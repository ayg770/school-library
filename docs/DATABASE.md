# Database

SQLite, on the library host only. `PRODUCT_SPEC.md` §7 defines the target
schema; this file records what exists **now** and the conventions every future
migration follows.

## Location

Resolved at runtime, never inside the installation directory (§4):

| Platform | Application data root |
|---|---|
| Windows | `%APPDATA%\SchoolLibrary` |
| macOS | `~/Library/Application Support/SchoolLibrary` |
| Linux | `$XDG_DATA_HOME/school-library` (or `~/.local/share/school-library`) |

`LIBRARY_DATA_DIR` overrides it. Under the root: `data/library.sqlite`,
`backups/`, `logs/`, `imports/`, `exports/`.

The live path is shown on the Settings and Support screen, so it can be read
off the library computer without a developer.

## Connection pragmas

Applied on every open, in `packages/core/src/db/open.ts`:

| Pragma | Value | Why |
|---|---|---|
| `foreign_keys` | `ON` | References are enforced, not decorative |
| `journal_mode` | `WAL` | Concurrent reads during a write. Safe only because every connection is on one host — §5 forbids WAL on an SMB/NFS share |
| `synchronous` | `NORMAL` | §5. Revisit to `FULL` if durability is later judged to matter more than write speed |
| `busy_timeout` | `5000` ms | A brief lock waits instead of failing the scan |

In-memory databases skip WAL; they have no journal file to keep.

## Current schema — version 3

Migrations `001-initial`, `002-catalog` and `003-circulation`.

### `schema_migrations`
Owned by the migration runner, not by any migration.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | Primary key |
| `version` | INTEGER | Unique. The applied migration's version |
| `name` | TEXT | Checked on every later run — see *Immutability* |
| `applied_at` | TEXT | ISO 8601 |

### `app_settings`
Key/value, JSON-encoded. Keys and defaults are in
`packages/core/src/settings.ts`; an unknown or unparseable row falls back to
its default and is logged rather than discarded silently.

| Column | Type |
|---|---|
| `key` | TEXT, primary key |
| `value_json` | TEXT |
| `updated_at` | TEXT |

### `staff_users`

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | Primary key, internal only |
| `public_id` | TEXT | Unique. What an API exposes (§9) |
| `username` | TEXT | Unique |
| `password_hash` | TEXT | scrypt. Plaintext is never stored (§21) |
| `display_name` | TEXT | |
| `role` | TEXT | `admin` \| `librarian` \| `read_only`, enforced by CHECK |
| `active` | INTEGER | 0/1, enforced by CHECK |
| `created_at`, `updated_at` | TEXT | ISO 8601 |

Index: `idx_staff_users_active`.

There is no login screen yet — Phase 0 establishes the table and the hashing;
authentication arrives with the screens that need it.

## Migration 002 — the catalog

`catalog-classes-students-books-copies`.

### `classes`
`public_id`, `external_class_id`, `name`, `grade`, `section`, `academic_year`,
`active`, timestamps. `external_class_id` holds the identifier the
student-management system uses, once it is known (§8).

Indexes: `active`, `external_class_id`.

### `students`
`public_id`, `first_name`, `last_name`, `class_id` → `classes`,
`local_barcode` (unique, nullable), `active`, `notes`, timestamps.

`local_barcode` is a barcode on a student card issued by the library. It is
**not** a cross-system identity: §7 forbids identifying a student across
systems by anything the library assigns or by a name. The permanent external
identifier lives in `external_student_links`, which arrives with the
integration work.

A student who has left is marked inactive. Deleting one would orphan every loan
they ever had.

Indexes: `class_id`, `active`, `last_name`.

### `categories`
`public_id`, `name`, `parent_id` → `categories` (self-referencing), `active`,
timestamps. Cycles are rejected in the domain layer: a category cannot be its
own ancestor, or the tree cannot be walked.

### `shelf_locations`
`public_id`, `name`, `room`, `shelf_code`, `active`, timestamps.

### `books`
The bibliographic record — a *title*, not an item.

`public_id`, `title`, `subtitle`, `author_text`, `publisher`,
`publication_year`, `isbn10`, `isbn13`, `language`, `category_id` →
`categories`, `default_call_number`, `notes`, `active`, timestamps.

Authors are free text rather than a normalised table (§7): the school's
catalogue does not need author records, and adding them would cost every
import and every form.

ISBNs are normalised to digits (with a trailing `X` allowed on ISBN-10) so that
hyphenated and unhyphenated forms of the same edition match. This does **not**
contradict the barcode rule below — an ISBN identifies an edition, a barcode
identifies one physical item.

Indexes: `title`, `author_text`, `category_id`, `isbn13`, `active`.

### `book_copies`
One physical item.

`public_id`, `book_id` → `books`, `barcode` (**unique**), `legacy_id`,
`accession_number`, `shelf_location_id` → `shelf_locations`,
`condition_status`, `purchase_date`, `price_cents`, `condition_note`,
`verified_at`, `active`, timestamps.

`condition_status` is constrained to `normal`, `damaged`, `lost`, `repair`,
`withdrawn`.

`verified_at` records when the copy was last confirmed present on the shelf —
written by the shelf-intake screen in Phase 4.

**Barcodes are stored exactly as supplied.** A value containing whitespace is
rejected rather than trimmed: silently stripping a character would turn one
library's barcode into a different one, and the mismatch would only surface
later as a book that cannot be found. Leading zeros are significant, and
lookup is exact.

There is no "on loan" column. Whether a copy is out is derived from an
unreturned row in `loans`, which Phase 2 adds (§7).

Indexes: `book_id`, `shelf_location_id`, `condition_status`, `verified_at`,
plus the unique index on `barcode`.

## Migration 003 — circulation

`circulation-loans-and-audit`.

### `loans`
Permanent circulation history.

`public_id`, `copy_id` → `book_copies`, `student_id` → `students`,
`checkout_at`, `due_at`, `returned_at`, `checkout_by_user_id`,
`return_by_user_id`, `renewal_count`, `notes`, timestamps.

`returned_at IS NULL` means the loan is open. A returned loan is never deleted
during normal operation (§7).

**One open loan per copy is enforced by the database:**

```sql
CREATE UNIQUE INDEX idx_loans_one_active_per_copy
  ON loans (copy_id) WHERE returned_at IS NULL;
```

A partial unique index rather than an application check, so two librarians
scanning the same book at the same moment cannot both succeed whatever the
code does. The domain checks availability first only to produce a good message;
the index is the guarantee.

Indexes: `student_id`, `copy_id`, `checkout_at`, and a partial index on `due_at`
restricted to open loans — the overdue report never looks at anything else.

There is still no `is_on_loan` column anywhere. Loan state is derived.

### `audit_log`
`event_id` (unique), `user_id`, `action`, `entity_type`, `entity_id`,
`old_data_json`, `new_data_json`, `created_at`.

Entries are written **inside the same transaction as the change they describe**,
so the log cannot disagree with the data. A rolled-back checkout takes its
audit entry with it.

Actions recorded so far: `loan.checked_out`, `loan.returned`, `loan.renewed`.

Indexes: `(entity_type, entity_id)`, `created_at`, `action`.

`checkout_by_user_id` and `audit_log.user_id` are null until staff sign in.
Threading a real identity through changes no logic here.

## Conventions for every future table

- **`id` is internal. `public_id` is external.** APIs and integrations quote
  `public_id` only, so a row can be exported and re-imported without breaking
  an identifier another system already stored (§9).
- **Barcodes are TEXT, always.** Leading zeros are significant, matches are
  exact, and an imported value is never trimmed or reformatted (§7, §34).
- **Nothing with history is hard-deleted.** Students, copies and titles carry
  `active`; a returned loan is never removed (§7).
- **Timestamps are ISO 8601 strings in UTC.**
- **Derive state, don't duplicate it.** A copy is on loan because an unreturned
  loan row exists, not because a status column says so (§7).

## Migrations

`packages/core/src/db/migrations/` — TypeScript modules exporting
`{ version, name, sql }`, listed in order in `migrations/index.ts`.

**Incremental by phase.** Migration 001 creates only what Phase 0 needs. Each
later phase adds its own. This exercises the runner repeatedly against a
database that already holds data, which is the case it must survive in
production years from now (ARCHITECTURE.md AD-4).

**Immutability.** Once a migration has shipped it is never edited or
renumbered. The runner records each migration's name and compares it on every
later run; an edited migration fails with `MIGRATION_MODIFIED` rather than
leaving two databases with silently different schemas.

**Transactional.** Each migration and its `schema_migrations` row commit
together. A failure rolls the whole migration back, leaving the database at the
last version that fully succeeded — never half-migrated.

**Refusals.** The runner stops, rather than guessing, when:

| Code | Situation |
|---|---|
| `DATABASE_FROM_NEWER_VERSION` | The database holds a migration this build does not know — it was written by a newer application |
| `MIGRATION_MODIFIED` | A released migration's name changed |
| `MISSING_APPLIED_MIGRATION` | History has a gap: a later migration ran but an earlier one never did |
| `MIGRATION_FAILED` | The DDL failed; the transaction was rolled back |
| `DUPLICATE_VERSION` / `INVALID_VERSION` | The migration set itself is malformed |

A database is never deleted or recreated to resolve any of these (§19, §34).

## Adding a migration

1. Add `NNN-name.ts` with the next version number.
2. Append it to `migrations/index.ts`.
3. Add a test covering what it changes.
4. Update this file.
5. Test the upgrade against a copy of a database at the previous version.

## Backups

Not yet implemented — Phase 5. When they are, §18 requires the SQLite online
backup API or `VACUUM INTO`, never a file copy of a live database, and a
verified backup before every migration, restore or significant update.
