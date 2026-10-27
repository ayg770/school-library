import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createStaffUser,
  ensureDefaultSettings,
  migrations,
  openDatabase,
  listStaffUsers,
  readSettings,
  resolveSession,
  revokeAllSessions,
  runMigrations,
  signIn,
  updateStaffUser,
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

/**
 * A four-character code, and the thing that makes it safe.
 *
 * Ten thousand possibilities is not many. What stands between a short code
 * and somebody with an evening alone at the library computer is that the
 * account stops answering after a handful of wrong tries — a few attempts an
 * hour rather than thousands a minute. A child who fumbles their own code
 * twice must notice none of it.
 */
describe('a short code', () => {
  let db: Db;

  beforeEach(() => {
    db = openDatabase({ file: ':memory:' });
    runMigrations(db, migrations);
    createStaffUser(db, { username: 'mendy', password: '4821', displayName: 'מנדי' });
  });

  afterEach(() => db.close());

  const wrong = (): unknown => {
    try {
      signIn(db, 'mendy', '0000');
      return null;
    } catch (cause) {
      return cause;
    }
  };

  it('is allowed at four characters, and refused at three', () => {
    expect(signIn(db, 'mendy', '4821').user.username).toBe('mendy');
    expect(() => createStaffUser(db, { username: 'x', password: '123', displayName: 'x' })).toThrow(
      /4/,
    );
  });

  it('forgives the first few mistakes', () => {
    for (let i = 0; i < 4; i += 1) wrong();

    // Nothing has been locked: the child simply types it correctly.
    expect(signIn(db, 'mendy', '4821').user.username).toBe('mendy');
  });

  it('stops answering once the wrong code keeps coming', () => {
    for (let i = 0; i < 5; i += 1) wrong();

    // Even the right code waits now — which is the whole protection: a
    // guesser cannot tell a locked account from a wrong guess, and gets a
    // handful of tries an hour either way.
    expect(() => signIn(db, 'mendy', '4821')).toThrow(/ניסיונות/);
  });

  it('clears the count the moment the right code arrives', () => {
    for (let i = 0; i < 4; i += 1) wrong();
    signIn(db, 'mendy', '4821');

    // A bad morning does not follow a child into the afternoon: the next four
    // mistakes start from nothing again.
    for (let i = 0; i < 4; i += 1) wrong();
    expect(signIn(db, 'mendy', '4821').user.username).toBe('mendy');
  });

  it('is unlocked by an administrator setting a new code', () => {
    for (let i = 0; i < 6; i += 1) wrong();
    expect(() => signIn(db, 'mendy', '4821')).toThrow(/ניסיונות/);

    const [user] = listStaffUsers(db).filter((person) => person.username === 'mendy');
    updateStaffUser(db, user!.publicId, { password: '7391' });

    // The usual reason for a new code is that somebody is locked out, so a
    // new one that still refuses to be typed would be no way out.
    expect(signIn(db, 'mendy', '7391').user.username).toBe('mendy');
  });
});
