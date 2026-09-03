import type { FastifyInstance } from 'fastify';
import {
  checkinByBarcode,
  checkoutCopy,
  getLoan,
  getStudentLibrarySummary,
  listLoans,
  renewLoan,
  type AppContext,
} from '@school-library/core';
import { z } from 'zod';
import { paginationQuery, parseInput } from '../http.js';

const checkoutBody = z.object({
  studentPublicId: z.string().min(1),
  barcode: z.string().optional(),
  copyPublicId: z.string().optional(),
  loanDays: z.number().int().positive().optional(),
  notes: z.union([z.string(), z.null()]).optional(),
});

const checkinBody = z.object({ barcode: z.string().min(1) });

const renewBody = z.object({
  loanPublicId: z.string().min(1),
  extraDays: z.number().int().positive().optional(),
});

const loanListQuery = z.object({
  studentPublicId: z.string().optional(),
  copyPublicId: z.string().optional(),
  bookPublicId: z.string().optional(),
  status: z.enum(['active', 'overdue', 'returned', 'all']).optional(),
  ...paginationQuery,
});

const params = z.object({ publicId: z.string().min(1) });

/**
 * Circulation — PRODUCT_SPEC.md §9 and §11.
 *
 * Every route here completes locally. Nothing in the checkout or return path
 * waits on the network, because a green result must mean the loan is committed
 * on this machine and nothing further is required (§22, §23).
 *
 * There is no authenticated user yet, so `checkout_by_user_id` is left null.
 * Once staff sign in, the identity is threaded through from the request rather
 * than changing any of this logic.
 */
export function registerCirculationRoutes(app: FastifyInstance, context: AppContext): void {
  app.post('/api/v1/circulation/checkout', async (request, reply) => {
    const body = parseInput(checkoutBody, request.body, 'השאלה');
    return reply.code(201).send(checkoutCopy(context.db, body));
  });

  app.post('/api/v1/circulation/checkin', async (request, reply) => {
    const { barcode } = parseInput(checkinBody, request.body, 'החזרה');
    return reply.send(checkinByBarcode(context.db, barcode));
  });

  app.post('/api/v1/circulation/renew', async (request, reply) => {
    const body = parseInput(renewBody, request.body, 'הארכה');
    const options = body.extraDays === undefined ? {} : { extraDays: body.extraDays };
    return reply.send(renewLoan(context.db, body.loanPublicId, options));
  });

  app.get('/api/v1/loans', async (request, reply) => {
    const options = parseInput(loanListQuery, request.query, 'סינון');
    return reply.send(listLoans(context.db, options));
  });

  app.get('/api/v1/loans/:publicId', async (request, reply) => {
    const { publicId } = parseInput(params, request.params, 'כתובת');
    return reply.send(getLoan(context.db, publicId));
  });

  /**
   * The student card (§15).
   *
   * Deliberately the same shape the `library-summary` integration endpoint
   * will return (§8), so the card and the student system cannot end up showing
   * different numbers.
   */
  app.get('/api/v1/students/:publicId/library-summary', async (request, reply) => {
    const { publicId } = parseInput(params, request.params, 'כתובת');
    return reply.send(getStudentLibrarySummary(context.db, publicId));
  });
}
