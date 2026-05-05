export class MenuItemVariantResponseDto {
  id: string;
  name: string;
  sku: string | null;
  price: string;
  isDefault: boolean;
  sortOrder: number;
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
