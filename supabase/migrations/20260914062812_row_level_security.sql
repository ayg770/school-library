-- Nothing is readable without an account.
--
-- This database holds children's names and their borrowing history. Supabase
-- publishes a REST API over every table, reachable by anyone who learns the
-- project's public key — so row level security is not a hardening step to do
-- later. Without it, the anon key is the whole library.
--
-- Superseded in part by `harden_helper_functions`, which moves the helper out
-- of the schema PostgREST exposes. Kept as applied: a migration is a record of
-- what happened, not a description of the present.

create function public.is_active_staff()
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

comment on function public.is_active_staff() is
  'True when the signed-in Supabase user maps to an active staff account.';

do $$
declare
  t text;
begin
  foreach t in array array[
    'app_settings', 'staff_users', 'classes', 'students', 'categories',
    'shelf_locations', 'books', 'book_copies', 'loans', 'audit_log'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);

    -- One policy per table, deliberately: every table holds part of the same
    -- library, and a rule that differs per table is a rule someone will get
    -- wrong. Who may do what is decided by role, in the application.
    execute format(
      'create policy staff_only on public.%I for all
         to authenticated
         using (public.is_active_staff())
         with check (public.is_active_staff())', t);
  end loop;
end $$;
