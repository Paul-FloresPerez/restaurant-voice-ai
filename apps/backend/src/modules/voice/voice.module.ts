import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { SttService } from './stt.service';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';

@Module({
  imports: [ChatModule],
  controllers: [VoiceController],
  providers: [VoiceService, SttService],
})
export class VoiceModule {}
