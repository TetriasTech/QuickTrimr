import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { assertLocalProject, projectId, root } from './local.mjs';

// Platform DDL only. Never reset or copy data from the user's application DB.
export async function withIsolatedSchema(work) {
  assertLocalProject();
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
  const sqlFor = (names) =>
    'set role postgres;\n' +
    names.map((f) => readFileSync(resolve(directory, f), 'utf8')).join('\n');
  const replay = (names) => {
    for (const name of names)
      assert.doesNotThrow(() => query(sqlFor([name])), `Replay ${name}`);
  };
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
    return await work({ query, replay, files, sqlFor, resetApplicationSchema });
  } finally {
    assert.equal(
      docker(['dropdb', '-U', 'postgres', '--if-exists', '--force', database])
        .status,
      0,
      'Isolated replay database cleanup',
    );
  }
}
