-- Claiming an account, without a trigger on `auth.users`.
--
-- The previous attempt hung a trigger on Supabase's own users table. It broke
-- signing in outright — "Database error querying schema" — because the auth
-- service runs as its own role and could not reach the schema the trigger
-- function lives in. Rather than widen that role's access to make a trigger on
-- someone else's table work, the coupling is removed: the application asks to
-- be claimed, once, just after it signs in.
--
-- This is the safer shape anyway. Nothing this project owns now runs inside
-- Supabase's authentication path, so a mistake here can no longer lock
-- everyone out of the front door.

drop trigger if exists link_staff_account on auth.users;
drop function if exists private.link_staff_account();

create function public.claim_staff_account()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed integer;
begin
  -- The address comes from the verified token, never from the caller, so
  -- asking to be claimed as somebody else is not expressible.
  update public.staff_users
     set auth_user_id = auth.uid()
   where auth_user_id is null
     and lower(email) = lower(auth.jwt() ->> 'email');

  get diagnostics claimed = row_count;
  return claimed > 0;
end;
$$;

comment on function public.claim_staff_account() is
  'Links the signed-in Supabase account to the staff row prepared for its
   email address. Safe to call on every sign-in: it claims at most one row and
   does nothing once claimed. Grants nothing on its own — a caller with no
   prepared row stays invisible to every policy.';

revoke all on function public.claim_staff_account() from public, anon;
grant execute on function public.claim_staff_account() to authenticated;
