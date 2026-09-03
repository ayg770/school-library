import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  ensureDefaultSettings,
  migrations,
  openDatabase,
  readSettings,
  runMigrations,
  writeSetting,
  type Db,
} from '../src/index.js';

describe('application settings', () => {
  let db: Db;

  beforeEach(() => {
    db = openDatabase({ file: ':memory:' });
    runMigrations(db, migrations);
  });

  afterEach(() => {
    db.close();
  });

  it('returns defaults when nothing is stored', () => {
    expect(readSettings(db)).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips a written value', () => {
    writeSetting(db, 'school_name', 'בית ספר הדוגמה');
    writeSetting(db, 'default_loan_days', 21);
    writeSetting(db, 'lan_enabled', true);

    const settings = readSettings(db);
    expect(settings.school_name).toBe('בית ספר הדוגמה');
    expect(settings.default_loan_days).toBe(21);
    expect(settings.lan_enabled).toBe(true);
  });

  it('overwrites rather than duplicating on a second write', () => {
    writeSetting(db, 'default_loan_days', 21);
    writeSetting(db, 'default_loan_days', 30);

    const count = db
      .prepare('SELECT COUNT(*) AS n FROM app_settings WHERE key = ?')
      .get('default_loan_days') as { n: number };
    expect(count.n).toBe(1);
    expect(readSettings(db).default_loan_days).toBe(30);
  });

  it('seeds defaults without overwriting an existing value', () => {
    writeSetting(db, 'default_loan_days', 21);
    ensureDefaultSettings(db);

    expect(readSettings(db).default_loan_days).toBe(21);
    expect(readSettings(db).backup_retention_count).toBe(DEFAULT_SETTINGS.backup_retention_count);
  });

  it('reports an unparseable value instead of discarding it silently (§13)', () => {
    db.prepare('INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)').run(
      'default_loan_days',
      'not json',
      'now',
    );

    const reported: string[] = [];
    const settings = readSettings(db, (key) => reported.push(key));

    expect(reported).toContain('default_loan_days');
    expect(settings.default_loan_days).toBe(DEFAULT_SETTINGS.default_loan_days);
  });

  it('reports an unknown key', () => {
    db.prepare('INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)').run(
      'legacy_option',
      '"x"',
      'now',
    );

    const reported: string[] = [];
    readSettings(db, (key) => reported.push(key));
    expect(reported).toContain('legacy_option');
  });

  it('defaults local-network access to off (§20)', () => {
    expect(DEFAULT_SETTINGS.lan_enabled).toBe(false);
  });
});
