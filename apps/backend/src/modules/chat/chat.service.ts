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
type MenuItemWithVariants = Prisma.menu_itemsGetPayload<{
  include: {
    menu_item_variants: true;
  };
}>;
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

        if (intent === 'ADD_ITEM') {
          const result = await this.addRequestedItem(tx, order, dto.message);
          order = result.order;
          assistantMessage = result.assistantMessage;
        } else if (intent === 'REMOVE_ITEM') {
          const result = await this.removeRequestedItem(tx, order, dto.message);
          order = result.order;
          assistantMessage = result.assistantMessage;
        } else if (intent === 'CONFIRM_ORDER') {
          if (order.order_items.length === 0) {
            assistantMessage =
              'No puedo confirmar un pedido vacio. Primero agrega al menos un producto.';
          } else {
            order = await this.confirmDraftOrder(tx, order.id);
            assistantMessage = this.buildConfirmedOrderMessage(order);
          }
        } else if (intent === 'ORDER_SUMMARY') {
          assistantMessage = this.buildOrderSummaryMessage(order);
        } else if (intent === 'MENU_CATEGORIES') {
          assistantMessage = await this.buildMenuCategoriesMessage(tx);
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

    if (this.containsAny(normalizedMessage, ['confirmar', 'confirmo'])) {
      return 'CONFIRM_ORDER';
    }

    if (
      this.containsAny(normalizedMessage, [
        'repiteme mi pedido',
        'repite mi pedido',
        'resumen',
        'que pedi',
      ])
    ) {
      return 'ORDER_SUMMARY';
    }

    if (this.containsAny(normalizedMessage, ['quita', 'elimina'])) {
      return 'REMOVE_ITEM';
    }

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

    if (
      this.containsAny(normalizedMessage, [
        'quiero',
        'agrega',
        'anade',
        'ponme',
        'dame',
      ])
    ) {
      return 'ADD_ITEM';
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

  private async addRequestedItem(
    tx: TxClient,
    order: OrderWithItems,
    message: string,
  ): Promise<{ order: OrderWithItems; assistantMessage: string }> {
    const matches = await this.findMatchingMenuItems(tx, message);

    if (matches.length === 0) {
      return {
        order,
        assistantMessage:
          'No encontre ese producto en el menu. Puedes decirlo de otra forma o pedirme los productos disponibles.',
      };
    }

    if (matches.length > 1) {
      return {
        order,
        assistantMessage: `Encontre varias opciones: ${matches
          .map((item) => item.name)
          .join(', ')}. Dime cual quieres agregar.`,
      };
    }

    const item = matches[0];
    const defaultVariant = item.menu_item_variants.find(
      (variant) => variant.is_default && variant.is_available,
    );

    if (!defaultVariant) {
      return {
        order,
        assistantMessage: `Encontre ${item.name}, pero no tiene una variante default disponible para agregar.`,
      };
    }

    const createdItem = await tx.order_items.create({
      data: {
        order_id: order.id,
        variant_id: defaultVariant.id,
        menu_item_id: item.id,
        item_name_snapshot: item.name,
        variant_name_snapshot: defaultVariant.name,
        unit_price_snapshot: defaultVariant.price,
        quantity: 1,
        line_total: defaultVariant.price,
      },
    });

    await this.recalculateTotals(tx, order.id);
    await this.createOrderEvent(tx, order.id, order_event_type.ADD_ITEM, {
      itemId: createdItem.id,
      variantId: defaultVariant.id,
      quantity: 1,
      source: 'CHAT_MESSAGE',
    });

    const updatedOrder = await this.findOrderOrThrow(tx, order.id);

    return {
      order: updatedOrder,
      assistantMessage: `Agregue 1 ${item.name} a tu pedido. Total actual: ${this.formatMoney(
        updatedOrder.total,
      )}.`,
    };
  }

  private async removeRequestedItem(
    tx: TxClient,
    order: OrderWithItems,
    message: string,
  ): Promise<{ order: OrderWithItems; assistantMessage: string }> {
    if (order.order_items.length === 0) {
      return {
        order,
        assistantMessage: 'Tu pedido esta vacio. No hay productos para quitar.',
      };
    }

    const matches = this.findMatchingOrderItems(order, message);

    if (matches.length === 0) {
      return {
        order,
        assistantMessage:
          'No encontre ese producto en tu pedido actual. Puedes pedirme el resumen para revisar lo que tienes.',
      };
    }

    if (matches.length > 1) {
      return {
        order,
        assistantMessage: `Encontre varias opciones en tu pedido: ${matches
          .map((item) => item.item_name_snapshot)
          .join(', ')}. Dime cual quieres quitar.`,
      };
    }

    const [item] = matches;

    await tx.order_items.delete({ where: { id: item.id } });
    await this.recalculateTotals(tx, order.id);
    await this.createOrderEvent(tx, order.id, order_event_type.REMOVE_ITEM, {
      itemId: item.id,
      source: 'CHAT_MESSAGE',
    });

    const updatedOrder = await this.findOrderOrThrow(tx, order.id);

    return {
      order: updatedOrder,
      assistantMessage: `Quite ${item.item_name_snapshot} de tu pedido. Total actual: ${this.formatMoney(
        updatedOrder.total,
      )}.`,
    };
  }

  private async findMatchingMenuItems(
    tx: TxClient,
    message: string,
  ): Promise<MenuItemWithVariants[]> {
    const items = await tx.menu_items.findMany({
      where: {
        is_active: true,
        is_available: true,
        categories: {
          is_active: true,
        },
      },
      include: {
        menu_item_variants: {
          where: { is_available: true },
          orderBy: [
            { is_default: 'desc' },
            { sort_order: 'asc' },
            { name: 'asc' },
          ],
        },
      },
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
    });

    return items.filter((item) =>
      this.itemMatchesMessage(message, [item.name, ...item.search_aliases]),
    );
  }

  private findMatchingOrderItems(
    order: OrderWithItems,
    message: string,
  ): OrderWithItems['order_items'] {
    return order.order_items.filter((item) =>
      this.itemMatchesMessage(message, [item.item_name_snapshot]),
    );
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

  private itemMatchesMessage(message: string, terms: string[]): boolean {
    const normalizedMessage = this.normalize(message);
    const messageTokens = this.toMeaningfulTokens(normalizedMessage);

    return terms.some((term) => {
      const normalizedTerm = this.normalize(term);

      if (!normalizedTerm) {
        return false;
      }

      if (normalizedMessage.includes(normalizedTerm)) {
        return true;
      }

      const termTokens = this.toMeaningfulTokens(normalizedTerm);

      return (
        messageTokens.length > 0 &&
        messageTokens.every((token) => termTokens.includes(token))
      );
    });
  }

  private toMeaningfulTokens(value: string): string[] {
    const stopwords = new Set([
      'agrega',
      'al',
      'anade',
      'con',
      'dame',
      'del',
      'el',
      'elimina',
      'favor',
      'la',
      'las',
      'los',
      'me',
      'mi',
      'para',
      'pedido',
      'ponme',
      'por',
      'quita',
      'quiero',
      'un',
      'una',
    ]);

    return this.normalize(value)
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 1 && !stopwords.has(token));
  }

  private containsAny(value: string, patterns: string[]): boolean {
    return patterns.some((pattern) => value.includes(pattern));
  }

  private formatMoney(value: Prisma.Decimal): string {
    return `S/ ${value.toFixed(2)}`;
  }
}
