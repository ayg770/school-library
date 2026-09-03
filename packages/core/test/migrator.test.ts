import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MigrationError,
  getSchemaVersion,
  openDatabase,
  planMigrations,
  readAppliedMigrations,
  runMigrations,
  type Db,
  type Migration,
} from '../src/index.js';

const first: Migration = {
  version: 1,
  name: 'create-alpha',
  sql: 'CREATE TABLE alpha (id INTEGER PRIMARY KEY, label TEXT NOT NULL);',
};

const second: Migration = {
  version: 2,
  name: 'create-beta',
  sql: 'CREATE TABLE beta (id INTEGER PRIMARY KEY);',
};

const broken: Migration = {
  version: 2,
  name: 'broken',
  // Valid first statement, invalid second: proves the whole migration rolls back.
  sql: 'CREATE TABLE gamma (id INTEGER PRIMARY KEY); CREATE TABLE gamma (id INTEGER PRIMARY KEY);',
};

function tableExists(db: Db, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
  return row !== undefined;
}

describe('migration runner', () => {
  let db: Db;

  beforeEach(() => {
    db = openDatabase({ file: ':memory:' });
  });

  afterEach(() => {
    db.close();
  });

  it('applies every migration to a fresh database', () => {
    const report = runMigrations(db, [first, second]);

    expect(report.currentVersion).toBe(0);
    expect(report.targetVersion).toBe(2);
    expect(report.applied.map((entry) => entry.version)).toEqual([1, 2]);
    expect(getSchemaVersion(db)).toBe(2);
    expect(tableExists(db, 'alpha')).toBe(true);
    expect(tableExists(db, 'beta')).toBe(true);
  });

  it('is a no-op when the database is already current', () => {
    runMigrations(db, [first, second]);
    const report = runMigrations(db, [first, second]);

    expect(report.applied).toHaveLength(0);
    expect(report.currentVersion).toBe(2);
    expect(getSchemaVersion(db)).toBe(2);
  });

  it('applies only what is pending', () => {
    runMigrations(db, [first]);
    const report = runMigrations(db, [first, second]);

    expect(report.currentVersion).toBe(1);
    expect(report.applied.map((entry) => entry.version)).toEqual([2]);
    expect(getSchemaVersion(db)).toBe(2);
  });

  it('records the applied version, name and timestamp', () => {
    runMigrations(db, [first]);
    const applied = readAppliedMigrations(db);

    expect(applied).toHaveLength(1);
    expect(applied[0]?.version).toBe(1);
    expect(applied[0]?.name).toBe('create-alpha');
    expect(Number.isNaN(Date.parse(applied[0]?.appliedAt ?? ''))).toBe(false);
  });

  it('refuses a database migrated by a newer build', () => {
    runMigrations(db, [first, second]);

    // This build has only migration 1; the database reports 2 as applied.
    expect(() => runMigrations(db, [first])).toThrowError(MigrationError);
    try {
      runMigrations(db, [first]);
    } catch (error) {
      expect((error as MigrationError).code).toBe('DATABASE_FROM_NEWER_VERSION');
    }
  });

  it('refuses when a released migration was edited', () => {
    runMigrations(db, [first]);
    const renamed: Migration = { ...first, name: 'create-alpha-renamed' };

    try {
      runMigrations(db, [renamed]);
      expect.unreachable('expected a MigrationError');
    } catch (error) {
      expect((error as MigrationError).code).toBe('MIGRATION_MODIFIED');
    }
  });

  it('refuses when an earlier migration was never applied', () => {
    // A database that somehow holds 2 but not 1.
    runMigrations(db, [second]);

    try {
      runMigrations(db, [first, second]);
      expect.unreachable('expected a MigrationError');
    } catch (error) {
      expect((error as MigrationError).code).toBe('MISSING_APPLIED_MIGRATION');
    }
  });

  it('rejects two migrations sharing a version', () => {
    try {
      planMigrations([first, { ...second, version: 1 }], []);
      expect.unreachable('expected a MigrationError');
    } catch (error) {
      expect((error as MigrationError).code).toBe('DUPLICATE_VERSION');
    }
  });

  it('rejects a non-positive version', () => {
    try {
      planMigrations([{ ...first, version: 0 }], []);
      expect.unreachable('expected a MigrationError');
    } catch (error) {
      expect((error as MigrationError).code).toBe('INVALID_VERSION');
    }
  });

  it('rolls a failing migration back and leaves the schema version unchanged', () => {
    runMigrations(db, [first]);

    try {
      runMigrations(db, [first, broken]);
      expect.unreachable('expected a MigrationError');
    } catch (error) {
      expect((error as MigrationError).code).toBe('MIGRATION_FAILED');
    }

    expect(getSchemaVersion(db)).toBe(1);
    // The partial work inside the failed migration must not survive.
    expect(tableExists(db, 'gamma')).toBe(false);
    expect(readAppliedMigrations(db).map((entry) => entry.version)).toEqual([1]);
  });

  it('can still migrate forward after a failure is corrected', () => {
    runMigrations(db, [first]);
    expect(() => runMigrations(db, [first, broken])).toThrowError(MigrationError);

    const report = runMigrations(db, [first, second]);
    expect(report.applied.map((entry) => entry.version)).toEqual([2]);
    expect(getSchemaVersion(db)).toBe(2);
  });

  it('applies migrations in version order regardless of declaration order', () => {
    const report = runMigrations(db, [second, first]);
    expect(report.applied.map((entry) => entry.version)).toEqual([1, 2]);
  });
});
