export type ChatIntent =
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
