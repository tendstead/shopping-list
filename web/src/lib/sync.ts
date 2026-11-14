import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import {
  project,
  route,
  newID,
  type SharedState,
  type Pending,
  type Operation,
  type Outcome,
  type Item,
  type History,
} from './model';
type Session = { state: SharedState | null; pending: Pending[] };
interface Persistence extends DBSchema {
  data: { key: string; value: Session | History[] };
}
export function openPersistence(
  name = 'shopping-list-v1',
): Promise<IDBPDatabase<Persistence>> {
  return openDB<Persistence>(name, 1, {
    upgrade(db) {
      db.createObjectStore('data');
    },
  });
}
export class Sync {
  state: SharedState | null = null;
  pending: Pending[] = [];
  connected = false;
  busy = false;
  storageError = false;
  onChange: () => void = () => {};
  onNeeded: (names: string[]) => void = () => {};
  private tail: Promise<unknown> = Promise.resolve();
  private running: Promise<void> | null = null;
  private reconcileRequested = false;
  constructor(
    private db: IDBPDatabase<Persistence>,
    private request: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}
  get view() {
    return this.state ? project(this.state, this.pending) : null;
  }
  get status(): 'synced' | 'saving' | 'offline' | 'attention' {
    if (this.storageError || this.pending.some((p) => p.problem))
      return 'attention';
    if (!this.connected) return 'offline';
    if (this.busy || this.pending.length) return 'saving';
    return 'synced';
  }
  private serial<T>(f: () => Promise<T>): Promise<T> {
    const p = this.tail.then(f);
    this.tail = p.catch(() => {});
    return p;
  }
  private async save(state: SharedState | null, pending: Pending[]) {
    try {
      const transaction = this.db.transaction('data', 'readwrite');
      const saved = (await transaction.store.get('session')) as
        Session | undefined;
      const known = new Set(this.pending.map((p) => p.op.id));
      const wanted = new Map(pending.map((p) => [p.op.id, p]));
      const combined = (saved?.pending || [])
        .filter((p) => !known.has(p.op.id) || wanted.has(p.op.id))
        .map((p) => wanted.get(p.op.id) || p);
      for (const [position, entry] of pending.entries()) {
        if (
          !known.has(entry.op.id) &&
          !combined.some((p) => p.op.id === entry.op.id)
        ) {
          // A reviewed replacement must stay before operations based on its value.
          const successor = pending
            .slice(position + 1)
            .find((next) => combined.some((p) => p.op.id === next.op.id));
          const index = successor
            ? combined.findIndex((p) => p.op.id === successor.op.id)
            : combined.length;
          combined.splice(index, 0, entry);
        }
      }
      if (saved?.state && (!state || saved.state.revision > state.revision))
        state = saved.state;
      await transaction.store.put({ state, pending: combined }, 'session');
      await transaction.done;
      this.state = state;
      this.pending = combined;
      this.storageError = false;
      this.onChange();
    } catch (e) {
      this.storageError = true;
      this.onChange();
      throw e;
    }
  }

  async init() {
    const saved = (await this.db.get('data', 'session')) as Session | undefined;
    if (saved) {
      this.state = saved.state;
      this.pending = saved.pending;
    }
    this.onChange();
  }
  async enqueue(input: Operation | ((view: SharedState) => Operation)) {
    await this.serial(async () => {
      if (!this.view) throw new Error('Load the checklist before editing');
      const op = typeof input === 'function' ? input(this.view) : input;
      const item = this.view?.items.find((i) => i.id === op.itemId);
      const label =
        item?.name ||
        op.name ||
        this.view?.layouts.find((l) => l.id === op.layoutId)?.name;
      await this.save(this.state, [
        ...this.pending,
        {
          op: structuredClone(op),
          label,
          item: item ? structuredClone(item) : undefined,
        },
      ]);
    });
  }
  async fetchJSON<T>(
    url: string,
    init?: RequestInit,
  ): Promise<{ body: T; ok: boolean; status: number }> {
    const response = await this.request(url, {
      ...init,
      signal: AbortSignal.timeout(8000),
    });
    const body = (await response.json()) as T;
    return { body, ok: response.ok, status: response.status };
  }
  private async adopt(state: SharedState, pending: Pending[], notify = false) {
    if (this.state && state.revision < this.state.revision) {
      await this.save(this.state, pending);
      return;
    }
    const previousView = this.view;
    const names =
      notify && this.state
        ? state.items
            .filter(
              (i) =>
                i.needed &&
                !this.state!.items.find((old) => old.id === i.id)?.needed &&
                !previousView?.items.find((old) => old.id === i.id)?.needed,
            )
            .map((i) => i.name)
        : [];
    await this.save(state, pending);
    if (names.length) this.onNeeded(names);
  }
  reconcile(): Promise<void> {
    this.reconcileRequested = true;
    if (this.running) return this.running;
    this.running = (async () => {
      try {
        do {
          this.reconcileRequested = false;
          await this.run();
          // Network failures retain the existing retry backoff in start().
        } while (this.reconcileRequested && this.connected);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }
  private async run() {
    this.busy = true;
    this.onChange();
    try {
      const { body: state, ok } =
        await this.fetchJSON<SharedState>('/api/state');
      if (!ok || !state.tripId) throw new Error('State unavailable');
      this.connected = true;
      await this.serial(() => this.adopt(state, this.pending, true));
      while (this.pending.length) {
        const entry = this.pending[0];
        if (entry.problem) break;
        const target = route(entry.op);
        const { body, ok, status } = await this.fetchJSON<Outcome>(target.url, {
          method: target.method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(entry.op),
        });
        if (!ok && (!body.problem || status >= 500))
          throw new Error('Save unavailable');
        await this.serial(async () => {
          const index = this.pending.findIndex((p) => p.op.id === entry.op.id);
          if (index < 0) return;
          const pending = structuredClone(this.pending);
          if (body.problem) {
            pending[index].problem = body.problem;
          } else {
            pending.splice(index, 1);
          }
          if (body.state?.tripId) await this.adopt(body.state, pending);
          else await this.save(this.state, pending);
        });
        if (body.problem) break;
      }
    } catch (e) {
      this.connected = false;
      if (this.storageError) throw e;
    } finally {
      this.busy = false;
      this.onChange();
    }
  }
  async resolve(
    choice: 'server' | 'mine',
    expectedId = this.pending[0]?.op.id,
  ): Promise<boolean> {
    return this.serial(async () => {
      if (!expectedId || this.pending[0]?.op.id !== expectedId) return false;
      const pending = structuredClone(this.pending);
      const entry = pending.shift();
      if (!entry || !this.state) return false;
      if (choice === 'mine') {
        if (entry.op.kind === 'finish')
          throw new Error('Review the trip and tap Finish again');
        const op = { ...entry.op, id: newID(), tripId: this.state.tripId };
        const item = this.state.items.find((i) => i.id === op.itemId);
        const layout = this.state.layouts.find((l) => l.id === op.layoutId);
        if (op.kind === 'trip_set' || op.kind === 'item_edit') {
          if (!item || !op.field)
            throw new Error(
              'This item was removed. Add it again as a one-time item',
            );
          op.base =
            op.field === 'category'
              ? item.category || ''
              : structuredClone(item[op.field as keyof Item]);
        }
        if (op.kind === 'item_delete') op.base = item;
        if (op.kind === 'layout_order') {
          if (!layout) throw new Error('Layout was removed');
          op.base = layout.order;
          const wanted = (op.value as string[]).filter((id) =>
            this.state!.items.some((i) => i.id === id),
          );
          op.value = [
            ...wanted,
            ...layout.order.filter((id) => !wanted.includes(id)),
          ];
        }
        if (op.kind === 'layout_rename') op.base = layout?.name;
        if (op.kind === 'layout_delete') op.base = layout;
        pending.unshift({ ...entry, op, problem: undefined });
      }
      await this.save(this.state, pending);
      return true;
    });
  }
  async useDuplicate() {
    const expectedId = this.pending[0]?.op.id;
    await this.serial(async () => {
      const entry = this.pending[0];
      const itemId = entry?.problem?.itemId;
      if (
        entry?.op.id !== expectedId ||
        entry?.problem?.code !== 'duplicate' ||
        !itemId ||
        !this.view
      )
        return;
      const item = this.view.items.find((i) => i.id === itemId);
      if (!item) throw new Error('The existing item was removed');
      const op: Operation = {
        id: newID(),
        tripId: this.view.tripId,
        kind: 'trip_set',
        itemId,
        field: item.counter ? 'count' : 'needed',
        base: item.counter ? item.count : item.needed,
        value: item.counter ? Math.max(item.count, 1) : true,
      };
      const pending = structuredClone(this.pending);
      pending.shift();
      pending.push({ op, label: item.name, item: structuredClone(item) });
      // Persist the selection together with discarding the duplicate; never expose
      // an empty queue or lose this intent between two separate storage writes.
      await this.save(this.state, pending);
    });
  }
  async restoreRemoved() {
    const expectedId = this.pending[0]?.op.id;
    await this.serial(async () => {
      const entry = this.pending[0];
      if (!entry?.item || entry.op.id !== expectedId || !this.state) return;
      const item = { ...entry.item };
      if (entry.op.field)
        Object.assign(item, { [entry.op.field]: entry.op.value });
      const id = newID();
      const operations: Operation[] = [
        {
          id: newID(),
          tripId: this.state.tripId,
          kind: 'item_add',
          itemId: id,
          name: item.name,
          ...(item.category ? { category: item.category } : {}),
          reusable: false,
          counter: item.counter,
          showTags: item.showTags,
          tags: item.tags,
        },
      ];
      if (item.counter && item.count !== 1)
        operations.push({
          id: newID(),
          tripId: this.state.tripId,
          kind: 'trip_set',
          itemId: id,
          field: 'count',
          base: 1,
          value: item.count,
        });
      if (item.showTags && item.selectedTags.length)
        operations.push({
          id: newID(),
          tripId: this.state.tripId,
          kind: 'trip_set',
          itemId: id,
          field: 'selectedTags',
          base: [],
          value: item.selectedTags,
        });
      if (item.purchased)
        operations.push({
          id: newID(),
          tripId: this.state.tripId,
          kind: 'trip_set',
          itemId: id,
          field: 'purchased',
          base: false,
          value: true,
        });
      const replacements: Pending[] = [];
      for (const op of operations) {
        const before = project(this.state, replacements).items.find(
          (i) => i.id === id,
        );
        replacements.push({ op, label: item.name, item: before });
      }
      // Replace the reviewed edit and persist every restoration step together.
      // A failed write leaves the original intent available for another attempt.
      await this.save(this.state, [...replacements, ...this.pending.slice(1)]);
    });
  }
  async finish() {
    await this.reconcile();
    if (
      !this.connected ||
      this.pending.length ||
      !this.state ||
      this.storageError
    )
      throw new Error(
        'Synchronize and resolve pending changes before finishing',
      );
    await this.enqueue({
      id: newID(),
      tripId: this.state.tripId,
      kind: 'finish',
      revision: this.state.revision,
    });
    await this.reconcile();
    if (this.pending.length)
      throw new Error('Completion is pending. Review synchronization status');
  }
  async history(): Promise<History[]> {
    try {
      const r = await this.fetchJSON<History[]>('/api/history');
      if (!r.ok) throw new Error('History unavailable');
      await this.db.put('data', r.body, 'history');
      return r.body;
    } catch {
      return (
        ((await this.db.get('data', 'history')) as History[] | undefined) || []
      );
    }
  }
  start(): () => void {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = 1000;
    const kick = () => {
      if (stopped) return;
      clearTimeout(timer);
      void this.reconcile()
        .catch(() => {})
        .finally(() => {
          if (stopped) return;
          if (this.connected) {
            delay = 1000;
          } else {
            timer = setTimeout(kick, delay);
            delay = Math.min(delay * 2, 30000);
          }
        });
    };
    const visible = () => {
      if (document.visibilityState === 'visible') kick();
    };
    const offline = () => {
      this.connected = false;
      this.onChange();
      kick();
    };
    window.addEventListener('online', kick);
    window.addEventListener('offline', offline);
    window.addEventListener('focus', kick);
    document.addEventListener('visibilitychange', visible);
    const events = new EventSource('/api/events');
    events.addEventListener('ready', kick);
    events.addEventListener('change', kick);
    events.onerror = kick;
    kick();
    return () => {
      stopped = true;
      clearTimeout(timer);
      events.close();
      window.removeEventListener('online', kick);
      window.removeEventListener('offline', offline);
      window.removeEventListener('focus', kick);
      document.removeEventListener('visibilitychange', visible);
    };
  }
}
