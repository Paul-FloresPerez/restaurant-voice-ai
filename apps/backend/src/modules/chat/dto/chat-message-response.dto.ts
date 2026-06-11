import { OrderResponseDto } from '../../order/dto/order-response.dto';

export type ChatIntent =
  | 'ADD_ITEM'
  | 'REMOVE_ITEM'
  | 'READ_MENU'
  | 'CATEGORY_QUERY'
  | 'MENU_CATEGORIES'
  | 'ORDER_SUMMARY'
  | 'CONFIRM_ORDER'
  | 'AFFIRMATION'
  | 'NEGATION'
  | 'UNKNOWN';

export class ChatMessageResponseDto {
  sessionId: string;
  orderId: string;
  intent: ChatIntent;
  assistantMessage: string;
  order: OrderResponseDto;
}
