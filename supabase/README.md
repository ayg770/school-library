# The online database

Supabase holds the library: the catalogue, the students, and the loans. The
office works against it directly from a browser. The library computer keeps its
own copy and syncs.

`ARCHITECTURE.md` AD-9 explains why, and which side owns what.

## The project

| | |
|---|---|
| Name | `school-library` |
| Region | `eu-central-1` (Frankfurt) |
| Plan | Free |

The project reference and keys are not written down here. The publishable key
is safe to put in a page, but it belongs in the deployment configuration rather
than in the repository, so that rotating it is a settings change and not a
commit.

## Migrations

`migrations/` mirrors what has been applied to the project, in order. They are
recorded here for the same reason the SQLite migrations are: a schema that
exists only in a running system is a schema nobody can review, and one that
cannot be rebuilt if the project is lost.

Applied migrations are immutable. A change is a new file.

## What the schema does differently from SQLite

**The public id is the primary key.** A row number is local to one machine, and
the same library now lives in two places. Rows written at the library and rows
written in the office have to merge without colliding.

**A loan carries where it came from.** `origin` is `library` or `online`, and
`confirmed_at` is null until the library computer agrees. The unique index that
enforces "one open loan per copy" counts only confirmed loans — so a suggestion
made in the office can never stop a librarian from lending the book that is in
their hand.

**Nothing is readable without an account.** Every table has row level security
forced on, and one policy: the caller must map to an active row in
`staff_users`. Deactivating an account ends its access everywhere at once.

**The database stamps `updated_at` itself.** The library computer syncs by
asking what changed since last time. If a row could be edited without that
column moving, the change would never reach the shelf.
