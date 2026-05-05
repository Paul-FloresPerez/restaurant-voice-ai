import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  order_event_type,
  order_status,
  session_status,
} from '../../../generated/prisma/enums';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AddOrderItemDto } from './dto/add-order-item.dto';
import { OrderItemModifierDto } from './dto/order-item-modifier.dto';
import { OrderResponseDto } from './dto/order-response.dto';
import { UpdateOrderItemDto } from './dto/update-order-item.dto';

const orderInclude = {
  order_items: {
    include: {
      order_item_modifiers: true,
    },
    orderBy: { created_at: 'asc' },
  },
} satisfies Prisma.ordersInclude;

const variantInclude = {
  menu_items: {
    include: {
      categories: true,
    },
  },
} satisfies Prisma.menu_item_variantsInclude;

const modifierInclude = {
  modifier_groups: true,
} satisfies Prisma.modifier_optionsInclude;

type OrderWithItems = Prisma.ordersGetPayload<{ include: typeof orderInclude }>;
type VariantWithItem = Prisma.menu_item_variantsGetPayload<{
  include: typeof variantInclude;
}>;
type ModifierOptionWithGroup = Prisma.modifier_optionsGetPayload<{
  include: typeof modifierInclude;
}>;
type TxClient = Prisma.TransactionClient;
type PricedModifier = { priceDelta: Prisma.Decimal; quantity: number };
type ResolvedModifier = PricedModifier & { option: ModifierOptionWithGroup };

@Injectable()
export class OrderService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreateCurrent(sessionId: string): Promise<OrderResponseDto> {
    const order = await this.prisma.$transaction(
      async (tx) => {
        await this.assertActiveSession(tx, sessionId);

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

        await this.createOrderEvent(tx, createdOrder.id, order_event_type.ADD_NOTE, {
          action: 'CREATE_DRAFT_ORDER',
          sessionId,
        });

        return createdOrder;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return this.toOrderResponse(order);
  }

  async findCurrent(sessionId: string): Promise<OrderResponseDto> {
    const order = await this.prisma.orders.findFirst({
      where: {
        session_id: sessionId,
        status: order_status.DRAFT,
      },
      include: orderInclude,
      orderBy: { created_at: 'desc' },
    });

    if (!order) {
      throw new NotFoundException('Draft order not found');
    }

    return this.toOrderResponse(order);
  }

  async addItem(orderId: string, dto: AddOrderItemDto): Promise<OrderResponseDto> {
    const order = await this.prisma.$transaction(async (tx) => {
      await this.assertDraftOrder(tx, orderId);

      const variant = await this.findAvailableVariant(tx, dto.variantId);
      const modifiers = await this.findValidModifiers(
        tx,
        variant.id,
        dto.modifiers ?? [],
      );
      const quantity = dto.quantity ?? 1;
      const lineTotal = this.calculateLineTotal(
        variant.price,
        modifiers,
        quantity,
      );

      const item = await tx.order_items.create({
        data: {
          order_id: orderId,
          variant_id: variant.id,
          menu_item_id: variant.menu_item_id,
          item_name_snapshot: variant.menu_items.name,
          variant_name_snapshot: variant.name,
          unit_price_snapshot: variant.price,
          quantity,
          special_instructions: this.cleanOptionalText(dto.specialInstructions),
          line_total: lineTotal,
          order_item_modifiers: {
            create: modifiers.map((modifier) => ({
              modifier_option_id: modifier.option.id,
              group_name_snapshot: modifier.option.modifier_groups.name,
              option_name_snapshot: modifier.option.name,
              price_delta_snapshot: modifier.option.price_delta,
              quantity: modifier.quantity,
            })),
          },
        },
      });

      await this.recalculateTotals(tx, orderId);
      await this.createOrderEvent(tx, orderId, order_event_type.ADD_ITEM, {
        itemId: item.id,
        variantId: variant.id,
        quantity,
      });

      return this.findOrderOrThrow(tx, orderId);
    });

    return this.toOrderResponse(order);
  }

  async updateItem(
    orderId: string,
    itemId: string,
    dto: UpdateOrderItemDto,
  ): Promise<OrderResponseDto> {
    if (
      dto.quantity === undefined &&
      dto.specialInstructions === undefined &&
      dto.modifiers === undefined
    ) {
      throw new BadRequestException('At least one field must be provided');
    }

    const order = await this.prisma.$transaction(async (tx) => {
      await this.assertDraftOrder(tx, orderId);

      const existingItem = await tx.order_items.findFirst({
        where: {
          id: itemId,
          order_id: orderId,
        },
        include: {
          order_item_modifiers: true,
        },
      });

      if (!existingItem) {
        throw new NotFoundException('Order item not found');
      }

      const quantity = dto.quantity ?? existingItem.quantity;
      const modifiers: PricedModifier[] =
        dto.modifiers === undefined
          ? existingItem.order_item_modifiers.map((modifier) => ({
              priceDelta: modifier.price_delta_snapshot,
              quantity: modifier.quantity,
            }))
          : await this.findValidModifiers(
              tx,
              existingItem.variant_id,
              dto.modifiers,
            );

      if (dto.modifiers !== undefined) {
        const resolvedModifiers = modifiers as ResolvedModifier[];

        await tx.order_item_modifiers.deleteMany({
          where: { order_item_id: itemId },
        });

        await tx.order_item_modifiers.createMany({
          data: resolvedModifiers.map((modifier) => ({
            order_item_id: itemId,
            modifier_option_id: modifier.option.id,
            group_name_snapshot: modifier.option.modifier_groups.name,
            option_name_snapshot: modifier.option.name,
            price_delta_snapshot: modifier.option.price_delta,
            quantity: modifier.quantity,
          })),
        });
      }

      const lineTotal = this.calculateLineTotal(
        existingItem.unit_price_snapshot,
        modifiers,
        quantity,
      );

      await tx.order_items.update({
        where: { id: itemId },
        data: {
          quantity,
          special_instructions:
            dto.specialInstructions === undefined
              ? existingItem.special_instructions
              : this.cleanOptionalText(dto.specialInstructions),
          line_total: lineTotal,
        },
      });

      await this.recalculateTotals(tx, orderId);
      await this.createOrderEvent(
        tx,
        orderId,
        dto.modifiers === undefined
          ? order_event_type.UPDATE_ITEM
          : order_event_type.CHANGE_MODIFIERS,
        {
          itemId,
          quantity,
          modifiersChanged: dto.modifiers !== undefined,
        },
      );

      return this.findOrderOrThrow(tx, orderId);
    });

    return this.toOrderResponse(order);
  }

  async removeItem(orderId: string, itemId: string): Promise<OrderResponseDto> {
    const order = await this.prisma.$transaction(async (tx) => {
      await this.assertDraftOrder(tx, orderId);

      const existingItem = await tx.order_items.findFirst({
        where: {
          id: itemId,
          order_id: orderId,
        },
      });

      if (!existingItem) {
        throw new NotFoundException('Order item not found');
      }

      await tx.order_items.delete({ where: { id: itemId } });
      await this.recalculateTotals(tx, orderId);
      await this.createOrderEvent(tx, orderId, order_event_type.REMOVE_ITEM, {
        itemId,
      });

      return this.findOrderOrThrow(tx, orderId);
    });

    return this.toOrderResponse(order);
  }

  async confirm(orderId: string): Promise<OrderResponseDto> {
    const order = await this.prisma.$transaction(async (tx) => {
      const draftOrder = await this.assertDraftOrder(tx, orderId);

      const itemCount = await tx.order_items.count({
        where: { order_id: draftOrder.id },
      });

      if (itemCount === 0) {
        throw new BadRequestException('Cannot confirm an empty order');
      }

      await this.recalculateTotals(tx, orderId);

      await tx.orders.update({
        where: { id: orderId },
        data: {
          status: order_status.CONFIRMED,
          confirmed_at: new Date(),
        },
      });

      await this.createOrderEvent(tx, orderId, order_event_type.CONFIRM_ORDER, {
        itemCount,
      });

      return this.findOrderOrThrow(tx, orderId);
    });

    return this.toOrderResponse(order);
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

  private async assertDraftOrder(
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

    if (order.status !== order_status.DRAFT) {
      throw new ConflictException('Only DRAFT orders can be modified');
    }

    return order;
  }

  private async findAvailableVariant(
    tx: TxClient,
    variantId: string,
  ): Promise<VariantWithItem> {
    const variant = await tx.menu_item_variants.findFirst({
      where: {
        id: variantId,
        is_available: true,
        menu_items: {
          is_active: true,
          is_available: true,
          categories: {
            is_active: true,
          },
        },
      },
      include: variantInclude,
    });

    if (!variant) {
      throw new NotFoundException('Available menu item variant not found');
    }

    return variant;
  }

  private async findValidModifiers(
    tx: TxClient,
    variantId: string,
    requestedModifiers: OrderItemModifierDto[],
  ): Promise<ResolvedModifier[]> {
    if (requestedModifiers.length === 0) {
      return [];
    }

    const quantitiesByOptionId = new Map<string, number>();
    for (const modifier of requestedModifiers) {
      quantitiesByOptionId.set(
        modifier.modifierOptionId,
        (quantitiesByOptionId.get(modifier.modifierOptionId) ?? 0) +
          (modifier.quantity ?? 1),
      );
    }

    const optionIds = Array.from(quantitiesByOptionId.keys());
    const options = await tx.modifier_options.findMany({
      where: {
        id: { in: optionIds },
        is_available: true,
        modifier_groups: {
          is_active: true,
          item_variant_modifier_groups: {
            some: {
              variant_id: variantId,
            },
          },
        },
      },
      include: modifierInclude,
    });

    if (options.length !== optionIds.length) {
      throw new BadRequestException(
        'One or more modifiers are unavailable for this item',
      );
    }

    return options.map((option) => ({
      option,
      quantity: quantitiesByOptionId.get(option.id) ?? 1,
      priceDelta: option.price_delta,
    }));
  }

  private calculateLineTotal(
    unitPrice: Prisma.Decimal,
    modifiers: Array<{ priceDelta: Prisma.Decimal; quantity: number }>,
    quantity: number,
  ): Prisma.Decimal {
    const modifierTotal = modifiers.reduce(
      (total, modifier) =>
        total.plus(modifier.priceDelta.mul(modifier.quantity)),
      new Prisma.Decimal(0),
    );

    return unitPrice.plus(modifierTotal).mul(quantity);
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

  private cleanOptionalText(value: string | undefined): string | null {
    const cleaned = value?.trim();
    return cleaned ? cleaned : null;
  }

  private toOrderResponse(order: OrderWithItems): OrderResponseDto {
    return {
      id: order.id,
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
