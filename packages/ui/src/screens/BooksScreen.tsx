import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  CONDITION_LABELS,
  api,
  formatDate,
  plural,
  type Book,
  type BookDetail,
  type CatalogueBreakdown,
  type Category,
  type ShelfLocation,
} from '../api.js';
import { Field } from '../components/Field.js';
import { Notice } from '../components/Notice.js';

interface BookForm {
  title: string;
  authorText: string;
  publisher: string;
  publicationYear: string;
  isbn13: string;
  categoryPublicId: string;
  notes: string;
  active: boolean;
}

const EMPTY_BOOK: BookForm = {
  title: '',
  authorText: '',
  publisher: '',
  publicationYear: '',
  isbn13: '',
  categoryPublicId: '',
  notes: '',
  active: true,
};

interface CopyForm {
  barcode: string;
  shelfPublicId: string;
  conditionNote: string;
}

const EMPTY_COPY: CopyForm = { barcode: '', shelfPublicId: '', conditionNote: '' };

export function BooksScreen(): JSX.Element {
  const [books, setBooks] = useState<Book[]>([]);
  const [searchText, setSearchText] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [shelfFilter, setShelfFilter] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [shelves, setShelves] = useState<ShelfLocation[]>([]);
  const [breakdown, setBreakdown] = useState<CatalogueBreakdown | null>(null);
  const [browsing, setBrowsing] = useState(false);

  const [selected, setSelected] = useState<BookDetail | null>(null);
  const [editing, setEditing] = useState<Book | 'new' | null>(null);
  const [bookForm, setBookForm] = useState<BookForm>(EMPTY_BOOK);
  const [copyForm, setCopyForm] = useState<CopyForm>(EMPTY_COPY);

  const [error, setError] = useState<string | null>(null);
  const [bookFieldError, setBookFieldError] = useState<string | undefined>(undefined);
  const [copyFieldError, setCopyFieldError] = useState<string | undefined>(undefined);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      setBooks(
        (
          await api.listBooks({
            query: searchText,
            categoryPublicId: categoryFilter,
            shelfPublicId: shelfFilter,
          })
        ).items,
      );
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'טעינת הספרים נכשלה');
    }
  }, [searchText, categoryFilter, shelfFilter]);

  const loadBreakdown = useCallback(async (): Promise<void> => {
    try {
      setBreakdown(await api.catalogueBreakdown());
    } catch {
      setBreakdown(null);
    }
  }, []);

  useEffect(() => {
    void api.listCategories().then((result) => setCategories(result.items)).catch(() => setCategories([]));
    void api.listShelves().then((result) => setShelves(result.items)).catch(() => setShelves([]));
    void loadBreakdown();
  }, [loadBreakdown]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 200);
    return () => window.clearTimeout(timer);
  }, [load]);

  /**
   * Loads a book into the detail panel.
   *
   * It deliberately leaves any notice alone: it is called both when the
   * librarian opens a book and when a save re-reads it, and clearing here
   * wiped the "saved" confirmation the moment it was set.
   */
  async function loadBook(publicId: string): Promise<void> {
    try {
      setSelected(await api.getBook(publicId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'טעינת הספר נכשלה');
    }
  }

  /** Opening a book from the list is a fresh start: clear what came before. */
  async function openBook(publicId: string): Promise<void> {
    setMessage(null);
    setError(null);
    setCopyFieldError(undefined);
    setCopyForm(EMPTY_COPY);
    await loadBook(publicId);
  }

  function startCreate(): void {
    setEditing('new');
    setBookForm(EMPTY_BOOK);
    setBookFieldError(undefined);
    setMessage(null);
  }

  function startEdit(book: BookDetail): void {
    setEditing(book);
    setBookForm({
      title: book.title,
      authorText: book.authorText ?? '',
      publisher: book.publisher ?? '',
      publicationYear: book.publicationYear ?? '',
      isbn13: book.isbn13 ?? '',
      categoryPublicId: book.categoryPublicId ?? '',
      notes: book.notes ?? '',
      active: book.active,
    });
    setBookFieldError(undefined);
    setMessage(null);
  }

  async function saveBook(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (editing === null) return;

    setSaving(true);
    setBookFieldError(undefined);

    const payload = {
      title: bookForm.title,
      authorText: bookForm.authorText === '' ? null : bookForm.authorText,
      publisher: bookForm.publisher === '' ? null : bookForm.publisher,
      publicationYear: bookForm.publicationYear === '' ? null : bookForm.publicationYear,
      isbn13: bookForm.isbn13 === '' ? null : bookForm.isbn13,
      categoryPublicId: bookForm.categoryPublicId === '' ? null : bookForm.categoryPublicId,
      notes: bookForm.notes === '' ? null : bookForm.notes,
      active: bookForm.active,
    };

    try {
      const saved = editing === 'new' ? await api.createBook(payload) : await api.updateBook(editing.publicId, payload);
      setEditing(null);
      setMessage(editing === 'new' ? 'הספר נוסף.' : 'הספר עודכן.');
      await load();
      await loadBook(saved.publicId);
    } catch (cause) {
      if (cause instanceof ApiError) setBookFieldError(cause.message);
      else setError('השמירה נכשלה. נסה שוב.');
    } finally {
      setSaving(false);
    }
  }

  async function addCopy(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (selected === null) return;

    setSaving(true);
    setCopyFieldError(undefined);

    try {
      await api.createCopy({
        bookPublicId: selected.publicId,
        barcode: copyForm.barcode,
        shelfPublicId: copyForm.shelfPublicId === '' ? null : copyForm.shelfPublicId,
        conditionNote: copyForm.conditionNote === '' ? null : copyForm.conditionNote,
      });
      setCopyForm(EMPTY_COPY);
      setMessage('העותק נוסף.');
      await loadBook(selected.publicId);
      await load();
    } catch (cause) {
      if (cause instanceof ApiError) setCopyFieldError(cause.message);
      else setError('הוספת העותק נכשלה. נסה שוב.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {error !== null && <Notice kind="error">{error}</Notice>}
      {message !== null && <Notice kind="ok">{message}</Notice>}

      {editing !== null && (
        <section className="card">
          <h2>{editing === 'new' ? 'ספר חדש' : 'עריכת ספר'}</h2>
          <form onSubmit={(event) => void saveBook(event)}>
            <Field label="שם הספר" htmlFor="title" error={bookFieldError}>
              <input
                id="title"
                type="text"
                value={bookForm.title}
                onChange={(event) => setBookForm({ ...bookForm, title: event.target.value })}
                autoFocus
              />
            </Field>

            <div className="field-row">
              <Field label="מחבר" htmlFor="authorText">
                <input
                  id="authorText"
                  type="text"
                  value={bookForm.authorText}
                  onChange={(event) => setBookForm({ ...bookForm, authorText: event.target.value })}
                />
              </Field>
              <Field label="הוצאה" htmlFor="publisher">
                <input
                  id="publisher"
                  type="text"
                  value={bookForm.publisher}
                  onChange={(event) => setBookForm({ ...bookForm, publisher: event.target.value })}
                />
              </Field>
            </div>

            <div className="field-row">
              <Field label="שנת הוצאה" htmlFor="publicationYear">
                <input
                  id="publicationYear"
                  type="text"
                  value={bookForm.publicationYear}
                  onChange={(event) => setBookForm({ ...bookForm, publicationYear: event.target.value })}
                />
              </Field>
              <Field label='מסת"ב (ISBN-13)' htmlFor="isbn13">
                <input
                  id="isbn13"
                  type="text"
                  value={bookForm.isbn13}
                  onChange={(event) => setBookForm({ ...bookForm, isbn13: event.target.value })}
                  dir="ltr"
                />
              </Field>
              <Field label="קטגוריה" htmlFor="categoryPublicId">
                <select
                  id="categoryPublicId"
                  value={bookForm.categoryPublicId}
                  onChange={(event) => setBookForm({ ...bookForm, categoryPublicId: event.target.value })}
                >
                  <option value="">ללא קטגוריה</option>
                  {categories.map((category) => (
                    <option key={category.publicId} value={category.publicId}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="הערות" htmlFor="bookNotes">
              <textarea
                id="bookNotes"
                value={bookForm.notes}
                onChange={(event) => setBookForm({ ...bookForm, notes: event.target.value })}
              />
            </Field>

            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={bookForm.active}
                onChange={(event) => setBookForm({ ...bookForm, active: event.target.checked })}
              />
              ספר פעיל בקטלוג
            </label>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'שומר…' : 'שמור'}
              </button>
              <button type="button" className="btn" onClick={() => setEditing(null)} disabled={saving}>
                ביטול
              </button>
            </div>
          </form>
        </section>
      )}

      {selected !== null && (
        <section className="card">
          <div className="card-header">
            <h2>{selected.title}</h2>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" className="btn" onClick={() => startEdit(selected)}>
                עריכת פרטי הספר
              </button>
              <button type="button" className="btn" onClick={() => setSelected(null)}>
                סגור
              </button>
            </div>
          </div>

          <dl className="info-grid">
            <dt>מחבר</dt>
            <dd>{selected.authorText ?? '—'}</dd>
            <dt>קטגוריה</dt>
            <dd>{selected.categoryName ?? '—'}</dd>
            <dt>מסת"ב</dt>
            <dd className="value-ltr">{selected.isbn13 ?? selected.isbn10 ?? '—'}</dd>
            <dt>עותקים</dt>
            <dd>{selected.copyCount}</dd>
          </dl>

          <h2 style={{ marginTop: '1.5rem' }}>עותקים פיזיים</h2>
          <p className="hint">
            לכל עותק ברקוד משלו. הברקוד נשמר בדיוק כפי שהוזן — אפסים מובילים נשמרים.
          </p>

          {selected.copies.length === 0 ? (
            <p className="empty">אין עדיין עותקים לספר הזה.</p>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>ברקוד</th>
                    <th>מיקום</th>
                    <th>מצב</th>
                    <th>מושאל ל</th>
                    <th>להחזרה עד</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.copies.map((copy) => (
                    <tr key={copy.publicId} className={copy.active ? '' : 'is-inactive'}>
                      <td className="value-ltr">{copy.barcode}</td>
                      <td>{copy.shelfName ?? '—'}</td>
                      <td>{CONDITION_LABELS[copy.conditionStatus]}</td>
                      <td>
                        {copy.onLoan ? (
                          copy.borrowerName
                        ) : (
                          <span className="status status-ok">על המדף</span>
                        )}
                      </td>
                      <td className={copy.overdue ? 'overdue-text' : ''}>
                        {copy.onLoan ? formatDate(copy.dueAt) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <form onSubmit={(event) => void addCopy(event)} style={{ marginTop: '1.25rem' }}>
            <div className="field-row">
              <Field label="ברקוד העותק" htmlFor="copyBarcode" error={copyFieldError}>
                <input
                  id="copyBarcode"
                  type="text"
                  value={copyForm.barcode}
                  onChange={(event) => setCopyForm({ ...copyForm, barcode: event.target.value })}
                  dir="ltr"
                />
              </Field>
              <Field label="מיקום מדף" htmlFor="copyShelf">
                <select
                  id="copyShelf"
                  value={copyForm.shelfPublicId}
                  onChange={(event) => setCopyForm({ ...copyForm, shelfPublicId: event.target.value })}
                >
                  <option value="">ללא מיקום</option>
                  {shelves.map((shelf) => (
                    <option key={shelf.publicId} value={shelf.publicId}>
                      {shelf.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="הערת מצב" htmlFor="copyNote">
                <input
                  id="copyNote"
                  type="text"
                  value={copyForm.conditionNote}
                  onChange={(event) => setCopyForm({ ...copyForm, conditionNote: event.target.value })}
                />
              </Field>
            </div>
            <button type="submit" className="btn btn-primary" disabled={saving || copyForm.barcode === ''}>
              הוסף עותק
            </button>
          </form>
        </section>
      )}

      {/*
        The catalogue by subject and by shelf.
        
        Collapsed by default: the search box is what a librarian reaches for
        most days. It earns its place the day a catalogue is imported, when the
        two numbers at the bottom — titles with no category, copies with no
        shelf — say whether the file landed the way it was meant to.
      */}
      {breakdown !== null && (
        <section className="card">
          <div className="card-header">
            <h2>הקטלוג במבט אחד</h2>
            <button
              type="button"
              className="btn-link"
              onClick={() => {
                setBrowsing((open) => !open);
                if (!browsing) void loadBreakdown();
              }}
              aria-expanded={browsing}
            >
              {browsing ? 'הסתר' : 'הצג'}
            </button>
          </div>

          {browsing && (
            <>
              <div className="browse-grid">
                <div>
                  <h3>לפי קטגוריה</h3>
                  {breakdown.categories.length === 0 ? (
                    <p className="empty">עדיין לא הוגדרו קטגוריות.</p>
                  ) : (
                    <ul className="browse-list">
                      {breakdown.categories.map((category) => (
                        <li key={category.publicId}>
                          <button
                            type="button"
                            className="btn-link"
                            onClick={() => {
                              setCategoryFilter(category.publicId);
                              setShelfFilter('');
                              setSearchText('');
                            }}
                          >
                            {category.name}
                          </button>
                          <span className="count">
                            {plural(category.titles, 'ספר', 'ספרים')} · {category.copies} עותקים
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <h3>לפי מיקום פיזי</h3>
                  {breakdown.shelves.length === 0 ? (
                    <p className="empty">עדיין לא הוגדרו מדפים.</p>
                  ) : (
                    <ul className="browse-list">
                      {breakdown.shelves.map((shelf) => (
                        <li key={shelf.publicId}>
                          <button
                            type="button"
                            className="btn-link"
                            onClick={() => {
                              setShelfFilter(shelf.publicId);
                              setCategoryFilter('');
                              setSearchText('');
                            }}
                          >
                            {shelf.name}
                            {shelf.room !== null && <span className="muted"> · {shelf.room}</span>}
                          </button>
                          <span className="count">
                            {shelf.copies} עותקים
                            {shelf.onLoan > 0 && ` · ${shelf.onLoan} מושאלים`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {(breakdown.uncategorisedTitles > 0 || breakdown.unplacedCopies > 0) && (
                <p className="hint">
                  {breakdown.uncategorisedTitles > 0 &&
                    `${plural(breakdown.uncategorisedTitles, 'ספר', 'ספרים')} ללא קטגוריה. `}
                  {breakdown.unplacedCopies > 0 &&
                    `${breakdown.unplacedCopies} עותקים ללא מיקום מדף.`}
                </p>
              )}
            </>
          )}
        </section>
      )}

      <section className="card">
        <div className="card-header">
          <h2>ספרים</h2>
          <button type="button" className="btn btn-primary" onClick={startCreate}>
            ספר חדש
          </button>
        </div>

        <div className="toolbar">
          <div className="grow">
            <input
              type="search"
              placeholder="חיפוש לפי שם, מחבר, מסת״ב או ברקוד עותק"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              aria-label="חיפוש ספרים"
            />
          </div>

          {/* The filters narrow the search rather than replacing it, so
              "comics on shelf 3" is one question and not three screens. */}
          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            aria-label="סינון לפי קטגוריה"
          >
            <option value="">כל הקטגוריות</option>
            {categories.map((category) => (
              <option key={category.publicId} value={category.publicId}>
                {category.name}
              </option>
            ))}
          </select>

          <select
            value={shelfFilter}
            onChange={(event) => setShelfFilter(event.target.value)}
            aria-label="סינון לפי מיקום מדף"
          >
            <option value="">כל המדפים</option>
            {shelves.map((shelf) => (
              <option key={shelf.publicId} value={shelf.publicId}>
                {shelf.name}
              </option>
            ))}
          </select>

          <span className="count">{plural(books.length, 'ספר', 'ספרים')}</span>
        </div>

        {(categoryFilter !== '' || shelfFilter !== '') && (
          <p className="hint" style={{ marginTop: 0 }}>
            <button
              type="button"
              className="btn-link"
              onClick={() => {
                setCategoryFilter('');
                setShelfFilter('');
              }}
            >
              נקה סינון
            </button>
          </p>
        )}

        {books.length === 0 ? (
          <p className="empty">אין ספרים להצגה.</p>
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
                  <tr key={book.publicId} className={book.active ? '' : 'is-inactive'}>
                    <td>{book.title}</td>
                    <td>{book.authorText ?? '—'}</td>
                    <td>{book.categoryName ?? '—'}</td>
                    <td>{book.copyCount}</td>
                    <td className="row-actions">
                      <button type="button" className="btn-link" onClick={() => void openBook(book.publicId)}>
                        פתח
                      </button>
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
