import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { serviceCategoryListSchema } from '../../packages/validation/src/contracts/catalogue.ts';

import {
  apiJson,
  apiRequest,
  assertRawBody,
  makeUsers,
} from './api-test-helpers.mjs';
import { coreFixtures, insertSql, sqlValue } from './core-fixtures.mjs';
import { localStatus } from './local-api.mjs';
import { queryLocal } from './verify.mjs';

// Real local Auth, Edge and PostgREST requests. SQL is fixture setup and an
// independent persistence witness only; it never stands in for an API assertion.
const status = localStatus();
const checks = [];
const categories = new Set();
let evidence;
const read = (sql) => JSON.parse(queryLocal(sql));
const categorySelect =
  'id,slug,displayName:display_name,description,displayOrder:display_order,minPriceCents:min_price_cents,maxPriceCents:max_price_cents,archivedAt:archived_at';
const inputFor = (
  { id, displayName, description, displayOrder, minPriceCents, maxPriceCents },
  overrides = {},
) => ({
  id,
  displayName,
  description,
  displayOrder,
  minPriceCents,
  maxPriceCents,
  ...overrides,
});
const { users, tokens } = await makeUsers(status, {
  additional: ['admin', 'unprofiled'],
  adversarialMetadata: true,
});
const fixtures = coreFixtures(users);
queryLocal(`begin; ${insertSql('profiles', { id: users.admin, role: 'admin', verification_status: 'not_started' })}
  ${fixtures.extra.map(([table, row]) => insertSql(table, row)).join('\n')}
  ${insertSql('profiles', fixtures.rows.profiles)} commit;`);
const mutate = (operation, body, token = tokens.admin) =>
  apiJson(status, `/functions/v1/${operation}-service-category`, token, {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
const audits = (id) =>
  read(`select coalesce(json_agg(json_build_object(
  'actor', actor_id, 'role', actor_role, 'action', action,
  'before', previous_value, 'after', new_value) order by created_at, id), '[]')
  from public.audit_logs where entity_type='service_categories' and entity_id=${sqlValue(id)};`);
const stored = (id) =>
  read(
    `select private.service_category_json(c) from public.service_categories c where id=${sqlValue(id)};`,
  );
async function create(overrides = {}) {
  const result = await mutate('create', {
    slug: `api-fixture-${randomUUID()}`,
    displayName: 'Synthetic API category',
    description: 'Disposable local catalogue test',
    displayOrder: 9,
    minPriceCents: 2000,
    maxPriceCents: 15000,
    ...overrides,
  });
  assert.equal(result.status, 200, 'Admin category create');
  serviceCategoryListSchema.parse([result.body]);
  categories.add(result.body.id);
  return result.body;
}
async function update(category, overrides = {}) {
  return mutate('update', inputFor(category, overrides));
}
async function serviceWrite(id, body) {
  return apiJson(
    status,
    `/rest/v1/barber_services?id=eq.${id}`,
    status.SERVICE_ROLE_KEY,
    { method: 'PATCH', body: JSON.stringify(body) },
  );
}
async function catalogue(token, filter = 'archived_at=is.null') {
  const result = await apiJson(
    status,
    `/rest/v1/service_categories?${filter}&select=${categorySelect}&order=display_order.asc,slug.asc,id.asc&limit=100`,
    token,
  );
  assert.equal(result.status, 200, 'Catalogue read');
  return serviceCategoryListSchema.parse(result.body);
}
try {
  let category = await create();
  const firstAudit = audits(category.id);
  assert.equal(firstAudit.length, 1);
  assertRawBody(
    firstAudit[0],
    {
      actor: users.admin,
      role: 'admin',
      action: 'service_category.created',
      before: null,
      after: category,
    },
    'Create audit',
  );
  // Populate only relationships this slice needs. Remaining foundation fixtures
  // belong to their own verifiers, including private contacts/location checks.
  const service = {
    ...fixtures.rows.barber_services,
    service_category_id: category.id,
  };
  for (const [table, row] of [
    ['client_profiles', fixtures.rows.client_profiles],
    ['barber_profiles', fixtures.rows.barber_profiles],
    ['barber_services', service],
    ['booking_requests', fixtures.rows.booking_requests],
    ['bookings', fixtures.rows.bookings],
    ['booking_services', fixtures.rows.booking_services],
  ])
    queryLocal(insertSql(table, row));
  const bookingBefore = queryLocal(
    `select row_to_json(b) from public.bookings b where id=${sqlValue(fixtures.rows.bookings.id)};`,
  );
  const bookingServiceBefore = queryLocal(
    `select row_to_json(b) from public.booking_services b where id=${sqlValue(fixtures.rows.booking_services.id)};`,
  );

  for (const operation of ['create', 'update', 'archive']) {
    for (const token of [undefined, 'forged.jwt.value', status.ANON_KEY]) {
      // Pass an explicit undefined through apiJson (mutate defaults to admin).
      const denied = await apiJson(
        status,
        `/functions/v1/${operation}-service-category`,
        token,
        { method: 'POST', body: '{' },
      );
      assert.equal(denied.status, 401, 'Missing/forged/anonymous identity');
    }
    for (const name of ['clientA', 'barberA', 'unprofiled']) {
      const denied = await mutate(operation, '{', tokens[name]);
      assert.equal(
        denied.status,
        403,
        `${operation}: role gate before body parsing`,
      );
      assertRawBody(denied.body, { error: 'forbidden' }, 'Safe role rejection');
    }
    const directRpc = await apiJson(
      status,
      '/rest/v1/rpc/manage_service_category',
      tokens.admin,
      {
        method: 'POST',
        body: JSON.stringify({
          p_user_id: users.admin,
          p_operation: operation,
          p_input: {},
        }),
      },
    );
    assert.equal(
      directRpc.status,
      403,
      'User JWT cannot invoke privileged mutation RPC',
    );
  }
  queryLocal(
    `update public.profiles set role='client' where id=${sqlValue(users.admin)};`,
  );
  assert.equal(
    (await update(category)).status,
    403,
    'Role revocation without token refresh',
  );
  queryLocal(
    `update public.profiles set role='admin' where id=${sqlValue(users.admin)};`,
  );
  checks.push(
    'JWT/role denial for all mutations, signed hostile metadata, direct RPC denial, immediate role revocation',
  );

  for (const overrides of [
    { displayName: ' ' },
    { displayOrder: -1 },
    { minPriceCents: -1 },
    { minPriceCents: 20.5 },
    { minPriceCents: 15000 },
    { maxPriceCents: 2147483648 },
  ])
    assert.equal(
      (await update(category, overrides)).status,
      422,
      'Invalid fields/range',
    );
  assert.equal(
    (await mutate('update', { ...inputFor(category), slug: category.slug }))
      .status,
    409,
    'Slug immutable',
  );
  const duplicateInput = inputFor(category);
  delete duplicateInput.id;
  assert.equal(
    (await mutate('create', { ...duplicateInput, slug: category.slug })).body
      .error,
    'slug_exists',
  );
  assert.equal(
    (await mutate('archive', { id: randomUUID() })).status,
    404,
    'Unknown category',
  );
  assert.equal(
    audits(category.id).length,
    1,
    'Rejections/no-op leave audit untouched',
  );

  const before = category;
  const renamed = await update(category, {
    displayName: 'Updated synthetic category',
    displayOrder: 8,
  });
  assert.equal(renamed.status, 200);
  category = renamed.body;
  assertRawBody(
    audits(category.id)[1],
    {
      actor: users.admin,
      role: 'admin',
      action: 'service_category.updated',
      before,
      after: category,
    },
    'Update audit',
  );
  const omitted = inputFor(category);
  delete omitted.description;
  assertRawBody(
    (await mutate('update', omitted)).body,
    category,
    'Omitted description preserved/no-op',
  );
  assert.equal(
    audits(category.id).length,
    2,
    'No-op has no extra mutation audit',
  );
  checks.push(
    'CRUD validation, immutable/unique slugs, missing rows, exact previous/new audit, no-op preservation',
  );

  for (const [overrides, field] of [
    [{ maxPriceCents: 4499 }, 'maxPriceCents'],
    [{ minPriceCents: 4501 }, 'minPriceCents'],
  ]) {
    const rejected = await update(category, overrides);
    assert.equal(rejected.status, 409);
    assert.equal(rejected.body.error, 'category_price_conflict');
    assert.deepEqual(Object.keys(rejected.body.fields), [field]);
    assertRawBody(stored(category.id), category, 'Rejected range unchanged');
  }
  const boundary = await update(category, {
    minPriceCents: 4500,
    maxPriceCents: 4501,
  });
  assert.equal(boundary.status, 200, 'Inclusive minimum boundary');
  category = boundary.body;
  const upper = await update(category, {
    minPriceCents: 4499,
    maxPriceCents: 4500,
  });
  assert.equal(upper.status, 200, 'Inclusive maximum boundary');
  category = upper.body;
  assert.equal(
    (await serviceWrite(service.id, { archived_at: new Date().toISOString() }))
      .status,
    200,
  );
  const narrowed = await update(category, {
    minPriceCents: 2000,
    maxPriceCents: 4000,
  });
  assert.equal(narrowed.status, 200, 'Archived price ignored');
  category = narrowed.body;
  assert.equal(
    (await serviceWrite(service.id, { archived_at: null })).status,
    400,
    'Out-of-bounds reactivation denied',
  );
  category = (await update(category, { maxPriceCents: 15000 })).body;
  assert.equal(
    (await serviceWrite(service.id, { archived_at: null })).status,
    200,
  );
  checks.push(
    'Active-price min/max conflicts, exact inclusive boundaries, ignored archived prices, reactivation integrity',
  );

  const raceOutcomes = [];
  // Delay the synthetic service write before its parent lock for half the rounds
  // so the more chatty Edge route can win too. Both requests are genuinely in
  // flight; this is a contention barrier, never a sequential race simulation.
  queryLocal(`create function private.category_race_pause_probe() returns trigger language plpgsql as $$ begin
    if new.id=${sqlValue(service.id)}::uuid then perform pg_sleep(0.2); end if; return new; end $$;`);
  try {
    for (let round = 0; round < 6; round++) {
      if (round === 3)
        queryLocal(
          'create trigger a_category_race_pause_probe before update on public.barber_services for each row execute function private.category_race_pause_probe();',
        );
      category = (await update(category, { maxPriceCents: 15000 })).body;
      assert.equal(
        (await serviceWrite(service.id, { price_cents: 4500 })).status,
        200,
      );
      const [bounds, price] = await Promise.all([
        update(category, { maxPriceCents: 5000 }),
        serviceWrite(service.id, { price_cents: 6000 }),
      ]);
      assert.ok(
        (bounds.status === 200 && price.status === 400) ||
          (bounds.status === 409 && price.status === 200),
        'Concurrent range/price changes must serialize with one rejection',
      );
      assert.equal(
        queryLocal(`select count(*) from public.barber_services s join public.service_categories c on c.id=s.service_category_id
      where s.id=${sqlValue(service.id)} and s.archived_at is null and (s.price_cents<c.min_price_cents or s.price_cents>c.max_price_cents);`),
        '0',
      );
      raceOutcomes.push({
        boundsStatus: bounds.status,
        priceStatus: price.status,
      });
      category = stored(category.id);
    }
  } finally {
    queryLocal(
      'drop trigger if exists a_category_race_pause_probe on public.barber_services; drop function private.category_race_pause_probe();',
    );
  }
  assert.ok(
    raceOutcomes.some((r) => r.boundsStatus === 200) &&
      raceOutcomes.some((r) => r.priceStatus === 200),
    'Exercise both concurrent winners',
  );
  assert.equal(
    queryLocal(
      `select row_to_json(b) from public.bookings b where id=${sqlValue(fixtures.rows.bookings.id)};`,
    ),
    bookingBefore,
  );
  assert.equal(
    queryLocal(
      `select row_to_json(b) from public.booking_services b where id=${sqlValue(fixtures.rows.booking_services.id)};`,
    ),
    bookingServiceBefore,
  );
  checks.push(
    'Six real parallel range/price races preserve invariant; original booking and line-item snapshots unchanged',
  );

  // A real database fault proves mutation + append-only audit are one transaction.
  const auditCount = audits(category.id).length;
  queryLocal(`create function private.category_audit_failure_probe() returns trigger language plpgsql as $$ begin
    if new.entity_id=${sqlValue(category.id)}::uuid and new.action='service_category.updated' then
      raise exception 'Synthetic audit failure'; end if; return new; end $$;
    create trigger category_audit_failure_probe before insert on public.audit_logs for each row execute function private.category_audit_failure_probe();`);
  try {
    assert.equal(
      (await update(category, { displayName: 'Must roll back' })).status,
      500,
    );
    assertRawBody(
      stored(category.id),
      category,
      'Audit failure rolls back category',
    );
    assert.equal(audits(category.id).length, auditCount);
  } finally {
    queryLocal(
      'drop trigger category_audit_failure_probe on public.audit_logs; drop function private.category_audit_failure_probe();',
    );
  }
  checks.push(
    'Injected audit failure rolls back mutation and audit atomically',
  );

  // Genuine duplicate create/archive calls, not sequential idempotency simulation.
  const slug = `concurrent-${randomUUID()}`;
  const duplicates = await Promise.all(
    Array.from({ length: 4 }, () =>
      mutate('create', {
        slug,
        displayName: 'Concurrent synthetic category',
        displayOrder: 8,
        minPriceCents: 2000,
        maxPriceCents: 15000,
      }),
    ),
  );
  assert.deepEqual(
    duplicates.map((r) => r.status).sort(),
    [200, 409, 409, 409],
  );
  const duplicate = duplicates.find((r) => r.status === 200).body;
  categories.add(duplicate.id);
  assert.equal(audits(duplicate.id).length, 1);
  const archived = await Promise.all(
    Array.from({ length: 4 }, () => mutate('archive', { id: category.id })),
  );
  for (const result of archived) {
    assert.equal(result.status, 200);
    assertRawBody(result.body, archived[0].body, 'Idempotent archive');
  }
  const archiveAudit = audits(category.id).filter(
    (row) => row.action === 'service_category.archived',
  );
  assert.equal(archiveAudit.length, 1);
  assertRawBody(archiveAudit[0].before, category, 'Archive previous audit');
  assertRawBody(
    archiveAudit[0].after,
    stored(category.id),
    'Archive new audit',
  );
  checks.push(
    'Four parallel duplicate creates: one row/audit; four parallel archives: one timestamp/audit',
  );

  for (const token of [
    tokens.clientA,
    tokens.barberA,
    tokens.admin,
    tokens.unprofiled,
  ]) {
    const active = await catalogue(token);
    assert.ok(
      active.every((c) => c.archivedAt === null && c.id !== category.id),
    );
    const sorted = [...active].sort(
      (a, b) => a.displayOrder - b.displayOrder || a.slug.localeCompare(b.slug),
    );
    assert.deepEqual(
      active.map((c) => c.id),
      sorted.map((c) => c.id),
      'Stable catalogue order',
    );
  }
  for (const [name, expected] of [
    ['clientA', 0],
    ['barberA', 0],
    ['clientB', 1],
    ['barberB', 1],
    ['admin', 1],
    ['unprofiled', 0],
  ]) {
    assert.equal(
      (await catalogue(tokens[name], `id=eq.${category.id}`)).length,
      expected,
      'Archived history is owner scoped',
    );
    const head = await apiRequest(
      status,
      `/rest/v1/service_categories?id=eq.${category.id}&select=id`,
      tokens[name],
      {
        method: 'HEAD',
        headers: { prefer: 'count=exact' },
      },
    );
    assert.equal(head.status, 200);
    assert.ok(
      head.headers.get('content-range')?.endsWith(`/${expected}`),
      'Archived HEAD count respects ownership',
    );
    assert.equal(await head.text(), '');
  }
  const unavailable = await apiJson(
    status,
    '/rest/v1/barber_services',
    status.SERVICE_ROLE_KEY,
    {
      method: 'POST',
      body: JSON.stringify({
        id: randomUUID(),
        barber_id: users.barberB,
        service_category_id: category.id,
        price_cents: 4500,
      }),
    },
  );
  assert.equal(
    unavailable.status,
    400,
    'Archived category unavailable for new services',
  );
  checks.push(
    'Sorted active catalogue excludes archives; archived history readable only by related owners/admin; new archived selections rejected',
  );

  const rawCategory = read(
    `select row_to_json(c) from public.service_categories c where id=${sqlValue(category.id)};`,
  );
  for (const token of [
    tokens.admin,
    tokens.clientA,
    tokens.barberA,
    status.SERVICE_ROLE_KEY,
  ]) {
    for (const method of ['POST', 'PATCH', 'DELETE', 'PUT', 'UPSERT']) {
      const denied = await apiJson(
        status,
        `/rest/v1/service_categories${['POST', 'UPSERT'].includes(method) ? '' : `?id=eq.${category.id}`}`,
        token,
        {
          method: method === 'UPSERT' ? 'POST' : method,
          ...(method === 'UPSERT'
            ? {
                headers: {
                  prefer: 'resolution=merge-duplicates,return=representation',
                },
              }
            : {}),
          ...(method === 'DELETE'
            ? {}
            : {
                body: JSON.stringify(
                  method === 'POST'
                    ? { ...rawCategory, id: randomUUID(), slug: randomUUID() }
                    : method === 'PATCH'
                      ? { display_name: 'Bypass' }
                      : rawCategory,
                ),
              }),
        },
      );
      assert.equal(denied.status, 403, 'Direct unaudited write denied');
    }
  }
  const anonymousList = await apiJson(
    status,
    `/rest/v1/service_categories?select=${categorySelect}&limit=1`,
    status.ANON_KEY,
  );
  assert.equal(anonymousList.status, 401);
  queryLocal(`begin; do $$ begin
    begin delete from public.service_categories where id=${sqlValue(category.id)}; raise exception 'Missing delete guard';
      exception when insufficient_privilege then null; end;
    begin truncate public.service_categories cascade; raise exception 'Missing truncate guard';
      exception when insufficient_privilege then null; end;
    begin update public.service_categories set slug=slug || '-changed' where id=${sqlValue(category.id)}; raise exception 'Missing immutable slug guard';
      exception when sqlstate 'PT409' then null; end;
    end $$; rollback;`);
  assert.equal(
    queryLocal(
      "select count(*) from pg_policies where schemaname='public' and tablename='service_categories' and cmd <> 'SELECT';",
    ),
    '0',
  );
  checks.push(
    'Anonymous catalogue denial; admin/client/barber/service-key POST/PATCH/DELETE/PUT/upsert denied; privileged DELETE/TRUNCATE/slug guards; no delete policy',
  );
  evidence = {
    ticket: 'P1-T10 / TRIMR-40',
    result: 'PASS',
    transport: 'local Auth + Edge + PostgREST',
    checks,
    raceOutcomes,
  };
} finally {
  // Retain referenced/audited identities; hide disposable categories through the
  // public archive API instead of bypassing the deliberately permanent history.
  queryLocal(
    `update public.profiles set role='admin' where id=${sqlValue(users.admin)};`,
  );
  for (const id of categories)
    assert.equal(
      (await mutate('archive', { id })).status,
      200,
      'Fixture archive cleanup',
    );
}
console.log(JSON.stringify(evidence, null, 2));
