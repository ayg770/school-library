import type { Migration } from '../migrator.js';
import { migration001 } from './001-initial.js';
import { migration002 } from './002-catalog.js';
import { migration003 } from './003-circulation.js';
import { migration004 } from './004-imports.js';
import { migration005 } from './005-sessions.js';
import { migration006 } from './006-sync.js';

/**
 * Every migration, in order.
 *
 * CLAUDE.md: a released migration is immutable. To change the schema, append a
 * new entry here — never edit one that has shipped.
 */
export const migrations: readonly Migration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
];
