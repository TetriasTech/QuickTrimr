import { expect, test } from '@playwright/test';

test('isolated seed page sorts/filters/paginates on the fixture server, then exercises safe confirmation and responsive UI', async ({
  page,
  request,
}) => {
  // Crafted transport inputs must reject without crashing the fixture server.
  for (const body of [
    'null',
    '[]',
    '{',
    '{"reason":"   "}',
    '{"reason":"x","amount":4500}',
  ]) {
    const response = await request.post('/api/confirm', {
      data: body,
      headers: { 'content-type': 'application/json' },
    });
    expect(response.status()).toBe(422);
    expect(await response.json()).toEqual({});
  }
  expect(
    (await request.post('/api/confirm', { data: 'x'.repeat(1025) })).status(),
  ).toBe(413);
  const responses: {
    url: URL;
    body: {
      rows: { id: string; status: string; gross_cents: number }[];
      rowCount: number;
    };
  }[] = [];
  const errors: string[] = [],
    requests: string[] = [];
  const secondPage = Promise.withResolvers<void>();
  let holdSecondPage = true;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => requests.push(request.url()));
  await page.route('**/api/bookings?**', async (route) => {
    // Read the ACTUAL fixture-server response before browser delivery/abort, not
    // asynchronously after a later query cancels its network resource.
    const response = await route.fetch();
    const url = new URL(route.request().url());
    expect(response.status()).toBe(200);
    responses.push({ url, body: await response.json() });
    // Hold delivery of an ACTUAL server page to prove old rows disappear while
    // the new controlled query is loading. Do not mock/replace its payload.
    if (holdSecondPage && url.searchParams.get('page') === '1')
      await secondPage.promise;
    await route.fulfill({ response });
  });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Component workspace' }),
  ).toBeVisible();
  await expect(
    page.getByText('Account: fixture-admin — not signed in'),
  ).toBeVisible();
  await expect(page.getByRole('row')).toHaveCount(6);
  const firstIds = await page.locator('tbody tr').allTextContents();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('Loading bookings…')).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Next', exact: true }),
  ).toBeDisabled();
  holdSecondPage = false;
  secondPage.resolve();
  await expect(page.getByText('Page 2 of 5 · 24 records')).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(5);
  expect(await page.locator('tbody tr').allTextContents()).not.toEqual(
    firstIds,
  );
  await page.getByRole('button', { name: /Status/ }).click();
  await expect(page.getByText('Page 1 of 5 · 24 records')).toBeVisible();
  await expect(
    page.getByRole('columnheader', { name: /Status/ }),
  ).toHaveAttribute('aria-sort', 'ascending');
  await page
    .getByLabel('Booking status')
    .selectOption('accepted_pending_payment');
  await expect(page.getByText('Page 1 of 1 · 2 records')).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await expect(
    page.getByRole('button', { name: 'Next', exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: 'test-results/fixtures/admin-components-desktop.png',
    fullPage: true,
  });
  await page.getByLabel('Booking status').selectOption('no_matches');
  await expect(page.getByText('No records', { exact: true })).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  await page.getByLabel('Booking status').selectOption('');
  await expect(page.locator('tbody tr')).toHaveCount(5);
  const opener = page.getByRole('button', { name: 'Open confirmation' });
  await opener.click();
  const dialog = page.getByRole('dialog');
  const reason = dialog.getByRole('textbox');
  await expect(reason).toBeFocused();
  await expect(
    dialog.getByRole('button', { name: 'Confirm', exact: true }),
  ).toBeDisabled();
  await reason.fill('   ');
  await expect(
    dialog.getByRole('button', { name: 'Confirm', exact: true }),
  ).toBeDisabled();
  await reason.fill('Synthetic correction reason');
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(
    dialog.getByRole('button', { name: 'Confirm', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(reason).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(
    dialog.getByRole('button', { name: 'Confirm', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(reason).toBeFocused();
  await page.screenshot({
    path: 'test-results/fixtures/admin-confirmation.png',
    fullPage: true,
  });
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  await expect(dialog.getByRole('alert')).toHaveText(
    'Could not confirm. Please try again.',
  );
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByText('Fixture confirmed. No financial action performed.'),
  ).toBeVisible();
  await expect(opener).toBeFocused();
  await opener.click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(opener).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'test-results/fixtures/admin-components-narrow.png',
    fullPage: true,
  });
  expect(errors).toEqual([]);
  expect(responses.length).toBeGreaterThanOrEqual(6);
  expect(responses.some((r) => r.url.searchParams.get('page') === '1')).toBe(
    true,
  );
  expect(
    responses.some((r) => r.url.searchParams.get('sort') === 'status'),
  ).toBe(true);
  for (const response of responses) {
    expect(response.body.rows.length).toBeLessThanOrEqual(5);
    for (const row of response.body.rows)
      expect(Object.keys(row).sort()).toEqual(['gross_cents', 'id', 'status']);
    const sort = response.url.searchParams.get('sort') as
      'id' | 'status' | 'gross_cents';
    const direction = response.url.searchParams.get('direction');
    expect(response.body.rows).toEqual(
      [...response.body.rows].sort((a, b) => {
        const compare =
          typeof a[sort] === 'number'
            ? Number(a[sort]) - Number(b[sort])
            : String(a[sort]).localeCompare(String(b[sort]));
        return (
          (direction === 'desc' ? -compare : compare) ||
          a.id.localeCompare(b.id)
        );
      }),
    );
    const status = response.url.searchParams.get('status');
    if (status)
      expect(response.body.rows.every((row) => row.status === status)).toBe(
        true,
      );
  }
  for (const url of requests)
    expect(new URL(url).origin).toBe('http://127.0.0.1:3101');
});
