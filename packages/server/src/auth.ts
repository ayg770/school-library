import cookie from '@fastify/cookie';
import {
  needsFirstUser,
  resolveSession,
  roleAllows,
  type AppContext,
  type Role,
  type StaffUser,
} from '@school-library/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { apiError } from './errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** The signed-in member of staff, or null on a public route. */
    staffUser: StaffUser | null;
  }
}

export const SESSION_COOKIE = 'library_session';

/**
 * Routes reachable without signing in.
 *
 * Deliberately short. `setup` is only usable while no account exists, and
 * `health` carries nothing but versions — it is what a monitor or the desktop
 * shell checks before the librarian has done anything.
 */
const PUBLIC_ROUTES = new Set([
  'GET /api/v1/health',
  'GET /api/v1/auth/session',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/logout',
  'POST /api/v1/auth/setup',
]);

/**
 * Actions reserved for an administrator (§18, §21): replacing the database,
 * and managing who may sign in at all.
 */
function isAdminOnly(method: string, path: string): boolean {
  if (path.startsWith('/api/v1/staff')) return true;
  if (path.startsWith('/api/v1/backups') && method !== 'GET') return true;
  // Deciding which online library this computer belongs to is a decision about
  // the whole institution, not about today's shift. Running an exchange is not:
  // that is ordinary work, and falls through to the librarian rule below.
  if (path.startsWith('/api/v1/sync/connection')) return true;
  return false;
}

/**
 * The role a request needs.
 *
 * Reading needs an account but no more; anything that changes the library needs
 * a librarian. `read_only` therefore covers a browsing terminal without
 * risking the catalogue (§20).
 */
function requiredRole(method: string, path: string): Role {
  if (isAdminOnly(method, path)) return 'admin';
  return method === 'GET' || method === 'HEAD' ? 'read_only' : 'librarian';
}

function pathOf(url: string): string {
  const index = url.indexOf('?');
  return index === -1 ? url : url.slice(0, index);
}

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    // Only over HTTPS once the service is reachable beyond this machine.
    secure: reply.request.protocol === 'https',
    expires: new Date(expiresAt),
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function readSessionToken(request: FastifyRequest): string | undefined {
  return request.cookies[SESSION_COOKIE];
}

/**
 * Installs sign-in for the whole API.
 *
 * Every route is closed unless it appears in `PUBLIC_ROUTES`, so a route added
 * later is protected by default rather than by remembering to protect it.
 */
export function registerAuth(app: FastifyInstance, context: AppContext): void {
  void app.register(cookie);

  app.decorateRequest('staffUser', null);

  app.addHook('onRequest', async (request, reply) => {
    request.staffUser = resolveSession(context.db, readSessionToken(request));

    const path = pathOf(request.url);
    if (!path.startsWith('/api/')) return;
    if (PUBLIC_ROUTES.has(`${request.method} ${path}`)) return;

    if (request.staffUser === null) {
      // While no account exists there is nobody who could sign in, and the
      // first-run screen needs to be able to say so.
      const code = needsFirstUser(context.db) ? 'SETUP_REQUIRED' : 'NOT_AUTHENTICATED';
      const message = needsFirstUser(context.db)
        ? 'המערכת עדיין לא הוגדרה. צור משתמש מנהל ראשון.'
        : 'יש להתחבר כדי להמשיך.';
      return reply.code(401).send(apiError(code, message));
    }

    if (!roleAllows(request.staffUser.role, requiredRole(request.method, path))) {
      return reply
        .code(403)
        .send(apiError('FORBIDDEN', 'אין לך הרשאה לבצע את הפעולה הזו. פנה למנהל המערכת.'));
    }
  });
}
