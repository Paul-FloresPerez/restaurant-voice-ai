import { OrderResponseDto } from '../../order/dto/order-response.dto';
import { ChatIntent } from '../../chat/dto/chat-message-response.dto';

export class VoiceMessageResponseDto {
  sessionId: string;
  transcription: string;
  intent: ChatIntent;
  assistantMessage: string;
  order: OrderResponseDto;
}
