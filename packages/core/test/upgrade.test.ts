import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createBook,
  createStudent,
  getSchemaVersion,
  migrations,
  openDatabase,
  readSettings,
  runMigrations,
  writeSetting,
  type Db,
} from '../src/index.js';

/**
 * The upgrade path: a database created by an earlier release, carrying real
 * data, brought forward by a later one.
 *
 * PRODUCT_SPEC.md §19 and §34 — an update must never lose data, and never
 * recreate the database to reach the new schema. Each phase adds a migration
 * partly so this can be tested for real rather than assumed.
 */
describe('upgrading an existing database', () => {
  let db: Db;

  beforeEach(() => {
    db = openDatabase({ file: ':memory:' });
  });

  afterEach(() => {
    db.close();
  });

  it('adds the catalog to a version-1 database without losing what was there', () => {
    // Stand where the previous release stood.
    const [migration001] = migrations;
    runMigrations(db, [migration001!]);
    expect(getSchemaVersion(db)).toBe(1);

    writeSetting(db, 'school_name', 'בית ספר הדוגמה');
    writeSetting(db, 'default_loan_days', 21);
    db.prepare(
      `INSERT INTO staff_users (public_id, username, password_hash, display_name, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('staff-1', 'librarian', 'hash', 'ספרנית', 'librarian', 'then', 'then');

    // Now run the current release's full set.
    const report = runMigrations(db, migrations);

    expect(report.currentVersion).toBe(1);
    expect(report.applied.map((entry) => entry.version)).toEqual([2]);
    expect(getSchemaVersion(db)).toBe(2);

    // Pre-existing data survived.
    const settings = readSettings(db);
    expect(settings.school_name).toBe('בית ספר הדוגמה');
    expect(settings.default_loan_days).toBe(21);
    const staff = db.prepare('SELECT display_name FROM staff_users WHERE public_id = ?').get('staff-1') as
      | { display_name: string }
      | undefined;
    expect(staff?.display_name).toBe('ספרנית');

    // And the new tables are usable.
    expect(createBook(db, { title: 'ספר חדש' }).title).toBe('ספר חדש');
    expect(createStudent(db, { firstName: 'א', lastName: 'ב' }).active).toBe(true);
  });

  it('is a no-op when run again on an up-to-date database', () => {
    runMigrations(db, migrations);
    createBook(db, { title: 'ספר' });

    const report = runMigrations(db, migrations);

    expect(report.applied).toHaveLength(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM books').get()).toEqual({ n: 1 });
  });
});
