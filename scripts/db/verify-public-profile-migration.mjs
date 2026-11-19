import assert from 'node:assert/strict';

import { withIsolatedSchema } from './isolated-schema.mjs';
import { buildSeed, renderSeed } from './seed-data.mjs';

assert.equal(process.argv.length, 2, 'No target overrides.');
const checks = [];
await withIsolatedSchema(async ({ query, replay, files }) => {
  const feature = '20261119140000_public_barber_profile.sql';
  const previous = files.filter((file) => file < feature);
  replay(previous);
  query(renderSeed(buildSeed()));
  const fingerprintSql = `set role postgres; select jsonb_build_object(
    'services',(select jsonb_agg(to_jsonb(s) order by id) from public.barber_services s),
    'bookings',(select jsonb_agg(to_jsonb(b) order by id) from public.bookings b),
    'audits',(select jsonb_agg(to_jsonb(a) order by id) from public.audit_logs a));`;
  const before = query(fingerprintSql).stdout;
  replay([feature]);
  assert.equal(
    query(fingerprintSql).stdout,
    before,
    'Migration preserves historical rows',
  );
  for (const role of ['anon', 'authenticated'])
    assert.equal(
      query(
        `select has_function_privilege('${role}', 'public.get_public_barber_profile(uuid,uuid,jsonb)', 'EXECUTE');`,
      ).stdout.trim(),
      'f',
    );
  assert.equal(
    query(
      "select has_function_privilege('service_role', 'public.get_public_barber_profile(uuid,uuid,jsonb)', 'EXECUTE');",
    ).stdout.trim(),
    't',
  );
  assert.equal(
    query(
      "select bool_and(relrowsecurity) from pg_class where oid in ('public.barber_profiles'::regclass,'public.barber_services'::regclass,'public.public_areas'::regclass);",
    ).stdout.trim(),
    't',
  );
  assert.equal(
    query(
      "select string_agg(column_name,',') from information_schema.columns where table_schema='public' and table_name='public_barber_profiles';",
    ).stdout.trim(),
    'id',
  );
  checks.push(
    `All ${previous.length + 1} migrations replay in an isolated database; seeded upgrade preserves prices/bookings/audits; RPC service-only; RLS and ID-only view retained`,
  );
});
console.log(
  JSON.stringify({ result: 'PASS', checks, applicationReset: false }, null, 2),
);
