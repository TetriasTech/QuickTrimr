begin;

create function private.address_search_key(value text) returns text
language sql immutable strict set search_path = '' as $$
  select btrim(regexp_replace(lower(value), '[^[:alnum:]]+', ' ', 'g'));
$$;
revoke all on function private.address_search_key(text) from public, anon, authenticated;
grant execute on function private.address_search_key(text) to service_role;

-- An independently licensed, server-only reference directory. Client addresses
-- keep their own snapshot, including when a later release retires an entry.
create table private.address_directory (
  id text primary key,
  line1 text not null,
  line1_long text not null,
  suburb text not null,
  state text not null check (state in ('ACT','NSW','NT','QLD','SA','TAS','VIC','WA','OT')),
  postcode text not null check (postcode ~ '^[0-9]{4}$'),
  unit text not null,
  location extensions.geography(Point, 4326) not null,
  search_document tsvector generated always as (
    to_tsvector('pg_catalog.simple', private.address_search_key(
      unit || ' ' || line1 || ' ' || line1_long || ' ' || suburb || ' ' || state || ' ' || postcode
    ))
  ) stored
);
alter table private.address_directory enable row level security;
revoke all on table private.address_directory from public, anon, authenticated;
grant select on table private.address_directory to service_role;
create index address_directory_search_idx on private.address_directory using gin (search_document);
create index address_directory_point_idx on private.address_directory using gist (location);
create index address_directory_postal_lookup_idx on private.address_directory (
  state, postcode, private.address_search_key(suburb), private.address_search_key(line1)
);
create index address_directory_postal_lookup_long_idx on private.address_directory (
  state, postcode, private.address_search_key(suburb), private.address_search_key(line1_long)
);

alter table public.client_addresses
  add column directory_id text,
  add column label text,
  add column line1 text,
  add column suburb text,
  add column state text,
  add column postcode text,
  add column unit text,
  add column access_notes text,
  add constraint client_address_snapshot_complete check (
    directory_id is null or (label is not null and line1 is not null and suburb is not null
      and state is not null and postcode is not null and unit is not null and access_notes is not null)
  );
grant select (directory_id, label, line1, suburb, state, postcode, unit, access_notes)
  on public.client_addresses to authenticated;
-- Even owner writes must go through the verified server path.
revoke insert, update, delete on public.client_addresses from public, anon, authenticated;

create function private.address_candidate(row_value private.address_directory) returns jsonb
language sql stable strict set search_path = '' as $$
  select jsonb_build_object('directoryId', row_value.id, 'line1', row_value.line1,
    'suburb', row_value.suburb, 'state', row_value.state, 'postcode', row_value.postcode,
    'unit', row_value.unit);
$$;
revoke all on function private.address_candidate(private.address_directory) from public, anon, authenticated;
grant execute on function private.address_candidate(private.address_directory) to service_role;

create function private.saved_address(row_value public.client_addresses) returns jsonb
language sql stable strict set search_path = '' as $$
  select jsonb_build_object('id', row_value.id, 'label', row_value.label, 'line1', row_value.line1,
    'suburb', row_value.suburb, 'state', row_value.state, 'postcode', row_value.postcode,
    'unit', row_value.unit, 'accessNotes', row_value.access_notes,
    'archivedAt', row_value.archived_at, 'createdAt', row_value.created_at);
$$;
revoke all on function private.saved_address(public.client_addresses) from public, anon, authenticated;
grant execute on function private.saved_address(public.client_addresses) to service_role;

create function public.manage_client_addresses(p_user_id uuid, p_request jsonb) returns jsonb
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
  query tsquery;
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
    select to_tsquery('pg_catalog.simple', string_agg(quote_literal(token) || ':*', ' & '))
      into query from unnest(string_to_array(private.address_search_key(p_request->>'query'), ' ')) as tokens(token)
      where token <> '';
    select coalesce(jsonb_agg(private.address_candidate(r.address) order by r.id), '[]'::jsonb)
      into result from (
        select a as address, a.id from private.address_directory a
        where a.search_document @@ query order by a.id limit 8
      ) r;
    return jsonb_build_object('operation', action, 'candidates', result);
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

revoke all on function public.manage_client_addresses(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.manage_client_addresses(uuid, jsonb) to service_role;

commit;
