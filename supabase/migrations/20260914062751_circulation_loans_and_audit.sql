-- Circulation.
--
-- The library computer owns loans. The office may propose one from the
-- browser, but a proposal is not a loan until the library confirms it — that
-- is what `confirmed_at` records, and it is the whole reason the two places
-- can both be used without either overruling the other.

create table loans (
  public_id           uuid primary key default gen_random_uuid(),
  copy_id             uuid not null references book_copies (public_id),
  student_id          uuid not null references students (public_id),
  checkout_at         timestamptz not null default now(),
  due_at              timestamptz,
  returned_at         timestamptz,
  checkout_by         uuid references staff_users (public_id),
  return_by           uuid references staff_users (public_id),
  renewal_count       integer not null default 0 check (renewal_count >= 0),
  notes               text,

  -- Where this row was written. A loan from the library is the truth; a loan
  -- from the browser is a suggestion until the library computer agrees.
  origin              text not null default 'library'
                        check (origin in ('library', 'online')),
  confirmed_at        timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- One open loan per copy — but only among confirmed loans.
--
-- The exclusion of unconfirmed rows is deliberate and load-bearing. If a
-- suggestion made in the office could occupy this index, it would stop a
-- librarian from lending the book that is physically in their hand. The
-- person holding the book wins.
create unique index idx_loans_one_active_per_copy
  on loans (copy_id)
  where returned_at is null and confirmed_at is not null;

-- A copy may carry at most one outstanding suggestion, so the office cannot
-- queue the same book twice by accident.
create unique index idx_loans_one_pending_per_copy
  on loans (copy_id)
  where returned_at is null and confirmed_at is null;

create index idx_loans_student on loans (student_id);
create index idx_loans_copy on loans (copy_id);
create index idx_loans_checkout_at on loans (checkout_at);
create index idx_loans_due_open on loans (due_at) where returned_at is null;
-- What the library computer asks for on every sync: what is waiting for it.
create index idx_loans_pending on loans (created_at) where confirmed_at is null;

create table audit_log (
  event_id    uuid primary key default gen_random_uuid(),
  user_id     uuid references staff_users (public_id),
  action      text not null,
  entity_type text not null,
  entity_id   text,
  old_data    jsonb,
  new_data    jsonb,
  created_at  timestamptz not null default now()
);

create index idx_audit_entity on audit_log (entity_type, entity_id);
create index idx_audit_created on audit_log (created_at);
create index idx_audit_action on audit_log (action);
