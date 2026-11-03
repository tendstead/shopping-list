<script lang="ts">
  let {
    size = 21,
    'aria-hidden': ariaHidden = true,
  }: {
    size?: number | string;
    'aria-hidden'?: boolean | 'true' | 'false';
  } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.8"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden={ariaHidden}
>
  <path d="m3 6 1 1 2-2M9 6h12M3 12h3M9 12h12M3 18h3M9 18h12" />
</svg>
