import { test, expect } from '@playwright/test';
import type { SharedState, Operation } from '../src/lib/model';

test('drag handle and touch pointer ordering update only the selected layout', async ({
  page,
}) => {
  const state = async (): Promise<SharedState> =>
    (await page.request.get('/api/state')).json();
  const mutate = async (path: string, values: Partial<Operation>) => {
    const current = await state();
    const response = await page.request.post(path, {
      data: { id: crypto.randomUUID(), tripId: current.tripId, ...values },
    });
    expect(response.ok()).toBe(true);
  };
  const a = crypto.randomUUID(),
    b = crypto.randomUUID(),
    layoutId = crypto.randomUUID();
  const name = `Drag ${Date.now()}`;
  await mutate('/api/items', {
    kind: 'item_add',
    itemId: a,
    name: `${name} A`,
    reusable: true,
  });
  await mutate('/api/items', {
    kind: 'item_add',
    itemId: b,
    name: `${name} B`,
    reusable: true,
  });
  await mutate('/api/layouts', { kind: 'layout_add', layoutId, name });
  const before = await state();
  const layout = before.layouts.find((l) => l.id === layoutId)!;
  await mutate('/api/operations', {
    kind: 'layout_order',
    layoutId,
    base: layout.order,
    value: [a, b, ...layout.order.filter((id) => id !== a && id !== b)],
  });
  const unchanged = (await state()).layouts[0].order;
  await page.goto('/');
  await expect(page.getByTestId('sync-status')).toHaveText('Synced');
  await page.getByLabel('Layout', { exact: true }).selectOption(layoutId);
  await page.getByRole('button', { name: 'Arrange', exact: true }).click();
  await page
    .getByRole('button', { name: `Move ${name} A`, exact: true })
    .dragTo(page.getByTestId(`item-${name} B`));
  await expect
    .poll(async () =>
      (await state()).layouts.find((l) => l.id === layoutId)?.order.slice(0, 2),
    )
    .toEqual([b, a]);
  // Exercise the touch handler's pointer capture/move/up sequence. Real device
  // gesture delivery is a deployment-device check; synthetic events have no native pointer capture.
  await page.evaluate(
    ({ name }) => {
      const handle = document.querySelector(
        `[aria-label="Move ${name} B"]`,
      ) as HTMLElement;
      const target = document.querySelector(
        `[data-testid="item-${name} A"]`,
      ) as HTMLElement;
      const origin = handle.getBoundingClientRect(),
        destination = target.getBoundingClientRect();
      handle.setPointerCapture = () => {};
      const event = (type: string, x: number, y: number) =>
        handle.dispatchEvent(
          new PointerEvent(type, {
            pointerType: 'touch',
            pointerId: 1,
            bubbles: true,
            clientX: x,
            clientY: y,
          }),
        );
      event(
        'pointerdown',
        origin.x + origin.width / 2,
        origin.y + origin.height / 2,
      );
      event(
        'pointermove',
        destination.x + destination.width / 2,
        destination.y + destination.height / 2,
      );
      event(
        'pointerup',
        destination.x + destination.width / 2,
        destination.y + destination.height / 2,
      );
    },
    { name },
  );
  await expect
    .poll(async () =>
      (await state()).layouts.find((l) => l.id === layoutId)?.order.slice(0, 2),
    )
    .toEqual([a, b]);
  expect((await state()).layouts[0].order).toEqual(unchanged);
});
