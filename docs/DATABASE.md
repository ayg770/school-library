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

## Current schema — version 5

Migrations `001-initial`, `002-catalog`, `003-circulation`, `004-imports`
and `005-sessions`.

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

## Migration 004 — the import staging area

`import-batches-and-rows`.

### `import_batches`
`public_id`, `filename`, `import_type` (`students` or `books`), `status`
(`parsed` → `validated` → `committed`, or `cancelled`), `mapping_json`,
`started_at`, `finished_at`, and the four counts §7 asks for.

### `import_rows`
`batch_id` → `import_batches` (cascade), `row_number`, `raw_data_json`,
`normalized_data_json`, `status`, `error_json`, `created_entity_id`.

Row 0 holds the file's header row, so a batch stays a complete record of the
file even once the original is gone.

Both what the file said (`raw_data_json`) and what it was understood to mean
(`normalized_data_json`) are kept. **A file is never applied straight to the
catalogue** (§13): every row is staged and judged first, so the conflicts are
shown while they are still free to fix, and a completed import can be explained
afterwards.

Row statuses: `pending` → `ready` / `warning` / `error` / `skipped`, then
`imported` or `failed` once committed. A `warning` row is imported; an `error`
row is not.

## Migration 005 — sign-in sessions

`staff-sessions`.

`token_hash` (unique), `user_id` → `staff_users`, `created_at`, `expires_at`,
`last_seen_at`.

**Only a hash of the token is stored.** Someone who obtains a copy of the
database — a backup on a USB stick — still cannot use it to sign in.

Sessions live in the database rather than in memory so they survive a restart:
a librarian mid-shift should not be signed out because the service was updated.
Expired rows are swept at start-up.

`staff_users` gains its purpose here: the accounts created in migration 001 are
now what sign-in checks. See `docs/ARCHITECTURE.md` AD-6 for why this is a local
password rather than an identity provider.

### Who may do what

| Role | May |
|---|---|
| `read_only` | Read anything, and change their own password |
| `librarian` | Everything above, plus circulation, catalogue, import and sync |
| `admin` | Everything above, plus staff accounts, backup, restore, and deciding which online library this computer belongs to |

**Changing your own password is open to every role**, including `read_only`. An
administrator sets the first one so a new librarian can get in; the librarian
then replaces it with one the administrator does not know, which is the only
thing that makes "who did this" mean anything. The current password is required,
and every session ends with the change — including the one that made it.

Enforced in one place, on every request, and closed by default: a route added
later is protected unless it is explicitly listed as public.

## Migration 006 — the link to the online library

`sync-with-the-online-library`. See `docs/ARCHITECTURE.md` AD-9 and AD-10.

`loans` gains two columns:

- **`origin`** — `library` or `office`. Where the checkout was recorded.
- **`confirmed_at`** — null while a checkout is only a suggestion.

The index that guarantees one open loan per copy is narrowed to confirmed rows,
and a second index allows at most one *unconfirmed* suggestion per copy. Both
may exist for the same copy at once, and that is the point: a suggestion made
in the office never blocks a librarian lending the book in their hand.

Rows that pre-date this migration were all made at the desk, so they are
confirmed by the fact of their existence. A checkout made here is confirmed as
it is written.

`staff_users` gains **`email`**, which is how an account prepared in the office
is matched to the person who signs in here. **`password_hash` never travels.**
An account that arrives from the office is stored with a stand-in that no
password can match; it is listed, and an administrator here gives it a password
before it can be used.

### `sync_state`

One row, `id = 1`. `connected_email`, `refresh_token`, `last_pulled_at`,
`last_pushed_at`, `last_attempt_at`, `last_error`.

Kept out of `app_settings`, which is a fixed list of the library's preferences:
a refresh token is not a preference, and storing it there would have it reported
as an unknown setting on every read.

**The refresh token is stored in clear.** It is worth exactly what the library
computer's own database is worth — which already holds every pupil and every
loan — so encrypting it with a key kept on the same disk would protect nothing
and imply a guarantee that is not there. An administrator revokes it from the
office rather than from here.

Nothing in this migration makes the network necessary. Every column is
optional, and a library that never connects behaves exactly as it did before.

## Migration 007 — a catalogue with two writers

`shared-catalogue-and-category-loan-period`. See `docs/ARCHITECTURE.md` AD-10.

### `synced_at`

Added to `categories`, `shelf_locations`, `books`, `book_copies` and `loans`.

It holds the `updated_at` the row had when it last agreed with the online
library. **Equal** means untouched since; **null** means the row was born here;
**anything else** means there is something to send.

It exists because the catalogue now has two writers. Without it, a row that came
*down* would be offered straight back *up* — and since the online side stamps
its own `updated_at` on every write, the two sides would hand the same row back
and forth for ever, re-downloading the whole catalogue on every exchange.

### `categories.loan_days`

Null uses the library-wide default. A number wins for every book in the
category, and what the librarian types at the desk beats both.

Textbooks are the reason: they are lent for the school year, not a fortnight,
and without this a child's textbook would turn red in the overdue report in
October. Capped at 400 days, because a typo of 3650 would put a book beyond
every report for a decade and nobody would notice until the shelf was empty.

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

Backups live in `backups/` under the application data root, named
`library-<timestamp>-v<schema>-<reason>.sqlite`, so what a file is and when it
was taken are readable without opening it.

**Never a file copy of a live database.** A plain copy of a WAL-mode database
can capture a torn state — the main file without the log that completes it —
and produces a backup that looks fine until the day it is needed. Two
mechanisms are used instead, both allowed by §18:

| Mechanism | Used for | Why |
|---|---|---|
| SQLite online backup API (`db.backup`) | Manual backups | Coherent snapshot without blocking a library that is open |
| `VACUUM INTO` | Startup, before migrations | Synchronous, so it works where application start-up cannot await; produces a compacted copy |

### When one is taken automatically

Before migrations run, and only when there is something to lose: a brand-new
database has nothing to back up, and an up-to-date one is not being changed.
If a migration then fails, the snapshot is on disk and the database is left
exactly as it was (§19).

Before every restore, so a restore of the wrong backup can itself be undone.

### Retention

`backup_retention_count` bounds the routine snapshots. Backups taken before a
migration or a restore are **never** pruned: those are the ones wanted when an
upgrade goes wrong, which is precisely when the routine snapshots have already
rolled over.

### Restore

The order is what makes it safe:

1. Verify the backup — open it read-only, run `PRAGMA integrity_check`, and
   confirm its schema version is one this build knows. A backup written by a
   newer release is refused rather than loaded.
2. Snapshot the current state (`before-restore`).
3. Close the connection, which checkpoints the WAL.
4. Remove the stale `-wal` and `-shm` files and put the backup in place.
5. Reopen. If step 4 failed, the snapshot from step 2 is restored first.
6. Record the restore in the audit log, against the restored database.

`AppContext.db` is a getter rather than a fixed reference, so everything
holding the context keeps working across the swap.

Restore is an administrator action (§18). There is no sign-in yet, so for now
it is protected only by the service being bound to loopback — it must sit
behind a role check before local-network access is enabled.
