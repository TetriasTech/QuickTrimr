import assert from 'node:assert/strict';

import {
  availableNowBoundsFit,
  bookingEligibility,
} from '../../packages/domain/src/availability.ts';

import { withIsolatedSchema } from './isolated-schema.mjs';
import { buildSeed, renderSeed } from './seed-data.mjs';
assert.equal(process.argv.length, 2, 'No target overrides');
const checks = [];
await withIsolatedSchema(async ({ query, replay, files }) => {
  // The scratch helper creates platform extensions as supabase_admin. Match the
  // local Supabase migration owner's schema before testing explicit grants.
  query('alter schema extensions owner to postgres;');
  const feature = '20261120100000_available_now_sessions.sql';
  replay(files.filter((f) => f < feature));
  query(renderSeed(buildSeed()));
  const fingerprint = `set role postgres;select jsonb_build_object('sessions',(select jsonb_agg(jsonb_build_array(id,barber_id,location::text,status,created_at,updated_at) order by id) from public.available_now_sessions),'bookings',(select jsonb_agg(to_jsonb(b) order by id) from public.bookings b),'audits',(select jsonb_agg(to_jsonb(a) order by id) from public.audit_logs a));`;
  const before = query(fingerprint).stdout;
  replay([feature]);
  assert.equal(query(fingerprint).stdout, before);
  checks.push(
    'Seeded upgrade preserves legacy sessions, bookings and immutable audits',
  );
  for (const role of ['anon', 'authenticated', 'service_role']) {
    const permissions = query(
      `select has_function_privilege('${role}','public.manage_available_now_session(uuid,text,jsonb)','EXECUTE'),has_table_privilege('${role}','public.available_now_sessions','UPDATE');`,
    ).stdout.trim();
    assert.equal(permissions, role === 'service_role' ? 't|f' : 'f|f');
  }
  checks.push(
    'RPC service-only, no direct runtime session writes, existing RLS retained',
  );
  assert.equal(
    query(
      "select bool_and(relrowsecurity) from pg_class where oid in ('public.available_now_sessions'::regclass,'public.barber_reliability_state'::regclass);",
    ).stdout.trim(),
    't',
  );
  for (const role of ['anon', 'authenticated', 'service_role'])
    for (const verb of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'])
      assert.equal(
        query(
          `select has_table_privilege('${role}','public.available_now_sessions','${verb}');`,
        ).stdout.trim(),
        'f',
      );

  // Pure/transactional policy parity for every state, including carried cooldowns
  // on lower levels, evaluated on either side and exactly at a fixed server instant.
  const barber = query(
    'select id from public.barber_profiles order by id limit 1;',
  ).stdout.trim();
  for (const level of [
    'good_standing',
    'watch',
    'limited',
    'restricted',
    'suspended',
  ]) {
    for (const deadline of [null, 999, 1000, 1001]) {
      query(
        `set role postgres;insert into public.barber_reliability_state(id,level,cooldown_until) values('${barber}','${level}',${deadline === null ? 'null' : `to_timestamp(${deadline}/1000.0)`}) on conflict(id) do update set level=excluded.level,cooldown_until=excluded.cooldown_until;`,
      );
      const actual = query(
        `set role postgres;select row_to_json(e) from private.barber_booking_eligibility('${barber}',to_timestamp(1)) e;`,
      )
        .stdout.trim()
        .split('\n')
        .at(-1);
      const expected = bookingEligibility(level, deadline, 1000);
      assert.deepEqual(JSON.parse(actual), {
        available_now_allowed: expected.availableNowAllowed,
        scheduled_allowed: expected.scheduledAllowed,
        search_demoted: expected.searchDemoted,
      });
    }
  }
  checks.push(
    '20 SQL/domain parity cases: every reliability level, absent and before/at/after cooldown',
  );
  for (const radius of [0.999, 1, 1.001, 49.999, 50, 50.001]) {
    for (const delta of [-1, 0, 1, 43200000, 43200001]) {
      const result = JSON.parse(
        query(
          `set role postgres;select private.available_now_bound_errors(${radius},to_timestamp((1000+${delta})/1000.0),to_timestamp(1),'{"min":1,"max":50}',12);`,
        )
          .stdout.trim()
          .split('\n')
          .at(-1),
      );
      const expected = availableNowBoundsFit(radius, 1000 + delta, 1000, {
        minRadiusKm: 1,
        maxRadiusKm: 50,
        maxHours: 12,
      });
      assert.equal(!('radiusKm' in result), expected.radiusKm);
      assert.equal(!('availableUntil' in result), expected.availableUntil);
    }
  }
  checks.push(
    '30 exact SQL/domain bound cases: fractional radius either side; past, equal-now, +1ms, exactly 12h and +1ms',
  );
  query(`set role postgres;
    insert into public.public_areas(id,code,label,vintage,source_url,attribution,archive_sha256,boundary) values('qa-area','qa-area','Synthetic',9999,'https://example.invalid','Synthetic','${'a'.repeat(64)}','SRID=4326;MULTIPOLYGON(((144 -39,146 -39,146 -37,144 -37,144 -39)))');
    create temporary table qa_ids as select n,md5('qa-availability-'||n)::uuid id from generate_series(1,20000)n;
    insert into auth.users(id) select id from qa_ids;
    insert into public.profiles(id,role,verification_status) select id,'barber','verified' from qa_ids;
    insert into public.barber_profiles(id) select id from qa_ids;
    insert into private.stripe_connect_accounts(barber_id,platform_account_id,stripe_account_id,account_status,charges_enabled,payouts_enabled)
      select id,'acct_LocalFixturePlatform','acct_QA'||replace(id::text,'-',''),'verified',true,true from qa_ids;
    insert into public.available_now_sessions(barber_id,location,status,location_source,radius_km,available_until,public_area_id)
      select id,case when n<=20 then 'SRID=4326;POINT(144.9 -37.8)' else 'SRID=4326;POINT(170 -30)' end::extensions.geography,
      'active','gps',1,clock_timestamp()+interval '1 hour','qa-area' from qa_ids;
    analyze public.available_now_sessions;analyze public.profiles;analyze public.barber_profiles;analyze private.stripe_connect_accounts;`);
  const candidateQuery = `select * from private.available_now_candidates('SRID=4326;POINT(144.9 -37.8)',clock_timestamp(),null,100)`;
  // Stable instant enables SQL function inlining; runtime callers also sample once.
  const plannedQuery = candidateQuery.replace('clock_timestamp()', 'now()');
  const plan = JSON.parse(
    query(
      'set role postgres;explain (analyze,buffers,format json) ' +
        plannedQuery +
        ';',
    )
      .stdout.trim()
      .split('\n')
      .slice(1)
      .join('\n'),
  );
  const nodes = [];
  function visit(node) {
    nodes.push(node);
    for (const child of node.Plans ?? []) visit(child);
  }
  visit(plan[0].Plan);
  assert.ok(
    nodes.some((n) => n['Index Name'] === 'available_now_location_gist'),
    'Natural plan uses spatial GiST index',
  );
  assert.ok(
    !nodes.some(
      (n) =>
        n['Node Type'] === 'Seq Scan' &&
        n['Relation Name'] === 'available_now_sessions',
    ),
    'No session sequential scan',
  );
  assert.ok(
    !nodes.some(
      (n) =>
        n['Node Type'] === 'Seq Scan' &&
        ['profiles', 'stripe_connect_accounts'].includes(n['Relation Name']),
    ),
    'Eligibility uses indexed nearby-owner lookups, not whole-market scans',
  );
  assert.equal(
    query('set role postgres;select count(*) from (' + plannedQuery + ') q;')
      .stdout.trim()
      .split('\n')
      .at(-1),
    '20',
  );
  assert.equal(
    query(
      'set role service_role;select count(*) from (' + plannedQuery + ') q;',
    )
      .stdout.trim()
      .split('\n')
      .at(-1),
    '20',
    'Internal service caller can execute candidate helper without direct config access',
  );
  const target = query("select md5('qa-availability-1')::uuid;").stdout.trim();
  query(
    `set role postgres;update public.available_now_sessions set status='cancelled' where public_area_id='qa-area';`,
  );
  for (const sessionStatus of [
    'active',
    'busy',
    'expired',
    'manually_disabled',
    'auto_disabled',
    'cancelled',
  ]) {
    query(
      `set role postgres;update public.available_now_sessions set status='${sessionStatus}' where barber_id='${target}';`,
    );
    assert.equal(
      query('set role postgres;select count(*) from (' + plannedQuery + ')q;')
        .stdout.trim()
        .split('\n')
        .at(-1),
      sessionStatus === 'active' ? '1' : '0',
    );
  }
  query(
    `set role postgres;update public.available_now_sessions set status='active',available_until=now() where barber_id='${target}';`,
  );
  assert.equal(
    query('set role postgres;select count(*) from (' + plannedQuery + ')q;')
      .stdout.trim()
      .split('\n')
      .at(-1),
    '0',
  );
  query(
    `set role postgres;update public.available_now_sessions set available_until=now()+interval '1 hour' where barber_id='${target}';`,
  );
  assert.equal(
    query(
      "set role postgres;select count(*) from private.available_now_candidates('SRID=4326;POINT(144.92 -37.8)',now(),null,100);",
    )
      .stdout.trim()
      .split('\n')
      .at(-1),
    '0',
    'Per-session radius excludes a point inside max envelope but outside 1km',
  );
  const duplicate = query(
    `set role postgres;insert into public.available_now_sessions(barber_id,location,status) values('${target}','SRID=4326;POINT(144.9 -37.8)','active');`,
    { mustSucceed: false },
  );
  assert.notEqual(duplicate.status, 0);
  assert.match(duplicate.stderr, /23505/);
  checks.push(
    '20,000-session representative fixture: GiST index scan without planner forcing; all excluded statuses/end-time/radius; independent unique-index duplicate rejection',
  );
  checks.push({ spatialPlan: plan[0] });
});
console.log(
  JSON.stringify({ result: 'PASS', checks, applicationReset: false }, null, 2),
);
