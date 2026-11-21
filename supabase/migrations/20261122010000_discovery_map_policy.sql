-- P2-T07 / RULE-DISCOVERY-07. Public UI throttle; no new table or location projection.
begin;
insert into private.platform_config(key,value) values ('discovery_map_refresh_ms','2000');
create or replace function public.get_client_discovery_filters(p_client_id uuid,p_address_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare address jsonb:=null; lead integer; horizon integer; discovery jsonb; map_refresh integer;
begin
 if auth.role() is distinct from 'service_role' or not exists(select 1 from public.profiles where id=p_client_id and role='client') then
  raise insufficient_privilege using message='discovery_forbidden';
 end if;
 select (value#>>'{}')::integer into lead from private.platform_config where key='scheduled_min_lead_minutes';
 select (value#>>'{}')::integer into horizon from private.platform_config where key='scheduled_max_horizon_days';
 select (value#>>'{}')::integer into map_refresh from private.platform_config where key='discovery_map_refresh_ms';
 if lead is null or horizon is null or lead<=0 or horizon<=0 or lead::bigint>horizon::bigint*24*60 or map_refresh is null or map_refresh<=0 then raise exception 'discovery_config_invalid'; end if;
 discovery:=public.get_discovery_config();
 if p_address_id is not null then
  select jsonb_build_object('id',a.id,'label',a.label,'point',jsonb_build_object('lat',extensions.st_y(a.location::extensions.geometry),'lng',extensions.st_x(a.location::extensions.geometry))) into address
  from public.client_addresses a where a.id=p_address_id and a.client_id=p_client_id and a.archived_at is null and a.directory_id is not null;
  if address is null then raise sqlstate 'PT422' using message='address_unavailable'; end if;
 end if;
 return jsonb_build_object('serverNow',clock_timestamp(),'scheduling',jsonb_build_object('minimumLeadMinutes',lead,'maximumHorizonDays',horizon),'radiusKm',discovery->'radiusKm','address',address,'map',jsonb_build_object('refreshIntervalMs',map_refresh));
end $$;
revoke all on function public.get_client_discovery_filters(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_client_discovery_filters(uuid,uuid) to service_role;
commit;
