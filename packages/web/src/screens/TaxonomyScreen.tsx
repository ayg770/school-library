import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabase.js';

interface Row {
  public_id: string;
  name: string;
  active: boolean;
  count: number;
}

type Kind = 'categories' | 'shelf_locations';

const LABEL: Record<Kind, { title: string; one: string; many: string; holds: string }> = {
  categories: { title: 'קטגוריות', one: 'קטגוריה', many: 'קטגוריות', holds: 'ספרים' },
  shelf_locations: { title: 'מיקומי מדף', one: 'מדף', many: 'מדפים', holds: 'עותקים' },
};

/**
 * Categories and shelves.
 *
 * Named by the library as something they want to decide from the office: which
 * subjects exist, and what they are called. Both lists are small, rarely
 * changed, and referenced by everything else — so the screen shows how many
 * books or copies each one holds, because renaming a category that four
 * hundred books point at is a different act from renaming an empty one.
 */
export function TaxonomyScreen({ kind }: { kind: Kind }): JSX.Element {
  const labels = LABEL[kind];
  const [rows, setRows] = useState<Row[]>([]);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<Row | null>(null);
  const [renameTo, setRenameTo] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      // The count comes from the side that points here, which is why the two
      // kinds ask different questions of different tables.
      const select =
        kind === 'categories'
          ? 'public_id, name, active, books(count)'
          : 'public_id, name, active, book_copies(count)';

      const { data, error } = await supabase.from(kind).select(select).order('name');
      if (error !== null) throw error;

      const mapped = (data ?? []).map((row) => {
        const record = row as unknown as Record<string, unknown>;
        const children = (record[kind === 'categories' ? 'books' : 'book_copies'] ??
          []) as { count: number }[];
        return {
          public_id: String(record.public_id),
          name: String(record.name),
          active: Boolean(record.active),
          count: children[0]?.count ?? 0,
        };
      });

      setRows(mapped);
      setProblem(null);
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : 'הטעינה נכשלה');
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    void load();
    setRenaming(null);
    setNewName('');
    setNotice(null);
  }, [load]);

  async function add(): Promise<void> {
    const name = newName.trim();
    if (name === '') return;
    try {
      const { error } = await supabase.from(kind).insert({ name });
      if (error !== null) throw error;
      setNewName('');
      setNotice(`נוספה ${labels.one}: ${name}`);
      await load();
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : 'ההוספה נכשלה');
    }
  }

  async function rename(): Promise<void> {
    if (renaming === null) return;
    const name = renameTo.trim();
    if (name === '') return;
    try {
      const { error } = await supabase
        .from(kind)
        .update({ name })
        .eq('public_id', renaming.public_id);
      if (error !== null) throw error;
      setNotice(`השם שונה ל"${name}"`);
      setRenaming(null);
      await load();
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : 'השינוי נכשל');
    }
  }

  /**
   * Retiring, not deleting.
   *
   * Books already point at this row, and removing it would either fail or
   * orphan them. Marking it inactive takes it out of every list a librarian
   * picks from, and leaves the books that already carry it alone.
   */
  async function setActive(row: Row, active: boolean): Promise<void> {
    try {
      const { error } = await supabase.from(kind).update({ active }).eq('public_id', row.public_id);
      if (error !== null) throw error;
      setNotice(active ? `${row.name} הוחזרה לשימוש` : `${row.name} הוצאה משימוש`);
      await load();
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : 'הפעולה נכשלה');
    }
  }

  return (
    <>
      <div className="page-head">
        <h2>{labels.title}</h2>
        <p>שינוי כאן מגיע לספרייה בסנכרון הבא.</p>
      </div>

      {problem !== null && (
        <div className="notice notice-error" role="alert">
          {problem}
        </div>
      )}
      {notice !== null && (
        <div className="notice notice-ok" role="status">
          {notice}
        </div>
      )}

      <section className="card">
        <div className="card-header">
          <h2>הוספה</h2>
        </div>
        <div className="toolbar">
          <div className="grow">
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void add();
              }}
              placeholder={`שם ${labels.one} חדשה`}
              aria-label={`שם ${labels.one} חדשה`}
            />
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void add()}
            disabled={newName.trim() === ''}
          >
            הוסף
          </button>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h2>{labels.many} קיימות</h2>
          <span className="count">{rows.length}</span>
        </div>

        {loading ? (
          <p className="empty">טוען…</p>
        ) : rows.length === 0 ? (
          <p className="empty">עדיין אין {labels.many}.</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>שם</th>
                  <th>{labels.holds}</th>
                  <th>מצב</th>
                  <th className="row-actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.public_id} className={row.active ? '' : 'is-inactive'}>
                    <td>
                      {renaming?.public_id === row.public_id ? (
                        <input
                          value={renameTo}
                          onChange={(event) => setRenameTo(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') void rename();
                            if (event.key === 'Escape') setRenaming(null);
                          }}
                          aria-label="שם חדש"
                          autoFocus
                        />
                      ) : (
                        row.name
                      )}
                    </td>
                    <td>{row.count}</td>
                    <td>
                      {row.active ? (
                        <span className="status status-ok">בשימוש</span>
                      ) : (
                        <span className="status status-neutral">לא בשימוש</span>
                      )}
                    </td>
                    <td className="row-actions">
                      {renaming?.public_id === row.public_id ? (
                        <>
                          <button type="button" className="btn-link" onClick={() => void rename()}>
                            שמור
                          </button>
                          <button type="button" className="btn-link" onClick={() => setRenaming(null)}>
                            בטל
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="btn-link"
                            onClick={() => {
                              setRenaming(row);
                              setRenameTo(row.name);
                            }}
                          >
                            שנה שם
                          </button>
                          <button
                            type="button"
                            className="btn-link"
                            onClick={() => void setActive(row, !row.active)}
                          >
                            {row.active ? 'הוצא משימוש' : 'החזר'}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
