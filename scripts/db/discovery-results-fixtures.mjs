// Explicit synthetic local facts, never a Stripe verification or customer deployment.
import { sqlValue } from './core-fixtures.mjs';
import { publicProfileFixtures } from './public-profile-fixtures.mjs';
import { queryLocal } from './verify.mjs';

export async function discoveryResultsFixtures() {
  const f = await publicProfileFixtures();
  const services = [];
  for (let i = 0; i < 25; i++) services.push(await f.createService(i));
  const selected = services.at(-1);
  const point = "'SRID=4326;POINT(145.2 -38.2)'::extensions.geography";
  const bulk = JSON.parse(
    queryLocal(`with u as (
    insert into auth.users(id) select gen_random_uuid() from generate_series(1,44) returning id
  ), p as (
    insert into public.profiles(id,role,verification_status) select id,'barber','verified' from u returning id
  ), b as (
    insert into public.barber_profiles(id,display_name,bio,years_experience,service_area,service_radius_km,public_area_id)
    select id,'QA Result','Synthetic result-list QA barber.',1,${point},12,'${f.areaId}' from p returning id
  ) select jsonb_agg(id order by id) from b`),
  );
  const all = [f.users.barberA, ...bulk].sort();
  const list = bulk.map(sqlValue).join(',');
  queryLocal(`insert into private.stripe_connect_accounts(barber_id,platform_account_id,stripe_account_id,account_status,charges_enabled,payouts_enabled)
    select id,'acct_LocalFixturePlatform','acct_LocalFixture'||replace(id::text,'-',''),'verified',true,true from public.barber_profiles where id in (${list});
    insert into public.barber_services(barber_id,service_category_id,price_cents)
    select id,'${selected.category.id}',${selected.service.priceCents} from public.barber_profiles where id in (${list});
    update public.barber_profiles set display_name='QA Barber '||lpad(n::text,2,'0') from
    (select id,row_number() over(order by id) n from public.barber_profiles where id in (${all.map(sqlValue).join(',')})) names
    where barber_profiles.id=names.id;
    insert into public.available_now_sessions(barber_id,location,status,location_source,radius_km,available_until,public_area_id)
    select id,${point},'active','gps',12,clock_timestamp()+interval '2 hours','${f.areaId}' from public.barber_profiles where id in (${all.map(sqlValue).join(',')});`);
  return {
    ...f,
    services,
    selected,
    all,
    async cleanup() {
      queryLocal(`update public.barber_services set archived_at=clock_timestamp() where barber_id in (${list});
      update public.barber_profiles set public_area_id=null where id in (${list});
      update public.available_now_sessions set public_area_id=null,status='manually_disabled' where barber_id in (${all.map(sqlValue).join(',')});`);
      queryLocal(
        `update auth.users set deleted_at=clock_timestamp() where id in (${list});`,
      );
      await f.cleanup();
    },
  };
}
