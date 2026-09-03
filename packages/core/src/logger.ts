import path from 'node:path';
import { pino, type Level, type Logger as PinoLogger, type StreamEntry } from 'pino';
import { APP_VERSION } from './version.js';

export type Logger = PinoLogger;

export interface CreateLoggerOptions {
  /** Directory for the rolling log file. Omit to log only to stdout. */
  readonly logDirectory?: string;
  readonly level?: Level;
}

/**
 * Structured logging for the local service.
 *
 * PRODUCT_SPEC.md §24: developer logs carry a timestamp, the application
 * version and enough context to diagnose a problem — and §21: never secrets.
 * The redaction list below is the enforcement of that second rule.
 */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const level = options.level ?? (process.env.LOG_LEVEL as Level | undefined) ?? 'info';

  const streams: StreamEntry[] = [{ level, stream: process.stdout }];

  if (options.logDirectory !== undefined) {
    streams.push({
      level,
      stream: pino.destination({
        dest: path.join(options.logDirectory, 'app.log'),
        mkdir: true,
        sync: false,
      }),
    });
  }

  return pino(
    {
      level,
      base: { appVersion: APP_VERSION },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: {
        paths: [
          'password',
          '*.password',
          'password_hash',
          '*.password_hash',
          'passwordHash',
          '*.passwordHash',
          'token',
          '*.token',
          'authorization',
          'req.headers.authorization',
          'req.headers.cookie',
        ],
        censor: '[redacted]',
      },
    },
    pino.multistream(streams),
  );
}
