-- P1-T10 / TRIMR-40. RULE-SERVICE-05 launch data; RULE-SERVICE-06 atomic bounds.
begin;

alter table public.service_categories
  add column slug text,
  add column display_name text,
  add column description text,
  add column display_order integer,
  add column min_price_cents integer,
  add column max_price_cents integer,
  add column archived_at timestamptz;

-- The foundation intentionally stored identities only. Never invent metadata
-- for an unrecognised historical identity, or delete it to make a migration pass.
do $$ begin
  if exists (select 1 from public.service_categories where id not in (
    '582742ef-60da-5c81-a9a8-5c0d45491718'::uuid,
    '6047e3e6-ae01-5c70-8668-6bbbec5d7f13'::uuid,
    '196308f0-562b-518a-9394-8f4f526ab04a'::uuid,
    '80287972-0695-559e-85d7-789b82f09bb8'::uuid,
    '8632aa1b-2fa5-59d6-a656-19aca69de49e'::uuid
  )) then
    raise exception 'Unmapped legacy category identities require an explicit catalogue mapping before migration';
  end if;
end $$;

insert into public.service_categories
  (id, slug, display_name, description, display_order, min_price_cents, max_price_cents)
values
  ('582742ef-60da-5c81-a9a8-5c0d45491718', 'haircut', 'Haircut', '', 1, 2000, 15000),
  ('6047e3e6-ae01-5c70-8668-6bbbec5d7f13', 'skin_fade', 'Skin Fade', '', 2, 2500, 17500),
  ('196308f0-562b-518a-9394-8f4f526ab04a', 'beard_trim', 'Beard Trim', '', 3, 1000, 10000),
  ('80287972-0695-559e-85d7-789b82f09bb8', 'haircut_beard', 'Haircut + Beard', '', 4, 3000, 20000),
  ('8632aa1b-2fa5-59d6-a656-19aca69de49e', 'skin_fade_beard', 'Skin Fade + Beard', '', 5, 3500, 22500)
on conflict (id) do update set
  slug = excluded.slug, display_name = excluded.display_name, description = excluded.description,
  display_order = excluded.display_order, min_price_cents = excluded.min_price_cents,
  max_price_cents = excluded.max_price_cents;

alter table public.service_categories
  alter column slug set not null,
  alter column display_name set not null,
  alter column description set not null,
  alter column display_order set not null,
  alter column min_price_cents set not null,
  alter column max_price_cents set not null,
  add constraint service_categories_slug_key unique (slug),
  add constraint service_categories_slug_nonempty check (btrim(slug) <> ''),
  add constraint service_categories_name_nonempty check (btrim(display_name) <> ''),
  add constraint service_categories_order_nonnegative check (display_order >= 0),
  add constraint service_categories_price_range check (min_price_cents >= 0 and max_price_cents > min_price_cents);

-- Required to exclude archived services from the approved bounds guard.
-- P1-T11 owns the barber's archive/upsert operations, using this same marker.
alter table public.barber_services add column archived_at timestamptz;
create index barber_services_active_category_price_idx
  on public.barber_services (service_category_id, price_cents) where archived_at is null;
create index service_categories_active_order_idx
  on public.service_categories (display_order, slug, id) where archived_at is null;

do $$ begin
  if exists (select 1 from public.barber_services s
    join public.service_categories c on c.id = s.service_category_id
    where s.archived_at is null and
      (s.price_cents < c.min_price_cents or s.price_cents > c.max_price_cents)) then
    raise exception 'Existing active service prices fall outside the approved launch catalogue';
  end if;
end $$;

create function private.service_category_json(c public.service_categories) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'slug', c.slug, 'displayName', c.display_name,
    'description', c.description, 'displayOrder', c.display_order,
    'minPriceCents', c.min_price_cents, 'maxPriceCents', c.max_price_cents,
    'archivedAt', c.archived_at);
$$;
revoke all on function private.service_category_json(public.service_categories) from public, anon, authenticated, service_role;

insert into public.audit_logs
  (actor_id, actor_role, action, entity_type, entity_id, previous_value, new_value)
select null, null, 'service_category.initialized', 'service_categories', c.id,
  null, private.service_category_json(c) from public.service_categories c;

create function private.protect_service_category() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise insufficient_privilege using message = 'Category rows must be archived, never deleted';
  end if;
  if new.slug is distinct from old.slug then
    raise sqlstate 'PT409' using message = 'slug_immutable';
  end if;
  return new;
end $$;
create trigger service_category_slug_immutable before update of slug on public.service_categories
  for each row execute function private.protect_service_category();
create trigger service_category_no_delete before delete on public.service_categories
  for each row execute function private.protect_service_category();
create trigger service_category_no_truncate before truncate on public.service_categories
  for each statement execute function private.protect_service_category();
revoke all on function private.protect_service_category() from public, anon, authenticated, service_role;

-- All linked writes lock the parent first. A category change cannot race an
-- insert, repricing or reactivation into committing an invalid active price.
create function private.guard_service_category_price() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c public.service_categories;
begin
  select * into strict c from public.service_categories where id = new.service_category_id for share;
  if new.archived_at is null then
    if c.archived_at is not null then
      raise check_violation using message = 'category_unavailable';
    end if;
    if new.price_cents < c.min_price_cents or new.price_cents > c.max_price_cents then
      raise check_violation using message = 'price_outside_category_bounds';
    end if;
  end if;
  return new;
end $$;
create trigger barber_service_category_integrity
  before insert or update of service_category_id, price_cents, archived_at on public.barber_services
  for each row execute function private.guard_service_category_price();
revoke all on function private.guard_service_category_price() from public, anon, authenticated, service_role;

create function private.has_category_history(p_category_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select
    ((select private.current_user_role()) = 'barber' and exists (
      select 1 from public.barber_services s where s.service_category_id = p_category_id
        and s.barber_id = (select auth.uid())
    )) or exists (
      select 1 from public.booking_services bs
      join public.barber_services s on s.id = bs.barber_service_id
      join public.bookings b on b.id = bs.booking_id
      where s.service_category_id = p_category_id and case (select private.current_user_role())
        when 'client' then b.client_id = (select auth.uid())
        when 'barber' then b.barber_id = (select auth.uid()) else false end
    );
$$;
revoke all on function private.has_category_history(uuid) from public, anon, authenticated;
grant execute on function private.has_category_history(uuid) to authenticated, service_role;

alter table public.service_categories enable row level security;
create policy category_catalogue_read on public.service_categories for select to authenticated
  using ((select auth.uid()) is not null and (archived_at is null or
    ((select private.current_user_role()) in ('client', 'barber') and private.has_category_history(id))));
grant select (slug, display_name, description, display_order, min_price_cents, max_price_cents, archived_at)
  on public.service_categories to authenticated;
grant select (archived_at) on public.barber_services to authenticated;
-- Administrative writes go through the audited RPC, including service-key callers.
revoke insert, update, delete, truncate on public.service_categories from public, anon, authenticated, service_role;

create function public.manage_service_category(p_user_id uuid, p_operation text, p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.service_categories;
  before_value jsonb;
  after_value jsonb;
  new_min integer;
  new_max integer;
  below_min boolean;
  above_max boolean;
  action_name text;
  violated_constraint text;
begin
  if auth.role() is distinct from 'service_role' then
    raise insufficient_privilege using message = 'category_forbidden';
  end if;
  perform 1 from public.profiles where id = p_user_id and role = 'admin' for share;
  if not found then raise insufficient_privilege using message = 'category_forbidden'; end if;
  if p_operation is null or p_operation not in ('create', 'update', 'archive')
    or p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise sqlstate 'PT422' using message = 'validation_failed';
  end if;
  if p_operation = 'update' and p_input ? 'slug' then
    raise sqlstate 'PT409' using message = 'slug_immutable';
  end if;

  if p_operation in ('create', 'update') then
    new_min := (p_input->>'minPriceCents')::integer;
    new_max := (p_input->>'maxPriceCents')::integer;
    if new_min is null or new_max is null or new_min < 0 or new_max <= new_min then
      raise sqlstate 'PT422' using message = 'validation_failed';
    end if;
  end if;
  if p_operation = 'create' then
    insert into public.service_categories
      (slug, display_name, description, display_order, min_price_cents, max_price_cents)
    values (btrim(p_input->>'slug'), btrim(p_input->>'displayName'),
      coalesce(p_input->>'description', ''), (p_input->>'displayOrder')::integer, new_min, new_max)
    returning * into c;
    action_name := 'service_category.created';
  else
    select * into c from public.service_categories where id = (p_input->>'id')::uuid for update;
    if not found then raise sqlstate 'PT404' using message = 'not_found'; end if;
    before_value := private.service_category_json(c);
    if p_operation = 'archive' then
      if c.archived_at is not null then
        return jsonb_build_object('id', c.id, 'archivedAt', c.archived_at);
      end if;
      update public.service_categories set archived_at = now() where id = c.id returning * into c;
      action_name := 'service_category.archived';
    else
      select
        exists (select 1 from public.barber_services s where s.service_category_id = c.id
          and s.archived_at is null and s.price_cents < new_min),
        exists (select 1 from public.barber_services s where s.service_category_id = c.id
          and s.archived_at is null and s.price_cents > new_max)
      into below_min, above_max;
      if below_min or above_max then
        raise sqlstate 'PT409' using message = 'category_price_conflict',
          detail = case when below_min and above_max then 'both'
            when below_min then 'minPriceCents' else 'maxPriceCents' end;
      end if;
      after_value := before_value || jsonb_build_object(
        'displayName', btrim(p_input->>'displayName'),
        'description', coalesce(p_input->>'description', c.description),
        'displayOrder', (p_input->>'displayOrder')::integer,
        'minPriceCents', new_min, 'maxPriceCents', new_max);
      if before_value = after_value then return before_value; end if;
      update public.service_categories set display_name = btrim(p_input->>'displayName'),
        description = coalesce(p_input->>'description', c.description),
        display_order = (p_input->>'displayOrder')::integer,
        min_price_cents = new_min, max_price_cents = new_max
      where id = c.id returning * into c;
      action_name := 'service_category.updated';
    end if;
  end if;
  after_value := private.service_category_json(c);
  insert into public.audit_logs (actor_id, actor_role, action, entity_type, entity_id, previous_value, new_value)
    values (p_user_id, 'admin', action_name, 'service_categories', c.id, before_value, after_value);
  return case when p_operation = 'archive'
    then jsonb_build_object('id', c.id, 'archivedAt', c.archived_at) else after_value end;
exception
  when unique_violation then
    get stacked diagnostics violated_constraint = constraint_name;
    if violated_constraint = 'service_categories_slug_key' then
      raise sqlstate 'PT409' using message = 'slug_exists';
    end if;
    raise;
  when check_violation or not_null_violation or numeric_value_out_of_range or invalid_text_representation then
    raise sqlstate 'PT422' using message = 'validation_failed';
end $$;
revoke all on function public.manage_service_category(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.manage_service_category(uuid, text, jsonb) to service_role;

commit;
