-- P2-T04 / TRIMR-47. RULE-DISCOVERY-01..06, RULE-ONBOARD-04/05,
-- RULE-RELY-06. No raw table grants, money, mutations or provider calls.
begin;
insert into private.platform_config(key,value) values
 ('reliability_search_penalty','"after_non_restricted"'),
 ('discovery_radius_km','{"min":1,"max":50}'),
 ('discovery_page_size','{"min":1,"max":50,"default":20}'),
 ('discovery_distance_bands','{"upperMeters":[2000,5000,10000],"labels":["under-2km","2-5km","5-10km","10km+"]}');

create function public.get_discovery_config() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise insufficient_privilege using message='discovery_forbidden'; end if;
 if (select value from private.platform_config where key='reliability_search_penalty') is distinct from '"after_non_restricted"'::jsonb then raise exception 'discovery_config_invalid'; end if;
 select jsonb_build_object('radiusKm',(select value from private.platform_config where key='discovery_radius_km'),
  'pageSize',(select value from private.platform_config where key='discovery_page_size'),
  'distanceBands',(select value from private.platform_config where key='discovery_distance_bands')) into result;
 if not coalesce((result->'radiusKm'->>'min')::numeric>0 and (result->'radiusKm'->>'max')::numeric>=(result->'radiusKm'->>'min')::numeric
  and (result->'pageSize'->>'min')::integer>0 and (result->'pageSize'->>'default')::integer>=(result->'pageSize'->>'min')::integer
  and (result->'pageSize'->>'max')::integer>=(result->'pageSize'->>'default')::integer
  and (result->'pageSize'->>'max')::numeric<2147483647 -- PostgreSQL integer plus continuation probe
  and jsonb_array_length(result->'distanceBands'->'upperMeters')=3 and jsonb_array_length(result->'distanceBands'->'labels')=4,false) then
   raise exception 'discovery_config_invalid';
 end if;
 return result;
end $$;
revoke all on function public.get_discovery_config() from public,anon,authenticated;
grant execute on function public.get_discovery_config() to service_role;

create function private.discovery_bounds(radius numeric,page_size integer,config jsonb) returns jsonb
language sql immutable as $$
 select (case when radius is null or radius='NaN'::numeric or radius<(config->'radiusKm'->>'min')::numeric or radius>(config->'radiusKm'->>'max')::numeric
  then jsonb_build_object('radiusKm',format('Enter a radius between %s and %s km.',config->'radiusKm'->>'min',config->'radiusKm'->>'max')) else '{}'::jsonb end)
 ||(case when page_size is null or page_size<(config->'pageSize'->>'min')::integer or page_size>(config->'pageSize'->>'max')::integer
  then jsonb_build_object('limit',format('Enter a whole-number limit between %s and %s.',config->'pageSize'->>'min',config->'pageSize'->>'max')) else '{}'::jsonb end);
$$;
create function private.discovery_distance_band(distance_meters double precision,bands jsonb) returns text
language sql immutable as $$
 select bands->'labels'->>(select count(*)::integer from jsonb_array_elements_text(bands->'upperMeters') n where distance_meters>=n.value::double precision);
$$;
revoke all on function private.discovery_bounds(numeric,integer,jsonb),private.discovery_distance_band(double precision,jsonb) from public,anon,authenticated,service_role;

-- Invoker SQL helper deliberately permits planner inlining. Each UNION arm is
-- pruned by booking type and performs constant-radius GiST pruning before the
-- per-barber coverage check. Never page UUID candidates then re-sort that page.
create function private.discovery_candidates(booking_type text,category uuid,point extensions.geography,radius_meters double precision,
 server_now timestamptz,after_key jsonb,page_size integer,config jsonb)
returns table(barber_id uuid,display_name text,photo_id text,approximate_area jsonb,price_cents integer,
 distance_meters double precision,available_until timestamptz,demoted boolean,rating numeric,rating_count bigint)
language sql stable as $$
 with geography_candidates as materialized (
  select s.barber_id,s.public_area_id,s.available_until,extensions.st_distance(s.location,point) as distance_meters
  from public.available_now_sessions s
  where booking_type='available_now' and s.status='active' and s.available_until>server_now
   and s.location_source is not null and s.public_area_id is not null
   and extensions.st_dwithin(s.location,point,radius_meters)
   and extensions.st_dwithin(s.location,point,s.radius_km::double precision*1000)
  union all
  select b.id,b.public_area_id,null::timestamptz,extensions.st_distance(b.service_area,point)
  from public.barber_profiles b
  where booking_type='scheduled' and b.public_area_id is not null
   and extensions.st_dwithin(b.service_area,point,radius_meters)
   and extensions.st_dwithin(b.service_area,point,b.service_radius_km::double precision*1000)
 ), eligible as (
  select g.barber_id,b.display_name,b.photo_id,
   jsonb_build_object('id',a.id,'label',a.label,'mapPoint',jsonb_build_object('lat',extensions.st_y(a.map_point),'lng',extensions.st_x(a.map_point))) as approximate_area,
   s.price_cents,g.distance_meters,g.available_until,e.search_demoted as demoted,
   -- Same unrated projection as P1-T12. P4 owns review storage/aggregation.
   null::numeric as rating,0::bigint as rating_count
  from geography_candidates g join public.barber_profiles b on b.id=g.barber_id
  join public.public_areas a on a.id=g.public_area_id
  join public.barber_services s on s.barber_id=g.barber_id and s.service_category_id=category and s.archived_at is null
  join public.service_categories c on c.id=s.service_category_id and c.archived_at is null
   and s.price_cents between c.min_price_cents and c.max_price_cents
  join lateral(select 1 from private.connect_eligible_barbers p where p.barber_id=g.barber_id limit 1) connected on true
  cross join lateral private.barber_booking_eligibility(g.barber_id,server_now) e
  where nullif(btrim(b.display_name),'') is not null and b.bio is not null and b.years_experience is not null
   and case when booking_type='available_now' then e.available_now_allowed else e.scheduled_allowed end
 )
 select * from eligible q where after_key is null or
  (q.demoted,q.distance_meters,q.price_cents,-coalesce(q.rating,0),-q.rating_count,q.barber_id) >
  ((after_key->>'demoted')::boolean,(after_key->>'distanceMeters')::double precision,(after_key->>'priceCents')::integer,
   -coalesce((after_key->>'rating')::numeric,0),-(after_key->>'ratingCount')::bigint,(after_key->>'barberId')::uuid)
 order by q.demoted,q.distance_meters,q.price_cents,q.rating desc nulls last,q.rating_count desc,q.barber_id
 limit least(page_size+1,(config->'pageSize'->>'max')::integer+1);
$$;
revoke all on function private.discovery_candidates(text,uuid,extensions.geography,double precision,timestamptz,jsonb,integer,jsonb) from public,anon,authenticated,service_role;

create function public.search_nearby_barbers(p_client_id uuid,p_request jsonb,p_after jsonb default null) returns jsonb
language plpgsql stable security definer set search_path='' set jit=off as $$
declare config jsonb; fields jsonb; page_size integer; point extensions.geography; result jsonb; server_now timestamptz:=clock_timestamp();
begin
 if auth.role() is distinct from 'service_role' or not exists(select 1 from public.profiles where id=p_client_id and role='client') then
  raise insufficient_privilege using message='discovery_forbidden';
 end if;
 config:=public.get_discovery_config();
 page_size:=coalesce((p_request->>'limit')::integer,(config->'pageSize'->>'default')::integer);
 fields:=private.discovery_bounds((p_request->>'radiusKm')::numeric,page_size,config);
 if jsonb_typeof(p_request->'lat') is distinct from 'number' or not coalesce((p_request->>'lat')::double precision between -90 and 90,false) then fields:=fields||'{"lat":"Enter a valid latitude."}'::jsonb; end if;
 if jsonb_typeof(p_request->'lng') is distinct from 'number' or not coalesce((p_request->>'lng')::double precision between -180 and 180,false) then fields:=fields||'{"lng":"Enter a valid longitude."}'::jsonb; end if;
 if p_request->>'bookingType' is null or p_request->>'bookingType' not in ('available_now','scheduled') then fields:=fields||'{"bookingType":"Choose a booking type."}'::jsonb; end if;
 if fields<>'{}'::jsonb then raise sqlstate 'PT422' using message='validation_failed',detail=fields::text; end if;
 point:=extensions.st_setsrid(extensions.st_makepoint((p_request->>'lng')::double precision,(p_request->>'lat')::double precision),4326)::extensions.geography;
 with page as materialized (
  select * from private.discovery_candidates(p_request->>'bookingType',(p_request->>'serviceCategoryId')::uuid,point,
   (p_request->>'radiusKm')::double precision*1000,server_now,p_after,page_size,config)
 ), visible as materialized (
  select * from page order by demoted,distance_meters,price_cents,rating desc nulls last,rating_count desc,barber_id limit page_size
 ) select jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('photoId',v.photo_id,'result',jsonb_build_object(
  'barberId',v.barber_id,'displayName',v.display_name,'photoUrl',null,'approximateArea',v.approximate_area,
  'priceCents',v.price_cents,'rating',v.rating,'ratingCount',v.rating_count,'availableUntil',v.available_until,
  'distanceBand',private.discovery_distance_band(v.distance_meters,config->'distanceBands')))
  order by v.demoted,v.distance_meters,v.price_cents,v.rating desc nulls last,v.rating_count desc,v.barber_id) from visible v),'[]'::jsonb),
  'nextKey',case when (select count(*) from page)>page_size then(select jsonb_build_object('demoted',v.demoted,'distanceMeters',v.distance_meters,
   'priceCents',v.price_cents,'rating',v.rating,'ratingCount',v.rating_count,'barberId',v.barber_id)
   from visible v order by demoted desc,distance_meters desc,price_cents desc,rating asc nulls first,rating_count,barber_id desc limit 1) else null end) into result;
 return result;
exception when invalid_text_representation or numeric_value_out_of_range then
 raise sqlstate 'PT422' using message='validation_failed',detail='{"_request":"Enter valid search fields."}';
end $$;
revoke all on function public.search_nearby_barbers(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.search_nearby_barbers(uuid,jsonb,jsonb) to service_role;
commit;
