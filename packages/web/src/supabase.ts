import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The connection to the library's own database.
 *
 * Both values below are meant to be public. The publishable key identifies the
 * project, not a person — every visitor's browser receives it, and it grants
 * nothing on its own. What protects the data is row level security: without a
 * signed-in account that maps to an active row in `staff_users`, this key
 * reads zero rows. That was verified against the live database before any data
 * was put in it.
 *
 * They are committed rather than injected at build time on purpose. A value
 * that ships inside the page gains nothing from being a deployment secret, and
 * the school should be able to rebuild this site from the repository alone.
 */
const SUPABASE_URL = 'https://zyaliwbzxjivmicuvlbn.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_iY3iCaDaKZf9ZHB-TRoGUw_LW4aAL_h';

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // The office is one person on their own computer. Staying signed in
    // between visits is the whole difference between a tool that gets used and
    // one that gets avoided.
    storageKey: 'school-library.session',
  },
});

/** A staff account, as this side of the system sees it. */
export interface StaffUser {
  public_id: string;
  username: string;
  display_name: string;
  role: 'admin' | 'librarian' | 'read_only';
  active: boolean;
  email: string | null;
}

/**
 * Who is signed in, as far as the library is concerned.
 *
 * A Supabase account is not the same as permission to use the library: anyone
 * may sign up, and someone who does without a prepared staff row sees nothing.
 * So this asks the database rather than the token — and a null answer is the
 * ordinary case for a stranger, not a fault.
 *
 * The row is matched on the signed-in account explicitly. Staff may read each
 * other — the משתמשים screen needs that — so asking for "a" staff row would
 * cheerfully return a colleague and sign you in as them.
 */
export async function currentStaff(): Promise<StaffUser | null> {
  const { data: session } = await supabase.auth.getUser();
  const authUserId = session.user?.id;
  if (authUserId === undefined) return null;

  // An account prepared by an administrator is claimed on first sign-in. Asked
  // every time rather than once: it does nothing when already claimed, and it
  // means somebody given access after they first tried is let in by signing in
  // again rather than by being told to do something obscure.
  await supabase.rpc('claim_staff_account');

  const { data } = await supabase
    .from('staff_users')
    .select('public_id, username, display_name, role, active, email')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  return (data as StaffUser | null) ?? null;
}
