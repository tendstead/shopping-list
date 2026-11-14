import { test, expect, type Page } from '@playwright/test';
import { writeFile, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
async function origin(phase: 'offline' | 'online') {
  const dir = process.env.ORIGIN_CONTROL_DIR;
  if (!dir)
    throw new Error('Run through make e2e for real origin disconnection');
  await writeFile(join(dir, 'request.tmp'), phase);
  await rename(join(dir, 'request.tmp'), join(dir, 'request'));
  await expect
    .poll(
      async () =>
        readFile(join(dir, 'ack'), 'utf8')
          .then((v) => v.trim())
          .catch(() => ''),
      { timeout: 15000 },
    )
    .toBe(phase);
}
import type { SharedState, Operation, Pending } from '../src/lib/model';
// Every network fault test lets the real API commit before dropping/delaying its response.
async function state(page: Page): Promise<SharedState> {
  return (await page.request.get('/api/state')).json();
}
async function mutate(
  page: Page,
  values: Omit<Operation, 'id' | 'tripId'>,
  url = '/api/operations',
) {
  const current = await state(page);
  const response = await page.request.post(url, {
    data: { id: crypto.randomUUID(), tripId: current.tripId, ...values },
  });
  expect(response.ok()).toBe(true);
  return response.json();
}
async function seed(page: Page, name: string) {
  const id = crypto.randomUUID();
  await mutate(
    page,
    {
      kind: 'item_add',
      itemId: id,
      name,
      reusable: true,
      counter: true,
      showTags: true,
      tags: ['A', 'B'],
    },
    '/api/items',
  );
  return id;
}
const unique = (s: string) =>
  `${s} ${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
const synced = (page: Page) =>
  expect(page.getByTestId('sync-status')).toHaveText('Synced');
test('secure shell reopens offline and retains pending changes through reload', async ({
  page,
}) => {
  const name = unique('Offline');
  const spiceID = await seed(page, name);
  const current = await state(page);
  const assigned = await page.request.patch(`/api/items/${spiceID}`, {
    data: {
      id: crypto.randomUUID(),
      tripId: current.tripId,
      kind: 'item_edit',
      itemId: spiceID,
      field: 'category',
      base: '',
      value: 'spices',
    },
  });
  expect(assigned.ok()).toBe(true);
  await page.goto('/');
  await synced(page);
  expect(await page.evaluate(() => isSecureContext)).toBe(true);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await synced(page);
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  test.setTimeout(60000);
  try {
    await origin('offline');
    await page
      .getByRole('button', { name: `Increase ${name}`, exact: true })
      .click();
    await expect(page.getByTestId('sync-status')).toContainText('pending', {
      timeout: 12000,
    });
    await page
      .getByRole('button', { name: 'Go shopping', exact: true })
      .click();
    await page.locator('[data-category="spices"] .category-header').click();
    await page
      .getByRole('checkbox', { name: `In cart: ${name}`, exact: true })
      .click();
    await page.reload({ timeout: 15000 });
    await page.getByText(/In cart ·/).click();
    await expect(
      page.getByLabel(`Count for ${name}`, { exact: true }),
    ).toHaveText('1');
    await expect(page.getByTestId('sync-status')).toContainText('2 pending');
  } finally {
    await origin('online');
  }

  await synced(page);
  expect((await state(page)).items.find((i) => i.id === spiceID)).toMatchObject(
    { category: 'spices', purchased: true },
  );
});
test.describe('network response faults', () => {
  test.use({ serviceWorkers: 'block' });
  test('lost response after commit retries the original operation and converges', async ({
    page,
  }) => {
    const name = unique('Lost response');
    const id = await seed(page, name);
    await page.goto('/');
    await synced(page);
    const ids: string[] = [];
    let first = true;
    await page.route('**/api/operations', async (route) => {
      const op = route.request().postDataJSON() as Operation;
      if (op.itemId !== id) {
        await route.continue();
        return;
      }
      ids.push(op.id);
      if (first) {
        first = false;
        await route.fetch();
        await route.abort('failed');
      } else await route.continue();
    });
    await page
      .getByRole('button', { name: `Increase ${name}`, exact: true })
      .click();
    await synced(page);
    await expect.poll(() => ids.length).toBeGreaterThanOrEqual(2);
    expect(new Set(ids).size).toBe(1);
    expect((await state(page)).items.find((i) => i.id === id)?.count).toBe(1);
  });
  test('timed-out acknowledged response is retained and safely retried', async ({
    page,
  }) => {
    const name = unique('Timeout');
    const id = await seed(page, name);
    await page.goto('/');
    await synced(page);
    let first = true;
    const ids: string[] = [];
    await page.route('**/api/operations', async (route) => {
      const op = route.request().postDataJSON() as Operation;
      if (op.itemId !== id) {
        await route.continue();
        return;
      }
      ids.push(op.id);
      if (first) {
        first = false;
        const response = await route.fetch();
        await new Promise((r) => setTimeout(r, 9000));
        await route.fulfill({ response }).catch(() => {});
      } else await route.continue();
    });
    await page
      .getByRole('button', { name: `Increase ${name}`, exact: true })
      .click();
    await expect(page.getByTestId('sync-status')).toContainText('1 pending', {
      timeout: 10000,
    });
    await synced(page);
    expect(new Set(ids).size).toBe(1);
    expect((await state(page)).items.find((i) => i.id === id)?.count).toBe(1);
  });
});
test('independent counter and tag changes merge after reconnection', async ({
  browser,
  page,
}) => {
  const name = unique('Independent');
  const id = await seed(page, name);
  await page.goto('/');
  await synced(page);
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const second = await context.newPage();
  await second.goto('/');
  await synced(second);
  await page.context().setOffline(true);
  await page
    .getByRole('button', { name: `Increase ${name}`, exact: true })
    .click();
  await expect(page.getByTestId('sync-status')).toContainText('pending');
  await second
    .getByRole('button', { name: `Tag A for ${name}`, exact: true })
    .click();
  await synced(second);
  await page.context().setOffline(false);
  await synced(page);
  const item = (await state(page)).items.find((i) => i.id === id);
  expect(item?.count).toBe(1);
  expect(item?.selectedTags).toEqual(['A']);
  await context.close();
});
test('late change is explicitly reviewed after another phone completes; history stays unchanged', async ({
  page,
}) => {
  const name = unique('Late');
  const id = await seed(page, name);
  await page.goto('/');
  await synced(page);
  await page.context().setOffline(true);
  await page
    .getByRole('button', { name: `Increase ${name}`, exact: true })
    .click();
  await expect(page.getByTestId('sync-status')).toContainText('pending');
  const current = await state(page);
  const result = await mutate(
    page,
    { kind: 'finish', revision: current.revision },
    '/api/finish',
  );
  const finished = result.history.id;
  await page.context().setOffline(false);
  await expect(page.getByTestId('sync-status')).toHaveText('Needs attention');
  await expect(
    page.getByText('This trip has already finished.', { exact: false }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Keep my change', exact: true })
    .click();
  await synced(page);
  expect((await state(page)).items.find((i) => i.id === id)?.count).toBe(1);
  const snapshot = await (
    await page.request.get(`/api/history/${finished}`)
  ).json();
  expect(snapshot.items.some((i: { name: string }) => i.name === name)).toBe(
    false,
  );
});
test('competing layout orders present both results for explicit selection', async ({
  browser,
  page,
}) => {
  const a = unique('Order A'),
    b = unique('Order B');
  await seed(page, a);
  await seed(page, b);
  await page.goto('/');
  await synced(page);
  await page.getByRole('button', { name: 'Arrange', exact: true }).click();
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const second = await context.newPage();
  await second.goto('/');
  await synced(second);
  await second.getByRole('button', { name: 'Arrange', exact: true }).click();
  await page.context().setOffline(true);
  await page.getByRole('button', { name: `Move ${a} up`, exact: true }).click();
  await expect(page.getByTestId('sync-status')).toContainText('pending');
  await second
    .getByRole('button', { name: `Move ${b} up`, exact: true })
    .click();
  await synced(second);
  const shared = (await state(second)).layouts[0].order;
  await page.context().setOffline(false);
  await expect(page.getByTestId('sync-status')).toHaveText('Needs attention');
  await expect(
    page.getByText('My pending change', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Keep shared value', exact: true })
    .click();
  await synced(page);
  expect((await state(page)).layouts[0].order).toEqual(shared);
  await context.close();
});

test('rapid counter taps and multiple tag selections retain every local intent', async ({
  page,
}) => {
  const name = unique('Rapid');
  await seed(page, name);
  await page.goto('/');
  await synced(page);
  await page.context().setOffline(true);
  await page.evaluate((name) => {
    const click = (label: string) =>
      (
        document.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement
      ).click();
    for (let n = 0; n < 3; n++) click(`Increase ${name}`);
    click(`Tag A for ${name}`);
    click(`Tag B for ${name}`);
  }, name);
  await expect(
    page.getByLabel(`Count for ${name}`, { exact: true }),
  ).toHaveText('3');
  await expect(page.getByTestId('sync-status')).toContainText('5 pending');
  await page.context().setOffline(false);
  await synced(page);
  const item = (await state(page)).items.find((i) => i.name === name);
  expect(item?.count).toBe(3);
  expect(item?.selectedTags).toEqual(['A', 'B']);
});

test('duplicate discovered on reconnection selects the existing shared item', async ({
  page,
}) => {
  const name = unique('Duplicate race');
  await page.goto('/');
  await synced(page);
  await page.context().setOffline(true);
  await page
    .getByRole('button', { name: 'Add one-time item', exact: true })
    .click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  await expect(page.getByTestId('sync-status')).toContainText('1 pending');
  const existing = await seed(page, name);
  await page.context().setOffline(false);
  await expect(page.getByTestId('sync-status')).toHaveText('Needs attention');
  await page.getByRole('button', { name: `Use ${name}`, exact: true }).click();
  await expect(
    page.getByLabel(`Count for ${name}`, { exact: true }),
  ).toHaveText('1');
  await synced(page);
  const matches = (await state(page)).items.filter((i) => i.name === name);
  expect(matches).toHaveLength(1);
  expect(matches[0].id).toBe(existing);
  expect(matches[0].count).toBe(1);
});

test('named layout create, rename, selection and deletion', async ({
  page,
}) => {
  const name = unique('Store');
  await page.goto('/');
  await synced(page);
  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'Edit', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Manage layouts', exact: true })
    .click();
  await page.getByLabel('Layout name', { exact: true }).fill(name);
  await page
    .getByRole('button', { name: 'Create layout', exact: true })
    .click();
  await synced(page);
  await page
    .getByLabel(`Rename layout ${name}`, { exact: true })
    .fill(name + ' renamed');
  await page.getByLabel(`Rename layout ${name}`, { exact: true }).press('Tab');
  await synced(page);
  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'Shopping list', exact: true })
    .click();
  await page
    .getByLabel('Layout', { exact: true })
    .selectOption({ label: name + ' renamed' });
  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'Edit', exact: true })
    .click();
  await page
    .getByRole('button', { name: `Delete layout ${name} renamed`, exact: true })
    .click();
  await synced(page);
  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'Shopping list', exact: true })
    .click();
  expect((await state(page)).layouts.some((l) => l.name.startsWith(name))).toBe(
    false,
  );
  await expect(page.getByLabel('Layout', { exact: true })).toHaveValue(
    (await state(page)).layouts[0].id,
  );
});

test('remote updates and navigation preserve checklist scroll position', async ({
  page,
}) => {
  const name = unique('Scroll');
  const id = await seed(page, name);
  await page.goto('/');
  await synced(page);
  await page.evaluate(() => window.scrollTo(0, 300));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(300);
  await mutate(page, {
    kind: 'trip_set',
    itemId: id,
    field: 'count',
    base: 0,
    value: 1,
  });
  await expect(
    page.getByLabel(`Count for ${name}`, { exact: true }),
  ).toHaveText('1');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(300);
  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'History', exact: true })
    .click();
  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'Shopping list', exact: true })
    .click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(300);
});

test.describe('synchronization regressions', () => {
  test.use({ serviceWorkers: 'block' });

  test('a remote change during a state fetch is displayed without another user action', async ({
    page,
  }) => {
    // Observe delivery without replacing the native SSE connection or its listeners.
    await page.addInitScript(() => {
      const NativeEventSource = window.EventSource;
      window.EventSource = class extends NativeEventSource {
        constructor(url: string | URL, options?: EventSourceInit) {
          super(url, options);
          this.addEventListener('change', () => {
            const root = document.documentElement;
            root.dataset.receivedChanges = String(
              Number(root.dataset.receivedChanges || '0') + 1,
            );
          });
        }
      };
    });
    const name = unique('Refresh race');
    const id = await seed(page, name);
    await page.goto('/');
    await synced(page);
    const receivedBefore = await page.evaluate(() =>
      Number(document.documentElement.dataset.receivedChanges || '0'),
    );

    let captured!: () => void;
    const snapshotCaptured = new Promise<void>((resolve) => {
      captured = resolve;
    });
    let release!: () => void;
    const releaseSnapshot = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holdNext = true;
    await page.route('**/api/state', async (route) => {
      if (!holdNext) {
        await route.continue();
        return;
      }
      holdNext = false;
      const response = await route.fetch();
      const snapshot = (await response.json()) as SharedState;
      expect(snapshot.items.find((i) => i.id === id)?.count).toBe(0);
      captured();
      await releaseSnapshot;
      await route.fulfill({ response });
    });
    try {
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await snapshotCaptured;
      await mutate(page, {
        kind: 'trip_set',
        itemId: id,
        field: 'count',
        base: 0,
        value: 1,
      });
      // Ensure the real change event reaches the page while its older fetch is held.
      await expect
        .poll(() =>
          page.evaluate(() =>
            Number(document.documentElement.dataset.receivedChanges || '0'),
          ),
        )
        .toBeGreaterThan(receivedBefore);
      release();
      await expect(
        page.getByLabel(`Count for ${name}`, { exact: true }),
      ).toHaveText('1');
      await synced(page);
    } finally {
      release();
      await page.unroute('**/api/state');
    }
  });

  test('a failed restoration retains the removed-item edit through reload and retry', async ({
    page,
  }) => {
    const name = unique('Restore storage failure');
    const id = await seed(page, name);
    await page.goto('/');
    await synced(page);
    await page.context().setOffline(true);
    await page
      .getByRole('button', { name: `Increase ${name}`, exact: true })
      .click();
    await expect(page.getByTestId('sync-status')).toContainText('1 pending');
    const current = await state(page);
    const deletion = await page.request.delete(`/api/items/${id}`, {
      data: {
        id: crypto.randomUUID(),
        tripId: current.tripId,
        kind: 'item_delete',
        itemId: id,
        base: current.items.find((i) => i.id === id),
      },
    });
    expect(deletion.ok()).toBe(true);
    await page.context().setOffline(false);
    await expect(page.getByTestId('sync-status')).toHaveText('Needs attention');
    const restore = page.getByRole('button', {
      name: 'Add again as one-time',
      exact: true,
    });
    await expect(restore).toBeVisible();

    // Fail only the replacement write. Earlier storage writes and all reads stay real.
    // Installing this after navigation means reload removes the injected failure.
    await page.evaluate((name) => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (
        value: unknown,
        key?: IDBValidKey,
      ) {
        const session = value as { pending?: Pending[] };
        if (
          this.transaction.db.name === 'shopping-list-v1' &&
          this.name === 'data' &&
          key === 'session' &&
          session.pending?.some(
            ({ op }) => op.kind === 'item_add' && op.name === name,
          )
        ) {
          document.documentElement.dataset.storageFaultInjected = 'true';
          throw new DOMException(
            'Simulated full device storage',
            'QuotaExceededError',
          );
        }
        return put.call(this, value, key);
      };
    }, name);
    await restore.click();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.dataset.storageFaultInjected,
        ),
      )
      .toBe('true');
    await page.reload();
    // The original intent must still be available after the failed replacement.
    await expect(restore).toBeVisible();
    await restore.click();
    await expect(
      page.getByLabel(`Count for ${name}`, { exact: true }),
    ).toHaveText('1');
    await synced(page);
    const restored = (await state(page)).items.filter((i) => i.name === name);
    expect(restored).toHaveLength(1);
    expect(restored[0].reusable).toBe(false);
    expect(restored[0].count).toBe(1);
  });
});
