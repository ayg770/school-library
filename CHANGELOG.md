# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The **schema version** is tracked separately from the application version: it
is the highest applied migration, shown on the Settings and Support screen.

## [Unreleased]

### Added — The sync between the library computer and the online library

- **The catalogue, the pupils and the accounts come down; circulation goes up.**
  One button on a new **סנכרון** screen. Nothing else changes: lending and
  returning work with the cable out, exactly as before, and a sync that never
  happens delays a report rather than a child borrowing a book.
- **A checkout proposed from the office becomes real only here.** If the copy
  is already lent from the desk, the suggestion keeps waiting and says so —
  the person holding the book wins.
- **A copy imported here before the two sides met adopts the online id**
  instead of colliding with it. Matching is on the barcode, which is the same
  number whoever wrote it down.
- **An account created in the office arrives without a password.** The office
  decides who the staff are; this computer decides how they prove it. A
  password set here never travels, and the account cannot sign in until an
  administrator here gives it one.
- **A loan the online library refuses is named, with the reason**, and the rest
  are still sent. The mark only advances past what was actually accepted, so a
  refused loan is retried rather than forgotten.
- **Who may change what is now enforced by Postgres, not by the screens.**
  Staff may read; circulation may be written by a librarian; the catalogue, the
  pupils and the accounts belong to an administrator. Verified against the live
  database: a librarian reads 2,039 books, changes none, cannot add a pupil and
  cannot promote itself.
- **Fixed while building this:** a checkout made at the desk was not marked
  confirmed, which under the new index would have let the same copy go out
  twice. Caught by a test, not in the library.
- **Fixed while building this:** Postgres and SQLite spell a timestamp
  differently, and "everything changed since" is compared as text — so a loan
  could have looked older than it was and been re-sent for ever. Every
  timestamp is normalised on the way in.


### Added — The office site

- **A site for managing the library from anywhere**, published to GitHub Pages
  and talking straight to Supabase. Sign in, and edit the catalogue, the
  categories and the shelf locations without going to the library.
- The same stylesheet as the installed program, because the office and the
  library are the same library and a person who learns one screen should
  recognise the other.
- **Signing up is not the same as being let in.** An administrator prepares an
  account by email; the person claims it by signing in. Someone who signs up
  without a prepared row is told so plainly instead of landing on an
  application that shows nothing.
- The home screen says when the library computer last synced, rather than
  showing figures that look live.
- **Fixed before release:** the first attempt linked accounts with a trigger on
  Supabase's own `auth.users` table, and it broke signing in for everyone —
  the auth service runs as its own role and could not reach the schema the
  trigger lived in. Replaced with a function the application calls after
  signing in, so nothing this project owns now runs inside Supabase's
  authentication path.
- **Fixed:** `currentStaff` asked for "a" staff row. Staff may read each other,
  so it would cheerfully have signed you in as a colleague.
- Verified against the live database, not a mock: signed out sees nothing,
  claiming is refused when signed out, every screen's query returns what the
  screen expects, an edit written from the office comes back changed and
  stamped, and signing out makes it all invisible again. Sixteen checks, all
  passing; every row they created was removed.
- **Fixed after publishing:** the e-mail field on the sign-in screen came out
  unstyled — narrower than the password box beneath it, with square corners —
  because the stylesheet listed the input types it covered and `email` had
  never been used before. It now names the types it excludes instead, so the
  next new kind of field is styled without anyone remembering to add it.

### Added — The online database

- **Supabase now holds the library.** A dedicated project, free tier, Frankfurt.
  The office works against it from a browser; the library computer keeps its
  own copy and syncs. See `ARCHITECTURE.md` AD-9, which supersedes AD-8.
- **Each side owns what it writes.** Catalogue, categories, students and
  accounts are the office's; loans are the library's. Two writers that never
  touch the same row need no conflict resolution — only a union.
- **A loan proposed online is a suggestion.** `origin` and `confirmed_at` carry
  that, and the unique index enforcing one open loan per copy counts only
  confirmed rows. A suggestion made in the office can never stop a librarian
  lending the book in their hand.
- **The public id is the primary key.** A row number is local to one machine,
  and the same library now lives in two places.
- **Nothing is readable without an account.** Row level security is forced on
  every table, with one policy: the caller must map to an active staff row.
  Verified that the anonymous key — the one a web page carries — reads nothing.
- **The database stamps `updated_at` itself**, so a change made anywhere,
  including by hand in Supabase's own table editor, still reaches the library.
- The policy helper lives in a `private` schema, because Supabase publishes
  every function in `public` as a REST endpoint.
- Zero findings from Supabase's security advisor.
- `supabase/migrations/` mirrors what was applied. A schema that exists only in
  a running system is one nobody can review, and one that cannot be rebuilt.

### Fixed — A list reported how many rows were on screen as the size of the library

Schema version: **5** (unchanged)

- Books, students and loans are fetched 200 at a time so a real catalogue does
  not become two thousand table rows. All three then reported that 200 as the
  count. A librarian who imports 2,039 titles and reads "200 ספרים" has every
  reason to believe the import lost most of their books.
- The total now leads, and the cap is stated when it applies: "2,039 ספרים ·
  מוצגים 200 הראשונים". Narrowing by search or filter removes the note as soon
  as everything fits.
- Found by importing a real 2,264-row catalogue rather than a test fixture.

### Fixed — Column mapping proposed a record number as the book title

Schema version: **5** (unchanged)

- A partial header match took the first column that contained the word rather
  than the closest one. A real catalogue export names its columns `IN_TITLE_no`
  (a record number) and `TI_TITLE` (the title), in that order — both contain
  "title", so every book was proposed to be named after a number.
- The librarian confirms the mapping before anything is imported (§13), so
  nothing could have been silently lost. But a proposal has to be worth
  confirming, and a catalogue imported with numbers for names is a catalogue
  that has to be done again.
- A partial match now takes the header the alias accounts for most of. An exact
  match is still decided first, so it can never be overruled by closeness.
- 3 further automated tests, built from the headers that found this.

### Added — Browsing the catalogue by subject and by shelf

Schema version: **5** (unchanged)

- **"הקטלוג במבט אחד"**: every category with its titles and copies, every shelf
  with its copies and how many of them are out. Clicking one filters the list.
- **Filters on the book list**, for category and for shelf location. They
  narrow the search rather than replacing it, so "comics on shelf 3" is one
  question and not three screens.
- A shelf holds copies, not titles, so filtering by shelf asks about the copies
  and reports the titles they belong to — and a book with three copies on one
  shelf appears once, not three times.
- **Titles with no category and copies with no shelf are counted.** This is
  what makes an import checkable: if four hundred books arrive and none of them
  landed in a category, the screen says so.
- Every figure is counted from the books and copies themselves. Nothing is
  stored, so nothing can drift.
- **Fixed:** a filter in a toolbar was full-width, which pushed every other
  control onto its own line and turned the row into a stack of bars.
- 11 further automated tests.

### Added — Checking for a new version

Schema version: **5** (unchanged)

- **"בדוק עדכון"** on the Settings and Support screen: it asks whether a newer
  release has been published, and if so offers the download page. Installing
  stays a decision a person makes.
- Only when asked. Nothing polls in the background — the library computer works
  offline by design, so a background check would either fail constantly or
  interrupt a queue of children waiting to borrow books.
- Being offline is reported as a plain statement, not a fault: "the program is
  working normally in the meantime". The route always answers, and never with
  an error the librarian has to interpret.
- The comparison is by number, not by text, so 0.10.0 is newer than 0.9.0. A
  pre-release is never offered, and a build newer than the last release is
  never asked to downgrade.
- `LIBRARY_RELEASES_URL` redirects the check, for a fork or for a test.
- 14 further automated tests.

### Added — The Windows application

Schema version: **5** (unchanged)

- **A program for the library computer.** Electron shell in `packages/desktop`:
  it starts the existing service in its own process on a port Windows assigns,
  opens a window onto it, and closes the database on the way out. It adds no
  domain rule, no screen and no route — everything it shows already existed.
- **Offline by construction.** The database is on the library computer and the
  application never needs the network to lend or return a book. This is the
  question `ARCHITECTURE.md` AD-1 deferred, now answered — see AD-8.
- The window is a browser onto the local service, with no Node, no
  `contextBridge` and no database handle in the renderer (AD-2). A LAN browser
  and the application window take the same path into the data.
- One instance at a time. Two copies would be two sets of migrations against
  one file; a second launch focuses the first window.
- A short Hebrew menu: reload, zoom, and the data, backups and log folders —
  what an application can offer and a web page cannot.
- A failure to start shows a dialog naming the log file, because a library
  computer has no console to print to.
- **Two installers**, built by `.github/workflows/desktop.yml` on a Windows
  runner: an ordinary setup program, and a single portable file that runs
  without installing. Pushing a `v*` tag publishes both as a release.
- `better-sqlite3` is fetched already compiled for Electron rather than rebuilt,
  so a Windows installer needs no compiler on the build machine.
- The application directory is built rather than collected — the packager is
  handed a finished Electron application, not the workspace. Packaging a
  monorepo is where these builds usually break.
- `LIBRARY_SQLITE_BINDING` names the native module explicitly. A packaged
  application is not laid out the way npm lays a project out, and a native
  module that has to be searched for is a blank window with nothing in the log.
- `createLogger({ console: false })` for a packaged program, which has no
  console attached to write to.
- **CI**: typecheck, lint and tests on every pull request, and the same checks
  on Windows before an installer is built.
- `docs/DESKTOP.md`, and `ARCHITECTURE.md` AD-8.
- 4 further automated tests.

### Added — Home screen, shelf intake, and a design pass

Schema version: **5** (unchanged)

- **Shelf intake** (§12, §27): one barcode, one title, one step. The title is
  found or created and the copy is always new, so adding the fifth copy of a
  book needs nothing different from adding the first — and lands as a fifth
  copy rather than a fifth book (§6). Matching is by ISBN first, then title and
  author, the same rule the file import uses, so a book typed by hand and the
  same book arriving in a spreadsheet land on one record.
- **Home screen**: a KPI row of headline numbers — on loan, overdue, today's
  activity, catalogue size — with the overdue list beneath it and the daily
  tasks as targets big enough to hit without looking. A row of counts, not a
  chart: four bars would say less than the four numbers.
- Every figure is derived. Nothing on the home screen is a stored counter that
  could drift from the loans themselves.
- **Design pass**: a token system with a chosen dark mode rather than an
  automatic flip, a grouped sidebar in place of ten top tabs, and one accent
  hue reserved for the current item and the primary action. Status colour is
  always accompanied by a word.
- Sign-in now stands on its own, without the application frame around it.
- **Fixed:** intake reported the copy count as it was *before* the copy was
  added, so the screen always showed one fewer than the truth.
- Hebrew agrees with the count — "1 תלמיד", not "1 תלמידים".
- 14 further automated tests.
### Added — Deployment packaging

- The service can now serve the built interface itself (`UI_DIR`), so a
  deployment is one process on one URL rather than two. Unknown page paths get
  the application shell; unknown `/api` paths still get an error.
- `TRUST_PROXY` makes the service read the original scheme from the proxy in
  front of it. Without it the session cookie would lose its `Secure` flag on
  exactly the deployments that need it — a bug that would only have appeared in
  production.
- A `Dockerfile` that builds the native module in one stage and ships only what
  runs, with a health check.
- `npm run build` bundles the server to a single file and builds the interface.
  Only the workspace's own code is bundled: `exceljs` is CommonJS with dynamic
  requires and `better-sqlite3` is native, and neither survives being inlined.
- `docs/DEPLOYMENT.md`.

### Added — Sign-in and permissions

Schema version: **5**

- Migration `005-sessions`: `staff_sessions`.
- A username and password held locally, not an identity provider — an identity
  provider cannot be reached with the network down, which is the one thing this
  application must survive. See `docs/ARCHITECTURE.md` AD-6.
- Three roles: `read_only` reads, `librarian` runs the library, `admin` also
  manages accounts, backup and restore.
- Every route is closed by default. A route added later is protected unless it
  is explicitly listed as public, rather than the other way round.
- The session token lives in an httpOnly cookie and only its hash is stored, so
  neither a page script nor a copy of the database yields a session.
- A wrong username and a wrong password give the same answer and take a
  comparable time, so the form cannot be used to discover which accounts exist.
- Changing a password, or deactivating an account, ends its sessions at once.
- The last administrator cannot be demoted or deactivated — locking everyone
  out is not recoverable from inside the application.
- A first-run screen creates the first administrator, and refuses once any
  account exists.
- Screens the current role cannot use are hidden, though the service refuses
  the request regardless of what the interface offers.
- 23 further automated tests.

### Added — Phase 4: Import from a file

Schema version: **4**

- Migration `004-imports`: `import_batches` and `import_rows`.
- CSV and XLSX, read as text throughout so a barcode of `0000123` cannot become
  the number 123.
- CSV encoding is detected: a UTF-8 BOM is honoured, and bytes that are not
  valid UTF-8 are decoded as windows-1255 — which is what Excel on a Hebrew
  Windows writes by default.
- Columns are proposed automatically from the file's own headers, in Hebrew and
  English, and the librarian confirms or corrects them.
- Nothing reaches the catalogue until the final step (§13). Every row is staged,
  validated and reported first.
- Detected: a missing required value, a barcode duplicated inside the file, a
  barcode already in the catalogue, a barcode containing whitespace, an invalid
  ISBN, a name that already exists, and blank rows.
- Several rows sharing a title become one book with several copies (§6), matched
  on ISBN first and title plus author second.
- Classes, categories and shelf locations named in the file are created as
  needed, and the report says which.
- A row that fails at commit is recorded as failed and the rest continue: one
  bad record in a three-thousand-row catalogue does not cost the whole import.
- A four-step wizard: choose, map, review, commit.
- **Fixed:** a POST with no body was sent with a JSON content type and rejected
  by the server, which broke "back up now" and "run the import" from the
  browser. The client now omits the header when there is no body, and the
  server accepts an empty body on a request that takes no parameters.
- 32 further automated tests.

### Added — Phase 5: Backup and update safety

Schema version: **3** (unchanged)

- Backups via SQLite's online backup API, and `VACUUM INTO` where the caller
  cannot await — never a file copy of a live database.
- An automatic backup before migrations run, taken only when there is data to
  lose and a change about to happen. If the migration then fails, the snapshot
  is on disk and the database is untouched (§19).
- An automatic snapshot before every restore, so restoring the wrong backup can
  itself be undone.
- Retention bounded by `backup_retention_count`; snapshots taken before a
  migration or restore are never pruned.
- Verification before any restore: integrity check, and refusal of a backup
  written by a newer release than the running build.
- `AppContext.db` became a getter so a restore can swap the underlying database
  without anything holding the context needing to know.
- API: `GET/POST /api/v1/backups`, `GET /api/v1/backups/:id/verify`,
  `POST /api/v1/backups/:id/restore` — the last requiring an explicit
  `confirm`, so a stray request cannot replace the database.
- A גיבוי screen: list, back up now, check, and restore behind a confirmation
  that says what will be lost.
- 19 further automated tests.

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
