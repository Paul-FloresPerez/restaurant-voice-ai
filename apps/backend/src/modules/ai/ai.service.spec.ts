import { ConfigService } from '@nestjs/config';
import { AiService } from './ai.service';

describe('AiService without Ollama', () => {
  const configService = {
    get: jest.fn().mockReturnValue(''),
  } as unknown as ConfigService;
  const service = new AiService(configService);

  it('reports Ollama as optional when no base URL is configured', async () => {
    await expect(service.checkHealth()).resolves.toEqual({
      ok: false,
      enabled: false,
      baseUrl: '',
      model: 'qwen2.5:3b',
      modelAvailable: false,
      error: 'OLLAMA_NOT_CONFIGURED',
    });
  });

  it('uses the local fallback without requesting Ollama', async () => {
    await expect(
      service.interpretMessage('quiero una hamburguesa', {}),
    ).resolves.toBeNull();
  });
});
