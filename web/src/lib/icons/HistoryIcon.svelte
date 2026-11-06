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
  <path d="M3 11a9 9 0 1 1 2.7 7" /><path d="M3 4v7h7M12 7v5l3 2" />
</svg>
