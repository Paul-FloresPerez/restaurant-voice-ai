import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MenuCategoryResponseDto } from './dto/menu-category-response.dto';
import { MenuItemResponseDto } from './dto/menu-item-response.dto';

const menuItemInclude = {
  categories: true,
  menu_item_variants: {
    where: { is_available: true },
    orderBy: [{ is_default: 'desc' }, { sort_order: 'asc' }, { name: 'asc' }],
  },
  menu_item_ingredients: {
    include: { ingredients: true },
    orderBy: { ingredients: { name: 'asc' } },
  },
  menu_item_allergens: {
    include: { allergens: true },
    orderBy: { allergens: { name: 'asc' } },
  },
} satisfies Prisma.menu_itemsInclude;

const menuItemDetailInclude = {
  categories: true,
  menu_item_variants: {
    where: { is_available: true },
    include: {
      item_variant_modifier_groups: {
        include: {
          modifier_groups: {
            include: {
              modifier_options: {
                where: { is_available: true },
                orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
              },
            },
          },
        },
      },
    },
    orderBy: [{ is_default: 'desc' }, { sort_order: 'asc' }, { name: 'asc' }],
  },
  menu_item_ingredients: {
    include: { ingredients: true },
    orderBy: { ingredients: { name: 'asc' } },
  },
  menu_item_allergens: {
    include: { allergens: true },
    orderBy: { allergens: { name: 'asc' } },
  },
} satisfies Prisma.menu_itemsInclude;

type MenuItemWithDetails = Prisma.menu_itemsGetPayload<{
  include: typeof menuItemInclude;
}>;

type MenuItemWithModifierDetails = Prisma.menu_itemsGetPayload<{
  include: typeof menuItemDetailInclude;
}>;

@Injectable()
export class MenuService {
  constructor(private readonly prisma: PrismaService) {}

  async findCategories(): Promise<MenuCategoryResponseDto[]> {
    const categories = await this.prisma.categories.findMany({
      where: { is_active: true },
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
    });

    return categories.map((category) => ({
      id: category.id,
      name: category.name,
      description: category.description,
      sortOrder: category.sort_order,
    }));
  }

  async findItems(): Promise<MenuItemResponseDto[]> {
    const items = await this.prisma.menu_items.findMany({
      where: this.availableMenuItemWhere(),
      include: menuItemInclude,
      orderBy: [
        { categories: { sort_order: 'asc' } },
        { sort_order: 'asc' },
        { name: 'asc' },
      ],
    });

    return items.map((item) => this.toMenuItemResponse(item));
  }

  async findItemById(id: string): Promise<MenuItemResponseDto> {
    const item = await this.prisma.menu_items.findFirst({
      where: {
        id,
        ...this.availableMenuItemWhere(),
      },
      include: menuItemDetailInclude,
    });

    if (!item) {
      throw new NotFoundException('Menu item not found');
    }

    return this.toMenuItemDetailResponse(item);
  }

  private availableMenuItemWhere(): Prisma.menu_itemsWhereInput {
    return {
      is_active: true,
      is_available: true,
      categories: {
        is_active: true,
      },
    };
  }

  private toMenuItemResponse(item: MenuItemWithDetails): MenuItemResponseDto {
    return {
      id: item.id,
      categoryId: item.category_id,
      categoryName: item.categories.name,
      name: item.name,
      description: item.description,
      isVegetarian: item.is_vegetarian,
      isVegan: item.is_vegan,
      isSpicy: item.is_spicy,
      searchAliases: item.search_aliases,
      sortOrder: item.sort_order,
      variants: item.menu_item_variants.map((variant) => ({
        id: variant.id,
        name: variant.name,
        sku: variant.sku,
        price: variant.price.toString(),
        isDefault: variant.is_default,
        sortOrder: variant.sort_order,
      })),
      ingredients: item.menu_item_ingredients.map((entry) => ({
        id: entry.ingredients.id,
        name: entry.ingredients.name,
      })),
      allergens: item.menu_item_allergens.map((entry) => ({
        id: entry.allergens.id,
        name: entry.allergens.name,
      })),
    };
  }

  private toMenuItemDetailResponse(
    item: MenuItemWithModifierDetails,
  ): MenuItemResponseDto {
    return {
      id: item.id,
      categoryId: item.category_id,
      categoryName: item.categories.name,
      name: item.name,
      description: item.description,
      isVegetarian: item.is_vegetarian,
      isVegan: item.is_vegan,
      isSpicy: item.is_spicy,
      searchAliases: item.search_aliases,
      sortOrder: item.sort_order,
      variants: item.menu_item_variants.map((variant) => ({
        id: variant.id,
        name: variant.name,
        sku: variant.sku,
        price: variant.price.toString(),
        isDefault: variant.is_default,
        isAvailable: variant.is_available,
        sortOrder: variant.sort_order,
        modifierGroups: variant.item_variant_modifier_groups
          .map((entry) => entry.modifier_groups)
          .filter((group) => group.is_active)
          .sort((left, right) => {
            const sortOrderDiff = left.sort_order - right.sort_order;

            return sortOrderDiff === 0
              ? left.name.localeCompare(right.name)
              : sortOrderDiff;
          })
          .map((group) => ({
            id: group.id,
            name: group.name,
            description: group.description,
            minSelect: group.min_select,
            maxSelect: group.max_select,
            isActive: group.is_active,
            sortOrder: group.sort_order,
            modifierOptions: group.modifier_options.map((option) => ({
              id: option.id,
              name: option.name,
              priceDelta: option.price_delta.toString(),
              isAvailable: option.is_available,
              sortOrder: option.sort_order,
            })),
          })),
      })),
      ingredients: item.menu_item_ingredients.map((entry) => ({
        id: entry.ingredients.id,
        name: entry.ingredients.name,
      })),
      allergens: item.menu_item_allergens.map((entry) => ({
        id: entry.allergens.id,
        name: entry.allergens.name,
      })),
    };
  }
}
