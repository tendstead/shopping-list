export type Item = {
  id: string;
  name: string;
  reusable: boolean;
  counter: boolean;
  showTags: boolean;
  tags: string[];
  needed: boolean;
  count: number;
  selectedTags: string[];
  purchased: boolean;
};
export type Layout = { id: string; name: string; order: string[] };
export type SharedState = {
  tripId: string;
  revision: number;
  items: Item[];
  layouts: Layout[];
};
export type History = {
  id: string;
  completedAt: string;
  items: {
    name: string;
    count: number;
    counter: boolean;
    selectedTags: string[];
    purchased: boolean;
    carriedOver: boolean;
  }[];
};
export type Operation = {
  id: string;
  tripId: string;
  kind: string;
  itemId?: string;
  layoutId?: string;
  name?: string;
  reusable?: boolean;
  counter?: boolean;
  showTags?: boolean;
  tags?: string[];
  field?: string;
  base?: unknown;
  value?: unknown;
  revision?: number;
};
export type Problem = {
  code: string;
  message: string;
  itemId?: string;
  current?: unknown;
};
export type Pending = {
  op: Operation;
  label?: string;
  item?: Item;
  problem?: Problem;
};
export type Outcome = {
  state: SharedState;
  history?: History;
  problem?: Problem;
  replay?: boolean;
};
export const normalize = (s: string) => s.trim().replace(/\s+/g, ' ');
export function newID(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function')
    return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
export function project(
  authoritative: SharedState,
  pending: Pending[],
): SharedState {
  const s = structuredClone(authoritative);
  for (const { op, problem } of pending) {
    if (problem || op.tripId !== s.tripId) continue;
    const i = s.items.find((i) => i.id === op.itemId);
    const l = s.layouts.find((l) => l.id === op.layoutId);
    if (op.kind === 'trip_set' && i && op.field) {
      Object.assign(i, { [op.field]: op.value });
      if (op.field === 'count') {
        i.needed = i.count > 0;
        if (!i.needed) i.purchased = false;
      }
      if (op.field === 'needed' && !i.needed) i.purchased = false;
    }
    if (op.kind === 'layout_order' && l) l.order = op.value as string[];
    if (op.kind === 'item_add') {
      if (s.items.some((i) => i.id === op.itemId)) continue;
      const item: Item = {
        id: op.itemId!,
        name: normalize(op.name || ''),
        reusable: !!op.reusable,
        counter: !!op.counter,
        showTags: !!op.showTags,
        tags: op.tags || [],
        needed: !op.reusable,
        count: !op.reusable && op.counter ? 1 : 0,
        selectedTags: [],
        purchased: false,
      };
      s.items.push(item);
      for (const l of s.layouts) l.order.push(item.id);
    }
  }
  return s;
}
export function route(op: Operation): { url: string; method: string } {
  if (op.kind === 'finish') return { url: '/api/finish', method: 'POST' };
  if (op.kind === 'item_add' && op.reusable)
    return { url: '/api/items', method: 'POST' };
  if (op.kind === 'item_edit' || op.kind === 'item_delete')
    return {
      url: `/api/items/${encodeURIComponent(op.itemId!)}`,
      method: op.kind === 'item_delete' ? 'DELETE' : 'PATCH',
    };
  if (op.kind === 'layout_add') return { url: '/api/layouts', method: 'POST' };
  if (op.kind === 'layout_rename' || op.kind === 'layout_delete')
    return {
      url: `/api/layouts/${encodeURIComponent(op.layoutId!)}`,
      method: op.kind === 'layout_delete' ? 'DELETE' : 'PATCH',
    };
  return { url: '/api/operations', method: 'POST' };
}
