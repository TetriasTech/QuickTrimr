-- P1-T11 / TRIMR-41. RULE-SERVICE-02/04/05/06, ADR-009/013.
begin;

-- A logical service keeps its ID across repricing, archive and reactivation.
-- Fail rather than silently choosing between legacy duplicate prices/history.
alter table public.barber_services add constraint barber_services_barber_category_key
  unique (barber_id, service_category_id);

create function private.barber_service_json(s public.barber_services) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', s.id, 'serviceCategoryId', s.service_category_id,
    'priceCents', s.price_cents, 'enabled', s.archived_at is null, 'archivedAt', s.archived_at);
$$;
revoke all on function private.barber_service_json(public.barber_services) from public, anon, authenticated, service_role;

create function private.protect_barber_service() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise insufficient_privilege using message = 'Services must be archived, never deleted';
  end if;
  if (new.barber_id, new.service_category_id) is distinct from (old.barber_id, old.service_category_id) then
    raise insufficient_privilege using message = 'Service ownership and category are immutable';
  end if;
  return new;
end $$;
create trigger barber_service_identity_immutable before update of barber_id, service_category_id on public.barber_services
  for each row execute function private.protect_barber_service();
create trigger barber_service_no_delete before delete on public.barber_services
  for each row execute function private.protect_barber_service();
create trigger barber_service_no_truncate before truncate on public.barber_services
  for each statement execute function private.protect_barber_service();
revoke all on function private.protect_barber_service() from public, anon, authenticated, service_role;

-- Preserve the existing owner/admin SELECT policies; only the audited RPC writes.
alter table public.barber_services enable row level security;
revoke insert, update, delete, truncate on public.barber_services from public, anon, authenticated, service_role;

create function public.manage_barber_service(p_user_id uuid, p_operation text, p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.barber_services;
  c public.service_categories;
  category_id uuid;
  before_value jsonb;
  after_value jsonb;
  price integer;
  active boolean;
  action_name text;
begin
  if auth.role() is distinct from 'service_role' then
    raise insufficient_privilege using message = 'barber_service_forbidden';
  end if;
  -- Serialize own writes and role revocation, committing no lock across I/O.
  perform 1 from public.profiles where id = p_user_id and role = 'barber' for update;
  if not found then raise insufficient_privilege using message = 'barber_service_forbidden'; end if;
  if p_operation is null or p_operation not in ('upsert', 'archive')
    or p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise sqlstate 'PT422' using message = 'validation_failed';
  end if;

  if p_operation = 'archive' then
    select service_category_id into category_id from public.barber_services
      where id = (p_input->>'serviceId')::uuid and barber_id = p_user_id;
    if not found then raise sqlstate 'PT404' using message = 'not_found'; end if;
  else
    category_id := (p_input->>'serviceCategoryId')::uuid;
  end if;
  -- Same parent-before-child lock order as P1-T10. Its integrity trigger remains
  -- the independent guard for every insert, repricing and reactivation.
  select * into c from public.service_categories where id = category_id for share;
  if not found or (p_operation = 'upsert' and c.archived_at is not null) then
    raise sqlstate 'PT404' using message = 'category_unavailable';
  end if;
  select * into s from public.barber_services
    where barber_id = p_user_id and service_category_id = category_id for update;
  if found then before_value := private.barber_service_json(s); end if;

  if p_operation = 'archive' then
    if s.archived_at is not null then
      return jsonb_build_object('id', s.id, 'archivedAt', s.archived_at);
    end if;
    update public.barber_services set archived_at = now() where id = s.id returning * into s;
    action_name := 'barber_service.archived';
  else
    price := (p_input->>'priceCents')::integer;
    active := (p_input->>'enabled')::boolean;
    if price is null or active is null then
      raise sqlstate 'PT422' using message = 'validation_failed';
    end if;
    if price < c.min_price_cents or price > c.max_price_cents then
      raise sqlstate 'PT422' using message = 'price_outside_category_bounds',
        detail = jsonb_build_object('min', c.min_price_cents, 'max', c.max_price_cents)::text;
    end if;
    if before_value is not null and s.price_cents = price and (s.archived_at is null) = active then
      return before_value;
    end if;
    if before_value is null then
      insert into public.barber_services (barber_id, service_category_id, price_cents, archived_at)
        values (p_user_id, category_id, price, case when active then null else now() end)
        returning * into s;
      action_name := 'barber_service.created';
    else
      update public.barber_services set price_cents = price,
        archived_at = case when active then null else coalesce(archived_at, now()) end
        where id = s.id returning * into s;
      action_name := 'barber_service.updated';
    end if;
  end if;
  after_value := private.barber_service_json(s);
  insert into public.audit_logs (actor_id, actor_role, action, entity_type, entity_id, previous_value, new_value)
    values (p_user_id, 'barber', action_name, 'barber_services', s.id, before_value, after_value);
  return case when p_operation = 'archive' then jsonb_build_object('id', s.id, 'archivedAt', s.archived_at)
    else after_value end;
exception
  when not_null_violation or numeric_value_out_of_range or invalid_text_representation then
    raise sqlstate 'PT422' using message = 'validation_failed';
end $$;
revoke all on function public.manage_barber_service(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.manage_barber_service(uuid, text, jsonb) to service_role;

commit;
