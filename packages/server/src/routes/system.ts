import type { FastifyInstance } from 'fastify';
import { readSettings, type AppContext, type AppSettings } from '@school-library/core';

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
}
