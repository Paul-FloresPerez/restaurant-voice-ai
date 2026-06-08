import { BadRequestException, Injectable } from '@nestjs/common';
import { VoiceMessageDto } from './dto/voice-message.dto';
import { VoiceMessageResponseDto } from './dto/voice-message-response.dto';
import { UploadedAudioFile } from './voice.types';

export const maxAudioFileSizeBytes = 10 * 1024 * 1024;

const allowedAudioMimeTypes = new Set([
  'audio/webm',
  'audio/wav',
  'audio/mpeg',
  'audio/mp4',
]);

@Injectable()
export class VoiceService {
  receiveAudio(
    dto: VoiceMessageDto,
    file: UploadedAudioFile | undefined,
  ): VoiceMessageResponseDto {
    this.validateAudioFile(file);

    return {
      message: 'Audio recibido correctamente',
      sessionId: dto.sessionId,
      fileInfo: {
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
      },
    };
  }

  private validateAudioFile(
    file: UploadedAudioFile | undefined,
  ): asserts file is UploadedAudioFile {
    if (!file) {
      throw new BadRequestException('Audio file is required');
    }

    if (!allowedAudioMimeTypes.has(file.mimetype)) {
      throw new BadRequestException('Unsupported audio MIME type');
    }

    if (file.size > maxAudioFileSizeBytes) {
      throw new BadRequestException('Audio file is too large');
    }
  }
}
