import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { DomainError, type AppContext } from '@school-library/core';
import { apiError } from './errors.js';
import { registerBookRoutes } from './routes/books.js';
import { registerCirculationRoutes } from './routes/circulation.js';
import { registerClassRoutes } from './routes/classes.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerStudentRoutes } from './routes/students.js';
import { registerSystemRoutes } from './routes/system.js';
import { registerTaxonomyRoutes } from './routes/taxonomy.js';

/**
 * Builds the HTTP API over an application context.
 *
 * ARCHITECTURE.md AD-2: this is the only way into the database. The renderer,
 * a browser on the local network, and a future integration client all arrive
 * here, so a rule enforced in this layer is enforced for all of them.
 */
export function buildApp(context: AppContext): FastifyInstance {
  // Widened to FastifyBaseLogger so Fastify keeps its default logger generic.
  // A pino logger satisfies that interface; without the widening every route
  // helper would have to be generic over pino's concrete Logger type.
  const app = Fastify({
    loggerInstance: context.logger as FastifyBaseLogger,
    disableRequestLogging: false,
  });

  registerHealthRoutes(app, context);
  registerSystemRoutes(app, context);
  registerClassRoutes(app, context);
  registerStudentRoutes(app, context);
  registerTaxonomyRoutes(app, context);
  registerBookRoutes(app, context);
  registerCirculationRoutes(app, context);

  app.setNotFoundHandler(async (request, reply) =>
    reply.code(404).send(apiError('NOT_FOUND', `לא נמצאה כתובת ${request.method} ${request.url}`)),
  );

  // §24: a user sees a short message, never a stack trace. The detail goes to
  // the log, where §21 keeps it free of secrets.
  app.setErrorHandler(async (error, request, reply) => {
    // A domain error is an expected outcome — a duplicate barcode, a missing
    // student — so it carries its own code and a message written for the
    // librarian, and is logged as a warning rather than a fault.
    if (error instanceof DomainError) {
      request.log.warn({ code: error.code, field: error.field }, 'Rejected request');
      return reply.code(error.httpStatus).send(apiError(error.code, error.message));
    }

    request.log.error({ err: error }, 'Request failed');
    const status = error.statusCode ?? 500;

    if (status >= 500) {
      return reply.code(status).send(apiError('INTERNAL_ERROR', 'אירעה שגיאה בשרת. נסה שוב.'));
    }
    return reply.code(status).send(apiError(error.code ?? 'BAD_REQUEST', error.message));
  });

  return app;
}
