import type { Db } from '../db/open.js';
import { newPublicId } from '../ids.js';
import { nowIso, optionalText, requireText } from './common.js';
import { findCopyByBarcode } from './copies.js';
import { DomainError, notFound } from './errors.js';
import { staffRowId } from './auth.js';
import { recordAudit } from './audit.js';

/**
 * "This is not that book."
 *
 * A librarian counting a shelf finds a barcode whose sticker and whose
 * catalogue entry disagree. Whether the sticker went on the wrong book years
 * ago or the spreadsheet was wrong when it was imported cannot be told from
 * the desk, and a person holding a book with children waiting is the worst
 * possible person to ask.
 *
 * So the desk does not decide. One press says "this is wrong", the count
 * carries on, and the disagreements collect for somebody with time and both
 * records in front of them. The alternative — making them stop and fix it —
 * means in practice that they stop counting.
 */

export const REPORT_KINDS = ['wrong_book', 'unreadable', 'other'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export interface CatalogueReport {
  readonly publicId: string;
  readonly barcode: string;
  /** What the catalogue claimed when the report was filed. */
  readonly claimedTitle: string | null;
  /** What the librarian says it really is, where they had time to say. */
  readonly actualTitle: string | null;
  readonly kind: ReportKind;
  readonly note: string | null;
  readonly reportedBy: string | null;
  readonly reportedAt: string;
  readonly resolvedAt: string | null;
  readonly resolution: string | null;
}

interface ReportRow {
  public_id: string;
  barcode: string;
  claimed_title: string | null;
  actual_title: string | null;
  kind: ReportKind;
  note: string | null;
  reported_by: string | null;
  reported_at: string;
  resolved_at: string | null;
  resolution: string | null;
}

const SELECT = `
  SELECT r.public_id, r.barcode, r.claimed_title, r.actual_title, r.kind, r.note,
         u.display_name AS reported_by, r.reported_at, r.resolved_at, r.resolution
    FROM catalogue_reports r
    LEFT JOIN staff_users u ON u.id = r.reported_by_user_id`;

function map(row: ReportRow): CatalogueReport {
  return {
    publicId: row.public_id,
    barcode: row.barcode,
    claimedTitle: row.claimed_title,
    actualTitle: row.actual_title,
    kind: row.kind,
    note: row.note,
    reportedBy: row.reported_by,
    reportedAt: row.reported_at,
    resolvedAt: row.resolved_at,
    resolution: row.resolution,
  };
}

export interface ReportInput {
  readonly barcode: unknown;
  readonly kind?: unknown;
  readonly actualTitle?: unknown;
  readonly note?: unknown;
  readonly userPublicId?: string | null;
}

function requireKind(value: unknown): ReportKind {
  if (value === undefined || value === null || value === '') return 'wrong_book';
  if (typeof value !== 'string' || !REPORT_KINDS.includes(value as ReportKind)) {
    throw new DomainError('VALIDATION', 'סוג הדיווח אינו תקין.', 'kind');
  }
  return value as ReportKind;
}

/**
 * Files a disagreement, or updates the one already open for this barcode.
 *
 * Pressing the button twice is not an error. A librarian who sees nothing
 * obvious happen will press again, and filing two reports for one sticker
 * would make the list longer without making it truer.
 */
export function reportMismatch(db: Db, input: ReportInput): CatalogueReport {
  const barcode = requireText(input.barcode, 'barcode', 'ברקוד', 64);
  const kind = requireKind(input.kind);
  const actualTitle = optionalText(input.actualTitle, 'actualTitle', 'שם הספר בפועל', 300);
  const note = optionalText(input.note, 'note', 'הערה', 500);

  const copy = findCopyByBarcode(db, barcode);
  const timestamp = nowIso();

  const userId = staffRowId(db, input.userPublicId);

  const open = db
    .prepare('SELECT public_id FROM catalogue_reports WHERE barcode = ? AND resolved_at IS NULL')
    .get(barcode) as { public_id: string } | undefined;

  if (open !== undefined) {
    db.prepare(
      `UPDATE catalogue_reports
          SET kind = ?, actual_title = COALESCE(?, actual_title),
              note = COALESCE(?, note), updated_at = ?
        WHERE public_id = ?`,
    ).run(kind, actualTitle, note, timestamp, open.public_id);

    return getReport(db, open.public_id);
  }

  const publicId = newPublicId();
  db.prepare(
    `INSERT INTO catalogue_reports
       (public_id, copy_id, barcode, claimed_title, actual_title, kind, note,
        reported_by_user_id, reported_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    publicId,
    copy === null
      ? null
      : (db.prepare('SELECT id FROM book_copies WHERE barcode = ?').get(barcode) as { id: number })
          .id,
    barcode,
    // The catalogue's claim is recorded now, because the correction this
    // report asks for is exactly what would otherwise erase the evidence.
    copy?.bookTitle ?? null,
    actualTitle,
    kind,
    note,
    userId,
    timestamp,
    timestamp,
    timestamp,
  );

  // Noticing that a label and the catalogue disagree is work, and it is the
  // kind that leaves nothing behind on the shelf to show for it.
  if (userId !== null) {
    recordAudit(db, {
      action: 'report.filed',
      entityType: 'catalogue_report',
      entityId: publicId,
      userId,
      newData: { barcode, kind },
    });
  }

  return getReport(db, publicId);
}

export function getReport(db: Db, publicId: string): CatalogueReport {
  const row = db.prepare(`${SELECT} WHERE r.public_id = ?`).get(publicId) as ReportRow | undefined;
  if (row === undefined) throw notFound('הדיווח');
  return map(row);
}

export function listReports(
  db: Db,
  options: { readonly resolved?: boolean } = {},
): { items: CatalogueReport[]; total: number; open: number } {
  const clause =
    options.resolved === undefined
      ? ''
      : options.resolved
        ? 'WHERE r.resolved_at IS NOT NULL'
        : 'WHERE r.resolved_at IS NULL';

  const rows = db
    .prepare(`${SELECT} ${clause} ORDER BY r.resolved_at IS NOT NULL, r.reported_at DESC LIMIT 500`)
    .all() as ReportRow[];

  const counts = db
    .prepare(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN resolved_at IS NULL THEN 1 ELSE 0 END) AS open
         FROM catalogue_reports`,
    )
    .get() as { total: number; open: number | null };

  return { items: rows.map(map), total: counts.total, open: counts.open ?? 0 };
}

export function resolveReport(db: Db, publicId: string, resolution: unknown): CatalogueReport {
  const current = getReport(db, publicId);
  if (current.resolvedAt !== null) return current;

  const timestamp = nowIso();
  db.prepare(
    'UPDATE catalogue_reports SET resolved_at = ?, resolution = ?, updated_at = ? WHERE public_id = ?',
  ).run(timestamp, optionalText(resolution, 'resolution', 'מה נעשה', 500), timestamp, publicId);

  return getReport(db, publicId);
}

/** How many disagreements are waiting, for a badge on a screen. */
export function openReportCount(db: Db): number {
  return (
    db.prepare('SELECT COUNT(*) AS n FROM catalogue_reports WHERE resolved_at IS NULL').get() as {
      n: number;
    }
  ).n;
}
