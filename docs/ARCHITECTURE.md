# Architecture Decisions

Records *why* the system is built the way it is. `PRODUCT_SPEC.md` defines
*what* it must do; this file records the structural choices made to get there,
so a future change is a deliberate revision rather than an accident.

Status legend: **Accepted** · **Superseded** · **Open**

---

## AD-1 — The application shell is deferred

**Status:** Accepted · 2026-09-03

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
