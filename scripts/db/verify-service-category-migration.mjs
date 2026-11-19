import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { insertSql } from './core-fixtures.mjs';
import { withIsolatedSchema } from './isolated-schema.mjs';
import { buildSeed, launchCategories, renderSeed } from './seed-data.mjs';
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
    const feature = '20261119120000_service_category_management.sql';
    const files = allFiles.filter((name) => name <= feature);
    assert.equal(files.at(-1), feature);
    const snapshot = () =>
      query(`select jsonb_build_object(
  'bookings', (select jsonb_agg(to_jsonb(b) order by id) from public.bookings b),
  'lines', (select jsonb_agg(to_jsonb(b) order by id) from public.booking_services b),
  'prices', (select jsonb_agg(jsonb_build_object('id', id, 'category', service_category_id, 'price', price_cents) order by id) from public.barber_services));`).stdout.trim();
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
  },
);
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
