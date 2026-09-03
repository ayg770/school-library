import { useCallback, useEffect, useState } from 'react';
import { api, type SessionState } from './api.js';

export interface SessionHook extends SessionState {
  readonly loading: boolean;
  refresh(): Promise<void>;
  signOut(): Promise<void>;
}

/**
 * Who is signed in, if anyone.
 *
 * Asked once at start-up: until the answer arrives the application shows
 * nothing, so a screen full of student names cannot flash up before the
 * session turns out to be invalid.
 */
export function useSession(): SessionHook {
  const [state, setState] = useState<SessionState>({ user: null, setupRequired: false });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setState(await api.session());
    } catch {
      // An unreachable service is not a signed-in one.
      setState({ user: null, setupRequired: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signOut = useCallback(async (): Promise<void> => {
    try {
      await api.logout();
    } finally {
      await refresh();
    }
  }, [refresh]);

  return { ...state, loading, refresh, signOut };
}
