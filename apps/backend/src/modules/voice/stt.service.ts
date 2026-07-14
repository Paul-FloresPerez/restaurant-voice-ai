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

type FasterWhisperResponse = {
  text?: unknown;
  language?: unknown;
};

@Injectable()
export class SttService {
  private readonly logger = new Logger(SttService.name);

  constructor(private readonly configService: ConfigService) {}

  async transcribe(audio: UploadedAudioFile): Promise<string> {
    const provider = this.sttProvider();

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

      const simulatedTranscription = this.simulatedTranscriptionForTest();

      if (simulatedTranscription) {
        return simulatedTranscription;
      }

      throw new ServiceUnavailableException(
        'No se pudo transcribir el audio con STT local. El pedido no fue modificado.',
      );
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

  private sttProvider(): string {
    return (
      this.configService.get<string>('STT_PROVIDER')?.trim() || 'faster-whisper'
    );
  }

  private simulatedTranscriptionForTest(): string | null {
    if (process.env.NODE_ENV !== 'test') {
      return null;
    }

    const value = this.configService
      .get<string>('STT_SIMULATED_FALLBACK')
      ?.trim()
      .toLowerCase();

    if (value !== 'true') {
      return null;
    }

    const configuredTranscription = this.configService
      .get<string>('STT_SIMULATED_TRANSCRIPTION')
      ?.trim();

    return configuredTranscription || null;
  }
}
