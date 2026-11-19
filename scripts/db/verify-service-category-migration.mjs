import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { insertSql } from './core-fixtures.mjs';
import { assertLocalProject, projectId, root } from './local.mjs';
import { buildSeed, launchCategories, renderSeed } from './seed-data.mjs';

// Clone platform DDL only, then replay repo migrations in a separate, disposable
// database. No Auth/secret/address data is copied and the user's stack is never reset.
assertLocalProject();
assert.equal(
  process.argv.length,
  2,
  'This verifier accepts no target overrides.',
);
const database = `quicktrimr_category_replay_${randomUUID().replaceAll('-', '')}`;
const container = `supabase_db_${projectId}`;
const docker = (args, input) =>
  spawnSync('docker', ['exec', '-i', container, ...args], {
    input,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
const query = (sql, { mustSucceed = true } = {}) => {
  const result = docker(
    [
      'sh',
      '-c',
      'export PGPASSWORD="$POSTGRES_PASSWORD"; exec psql "$@"',
      'replay-psql',
      '-X',
      '-U',
      'supabase_admin',
      '-d',
      database,
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
      '-v',
      'VERBOSITY=sqlstate',
    ],
    sql,
  );
  if (mustSucceed)
    assert.equal(
      result.status,
      0,
      `Isolated migration query failed (${result.stderr.match(/ERROR:\s+([A-Z0-9]{5})/)?.[1] ?? 'unavailable'}); SQL/output suppressed.`,
    );
  return result;
};
const directory = resolve(root, 'supabase/migrations');
const files = readdirSync(directory)
  .filter((f) => /^\d{14}_.+\.sql$/.test(f))
  .sort();
const feature = '20261119120000_service_category_management.sql';
assert.equal(
  files.at(-1),
  feature,
  'Update the replay boundary when adding later migrations.',
);
const sqlFor = (names) =>
  'set role postgres;\n' +
  names.map((f) => readFileSync(resolve(directory, f), 'utf8')).join('\n');
const replay = (names) => {
  for (const name of names)
    assert.doesNotThrow(() => query(sqlFor([name])), `Replay ${name}`);
};
const checks = [];
const snapshot = () =>
  query(`select jsonb_build_object(
  'bookings', (select jsonb_agg(to_jsonb(b) order by id) from public.bookings b),
  'lines', (select jsonb_agg(to_jsonb(b) order by id) from public.booking_services b),
  'prices', (select jsonb_agg(jsonb_build_object('id', id, 'category', service_category_id, 'price', price_cents) order by id) from public.barber_services));`).stdout.trim();
const resetApplicationSchema = () => {
  query(
    `drop schema public cascade; drop schema if exists private cascade;
    do $$ declare p record; begin
      for p in select policyname from pg_policies where schemaname='storage' and tablename='objects' loop
        execute format('drop policy %I on storage.objects', p.policyname);
      end loop; end $$;
    truncate storage.objects, storage.buckets;
    create schema public authorization postgres;
    grant usage on schema public to anon, authenticated, service_role;`,
  );
};
try {
  assert.equal(
    docker(['createdb', '-U', 'postgres', database]).status,
    0,
    'Isolated database creation',
  );
  const schema = docker([
    'pg_dump',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '--schema-only',
    '--no-owner',
    '--no-privileges',
    '--schema=auth',
    '--schema=storage',
    '--section=pre-data',
  ]);
  assert.equal(schema.status, 0, 'Platform schema-only dump');
  const versionResult = docker([
    'psql',
    '-X',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '-At',
    '-c',
    'select json_object_agg(extname, extversion) from pg_extension;',
  ]);
  assert.equal(versionResult.status, 0, 'Platform extension metadata');
  const versions = JSON.parse(versionResult.stdout);
  // Copy only the platform types/tables/functions repo migrations depend on.
  // Platform-managed GraphQL/event triggers and existing app policies are excluded.
  query(
    'create schema extensions; ' +
      ['postgis', 'pgcrypto', 'uuid-ossp']
        .map((name) => {
          assert.match(versions[name], /^[\w.-]+$/);
          return `create extension "${name}" with schema extensions version '${versions[name]}';`;
        })
        .join('\n'),
  );
  query(schema.stdout);
  query(`alter table auth.users add primary key (id);
    alter table storage.buckets add primary key (id);
    alter table storage.objects add primary key (id);
    grant all on schema auth, storage, extensions to postgres;
    grant all on all tables in schema auth, storage to postgres;
    grant execute on all functions in schema auth, storage to postgres;`);
  resetApplicationSchema();
  replay(files);
  const catalogue = JSON.parse(
    query(`select json_agg(json_build_object('slug', slug, 'name', display_name,
    'order', display_order, 'min', min_price_cents, 'max', max_price_cents) order by display_order) from public.service_categories;`)
      .stdout,
  );
  assert.deepEqual(catalogue, launchCategories);
  assert.equal(
    query(
      "select count(*) from public.audit_logs where action='service_category.initialized';",
    ).stdout.trim(),
    '5',
  );
  checks.push(
    `All ${files.length} migrations replay on an empty application schema; exact five RULE-SERVICE-05 categories and initialization audits`,
  );

  resetApplicationSchema();
  replay(files.slice(0, -1));
  const unknown = randomUUID();
  query(insertSql('service_categories', { id: unknown }));
  assert.notEqual(
    query(sqlFor([feature]), { mustSucceed: false }).status,
    0,
    'Unknown identity must block migration',
  );
  assert.equal(
    query(
      "select count(*) from information_schema.columns where table_schema='public' and table_name='service_categories' and column_name='slug';",
    ).stdout.trim(),
    '0',
  );
  query(`delete from public.service_categories where id='${unknown}';`);
  checks.push(
    'Unknown legacy identity rejects and rolls back all added columns; no invented mapping or deletion',
  );

  // Reconstruct the foundation's old identity-only category rows, retaining the
  // full historical seed relationships and snapshots for the upgrade test.
  const seed = buildSeed();
  const legacySeed = renderSeed().replace(
    /^insert into public\.service_categories .*;$/gm,
    (line) => {
      const id = line.match(/values \('([a-f0-9-]+)'/)[1];
      return insertSql('service_categories', { id });
    },
  );
  query(legacySeed);
  const service = seed.rows.barber_services[0];
  query(
    `update public.barber_services set price_cents=1999 where id='${service.id}';`,
  );
  assert.notEqual(
    query(sqlFor([feature]), { mustSucceed: false }).status,
    0,
    'Invalid legacy active price must block migration',
  );
  assert.equal(
    query(
      "select count(*) from information_schema.columns where table_schema='public' and table_name='barber_services' and column_name='archived_at';",
    ).stdout.trim(),
    '0',
  );
  query(
    `update public.barber_services set price_cents=${service.price_cents} where id='${service.id}';`,
  );
  const before = snapshot();
  query(sqlFor([feature]));
  assert.equal(
    snapshot(),
    before,
    'Migration preserves historical bookings, lines, service identities and prices',
  );
  checks.push(
    'Invalid legacy price rejects atomically; corrected seeded upgrade preserves every booking, line, service ID and price',
  );

  query(
    "update public.service_categories set display_name='Edited replay fixture' where slug='haircut';",
  );
  query(renderSeed());
  query(renderSeed());
  assert.equal(
    query(
      "select display_name from public.service_categories where slug='haircut';",
    ).stdout.trim(),
    'Edited replay fixture',
  );
  assert.equal(snapshot(), before);
  checks.push(
    'Two seed reruns preserve edited catalogue metadata and historical amounts',
  );
} finally {
  assert.equal(
    docker(['dropdb', '-U', 'postgres', '--if-exists', '--force', database])
      .status,
    0,
    'Isolated replay database cleanup',
  );
}
console.log(
  JSON.stringify(
    {
      ticket: 'P1-T10 / TRIMR-40',
      result: 'PASS',
      isolation:
        'separate local database; platform DDL only; removed after verification',
      checks,
    },
    null,
    2,
  ),
);
