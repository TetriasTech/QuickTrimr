import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

import {
  getPublicBarberProfileResponseSchema,
  searchAvailableNowBarbersResponseSchema,
} from '../../packages/validation/src/index.ts';

import { sqlValue } from './core-fixtures.mjs';
import { discoveryResultsFixtures } from './discovery-results-fixtures.mjs';
import { queryLocal } from './verify.mjs';

assert.equal(process.argv.length, 2, 'Local proof accepts no overrides.');
const f = await discoveryResultsFixtures();
const checks = [];
const record = (message) => {
  checks.push(message);
  console.log(message + ': PASS');
};
const search = (changes = {}) =>
  f.post('/functions/v1/search-available-now-barbers', f.tokens.clientA, {
    bookingType: 'available_now',
    serviceCategoryId: f.selected.category.id,
    lat: -38.2,
    lng: 145.2,
    radiusKm: 2.5,
    ...changes,
  });
const profile = (changes = {}, token = f.tokens.clientA) =>
  f.post('/functions/v1/get-public-barber-profile', token, {
    barberId: f.users.barberA,
    serviceCategoryId: f.selected.category.id,
    ...changes,
  });
try {
  let cursor, first;
  const seen = [];
  const sizes = [];
  do {
    const r = await search(cursor ? { cursor } : {});
    assert.equal(r.status, 200);
    searchAvailableNowBarbersResponseSchema.parse(r.body);
    first ??= r.body;
    sizes.push(r.body.results.length);
    seen.push(...r.body.results.map((r) => r.barberId));
    cursor = r.body.nextCursor;
    assert.ok(sizes.length <= 3, 'Bounded traversal');
  } while (cursor);
  assert.deepEqual(sizes, [20, 20, 5]);
  assert.deepEqual(seen, f.all);
  assert.equal(new Set(seen).size, 45);
  record(
    '45 real PostGIS results traverse default 20/20/5 opaque pages in stable UUID tie order, without duplicates or gaps',
  );
  const r = await profile();
  assert.equal(r.status, 200);
  getPublicBarberProfileResponseSchema.parse(r.body);
  assert.equal(r.body.profile.services.length, 20);
  assert.equal(
    r.body.profile.services.some(
      (s) => s.serviceCategoryId === f.selected.category.id,
    ),
    false,
  );
  assert.equal(
    r.body.profile.selectedService.priceCents,
    f.selected.service.priceCents,
  );
  const card = (await search({ limit: 50 })).body.results.find(
    (r) => r.barberId === f.users.barberA,
  );
  assert.equal(card.priceCents, r.body.profile.selectedService.priceCents);
  assert.equal(
    card.approximateArea.label,
    r.body.profile.approximateArea.label,
  );
  assert.equal(card.distanceBand, 'under-2km');
  record(
    'Card and immediate profile selected-service prices match, including category 25 outside the first 20 services',
  );
  const publicKeys = [
    'barberId',
    'displayName',
    'photoUrl',
    'approximateArea',
    'rating',
    'ratingCount',
    'priceCents',
    'distanceBand',
    'availableUntil',
  ].sort();
  for (const row of first.results)
    assert.deepEqual(Object.keys(row).sort(), publicKeys);
  assert.deepEqual(
    Object.keys(r.body.profile.selectedService).sort(),
    [
      'id',
      'serviceCategoryId',
      'displayName',
      'description',
      'priceCents',
    ].sort(),
  );
  for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
    const result = await fetch(
      new URL(
        '/rest/v1/barber_profiles?id=eq.' + f.users.barberA,
        f.status.API_URL,
      ),
      {
        method,
        headers: {
          apikey: f.status.ANON_KEY,
          authorization: 'Bearer ' + f.tokens.clientA,
          'content-type': 'application/json',
          prefer: 'return=representation',
        },
        ...(['POST', 'PATCH'].includes(method)
          ? { body: JSON.stringify({ display_name: 'forged' }) }
          : {}),
      },
    );
    const body = await result.json();
    assert.equal(result.status, 403);
    assert.equal(body.code, '42501');
    assert.equal(JSON.stringify(body).includes(f.users.barberA), false);
  }
  record(
    'Strict raw public allowlists expose no private address/contact, exact distance or barber point; cross-user GET/POST/PATCH/DELETE remain denied',
  );
  for (const token of [null, f.tokens.barberA, f.tokens.admin])
    assert.equal((await profile({}, token)).status, token ? 403 : 401);
  assert.equal((await profile({ serviceCategoryId: 'bad' })).status, 422);
  for (const token of [
    null,
    f.tokens.clientA,
    f.tokens.barberA,
    f.tokens.admin,
  ])
    assert.equal(
      (
        await f.post('/rest/v1/rpc/get_public_barber_profile', token, {
          p_client_id: f.users.clientA,
          p_barber_id: f.users.barberA,
          p_after: null,
          p_service_category_id: f.selected.category.id,
        })
      ).status,
      token ? 403 : 401,
    );
  record(
    'Selected lookup checks verified caller/stored client role and UUID; four-argument RPC is denied to anon and all authenticated roles',
  );
  assert.equal(
    (
      await f.post('/functions/v1/upsert-barber-service', f.tokens.barberA, {
        serviceCategoryId: f.selected.category.id,
        priceCents: 5000,
        enabled: true,
      })
    ).status,
    200,
  );
  assert.equal((await profile()).body.profile.selectedService.priceCents, 5000);
  assert.equal(
    (await search({ limit: 50 })).body.results.find(
      (r) => r.barberId === f.users.barberA,
    ).priceCents,
    5000,
  );
  assert.equal(
    (await search({ radiusKm: 3, cursor: first.nextCursor })).status,
    422,
  );
  assert.equal((await search({ radiusKm: 3 })).status, 200);
  record(
    'Live price updates read current integer cents on both screens; a changed filter rejects old cursors and succeeds from a fresh traversal',
  );
  queryLocal(
    `update public.barber_services set archived_at=clock_timestamp() where id=${sqlValue(f.selected.service.id)}`,
  );
  assert.equal((await profile()).body.profile.selectedService, null);
  assert.equal(
    (await search({ limit: 50 })).body.results.some(
      (r) => r.barberId === f.users.barberA,
    ),
    false,
  );
  queryLocal(
    `update private.stripe_connect_accounts set payouts_enabled=false where barber_id='${f.users.barberA}'`,
  );
  assert.equal((await profile()).body.profile, null);
  record(
    'Archived selection returns null and disappears from search; loss of Connect eligibility removes the profile',
  );
  mkdirSync('docs/qa/evidence/P2-T06', { recursive: true });
  writeFileSync(
    'docs/qa/evidence/P2-T06/api.json',
    JSON.stringify(
      {
        result: 'PASS',
        environment:
          'disposable synthetic local facts; no hosted deployment or Stripe calls',
        checks,
        pages: sizes,
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  await f.cleanup();
}
