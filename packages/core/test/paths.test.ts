import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultAppDataRoot, resolveAppPaths } from '../src/index.js';

describe('application data paths', () => {
  it('honours the LIBRARY_DATA_DIR override', () => {
    const root = defaultAppDataRoot('linux', { LIBRARY_DATA_DIR: '/srv/library-data' });
    expect(root).toBe(path.resolve('/srv/library-data'));
  });

  it('ignores a blank override', () => {
    const root = defaultAppDataRoot('linux', { LIBRARY_DATA_DIR: '   ', HOME: '/home/x' });
    expect(root).not.toBe('   ');
  });

  it('uses APPDATA on Windows', () => {
    const root = defaultAppDataRoot('win32', { APPDATA: 'C:\\Users\\x\\AppData\\Roaming' });
    expect(root).toBe(path.join('C:\\Users\\x\\AppData\\Roaming', 'SchoolLibrary'));
  });

  it('uses XDG_DATA_HOME on Linux', () => {
    const root = defaultAppDataRoot('linux', { XDG_DATA_HOME: '/home/x/.local/share' });
    expect(root).toBe(path.join('/home/x/.local/share', 'school-library'));
  });

  it('keeps data, backups, logs, imports and exports separate (§4)', () => {
    const paths = resolveAppPaths('/tmp/example');
    const dirs = [paths.data, paths.backups, paths.logs, paths.imports, paths.exports];

    expect(new Set(dirs).size).toBe(dirs.length);
    for (const dir of dirs) {
      expect(dir.startsWith(paths.root)).toBe(true);
    }
    expect(paths.databaseFile).toBe(path.join(paths.data, 'library.sqlite'));
  });
});
