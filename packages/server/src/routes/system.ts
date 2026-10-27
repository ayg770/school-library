import type { FastifyInstance } from 'fastify';
import {
  checkForUpdate,
  getDashboardSummary,
  readSettings,
  recordAudit,
  writeSetting,
  type AppContext,
  type AppSettings,
  type UpdateStatus,
} from '@school-library/core';
import { z } from 'zod';
import { parseInput } from '../http.js';

/**
 * The settings an administrator may change from the screen.
 *
 * Narrow on purpose. Most of `AppSettings` decides how the library lends
 * books, and changing those from a screen is a separate piece of work with
 * its own consequences; this one decides whether the computer stays signed
 * in, which is a question about the room it stands in.
 */
const settingsBody = z.object({
  lockWhenUnattended: z.boolean().optional(),
});

export interface SystemInfoResponse {
  readonly appVersion: string;
  readonly schemaVersion: number;
  readonly paths: {
    readonly root: string;
    readonly database: string;
    readonly backups: string;
    readonly logs: string;
    readonly imports: string;
    readonly exports: string;
  };
  readonly settings: AppSettings;
}

/**
 * `GET /api/v1/system/info` — backs the Settings and Support screen (§24),
 * which must show the application version, schema version and data path so a
 * problem can be diagnosed on the library computer without a developer.
 *
 * It reports paths on the machine running the service. That is acceptable on
 * loopback; when local-network access is added in Phase 7 this route sits
 * behind the same authentication as everything else (§20).
 */
export function registerSystemRoutes(app: FastifyInstance, context: AppContext): void {
  /** The figures the home screen leads with. */
  app.get('/api/v1/dashboard', async (_request, reply) =>
    reply.send(getDashboardSummary(context.db)),
  );

  app.get('/api/v1/system/info', async (_request, reply) => {
    const body: SystemInfoResponse = {
      appVersion: context.appVersion,
      schemaVersion: context.schemaVersion,
      paths: {
        root: context.paths.root,
        database: context.paths.databaseFile,
        backups: context.paths.backups,
        logs: context.paths.logs,
        imports: context.paths.imports,
        exports: context.paths.exports,
      },
      // Read fresh rather than from the startup snapshot, so the screen shows
      // current values once settings become editable.
      settings: readSettings(context.db),
    };

    return reply.code(200).send(body);
  });

  /**
   * `PATCH /api/v1/system/settings` — administrators only (see `auth.ts`).
   *
   * Audited, because turning the lock off is a decision about who can reach
   * the library's records, and the record of it should outlive the person who
   * made it.
   */
  app.patch('/api/v1/system/settings', async (request, reply) => {
    const body = parseInput(settingsBody, request.body, 'הגדרות');

    if (body.lockWhenUnattended !== undefined) {
      writeSetting(context.db, 'lock_when_unattended', body.lockWhenUnattended);
      recordAudit(context.db, {
        action: 'settings.changed',
        entityType: 'settings',
        entityId: 'lock_when_unattended',
        // The audit's own user column holds a row id, which a route does not
        // have; the username is what a person reading this would look for.
        newData: {
          lockWhenUnattended: body.lockWhenUnattended,
          byUser: request.staffUser?.username ?? null,
        },
      });
    }

    return reply.send({ settings: readSettings(context.db) });
  });

  /**
   * `GET /api/v1/system/update` — is there a newer version to install?
   *
   * Only when asked. The library computer does not poll for updates in the
   * background: it works offline by design (AD-8), and a check that runs on its
   * own would either fail constantly or interrupt a queue of children waiting
   * to borrow books.
   *
   * Never an error response. Being unable to reach the internet is the
   * expected state of this machine, and the body says so in words the screen
   * can show as it is.
   */
  app.get('/api/v1/system/update', async (_request, reply) => {
    const status: UpdateStatus = await checkForUpdate({ currentVersion: context.appVersion });
    return reply.code(200).send(status);
  });
}
