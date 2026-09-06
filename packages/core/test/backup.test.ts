import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BackupError,
  createAppContext,
  createBackup,
  createBackupSync,
  createBook,
  createLogger,
  createStudent,
  ensureAppDirectories,
  ensureDefaultSettings,
  listBackups,
  listBooks,
  migrations,
  openDatabase,
  pruneBackups,
  resolveAppPaths,
  restoreBackup,
  runMigrations,
  readSettings,
  verifyBackup,
  writeSetting,
  type AppContext,
} from '../src/index.js';
import { makeTempRoot } from './helpers.js';

const quietLogger = createLogger({ level: 'fatal' });

describe('backup and restore', () => {
  let temp: ReturnType<typeof makeTempRoot>;
  let context: AppContext | null = null;

  beforeEach(() => {
    temp = makeTempRoot();
    context = createAppContext({ dataRoot: temp.root, logger: quietLogger });
  });

  afterEach(() => {
    context?.close();
    context = null;
    temp.cleanup();
  });

  it('writes a backup that opens as a valid database', async () => {
    createBook(context!.db, { title: 'מסילת ישרים' });

    const backup = await createBackup(context!.db, context!.paths, 'manual');

    expect(fs.existsSync(backup.path)).toBe(true);
    expect(backup.sizeBytes).toBeGreaterThan(0);
    expect(backup.schemaVersion).toBe(context!.schemaVersion);

    const check = verifyBackup(backup.path);
    expect(check.ok, check.problems.join(' ')).toBe(true);
    expect(check.integrity).toBe('ok');
  });

  it('captures the data as it was at the moment of the backup', async () => {
    createBook(context!.db, { title: 'ספר ראשון' });
    const backup = await createBackup(context!.db, context!.paths, 'manual');
    createBook(context!.db, { title: 'ספר שני' });

    const copy = openDatabase({ file: backup.path });
    expect(listBooks(copy).total).toBe(1);
    copy.close();

    expect(listBooks(context!.db).total).toBe(2);
  });

  it('takes a synchronous backup with VACUUM INTO', () => {
    createBook(context!.db, { title: 'ספר' });
    const backup = createBackupSync(context!.db, context!.paths, 'before-migration');

    expect(verifyBackup(backup.path).ok).toBe(true);
    expect(backup.reason).toBe('before-migration');
  });

  it('lists backups newest first and reads their metadata from the name', async () => {
    const first = await createBackup(context!.db, context!.paths, 'manual');
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await createBackup(context!.db, context!.paths, 'automatic');

    const listed = listBackups(context!.paths);
    expect(listed).toHaveLength(2);
    expect(listed[0]?.id).toBe(second.id);
    expect(listed[1]?.id).toBe(first.id);
    expect(listed[0]?.reason).toBe('automatic');
    expect(listed[0]?.schemaVersion).toBe(context!.schemaVersion);
  });

  it('prunes routine backups but keeps the ones taken before a change', async () => {
    for (let index = 0; index < 4; index += 1) {
      await createBackup(context!.db, context!.paths, 'manual');
      await new Promise((resolve) => setTimeout(resolve, 3));
    }
    const beforeMigration = createBackupSync(context!.db, context!.paths, 'before-migration');
    const beforeRestore = createBackupSync(context!.db, context!.paths, 'before-restore');

    pruneBackups(context!.paths, 2);
    const remaining = listBackups(context!.paths).map((backup) => backup.id);

    // Two routine snapshots, plus both safety snapshots, which are never pruned.
    expect(remaining).toHaveLength(4);
    expect(remaining).toContain(beforeMigration.id);
    expect(remaining).toContain(beforeRestore.id);
    expect(remaining.filter((id) => id.includes('manual'))).toHaveLength(2);
  });

  it('restores the database and keeps a snapshot of what it replaced', async () => {
    createBook(context!.db, { title: 'ספר מהגיבוי' });
    const backup = await createBackup(context!.db, context!.paths, 'manual');

    // Change the live database after the backup was taken.
    createBook(context!.db, { title: 'ספר שנוסף אחרי' });
    createStudent(context!.db, { firstName: 'שרה', lastName: 'כהן' });
    expect(listBooks(context!.db).total).toBe(2);

    const result = await restoreBackup(context!.db, context!.paths, backup.id, {
      closeDatabase: () => context!.closeDatabase(),
      reopenDatabase: () => context!.reopenDatabase(),
    });

    // The live database is the backup again.
    const titles = listBooks(context!.db).items.map((book) => book.title);
    expect(titles).toEqual(['ספר מהגיבוי']);

    // And the state that was replaced is still recoverable.
    const safety = openDatabase({ file: result.safetyBackup.path });
    expect(listBooks(safety).total).toBe(2);
    safety.close();
  });

  it('leaves the database usable after a restore', async () => {
    const backup = await createBackup(context!.db, context!.paths, 'manual');
    await restoreBackup(context!.db, context!.paths, backup.id, {
      closeDatabase: () => context!.closeDatabase(),
      reopenDatabase: () => context!.reopenDatabase(),
    });

    // Writing through the reopened connection must work.
    expect(createBook(context!.db, { title: 'אחרי שחזור' }).title).toBe('אחרי שחזור');
  });

  it('refuses to restore a backup that is not a valid database', async () => {
    const bogus = path.join(context!.paths.backups, 'library-20260101T000000000Z-v3-manual.sqlite');
    fs.writeFileSync(bogus, 'this is not a database');

    await expect(
      restoreBackup(context!.db, context!.paths, path.basename(bogus), {
        closeDatabase: () => context!.closeDatabase(),
        reopenDatabase: () => context!.reopenDatabase(),
      }),
    ).rejects.toThrowError(BackupError);

    // Nothing was touched.
    expect(createBook(context!.db, { title: 'עדיין עובד' }).title).toBe('עדיין עובד');
  });

  it('leaves a rejected backup file deletable, and unchanged', () => {
    const bogus = path.join(context!.paths.backups, 'library-20260101T000000000Z-v3-manual.sqlite');
    fs.writeFileSync(bogus, 'this is not a database');

    const check = verifyBackup(bogus);
    expect(check.ok).toBe(false);
    expect(check.integrity).toBe('unreadable');

    // A check that fails must not leave the file open. On Windows an open
    // handle makes the file undeletable until the program exits, so a
    // librarian could not remove or replace a backup that had just been
    // rejected. This is the assertion that catches it.
    expect(() => fs.unlinkSync(bogus)).not.toThrow();

    // And a check must not modify what it is checking: opening a database
    // normally puts it into WAL mode and writes these two files beside it.
    expect(fs.existsSync(`${bogus}-wal`)).toBe(false);
    expect(fs.existsSync(`${bogus}-shm`)).toBe(false);
  });

  it('refuses a backup that does not exist', async () => {
    await expect(
      restoreBackup(context!.db, context!.paths, 'library-nope.sqlite', {
        closeDatabase: () => context!.closeDatabase(),
        reopenDatabase: () => context!.reopenDatabase(),
      }),
    ).rejects.toThrowError(BackupError);
  });

  it('rejects a backup from a newer schema than this build knows', () => {
    const file = path.join(context!.paths.backups, 'future.sqlite');
    const future = openDatabase({ file });
    runMigrations(future, migrations);
    const latest = Math.max(...migrations.map((migration) => migration.version));
    future
      .prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
      .run(latest + 1, 'from-the-future', new Date().toISOString());
    future.close();

    const check = verifyBackup(file);
    expect(check.ok).toBe(false);
    expect(check.problems.join(' ')).toContain('חדשה יותר');
  });
});

describe('startup backup before migrating (§19)', () => {
  let temp: ReturnType<typeof makeTempRoot>;

  beforeEach(() => {
    temp = makeTempRoot();
  });

  afterEach(() => {
    temp.cleanup();
  });

  it('takes no backup when the database is brand new', () => {
    const context = createAppContext({ dataRoot: temp.root, logger: quietLogger });

    expect(context.startupBackup).toBeNull();
    expect(listBackups(context.paths)).toHaveLength(0);
    context.close();
  });

  it('takes no backup when there is nothing to migrate', () => {
    createAppContext({ dataRoot: temp.root, logger: quietLogger }).close();
    const second = createAppContext({ dataRoot: temp.root, logger: quietLogger });

    expect(second.startupBackup).toBeNull();
    second.close();
  });

  it('backs up an existing database before bringing it forward', () => {
    // Build the database the way a previous release would have left it:
    // migration 1 only, carrying real data. Simulating this by creating it
    // from that migration alone is closer to the truth than dropping tables
    // out of a current one.
    const paths = resolveAppPaths(temp.root);
    ensureAppDirectories(paths);

    const old = openDatabase({ file: paths.databaseFile });
    const [migration001] = migrations;
    runMigrations(old, [migration001!]);
    ensureDefaultSettings(old);
    writeSetting(old, 'school_name', 'בית ספר הדוגמה');
    old.close();

    const latest = Math.max(...migrations.map((migration) => migration.version));

    const upgraded = createAppContext({ dataRoot: temp.root, logger: quietLogger });

    expect(upgraded.startupBackup).not.toBeNull();
    expect(upgraded.startupBackup?.reason).toBe('before-migration');
    expect(upgraded.startupBackup?.schemaVersion).toBe(1);
    expect(upgraded.schemaVersion).toBe(latest);

    // The snapshot is a usable database at the old version, and the setting
    // written before the upgrade is still there afterwards.
    expect(verifyBackup(upgraded.startupBackup!.path).ok).toBe(true);
    expect(readSettings(upgraded.db).school_name).toBe('בית ספר הדוגמה');

    upgraded.close();
  });
});
