// Real mobile API boundary against the fixed local stack and customer sandbox.
// Provider payloads, bearer links and credentials are never printed.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

import {
  apiJson,
  assertRawBody,
} from '../../../scripts/db/api-test-helpers.mjs';
import { localStatus } from '../../../scripts/db/local-api.mjs';
import { connectApi } from '../src/features/connect/connect-api.ts';
import { runConnectOnboarding } from '../src/features/connect/connect-flow.ts';

const local = localStatus();
const users = [];
const signal = new AbortController().signal;
const clients = [];

async function makeUser(role) {
  const email = `connect-mobile-${randomUUID()}@example.invalid`;
  const password = `Fixture-${randomUUID()}!`;
  const created = await apiJson(
    local,
    '/auth/v1/admin/users',
    local.SERVICE_ROLE_KEY,
    {
      method: 'POST',
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { signup_role: role },
      }),
    },
  );
  assert.equal(created.status, 200, 'Local fixture creation');
  const userId = created.body.id;
  users.push(userId);
  const supabase = createClient(local.API_URL, local.ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  clients.push(supabase);
  const login = await supabase.auth.signInWithPassword({ email, password });
  assert.ok(
    !login.error && login.data.session,
    'Local fixture login; payload suppressed.',
  );
  const synced = await apiJson(
    local,
    '/functions/v1/create-or-sync-profile',
    login.data.session.access_token,
    { method: 'POST', body: JSON.stringify({ role }) },
  );
  assert.equal(synced.status, 200, 'Profile sync');
  return {
    api: connectApi(supabase, userId),
    supabase,
    userId,
    email,
    password,
  };
}

try {
  const barber = await makeUser('barber');
  const client = await makeUser('client');
  await assert.rejects(client.api.refresh(signal), { status: 403 });
  await assert.rejects(client.api.createLink(signal), { status: 403 });
  const unlinked = await barber.api.refresh(signal);
  assertRawBody(
    unlinked,
    {
      accountStatus: 'not_started',
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
    },
    'Unlinked mobile status',
  );
  let opens = 0;
  const links = new Set();
  let current;
  const flow = {
    signal,
    callbackUrl: 'quicktrimr://connect',
    createLink: () => barber.api.createLink(signal),
    async refresh() {
      current = await barber.api.refresh(signal);
      return current;
    },
    async openBrowser(url) {
      assert.ok(
        new URL(url).hostname.endsWith('.stripe.com'),
        'Hosted Stripe URL',
      );
      assert.ok(!links.has(url), 'Resume received a fresh provider link.');
      links.add(url);
      opens++;
      // Notification only: no browser or onboarding submission occurs in this API check.
      return opens === 1
        ? { type: 'cancel' }
        : {
            type: 'success',
            url: 'quicktrimr://connect?action=return&status=verified',
          };
    },
  };
  await runConnectOnboarding(flow);
  assert.equal(
    current.accountStatus,
    'pending',
    'Abandonment remains pending.',
  );
  await runConnectOnboarding(flow);
  assert.equal(
    current.accountStatus,
    'pending',
    'Return without completion remains pending.',
  );
  assert.equal(links.size, 2, 'Fresh link per attempt.');
  const {
    data: { session },
  } = await barber.supabase.auth.getSession();
  assert.ok(session, 'Active fixture session');
  await barber.supabase.auth.signOut();
  await assert.rejects(barber.api.refresh(signal), /Session changed/);
  console.log(
    JSON.stringify({
      check: 'P1-T08 mobile API + Stripe sandbox',
      unlinked: true,
      abandonmentPending: true,
      returnWithoutCompletionPending: true,
      freshLinks: links.size,
      clientDenied: true,
      signedOutDenied: true,
      browserExercised: false,
    }),
  );
} finally {
  await Promise.all(clients.map((client) => client.auth.signOut()));
  for (const userId of users) {
    // Soft deletion retains immutable audit attribution and removes fixture login access.
    const deleted = await apiJson(
      local,
      `/auth/v1/admin/users/${userId}`,
      local.SERVICE_ROLE_KEY,
      { method: 'DELETE', body: JSON.stringify({ should_soft_delete: true }) },
    );
    assert.equal(deleted.status, 200, 'Local fixture cleanup');
  }
}
