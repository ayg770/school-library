import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers.js';

/**
 * The sync routes.
 *
 * Nothing here talks to Supabase: the exchange itself is tested in the core
 * package against a stand-in. What matters at this level is who may do what,
 * and that a library which has never been connected answers calmly rather than
 * failing.
 */
describe('sync API', () => {
  let harness: TestApp;

  afterEach(async () => {
    await harness.close();
  });

  describe('as an administrator', () => {
    beforeEach(async () => {
      harness = await createTestApp('admin');
    });

    it('reports a library that has never been connected', async () => {
      const response = await harness.get('/api/v1/sync');
      expect(response.statusCode).toBe(200);

      expect(response.json()).toMatchObject({
        connected: false,
        connectedEmail: null,
        lastPulledAt: null,
        lastPushedAt: null,
        waitingToSend: 0,
        waitingSuggestions: 0,
        accountsWithoutPassword: 0,
      });
    });

    it('refuses to exchange before anyone has connected it', async () => {
      const response = await harness.post('/api/v1/sync/run');
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: { message: 'המחשב עדיין לא מחובר לאונליין.' },
      });
    });

    it('asks for both an address and a password', async () => {
      const missing = await harness.post('/api/v1/sync/connection', { email: '' });
      expect(missing.statusCode).toBe(400);
      expect(missing.json()).toMatchObject({ error: { message: 'כתובת דוא״ל היא שדה חובה.' } });

      const noPassword = await harness.post('/api/v1/sync/connection', {
        email: 'library@example.test',
      });
      expect(noPassword.statusCode).toBe(400);
      expect(noPassword.json()).toMatchObject({ error: { message: 'סיסמה היא שדה חובה.' } });
    });

    it('disconnecting a library that was never connected changes nothing', async () => {
      const response = await harness.app.inject({
        method: 'DELETE',
        url: '/api/v1/sync/connection',
        headers: { cookie: harness.cookie },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ connected: false });
    });

    it('counts a loan made at the desk as waiting to be sent', async () => {
      const book = await harness.post('/api/v1/books', { title: 'מסילת ישרים' });
      const bookId = (book.json() as { publicId: string }).publicId;
      await harness.post('/api/v1/copies', { bookPublicId: bookId, barcode: '001796' });
      const student = await harness.post('/api/v1/students', {
        firstName: 'שרה',
        lastName: 'כהן',
      });
      const studentId = (student.json() as { publicId: string }).publicId;

      await harness.post('/api/v1/circulation/checkout', {
        barcode: '001796',
        studentPublicId: studentId,
      });

      const status = (await harness.get('/api/v1/sync')).json() as { waitingToSend: number };
      expect(status.waitingToSend).toBe(1);
    });
  });

  describe('as a librarian', () => {
    beforeEach(async () => {
      harness = await createTestApp('librarian');
    });

    it('may see where the sync stands and may run one', async () => {
      expect((await harness.get('/api/v1/sync')).statusCode).toBe(200);
      // Not connected, so it stops at that — but it was allowed to try.
      expect((await harness.post('/api/v1/sync/run')).statusCode).toBe(400);
    });

    it('may not decide which online library this computer belongs to', async () => {
      const connect = await harness.post('/api/v1/sync/connection', {
        email: 'library@example.test',
        password: 'whatever',
      });
      expect(connect.statusCode).toBe(403);

      const disconnect = await harness.app.inject({
        method: 'DELETE',
        url: '/api/v1/sync/connection',
        headers: { cookie: harness.cookie },
      });
      expect(disconnect.statusCode).toBe(403);
    });
  });

  describe('without signing in', () => {
    beforeEach(async () => {
      harness = await createTestApp('admin');
    });

    it('says nothing at all', async () => {
      const response = await harness.app.inject({ method: 'GET', url: '/api/v1/sync' });
      expect(response.statusCode).toBe(401);
    });
  });
});
