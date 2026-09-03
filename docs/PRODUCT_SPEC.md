# School Library – Product & Architecture Specification

## 0. Purpose

Build a reliable, fast, offline-first desktop application for a school library.

The system must:
- work fully without internet during normal library operations;
- store the authoritative library data locally on the library computer;
- support very fast barcode-based checkout and return;
- support existing books whose library labels/barcodes are already attached;
- support importing part of the current catalog/student list from CSV/XLSX;
- support adding books that are not present in the old list while scanning shelves;
- allow safe upgrades for years without losing data;
- allow temporary access from other computers on the local network;
- be designed from day one for future integration with an existing student-management application;
- later allow library status (current loans, overdue items, history/summary) to appear on each student's card in the existing student system.

The MVP must not depend on cloud services.

## 1. Product principles

1. Offline first.
2. Local database is the source of truth for library circulation.
3. Student identity should ultimately come from the existing student-management system.
4. Never use a student's name as the permanent cross-system identifier.
5. Separate application code, database, backups, logs, and imports.
6. Never destroy or recreate a production database during an update.
7. Every schema change must be a migration.
8. Every destructive or structural operation must be preceded by a verified backup.
9. Barcode scanning paths must be keyboard-first and require almost no mouse use.
10. Network access must be optional and disabled by default.
11. Direct SQLite access from another computer is forbidden.
12. The library app should expose a stable service/API layer so other clients can integrate later.
13. Keep the MVP simple. Do not add cloud sync, reservations, fines, notifications, or complex cataloging unless explicitly requested.

## 2. Recommended technology stack

Primary proposal:
- Electron
- React
- TypeScript
- Node.js local backend/service
- SQLite
- better-sqlite3 or another mature SQLite binding compatible with the pinned Electron/Node version
- a small local HTTP API (Fastify preferred, Express acceptable)
- Zod or equivalent runtime validation
- Vitest/Jest for tests
- Playwright for a small set of critical end-to-end tests
- Git for version control

Important:
- Pin tested versions in package-lock.json.
- Do not auto-upgrade Electron/Node/native SQLite bindings without testing.
- Do not load runtime JavaScript, fonts, CSS, or core assets from a CDN.
- The application must launch and perform all circulation functions with internet completely disconnected.

Alternative stack changes require a written reason before implementation.

## 3. High-level architecture

### Desktop UI
Electron + React renderer.

Responsibilities:
- screens;
- forms;
- barcode input UX;
- visual feedback;
- reports;
- settings UI.

It must NOT access SQLite directly.

### Local application service
A Node service running on the same host.

Responsibilities:
- business rules;
- validation;
- database transactions;
- permissions;
- imports;
- backups;
- integration API;
- audit log.

The UI calls this service.

### SQLite database
Stored only on the library host computer.

Only the local service may open the SQLite database.

### Optional LAN client access
When an administrator enables LAN mode, browsers on the same local network may access the local service/UI.

Remote computers must never open the .sqlite/.db file directly.

## 4. Data storage layout

Do not place production data inside the application installation directory.

Use an OS-appropriate application data directory outside the installed executable. Keep separate subfolders:

- data/library.sqlite
- backups/
- logs/
- imports/
- exports/

Expose the current data and backup paths in Settings.

Add:
- Open data folder
- Create backup now
- Open backup folder

Do not hard-code a user Desktop path.

## 5. SQLite configuration

At database initialization:
- PRAGMA foreign_keys = ON
- WAL mode may be used because all SQLite connections remain on one host
- configure a sensible busy_timeout
- use explicit transactions for multi-step writes
- use indexes for barcode, external student IDs, active loans, title search, class, and due dates

Never place a WAL database on a shared SMB/NFS/network folder.

Suggested production pragmas should be benchmarked rather than blindly optimized:
- journal_mode=WAL
- synchronous=NORMAL (or FULL if later decided for stronger durability)
- busy_timeout=5000

## 6. Core domain model

A bibliographic title and a physical copy are different entities.

Example:
"מסילת ישרים" = one Book/Title record.
Five physical copies = five Copy records.
Each physical copy has its own library barcode.

ISBN identifies an edition/title, not a unique physical copy.

## 7. Database schema

Exact SQL may evolve through migrations, but preserve these concepts.

### schema_migrations
- id INTEGER PRIMARY KEY
- version INTEGER UNIQUE NOT NULL
- name TEXT NOT NULL
- applied_at TEXT NOT NULL

Rules:
- migrations are immutable once released;
- never edit an old production migration;
- add a new migration instead.

### app_settings
- key TEXT PRIMARY KEY
- value_json TEXT NOT NULL
- updated_at TEXT NOT NULL

Examples:
- school_name
- default_loan_days
- max_active_loans_per_student
- interface_language
- lan_enabled
- backup_retention_count
- automatic_backup_enabled

### staff_users
- id INTEGER PRIMARY KEY
- public_id TEXT UNIQUE NOT NULL
- username TEXT UNIQUE NOT NULL
- password_hash TEXT NOT NULL
- display_name TEXT NOT NULL
- role TEXT NOT NULL
- active INTEGER NOT NULL DEFAULT 1
- created_at TEXT NOT NULL
- updated_at TEXT NOT NULL

Roles:
- admin
- librarian
- read_only

Passwords must never be stored in plaintext.

### classes
- id INTEGER PRIMARY KEY
- public_id TEXT UNIQUE NOT NULL
- external_class_id TEXT NULL
- name TEXT NOT NULL
- grade TEXT NULL
- section TEXT NULL
- academic_year TEXT NULL
- active INTEGER NOT NULL DEFAULT 1
- created_at TEXT NOT NULL
- updated_at TEXT NOT NULL

### students
- id INTEGER PRIMARY KEY
- public_id TEXT UNIQUE NOT NULL
- first_name TEXT NOT NULL
- last_name TEXT NOT NULL
- class_id INTEGER NULL REFERENCES classes(id)
- local_barcode TEXT NULL
- active INTEGER NOT NULL DEFAULT 1
- notes TEXT NULL
- created_at TEXT NOT NULL
- updated_at TEXT NOT NULL

Important:
- student names may change;
- students may move classes;
- never use first_name + last_name as the integration key;
- do not hard-delete students with history; mark inactive.

### external_student_links
Critical future-integration table.

Purpose:
Map one local student to the permanent identifier used by another system.

Fields:
- id INTEGER PRIMARY KEY
- student_id INTEGER NOT NULL REFERENCES students(id)
- system_key TEXT NOT NULL
- external_student_id TEXT NOT NULL
- external_student_code TEXT NULL
- is_primary INTEGER NOT NULL DEFAULT 0
- last_synced_at TEXT NULL
- sync_status TEXT NULL
- created_at TEXT NOT NULL
- updated_at TEXT NOT NULL

Constraint:
- UNIQUE(system_key, external_student_id)

### categories
- id INTEGER PRIMARY KEY
- name TEXT NOT NULL
- parent_id INTEGER NULL REFERENCES categories(id)
- active INTEGER NOT NULL DEFAULT 1

### shelf_locations
- id INTEGER PRIMARY KEY
- name TEXT NOT NULL
- room TEXT NULL
- shelf_code TEXT NULL
- active INTEGER NOT NULL DEFAULT 1

### books
Bibliographic/title-level record.

- id INTEGER PRIMARY KEY
- public_id TEXT UNIQUE NOT NULL
- title TEXT NOT NULL
- subtitle TEXT NULL
- author_text TEXT NULL
- publisher TEXT NULL
- publication_year TEXT NULL
- isbn10 TEXT NULL
- isbn13 TEXT NULL
- language TEXT NULL
- category_id INTEGER NULL REFERENCES categories(id)
- default_call_number TEXT NULL
- notes TEXT NULL
- active INTEGER NOT NULL DEFAULT 1
- created_at TEXT NOT NULL
- updated_at TEXT NOT NULL

Do not over-normalize authors in MVP unless required.

### book_copies
One physical item.

- id INTEGER PRIMARY KEY
- public_id TEXT UNIQUE NOT NULL
- book_id INTEGER NOT NULL REFERENCES books(id)
- barcode TEXT UNIQUE NOT NULL
- legacy_id TEXT NULL
- accession_number TEXT NULL
- shelf_location_id INTEGER NULL REFERENCES shelf_locations(id)
- condition_status TEXT NOT NULL DEFAULT 'normal'
- purchase_date TEXT NULL
- price_cents INTEGER NULL
- condition_note TEXT NULL
- verified_at TEXT NULL
- active INTEGER NOT NULL DEFAULT 1
- created_at TEXT NOT NULL
- updated_at TEXT NOT NULL

Barcode rules:
- barcode is TEXT, never INTEGER;
- preserve leading zeros;
- exact-match lookup;
- never silently trim or reformat imported barcodes;
- uniqueness is enforced;
- loan state is derived from an active loan, not duplicated in a loaned status field.

condition_status:
- normal
- damaged
- lost
- repair
- withdrawn

### loans
Permanent circulation history.

- id INTEGER PRIMARY KEY
- public_id TEXT UNIQUE NOT NULL
- copy_id INTEGER NOT NULL REFERENCES book_copies(id)
- student_id INTEGER NOT NULL REFERENCES students(id)
- checkout_at TEXT NOT NULL
- due_at TEXT NULL
- returned_at TEXT NULL
- checkout_by_user_id INTEGER NULL REFERENCES staff_users(id)
- return_by_user_id INTEGER NULL REFERENCES staff_users(id)
- renewal_count INTEGER NOT NULL DEFAULT 0
- notes TEXT NULL
- created_at TEXT NOT NULL
- updated_at TEXT NOT NULL

Rules:
- returned_at IS NULL = active loan;
- only one active loan may exist for a given copy;
- returned loans are never deleted during normal operation;
- create a partial unique index equivalent to UNIQUE copy_id WHERE returned_at IS NULL.

### audit_log
- id INTEGER PRIMARY KEY
- event_id TEXT UNIQUE NOT NULL
- user_id INTEGER NULL
- action TEXT NOT NULL
- entity_type TEXT NOT NULL
- entity_id TEXT NULL
- old_data_json TEXT NULL
- new_data_json TEXT NULL
- created_at TEXT NOT NULL

Audit at least:
- barcode changes
- copy lost/damaged/withdrawn
- student merge/link changes
- manual loan corrections
- settings affecting circulation
- restore operations
- integration configuration changes

### import_batches
- id INTEGER PRIMARY KEY
- public_id TEXT UNIQUE NOT NULL
- filename TEXT NOT NULL
- import_type TEXT NOT NULL
- started_at TEXT NOT NULL
- finished_at TEXT NULL
- total_rows INTEGER NOT NULL DEFAULT 0
- success_count INTEGER NOT NULL DEFAULT 0
- warning_count INTEGER NOT NULL DEFAULT 0
- error_count INTEGER NOT NULL DEFAULT 0
- status TEXT NOT NULL

### import_rows
Recommended staging table.

- id INTEGER PRIMARY KEY
- batch_id INTEGER NOT NULL REFERENCES import_batches(id)
- row_number INTEGER NOT NULL
- raw_data_json TEXT NOT NULL
- normalized_data_json TEXT NULL
- status TEXT NOT NULL
- error_json TEXT NULL

Purpose:
Validate imports before committing data to production tables.

### integration_configs
- id INTEGER PRIMARY KEY
- system_key TEXT UNIQUE NOT NULL
- display_name TEXT NOT NULL
- mode TEXT NOT NULL
- base_url TEXT NULL
- enabled INTEGER NOT NULL DEFAULT 0
- config_json TEXT NULL
- last_success_at TEXT NULL
- last_error_at TEXT NULL
- last_error_message TEXT NULL

Do not store raw API secrets in ordinary plaintext settings. Use the OS credential store/keychain when an online connector is implemented.

### integration_outbox
Critical for reliable future synchronization.

Every library change that must be sent to another system is first recorded locally.

- id INTEGER PRIMARY KEY
- event_id TEXT UNIQUE NOT NULL
- system_key TEXT NOT NULL
- event_type TEXT NOT NULL
- entity_type TEXT NOT NULL
- entity_public_id TEXT NOT NULL
- student_public_id TEXT NULL
- external_student_id TEXT NULL
- payload_json TEXT NOT NULL
- occurred_at TEXT NOT NULL
- delivery_status TEXT NOT NULL DEFAULT 'pending'
- attempt_count INTEGER NOT NULL DEFAULT 0
- last_attempt_at TEXT NULL
- delivered_at TEXT NULL
- last_error TEXT NULL

Possible event types:
- loan.checked_out
- loan.returned
- loan.renewed
- loan.due_date_changed
- copy.lost
- copy.found
- copy.damaged

Why:
The library must continue working while offline. If internet is unavailable, events stay pending. When a connection is available, the connector retries them safely.

Every event has a stable event_id so the receiving system can process it idempotently and avoid duplicates.

## 8. Student-system integration strategy

### Ownership of data

Existing student-management system owns:
- student's permanent identity;
- current name;
- class;
- active/inactive school status;
- other school profile information.

Library system owns:
- books;
- copies;
- checkouts/returns;
- overdue state;
- library history;
- lost/damaged library items.

Do not create two independent authoritative copies of the same domain data.

### Initial phase before API integration exists

Allow students to be imported from CSV/XLSX.

If the exported student file contains a stable student ID, store it immediately in external_student_links.

If it contains only names:
- import names/classes;
- later perform a one-time reconciliation when the main system exposes IDs;
- once linked, persist the external ID permanently;
- never repeatedly match by name.

### Future preferred one-way student sync

Main student system -> Library:
- external_student_id
- first_name
- last_name
- class
- active status

Library should not overwrite these fields back unless explicitly designed.

### Future library status in student card

Two supported approaches:

#### A. Live local API
Best when the student application can reach the library computer.

Example:
GET /api/v1/integrations/students/{externalStudentId}/library-summary

Example response:
{
  "studentId": "student-48291",
  "activeLoanCount": 3,
  "overdueCount": 1,
  "activeLoans": [
    {
      "loanId": "uuid",
      "copyBarcode": "001796",
      "title": "מסילת ישרים",
      "checkoutAt": "...",
      "dueAt": "...",
      "overdue": true
    }
  ],
  "lifetimeLoanCount": 42,
  "lastLibraryActivityAt": "..."
}

Advantages:
- always current;
- no duplicate loan data;
- library remains source of truth.

Limitation:
- library computer/service must be reachable.

#### B. Offline-safe event synchronization
Best if the existing student application is online/cloud-based and the library computer is often offline.

Flow:
1. checkout/return succeeds locally;
2. same local transaction creates an integration_outbox event;
3. circulation screen immediately succeeds; internet is not required;
4. when internet is available, sync worker sends pending events;
5. receiving system stores/updates the student's library summary;
6. event is marked delivered only after confirmed success;
7. retries are automatic;
8. event_id is used as idempotency key.

Recommended long-term hybrid:
- Student roster flows from main student system to library.
- Loan activity flows from library to main student system through outbox sync.
- A live summary API may also exist on the LAN.
- No direct database-to-database coupling.

## 9. Integration API design

Version all integration endpoints:
/api/v1/...

Minimum future endpoints:
- GET /api/v1/health
- GET /api/v1/students
- GET /api/v1/students/:publicId
- GET /api/v1/integrations/students/:externalStudentId/library-summary
- GET /api/v1/loans?studentId=&status=active
- GET /api/v1/loans/:publicId
- POST /api/v1/circulation/checkout
- POST /api/v1/circulation/checkin
- POST /api/v1/circulation/renew

Rules:
- validate every request;
- never expose SQL;
- no direct DB access from client;
- use stable public IDs in APIs, not internal row IDs;
- return structured error codes;
- version breaking changes;
- require authentication for LAN/external access.

## 10. Barcode/scanner requirements

The app must work with generic USB barcode scanners in USB HID Keyboard mode.

Expected behavior:
- scanner types characters as keyboard input;
- scanner sends Enter/Carriage Return as suffix;
- app treats Enter as scan completion;
- do not depend primarily on timing heuristics;
- scanner focus automatically returns after every action;
- scanner workflow must work without mouse.

Support:
- existing 1D library labels;
- future Code 128 labels;
- QR/2D scanners may be used for student cards, campaigns, lotteries, etc.

Do not tie application logic to a vendor SDK for MVP.

Scanner test screen:
- show raw scanned value;
- show length;
- show timestamp;
- show detected suffix;
- allow user to confirm expected barcode.

New internally generated copy barcodes:
- prefer numeric-only unique values or a simple ASCII format;
- keep them human-readable below the barcode;
- Code 128 is a good default for book-copy labels;
- QR may be used for student/event cards, but is not required for book copies.

## 11. Primary workflows

### Checkout
1. scan/search student;
2. display student name, class, active loans, overdue warning;
3. keep focus in book scan field;
4. scan copy barcode;
5. exact indexed lookup;
6. validate availability and student status;
7. write loan in a transaction;
8. add audit/integration outbox event in same transaction;
9. large green success indication;
10. optional sound;
11. focus returns immediately;
12. next scan.

Do not require a confirmation modal for every normal checkout.

### Return
1. scan book;
2. locate active loan;
3. set returned_at;
4. log event/outbox in same transaction;
5. display book + returning student;
6. green success;
7. immediately ready for next scan.

No student scan for ordinary return.

### Unknown barcode
Show "Barcode not found".

Options:
- Scan again
- Add this physical copy
- Search for existing title and attach copy
- Create new title

Preserve scanned barcode in the flow.

## 12. Shelf intake / migration mode

Important early feature.

Screen:
"קליטת ספרים מהמדף"

On known scan:
- show title/author/barcode/status/location;
- mark verified_at.

On unknown scan:
- preserve barcode;
- search existing title;
- create title if needed;
- optionally scan ISBN;
- create physical copy.

Conflicts:
- never overwrite automatically;
- dedicated conflict screen.

Dashboard:
- scanned/verified today
- known copies
- newly added copies
- conflicts
- imported but not yet physically verified

## 13. Import system

Support:
- CSV
- XLSX

Import types:
- students/classes
- books/copies
- historical loans later

Wizard:
1. choose file;
2. preview;
3. map columns;
4. validate;
5. show conflicts/warnings;
6. commit;
7. report.

Never silently rewrite barcodes.
Barcode columns are text.

Detect:
- duplicate barcode in file;
- duplicate barcode already in DB;
- missing title;
- duplicate student external ID;
- ambiguous names;
- blank rows.

## 14. Search

Search:
- title
- author
- barcode
- ISBN
- category
- shelf
- student name
- external student ID

Barcode search:
- exact
- indexed
- near-instant.

Consider SQLite FTS5 later for large title/author catalog after profiling.

## 15. Student card

Show:
- name
- class
- external-system link status
- student barcode if used
- active loans
- overdue loans
- history
- total loans this year
- last library activity

## 16. Book card

Show:
- title
- author
- ISBN
- category
- notes
- all copies
- copy barcode
- location
- condition
- current borrower
- circulation history

## 17. Reports – MVP

- active loans
- overdue
- by student
- by class
- lost copies
- damaged copies
- inventory
- popular titles
- date-range circulation
- imported but not physically verified
- shelf-intake verification

Export:
- CSV first
- XLSX if convenient
- PDF later

## 18. Backup and restore

Use a SQLite-safe backup mechanism, not naive copy of a live DB.

Preferred:
- SQLite Online Backup API, or
- VACUUM INTO where appropriate.

Create backup:
- manually;
- before migration;
- before restore;
- before significant update;
- optionally daily.

Keep several historical backups and allow an external/USB backup folder.

Restore:
1. admin only;
2. create backup of current state;
3. coordinate/close DB connections;
4. restore snapshot;
5. integrity check;
6. verify schema;
7. restart;
8. audit.

## 19. Updates and migrations

Application update and data are separate.

Flow:
1. install update;
2. locate data directory;
3. read schema version;
4. safe backup;
5. run migrations;
6. sanity checks;
7. open UI.

If migration fails:
- stop;
- log;
- preserve backup;
- provide recovery path.

Never create an empty DB merely because opening the old DB failed.

## 20. LAN mode

Default:
- localhost only.

Admin toggle:
"גישה ברשת המקומית"

When enabled:
- bind to LAN;
- authentication required;
- show local URL;
- allow immediate disable;
- optional read-only accounts.

Never expose SQLite.
Never automatically open public router ports.

## 21. Security

Electron:
- contextIsolation=true
- nodeIntegration=false
- sandbox where possible
- restrictive CSP
- narrow contextBridge
- validate IPC
- no remote code
- do not disable webSecurity
- restrict navigation/windows

Application:
- hash passwords;
- roles;
- audit privileged changes;
- no secrets in logs;
- future API tokens in OS credential store.

Privacy:
- duplicate only student data needed for library work.

## 22. Performance targets

Targets:
- barcode exact lookup typically <50ms locally;
- ordinary checkout/return feedback target <150ms;
- no internet dependency;
- no spinner for normal scans.

Use:
- indexes
- short transactions
- no network request in critical scan path
- background sync/import
- pagination for long history

## 23. Reliability

A green checkout means:
- loan committed locally;
- audit/outbox event committed locally;
- no internet confirmation needed.

Checkout transaction should include:
- create loan
- audit event
- integration outbox event

Rollback all if required local steps fail.

## 24. Error handling/logging

User-facing:
- short Hebrew message
- clear recovery action
- no stack trace

Developer logs:
- timestamp
- app version
- context
- error code
- sanitized details

Support screen:
- app version
- schema version
- data path
- last backup
- last successful sync
- pending sync count
- LAN state
- scanner test
- open logs folder

## 25. UI/UX

Primary language: Hebrew, true RTL.
Prepare for Russian later.

Home:
- השאלה
- החזרה
- קליטת ספרים מהמדף
- חיפוש
- תלמידים
- ספרים
- דוחות
- ייבוא
- גיבוי
- הגדרות

Use few dialogs.
Scanner workflows are keyboard-first.
Green success, red block/error, yellow warning.

## 26. Future features – not MVP

- reservations
- fines
- notifications
- ISBN metadata enrichment when online
- cover images
- label printing
- student QR cards
- reading campaigns
- lottery/points modules
- dashboards
- mobile scanning
- cloud mirror
- multiple branches

Design should not prevent these, but do not build prematurely.

## 27. New book intake

Conceptual identifiers:
- publisher ISBN = title/edition
- library barcode = unique physical copy

Flow:
1. optionally scan ISBN;
2. search local catalog;
3. optional online metadata enrichment later;
4. select/create title;
5. assign unique internal library barcode;
6. create copy;
7. optionally print label later.

## 28. Testing

Cover:
- barcode leading zeros
- duplicate barcode
- checkout
- already-loaned rejection
- return
- return of non-loaned copy
- inactive student
- lost/withdrawn copy
- active-loan uniqueness
- migration sequence
- import validation
- backup/restore
- external link uniqueness
- outbox transaction
- retry/idempotency
- startup with network disconnected

E2E smoke:
1. create/import student
2. create book/copy
3. select student
4. checkout
5. return
6. verify history

## 29. Git/release

Repository:
- CLAUDE.md
- docs/PRODUCT_SPEC.md
- docs/ARCHITECTURE.md
- docs/DATABASE.md
- docs/INTEGRATION.md
- CHANGELOG.md
- migrations/
- tests/

Never commit:
- production DB
- backups
- real student exports
- tokens
- sensitive logs

Use small commits.

## 30. Suggested phases

Phase 0 – Foundation:
- repository
- Electron/React/TypeScript
- local service
- SQLite
- migration runner
- logging
- settings
- security
- tests
- RTL shell

Phase 1 – Core catalog:
- classes
- students
- books
- copies
- categories
- shelves
- CRUD/search

Phase 2 – Circulation:
- checkout
- return
- renewal
- student card
- book card
- overdue
- audit

Phase 3 – Barcode UX:
- scanner
- suffix
- autofocus
- test screen
- duplicate-scan protection

Phase 4 – Legacy import + shelf intake

Phase 5 – Backup/update safety

Phase 6 – Reports/export

Phase 7 – LAN

Phase 8 – Integration foundation:
- external_student_links
- integration_configs
- integration_outbox
- library-summary endpoint
- sync worker interface
- connector adapter abstraction

Phase 9 – Real student-system connector only after API details are known.

## 31. Connector abstraction

Do not hard-code the future student system throughout the library code.

Conceptual interfaces:

StudentDirectoryConnector:
- testConnection()
- fetchStudents(since?)
- fetchClasses(since?)
- getStudent(externalId)

LibraryEventConnector:
- testConnection()
- sendEvent(event)
- sendBatch(events)
- optionally pushSnapshot(student)

Implement initially:
- NoOpConnector
- CsvStudentImporter

Real connector later.

## 32. Information needed later for existing student app

Do not block early phases on these, but collect before Phase 9:
1. application name;
2. web/desktop/local DB;
3. hosting;
4. API availability;
5. write/update capability;
6. stable immutable student ID;
7. can a Library section be added to student profile?;
8. plugin/extension support;
9. database technology;
10. integration authentication;
11. must library status remain visible when library PC is offline?;
12. history depth;
13. fields to display: active count, titles, due dates, overdue, lost, full history;
14. source of truth for class/status;
15. desired sync frequency.

## 33. Definition of done for MVP

MVP is successful when:
- app starts offline;
- data imports;
- missing books can be added;
- shelf intake works;
- student selected/scanned;
- rapid multi-book checkout;
- return by book scan only;
- history correct;
- overdue works;
- update preserves data;
- backup/restore tested;
- data separated from binaries;
- generic HID scanner supported;
- external student IDs/API boundaries are ready;
- future student-system connector can be added without rewriting circulation.

## 34. Hard prohibitions

Do NOT:
- delete/recreate existing DB for schema fixes;
- alter production schema without migration;
- access SQLite from renderer;
- store barcode as number;
- identify students across systems by name;
- put production DB on network share;
- make checkout depend on internet;
- silently discard import failures;
- ignore failed migrations;
- expose local service publicly;
- open router ports automatically;
- add cloud dependencies without approval;
- implement real external connector before target contract is known.
