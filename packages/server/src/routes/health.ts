import type { FastifyInstance } from 'fastify';
import type { AppContext } from '@school-library/core';

export interface HealthResponse {
  readonly status: 'ok';
  readonly appVersion: string;
  readonly schemaVersion: number;
  readonly checkedAt: string;
}

/**
 * `GET /api/v1/health` — PRODUCT_SPEC.md §9.
 *
 * Runs a real query rather than returning a constant, so a reachable service
 * with an unusable database reports unhealthy instead of ok.
 */
export function registerHealthRoutes(app: FastifyInstance, context: AppContext): void {
  app.get('/api/v1/health', async (_request, reply) => {
    context.db.prepare('SELECT 1').get();

    const body: HealthResponse = {
      status: 'ok',
      appVersion: context.appVersion,
      schemaVersion: context.schemaVersion,
      checkedAt: new Date().toISOString(),
    };

    return reply.code(200).send(body);
  });
}
