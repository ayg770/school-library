import type { Migration } from '../migrator.js';
import { migration001 } from './001-initial.js';
import { migration002 } from './002-catalog.js';

/**
 * Every migration, in order.
 *
 * CLAUDE.md: a released migration is immutable. To change the schema, append a
 * new entry here — never edit one that has shipped.
 */
export const migrations: readonly Migration[] = [migration001, migration002];
