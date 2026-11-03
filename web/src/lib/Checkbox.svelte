<script lang="ts">
  import { createCheckbox } from '@melt-ui/svelte';
  import { writable } from 'svelte/store';
  export let checked = false;
  export let disabled = false;
  export let label: string;
  export let compact = false;
  export let onChange: (value: boolean) => void = () => {};
  const controlled = writable<boolean | 'indeterminate'>(checked);
  const {
    elements: { root },
    options,
  } = createCheckbox({
    checked: controlled,
    onCheckedChange: ({ next }) => {
      onChange(next === true);
      return next;
    },
  });
  $: controlled.set(checked);
  $: options.disabled.set(disabled);
</script>

<button
  {...$root}
  use:root
  aria-label={label}
  class:compact
  class:active={checked}
  ><span class="box" aria-hidden="true">{checked ? '✓' : ''}</span
  >{#if !compact}<span>{label}</span>{/if}</button
>

<style>
  button {
    display: inline-flex;
    align-items: center;
    gap: 0.65rem;
    background: transparent;
    border: 0;
    color: inherit;
    font: inherit;
    text-align: left;
    padding: 0.4rem 0;
    min-height: 44px;
    cursor: pointer;
  }
  .compact {
    padding: 0;
    min-width: 44px;
    justify-content: center;
  }
  .box {
    width: 24px;
    height: 24px;
    border: 1.5px solid var(--ts-muted, #625e6b);
    border-radius: 7px;
    display: grid;
    place-items: center;
    font-size: 17px;
    color: var(--ts-on-primary, #fff);
    flex-shrink: 0;
  }
  .active .box {
    background: var(--ts-primary, #6750a4);
    border-color: var(--ts-primary, #6750a4);
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
