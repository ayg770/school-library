import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBook, createCopy } from '@school-library/core';
import { createTestApp, type TestApp } from './helpers.js';

/**
 * The stocktake routes.
 *
 * The rules of counting are tested in core. What matters here is who may do
 * what — because the people doing the counting are the volunteers, who are
 * children, and the difference between scanning a book and declaring the whole
 * count finished has to be enforced by the service rather than by which button
 * a screen happens to draw.
 */
describe('stocktake API', () => {
  let harness: TestApp;

  afterEach(async () => {
    await harness.close();
  });

  function shelf(): void {
    const book = createBook(harness.context.db, { title: 'מסילת ישרים' });
    for (const barcode of ['001', '002']) {
      createCopy(harness.context.db, { bookPublicId: book.publicId, barcode });
    }
  }

  describe('as an administrator', () => {
    beforeEach(async () => {
      harness = await createTestApp('admin');
      shelf();
    });

    it('reports a library where nobody has started counting', async () => {
      const response = await harness.get('/api/v1/stocktake');

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ round: null, expected: 2, seen: 0, missing: 2 });
    });

    it('opens a round, counts a book, and reports progress in the same reply', async () => {
      const opened = await harness.post('/api/v1/stocktake/rounds', { name: 'תשפ״ז' });
      expect(opened.statusCode).toBe(201);

      const scan = await harness.post('/api/v1/stocktake/scan', { barcode: '001' });
      expect(scan.statusCode).toBe(200);

      // Both in one reply: a screen that asked separately would show the count
      // as it was one book ago, at a book every two seconds.
      expect(scan.json()).toMatchObject({
        result: { found: true, repeat: false, copy: { bookTitle: 'מסילת ישרים' } },
        progress: { seen: 1, missing: 1 },
      });
    });

    it('reports an unknown barcode without inventing a book', async () => {
      await harness.post('/api/v1/stocktake/rounds', { name: 'תשפ״ז' });
      const scan = await harness.post('/api/v1/stocktake/scan', { barcode: '999' });

      expect(scan.statusCode).toBe(200);
      expect(scan.json()).toMatchObject({
        result: { found: false, barcode: '999', copy: null },
        progress: { seen: 0, expected: 2 },
      });
    });

    it('lists what has not turned up', async () => {
      await harness.post('/api/v1/stocktake/rounds', { name: 'תשפ״ז' });
      await harness.post('/api/v1/stocktake/scan', { barcode: '001' });

      const missing = await harness.get('/api/v1/stocktake/missing');
      expect(missing.json()).toMatchObject({ total: 1 });
      expect(missing.json().items[0]).toMatchObject({ barcode: '002' });
    });

    it('refuses a second open round', async () => {
      await harness.post('/api/v1/stocktake/rounds', { name: 'ראשון' });
      const second = await harness.post('/api/v1/stocktake/rounds', { name: 'שני' });

      expect(second.statusCode).toBe(400);
      expect(second.json()).toMatchObject({ error: { message: /כבר פתוח סבב/ } });
    });

    it('closes a round, and then counts nothing until another is opened', async () => {
      await harness.post('/api/v1/stocktake/rounds', { name: 'תשפ״ז' });
      await harness.post('/api/v1/stocktake/scan', { barcode: '001' });

      const finished = await harness.post('/api/v1/stocktake/rounds/finish', {});
      expect(finished.statusCode).toBe(200);
      expect(finished.json().finishedAt).not.toBeNull();

      const scan = await harness.post('/api/v1/stocktake/scan', { barcode: '002' });
      expect(scan.statusCode).toBe(400);
      expect(scan.json()).toMatchObject({ error: { message: /אין סבב בדיקה פתוח/ } });
    });
  });

  describe('as a librarian — one of the volunteers', () => {
    beforeEach(async () => {
      harness = await createTestApp('librarian');
      shelf();
    });

    it('may count books, which is the whole job', async () => {
      // The round is opened by an administrator, so this one is created
      // directly rather than through a route the volunteer cannot reach.
      harness.context.db
        .prepare(
          `INSERT INTO stocktake_rounds (public_id, name, started_at, created_at, updated_at)
           VALUES ('round-1', 'תשפ״ז', '2026-10-18T06:00:00.000Z',
                   '2026-10-18T06:00:00.000Z', '2026-10-18T06:00:00.000Z')`,
        )
        .run();

      const scan = await harness.post('/api/v1/stocktake/scan', { barcode: '001' });
      expect(scan.statusCode).toBe(200);
      expect(scan.json()).toMatchObject({ progress: { seen: 1 } });
    });

    it('may see how the count is going', async () => {
      expect((await harness.get('/api/v1/stocktake')).statusCode).toBe(200);
      expect((await harness.get('/api/v1/stocktake/missing')).statusCode).toBe(200);
    });

    it('may not declare a count begun or finished', async () => {
      // Resetting the count would change what every progress number in the
      // building means. That is not a decision for a twelve-year-old's shift.
      const opened = await harness.post('/api/v1/stocktake/rounds', { name: 'שלי' });
      expect(opened.statusCode).toBe(403);

      const finished = await harness.post('/api/v1/stocktake/rounds/finish', {});
      expect(finished.statusCode).toBe(403);
    });
  });

  describe('as a browsing terminal', () => {
    beforeEach(async () => {
      harness = await createTestApp('read_only');
      shelf();
    });

    it('may look, and may not count', async () => {
      expect((await harness.get('/api/v1/stocktake')).statusCode).toBe(200);

      const scan = await harness.post('/api/v1/stocktake/scan', { barcode: '001' });
      expect(scan.statusCode).toBe(403);
    });
  });
});
