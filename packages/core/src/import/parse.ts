import { parse as parseCsv } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import iconv from 'iconv-lite';
import { DomainError } from '../domain/errors.js';

/** A sheet reduced to a header row and the rows beneath it. */
export interface ParsedSheet {
  readonly headers: string[];
  /** Cell values as text. Everything is text so a barcode cannot become a number. */
  readonly rows: string[][];
}

export type SourceFormat = 'csv' | 'xlsx';

export function detectFormat(filename: string): SourceFormat {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) return 'xlsx';
  if (lower.endsWith('.csv') || lower.endsWith('.tsv') || lower.endsWith('.txt')) return 'csv';

  throw new DomainError(
    'VALIDATION',
    'סוג הקובץ אינו נתמך. יש להעלות קובץ Excel ‏(xlsx) או CSV.',
    'file',
  );
}

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/**
 * Decodes a CSV file's bytes to text.
 *
 * Excel on a Hebrew Windows saves CSV as windows-1255, not UTF-8, and reading
 * those bytes as UTF-8 turns every Hebrew name into replacement characters.
 * A UTF-8 BOM is taken at its word; otherwise the bytes are decoded strictly
 * as UTF-8 and, if that fails, as windows-1255.
 */
export function decodeText(buffer: Buffer): { text: string; encoding: 'utf-8' | 'windows-1255' } {
  if (buffer.subarray(0, 3).equals(UTF8_BOM)) {
    return { text: buffer.subarray(3).toString('utf8'), encoding: 'utf-8' };
  }

  const asUtf8 = buffer.toString('utf8');
  // A replacement character means the bytes were not valid UTF-8.
  if (!asUtf8.includes('�')) return { text: asUtf8, encoding: 'utf-8' };

  return { text: iconv.decode(buffer, 'windows-1255'), encoding: 'windows-1255' };
}

function normaliseRows(records: string[][]): ParsedSheet {
  const headerRow = records[0];
  if (headerRow === undefined) {
    throw new DomainError('VALIDATION', 'הקובץ ריק.', 'file');
  }

  const headers = headerRow.map((value, index) => {
    const text = String(value ?? '').trim();
    return text === '' ? `עמודה ${index + 1}` : text;
  });

  const rows = records.slice(1).map((record) => {
    const row = headers.map((_, index) => String(record[index] ?? '').trim());
    return row;
  });

  return { headers, rows };
}

export function parseCsvBuffer(buffer: Buffer): ParsedSheet & { encoding: string } {
  const { text, encoding } = decodeText(buffer);
  const delimiter = text.includes('\t') && !text.includes(',') ? '\t' : ',';

  let records: string[][];
  try {
    records = parseCsv(text, {
      delimiter,
      relax_column_count: true,
      skip_empty_lines: false,
      // Never cast: a barcode of "0000123" must not become the number 123.
      cast: false,
      bom: true,
    }) as string[][];
  } catch (cause) {
    throw new DomainError(
      'VALIDATION',
      `לא ניתן לקרוא את הקובץ: ${cause instanceof Error ? cause.message : 'שגיאה'}`,
      'file',
    );
  }

  return { ...normaliseRows(records), encoding };
}

/** Reads a cell as the text a person would see, never as a number. */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);

  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text;
    if ('result' in value) return cellText(value.result as ExcelJS.CellValue);
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('');
    }
    if ('hyperlink' in value && 'text' in value) return String(value.text ?? '');
  }

  return String(value);
}

export async function parseXlsxBuffer(buffer: Buffer): Promise<ParsedSheet> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch (cause) {
    throw new DomainError(
      'VALIDATION',
      `לא ניתן לקרוא את קובץ ה-Excel: ${cause instanceof Error ? cause.message : 'שגיאה'}`,
      'file',
    );
  }

  const sheet = workbook.worksheets[0];
  if (sheet === undefined) {
    throw new DomainError('VALIDATION', 'קובץ ה-Excel אינו מכיל גיליונות.', 'file');
  }

  const records: string[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    const values: string[] = [];
    // `values` is 1-based in exceljs; index 0 is always empty.
    const raw = row.values as ExcelJS.CellValue[];
    for (let index = 1; index < raw.length; index += 1) {
      values.push(cellText(raw[index] ?? null));
    }
    records.push(values);
  });

  return normaliseRows(records);
}

export async function parseFile(
  filename: string,
  buffer: Buffer,
): Promise<ParsedSheet & { format: SourceFormat; encoding?: string }> {
  const format = detectFormat(filename);

  if (format === 'csv') {
    const parsed = parseCsvBuffer(buffer);
    return { ...parsed, format };
  }
  return { ...(await parseXlsxBuffer(buffer)), format };
}
