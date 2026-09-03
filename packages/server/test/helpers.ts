import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createAppContext,
  createLogger,
  createStaffUser,
  type AppContext,
  type Role,
} from '@school-library/core';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp } from '../src/app.js';

const quietLogger = createLogger({ level: 'fatal' });

export interface TestApp {
  readonly app: FastifyInstance;
  readonly context: AppContext;
  readonly root: string;
  /** The session cookie for the signed-in member of staff. */
  readonly cookie: string;
  get(url: string, options?: InjectOptions): ReturnType<FastifyInstance['inject']>;
  post(url: string, payload?: unknown, options?: InjectOptions): ReturnType<FastifyInstance['inject']>;
  patch(url: string, payload?: unknown): ReturnType<FastifyInstance['inject']>;
  /** Signs in as another account, returning that session's cookie. */
  signInAs(username: string, password: string): Promise<string>;
  close(): Promise<void>;
}

export interface BareTestApp {
  readonly app: FastifyInstance;
  readonly context: AppContext;
  close(): Promise<void>;
}

/**
 * A service with no accounts at all — where a new installation starts.
 *
 * Deleting the accounts from a normal harness is not the same thing: signing
 * in writes an audit entry that references the user, so the rows cannot simply
 * be removed.
 */
export async function createBareTestApp(): Promise<BareTestApp> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'school-library-bare-'));
  const context = createAppContext({ dataRoot: root, logger: quietLogger });
  const app = buildApp(context);
  await app.ready();

  return {
    app,
    context,
    close: async () => {
      await app.close();
      context.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

/**
 * A running service with a signed-in member of staff.
 *
 * Every route but a handful requires a session, so a test that does not sign in
 * is only ever testing the guard. Each instance gets its own temp data
 * directory, so tests stay independent.
 */
export async function createTestApp(role: Role = 'admin'): Promise<TestApp> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'school-library-test-'));
  const context = createAppContext({ dataRoot: root, logger: quietLogger });
  const app = buildApp(context);
  await app.ready();

  // The first account is always an administrator, so a lesser role is made by
  // creating that one first and then the account under test.
  createStaffUser(context.db, {
    username: 'root',
    password: 'root-password',
    displayName: 'מנהל ראשוני',
  });

  const username = role === 'admin' ? 'root' : role;
  if (role !== 'admin') {
    createStaffUser(context.db, {
      username,
      password: 'test-password',
      displayName: `בודק ${role}`,
      role,
    });
  }

  const signIn = async (user: string, password: string): Promise<string> => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: user, password },
    });
    const header = response.headers['set-cookie'];
    const raw = Array.isArray(header) ? header[0] : header;
    if (raw === undefined) throw new Error(`sign-in failed: ${response.body}`);
    return raw.split(';')[0] ?? '';
  };

  const cookie = await signIn(username, role === 'admin' ? 'root-password' : 'test-password');

  return {
    app,
    context,
    root,
    cookie,
    get: (url, options) => app.inject({ method: 'GET', url, headers: { cookie }, ...options }),
    post: (url, payload, options) =>
      app.inject({
        method: 'POST',
        url,
        headers: { cookie },
        ...(payload === undefined ? {} : { payload }),
        ...options,
      }),
    patch: (url, payload) =>
      app.inject({ method: 'PATCH', url, headers: { cookie }, payload: payload as object }),
    signInAs: signIn,
    close: async () => {
      await app.close();
      context.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
