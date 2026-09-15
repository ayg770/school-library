-- Who may change what, enforced by the database rather than by the screens.
--
-- The blanket policy this replaces let any active staff account write to any
-- table. That was fine while the only account was the administrator's, and it
-- stops being fine the moment the library computer has an account of its own:
-- the school's decision (AD-9) is that the librarians' side records loans and
-- otherwise only looks. A rule that lives in the office site's buttons is not
-- that decision — it is a suggestion, because the REST API is there either way.
--
-- So: everyone who is staff may read. Circulation may be written by a
-- librarian. Everything else — the catalogue, the pupils, the accounts —
-- belongs to an administrator, which is to say to the office.

create function private.staff_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.role
    from public.staff_users u
   where u.auth_user_id = auth.uid()
     and u.active
   limit 1;
$$;

comment on function private.staff_role() is
  'The signed-in user''s role in the library, or null when they are not active staff.';

do $$
declare
  t text;
  circulation constant text[] := array['loans', 'audit_log'];
  everything constant text[] := array[
    'app_settings', 'staff_users', 'classes', 'students', 'categories',
    'shelf_locations', 'books', 'book_copies', 'loans', 'audit_log'
  ];
begin
  foreach t in array everything
  loop
    execute format('drop policy if exists staff_only on public.%I', t);

    -- Reading is the same for everyone who works here. A read_only account —
    -- a browsing terminal, say — gets exactly this and nothing more.
    execute format(
      'create policy staff_read on public.%I for select
         to authenticated
         using (private.staff_role() is not null)', t);

    if t = any (circulation) then
      execute format(
        'create policy circulation_write on public.%I for all
           to authenticated
           using (private.staff_role() in (''admin'', ''librarian''))
           with check (private.staff_role() in (''admin'', ''librarian''))', t);
    else
      execute format(
        'create policy office_write on public.%I for all
           to authenticated
           using (private.staff_role() = ''admin'')
           with check (private.staff_role() = ''admin'')', t);
    end if;
  end loop;
end $$;

-- `claim_staff_account` keeps working: it is SECURITY DEFINER, so the one
-- write a brand-new account must make — linking itself to the row an
-- administrator prepared — does not depend on a policy it could not satisfy.
