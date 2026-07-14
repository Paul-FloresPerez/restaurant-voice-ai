import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { extname, join, resolve } from 'path';
import { promisify } from 'util';
import { UploadedAudioFile } from './voice.types';

const execFileAsync = promisify(execFile);
const groqTranscriptionUrl =
  'https://api.groq.com/openai/v1/audio/transcriptions';
const defaultGroqTimeoutMs = 20000;

type FasterWhisperResponse = {
  text?: unknown;
  language?: unknown;
};

type GroqTranscriptionResponse = {
  text?: unknown;
};

@Injectable()
export class SttService {
  private readonly logger = new Logger(SttService.name);

  constructor(private readonly configService: ConfigService) {}

  async transcribe(audio: UploadedAudioFile): Promise<string> {
    const provider = this.sttProvider();

    if (provider === 'groq') {
      try {
        return await this.transcribeWithGroq(audio);
      } catch {
        this.logger.warn('Groq STT transcription failed');
        throw new ServiceUnavailableException(
          'No pude entender el audio. Intenta nuevamente.',
        );
      }
    }

    if (provider === 'browser') {
      throw new ServiceUnavailableException(
        'La transcripcion de audio no esta disponible en este despliegue. Envia texto a /chat/message.',
      );
    }

    if (provider !== 'faster-whisper') {
      throw new ServiceUnavailableException('STT provider is not supported');
    }

    try {
      return await this.transcribeWithFasterWhisper(audio);
    } catch {
      this.logger.warn('STT real transcription failed');
      throw new ServiceUnavailableException(
        'No se pudo transcribir el audio con STT local. El pedido no fue modificado.',
      );
    }
  }

  private async transcribeWithGroq(
    audio: UploadedAudioFile,
  ): Promise<string> {
    const apiKey = this.configService.get<string>('GROQ_API_KEY')?.trim();

    if (!apiKey) {
      throw new Error('GROQ_API_KEY is not configured');
    }

    const formData = new FormData();
    const audioBytes = new Uint8Array(audio.buffer);
    const audioBlob = new Blob([audioBytes], {
      type: this.normalizedMimeType(audio.mimetype),
    });

    formData.append('file', audioBlob, this.audioFilename(audio));
    formData.append('model', this.groqModelName());
    formData.append('language', 'es');
    formData.append('response_format', 'json');
    formData.append('temperature', '0');

    const abortController = new AbortController();
    const timeout = setTimeout(
      () => abortController.abort(),
      this.groqTimeoutMs(),
    );

    try {
      const response = await fetch(groqTranscriptionUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`Groq STT returned HTTP ${response.status}`);
      }

      const parsed = (await response.json()) as GroqTranscriptionResponse;

      if (typeof parsed.text !== 'string' || !parsed.text.trim()) {
        throw new Error('Groq STT returned an empty transcription');
      }

      return parsed.text.trim();
    } finally {
      clearTimeout(timeout);
    }
  }

  private async transcribeWithFasterWhisper(
    audio: UploadedAudioFile,
  ): Promise<string> {
    const tempFilePath = await this.writeTemporaryAudioFile(audio);

    try {
      const { stdout } = await execFileAsync(
        this.pythonPath(),
        [
          this.scriptPath(),
          tempFilePath,
          '--model',
          this.modelName(),
          '--language',
          'es',
        ],
        {
          cwd: process.cwd(),
          timeout: 120000,
          windowsHide: true,
          maxBuffer: 1024 * 1024,
        },
      );

      const parsed = this.parseFasterWhisperResponse(stdout);

      if (!parsed.text) {
        throw new Error('STT returned empty transcription');
      }

      return parsed.text;
    } finally {
      await rm(tempFilePath, { force: true });
    }
  }

  private parseFasterWhisperResponse(stdout: string): { text: string } {
    let parsed: FasterWhisperResponse;

    try {
      parsed = JSON.parse(stdout) as FasterWhisperResponse;
    } catch {
      throw new Error('STT returned invalid JSON');
    }

    if (typeof parsed.text !== 'string') {
      throw new Error('STT response is missing text');
    }

    return { text: parsed.text.trim() };
  }

  private async writeTemporaryAudioFile(
    audio: UploadedAudioFile,
  ): Promise<string> {
    const tempDirectory = join(tmpdir(), 'restaurant-voice-ai-stt');
    const extension = this.audioExtension(audio);
    const tempFilePath = join(tempDirectory, `${randomUUID()}${extension}`);

    await mkdir(tempDirectory, { recursive: true });
    await writeFile(tempFilePath, audio.buffer);

    return tempFilePath;
  }

  private audioExtension(audio: UploadedAudioFile): string {
    const originalExtension = extname(audio.originalname);

    if (originalExtension) {
      return originalExtension;
    }

    const extensionsByMimeType: Record<string, string> = {
      'audio/webm': '.webm',
      'audio/wav': '.wav',
      'audio/mpeg': '.mp3',
      'audio/mp4': '.mp4',
    };

    return extensionsByMimeType[audio.mimetype] ?? '.audio';
  }

  private audioFilename(audio: UploadedAudioFile): string {
    const extensionByMimeType: Record<string, string> = {
      'audio/webm': '.webm',
      'audio/wav': '.wav',
      'audio/mpeg': '.mp3',
      'audio/mp4': '.mp4',
    };
    const extension =
      extensionByMimeType[this.normalizedMimeType(audio.mimetype)] ?? '.webm';

    return `audio${extension}`;
  }

  private normalizedMimeType(mimeType: string): string {
    return mimeType.split(';', 1)[0].trim().toLowerCase();
  }

  private pythonPath(): string {
    const configuredPath =
      this.configService.get<string>('STT_PYTHON_PATH')?.trim() ||
      '.venv/Scripts/python.exe';

    return resolve(process.cwd(), configuredPath);
  }

  private scriptPath(): string {
    return resolve(process.cwd(), 'src/modules/voice/stt-python/transcribe.py');
  }

  private modelName(): string {
    return this.configService.get<string>('STT_MODEL')?.trim() || 'base';
  }

  private groqModelName(): string {
    return (
      this.configService.get<string>('GROQ_STT_MODEL')?.trim() ||
      'whisper-large-v3-turbo'
    );
  }

  private groqTimeoutMs(): number {
    const configuredTimeout = Number(
      this.configService.get<string>('GROQ_STT_TIMEOUT_MS')?.trim(),
    );

    return Number.isFinite(configuredTimeout) && configuredTimeout >= 1000
      ? Math.min(configuredTimeout, 120000)
      : defaultGroqTimeoutMs;
  }

  private sttProvider(): string {
    return (
      this.configService.get<string>('STT_PROVIDER')?.trim() || 'faster-whisper'
    );
  }
}
