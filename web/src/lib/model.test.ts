import { expect, test } from 'vitest';
import { project, type SharedState, type Operation } from './model';
const state: SharedState = {
  tripId: 'trip',
  revision: 0,
  items: [],
  layouts: [{ id: 'l', name: 'L', order: [] }],
};
test('old additions and spice additions project without modifying the snapshot or queue', () => {
  const old: Operation = {
    id: 'old',
    tripId: 'trip',
    kind: 'item_add',
    itemId: 'bread',
    name: 'Bread',
  };
  const spice: Operation = {
    ...old,
    id: 'new',
    itemId: 'cumin',
    name: 'Cumin',
    category: 'spices',
  };
  const pending = [
    { op: old },
    { op: spice },
    {
      op: {
        id: 'buy',
        tripId: 'trip',
        kind: 'trip_set',
        itemId: 'cumin',
        field: 'purchased',
        base: false,
        value: true,
      },
    },
  ];
  const original = JSON.stringify(pending);
  const result = project(state, pending);
  expect(result.items[0].category ?? '').toBe('');
  expect(result.items[1]).toMatchObject({
    category: 'spices',
    purchased: true,
  });
  expect(state.items).toEqual([]);
  expect(JSON.stringify(pending)).toBe(original);
});
