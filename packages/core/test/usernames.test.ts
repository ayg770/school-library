import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createStaffUser,
  ensureDefaultSettings,
  migrations,
  openDatabase,
  readSettings,
  resolveSession,
  revokeAllSessions,
  runMigrations,
  signIn,
  type Db,
} from '../src/index.js';

/**
 * Signing in with the name you are called by.
 *
 * The volunteers are children in a Hebrew-speaking school, and a sign-in
 * screen that insists on English is a sign-in screen they get wrong twice
 * before giving up. What matters more than accepting Hebrew is that the name
 * stored when the account was made is the one the child reaches by typing it:
 * a username nobody can type is an account nobody can use.
 */
describe('a staff username', () => {
  let db: Db;

  beforeEach(() => {
    db = openDatabase({ file: ':memory:' });
    runMigrations(db, migrations);
  });

  afterEach(() => {
    db.close();
  });

  const account = (username: string) => ({
    username,
    password: '12345678',
    displayName: 'מנדי כהן',
  });

  it('may be Hebrew, and signs in', () => {
    createStaffUser(db, account('מנדי'));

    expect(signIn(db, 'מנדי', '12345678').user.username).toBe('מנדי');
  });

  it('may end in a final letter', () => {
    createStaffUser(db, account('ברוך'));

    expect(signIn(db, 'ברוך', '12345678').user.username).toBe('ברוך');
  });

  it('still takes English, and still ignores capitals', () => {
    createStaffUser(db, account('Avremi'));

    expect(signIn(db, 'AVREMI', '12345678').user.username).toBe('avremi');
  });

  it('survives an invisible mark arriving with a pasted name', () => {
    // A right-to-left mark, as a copy out of a document brings along. It
    // cannot be seen in the field, so storing it would lock the account on
    // the day it was created.
    createStaffUser(db, account('‏שניאור‎'));

    expect(signIn(db, 'שניאור', '12345678').user.username).toBe('שניאור');
  });

  it('refuses a space, because the second word is never typed the same way', () => {
    expect(() => createStaffUser(db, account('מנדי כהן'))).toThrow(/שם המשתמש/);
  });

  it('refuses nikud, which cannot be reproduced at the sign-in screen', () => {
    expect(() => createStaffUser(db, account('מֶנדי'))).toThrow(/שם המשתמש/);
  });
});

/**
 * Being left alone.
 *
 * The library computer stands where children walk past it, and a session
 * lasts a fortnight. Locking Windows or closing the program has to end every
 * session on the machine — not only the one in the window that happens to be
 * open — or the next person to sit down is still signed in as the last one.
 */
describe('signing everyone out', () => {
  let db: Db;

  beforeEach(() => {
    db = openDatabase({ file: ':memory:' });
    runMigrations(db, migrations);
  });

  afterEach(() => {
    db.close();
  });

  it('ends every session, not only the one that asked', () => {
    createStaffUser(db, { username: 'first', password: '12345678', displayName: 'ראשון' });
    createStaffUser(db, { username: 'second', password: '87654321', displayName: 'שני' });

    const one = signIn(db, 'first', '12345678');
    const two = signIn(db, 'second', '87654321');

    expect(revokeAllSessions(db)).toBe(2);

    expect(resolveSession(db, one.token)).toBeNull();
    expect(resolveSession(db, two.token)).toBeNull();
  });

  it('leaves the accounts themselves alone — it is a lock, not a dismissal', () => {
    createStaffUser(db, { username: 'first', password: '12345678', displayName: 'ראשון' });
    signIn(db, 'first', '12345678');

    revokeAllSessions(db);

    expect(signIn(db, 'first', '12345678').user.username).toBe('first');
  });

  it('is on by default, including for a library that upgrades into it', () => {
    ensureDefaultSettings(db);

    expect(readSettings(db).lock_when_unattended).toBe(true);
  });
});
