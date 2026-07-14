import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SttService } from './stt.service';

describe('SttService browser provider', () => {
  const configService = {
    get: jest.fn().mockImplementation((key: string) =>
      key === 'STT_PROVIDER' ? 'browser' : '',
    ),
  } as unknown as ConfigService;
  const service = new SttService(configService);

  it('returns a controlled error without invoking Python', async () => {
    await expect(
      service.transcribe({
        originalname: 'message.webm',
        mimetype: 'audio/webm',
        size: 1,
        buffer: Buffer.from('a'),
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
