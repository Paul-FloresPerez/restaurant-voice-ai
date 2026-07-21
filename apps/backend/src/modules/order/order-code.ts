export function createOrderCode(orderId: string): string {
  return orderId.replaceAll('-', '').slice(0, 8).toUpperCase();
}
