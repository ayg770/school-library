import {
  finishRound,
  listMissing,
  listRounds,
  recordScan,
  startRound,
  stocktakeProgress,
  type AppContext,
} from '@school-library/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseInput } from '../http.js';

/**
 * Counting the shelves — PRODUCT_SPEC.md §12.
 *
 * The scanning route is the one that matters, and it is shaped by what it
 * costs: a librarian works through a shelf at roughly a book every two
 * seconds, so this is called more often in one morning than every other route
 * put together is in a week. It therefore does exactly one thing and returns
 * everything the screen needs to draw the next state, so the screen never has
 * to ask twice between two books.
 */

const scanBody = z.object({
  barcode: z.string().min(1),
  conditionStatus: z.string().optional(),
  conditionNote: z.string().optional(),
});

const roundBody = z.object({ name: z.string().min(1) });
const finishBody = z.object({ note: z.string().optional() });
const missingQuery = z.object({
  limit: z.coerce.number().int().positive().max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export function registerStocktakeRoutes(app: FastifyInstance, context: AppContext): void {
  /** Where the count stands, and which round it belongs to. */
  app.get('/api/v1/stocktake', async (_request, reply) =>
    reply.send(stocktakeProgress(context.db)),
  );

  app.get('/api/v1/stocktake/rounds', async (_request, reply) =>
    reply.send({ items: listRounds(context.db) }),
  );

  app.post('/api/v1/stocktake/rounds', async (request, reply) => {
    const { name } = parseInput(roundBody, request.body, 'סבב בדיקה');
    const round = startRound(context.db, name, request.staffUser?.publicId ?? null);
    return reply.code(201).send(round);
  });

  app.post('/api/v1/stocktake/rounds/finish', async (request, reply) => {
    const { note } = parseInput(finishBody, request.body ?? {}, 'סיום סבב');
    return reply.send(finishRound(context.db, note));
  });

  /**
   * One book, seen.
   *
   * The progress comes back with the result because the screen shows both, and
   * fetching it separately would show the count as it was one book ago.
   */
  app.post('/api/v1/stocktake/scan', async (request, reply) => {
    const body = parseInput(scanBody, request.body, 'סריקה');
    const result = recordScan(context.db, {
      ...body,
      userPublicId: request.staffUser?.publicId ?? null,
    });
    return reply.send({ result, progress: stocktakeProgress(context.db) });
  });

  /** What has not turned up yet, with the borrower named where there is one. */
  app.get('/api/v1/stocktake/missing', async (request, reply) => {
    const options = parseInput(missingQuery, request.query, 'סינון');
    return reply.send(listMissing(context.db, options));
  });
}
