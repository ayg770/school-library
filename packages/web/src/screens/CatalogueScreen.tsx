import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabase.js';

interface BookRow {
  public_id: string;
  title: string;
  author_text: string | null;
  publisher: string | null;
  active: boolean;
  categories: { name: string } | null;
  book_copies: { count: number }[];
}

interface CategoryRow {
  public_id: string;
  name: string;
}

const PAGE_SIZE = 50;

/**
 * The catalogue, from the office.
 *
 * This is the half the library asked to be able to reach without going to the
 * library: renaming a book, moving it to another category, correcting an
 * author. It writes straight to Supabase, which is where the catalogue now
 * lives, so a correction made here is the correction — not a request.
 */
export function CatalogueScreen(): JSX.Element {
  const [books, setBooks] = useState<BookRow[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const [editing, setEditing] = useState<BookRow | null>(null);
  const [form, setForm] = useState({ title: '', author_text: '', category_id: '' });

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      let query = supabase
        .from('books')
        .select(
          'public_id, title, author_text, publisher, active, categories(name), book_copies(count)',
          { count: 'exact' },
        )
        .order('title')
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      if (search.trim() !== '') {
        // Postgres pattern matching, escaped: a title containing a comma would
        // otherwise be read as the end of one filter and the start of another.
        const term = search.trim().replace(/[,()]/g, ' ');
        query = query.or(`title.ilike.%${term}%,author_text.ilike.%${term}%`);
      }
      if (categoryFilter !== '') query = query.eq('category_id', categoryFilter);

      const { data, count, error } = await query;
      if (error !== null) throw error;

      setBooks((data ?? []) as unknown as BookRow[]);
      setTotal(count ?? 0);
      setProblem(null);
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : 'טעינת הקטלוג נכשלה');
    } finally {
      setLoading(false);
    }
  }, [search, categoryFilter, page]);

  useEffect(() => {
    void supabase
      .from('categories')
      .select('public_id, name')
      .eq('active', true)
      .order('name')
      .then(({ data }) => setCategories((data ?? []) as CategoryRow[]));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  // A new search starts from the first page; staying on page 7 of a result
  // that now has two pages shows an empty screen and looks like a failure.
  useEffect(() => setPage(0), [search, categoryFilter]);

  function startEdit(book: BookRow): void {
    setEditing(book);
    setSaved(null);
    setForm({
      title: book.title,
      author_text: book.author_text ?? '',
      category_id: '',
    });
  }

  async function save(): Promise<void> {
    if (editing === null) return;
    try {
      const { error } = await supabase
        .from('books')
        .update({
          title: form.title.trim(),
          author_text: form.author_text.trim() === '' ? null : form.author_text.trim(),
          ...(form.category_id === '' ? {} : { category_id: form.category_id }),
        })
        .eq('public_id', editing.public_id);

      if (error !== null) throw error;

      setSaved(`נשמר: ${form.title.trim()}`);
      setEditing(null);
      await load();
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : 'השמירה נכשלה');
    }
  }

  const pages = Math.ceil(total / PAGE_SIZE);

  return (
    <>
      <div className="page-head">
        <h2>קטלוג</h2>
        <p>שינוי כאן נשמר ישר למסד הנתונים, ומגיע לספרייה בסנכרון הבא.</p>
      </div>

      {problem !== null && (
        <div className="notice notice-error" role="alert">
          {problem}
        </div>
      )}
      {saved !== null && (
        <div className="notice notice-ok" role="status">
          {saved}
        </div>
      )}

      {editing !== null && (
        <section className="card">
          <div className="card-header">
            <h2>עריכת ספר</h2>
            <button type="button" className="btn-link" onClick={() => setEditing(null)}>
              בטל
            </button>
          </div>

          <div className="field">
            <label htmlFor="edit-title">שם הספר</label>
            <input
              id="edit-title"
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
            />
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="edit-author">מחבר</label>
              <input
                id="edit-author"
                value={form.author_text}
                onChange={(event) => setForm({ ...form, author_text: event.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="edit-category">קטגוריה</label>
              <select
                id="edit-category"
                value={form.category_id}
                onChange={(event) => setForm({ ...form, category_id: event.target.value })}
              >
                <option value="">— השאר כפי שהיא —</option>
                {categories.map((category) => (
                  <option key={category.public_id} value={category.public_id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void save()}
              disabled={form.title.trim() === ''}
            >
              שמור
            </button>
          </div>
        </section>
      )}

      <section className="card">
        <div className="toolbar">
          <div className="grow">
            <input
              type="search"
              placeholder="חיפוש לפי שם או מחבר"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="חיפוש ספרים"
            />
          </div>
          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            aria-label="סינון לפי קטגוריה"
          >
            <option value="">כל הקטגוריות</option>
            {categories.map((category) => (
              <option key={category.public_id} value={category.public_id}>
                {category.name}
              </option>
            ))}
          </select>
          <span className="count">
            {total} ספרים
            {pages > 1 && <span className="muted"> · עמוד {page + 1} מתוך {pages}</span>}
          </span>
        </div>

        {loading ? (
          <p className="empty">טוען…</p>
        ) : books.length === 0 ? (
          <p className="empty">
            {total === 0 && search === '' && categoryFilter === ''
              ? 'הקטלוג ריק. הוא יתמלא כשהתוכנה בספרייה תסנכרן, או מייבוא.'
              : 'אין ספרים שמתאימים לחיפוש.'}
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>שם הספר</th>
                  <th>מחבר</th>
                  <th>קטגוריה</th>
                  <th>עותקים</th>
                  <th className="row-actions" />
                </tr>
              </thead>
              <tbody>
                {books.map((book) => (
                  <tr key={book.public_id} className={book.active ? '' : 'is-inactive'}>
                    <td>{book.title}</td>
                    <td>{book.author_text ?? '—'}</td>
                    <td>{book.categories?.name ?? '—'}</td>
                    <td>{book.book_copies[0]?.count ?? 0}</td>
                    <td className="row-actions">
                      <button type="button" className="btn-link" onClick={() => startEdit(book)}>
                        ערוך
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <div className="form-actions">
            <button
              type="button"
              className="btn"
              onClick={() => setPage((n) => Math.max(0, n - 1))}
              disabled={page === 0}
            >
              הקודם
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setPage((n) => Math.min(pages - 1, n + 1))}
              disabled={page >= pages - 1}
            >
              הבא
            </button>
          </div>
        )}
      </section>
    </>
  );
}
