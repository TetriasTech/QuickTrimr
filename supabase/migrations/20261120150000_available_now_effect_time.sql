-- P2-T03: session effect timestamps must use the clock after waiting for locks.
-- The baseline statement_timestamp trigger can predate the actual transition.
begin;
create function private.touch_available_now_updated_at() returns trigger
language plpgsql set search_path='' as $$
begin new.updated_at:=clock_timestamp(); return new; end $$;
revoke all on function private.touch_available_now_updated_at() from public,anon,authenticated,service_role;
drop trigger touch_updated_at on public.available_now_sessions;
create trigger touch_updated_at before update on public.available_now_sessions
for each row execute function private.touch_available_now_updated_at();
commit;
