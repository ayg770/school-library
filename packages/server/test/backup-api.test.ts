import fs from 'node:fs';
import path from 'node:path';
import { listBooks } from '@school-library/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers.js';

describe('backup API', () => {
  let harness: TestApp;

  const post = (url: string, payload?: unknown) => harness.post(url, payload);
  const get = (url: string) => harness.get(url);

  beforeEach(async () => {
    harness = await createTestApp();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('creates a backup and lists it', async () => {
    await post('/api/v1/books', { title: 'מסילת ישרים' });

    const created = await post('/api/v1/backups');
    expect(created.statusCode).toBe(201);
    const backup = created.json() as { id: string; sizeBytes: number; schemaVersion: number };
    expect(backup.sizeBytes).toBeGreaterThan(0);
    expect(backup.schemaVersion).toBe(harness.context.schemaVersion);

    const listed = await get('/api/v1/backups');
    const items = (listed.json() as { items: Array<{ id: string }> }).items;
    expect(items.map((item) => item.id)).toContain(backup.id);
  });

  it('verifies a backup', async () => {
    const created = await post('/api/v1/backups');
    const { id } = created.json() as { id: string };

    const check = await get(`/api/v1/backups/${id}/verify`);
    expect(check.statusCode).toBe(200);
    const body = check.json() as { ok: boolean; integrity: string };
    expect(body.ok).toBe(true);
    expect(body.integrity).toBe('ok');
  });

  it('restores, and the service keeps working afterwards', async () => {
    await post('/api/v1/books', { title: 'ספר מהגיבוי' });
    const { id } = (await post('/api/v1/backups')).json() as { id: string };

    await post('/api/v1/books', { title: 'ספר שנוסף אחרי' });
    expect((((await get('/api/v1/books')).json()) as { total: number }).total).toBe(2);

    const restored = await post(`/api/v1/backups/${id}/restore`, { confirm: true });
    expect(restored.statusCode).toBe(200);
    const result = restored.json() as { safetyBackup: { id: string } };
    expect(result.safetyBackup.id).toContain('before-restore');

    // The API answers from the restored database through the same harness.context.
    const books = (await get('/api/v1/books')).json() as { total: number; items: Array<{ title: string }> };
    expect(books.total).toBe(1);
    expect(books.items[0]?.title).toBe('ספר מהגיבוי');

    // And writes still work through the reopened connection.
    expect((await post('/api/v1/books', { title: 'אחרי שחזור' })).statusCode).toBe(201);
    expect(listBooks(harness.context.db).total).toBe(2);
  });

  it('refuses to restore without an explicit confirmation', async () => {
    const { id } = (await post('/api/v1/backups')).json() as { id: string };

    const response = await post(`/api/v1/backups/${id}/restore`, {});
    expect(response.statusCode).toBe(400);
    expect((response.json() as { error: { code: string } }).error.code).toBe('VALIDATION');
  });

  it('answers 404 for a backup that does not exist', async () => {
    expect((await get('/api/v1/backups/nope.sqlite/verify')).statusCode).toBe(404);

    const restore = await post('/api/v1/backups/nope.sqlite/restore', { confirm: true });
    expect(restore.statusCode).toBe(404);
    expect((restore.json() as { error: { code: string } }).error.code).toBe('BACKUP_NOT_FOUND');
  });

  it('reports a corrupt backup as a conflict rather than restoring it', async () => {
    const name = 'library-20260101T000000000Z-v3-manual.sqlite';
    fs.writeFileSync(path.join(harness.context.paths.backups, name), 'not a database');

    const response = await post(`/api/v1/backups/${name}/restore`, { confirm: true });

    expect(response.statusCode).toBe(409);
    expect((response.json() as { error: { code: string } }).error.code).toBe('BACKUP_INVALID');

    // The live database is untouched.
    expect((await get('/api/v1/books')).statusCode).toBe(200);
  });
});
