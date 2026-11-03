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
  <path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15l-1 6Z" />
</svg>
