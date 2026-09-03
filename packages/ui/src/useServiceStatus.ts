import { useEffect, useState } from 'react';
import { fetchHealth } from './api.js';

export type ServiceState = 'checking' | 'reachable' | 'unreachable';

const POLL_INTERVAL_MS = 15_000;

/**
 * Tracks two independent things the support screen must distinguish (§24):
 * whether the local service answers, and whether the machine has internet.
 *
 * They are separate on purpose. Circulation depends on the first and never on
 * the second (§23), so an offline machine with a healthy service is a normal,
 * fully working state — not an error.
 */
export function useServiceStatus(): { service: ServiceState; online: boolean } {
  const [service, setService] = useState<ServiceState>('checking');
  const [online, setOnline] = useState<boolean>(() => navigator.onLine);

  useEffect(() => {
    const updateOnline = (): void => setOnline(navigator.onLine);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const check = async (): Promise<void> => {
      try {
        await fetchHealth(controller.signal);
        if (!cancelled) setService('reachable');
      } catch {
        if (!cancelled) setService('unreachable');
      }
    };

    void check();
    const timer = window.setInterval(() => void check(), POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);

  return { service, online };
}
