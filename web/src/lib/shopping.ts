import { categoryDefinitions, type Category, type Item } from './model';
export type ShoppingEntry =
  | { kind: 'item'; item: Item }
  | { kind: 'category'; category: Exclude<Category, ''>; items: Item[] };

export function shoppingEntries(ordered: Item[]): ShoppingEntry[] {
  const groups = new Map<string, Item[]>();
  for (const { id } of categoryDefinitions) {
    groups.set(
      id,
      ordered.filter((i) => i.category === id && i.needed && !i.purchased),
    );
  }
  const seen = new Set<string>();
  const entries: ShoppingEntry[] = [];
  for (const item of ordered) {
    if (!item.needed) continue;
    const category = categoryDefinitions.find(
      (c) => c.id === item.category,
    )?.id;
    if (category) {
      if (seen.has(category)) continue;
      seen.add(category);
      const items = groups.get(category)!;
      if (items.length) entries.push({ kind: 'category', category, items });
    } else if (!item.purchased) entries.push({ kind: 'item', item });
  }
  return entries;
}
