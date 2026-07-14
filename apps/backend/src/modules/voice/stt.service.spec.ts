import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SttService } from './stt.service';
import { UploadedAudioFile } from './voice.types';

const audio: UploadedAudioFile = {
  originalname: 'message.webm',
  mimetype: 'audio/webm',
  size: 1,
  buffer: Buffer.from('a'),
};

const configService = (values: Record<string, string>) =>
  ({
    get: jest.fn((key: string) => values[key] ?? ''),
  }) as unknown as ConfigService;

const failLocalStt = (service: SttService) => {
  (
    service as unknown as {
      transcribeWithFasterWhisper: jest.Mock;
    }
  ).transcribeWithFasterWhisper = jest
    .fn()
    .mockRejectedValue(new Error('local STT failed'));
};

describe('SttService safe providers', () => {
  it('returns 503 for browser provider and directs clients to chat', async () => {
    const service = new SttService(
      configService({ STT_PROVIDER: 'browser' }),
    );

    await expect(service.transcribe(audio)).rejects.toMatchObject({
      status: 503,
      message: expect.stringContaining('/chat/message'),
    });
  });

  it('returns a controlled error without inventing text when local STT fails', async () => {
    const service = new SttService(
      configService({ STT_PROVIDER: 'faster-whisper' }),
    );
    failLocalStt(service);

    await expect(service.transcribe(audio)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('allows an explicitly configured simulated transcription only in tests', async () => {
    const service = new SttService(
      configService({
        STT_PROVIDER: 'faster-whisper',
        STT_SIMULATED_FALLBACK: 'true',
        STT_SIMULATED_TRANSCRIPTION: 'transcripcion automatizada de prueba',
      }),
    );
    failLocalStt(service);

    await expect(service.transcribe(audio)).resolves.toBe(
      'transcripcion automatizada de prueba',
    );
  });

  it('ignores simulated fallback outside NODE_ENV=test', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    try {
      const service = new SttService(
        configService({
          STT_PROVIDER: 'faster-whisper',
          STT_SIMULATED_FALLBACK: 'true',
          STT_SIMULATED_TRANSCRIPTION: 'transcripcion no permitida',
        }),
      );
      failLocalStt(service);

      await expect(service.transcribe(audio)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });
});
