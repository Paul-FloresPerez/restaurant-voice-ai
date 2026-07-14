import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SttService } from './stt.service';
import { UploadedAudioFile } from './voice.types';

const audio: UploadedAudioFile = {
  originalname: 'message.webm',
  mimetype: 'audio/webm;codecs=opus',
  size: 4,
  buffer: Buffer.from('audio'),
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

describe('SttService providers', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends real audio to Groq with the configured transcription fields', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ text: '  quiero una gaseosa  ' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const service = new SttService(
      configService({
        STT_PROVIDER: 'groq',
        GROQ_API_KEY: 'test-key',
        GROQ_STT_MODEL: 'whisper-large-v3-turbo',
      }),
    );

    await expect(service.transcribe(audio)).resolves.toBe(
      'quiero una gaseosa',
    );

    const [url, request] = fetchMock.mock.calls[0];
    const body = request?.body as FormData;
    const file = body.get('file');

    expect(url).toBe(
      'https://api.groq.com/openai/v1/audio/transcriptions',
    );
    expect(request?.method).toBe('POST');
    expect(request?.headers).toEqual({ Authorization: 'Bearer test-key' });
    expect(file).toBeInstanceOf(Blob);
    expect((file as Blob).type).toBe('audio/webm');
    expect(body.get('model')).toBe('whisper-large-v3-turbo');
    expect(body.get('language')).toBe('es');
    expect(body.get('response_format')).toBe('json');
    expect(body.get('temperature')).toBe('0');
  });

  it('returns the controlled message when Groq fails', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 503 }));
    const service = new SttService(
      configService({
        STT_PROVIDER: 'groq',
        GROQ_API_KEY: 'test-key',
      }),
    );

    await expect(service.transcribe(audio)).rejects.toMatchObject({
      status: 503,
      message: 'No pude entender el audio. Intenta nuevamente.',
    });
  });

  it('does not use a simulated fallback when local STT fails', async () => {
    const service = new SttService(
      configService({
        STT_PROVIDER: 'faster-whisper',
        STT_SIMULATED_FALLBACK: 'true',
        STT_SIMULATED_TRANSCRIPTION: 'quiero una hamburguesa vegetariana',
      }),
    );
    failLocalStt(service);

    await expect(service.transcribe(audio)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('returns 503 for the legacy browser provider', async () => {
    const service = new SttService(
      configService({ STT_PROVIDER: 'browser' }),
    );

    await expect(service.transcribe(audio)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
