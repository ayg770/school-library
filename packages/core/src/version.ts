import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_PACKAGE_NAME = 'school-library';
const UNKNOWN_VERSION = '0.0.0-unknown';

/**
 * The application version, read from the workspace root `package.json`.
 *
 * Found by walking up from this module rather than by a fixed relative path,
 * so it resolves the same whether the code runs from `src` or from a build
 * output directory. Shown on the support screen (§24) and returned by
 * `/api/v1/health`.
 */
function findAppVersion(startDir: string): string {
  let dir = startDir;

  for (;;) {
    const candidate = path.join(dir, 'package.json');
    if (fs.existsSync(candidate)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8')) as {
          name?: unknown;
          version?: unknown;
        };
        if (parsed.name === ROOT_PACKAGE_NAME && typeof parsed.version === 'string') {
          return parsed.version;
        }
      } catch {
        // Unreadable package.json — keep walking up rather than failing to boot.
      }
    }

    const parent = path.dirname(dir);
    if (parent === dir) return UNKNOWN_VERSION;
    dir = parent;
  }
}

export const APP_VERSION: string = findAppVersion(path.dirname(fileURLToPath(import.meta.url)));
