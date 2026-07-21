import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import {
  interaction_role,
  order_event_type,
  order_status,
  session_status,
} from '../../../generated/prisma/enums';
import { Prisma } from '../../../generated/prisma/client';
import {
  AiConfirmationType,
  AiInterpretation,
  AiService,
} from '../ai/ai.service';
import { OrderResponseDto } from '../order/dto/order-response.dto';
import { createOrderCode } from '../order/order-code';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ChatIntent,
  ChatMessageResponseDto,
} from './dto/chat-message-response.dto';
import { SendChatMessageDto } from './dto/send-chat-message.dto';

const minimumAiConfidence = 0.6;

const productSynonyms = [
  {
    canonicalName: 'hamburguesa vegetariana',
    phrases: ['veggie', 'vegetal', 'sin carne'],
  },
  {
    canonicalName: 'hamburguesa',
    phrases: ['burger', 'hamburguesa'],
  },
  {
    canonicalName: 'gaseosa',
    phrases: ['soda', 'refresco', 'gaseosa'],
  },
  {
    canonicalName: 'papas fritas',
    phrases: ['papitas', 'papas', 'papas fritas'],
  },
  {
    canonicalName: 'helado',
    phrases: ['heladito', 'helado'],
  },
] as const;

const irrelevantWords = new Set([
  'a',
  'agrega',
  'al',
  'anade',
  'con',
  'de',
  'del',
  'dame',
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
  'please',
  'ponme',
  'por',
  'quiero',
  'quita',
  'un',
  'una',
]);

const spelledQuantities: Readonly<Record<string, number>> = {
  un: 1,
  una: 1,
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
};

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
type ScoredMenuItemMatch = {
  item: MenuItemWithVariants;
  score: number;
};
type TxClient = Prisma.TransactionClient;
type RuleIntentResult = {
  intent: ChatIntent;
  confirmationType: AiConfirmationType | null;
};
export type ChatProcessingTelemetry = {
  aiMs?: number;
};

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
  ) {}

  async handleMessage(
    dto: SendChatMessageDto,
    telemetry?: ChatProcessingTelemetry,
  ): Promise<ChatMessageResponseDto> {
    const aiInterpretation = await this.interpretWithAi(
      dto.sessionId,
      dto.message,
      telemetry,
    );

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
        const lastAssistantMessage = await this.findLastAssistantMessage(
          tx,
          dto.sessionId,
        );
        const intent = this.resolveIntent(dto.message, aiInterpretation);
        const confirmationType = this.resolveConfirmationType(
          dto.message,
          aiInterpretation,
        );
        let assistantMessage: string;

        if (intent === 'ADD_ITEM') {
          const result = await this.addRequestedItem(
            tx,
            order,
            dto.message,
            aiInterpretation,
          );
          order = result.order;
          assistantMessage = result.assistantMessage;
        } else if (intent === 'CANCEL_ITEM') {
          const result = await this.removeRequestedItem(tx, order, dto.message);
          order = result.order;
          assistantMessage = result.assistantMessage;
        } else if (intent === 'CONFIRM_ORDER') {
          if (order.order_items.length === 0) {
            assistantMessage =
              'Aún no hay productos para confirmar. Dime qué deseas agregar.';
          } else if (
            confirmationType !== 'explicit' ||
            !this.isFinalConfirmationPrompt(lastAssistantMessage)
          ) {
            assistantMessage = this.buildFinalConfirmationPrompt(order);
          } else {
            order = await this.confirmDraftOrder(tx, order.id);
            assistantMessage = this.buildConfirmedOrderMessage(order);
          }
        } else if (intent === 'ORDER_SUMMARY') {
          assistantMessage = this.buildOrderSummaryMessage(order);
        } else if (intent === 'CATEGORY_QUERY') {
          assistantMessage = await this.buildCategoryItemsMessage(
            tx,
            dto.message,
          );
        } else if (intent === 'READ_MENU' || intent === 'MENU_CATEGORIES') {
          assistantMessage = await this.buildMenuCategoriesMessage(tx);
        } else if (intent === 'AFFIRMATION') {
          assistantMessage =
            order.order_items.length > 0
              ? this.buildFinalConfirmationPrompt(order)
              : 'Claro. ¿Qué te gustaría agregar?';
        } else if (intent === 'NEGATION') {
          assistantMessage = 'De acuerdo, no confirmo. ¿Quieres cambiar algo?';
        } else {
          assistantMessage =
            'No estoy seguro de qué producto deseas. Puedo leerte hamburguesas, bebidas, extras o postres.';
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
          order: this.toOrderResponse(order),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async interpretWithAi(
    sessionId: string,
    message: string,
    telemetry?: ChatProcessingTelemetry,
  ): Promise<AiInterpretation | null> {
    const context = await this.buildAiContext(sessionId, message);
    const aiStartedAt = performance.now();

    try {
      return await this.aiService.interpretMessage(message, context);
    } finally {
      if (telemetry) {
        telemetry.aiMs = this.elapsedMs(aiStartedAt);
      }
    }
  }

  private async buildAiContext(
    sessionId: string,
    message: string,
  ): Promise<object> {
    const [categories, items, currentOrder, lastAssistantLog] =
      await Promise.all([
        this.prisma.categories.findMany({
          where: { is_active: true },
          select: { name: true },
          orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
        }),
        this.prisma.menu_items.findMany({
          where: {
            is_active: true,
            is_available: true,
            categories: {
              is_active: true,
            },
          },
          select: {
            name: true,
            search_aliases: true,
            categories: {
              select: { name: true },
            },
          },
          orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
        }),
        this.prisma.orders.findFirst({
          where: {
            session_id: sessionId,
            status: order_status.DRAFT,
          },
          include: orderInclude,
          orderBy: { created_at: 'desc' },
        }),
        this.prisma.interaction_logs.findFirst({
          where: {
            session_id: sessionId,
            role: interaction_role.ASSISTANT,
          },
          select: { message: true },
          orderBy: { created_at: 'desc' },
        }),
      ]);

    return {
      currentMessage: message,
      supportedIntents: [
        'ADD_ITEM',
        'CANCEL_ITEM',
        'READ_MENU',
        'CATEGORY_QUERY',
        'ORDER_SUMMARY',
        'CONFIRM_ORDER',
        'AFFIRMATION',
        'NEGATION',
        'UNKNOWN',
      ],
      currentOrder: currentOrder
        ? this.toAiOrderContext(currentOrder)
        : {
            status: order_status.DRAFT,
            items: [],
            total: '0',
          },
      lastAssistantMessage: lastAssistantLog?.message ?? null,
      categories: categories.map((category) => category.name),
      menuItems: items.map((item) => ({
        name: item.name,
        aliases: item.search_aliases,
        categoryName: item.categories.name,
      })),
    };
  }

  private toAiOrderContext(order: OrderWithItems): object {
    return {
      status: order.status,
      total: order.total.toString(),
      items: order.order_items.map((item) => ({
        productName: item.item_name_snapshot,
        variantName: item.variant_name_snapshot,
        quantity: item.quantity,
        lineTotal: item.line_total.toString(),
        modifiers: item.order_item_modifiers.map((modifier) => ({
          groupName: modifier.group_name_snapshot,
          optionName: modifier.option_name_snapshot,
          priceDelta: modifier.price_delta_snapshot.toString(),
          quantity: modifier.quantity,
        })),
      })),
    };
  }

  private resolveIntent(
    message: string,
    aiInterpretation: AiInterpretation | null,
  ): ChatIntent {
    const ruleIntent = this.detectIntentDetails(message);

    if (ruleIntent.intent !== 'UNKNOWN') {
      return ruleIntent.intent;
    }

    if (
      aiInterpretation &&
      aiInterpretation.confidence >= minimumAiConfidence
    ) {
      return this.normalizeAiIntent(aiInterpretation.intent);
    }

    return ruleIntent.intent;
  }

  private resolveConfirmationType(
    message: string,
    aiInterpretation: AiInterpretation | null,
  ): AiConfirmationType | null {
    const ruleIntent = this.detectIntentDetails(message);

    if (ruleIntent.confirmationType) {
      return ruleIntent.confirmationType;
    }

    if (
      aiInterpretation &&
      aiInterpretation.confidence >= minimumAiConfidence &&
      this.normalizeAiIntent(aiInterpretation.intent) === 'CONFIRM_ORDER' &&
      aiInterpretation.confirmationType
    ) {
      return aiInterpretation.confirmationType;
    }

    if (
      aiInterpretation &&
      aiInterpretation.confidence >= minimumAiConfidence &&
      this.normalizeAiIntent(aiInterpretation.intent) === 'AFFIRMATION'
    ) {
      return 'ambiguous';
    }

    return null;
  }

  private normalizeAiIntent(intent: AiInterpretation['intent']): ChatIntent {
    if (intent === 'MENU_CATEGORIES') {
      return 'READ_MENU';
    }

    return intent === 'REMOVE_ITEM' ? 'CANCEL_ITEM' : intent;
  }

  private resolveQuantity(
    message: string,
    aiInterpretation: AiInterpretation | null,
  ): number {
    if (
      aiInterpretation &&
      aiInterpretation.intent === 'ADD_ITEM' &&
      aiInterpretation.confidence >= minimumAiConfidence &&
      aiInterpretation.quantity
    ) {
      return aiInterpretation.quantity;
    }

    const normalizedMessage = this.normalize(message);
    const numericQuantity = normalizedMessage.match(
      /(?:^|\s)(\d{1,2})(?:\s|$)/,
    );

    if (numericQuantity) {
      return Number(numericQuantity[1]);
    }

    const spelledQuantity = normalizedMessage
      .split(' ')
      .map((token) => spelledQuantities[token])
      .find((quantity) => quantity !== undefined);

    return spelledQuantity ?? 1;
  }

  private itemLookupMessages(message: string): string[] {
    return [message];
  }

  private detectIntentDetails(message: string): RuleIntentResult {
    const normalizedMessage = this.normalize(message);

    if (this.isExplicitConfirmation(normalizedMessage)) {
      return { intent: 'CONFIRM_ORDER', confirmationType: 'explicit' };
    }

    if (this.isClosureConfirmation(normalizedMessage)) {
      return { intent: 'CONFIRM_ORDER', confirmationType: 'closure' };
    }

    if (
      this.containsAny(normalizedMessage, [
        'repiteme mi pedido',
        'repite mi pedido',
        'resumen',
        'que pedi',
        'mi pedido',
        'mi orden',
      ])
    ) {
      return { intent: 'ORDER_SUMMARY', confirmationType: null };
    }

    if (this.isCancelItemRequest(normalizedMessage)) {
      return { intent: 'CANCEL_ITEM', confirmationType: null };
    }

    if (this.isNegation(normalizedMessage)) {
      return { intent: 'NEGATION', confirmationType: null };
    }

    if (
      this.containsAny(normalizedMessage, [
        'categoria',
        'categorias',
        'bebidas',
        'postres',
        'combos',
        'extras',
      ])
    ) {
      return { intent: 'CATEGORY_QUERY', confirmationType: null };
    }

    if (
      this.containsAny(normalizedMessage, [
        'menu',
        'carta',
        'productos',
        'que hay',
        'que tienen',
        'que ofrecen',
        'muestrame',
        'lista',
      ])
    ) {
      return { intent: 'READ_MENU', confirmationType: null };
    }

    if (
      this.containsAny(normalizedMessage, [
        'quiero',
        'agrega',
        'anade',
        'ponme',
        'dame',
        'me das',
        'ordenar',
      ])
    ) {
      return { intent: 'ADD_ITEM', confirmationType: null };
    }

    if (this.hasProductSynonym(normalizedMessage)) {
      return { intent: 'ADD_ITEM', confirmationType: null };
    }

    if (this.isAffirmation(normalizedMessage)) {
      return { intent: 'AFFIRMATION', confirmationType: 'ambiguous' };
    }

    return { intent: 'UNKNOWN', confirmationType: null };
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
        order_code: createOrderCode(orderId),
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
    aiInterpretation: AiInterpretation | null,
  ): Promise<{ order: OrderWithItems; assistantMessage: string }> {
    const requestedQuantity = this.resolveQuantity(message, aiInterpretation);
    const matches = await this.findMatchingMenuItems(
      tx,
      this.itemLookupMessages(message),
    );

    if (matches.length === 0) {
      return {
        order,
        assistantMessage:
          'No estoy seguro de qué producto deseas. Puedo leerte hamburguesas, bebidas, extras o postres.',
      };
    }

    if (matches.length > 1) {
      return {
        order,
        assistantMessage: `Tengo varias opciones: ${matches
          .map((item) => item.name)
          .join(', ')}. ¿Cuál prefieres?`,
      };
    }

    const item = matches[0];
    const defaultVariant = item.menu_item_variants.find(
      (variant) => variant.is_default && variant.is_available,
    );

    if (!defaultVariant) {
      return {
        order,
        assistantMessage: `Tengo ${item.name}, pero no está disponible para agregar ahora.`,
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
        quantity: requestedQuantity,
        line_total: defaultVariant.price.mul(requestedQuantity),
      },
    });

    await this.recalculateTotals(tx, order.id);
    await this.createOrderEvent(tx, order.id, order_event_type.ADD_ITEM, {
      itemId: createdItem.id,
      variantId: defaultVariant.id,
      quantity: requestedQuantity,
      source: 'CHAT_MESSAGE',
    });

    const updatedOrder = await this.findOrderOrThrow(tx, order.id);

    return {
      order: updatedOrder,
      assistantMessage: `Listo, agregué ${this.formatAddedItemName(
        requestedQuantity,
        item.name,
      )}. Tu total va en ${this.formatMoney(
        updatedOrder.total,
      )}. ¿Deseas algo más o confirmamos?`,
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
        assistantMessage: 'Tu pedido está vacío. No hay nada que quitar.',
      };
    }

    const matches = this.findMatchingOrderItems(
      order,
      this.itemLookupMessages(message),
    );

    if (matches.length === 0) {
      return {
        order,
        assistantMessage:
          'No veo ese producto en tu pedido. Puedo repetirte el resumen.',
      };
    }

    if (matches.length > 1) {
      return {
        order,
        assistantMessage: `Veo varias opciones: ${matches
          .map((item) => item.item_name_snapshot)
          .join(', ')}. ¿Cuál quito?`,
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
      assistantMessage: `Listo, quité ${this.lowercaseFirst(
        item.item_name_snapshot,
      )}. Tu total va en ${this.formatMoney(updatedOrder.total)}.`,
    };
  }

  private async findMatchingMenuItems(
    tx: TxClient,
    messages: string[],
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

    const matchesByItemId = new Map<string, ScoredMenuItemMatch>();

    for (const message of messages) {
      const normalizedMessage = this.normalize(message);
      const messageTokens = this.toMeaningfulTokens(normalizedMessage);

      for (const item of items) {
        const score = this.scoreMenuItemMatch(
          item,
          normalizedMessage,
          messageTokens,
          items,
        );

        if (score === 0) {
          continue;
        }

        const existingMatch = matchesByItemId.get(item.id);

        if (!existingMatch || existingMatch.score < score) {
          matchesByItemId.set(item.id, { item, score });
        }
      }
    }

    const matches = Array.from(matchesByItemId.values());

    if (matches.length === 0) {
      return [];
    }

    const bestScore = Math.max(...matches.map((match) => match.score));

    return matches
      .filter((match) => match.score === bestScore)
      .map((match) => match.item);
  }

  private findMatchingOrderItems(
    order: OrderWithItems,
    messages: string[],
  ): OrderWithItems['order_items'] {
    return order.order_items.filter((item) =>
      messages.some((message) =>
        this.itemMatchesMessage(message, [item.item_name_snapshot]),
      ),
    );
  }

  private async buildMenuCategoriesMessage(tx: TxClient): Promise<string> {
    const categories = await tx.categories.findMany({
      where: { is_active: true },
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
    });

    if (categories.length === 0) {
      return 'Por ahora no tengo categorías disponibles.';
    }

    return `Tenemos ${categories
      .map((category) => category.name)
      .join(', ')}. ¿Qué categoría quieres escuchar?`;
  }

  private async buildCategoryItemsMessage(
    tx: TxClient,
    message: string,
  ): Promise<string> {
    const categories = await tx.categories.findMany({
      where: { is_active: true },
      select: { id: true, name: true },
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
    });
    const matchingCategories = categories.filter((category) =>
      this.matchesCategory(this.normalize(message), category.name),
    );

    if (matchingCategories.length !== 1) {
      return this.buildMenuCategoriesMessage(tx);
    }

    const category = matchingCategories[0];
    const items = await tx.menu_items.findMany({
      where: {
        category_id: category.id,
        is_active: true,
        is_available: true,
      },
      select: { name: true },
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
      take: 8,
    });

    if (items.length === 0) {
      return `Por ahora no tengo productos disponibles en ${this.lowercaseFirst(
        category.name,
      )}.`;
    }

    return `En ${this.lowercaseFirst(category.name)} tenemos ${items
      .map((item) => item.name)
      .join(', ')}. ¿Cuál deseas agregar?`;
  }

  private buildOrderSummaryMessage(order: OrderWithItems): string {
    if (order.order_items.length === 0) {
      return 'Tu pedido está vacío. Dime qué deseas agregar.';
    }

    return `Tienes ${this.formatOrderItems(
      order,
    )}. Total: ${this.formatMoney(order.total)}. Aún no está confirmado.`;
  }

  private buildFinalConfirmationPrompt(order: OrderWithItems): string {
    return `${this.buildOrderSummaryMessage(
      order,
    )} Si todo está correcto, di "confirmo".`;
  }

  private isFinalConfirmationPrompt(message: string | null): boolean {
    if (!message) {
      return false;
    }

    const normalizedMessage = this.normalize(message);

    return (
      normalizedMessage.includes('si todo esta correcto') &&
      normalizedMessage.includes('confirmo')
    );
  }

  private buildConfirmedOrderMessage(order: OrderWithItems): string {
    return `Perfecto, pedido confirmado: ${this.formatOrderItems(
      order,
    )}. Total: ${this.formatMoney(order.total)}.`;
  }

  private formatOrderItems(order: OrderWithItems): string {
    return order.order_items
      .map((item) => {
        const variant =
          item.variant_name_snapshot && item.variant_name_snapshot !== 'Default'
            ? ` ${this.lowercaseFirst(item.variant_name_snapshot)}`
            : '';
        const modifiers =
          item.order_item_modifiers.length > 0
            ? ` con ${item.order_item_modifiers
                .map((modifier) =>
                  this.lowercaseFirst(modifier.option_name_snapshot),
                )
                .join(', ')}`
            : '';

        return `${this.formatItemQuantity(
          item.quantity,
          item.item_name_snapshot,
        )}${variant}${modifiers}`;
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

  private async findLastAssistantMessage(
    tx: TxClient,
    sessionId: string,
  ): Promise<string | null> {
    const lastAssistantLog = await tx.interaction_logs.findFirst({
      where: {
        session_id: sessionId,
        role: interaction_role.ASSISTANT,
      },
      select: { message: true },
      orderBy: { created_at: 'desc' },
    });

    return lastAssistantLog?.message ?? null;
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
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  private scoreMenuItemMatch(
    item: MenuItemWithVariants,
    normalizedMessage: string,
    messageTokens: string[],
    allItems: MenuItemWithVariants[],
  ): number {
    const nameScore = this.scoreContainedTerm(
      normalizedMessage,
      item.name,
      300,
    );

    if (nameScore > 0) {
      return nameScore;
    }

    const aliasScore = this.bestAliasScore(item, normalizedMessage, allItems);
    const synonymScore = this.bestSynonymScore(item, normalizedMessage);
    const fuzzyScore = this.bestFuzzyScore(item, messageTokens, allItems);
    const broadScore = this.matchesByUserTokens(messageTokens, [
      item.name,
      ...item.search_aliases,
    ])
      ? 100
      : 0;

    return Math.max(aliasScore, synonymScore, fuzzyScore, broadScore);
  }

  private bestSynonymScore(
    item: MenuItemWithVariants,
    normalizedMessage: string,
  ): number {
    return productSynonyms.reduce((bestScore, synonym) => {
      const isRequested = synonym.phrases.some((phrase: string) =>
        this.containsPhrase(normalizedMessage, phrase),
      );

      if (!isRequested || !this.isCanonicalItem(item, synonym.canonicalName)) {
        return bestScore;
      }

      return Math.max(bestScore, 325);
    }, 0);
  }

  private bestFuzzyScore(
    item: MenuItemWithVariants,
    messageTokens: string[],
    allItems: MenuItemWithVariants[],
  ): number {
    if (messageTokens.length === 0) {
      return 0;
    }

    return [item.name, ...item.search_aliases].reduce((bestScore, term) => {
      const termTokens = this.toMeaningfulTokens(term);

      if (
        termTokens.length === 0 ||
        !termTokens.every((termToken) =>
          messageTokens.some((messageToken) =>
            this.isFuzzyTokenMatch(messageToken, termToken),
          ),
        ) ||
        (termTokens.length === 1 &&
          !this.isSpecificSingleTokenAlias(termTokens[0], allItems))
      ) {
        return bestScore;
      }

      return Math.max(bestScore, 180 + termTokens.length);
    }, 0);
  }

  private bestAliasScore(
    item: MenuItemWithVariants,
    normalizedMessage: string,
    allItems: MenuItemWithVariants[],
  ): number {
    return item.search_aliases.reduce((bestScore, alias) => {
      const normalizedAlias = this.normalize(alias);

      if (!normalizedAlias || !normalizedMessage.includes(normalizedAlias)) {
        return bestScore;
      }

      const aliasTokens = this.toMeaningfulTokens(normalizedAlias);

      if (aliasTokens.length === 0) {
        return bestScore;
      }

      if (
        aliasTokens.length === 1 &&
        !this.isSpecificSingleTokenAlias(aliasTokens[0], allItems)
      ) {
        return Math.max(bestScore, 100);
      }

      return Math.max(bestScore, 250 + aliasTokens.length);
    }, 0);
  }

  private scoreContainedTerm(
    normalizedMessage: string,
    term: string,
    baseScore: number,
  ): number {
    const normalizedTerm = this.normalize(term);

    if (!normalizedTerm || !normalizedMessage.includes(normalizedTerm)) {
      return 0;
    }

    const termTokens = this.toMeaningfulTokens(normalizedTerm);

    if (termTokens.length === 0) {
      return 0;
    }

    return baseScore + termTokens.length;
  }

  private matchesByUserTokens(
    messageTokens: string[],
    terms: string[],
  ): boolean {
    if (messageTokens.length === 0) {
      return false;
    }

    return terms.some((term) => {
      const termTokens = this.toMeaningfulTokens(term);

      return messageTokens.every((token) => termTokens.includes(token));
    });
  }

  private isSpecificSingleTokenAlias(
    aliasToken: string,
    allItems: MenuItemWithVariants[],
  ): boolean {
    const matchingItems = allItems.filter((item) => {
      const terms = [item.name, ...item.search_aliases];

      return terms.some((term) =>
        this.toMeaningfulTokens(term).includes(aliasToken),
      );
    });

    return matchingItems.length === 1;
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

      if (this.matchesByUserTokens(messageTokens, [normalizedTerm])) {
        return true;
      }

      if (
        productSynonyms.some(
          (synonym) =>
            synonym.phrases.some((phrase: string) =>
              this.containsPhrase(normalizedMessage, phrase),
            ) &&
            this.normalize(normalizedTerm) ===
              this.normalize(synonym.canonicalName),
        )
      ) {
        return true;
      }

      return this.toMeaningfulTokens(normalizedTerm).every((termToken) =>
        messageTokens.some((messageToken) =>
          this.isFuzzyTokenMatch(messageToken, termToken),
        ),
      );
    });
  }

  private toMeaningfulTokens(value: string): string[] {
    return this.normalize(value)
      .split(/\s+/)
      .filter((token) => token.length > 1 && !irrelevantWords.has(token));
  }

  private hasProductSynonym(normalizedMessage: string): boolean {
    return productSynonyms.some((synonym) =>
      synonym.phrases.some((phrase: string) =>
        this.containsPhrase(normalizedMessage, phrase),
      ),
    );
  }

  private isCanonicalItem(
    item: MenuItemWithVariants,
    canonicalName: string,
  ): boolean {
    return this.normalize(item.name) === this.normalize(canonicalName);
  }

  private matchesCategory(
    normalizedMessage: string,
    categoryName: string,
  ): boolean {
    const normalizedCategoryName = this.normalize(categoryName);

    return this.containsPhrase(normalizedMessage, normalizedCategoryName);
  }

  private isCancelItemRequest(value: string): boolean {
    if (this.containsPhrase(value, 'cancelar pedido')) {
      return false;
    }

    return /^(quita|quitar|elimina|eliminar|saca|sacar|borra|borrar|cancela|cancelar)\b/.test(
      value,
    );
  }

  private isFuzzyTokenMatch(value: string, candidate: string): boolean {
    if (value === candidate) {
      return true;
    }

    if (value.length < 4 || candidate.length < 4) {
      return false;
    }

    const maximumDistance =
      Math.max(value.length, candidate.length) >= 7 ? 2 : 1;

    return this.levenshteinDistance(value, candidate) <= maximumDistance;
  }

  private levenshteinDistance(first: string, second: string): number {
    let previousRow = Array.from(
      { length: second.length + 1 },
      (_, index) => index,
    );

    for (let firstIndex = 1; firstIndex <= first.length; firstIndex += 1) {
      const currentRow = [firstIndex];

      for (
        let secondIndex = 1;
        secondIndex <= second.length;
        secondIndex += 1
      ) {
        currentRow[secondIndex] = Math.min(
          currentRow[secondIndex - 1] + 1,
          previousRow[secondIndex] + 1,
          previousRow[secondIndex - 1] +
            (first[firstIndex - 1] === second[secondIndex - 1] ? 0 : 1),
        );
      }

      previousRow = currentRow;
    }

    return previousRow[second.length];
  }

  private isExplicitConfirmation(value: string): boolean {
    if (value.startsWith('no ') || value.includes(' no confirmo')) {
      return false;
    }

    return this.containsAny(value, [
      'si confirmo',
      'confirmo',
      'confirmar pedido',
      'confirmar el pedido',
      'confirmar mi pedido',
    ]);
  }

  private isClosureConfirmation(value: string): boolean {
    return (
      value === 'confirmar' ||
      this.containsAny(value, [
        'quiero hacer el pedido',
        'hacer el pedido',
        'haz el pedido',
        'ya esta',
        'eso nomas',
        'eso no mas',
        'si eso quiero',
        'eso quiero',
        'quiero confirmar',
      ])
    );
  }

  private isAffirmation(value: string): boolean {
    return [
      'si',
      'ok',
      'okay',
      'dale',
      'ya',
      'listo',
      'correcto',
      'esta bien',
      'de acuerdo',
    ].includes(value);
  }

  private isNegation(value: string): boolean {
    return (
      [
        'no',
        'no gracias',
        'mejor no',
        'por ahora no',
        'cancela',
        'cancelar',
        'olvidalo',
      ].includes(value) || value.startsWith('no ')
    );
  }

  private containsAny(value: string, patterns: string[]): boolean {
    return patterns.some((pattern) => this.containsPhrase(value, pattern));
  }

  private containsPhrase(value: string, phrase: string): boolean {
    const normalizedPhrase = this.normalize(phrase);

    return ` ${value} `.includes(` ${normalizedPhrase} `);
  }

  private formatAddedItemName(quantity: number, itemName: string): string {
    if (quantity === 1) {
      return `${this.articleForItem(itemName)} ${this.lowercaseFirst(
        itemName,
      )}`;
    }

    return `${quantity} ${this.lowercaseFirst(itemName)}`;
  }

  private formatItemQuantity(quantity: number, itemName: string): string {
    if (quantity === 1) {
      return `${this.articleForItem(itemName)} ${this.lowercaseFirst(
        itemName,
      )}`;
    }

    return `${quantity} ${this.lowercaseFirst(itemName)}`;
  }

  private articleForItem(itemName: string): 'un' | 'una' {
    const normalizedName = this.normalize(itemName);

    if (
      normalizedName.startsWith('hamburguesa') ||
      normalizedName.startsWith('bebida') ||
      normalizedName.startsWith('gaseosa') ||
      normalizedName.startsWith('ensalada') ||
      normalizedName.startsWith('pizza') ||
      normalizedName.startsWith('entrada')
    ) {
      return 'una';
    }

    return 'un';
  }

  private lowercaseFirst(value: string): string {
    if (!value) {
      return value;
    }

    return `${value.charAt(0).toLocaleLowerCase('es-PE')}${value.slice(1)}`;
  }

  private elapsedMs(startedAt: number): number {
    return Math.max(0, Math.round(performance.now() - startedAt));
  }

  private formatMoney(value: Prisma.Decimal): string {
    return `S/ ${value.toFixed(2)}`;
  }

  private toOrderResponse(order: OrderWithItems): OrderResponseDto {
    return {
      id: order.id,
      orderCode: order.order_code ?? createOrderCode(order.id),
      sessionId: order.session_id,
      status: order.status,
      subtotal: order.subtotal.toString(),
      discountTotal: order.discount_total.toString(),
      taxTotal: order.tax_total.toString(),
      total: order.total.toString(),
      notes: order.notes,
      confirmedAt: order.confirmed_at,
      createdAt: order.created_at,
      updatedAt: order.updated_at,
      items: order.order_items.map((item) => ({
        id: item.id,
        menuItemId: item.menu_item_id,
        variantId: item.variant_id,
        itemName: item.item_name_snapshot,
        variantName: item.variant_name_snapshot,
        unitPrice: item.unit_price_snapshot.toString(),
        quantity: item.quantity,
        specialInstructions: item.special_instructions,
        lineTotal: item.line_total.toString(),
        modifiers: item.order_item_modifiers.map((modifier) => ({
          id: modifier.id,
          modifierOptionId: modifier.modifier_option_id,
          groupName: modifier.group_name_snapshot,
          optionName: modifier.option_name_snapshot,
          priceDelta: modifier.price_delta_snapshot.toString(),
          quantity: modifier.quantity,
        })),
      })),
    };
  }
}
