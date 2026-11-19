import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { insertSql } from './core-fixtures.mjs';
import { withIsolatedSchema } from './isolated-schema.mjs';
import { buildSeed, renderSeed } from './seed-data.mjs';

assert.equal(
  process.argv.length,
  2,
  'This verifier accepts no target overrides.',
);
const checks = [];
await withIsolatedSchema(
  async ({
    query,
    replay,
    files: allFiles,
    sqlFor,
    resetApplicationSchema,
  }) => {
    const feature = '20261119130000_barber_services_and_pricing.sql';
    const files = allFiles.filter((name) => name <= feature);
    assert.equal(files.at(-1), feature);
    replay(files);
    assert.equal(
      query(
        "select count(*) from pg_constraint where conrelid='public.barber_services'::regclass and conname='barber_services_barber_category_key';",
      ).stdout.trim(),
      '1',
    );
    assert.equal(
      query(
        "select relrowsecurity from pg_class where oid='public.barber_services'::regclass;",
      ).stdout.trim(),
      't',
    );
    assert.equal(
      query(
        "select count(*) from pg_policies where schemaname='public' and tablename='barber_services' and cmd<>'SELECT';",
      ).stdout.trim(),
      '0',
    );
    for (const role of ['anon', 'authenticated', 'service_role'])
      assert.equal(
        query(
          `select has_table_privilege('${role}','public.barber_services','INSERT,UPDATE,DELETE,TRUNCATE');`,
        ).stdout.trim(),
        'f',
      );
    checks.push(
      `All ${files.length} migrations replay; one barber/category key, RLS, SELECT-only policies and no direct DML grants`,
    );

    resetApplicationSchema();
    replay(files.slice(0, -1));
    query(renderSeed());
    const seed = buildSeed();
    const duplicate = { ...seed.rows.barber_services[0], id: randomUUID() };
    query(insertSql('barber_services', duplicate));
    const failed = query(sqlFor([feature]), { mustSucceed: false });
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /ERROR:\s+23505/);
    assert.equal(
      query(
        "select count(*) from pg_proc where pronamespace='public'::regnamespace and proname='manage_barber_service';",
      ).stdout.trim(),
      '0',
    );
    assert.equal(
      query(
        "select has_table_privilege('service_role','public.barber_services','UPDATE');",
      ).stdout.trim(),
      't',
    );
    // This is only the deliberately inserted duplicate in this disposable DB.
    query(`delete from public.barber_services where id='${duplicate.id}';`);
    const snapshot = () =>
      query(`select jsonb_build_object(
    'services',(select jsonb_agg(to_jsonb(s) order by id) from public.barber_services s),
    'bookings',(select jsonb_agg(to_jsonb(b) order by id) from public.bookings b),
    'lines',(select jsonb_agg(to_jsonb(b) order by id) from public.booking_services b));`).stdout.trim();
    const before = snapshot();
    query(sqlFor([feature]));
    assert.equal(snapshot(), before);
    query(renderSeed());
    query(renderSeed());
    assert.equal(snapshot(), before);
    checks.push(
      'Duplicate legacy services reject atomically without selecting/deleting a historical row; corrected seeded upgrade preserves all service IDs/prices and booking snapshots',
    );
    checks.push(
      'Two insert-only seed reruns preserve the upgraded services and bookings',
    );
  },
);
console.log(
  JSON.stringify(
    {
      ticket: 'P1-T11 / TRIMR-41',
      result: 'PASS',
      isolation:
        'separate local database; platform DDL only; removed after verification',
      checks,
    },
    null,
    2,
  ),
);
