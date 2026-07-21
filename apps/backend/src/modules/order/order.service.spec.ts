import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import {
  order_event_type,
  order_status,
} from '../../../generated/prisma/enums';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderService } from './order.service';

const orderId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';

function createOrder(status: order_status, itemCount = 1) {
  const now = new Date('2026-07-21T12:00:00.000Z');

  return {
    id: orderId,
    session_id: sessionId,
    order_code: status === order_status.DRAFT ? null : '11111111',
    status,
    subtotal: new Prisma.Decimal(20),
    discount_total: new Prisma.Decimal(0),
    tax_total: new Prisma.Decimal(0),
    total: new Prisma.Decimal(20),
    notes: null,
    confirmed_at: status === order_status.DRAFT ? null : now,
    cancelled_at: null,
    created_at: now,
    updated_at: now,
    order_items: Array.from({ length: itemCount }, (_, index) => ({
      id: `33333333-3333-4333-8333-33333333333${index}`,
      order_id: orderId,
      variant_id: '44444444-4444-4444-8444-444444444444',
      menu_item_id: '55555555-5555-4555-8555-555555555555',
      item_name_snapshot: 'Hamburguesa clásica',
      variant_name_snapshot: 'Default',
      unit_price_snapshot: new Prisma.Decimal(20),
      quantity: 1,
      special_instructions: null,
      line_total: new Prisma.Decimal(20),
      created_at: now,
      updated_at: now,
      order_item_modifiers: [],
    })),
  };
}

function createTransactionMock() {
  return {
    orders: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    order_items: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    order_events: {
      create: jest.fn(),
    },
  };
}

function createTransactionalService(
  tx: ReturnType<typeof createTransactionMock>,
) {
  const prisma = {
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  } as unknown as PrismaService;

  return new OrderService(prisma);
}

describe('OrderService confirmation', () => {
  it('confirms a non-empty DRAFT order and records one event', async () => {
    const tx = createTransactionMock();
    tx.orders.findUnique
      .mockResolvedValueOnce(createOrder(order_status.DRAFT))
      .mockResolvedValueOnce(createOrder(order_status.CONFIRMED));
    tx.order_items.count.mockResolvedValue(1);
    tx.order_items.findMany.mockResolvedValue([
      { line_total: new Prisma.Decimal(20) },
    ]);
    tx.orders.updateMany.mockResolvedValue({ count: 1 });
    const service = createTransactionalService(tx);

    const result = await service.confirm(orderId);
    // Jest stores mock call arguments as any; narrow the inspected contract here.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const confirmUpdate = tx.orders.updateMany.mock.calls[0]?.[0] as {
      where: { id: string; status: order_status };
      data: { status: order_status; order_code: string };
    };

    expect(result.status).toBe('CONFIRMED');
    expect(confirmUpdate.where).toEqual({
      id: orderId,
      status: order_status.DRAFT,
    });
    expect(confirmUpdate.data.status).toBe(order_status.CONFIRMED);
    expect(confirmUpdate.data.order_code).toBe('11111111');
    expect(tx.order_events.create).toHaveBeenCalledTimes(1);
  });

  it('does not confirm an empty order', async () => {
    const tx = createTransactionMock();
    tx.orders.findUnique.mockResolvedValue(createOrder(order_status.DRAFT, 0));
    tx.order_items.count.mockResolvedValue(0);
    const service = createTransactionalService(tx);

    await expect(service.confirm(orderId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tx.orders.update).not.toHaveBeenCalled();
    expect(tx.order_events.create).not.toHaveBeenCalled();
  });

  it('returns an already confirmed order without duplicate updates or events', async () => {
    const tx = createTransactionMock();
    tx.orders.findUnique.mockResolvedValue(createOrder(order_status.CONFIRMED));
    const service = createTransactionalService(tx);

    const result = await service.confirm(orderId);

    expect(result.status).toBe('CONFIRMED');
    expect(tx.orders.update).not.toHaveBeenCalled();
    expect(tx.order_events.create).not.toHaveBeenCalled();
  });

  it('does not duplicate confirmation when another request wins the race', async () => {
    const tx = createTransactionMock();
    tx.orders.findUnique
      .mockResolvedValueOnce(createOrder(order_status.DRAFT))
      .mockResolvedValueOnce(createOrder(order_status.CONFIRMED));
    tx.order_items.count.mockResolvedValue(1);
    tx.order_items.findMany.mockResolvedValue([
      { line_total: new Prisma.Decimal(20) },
    ]);
    tx.orders.updateMany.mockResolvedValue({ count: 0 });
    const service = createTransactionalService(tx);

    const result = await service.confirm(orderId);

    expect(result.status).toBe('CONFIRMED');
    expect(tx.order_events.create).not.toHaveBeenCalled();
  });
});

describe('OrderService kitchen queue', () => {
  it('lists active confirmed orders from oldest to newest', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValue([createOrder(order_status.CONFIRMED)]);
    const prisma = { orders: { findMany } } as unknown as PrismaService;
    const service = new OrderService(prisma);

    const result = await service.findKitchenOrders();

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('CONFIRMED');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: {
            in: [
              order_status.CONFIRMED,
              order_status.IN_PREPARATION,
              order_status.READY,
            ],
          },
        },
        orderBy: [{ confirmed_at: 'asc' }, { created_at: 'asc' }],
      }),
    );
  });

  it.each([
    {
      current: order_status.CONFIRMED,
      requested: 'PREPARING' as const,
      stored: order_status.IN_PREPARATION,
    },
    {
      current: order_status.IN_PREPARATION,
      requested: 'READY' as const,
      stored: order_status.READY,
    },
    {
      current: order_status.READY,
      requested: 'DELIVERED' as const,
      stored: order_status.DELIVERED,
    },
  ])(
    'moves $current to $requested and records the transition',
    async ({ current, requested, stored }) => {
      const tx = createTransactionMock();
      tx.orders.findUnique
        .mockResolvedValueOnce(createOrder(current))
        .mockResolvedValueOnce(createOrder(stored));
      const service = createTransactionalService(tx);

      const result = await service.updateKitchenStatus(orderId, requested);
      // Jest stores mock call arguments as any; narrow the inspected contract here.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const eventCreate = tx.order_events.create.mock.calls[0]?.[0] as {
        data: {
          order_id: string;
          type: order_event_type;
          payload: Record<string, string>;
        };
      };

      expect(result.status).toBe(requested);
      expect(tx.orders.update).toHaveBeenCalledWith({
        where: { id: orderId },
        data: { status: stored },
      });
      expect(eventCreate.data.order_id).toBe(orderId);
      expect(eventCreate.data.type).toBe(order_event_type.ADD_NOTE);
      expect(eventCreate.data.payload).toEqual({
        action: 'KITCHEN_STATUS_CHANGE',
        previousStatus:
          current === order_status.IN_PREPARATION ? 'PREPARING' : current,
        status: requested,
      });
    },
  );

  it('rejects an invalid kitchen transition', async () => {
    const tx = createTransactionMock();
    tx.orders.findUnique.mockResolvedValue(createOrder(order_status.CONFIRMED));
    const service = createTransactionalService(tx);

    await expect(
      service.updateKitchenStatus(orderId, 'READY'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.orders.update).not.toHaveBeenCalled();
    expect(tx.order_events.create).not.toHaveBeenCalled();
  });
});
