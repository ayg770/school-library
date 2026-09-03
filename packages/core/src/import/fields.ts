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
 * Proposes a column for each field by matching the file's own headers.
 *
 * Exact alias matches are taken first across all fields, so a file with both
 * "ברקוד כרטיס" and "ברקוד" cannot have the more specific header stolen by a
 * loose contains-match on the other.
 */
export function suggestMapping(
  headers: readonly string[],
  importType: ImportType,
): Record<string, number> {
  const fields = IMPORT_FIELDS[importType];
  const normalised = headers.map(normaliseHeader);
  const mapping: Record<string, number> = {};
  const taken = new Set<number>();

  for (const pass of ['exact', 'contains'] as const) {
    for (const field of fields) {
      if (mapping[field.key] !== undefined) continue;

      const index = normalised.findIndex((header, position) => {
        if (taken.has(position)) return false;
        return field.aliases.some((alias) => {
          const target = normaliseHeader(alias);
          return pass === 'exact' ? header === target : header.includes(target);
        });
      });

      if (index !== -1) {
        mapping[field.key] = index;
        taken.add(index);
      }
    }
  }

  return mapping;
}
