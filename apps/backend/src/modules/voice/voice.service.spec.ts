import { ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ChatService } from '../chat/chat.service';
import { SttService } from './stt.service';
import { UploadedAudioFile } from './voice.types';
import { VoiceService } from './voice.service';

describe('VoiceService safe transcription flow', () => {
  const audio: UploadedAudioFile = {
    originalname: 'message.webm',
    mimetype: 'audio/webm',
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
});
