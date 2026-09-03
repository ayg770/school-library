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
});

export type ServerConfig = z.infer<typeof configSchema> & { readonly isLoopback: boolean };

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const parsed = configSchema.parse({
    host: env.SERVER_HOST,
    port: env.SERVER_PORT,
    dataRoot: env.LIBRARY_DATA_DIR,
    logLevel: env.LOG_LEVEL,
  });

  return { ...parsed, isLoopback: LOOPBACK_HOSTS.has(parsed.host) };
}
