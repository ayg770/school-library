import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers.js';
import { loadConfig } from '../src/config.js';

describe('local service API', () => {
  let harness: TestApp;

  beforeEach(async () => {
    harness = await createTestApp();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('reports health with the running versions', async () => {
    const response = await harness.get('/api/v1/health');

    expect(response.statusCode).toBe(200);
    const body = response.json() as { status: string; appVersion: string; schemaVersion: number };
    expect(body.status).toBe('ok');
    expect(body.schemaVersion).toBe(harness.context.schemaVersion);
    expect(body.appVersion).toBe(harness.context.appVersion);
  });

  it('answers the update check even when nothing can be reached', async () => {
    // Pointed at an address that cannot answer, which is what a library
    // computer with no connection looks like. The route must still return a
    // body the screen can show — never an error the librarian has to
    // interpret (§23, ARCHITECTURE.md AD-8).
    const previous = process.env.LIBRARY_RELEASES_URL;
    process.env.LIBRARY_RELEASES_URL = 'http://127.0.0.1:1/releases';

    try {
      const response = await harness.get('/api/v1/system/update');

      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        currentVersion: string;
        updateAvailable: boolean;
        problem: string | null;
      };

      expect(body.currentVersion).toBe(harness.context.appVersion);
      expect(body.updateAvailable).toBe(false);
      expect(body.problem).not.toBeNull();
    } finally {
      if (previous === undefined) delete process.env.LIBRARY_RELEASES_URL;
      else process.env.LIBRARY_RELEASES_URL = previous;
    }
  });

  it('exposes the information the support screen needs (§24)', async () => {
    const response = await harness.get('/api/v1/system/info');

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      appVersion: string;
      schemaVersion: number;
      paths: Record<string, string>;
      settings: Record<string, unknown>;
    };

    expect(body.appVersion).toBe(harness.context.appVersion);
    expect(body.schemaVersion).toBeGreaterThanOrEqual(1);
    expect(body.paths.root).toBe(harness.context.paths.root);
    expect(body.paths.database).toBe(harness.context.paths.databaseFile);
    expect(body.settings.default_loan_days).toBe(14);
    expect(body.settings.lan_enabled).toBe(false);
  });

  it('returns a structured error for an unknown route (§9)', async () => {
    const response = await harness.get('/api/v1/does-not-exist');

    expect(response.statusCode).toBe(404);
    const body = response.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message.length).toBeGreaterThan(0);
  });

  it('accepts a POST with a JSON content type and no body', async () => {
    // The browser's fetch sends this shape for an action that takes no
    // parameters. Rejecting it made "back up now" and "run the import" fail.
    const response = await harness.post('/api/v1/backups', undefined, {
      headers: { cookie: harness.cookie, 'content-type': 'application/json' },
      payload: '',
    });

    expect(response.statusCode).toBe(201);
  });

  it('still rejects a malformed JSON body', async () => {
    const response = await harness.post('/api/v1/books', undefined, {
      headers: { cookie: harness.cookie, 'content-type': 'application/json' },
      payload: '{ this is not json',
    });

    expect(response.statusCode).toBe(400);
  });

  it('never exposes SQL or internals in an error body (§9)', async () => {
    const response = await harness.get('/api/v1/does-not-exist');
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
