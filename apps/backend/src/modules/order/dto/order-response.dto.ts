export class OrderItemModifierResponseDto {
  id: string;
  modifierOptionId: string | null;
  groupName: string;
  optionName: string;
  priceDelta: string;
  quantity: number;
}

export class OrderItemResponseDto {
  id: string;
  menuItemId: string;
  variantId: string;
  itemName: string;
  variantName: string | null;
  unitPrice: string;
  quantity: number;
  specialInstructions: string | null;
  lineTotal: string;
  modifiers: OrderItemModifierResponseDto[];
}

export class OrderResponseDto {
  id: string;
  sessionId: string;
  status: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  notes: string | null;
  confirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  items: OrderItemResponseDto[];
}
