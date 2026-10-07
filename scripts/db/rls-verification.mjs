import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

import {
  AVAIL_STATUS_VALUE,
  USER_ROLE_VALUE,
  VERIFICATION_STATUS,
} from '../../packages/shared/src/index.ts';

import {
  apiJson,
  apiRequest,
  assertDenied,
  assertRawBody,
} from './api-test-helpers.mjs';
import { coreFixtures, insertSql, sqlValue } from './core-fixtures.mjs';
import { appendOnlyTables, coreTables } from './core-schema.mjs';
import { queryLocal } from './verify.mjs';

export const ownReadTables = {
  client: [
    'profiles',
    'client_profiles',
    'client_addresses',
    'booking_requests',
    'bookings',
    'disputes',
    'reviews',
  ],
  barber: [
    'profiles',
    'barber_profiles',
    'barber_services',
    'available_now_sessions',
    'booking_requests',
    'bookings',
    'barber_earnings',
    'reviews',
  ],
};
const paymentFields = [
  'id',
  'booking_id',
  'status',
  'gross_cents',
  'refunded_cents',
  'created_at',
  'updated_at',
];
const rowPath = (table, id, select = '*') =>
  `/rest/v1/${table}?id=eq.${id}&select=${encodeURIComponent(select)}&limit=1`;
const roleOf = (identity) =>
  identity.startsWith('client')
    ? 'client'
    : identity.startsWith('barber')
      ? 'barber'
      : identity;

function checkPolicies() {
  const policies = JSON.parse(
    queryLocal(
      `select json_agg(json_build_object('table', tablename, 'cmd', cmd, 'roles', roles, 'qual', qual, 'check', with_check)) from pg_policies where schemaname = 'public';`,
    ),
  );
  assert.equal(policies.length, 32);
  assert.ok(
    policies.every(
      (policy) =>
        policy.cmd === 'SELECT' &&
        policy.check === null &&
        policy.roles.length === 1 &&
        policy.roles[0] === 'authenticated' &&
        policy.qual.includes('private.current_user_role()'),
    ),
  );
  assert.ok(
    policies.every(
      (policy) => !/auth\.jwt|metadata|request\.jwt/i.test(policy.qual),
    ),
    'No role from metadata.',
  );
  const helper = JSON.parse(
    queryLocal(
      `select json_build_object('definer', p.prosecdef, 'stable', p.provolatile, 'args', p.pronargs, 'config', p.proconfig, 'owner', pg_get_userbyid(p.proowner), 'definition', pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'current_user_role';`,
    ),
  );
  assert.ok(
    helper.definer &&
      helper.stable === 's' &&
      helper.args === 0 &&
      helper.owner === 'postgres',
  );
  assert.ok(helper.config.includes('search_path=""'));
  assert.ok(
    helper.definition.includes('public.profiles') &&
      helper.definition.includes('auth.uid()') &&
      !/metadata|auth\.jwt/i.test(helper.definition),
  );
  assert.equal(
    queryLocal(
      "select has_function_privilege('anon', 'private.current_user_role()', 'EXECUTE');",
    ),
    'f',
  );
  for (const table of coreTables)
    assert.equal(
      queryLocal(
        `select has_table_privilege('authenticated', ${sqlValue('public.' + table)}, 'SELECT');`,
      ),
      'f',
      `${table}: column grants only.`,
    );
  const views = JSON.parse(
    queryLocal(
      `select json_agg(json_build_object('name', c.relname, 'options', c.reloptions, 'owner', pg_get_userbyid(c.relowner))) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v';`,
    ),
  );
  assert.equal(views.length, 2);
  assert.ok(
    views.every(
      (view) =>
        view.owner === 'postgres' &&
        view.options.includes('security_barrier=true') &&
        view.options.includes('security_invoker=false'),
    ),
  );
  for (const view of views) {
    for (const role of ['authenticated', 'anon', 'service_role'])
      assert.equal(
        queryLocal(
          `select has_table_privilege(${sqlValue(role)}, ${sqlValue('public.' + view.name)}, 'INSERT,UPDATE,DELETE');`,
        ),
        'f',
        `${view.name}: read-only grants.`,
      );
  }
  console.log(
    'Policies: PASS (21 RLS tables, 32 SELECT-only database-role policies, private no-argument definer with empty search path, explicit column grants, 2 guarded read-only views).',
  );
}

async function expectRead(status, table, id, token, expected) {
  const result = await apiJson(status, rowPath(table, id), token);
  assert.equal(result.status, 200, `${table}: positive read status.`);
  assertRawBody(result.body, expected, `${table} positive read`);
}

function owns(identity, table, row, users) {
  const role = roleOf(identity);
  if (!ownReadTables[role]?.includes(table)) return false;
  if (['profiles', 'client_profiles', 'barber_profiles'].includes(table))
    return row.id === users[identity];
  if (['disputes', 'reviews'].includes(table)) return false; // checked against the owning booking below
  return (
    (role === 'client' ? row.client_id : row.barber_id) === users[identity]
  );
}

async function checkViews(status, fixtures, tokens, users) {
  let reads = 0;
  let writes = 0;
  for (const [identity, token] of Object.entries(tokens)) {
    for (const barber of [users.barberA, users.barberB]) {
      await expectRead(
        status,
        'public_barber_profiles',
        barber,
        token,
        identity === 'unprofiled' ? [] : [{ id: barber }],
      );
      reads++;
    }
    const payment = await apiJson(
      status,
      rowPath('payments', fixtures.rows.payments.id),
      status.SERVICE_ROLE_KEY,
    );
    assert.equal(payment.status, 200);
    const expected =
      identity === 'clientB'
        ? [
            Object.fromEntries(
              paymentFields.map((field) => [field, payment.body[0][field]]),
            ),
          ]
        : [];
    await expectRead(
      status,
      'client_payments',
      fixtures.rows.payments.id,
      token,
      expected,
    );
    reads++;
    // A caller cannot ask a narrow view to return a base-table private column.
    const extra = await apiJson(
      status,
      rowPath('public_barber_profiles', users.barberB, 'id,service_area'),
      token,
    );
    assert.equal(extra.status, 400);
    assert.equal(extra.body.code, '42703');
    for (const [view, row, candidate] of [
      [
        'public_barber_profiles',
        { id: users.barberB },
        { id: users.candidateBarber },
      ],
      [
        'client_payments',
        fixtures.rows.payments,
        Object.fromEntries(
          paymentFields
            .filter((field) => field in fixtures.candidates.payments)
            .map((field) => [field, fixtures.candidates.payments[field]]),
        ),
      ],
    ]) {
      for (const method of ['POST', 'PATCH', 'DELETE']) {
        await assertDenied(
          status,
          method === 'POST' ? `/rest/v1/${view}` : rowPath(view, row.id),
          token,
          {
            method,
            httpStatus: 403,
            code: '42501',
            ...(method === 'POST' ? { body: candidate } : {}),
            ...(method === 'PATCH' ? { body: { id: row.id } } : {}),
          },
        );
        writes++;
      }
    }
  }
  for (const view of ['public_barber_profiles', 'client_payments'])
    await assertDenied(
      status,
      `/rest/v1/${view}?select=*&limit=1`,
      status.ANON_KEY,
      { httpStatus: 401, code: '42501' },
    );
  console.log(
    `Projections: PASS (${reads} role-scoped reads, ${writes} denied writes; ID-only public barber fields, 7-column own-client payments, private-field selection denied, anon denied).`,
  );
}

async function checkNewColumns(status, fixtures, tokens) {
  const probes = [
    ['barber_profiles', fixtures.rows.barber_profiles.id],
    ['payments', fixtures.rows.payments.id],
  ];
  try {
    for (const [table] of probes)
      queryLocal(
        `alter table public.${table} add column private_probe text default 'synthetic_private_marker';`,
      );
    queryLocal("notify pgrst, 'reload schema';");
    for (const [table, id] of probes) {
      let cached = false;
      for (let attempt = 0; attempt < 30; attempt++) {
        const control = await apiJson(
          status,
          rowPath(table, id, 'private_probe'),
          status.SERVICE_ROLE_KEY,
        );
        if (control.status === 200) {
          assertRawBody(
            control.body,
            [{ private_probe: 'synthetic_private_marker' }],
            'Private probe exists',
          );
          cached = true;
          break;
        }
        await setTimeout(100);
      }
      assert.ok(
        cached,
        'Positive control must prove the API knows the new private column.',
      );
      for (const token of [tokens.clientB, tokens.barberB, tokens.admin])
        await assertDenied(status, rowPath(table, id, 'private_probe'), token, {
          httpStatus: 403,
          code: '42501',
        });
    }
    const publicProfile = await apiJson(
      status,
      rowPath('public_barber_profiles', fixtures.rows.barber_profiles.id),
      tokens.clientA,
    );
    assert.equal(publicProfile.status, 200);
    assertRawBody(
      publicProfile.body,
      [{ id: fixtures.rows.barber_profiles.id }],
      'Future barber private field excluded',
    );
    const payments = await apiJson(
      status,
      rowPath('client_payments', fixtures.rows.payments.id),
      tokens.clientB,
    );
    assert.equal(payments.status, 200);
    assertRawBody(
      Object.keys(payments.body[0]).sort(),
      [...paymentFields].sort(),
      'Future payment private field excluded',
    );
  } finally {
    for (const [table] of probes)
      queryLocal(
        `alter table public.${table} drop column if exists private_probe;`,
      );
    queryLocal("notify pgrst, 'reload schema';");
  }
  console.log(
    'Future-column privacy: PASS (2 actual local column additions; API cache-positive controls, authenticated/admin direct denial, projection allowlists unchanged; probes removed).',
  );
}

async function checkDatabaseRole(status, fixtures, tokens, users) {
  const token = tokens.clientA; // Deliberately retain exactly this signed JWT.
  const auditPath = rowPath('audit_logs', fixtures.rows.audit_logs.id);
  await assertDenied(status, auditPath, token);
  for (const role of [USER_ROLE_VALUE.ADMIN, USER_ROLE_VALUE.CLIENT]) {
    queryLocal(`begin; update public.profiles set role = ${sqlValue(role)} where id = ${sqlValue(users.clientA)};
      ${insertSql('audit_logs', { id: randomUUID(), actor_id: users.admin, actor_role: USER_ROLE_VALUE.ADMIN, action: 'fixture_role_change', entity_type: 'profiles', entity_id: users.clientA, new_value: { role }, reason: 'Disposable RLS role-source test', metadata: { synthetic: true } })} commit;`);
    const response = await apiJson(status, auditPath, token);
    assert.equal(response.status, 200);
    if (role === USER_ROLE_VALUE.ADMIN)
      assert.equal(
        response.body.length,
        1,
        'Database grant must take effect without JWT refresh.',
      );
    else
      assertRawBody(
        response.body,
        [],
        'Database revocation takes effect without JWT refresh',
      );
  }
  const self = await apiJson(status, rowPath('profiles', users.clientA), token);
  assert.equal(self.status, 200);
  assert.equal(self.body.length, 1);
  assert.equal(self.body[0].role, USER_ROLE_VALUE.CLIENT);
  // These are client requests against their own visible profile, not foreign-row no-ops.
  await assertDenied(status, rowPath('profiles', users.clientA), token, {
    method: 'PATCH',
    body: {
      role: USER_ROLE_VALUE.ADMIN,
      verification_status: VERIFICATION_STATUS[2],
    },
  });
  await assertDenied(status, rowPath('profiles', users.clientA), token, {
    method: 'DELETE',
  });
  const after = await apiJson(
    status,
    rowPath('profiles', users.clientA),
    token,
  );
  assertRawBody(
    after.body,
    self.body,
    'Self-escalation and deletion leave role/profile unchanged',
  );
  const hiddenHelper = await apiJson(
    status,
    '/rest/v1/rpc/current_user_role',
    token,
    { method: 'POST', body: JSON.stringify({ user_id: users.admin }) },
  );
  assert.equal(hiddenHelper.status, 404);
  assert.equal(hiddenHelper.body.code, 'PGRST202');
  console.log(
    'Role source: PASS (real signed user/app admin metadata ignored; database grant/revoke changes access without JWT refresh; self-role/verification forgery denied; private helper not exposed as RPC).',
  );
}

export async function verifyBaselineApi({
  status,
  fixtures,
  tokens,
  users,
  snapshot,
}) {
  checkPolicies();
  queryLocal(
    insertSql('profiles', {
      id: users.admin,
      role: USER_ROLE_VALUE.ADMIN,
      verification_status: VERIFICATION_STATUS[0],
    }),
  );
  const mirror = coreFixtures({
    ...users,
    clientA: users.clientB,
    clientB: users.clientA,
    barberA: users.barberB,
    barberB: users.barberA,
  });
  // Profile rows/children already exist, and the state table deliberately stays a
  // B-only fixture so the candidate A state insert remains structurally valid.
  for (const table of [
    'profiles',
    'client_profiles',
    'barber_profiles',
    'barber_reliability_state',
  ])
    delete mirror.rows[table];
  queryLocal(
    `begin; ${Object.entries(mirror.rows)
      .map(([table, row]) => insertSql(table, row))
      .join('\n')} commit;`,
  );
  fixtures.candidates.available_now_sessions.status =
    AVAIL_STATUS_VALUE.EXPIRED;
  queryLocal(
    `begin; ${Object.entries(fixtures.candidates)
      .map(([table, row]) => insertSql(table, row))
      .join('\n')} rollback;`,
  );
  const before = snapshot();
  let positive = 0;
  let negative = 0;
  let writes = 0;
  let heads = 0;
  const groups = [
    { rows: fixtures.rows, owner: 'B' },
    { rows: mirror.rows, owner: 'A' },
  ];
  for (const group of groups) {
    for (const [table, row] of Object.entries(group.rows)) {
      const path = rowPath(table, row.id);
      const control = await apiJson(status, path, status.SERVICE_ROLE_KEY);
      assert.equal(control.status, 200);
      assert.equal(
        control.body.length,
        1,
        `${table}: fixture must exist at API.`,
      );
      for (const [identity, token] of Object.entries(tokens)) {
        const role = roleOf(identity);
        const relatedOwner =
          ownReadTables[role]?.includes(table) &&
          ['disputes', 'reviews'].includes(table) &&
          identity.endsWith(group.owner);
        if (
          identity === 'admin' ||
          owns(identity, table, row, users) ||
          relatedOwner
        ) {
          await expectRead(status, table, row.id, token, control.body);
          positive++;
        } else {
          await assertDenied(status, path, token);
          negative++;
        }
        const head = await apiRequest(status, path, token, {
          method: 'HEAD',
          headers: { prefer: 'count=exact' },
        });
        assert.equal(head.status, 200, `${table}: HEAD status.`);
        const allowed =
          identity === 'admin' ||
          owns(identity, table, row, users) ||
          relatedOwner;
        assert.ok(
          head.headers.get('content-range')?.endsWith(allowed ? '/1' : '/0'),
          `${table}: HEAD count must respect the same ownership gate.`,
        );
        assert.equal(await head.text(), '');
        heads++;
        for (const method of ['POST', 'PATCH', 'DELETE']) {
          await assertDenied(
            status,
            method === 'POST' ? `/rest/v1/${table}` : path,
            token,
            {
              method,
              ...(method === 'POST'
                ? {
                    httpStatus: 403,
                    code: '42501',
                    body: fixtures.candidates[table],
                  }
                : {}),
              ...(method === 'PATCH'
                ? { body: { updated_at: '2000-01-01T00:00:00Z' } }
                : {}),
            },
          );
          writes++;
        }
        // PUT and merge-upsert are distinct crafted write paths, not PATCH.
        // Include every column using the successful privileged GET as the witness.
        for (const method of ['PUT', 'UPSERT']) {
          const result = await apiJson(
            status,
            method === 'PUT'
              ? `/rest/v1/${table}?id=eq.${row.id}`
              : `/rest/v1/${table}`,
            token,
            {
              method: method === 'PUT' ? 'PUT' : 'POST',
              body: JSON.stringify(control.body[0]),
              ...(method === 'UPSERT'
                ? {
                    headers: {
                      prefer:
                        'resolution=merge-duplicates,return=representation',
                    },
                  }
                : {}),
            },
          );
          assert.equal(
            result.status,
            403,
            `${table}: ${method} must be denied.`,
          );
          assert.ok(
            result.body.code === '42501',
            `${table}: ${method} must fail RLS, not payload/constraint validation.`,
          );
          writes++;
        }
      }
      await assertDenied(status, path, status.ANON_KEY, {
        httpStatus: 401,
        code: '42501',
      });
    }
  }
  // Existing A-side profile/children are tested separately; mirrors deliberately
  // did not reinsert them. This includes the client with hostile signed metadata.
  for (const identity of ['clientA', 'barberA']) {
    for (const table of [
      'profiles',
      roleOf(identity) === 'client' ? 'client_profiles' : 'barber_profiles',
    ]) {
      const control = await apiJson(
        status,
        rowPath(table, users[identity]),
        status.SERVICE_ROLE_KEY,
      );
      await expectRead(
        status,
        table,
        users[identity],
        tokens[identity],
        control.body,
      );
      positive++;
    }
  }
  for (const table of appendOnlyTables) {
    for (const method of ['PATCH', 'DELETE'])
      await assertDenied(
        status,
        rowPath(table, fixtures.rows[table].id),
        status.SERVICE_ROLE_KEY,
        {
          method,
          httpStatus: 500,
          code: '55000',
          ...(method === 'PATCH'
            ? { body: { updated_at: '2000-01-01T00:00:00Z' } }
            : {}),
        },
      );
  }
  await checkViews(status, fixtures, tokens, users);
  // Embedding cannot turn a hidden client profile/address into readable data.
  const embedded = await apiJson(
    status,
    rowPath(
      'booking_requests',
      fixtures.rows.booking_requests.id,
      'id,client_profiles!client_id(id,client_addresses(id,location))',
    ),
    tokens.barberB,
  );
  assert.equal(embedded.status, 200);
  assertRawBody(
    embedded.body,
    [{ id: fixtures.rows.booking_requests.id, client_profiles: null }],
    'Pending-request embedded contact/address denial',
  );
  const foreignBooking = await apiJson(
    status,
    rowPath(
      'client_payments',
      fixtures.rows.payments.id,
      'id,bookings(id,barber_profiles(id,service_area))',
    ),
    tokens.clientB,
  );
  assert.equal(foreignBooking.status, 200);
  assertRawBody(
    foreignBooking.body,
    [
      {
        id: fixtures.rows.payments.id,
        bookings: { id: fixtures.rows.bookings.id, barber_profiles: null },
      },
    ],
    'Payment embedding cannot bypass barber private RLS',
  );
  const forged = await apiJson(
    status,
    rowPath('audit_logs', fixtures.rows.audit_logs.id),
    'forged.jwt.value',
  );
  assert.equal(forged.status, 401);
  assert.equal(forged.body.code, 'PGRST301');
  await assertDenied(
    status,
    rowPath('audit_logs', fixtures.rows.audit_logs.id),
    undefined,
    { httpStatus: 401, code: '42501' },
  );
  assert.ok(
    snapshot() === before,
    'All denied writes must leave every stored row unchanged.',
  );
  console.log(
    `RLS API: PASS (${positive} own/admin positive reads, ${negative} cross-user/no-profile negative reads, ${heads} HEAD ownership/count checks, ${writes} direct denied writes including PUT/merge-upsert; 21 tables/every verb; 6 privileged immutable API denials; anonymous/forged/missing JWT denial; raw embedded relations remain private; stored rows unchanged).`,
  );
  await checkDatabaseRole(status, fixtures, tokens, users);
  await checkNewColumns(status, fixtures, tokens);
}
