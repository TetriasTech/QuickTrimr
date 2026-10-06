import assert from 'node:assert/strict';
import test from 'node:test';

import { getRouteAccess } from '../src/features/session/route-access.ts';

test('signed-out sessions can access only the auth group', () => {
  assert.deepEqual(getRouteAccess({ status: 'signed-out' }), {
    auth: true,
    onboarding: false,
    client: false,
    barber: false,
    modals: false,
  });
});

test('incomplete authenticated sessions can access only onboarding', () => {
  for (const role of ['client', 'barber']) {
    assert.deepEqual(
      getRouteAccess({ status: 'signed-in', role, onboardingComplete: false }),
      {
        auth: false,
        onboarding: true,
        client: false,
        barber: false,
        modals: false,
      },
    );
  }
});

test('complete client sessions reach the client journey and shared modals', () => {
  assert.deepEqual(
    getRouteAccess({
      status: 'signed-in',
      role: 'client',
      onboardingComplete: true,
    }),
    {
      auth: false,
      onboarding: false,
      client: true,
      barber: false,
      modals: true,
    },
  );
});

test('complete barber sessions reach the barber journey and shared modals', () => {
  assert.deepEqual(
    getRouteAccess({
      status: 'signed-in',
      role: 'barber',
      onboardingComplete: true,
    }),
    {
      auth: false,
      onboarding: false,
      client: false,
      barber: true,
      modals: true,
    },
  );
});
