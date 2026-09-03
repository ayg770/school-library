import fs from 'node:fs';
import path from 'node:path';
import { openDatabase, type Db } from './db/open.js';
import { getSchemaVersion, readAppliedMigrations } from './db/migrator.js';
import { migrations } from './db/migrations/index.js';
import type { AppPaths } from './paths.js';

/**
 * Backup and restore — PRODUCT_SPEC.md §18.
 *
 * Backups are taken with SQLite's own online backup API, never by copying a
 * live database file. A plain copy of a database in WAL mode can capture a
 * torn state — the main file without the write-ahead log that completes it —
 * and produces a backup that looks fine until the day it is needed.
 */

export type BackupReason = 'manual' | 'before-migration' | 'before-restore' | 'automatic';

export interface BackupFile {
  /** Filename, which is also the identifier used by the API. */
  readonly id: string;
  readonly path: string;
  readonly reason: BackupReason;
  readonly createdAt: string;
  readonly sizeBytes: number;
  /** Schema version the backup was taken at, read from its filename. */
  readonly schemaVersion: number | null;
}

export class BackupError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'BackupError';
    this.code = code;
  }
}

const FILE_PATTERN = /^library-(\d{8}T\d{6}\d{0,3}Z)-v(\d+)-([a-z-]+)\.sqlite$/;

function timestampForFilename(date: Date): string {
  return date.toISOString().replace(/[-:.]/g, '');
}

function parseBackupFilename(filename: string): { createdAt: string; schemaVersion: number; reason: BackupReason } | null {
  const match = FILE_PATTERN.exec(filename);
  if (match === null) return null;

  const [, stamp, version, reason] = match as unknown as [string, string, string, string];
  // 20260903T182700000Z -> 2026-09-03T18:27:00.000Z
  const iso = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}.${stamp.slice(15, 18) || '000'}Z`;

  return {
    createdAt: Number.isNaN(Date.parse(iso)) ? new Date(0).toISOString() : iso,
    schemaVersion: Number(version),
    reason: reason as BackupReason,
  };
}

/**
 * Takes a consistent snapshot of the live database.
 *
 * `better-sqlite3`'s `backup` drives SQLite's online backup API, so the
 * snapshot is coherent even while the library is in use.
 */
export async function createBackup(
  db: Db,
  paths: AppPaths,
  reason: BackupReason = 'manual',
): Promise<BackupFile> {
  fs.mkdirSync(paths.backups, { recursive: true });

  const version = getSchemaVersion(db);
  const filename = `library-${timestampForFilename(new Date())}-v${version}-${reason}.sqlite`;
  const destination = path.join(paths.backups, filename);

  try {
    await db.backup(destination);
  } catch (cause) {
    throw new BackupError('BACKUP_FAILED', 'יצירת הגיבוי נכשלה.', { cause });
  }

  const stats = fs.statSync(destination);
  return {
    id: filename,
    path: destination,
    reason,
    createdAt: new Date().toISOString(),
    sizeBytes: stats.size,
    schemaVersion: version,
  };
}

/**
 * A synchronous snapshot, for the places that cannot await.
 *
 * `VACUUM INTO` is the other mechanism §18 allows. It is used at startup —
 * before migrations run — because application start-up is synchronous, and
 * because a compacted copy is exactly what is wanted for the snapshot an
 * upgrade may have to be rolled back to. Manual backups use the online API
 * above instead, which does not block a library that is open.
 */
export function createBackupSync(db: Db, paths: AppPaths, reason: BackupReason): BackupFile {
  fs.mkdirSync(paths.backups, { recursive: true });

  const version = getSchemaVersion(db);
  const filename = `library-${timestampForFilename(new Date())}-v${version}-${reason}.sqlite`;
  const destination = path.join(paths.backups, filename);

  try {
    // The path is interpolated because SQLite does not accept a bound
    // parameter here; the value is built above, never supplied by a caller.
    db.exec(`VACUUM INTO '${destination.replace(/'/g, "''")}'`);
  } catch (cause) {
    throw new BackupError('BACKUP_FAILED', 'יצירת הגיבוי נכשלה.', { cause });
  }

  return {
    id: filename,
    path: destination,
    reason,
    createdAt: new Date().toISOString(),
    sizeBytes: fs.statSync(destination).size,
    schemaVersion: version,
  };
}

/** Newest first. */
export function listBackups(paths: AppPaths): BackupFile[] {
  if (!fs.existsSync(paths.backups)) return [];

  return fs
    .readdirSync(paths.backups)
    .filter((name) => name.endsWith('.sqlite'))
    .map((name) => {
      const full = path.join(paths.backups, name);
      const stats = fs.statSync(full);
      const parsed = parseBackupFilename(name);

      return {
        id: name,
        path: full,
        reason: parsed?.reason ?? 'manual',
        // Fall back to the file's own mtime for anything not named by us.
        createdAt: parsed?.createdAt ?? stats.mtime.toISOString(),
        sizeBytes: stats.size,
        schemaVersion: parsed?.schemaVersion ?? null,
      } satisfies BackupFile;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Removes the oldest backups beyond the retention count.
 *
 * Backups taken before a migration or a restore are never pruned: those are
 * the ones wanted when an upgrade goes wrong, which is exactly when the
 * routine snapshots have already rolled over.
 */
export function pruneBackups(paths: AppPaths, keep: number): BackupFile[] {
  if (keep <= 0) return [];

  const prunable = listBackups(paths).filter(
    (backup) => backup.reason === 'manual' || backup.reason === 'automatic',
  );
  const removed: BackupFile[] = [];

  for (const backup of prunable.slice(keep)) {
    fs.rmSync(backup.path, { force: true });
    removed.push(backup);
  }

  return removed;
}

export interface BackupCheck {
  readonly ok: boolean;
  readonly integrity: string;
  readonly schemaVersion: number;
  readonly problems: string[];
}

/**
 * Opens a backup read-only and satisfies itself that it is usable before
 * anything is replaced with it (§18: integrity check, verify schema).
 */
export function verifyBackup(file: string): BackupCheck {
  const problems: string[] = [];

  if (!fs.existsSync(file)) {
    return { ok: false, integrity: 'missing', schemaVersion: 0, problems: ['הקובץ לא נמצא.'] };
  }

  let db: Db | null = null;
  try {
    db = openDatabase({ file });

    const rows = db.pragma('integrity_check') as Array<Record<string, unknown>>;
    const integrity = String(Object.values(rows[0] ?? {})[0] ?? 'unknown');
    if (integrity !== 'ok') problems.push(`בדיקת תקינות נכשלה: ${integrity}`);

    const schemaVersion = getSchemaVersion(db);
    if (schemaVersion === 0) problems.push('הגיבוי אינו מכיל טבלת מיגרציות.');

    const latestKnown = Math.max(...migrations.map((migration) => migration.version));
    if (schemaVersion > latestKnown) {
      problems.push(
        `הגיבוי נוצר בגרסת סכימה ${schemaVersion}, חדשה יותר מזו שהתוכנה מכירה (${latestKnown}).`,
      );
    }

    // Every migration the backup claims must be one this build knows.
    const known = new Set(migrations.map((migration) => migration.version));
    for (const applied of readAppliedMigrations(db)) {
      if (!known.has(applied.version)) {
        problems.push(`הגיבוי מכיל מיגרציה לא מוכרת (${applied.version}).`);
      }
    }

    return { ok: problems.length === 0, integrity, schemaVersion, problems };
  } catch (cause) {
    return {
      ok: false,
      integrity: 'unreadable',
      schemaVersion: 0,
      problems: [`לא ניתן לקרוא את הגיבוי: ${cause instanceof Error ? cause.message : 'שגיאה'}`],
    };
  } finally {
    db?.close();
  }
}

export interface RestoreResult {
  readonly restoredFrom: BackupFile;
  /** The snapshot of the pre-restore state, kept so a restore can be undone. */
  readonly safetyBackup: BackupFile;
  readonly check: BackupCheck;
}

/**
 * Replaces the live database with a backup.
 *
 * The order is what makes this safe (§18): verify the backup first, snapshot
 * the current state second, and only then close the connection and swap the
 * file. A restore that turns out to be the wrong one can itself be undone.
 *
 * The caller owns the connection, so it closes and reopens it around the swap
 * — nothing here leaves a half-open database behind.
 */
export async function restoreBackup(
  db: Db,
  paths: AppPaths,
  backupId: string,
  hooks: { closeDatabase: () => void; reopenDatabase: () => void },
): Promise<RestoreResult> {
  const backup = listBackups(paths).find((candidate) => candidate.id === backupId);
  if (backup === undefined) {
    throw new BackupError('BACKUP_NOT_FOUND', 'הגיבוי המבוקש לא נמצא.');
  }

  const check = verifyBackup(backup.path);
  if (!check.ok) {
    throw new BackupError('BACKUP_INVALID', `הגיבוי אינו תקין: ${check.problems.join(' ')}`);
  }

  const safetyBackup = await createBackup(db, paths, 'before-restore');

  hooks.closeDatabase();
  try {
    // Closing checkpointed the WAL, so these are stale once the file is swapped.
    for (const suffix of ['-wal', '-shm']) {
      fs.rmSync(`${paths.databaseFile}${suffix}`, { force: true });
    }
    fs.copyFileSync(backup.path, paths.databaseFile);
  } catch (cause) {
    // Put the previous database back before giving up.
    fs.copyFileSync(safetyBackup.path, paths.databaseFile);
    hooks.reopenDatabase();
    throw new BackupError('RESTORE_FAILED', 'השחזור נכשל. המצב הקודם הוחזר.', { cause });
  }

  hooks.reopenDatabase();

  return { restoredFrom: backup, safetyBackup, check };
}
