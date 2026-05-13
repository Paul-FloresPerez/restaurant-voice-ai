export class MenuItemModifierOptionResponseDto {
  id: string;
  name: string;
  priceDelta: string;
  isAvailable: boolean;
  sortOrder: number;
}

export class MenuItemModifierGroupResponseDto {
  id: string;
  name: string;
  description: string | null;
  minSelect: number;
  maxSelect: number;
  isActive: boolean;
  sortOrder: number;
  options: MenuItemModifierOptionResponseDto[];
}

export class MenuItemVariantResponseDto {
  id: string;
  name: string;
  sku: string | null;
  price: string;
  isDefault: boolean;
  isAvailable?: boolean;
  sortOrder: number;
  modifierGroups?: MenuItemModifierGroupResponseDto[];
}

export class MenuItemIngredientResponseDto {
  id: string;
  name: string;
}

export class MenuItemAllergenResponseDto {
  id: string;
  name: string;
}

export class MenuItemResponseDto {
  id: string;
  categoryId: string;
  categoryName: string;
  name: string;
  description: string | null;
  isVegetarian: boolean;
  isVegan: boolean;
  isSpicy: boolean;
  searchAliases: string[];
  sortOrder: number;
  variants: MenuItemVariantResponseDto[];
  ingredients: MenuItemIngredientResponseDto[];
  allergens: MenuItemAllergenResponseDto[];
}
