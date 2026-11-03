<script lang="ts">
  import Checkbox from './Checkbox.svelte';
  import { translations, type Language } from './i18n';
  import type { Item } from './model';
  export let item: Item;
  export let shopping = false;
  export let lang: Language = 'en';
  export let arrange = false;
  export let canUp = true;
  export let canDown = true;
  export let change: (field: string, value: unknown) => void;
  export let move: (delta: number) => void;
  export let drop: (from: string, to: string) => void;
  $: t = translations[lang];
  let pointerStart: { x: number; y: number } | null = null;
  let target = '';
  let dragging = false;
  function pointerDown(e: PointerEvent) {
    if (e.pointerType === 'mouse') return;
    pointerStart = { x: e.clientX, y: e.clientY };
    target = item.id;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function pointerMove(e: PointerEvent) {
    if (!pointerStart) return;
    if (Math.abs(e.clientY - pointerStart.y) > 8) dragging = true;
    const element = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLElement>('[data-item-id]');
    if (element) target = element.dataset.itemId || item.id;
  }
  function pointerUp() {
    if (pointerStart && dragging && target !== item.id) drop(item.id, target);
    pointerStart = null;
    dragging = false;
  }
</script>

<li
  class:purchased={shopping && item.purchased}
  class:dragging
  data-item-id={item.id}
  data-testid={`item-${item.name}`}
  on:dragover|preventDefault
  on:drop|preventDefault={(e) =>
    drop(e.dataTransfer?.getData('text/plain') || '', item.id)}
>
  <div class="main-row">
    {#if shopping}<Checkbox
        compact
        checked={item.purchased}
        label={`${t.inCart}: ${item.name}`}
        onChange={(value) => change('purchased', value)}
      />{:else if !item.counter}<Checkbox
        compact
        checked={item.needed}
        label={`${t.needed}: ${item.name}`}
        onChange={(value) => change('needed', value)}
      />{/if}
    <div class="name">
      <span>{item.name}</span>{#if !item.reusable}<small>{t.oneTime}</small
        >{/if}
      {#if item.showTags}<div class="tags">
          {#each item.tags as tag (tag)}<button
              type="button"
              class:selected={item.selectedTags.includes(tag)}
              aria-pressed={item.selectedTags.includes(tag)}
              aria-label={`${t.tag} ${tag} ${t.for} ${item.name}`}
              on:click={() =>
                change('selectedTags', (current: unknown) => {
                  const selected = current as string[];
                  return selected.includes(tag)
                    ? selected.filter((v) => v !== tag)
                    : [...selected, tag].sort();
                })}>{tag}</button
            >{/each}
        </div>{/if}
    </div>
    {#if item.counter}<div class="counter">
        <button
          type="button"
          disabled={item.count === 0}
          aria-label={`${t.decrease} ${item.name}`}
          on:click={() =>
            change('count', (current: unknown) =>
              Math.max(0, Number(current) - 1),
            )}>−</button
        ><output aria-label={`${t.count} ${item.name}`}>{item.count}</output
        ><button
          type="button"
          aria-label={`${t.increase} ${item.name}`}
          on:click={() =>
            change('count', (current: unknown) => Number(current) + 1)}
          >+</button
        >
      </div>{/if}
  </div>
  {#if arrange}<div class="order">
      <button
        type="button"
        class="handle"
        draggable="true"
        aria-label={`${t.move} ${item.name}`}
        on:dragstart={(e) => e.dataTransfer?.setData('text/plain', item.id)}
        on:pointerdown={pointerDown}
        on:pointermove={pointerMove}
        on:pointerup={pointerUp}
        on:pointercancel={() => {
          pointerStart = null;
          dragging = false;
        }}>⠿</button
      ><button
        type="button"
        disabled={!canUp}
        aria-label={`${t.move} ${item.name} ${t.up}`}
        on:click={() => move(-1)}>↑</button
      ><button
        type="button"
        disabled={!canDown}
        aria-label={`${t.move} ${item.name} ${t.down}`}
        on:click={() => move(1)}>↓</button
      >
    </div>{/if}
</li>

<style>
  li {
    list-style: none;
    padding: 14px 12px;
    border-bottom: 1px solid #e9e9df;
    scroll-margin: 100px;
  }
  .main-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .name {
    flex: 1;
    min-width: 0;
    font-size: 16px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .name > small {
    display: block;
    margin-top: 3px;
    font-weight: 400;
    font-size: 11px;
    color: #69786b;
    text-transform: uppercase;
    letter-spacing: 0.07em;
  }
  .counter {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }
  .counter button {
    height: 46px;
    width: 42px;
    font-size: 24px;
    border: 1px solid #d8e3d9;
    border-radius: 12px;
    background: #eef3ed;
    color: #245c45;
  }
  .counter output {
    min-width: 28px;
    text-align: center;
    font-size: 18px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .tags {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-left: 8px;
    vertical-align: middle;
  }
  .tags button {
    border: 1px solid #d6ddcd;
    min-width: 36px;
    min-height: 44px;
    border-radius: 10px;
    font-size: 12px;
    font-weight: 700;
    background: #fffdf7;
    color: #677763;
    padding: 4px 7px;
  }
  .tags .selected {
    background: #245c45;
    color: white;
    border-color: #245c45;
  }
  .purchased .name > span {
    text-decoration: line-through;
    color: #788479;
  }
  .purchased {
    background: #f5f7f0;
  }
  .order {
    display: flex;
    justify-content: flex-end;
    gap: 4px;
    padding-top: 6px;
  }
  .order button {
    background: #f1f2e9;
    border: 0;
    border-radius: 8px;
    min-height: 44px;
    min-width: 44px;
    color: #536b59;
    font-size: 18px;
  }
  .handle {
    touch-action: none;
  }
  .dragging {
    background: #e3eddf;
  }
</style>
