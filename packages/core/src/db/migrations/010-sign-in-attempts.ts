import type { Migration } from '../migrator.js';

/**
 * Counting wrong codes.
 *
 * The librarian asked for four-character codes, because a volunteer who is
 * nine should not have to remember eight. Four digits is ten thousand
 * possibilities, which a person could work through given a long enough
 * evening alone with the computer — so the thing that makes a short code safe
 * is not its length, it is that guessing is slow.
 *
 * These two columns are what makes it slow. Consecutive failures are counted,
 * and past a handful the account stops answering for a while — longer each
 * time. A guesser gets a few tries an hour instead of thousands a minute,
 * which turns ten thousand possibilities into years; a child who mistypes
 * their own code twice notices nothing at all.
 *
 * They sit on the account rather than in memory because the program is closed
 * and opened all day, and a counter that forgets at every launch protects
 * nothing.
 */
export const migration010: Migration = {
  version: 10,
  name: 'sign-in-attempts',
  sql: `
    ALTER TABLE staff_users ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE staff_users ADD COLUMN locked_until TEXT NULL;
  `,
};
