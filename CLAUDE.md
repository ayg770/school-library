# CLAUDE.md – Working Rules for School Library

Read `docs/PRODUCT_SPEC.md` before architectural/data-model changes.

## Non-negotiable
- Offline-first.
- Checkout/return works with internet disconnected.
- SQLite stays on library host.
- Renderer never opens SQLite directly.
- Remote machines never open the DB file directly.
- Student names are not integration IDs.
- Preserve barcodes and external IDs exactly.
- Barcode values are TEXT.
- Every schema change is a migration.
- Never delete/recreate production DB as upgrade strategy.
- Safe SQLite backup before migrations/restore/significant update.
- Binaries and data are separate.
- No real DB/backups/student exports/tokens in Git.
- No network call in critical checkout/return path.
- Future sync uses durable local outbox and retries.
- Main student system owns student identity/class/status.
- Library owns circulation.
- APIs use stable public IDs and `/api/v1`.
- Integrations use adapters/connectors.
- Generic USB HID Keyboard scanners are the MVP target.

## Electron security
- contextIsolation=true
- nodeIntegration=false
- sandbox where possible
- restrictive CSP
- narrow contextBridge APIs
- validate IPC
- no remote code
- do not disable webSecurity

## Development behavior
Before editing:
1. inspect relevant files;
2. understand architecture;
3. state short plan;
4. limit scope.

After editing:
1. typecheck;
2. tests;
3. lint if configured;
4. smoke test;
5. summarize changed files/migrations;
6. never claim success if checks failed.

For schema changes:
1. new migration;
2. migration test;
3. update docs/DATABASE.md;
4. test upgrading a previous-version DB copy.

For circulation:
- loan + audit + integration outbox belong in same local transaction when applicable.

For bugs:
- add regression test where practical;
- no unrelated refactor.

## UX
- Hebrew true RTL.
- Scanner workflows keyboard-first.
- No confirmation modal for normal checkout.
- Restore scan focus after success.
- Clear green/red/yellow feedback.

## Implementation order
0. Foundation
1. Core catalog
2. Circulation
3. Barcode UX
4. Legacy import + shelf intake
5. Backup/update safety
6. Reports
7. LAN
8. Integration foundation
9. Real student-system connector

Do not attempt all phases in one pass.

## Integration future
Prepare:
- external_student_links
- stable public IDs
- connector interfaces
- integration_outbox
- library-summary API

Do not build the real connector until the target system API and stable student identifier are known.
