import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadProfile } from '../src/features/session/load-profile.ts';

const userId = '60499711-52d4-46c7-beb1-6d2c46937ed5';

function setup(sessionUser = userId) {
  const calls = [];
  const supabase = {
    from() {
      return this;
    },
    select() {
      return this;
    },
    eq() {
      return this;
    },
    abortSignal() {
      return this;
    },
    async maybeSingle() {
      calls.push('role lookup');
      return { data: { role: 'barber' }, error: null };
    },
    auth: {
      async getSession() {
        calls.push('current session');
        return {
          data: {
            session: {
              access_token: 'mock-refreshed-token',
              user: {
                id: sessionUser,
                user_metadata: { signup_role: 'admin' },
              },
            },
          },
          error: null,
        };
      },
    },
    functions: {
      async invoke(name, options) {
        calls.push(name);
        assert.equal(
          options.headers.Authorization,
          'Bearer mock-refreshed-token',
        );
        assert.deepEqual(JSON.parse(options.body), { role: 'barber' });
        return {
          data: {
            id: userId,
            role: 'barber',
            verificationStatus: 'not_started',
            onboardingComplete: true,
            createdAt: '2026-11-17T03:30:00Z',
          },
          error: null,
        };
      },
    },
  };
  return { calls, supabase };
}

test('profile sync uses the current token and stored role after the initial role lookup', async () => {
  const { calls, supabase } = setup();
  const profile = await loadProfile(
    supabase,
    userId,
    new AbortController().signal,
  );
  assert.deepEqual(profile, { role: 'barber', onboardingComplete: true });
  assert.deepEqual(calls, [
    'role lookup',
    'current session',
    'create-or-sync-profile',
  ]);
});

test('profile sync stops if the session changes during the role lookup', async () => {
  const { calls, supabase } = setup('replaced');
  await assert.rejects(
    loadProfile(supabase, userId, new AbortController().signal),
    /Session changed/,
  );
  assert.deepEqual(calls, ['role lookup', 'current session']);
});
