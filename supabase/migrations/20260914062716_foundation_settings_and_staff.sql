-- Foundation: settings and the people who operate the library.
--
-- One change from the SQLite schema runs through every table here: the public
-- id is the primary key. A row number is local to one machine, and this
-- database is now one of two places the same library lives. Rows created at
-- the library and rows created in the office have to merge without colliding,
-- and only a globally unique identity makes that safe.

create table app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- Mirrors the accounts the desktop application holds. The office signs in
-- through Supabase Auth; this table is what the library computer syncs, so the
-- same person is the same person in both places.
create table staff_users (
  public_id     uuid primary key default gen_random_uuid(),
  username      text not null unique,
  display_name  text not null,
  role          text not null check (role in ('admin', 'librarian', 'read_only')),
  active        boolean not null default true,
  -- Deliberately absent: password_hash. Passwords stay on the library
  -- computer. Supabase Auth holds the online credentials separately, so a copy
  -- of this database never carries a secret that unlocks anything.
  auth_user_id  uuid unique references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_staff_users_active on staff_users (active);
