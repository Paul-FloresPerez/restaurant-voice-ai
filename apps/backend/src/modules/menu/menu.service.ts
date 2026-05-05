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

type MenuItemWithDetails = Prisma.menu_itemsGetPayload<{
  include: typeof menuItemInclude;
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
      include: menuItemInclude,
    });

    if (!item) {
      throw new NotFoundException('Menu item not found');
    }

    return this.toMenuItemResponse(item);
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
}
