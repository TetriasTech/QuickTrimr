import assert from 'node:assert/strict';

import { withIsolatedSchema } from './isolated-schema.mjs';
await withIsolatedSchema(async ({ query, replay, files }) => {
  const q = (sql) => query(sql).stdout.trim().split('\n').at(-1);
  const last = '20261121010000_client_discovery_filters.sql';
  replay(files.filter((f) => f < last));
  q(
    "insert into auth.users(id)values('11111111-1111-4111-8111-111111111111');insert into public.profiles(id,role,verification_status)values('11111111-1111-4111-8111-111111111111','client','not_started');insert into public.client_profiles(id,display_name)values('11111111-1111-4111-8111-111111111111','Preserved fixture');",
  );
  replay([last]);
  assert.equal(
    q(
      "select display_name from public.client_profiles where id='11111111-1111-4111-8111-111111111111'",
    ),
    'Preserved fixture',
  );
  for (const role of ['anon', 'authenticated'])
    assert.equal(
      q(
        `select has_function_privilege('${role}','public.get_client_discovery_filters(uuid,uuid)','execute')`,
      ),
      'f',
    );
  assert.equal(
    q(
      "select has_function_privilege('service_role','public.get_client_discovery_filters(uuid,uuid)','execute')",
    ),
    't',
  );
  const config = JSON.parse(
    q(
      "select set_config('request.jwt.claim.role','service_role',false);select public.get_client_discovery_filters('11111111-1111-4111-8111-111111111111');",
    ),
  );
  assert.deepEqual(config.scheduling, {
    minimumLeadMinutes: 240,
    maximumHorizonDays: 30,
  });
  assert.equal(config.address, null);
  console.log(
    'Full replay, populated upgrade preservation, strict service-only ACL and initial scheduling config: PASS',
  );
});
