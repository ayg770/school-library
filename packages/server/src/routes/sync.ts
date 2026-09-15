import {
  connectSync,
  disconnectSync,
  syncStatus,
  synchronise,
  type AppContext,
} from '@school-library/core';
import type { FastifyInstance } from 'fastify';

/**
 * The link to the online library — PRODUCT_SPEC.md §2, ARCHITECTURE.md AD-9.
 *
 * Four routes and no more. Connecting is an administrator's job and happens
 * once; running an exchange is ordinary work and any librarian may do it.
 *
 * None of this is on the path of lending a book. The library keeps working
 * with the cable out; these routes simply have nothing to do until it is back.
 */
export function registerSyncRoutes(app: FastifyInstance, context: AppContext): void {
  app.get('/api/v1/sync', async (_request, reply) => reply.send(syncStatus(context.db)));

  /** Connect this computer, once, with an account prepared in the office. */
  app.post('/api/v1/sync/connection', async (request, reply) => {
    const body = (request.body ?? {}) as { email?: unknown; password?: unknown };
    const status = await connectSync(context.db, body.email, body.password);
    return reply.send(status);
  });

  app.delete('/api/v1/sync/connection', async (_request, reply) =>
    reply.send(disconnectSync(context.db)),
  );

  /**
   * One exchange.
   *
   * The report comes back with the status, because the screen shows both and
   * asking for the second separately would show it as it was a moment before
   * the first.
   */
  app.post('/api/v1/sync/run', async (_request, reply) => {
    const report = await synchronise(context.db);
    return reply.send({ report, status: syncStatus(context.db) });
  });
}
