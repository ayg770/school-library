/**
 * The UI's only contract with the service (ARCHITECTURE.md AD-2).
 * These types mirror the responses in `@school-library/server`.
 */

export interface SystemInfo {
  appVersion: string;
  schemaVersion: number;
  paths: {
    root: string;
    database: string;
    backups: string;
    logs: string;
    imports: string;
    exports: string;
  };
  settings: {
    school_name: string;
    default_loan_days: number;
    max_active_loans_per_student: number;
    interface_language: string;
    lan_enabled: boolean;
    backup_retention_count: number;
    automatic_backup_enabled: boolean;
  };
}

export interface HealthStatus {
  status: 'ok';
  appVersion: string;
  schemaVersion: number;
  checkedAt: string;
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    headers: { Accept: 'application/json' },
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    throw new Error(`השרת המקומי החזיר שגיאה ${response.status}`);
  }
  return (await response.json()) as T;
}

export function fetchSystemInfo(signal?: AbortSignal): Promise<SystemInfo> {
  return getJson<SystemInfo>('/api/v1/system/info', signal);
}

export function fetchHealth(signal?: AbortSignal): Promise<HealthStatus> {
  return getJson<HealthStatus>('/api/v1/health', signal);
}
