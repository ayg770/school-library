import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  api,
  formatDate,
  type ConditionStatus,
  type MissingCopy,
  type CatalogueReport,
  type ScanResult,
  type StocktakeProgress,
} from '../api.js';
import { Notice } from '../components/Notice.js';
import { useScanner } from '../components/useScanner.js';

/**
 * Counting the shelves — PRODUCT_SPEC.md §12.
 *
 * Two thousand books, one librarian, one morning. Every decision on this
 * screen follows from that arithmetic: a book that is present and undamaged —
 * which is almost all of them — costs one scan and nothing else. No
 * confirmation, no dropdown, no reaching for the mouse. Saying anything other
 * than "fine" is the exception, and only the exception costs a keystroke.
 *
 * The condition buttons are therefore a correction applied *after* the fact,
 * to the book just scanned, rather than a question asked before it. Asking
 * first would put a decision between every book and the next one, and turn a
 * morning's work into a week's.
 */

const CONDITION_LABELS: Record<ConditionStatus, string> = {
  normal: 'תקין',
  damaged: 'פגום',
  repair: 'דורש תיקון',
  lost: 'אבוד',
  withdrawn: 'הוצא משימוש',
};

/** The corrections worth one keypress each; the rest live in the book's page. */
const QUICK_CONDITIONS: ReadonlyArray<{ status: ConditionStatus; key: string }> = [
  { status: 'damaged', key: '2' },
  { status: 'repair', key: '3' },
];

interface LogEntry {
  readonly key: number;
  readonly kind: 'ok' | 'repeat' | 'unknown' | 'report';
  readonly text: string;
  readonly at: string;
}

export function StocktakeScreen({ isAdmin }: { readonly isAdmin: boolean }): JSX.Element {
  const [progress, setProgress] = useState<StocktakeProgress | null>(null);
  const [last, setLast] = useState<ScanResult | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [missing, setMissing] = useState<{ items: MissingCopy[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roundName, setRoundName] = useState('');
  const [busy, setBusy] = useState(false);
  /** Barcodes reported in this sitting, so the button can say it worked. */
  const [reported, setReported] = useState<ReadonlySet<string>>(new Set());
  const [openReports, setOpenReports] = useState(0);
  const [reportList, setReportList] = useState<CatalogueReport[]>([]);
  const [showReports, setShowReports] = useState(false);

  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [next, reports] = await Promise.all([api.stocktake(), api.catalogueReports(false)]);
      setProgress(next);
      setOpenReports(reports.open);
      setReportList(reports.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'טעינת מצב הבדיקה נכשלה');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const open = progress?.round ?? null;

  function remember(entry: Omit<LogEntry, 'key' | 'at'>): void {
    setLog((entries) =>
      [
        { ...entry, key: Date.now() + Math.random(), at: new Date().toLocaleTimeString('he-IL') },
        ...entries,
      ].slice(0, 15),
    );
  }

  const scan = useCallback(async (barcode: string): Promise<void> => {
    setError(null);
    try {
      const { result, progress: next } = await api.scanForStocktake(barcode);
      setProgress(next);
      setLast(result);

      if (!result.found) {
        remember({ kind: 'unknown', text: `${barcode} — לא נמצא בקטלוג` });
      } else if (result.repeat) {
        remember({ kind: 'repeat', text: `${result.copy?.bookTitle ?? barcode} — כבר נספר` });
      } else {
        remember({ kind: 'ok', text: result.copy?.bookTitle ?? barcode });
      }
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : 'הסריקה נכשלה.';
      setError(message);
      remember({ kind: 'unknown', text: `${barcode} — ${message}` });
    } finally {
      input.current?.focus();
    }
  }, []);

  const scanner = useScanner({ onScan: (barcode) => void scan(barcode), enabled: open !== null });

  /**
   * Corrects the book just scanned.
   *
   * Re-scanning the same barcode with a condition is the whole mechanism: the
   * copy is already counted, so this only changes what was said about it.
   */
  const correct = useCallback(
    async (status: ConditionStatus): Promise<void> => {
      const barcode = last?.copy?.barcode;
      if (barcode === undefined) return;

      try {
        const { result, progress: next } = await api.scanForStocktake(barcode, status);
        setProgress(next);
        // Not a repeat, whatever the service says. The book was counted a
        // moment ago by this same librarian, who is now correcting what was
        // said about it — warning them about their own deliberate act reads
        // as a mistake and teaches them to ignore the warning that matters.
        setLast({ ...result, repeat: false });
        remember({ kind: 'ok', text: `${result.copy?.bookTitle ?? barcode} — ${CONDITION_LABELS[status]}` });
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : 'העדכון נכשל.');
      } finally {
        input.current?.focus();
      }
    },
    [last],
  );

  /**
   * "This is not that book."
   *
   * The sticker and the catalogue disagree. Which of them is wrong cannot be
   * told from here, and a librarian holding a book with children waiting is
   * the worst person to ask — so this files the disagreement in one press and
   * lets the count carry on. Somebody with both records and no queue settles
   * it later.
   */
  const reportWrongBook = useCallback(async (): Promise<void> => {
    const barcode = last?.barcode;
    if (barcode === undefined) return;

    try {
      await api.reportMismatch(barcode);
      setReported((seen) => new Set(seen).add(barcode));
      const reports = await api.catalogueReports(false);
      setOpenReports(reports.open);
      setReportList(reports.items);
      remember({ kind: 'report', text: `${barcode} — דווח: לא הספר הנכון` });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'הדיווח נכשל.');
    } finally {
      input.current?.focus();
    }
  }, [last]);

  // The hands are on the scanner, not the mouse. A digit marks the book just
  // counted; the field keeps focus throughout so the next scan needs nothing.
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (last?.copy === undefined || last.copy === null) return;
      if (scanner.value !== '') return;

      if (event.key === '4') {
        event.preventDefault();
        void reportWrongBook();
        return;
      }

      const match = QUICK_CONDITIONS.find((entry) => entry.key === event.key);
      if (match === undefined) return;
      event.preventDefault();
      void correct(match.status);
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [correct, last, reportWrongBook, scanner.value]);

  async function startRound(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.startStocktake(roundName.trim() === '' ? defaultRoundName() : roundName);
      setRoundName('');
      setLog([]);
      setLast(null);
      await load();
      input.current?.focus();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'פתיחת הסבב נכשלה.');
    } finally {
      setBusy(false);
    }
  }

  async function finishRound(): Promise<void> {
    // Ending a count is not undoable, and the button sits beside one that is
    // pressed constantly. Asking costs a second; a count ended by accident
    // costs the morning that produced it.
    const sure = window.confirm(
      `לסיים את הסבב "${progress?.round?.name ?? ''}"?\n\nנספרו ${progress?.seen ?? 0} מתוך ${progress?.expected ?? 0}. ` +
        'אחרי הסיום אי אפשר להמשיך לספור בסבב הזה.',
    );
    if (!sure) return;

    setBusy(true);
    try {
      await api.finishStocktake();
      setMissing(null);
      setLast(null);
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'סיום הסבב נכשל.');
    } finally {
      setBusy(false);
    }
  }

  async function showMissing(): Promise<void> {
    setBusy(true);
    try {
      setMissing(await api.missingCopies());
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'טעינת הרשימה נכשלה.');
    } finally {
      setBusy(false);
    }
  }

  if (progress === null) {
    return (
      <>
        <div className="page-head">
          <h2>בדיקת מלאי</h2>
        </div>
        {error !== null ? <Notice kind="error">{error}</Notice> : <p className="empty">רגע…</p>}
      </>
    );
  }

  const percent = progress.expected === 0 ? 0 : Math.round((progress.seen / progress.expected) * 100);

  return (
    <>
      <div className="page-head">
        <h2>בדיקת מלאי</h2>
        <p>סרוק ספר אחר ספר. ספר תקין נספר מעצמו — בלי לגעת במקלדת.</p>
      </div>

      {/* The count survives closing the program, the screen and the day. It
          said so nowhere, so the librarian who came back assumed it was lost
          and did not dare carry on. */}
      {open !== null && (
        <div className="round-banner" role="status">
          <div>
            <span className="round-banner-label">סבב פתוח</span>
            <strong>{open.name}</strong>
            <span className="round-banner-since">מאז {formatDate(open.startedAt)}</span>
          </div>
          <div className="round-banner-progress">
            נספרו <strong>{progress.seen.toLocaleString('he-IL')}</strong> מתוך{' '}
            {progress.expected.toLocaleString('he-IL')} · הבדיקה נשמרת, אפשר להפסיק ולהמשיך מחר
          </div>
        </div>
      )}

      {error !== null && <Notice kind="error">{error}</Notice>}

      {open === null ? (
        <section className="card">
          <div className="card-header">
            <h2>אין סבב בדיקה פתוח</h2>
          </div>
          <p className="hint">
            סבב הוא ספירה אחת שלמה של הספרייה. מה שנספר בסבב קודם לא נחשב בסבב חדש, כך שאפשר
            לחזור על הבדיקה בכל שנה מאפס.
          </p>
          {isAdmin ? (
            <form onSubmit={(event) => void startRound(event)}>
              <div className="field">
                <label htmlFor="round-name">שם הסבב</label>
                <input
                  id="round-name"
                  type="text"
                  value={roundName}
                  onChange={(event) => setRoundName(event.target.value)}
                  placeholder={defaultRoundName()}
                />
              </div>
              <div className="form-actions">
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  התחל סבב בדיקה
                </button>
              </div>
            </form>
          ) : (
            <p className="hint">מנהל המערכת פותח את הסבב.</p>
          )}
        </section>
      ) : (
        <>
          <div className="kpi-row">
            <div className="tile">
              <div className="label">נספרו</div>
              <div className="value">{progress.seen.toLocaleString('he-IL')}</div>
              <div className="note">מתוך {progress.expected.toLocaleString('he-IL')} · {percent}%</div>
            </div>

            <div className={`tile ${progress.missing > 0 ? 'tile-warn' : ''}`}>
              <div className="label">עוד לא נמצאו</div>
              <div className="value">{progress.missing.toLocaleString('he-IL')}</div>
              <div className="note">{progress.missing === 0 ? 'הכול נמצא' : 'כולל ספרים מושאלים'}</div>
            </div>

            <div className="tile">
              <div className="label">דורשים טיפול</div>
              <div className="value">
                {(progress.byCondition.damaged + progress.byCondition.repair).toLocaleString('he-IL')}
              </div>
              <div className="note">פגומים או לתיקון</div>
            </div>

            <div className={`tile ${openReports > 0 ? 'tile-warn' : ''}`}>
              <div className="label">אי-התאמות</div>
              <div className="value">{openReports.toLocaleString('he-IL')}</div>
              <div className="note">{openReports === 0 ? 'אין דיווחים' : 'ממתינות לבדיקה'}</div>
            </div>

            <div className="tile">
              <div className="label">הסבב</div>
              <div className="value" style={{ fontSize: '1.1rem' }}>{open.name}</div>
              <div className="note">מאז {formatDate(open.startedAt)}</div>
            </div>
          </div>

          <section className="card">
            <h2>סרוק ספר</h2>
            <form onSubmit={(event) => { event.preventDefault(); scanner.submit(); }} className="scan-field">
              <input
                {...scanner.inputProps}
                ref={input}
                type="text"
                placeholder="סרוק את ברקוד הספר"
                aria-label="ברקוד הספר"
                dir="ltr"
                autoFocus
              />
            </form>

                    {last !== null && (
              <ScanOutcome
                result={last}
                reported={reported.has(last.barcode)}
                onCorrect={(status) => void correct(status)}
                onReport={() => void reportWrongBook()}
              />
            )}
          </section>

          <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
            <button type="button" className="btn" onClick={() => void showMissing()} disabled={busy}>
              הצג מה עוד לא נמצא
            </button>
            {openReports > 0 && (
              <button type="button" className="btn" onClick={() => setShowReports((open) => !open)}>
                {showReports ? 'הסתר אי-התאמות' : `הצג אי-התאמות (${openReports})`}
              </button>
            )}
            {isAdmin && (
              <button type="button" className="btn" onClick={() => void finishRound()} disabled={busy}>
                סיים את הסבב
              </button>
            )}
          </div>
        </>
      )}

      {log.length > 0 && (
        <section className="card">
          <h2>נספרו עכשיו</h2>
          <ul className="scan-log">
            {log.map((entry) => (
              <li key={entry.key}>
                <span className={`mark ${entry.kind === 'ok' ? 'mark-ok' : 'mark-error'}`}>
                  {entry.kind === 'ok' ? '✓' : entry.kind === 'repeat' ? '↻' : '?'}
                </span>
                <span>{entry.text}</span>
                <span className="at">{entry.at}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* The pile the desk has been filing into. Nothing here is urgent — it
          is read by somebody with both records and no queue of children. */}
      {showReports && reportList.length > 0 && (
        <section className="card">
          <div className="card-header">
            <h2>אי-התאמות שדווחו</h2>
          </div>
          <p className="hint" style={{ marginTop: 0 }}>
            ספרים שבהם המדבקה והקטלוג לא מסכימים. הספרן דיווח תוך כדי עבודה; מישהו יבדוק אותם
            בנחת מול הספר עצמו.
          </p>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>מס׳ סידורי</th>
                  <th>מה הקטלוג אמר</th>
                  <th>דווח על ידי</th>
                  <th>מתי</th>
                </tr>
              </thead>
              <tbody>
                {reportList.map((report) => (
                  <tr key={report.publicId}>
                    <td className="value-ltr">{report.barcode}</td>
                    <td>{report.claimedTitle ?? <span className="hint">לא היה בקטלוג</span>}</td>
                    <td>{report.reportedBy ?? '—'}</td>
                    <td>{formatDate(report.reportedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {missing !== null && (
        <section className="card">
          <div className="card-header">
            <h2>עוד לא נמצאו — {missing.total.toLocaleString('he-IL')}</h2>
          </div>
          {missing.items.length === 0 ? (
            <p className="empty">כל הספרים נמצאו. 🎉</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>ברקוד</th>
                    <th>שם הספר</th>
                    <th>מדף</th>
                    <th>איפה הוא</th>
                  </tr>
                </thead>
                <tbody>
                  {missing.items.map((copy) => (
                    <tr key={copy.publicId}>
                      <td dir="ltr">{copy.barcode}</td>
                      <td>{copy.title}</td>
                      <td>{copy.shelfName ?? '—'}</td>
                      <td>
                        {copy.onLoanTo === null ? (
                          <span className="hint">לא נמצא</span>
                        ) : (
                          <>מושאל ל{copy.onLoanTo}</>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}

/** What the librarian sees the instant a barcode lands. */
function ScanOutcome({
  result,
  reported,
  onCorrect,
  onReport,
}: {
  readonly result: ScanResult;
  readonly reported: boolean;
  readonly onCorrect: (status: ConditionStatus) => void;
  readonly onReport: () => void;
}): JSX.Element {
  if (!result.found) {
    return (
      <div className="result result-error" role="status" aria-live="polite">
        <p className="result-headline">הספר הזה לא נמצא בקטלוג</p>
        <p className="result-detail">ברקוד {result.barcode}</p>
        <p className="result-meta">
          אם זה ספר חדש — הוסף אותו במסך <strong>קליטה</strong> עם הברקוד הזה, וסרוק שוב.
        </p>
        <div className="form-actions" style={{ justifyContent: 'flex-start', marginTop: '0.6rem' }}>
          <button type="button" className="btn" onClick={onReport} disabled={reported}>
            {reported ? '✓ דווח' : 'דווח על הברקוד הזה'} <kbd>4</kbd>
          </button>
        </div>
      </div>
    );
  }

  const copy = result.copy;

  return (
    <div className={`result result-${result.repeat ? 'warn' : 'ok'}`} role="status" aria-live="polite">
      <p className="result-headline">{copy?.bookTitle}</p>
      <p className="result-detail">
        {copy?.bookAuthor ?? 'ללא מחבר'}
        {copy?.categoryName != null && ` · ${copy.categoryName}`} · מס׳{' '}
        <span dir="ltr">{result.barcode}</span>
        {result.repeat && ' · נספר כבר בסבב הזה'}
      </p>
      {result.onLoanTo !== null && (
        <p className="result-meta">הספר מושאל כרגע ל{result.onLoanTo}.</p>
      )}

      <div className="form-actions" style={{ justifyContent: 'flex-start', marginTop: '0.6rem' }}>
        <span className="hint" style={{ marginInlineEnd: '0.5rem' }}>
          מצב הספר: <strong>{CONDITION_LABELS[copy?.conditionStatus ?? 'normal']}</strong>
        </span>
        {QUICK_CONDITIONS.map(({ status, key }) => (
          <button key={status} type="button" className="btn" onClick={() => onCorrect(status)}>
            {CONDITION_LABELS[status]} <kbd>{key}</kbd>
          </button>
        ))}
        {/* The librarian is holding the book. If it is not this one, saying so
            must be as cheap as saying it is damaged — otherwise nobody says
            it, and the catalogue stays wrong for ever. */}
        <button type="button" className="btn btn-report" onClick={onReport} disabled={reported}>
          {reported ? '✓ דווח' : 'זה לא הספר הזה'} <kbd>4</kbd>
        </button>
      </div>
    </div>
  );
}

/** Something sensible in the box, so starting a count needs no thought. */
function defaultRoundName(): string {
  const now = new Date();
  // The school year turns over the summer, so a count in October belongs to
  // the year that has just begun rather than the calendar year.
  const year = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return `בדיקת מלאי ${year}/${year + 1}`;
}
