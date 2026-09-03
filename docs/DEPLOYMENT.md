# Deployment

How to put the library online. Written for the interim phase described in
`ARCHITECTURE.md` AD-1: the application is hosted so data can be entered from
anywhere, before it moves to the library computer.

## What hosting must provide

Only three things. Everything else the application brings with it.

| Requirement | Why |
|---|---|
| **A persistent disk** | The library's data is a SQLite file. A platform with an ephemeral filesystem loses it on every deploy. This is the requirement that rules platforms out. |
| **Node.js 22, or Docker** | `better-sqlite3` compiles a native module, so the platform must either run the provided `Dockerfile` or allow a build step. |
| **HTTPS** | Children's names and borrowing history. Every hosting platform terminates TLS for you. |

Resource needs are negligible — a school library is a few thousand rows and a
handful of users. The smallest paid tier of any platform is ample.

## Environment

| Variable | Set to | Notes |
|---|---|---|
| `LIBRARY_DATA_DIR` | The mounted volume, e.g. `/data` | **The one that matters.** Everything the library owns lives here. |
| `SERVER_HOST` | `0.0.0.0` | Inside a container, loopback is unreachable from the platform's proxy. |
| `SERVER_PORT` | `3000`, or whatever the platform assigns | |
| `UI_DIR` | `/app/packages/ui/dist` | Makes the service serve the interface itself, so it is one process on one URL. |
| `TRUST_PROXY` | `true` | Without it the service believes every request is plain HTTP and stops marking the session cookie `Secure` — precisely where it matters. |
| `LOG_LEVEL` | `info` | |

The `Dockerfile` already sets all of these except `SERVER_PORT`, which some
platforms assign at runtime.

## Deploying

```
docker build -t school-library .
docker run -p 3000:3000 -v library-data:/data school-library
```

On a platform that builds from the repository, point it at the `Dockerfile`,
attach a volume at `/data`, and set `SERVER_PORT` if it requires one.

## First run

Open the URL. The application asks for a display name, a username and a
password, and creates the first administrator — see `ARCHITECTURE.md` AD-6.
It refuses to do this a second time, so the window is only open until the
first account exists.

Then, in order:

1. **Back up.** Confirm the גיבוי screen produces a file before importing
   anything. A backup mechanism that has never been run is not a backup
   mechanism.
2. **Import the catalogue** through the ייבוא screen.
3. **Add the remaining accounts** in the משתמשים screen — a librarian for
   daily work, `read_only` for a browsing terminal.

## Backups on a host

The application keeps its backups on the same volume as the database, which
protects against a mistaken restore but **not** against losing the volume.
Download a backup periodically and keep it somewhere else. Until that is
automated, it is a manual habit worth having.

## Moving to the library computer later

Not an export and re-import. The mechanism already exists:

1. Take a backup on the server and download it.
2. Install the application on the library computer.
3. Put the file in that machine's `backups/` folder and restore it from the
   גיבוי screen.

Same file format, same integrity checks, same code path that is exercised by
the test suite.

## What is deliberately not here

**Automatic HTTPS certificates, a custom domain, log shipping, monitoring.**
Every hosting platform provides these in its own way, and hard-coding one
platform's approach would make the others harder rather than easier.

**A cloud database.** See `ARCHITECTURE.md` AD-7.
