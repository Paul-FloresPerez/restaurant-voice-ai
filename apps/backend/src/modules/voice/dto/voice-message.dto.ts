import { IsUUID } from 'class-validator';

export class VoiceMessageDto {
  @IsUUID()
  sessionId: string;
}
