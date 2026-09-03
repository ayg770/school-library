import { useRef, useState } from 'react';
import {
  ApiError,
  api,
  type CommitReport,
  type ImportBatch,
  type ImportRow,
  type ImportType,
  type TargetField,
} from '../api.js';
import { Field } from '../components/Field.js';
import { Notice } from '../components/Notice.js';

type Step = 'choose' | 'map' | 'review' | 'done';

const STEP_LABELS: Record<Step, string> = {
  choose: 'בחירת קובץ',
  map: 'התאמת עמודות',
  review: 'בדיקה',
  done: 'סיכום',
};

const TYPE_LABELS: Record<ImportType, string> = {
  students: 'תלמידים',
  books: 'ספרים ועותקים',
};

const UNMAPPED = -1;

/**
 * The import wizard — PRODUCT_SPEC.md §13.
 *
 * Four steps, in the order the spec sets out: choose a file, map its columns,
 * see the conflicts, then commit. Nothing reaches the catalogue until the last
 * step, so every problem is still free to fix when it is shown.
 */
export function ImportScreen(): JSX.Element {
  const [step, setStep] = useState<Step>('choose');
  const [importType, setImportType] = useState<ImportType>('books');
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [fields, setFields] = useState<TargetField[]>([]);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<ImportRow[]>([]);
  const [problemRows, setProblemRows] = useState<ImportRow[]>([]);
  const [report, setReport] = useState<CommitReport | null>(null);
  const [encoding, setEncoding] = useState<string | undefined>(undefined);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function reset(): void {
    setStep('choose');
    setBatch(null);
    setFields([]);
    setMapping({});
    setPreview([]);
    setProblemRows([]);
    setReport(null);
    setEncoding(undefined);
    setError(null);
    if (fileInput.current !== null) fileInput.current.value = '';
  }

  async function upload(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (file === undefined) {
      setError('יש לבחור קובץ.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await api.uploadImport(file, importType);
      setBatch(result.batch);
      setFields(result.fields);
      setMapping(result.suggestedMapping);
      setPreview(result.preview);
      setEncoding(result.encoding);
      setStep('map');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'העלאת הקובץ נכשלה.');
    } finally {
      setBusy(false);
    }
  }

  async function validate(): Promise<void> {
    if (batch === null) return;

    setBusy(true);
    setError(null);
    try {
      const cleaned = Object.fromEntries(
        Object.entries(mapping).filter(([, index]) => index !== UNMAPPED),
      );
      const validated = await api.validateImport(batch.publicId, cleaned);
      setBatch(validated);

      const [errors, warnings] = await Promise.all([
        api.getImportRows(batch.publicId, 'error'),
        api.getImportRows(batch.publicId, 'warning'),
      ]);
      setProblemRows([...errors.items, ...warnings.items].sort((a, b) => a.rowNumber - b.rowNumber));
      setStep('review');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'הבדיקה נכשלה.');
    } finally {
      setBusy(false);
    }
  }

  async function commit(): Promise<void> {
    if (batch === null) return;

    setBusy(true);
    setError(null);
    try {
      setReport(await api.commitImport(batch.publicId));
      setStep('done');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'הייבוא נכשל.');
    } finally {
      setBusy(false);
    }
  }

  const order: Step[] = ['choose', 'map', 'review', 'done'];
  const currentIndex = order.indexOf(step);

  return (
    <>
      <div className="steps">
        {order.map((id, index) => (
          <span key={id} style={{ display: 'contents' }}>
            {index > 0 && <span className="sep">›</span>}
            <span
              className="step"
              data-state={index === currentIndex ? 'current' : index < currentIndex ? 'done' : 'todo'}
            >
              {index < currentIndex ? '✓' : `${index + 1}.`} {STEP_LABELS[id]}
            </span>
          </span>
        ))}
      </div>

      {error !== null && <Notice kind="error">{error}</Notice>}

      {step === 'choose' && (
        <section className="card">
          <h2>ייבוא מקובץ</h2>
          <p className="hint">
            קובץ Excel או CSV. השורה הראשונה צריכה להיות שורת כותרות. שום דבר לא נכנס למערכת עד
            שתאשר בסוף.
          </p>

          <form onSubmit={(event) => void upload(event)}>
            <Field label="מה מייבאים" htmlFor="importType">
              <select
                id="importType"
                value={importType}
                onChange={(event) => setImportType(event.target.value as ImportType)}
              >
                <option value="books">{TYPE_LABELS.books}</option>
                <option value="students">{TYPE_LABELS.students}</option>
              </select>
            </Field>

            <Field label="קובץ" htmlFor="file">
              <input id="file" ref={fileInput} type="file" accept=".csv,.tsv,.txt,.xlsx,.xlsm" />
            </Field>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'קורא את הקובץ…' : 'המשך'}
              </button>
            </div>
          </form>
        </section>
      )}

      {step === 'map' && batch !== null && (
        <>
          <section className="card">
            <div className="card-header">
              <h2>התאמת עמודות</h2>
              <span className="count">
                {batch.filename} · {batch.totalRows} שורות
              </span>
            </div>
            <p className="hint">
              התאמנו את העמודות לפי הכותרות בקובץ. בדוק שהן נכונות ותקן מה שצריך.
              {encoding === 'windows-1255' && ' הקובץ נקרא בקידוד עברי של Excel.'}
            </p>

            <div className="map-grid">
              {fields.map((field) => (
                <Field
                  key={field.key}
                  label={field.required ? `${field.label} (חובה)` : field.label}
                  htmlFor={`map-${field.key}`}
                >
                  <select
                    id={`map-${field.key}`}
                    value={mapping[field.key] ?? UNMAPPED}
                    onChange={(event) =>
                      setMapping({ ...mapping, [field.key]: Number(event.target.value) })
                    }
                  >
                    <option value={UNMAPPED}>— ללא —</option>
                    {batch.headers.map((header, index) => (
                      <option key={`${header}-${index}`} value={index}>
                        {header}
                      </option>
                    ))}
                  </select>
                  {field.hint !== undefined && <p className="hint">{field.hint}</p>}
                </Field>
              ))}
            </div>

            <div className="form-actions">
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void validate()}>
                {busy ? 'בודק…' : 'בדוק את הקובץ'}
              </button>
              <button type="button" className="btn" disabled={busy} onClick={reset}>
                התחל מחדש
              </button>
            </div>
          </section>

          {preview.length > 0 && (
            <section className="card">
              <h2>השורות הראשונות בקובץ</h2>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>#</th>
                      {batch.headers.map((header, index) => (
                        <th key={`${header}-${index}`}>{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row) => (
                      <tr key={row.rowNumber}>
                        <td>{row.rowNumber}</td>
                        {batch.headers.map((_, index) => (
                          <td key={index} className="sample">
                            {row.raw[index] ?? ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}

      {step === 'review' && batch !== null && (
        <>
          <section className="card">
            <h2>תוצאות הבדיקה</h2>

            <div className="stat-row">
              <div className="stat stat-ok">
                <div className="value">{batch.successCount}</div>
                <div className="label">מוכנות לייבוא</div>
              </div>
              <div className="stat stat-warn">
                <div className="value">{batch.warningCount}</div>
                <div className="label">עם אזהרה — ייובאו גם הן</div>
              </div>
              <div className="stat stat-error">
                <div className="value">{batch.errorCount}</div>
                <div className="label">עם שגיאה — לא ייובאו</div>
              </div>
            </div>

            {batch.errorCount > 0 && (
              <p className="hint">
                שורות עם שגיאה יידלגו. אפשר לייבא את השאר עכשיו, ולתקן את הקובץ ולייבא שוב רק
                אותן — ברקוד שכבר נכנס יזוהה ולא ייווצר פעמיים.
              </p>
            )}

            <div className="form-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || batch.successCount + batch.warningCount === 0}
                onClick={() => void commit()}
              >
                {busy ? 'מייבא…' : `ייבא ${batch.successCount + batch.warningCount} שורות`}
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => setStep('map')}>
                חזור להתאמת עמודות
              </button>
              <button type="button" className="btn" disabled={busy} onClick={reset}>
                בטל
              </button>
            </div>
          </section>

          {problemRows.length > 0 && (
            <section className="card">
              <h2>שורות שדורשות תשומת לב</h2>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>שורה</th>
                      <th>תוכן</th>
                      <th>מה נמצא</th>
                    </tr>
                  </thead>
                  <tbody>
                    {problemRows.slice(0, 100).map((row) => (
                      <tr key={row.rowNumber}>
                        <td>{row.rowNumber}</td>
                        <td className="sample">{row.raw.filter((value) => value !== '').join(' · ')}</td>
                        <td className={row.status === 'error' ? 'row-problem' : 'row-warn'}>
                          {row.problems.join(' · ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {problemRows.length > 100 && (
                <p className="hint">מוצגות 100 השורות הראשונות מתוך {problemRows.length}.</p>
              )}
            </section>
          )}
        </>
      )}

      {step === 'done' && report !== null && (
        <section className="card">
          <h2>הייבוא הושלם</h2>

          <div className="stat-row">
            <div className="stat stat-ok">
              <div className="value">{report.imported}</div>
              <div className="label">נוספו</div>
            </div>
            <div className="stat">
              <div className="value">{report.skipped}</div>
              <div className="label">דולגו</div>
            </div>
            <div className="stat stat-error">
              <div className="value">{report.failed}</div>
              <div className="label">נכשלו</div>
            </div>
          </div>

          <dl className="info-grid">
            {report.createdClasses.length > 0 && (
              <>
                <dt>כיתות שנוצרו</dt>
                <dd>{report.createdClasses.join(', ')}</dd>
              </>
            )}
            {report.createdCategories.length > 0 && (
              <>
                <dt>קטגוריות שנוצרו</dt>
                <dd>{report.createdCategories.join(', ')}</dd>
              </>
            )}
            {report.createdShelves.length > 0 && (
              <>
                <dt>מיקומי מדף שנוצרו</dt>
                <dd>{report.createdShelves.join(', ')}</dd>
              </>
            )}
          </dl>

          <div className="form-actions">
            <button type="button" className="btn btn-primary" onClick={reset}>
              ייבוא נוסף
            </button>
          </div>
        </section>
      )}
    </>
  );
}
