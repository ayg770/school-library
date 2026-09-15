import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { PullTable, RemoteLibrary, RemoteLoan, RemoteRow } from './types.js';

/**
 * The online library, reached over the network.
 *
 * The one place in this package that knows Supabase exists. Everything above
 * it works against `RemoteLibrary`, so the rules about what to do with a row
 * are tested without a network — and if the school ever moves its data
 * somewhere else, this file is what gets rewritten.
 */

/**
 * Where the library's data lives, and the key that identifies the project.
 *
 * Both are meant to be public: the same pair ships inside the office site's
 * page, and every visitor's browser receives them. They grant nothing on their
 * own. What protects the data is row level security, which returns no rows at
 * all without a signed-in account that maps to active staff.
 */
export const SUPABASE_URL = 'https://zyaliwbzxjivmicuvlbn.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_iY3iCaDaKZf9ZHB-TRoGUw_LW4aAL_h';

/** PostgREST answers a page at a time; the catalogue is bigger than one page. */
const PAGE_SIZE = 1000;

export interface Connection {
  readonly remote: RemoteLibrary;
  /**
   * The token to store for next time.
   *
   * Supabase rotates it on every refresh, so the one held locally has to be
   * replaced after each exchange or the next one signs in to nothing.
   */
  readonly refreshToken: string;
  readonly email: string;
}

export class SyncAuthError extends Error {}
export class SyncNetworkError extends Error {}

function newClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      // The session is kept in the library's own database, not in a browser
      // store this process does not have. Nothing is written to disk by the
      // client itself.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

class SupabaseLibrary implements RemoteLibrary {
  constructor(private readonly client: SupabaseClient) {}

  async fetchSince(table: PullTable, since: string | null): Promise<RemoteRow[]> {
    const rows: RemoteRow[] = [];

    for (let page = 0; ; page += 1) {
      let query = this.client
        .from(table)
        .select('*')
        // Ordered by the same column the cursor uses, and then by id so the
        // order is total: two rows written in the same millisecond must not be
        // able to swap places between one page and the next, or one of them is
        // never seen.
        .order('updated_at', { ascending: true })
        .order('public_id', { ascending: true })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      // Greater-or-equal, not greater: a row written in the same millisecond
      // as the cursor would otherwise be stepped over. Applying a row twice is
      // harmless; missing one is not.
      if (since !== null) query = query.gte('updated_at', since);

      const { data, error } = await query;
      if (error !== null) throw translate(error);

      rows.push(...((data ?? []) as RemoteRow[]));
      if ((data ?? []).length < PAGE_SIZE) return rows;
    }
  }

  async upsertLoans(loans: readonly RemoteLoan[]): Promise<void> {
    if (loans.length === 0) return;
    const { error } = await this.client.from('loans').upsert([...loans], { onConflict: 'public_id' });
    if (error !== null) throw translate(error);
  }

  async describeAccount(): Promise<{ email: string; displayName: string; role: string }> {
    const { data: session } = await this.client.auth.getUser();
    const authUserId = session.user?.id;
    if (authUserId === undefined) throw new SyncAuthError('אין חיבור פעיל לאונליין.');

    const { data, error } = await this.client
      .from('staff_users')
      .select('display_name, role, email, active')
      .eq('auth_user_id', authUserId)
      .maybeSingle();

    if (error !== null) throw translate(error);
    if (data === null) {
      throw new SyncAuthError('החשבון הזה אינו רשום כצוות הספרייה. הוסף אותו באתר הניהול.');
    }
    if (data.active !== true) {
      throw new SyncAuthError('החשבון הזה הושבת באתר הניהול.');
    }

    return {
      email: String(data.email ?? ''),
      displayName: String(data.display_name),
      role: String(data.role),
    };
  }
}

function translate(error: { message: string; code?: string }): Error {
  const message = error.message;
  if (/JWT|token|Unauthorized|not authenticated/i.test(message)) {
    return new SyncAuthError('החיבור לאונליין פג. התחבר מחדש במסך הסנכרון.');
  }
  if (/fetch failed|network|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(message)) {
    return new SyncNetworkError('אין חיבור לאינטרנט. הספרייה ממשיכה לעבוד; נסה שוב מאוחר יותר.');
  }
  const wrapped = new Error(message);
  if (error.code !== undefined) wrapped.name = error.code;
  return wrapped;
}

/** Signs in for the first time, with the credentials an administrator typed. */
export async function connectWithPassword(email: string, password: string): Promise<Connection> {
  const client = newClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });

  if (error !== null) throw new SyncAuthError('כתובת הדוא״ל או הסיסמה שגויים.');
  if (data.session === null) {
    throw new SyncAuthError('החשבון עדיין לא אושר בדוא״ל. אשר אותו ונסה שוב.');
  }

  const remote = new SupabaseLibrary(client);
  // Refuse the connection now rather than on the first exchange: an account
  // that is not staff can sign in to Supabase and still see nothing, and
  // "connected" followed by an empty download explains nothing.
  const account = await remote.describeAccount();

  return { remote, refreshToken: data.session.refresh_token, email: account.email || email };
}

/** Signs in again with the token kept from last time. */
export async function connectWithToken(refreshToken: string): Promise<Connection> {
  const client = newClient();
  const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken });

  if (error !== null || data.session === null) {
    throw new SyncAuthError('החיבור לאונליין פג. התחבר מחדש במסך הסנכרון.');
  }

  const remote = new SupabaseLibrary(client);
  const account = await remote.describeAccount();

  return { remote, refreshToken: data.session.refresh_token, email: account.email };
}
