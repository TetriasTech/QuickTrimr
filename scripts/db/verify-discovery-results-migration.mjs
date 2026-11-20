import assert from 'node:assert/strict';

import { withIsolatedSchema } from './isolated-schema.mjs';
import { buildSeed, renderSeed } from './seed-data.mjs';

await withIsolatedSchema(async ({ query, replay, files }) => {
  const feature = '20261121020000_discovery_selected_service.sql';
  replay(files.filter((f) => f < feature));
  query(renderSeed(buildSeed()));
  const fingerprint =
    "select jsonb_build_object('services',(select jsonb_agg(to_jsonb(s) order by id) from public.barber_services s),'bookings',(select jsonb_agg(to_jsonb(b) order by id) from public.bookings b),'audits',(select jsonb_agg(to_jsonb(a) order by id) from public.audit_logs a));";
  const before = query(fingerprint).stdout;
  replay([feature]);
  assert.equal(query(fingerprint).stdout, before);
  for (const signature of ['uuid,uuid,jsonb', 'uuid,uuid,jsonb,uuid'])
    for (const role of ['anon', 'authenticated', 'service_role'])
      assert.equal(
        query(
          `select has_function_privilege('${role}','public.get_public_barber_profile(${signature})','execute');`,
        ).stdout.trim(),
        role === 'service_role' ? 't' : 'f',
      );
  assert.equal(
    query(
      "select bool_and(relrowsecurity) from pg_class where oid in ('public.barber_profiles'::regclass,'public.barber_services'::regclass,'public.service_categories'::regclass,'public.public_areas'::regclass);",
    ).stdout.trim(),
    't',
  );
  console.log(
    'Full replay, seeded upgrade preserves services/bookings/audits, both RPC signatures service-only and underlying RLS unchanged: PASS',
  );
});
