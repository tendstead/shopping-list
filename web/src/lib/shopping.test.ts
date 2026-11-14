import { expect, test } from 'vitest';
import { shoppingEntries } from './shopping';
import type { Item } from './model';
const item = (id: string, category?: 'spices'): Item => ({
  id,
  name: id,
  category,
  reusable: true,
  counter: false,
  showTags: false,
  tags: [],
  needed: true,
  count: 0,
  selectedTags: [],
  purchased: false,
});
test('category stays anchored when its first member is purchased', () => {
  const list = [
    item('bread'),
    item('cumin', 'spices'),
    item('milk'),
    item('cinnamon', 'spices'),
  ];
  const result = () =>
    shoppingEntries(list).map((e) =>
      e.kind === 'item' ? e.item.id : [e.category, ...e.items.map((i) => i.id)],
    );
  expect(result()).toEqual(['bread', ['spices', 'cumin', 'cinnamon'], 'milk']);
  list[1].purchased = true;
  expect(result()).toEqual(['bread', ['spices', 'cinnamon'], 'milk']);
  list[3].purchased = true;
  expect(result()).toEqual(['bread', 'milk']);
  list[3].purchased = false;
  expect(result()).toEqual(['bread', ['spices', 'cinnamon'], 'milk']);
  expect(list.map((i) => i.id)).toEqual(['bread', 'cumin', 'milk', 'cinnamon']);
});
test('only needed rows participate and category members follow layout order', () => {
  const a = item('a', 'spices'),
    b = item('b', 'spices');
  a.needed = false;
  expect(shoppingEntries([a, item('milk'), b])).toEqual([
    { kind: 'item', item: item('milk') },
    { kind: 'category', category: 'spices', items: [b] },
  ]);
  a.needed = true;
  expect(shoppingEntries([b, a])).toEqual([
    { kind: 'category', category: 'spices', items: [b, a] },
  ]);
  expect(shoppingEntries([])).toEqual([]);
  const unknown = { ...item('future'), category: 'future' } as unknown as Item;
  expect(shoppingEntries([unknown])).toEqual([{ kind: 'item', item: unknown }]);
});
