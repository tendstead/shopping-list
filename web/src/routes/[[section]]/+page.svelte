<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { resolve } from '$app/paths';
  import { afterNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import { AppShell, type Destination } from '@tendstead/ui';
  import '@tendstead/ui/theme.css';
  import HistoryIcon from '../../lib/icons/HistoryIcon.svelte';
  import ListIcon from '../../lib/icons/ListIcon.svelte';
  import EditIcon from '../../lib/icons/EditIcon.svelte';
  import Checkbox from '../../lib/Checkbox.svelte';
  import ItemRow from '../../lib/ItemRow.svelte';
  import { translations, type Language } from '../../lib/i18n';
  import { Sync, openPersistence } from '../../lib/sync';
  import {
    newID,
    normalize,
    type Item,
    type SharedState,
    type Operation,
    type Pending,
    type History,
  } from '../../lib/model';
  let sync: Sync;
  let view: SharedState | null = null;
  let status = 'offline';
  let pending: Pending[] = [];
  let connected = false;
  let ready = false;
  let lang: Language = 'en';
  let tab: 'history' | 'list' | 'edit' = 'list';
  let shopping = false;
  let layoutId = '';
  let arrange = false;
  let layoutsOpen = false;
  let addOpen = false;
  let finishConfirm = false;
  let busy = false;
  let actionsPending = 0;
  let error = '';
  let notification = '';
  let duplicate: Item | undefined;
  let newName = '';
  let newCounter = false;
  let newTags = false;
  let newTagLabels = '';
  let newLayout = '';
  let history: History[] = [];
  let scrolls: Record<string, number> = {};
  $: t = translations[lang];
  $: destinations = [
    {
      id: 'history',
      icon: HistoryIcon,
      label: t.history,
      href: resolve('/[[section]]', { section: 'history' }),
      match: 'exact',
    },
    {
      id: 'list',
      icon: ListIcon,
      label: t.list,
      href: resolve('/[[section]]', { section: undefined }),
      match: 'exact',
    },
    {
      id: 'edit',
      icon: EditIcon,
      label: t.edit,
      href: resolve('/[[section]]', { section: 'edit' }),
      match: 'exact',
    },
  ] satisfies Destination[];
  $: pathname = destinations.find(
    (destination) => destination.id === tab,
  )!.href;
  function navigate(event: MouseEvent, destination: Destination) {
    event.preventDefault();
    const section =
      destination.id === 'history' || destination.id === 'edit'
        ? destination.id
        : undefined;
    if (sync) void goto(resolve('/[[section]]', { section }), { reset: false });
  }
  afterNavigate(({ from, to }) => {
    if (!from || !ready || !sync) return;
    const section = to?.params?.section;
    const next = section === 'history' || section === 'edit' ? section : 'list';
    if (next !== tab) void switchTab(next);
  });
  $: displayStatus =
    status === 'synced' && (busy || actionsPending > 0) ? 'saving' : status;
  $: layout = view?.layouts.find((l) => l.id === layoutId) || view?.layouts[0];
  $: ordered =
    layout?.order
      .map((id) => view?.items.find((i) => i.id === id))
      .filter((i): i is Item => !!i) || [];
  $: visible = shopping
    ? ordered.filter((i) => i.needed && !i.purchased)
    : ordered;
  $: cart = ordered.filter((i) => i.needed && i.purchased);
  $: needed = view?.items.filter((i) => i.needed).length || 0;
  $: canEdit = connected && status !== 'attention' && !busy;
  $: conflict = pending.find((p) => p.problem);
  $: duplicateConflict =
    conflict?.problem?.code === 'duplicate'
      ? view?.items.find((i) => i.id === conflict.problem?.itemId)
      : undefined;
  $: removed =
    !!conflict?.item && !view?.items.some((i) => i.id === conflict?.op.itemId);
  $: fieldLabel = conflict?.op.field
    ? (
        {
          count: t.fieldCount,
          selectedTags: t.fieldTags,
          needed: t.fieldNeeded,
          purchased: t.fieldPurchased,
          name: t.fieldName,
          counter: t.fieldCounter,
          showTags: t.fieldShowTags,
          tags: t.tagLabels,
        } as Record<string, string>
      )[conflict.op.field] || conflict.op.field
    : t.fieldOrder;
  function key() {
    return `${tab}:${shopping}:${layoutId}`;
  }
  function prefs() {
    localStorage.setItem(
      'shopping-preferences',
      JSON.stringify({ lang, tab, shopping, layoutId, scrolls }),
    );
  }
  function scrollSave() {
    scrolls[key()] = window.scrollY;
    prefs();
  }
  async function switchTab(next: typeof tab) {
    scrollSave();
    tab = next;
    finishConfirm = false;
    error = '';
    addOpen = false;
    prefs();
    if (next === 'history') history = await sync.history();
    await tick();
    window.scrollTo(0, scrolls[key()] || 0);
  }
  async function switchMode() {
    scrollSave();
    shopping = !shopping;
    finishConfirm = false;
    addOpen = false;
    prefs();
    await tick();
    window.scrollTo(0, scrolls[key()] || 0);
  }
  async function chooseLayout(id: string) {
    scrollSave();
    layoutId = id;
    prefs();
    await tick();
    window.scrollTo(0, scrolls[key()] || 0);
  }
  onMount(() => {
    let stop = () => {};
    let disposed = false;
    try {
      const p = JSON.parse(
        localStorage.getItem('shopping-preferences') || '{}',
      );
      lang = p.lang === 'de' ? 'de' : 'en';
      tab = ['history', 'edit', 'list'].includes(p.tab) ? p.tab : 'list';
      shopping = !!p.shopping;
      layoutId = p.layoutId || '';
      scrolls = p.scrolls || {};
    } catch {
      /* start with defaults */
    }
    const section = page.params.section;
    if (section === 'history' || section === 'edit') tab = section;
    document.documentElement.lang = lang;
    void (async () => {
      try {
        sync = new Sync(await openPersistence());
        sync.onChange = () => {
          const y = window.scrollY;
          view = sync.view;
          status = sync.status;
          pending = sync.pending;
          connected = sync.connected;
          if (!view?.layouts.some((l) => l.id === layoutId))
            layoutId = view?.layouts[0]?.id || '';
          void tick().then(() => window.scrollTo(0, y));
        };
        sync.onNeeded = (names) => {
          if (shopping)
            notification = `${translations[lang].notification}: ${names.join(', ')}`;
        };
        await sync.init();
        ready = true;
        if (!disposed) stop = sync.start();
        if (tab === 'history') history = await sync.history();
        await tick();
        window.scrollTo(0, scrolls[key()] || 0);
      } catch {
        error = t.storage;
        ready = true;
      }
    })();
    const save = () => scrollSave();
    window.addEventListener('pagehide', save);
    return () => {
      disposed = true;
      stop();
      window.removeEventListener('pagehide', save);
    };
  });
  async function write(
    values:
      | Omit<Operation, 'id' | 'tripId'>
      | ((current: SharedState) => Omit<Operation, 'id' | 'tripId'>),
    onlineOnly = false,
  ) {
    actionsPending++;
    try {
      error = '';
      if (onlineOnly) {
        await sync.reconcile();
        if (!sync.connected || sync.pending.length) {
          error = t.connectRequired;
          return false;
        }
      }
      try {
        const tripId = view!.tripId;
        await sync.enqueue((current) => ({
          id: newID(),
          tripId,
          ...(typeof values === 'function' ? values(current) : values),
        }));
        await sync.reconcile();
        return true;
      } catch {
        error = t.storage;
        return false;
      }
    } finally {
      actionsPending--;
    }
  }
  async function change(
    item: Item,
    field: string,
    update: unknown | ((value: unknown) => unknown),
  ) {
    await write((current) => {
      const latest = current.items.find((i) => i.id === item.id) || item;
      const base = latest[field as keyof Item];
      return {
        kind: 'trip_set',
        itemId: item.id,
        field,
        base,
        value: typeof update === 'function' ? update(base) : update,
      };
    });
  }
  async function addItem(reusable: boolean) {
    const name = normalize(newName);
    if (!name) return;
    duplicate = view?.items.find(
      (i) => normalize(i.name).toLocaleLowerCase() === name.toLocaleLowerCase(),
    );
    if (duplicate) return;
    const labels = newTagLabels.split(/[,\s]+/).filter(Boolean);
    if (labels.some((tag) => !/^[a-zA-Z0-9]{1,3}$/.test(tag))) {
      error = t.invalidTags;
      return;
    }
    busy = true;
    if (
      await write(
        {
          kind: 'item_add',
          itemId: newID(),
          name,
          reusable,
          counter: newCounter,
          showTags: newTags,
          tags: [...new Set(labels)].sort(),
        },
        reusable,
      )
    ) {
      newName = '';
      newCounter = false;
      newTags = false;
      newTagLabels = '';
      addOpen = false;
    }
    busy = false;
  }
  async function useExisting() {
    if (!duplicate) return;
    const i = duplicate;
    duplicate = undefined;
    newName = '';
    addOpen = false;
    await change(
      i,
      i.counter ? 'count' : 'needed',
      i.counter ? Math.max(i.count, 1) : true,
    );
  }
  async function edit(item: Item, field: string, value: unknown) {
    if (item[field as keyof Item] === value) return;
    await write(
      {
        kind: 'item_edit',
        itemId: item.id,
        field,
        base: item[field as keyof Item],
        value,
      },
      true,
    );
  }
  async function deleteItem(item: Item) {
    await write({ kind: 'item_delete', itemId: item.id, base: item }, true);
  }
  async function reorder(from: string, to: string) {
    if (!layout || from === to) return;
    const order = [...layout.order];
    const start = order.indexOf(from);
    const end = order.indexOf(to);
    if (start < 0 || end < 0) return;
    order.splice(start, 1);
    order.splice(end, 0, from);
    await write({
      kind: 'layout_order',
      layoutId: layout.id,
      base: layout.order,
      value: order,
    });
  }
  async function move(item: Item, delta: number) {
    const list = shopping ? visible : ordered;
    const n = list.findIndex((i) => i.id === item.id);
    const other = list[n + delta];
    if (other) await reorder(item.id, other.id);
  }
  async function finish() {
    if (!finishConfirm) {
      finishConfirm = true;
      return;
    }
    busy = true;
    error = '';
    try {
      await sync.finish();
      finishConfirm = false;
      shopping = false;
      notification = t.completed;
      prefs();
    } catch {
      error = t.syncRequired;
    }
    busy = false;
  }
  async function resolveConflict(choice: 'mine' | 'server') {
    if (conflict?.op.kind === 'finish') finishConfirm = false;
    error = '';
    try {
      await sync.resolve(choice);
      await sync.reconcile();
    } catch {
      error = removed ? t.removed : t.reviewFinish;
    }
  }
  function showValue(value: unknown): string {
    if (Array.isArray(value))
      return (
        value
          .map((v) => view?.items.find((i) => i.id === v)?.name || String(v))
          .join(' → ') || '—'
      );
    if (typeof value === 'boolean') return value ? '✓' : '—';
    return value === undefined ? '—' : String(value);
  }
  function currentValue() {
    if (!conflict) return undefined;
    if (conflict.problem?.current !== undefined)
      return conflict.problem.current;
    if (conflict.op.kind === 'layout_order')
      return view?.layouts.find((l) => l.id === conflict.op.layoutId)?.order;
    return conflict.op.field
      ? view?.items.find((i) => i.id === conflict.op.itemId)?.[
          conflict.op.field as keyof Item
        ]
      : undefined;
  }
</script>

<svelte:head
  ><title>{t.brand} - Tendstead</title><meta
    name="description"
    content={t.subtitle}
  /></svelte:head
>
<div class="shopping-shell">
  <AppShell
    brand={t.brand}
    appLabel="Tendstead"
    pageTitle={t.brand}
    {pathname}
    {destinations}
    mobilePrimaryIds={['history', 'list', 'edit']}
    onNavigate={navigate}
  >
    {#snippet pageActions()}
      <label class="language"
        ><span class="sr-only">{t.language}</span><select
          aria-label={t.language}
          value={lang}
          on:change={(e) => {
            lang = e.currentTarget.value as Language;
            document.documentElement.lang = lang;
            prefs();
          }}
          ><option value="en">EN</option><option value="de">DE</option></select
        ></label
      >
    {/snippet}
    <div class="app">
      <div class="status-line">
        <span data-testid="sync-status" class="status {displayStatus}"
          ><i></i>{displayStatus === 'synced'
            ? t.synced
            : displayStatus === 'saving'
              ? t.saving
              : displayStatus === 'attention'
                ? t.attention
                : `${t.offline} · ${pending.length} ${t.pending}`}</span
        >{#if status === 'offline' && ready}<button
            class="text-button"
            on:click={() => sync?.reconcile()}>{t.retry}</button
          >{/if}
      </div>
      {#if notification}<div
          class="notice"
          data-testid="notification"
          role="status"
        >
          <span>{notification}</span><button
            class="icon-button"
            aria-label={t.done}
            on:click={() => (notification = '')}>×</button
          >
        </div>{/if}
      {#if error}<div class="error" role="alert">{error}</div>{/if}
      {#if conflict}<section class="conflict" aria-label={t.conflict}>
          <h2>{t.conflict}</h2>
          <p>{conflict.label} · {fieldLabel}</p>
          {#if conflict.problem?.code === 'late_trip'}<p>
              {t.late}
            </p>{:else if conflict.problem?.code === 'invalid_controls'}<p>
              {t.updatedControls}
            </p>{/if}
          <div class="choices">
            <div>
              <small>{t.current}</small>
              <p>{showValue(currentValue())}</p>
            </div>
            <div>
              <small>{t.mine}</small>
              <p>{showValue(conflict.op.value ?? conflict.op.name)}</p>
            </div>
          </div>
          <div class="actions">
            <button class="secondary" on:click={() => resolveConflict('server')}
              >{t.keepCurrent}</button
            >{#if duplicateConflict}<button
                class="primary"
                disabled={!connected}
                on:click={async () => {
                  try {
                    await sync.useDuplicate();
                    await sync.reconcile();
                  } catch {
                    error = t.storage;
                  }
                }}>{t.use} {duplicateConflict.name}</button
              >{:else if conflict.op.kind !== 'finish' && !removed}<button
                class="primary"
                disabled={!connected}
                on:click={() => resolveConflict('mine')}>{t.keepMine}</button
              >{:else if removed}<button
                class="primary"
                disabled={!connected}
                on:click={async () => {
                  try {
                    await sync.restoreRemoved();
                    await sync.reconcile();
                  } catch {
                    error = t.storage;
                  }
                }}>{t.restore}</button
              >{/if}
          </div>
        </section>{/if}
      {#if !ready}<p class="empty">{t.loading}</p>{:else if !view}<div
          class="empty"
        >
          <h2 class="page-heading">{t.noSnapshot}</h2>
        </div>{:else if tab === 'list'}
        <section class="hero">
          <p class="eyebrow">{t.list} · {needed} {t.neededSummary}</p>
          <h2 class="page-heading">{shopping ? t.shopping : t.prepare}</h2>
          <p>{shopping ? t.shoppingHint : t.prepareHint}</p>
          <div class="actions">
            <button
              aria-label={shopping ? t.back : t.go}
              class={shopping ? 'secondary' : 'primary'}
              on:click={switchMode}
              >{shopping ? '← ' + t.back : t.go + ' →'}</button
            >{#if shopping}<button
                class="primary"
                disabled={busy ||
                  (finishConfirm &&
                    (status === 'attention' || status === 'offline'))}
                on:click={finish}>{t.finish}</button
              >{/if}
          </div>
        </section>
        {#if finishConfirm}<div class="finish-info" role="status">
            <p>{t.finishInfo}</p>
            <button class="text-button" on:click={() => (finishConfirm = false)}
              >{t.cancel}</button
            >
          </div>{/if}
        <div class="list-toolbar">
          <label class="layout"
            ><span>{t.layout}</span><select
              aria-label={t.layout}
              value={layout?.id}
              on:change={(e) => chooseLayout(e.currentTarget.value)}
              >{#each view.layouts as l (l.id)}<option value={l.id}
                  >{l.name}</option
                >{/each}</select
            ></label
          ><button
            class="text-button"
            aria-pressed={arrange}
            on:click={() => (arrange = !arrange)}
            >{arrange ? t.done : t.arrange}</button
          >
        </div>
        {#if visible.length}<ul class="items">
            {#each visible as item (item.id)}<ItemRow
                {item}
                {shopping}
                {lang}
                {arrange}
                canUp={visible[0].id !== item.id}
                canDown={visible[visible.length - 1].id !== item.id}
                change={(field, value) => change(item, field, value)}
                move={(delta) => move(item, delta)}
                drop={reorder}
              />{/each}
          </ul>{:else}<div class="empty">
            <span class="empty-icon" aria-hidden="true"
              >{shopping ? '✓' : '＋'}</span
            >
            <h2>{shopping ? t.nothingNeeded : t.empty}</h2>
            <p>{shopping ? t.nothingHint : t.emptyHint}</p>
            {#if !shopping}<button
                class="secondary"
                on:click={() =>
                  goto(resolve('/[[section]]', { section: 'edit' }), {
                    reset: false,
                  })}>{t.edit}</button
              >{/if}
          </div>{/if}
        {#if shopping && cart.length}<details class="cart">
            <summary>{t.inCart} · {cart.length}</summary>
            <ul class="items">
              {#each cart as item (item.id)}<ItemRow
                  {item}
                  {shopping}
                  {lang}
                  arrange={false}
                  change={(field, value) => change(item, field, value)}
                  move={() => {}}
                  drop={reorder}
                />{/each}
            </ul>
          </details>{/if}
        <button
          aria-label={addOpen ? t.cancel : t.addOne}
          class="add-one secondary"
          on:click={() => {
            addOpen = !addOpen;
            duplicate = undefined;
          }}>{addOpen ? t.cancel : '+ ' + t.addOne}</button
        >
        {#if addOpen}<form
            class="panel"
            on:submit|preventDefault={() => addItem(false)}
          >
            <label
              >{t.name}<input
                aria-label={t.name}
                bind:value={newName}
                maxlength="240"
                required
                autocomplete="off"
              /></label
            ><Checkbox
              checked={newCounter}
              label={t.counter}
              onChange={(v) => (newCounter = v)}
            /><Checkbox
              checked={newTags}
              label={t.personTags}
              onChange={(v) => (newTags = v)}
            />{#if newTags}<label
                >{t.tagLabels}<input
                  aria-label={t.tagLabels}
                  bind:value={newTagLabels}
                  autocomplete="off"
                /></label
              ><small>{t.tagHint}</small>{/if}<button
              class="primary"
              disabled={busy}>{t.add}</button
            >{#if duplicate}<div role="status">
                <p>{t.duplicate}</p>
                <button type="button" class="secondary" on:click={useExisting}
                  >{t.use} {duplicate.name}</button
                >
              </div>{/if}
          </form>{/if}
      {:else if tab === 'edit'}
        <section class="hero">
          <p class="eyebrow">{t.edit}</p>
          <h2 class="page-heading">{t.editTitle}</h2>
          <p>{t.editHint}</p>
        </section>
        {#if !canEdit}<p class="finish-info">{t.connectRequired}</p>{/if}
        <form class="panel" on:submit|preventDefault={() => addItem(true)}>
          <label
            >{t.name}<input
              aria-label={t.name}
              bind:value={newName}
              disabled={!canEdit}
              maxlength="240"
              required
              autocomplete="off"
            /></label
          ><Checkbox
            checked={newCounter}
            disabled={!canEdit}
            label={t.counter}
            onChange={(v) => (newCounter = v)}
          /><Checkbox
            checked={newTags}
            disabled={!canEdit}
            label={t.personTags}
            onChange={(v) => (newTags = v)}
          />{#if newTags}<label
              >{t.tagLabels}<input
                aria-label={t.tagLabels}
                bind:value={newTagLabels}
                disabled={!canEdit}
                autocomplete="off"
              /></label
            ><small>{t.tagHint}</small>{/if}<button
            class="primary"
            disabled={!canEdit}>{t.add}</button
          >{#if duplicate}<div role="status">
              <p>{t.duplicate}</p>
              <button type="button" class="secondary" on:click={useExisting}
                >{t.use} {duplicate.name}</button
              >
            </div>{/if}
        </form>
        <div class="edit-items">
          {#each view.items as item (item.id)}<section class="panel edit-item">
              <label
                >{t.name}<input
                  aria-label={`${t.rename} ${item.name}`}
                  value={item.name}
                  disabled={!canEdit}
                  maxlength="240"
                  on:blur={(e) => edit(item, 'name', e.currentTarget.value)}
                  on:keydown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                  }}
                /></label
              ><Checkbox
                checked={item.counter}
                disabled={!canEdit}
                label={`${t.counter} ${t.for} ${item.name}`}
                onChange={(v) => edit(item, 'counter', v)}
              /><Checkbox
                checked={item.showTags}
                disabled={!canEdit}
                label={`${t.personTags} ${t.for} ${item.name}`}
                onChange={(v) => edit(item, 'showTags', v)}
              />{#if item.showTags}<label
                  >{t.tagLabels}<input
                    aria-label={`${t.tagLabels} ${t.for} ${item.name}`}
                    value={item.tags.join(' ')}
                    disabled={!canEdit}
                    on:blur={(e) =>
                      edit(
                        item,
                        'tags',
                        e.currentTarget.value
                          .split(/[,\s]+/)
                          .filter(Boolean)
                          .sort(),
                      )}
                  /></label
                >{/if}
              <div class="edit-foot">
                {#if !item.reusable}<small>{t.oneTime}</small>{/if}<button
                  class="danger text-button"
                  disabled={!canEdit}
                  aria-label={`${t.delete} ${item.name}`}
                  on:click={() => deleteItem(item)}>{t.delete}</button
                >
              </div>
            </section>{/each}
        </div>
        <button
          class="secondary wide"
          aria-expanded={layoutsOpen}
          on:click={() => (layoutsOpen = !layoutsOpen)}
          >{t.manageLayouts}</button
        >{#if layoutsOpen}<section class="panel layouts">
            <form
              on:submit|preventDefault={async () => {
                if (
                  await write(
                    { kind: 'layout_add', layoutId: newID(), name: newLayout },
                    true,
                  )
                )
                  newLayout = '';
              }}
            >
              <label
                >{t.newLayout}<input
                  aria-label={t.layoutName}
                  bind:value={newLayout}
                  disabled={!canEdit}
                  required
                  maxlength="240"
                /></label
              ><button class="primary" disabled={!canEdit}
                >{t.createLayout}</button
              >
            </form>
            {#each view.layouts as l (l.id)}<div class="layout-edit">
                <input
                  aria-label={`${t.renameLayout} ${l.name}`}
                  value={l.name}
                  disabled={!canEdit}
                  on:blur={(e) => {
                    if (e.currentTarget.value !== l.name)
                      void write(
                        {
                          kind: 'layout_rename',
                          layoutId: l.id,
                          name: e.currentTarget.value,
                          base: l.name,
                        },
                        true,
                      );
                  }}
                /><button
                  class="text-button danger"
                  aria-label={`${t.deleteLayout} ${l.name}`}
                  disabled={!canEdit || view.layouts.length === 1}
                  on:click={() =>
                    write(
                      { kind: 'layout_delete', layoutId: l.id, base: l },
                      true,
                    )}>{t.delete}</button
                >
              </div>{/each}
          </section>{/if}
      {:else}
        <section class="hero">
          <p class="eyebrow">{t.history}</p>
          <h2 class="page-heading">{t.historyTitle}</h2>
          <p>{t.historyHint}</p>
        </section>
        {#if history.length === 0}<div class="empty">
            <span class="empty-icon" aria-hidden="true">↗</span>
            <h2>{t.historyEmpty}</h2>
            <p>{t.historyEmptyHint}</p>
          </div>{/if}
        {#each history as trip (trip.id)}<article class="panel history">
            <h2>
              {new Date(trip.completedAt).toLocaleString(
                lang === 'de' ? 'de-DE' : 'en-GB',
                { dateStyle: 'medium', timeStyle: 'short' },
              )}
            </h2>
            <ul>
              {#each trip.items as item (item.name)}<li>
                  <span
                    >{#if item.counter}<b>{item.count} ×</b>
                    {/if}<span>{item.name}</span
                    >{#if item.selectedTags.length}<small
                        >{item.selectedTags.join(' · ')}</small
                      >{/if}</span
                  ><span class:carried={item.carriedOver} class="history-status"
                    >{item.purchased
                      ? '✓ ' + t.purchased
                      : '↗ ' + t.carried}</span
                  >
                </li>{/each}
            </ul>
          </article>{/each}
      {/if}
    </div>
  </AppShell>
</div>

<style>
  /* UI 0.1.0 has a fixed decorative letter mark and no brand-image prop. */
  .shopping-shell :global(.ts-brand-mark) {
    border: 0;
    font-size: 0;
    background: url('/shopping-list-mark.svg') center / 52px 52px no-repeat;
  }
  .shopping-shell :global(.ts-page-heading) {
    display: flex;
    flex-direction: column;
  }
  .shopping-shell :global(.ts-page-heading .ts-eyebrow) {
    order: 1;
    margin: 4px 0 0;
  }

  .shopping-shell :global(.ts-nav-link > svg) {
    display: none;
  }
  /* All three destinations are already in the mobile bar; no overflow menu. */
  .shopping-shell :global(.ts-menu-trigger) {
    display: none;
  }
  @media (max-width: 767px) {
    .shopping-shell :global(.ts-mobile-bar .ts-nav-link > svg) {
      display: block;
    }
    .shopping-shell :global(.ts-mobile-bar .ts-nav-link) {
      justify-content: center;
    }
    .shopping-shell :global(.ts-mobile-bar .ts-nav-label) {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      padding: 0;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  }

  :global(*) {
    box-sizing: border-box;
  }
  :global(body) {
    margin: 0;
    background: var(--ts-surface-subtle, #f9f9fb);
    color: var(--ts-text, #27242d);
    font-family:
      Inter,
      ui-sans-serif,
      system-ui,
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      sans-serif;
    line-height: 1.5;
  }
  :global(button),
  :global(input),
  :global(select) {
    font: inherit;
  }
  :global(button) {
    scroll-margin-top: 90px;
    scroll-margin-bottom: 120px;
    cursor: pointer;
  }
  :global(button:disabled) {
    cursor: default;
    opacity: 0.45;
  }
  :global(button:focus-visible),
  :global(input:focus-visible),
  :global(select:focus-visible),
  :global(summary:focus-visible) {
    outline: 3px solid var(--ts-focus, #6750a4);
    outline-offset: 3px;
  }
  :global(input),
  :global(select) {
    color: var(--ts-text, #27242d);
  }
  :global(html) {
    scroll-behavior: auto;
  }
  :global(.sr-only) {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  .app {
    max-width: 780px;
    margin: auto;
    color: var(--ts-text, #27242d);
  }
  .language select {
    border: 1px solid var(--ts-border, #dedbe4);
    border-radius: 10px;
    background: transparent;
    padding: 8px;
    min-height: 44px;
  }
  .status-line {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    min-height: 38px;
  }
  .status {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-size: 12px;
    color: var(--ts-primary, #6750a4);
  }
  .status i {
    height: 7px;
    width: 7px;
    border-radius: 50%;
    background: var(--ts-primary, #6750a4);
  }
  .offline {
    color: var(--ts-muted, #625e6b);
  }
  .offline i {
    background: var(--ts-muted, #625e6b);
  }
  .saving {
    color: #977424;
  }
  .saving i,
  .attention i {
    background: #c7953d;
  }
  .attention {
    color: #925620;
  }
  .hero {
    padding: 26px 0 24px;
  }
  .eyebrow {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--ts-muted, #625e6b);
    font-weight: 650;
    margin: 0 0 12px;
  }
  .page-heading {
    font-family: Georgia, 'Times New Roman', serif;
    font-weight: 400;
    font-size: clamp(30px, 7vw, 42px);
    letter-spacing: -0.035em;
    line-height: 1.12;
    margin: 0 0 12px;
    max-width: 580px;
  }
  .hero > p:not(.eyebrow) {
    font-size: 14px;
    color: var(--ts-muted, #625e6b);
    margin: 0 0 20px;
  }
  h2 {
    font-size: 18px;
    font-weight: 650;
    margin: 0 0 8px;
  }
  .actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .primary,
  .secondary {
    border-radius: 12px;
    padding: 11px 18px;
    min-height: 46px;
    border: 1px solid var(--ts-primary, #6750a4);
    font-weight: 600;
    font-size: 14px;
  }
  .primary {
    background: var(--ts-primary, #6750a4);
    color: var(--ts-on-primary, #fff);
  }
  .secondary {
    background: var(--ts-surface, #fff);
    color: var(--ts-primary, #6750a4);
    border-color: var(--ts-border, #dedbe4);
  }
  .text-button {
    border: 0;
    background: transparent;
    color: var(--ts-primary, #6750a4);
    padding: 10px 5px;
    font-size: 13px;
    font-weight: 600;
    min-height: 44px;
  }
  .icon-button {
    border: 0;
    background: transparent;
    font-size: 22px;
    color: inherit;
    min-height: 44px;
    min-width: 44px;
  }
  .list-toolbar {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    margin: 0 0 14px;
    padding-top: 4px;
    gap: 10px;
  }
  .layout {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .layout > span {
    font-size: 12px;
    color: var(--ts-muted, #625e6b);
  }
  .layout select {
    max-width: 200px;
    min-height: 44px;
    border: 0;
    border-bottom: 1px solid var(--ts-border, #dedbe4);
    background: transparent;
    font-weight: 650;
    font-size: 14px;
    padding: 6px;
  }
  .items {
    padding: 0;
    margin: 0;
    background: var(--ts-surface, #fff);
    border: 1px solid var(--ts-border, #dedbe4);
    border-radius: 16px;
    overflow: hidden;
    overflow-anchor: none;
  }
  .items :global(li:last-child) {
    border-bottom: 0;
  }
  .empty {
    text-align: center;
    padding: 36px 16px 40px;
    color: var(--ts-muted, #625e6b);
  }
  .empty h2 {
    color: var(--ts-text, #27242d);
    font-size: 20px;
  }
  .empty p {
    font-size: 14px;
    max-width: 300px;
    margin: 8px auto 18px;
  }
  .empty-icon {
    display: block;
    font-size: 40px;
    line-height: 1;
    padding-bottom: 18px;
    color: var(--ts-primary, #6750a4);
  }
  .empty .page-heading {
    font-size: 26px;
  }
  .add-one {
    margin-top: 18px;
    width: 100%;
    border-style: dashed;
    background: transparent;
  }
  .cart {
    margin-top: 22px;
  }
  .cart summary {
    padding: 12px 4px;
    min-height: 44px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 650;
    color: var(--ts-muted, #625e6b);
  }
  .cart .items {
    margin-top: 8px;
  }
  .panel {
    border: 1px solid var(--ts-border, #dedbe4);
    background: var(--ts-surface, #fff);
    padding: 18px;
    border-radius: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 18px 0;
  }
  .panel label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--ts-muted, #625e6b);
  }
  input {
    border: 1px solid var(--ts-border, #dedbe4);
    border-radius: 10px;
    background: var(--ts-surface, #fff);
    padding: 10px 12px;
    min-height: 46px;
    font-size: 16px;
    min-width: 0;
    width: 100%;
  }
  .panel small {
    color: var(--ts-muted, #625e6b);
    font-size: 12px;
  }
  .panel .primary {
    align-self: flex-start;
  }
  .notice,
  .finish-info,
  .error {
    border: 1px solid var(--ts-border, #dedbe4);
    border-radius: 12px;
    background: var(--ts-selection, #e9e2f5);
    padding: 12px 14px;
    font-size: 13px;
    margin: 12px 0;
  }
  .notice {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding-top: 4px;
    padding-bottom: 4px;
  }
  .error {
    background: #fbefdf;
    border-color: #ebceab;
    color: #824d28;
  }
  .finish-info p {
    margin: 0;
  }
  .conflict {
    background: #fff1db;
    border: 1px solid #e7c58f;
    border-radius: 16px;
    padding: 18px;
    margin: 18px 0;
    color: #67431b;
  }
  .conflict p {
    font-size: 13px;
  }
  .choices {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-bottom: 14px;
  }
  .choices > div {
    padding: 10px;
    background: #fffaf0;
    border-radius: 10px;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .choices small {
    font-size: 11px;
  }
  .choices p {
    font-weight: 600;
    margin-bottom: 0;
  }
  .edit-foot {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 8px;
  }
  .edit-foot small {
    margin-right: auto;
  }
  .danger {
    color: #a05838;
  }
  .wide {
    width: 100%;
    margin-top: 14px;
  }
  .layouts form {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .layout-edit {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .history h2 {
    font-size: 15px;
    font-weight: 600;
  }
  .history ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .history li {
    padding: 10px 0;
    border-top: 1px solid var(--ts-border, #dedbe4);
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-size: 14px;
    overflow-wrap: anywhere;
  }
  .history li > span:first-child {
    min-width: 0;
  }
  .history li small {
    display: block;
  }
  .history-status {
    font-size: 11px;
    color: var(--ts-primary, #6750a4);
    align-self: center;
    flex-shrink: 0;
  }
  .history-status.carried {
    color: #a17932;
  }
  @media (min-width: 650px) {
    .hero {
      padding-top: 34px;
    }
    .edit-items {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
    }
    .edit-items .panel {
      margin: 0;
    }
    .edit-items {
      margin-bottom: 20px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    * {
      scroll-behavior: auto;
    }
  }
</style>
