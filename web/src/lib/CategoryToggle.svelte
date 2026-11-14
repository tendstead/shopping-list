<script lang="ts">
  import InfoTooltip from './InfoTooltip.svelte';
  import Checkbox from './Checkbox.svelte';
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
  <div class="category-option">
    <Checkbox
      boxed
      checked={value === category.id}
      label={itemName
        ? `${t[category.labelKey]} ${t.for} ${itemName}`
        : t[category.labelKey]}
      text={t[category.labelKey]}
      {disabled}
      onChange={(checked) => onChange(checked ? category.id : '')}
    />
    <InfoTooltip
      label={`${t.categoryInfo} ${t[category.labelKey]}${itemName ? ` ${t.for} ${itemName}` : ''}`}
      text={t[category.helpKey]}
    />
  </div>
{/each}

<style>
  .category-option {
    position: relative;
    display: flex;
    min-width: 0;
  }
</style>
