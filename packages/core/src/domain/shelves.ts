import type { Db } from '../db/open.js';
import { newPublicId } from '../ids.js';
import { fromDbBool, nowIso, optionalText, requireText, toDbBool } from './common.js';
import { notFound } from './errors.js';

export interface ShelfLocation {
  readonly publicId: string;
  readonly name: string;
  readonly room: string | null;
  readonly shelfCode: string | null;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateShelfInput {
  readonly name: unknown;
  readonly room?: unknown;
  readonly shelfCode?: unknown;
}

export interface UpdateShelfInput extends Partial<CreateShelfInput> {
  readonly active?: boolean;
}

interface ShelfRow {
  public_id: string;
  name: string;
  room: string | null;
  shelf_code: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

const COLUMNS = 'public_id, name, room, shelf_code, active, created_at, updated_at';

function map(row: ShelfRow): ShelfLocation {
  return {
    publicId: row.public_id,
    name: row.name,
    room: row.room,
    shelfCode: row.shelf_code,
    active: fromDbBool(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createShelf(db: Db, input: CreateShelfInput): ShelfLocation {
  const name = requireText(input.name, 'name', 'שם המיקום', 120);
  const room = optionalText(input.room, 'room', 'חדר', 120);
  const shelfCode = optionalText(input.shelfCode, 'shelfCode', 'קוד מדף', 60);

  const publicId = newPublicId();
  const timestamp = nowIso();

  db.prepare(
    'INSERT INTO shelf_locations (public_id, name, room, shelf_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(publicId, name, room, shelfCode, timestamp, timestamp);

  return getShelf(db, publicId);
}

export function getShelf(db: Db, publicId: string): ShelfLocation {
  const row = db.prepare(`SELECT ${COLUMNS} FROM shelf_locations WHERE public_id = ?`).get(publicId) as
    | ShelfRow
    | undefined;
  if (row === undefined) throw notFound('מיקום המדף');
  return map(row);
}

export function updateShelf(db: Db, publicId: string, input: UpdateShelfInput): ShelfLocation {
  const current = getShelf(db, publicId);

  const name = input.name === undefined ? current.name : requireText(input.name, 'name', 'שם המיקום', 120);
  const room = input.room === undefined ? current.room : optionalText(input.room, 'room', 'חדר', 120);
  const shelfCode =
    input.shelfCode === undefined ? current.shelfCode : optionalText(input.shelfCode, 'shelfCode', 'קוד מדף', 60);
  const active = input.active ?? current.active;

  db.prepare(
    'UPDATE shelf_locations SET name = ?, room = ?, shelf_code = ?, active = ?, updated_at = ? WHERE public_id = ?',
  ).run(name, room, shelfCode, toDbBool(active), nowIso(), publicId);

  return getShelf(db, publicId);
}

export function listShelves(db: Db, options: { active?: boolean } = {}): ShelfLocation[] {
  const clause = options.active === undefined ? '' : 'WHERE active = ?';
  const params = options.active === undefined ? [] : [toDbBool(options.active)];
  const rows = db.prepare(`SELECT ${COLUMNS} FROM shelf_locations ${clause} ORDER BY name`).all(
    ...params,
  ) as ShelfRow[];
  return rows.map(map);
}
