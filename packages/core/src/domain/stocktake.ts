import type { Db } from '../db/open.js';
import { newPublicId } from '../ids.js';
import { CONDITION_STATUSES, findCopyByBarcode, type BookCopy, type ConditionStatus } from './copies.js';
import { nowIso, optionalText, requireText } from './common.js';
import { DomainError } from './errors.js';

/**
 * Counting the shelves — PRODUCT_SPEC.md §12.
 *
 * The library is about to be handed to volunteers who are children. Before
 * that, somebody has to walk the shelves with a scanner and establish that the
 * 2,212 copies in the catalogue are 2,212 books in the room. This is what that
 * walk writes down.
 *
 * The design has one rule above all others: a book that is present and fine —
 * which is almost every book — must cost exactly one scan and nothing else. A
 * screen that asks a question after each book turns a morning's work into a
 * week's. So scanning records "seen, in order"; saying anything else is the
 * exception, and only the exception costs a keystroke.
 */

/** A round of counting. Progress means "seen since this began". */
export interface StocktakeRound {
  readonly publicId: string;
  readonly name: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly note: string | null;
}

interface RoundRow {
  id: number;
  public_id: string;
  name: string;
  started_at: string;
  finished_at: string | null;
  note: string | null;
}

function mapRound(row: RoundRow): StocktakeRound {
  return {
    publicId: row.public_id,
    name: row.name,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    note: row.note,
  };
}

const ROUND_SELECT =
  'SELECT id, public_id, name, started_at, finished_at, note FROM stocktake_rounds';

/** The row id of the open round, which is what a sighting points at. */
function openRoundId(db: Db): number | null {
  const row = db
    .prepare('SELECT id FROM stocktake_rounds WHERE finished_at IS NULL')
    .get() as { id: number } | undefined;
  return row?.id ?? null;
}

export function currentRound(db: Db): StocktakeRound | null {
  const row = db
    .prepare(`${ROUND_SELECT} WHERE finished_at IS NULL`)
    .get() as RoundRow | undefined;
  return row === undefined ? null : mapRound(row);
}

export function listRounds(db: Db): StocktakeRound[] {
  const rows = db
    .prepare(`${ROUND_SELECT} ORDER BY started_at DESC`)
    .all() as RoundRow[];
  return rows.map(mapRound);
}

/**
 * Opens a round.
 *
 * Refused while another is open, rather than quietly closing it: two people
 * counting different things under one name is how a count stops meaning
 * anything, and the person who opened the first round is entitled to be asked.
 */
export function startRound(db: Db, name: unknown, userPublicId?: string | null): StocktakeRound {
  if (currentRound(db) !== null) {
    throw new DomainError(
      'VALIDATION',
      'כבר פתוח סבב בדיקה. סיים אותו לפני שתתחיל סבב חדש.',
      'name',
    );
  }

  const roundName = requireText(name, 'name', 'שם הסבב', 120);
  const publicId = newPublicId();
  const timestamp = nowIso();

  db.prepare(
    `INSERT INTO stocktake_rounds (public_id, name, started_at, started_by_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(publicId, roundName, timestamp, staffRowId(db, userPublicId), timestamp, timestamp);

  return mapRound(
    db.prepare(`${ROUND_SELECT} WHERE public_id = ?`).get(publicId) as RoundRow,
  );
}

export function finishRound(db: Db, note?: unknown): StocktakeRound {
  const open = currentRound(db);
  if (open === null) {
    throw new DomainError('VALIDATION', 'אין סבב בדיקה פתוח.');
  }

  const timestamp = nowIso();
  db.prepare(
    'UPDATE stocktake_rounds SET finished_at = ?, note = ?, updated_at = ? WHERE public_id = ?',
  ).run(timestamp, optionalText(note, 'note', 'הערה', 500) ?? open.note, timestamp, open.publicId);

  return mapRound(
    db.prepare(`${ROUND_SELECT} WHERE public_id = ?`).get(open.publicId) as RoundRow,
  );
}

/** How far the current round has got. */
export interface StocktakeProgress {
  readonly round: StocktakeRound | null;
  /** Copies the catalogue expects to be on a shelf. */
  readonly expected: number;
  readonly seen: number;
  readonly missing: number;
  /** Seen in this round, by what the librarian said about them. */
  readonly byCondition: Readonly<Record<ConditionStatus, number>>;
}

/**
 * Withdrawn copies are not expected on a shelf.
 *
 * Counting them would leave a number that can never reach its total, and a
 * progress bar that cannot be finished is one nobody trusts.
 */
const EXPECTED = "active = 1 AND condition_status <> 'withdrawn'";
/** The same rule where the query joins, and the columns need their table. */
const EXPECTED_BC = "bc.active = 1 AND bc.condition_status <> 'withdrawn'";

export function stocktakeProgress(db: Db): StocktakeProgress {
  const round = currentRound(db);

  const expected = (
    db.prepare(`SELECT COUNT(*) AS n FROM book_copies WHERE ${EXPECTED}`).get() as { n: number }
  ).n;

  const byCondition = Object.fromEntries(
    CONDITION_STATUSES.map((status) => [status, 0]),
  ) as Record<ConditionStatus, number>;

  const roundId = openRoundId(db);
  if (round === null || roundId === null) {
    return { round: null, expected, seen: 0, missing: expected, byCondition };
  }

  const rows = db
    .prepare(
      `SELECT condition_status AS status, COUNT(*) AS n
         FROM book_copies
        WHERE active = 1 AND verified_round_id = ?
        GROUP BY condition_status`,
    )
    .all(roundId) as Array<{ status: ConditionStatus; n: number }>;

  let seen = 0;
  for (const row of rows) {
    byCondition[row.status] = row.n;
    seen += row.n;
  }

  // Seen can exceed expected once withdrawn copies are scanned, so the shelf
  // that is still outstanding is counted directly rather than subtracted.
  const missing = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM book_copies
          WHERE ${EXPECTED} AND (verified_round_id IS NULL OR verified_round_id <> ?)`,
      )
      .get(roundId) as { n: number }
  ).n;

  return { round, expected, seen, missing, byCondition };
}

/** What the screen shows the moment a barcode arrives. */
export interface ScanResult {
  readonly found: boolean;
  readonly barcode: string;
  readonly copy: BookCopy | null;
  /** True when this copy was already counted earlier in the same round. */
  readonly repeat: boolean;
  /** Set when the copy is out on loan — it is not missing, it is with a child. */
  readonly onLoanTo: string | null;
}

export interface ScanInput {
  readonly barcode: unknown;
  readonly conditionStatus?: unknown;
  readonly conditionNote?: unknown;
  /**
   * Who was holding the scanner, by the id the outside world uses.
   *
   * A public id rather than a row number, so a route can pass what it has
   * without reaching into the database, and so an account that does not exist
   * is refused here with a sentence rather than by a foreign key.
   */
  readonly userPublicId?: string | null;
}

/** The row id behind a staff account's public id. */
function staffRowId(db: Db, publicId: string | null | undefined): number | null {
  if (publicId === null || publicId === undefined || publicId === '') return null;

  const row = db.prepare('SELECT id FROM staff_users WHERE public_id = ?').get(publicId) as
    | { id: number }
    | undefined;

  if (row === undefined) {
    throw new DomainError('REFERENCE_NOT_FOUND', 'המשתמש שנבחר לא נמצא.', 'userPublicId');
  }
  return row.id;
}

function requireCondition(value: unknown): ConditionStatus {
  if (value === undefined || value === null || value === '') return 'normal';
  if (typeof value !== 'string' || !CONDITION_STATUSES.includes(value as ConditionStatus)) {
    throw new DomainError('VALIDATION', 'מצב הספר אינו תקין.', 'conditionStatus');
  }
  return value as ConditionStatus;
}

/**
 * One book, seen.
 *
 * Marks the copy present, in the condition given — `normal` when nothing was
 * said, because that is true of almost every book and saying so should cost
 * nothing. A copy not in the catalogue is reported rather than invented: the
 * screen offers to add it, and adding a book is a decision with a title and an
 * author in it, not something a scanner should do by itself.
 */
export function recordScan(db: Db, input: ScanInput): ScanResult {
  const barcode = requireText(input.barcode, 'barcode', 'ברקוד', 64);
  const copy = findCopyByBarcode(db, barcode);

  if (copy === null) {
    return { found: false, barcode, copy: null, repeat: false, onLoanTo: null };
  }

  const roundId = openRoundId(db);
  if (roundId === null) {
    throw new DomainError('VALIDATION', 'אין סבב בדיקה פתוח. התחל סבב כדי לספור.');
  }

  const seenAlready = db
    .prepare('SELECT verified_round_id AS round FROM book_copies WHERE barcode = ?')
    .get(barcode) as { round: number | null };
  const repeat = seenAlready.round === roundId;
  const userId = staffRowId(db, input.userPublicId);
  const condition = requireCondition(input.conditionStatus);
  const note = optionalText(input.conditionNote, 'conditionNote', 'הערת מצב', 500);
  const timestamp = nowIso();

  db.prepare(
    `UPDATE book_copies
        SET verified_at = ?, verified_round_id = ?, verified_by_user_id = ?,
            condition_status = ?, condition_note = COALESCE(?, condition_note),
            updated_at = ?
      WHERE barcode = ?`,
  ).run(timestamp, roundId, userId, condition, note ?? null, timestamp, barcode);

  const borrower = db
    .prepare(
      `SELECT s.first_name || ' ' || s.last_name AS name
         FROM loans l
         JOIN students s ON s.id = l.student_id
         JOIN book_copies bc ON bc.id = l.copy_id
        WHERE bc.barcode = ? AND l.returned_at IS NULL AND l.confirmed_at IS NOT NULL`,
    )
    .get(barcode) as { name: string } | undefined;

  return {
    found: true,
    barcode,
    copy: findCopyByBarcode(db, barcode),
    repeat,
    onLoanTo: borrower?.name ?? null,
  };
}

export interface MissingCopy {
  readonly publicId: string;
  readonly barcode: string;
  readonly title: string;
  readonly author: string | null;
  readonly shelfName: string | null;
  readonly lastSeen: string | null;
  /** The child holding it, when the catalogue knows the book is out. */
  readonly onLoanTo: string | null;
}

/** Which pile of the round a list is asking for. */
export type RoundGroup = 'missing' | 'counted' | 'attention';

/** A row of such a list. A counted book has a condition worth showing. */
export interface RoundCopy extends MissingCopy {
  readonly condition: ConditionStatus;
}

/**
 * The books behind one of the numbers on the stocktake screen.
 *
 * Every tile up there is a count of something, and a count is the one thing a
 * librarian cannot act on: 2,042 missing is a statement about the library,
 * while a list of 2,042 shelf marks is an afternoon of work. The three piles
 * come out of one query because they differ by a single clause — a list that
 * disagrees with the tile above it would be worse than no list at all.
 *
 *  - `missing`   — expected on the shelf and not yet seen in this round
 *  - `counted`   — seen in this round
 *  - `attention` — seen in this round and marked damaged or needing repair
 *
 * A book out on loan is listed with the child's name rather than left to look
 * like a loss. Most of what a first count cannot find is sitting in a
 * schoolbag, and a list that does not say so sends somebody searching the
 * shelves for a book nobody could have found there.
 */
export function listRoundCopies(
  db: Db,
  group: RoundGroup,
  options: { readonly limit?: number; readonly offset?: number } = {},
): { items: RoundCopy[]; total: number } {
  const roundId = openRoundId(db);
  if (roundId === null) return { items: [], total: 0 };

  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const offset = Math.max(options.offset ?? 0, 0);

  // Counted and attention describe what this round has seen, so they are not
  // narrowed to what was expected: a withdrawn copy that turns up on a shelf
  // was still scanned, and leaving it out of the list it was counted in is
  // how a number stops matching the books behind it.
  const where =
    group === 'missing'
      ? {
          count: `${EXPECTED} AND (verified_round_id IS NULL OR verified_round_id <> ?)`,
          rows: `${EXPECTED_BC} AND (bc.verified_round_id IS NULL OR bc.verified_round_id <> ?)`,
        }
      : group === 'counted'
        ? {
            count: 'active = 1 AND verified_round_id = ?',
            rows: 'bc.active = 1 AND bc.verified_round_id = ?',
          }
        : {
            count:
              "active = 1 AND verified_round_id = ? AND condition_status IN ('damaged', 'repair')",
            rows:
              "bc.active = 1 AND bc.verified_round_id = ? AND bc.condition_status IN ('damaged', 'repair')",
          };

  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM book_copies WHERE ${where.count}`).get(roundId) as {
      n: number;
    }
  ).n;

  const rows = db
    .prepare(
      `SELECT bc.public_id, bc.barcode, bc.condition_status AS condition,
              b.title, b.author_text AS author,
              sl.name AS shelf_name, bc.verified_at AS last_seen,
              (SELECT s.first_name || ' ' || s.last_name
                 FROM loans l JOIN students s ON s.id = l.student_id
                WHERE l.copy_id = bc.id AND l.returned_at IS NULL
                  AND l.confirmed_at IS NOT NULL) AS on_loan_to
         FROM book_copies bc
         JOIN books b ON b.id = bc.book_id
         LEFT JOIN shelf_locations sl ON sl.id = bc.shelf_location_id
        WHERE ${where.rows}
        ORDER BY sl.name, b.title
        LIMIT ? OFFSET ?`,
    )
    .all(roundId, limit, offset) as Array<{
    public_id: string;
    barcode: string;
    condition: ConditionStatus;
    title: string;
    author: string | null;
    shelf_name: string | null;
    last_seen: string | null;
    on_loan_to: string | null;
  }>;

  return {
    total,
    items: rows.map((row) => ({
      publicId: row.public_id,
      barcode: row.barcode,
      condition: row.condition,
      title: row.title,
      author: row.author,
      shelfName: row.shelf_name,
      lastSeen: row.last_seen,
      onLoanTo: row.on_loan_to,
    })),
  };
}

/**
 * What has not turned up yet — the case above that the screen asks for most,
 * kept under the name the rest of the program already calls it by.
 */
export function listMissing(
  db: Db,
  options: { readonly limit?: number; readonly offset?: number } = {},
): { items: MissingCopy[]; total: number } {
  return listRoundCopies(db, 'missing', options);
}
