import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

import {
  AVAIL_STATUS_VALUE,
  SHARED_ENUMS,
  assertPostgresEnumValuesMatch,
} from '../../packages/shared/src/index.ts';

import { coreFixtures, insertSql, sqlValue } from './core-fixtures.mjs';
import {
  appendOnlyTables,
  coreTables,
  postgresEnumNames,
} from './core-schema.mjs';
import { localStatus } from './local-api.mjs';
import { projectId, runLocal } from './local.mjs';
import { queryLocal, verifyPostgis } from './verify.mjs';

const tablesSql = coreTables.map(sqlValue).join(',');
const catalog = (sql) => JSON.parse(queryLocal(sql));

function checkCatalog() {
  const tables =
    catalog(`select json_agg(json_build_object('name', c.relname, 'rls', c.relrowsecurity) order by c.relname)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r';`);
  assert.deepEqual(
    tables.map((table) => table.name),
    [...coreTables].sort(),
  );
  assert.ok(
    tables.every((table) => table.rls),
    'Every table must enable RLS.',
  );
  assert.equal(
    queryLocal("select count(*) from pg_policies where schemaname = 'public';"),
    '0',
  );
  const enums = catalog(`select json_object_agg(typname, labels) from (
    select t.typname, json_agg(e.enumlabel order by e.enumsortorder) labels from pg_type t
    join pg_namespace n on n.oid = t.typnamespace join pg_enum e on e.enumtypid = t.oid
    where n.nspname = 'public' group by t.typname) s;`);
  assert.deepEqual(
    Object.keys(enums).sort(),
    Object.values(postgresEnumNames).sort(),
  );
  for (const id of Object.keys(SHARED_ENUMS))
    assertPostgresEnumValuesMatch(id, enums[postgresEnumNames[id]]);
  assert.equal(
    queryLocal(
      "select count(*) from pg_extension where extname in ('postgis', 'pgcrypto');",
    ),
    '2',
  );
  const columns =
    catalog(`select json_agg(json_build_object('table', c.table_name, 'column', c.column_name,
    'type', c.udt_name, 'nullable', c.is_nullable, 'default', c.column_default) order by c.table_name, c.ordinal_position)
    from information_schema.columns c where c.table_schema = 'public';`);
  assert.ok(
    columns.every(
      (column) =>
        !['numeric', 'float4', 'float8', 'money'].includes(column.type),
    ),
    'No numeric/float/money column.',
  );
  const money = columns.filter((column) => column.column.endsWith('_cents'));
  assert.equal(money.length, 12);
  assert.ok(
    money.every(
      (column) =>
        column.type === 'int4' &&
        column.nullable === 'NO' &&
        column.default === null,
    ),
  );
  for (const name of [
    'service_price_cents',
    'commission_pct_snapshot',
    'gross_cents',
    'commission_cents',
    'barber_net_cents',
  ])
    assert.ok(
      columns.some(
        (column) =>
          column.table === 'bookings' &&
          column.column === name &&
          column.type === 'int4' &&
          column.default === null,
      ),
    );
  for (const table of coreTables) {
    for (const name of ['created_at', 'updated_at'])
      assert.ok(
        columns.some(
          (column) =>
            column.table === table &&
            column.column === name &&
            column.type === 'timestamptz' &&
            column.nullable === 'NO',
        ),
      );
  }
  assert.ok(
    columns.every(
      (column) =>
        column.default === null ||
        /^(now\(\)|gen_random_uuid\(\))$/.test(column.default),
    ),
    'No business defaults.',
  );
  for (const [table, expected] of Object.entries({
    booking_status_history: [
      'booking_id',
      'from_status',
      'to_status',
      'actor_id',
      'actor_role',
      'reason',
      'created_at',
    ],
    audit_logs: [
      'actor_id',
      'actor_role',
      'action',
      'entity_type',
      'entity_id',
      'previous_value',
      'new_value',
      'reason',
      'created_at',
      'metadata',
    ],
  }))
    for (const name of expected)
      assert.ok(
        columns.some(
          (column) => column.table === table && column.column === name,
        ),
      );
  const locations =
    catalog(`select json_agg(json_build_object('table', c.relname, 'column', a.attname,
    'type', format_type(a.atttypid, a.atttypmod))) from pg_attribute a join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace join pg_type t on t.oid = a.atttypid
    where n.nspname = 'public' and t.typname = 'geography' and a.attnum > 0;`);
  assert.equal(locations.length, 3);
  assert.ok(
    locations.every((column) => /geography\(Point,4326\)$/.test(column.type)),
  );
  const indexes = catalog(
    "select json_agg(json_build_object('table', tablename, 'definition', indexdef)) from pg_indexes where schemaname = 'public';",
  );
  for (const [table, column] of [
    ['available_now_sessions', 'location'],
    ['barber_profiles', 'service_area'],
  ])
    assert.ok(
      indexes.some(
        (index) =>
          index.table === table &&
          index.definition.includes(`USING gist (${column})`),
      ),
    );
  for (const [table, column] of [
    ['bookings', 'status'],
    ['bookings', 'barber_id'],
    ['bookings', 'client_id'],
    ['bookings', 'booking_type'],
    ['available_now_sessions', 'status'],
    ['payments', 'status'],
    ['disputes', 'status'],
  ])
    assert.ok(
      indexes.some(
        (index) =>
          index.table === table && index.definition.includes(`(${column})`),
      ),
    );
  for (const table of coreTables)
    assert.ok(
      indexes.some(
        (index) =>
          index.table === table && index.definition.includes('(created_at)'),
      ),
    );
  const fks =
    catalog(`select json_agg(json_build_object('name', c.conname, 'delete', c.confdeltype,
    'indexed', exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1] and i.indpred is null)))
    from pg_constraint c join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f' and n.nspname = 'public';`);
  assert.ok(
    fks.length > 0 && fks.every((fk) => fk.delete === 'r' && fk.indexed),
    'Every FK restricts deletion and is indexed.',
  );
  const grants =
    catalog(`select json_agg(json_build_object('role', r, 'table', t,
    'read', has_table_privilege(r, 'public.' || t, 'SELECT'),
    'write', has_table_privilege(r, 'public.' || t, 'INSERT') and has_table_privilege(r, 'public.' || t, 'UPDATE') and has_table_privilege(r, 'public.' || t, 'DELETE'),
    'truncate', has_table_privilege(r, 'public.' || t, 'TRUNCATE')))
    from unnest(array['anon','authenticated','service_role']) r cross join unnest(array[${tablesSql}]) t;`);
  assert.ok(
    grants.every((grant) => grant.read && grant.write && !grant.truncate),
    'DML grants exist: denial must come from RLS, not missing privileges. TRUNCATE must be revoked.',
  );
  assert.equal(
    queryLocal(
      "select count(*) from pg_roles where rolname in ('anon','authenticated') and (rolsuper or rolbypassrls);",
    ),
    '0',
  );
  console.log(
    `Catalog: PASS (${tables.length} tables/RLS, ${Object.keys(enums).length} enums, ${money.length} integer-cent columns, 3 geography columns, ${fks.length} indexed RESTRICT FKs, timestamps/indexes/defaults/grants).`,
  );
}

// Deliberately independent processes: concurrent SQL, not sequential awaits.
function runSqlAsync(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'docker',
      [
        'exec',
        `supabase_db_${projectId}`,
        'psql',
        '-X',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-A',
        '-t',
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        sql,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', () => {}); // Never forward fixtures or database error values.
    child.on('error', () =>
      reject(new Error('Local parallel SQL process failed.')),
    );
    child.on('close', (code) =>
      code === 0
        ? resolve(stdout.trim())
        : reject(new Error('Local parallel SQL check failed.')),
    );
  });
}

function expectSqlState(sql, expected) {
  const result = queryLocal(`do $$ begin
    begin ${sql} raise exception 'Expected SQLSTATE ${expected} was not raised';
    exception when sqlstate '${expected}' then null; end;
  end $$; select 'PASS';`);
  assert.ok(result.endsWith('PASS'));
}

function databaseSnapshot() {
  return queryLocal(
    `select json_build_object(${coreTables.map((table) => `${sqlValue(table)}, (select json_agg(row_to_json(t) order by t.id) from public.${table} t)`).join(',')});`,
  );
}

async function checkConstraints(fixtures, users) {
  for (const table of [
    'barber_earnings',
    'reviews',
    'available_now_sessions',
  ]) {
    const duplicate = { ...fixtures.rows[table], id: randomUUID() };
    expectSqlState(insertSql(table, duplicate), '23505');
    // Historical sessions remain valid: the unique predicate is not all statuses.
    if (table === 'available_now_sessions')
      queryLocal(
        `begin; ${insertSql(table, { ...duplicate, status: AVAIL_STATUS_VALUE.EXPIRED })} rollback;`,
      );
    for (let round = 0; round < 3; round++) {
      const contenders = [1, 2, 3].map(() => ({
        ...fixtures.candidates[table],
        id: randomUUID(),
      }));
      const raceName = `quicktrimr-core-${randomUUID()}`;
      const pending = Promise.allSettled(
        contenders.map((row) =>
          runSqlAsync(`set application_name = ${sqlValue(raceName)}; select pg_sleep(0.2); do $$ begin
        begin ${insertSql(table, row)} perform pg_sleep(1);
        exception when unique_violation then return; end;
      end $$; select count(*) from public.${table} where id = ${sqlValue(row.id)};`),
        ),
      );
      let contentionObserved = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        await setTimeout(50);
        if (
          Number(
            queryLocal(
              `select count(*) from pg_stat_activity where application_name = ${sqlValue(raceName)} and wait_event_type = 'Lock';`,
            ),
          ) > 0
        ) {
          contentionObserved = true;
          break;
        }
      }
      const results = await pending;
      const failure = results.find((result) => result.status === 'rejected');
      if (failure) throw failure.reason;
      const outcomes = results.map((result) => result.value);
      assert.ok(
        contentionObserved,
        `${table}: observe real lock contention, not just parallel process launch.`,
      );
      assert.equal(
        outcomes.filter((output) => output.endsWith('1')).length,
        1,
        `${table}: exactly one concurrent winner.`,
      );
      assert.equal(
        queryLocal(
          `select count(*) from public.${table} where id in (${contenders.map((row) => sqlValue(row.id)).join(',')});`,
        ),
        '1',
      );
      queryLocal(
        `delete from public.${table} where id in (${contenders.map((row) => sqlValue(row.id)).join(',')});`,
      );
    }
  }
  const before = databaseSnapshot();
  for (const sql of [
    `delete from auth.users where id = ${sqlValue(users.clientB)};`,
    `delete from public.profiles where id = ${sqlValue(users.clientB)};`,
    `delete from public.client_profiles where id = ${sqlValue(users.clientB)};`,
    `delete from public.barber_profiles where id = ${sqlValue(users.barberB)};`,
    `delete from public.bookings where id = ${sqlValue(fixtures.rows.bookings.id)};`,
    insertSql('payments', {
      ...fixtures.rows.payments,
      id: randomUUID(),
      booking_id: randomUUID(),
    }),
  ])
    expectSqlState(sql, '23503');
  assert.equal(
    databaseSnapshot(),
    before,
    'FK failures cannot lose financial records.',
  );
  for (const table of appendOnlyTables) {
    for (const action of ['update', 'delete', 'truncate']) {
      const sql =
        action === 'update'
          ? `update public.${table} set updated_at = now();`
          : `${action} ${action === 'delete' ? 'from' : 'table'} public.${table};`;
      expectSqlState(sql, '55000'); // postgres owner bypasses RLS; trigger must still reject.
    }
  }
  assert.equal(
    databaseSnapshot(),
    before,
    'Append-only failures cannot alter evidence.',
  );
  for (const table of coreTables.filter(
    (table) => !appendOnlyTables.includes(table),
  )) {
    const result = queryLocal(
      `begin; update public.${table} set updated_at = '2000-01-01' where id = ${sqlValue(fixtures.rows[table].id)} returning (updated_at = statement_timestamp() and updated_at > created_at)::text; rollback;`,
    );
    assert.ok(
      result.includes('true'),
      `${table}: update timestamp is server-controlled.`,
    );
  }
  for (const table of ['audit_logs', 'booking_status_history']) {
    const row = {
      ...fixtures.rows[table],
      id: randomUUID(),
      actor_id: null,
      actor_role: null,
    };
    queryLocal(`begin; ${insertSql(table, row)} rollback;`);
    expectSqlState(
      insertSql(table, { ...row, actor_role: fixtures.rows[table].actor_role }),
      '23514',
    );
  }
  queryLocal(
    `begin; update public.barber_services set price_cents = 4503 where id = ${sqlValue(fixtures.rows.barber_services.id)};` +
      ` do $$ begin if (select service_price_cents from public.bookings where id = ${sqlValue(fixtures.rows.bookings.id)}) <> 4500 then raise exception 'Live price changed booking snapshot'; end if; end $$; rollback;`,
  );
  console.log(
    'Constraints: PASS (3 uniqueness guards × 3 parallel rounds × 3 contenders; lock contention observed in all 9 races; historical sessions allowed; FK retention/dangling denial; 9 privileged append-only denials; 18 timestamp triggers; actor-pair integrity).',
  );
}

async function apiJson(status, path, token, options = {}) {
  const response = await fetch(new URL(path, status.API_URL), {
    ...options,
    headers: {
      apikey: status.ANON_KEY,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
      ...options.headers,
    },
    signal: AbortSignal.timeout(10000),
  });
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(
      `Local ${options.method ?? 'GET'} returned non-JSON (${response.status}); body suppressed.`,
    );
  }
  return { status: response.status, body };
}

async function makeUsers(status) {
  const users = {};
  const tokens = {};
  for (const name of [
    'clientA',
    'clientB',
    'barberA',
    'barberB',
    'candidateClient',
    'candidateBarber',
    'candidateProfile',
  ]) {
    const email = `core-${randomUUID()}@example.invalid`;
    const password = randomUUID() + randomUUID();
    const created = await apiJson(
      status,
      '/auth/v1/admin/users',
      status.SERVICE_ROLE_KEY,
      {
        method: 'POST',
        body: JSON.stringify({ email, password, email_confirm: true }),
      },
    );
    assert.equal(
      created.status,
      200,
      'Disposable local user creation failed; body suppressed.',
    );
    assert.match(created.body.id ?? '', /^[0-9a-f-]{36}$/);
    users[name] = created.body.id;
    if (['clientA', 'clientB', 'barberA', 'barberB'].includes(name)) {
      const login = await apiJson(
        status,
        '/auth/v1/token?grant_type=password',
        status.ANON_KEY,
        {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        },
      );
      assert.equal(
        login.status,
        200,
        'Local password authentication failed; body suppressed.',
      );
      assert.equal(
        login.body.user?.id,
        users[name],
        'Login returned the wrong fixture user.',
      );
      assert.ok(
        typeof login.body.access_token === 'string',
        'Local user JWT missing.',
      );
      tokens[name] = login.body.access_token;
    }
  }
  return { users, tokens };
}

async function checkApi(status, fixtures, tokens) {
  const before = databaseSnapshot();
  let checks = 0;
  let privilegedMutationDenials = 0;
  for (const table of coreTables) {
    const row = fixtures.rows[table];
    const path = `/rest/v1/${table}?select=*&id=eq.${row.id}`;
    const control = await apiJson(status, path, status.SERVICE_ROLE_KEY);
    assert.equal(
      control.status,
      200,
      `${table}: privileged API control failed.`,
    );
    assert.equal(
      control.body.length,
      1,
      `${table}: fixture must actually exist.`,
    );
    assert.equal(control.body[0].id, row.id);
    if (appendOnlyTables.includes(table)) {
      for (const method of ['PATCH', 'DELETE']) {
        const result = await apiJson(status, path, status.SERVICE_ROLE_KEY, {
          method,
          ...(method === 'PATCH'
            ? { body: JSON.stringify({ updated_at: '2000-01-01T00:00:00Z' }) }
            : {}),
        });
        assert.equal(
          result.status,
          500,
          `${table}: privileged ${method} must reject append-only mutation.`,
        );
        assert.equal(result.body.code, '55000');
        assert.equal(
          result.body.message,
          'Append-only records cannot be changed; append a correction.',
        );
        privilegedMutationDenials++;
      }
    }
    for (const [identity, token] of Object.entries({
      ...tokens,
      anon: status.ANON_KEY,
    })) {
      for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
        const result = await apiJson(
          status,
          method === 'POST' ? `/rest/v1/${table}` : path,
          token,
          {
            method,
            ...(method === 'POST'
              ? { body: JSON.stringify(fixtures.candidates[table]) }
              : {}),
            ...(method === 'PATCH'
              ? { body: JSON.stringify({ updated_at: '2000-01-01T00:00:00Z' }) }
              : {}),
          },
        );
        if (method === 'POST') {
          assert.equal(
            result.status,
            identity === 'anon' ? 401 : 403,
            `${identity} ${table} POST must be denied.`,
          );
          assert.equal(
            result.body.code,
            '42501',
            `${identity} ${table}: RLS error code expected.`,
          );
          assert.equal(result.body.details, null);
          assert.equal(result.body.hint, null);
          assert.ok(result.body.message.includes('row-level security'));
        } else {
          assert.equal(
            result.status,
            200,
            `${identity} ${table} ${method}: expected filtered denial.`,
          );
          assert.deepEqual(
            result.body,
            [],
            `${identity} ${table} ${method}: no fields may leak.`,
          );
        }
        checks++;
      }
    }
  }
  assert.equal(
    databaseSnapshot(),
    before,
    'Denied API writes cannot change any fixture.',
  );
  console.log(
    `API: PASS (${checks} raw-response denials; 4 real authenticated users + anon × 21 tables × GET/POST/PATCH/DELETE; 21 privileged positive controls; ${privilegedMutationDenials} privileged append-only API denials; database unchanged).`,
  );
  console.log(
    'Raw denial contract: GET/PATCH/DELETE = 200 []; POST = authenticated 403 / anon 401 {code:"42501",details:null,hint:null,message:"...row-level security..."}.',
  );
}

let resetAllowed = false;
try {
  assert.deepEqual(
    process.argv.slice(2),
    ['--allow-local-reset'],
    'db:test:core erases QuickTrimr local data. Use --allow-local-reset only on a disposable local stack.',
  );
  verifyPostgis();
  const status = localStatus();
  resetAllowed = true;
  assert.equal(runLocal('reset'), 0, 'Initial local reset failed.');
  checkCatalog();
  const { users, tokens } = await makeUsers(status);
  const fixtures = coreFixtures(users);
  queryLocal(
    `begin; ${[...fixtures.extra, ...Object.entries(fixtures.rows), ...fixtures.after].map(([table, row]) => insertSql(table, row)).join('\n')} commit;`,
  );
  // Prove POST payloads are valid with RLS bypassed, then roll back. Denial tests
  // must not merely exercise an invalid FK, primary key, or unique constraint.
  queryLocal(
    `begin; ${Object.entries(fixtures.candidates)
      .map(([table, row]) => insertSql(table, row))
      .join('\n')} rollback;`,
  );
  await checkConstraints(fixtures, users);
  await checkApi(status, fixtures, tokens);
  console.log('Core schema live verification: PASS.');
} catch (error) {
  // No Auth responses, request headers, SQL fixture values or keys in failure logs.
  console.error(
    error instanceof Error ? error.message : 'Core schema check failed.',
  );
  process.exitCode = 1;
} finally {
  if (resetAllowed) {
    if (runLocal('reset') !== 0) {
      console.error(
        'Final local reset failed; disposable fixtures may remain.',
      );
      process.exitCode = 1;
    } else
      console.log(
        'Fixture cleanup: PASS (local reset; no Auth/test rows retained).',
      );
  }
}
