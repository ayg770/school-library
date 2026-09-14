-- How a person becomes a user of the online library.
--
-- Supabase Auth holds the credentials; `staff_users` holds the permission.
-- Keeping them apart is what lets row level security be strict without this
-- application ever handling a password: signing up is not the same as being
-- let in, and only the second is granted here.
--
-- An account is prepared by an administrator, by email. When that person later
-- signs in with the same address, the two halves join — see
-- `claim_staff_account`, which replaced the trigger this migration created.

alter table staff_users
  add column email text unique;

comment on column staff_users.email is
  'The address this account is claimed with. Matching is case-insensitive.';

create unique index idx_staff_users_email_lower
  on staff_users (lower(email));

create function private.link_staff_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.staff_users
     set auth_user_id = new.id
   where lower(email) = lower(new.email)
     and auth_user_id is null;
  return new;
end;
$$;

create trigger link_staff_account
  after insert on auth.users
  for each row execute function private.link_staff_account();
