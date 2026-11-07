import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  BOOKING_STATUS_VALUE,
  BOOKING_TYPE_VALUE,
  DISPUTE_STATUS_VALUE,
  EARNING_STATUS_VALUE,
  USER_ROLE_VALUE,
} from '@quicktrimr/shared';

import { CONTRACT_DETAILS } from '../src/contract-details.ts';
import { API_FIXTURES } from '../src/fixtures.ts';
import { CONTRACTS, SERVER_CONTROLLED_REQUEST_FIELDS } from '../src/index.ts';

const root = new URL('../../../', import.meta.url);
const validRequest = (name) => structuredClone(API_FIXTURES[name].request);
const validResponse = (name) => structuredClone(API_FIXTURES[name].response);
const accept = (name, side, value) =>
  CONTRACTS[name][`${side}Schema`].safeParse(value).success;
const adminIntents = new Set(['admin-resolve-dispute', 'admin-issue-refund']);

test('KB inventory, contract registry, details and fixtures have exactly the same 49 names', async () => {
  const kb = await readFile(
    new URL('QUICKTRIMR_KNOWLEDGE_BASE.md', root),
    'utf8',
  );
  const inventory = [
    ...kb
      .split('Function inventory:')[1]
      .split('```')[1]
      .matchAll(/[a-z]+(?:-[a-z]+)+/g),
  ].map((match) => match[0]);
  assert.equal(inventory.length, 49);
  assert.equal(new Set(inventory).size, 49);
  for (const entries of [CONTRACTS, CONTRACT_DETAILS, API_FIXTURES])
    assert.deepEqual(Object.keys(entries).sort(), inventory.toSorted());
  const backlog = await readFile(
    new URL('QUICKTRIMR_BACKLOG_README.md', root),
    'utf8',
  );
  for (const detail of Object.values(CONTRACT_DETAILS)) {
    for (const rule of detail.rules)
      assert.ok(
        kb.includes(`\`${rule}\``) || kb.includes(`### ${rule} `),
        rule,
      );
    for (const owner of detail.owner.split(' / '))
      assert.ok(backlog.includes(`id: ${owner}\n`), owner);
    assert.ok(detail.errors.length > 0);
    assert.equal(
      new Set(detail.errors.map((error) => `${error.status}:${error.code}`))
        .size,
      detail.errors.length,
    );
  }
});

test('all 49 success and every documented error fixture parse, and JSON round trips', () => {
  for (const [name, fixture] of Object.entries(API_FIXTURES)) {
    assert.equal(
      accept(name, 'request', JSON.parse(JSON.stringify(fixture.request))),
      true,
      name,
    );
    assert.equal(
      accept(name, 'response', JSON.parse(JSON.stringify(fixture.response))),
      true,
      name,
    );
    assert.deepEqual(
      fixture.errors.map(({ status, body }) => [status, body.error]),
      CONTRACT_DETAILS[name].errors.map(({ status, code }) => [status, code]),
    );
    for (const { status, body } of fixture.errors) {
      assert.ok(Number.isInteger(status) && status >= 400 && status < 600);
      assert.match(body.error, /^[a-z]+(?:_[a-z]+)*$/);
      assert.equal(CONTRACTS[name].errorSchema.safeParse(body).success, true);
      assert.equal(
        CONTRACTS[name].errorSchema.safeParse({
          ...body,
          clientSecret: 'private',
        }).success,
        false,
      );
      if (body.error === 'validation_failed')
        assert.ok(Object.keys(body.fields).length > 0);
    }
  }
});

test('caller classification separates all workers, provider ingress and admin-only actions', () => {
  const internal = [
    'auto-disable-unresponsive-barber',
    'expire-booking-request',
    'capture-authorised-payment',
    'cancel-payment-authorisation',
    'create-refund',
    'auto-complete-after-barber-complete-timeout',
    'send-final-completion-prompt',
    'auto-complete-after-final-prompt',
    'create-barber-earning',
    'release-barber-earning',
    'queue-payout-batch',
    'process-payout-batch',
    'mark-payout-batch-paid',
  ];
  assert.deepEqual(
    Object.entries(CONTRACT_DETAILS)
      .filter(([, detail]) => detail.caller === 'server')
      .map(([name]) => name)
      .sort(),
    internal.toSorted(),
  );
  assert.equal(CONTRACT_DETAILS['stripe-webhook'].caller, 'stripe');
  for (const [name, detail] of Object.entries(CONTRACT_DETAILS)) {
    if (detail.caller === 'user') {
      assert.ok(detail.roles.length > 0);
      assert.ok(
        detail.errors.some(
          (error) => error.status === 401 && error.code === 'unauthenticated',
        ),
      );
      if (
        name.startsWith('admin-') ||
        [
          'create-service-category',
          'update-service-category',
          'archive-service-category',
          'update-review-admin-visibility',
        ].includes(name)
      )
        assert.deepEqual(detail.roles, [USER_ROLE_VALUE.ADMIN]);
    } else assert.deepEqual(detail.roles, []);
  }
  // Metadata is a promise for future endpoint denial tests, not authorization itself.
});

test('ordinary requests cannot yield trusted server-owned fields; admin refund intent is narrowly explicit', () => {
  for (const name of Object.keys(CONTRACTS)) {
    if (name === 'stripe-webhook') continue; // opaque verified provider objects are not user input.
    for (const field of SERVER_CONTROLLED_REQUEST_FIELDS) {
      if (adminIntents.has(name) && field === 'refundCents') continue;
      const parsed = CONTRACTS[name].requestSchema.safeParse({
        ...validRequest(name),
        [field]: 123,
      });
      if (parsed.success)
        assert.equal(
          Object.hasOwn(parsed.data, field),
          false,
          `${name}: ${field}`,
        );
    }
    for (const field of [
      'now',
      'scheduledCutoff',
      'resolvedAt',
      'roleClaim',
      'permissions',
      'rawCardNumber',
    ])
      assert.equal(
        accept(name, 'request', { ...validRequest(name), [field]: 'forged' }),
        false,
        `${name}: ${field}`,
      );
  }
  for (const name of adminIntents) {
    for (const refundCents of [-1, 0.1, Infinity, '2000'])
      assert.equal(
        accept(name, 'request', { ...validRequest(name), refundCents }),
        false,
        name,
      );
    for (const reason of ['', '  ', '\n'])
      assert.equal(
        accept(name, 'request', { ...validRequest(name), reason }),
        false,
        name,
      );
    assert.equal(accept(name, 'request', validRequest(name)), true);
  }
});

test('strict success projections reject private fields at root and public nested boundaries', () => {
  for (const name of Object.keys(CONTRACTS)) {
    for (const key of [
      'phone',
      'homeAddress',
      'stripeSecret',
      'rawProviderPayload',
      'origin',
      'polyline',
    ])
      assert.equal(
        accept(name, 'response', { ...validResponse(name), [key]: 'private' }),
        false,
        `${name}: ${key}`,
      );
  }
  for (const key of [
    'lat',
    'lng',
    'distanceMeters',
    'mobile',
    'serviceAreaLat',
    'stripeAccountId',
  ]) {
    const result = validResponse('search-available-now-barbers');
    result.results[0][key] = 'private';
    assert.equal(
      accept('search-available-now-barbers', 'response', result),
      false,
      key,
    );
  }
  const profile = validResponse('complete-barber-profile');
  profile.approximateArea.mapPoint.barberId = 'private';
  assert.equal(accept('complete-barber-profile', 'response', profile), false);
});

test('admin status alias is exactly the approved reliability schema and metadata, not new privileges', () => {
  for (const field of ['requestSchema', 'responseSchema'])
    assert.equal(
      CONTRACTS['admin-update-barber-status'][field],
      CONTRACTS['admin-update-reliability-state'][field],
    );
  assert.equal(
    CONTRACT_DETAILS['admin-update-barber-status'],
    CONTRACT_DETAILS['admin-update-reliability-state'],
  );
  for (const name of [
    'admin-update-barber-status',
    'admin-update-reliability-state',
  ]) {
    assert.equal(
      accept(name, 'request', { ...validRequest(name), toLevel: 'verified' }),
      false,
    );
    assert.equal(
      accept(name, 'request', { ...validRequest(name), reason: ' ' }),
      false,
    );
  }
});

test('structural boundaries cover profile, category, discovery, dates and permission denial', () => {
  assert.equal(
    accept('create-or-sync-profile', 'request', {
      role: USER_ROLE_VALUE.ADMIN,
    }),
    false,
  );
  assert.equal(
    accept('complete-client-profile', 'request', {
      ...validRequest('complete-client-profile'),
      mobile: 'not-a-phone',
    }),
    false,
  );
  for (const name of ['create-service-category', 'update-service-category']) {
    const request = validRequest(name);
    for (const maxPriceCents of [
      request.minPriceCents,
      request.minPriceCents - 1,
      12.5,
    ])
      assert.equal(
        accept(name, 'request', { ...request, maxPriceCents }),
        false,
      );
  }
  const search = validRequest('search-available-now-barbers');
  assert.equal(
    accept('search-available-now-barbers', 'request', {
      ...search,
      bookingType: BOOKING_TYPE_VALUE.SCHEDULED,
    }),
    false,
  );
  assert.equal(
    accept('search-available-now-barbers', 'request', {
      ...search,
      bookingType: BOOKING_TYPE_VALUE.SCHEDULED,
      scheduledFor: '2026-11-03T00:00:00Z',
    }),
    true,
  );
  for (const radiusKm of [0, -1, Infinity])
    assert.equal(
      accept('search-available-now-barbers', 'request', {
        ...search,
        radiusKm,
      }),
      false,
    );
  for (const limit of [0, -1, 1.5])
    assert.equal(accept('admin-list-bookings', 'request', { limit }), false);
  for (const name of ['admin-list-bookings', 'admin-view-platform-analytics'])
    assert.equal(
      accept(name, 'request', {
        ...validRequest(name),
        from: '2026-11-03T00:00:00Z',
        to: '2026-11-02T00:00:00Z',
      }),
      false,
    );
  const onWay = validRequest('mark-on-the-way');
  const { lat, lng, ...withoutCoordinates } = onWay;
  assert.ok(Number.isFinite(lat) && Number.isFinite(lng));
  assert.equal(accept('mark-on-the-way', 'request', withoutCoordinates), true);
  assert.equal(
    accept('mark-on-the-way', 'request', { ...withoutCoordinates, lat }),
    false,
  );
  assert.equal(
    accept('mark-on-the-way', 'request', { ...withoutCoordinates, lng }),
    false,
  );
});

test('decoded webhook envelope is compatible with provider additions but is not an authentication mechanism', () => {
  const input = {
    ...validRequest('stripe-webhook'),
    api_version: 'synthetic',
    livemode: false,
  };
  const parsed = CONTRACTS['stripe-webhook'].requestSchema.parse(input);
  assert.equal('livemode' in parsed, false);
  assert.equal(
    accept('stripe-webhook', 'request', {
      ...input,
      data: { object: 'raw-unvalidated-string' },
    }),
    false,
  );
  assert.equal(
    accept('stripe-webhook', 'response', { received: true, duplicate: true }),
    true,
  );
});

test('worker no-op and empty branches parse without claiming a stale state transition', () => {
  for (const name of [
    'auto-complete-after-barber-complete-timeout',
    'auto-complete-after-final-prompt',
  ]) {
    const response = validResponse(name);
    assert.equal(
      accept(name, 'response', {
        ...response,
        status: BOOKING_STATUS_VALUE.DISPUTED,
      }),
      false,
    );
    assert.equal(
      accept(name, 'response', {
        ...response,
        applied: false,
        status: BOOKING_STATUS_VALUE.DISPUTED,
        earningStatus: EARNING_STATUS_VALUE.PENDING,
      }),
      true,
    );
  }
  assert.equal(
    accept('queue-payout-batch', 'response', {
      batchId: null,
      itemCount: 0,
      totalCents: 0,
    }),
    true,
  );
  assert.equal(
    accept('queue-payout-batch', 'response', {
      ...validResponse('queue-payout-batch'),
      totalCents: 0,
    }),
    false,
  );
  assert.equal(
    accept('search-available-now-barbers', 'response', {
      results: [],
      nextCursor: null,
    }),
    true,
  );
  assert.equal(
    accept('admin-list-bookings', 'response', {
      results: [],
      nextCursor: null,
    }),
    true,
  );
  // Payload variants only: no claim of actual worker execution/idempotency here.
});

test('refund outcomes and monetary responses reject invalid cents/statuses', () => {
  for (const [name, field] of [
    ['create-payment-authorisation', 'amountCents'],
    ['capture-authorised-payment', 'capturedCents'],
    ['create-refund', 'refundCents'],
    ['create-barber-earning', 'barberNetCents'],
    ['queue-payout-batch', 'totalCents'],
    ['admin-resolve-dispute', 'refundCents'],
  ]) {
    for (const amount of [-1, 0.5, Infinity, '4500'])
      assert.equal(
        accept(name, 'response', { ...validResponse(name), [field]: amount }),
        false,
        name,
      );
  }
  const response = validResponse('capture-authorised-payment');
  assert.equal(
    accept('capture-authorised-payment', 'response', {
      ...response,
      bookingStatus: BOOKING_STATUS_VALUE.ACCEPTED_PENDING_PAYMENT,
    }),
    false,
  );
  const partial = validRequest('admin-resolve-dispute');
  const resolution = validResponse('admin-resolve-dispute');
  const fullRefund = {
    ...resolution,
    status: DISPUTE_STATUS_VALUE.RESOLVED_CLIENT_REFUND,
    refundCents: 4500,
    barberNetCents: 0,
    platformRetainedCents: 0,
  };
  assert.equal(accept('admin-resolve-dispute', 'response', fullRefund), false);
  assert.equal(
    accept('admin-resolve-dispute', 'response', {
      ...fullRefund,
      earningStatus: EARNING_STATUS_VALUE.REVERSED,
    }),
    true,
  );
  assert.equal(
    accept('admin-resolve-dispute', 'request', {
      ...partial,
      outcome: DISPUTE_STATUS_VALUE.OPEN,
    }),
    false,
  );
  const { refundCents, ...full } = partial;
  assert.equal(refundCents, 2000);
  assert.equal(
    accept('admin-resolve-dispute', 'request', {
      ...full,
      outcome: DISPUTE_STATUS_VALUE.RESOLVED_CLIENT_REFUND,
    }),
    true,
  );
});

function jsonExamples(source) {
  const values = [];
  for (const block of source.matchAll(/```jsonc\n([\s\S]*?)```/g)) {
    const text = block[1]
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n');
    let depth = 0;
    let start = 0;
    let quoted = false;
    let escaped = false;
    for (let index = 0; index < text.length; index++) {
      const char = text[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === '{') {
        if (depth++ === 0) start = index;
      } else if (char === '}' && --depth === 0)
        values.push(JSON.parse(text.slice(start, index + 1)));
    }
  }
  return values;
}

test('owning backlog error examples use the shared envelope and are covered by contract details', async () => {
  const backlog = await readFile(
    new URL('QUICKTRIMR_BACKLOG_README.md', root),
    'utf8',
  );
  const owners = new Set(
    Object.values(CONTRACT_DETAILS).flatMap((detail) =>
      detail.owner.split(' / '),
    ),
  );
  for (const owner of owners) {
    const ticket = backlog.split(`#### ${owner} —`)[1]?.split('\n#### ')[0];
    assert.ok(ticket, owner);
    const details = Object.values(CONTRACT_DETAILS).filter((detail) =>
      detail.owner.split(' / ').includes(owner),
    );
    const codes = new Set(
      details.flatMap((detail) => detail.errors.map((error) => error.code)),
    );
    for (const example of jsonExamples(ticket).filter((example) =>
      Object.hasOwn(example, 'error'),
    )) {
      assert.equal(
        CONTRACTS['create-review'].errorSchema.safeParse(example).success,
        true,
        `${owner}: ${JSON.stringify(example)}`,
      );
      assert.ok(
        codes.has(example.error),
        `${owner} undocumented error ${example.error}`,
      );
    }
  }
});
