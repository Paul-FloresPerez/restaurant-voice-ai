import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { ChatService } from '../chat/chat.service';
import { SttService } from './stt.service';
import { UploadedAudioFile } from './voice.types';
import { maxAudioFileSizeBytes, VoiceService } from './voice.service';

describe('VoiceService safe transcription flow', () => {
  const audio: UploadedAudioFile = {
    originalname: 'message.webm',
    mimetype: 'audio/webm;codecs=opus',
    size: 1,
    buffer: Buffer.from('a'),
  };

  const createService = () => {
    const transcribe = jest.fn();
    const handleMessage = jest.fn();
    const sttService = { transcribe } as unknown as SttService;
    const chatService = { handleMessage } as unknown as ChatService;

    return {
      service: new VoiceService(sttService, chatService),
      transcribe,
      handleMessage,
    };
  };

  it('does not call chat or create products when STT fails', async () => {
    const { service, transcribe, handleMessage } = createService();
    transcribe.mockRejectedValue(
      new ServiceUnavailableException('STT unavailable'),
    );

    await expect(
      service.receiveAudio({ sessionId: randomUUID() }, audio),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(handleMessage).not.toHaveBeenCalled();
  });

  it('does not call chat for an empty transcription', async () => {
    const { service, transcribe, handleMessage } = createService();
    transcribe.mockResolvedValue('   ');

    await expect(
      service.receiveAudio({ sessionId: randomUUID() }, audio),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(handleMessage).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'empty audio',
      file: { ...audio, size: 0, buffer: Buffer.alloc(0) },
    },
    {
      name: 'unsupported MIME type',
      file: { ...audio, mimetype: 'audio/ogg' },
    },
    {
      name: 'audio larger than 10 MB',
      file: { ...audio, size: maxAudioFileSizeBytes + 1 },
    },
  ])('rejects $name before STT or ChatService', async ({ file }) => {
    const { service, transcribe, handleMessage } = createService();

    await expect(
      service.receiveAudio({ sessionId: randomUUID() }, file),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transcribe).not.toHaveBeenCalled();
    expect(handleMessage).not.toHaveBeenCalled();
  });

  it('passes a gaseosa transcription unchanged to ChatService', async () => {
    const { service, transcribe, handleMessage } = createService();
    transcribe.mockResolvedValue('quiero una gaseosa');
    handleMessage.mockResolvedValue({
      sessionId: 'session-id',
      orderId: 'order-id',
      intent: 'ADD_ITEM',
      assistantMessage: 'Listo.',
      order: null,
    });
    const sessionId = randomUUID();

    await service.receiveAudio({ sessionId }, audio);

    expect(handleMessage).toHaveBeenCalledWith(
      {
        sessionId,
        message: 'quiero una gaseosa',
      },
      expect.any(Object),
    );
  });

  it('does not call ChatService when the Groq request fails', async () => {
    const configService = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          STT_PROVIDER: 'groq',
          GROQ_API_KEY: 'test-key',
        };

        return values[key] ?? '';
      }),
    } as unknown as ConfigService;
    const sttService = new SttService(configService);
    const handleMessage = jest.fn();
    const chatService = { handleMessage } as unknown as ChatService;
    const service = new VoiceService(sttService, chatService);
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 503 }));

    await expect(
      service.receiveAudio({ sessionId: randomUUID() }, audio),
    ).rejects.toMatchObject({
      message: 'No pude entender el audio. Intenta nuevamente.',
    });
    expect(handleMessage).not.toHaveBeenCalled();
  });
});
