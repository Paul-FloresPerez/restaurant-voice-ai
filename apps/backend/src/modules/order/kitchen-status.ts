import { order_status } from '../../../generated/prisma/enums';

export const kitchenStatusValues = ['PREPARING', 'READY', 'DELIVERED'] as const;

export type KitchenStatus = (typeof kitchenStatusValues)[number];

export const activeKitchenDatabaseStatuses = [
  order_status.CONFIRMED,
  order_status.IN_PREPARATION,
  order_status.READY,
] as const;

export function toDatabaseKitchenStatus(status: KitchenStatus): order_status {
  if (status === 'PREPARING') {
    return order_status.IN_PREPARATION;
  }

  return order_status[status];
}

export function toApiKitchenStatus(status: order_status): string {
  return status === order_status.IN_PREPARATION ? 'PREPARING' : status;
}

export function isValidKitchenTransition(
  currentStatus: order_status,
  nextStatus: order_status,
): boolean {
  return (
    (currentStatus === order_status.CONFIRMED &&
      nextStatus === order_status.IN_PREPARATION) ||
    (currentStatus === order_status.IN_PREPARATION &&
      nextStatus === order_status.READY) ||
    (currentStatus === order_status.READY &&
      nextStatus === order_status.DELIVERED)
  );
}
