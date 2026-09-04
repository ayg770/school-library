import type { FastifyInstance } from 'fastify';
import {
  CONDITION_STATUSES,
  createBook,
  createCopy,
  findCopyByBarcode,
  getBook,
  getCopy,
  intakeCopy,
  listBooks,
  listCopies,
  listLoans,
  updateBook,
  updateCopy,
  type AppContext,
} from '@school-library/core';
import { z } from 'zod';
import { apiError } from '../errors.js';
import { optionalTextField, paginationQuery, parseInput, queryFlag } from '../http.js';

const bookBody = z.object({
  title: z.string(),
  subtitle: optionalTextField,
  authorText: optionalTextField,
  publisher: optionalTextField,
  publicationYear: optionalTextField,
  isbn10: optionalTextField,
  isbn13: optionalTextField,
  language: optionalTextField,
  categoryPublicId: optionalTextField,
  defaultCallNumber: optionalTextField,
  notes: optionalTextField,
});
const bookUpdate = bookBody.partial().extend({ active: z.boolean().optional() });

const copyBody = z.object({
  bookPublicId: z.string(),
  barcode: z.string(),
  legacyId: optionalTextField,
  accessionNumber: optionalTextField,
  shelfPublicId: optionalTextField,
  conditionStatus: z.enum(CONDITION_STATUSES).optional(),
  purchaseDate: optionalTextField,
  priceCents: z.union([z.number(), z.null()]).optional(),
  conditionNote: optionalTextField,
});
const copyUpdate = copyBody.omit({ bookPublicId: true }).partial().extend({
  active: z.boolean().optional(),
  verifiedAt: z.union([z.string(), z.null()]).optional(),
});

const intakeBody = z.object({
  barcode: z.string(),
  title: z.string(),
  authorText: optionalTextField,
  isbn13: optionalTextField,
  categoryPublicId: optionalTextField,
  shelfPublicId: optionalTextField,
});

const bookListQuery = z.object({
  query: z.string().optional(),
  categoryPublicId: z.string().optional(),
  active: queryFlag,
  ...paginationQuery,
});

const copyListQuery = z.object({
  bookPublicId: z.string().optional(),
  shelfPublicId: z.string().optional(),
  conditionStatus: z.enum(CONDITION_STATUSES).optional(),
  active: queryFlag,
  ...paginationQuery,
});

const params = z.object({ publicId: z.string().min(1) });
const barcodeParams = z.object({ barcode: z.string().min(1) });

export function registerBookRoutes(app: FastifyInstance, context: AppContext): void {
  app.get('/api/v1/books', async (request, reply) => {
    const options = parseInput(bookListQuery, request.query, 'סינון');
    return reply.send(listBooks(context.db, options));
  });

  app.post('/api/v1/books', async (request, reply) => {
    const body = parseInput(bookBody, request.body, 'ספר');
    return reply.code(201).send(createBook(context.db, body));
  });

  app.get('/api/v1/books/:publicId', async (request, reply) => {
    const { publicId } = parseInput(params, request.params, 'כתובת');
    // A title is rarely useful without its physical items, and §16 asks for
    // the current borrower alongside each one.
    const book = getBook(context.db, publicId);
    const copies = listCopies(context.db, { bookPublicId: publicId, limit: 200 });
    const openLoans = listLoans(context.db, { bookPublicId: publicId, status: 'active', limit: 200 });
    const byCopy = new Map(openLoans.items.map((loan) => [loan.copyPublicId, loan]));

    return reply.send({
      ...book,
      copies: copies.items.map((copy) => {
        const loan = byCopy.get(copy.publicId);
        return {
          ...copy,
          onLoan: loan !== undefined,
          borrowerName: loan === undefined ? null : `${loan.studentFirstName} ${loan.studentLastName}`,
          dueAt: loan?.dueAt ?? null,
          overdue: loan?.overdue ?? false,
        };
      }),
    });
  });

  app.patch('/api/v1/books/:publicId', async (request, reply) => {
    const { publicId } = parseInput(params, request.params, 'כתובת');
    const body = parseInput(bookUpdate, request.body, 'ספר');
    return reply.send(updateBook(context.db, publicId, body));
  });

  /**
   * Shelf intake (§12): one barcode, one title, one call. The title is found
   * or created; the copy is always new.
   */
  app.post('/api/v1/intake', async (request, reply) => {
    const body = parseInput(intakeBody, request.body, 'קליטת ספר');
    return reply.code(201).send(intakeCopy(context.db, body));
  });

  app.get('/api/v1/copies', async (request, reply) => {
    const options = parseInput(copyListQuery, request.query, 'סינון');
    return reply.send(listCopies(context.db, options));
  });

  app.post('/api/v1/copies', async (request, reply) => {
    const body = parseInput(copyBody, request.body, 'עותק');
    return reply.code(201).send(createCopy(context.db, body));
  });

  /**
   * The scan path (§11, §22): exact, indexed, no fragment matching.
   * A miss answers 404 with `BARCODE_NOT_FOUND`, which is what drives the
   * "barcode not found — add this copy?" flow rather than an error screen.
   */
  app.get('/api/v1/copies/by-barcode/:barcode', async (request, reply) => {
    const { barcode } = parseInput(barcodeParams, request.params, 'ברקוד');
    const copy = findCopyByBarcode(context.db, barcode);
    if (copy === null) {
      return reply.code(404).send(apiError('BARCODE_NOT_FOUND', 'הברקוד לא נמצא במערכת.'));
    }
    return reply.send(copy);
  });

  app.get('/api/v1/copies/:publicId', async (request, reply) => {
    const { publicId } = parseInput(params, request.params, 'כתובת');
    return reply.send(getCopy(context.db, publicId));
  });

  app.patch('/api/v1/copies/:publicId', async (request, reply) => {
    const { publicId } = parseInput(params, request.params, 'כתובת');
    const body = parseInput(copyUpdate, request.body, 'עותק');
    return reply.send(updateCopy(context.db, publicId, body));
  });
}
