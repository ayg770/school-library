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

## Current schema — version 1

Migration `001-initial` (`initial-settings-and-staff`).

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
