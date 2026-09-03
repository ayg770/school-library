# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The **schema version** is tracked separately from the application version: it
is the highest applied migration, shown on the Settings and Support screen.

## [Unreleased]

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
