import 'fake-indexeddb/auto';
import { describe, expect, test } from 'vitest';
import { Sync, openPersistence } from './sync';
import { project, type SharedState, type Operation } from './model';
const initial: SharedState = {
  tripId: 'trip-a',
  revision: 0,
  items: [
    {
      id: 'milk',
      name: 'Milk',
      reusable: true,
      counter: true,
      showTags: true,
      tags: ['A', 'B'],
      needed: false,
      count: 0,
      selectedTags: [],
      purchased: false,
    },
  ],
  layouts: [{ id: 'aldi', name: 'Aldi', order: ['milk'] }],
};
const operation = (base = 0, value = 2): Operation => ({
  id: crypto.randomUUID(),
  tripId: 'trip-a',
  kind: 'trip_set',
  itemId: 'milk',
  field: 'count',
  base,
  value,
});
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
describe('durable synchronization', () => {
  test('offline count changes survive a new instance before appearing saved', async () => {
    const db = await openPersistence(crypto.randomUUID());
    await db.put('data', { state: initial, pending: [] }, 'session');
    const s = new Sync(db, async () => {
      throw new TypeError('disconnected');
    });
    await s.init();
    await s.enqueue(operation());
    expect(s.view?.items[0].count).toBe(2);
    expect(s.pending).toHaveLength(1);
    const reloaded = new Sync(db, async () => {
      throw new TypeError('disconnected');
    });
    await reloaded.init();
    expect(reloaded.view?.items[0].count).toBe(2);
    expect(reloaded.pending[0].op.base).toBe(0);
  });
  test('lost acknowledged response retries exactly the original operation id', async () => {
    const db = await openPersistence(crypto.randomUUID());
    await db.put('data', { state: initial, pending: [] }, 'session');
    let committed = false;
    const ids: string[] = [];
    const s = new Sync(db, async (_url, options) => {
      if (!options?.body)
        return response(
          committed
            ? {
                ...initial,
                revision: 1,
                items: [{ ...initial.items[0], count: 2, needed: true }],
              }
            : initial,
        );
      const op = JSON.parse(String(options.body));
      ids.push(op.id);
      if (!committed) {
        committed = true;
        throw new TypeError('lost response');
      }
      return response({
        state: {
          ...initial,
          revision: 1,
          items: [{ ...initial.items[0], count: 2, needed: true }],
        },
        replay: true,
      });
    });
    await s.init();
    const op = operation();
    await s.enqueue(op);
    await s.reconcile();
    expect(s.pending).toHaveLength(1);
    await s.reconcile();
    expect(s.pending).toHaveLength(0);
    expect(ids).toEqual([op.id, op.id]);
    expect(s.view?.items[0].count).toBe(2);
  });
  test('competing values remain pending until explicit choice', async () => {
    const db = await openPersistence(crypto.randomUUID());
    await db.put('data', { state: initial, pending: [] }, 'session');
    const remote = {
      ...initial,
      revision: 1,
      items: [{ ...initial.items[0], count: 5, needed: true }],
    };
    const s = new Sync(db, async (_u, opts) =>
      opts?.body
        ? response(
            {
              state: remote,
              problem: { code: 'conflict', message: 'choose', current: 5 },
            },
            409,
          )
        : response(remote),
    );
    await s.init();
    await s.enqueue(operation());
    await s.reconcile();
    expect(s.status).toBe('attention');
    expect(s.pending).toHaveLength(1);
    expect(s.view?.items[0].count).toBe(5);
    await s.resolve('server');
    expect(s.pending).toHaveLength(0);
  });
  test('late changes require review and use a new id when explicitly reapplied', async () => {
    const db = await openPersistence(crypto.randomUUID());
    await db.put('data', { state: initial, pending: [] }, 'session');
    const remote = { ...initial, tripId: 'trip-b', revision: 1 };
    let seen: Operation | undefined;
    const s = new Sync(db, async (_u, opts) => {
      if (!opts?.body) return response(remote);
      seen = JSON.parse(String(opts.body));
      if (seen?.tripId === 'trip-a')
        return response(
          { state: remote, problem: { code: 'late_trip', message: 'review' } },
          409,
        );
      return response({
        state: {
          ...remote,
          revision: 2,
          items: [{ ...initial.items[0], count: 2, needed: true }],
        },
      });
    });
    await s.init();
    const old = operation();
    await s.enqueue(old);
    await s.reconcile();
    expect(s.status).toBe('attention');
    await s.resolve('mine');
    expect(s.pending[0].op.tripId).toBe('trip-b');
    expect(s.pending[0].op.id).not.toBe(old.id);
    await s.reconcile();
    expect(s.pending).toHaveLength(0);
    expect(seen?.tripId).toBe('trip-b');
  });
  test('storage failure never marks an unpersisted edit locally saved', async () => {
    const db = await openPersistence(crypto.randomUUID());
    await db.put('data', { state: initial, pending: [] }, 'session');
    const s = new Sync(db, async () => response(initial));
    await s.init();
    db.close();
    await expect(s.enqueue(operation())).rejects.toThrow();
    expect(s.pending).toHaveLength(0);
    expect(s.view?.items[0].count).toBe(0);
  });
});
test('projection keeps counter status and order consistent', () => {
  const state = project(initial, [{ op: operation() }]);
  expect(state.items[0].needed).toBe(true);
  expect(initial.items[0].count).toBe(0);
});

test('two instances sharing browser storage cannot overwrite independent pending edits', async () => {
  const db = await openPersistence(crypto.randomUUID());
  await db.put('data', { state: initial, pending: [] }, 'session');
  const offline: typeof fetch = async () => {
    throw new TypeError('offline');
  };
  const first = new Sync(db, offline);
  const second = new Sync(db, offline);
  await first.init();
  await second.init();
  await first.enqueue(operation());
  await second.enqueue({
    id: crypto.randomUUID(),
    tripId: 'trip-a',
    kind: 'trip_set',
    itemId: 'milk',
    field: 'selectedTags',
    base: [],
    value: ['A'],
  });
  const reloaded = new Sync(db, offline);
  await reloaded.init();
  expect(reloaded.pending).toHaveLength(2);
  expect(reloaded.view?.items[0].count).toBe(2);
  expect(reloaded.view?.items[0].selectedTags).toEqual(['A']);
});

test('rapid local intents use the latest durable projection without losing taps or tags', async () => {
  const db = await openPersistence(crypto.randomUUID());
  await db.put('data', { state: initial, pending: [] }, 'session');
  const s = new Sync(db, async () => {
    throw new TypeError('offline');
  });
  await s.init();
  const increment = () =>
    s.enqueue((view: SharedState) => ({
      ...operation(view.items[0].count, view.items[0].count + 1),
      tripId: view.tripId,
    }));
  await Promise.all([increment(), increment(), increment()]);
  const tag = (value: string) =>
    s.enqueue((view: SharedState) => ({
      id: crypto.randomUUID(),
      tripId: view.tripId,
      kind: 'trip_set',
      itemId: 'milk',
      field: 'selectedTags',
      base: view.items[0].selectedTags,
      value: [...view.items[0].selectedTags, value].sort(),
    }));
  await Promise.all([tag('A'), tag('B')]);
  expect(s.view?.items[0].count).toBe(3);
  expect(s.view?.items[0].selectedTags).toEqual(['A', 'B']);
  expect(s.pending.map((p) => p.op.base)).toEqual([0, 1, 2, [], ['A']]);
});

test('keeping a conflicted change preserves its position before dependent local edits', async () => {
  const db = await openPersistence(crypto.randomUUID());
  await db.put('data', { state: initial, pending: [] }, 'session');
  let count = 5;
  let revision = 1;
  const s = new Sync(db, async (_u, options) => {
    const remote = () => ({
      ...initial,
      revision,
      items: [{ ...initial.items[0], needed: true, count }],
    });
    if (!options?.body) return response(remote());
    const op = JSON.parse(String(options.body)) as Operation;
    if (op.base !== count && op.value !== count)
      return response(
        { state: remote(), problem: { code: 'conflict', current: count } },
        409,
      );
    count = Number(op.value);
    revision++;
    return response({ state: remote() });
  });
  await s.init();
  await s.enqueue(operation(0, 2));
  await s.enqueue(operation(2, 3));
  await s.reconcile();
  expect(s.status).toBe('attention');
  await s.resolve('mine');
  expect(s.pending.map((p) => p.op.value)).toEqual([2, 3]);
  await s.reconcile();
  expect(s.pending).toHaveLength(0);
  expect(s.view?.items[0].count).toBe(3);
});

test('server-detected duplicate offers the existing item for selection', async () => {
  const db = await openPersistence(crypto.randomUUID());
  await db.put('data', { state: initial, pending: [] }, 'session');
  const s = new Sync(db, async (_u, options) =>
    options?.body
      ? response(
          { state: initial, problem: { code: 'duplicate', itemId: 'milk' } },
          409,
        )
      : response(initial),
  );
  await s.init();
  await s.enqueue({
    id: crypto.randomUUID(),
    tripId: initial.tripId,
    kind: 'item_add',
    itemId: 'other-milk',
    name: 'Milk',
    reusable: false,
  });
  await s.reconcile();
  await s.useDuplicate();
  expect(s.pending).toHaveLength(1);
  expect(s.pending[0].op.itemId).toBe('milk');
  expect(s.view?.items[0].count).toBe(1);
});

test('double-tapping duplicate selection cannot discard the next pending edit', async () => {
  const db = await openPersistence(crypto.randomUUID());
  await db.put('data', { state: initial, pending: [] }, 'session');
  const s = new Sync(db, async (_u, options) =>
    options?.body
      ? response(
          { state: initial, problem: { code: 'duplicate', itemId: 'milk' } },
          409,
        )
      : response(initial),
  );
  await s.init();
  await s.enqueue({
    id: crypto.randomUUID(),
    tripId: initial.tripId,
    kind: 'item_add',
    itemId: 'other',
    name: 'Milk',
    reusable: false,
  });
  const later = {
    ...operation(),
    field: 'selectedTags',
    base: [],
    value: ['B'],
  };
  await s.enqueue(later);
  await s.reconcile();
  await Promise.all([s.useDuplicate(), s.useDuplicate()]);
  expect(s.pending.filter((p) => p.op.id === later.id)).toHaveLength(1);
  expect(s.pending).toHaveLength(2);
  expect(s.view?.items[0].selectedTags).toEqual(['B']);
});

test('same-origin instances concurrently drain shared storage without losing or repeating writes', async () => {
  const db = await openPersistence(crypto.randomUUID());
  await db.put('data', { state: initial, pending: [] }, 'session');
  let shared = structuredClone(initial);
  const acknowledged = new Set<string>();
  const transport: typeof fetch = async (_u, options) => {
    if (!options?.body) return response(shared);
    const op = JSON.parse(String(options.body)) as Operation;
    if (!acknowledged.has(op.id)) {
      shared = project(shared, [{ op }]);
      shared.revision++;
      acknowledged.add(op.id);
    }
    return response({ state: shared });
  };
  const first = new Sync(db, transport),
    second = new Sync(db, transport);
  await first.init();
  await second.init();
  const count = operation();
  await first.enqueue(count);
  const tags = {
    ...operation(),
    field: 'selectedTags',
    base: [],
    value: ['A'],
  };
  await second.enqueue(tags);
  await Promise.all([first.reconcile(), second.reconcile()]);
  const restored = new Sync(db, transport);
  await restored.init();
  expect(restored.pending).toHaveLength(0);
  expect(restored.view?.items[0].count).toBe(2);
  expect(restored.view?.items[0].selectedTags).toEqual(['A']);
  expect([...acknowledged].sort()).toEqual([count.id, tags.id].sort());
  expect(shared.revision).toBe(2);
});

test('remote newly-needed notification is retained alongside a local tag edit', async () => {
  const db = await openPersistence(crypto.randomUUID());
  await db.put('data', { state: initial, pending: [] }, 'session');
  const remote = {
    ...initial,
    revision: 1,
    items: [{ ...initial.items[0], needed: true, count: 1 }],
  };
  const s = new Sync(db, async (_u, options) =>
    options?.body
      ? response({
          state: {
            ...remote,
            revision: 2,
            items: [{ ...remote.items[0], selectedTags: ['A'] }],
          },
        })
      : response(remote),
  );
  const notifications: string[][] = [];
  s.onNeeded = (names) => notifications.push(names);
  await s.init();
  await s.enqueue({
    ...operation(),
    field: 'selectedTags',
    base: [],
    value: ['A'],
  });
  await s.reconcile();
  expect(notifications).toEqual([['Milk']]);
});

test('using a duplicate follows existing-item edits already queued behind it', async () => {
  const db = await openPersistence(crypto.randomUUID());
  await db.put('data', { state: initial, pending: [] }, 'session');
  let shared = structuredClone(initial);
  const s = new Sync(db, async (_u, options) => {
    if (!options?.body) return response(shared);
    const op = JSON.parse(String(options.body)) as Operation;
    if (op.kind === 'item_add')
      return response(
        { state: shared, problem: { code: 'duplicate', itemId: 'milk' } },
        409,
      );
    if (op.base !== shared.items[0].count && op.value !== shared.items[0].count)
      return response(
        {
          state: shared,
          problem: { code: 'conflict', current: shared.items[0].count },
        },
        409,
      );
    shared = project(shared, [{ op }]);
    shared.revision++;
    return response({ state: shared });
  });
  await s.init();
  await s.enqueue({
    id: crypto.randomUUID(),
    tripId: initial.tripId,
    kind: 'item_add',
    itemId: 'other',
    name: 'Milk',
    reusable: false,
  });
  const later = operation(0, 2);
  await s.enqueue(later);
  await s.reconcile();
  await s.useDuplicate();
  await s.reconcile();
  expect(s.pending).toHaveLength(0);
  expect(s.status).toBe('synced');
  expect(s.view?.items[0].count).toBe(2);
});
