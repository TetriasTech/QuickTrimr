import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

import { upsertBarberServiceResponseSchema } from '../../packages/validation/src/contracts/barber-service.ts';

import { apiJson, assertRawBody, makeUsers } from './api-test-helpers.mjs';
import { coreFixtures, insertSql, sqlValue } from './core-fixtures.mjs';
import { localStatus } from './local-api.mjs';
import { projectId } from './local.mjs';
import { queryLocal } from './verify.mjs';

const status = localStatus();
const read = (sql) => JSON.parse(queryLocal(sql));
const { users, tokens } = await makeUsers(status, {
  additional: ['admin', 'unprofiled'],
  adversarialMetadata: true,
});
const fixtures = coreFixtures(users);
queryLocal(
  `begin; ${[
    ...fixtures.extra,
    ['profiles', fixtures.rows.profiles],
    [
      'profiles',
      { id: users.admin, role: 'admin', verification_status: 'not_started' },
    ],
    ['client_profiles', fixtures.rows.client_profiles],
    ['barber_profiles', fixtures.rows.barber_profiles],
    ['barber_profiles', { id: users.barberA }],
  ]
    .map(([table, row]) => insertSql(table, row))
    .join('\n')} commit;`,
);
const invoke = (name, body, token) =>
  apiJson(status, `/functions/v1/${name}`, token, {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
const upsert = (
  category,
  priceCents = 4500,
  token = tokens.barberB,
  enabled = true,
) =>
  invoke(
    'upsert-barber-service',
    { serviceCategoryId: category.id, priceCents, enabled },
    token,
  );
const archive = (serviceId, token = tokens.barberB) =>
  invoke('archive-barber-service', { serviceId }, token);
const categoryInput = (c, extra = {}) => ({
  id: c.id,
  displayName: c.displayName,
  description: c.description,
  displayOrder: c.displayOrder,
  minPriceCents: c.minPriceCents,
  maxPriceCents: c.maxPriceCents,
  ...extra,
});
const categories = [];
const checks = [];
let evidence;
const audits = (id) =>
  read(
    `select coalesce(json_agg(json_build_object('actor',actor_id,'role',actor_role,'action',action,'before',previous_value,'after',new_value) order by created_at,id),'[]') from public.audit_logs where entity_type='barber_services' and entity_id=${sqlValue(id)};`,
  );
const snapshot = () =>
  queryLocal(
    `select jsonb_build_object('booking',(select to_jsonb(b) from public.bookings b where id=${sqlValue(fixtures.rows.bookings.id)}), 'line',(select to_jsonb(b) from public.booking_services b where id=${sqlValue(fixtures.rows.booking_services.id)}));`,
  );
async function createCategory() {
  const result = await invoke(
    'create-service-category',
    {
      slug: `pricing-fixture-${randomUUID()}`,
      displayName: 'Synthetic pricing category',
      displayOrder: 9,
      minPriceCents: 2000,
      maxPriceCents: 15000,
    },
    tokens.admin,
  );
  assert.equal(result.status, 200, 'Fixture category create');
  categories.push(result.body.id);
  return result.body;
}

// A controlled lock barrier proves overlapping requests in both lock orders.
// Only this test transaction holds a lock; application RPCs perform no network I/O.
async function holdProfile(id) {
  const child = spawn(
    'docker',
    [
      'exec',
      '-i',
      `supabase_db_${projectId}`,
      'psql',
      '-X',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  const completed = new Promise((resolve, reject) => {
    child.on('error', () => reject(new Error('Barrier process failed')));
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error('Barrier transaction failed')),
    );
  });
  child.stderr.on('data', () => {});
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stdin.write(
    `begin; select pg_backend_pid(); select 1 from public.profiles where id=${sqlValue(id)} for update;\n\\echo READY\n`,
  );
  for (let attempt = 0; attempt < 50 && !output.includes('READY'); attempt++)
    await setTimeout(20);
  if (!output.includes('READY')) {
    child.stdin.end('rollback;\n');
    await completed;
    throw new Error('Barrier did not become ready');
  }
  const pid = Number(output.split('\n').find((s) => /^\d+$/.test(s)));
  return {
    pid,
    async release() {
      if (!child.stdin.writableEnded) child.stdin.end('commit;\n');
      await completed;
    },
  };
}
async function waitBlocked(pid, rpc) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const found = queryLocal(
      `select count(*) from pg_stat_activity where ${pid}=any(pg_blocking_pids(pid)) and query like '%${rpc}%';`,
    );
    if (Number(found) > 0) return;
    await setTimeout(20);
  }
  throw new Error('Expected blocked API request was not observed');
}

try {
  let category = await createCategory();
  const writeCategory = await createCategory();
  for (const endpoint of ['upsert-barber-service', 'archive-barber-service']) {
    for (const token of [undefined, 'forged.jwt.value', status.ANON_KEY])
      assert.equal(
        (await invoke(endpoint, '{', token)).status,
        401,
        'Auth denial',
      );
    for (const name of ['clientA', 'admin', 'unprofiled']) {
      const denied = await invoke(endpoint, '{', tokens[name]);
      assert.equal(denied.status, 403);
      assertRawBody(
        denied.body,
        { error: 'forbidden' },
        'Role gate before validation',
      );
    }
  }
  const concurrent = await Promise.all(
    Array.from({ length: 6 }, () => upsert(category)),
  );
  for (const result of concurrent) assert.equal(result.status, 200);
  let service = concurrent[0].body;
  upsertBarberServiceResponseSchema.parse(service);
  for (const result of concurrent)
    assertRawBody(result.body, service, 'One concurrent upsert identity');
  assertRawBody(
    audits(service.id),
    [
      {
        actor: users.barberB,
        role: 'barber',
        action: 'barber_service.created',
        before: null,
        after: service,
      },
    ],
    'One exact creation audit',
  );
  assert.equal(
    queryLocal(
      `select count(*) from public.barber_services where barber_id=${sqlValue(users.barberB)} and service_category_id=${sqlValue(category.id)};`,
    ),
    '1',
  );
  checks.push(
    'All auth/role denials precede parsing; six parallel identical creates produce one ID/row/audit',
  );

  fixtures.rows.booking_services.barber_service_id = service.id;
  queryLocal(
    `begin; ${['booking_requests', 'bookings', 'booking_services'].map((table) => insertSql(table, fixtures.rows[table])).join('\n')} commit;`,
  );
  const bookingBefore = snapshot();
  for (const [price, expected] of [
    [1999, 422],
    [2000, 200],
    [2001, 200],
    [14999, 200],
    [15000, 200],
    [15001, 422],
    [4500.5, 422],
    [-1, 422],
    [2147483648, 422],
  ]) {
    const result = await upsert(category, price);
    assert.equal(result.status, expected, `Boundary ${price}`);
    if (expected === 422) assert.ok(result.body.fields.priceCents);
    else {
      assert.equal(result.body.id, service.id);
      assert.equal(result.body.priceCents, price);
    }
  }
  service = (await upsert(category)).body;
  const beforePrice = service;
  service = (await upsert(category, 4550)).body;
  assertRawBody(
    audits(service.id).at(-1),
    {
      actor: users.barberB,
      role: 'barber',
      action: 'barber_service.updated',
      before: beforePrice,
      after: service,
    },
    'Exact repricing audit',
  );
  assert.equal(snapshot(), bookingBefore);
  assert.equal(
    queryLocal(
      `select pg_typeof(price_cents)::text from public.barber_services where id=${sqlValue(service.id)};`,
    ),
    'integer',
  );
  checks.push(
    'Both bounds and adjacent cents; fractional/negative/overflow rejection; 45.50 stored as 4550 integer cents; exact repricing audit; pre-existing booking unchanged',
  );

  const other = (await upsert(category, 3500, tokens.barberA)).body;
  for (const [token, id] of [
    [tokens.barberA, service.id],
    [tokens.barberB, other.id],
    [tokens.clientA, service.id],
  ]) {
    const result = await apiJson(
      status,
      `/rest/v1/barber_services?id=eq.${id}&select=id,price_cents,archived_at`,
      token,
    );
    assert.equal(result.status, 200);
    assertRawBody(result.body, [], 'Cross-owner read denial');
  }
  assert.equal((await archive(other.id)).status, 404);
  const forged = await invoke(
    'upsert-barber-service',
    {
      serviceCategoryId: category.id,
      priceCents: 4550,
      enabled: true,
      userId: users.barberA,
    },
    tokens.barberB,
  );
  assert.equal(forged.body.id, service.id);
  assert.equal(
    queryLocal(
      `select price_cents from public.barber_services where id=${sqlValue(other.id)};`,
    ),
    '3500',
  );
  assert.equal(
    (
      await invoke(
        'upsert-barber-service',
        {
          serviceCategoryId: category.id,
          priceCents: 4550,
          enabled: true,
          barberId: users.barberA,
        },
        tokens.barberB,
      )
    ).status,
    422,
  );
  const embedded = await apiJson(
    status,
    `/rest/v1/service_categories?id=eq.${category.id}&select=id,services:barber_services(id,price_cents,archived_at)&services.barber_id=eq.${users.barberB}`,
    tokens.barberB,
  );
  assert.equal(embedded.status, 200);
  assertRawBody(
    embedded.body,
    [
      {
        id: category.id,
        services: [{ id: service.id, price_cents: 4550, archived_at: null }],
      },
    ],
    'Embedded catalogue owner-only prices',
  );
  checks.push(
    'Cross-barber/client raw reads denied; foreign archive 404; forged owner cannot redirect writes; joined catalogue contains only own service',
  );

  const raw = read(
    `select to_jsonb(s) from public.barber_services s where id=${sqlValue(service.id)};`,
  );
  for (const token of [
    tokens.clientA,
    tokens.barberA,
    tokens.barberB,
    tokens.admin,
    status.SERVICE_ROLE_KEY,
  ]) {
    for (const method of ['POST', 'PATCH', 'DELETE', 'PUT', 'UPSERT']) {
      const result = await apiJson(
        status,
        `/rest/v1/barber_services${['POST', 'UPSERT'].includes(method) ? '' : `?id=eq.${service.id}`}`,
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
                    ? {
                        ...raw,
                        id: randomUUID(),
                        service_category_id: writeCategory.id,
                      }
                    : method === 'PATCH'
                      ? { price_cents: 4600 }
                      : raw,
                ),
              }),
        },
      );
      assert.equal(result.status, 403, 'Unaudited DML denied');
      assert.equal(result.body.code, '42501');
    }
  }
  const direct = await apiJson(
    status,
    '/rest/v1/rpc/manage_barber_service',
    tokens.barberB,
    {
      method: 'POST',
      body: JSON.stringify({
        p_user_id: users.barberA,
        p_operation: 'upsert',
        p_input: {},
      }),
    },
  );
  assert.equal(direct.status, 403);
  queryLocal(`begin; do $$ begin
    begin delete from public.barber_services where id=${sqlValue(service.id)}; raise exception 'Missing delete guard'; exception when insufficient_privilege then null; end;
    begin truncate public.barber_services cascade; raise exception 'Missing truncate guard'; exception when insufficient_privilege then null; end;
    begin update public.barber_services set barber_id=${sqlValue(users.barberA)} where id=${sqlValue(service.id)}; raise exception 'Missing ownership guard'; exception when insufficient_privilege then null; end;
    end $$; rollback;`);
  checks.push(
    '25 direct POST/PATCH/DELETE/PUT/upsert denials; client RPC denied; privileged delete/truncate/owner-reassignment guarded',
  );

  const archiveBefore = audits(service.id).length;
  const archived = await Promise.all(
    Array.from({ length: 4 }, () => archive(service.id)),
  );
  for (const result of archived) {
    assert.equal(result.status, 200);
    assertRawBody(
      result.body,
      archived[0].body,
      'Idempotent archive timestamp',
    );
  }
  assert.equal(audits(service.id).length, archiveBefore + 1);
  assert.equal(snapshot(), bookingBefore);
  const reactivated = await upsert(category, 4700);
  assert.equal(reactivated.body.id, service.id);
  assert.equal(reactivated.body.archivedAt, null);
  const off = await upsert(category, 4700, tokens.barberB, false);
  assert.equal(off.body.enabled, false);
  assert.ok(off.body.archivedAt);
  assert.equal(
    (await archive(service.id)).body.archivedAt,
    off.body.archivedAt,
  );
  service = (await upsert(category)).body;
  checks.push(
    'Four parallel archives have one timestamp/audit; historical rows retained; re-enable keeps ID; enabled=false archives; snapshots unchanged',
  );

  const priorAudit = audits(service.id).length;
  queryLocal(`create function private.service_audit_failure_probe() returns trigger language plpgsql as $$ begin
    if new.entity_type='barber_services' and new.entity_id=${sqlValue(service.id)}::uuid then raise exception 'Synthetic audit failure'; end if; return new; end $$;
    create trigger service_audit_failure_probe before insert on public.audit_logs for each row execute function private.service_audit_failure_probe();`);
  try {
    assert.equal((await upsert(category, 4900)).status, 500);
    assert.equal(audits(service.id).length, priorAudit);
    assert.equal(
      queryLocal(
        `select price_cents from public.barber_services where id=${sqlValue(service.id)};`,
      ),
      '4500',
    );
  } finally {
    queryLocal(
      'drop trigger service_audit_failure_probe on public.audit_logs; drop function private.service_audit_failure_probe();',
    );
  }
  checks.push('Injected audit failure rolls back price and audit together');

  const raceOutcomes = [];
  for (const winner of ['category', 'price'])
    for (let round = 0; round < 3; round++) {
      category = (
        await invoke(
          'update-service-category',
          categoryInput(category, { maxPriceCents: 15000 }),
          tokens.admin,
        )
      ).body;
      assert.equal((await upsert(category)).status, 200);
      const barrier = await holdProfile(
        winner === 'category' ? users.barberB : users.admin,
      );
      let blocked;
      try {
        blocked =
          winner === 'category'
            ? upsert(category, 6000)
            : invoke(
                'update-service-category',
                categoryInput(category, { maxPriceCents: 5000 }),
                tokens.admin,
              );
        await waitBlocked(
          barrier.pid,
          winner === 'category'
            ? 'manage_barber_service'
            : 'manage_service_category',
        );
        const winning = (
          winner === 'category'
            ? invoke(
                'update-service-category',
                categoryInput(category, { maxPriceCents: 5000 }),
                tokens.admin,
              )
            : upsert(category, 6000)
        ).finally(() => barrier.release());
        const results = await Promise.all([blocked, winning]);
        assert.deepEqual(
          results.map((r) => r.status),
          winner === 'category' ? [422, 200] : [409, 200],
        );
        assert.equal(
          queryLocal(
            `select count(*) from public.barber_services s join public.service_categories c on c.id=s.service_category_id where c.id=${sqlValue(category.id)} and s.archived_at is null and (s.price_cents<c.min_price_cents or s.price_cents>c.max_price_cents);`,
          ),
          '0',
        );
        raceOutcomes.push({ winner, statuses: results.map((r) => r.status) });
      } finally {
        await barrier.release();
        if (blocked) await blocked;
      }
    }
  assert.equal(snapshot(), bookingBefore);
  checks.push(
    'Six observed overlapping API races, three of each winner: current bounds enforced and all booking snapshots unchanged',
  );
  assert.equal(
    (
      await invoke(
        'archive-service-category',
        { id: category.id },
        tokens.admin,
      )
    ).status,
    200,
  );
  assert.equal((await upsert(category)).status, 404);
  assert.equal(
    (await upsert({ id: randomUUID() })).body.error,
    'category_unavailable',
  );
  assert.equal(
    (await archive(service.id)).status,
    200,
    'Still allow own service archive under archived category',
  );
  assert.equal(snapshot(), bookingBefore);
  queryLocal(
    `update public.profiles set role='client' where id=${sqlValue(users.barberA)};`,
  );
  assert.equal(
    (await upsert(writeCategory, 4500, tokens.barberA)).status,
    403,
    'Immediate role revocation',
  );
  checks.push(
    'Unknown/archived categories reject upsert; own archive still works; database role revocation applies to existing JWT',
  );
  evidence = {
    ticket: 'P1-T11 / TRIMR-41',
    result: 'PASS',
    transport: 'local Auth + Edge + PostgREST',
    checks,
    raceOutcomes,
  };
} finally {
  for (const id of categories)
    assert.equal(
      (await invoke('archive-service-category', { id }, tokens.admin)).status,
      200,
      'Archive fixture category',
    );
}
console.log(JSON.stringify(evidence, null, 2));
