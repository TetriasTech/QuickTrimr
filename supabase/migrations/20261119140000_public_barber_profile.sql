-- P1-T12 / TRIMR-42. Preserve raw-table RLS and the ID-only foundation view.
begin;

create function public.get_public_barber_profile(p_client_id uuid, p_barber_id uuid, p_after jsonb default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.role() is distinct from 'service_role' or not exists (
    select 1 from public.profiles where id = p_client_id and role = 'client'
  ) then raise insufficient_privilege using message = 'public_profile_forbidden'; end if;

  with eligible as materialized (
    select p.id, p.display_name, p.bio, p.years_experience, p.approximate_area, b.photo_id
    from private.barber_public_profiles p
    join private.connect_eligible_barbers e on e.barber_id = p.id
    join public.barber_profiles b on b.id = p.id
    where p.id = p_barber_id and nullif(btrim(p.display_name), '') is not null
      and p.bio is not null and p.years_experience is not null
  ), page as materialized (
    select s.id, s.service_category_id, c.display_name, coalesce(c.description, '') as description,
      s.price_cents, c.display_order, c.slug
    from public.barber_services s
    join public.service_categories c on c.id = s.service_category_id
    join eligible p on p.id = s.barber_id
    where s.archived_at is null and c.archived_at is null
      and (p_after is null or (c.display_order, c.slug, s.id) >
        ((p_after->>'displayOrder')::integer, p_after->>'slug', (p_after->>'id')::uuid))
    order by c.display_order, c.slug, s.id
    limit 21 -- Transport page: 20 visible rows plus one continuation probe, not a business cap.
  ), visible as (
    select * from page order by display_order, slug, id limit 20
  )
  select jsonb_build_object('photoId', p.photo_id, 'profile', jsonb_build_object(
    'barberId', p.id, 'displayName', p.display_name, 'bio', p.bio,
    'yearsExperience', p.years_experience, 'approximateArea', p.approximate_area,
    -- Phase 4 owns review storage and aggregation. Never invent a default score.
    'rating', null, 'ratingCount', 0,
    'services', coalesce((select jsonb_agg(jsonb_build_object(
      'id', v.id, 'serviceCategoryId', v.service_category_id, 'displayName', v.display_name,
      'description', v.description, 'priceCents', v.price_cents
    ) order by v.display_order, v.slug, v.id) from visible v), '[]'::jsonb),
    'nextServicesCursor', case when (select count(*) from page) > 20 then (
      select jsonb_build_object('displayOrder', v.display_order, 'slug', v.slug, 'id', v.id)
      from visible v order by v.display_order desc, v.slug desc, v.id desc limit 1
    ) else null end
  )) into result from eligible p;
  return coalesce(result, '{"profile":null,"photoId":null}'::jsonb);
end;
$$;
revoke all on function public.get_public_barber_profile(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.get_public_barber_profile(uuid, uuid, jsonb) to service_role;
commit;
