<script lang="ts">
  let { label, text }: { label: string; text: string } = $props();
  const id = $props.id();
  let focused = $state(false);
  let hovered = $state(false);
  let dismissed = $state(false);
  const open = $derived((focused || hovered) && !dismissed);
</script>

<span
  class="info"
  role="presentation"
  onmouseenter={() => {
    hovered = true;
    dismissed = false;
  }}
  onmouseleave={() => (hovered = false)}
>
  <button
    type="button"
    aria-label={label}
    aria-describedby={open ? id : undefined}
    onfocus={() => {
      focused = true;
      dismissed = false;
    }}
    onblur={() => (focused = false)}
    onclick={(event) => {
      event.currentTarget.focus();
      dismissed = false;
    }}
    onkeydown={(event) => {
      if (event.key === 'Escape') {
        dismissed = true;
        event.stopPropagation();
      }
    }}
  >
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
    >
      <circle cx="12" cy="12" r="9" /><path d="M12 11v6" /><path
        d="M12 7h.01"
      />
    </svg>
  </button>
  {#if open}<span {id} class="tip" role="tooltip">{text}</span>{/if}
</span>

<style>
  .info {
    position: absolute;
    top: -10px;
    right: -8px;
    width: 24px;
    height: 24px;
    z-index: 1;
  }
  .info:hover,
  .info:focus-within {
    z-index: 2;
  }
  button {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    color: var(--ts-primary, #6750a4);
    background: var(--ts-surface, #fff);
    cursor: help;
  }
  button:focus-visible {
    outline: 2px solid var(--ts-primary, #6750a4);
    outline-offset: 2px;
  }
  .tip {
    position: absolute;
    top: 100%;
    right: 0;
    width: min(280px, calc(100vw - 64px));
    padding: 12px;
    border: 1px solid var(--ts-border, #dedbe4);
    border-radius: 10px;
    background: var(--ts-surface, #fff);
    color: var(--ts-text, #24212a);
    box-shadow: 0 4px 16px #0002;
    font-size: 13px;
    font-weight: 400;
    line-height: 1.5;
    text-align: left;
  }
</style>
