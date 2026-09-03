import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db/open.js';
import { newPublicId } from '../ids.js';
import { hashPassword, verifyPassword } from '../password.js';
import { recordAudit } from './audit.js';
import { fromDbBool, nowIso, requireText, toDbBool } from './common.js';
import { DomainError, notFound } from './errors.js';

/**
 * Staff accounts and sign-in — PRODUCT_SPEC.md §21.
 *
 * A username and a password, held locally. Not a third-party sign-in: the
 * application must work with the network disconnected (§2), and an identity
 * provider cannot be reached then. Choosing one now would mean rewriting this
 * when the library moves to the desktop, where it would stop working entirely.
 */

export const ROLES = ['admin', 'librarian', 'read_only'] as const;
export type Role = (typeof ROLES)[number];

/** What each role may do. Every role above inherits the ones below it. */
const ROLE_RANK: Record<Role, number> = { read_only: 0, librarian: 1, admin: 2 };

export function roleAllows(role: Role, required: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[required];
}

export interface StaffUser {
  readonly publicId: string;
  readonly username: string;
  readonly displayName: string;
  readonly role: Role;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateStaffUserInput {
  readonly username: unknown;
  readonly password: unknown;
  readonly displayName: unknown;
  readonly role?: unknown;
}

export interface UpdateStaffUserInput {
  readonly displayName?: unknown;
  readonly password?: unknown;
  readonly role?: unknown;
  readonly active?: boolean;
}

interface UserRow {
  id: number;
  public_id: string;
  username: string;
  password_hash: string;
  display_name: string;
  role: Role;
  active: number;
  created_at: string;
  updated_at: string;
}

const SESSION_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 8;

function mapUser(row: UserRow): StaffUser {
  return {
    publicId: row.public_id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    active: fromDbBool(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function requireUsername(value: unknown): string {
  const username = requireText(value, 'username', 'שם משתמש', 60).toLowerCase();
  if (!/^[a-z0-9._-]+$/.test(username)) {
    throw new DomainError(
      'VALIDATION',
      'שם המשתמש יכול להכיל אותיות באנגלית, ספרות, נקודה, מקף וקו תחתון בלבד.',
      'username',
    );
  }
  return username;
}

function requirePassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < MIN_PASSWORD_LENGTH) {
    throw new DomainError(
      'VALIDATION',
      `הסיסמה חייבת להכיל לפחות ${MIN_PASSWORD_LENGTH} תווים.`,
      'password',
    );
  }
  return value;
}

function requireRole(value: unknown, fallback: Role): Role {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || !ROLES.includes(value as Role)) {
    throw new DomainError('VALIDATION', 'התפקיד אינו תקין.', 'role');
  }
  return value as Role;
}

/** True while no account exists, which is what the first-run screen asks. */
export function needsFirstUser(db: Db): boolean {
  const row = db.prepare('SELECT COUNT(*) AS n FROM staff_users WHERE active = 1').get() as {
    n: number;
  };
  return row.n === 0;
}

export function createStaffUser(db: Db, input: CreateStaffUserInput): StaffUser {
  const username = requireUsername(input.username);
  const password = requirePassword(input.password);
  const displayName = requireText(input.displayName, 'displayName', 'שם לתצוגה', 120);

  // The first account is always an administrator: someone has to be able to
  // create the others.
  const role = needsFirstUser(db) ? 'admin' : requireRole(input.role, 'librarian');

  const existing = db.prepare('SELECT 1 FROM staff_users WHERE username = ?').get(username);
  if (existing !== undefined) {
    throw new DomainError('DUPLICATE_VALUE', 'שם המשתמש הזה כבר תפוס.', 'username');
  }

  const publicId = newPublicId();
  const timestamp = nowIso();

  db.prepare(
    `INSERT INTO staff_users (public_id, username, password_hash, display_name, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(publicId, username, hashPassword(password), displayName, role, timestamp, timestamp);

  return getStaffUser(db, publicId);
}

export function getStaffUser(db: Db, publicId: string): StaffUser {
  const row = db.prepare('SELECT * FROM staff_users WHERE public_id = ?').get(publicId) as
    | UserRow
    | undefined;
  if (row === undefined) throw notFound('המשתמש');
  return mapUser(row);
}

export function listStaffUsers(db: Db): StaffUser[] {
  const rows = db.prepare('SELECT * FROM staff_users ORDER BY display_name').all() as UserRow[];
  return rows.map(mapUser);
}

export function updateStaffUser(db: Db, publicId: string, input: UpdateStaffUserInput): StaffUser {
  const current = getStaffUser(db, publicId);

  const displayName =
    input.displayName === undefined
      ? current.displayName
      : requireText(input.displayName, 'displayName', 'שם לתצוגה', 120);
  const role = input.role === undefined ? current.role : requireRole(input.role, current.role);
  const active = input.active ?? current.active;

  // Locking everyone out is not recoverable from inside the application.
  if ((!active || role !== 'admin') && current.role === 'admin' && current.active) {
    const others = db
      .prepare("SELECT COUNT(*) AS n FROM staff_users WHERE role = 'admin' AND active = 1 AND public_id <> ?")
      .get(publicId) as { n: number };
    if (others.n === 0) {
      throw new DomainError(
        'VALIDATION',
        'זהו מנהל המערכת האחרון. הוסף מנהל נוסף לפני שינוי ההרשאה או ביטול המשתמש.',
        'role',
      );
    }
  }

  const timestamp = nowIso();

  if (input.password !== undefined) {
    const password = requirePassword(input.password);
    db.prepare('UPDATE staff_users SET password_hash = ?, updated_at = ? WHERE public_id = ?').run(
      hashPassword(password),
      timestamp,
      publicId,
    );
    // A password change ends every session that used the old one.
    revokeAllSessionsFor(db, publicId);
  }

  db.prepare(
    'UPDATE staff_users SET display_name = ?, role = ?, active = ?, updated_at = ? WHERE public_id = ?',
  ).run(displayName, role, toDbBool(active), timestamp, publicId);

  if (!active) revokeAllSessionsFor(db, publicId);

  return getStaffUser(db, publicId);
}

export interface Session {
  /** Sent to the client. Never stored — only its hash is. */
  readonly token: string;
  readonly expiresAt: string;
  readonly user: StaffUser;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Verifies a username and password and opens a session.
 *
 * A wrong username and a wrong password give the same message and take a
 * comparable amount of time, so the form cannot be used to discover which
 * accounts exist.
 */
export function signIn(db: Db, username: unknown, password: unknown): Session {
  const failure = new DomainError('VALIDATION', 'שם משתמש או סיסמה שגויים.', 'username');

  if (typeof username !== 'string' || typeof password !== 'string') throw failure;

  const row = db.prepare('SELECT * FROM staff_users WHERE username = ?').get(username.trim().toLowerCase()) as
    | UserRow
    | undefined;

  // Hash anyway when the user does not exist, so the reply takes a similar time.
  const storedHash = row?.password_hash ?? hashPassword('placeholder-for-timing');
  const passwordMatches = verifyPassword(password, storedHash);

  if (row === undefined || !passwordMatches) throw failure;
  if (row.active !== 1) {
    throw new DomainError('VALIDATION', 'המשתמש אינו פעיל. פנה למנהל המערכת.', 'username');
  }

  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * MS_PER_DAY).toISOString();

  db.prepare(
    'INSERT INTO staff_sessions (token_hash, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
  ).run(hashToken(token), row.id, now.toISOString(), expiresAt, now.toISOString());

  recordAudit(db, {
    action: 'settings.changed',
    entityType: 'session',
    entityId: row.public_id,
    userId: row.id,
    newData: { event: 'signed-in', username: row.username },
  });

  return { token, expiresAt, user: mapUser(row) };
}

/** Resolves a token to its user, or null. Expired sessions are cleaned up. */
export function resolveSession(db: Db, token: string | undefined): StaffUser | null {
  if (token === undefined || token === '') return null;

  const tokenHash = hashToken(token);
  const row = db
    .prepare(
      `SELECT s.id AS session_id, s.expires_at, u.*
         FROM staff_sessions s JOIN staff_users u ON u.id = s.user_id
        WHERE s.token_hash = ?`,
    )
    .get(tokenHash) as (UserRow & { session_id: number; expires_at: string }) | undefined;

  if (row === undefined) return null;

  if (Date.parse(row.expires_at) < Date.now() || row.active !== 1) {
    db.prepare('DELETE FROM staff_sessions WHERE id = ?').run(row.session_id);
    return null;
  }

  db.prepare('UPDATE staff_sessions SET last_seen_at = ? WHERE id = ?').run(nowIso(), row.session_id);
  return mapUser(row);
}

export function signOut(db: Db, token: string | undefined): void {
  if (token === undefined || token === '') return;
  db.prepare('DELETE FROM staff_sessions WHERE token_hash = ?').run(hashToken(token));
}

export function revokeAllSessionsFor(db: Db, userPublicId: string): void {
  db.prepare(
    'DELETE FROM staff_sessions WHERE user_id = (SELECT id FROM staff_users WHERE public_id = ?)',
  ).run(userPublicId);
}

/** Removes sessions that have already expired. Called at startup. */
export function purgeExpiredSessions(db: Db): number {
  const result = db.prepare('DELETE FROM staff_sessions WHERE expires_at < ?').run(nowIso());
  return result.changes;
}

export function describeRole(role: Role): string {
  const labels: Record<Role, string> = {
    admin: 'מנהל מערכת',
    librarian: 'ספרן',
    read_only: 'צפייה בלבד',
  };
  return labels[role];
}
