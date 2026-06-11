import {
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { VoiceMessageDto } from './dto/voice-message.dto';
import { VoiceMessageResponseDto } from './dto/voice-message-response.dto';
import { maxAudioFileSizeBytes, VoiceService } from './voice.service';
import { UploadedAudioFile } from './voice.types';

@Controller('voice')
export class VoiceController {
  constructor(private readonly voiceService: VoiceService) {}

  @Post('message')
  @UseInterceptors(
    FileInterceptor('audio', {
      limits: {
        fileSize: maxAudioFileSizeBytes,
      },
    }),
  )
  receiveMessage(
    @Body() dto: VoiceMessageDto,
    @UploadedFile() file: UploadedAudioFile | undefined,
  ): Promise<VoiceMessageResponseDto> {
    return this.voiceService.receiveAudio(dto, file);
  }
}
