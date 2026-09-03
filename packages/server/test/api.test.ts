import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAppContext, createLogger, type AppContext } from '@school-library/core';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const quietLogger = createLogger({ level: 'fatal' });

describe('local service API', () => {
  let root: string;
  let context: AppContext;
  let app: FastifyInstance;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'school-library-api-'));
    context = createAppContext({ dataRoot: root, logger: quietLogger });
    app = buildApp(context);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    context.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('reports health with the running versions', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { status: string; appVersion: string; schemaVersion: number };
    expect(body.status).toBe('ok');
    expect(body.schemaVersion).toBe(context.schemaVersion);
    expect(body.appVersion).toBe(context.appVersion);
  });

  it('exposes the information the support screen needs (§24)', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/system/info' });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      appVersion: string;
      schemaVersion: number;
      paths: Record<string, string>;
      settings: Record<string, unknown>;
    };

    expect(body.appVersion).toBe(context.appVersion);
    expect(body.schemaVersion).toBeGreaterThanOrEqual(1);
    expect(body.paths.root).toBe(context.paths.root);
    expect(body.paths.database).toBe(context.paths.databaseFile);
    expect(body.settings.default_loan_days).toBe(14);
    expect(body.settings.lan_enabled).toBe(false);
  });

  it('returns a structured error for an unknown route (§9)', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/does-not-exist' });

    expect(response.statusCode).toBe(404);
    const body = response.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message.length).toBeGreaterThan(0);
  });

  it('never exposes SQL or internals in an error body (§9)', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/does-not-exist' });
    expect(response.body.toUpperCase()).not.toContain('SELECT');
    expect(response.body).not.toContain('sqlite');
  });
});

describe('server configuration', () => {
  it('binds to loopback by default (§20)', () => {
    const config = loadConfig({});
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(3000);
    expect(config.isLoopback).toBe(true);
  });

  it('flags a non-loopback bind address', () => {
    const config = loadConfig({ SERVER_HOST: '0.0.0.0' });
    expect(config.isLoopback).toBe(false);
  });

  it('rejects an out-of-range port instead of silently defaulting', () => {
    expect(() => loadConfig({ SERVER_PORT: '99999' })).toThrowError();
    expect(() => loadConfig({ SERVER_PORT: 'not-a-number' })).toThrowError();
  });

  it('rejects an unknown log level', () => {
    expect(() => loadConfig({ LOG_LEVEL: 'chatty' })).toThrowError();
  });
});
