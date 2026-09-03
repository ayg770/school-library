import type { FastifyInstance } from 'fastify';
import {
  createCategory,
  createShelf,
  getCategory,
  getShelf,
  listCategories,
  listShelves,
  updateCategory,
  updateShelf,
  type AppContext,
} from '@school-library/core';
import { z } from 'zod';
import { optionalTextField, parseInput, queryFlag } from '../http.js';

/** Categories and shelf locations: the small lookup lists a book refers to. */

const categoryBody = z.object({
  name: z.string(),
  parentPublicId: optionalTextField,
});
const categoryUpdate = categoryBody.partial().extend({ active: z.boolean().optional() });

const shelfBody = z.object({
  name: z.string(),
  room: optionalTextField,
  shelfCode: optionalTextField,
});
const shelfUpdate = shelfBody.partial().extend({ active: z.boolean().optional() });

const activeQuery = z.object({ active: queryFlag });
const params = z.object({ publicId: z.string().min(1) });

export function registerTaxonomyRoutes(app: FastifyInstance, context: AppContext): void {
  app.get('/api/v1/categories', async (request, reply) => {
    const options = parseInput(activeQuery, request.query, 'סינון');
    return reply.send({ items: listCategories(context.db, options) });
  });

  app.post('/api/v1/categories', async (request, reply) => {
    const body = parseInput(categoryBody, request.body, 'קטגוריה');
    return reply.code(201).send(createCategory(context.db, body));
  });

  app.get('/api/v1/categories/:publicId', async (request, reply) => {
    const { publicId } = parseInput(params, request.params, 'כתובת');
    return reply.send(getCategory(context.db, publicId));
  });

  app.patch('/api/v1/categories/:publicId', async (request, reply) => {
    const { publicId } = parseInput(params, request.params, 'כתובת');
    const body = parseInput(categoryUpdate, request.body, 'קטגוריה');
    return reply.send(updateCategory(context.db, publicId, body));
  });

  app.get('/api/v1/shelf-locations', async (request, reply) => {
    const options = parseInput(activeQuery, request.query, 'סינון');
    return reply.send({ items: listShelves(context.db, options) });
  });

  app.post('/api/v1/shelf-locations', async (request, reply) => {
    const body = parseInput(shelfBody, request.body, 'מיקום מדף');
    return reply.code(201).send(createShelf(context.db, body));
  });

  app.get('/api/v1/shelf-locations/:publicId', async (request, reply) => {
    const { publicId } = parseInput(params, request.params, 'כתובת');
    return reply.send(getShelf(context.db, publicId));
  });

  app.patch('/api/v1/shelf-locations/:publicId', async (request, reply) => {
    const { publicId } = parseInput(params, request.params, 'כתובת');
    const body = parseInput(shelfUpdate, request.body, 'מיקום מדף');
    return reply.send(updateShelf(context.db, publicId, body));
  });
}
