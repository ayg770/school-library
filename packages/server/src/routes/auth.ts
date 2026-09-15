import {
  changeOwnPassword,
  ROLES,
  createStaffUser,
  getStaffUser,
  listStaffUsers,
  needsFirstUser,
  signIn,
  signOut,
  updateStaffUser,
  type AppContext,
} from '@school-library/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { clearSessionCookie, readSessionToken, setSessionCookie } from '../auth.js';
import { apiError } from '../errors.js';
import { parseInput } from '../http.js';

const credentials = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const setupBody = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  displayName: z.string().min(1),
});

const createUserBody = setupBody.extend({
  role: z.enum(ROLES).optional(),
});

const updateUserBody = z.object({
  displayName: z.string().optional(),
  password: z.string().optional(),
  role: z.enum(ROLES).optional(),
  active: z.boolean().optional(),
});

const params = z.object({ publicId: z.string().min(1) });

/**
 * Sign-in and staff accounts — PRODUCT_SPEC.md §21.
 *
 * The session token lives in an httpOnly cookie, so page scripts cannot read
 * it. Only its hash is stored, so a copy of the database — a backup on a USB
 * stick — cannot be turned into a session.
 */
export function registerAuthRoutes(app: FastifyInstance, context: AppContext): void {
  /** What the interface asks before deciding which screen to show. */
  app.get('/api/v1/auth/session', async (request, reply) =>
    reply.send({
      user: request.staffUser,
      setupRequired: needsFirstUser(context.db),
    }),
  );

  app.post('/api/v1/auth/login', async (request, reply) => {
    const body = parseInput(credentials, request.body, 'התחברות');
    const session = signIn(context.db, body.username, body.password);

    setSessionCookie(reply, session.token, session.expiresAt);
    request.log.info({ username: session.user.username }, 'Staff signed in');

    return reply.send({ user: session.user, expiresAt: session.expiresAt });
  });

  /**
   * Changing your own password.
   *
   * Reachable by anyone signed in, which is the point: an administrator sets
   * the first password so a new librarian can get in, and the librarian then
   * replaces it with one nobody else knows. Every session ends with it,
   * including this one, so the reply clears the cookie and the screen asks them
   * to sign in again.
   */
  app.post('/api/v1/auth/password', async (request, reply) => {
    const user = request.staffUser;
    if (user === null) return reply.code(401).send(apiError('UNAUTHENTICATED', 'נדרשת התחברות.'));

    const body = (request.body ?? {}) as { currentPassword?: unknown; newPassword?: unknown };
    changeOwnPassword(context.db, user.publicId, body.currentPassword, body.newPassword);

    clearSessionCookie(reply);
    request.log.info({ username: user.username }, 'Staff changed their own password');
    return reply.code(204).send();
  });

  app.post('/api/v1/auth/logout', async (request, reply) => {
    signOut(context.db, readSessionToken(request));
    clearSessionCookie(reply);
    return reply.code(204).send();
  });

  /**
   * Creates the first administrator.
   *
   * Only while no account exists — otherwise anyone reaching the service could
   * grant themselves administrator rights.
   */
  app.post('/api/v1/auth/setup', async (request, reply) => {
    if (!needsFirstUser(context.db)) {
      return reply
        .code(409)
        .send(apiError('ALREADY_SET_UP', 'המערכת כבר הוגדרה. יש להתחבר עם משתמש קיים.'));
    }

    const body = parseInput(setupBody, request.body, 'הגדרה ראשונית');
    const user = createStaffUser(context.db, body);
    const session = signIn(context.db, body.username, body.password);

    setSessionCookie(reply, session.token, session.expiresAt);
    request.log.warn({ username: user.username }, 'First administrator created');

    return reply.code(201).send({ user, expiresAt: session.expiresAt });
  });

  app.get('/api/v1/staff', async (_request, reply) => reply.send({ items: listStaffUsers(context.db) }));

  app.post('/api/v1/staff', async (request, reply) => {
    const body = parseInput(createUserBody, request.body, 'משתמש');
    return reply.code(201).send(createStaffUser(context.db, body));
  });

  app.get('/api/v1/staff/:publicId', async (request, reply) => {
    const { publicId } = parseInput(params, request.params, 'כתובת');
    return reply.send(getStaffUser(context.db, publicId));
  });

  app.patch('/api/v1/staff/:publicId', async (request, reply) => {
    const { publicId } = parseInput(params, request.params, 'כתובת');
    const body = parseInput(updateUserBody, request.body, 'משתמש');
    return reply.send(updateStaffUser(context.db, publicId, body));
  });
}
