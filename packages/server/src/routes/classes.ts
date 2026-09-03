import type { FastifyInstance } from 'fastify';
import {
  createClass,
  getClass,
  listClasses,
  updateClass,
  type AppContext,
} from '@school-library/core';
import { z } from 'zod';
import { optionalTextField, paginationQuery, parseInput, queryFlag } from '../http.js';

const createBody = z.object({
  name: z.string(),
  grade: optionalTextField,
  section: optionalTextField,
  academicYear: optionalTextField,
  externalClassId: optionalTextField,
});

const updateBody = createBody.partial().extend({ active: z.boolean().optional() });

const listQuery = z.object({
  query: z.string().optional(),
  active: queryFlag,
  ...paginationQuery,
});

const params = z.object({ publicId: z.string().min(1) });

export function registerClassRoutes(app: FastifyInstance, context: AppContext): void {
  app.get('/api/v1/classes', async (request, reply) => {
    const options = parseInput(listQuery, request.query, 'סינון');
    return reply.send(listClasses(context.db, options));
  });

  app.post('/api/v1/classes', async (request, reply) => {
    const body = parseInput(createBody, request.body, 'כיתה');
    return reply.code(201).send(createClass(context.db, body));
  });

  app.get('/api/v1/classes/:publicId', async (request, reply) => {
    const { publicId } = parseInput(params, request.params, 'כתובת');
    return reply.send(getClass(context.db, publicId));
  });

  app.patch('/api/v1/classes/:publicId', async (request, reply) => {
    const { publicId } = parseInput(params, request.params, 'כתובת');
    const body = parseInput(updateBody, request.body, 'כיתה');
    return reply.send(updateClass(context.db, publicId, body));
  });
}
