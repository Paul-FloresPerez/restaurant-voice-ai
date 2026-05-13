import { Injectable, NotFoundException } from '@nestjs/common';
import {
  interaction_role,
  order_event_type,
  order_status,
  session_status,
} from '../../../generated/prisma/enums';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ChatIntent,
  ChatMessageResponseDto,
} from './dto/chat-message-response.dto';
import { SendChatMessageDto } from './dto/send-chat-message.dto';

const orderInclude = {
  order_items: {
    include: {
      order_item_modifiers: true,
    },
    orderBy: { created_at: 'asc' },
  },
} satisfies Prisma.ordersInclude;

type OrderWithItems = Prisma.ordersGetPayload<{ include: typeof orderInclude }>;
type TxClient = Prisma.TransactionClient;

@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  async handleMessage(
    dto: SendChatMessageDto,
  ): Promise<ChatMessageResponseDto> {
    return this.prisma.$transaction(
      async (tx) => {
        await this.assertActiveSession(tx, dto.sessionId);
        await this.createInteractionLog(
          tx,
          dto.sessionId,
          interaction_role.USER,
          dto.message,
        );

        let order = await this.getOrCreateDraftOrder(tx, dto.sessionId);
        const intent = this.detectIntent(dto.message);
        let assistantMessage: string;

        if (intent === 'MENU_CATEGORIES') {
          assistantMessage = await this.buildMenuCategoriesMessage(tx);
        } else if (intent === 'ORDER_SUMMARY') {
          assistantMessage = this.buildOrderSummaryMessage(order);
        } else if (intent === 'CONFIRM_ORDER') {
          if (order.order_items.length === 0) {
            assistantMessage =
              'No puedo confirmar un pedido vacio. Primero agrega al menos un producto.';
          } else {
            order = await this.confirmDraftOrder(tx, order.id);
            assistantMessage = this.buildConfirmedOrderMessage(order);
          }
        } else {
          assistantMessage =
            'Estoy en modo prueba. Puedes pedirme el menu, el resumen de tu pedido o confirmar tu pedido.';
        }

        await this.createInteractionLog(
          tx,
          dto.sessionId,
          interaction_role.ASSISTANT,
          assistantMessage,
        );

        return {
          sessionId: dto.sessionId,
          orderId: order.id,
          intent,
          assistantMessage,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private detectIntent(message: string): ChatIntent {
    const normalizedMessage = this.normalize(message);

    if (
      this.containsAny(normalizedMessage, [
        'menu',
        'carta',
        'productos',
        'que hay',
      ])
    ) {
      return 'MENU_CATEGORIES';
    }

    if (this.containsAny(normalizedMessage, ['confirmar', 'confirmo'])) {
      return 'CONFIRM_ORDER';
    }

    if (
      this.containsAny(normalizedMessage, ['pedido', 'resumen', 'que pedi'])
    ) {
      return 'ORDER_SUMMARY';
    }

    return 'UNKNOWN';
  }

  private async assertActiveSession(
    tx: TxClient,
    sessionId: string,
  ): Promise<void> {
    const session = await tx.sessions.findFirst({
      where: {
        id: sessionId,
        status: session_status.ACTIVE,
      },
    });

    if (!session) {
      throw new NotFoundException('Active session not found');
    }
  }

  private async getOrCreateDraftOrder(
    tx: TxClient,
    sessionId: string,
  ): Promise<OrderWithItems> {
    const existingOrder = await tx.orders.findFirst({
      where: {
        session_id: sessionId,
        status: order_status.DRAFT,
      },
      include: orderInclude,
      orderBy: { created_at: 'desc' },
    });

    if (existingOrder) {
      return existingOrder;
    }

    const createdOrder = await tx.orders.create({
      data: {
        session_id: sessionId,
        status: order_status.DRAFT,
      },
      include: orderInclude,
    });

    await this.createOrderEvent(
      tx,
      createdOrder.id,
      order_event_type.ADD_NOTE,
      {
        action: 'CREATE_DRAFT_ORDER',
        sessionId,
        source: 'CHAT_MESSAGE',
      },
    );

    return createdOrder;
  }

  private async confirmDraftOrder(
    tx: TxClient,
    orderId: string,
  ): Promise<OrderWithItems> {
    await this.recalculateTotals(tx, orderId);

    await tx.orders.update({
      where: { id: orderId },
      data: {
        status: order_status.CONFIRMED,
        confirmed_at: new Date(),
      },
    });

    await this.createOrderEvent(tx, orderId, order_event_type.CONFIRM_ORDER, {
      source: 'CHAT_MESSAGE',
    });

    return this.findOrderOrThrow(tx, orderId);
  }

  private async buildMenuCategoriesMessage(tx: TxClient): Promise<string> {
    const categories = await tx.categories.findMany({
      where: { is_active: true },
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
    });

    if (categories.length === 0) {
      return 'Por ahora no tengo categorias disponibles en el menu.';
    }

    return `Tenemos estas categorias: ${categories
      .map((category) => category.name)
      .join(', ')}. Puedes pedirme una categoria o preguntar por productos.`;
  }

  private buildOrderSummaryMessage(order: OrderWithItems): string {
    if (order.order_items.length === 0) {
      return 'Tu pedido actual esta vacio. Puedes decirme que quieres agregar cuando estes listo.';
    }

    return `Tu pedido actual tiene: ${this.formatOrderItems(
      order,
    )}. Total: ${this.formatMoney(order.total)}. Aun no esta confirmado.`;
  }

  private buildConfirmedOrderMessage(order: OrderWithItems): string {
    return `Pedido confirmado. ${this.formatOrderItems(
      order,
    )}. Total: ${this.formatMoney(order.total)}.`;
  }

  private formatOrderItems(order: OrderWithItems): string {
    return order.order_items
      .map((item) => {
        const variant =
          item.variant_name_snapshot && item.variant_name_snapshot !== 'Default'
            ? ` ${item.variant_name_snapshot}`
            : '';
        const modifiers =
          item.order_item_modifiers.length > 0
            ? ` con ${item.order_item_modifiers
                .map((modifier) => modifier.option_name_snapshot)
                .join(', ')}`
            : '';

        return `${item.quantity} x ${item.item_name_snapshot}${variant}${modifiers}`;
      })
      .join('; ');
  }

  private async recalculateTotals(
    tx: TxClient,
    orderId: string,
  ): Promise<void> {
    const items = await tx.order_items.findMany({
      where: { order_id: orderId },
      select: { line_total: true },
    });

    const subtotal = items.reduce(
      (total, item) => total.plus(item.line_total),
      new Prisma.Decimal(0),
    );

    await tx.orders.update({
      where: { id: orderId },
      data: {
        subtotal,
        total: subtotal,
      },
    });
  }

  private async findOrderOrThrow(
    tx: TxClient,
    orderId: string,
  ): Promise<OrderWithItems> {
    const order = await tx.orders.findUnique({
      where: { id: orderId },
      include: orderInclude,
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return order;
  }

  private async createInteractionLog(
    tx: TxClient,
    sessionId: string,
    role: interaction_role,
    message: string,
  ): Promise<void> {
    await tx.interaction_logs.create({
      data: {
        session_id: sessionId,
        role,
        message,
      },
    });
  }

  private async createOrderEvent(
    tx: TxClient,
    orderId: string,
    type: order_event_type,
    payload: Prisma.InputJsonValue,
  ): Promise<void> {
    await tx.order_events.create({
      data: {
        order_id: orderId,
        type,
        payload,
      },
    });
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  private containsAny(value: string, patterns: string[]): boolean {
    return patterns.some((pattern) => value.includes(pattern));
  }

  private formatMoney(value: Prisma.Decimal): string {
    return `S/ ${value.toFixed(2)}`;
  }
}
