import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

import {
  apiJson,
  assertRawBody,
} from '../../../scripts/db/api-test-helpers.mjs';
import { localStatus } from '../../../scripts/db/local-api.mjs';
import { authFailure } from '../src/features/auth/auth-errors.ts';
import { loadProfile } from '../src/features/session/load-profile.ts';
import { getRouteAccess } from '../src/features/session/route-access.ts';

const status = localStatus();
const mailpit = 'http://127.0.0.1:55324';

function client(storage) {
  return createClient(status.API_URL, status.ANON_KEY, {
    auth: {
      storage,
      persistSession: Boolean(storage),
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function expectSuccess(result, label) {
  assert.ok(!result.error, `${label} failed; provider payload suppressed.`);
  return result.data;
}

async function emailCode(email, subject) {
  const url = new URL('/api/v1/search', mailpit);
  url.searchParams.set('query', `to:${email}`);
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(3000),
  });
  assert.equal(response.status, 200, 'Mailpit search');
  const inbox = await response.json();
  const message = inbox.messages.find((mail) => mail.Subject === subject);
  assert.ok(
    message && /^[a-zA-Z0-9_-]+$/.test(message.ID),
    'Expected the QuickTrimr email in Mailpit.',
  );
  const detail = await fetch(
    new URL(`/api/v1/message/${message.ID}`, mailpit),
    { redirect: 'error', signal: AbortSignal.timeout(3000) },
  );
  assert.equal(detail.status, 200, 'Mailpit message');
  const code = (await detail.json()).HTML.match(/<strong>(\d+)<\/strong>/)?.[1];
  assert.ok(code, 'QuickTrimr email should include a code.');
  return code;
}

const credentials = {};
for (const role of ['client', 'barber']) {
  const email = `mobile-auth-${randomUUID()}@example.invalid`;
  const password = `Fixture-${randomUUID()}!`;
  credentials[role] = { email, password };
  const storage = new Map();
  const adapter = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  const first = client(adapter);
  const signup = expectSuccess(
    await first.auth.signUp({
      email,
      password,
      options: { data: { signup_role: role } },
    }),
    'Sign-up',
  );
  assert.ok(
    !signup.session,
    'Email confirmation should precede session creation.',
  );
  const confirmed = expectSuccess(
    await first.auth.verifyOtp({
      email,
      token: await emailCode(email, 'Confirm your QuickTrimr email'),
      type: 'signup',
    }),
    'Email confirmation',
  );
  assert.ok(confirmed.session, 'Confirmation should create a session.');
  const profile = await loadProfile(
    first,
    confirmed.session.user.id,
    AbortSignal.timeout(5000),
  );
  assertRawBody(
    profile,
    { role, onboardingComplete: false },
    'Profile bootstrap',
  );
  assert.equal(
    getRouteAccess({ status: 'signed-in', ...profile }).onboarding,
    true,
  );

  const resumed = client(adapter);
  const persisted = expectSuccess(
    await resumed.auth.getSession(),
    'Session reload',
  );
  assert.ok(
    persisted.session?.user.id === confirmed.session.user.id,
    'Session restored using a new client.',
  );
  const userId = confirmed.session.user.id;
  const updated = await apiJson(
    status,
    `/rest/v1/profiles?id=eq.${userId}&select=id`,
    status.SERVICE_ROLE_KEY,
    {
      method: 'PATCH',
      body: JSON.stringify({
        onboarding_completed_at: new Date().toISOString(),
      }),
    },
  );
  assert.equal(updated.status, 200, 'Synthetic completion fixture');
  assert.equal(
    updated.body.length,
    1,
    'Only the disposable profile is updated.',
  );
  const metadata = expectSuccess(
    await resumed.auth.updateUser({ data: { signup_role: 'admin' } }),
    'Update disposable metadata',
  );
  assert.equal(metadata.user.user_metadata.signup_role, 'admin');
  const complete = await loadProfile(
    resumed,
    persisted.session.user.id,
    AbortSignal.timeout(5000),
  );
  assertRawBody(
    complete,
    { role, onboardingComplete: true },
    'Server-owned route state',
  );
  assert.equal(
    getRouteAccess({ status: 'signed-in', ...complete })[role],
    true,
  );

  expectSuccess(await resumed.auth.signOut({ scope: 'local' }), 'Sign out');
  assert.equal(
    storage.size,
    0,
    'Sign-out removed the session from its supplied storage.',
  );
  expectSuccess(
    await resumed.auth.signInWithPassword({ email, password }),
    'Sign back in',
  );
  expectSuccess(
    await resumed.auth.signOut({ scope: 'local' }),
    'Sign out again',
  );
}

const { email, password } = credentials.client;
const main = client();
const wrongPassword = await main.auth.signInWithPassword({
  email,
  password: randomUUID(),
});
const missingUser = await main.auth.signInWithPassword({
  email: `unknown-${randomUUID()}@example.invalid`,
  password,
});
assert.ok(wrongPassword.error && missingUser.error, 'Both sign-ins must fail.');
assertRawBody(
  [
    wrongPassword.error.status,
    wrongPassword.error.code,
    authFailure(wrongPassword.error),
  ],
  [
    missingUser.error.status,
    missingUser.error.code,
    authFailure(missingUser.error),
  ],
  'Invalid credentials envelope',
);
assert.equal(authFailure(wrongPassword.error), 'invalid_credentials');

expectSuccess(
  await main.auth.resetPasswordForEmail(email),
  'Request a reset code',
);
const recovery = client();
const recoveryCode = await emailCode(email, 'Reset your QuickTrimr password');
const recovered = expectSuccess(
  await recovery.auth.verifyOtp({
    email,
    token: recoveryCode,
    type: 'recovery',
  }),
  'Verify reset code',
);
assert.ok(recovered.session, 'Expected an isolated recovery session.');
assert.equal(
  (await main.auth.getSession()).data.session,
  null,
  'Recovery does not sign in the main client.',
);
const newPassword = `Fixture-reset-${randomUUID()}!`;
expectSuccess(
  await recovery.auth.updateUser({ password: newPassword }),
  'Save new password',
);
expectSuccess(
  await recovery.auth.signOut({ scope: 'local' }),
  'Close recovery session',
);
const stale = await main.auth.signInWithPassword({ email, password });
assert.ok(
  stale.error && authFailure(stale.error) === 'invalid_credentials',
  'Old password rejected.',
);
expectSuccess(
  await main.auth.signInWithPassword({ email, password: newPassword }),
  'Sign in with new password',
);
expectSuccess(
  await main.auth.signOut({ scope: 'local' }),
  'Sign out the reset fixture',
);

console.log(
  'Mobile Auth passed against local Supabase: client and barber sign-up, Mailpit confirmation and recovery, profile routing, storage adapter rehydration, sign-out, and identical credential failures.',
);
