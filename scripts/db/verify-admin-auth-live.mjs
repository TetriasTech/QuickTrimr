import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { apiJson, assertRawBody } from './api-test-helpers.mjs';
import { localStatus } from './local-api.mjs';

const status = localStatus();
const origin = 'http://127.0.0.1:3102';
const adminRoot = resolve(import.meta.dirname, '../../apps/admin');
const adminRequire = createRequire(resolve(adminRoot, 'package.json'));
const { chromium } = adminRequire('@playwright/test');
const { createServerClient } = adminRequire('@supabase/ssr');
const unsafeBody =
  /data-admin-shell|fixture-admin|No operational screens yet|Account:|"(?:client_address|payment_intent_id|booking_status_history)"/;

async function fixture(role) {
  const email = `admin-flow-${randomUUID()}@example.invalid`;
  const password = `Local-fixture-${randomUUID()}`;
  const created = await apiJson(
    status,
    '/auth/v1/admin/users',
    status.SERVICE_ROLE_KEY,
    {
      method: 'POST',
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { role: 'admin' },
        app_metadata: { role: 'admin' },
      }),
    },
  );
  assert.equal(created.status, 200, 'Disposable local Auth user');
  const id = created.body.id;
  assert.match(id, /^[0-9a-f-]{36}$/);
  const profile = await apiJson(
    status,
    '/rest/v1/profiles',
    status.SERVICE_ROLE_KEY,
    {
      method: 'POST',
      body: JSON.stringify({ id, role, verification_status: 'not_started' }),
    },
  );
  assert.equal(profile.status, 201, 'Disposable local role');
  return { id, email, password };
}

async function providerLogin({ email, password }) {
  const jar = new Map();
  const provider = createServerClient(status.API_URL, status.ANON_KEY, {
    cookieOptions: { name: 'quicktrimr-admin-auth' },
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) =>
        cookies.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const { data, error } = await provider.auth.signInWithPassword({
    email,
    password,
  });
  assert.ok(
    !error && data.session,
    'Provider verified the disposable account.',
  );
  return {
    provider,
    token: data.session.access_token,
    cookie: () =>
      [...jar].map(([name, value]) => `${name}=${value}`).join('; '),
  };
}

const rpc = (token, p_operation) =>
  apiJson(status, '/rest/v1/rpc/admin_dashboard_session', token, {
    method: 'POST',
    body: JSON.stringify({ p_operation }),
  });

async function audit(actorId) {
  const result = await apiJson(
    status,
    `/rest/v1/audit_logs?actor_id=eq.${actorId}&entity_type=eq.admin_session&select=actor_role,action,entity_id`,
    status.SERVICE_ROLE_KEY,
  );
  assert.equal(result.status, 200, 'Read local audit evidence');
  for (const row of result.body) {
    assert.equal(row.actor_role, 'admin');
    assert.match(row.entity_id, /^[0-9a-f-]{36}$/);
  }
  return result.body;
}

async function assertDenied(cookie, expected, redirect) {
  for (const rsc of [false, true]) {
    const response = await fetch(origin + (rsc ? '/?_rsc' : '/'), {
      redirect: 'manual',
      signal: AbortSignal.timeout(7000),
      headers: { ...(cookie ? { cookie } : {}), ...(rsc ? { RSC: '1' } : {}) },
    });
    const body = await response.text();
    assert.equal(
      response.status,
      expected,
      `${rsc ? 'RSC' : 'HTML'} guard status`,
    );
    assert.ok(
      !unsafeBody.test(body),
      'Denied response contains protected data.',
    );
    assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    if (redirect) {
      const target = new URL(response.headers.get('location'), origin);
      assert.equal(target.pathname + target.search, redirect);
    }
  }
}

function localSql(command, params = []) {
  return execFileSync(
    'docker',
    [
      'exec',
      '-i',
      'supabase_db_quicktrimr',
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-XAtq',
      '-v',
      'ON_ERROR_STOP=1',
      ...params,
    ],
    { input: command, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] },
  ).trim();
}

const nextPath = resolve(adminRoot, 'node_modules/next/dist/bin/next');
const env = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
};
// Build with the fixed local target so an earlier build's inlined hosted URL
// cannot receive disposable sign-in attempts.
execFileSync(process.execPath, [nextPath, 'build', '--webpack'], {
  cwd: adminRoot,
  env,
  stdio: ['ignore', 'ignore', 'inherit'],
});
const server = spawn(
  process.execPath,
  [nextPath, 'start', '--hostname', '127.0.0.1', '--port', '3102'],
  {
    cwd: adminRoot,
    env,
    stdio: ['ignore', 'ignore', 'inherit'],
  },
);
let browser;
try {
  let ready = false;
  for (
    let attempt = 0;
    attempt < 30 && !ready && server.exitCode === null;
    attempt++
  ) {
    ready = await fetch(origin + '/login', {
      redirect: 'error',
      signal: AbortSignal.timeout(2000),
    }).then(
      (response) => response.ok,
      () => false,
    );
    if (!ready) await delay(200);
  }
  assert.ok(
    ready && server.exitCode === null,
    'Start the built local admin app.',
  );
  await assertDenied('', 302, '/login');
  await assertDenied(
    'quicktrimr-admin-auth=invalid',
    302,
    '/login?reason=expired',
  );
  assert.equal(
    localSql(
      `select value from private.platform_config where key = 'admin_session_hours';`,
    ),
    '8',
  );
  const anon = await rpc(undefined, 'open');
  assert.ok(
    [401, 403, 404].includes(anon.status),
    'Anonymous cannot call the RPC.',
  );
  assert.equal(
    localSql(
      `select relrowsecurity from pg_class where oid = 'private.platform_config'::regclass;`,
    ),
    't',
  );
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.equal(
      localSql(
        `select has_table_privilege(:'role', 'private.platform_config', 'SELECT,INSERT,UPDATE,DELETE');`,
        ['-v', `role=${role}`],
      ),
      'f',
    );
  }

  const [client, barber, admin] = await Promise.all(
    ['client', 'barber', 'admin'].map(fixture),
  );
  for (const account of [client, barber]) {
    const session = await providerLogin(account);
    await assertDenied(session.cookie(), 403);
    for (const operation of ['open', 'check', 'close']) {
      const result = await rpc(session.token, operation);
      assert.equal(result.status, 200);
      assertRawBody(
        result.body,
        { status: 'forbidden' },
        'Database denies non-admin with signed admin metadata.',
      );
    }
    const config = await apiJson(
      status,
      '/rest/v1/platform_config?select=key',
      session.token,
    );
    assert.ok(
      [403, 404].includes(config.status),
      'Private config is inaccessible via PostgREST.',
    );
    assertRawBody(
      await audit(account.id),
      [],
      'Denied accounts leave no session audit entry.',
    );
  }

  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(origin + '/login');
  async function signIn(email, password) {
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  }
  await signIn(client.email, client.password);
  await page
    .getByText('Sign-in failed. Check your credentials and try again.', {
      exact: true,
    })
    .waitFor();
  await page.reload();
  await signIn(`absent-${randomUUID()}@example.invalid`, client.password);
  await page
    .getByText('Sign-in failed. Check your credentials and try again.', {
      exact: true,
    })
    .waitFor();
  await page.reload();
  await signIn(admin.email, admin.password);
  await page.waitForURL(origin + '/');
  await page.getByText(`Account: ${admin.id}`, { exact: true }).waitFor();
  const cookies = (await page.context().cookies()).filter((cookie) =>
    cookie.name.startsWith('quicktrimr-admin-auth'),
  );
  assert.ok(
    cookies.length &&
      cookies.every(
        (cookie) =>
          cookie.httpOnly && cookie.secure && cookie.sameSite === 'Lax',
      ),
    'Admin cookies are HttpOnly, Secure and SameSite=Lax.',
  );
  const signedIn = await audit(admin.id);
  assert.equal(signedIn.length, 1);
  assert.equal(signedIn[0].action, 'admin.sign_in');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL(origin + '/login');
  assert.equal(
    (await page.context().cookies()).filter((cookie) =>
      cookie.name.startsWith('quicktrimr-admin-auth'),
    ).length,
    0,
  );
  const signedOut = await audit(admin.id);
  assertRawBody(
    signedOut.map((row) => row.action).sort(),
    ['admin.sign_in', 'admin.sign_out'],
    'Logout is audited once.',
  );
  assert.ok(signedOut.every((row) => row.entity_id === signedIn[0].entity_id));
  for (const browserCookie of [
    '',
    cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; '),
  ]) {
    await assertDenied(
      browserCookie,
      302,
      browserCookie ? '/login?reason=expired' : '/login',
    );
  }

  for (let round = 0; round < 3; round++) {
    const session = await providerLogin(admin);
    await assertDenied(session.cookie(), 403);
    const opened = await Promise.all(
      Array.from({ length: 6 }, () => rpc(session.token, 'open')),
    );
    for (const result of opened)
      assertRawBody(
        result.body,
        { status: 'active', userId: admin.id },
        'Concurrent open',
      );
    const closed = await Promise.all(
      Array.from({ length: 6 }, () => rpc(session.token, 'close')),
    );
    for (const result of closed)
      assertRawBody(result.body, { status: 'expired' }, 'Concurrent close');
    assertRawBody(
      (await rpc(session.token, 'open')).body,
      { status: 'expired' },
      'Closed session cannot reopen',
    );
  }
  const actions = (await audit(admin.id)).map((row) => row.action);
  assert.equal(
    actions.filter((action) => action === 'admin.sign_in').length,
    4,
  );
  assert.equal(
    actions.filter((action) => action === 'admin.sign_out').length,
    4,
  );

  const ageing = await providerLogin(admin);
  assertRawBody(
    (await rpc(ageing.token, 'open')).body,
    { status: 'active', userId: admin.id },
    'Fresh admin session',
  );
  const records = await audit(admin.id);
  const closedIds = new Set(
    records
      .filter((row) => row.action === 'admin.sign_out')
      .map((row) => row.entity_id),
  );
  const openRows = records.filter(
    (row) => row.action === 'admin.sign_in' && !closedIds.has(row.entity_id),
  );
  assert.equal(openRows.length, 1);
  const sessionId = openRows[0].entity_id;
  const age = (padding) =>
    localSql(
      `update auth.sessions set created_at = clock_timestamp() - make_interval(hours => (select value::int from private.platform_config where key = 'admin_session_hours')) + :'padding'::interval where id = :'id'::uuid and user_id = :'user'::uuid returning 'aged';`,
      [
        '-v',
        `padding=${padding}`,
        '-v',
        `id=${sessionId}`,
        '-v',
        `user=${admin.id}`,
      ],
    );
  assert.equal(age('1 minute'), 'aged');
  const before = await fetch(origin + '/', {
    redirect: 'manual',
    headers: { cookie: ageing.cookie() },
  });
  assert.equal(before.status, 200, 'Session works before its deadline.');
  assert.equal(age('0 seconds'), 'aged');
  assert.ok(
    !(await ageing.provider.auth.refreshSession()).error,
    'Auth still refreshes the same provider session.',
  );
  await assertDenied(ageing.cookie(), 302, '/login?reason=expired');
  const newSignIn = await providerLogin(admin);
  assertRawBody(
    (await rpc(newSignIn.token, 'open')).body,
    { status: 'active', userId: admin.id },
    'Fresh sign-in restores access.',
  );
  const roleChange = await apiJson(
    status,
    `/rest/v1/profiles?id=eq.${admin.id}&select=id`,
    status.SERVICE_ROLE_KEY,
    { method: 'PATCH', body: JSON.stringify({ role: 'client' }) },
  );
  assert.equal(roleChange.status, 200);
  assert.equal(roleChange.body.length, 1);
  await assertDenied(newSignIn.cookie(), 403);

  console.log(
    'Admin Auth passed: browser sign-in and sign-out, raw HTML and RSC denials, signed metadata ignored, current database role, audited concurrent opens/closes, and expiry after token refresh.',
  );
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
