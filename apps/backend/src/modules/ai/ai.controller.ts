import { Body, Controller, Get, Post } from '@nestjs/common';
import { AiHealthResponse, AiInterpretation, AiService } from './ai.service';
import { InterpretMessageDto } from './dto/interpret-message.dto';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Get('health')
  checkHealth(): Promise<AiHealthResponse> {
    return this.aiService.checkHealth();
  }

  @Post('interpret')
  interpretMessage(
    @Body() dto: InterpretMessageDto,
  ): Promise<AiInterpretation | null> {
    return this.aiService.interpretMessage(dto.message, {
      source: 'AI_DIAGNOSTIC_ENDPOINT',
    });
  }
}
