import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Filesystem layout for everything the application owns at runtime.
 *
 * PRODUCT_SPEC.md §4: production data never lives inside the installation
 * directory, so that reinstalling or upgrading the application cannot touch
 * the database, and so a backup can be taken by copying one folder.
 */
export interface AppPaths {
  /** Root of the application data directory. */
  readonly root: string;
  /** Holds the live SQLite database. */
  readonly data: string;
  readonly backups: string;
  readonly logs: string;
  readonly imports: string;
  readonly exports: string;
  /** The live database file itself. */
  readonly databaseFile: string;
}

const APP_DIR_NAME = 'SchoolLibrary';
const DATABASE_FILENAME = 'library.sqlite';

/**
 * The OS-appropriate application data directory.
 *
 * `LIBRARY_DATA_DIR` overrides it — used by tests, and by an administrator who
 * needs to place the data somewhere specific. A user Desktop path is never
 * assumed (§4).
 */
export function defaultAppDataRoot(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env.LIBRARY_DATA_DIR?.trim();
  if (override) return path.resolve(override);

  const home = os.homedir();
  switch (platform) {
    case 'win32': {
      const appData = env.APPDATA?.trim() || path.join(home, 'AppData', 'Roaming');
      return path.join(appData, APP_DIR_NAME);
    }
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', APP_DIR_NAME);
    default: {
      const xdg = env.XDG_DATA_HOME?.trim() || path.join(home, '.local', 'share');
      return path.join(xdg, 'school-library');
    }
  }
}

export function resolveAppPaths(root: string = defaultAppDataRoot()): AppPaths {
  const absoluteRoot = path.resolve(root);
  const data = path.join(absoluteRoot, 'data');
  return {
    root: absoluteRoot,
    data,
    backups: path.join(absoluteRoot, 'backups'),
    logs: path.join(absoluteRoot, 'logs'),
    imports: path.join(absoluteRoot, 'imports'),
    exports: path.join(absoluteRoot, 'exports'),
    databaseFile: path.join(data, DATABASE_FILENAME),
  };
}

/** Creates every directory in the layout. Safe to call repeatedly. */
export function ensureAppDirectories(paths: AppPaths): void {
  for (const dir of [paths.root, paths.data, paths.backups, paths.logs, paths.imports, paths.exports]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
