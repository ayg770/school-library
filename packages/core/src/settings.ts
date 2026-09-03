import type { Db } from './db/open.js';

/**
 * Settings that affect how the library operates.
 * PRODUCT_SPEC.md §7 lists these under `app_settings`.
 */
export interface AppSettings {
  readonly school_name: string;
  readonly default_loan_days: number;
  readonly max_active_loans_per_student: number;
  readonly interface_language: 'he' | 'ru';
  readonly lan_enabled: boolean;
  readonly backup_retention_count: number;
  readonly automatic_backup_enabled: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  school_name: '',
  default_loan_days: 14,
  max_active_loans_per_student: 3,
  interface_language: 'he',
  // §20: local network access is off until an administrator turns it on.
  lan_enabled: false,
  backup_retention_count: 10,
  automatic_backup_enabled: true,
};

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as Array<keyof AppSettings>;

function isKnownKey(key: string): key is keyof AppSettings {
  return (SETTING_KEYS as string[]).includes(key);
}

/**
 * Reads all settings, filling in defaults for anything absent.
 *
 * A row that cannot be parsed falls back to its default and is reported
 * through `onInvalid` rather than thrown: a corrupt preference should not stop
 * the library from opening in the morning, but it must not pass unnoticed
 * either (§13, nothing is discarded silently).
 */
export function readSettings(db: Db, onInvalid?: (key: string, reason: string) => void): AppSettings {
  const rows = db.prepare('SELECT key, value_json FROM app_settings').all() as Array<{
    key: string;
    value_json: string;
  }>;

  const stored: Record<string, unknown> = {};
  for (const row of rows) {
    if (!isKnownKey(row.key)) {
      onInvalid?.(row.key, 'unknown setting key');
      continue;
    }
    try {
      stored[row.key] = JSON.parse(row.value_json);
    } catch {
      onInvalid?.(row.key, 'value is not valid JSON');
    }
  }

  return { ...DEFAULT_SETTINGS, ...stored } as AppSettings;
}

export function writeSetting<K extends keyof AppSettings>(db: Db, key: K, value: AppSettings[K]): void {
  db.prepare(
    `INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
  ).run(key, JSON.stringify(value), new Date().toISOString());
}

/** Writes any setting that has no row yet, leaving existing values untouched. */
export function ensureDefaultSettings(db: Db): void {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)',
  );
  const now = new Date().toISOString();
  const seed = db.transaction(() => {
    for (const key of SETTING_KEYS) {
      insert.run(key, JSON.stringify(DEFAULT_SETTINGS[key]), now);
    }
  });
  seed();
}
