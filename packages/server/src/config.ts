import { z } from 'zod';

/**
 * Server configuration, validated at startup.
 *
 * PRODUCT_SPEC.md §20: the service listens on loopback only unless an
 * administrator deliberately enables local-network access. Binding elsewhere
 * is possible but never silent — `isLoopback` drives a startup warning.
 */
const configSchema = z.object({
  host: z.string().min(1).default('127.0.0.1'),
  port: z.coerce.number().int().min(0).max(65535).default(3000),
  dataRoot: z.string().min(1).optional(),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /**
   * Directory holding the built interface. When set, the service serves the
   * interface itself, so a deployment is one process on one URL rather than
   * two. Left unset in development, where Vite serves it and proxies the API.
   */
  uiDir: z.string().min(1).optional(),
  /**
   * Whether a reverse proxy sits in front. Hosting platforms terminate TLS and
   * forward plain HTTP, so without this the service believes every request is
   * insecure and stops marking the session cookie Secure — which is precisely
   * the case where it matters most.
   */
  trustProxy: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

export type ServerConfig = z.infer<typeof configSchema> & { readonly isLoopback: boolean };

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const parsed = configSchema.parse({
    host: env.SERVER_HOST,
    port: env.SERVER_PORT,
    dataRoot: env.LIBRARY_DATA_DIR,
    logLevel: env.LOG_LEVEL,
    uiDir: env.UI_DIR,
    trustProxy: env.TRUST_PROXY,
  });

  return { ...parsed, isLoopback: LOOPBACK_HOSTS.has(parsed.host) };
}
