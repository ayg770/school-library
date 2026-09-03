import type { FastifyInstance } from 'fastify';
import {
  createStudent,
  findStudentByBarcode,
  getStudent,
  listStudents,
  updateStudent,
  type AppContext,
} from '@school-library/core';
import { z } from 'zod';
import { apiError } from '../errors.js';
import { optionalTextField, paginationQuery, parseInput, queryFlag } from '../http.js';

const createBody = z.object({
  firstName: z.string(),
  lastName: z.string(),
  classPublicId: optionalTextField,
  localBarcode: optionalTextField,
  notes: optionalTextField,
});

const updateBody = createBody.partial().extend({ active: z.boolean().optional() });

const listQuery = z.object({
  query: z.string().optional(),
  classPublicId: z.string().optional(),
  active: queryFlag,
  ...paginationQuery,
});

const params = z.object({ publicId: z.string().min(1) });
const barcodeParams = z.object({ barcode: z.string().min(1) });

export function registerStudentRoutes(app: FastifyInstance, context: AppContext): void {
  app.get('/api/v1/students', async (request, reply) => {
    const options = parseInput(listQuery, request.query, 'סינון');
    return reply.send(listStudents(context.db, options));
  });

  app.post('/api/v1/students', async (request, reply) => {
    const body = parseInput(createBody, request.body, 'תלמיד');
    return reply.code(201).send(createStudent(context.db, body));
  });

  // Exact lookup for a scanned student card. A miss is a normal outcome, so it
  // answers 404 with a code the interface can act on rather than an error.
  app.get('/api/v1/students/by-barcode/:barcode', async (request, reply) => {
    const { barcode } = parseInput(barcodeParams, request.params, 'ברקוד');
    const student = findStudentByBarcode(context.db, barcode);
    if (student === null) {
      return reply.code(404).send(apiError('BARCODE_NOT_FOUND', 'לא נמצא תלמיד עם הברקוד הזה.'));
    }
    return reply.send(student);
  });

  app.get('/api/v1/students/:publicId', async (request, reply) => {
    const { publicId } = parseInput(params, request.params, 'כתובת');
    return reply.send(getStudent(context.db, publicId));
  });

  app.patch('/api/v1/students/:publicId', async (request, reply) => {
    const { publicId } = parseInput(params, request.params, 'כתובת');
    const body = parseInput(updateBody, request.body, 'תלמיד');
    return reply.send(updateStudent(context.db, publicId, body));
  });
}
