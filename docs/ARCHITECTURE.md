# Architecture Decisions

Records *why* the system is built the way it is. `PRODUCT_SPEC.md` defines
*what* it must do; this file records the structural choices made to get there,
so a future change is a deliberate revision rather than an accident.

Status legend: **Accepted** · **Superseded** · **Open**

---

## AD-1 — The application shell is deferred

**Status:** Resolved by AD-8 · 2026-09-06 — the question this deferred has been
answered, and the shell is built. Kept because the reasoning still explains why
`core`, `server` and `ui` are shaped the way they are.

### Context

`PRODUCT_SPEC.md` §2 proposes Electron as the delivery vehicle. At the time of
writing, it is **not yet known** whether software can be installed on the
library computer at all. The system may end up delivered as:

- an installed desktop application, or
- a browser-based application with no installation.

Committing to Electron now means rework if the answer turns out to be the
second. Committing to a hosted web app now means abandoning offline-first
before it is necessary.

### Decision

Build the system as four packages, and postpone the shell:

| Package | Contains | Knows about |
|---|---|---|
| `core` | Domain rules, SQLite access, migrations | Nothing above it |
| `server` | HTTP API (`/api/v1`) over `core` | `core` |
| `ui` | React renderer, Hebrew RTL | HTTP only |
| `desktop` | Electron shell — **not built yet** | `server`, `ui` |

`core`, `server` and `ui` are identical under either delivery model and
represent the large majority of the work. Phase 0 builds those three and runs
them in a browser against `localhost`.

### Consequences

- Phase 0 has no native module to rebuild, no platform-specific packaging, and
  no installer. It can be built and genuinely executed in a remote Linux
  session, rather than written blind and first run on the target machine.
- `ui` must never import from `core` or `server` directly. Its only contract is
  the HTTP API. This is what makes the shell swappable — and it is also what
  §20 (LAN access) already requires, since a LAN browser client and the local
  UI then share one code path.
- Adding the Electron shell later is a thin, additive package: start `server`
  in the main process, load `ui`, expose OS affordances (open data folder,
  paths, version) over a narrow `contextBridge`.

### The cost of choosing "web, hosted" later

This must be stated plainly, because it contradicts the first non-negotiable
rule in `CLAUDE.md`:

> Checkout/return works with internet disconnected.

A hosted web application **cannot** honour that rule. If the connection drops,
circulation stops. Offline-first is the one property that does not survive the
deferral — everything else in the spec does.

A PWA with a service worker and local persistence could recover part of it, at
a significant increase in complexity. It is out of scope unless explicitly
chosen.

### Revisit when

The constraints of the library computer are known: whether software may be
installed, and whether the network is reliable enough to make circulation
depend on it.

**Answered.** Software may be installed, and offline-first is required. See
AD-8.

---

## AD-2 — The UI reaches the database only over HTTP

**Status:** Accepted · 2026-09-03

### Decision

The renderer calls `server` over HTTP. It never opens SQLite, and business
rules are never duplicated in it. Where an Electron shell exists, IPC is used
only for operating-system affordances — opening a folder, reporting paths and
versions — never for data.

### Consequences

- Satisfies `PRODUCT_SPEC.md` §3 and §34 ("no direct SQLite access from
  renderer") structurally, not by convention.
- One implementation of every rule, exercised identically by the local UI, a
  LAN browser client, and the future integration API.
- Requests are validated at the API boundary with a runtime schema validator,
  so an untrusted caller cannot bypass a rule the UI happens to enforce.

---

## AD-3 — The service runs in-process with its host

**Status:** Accepted · 2026-09-03

### Decision

`server` runs inside whatever process hosts it — the dev server now, the
Electron main process later — rather than as a separately supervised child
process. It binds to `127.0.0.1` by default; LAN mode (§20) changes the bind
address and requires authentication.

### Consequences

- One lifecycle. No orphaned process to supervise, restart, or leave running
  after the application is closed.
- Because `server` is a library that is *started*, not a binary that is
  *spawned*, moving it into a separate process later is a change of entry
  point, not a change of architecture.

---

## AD-4 — Migrations are incremental, one phase at a time

**Status:** Accepted · 2026-09-03

### Context

`PRODUCT_SPEC.md` §7 specifies the full schema. It is tempting to create all of
it in a single initial migration.

### Decision

Migration `001` creates only what Phase 0 needs: `schema_migrations`,
`app_settings`, `staff_users`. Each later phase adds its own tables in its own
migration.

### Consequences

- The migration runner is exercised repeatedly against a database that already
  holds data, throughout development — which is exactly the scenario it must
  survive in production years from now (§19). A single big initial migration
  would never test the upgrade path at all.
- Each migration stays small enough to review and to reason about on failure.
- Per `CLAUDE.md`, a released migration is immutable. During Phase 0, before
  any real deployment exists, `001` may still be revised; after the first
  install on a real machine it is frozen like any other.

---

## AD-5 — No runtime asset is fetched from the network

**Status:** Accepted · 2026-09-03

### Decision

Fonts (including the Hebrew face), stylesheets, scripts and icons are bundled
into the repository and served locally. No CDN, at build time or run time.

### Consequences

- Required by §2 and §22: the application must start and operate with the
  network fully disconnected, and no network request may sit in the critical
  scan path.
- A Hebrew font with an appropriate open licence is vendored into the repo, not
  linked.

---

## AD-6 — Sign-in is a local username and password

**Status:** Accepted · 2026-09-03

### Context

The library needs accounts before it is reachable from anywhere but the
machine it runs on: it holds children's names, classes and borrowing history.
Two options were on the table — a username and password held by the
application, or signing in through an identity provider such as Google.

### Decision

A username and a password, stored in `staff_users`, verified locally.

### Why not an identity provider

**It cannot work offline.** The first non-negotiable rule in `CLAUDE.md` is
that checkout and return work with the internet disconnected. An identity
provider is, by definition, reachable only over the network. Choosing one now
would mean the library could not be opened on a morning the connection is down
— and it would have to be replaced anyway when the application moves to the
library computer, which is the whole direction of AD-1.

A local password works identically in both places, and there is no second
system to keep accounts in step with.

The number of accounts is small — a librarian, perhaps an assistant, perhaps a
read-only terminal — so the administrative saving an identity provider offers
does not apply here either.

### Consequences

- Passwords are hashed with scrypt from Node's own crypto module: no second
  native dependency to rebuild per platform (see `password.ts`).
- Sessions live in the database, not in memory, so a restart does not sign
  everyone out — and the same mechanism works unchanged on the desktop.
- Only a hash of each session token is stored. A copy of the database, such as
  a backup on a USB stick, cannot be turned into a session.
- Password policy, lockout and rotation are the library's own to set. The
  current rule is a minimum length; anything more should follow a real need
  rather than habit.

### Revisit when

The school already runs a directory that staff sign into, and offline operation
has been given up.

---

## AD-7 — The data stays in SQLite, not a hosted database

**Status:** Accepted · 2026-09-03

### Context

Hosting the application online raises the question of where the data lives. A
hosted Postgres service — Supabase and its like — is the usual answer for a web
application, and was considered before this project's constraints were known.

### Decision

The library's data stays in the SQLite file described in `docs/DATABASE.md`,
wherever the application runs.

### Why

**A hosted database is a network dependency, and the library must work without
one.** PRODUCT_SPEC.md §2 and §23 require circulation to complete locally; a
remote database makes every checkout a network round trip that can fail. The
offline desktop application that AD-1 keeps open would need a local database
anyway, so adopting a hosted one now would mean maintaining two data layers and
a synchronisation problem between them.

It would also mean rewriting every query, every migration and the whole backup
and restore mechanism, for a library whose entire catalogue is a few megabytes.

### What this asks of hosting

The one requirement: **a persistent disk.** Platforms with an ephemeral
filesystem lose the database on each deploy, so the service must run somewhere
its data directory survives — a small virtual machine, or a host that offers a
mounted volume.

`LIBRARY_DATA_DIR` points the application at that volume.

### How the move to the library computer works

Not an export and re-import. The backup mechanism from Phase 5 already is the
migration path: take a backup on the server, restore it on the library
computer. Same file format, same integrity checks.

### Revisit when

The library needs more than one site writing at once, which SQLite on a single
host cannot serve. Nothing in the current plan requires it.

---

## AD-8 — The desktop application is the system; the online copy is a backup

**Status:** Accepted · 2026-09-06

### Context

AD-1 deferred the shell until it was known whether software could be installed
on the library computer. It can. The library also stated the shape it wants:

- The program on the library computer holds the data and works on its own.
- An online copy exists for backup and for reading from elsewhere.
- No new paid account. GitHub and an existing Supabase project, nothing more.

That settles the question AD-1 left open, and settles it in favour of the rule
`CLAUDE.md` puts first: **checkout and return work with the internet
disconnected.**

### Decision

Ship a Windows application built with Electron. The database lives on the
library computer and is the only copy anything writes to.

The shell is deliberately thin. It does four things:

1. Starts the existing service in its own process, on a port the operating
   system assigns.
2. Opens a window onto that service.
3. Offers what an application must offer and a web page cannot — the data
   folder, the backups folder, the log.
4. Closes the database on the way out.

Everything else is the packages that already existed. The shell adds no
domain rule, no screen and no route.

### Why the window is a browser rather than a native interface

The renderer gets no Node, no `contextBridge` and no database handle. It
reaches the service over HTTP, exactly as a browser on the local network does
(AD-2). One consequence matters: a rule enforced in the service is enforced for
every client, and there is no second path into the data to keep in step.

This is also what makes the later phases cheap. A read-only website showing the
same catalogue is the same interface against a different origin.

### Why Electron, and what it costs

Electron is a large runtime — roughly 100 MB unpacked — for an application
whose own code is a few megabytes. That is a real cost and worth naming.

What it buys is that the interface already exists and already works. The
alternatives were to write a second interface in a native toolkit, or to give
up offline-first. Both cost more than the disk does.

### Packaging

Two decisions that are unusual enough to state:

- **The application directory is built, not collected.** `build.mjs` produces a
  finished Electron application — one bundled main process, the built
  interface, one native module, one manifest — and the packager is handed that
  rather than the workspace. Packaging a monorepo otherwise means asking a tool
  to work out which parts of a hoisted, symlinked `node_modules` belong to the
  application, which is where these builds usually break.
- **`better-sqlite3` is fetched already compiled for Electron**, not rebuilt.
  Electron embeds its own V8, so the copy npm installs for Node will not load
  inside it. The project publishes binaries for both, so a Windows installer
  can be built without a compiler on the build machine.

### Consequences

- The library computer is where the data is. Anything else that displays it is
  downstream of a copy.
- Two instances would be two sets of migrations against one file, so the
  application takes a single-instance lock and a second launch focuses the
  first window.
- The Windows installer can only be produced on Windows, which means CI. It
  cannot be run or verified from a Linux development session — the Linux build
  is verified instead, and it exercises the same code and the same packaging
  path.

### Revisit when

The library needs more than one computer writing at once. That is a different
system, not a bigger version of this one.
