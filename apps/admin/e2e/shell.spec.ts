import { expect, test } from '@playwright/test';

const privateContent =
  /data-admin-shell|data-table-row|fixture-admin|No operational screens yet|private child|"(?:client_address|payment_intent_id|booking_status_history)"/;

for (const role of ['anonymous', 'client', 'barber', 'admin', 'expired']) {
  for (const rsc of [false, true]) {
    test(`raw ${rsc ? 'RSC' : 'HTML'} request denies client-supplied ${role} claims`, async ({
      request,
    }) => {
      // Include Next's canonical RSC query marker so the request reaches the guard,
      // rather than stopping at the framework's URL-normalisation redirect.
      const response = await request.get(
        `/?role=${role}${rsc ? '&_rsc' : ''}`,
        {
          maxRedirects: 0,
          headers: {
            'x-user-role': role,
            'x-middleware-subrequest':
              'middleware:middleware:middleware:middleware:middleware',
            cookie: `role=${role}; session=unverified-${role}`,
            ...(rsc ? { RSC: '1' } : {}),
          },
        },
      );
      const body = await response.text();
      expect(body).not.toMatch(privateContent);
      expect(response.status()).toBe(302);
      expect(
        new URL(response.headers().location ?? '', response.url()).pathname,
      ).toBe('/login');
      expect(response.headers()['cache-control']).toContain('no-store');
    });
  }
}

test('running dashboard renders Tailwind/shadcn and denies navigation with no operational requests', async ({
  page,
}) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/login');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Admin sign in',
  );
  const button = page.getByRole('button', { name: 'Sign in' });
  await expect(button).toHaveAttribute('data-slot', 'button');
  await expect(button).toHaveCSS('background-color', 'rgb(32, 91, 66)');
  await expect(page).toHaveURL('/login');
  await expect(page.getByText('No operational screens yet.')).toHaveCount(0);
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
  expect(errors).toEqual([]);
  for (const url of requests) {
    const parsed = new URL(url);
    expect(parsed.origin).toBe('http://127.0.0.1:3100');
    expect(parsed.pathname).toMatch(/^(?:\/|\/login|\/_next\/.*)$/);
  }
  await page.screenshot({
    path: 'test-results/admin-access-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(button).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'test-results/admin-access-narrow.png',
    fullPage: true,
  });
});
