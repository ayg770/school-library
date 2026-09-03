import type { Db } from '../db/open.js';
import { newPublicId } from '../ids.js';
import { nowIso } from './common.js';

/**
 * The audit trail (§7).
 *
 * Every circulation event is written here inside the same transaction as the
 * change it describes, so the log cannot disagree with the data (§23).
 */
export type AuditAction =
  | 'loan.checked_out'
  | 'loan.returned'
  | 'loan.renewed'
  | 'loan.due_date_changed'
  | 'copy.condition_changed'
  | 'copy.barcode_changed'
  | 'student.deactivated'
  | 'settings.changed';

export interface AuditEntry {
  readonly action: AuditAction;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly userId?: number | null;
  readonly oldData?: unknown;
  readonly newData?: unknown;
}

export interface AuditRecord extends AuditEntry {
  readonly eventId: string;
  readonly createdAt: string;
}

/**
 * Appends one entry.
 *
 * Call it inside the caller's transaction — it opens none of its own, so a
 * rolled-back change takes its audit entry with it.
 */
export function recordAudit(db: Db, entry: AuditEntry): string {
  const eventId = newPublicId();

  db.prepare(
    `INSERT INTO audit_log (event_id, user_id, action, entity_type, entity_id,
                            old_data_json, new_data_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    eventId,
    entry.userId ?? null,
    entry.action,
    entry.entityType,
    entry.entityId,
    entry.oldData === undefined ? null : JSON.stringify(entry.oldData),
    entry.newData === undefined ? null : JSON.stringify(entry.newData),
    nowIso(),
  );

  return eventId;
}

interface AuditRow {
  event_id: string;
  user_id: number | null;
  action: AuditAction;
  entity_type: string;
  entity_id: string | null;
  old_data_json: string | null;
  new_data_json: string | null;
  created_at: string;
}

function parseJson(value: string | null): unknown {
  if (value === null) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function listAudit(
  db: Db,
  options: { entityType?: string; entityId?: string; action?: AuditAction; limit?: number } = {},
): AuditRecord[] {
  const where: string[] = [];
  const params: unknown[] = [];

  if (options.entityType !== undefined) {
    where.push('entity_type = ?');
    params.push(options.entityType);
  }
  if (options.entityId !== undefined) {
    where.push('entity_id = ?');
    params.push(options.entityId);
  }
  if (options.action !== undefined) {
    where.push('action = ?');
    params.push(options.action);
  }

  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT event_id, user_id, action, entity_type, entity_id, old_data_json, new_data_json, created_at
         FROM audit_log ${clause} ORDER BY id DESC LIMIT ?`,
    )
    .all(...params, Math.min(options.limit ?? 100, 500)) as AuditRow[];

  return rows.map((row) => ({
    eventId: row.event_id,
    userId: row.user_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    oldData: parseJson(row.old_data_json),
    newData: parseJson(row.new_data_json),
    createdAt: row.created_at,
  }));
}
