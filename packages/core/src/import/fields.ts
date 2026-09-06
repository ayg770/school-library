export type ImportType = 'students' | 'books';

export interface TargetField {
  readonly key: string;
  readonly label: string;
  readonly required: boolean;
  readonly hint?: string;
  /** Header texts that map to this field without the user choosing. */
  readonly aliases: readonly string[];
}

/**
 * What a file can be mapped onto (§13).
 *
 * Aliases carry the Hebrew a school's own export actually uses, so the common
 * case needs no mapping at all — the wizard proposes it and the librarian
 * confirms. Anything unrecognised is simply left for them to map by hand.
 */
export const IMPORT_FIELDS: Record<ImportType, readonly TargetField[]> = {
  students: [
    {
      key: 'firstName',
      label: 'שם פרטי',
      required: true,
      aliases: ['שם פרטי', 'שם', 'פרטי', 'first name', 'firstname', 'first'],
    },
    {
      key: 'lastName',
      label: 'שם משפחה',
      required: true,
      aliases: ['שם משפחה', 'משפחה', 'last name', 'lastname', 'surname', 'family name'],
    },
    {
      key: 'className',
      label: 'כיתה',
      required: false,
      hint: 'כיתה שאינה קיימת תיווצר אוטומטית',
      aliases: ['כיתה', 'הכיתה', 'class', 'classroom', 'grade'],
    },
    {
      key: 'localBarcode',
      label: 'ברקוד כרטיס',
      required: false,
      hint: 'נשמר בדיוק כפי שהוא בקובץ',
      aliases: ['ברקוד', 'ברקוד כרטיס', 'מספר כרטיס', 'barcode', 'card'],
    },
    { key: 'notes', label: 'הערות', required: false, aliases: ['הערות', 'הערה', 'notes', 'note'] },
  ],
  books: [
    {
      key: 'title',
      label: 'שם הספר',
      required: true,
      aliases: ['שם הספר', 'שם ספר', 'כותרת', 'ספר', 'title', 'book', 'book title'],
    },
    {
      key: 'authorText',
      label: 'מחבר',
      required: false,
      aliases: ['מחבר', 'סופר', 'author', 'writer'],
    },
    {
      key: 'barcode',
      label: 'ברקוד העותק',
      required: false,
      hint: 'שורה עם ברקוד יוצרת עותק פיזי. נשמר בדיוק כפי שהוא בקובץ',
      aliases: ['ברקוד', 'ברקוד ספר', 'ברקוד עותק', 'מספר עותק', 'barcode', 'copy barcode'],
    },
    {
      key: 'isbn13',
      label: 'מסת"ב',
      required: false,
      aliases: ['מסתב', 'מסת"ב', 'isbn', 'isbn13', 'isbn-13'],
    },
    {
      key: 'publisher',
      label: 'הוצאה',
      required: false,
      aliases: ['הוצאה', 'הוצאת', 'מוציא לאור', 'publisher'],
    },
    {
      key: 'publicationYear',
      label: 'שנת הוצאה',
      required: false,
      aliases: ['שנה', 'שנת הוצאה', 'year', 'publication year'],
    },
    {
      key: 'categoryName',
      label: 'קטגוריה',
      required: false,
      hint: 'קטגוריה שאינה קיימת תיווצר אוטומטית',
      aliases: ['קטגוריה', 'נושא', 'סוגה', 'ז\'אנר', 'category', 'genre', 'subject'],
    },
    {
      key: 'shelfName',
      label: 'מיקום מדף',
      required: false,
      hint: 'מיקום שאינו קיים ייווצר אוטומטית',
      aliases: ['מדף', 'מיקום', 'מיקום מדף', 'shelf', 'location'],
    },
    {
      key: 'accessionNumber',
      label: 'מספר קטלוגי',
      required: false,
      aliases: ['מספר קטלוגי', 'מספר רשומה', 'accession', 'accession number'],
    },
    {
      key: 'legacyId',
      label: 'מזהה מהמערכת הישנה',
      required: false,
      aliases: ['מזהה ישן', 'מספר ישן', 'legacy', 'legacy id', 'old id'],
    },
  ],
};

function normaliseHeader(text: string): string {
  return text.trim().toLowerCase().replace(/["'׳״]/g, '').replace(/\s+/g, ' ');
}

/**
 * How well an alias matches a header, or null when it does not.
 *
 * The share of the header the alias accounts for. A real export names a column
 * `TI_TITLE` beside a record number called `IN_TITLE_no`, and both contain
 * "title" — but the first is almost entirely the word and the second is mostly
 * something else, so the first is the better guess.
 */
function matchStrength(header: string, alias: string): number | null {
  if (!header.includes(alias) || alias.length === 0) return null;
  return alias.length / header.length;
}

/**
 * Proposes a column for each field by matching the file's own headers.
 *
 * Exact alias matches are taken first across all fields, so a file with both
 * "ברקוד כרטיס" and "ברקוד" cannot have the more specific header stolen by a
 * loose contains-match on the other.
 *
 * A partial match then takes the *closest* header rather than the first one in
 * the file. Taking the first meant a column order the school did not choose
 * decided which column became the book's title — and a catalogue imported with
 * record numbers for titles is a catalogue that has to be thrown away and done
 * again. The librarian confirms the proposal either way (§13); this is about
 * proposing the right thing to confirm.
 */
export function suggestMapping(
  headers: readonly string[],
  importType: ImportType,
): Record<string, number> {
  const fields = IMPORT_FIELDS[importType];
  const normalised = headers.map(normaliseHeader);
  const mapping: Record<string, number> = {};
  const taken = new Set<number>();

  for (const field of fields) {
    const index = normalised.findIndex(
      (header, position) =>
        !taken.has(position) && field.aliases.some((alias) => header === normaliseHeader(alias)),
    );
    if (index !== -1) {
      mapping[field.key] = index;
      taken.add(index);
    }
  }

  for (const field of fields) {
    if (mapping[field.key] !== undefined) continue;

    let best: { index: number; strength: number } | null = null;

    normalised.forEach((header, position) => {
      if (taken.has(position)) return;
      for (const alias of field.aliases) {
        const strength = matchStrength(header, normaliseHeader(alias));
        if (strength === null) continue;
        // Strictly greater, so an equally good match earlier in the file wins
        // and the proposal stays stable for a given file.
        if (best === null || strength > best.strength) best = { index: position, strength };
      }
    });

    if (best !== null) {
      const chosen: { index: number; strength: number } = best;
      mapping[field.key] = chosen.index;
      taken.add(chosen.index);
    }
  }

  return mapping;
}
