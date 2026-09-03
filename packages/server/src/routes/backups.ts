import {
  createBackup,
  listBackups,
  pruneBackups,
  recordAudit,
  restoreBackup,
  verifyBackup,
  type AppContext,
} from '@school-library/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { apiError } from '../errors.js';
import { parseInput } from '../http.js';

const params = z.object({ id: z.string().min(1) });

const restoreBody = z.object({
  /**
   * Restoring replaces the live database. Requiring the caller to say so
   * explicitly means a mistyped URL or a stray request cannot do it.
   */
  confirm: z.literal(true),
});

/**
 * Backup and restore — PRODUCT_SPEC.md §18.
 *
 * §18 reserves restore for an administrator. There is no sign-in yet, so for
 * now these routes are protected only by the service being bound to loopback
 * (§20). They must sit behind the staff role check before local-network access
 * is enabled or the service is reachable from anywhere else.
 */
export function registerBackupRoutes(app: FastifyInstance, context: AppContext): void {
  app.get('/api/v1/backups', async (_request, reply) =>
    reply.send({ items: listBackups(context.paths) }),
  );

  app.post('/api/v1/backups', async (_request, reply) => {
    const backup = await createBackup(context.db, context.paths, 'manual');
    pruneBackups(context.paths, context.settings.backup_retention_count);
    return reply.code(201).send(backup);
  });

  app.get('/api/v1/backups/:id/verify', async (request, reply) => {
    const { id } = parseInput(params, request.params, 'כתובת');
    const backup = listBackups(context.paths).find((candidate) => candidate.id === id);

    if (backup === undefined) {
      return reply.code(404).send(apiError('BACKUP_NOT_FOUND', 'הגיבוי לא נמצא.'));
    }
    return reply.send(verifyBackup(backup.path));
  });

  app.post('/api/v1/backups/:id/restore', async (request, reply) => {
    const { id } = parseInput(params, request.params, 'כתובת');
    parseInput(restoreBody, request.body, 'בקשת שחזור');

    const result = await restoreBackup(context.db, context.paths, id, {
      closeDatabase: () => context.closeDatabase(),
      reopenDatabase: () => context.reopenDatabase(),
    });

    // Audited against the restored database, so the record survives in the
    // state the library is actually left in (§7).
    recordAudit(context.db, {
      action: 'settings.changed',
      entityType: 'database',
      entityId: result.restoredFrom.id,
      newData: {
        restoredFrom: result.restoredFrom.id,
        safetyBackup: result.safetyBackup.id,
        schemaVersion: result.check.schemaVersion,
      },
    });

    request.log.warn(
      { restoredFrom: result.restoredFrom.id, safetyBackup: result.safetyBackup.id },
      'Database restored from backup',
    );

    return reply.send(result);
  });
}
