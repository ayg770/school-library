import { useEffect, useRef, useState } from 'react';
import { ApiError, api, type Category, type ShelfLocation } from '../api.js';
import { Field } from '../components/Field.js';

interface AddedRow {
  readonly key: number;
  readonly barcode: string;
  readonly title: string;
  readonly createdTitle: boolean;
  readonly at: string;
}

type Feedback = { kind: 'ok' | 'error'; headline: string; detail: string; meta?: string } | null;

/**
 * Shelf intake — PRODUCT_SPEC.md §12 and §27.
 *
 * One book, one pass. The barcode leads because that is what a scanner sends
 * first, and the whole form submits from any field, so a librarian working
 * through a shelf never reaches for the mouse.
 *
 * The title is found or created by the service. Adding the second copy of a
 * book already in the catalogue therefore needs nothing different from adding
 * the first — the same form, and it lands as a second copy rather than a
 * second book (§6).
 */
export function IntakeScreen(): JSX.Element {
  const [barcode, setBarcode] = useState('');
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [categoryPublicId, setCategoryPublicId] = useState('');
  const [shelfPublicId, setShelfPublicId] = useState('');
  /** Kept between books: a shelf is worked through one section at a time. */
  const [keepPlacement, setKeepPlacement] = useState(true);

  const [categories, setCategories] = useState<Category[]>([]);
  const [shelves, setShelves] = useState<ShelfLocation[]>([]);
  const [added, setAdded] = useState<AddedRow[]>([]);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const barcodeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    barcodeInput.current?.focus();
    void api.listCategories().then((result) => setCategories(result.items)).catch(() => setCategories([]));
    void api.listShelves().then((result) => setShelves(result.items)).catch(() => setShelves([]));
  }, []);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (busy || barcode.trim() === '' || title.trim() === '') return;

    setBusy(true);
    setFieldError(undefined);

    try {
      const result = await api.intake({
        barcode,
        title,
        authorText: author === '' ? null : author,
        categoryPublicId: categoryPublicId === '' ? null : categoryPublicId,
        shelfPublicId: shelfPublicId === '' ? null : shelfPublicId,
      });

      setFeedback({
        kind: 'ok',
        headline: result.createdTitle ? 'ספר חדש נוסף' : 'עותק נוסף לספר קיים',
        detail: result.book.title,
        meta: `ברקוד ${result.copy.barcode} · סה"כ ${result.book.copyCount} עותקים`,
      });
      setAdded((rows) =>
        [
          {
            key: Date.now(),
            barcode: result.copy.barcode,
            title: result.book.title,
            createdTitle: result.createdTitle,
            at: new Date().toLocaleTimeString('he-IL'),
          },
          ...rows,
        ].slice(0, 15),
      );

      setBarcode('');
      setTitle('');
      setAuthor('');
      if (!keepPlacement) {
        setCategoryPublicId('');
        setShelfPublicId('');
      }
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : 'ההוספה נכשלה. נסה שוב.';
      setFieldError(message);
      setFeedback({ kind: 'error', headline: 'לא נוסף', detail: message });
    } finally {
      setBusy(false);
      barcodeInput.current?.focus();
      barcodeInput.current?.select();
    }
  }

  return (
    <>
      <div className="page-head">
        <h2>קליטת ספרים</h2>
        <p>הוספת ספר אחד בכל פעם. לספר שכבר קיים בקטלוג ייווצר עותק נוסף, לא רשומה כפולה.</p>
      </div>

      {feedback !== null && (
        <div className={`result result-${feedback.kind}`} role="status" aria-live="polite">
          <p className="result-headline">{feedback.headline}</p>
          <p className="result-detail">{feedback.detail}</p>
          {feedback.meta !== undefined && <p className="result-meta">{feedback.meta}</p>}
        </div>
      )}

      <section className="card">
        <form onSubmit={(event) => void submit(event)}>
          <Field label="ברקוד העותק" htmlFor="intake-barcode" error={fieldError}>
            <input
              id="intake-barcode"
              ref={barcodeInput}
              type="text"
              value={barcode}
              onChange={(event) => setBarcode(event.target.value)}
              placeholder="סרוק או הקלד"
              dir="ltr"
              autoComplete="off"
              className="scan-field"
              style={{ fontSize: '1.125rem', padding: '0.7rem 0.8rem' }}
            />
          </Field>

          <div className="field-row">
            <Field label="שם הספר" htmlFor="intake-title">
              <input
                id="intake-title"
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                autoComplete="off"
              />
            </Field>
            <Field label="מחבר" htmlFor="intake-author">
              <input
                id="intake-author"
                type="text"
                value={author}
                onChange={(event) => setAuthor(event.target.value)}
                autoComplete="off"
              />
            </Field>
          </div>

          <div className="field-row">
            <Field label="קטגוריה" htmlFor="intake-category">
              <select
                id="intake-category"
                value={categoryPublicId}
                onChange={(event) => setCategoryPublicId(event.target.value)}
              >
                <option value="">ללא קטגוריה</option>
                {categories.map((category) => (
                  <option key={category.publicId} value={category.publicId}>
                    {category.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="מיקום מדף" htmlFor="intake-shelf">
              <select
                id="intake-shelf"
                value={shelfPublicId}
                onChange={(event) => setShelfPublicId(event.target.value)}
              >
                <option value="">ללא מיקום</option>
                {shelves.map((shelf) => (
                  <option key={shelf.publicId} value={shelf.publicId}>
                    {shelf.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={keepPlacement}
              onChange={(event) => setKeepPlacement(event.target.checked)}
            />
            שמור קטגוריה ומדף לספר הבא
          </label>

          <div className="form-actions">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy || barcode.trim() === '' || title.trim() === ''}
            >
              {busy ? 'מוסיף…' : 'הוסף ספר'}
            </button>
            <span className="hint" style={{ margin: 0, alignSelf: 'center' }}>
              Enter מכל שדה מוסיף ומחזיר את הסמן לברקוד
            </span>
          </div>
        </form>
      </section>

      {added.length > 0 && (
        <section className="card">
          <div className="card-header">
            <h2>נוספו עכשיו</h2>
            <span className="count">{added.length} ספרים</span>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>ברקוד</th>
                  <th>ספר</th>
                  <th>מה קרה</th>
                  <th>שעה</th>
                </tr>
              </thead>
              <tbody>
                {added.map((row) => (
                  <tr key={row.key}>
                    <td className="value-ltr">{row.barcode}</td>
                    <td>{row.title}</td>
                    <td>
                      {row.createdTitle ? (
                        <span className="status status-ok">ספר חדש</span>
                      ) : (
                        <span className="status status-neutral">עותק נוסף</span>
                      )}
                    </td>
                    <td className="num">{row.at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
