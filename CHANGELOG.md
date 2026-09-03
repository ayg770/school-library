# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The **schema version** is tracked separately from the application version: it
is the highest applied migration, shown on the Settings and Support screen.

## [Unreleased]

### Added — Phase 2: Circulation

Schema version: **3**

- Migration `003-circulation`: `loans` and `audit_log`.
- One open loan per copy, enforced by a partial unique index rather than by
  application code — concurrent scans cannot both succeed.
- Checkout: due date from `default_loan_days`, per-student loan limit, and
  refusal for an inactive student or a copy marked lost or withdrawn. A damaged
  copy still circulates.
- Return on the book scan alone; the borrower is already on the loan (§11).
- Renewal, which extends from today when a loan is already late so a renewal
  always grants the full period.
- Every circulation change writes its audit entry in the same transaction, so
  the log cannot disagree with the data (§23).
- Overdue is derived from the due date and the absence of a return, never
  stored.
- API: `POST /api/v1/circulation/{checkout,checkin,renew}`, `GET /api/v1/loans`,
  and `GET /api/v1/students/:publicId/library-summary` — the last one already
  in the shape the future integration endpoint returns (§8).
- The book card now shows who holds each copy and when it is due (§16).
- Screens: השאלה (find the student once, then scan book after book, keyboard
  only), החזרה (book scan alone), and השאלות with an overdue view, renewal and
  return.
- 45 further automated tests, including one that bypasses the domain entirely
  to prove the database itself rejects a second open loan.

### Added — Phase 1: Core catalog

Schema version: **2**

- Migration `002-catalog`: `classes`, `students`, `categories`,
  `shelf_locations`, `books`, `book_copies`, with the indexes §5 calls for.
- A title and a physical copy are separate records (§6): one book, many copies,
  each with its own barcode.
- Barcodes are stored exactly as supplied. A value containing whitespace is
  rejected rather than trimmed, and lookup is exact — leading zeros are
  significant (§7, §34).
- Students are deactivated, never deleted, so circulation history stays whole.
- ISBNs are normalised to digits so hyphenated and plain forms of the same
  edition match.
- Category cycles are rejected.
- Catalog API under `/api/v1`: classes, students, categories, shelf locations,
  books and copies, plus exact barcode lookup at
  `GET /api/v1/copies/by-barcode/:barcode` and
  `GET /api/v1/students/by-barcode/:barcode`.
- Domain errors carry a code and a Hebrew message — `DUPLICATE_BARCODE` answers
  409, validation answers 400 with the field named.
- Screens: students (search, filter by class, create, edit, deactivate); books
  (search by title, author, ISBN or copy barcode; detail with its copies; add a
  copy); classes, categories and shelf locations.
- The current screen is kept in the address, so a reload returns to it.
- 37 further automated tests, including the upgrade of a version-1 database
  carrying data to version 2.

### Added — Phase 0: Foundation

Schema version: **1**

- npm workspaces layout: `core` (domain, database, migrations), `server`
  (HTTP API), `ui` (React, Hebrew RTL). The application shell is deliberately
  deferred — see `docs/ARCHITECTURE.md` AD-1.
- SQLite initialisation with the pragmas required by `PRODUCT_SPEC.md` §5:
  `foreign_keys=ON`, WAL, `synchronous=NORMAL`, `busy_timeout=5000`.
- Migration runner: transactional, incremental, and refusing to proceed on a
  database from a newer build, an edited migration, or a gap in history.
- Migration `001-initial`: `app_settings`, `staff_users`.
- Application data directories outside the installation directory, per OS,
  overridable with `LIBRARY_DATA_DIR`.
- Structured logging (pino) to stdout and `logs/app.log`, with passwords and
  tokens redacted.
- `GET /api/v1/health` and `GET /api/v1/system/info`.
- Hebrew RTL shell with a vendored font — no CDN, no runtime network request.
- Settings and Support screen: application version, schema version, data paths,
  local-service reachability and internet status shown separately.
- Password hashing with scrypt from Node's own crypto module.
- 46 automated tests covering database initialisation, the migration runner,
  settings, path resolution, password hashing and the API.
- `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, `docs/INTEGRATION.md`.

### Not included

Circulation, catalog, students, books, barcode scanning, import, backup and
reports all arrive in later phases. Nothing in this release moves a book.
