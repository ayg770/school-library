import { afterEach, describe, expect, it } from 'vitest';
import {
  SyncAuthError,
  SyncNetworkError,
  classifyAuthFailure,
  connectWithPassword,
  connectWithToken,
  useNetworkTransport,
} from '../src/sync/supabase.js';

/**
 * Reaching the online library from a school computer.
 *
 * These exist because of a real evening at the library desk. The librarian
 * typed a correct password and the application answered "the e-mail address or
 * password is wrong", three times. Nothing had reached the online library at
 * all: the school runs UserGate, a filter that terminates every secure
 * connection and presents a certificate of its own, and the request was
 * refused on the way out by a list of trusted authorities that had never heard
 * of it.
 *
 * Two faults, and both are covered below. The application could not use the
 * network the computer was configured for, and when that failed it accused the
 * password. The first cost an evening; the second is what made it cost an
 * evening, because it pointed at the one thing that was not wrong.
 */

/** How the filter's certificate surfaces on a machine that does not trust it. */
const CERTIFICATE_REJECTION = new TypeError(
  'fetch failed: unable to verify the first certificate',
);

afterEach(() => {
  useNetworkTransport(globalThis.fetch.bind(globalThis));
});

/** Answers every request the way a server would, without a network. */
function respondWith(status: number, body: unknown): string[] {
  const seen: string[] = [];
  useNetworkTransport(async (input) => {
    seen.push(String(input));
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return seen;
}

describe('reaching the online library', () => {
  it('routes its requests through the transport the host supplies', async () => {
    const seen = respondWith(400, { error: 'invalid_grant' });

    await expect(connectWithPassword('ayg770@gmail.com', 'whatever')).rejects.toThrow();

    // The point of the seam: on the library computer this is Electron's stack,
    // which uses the certificates and proxy Windows was told about.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]).toContain('/auth/v1/token');
  });

  it('blames the password only when the online library actually said so', async () => {
    respondWith(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });

    await expect(connectWithPassword('ayg770@gmail.com', 'wrong')).rejects.toThrow(SyncAuthError);
    await expect(connectWithPassword('ayg770@gmail.com', 'wrong')).rejects.toThrow(
      /הדוא״ל או הסיסמה שגויים/,
    );
  });

  it('does not blame the password when the request never arrived', async () => {
    useNetworkTransport(() => Promise.reject(CERTIFICATE_REJECTION));

    const attempt = connectWithPassword('ayg770@gmail.com', 'a-correct-password');

    // The whole fix, in one assertion: a connection that never left the
    // building must not send anyone hunting for a password that was right.
    await expect(attempt).rejects.toThrow(SyncNetworkError);
    await expect(attempt).rejects.not.toThrow(SyncAuthError);
  });

  it('names the filter as a likely cause, and keeps the technical detail', async () => {
    useNetworkTransport(() => Promise.reject(CERTIFICATE_REJECTION));

    await expect(connectWithPassword('ayg770@gmail.com', 'correct')).rejects.toThrow(
      /מסנן הרשת של בית הספר/,
    );
    // Support can only act on what the message carries up from below.
    await expect(connectWithPassword('ayg770@gmail.com', 'correct')).rejects.toThrow(
      /certificate/,
    );
  });

  it('says the library still works', async () => {
    useNetworkTransport(() => Promise.reject(new TypeError('fetch failed')));

    await expect(connectWithPassword('ayg770@gmail.com', 'correct')).rejects.toThrow(
      /ממשיכה לעבוד/,
    );
  });

  /**
   * The rule itself, rather than the library that happens to apply it.
   *
   * This used to be driven through `connectWithToken`, which meant waiting out
   * Supabase's retry schedule for a network fault: half a minute, and not the
   * same half minute on every machine. The Windows build failed on it while
   * Linux passed — a test reporting on the weather rather than on the rule.
   * What matters is the decision, and the decision is one number.
   */
  it('reads a real HTTP refusal as the credentials being wrong', () => {
    expect(classifyAuthFailure({ status: 400 })).toBe('credentials');
    expect(classifyAuthFailure({ status: 401 })).toBe('credentials');
    expect(classifyAuthFailure({ status: 422 })).toBe('credentials');
    expect(classifyAuthFailure({ status: 499 })).toBe('credentials');
  });

  it('reads anything else as the request never having arrived', () => {
    // Zero is what the client reports when nothing answered — the case that
    // cost the library an evening, blamed on a password that was correct.
    expect(classifyAuthFailure({ status: 0 })).toBe('network');
    expect(classifyAuthFailure({})).toBe('network');
    expect(classifyAuthFailure({ status: undefined })).toBe('network');
    // A server that broke is not a librarian who mistyped.
    expect(classifyAuthFailure({ status: 500 })).toBe('network');
    expect(classifyAuthFailure({ status: 502 })).toBe('network');
  });

  it('still asks for a reconnection when the token itself was refused', async () => {
    respondWith(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });

    await expect(connectWithToken('an-expired-token')).rejects.toThrow(SyncAuthError);
    await expect(connectWithToken('an-expired-token')).rejects.toThrow(/התחבר מחדש/);
  });
});
