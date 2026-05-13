export type ChatIntent =
  | 'ADD_ITEM'
  | 'REMOVE_ITEM'
  | 'MENU_CATEGORIES'
  | 'ORDER_SUMMARY'
  | 'CONFIRM_ORDER'
  | 'UNKNOWN';

export class ChatMessageResponseDto {
  sessionId: string;
  orderId: string;
  intent: ChatIntent;
  assistantMessage: string;
}
