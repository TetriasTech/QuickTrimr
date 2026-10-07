import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

import {
  SHARED_ENUMS,
  USER_ROLE_VALUE,
} from '../../packages/shared/src/index.ts';

import {
  apiJson,
  apiRequest,
  assertDenied,
  assertRawBody,
  makeUsers,
} from './api-test-helpers.mjs';
import { insertSql, sqlValue } from './core-fixtures.mjs';
import { appendOnlyTables, coreTables } from './core-schema.mjs';
import { localStatus } from './local-api.mjs';
import { assertLocalProject, runLocal } from './local.mjs';
import { ownReadTables } from './rls-verification.mjs';
import {
  buildSeed,
  geoOrigin,
  geoRadiusMetres,
  renderSeed,
  seedId,
} from './seed-data.mjs';
import { applySeed } from './seed.mjs';
import { queryLocal, verifyPostgis } from './verify.mjs';

const fixture = buildSeed();
const readJson = (sql) => JSON.parse(queryLocal(sql));
const hash = (value) => createHash('sha256').update(value).digest('hex');

function dataFingerprint(includeAuth = true) {
  const parts = coreTables.map(
    (table) =>
      `${sqlValue(table)}, (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]') from public.${table} t)`,
  );
  if (includeAuth)
    parts.push(
      `'auth', (select jsonb_agg(to_jsonb(u) order by u.id) from auth.users u where u.id in (${fixture.auth.map((u) => sqlValue(u.id)).join(',')}))`,
    );
  // Full row values are hashed in memory, never printed, including Auth internals.
  return hash(queryLocal(`select jsonb_build_object(${parts.join(',')});`));
}

function securityFingerprint() {
  return hash(
    queryLocal(`select jsonb_build_object(
    'policies', (select jsonb_agg(to_jsonb(p) order by tablename, policyname) from pg_policies p where schemaname = 'public'),
    'rls_acl', (select jsonb_agg(jsonb_build_object('name', c.relname, 'rls', c.relrowsecurity, 'acl', c.relacl) order by c.relname)
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','v')),
    'column_acl', (select jsonb_agg(jsonb_build_object('table', c.relname, 'column', a.attname, 'acl', a.attacl) order by c.relname, a.attnum)
      from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and a.attnum>0 and not a.attisdropped),
    'triggers', (select jsonb_agg(pg_get_triggerdef(t.oid) order by c.relname,t.tgname) from pg_trigger t join pg_class c on c.oid=t.tgrelid
      join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal),
    'helpers', (select jsonb_agg(pg_get_functiondef(p.oid) order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'));`),
  );
}

function checkDataset() {
  const counts = readJson(
    `select jsonb_build_object(${coreTables.map((t) => `${sqlValue(t)}, (select count(*) from public.${t})`).join(',')});`,
  );
  assert.deepEqual(
    counts,
    Object.fromEntries(coreTables.map((t) => [t, fixture.rows[t].length])),
  );
  assert.equal(
    queryLocal('select count(*) from auth.users;'),
    String(fixture.auth.length),
  );
  assert.equal(
    queryLocal(
      `select count(*) from auth.users where email not like 'quicktrimr-seed-%@example.com' or encrypted_password is not null or phone is not null;`,
    ),
    '0',
  );
  const coverage = {
    'ENUM-USER-ROLE': ['profiles', 'role'],
    'ENUM-VERIFICATION-STATUS': ['profiles', 'verification_status'],
    'ENUM-BOOKING-TYPE': ['bookings', 'booking_type'],
    'ENUM-BOOKING-STATUS': ['bookings', 'status'],
    'ENUM-REQUEST-STATUS': ['booking_requests', 'status'],
    'ENUM-PAYMENT-STATUS': ['payments', 'status'],
    'ENUM-EARNING-STATUS': ['barber_earnings', 'status'],
    'ENUM-PAYOUT-STATUS': ['payout_batches', 'status'],
    'ENUM-AVAIL-STATUS': ['available_now_sessions', 'status'],
    'ENUM-DISPUTE-STATUS': ['disputes', 'status'],
    'ENUM-RELIABILITY-LEVEL': ['barber_reliability_state', 'level'],
  };
  for (const [id, [table, column]] of Object.entries(coverage))
    assert.deepEqual(
      readJson(
        `select json_agg(v order by v) from (select distinct ${column}::text v from public.${table}) s;`,
      ),
      [...SHARED_ENUMS[id]].sort(),
    );
  assert.equal(
    queryLocal(`select count(*) from public.bookings b left join public.booking_status_history h on h.booking_id=b.id
    where h.id is null or h.to_status<>b.status or h.from_status is not null or h.actor_id is not null or h.actor_role is not null;`),
    '0',
  );
  assert.equal(
    queryLocal(
      `select count(*) from public.bookings where gross_cents <> commission_cents + barber_net_cents;`,
    ),
    '0',
  );
  assert.equal(
    queryLocal(`select count(*) from public.barber_earnings e join public.payments p on p.booking_id=e.booking_id
    where e.gross_cents-p.refunded_cents <> e.commission_cents+e.barber_net_cents;`),
    '0',
  );
  console.log(
    `Seed coverage: PASS (21 tables; 8 credential-free synthetic Auth identities; all 11 shared enum sets; ${fixture.rows.bookings.length} bookings with initial history; integer-cent snapshots/refund examples).`,
  );
}

function checkNonDestructive() {
  const service = fixture.rows.barber_services[0];
  const unrelated = { id: randomUUID() };
  const correction = {
    ...fixture.rows.audit_logs[0],
    id: randomUUID(),
    action: 'local_seed_correction',
    reason: 'Synthetic appended correction, not a mutation.',
  };
  queryLocal(`begin; ${insertSql('service_categories', unrelated)} ${insertSql('audit_logs', correction)}
    update public.barber_services set price_cents=price_cents+1 where id=${sqlValue(service.id)}; commit;`);
  const changed = dataFingerprint();
  applySeed();
  assert.equal(
    dataFingerprint(),
    changed,
    'Rerun changed edited, appended or unrelated data.',
  );
  assert.equal(
    queryLocal(
      `select service_price_cents from public.bookings where id=${sqlValue(seedId('booking/requested'))};`,
    ),
    '4500',
  );
  const failed = renderSeed()
    .replace(
      'begin;',
      `begin; ${insertSql('service_categories', { id: randomUUID() })}`,
    )
    .replace('commit;', 'select 1 / 0; commit;');
  assert.throws(() => queryLocal(failed), /Local database query failed/);
  assert.equal(
    dataFingerprint(),
    changed,
    'Failed seed did not roll back atomically.',
  );
  console.log(
    'Rerun safety: PASS (edited service/timestamp, appended audit correction and unrelated row preserved; original booking snapshot unchanged; injected failure rolls back every insert).',
  );
}

function checkGeography() {
  const point = `extensions.st_setsrid(extensions.st_point(${geoOrigin.join(',')}),4326)::extensions.geography`;
  const query = `select id from public.barber_profiles where extensions.st_dwithin(service_area, ${point}, ${geoRadiusMetres}) order by id limit 10`;
  const matches = readJson(
    `select coalesce(json_agg(id),'[]') from (${query}) s;`,
  );
  assert.ok(matches.length > 0 && matches.length < fixture.barbers.length);
  assert.equal(
    queryLocal(
      `select count(*) from public.barber_profiles where extensions.st_distance(service_area, ${point}) > 25000;`,
    ),
    '0',
  );
  // Tiny fixtures normally favour seq scans. This proves the actual index is
  // eligible, not a production-scale performance benchmark or natural planner choice.
  const plan = queryLocal(
    `begin; set local enable_seqscan=off; explain (format json) ${query}; rollback;`,
  );
  assert.match(plan, /barber_service_area_gist/);
  console.log(
    `PostGIS fixture probe: PASS (${matches.length}/${fixture.barbers.length} within test-only ${geoRadiusMetres}m; all within 25km; LIMIT 10; existing GiST index eligible with seqscan disabled).`,
  );
}

async function seedSessions(status) {
  const identities = [
    fixture.admin,
    ...fixture.clients,
    seedId('user/barber/verified'),
    seedId('user/barber/not_started'),
  ];
  const sessions = [];
  // Relationship-only seed Auth rows aren't login-ready. Normalize GoTrue's
  // local Auth instance/text placeholders only for these disposable tests. A null
  // instance ID is not found by GoTrue, which would try to create a duplicate email.
  // No password is set; final reset removes sessions/links/compatibility edits.
  queryLocal(`update auth.users set instance_id='00000000-0000-0000-0000-000000000000',
    email_change='', confirmation_token='', recovery_token='',
    email_change_token_new='', email_change_token_current='', reauthentication_token='',
    phone_change='', phone_change_token=''
    where id in (${identities.map(sqlValue).join(',')});`);
  for (const id of identities) {
    const user = fixture.auth.find((u) => u.id === id);
    const generated = await apiJson(
      status,
      '/auth/v1/admin/generate_link',
      status.SERVICE_ROLE_KEY,
      {
        method: 'POST',
        body: JSON.stringify({ type: 'magiclink', email: user.email }),
      },
    );
    assert.equal(
      generated.status,
      200,
      'Local seed Auth link generation failed; body suppressed.',
    );
    assert.ok(
      typeof generated.body.hashed_token === 'string',
      'Local Auth token unavailable; body suppressed.',
    );
    const verified = await apiJson(status, '/auth/v1/verify', status.ANON_KEY, {
      method: 'POST',
      body: JSON.stringify({
        type: 'email',
        token_hash: generated.body.hashed_token,
      }),
    });
    assert.equal(
      verified.status,
      200,
      'Local seed Auth verification failed; body suppressed.',
    );
    assert.ok(
      verified.body.user?.id === id &&
        typeof verified.body.access_token === 'string',
      'Local session identity mismatch; values suppressed.',
    );
    sessions.push({
      id,
      token: verified.body.access_token,
      role: fixture.rows.profiles.find((r) => r.id === id).role,
    });
  }
  return sessions; // Never log tokens, link bodies, Auth internals or private rows.
}

function expectedRead(identity, table, row) {
  if (identity.role === USER_ROLE_VALUE.ADMIN) return true;
  if (!ownReadTables[identity.role]?.includes(table)) return false;
  if (['profiles', 'client_profiles', 'barber_profiles'].includes(table))
    return row.id === identity.id;
  if (['disputes', 'reviews'].includes(table)) {
    const booking = fixture.rows.bookings.find((b) => b.id === row.booking_id);
    return (
      (identity.role === USER_ROLE_VALUE.CLIENT
        ? booking.client_id
        : booking.barber_id) === identity.id
    );
  }
  return (
    (identity.role === USER_ROLE_VALUE.CLIENT
      ? row.client_id
      : row.barber_id) === identity.id
  );
}

async function candidates(status) {
  const { users } = await makeUsers(status);
  queryLocal(`begin;
    ${[users.candidateClient, users.candidateBarber, users.barberA]
      .map((id) =>
        insertSql('profiles', {
          id,
          role: id === users.candidateClient ? 'client' : 'barber',
          verification_status: 'not_started',
        }),
      )
      .join('\n')}
    ${insertSql('barber_profiles', { id: users.barberA })} commit;`);
  const rows = Object.fromEntries(
    coreTables.map((table) => [
      table,
      { ...fixture.rows[table][0], id: randomUUID() },
    ]),
  );
  rows.profiles.id = users.candidateProfile;
  rows.client_profiles.id = users.candidateClient;
  rows.barber_profiles.id = users.candidateBarber;
  rows.available_now_sessions.status = SHARED_ENUMS['ENUM-AVAIL-STATUS'].find(
    (s) => s === 'expired',
  );
  rows.barber_earnings.booking_id = seedId('booking/requested');
  rows.barber_earnings.barber_id = seedId('user/barber/verified');
  rows.reviews.booking_id = seedId('booking/paid_confirmed');
  rows.barber_reliability_state.id = users.barberA;
  queryLocal(
    `begin; ${coreTables.map((t) => insertSql(t, rows[t])).join('\n')} rollback;`,
  );
  return rows; // Every POST has an independently successful, rolled-back SQL control.
}

async function checkApi(status) {
  const sessions = await seedSessions(status);
  const postRows = await candidates(status);
  const before = dataFingerprint(false);
  let positive = 0,
    negative = 0,
    heads = 0,
    writes = 0;
  const rowPath = (table, id) =>
    `/rest/v1/${table}?id=eq.${id}&select=*&limit=1`;
  for (const table of coreTables) {
    const samples = fixture.rows[table]
      .filter(
        (row, i) =>
          i < 2 ||
          (['profiles', 'client_profiles', 'barber_profiles'].includes(table) &&
            sessions.some((s) => s.id === row.id)) ||
          row.barber_id === seedId('user/barber/verified'),
      )
      .slice(0, 5);
    for (const row of samples) {
      const path = rowPath(table, row.id);
      const control = await apiJson(status, path, status.SERVICE_ROLE_KEY);
      assert.equal(control.status, 200);
      assert.equal(
        control.body.length,
        1,
        `${table}: API fixture positive control.`,
      );
      for (const session of sessions) {
        const allowed = expectedRead(session, table, row);
        const result = await apiJson(status, path, session.token);
        assert.equal(result.status, 200);
        assertRawBody(
          result.body,
          allowed ? control.body : [],
          `${table}: seeded ownership read`,
        );
        if (allowed) positive++;
        else negative++;
        const head = await apiRequest(status, path, session.token, {
          method: 'HEAD',
          headers: { prefer: 'count=exact' },
        });
        assert.equal(head.status, 200);
        assert.ok(
          head.headers.get('content-range')?.endsWith(allowed ? '/1' : '/0'),
          `${table}: count privacy.`,
        );
        assert.equal(await head.text(), '');
        heads++;
        for (const method of ['POST', 'PATCH', 'DELETE']) {
          await assertDenied(
            status,
            method === 'POST' ? `/rest/v1/${table}` : path,
            session.token,
            {
              method,
              ...(method === 'POST'
                ? { body: postRows[table], httpStatus: 403, code: '42501' }
                : {}),
              ...(method === 'PATCH'
                ? { body: { updated_at: '2000-01-01T00:00:00Z' } }
                : {}),
            },
          );
          writes++;
        }
        for (const method of ['PUT', 'UPSERT']) {
          const changed = await apiJson(
            status,
            method === 'PUT'
              ? `/rest/v1/${table}?id=eq.${row.id}`
              : `/rest/v1/${table}`,
            session.token,
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
          assert.equal(changed.status, 403);
          assert.ok(
            changed.body.code === '42501',
            `${table}: ${method} must fail RLS, not invalid input.`,
          );
          writes++;
        }
      }
    }
  }
  // Projection allowlists, pending/finished embeddings and missing/forged JWTs.
  const fields = [
    'id',
    'booking_id',
    'status',
    'gross_cents',
    'refunded_cents',
    'created_at',
    'updated_at',
  ];
  for (const session of sessions) {
    const publicBarber = await apiJson(
      status,
      rowPath('public_barber_profiles', seedId('user/barber/verified')),
      session.token,
    );
    assert.equal(publicBarber.status, 200);
    assertRawBody(
      publicBarber.body,
      [{ id: seedId('user/barber/verified') }],
      'Seed public barber allowlist',
    );
    for (const row of fixture.rows.payments.slice(0, 2)) {
      const control = await apiJson(
        status,
        rowPath('payments', row.id),
        status.SERVICE_ROLE_KEY,
      );
      const owner = fixture.rows.bookings.find(
        (b) => b.id === row.booking_id,
      ).client_id;
      const safe = await apiJson(
        status,
        rowPath('client_payments', row.id),
        session.token,
      );
      assert.equal(safe.status, 200);
      assertRawBody(
        safe.body,
        session.role === 'client' && session.id === owner
          ? [Object.fromEntries(fields.map((f) => [f, control.body[0][f]]))]
          : [],
        'Seed payment allowlist',
      );
    }
  }
  const barber = sessions.find((s) => s.role === 'barber');
  for (const name of ['requested', 'completed', 'cancelled_before_capture']) {
    const result = await apiJson(
      status,
      `/rest/v1/bookings?id=eq.${seedId(`booking/${name}`)}&select=id,client_profiles(*)&limit=1`,
      barber.token,
    );
    assert.equal(result.status, 200);
    assertRawBody(
      result.body,
      [{ id: seedId(`booking/${name}`), client_profiles: null }],
      'Seed client embedding privacy',
    );
  }
  for (const token of [undefined, 'forged.jwt.value']) {
    const result = await apiJson(
      status,
      rowPath('bookings', fixture.rows.bookings[0].id),
      token,
    );
    assert.equal(result.status, 401);
  }
  for (const table of appendOnlyTables) {
    for (const method of ['PATCH', 'DELETE']) {
      await assertDenied(
        status,
        rowPath(table, fixture.rows[table][0].id),
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
    queryLocal(`begin; do $$ begin
      begin truncate public.${table}; raise exception 'Missing immutable guard';
      exception when sqlstate '55000' then null; end;
    end $$; rollback;`);
  }
  assert.equal(
    dataFingerprint(false),
    before,
    'Denied API writes altered stored data.',
  );
  console.log(
    `Seed API: PASS (${positive} own/admin positives, ${negative} cross-user/private negatives, ${heads} HEAD counts, ${writes} denied POST/PATCH/DELETE/PUT/upserts; all 21 tables/five identities; raw views/embeddings; missing/forged JWTs; 9 privileged immutable denials; application rows unchanged).`,
  );
}

let resetAllowed = false;
let initial;
try {
  assert.deepEqual(
    process.argv.slice(2),
    ['--allow-local-reset'],
    'db:test:seed erases QuickTrimr local data. Use --allow-local-reset only on a disposable stack.',
  );
  assertLocalProject();
  const status = localStatus();
  verifyPostgis();
  resetAllowed = true;
  assert.equal(runLocal('reset'), 0, 'First seeded local reset failed.');
  checkDataset();
  initial = dataFingerprint();
  const security = securityFingerprint();
  applySeed();
  assert.equal(
    dataFingerprint(),
    initial,
    'Second seed changed data/timestamps.',
  );
  assert.equal(runLocal('reset'), 0, 'Second seeded local reset failed.');
  checkDataset();
  assert.equal(
    dataFingerprint(),
    initial,
    'Reset did not reproduce full seed data.',
  );
  assert.equal(
    securityFingerprint(),
    security,
    'Reset changed policies/grants/guards.',
  );
  console.log(
    `Seed replay: PASS (reset → reseed → reset; identical complete application/Auth-fixture SHA-256: ${initial}).`,
  );
  checkNonDestructive();
  checkGeography();
  await checkApi(status);
  assert.equal(
    securityFingerprint(),
    security,
    'Seed/testing changed policies, column grants, RLS or immutable helpers.',
  );
  console.log(
    'Seed security metadata: PASS (policies, table/column ACLs, RLS, triggers and private helpers unchanged).',
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Live seed verification failed.',
  );
  process.exitCode = 1;
} finally {
  if (resetAllowed) {
    if (runLocal('reset') !== 0) {
      console.error(
        'Final local reset failed; disposable test data may remain.',
      );
      process.exitCode = 1;
    } else {
      try {
        checkDataset();
        if (initial)
          assert.equal(
            dataFingerprint(),
            initial,
            'Final cleanup did not restore pristine seeds.',
          );
        console.log(
          'Seed cleanup: PASS (pristine seed restored; disposable sessions/users/corrections removed).',
        );
      } catch {
        console.error(
          'Final seed cleanup verification failed; inspect the disposable local stack.',
        );
        process.exitCode = 1;
      }
    }
  }
}
