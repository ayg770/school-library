# The Windows application

The program that runs on the library computer. It holds the library's data,
works with the internet disconnected, and needs nothing else installed
alongside it.

## Getting a copy

### From a release

Releases are published on the repository's **Releases** page. Two files:

| File | What it is |
|---|---|
| `SchoolLibrary-Setup-<version>.exe` | The installer. Creates a Start-menu and desktop shortcut. |
| `SchoolLibrary-Portable-<version>.exe` | One file that runs without installing. |

Either produces the same application, and both keep their data in the same
place — so a portable trial is not thrown away when the installer is used
later.

### Without waiting for a release

The **Windows application** workflow under the repository's Actions tab can be
run by hand. It attaches the same two files to the run as a downloadable
artefact, kept for a fortnight.

## Windows will warn about it

The first launch shows a blue "Windows protected your PC" screen. This is
SmartScreen, and it appears because the file is not signed with a purchased
code-signing certificate — not because anything is wrong with it.

**More info → Run anyway.**

Signing would remove the warning and costs a few hundred dollars a year. It is
not needed for a program installed on one computer by the person who fetched
it.

## First run

The application opens on a screen asking for a display name, a username and a
password, and creates the first administrator. It refuses to do this a second
time, so that window is open only until the first account exists.

Then, in order:

1. **Take a backup**, from the גיבוי screen, before importing anything. A
   backup mechanism that has never been run is not a backup mechanism.
2. **Import the catalogue** through the ייבוא מקובץ screen.
3. **Add the remaining accounts** in the משתמשים screen — a librarian for daily
   work, and `read_only` for a browsing terminal.

## Updating

The **הגדרות ותמיכה** screen has a **בדוק עדכון** button. It asks whether a
newer release has been published and, if so, offers the download page. Nothing
checks on its own: this machine is meant to work without a connection, and a
background check would spend most of its life failing.

Installing over an existing copy does not touch the data — it lives outside the
installation directory (see below). Taking a backup first is still the habit
worth keeping.

## Where the data is

Everything the library owns lives in one folder, outside the installation
directory, so reinstalling or upgrading cannot touch it:

```
%APPDATA%\SchoolLibrary\
  data\library.sqlite     the library
  backups\                every backup taken
  logs\app.log            what the application did
```

The **עזרה** menu opens each of these. Copying that folder copies the library.

Uninstalling the application does not delete it.

## Building it

```
npm ci
node packages/desktop/build.mjs --platform=win32 --arch=x64
cd packages/desktop && npx electron-builder --config electron-builder.yml --win
```

The installers land in `packages/desktop/release/`.

The Windows installer can only be produced on Windows, which is what
`.github/workflows/desktop.yml` is for. On Linux or macOS the same two commands
work with `--linux` or `--mac` and produce a runnable application for
development — the same code and the same packaging path, which is how the
packaging is verified without a Windows machine.

### What the build does

`build.mjs` writes a finished Electron application into `packages/desktop/app`:

| | |
|---|---|
| `main.cjs` | The shell and the whole local service, bundled into one file. |
| `ui/` | The built interface. |
| `node_modules/better-sqlite3/` | SQLite, compiled for Electron rather than for Node. |
| `package.json` | Names and versions the three above. |

The packager is then handed that directory and does no dependency resolution of
its own. See `ARCHITECTURE.md` AD-8 for why.

## Releasing a version

```
npm version 0.2.0        # in the workspace root
git push && git push --tags
```

The tag starts the workflow, which builds both files and publishes a release.
The version shown on the הגדרות ותמיכה screen is the one in the root
`package.json`, so those numbers agree by construction.

## When it will not start

A failure to start shows a dialog naming `logs\app.log`, because there is no
console on a library computer. The last lines of that file say what happened.

| In the log | Usually means |
|---|---|
| `Cannot open database` | The data folder is on a disconnected network drive, or read-only. |
| `was compiled against a different Node.js version` | A hand-built copy whose native module does not match its Electron. Rebuild with `build.mjs`. |
| Nothing at all, and no window | Another copy is already running — the application allows one at a time, and the second launch focuses the first window. |
