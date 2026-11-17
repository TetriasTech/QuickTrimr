-- P1-T06 / TRIMR-36. Scheduled service area and its independent ABS projection.
begin;

create table public.public_areas (
  id text primary key,
  code text not null,
  label text not null,
  vintage integer not null,
  source_url text not null,
  attribution text not null,
  archive_sha256 text not null check (archive_sha256 ~ '^[0-9a-f]{64}$'),
  boundary extensions.geometry(MultiPolygon, 4326) not null check (not extensions.st_isempty(boundary)),
  map_point extensions.geometry(Point, 4326) generated always as (extensions.st_pointonsurface(boundary)) stored,
  unique (vintage, code)
);
alter table public.public_areas enable row level security;
revoke all on public.public_areas from public, anon, authenticated;
grant select on public.public_areas to service_role;
create index public_areas_boundary_idx on public.public_areas using gist (boundary);

alter table public.barber_profiles
  add column display_name text,
  add column bio text,
  add column years_experience integer check (years_experience >= 0),
  add column service_radius_km numeric check (service_radius_km > 0),
  add column public_area_id text references public.public_areas(id) on delete restrict,
  add column photo_id text check (photo_id ~ '^[0-9a-f]{64}$');
revoke insert, update, delete on public.barber_profiles from public, anon, authenticated;

insert into storage.buckets (id, name, public, allowed_mime_types)
values ('barber-avatars', 'barber-avatars', false, array['image/jpeg']);
-- No client storage policy for this bucket. The authenticated Edge path checks
-- type, actual bytes, and dimensions before using the server storage credential.

create function private.search_address_directory(input text) returns jsonb
language sql stable set search_path = '' as $$
  with search_query as (
    select to_tsquery('pg_catalog.simple', coalesce(string_agg(quote_literal(token) || ':*', ' & '), '')) as value
    from unnest(string_to_array(private.address_search_key(input), ' ')) as tokens(token)
    where token <> ''
  )
  select coalesce(jsonb_agg(private.address_candidate(r.address) order by r.id), '[]'::jsonb)
  from (
    select a as address, a.id from private.address_directory a, search_query q
    where a.search_document @@ q.value order by a.id limit 8
  ) r;
$$;
revoke all on function private.search_address_directory(text) from public, anon, authenticated;
grant execute on function private.search_address_directory(text) to service_role;

-- Service-only public-field projection. The existing client-readable view stays
-- ID-only until an authorised client-facing route can apply discovery eligibility.
create view private.barber_public_profiles with (security_barrier = true) as
select b.id, b.display_name, b.bio, b.years_experience,
  jsonb_build_object('id', a.id, 'label', a.label, 'mapPoint', jsonb_build_object(
    'lat', extensions.st_y(a.map_point), 'lng', extensions.st_x(a.map_point)
  )) as approximate_area
from public.barber_profiles b
join public.public_areas a on a.id = b.public_area_id;
revoke all on private.barber_public_profiles from public, anon, authenticated;
grant select on private.barber_public_profiles to service_role;

create function public.manage_barber_profile(p_user_id uuid, p_request jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  action text := p_request->>'operation';
  owner_role public.user_role;
  completed_at timestamptz;
  previous record;
  centre extensions.geography;
  area_id text;
  photo text;
  result jsonb;
begin
  -- Both the role and the row used by onboarding are server-owned. Serialize
  -- profile mutations with profile sync and later onboarding steps.
  if action = 'save' then
    select role, onboarding_completed_at into owner_role, completed_at
      from public.profiles where id = p_user_id for update;
  else
    select role, onboarding_completed_at into owner_role, completed_at
      from public.profiles where id = p_user_id;
  end if;
  if owner_role is distinct from 'barber'::public.user_role then
    raise insufficient_privilege using message = 'barber_profile_forbidden';
  end if;
  case action
    when 'authorize_photo' then return '{}'::jsonb;
    when 'search' then
      return jsonb_build_object('candidates', private.search_address_directory(p_request->>'query'));
    when 'read' then null;
    when 'save' then
      select display_name, bio, years_experience, service_radius_km, service_area, public_area_id, photo_id
        into strict previous from public.barber_profiles where id = p_user_id;
      if p_request ? 'serviceAreaDirectoryId' then
        select a.location into centre from private.address_directory a
          where a.id = p_request->>'serviceAreaDirectoryId';
      elsif p_request ? 'serviceAreaLat' then
        centre := extensions.st_setsrid(extensions.st_makepoint(
          (p_request->>'serviceAreaLng')::double precision,
          (p_request->>'serviceAreaLat')::double precision
        ), 4326)::extensions.geography;
      else
        centre := previous.service_area;
      end if;
      if centre is not null then
        select a.id into area_id from public.public_areas a
          where extensions.st_covers(a.boundary, centre::extensions.geometry)
          order by a.vintage desc,
            extensions.st_contains(a.boundary, centre::extensions.geometry) desc, a.code
          limit 1;
      end if;
      if area_id is null then
        raise invalid_parameter_value using message = 'barber_area_unresolved';
      end if;

      photo := coalesce(p_request->>'photoId', previous.photo_id);
      if p_request ? 'photoId' and not exists (
        select 1 from storage.objects
        where bucket_id = 'barber-avatars' and name = p_user_id::text || '/' || photo || '.jpg'
      ) then
        raise invalid_parameter_value using message = 'barber_photo_unavailable';
      end if;
      if (previous.display_name, previous.bio, previous.years_experience,
          previous.service_radius_km, previous.service_area::text, previous.public_area_id, previous.photo_id)
        is distinct from (p_request->>'displayName', p_request->>'bio', (p_request->>'yearsExperience')::integer,
          (p_request->>'serviceRadiusKm')::numeric, centre::text, area_id, photo) then
        update public.barber_profiles set display_name = p_request->>'displayName',
          bio = p_request->>'bio', years_experience = (p_request->>'yearsExperience')::integer,
          service_radius_km = (p_request->>'serviceRadiusKm')::numeric, service_area = centre,
          public_area_id = area_id, photo_id = photo, updated_at = now()
        where id = p_user_id;
        insert into public.audit_logs (actor_id, actor_role, action, entity_type, entity_id, new_value)
        values (p_user_id, owner_role, 'barber.profile_saved', 'barber_profile', p_user_id,
          jsonb_build_object('photoChanged', previous.photo_id is distinct from photo,
            'serviceAreaChanged', previous.service_area::text is distinct from centre::text));
      end if;
    else raise invalid_parameter_value using message = 'invalid_barber_profile_operation';
  end case;

  select jsonb_build_object('id', p.id, 'displayName', p.display_name, 'bio', p.bio,
    'yearsExperience', p.years_experience, 'approximateArea', p.approximate_area,
    'serviceRadiusKm', b.service_radius_km, 'photoId', b.photo_id,
    'onboardingComplete', completed_at is not null, 'publishable', false)
    into result from private.barber_public_profiles p join public.barber_profiles b using (id)
    where p.id = p_user_id;
  -- This slice never completes Connect, selects offered services or grants eligibility.
  return jsonb_build_object('profile', result);
end;
$$;
revoke all on function public.manage_barber_profile(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.manage_barber_profile(uuid, jsonb) to service_role;

-- Client and barber address suggestions share the same directory query and
-- candidate projection. The client RPC keeps its existing role and write guards.
create or replace function public.manage_client_addresses(p_user_id uuid, p_request jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  action text := p_request->>'operation';
  target_id uuid := (p_request->>'id')::uuid;
  postal jsonb := p_request->'address';
  input_unit text := coalesce(postal->>'unit', '');
  owner_role public.user_role;
  completed_at timestamptz;
  address_ready boolean;
  changed boolean := false;
  point extensions.geography;
  result jsonb;
  selected private.address_directory;
  previous public.client_addresses;
  saved public.client_addresses;
begin
  -- Same lock as profile completion. List and lookup only need the current role.
  if action in ('create', 'update', 'archive') then
    select role, onboarding_completed_at into owner_role, completed_at
      from public.profiles where id = p_user_id for update;
  else
    select role into owner_role from public.profiles where id = p_user_id;
  end if;
  if owner_role is distinct from 'client'::public.user_role then
    raise insufficient_privilege using message = 'client_address_forbidden';
  end if;

  case action
  when 'list' then
    -- One extra row detects another page without counting the entire list.
    select jsonb_build_object('addresses',
      coalesce(jsonb_agg(private.saved_address(page.address) order by page.id)
        filter (where page.position <= 50), '[]'::jsonb),
      'nextCursor', case when count(*) > 50 then
        (array_agg(page.id order by page.id) filter (where page.position = 50))[1] end)
    into result
    from (
      select a as address, a.id, row_number() over (order by a.id) as position
      from public.client_addresses a
      where a.client_id = p_user_id and a.archived_at is null and a.directory_id is not null
        and ((p_request->>'after') is null or a.id > (p_request->>'after')::uuid)
      order by a.id limit 51
    ) page;
    return result || jsonb_build_object('operation', action);
  when 'search' then
    return jsonb_build_object('operation', action, 'candidates', private.search_address_directory(p_request->>'query'));
  when 'nearby' then
    point := extensions.st_setsrid(extensions.st_makepoint(
      (p_request->>'lng')::double precision, (p_request->>'lat')::double precision
    ), 4326)::extensions.geography;
    select coalesce(jsonb_agg(private.address_candidate(r.address) order by r.distance), '[]'::jsonb)
      into result from (
        select a as address, a.location operator(extensions.<->) point as distance
        from private.address_directory a where a.unit = ''
        order by a.location operator(extensions.<->) point limit 8
      ) r;
    return jsonb_build_object('operation', action, 'candidates', result);
  else
    if action not in ('create', 'update', 'archive') or action is null then
      raise invalid_parameter_value using message = 'invalid_address_operation';
    end if;
  end case;

  if action in ('update', 'archive') then
    select a.* into previous from public.client_addresses a
      where a.id = target_id and a.client_id = p_user_id and a.directory_id is not null;
    if not found then raise no_data_found using message = 'client_address_not_found'; end if;
    if previous.archived_at is not null and action = 'update' then
      raise sqlstate 'PT409' using message = 'address_archived';
    end if;
    saved := previous;
  end if;

  if action = 'archive' then
    if previous.archived_at is null then
      update public.client_addresses set archived_at = now() where id = previous.id returning * into saved;
      changed := true;
    end if;
  else
    -- Edits to private notes or the label can use the existing trusted snapshot
    -- even if the directory has since retired the address.
    if action = 'update' and p_request->>'directoryId' is null and (
      private.address_search_key(previous.line1), private.address_search_key(previous.suburb), previous.state, previous.postcode,
      private.address_search_key(previous.unit)
    ) = (private.address_search_key(postal->>'line1'), private.address_search_key(postal->>'suburb'),
         postal->>'state', postal->>'postcode', private.address_search_key(input_unit)) then
      selected.id := previous.directory_id;
      selected.line1 := previous.line1;
      selected.suburb := previous.suburb;
      selected.state := previous.state;
      selected.postcode := previous.postcode;
      selected.location := previous.location;
    else
      with matched as materialized (
        select a as entry, case when a.unit <> '' then 1 else 0 end as unit_rank
        from private.address_directory a
        where a.state = postal->>'state' and a.postcode = postal->>'postcode'
          and private.address_search_key(a.suburb) = private.address_search_key(postal->>'suburb')
          and (private.address_search_key(a.line1) = private.address_search_key(postal->>'line1')
            or private.address_search_key(a.line1_long) = private.address_search_key(postal->>'line1'))
          and (p_request->>'directoryId' is null or a.id = p_request->>'directoryId')
          and (a.unit = '' or private.address_search_key(a.unit) = private.address_search_key(input_unit))
      ), best as (
        select entry from matched where unit_rank = (select max(unit_rank) from matched)
      )
      select (b.entry).* into selected from best b
      -- A typed address cannot choose between conflicting physical points.
      where (select count(distinct (entry).location::text) from best) = 1
      order by (b.entry).id limit 1;
      if not found then raise invalid_parameter_value using message = 'client_address_unresolved'; end if;
    end if;

    if action = 'create' then
      -- Parallel retries of the same save yield one active row and one audit.
      select a.* into saved from public.client_addresses a
        where a.client_id = p_user_id and a.archived_at is null
          and (a.directory_id, a.label, a.unit, a.access_notes) =
            (selected.id, postal->>'label', input_unit, postal->>'accessNotes')
        limit 1;
      if not found then
        insert into public.client_addresses
          (client_id, directory_id, label, line1, suburb, state, postcode, unit, access_notes, location)
        values (p_user_id, selected.id, postal->>'label', selected.line1, selected.suburb,
          selected.state, selected.postcode, input_unit, postal->>'accessNotes', selected.location)
        returning * into saved;
        changed := true;
      end if;
    elsif (previous.directory_id, previous.label, previous.unit, previous.access_notes,
      previous.line1, previous.suburb, previous.state, previous.postcode, previous.location::text)
      is distinct from (selected.id, postal->>'label', input_unit, postal->>'accessNotes',
        selected.line1, selected.suburb, selected.state, selected.postcode, selected.location::text) then
      update public.client_addresses set directory_id = selected.id, label = postal->>'label',
        line1 = selected.line1, suburb = selected.suburb, state = selected.state, postcode = selected.postcode,
        unit = input_unit, access_notes = postal->>'accessNotes', location = selected.location
      where id = previous.id returning * into saved;
      changed := true;
    end if;
  end if;

  select exists (
    select 1 from public.client_profiles p where p.id = p_user_id
      and p.display_name is not null and p.mobile is not null
  ) and exists (
    select 1 from public.client_addresses a where a.client_id = p_user_id and a.archived_at is null
  ) into address_ready;

  if (completed_at is not null) is distinct from address_ready then
    update public.profiles set onboarding_completed_at = case when address_ready then now() else null end
    where id = p_user_id;
  end if;
  if changed then
    insert into public.audit_logs (actor_id, actor_role, action, entity_type, entity_id, new_value)
    values (p_user_id, owner_role, 'client.address_' || action, 'client_address', saved.id,
      jsonb_build_object('onboardingComplete', address_ready));
  end if;
  return jsonb_build_object('operation', action, 'address', private.saved_address(saved),
    'onboardingComplete', address_ready);
end;
$$;


commit;
