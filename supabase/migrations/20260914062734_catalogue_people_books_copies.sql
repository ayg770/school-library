-- The catalogue and the people who borrow from it.
--
-- PRODUCT_SPEC.md §6: a title and a physical item are different things.
-- "מסילת ישרים" is one book with five copies, and each copy carries its own
-- barcode. Whether a copy is on loan is never stored here — it is derived from
-- an unreturned loan (§7).

create table classes (
  public_id         uuid primary key default gen_random_uuid(),
  external_class_id text,
  name              text not null,
  grade             text,
  section           text,
  academic_year     text,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_classes_active on classes (active);
create index idx_classes_external on classes (external_class_id);

-- Names change and students move classes, so neither is an identity (§7).
-- A student with history is deactivated, never deleted.
create table students (
  public_id     uuid primary key default gen_random_uuid(),
  first_name    text not null,
  last_name     text not null,
  class_id      uuid references classes (public_id),
  local_barcode text unique,
  active        boolean not null default true,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_students_class on students (class_id);
create index idx_students_active on students (active);
create index idx_students_last_name on students (last_name);

create table categories (
  public_id  uuid primary key default gen_random_uuid(),
  name       text not null,
  parent_id  uuid references categories (public_id),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_categories_parent on categories (parent_id);

create table shelf_locations (
  public_id  uuid primary key default gen_random_uuid(),
  name       text not null,
  room       text,
  shelf_code text,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The bibliographic record. Authors are deliberately not normalised (§7): a
-- free-text field covers this school's catalogue without the cost of an author
-- table nobody has asked for.
create table books (
  public_id           uuid primary key default gen_random_uuid(),
  title               text not null,
  subtitle            text,
  author_text         text,
  publisher           text,
  publication_year    text,
  isbn10              text,
  isbn13              text,
  language            text,
  category_id         uuid references categories (public_id),
  default_call_number text,
  notes               text,
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index idx_books_title on books (title);
create index idx_books_author on books (author_text);
create index idx_books_category on books (category_id);
create index idx_books_isbn13 on books (isbn13);
create index idx_books_active on books (active);

-- One physical item. The barcode is text so leading zeros survive, and unique
-- so two items can never answer the same scan (§7, §34).
create table book_copies (
  public_id         uuid primary key default gen_random_uuid(),
  book_id           uuid not null references books (public_id),
  barcode           text not null unique,
  legacy_id         text,
  accession_number  text,
  shelf_location_id uuid references shelf_locations (public_id),
  condition_status  text not null default 'normal'
                      check (condition_status in ('normal', 'damaged', 'lost', 'repair', 'withdrawn')),
  purchase_date     date,
  price_cents       integer,
  condition_note    text,
  verified_at       timestamptz,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_copies_book on book_copies (book_id);
create index idx_copies_shelf on book_copies (shelf_location_id);
create index idx_copies_condition on book_copies (condition_status);
create index idx_copies_verified on book_copies (verified_at);
