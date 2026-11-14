<script lang="ts">
  import { categoryDefinitions, type Category } from './model';
  import { translations, type Language } from './i18n';
  export let value: Category = '';
  export let lang: Language = 'en';
  export let disabled = false;
  export let itemName = '';
  export let onChange: (value: Category) => void;
  $: t = translations[lang];
</script>

{#each categoryDefinitions as category (category.id)}
  <button
    type="button"
    class:selected={value === category.id}
    aria-pressed={value === category.id}
    aria-label={itemName
      ? `${t[category.labelKey]} ${t.for} ${itemName}`
      : t[category.labelKey]}
    {disabled}
    on:click={() => onChange(value === category.id ? '' : category.id)}
    >{t[category.labelKey]}</button
  >
{/each}

<style>
  button {
    min-height: 44px;
    padding: 8px 12px;
    border: 1px solid var(--ts-border, #dedbe4);
    border-radius: 10px;
    background: var(--ts-surface, #fff);
    color: var(--ts-primary, #6750a4);
    font: inherit;
    cursor: pointer;
  }
  button.selected {
    background: var(--ts-primary, #6750a4);
    color: var(--ts-on-primary, #fff);
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
