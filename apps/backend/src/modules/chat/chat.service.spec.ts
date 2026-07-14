import { ChatService } from './chat.service';

type FindMatchingMenuItems = {
  findMatchingMenuItems(
    tx: { menu_items: { findMany: jest.Mock } },
    messages: string[],
  ): Promise<Array<{ name: string }>>;
};

const menuItem = (id: string, name: string, searchAliases: string[]) => ({
  id,
  name,
  search_aliases: searchAliases,
  menu_item_variants: [],
});

describe('ChatService product matching', () => {
  const items = [
    menuItem('classic-burger', 'Hamburguesa Clasica', [
      'hamburguesa',
      'clasica',
      'burger clasica',
    ]),
    menuItem('double-burger', 'Hamburguesa Doble Carne', [
      'doble',
      'doble carne',
      'burger doble',
    ]),
    menuItem('veggie-burger', 'Hamburguesa Vegetariana', [
      'vegetariana',
      'veggie',
      'hamburguesa vegetal',
    ]),
  ];

  const findMatches = async (message: string) => {
    const service = new ChatService(
      {} as ConstructorParameters<typeof ChatService>[0],
      {} as ConstructorParameters<typeof ChatService>[1],
    ) as unknown as FindMatchingMenuItems;
    const tx = {
      menu_items: {
        findMany: jest.fn().mockResolvedValue(items),
      },
    };

    return service.findMatchingMenuItems(tx, [message]);
  };

  it('prioritizes the full product name over broad aliases', async () => {
    const matches = await findMatches('quiero una hamburguesa vegetariana');

    expect(matches.map((item) => item.name)).toEqual([
      'Hamburguesa Vegetariana',
    ]);
  });

  it('normalizes accents and punctuation before matching', async () => {
    const matches = await findMatches('quiero hamburguesa, cl\u00e1sica!');

    expect(matches.map((item) => item.name)).toEqual(['Hamburguesa Clasica']);
  });

  it('uses a specific search alias directly', async () => {
    const matches = await findMatches('quiero hamburguesa vegetal');

    expect(matches.map((item) => item.name)).toEqual([
      'Hamburguesa Vegetariana',
    ]);
  });

  it('keeps generic product requests ambiguous', async () => {
    const matches = await findMatches('quiero una hamburguesa');

    expect(matches.map((item) => item.name)).toEqual([
      'Hamburguesa Clasica',
      'Hamburguesa Doble Carne',
      'Hamburguesa Vegetariana',
    ]);
  });

  it('maps product synonyms to their canonical menu item', async () => {
    const matches = await findMatches('unas veggie por favor');

    expect(matches.map((item) => item.name)).toEqual([
      'Hamburguesa Vegetariana',
    ]);
  });

  it('matches a product when a meaningful token has a small typo', async () => {
    const matches = await findMatches('quiero una hamburguesa clazica');

    expect(matches.map((item) => item.name)).toEqual(['Hamburguesa Clasica']);
  });
});
