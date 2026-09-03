import {
  IMPORT_FIELDS,
  cancelImportBatch,
  commitImportBatch,
  createImportBatch,
  getImportBatch,
  listImportBatches,
  listImportRows,
  parseFile,
  suggestMapping,
  validateImportBatch,
  type AppContext,
  type ImportType,
} from '@school-library/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { apiError } from '../errors.js';
import { parseInput } from '../http.js';

const params = z.object({ publicId: z.string().min(1) });

const validateBody = z.object({
  mapping: z.record(z.string(), z.number().int().min(0)),
});

const rowsQuery = z.object({
  status: z.enum(['pending', 'ready', 'warning', 'error', 'skipped', 'imported', 'failed']).optional(),
  limit: z.coerce.number().int().optional(),
  offset: z.coerce.number().int().optional(),
});

const IMPORT_TYPES = ['students', 'books'] as const;

/** 20 MB is far beyond any school's catalogue export, and bounds the upload. */
const MAX_FILE_BYTES = 20 * 1024 * 1024;

/**
 * Import — PRODUCT_SPEC.md §13.
 *
 * The wizard's steps map onto these routes: upload and preview, map columns
 * and validate, then commit. Nothing reaches the catalogue until the last one,
 * so the librarian sees every conflict while it is still free to fix.
 */
export function registerImportRoutes(app: FastifyInstance, context: AppContext): void {
  app.get('/api/v1/imports', async (_request, reply) =>
    reply.send({ items: listImportBatches(context.db) }),
  );

  app.get('/api/v1/imports/fields', async (_request, reply) => reply.send(IMPORT_FIELDS));

  app.post('/api/v1/imports', async (request, reply) => {
    const upload = await request.file({ limits: { fileSize: MAX_FILE_BYTES } });

    if (upload === undefined) {
      return reply.code(400).send(apiError('VALIDATION', 'לא נבחר קובץ.'));
    }

    const rawType = (upload.fields.importType as { value?: unknown } | undefined)?.value;
    if (typeof rawType !== 'string' || !IMPORT_TYPES.includes(rawType as ImportType)) {
      return reply.code(400).send(apiError('VALIDATION', 'יש לציין מה מייבאים: תלמידים או ספרים.'));
    }
    const importType = rawType as ImportType;

    const buffer = await upload.toBuffer();
    if (upload.file.truncated) {
      return reply.code(413).send(apiError('FILE_TOO_LARGE', 'הקובץ גדול מדי. המגבלה היא 20MB.'));
    }

    const sheet = await parseFile(upload.filename, buffer);
    const batch = createImportBatch(context.db, {
      filename: upload.filename,
      importType,
      sheet,
    });

    // The mapping is proposed, never applied on its own: §13 has the librarian
    // confirm it before a single row is validated against it.
    return reply.code(201).send({
      batch,
      suggestedMapping: suggestMapping(sheet.headers, importType),
      fields: IMPORT_FIELDS[importType],
      encoding: 'encoding' in sheet ? sheet.encoding : undefined,
      preview: listImportRows(context.db, batch.publicId, { limit: 10 }).items,
    });
  });

  app.get('/api/v1/imports/:publicId', async (request, reply) => {
    const { publicId } = parseInput(params, request.params, 'כתובת');
    const batch = getImportBatch(context.db, publicId);
    return reply.send({ batch, fields: IMPORT_FIELDS[batch.importType] });
  });

  app.get('/api/v1/imports/:publicId/rows', async (request, reply) => {
    const { publicId } = parseInput(params, request.params, 'כתובת');
    const options = parseInput(rowsQuery, request.query, 'סינון');
    return reply.send(listImportRows(context.db, publicId, options));
  });

  app.post('/api/v1/imports/:publicId/validate', async (request, reply) => {
    const { publicId } = parseInput(params, request.params, 'כתובת');
    const { mapping } = parseInput(validateBody, request.body, 'מיפוי');
    return reply.send(validateImportBatch(context.db, publicId, mapping));
  });

  app.post('/api/v1/imports/:publicId/commit', async (request, reply) => {
    const { publicId } = parseInput(params, request.params, 'כתובת');
    const report = commitImportBatch(context.db, publicId);

    request.log.info(
      { batch: publicId, imported: report.imported, failed: report.failed },
      'Import committed',
    );
    return reply.send(report);
  });

  app.post('/api/v1/imports/:publicId/cancel', async (request, reply) => {
    const { publicId } = parseInput(params, request.params, 'כתובת');
    return reply.send(cancelImportBatch(context.db, publicId));
  });
}
