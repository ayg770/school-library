import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { BackupError, DomainError, type AppContext } from '@school-library/core';
import { registerAuth } from './auth.js';
import { apiError } from './errors.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerBackupRoutes } from './routes/backups.js';
import { registerBookRoutes } from './routes/books.js';
import { registerCirculationRoutes } from './routes/circulation.js';
import { registerClassRoutes } from './routes/classes.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerImportRoutes } from './routes/imports.js';
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
export interface BuildAppOptions {
  /** Directory of the built interface, served at the root when given. */
  readonly uiDir?: string;
  readonly trustProxy?: boolean;
}

export function buildApp(context: AppContext, options: BuildAppOptions = {}): FastifyInstance {
  // Widened to FastifyBaseLogger so Fastify keeps its default logger generic.
  // A pino logger satisfies that interface; without the widening every route
  // helper would have to be generic over pino's concrete Logger type.
  const app = Fastify({
    loggerInstance: context.logger as FastifyBaseLogger,
    disableRequestLogging: false,
    // Behind a hosting platform's proxy, the original scheme and address
    // arrive in headers. Without this the service would mark the session
    // cookie insecure on exactly the deployments that need it secure.
    trustProxy: options.trustProxy ?? false,
  });

  // Catalogue files arrive as multipart uploads (§13). Registered before the
  // routes so the import route can read the file off the request.
  void app.register(multipart, { limits: { files: 1, fileSize: 20 * 1024 * 1024 } });

  // A POST that takes no parameters — "back up now", "run this import" — may
  // arrive with a JSON content type and an empty body. Fastify's default parser
  // rejects that, which is a needless failure for a request that is complete.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    const text = typeof body === 'string' ? body.trim() : '';
    if (text === '') {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(text));
    } catch {
      const error = new Error('גוף הבקשה אינו JSON תקין.') as Error & { statusCode?: number };
      error.statusCode = 400;
      done(error, undefined);
    }
  });

  // Registered before any route so a route added later is closed by default
  // rather than by remembering to close it.
  registerAuth(app, context);

  registerAuthRoutes(app, context);
  registerHealthRoutes(app, context);
  registerSystemRoutes(app, context);
  registerClassRoutes(app, context);
  registerStudentRoutes(app, context);
  registerTaxonomyRoutes(app, context);
  registerBookRoutes(app, context);
  registerCirculationRoutes(app, context);
  registerBackupRoutes(app, context);
  registerImportRoutes(app, context);

  if (options.uiDir !== undefined) {
    void app.register(fastifyStatic, { root: options.uiDir, wildcard: false });
  }

  app.setNotFoundHandler(async (request, reply) => {
    // An unknown API path is an error. An unknown page path is the interface's
    // own routing, so it gets the application shell and resolves it in the
    // browser.
    if (options.uiDir !== undefined && !request.url.startsWith('/api/') && request.method === 'GET') {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send(apiError('NOT_FOUND', `לא נמצאה כתובת ${request.method} ${request.url}`));
  });

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

    // A backup problem is reportable too: the operator needs to know which
    // backup was rejected and why, not a generic server error.
    if (error instanceof BackupError) {
      request.log.error({ err: error, code: error.code }, 'Backup operation failed');
      const status = error.code === 'BACKUP_NOT_FOUND' ? 404 : 409;
      return reply.code(status).send(apiError(error.code, error.message));
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
