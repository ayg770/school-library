-- Move the policy helper out of reach.
--
-- Supabase publishes every function in `public` as a REST endpoint. A function
-- that decides who may read the library has no business being callable by
-- anyone who asks — it is plumbing for the policies, not part of the API. A
-- schema PostgREST does not expose is the right home for it.
--
-- It cannot simply have its EXECUTE revoked: a policy expression runs as the
-- caller, so removing the grant would lock out the very users it is meant to
-- admit.

create schema if not exists private;
revoke all on schema private from anon, authenticated;
grant usage on schema private to authenticated;

create function private.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.staff_users u
     where u.auth_user_id = auth.uid()
       and u.active
  );
$$;

comment on function private.is_active_staff() is
  'True when the signed-in Supabase user maps to an active staff account.';

grant execute on function private.is_active_staff() to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'app_settings', 'staff_users', 'classes', 'students', 'categories',
    'shelf_locations', 'books', 'book_copies', 'loans', 'audit_log'
  ]
  loop
    execute format('drop policy staff_only on public.%I', t);
    execute format(
      'create policy staff_only on public.%I for all
         to authenticated
         using (private.is_active_staff())
         with check (private.is_active_staff())', t);
  end loop;
end $$;

drop function public.is_active_staff();

-- A trigger function with a mutable search_path can be pointed at a planted
-- schema by whoever calls it. This one needs nothing outside itself.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
