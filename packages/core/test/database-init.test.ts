import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createAppContext,
  createLogger,
  openDatabase,
  readPragma,
  resolveAppPaths,
  type AppContext,
} from '../src/index.js';
import { makeTempRoot } from './helpers.js';

/** Silent logger, so test output stays readable. */
const quietLogger = createLogger({ level: 'fatal' });

describe('database initialisation', () => {
  let temp: ReturnType<typeof makeTempRoot>;
  let context: AppContext | null = null;

  beforeEach(() => {
    temp = makeTempRoot();
  });

  afterEach(() => {
    context?.close();
    context = null;
    temp.cleanup();
  });

  it('creates every data directory outside the application code (§4)', () => {
    context = createAppContext({ dataRoot: temp.root, logger: quietLogger });
    const paths = context.paths;

    for (const dir of [paths.data, paths.backups, paths.logs, paths.imports, paths.exports]) {
      expect(fs.existsSync(dir), `${dir} should exist`).toBe(true);
    }
    expect(fs.existsSync(paths.databaseFile)).toBe(true);
  });

  it('applies the pragmas required by §5', () => {
    context = createAppContext({ dataRoot: temp.root, logger: quietLogger });

    expect(readPragma(context.db, 'foreign_keys')).toBe(1);
    expect(String(readPragma(context.db, 'journal_mode')).toLowerCase()).toBe('wal');
    expect(readPragma(context.db, 'busy_timeout')).toBe(5000);
  });

  it('migrates a fresh database and reports its schema version', () => {
    context = createAppContext({ dataRoot: temp.root, logger: quietLogger });

    expect(context.schemaVersion).toBeGreaterThanOrEqual(1);
    expect(context.migrationReport.applied.length).toBeGreaterThan(0);

    const tables = context.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((row) => row.name);

    expect(names).toContain('schema_migrations');
    expect(names).toContain('app_settings');
    expect(names).toContain('staff_users');
  });

  it('seeds default settings without overwriting an existing value', () => {
    context = createAppContext({ dataRoot: temp.root, logger: quietLogger });
    expect(context.settings.default_loan_days).toBe(14);
    expect(context.settings.lan_enabled).toBe(false);

    context.db
      .prepare('UPDATE app_settings SET value_json = ? WHERE key = ?')
      .run(JSON.stringify(21), 'default_loan_days');
    context.close();

    context = createAppContext({ dataRoot: temp.root, logger: quietLogger });
    expect(context.settings.default_loan_days).toBe(21);
  });

  it('reopens an existing database without recreating it (§19, §34)', () => {
    context = createAppContext({ dataRoot: temp.root, logger: quietLogger });
    context.db
      .prepare(
        `INSERT INTO staff_users
           (public_id, username, password_hash, display_name, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('public-1', 'librarian', 'hash', 'ספרנית', 'librarian', 'now', 'now');
    const firstVersion = context.schemaVersion;
    context.close();

    // A second startup stands in for restarting the application after an update.
    context = createAppContext({ dataRoot: temp.root, logger: quietLogger });

    expect(context.schemaVersion).toBe(firstVersion);
    expect(context.migrationReport.applied).toHaveLength(0);
    const row = context.db
      .prepare('SELECT username FROM staff_users WHERE public_id = ?')
      .get('public-1') as { username: string } | undefined;
    expect(row?.username).toBe('librarian');
  });

  it('enforces foreign keys and check constraints on staff roles', () => {
    context = createAppContext({ dataRoot: temp.root, logger: quietLogger });

    expect(() =>
      context!.db
        .prepare(
          `INSERT INTO staff_users
             (public_id, username, password_hash, display_name, role, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('public-2', 'nobody', 'hash', 'שם', 'superuser', 'now', 'now'),
    ).toThrowError();
  });

  it('uses the OS data directory when no override is given', () => {
    const paths = resolveAppPaths();
    expect(paths.root.length).toBeGreaterThan(0);
    expect(paths.databaseFile.startsWith(paths.data)).toBe(true);
  });

  it('opens an in-memory database without WAL', () => {
    const db = openDatabase({ file: ':memory:' });
    expect(String(readPragma(db, 'journal_mode')).toLowerCase()).toBe('memory');
    expect(readPragma(db, 'foreign_keys')).toBe(1);
    db.close();
  });
});
