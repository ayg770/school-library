import { createStaffUser, listStaffUsers } from '@school-library/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBareTestApp, createTestApp, type TestApp } from './helpers.js';

describe('sign-in and access control', () => {
  let harness: TestApp;

  beforeEach(async () => {
    harness = await createTestApp();
  });

  afterEach(async () => {
    await harness.close();
  });

  /** A request with no session cookie at all. */
  const anonymous = (method: string, url: string, payload?: unknown) =>
    harness.app.inject({
      method: method as 'GET',
      url,
      ...(payload === undefined ? {} : { payload }),
    });

  describe('the guard', () => {
    it('refuses a request with no session', async () => {
      const response = await anonymous('GET', '/api/v1/books');

      expect(response.statusCode).toBe(401);
      expect((response.json() as { error: { code: string } }).error.code).toBe('NOT_AUTHENTICATED');
    });

    it('refuses a write with no session', async () => {
      const response = await anonymous('POST', '/api/v1/books', { title: 'ספר' });
      expect(response.statusCode).toBe(401);
    });

    it('lets health through, because it carries nothing private', async () => {
      const response = await anonymous('GET', '/api/v1/health');
      expect(response.statusCode).toBe(200);
    });

    it('refuses a made-up cookie', async () => {
      const response = await harness.app.inject({
        method: 'GET',
        url: '/api/v1/books',
        headers: { cookie: 'library_session=not-a-real-token' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('lets a signed-in request through', async () => {
      expect((await harness.get('/api/v1/books')).statusCode).toBe(200);
    });
  });

  describe('signing in', () => {
    it('gives the same message for a wrong username and a wrong password', async () => {
      const wrongUser = await anonymous('POST', '/api/v1/auth/login', {
        username: 'nobody',
        password: 'root-password',
      });
      const wrongPassword = await anonymous('POST', '/api/v1/auth/login', {
        username: 'root',
        password: 'not-the-password',
      });

      expect(wrongUser.statusCode).toBe(400);
      expect(wrongPassword.statusCode).toBe(400);
      // Otherwise the form tells an attacker which accounts exist.
      expect(wrongUser.json()).toEqual(wrongPassword.json());
    });

    it('sets an httpOnly cookie that a page script cannot read', async () => {
      const response = await anonymous('POST', '/api/v1/auth/login', {
        username: 'root',
        password: 'root-password',
      });

      const header = response.headers['set-cookie'];
      const raw = Array.isArray(header) ? header[0] : header;
      expect(raw).toContain('HttpOnly');
      expect(raw).toContain('SameSite=Lax');
    });

    it('reports who is signed in', async () => {
      const response = await harness.get('/api/v1/auth/session');
      const body = response.json() as { user: { username: string; role: string } | null };

      expect(body.user?.username).toBe('root');
      expect(body.user?.role).toBe('admin');
    });

    it('never returns a password hash', async () => {
      const session = await harness.get('/api/v1/auth/session');
      const staff = await harness.get('/api/v1/staff');

      expect(session.body).not.toContain('password');
      expect(staff.body).not.toContain('scrypt');
    });

    it('ends the session on sign-out', async () => {
      expect((await harness.post('/api/v1/auth/logout')).statusCode).toBe(204);
      expect((await harness.get('/api/v1/books')).statusCode).toBe(401);
    });

    it('ends every session when the password changes', async () => {
      const me = (await harness.get('/api/v1/auth/session')).json() as {
        user: { publicId: string };
      };

      await harness.patch(`/api/v1/staff/${me.user.publicId}`, { password: 'a-new-password' });

      // The cookie issued against the old password no longer resolves.
      expect((await harness.get('/api/v1/books')).statusCode).toBe(401);
    });
  });

  describe('first run', () => {
    it('says setup is required before any account exists', async () => {
      const fresh = await createBareTestApp();

      const response = await fresh.app.inject({ method: 'GET', url: '/api/v1/auth/session' });
      const body = response.json() as { setupRequired: boolean; user: null };

      expect(body.setupRequired).toBe(true);
      expect(body.user).toBeNull();

      // And a protected route says so too, rather than just refusing.
      const guarded = await fresh.app.inject({ method: 'GET', url: '/api/v1/books' });
      expect((guarded.json() as { error: { code: string } }).error.code).toBe('SETUP_REQUIRED');

      await fresh.close();
    });

    it('creates the first administrator and signs them in', async () => {
      const fresh = await createBareTestApp();

      const response = await fresh.app.inject({
        method: 'POST',
        url: '/api/v1/auth/setup',
        payload: { username: 'librarian', password: 'a-good-password', displayName: 'ספרנית' },
      });

      expect(response.statusCode).toBe(201);
      expect((response.json() as { user: { role: string } }).user.role).toBe('admin');
      expect(response.headers['set-cookie']).toBeDefined();

      await fresh.close();
    });

    it('refuses setup once an account exists', async () => {
      const response = await anonymous('POST', '/api/v1/auth/setup', {
        username: 'sneaky',
        password: 'a-good-password',
        displayName: 'לא אמור לעבוד',
      });

      expect(response.statusCode).toBe(409);
      expect((response.json() as { error: { code: string } }).error.code).toBe('ALREADY_SET_UP');
      expect(listStaffUsers(harness.context.db).map((user) => user.username)).not.toContain('sneaky');
    });
  });

  describe('roles', () => {
    it('lets a read-only account read but not write', async () => {
      createStaffUser(harness.context.db, {
        username: 'viewer',
        password: 'viewer-password',
        displayName: 'צופה',
        role: 'read_only',
      });
      const cookie = await harness.signInAs('viewer', 'viewer-password');

      const read = await harness.app.inject({ method: 'GET', url: '/api/v1/books', headers: { cookie } });
      expect(read.statusCode).toBe(200);

      const write = await harness.app.inject({
        method: 'POST',
        url: '/api/v1/books',
        headers: { cookie },
        payload: { title: 'ספר' },
      });
      expect(write.statusCode).toBe(403);
      expect((write.json() as { error: { code: string } }).error.code).toBe('FORBIDDEN');
    });

    it('lets a librarian run circulation but not manage staff or restore', async () => {
      createStaffUser(harness.context.db, {
        username: 'sarah',
        password: 'sarah-password',
        displayName: 'שרה',
        role: 'librarian',
      });
      const cookie = await harness.signInAs('sarah', 'sarah-password');
      const as = (method: string, url: string, payload?: unknown) =>
        harness.app.inject({
          method: method as 'GET',
          url,
          headers: { cookie },
          ...(payload === undefined ? {} : { payload }),
        });

      expect((await as('POST', '/api/v1/books', { title: 'ספר' })).statusCode).toBe(201);

      // §18 and §21 reserve these for an administrator.
      expect((await as('POST', '/api/v1/staff', {
        username: 'x',
        password: 'a-good-password',
        displayName: 'x',
      })).statusCode).toBe(403);
      expect((await as('POST', '/api/v1/backups')).statusCode).toBe(403);
    });

    it('lets an administrator do both', async () => {
      expect((await harness.post('/api/v1/books', { title: 'ספר' })).statusCode).toBe(201);
      expect((await harness.post('/api/v1/backups')).statusCode).toBe(201);
    });
  });

  describe('managing accounts', () => {
    it('creates a librarian account that can sign in', async () => {
      const created = await harness.post('/api/v1/staff', {
        username: 'sarah',
        password: 'sarah-password',
        displayName: 'שרה כהן',
        role: 'librarian',
      });

      expect(created.statusCode).toBe(201);
      expect((created.json() as { role: string }).role).toBe('librarian');
      await expect(harness.signInAs('sarah', 'sarah-password')).resolves.toBeTruthy();
    });

    it('refuses a duplicate username', async () => {
      const response = await harness.post('/api/v1/staff', {
        username: 'root',
        password: 'another-password',
        displayName: 'מתחזה',
      });

      expect(response.statusCode).toBe(409);
      expect((response.json() as { error: { code: string } }).error.code).toBe('DUPLICATE_VALUE');
    });

    it('rejects a short password', async () => {
      const response = await harness.post('/api/v1/staff', {
        username: 'weak',
        password: '123',
        displayName: 'סיסמה חלשה',
      });

      expect(response.statusCode).toBe(400);
      expect((response.json() as { error: { message: string } }).error.message).toContain('8');
    });

    it('refuses to remove the last administrator', async () => {
      const me = (await harness.get('/api/v1/auth/session')).json() as {
        user: { publicId: string };
      };

      // Locking everyone out cannot be undone from inside the application.
      const demote = await harness.patch(`/api/v1/staff/${me.user.publicId}`, { role: 'librarian' });
      expect(demote.statusCode).toBe(400);

      const deactivate = await harness.patch(`/api/v1/staff/${me.user.publicId}`, { active: false });
      expect(deactivate.statusCode).toBe(400);
    });

    it('allows the last administrator to step down once another exists', async () => {
      await harness.post('/api/v1/staff', {
        username: 'second',
        password: 'second-password',
        displayName: 'מנהל שני',
        role: 'admin',
      });

      const me = (await harness.get('/api/v1/auth/session')).json() as {
        user: { publicId: string };
      };
      const response = await harness.patch(`/api/v1/staff/${me.user.publicId}`, { role: 'librarian' });

      expect(response.statusCode).toBe(200);
    });

    it('signs out an account the moment it is deactivated', async () => {
      const created = (
        await harness.post('/api/v1/staff', {
          username: 'temp',
          password: 'temp-password',
          displayName: 'זמני',
          role: 'librarian',
        })
      ).json() as { publicId: string };
      const cookie = await harness.signInAs('temp', 'temp-password');

      await harness.patch(`/api/v1/staff/${created.publicId}`, { active: false });

      const response = await harness.app.inject({
        method: 'GET',
        url: '/api/v1/books',
        headers: { cookie },
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('changing your own password', () => {
    it('lets a librarian replace the password an administrator gave them', async () => {
      const harness = await createTestApp('librarian');
      try {
        const changed = await harness.post('/api/v1/auth/password', {
          currentPassword: 'test-password',
          newPassword: 'a-password-only-i-know',
        });
        expect(changed.statusCode).toBe(204);

        // The old password is gone, the new one works, and the session that
        // made the change ended with it.
        await expect(harness.signInAs('librarian', 'test-password')).rejects.toThrow();
        await expect(harness.signInAs('librarian', 'a-password-only-i-know')).resolves.toBeTruthy();

        const stale = await harness.get('/api/v1/dashboard');
        expect(stale.statusCode).toBe(401);
      } finally {
        await harness.close();
      }
    });

    it('will not take the new password without the old one', async () => {
      const harness = await createTestApp('librarian');
      try {
        const wrong = await harness.post('/api/v1/auth/password', {
          currentPassword: 'not-the-password',
          newPassword: 'something-new-entirely',
        });
        expect(wrong.statusCode).toBe(400);
        expect(wrong.json()).toMatchObject({ error: { message: 'הסיסמה הנוכחית שגויה.' } });

        // Still signed in, still the old password.
        expect((await harness.get('/api/v1/dashboard')).statusCode).toBe(200);
      } finally {
        await harness.close();
      }
    });

    it('is open to a read-only account too, because it is their password', async () => {
      const harness = await createTestApp('read_only');
      try {
        const changed = await harness.post('/api/v1/auth/password', {
          currentPassword: 'test-password',
          newPassword: 'my-own-password',
        });
        expect(changed.statusCode).toBe(204);
      } finally {
        await harness.close();
      }
    });

    it('refuses a password too short to be worth having', async () => {
      const harness = await createTestApp('librarian');
      try {
        const short = await harness.post('/api/v1/auth/password', {
          currentPassword: 'test-password',
          newPassword: 'short',
        });
        expect(short.statusCode).toBe(400);
      } finally {
        await harness.close();
      }
    });
  });
});
