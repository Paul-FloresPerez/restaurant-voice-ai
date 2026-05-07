import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

type CategorySeed = {
  name: string;
  description: string;
  sortOrder: number;
};

type MenuItemSeed = {
  categoryName: string;
  name: string;
  description: string;
  sortOrder: number;
  searchAliases: string[];
  isVegetarian?: boolean;
  isVegan?: boolean;
  isSpicy?: boolean;
  ingredients: string[];
  allergens: string[];
  variants: Array<{
    name: string;
    sku: string;
    price: string;
    isDefault?: boolean;
    sortOrder: number;
    modifierGroups?: string[];
  }>;
};

type ModifierGroupSeed = {
  name: string;
  description: string;
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
  options: Array<{
    name: string;
    priceDelta: string;
    sortOrder: number;
  }>;
};

const categories: CategorySeed[] = [
  {
    name: 'Hamburguesas',
    description: 'Hamburguesas principales del menu.',
    sortOrder: 10,
  },
  {
    name: 'Bebidas',
    description: 'Bebidas frias para acompanar el pedido.',
    sortOrder: 20,
  },
  {
    name: 'Extras',
    description: 'Acompanamientos y adicionales.',
    sortOrder: 30,
  },
  {
    name: 'Postres',
    description: 'Opciones dulces para cerrar el pedido.',
    sortOrder: 40,
  },
];

const modifierGroups: ModifierGroupSeed[] = [
  {
    name: 'Extras',
    description: 'Adicionales para hamburguesas.',
    minSelect: 0,
    maxSelect: 3,
    sortOrder: 10,
    options: [
      { name: 'Queso adicional', priceDelta: '2.50', sortOrder: 10 },
      { name: 'Tocino', priceDelta: '4.00', sortOrder: 20 },
      { name: 'Palta', priceDelta: '3.50', sortOrder: 30 },
      { name: 'Huevo frito', priceDelta: '3.00', sortOrder: 40 },
    ],
  },
  {
    name: 'Tipo de bebida',
    description: 'Sabor o tipo de bebida.',
    minSelect: 0,
    maxSelect: 1,
    sortOrder: 20,
    options: [
      { name: 'Cola', priceDelta: '0.00', sortOrder: 10 },
      { name: 'Naranja', priceDelta: '0.00', sortOrder: 20 },
      { name: 'Limon', priceDelta: '0.00', sortOrder: 30 },
      { name: 'Sin azucar', priceDelta: '0.50', sortOrder: 40 },
    ],
  },
  {
    name: 'Acompanamiento',
    description: 'Guarnicion incluida o adicional para combos.',
    minSelect: 0,
    maxSelect: 1,
    sortOrder: 30,
    options: [
      { name: 'Papas fritas', priceDelta: '0.00', sortOrder: 10 },
      { name: 'Aros de cebolla', priceDelta: '2.00', sortOrder: 20 },
      { name: 'Ensalada simple', priceDelta: '1.50', sortOrder: 30 },
      { name: 'Sin acompanamiento', priceDelta: '0.00', sortOrder: 40 },
    ],
  },
];

const menuItems: MenuItemSeed[] = [
  {
    categoryName: 'Hamburguesas',
    name: 'Hamburguesa Clasica',
    description: 'Carne de res, queso, lechuga, tomate y salsa de la casa.',
    sortOrder: 10,
    searchAliases: ['hamburguesa', 'clasica', 'burger clasica'],
    ingredients: ['Pan brioche', 'Carne de res', 'Queso cheddar', 'Lechuga', 'Tomate', 'Salsa de la casa'],
    allergens: ['Gluten', 'Lacteos', 'Huevo'],
    variants: [
      {
        name: 'Simple',
        sku: 'BUR-CLAS-SIMPLE',
        price: '18.90',
        isDefault: true,
        sortOrder: 10,
        modifierGroups: ['Extras', 'Acompanamiento'],
      },
      {
        name: 'Combo',
        sku: 'BUR-CLAS-COMBO',
        price: '25.90',
        sortOrder: 20,
        modifierGroups: ['Extras', 'Acompanamiento', 'Tipo de bebida'],
      },
    ],
  },
  {
    categoryName: 'Hamburguesas',
    name: 'Hamburguesa Doble',
    description: 'Doble carne de res, doble queso, cebolla caramelizada y salsa.',
    sortOrder: 20,
    searchAliases: ['doble', 'doble carne', 'burger doble'],
    ingredients: ['Pan brioche', 'Carne de res', 'Queso cheddar', 'Cebolla caramelizada', 'Salsa de la casa'],
    allergens: ['Gluten', 'Lacteos', 'Huevo'],
    variants: [
      {
        name: 'Simple',
        sku: 'BUR-DOBLE-SIMPLE',
        price: '24.90',
        isDefault: true,
        sortOrder: 10,
        modifierGroups: ['Extras', 'Acompanamiento'],
      },
      {
        name: 'Combo',
        sku: 'BUR-DOBLE-COMBO',
        price: '31.90',
        sortOrder: 20,
        modifierGroups: ['Extras', 'Acompanamiento', 'Tipo de bebida'],
      },
    ],
  },
  {
    categoryName: 'Hamburguesas',
    name: 'Hamburguesa Vegetariana',
    description: 'Medallon vegetal, lechuga, tomate, palta y salsa vegana.',
    sortOrder: 30,
    searchAliases: ['vegetariana', 'veggie', 'hamburguesa vegetal'],
    isVegetarian: true,
    ingredients: ['Pan integral', 'Medallon vegetal', 'Lechuga', 'Tomate', 'Palta', 'Salsa vegana'],
    allergens: ['Gluten', 'Soya'],
    variants: [
      {
        name: 'Simple',
        sku: 'BUR-VEG-SIMPLE',
        price: '20.90',
        isDefault: true,
        sortOrder: 10,
        modifierGroups: ['Extras', 'Acompanamiento'],
      },
      {
        name: 'Combo',
        sku: 'BUR-VEG-COMBO',
        price: '27.90',
        sortOrder: 20,
        modifierGroups: ['Extras', 'Acompanamiento', 'Tipo de bebida'],
      },
    ],
  },
  {
    categoryName: 'Bebidas',
    name: 'Gaseosa',
    description: 'Gaseosa helada a eleccion.',
    sortOrder: 10,
    searchAliases: ['gaseosa', 'refresco', 'soda'],
    ingredients: ['Agua carbonatada', 'Azucar'],
    allergens: [],
    variants: [
      {
        name: 'Vaso 350 ml',
        sku: 'BEB-GAS-350',
        price: '5.90',
        isDefault: true,
        sortOrder: 10,
        modifierGroups: ['Tipo de bebida'],
      },
      {
        name: 'Botella 500 ml',
        sku: 'BEB-GAS-500',
        price: '7.90',
        sortOrder: 20,
        modifierGroups: ['Tipo de bebida'],
      },
    ],
  },
  {
    categoryName: 'Bebidas',
    name: 'Agua',
    description: 'Agua mineral con o sin gas.',
    sortOrder: 20,
    searchAliases: ['agua', 'agua mineral'],
    ingredients: ['Agua mineral'],
    allergens: [],
    variants: [
      {
        name: 'Sin gas 500 ml',
        sku: 'BEB-AGUA-SIN-GAS',
        price: '4.90',
        isDefault: true,
        sortOrder: 10,
      },
      {
        name: 'Con gas 500 ml',
        sku: 'BEB-AGUA-CON-GAS',
        price: '5.50',
        sortOrder: 20,
      },
    ],
  },
  {
    categoryName: 'Bebidas',
    name: 'Jugo Natural',
    description: 'Jugo natural preparado al momento.',
    sortOrder: 30,
    searchAliases: ['jugo', 'jugo natural', 'zumo'],
    ingredients: ['Fruta natural', 'Agua'],
    allergens: [],
    variants: [
      {
        name: 'Maracuya',
        sku: 'BEB-JUGO-MARACUYA',
        price: '8.90',
        isDefault: true,
        sortOrder: 10,
      },
      {
        name: 'Fresa',
        sku: 'BEB-JUGO-FRESA',
        price: '9.90',
        sortOrder: 20,
      },
    ],
  },
  {
    categoryName: 'Extras',
    name: 'Papas Fritas',
    description: 'Porcion individual de papas fritas crocantes.',
    sortOrder: 10,
    searchAliases: ['papas', 'papas fritas', 'fritas'],
    isVegetarian: true,
    isVegan: true,
    ingredients: ['Papa', 'Aceite vegetal', 'Sal'],
    allergens: [],
    variants: [
      {
        name: 'Individual',
        sku: 'EXT-PAPAS-IND',
        price: '7.90',
        isDefault: true,
        sortOrder: 10,
      },
      {
        name: 'Grande',
        sku: 'EXT-PAPAS-GDE',
        price: '11.90',
        sortOrder: 20,
      },
    ],
  },
  {
    categoryName: 'Extras',
    name: 'Aros de Cebolla',
    description: 'Aros de cebolla apanados.',
    sortOrder: 20,
    searchAliases: ['aros', 'aros de cebolla', 'cebolla'],
    isVegetarian: true,
    ingredients: ['Cebolla', 'Harina de trigo', 'Aceite vegetal'],
    allergens: ['Gluten'],
    variants: [
      {
        name: 'Individual',
        sku: 'EXT-AROS-IND',
        price: '8.90',
        isDefault: true,
        sortOrder: 10,
      },
    ],
  },
  {
    categoryName: 'Postres',
    name: 'Brownie',
    description: 'Brownie de chocolate con nueces.',
    sortOrder: 10,
    searchAliases: ['brownie', 'chocolate'],
    isVegetarian: true,
    ingredients: ['Chocolate', 'Harina de trigo', 'Huevo', 'Mantequilla', 'Nueces'],
    allergens: ['Gluten', 'Lacteos', 'Huevo', 'Frutos secos'],
    variants: [
      {
        name: 'Porcion',
        sku: 'POS-BROWNIE-POR',
        price: '9.90',
        isDefault: true,
        sortOrder: 10,
      },
    ],
  },
  {
    categoryName: 'Postres',
    name: 'Helado',
    description: 'Helado artesanal de vainilla o chocolate.',
    sortOrder: 20,
    searchAliases: ['helado', 'postre frio'],
    isVegetarian: true,
    ingredients: ['Leche', 'Crema', 'Azucar'],
    allergens: ['Lacteos'],
    variants: [
      {
        name: 'Vainilla',
        sku: 'POS-HELADO-VAI',
        price: '7.90',
        isDefault: true,
        sortOrder: 10,
      },
      {
        name: 'Chocolate',
        sku: 'POS-HELADO-CHO',
        price: '8.50',
        sortOrder: 20,
      },
    ],
  },
];

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to run the Prisma seed');
  }

  const categoryByName = new Map<string, { id: string }>();
  for (const category of categories) {
    const savedCategory = await prisma.categories.upsert({
      where: { name: category.name },
      update: {
        description: category.description,
        sort_order: category.sortOrder,
        is_active: true,
        updated_at: new Date(),
      },
      create: {
        name: category.name,
        description: category.description,
        sort_order: category.sortOrder,
        is_active: true,
      },
      select: { id: true },
    });

    categoryByName.set(category.name, savedCategory);
  }

  const modifierGroupByName = new Map<string, { id: string }>();
  for (const group of modifierGroups) {
    const savedGroup = await prisma.modifier_groups.upsert({
      where: { name: group.name },
      update: {
        description: group.description,
        min_select: group.minSelect,
        max_select: group.maxSelect,
        is_active: true,
        sort_order: group.sortOrder,
        updated_at: new Date(),
      },
      create: {
        name: group.name,
        description: group.description,
        min_select: group.minSelect,
        max_select: group.maxSelect,
        is_active: true,
        sort_order: group.sortOrder,
      },
      select: { id: true },
    });

    modifierGroupByName.set(group.name, savedGroup);

    for (const option of group.options) {
      await prisma.modifier_options.upsert({
        where: {
          group_id_name: {
            group_id: savedGroup.id,
            name: option.name,
          },
        },
        update: {
          price_delta: option.priceDelta,
          is_available: true,
          sort_order: option.sortOrder,
          updated_at: new Date(),
        },
        create: {
          group_id: savedGroup.id,
          name: option.name,
          price_delta: option.priceDelta,
          is_available: true,
          sort_order: option.sortOrder,
        },
      });
    }
  }

  const allIngredientNames = Array.from(
    new Set(menuItems.flatMap((item) => item.ingredients)),
  );
  const allAllergenNames = Array.from(
    new Set(menuItems.flatMap((item) => item.allergens)),
  );

  const ingredientByName = new Map<string, { id: string }>();
  for (const name of allIngredientNames) {
    const ingredient = await prisma.ingredients.upsert({
      where: { name },
      update: {},
      create: { name },
      select: { id: true },
    });

    ingredientByName.set(name, ingredient);
  }

  const allergenByName = new Map<string, { id: string }>();
  for (const name of allAllergenNames) {
    const allergen = await prisma.allergens.upsert({
      where: { name },
      update: {},
      create: { name },
      select: { id: true },
    });

    allergenByName.set(name, allergen);
  }

  for (const item of menuItems) {
    const category = categoryByName.get(item.categoryName);
    if (!category) {
      throw new Error(`Missing category "${item.categoryName}"`);
    }

    const savedItem = await prisma.menu_items.upsert({
      where: {
        category_id_name: {
          category_id: category.id,
          name: item.name,
        },
      },
      update: {
        description: item.description,
        is_active: true,
        is_available: true,
        is_vegetarian: item.isVegetarian ?? false,
        is_vegan: item.isVegan ?? false,
        is_spicy: item.isSpicy ?? false,
        search_aliases: item.searchAliases,
        sort_order: item.sortOrder,
        updated_at: new Date(),
      },
      create: {
        category_id: category.id,
        name: item.name,
        description: item.description,
        is_active: true,
        is_available: true,
        is_vegetarian: item.isVegetarian ?? false,
        is_vegan: item.isVegan ?? false,
        is_spicy: item.isSpicy ?? false,
        search_aliases: item.searchAliases,
        sort_order: item.sortOrder,
      },
      select: { id: true },
    });

    await prisma.menu_item_ingredients.deleteMany({
      where: { menu_item_id: savedItem.id },
    });
    await prisma.menu_item_ingredients.createMany({
      data: item.ingredients.map((name) => {
        const ingredient = ingredientByName.get(name);
        if (!ingredient) {
          throw new Error(`Missing ingredient "${name}"`);
        }

        return {
          menu_item_id: savedItem.id,
          ingredient_id: ingredient.id,
        };
      }),
      skipDuplicates: true,
    });

    await prisma.menu_item_allergens.deleteMany({
      where: { menu_item_id: savedItem.id },
    });
    if (item.allergens.length > 0) {
      await prisma.menu_item_allergens.createMany({
        data: item.allergens.map((name) => {
          const allergen = allergenByName.get(name);
          if (!allergen) {
            throw new Error(`Missing allergen "${name}"`);
          }

          return {
            menu_item_id: savedItem.id,
            allergen_id: allergen.id,
          };
        }),
        skipDuplicates: true,
      });
    }

    for (const variant of item.variants) {
      const savedVariant = await prisma.menu_item_variants.upsert({
        where: { sku: variant.sku },
        update: {
          menu_item_id: savedItem.id,
          name: variant.name,
          price: variant.price,
          is_default: variant.isDefault ?? false,
          is_available: true,
          sort_order: variant.sortOrder,
          updated_at: new Date(),
        },
        create: {
          menu_item_id: savedItem.id,
          name: variant.name,
          sku: variant.sku,
          price: variant.price,
          is_default: variant.isDefault ?? false,
          is_available: true,
          sort_order: variant.sortOrder,
        },
        select: { id: true },
      });

      await prisma.item_variant_modifier_groups.deleteMany({
        where: { variant_id: savedVariant.id },
      });

      const groups = variant.modifierGroups ?? [];
      if (groups.length > 0) {
        await prisma.item_variant_modifier_groups.createMany({
          data: groups.map((groupName) => {
            const group = modifierGroupByName.get(groupName);
            if (!group) {
              throw new Error(`Missing modifier group "${groupName}"`);
            }

            return {
              variant_id: savedVariant.id,
              group_id: group.id,
            };
          }),
          skipDuplicates: true,
        });
      }
    }
  }
}

main()
  .then(async () => {
    console.log('Seed completed.');
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
