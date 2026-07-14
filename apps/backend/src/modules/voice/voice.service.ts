import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import { ChatProcessingTelemetry, ChatService } from '../chat/chat.service';
import { VoiceMessageDto } from './dto/voice-message.dto';
import { VoiceMessageResponseDto } from './dto/voice-message-response.dto';
import { SttService } from './stt.service';
import { UploadedAudioFile } from './voice.types';

export const maxAudioFileSizeBytes = 10 * 1024 * 1024;

const allowedAudioMimeTypes = new Set([
  'audio/webm',
  'audio/wav',
  'audio/mpeg',
  'audio/mp4',
]);

type VoiceTimingMetrics = {
  receiveMs: number;
  sttMs: number;
  chatMs: number;
  aiMs: number;
  totalMs: number;
};

@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);

  constructor(
    private readonly sttService: SttService,
    private readonly chatService: ChatService,
  ) {}

  async receiveAudio(
    dto: VoiceMessageDto,
    file: UploadedAudioFile | undefined,
  ): Promise<VoiceMessageResponseDto> {
    const totalStartedAt = performance.now();
    const timingMetrics: VoiceTimingMetrics = {
      receiveMs: 0,
      sttMs: 0,
      chatMs: 0,
      aiMs: 0,
      totalMs: 0,
    };

    try {
      const receiveStartedAt = performance.now();

      try {
        this.validateAudioFile(file);
      } finally {
        timingMetrics.receiveMs = this.elapsedMs(receiveStartedAt);
      }

      const sttStartedAt = performance.now();
      let transcription: string;

      try {
        transcription = await this.sttService.transcribe(file);
      } finally {
        timingMetrics.sttMs = this.elapsedMs(sttStartedAt);
      }

      transcription = transcription.trim();

      if (!transcription) {
        throw new ServiceUnavailableException(
          'No se detecto una transcripcion valida. El pedido no fue modificado.',
        );
      }

      const chatTelemetry: ChatProcessingTelemetry = {};
      const chatStartedAt = performance.now();
      let chatResponse: Awaited<ReturnType<ChatService['handleMessage']>>;

      try {
        chatResponse = await this.chatService.handleMessage(
          {
            sessionId: dto.sessionId,
            message: transcription,
          },
          chatTelemetry,
        );
      } finally {
        const chatTotalMs = this.elapsedMs(chatStartedAt);

        timingMetrics.aiMs = chatTelemetry.aiMs ?? 0;
        timingMetrics.chatMs = Math.max(0, chatTotalMs - timingMetrics.aiMs);
      }

      return {
        sessionId: dto.sessionId,
        transcription,
        intent: chatResponse.intent,
        assistantMessage: chatResponse.assistantMessage,
        order: chatResponse.order,
      };
    } finally {
      timingMetrics.totalMs = this.elapsedMs(totalStartedAt);
      this.logTimingMetrics(timingMetrics);
    }
  }

  private validateAudioFile(
    file: UploadedAudioFile | undefined,
  ): asserts file is UploadedAudioFile {
    if (!file) {
      throw new BadRequestException('Audio file is required');
    }

    if (file.size <= 0 || file.buffer.length === 0) {
      throw new BadRequestException('Audio file is empty');
    }

    const normalizedMimeType = file.mimetype
      .split(';', 1)[0]
      .trim()
      .toLowerCase();

    if (!allowedAudioMimeTypes.has(normalizedMimeType)) {
      throw new BadRequestException('Unsupported audio MIME type');
    }

    if (
      file.size > maxAudioFileSizeBytes ||
      file.buffer.length > maxAudioFileSizeBytes
    ) {
      throw new BadRequestException('Audio file is too large');
    }
  }

  private logTimingMetrics(timingMetrics: VoiceTimingMetrics): void {
    this.logger.log(
      [
        `voice.totalMs=${timingMetrics.totalMs}`,
        `voice.sttMs=${timingMetrics.sttMs}`,
        `voice.chatMs=${timingMetrics.chatMs}`,
        `voice.aiMs=${timingMetrics.aiMs}`,
        `voice.receiveMs=${timingMetrics.receiveMs}`,
      ].join(' '),
    );
  }

  private elapsedMs(startedAt: number): number {
    return Math.max(0, Math.round(performance.now() - startedAt));
  }
}
