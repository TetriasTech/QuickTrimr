import assert from 'node:assert/strict';

import { withIsolatedSchema } from './isolated-schema.mjs';
import { buildSeed, renderSeed } from './seed-data.mjs';
assert.equal(process.argv.length, 2, 'No target overrides');
const checks = [];
await withIsolatedSchema(async ({ query, replay, files }) => {
  query('alter schema extensions owner to postgres;');
  const feature = '20261120110000_available_now_mobile_state.sql';
  replay(files.filter((f) => f < feature));
  query(renderSeed(buildSeed()));
  const before = query(
    `set role postgres;select jsonb_build_object('sessions',(select jsonb_agg(to_jsonb(s) order by id) from public.available_now_sessions s),'audits',(select jsonb_agg(to_jsonb(a) order by id) from public.audit_logs a));`,
  ).stdout;
  replay([feature]);
  const after = query(
    `set role postgres;select jsonb_build_object('sessions',(select jsonb_agg(to_jsonb(s) order by id) from public.available_now_sessions s),'audits',(select jsonb_agg(to_jsonb(a) order by id) from public.audit_logs a));`,
  ).stdout;
  assert.equal(before, after);
  for (const role of ['anon', 'authenticated', 'service_role'])
    for (const signature of [
      'public.get_available_now_state(uuid)',
      'public.available_now_mobile_input(uuid,text,jsonb)',
    ])
      assert.equal(
        query(
          `select has_function_privilege('${role}','${signature}','EXECUTE');`,
        ).stdout.trim(),
        role === 'service_role' ? 't' : 'f',
      );
  assert.equal(
    query(
      "select bool_and(relrowsecurity) from pg_class where oid in ('public.available_now_sessions'::regclass,'public.barber_reliability_state'::regclass);",
    ).stdout.trim(),
    't',
  );
  checks.push(
    'Fresh migration chain and seeded upgrade; sessions/audits preserved, RLS retained, new RPCs service-only',
  );
});
console.log(
  JSON.stringify({ result: 'PASS', checks, applicationReset: false }, null, 2),
);
