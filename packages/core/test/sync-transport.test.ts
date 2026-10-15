import { afterEach, describe, expect, it } from 'vitest';
import {
  SyncAuthError,
  SyncNetworkError,
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

  // Longer than the rest: renewing a token is the one call Supabase retries
  // with a backoff before giving up, so a network fault takes seconds to be
  // reported rather than milliseconds. That is the right behaviour on a flaky
  // school connection, and the test has to wait for it like the librarian does.
  it('does not send a librarian to reconnect when it is the network that failed', async () => {
    useNetworkTransport(() => Promise.reject(CERTIFICATE_REJECTION));

    // A stored token is replaced by hand only when the online library refused
    // it. A filter in the way is not a reason to make someone type a password.
    const attempt = connectWithToken('a-stored-refresh-token');

    await expect(attempt).rejects.toThrow(SyncNetworkError);
    await expect(attempt).rejects.not.toThrow(/התחבר מחדש/);
  }, 30_000);

  it('still asks for a reconnection when the token itself was refused', async () => {
    respondWith(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });

    await expect(connectWithToken('an-expired-token')).rejects.toThrow(SyncAuthError);
    await expect(connectWithToken('an-expired-token')).rejects.toThrow(/התחבר מחדש/);
  });
});
