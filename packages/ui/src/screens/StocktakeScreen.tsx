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

/**
 * The corrections offered at the desk; the rest live in the book's page.
 *
 * `normal` is here so a mark can be taken back. It had no button at all, which
 * meant the conditions my own keyboard shortcuts set by accident could not be
 * undone from the screen that set them.
 */
/** One restrained mark per state. Enough to find the button without reading. */
const CONDITION_EMOJI: Record<ConditionStatus, string> = {
  normal: '✓',
  damaged: '✗',
  repair: '🔧',
  lost: '—',
  withdrawn: '—',
};

const QUICK_CONDITIONS: ReadonlyArray<{ status: ConditionStatus }> = [
  { status: 'normal' },
  { status: 'damaged' },
  { status: 'repair' },
];

interface LogEntry {
  readonly key: number;
  readonly kind: 'ok' | 'repeat' | 'unknown' | 'report';
  readonly text: string;
  readonly at: string;
}

export function StocktakeScreen({
  isAdmin,
  onGo,
}: {
  readonly isAdmin: boolean;
  /** Leaves for another screen, carrying a barcode where one is wanted. */
  readonly onGo: (screen: string, barcode?: string) => void;
}): JSX.Element {
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

  /*
   * There are no keyboard shortcuts here, and that is deliberate.
   *
   * There were: 2 for damaged, 3 for needs-repair, 4 for "not that book". They
   * were a mistake of the worst kind, because a scanner is a keyboard that
   * types digits. A barcode beginning with 2 marked the previous book damaged
   * and lost its own first digit, so the remainder looked up a different book
   * — which is exactly what the library reported, and which also quietly
   * produced conditions and disagreements nobody had entered.
   *
   * The scanner and the shortcuts were speaking into the same channel. The
   * fix is not a cleverer filter; it is that this channel belongs to the
   * scanner alone. The corrections are buttons, reached by hand.
   */

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
            <p className="hint" style={{ marginTop: 0 }}>
              סרוק עם המכשיר, או הקלד את המספר שעל המדבקה ולחץ Enter.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                scanner.submit();
              }}
              className="scan-row"
            >
              <input
                {...scanner.inputProps}
                ref={input}
                type="text"
                inputMode="numeric"
                placeholder="סרוק או הקלד מספר"
                aria-label="ברקוד הספר"
                dir="ltr"
                autoFocus
              />
              {/* Typing by hand never submits itself — that is what keeps a
                  half-typed number from being looked up — so there has to be
                  something to press. */}
              <button type="submit" className="btn btn-primary" disabled={scanner.value.trim() === ''}>
                חפש
              </button>
            </form>

                    {last !== null && (
              <ScanOutcome
                result={last}
                reported={reported.has(last.barcode)}
                onCorrect={(status) => void correct(status)}
                onReport={() => void reportWrongBook()}
                onDismiss={() => {
                  setLast(null);
                  input.current?.focus();
                }}
                onCatalogue={() => onGo('intake', last.barcode)}
              />
            )}
          </section>

          <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
            {/* Stopping for now is the common case and ending the count is
                the rare one, so stopping is the plain button here and ending
                has been moved out of reach, below. They were side by side. */}
            <button type="button" className="btn btn-primary" onClick={() => onGo('home')}>
              הפסק לעכשיו — הכול נשמר
            </button>
            <button type="button" className="btn" onClick={() => void showMissing()} disabled={busy}>
              הצג מה עוד לא נמצא
            </button>
            {openReports > 0 && (
              <button type="button" className="btn" onClick={() => setShowReports((open) => !open)}>
                {showReports ? 'הסתר אי-התאמות' : `הצג אי-התאמות (${openReports})`}
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

      {isAdmin && (
        <section className="card card-quiet">
          <h2>סיום הסבב</h2>
          <p className="hint" style={{ marginTop: 0 }}>
            רק כשסיימת לעבור על כל הספרייה. אחרי הסיום אי אפשר להמשיך לספור בסבב הזה — אם אתה
            רק מפסיק להיום, פשוט צא מהמסך, הכול נשמר.
          </p>
          <button type="button" className="btn" onClick={() => void finishRound()} disabled={busy}>
            סיים את הסבב
          </button>
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
  onDismiss,
  onCatalogue,
}: {
  readonly result: ScanResult;
  readonly reported: boolean;
  readonly onCorrect: (status: ConditionStatus) => void;
  readonly onReport: () => void;
  /** Clears the panel. There was no way to put the last book down. */
  readonly onDismiss: () => void;
  /** Takes an unknown barcode to the intake screen, already filled in. */
  readonly onCatalogue: () => void;
}): JSX.Element {
  if (!result.found) {
    return (
      <div className="index-card" role="status" aria-live="polite">
        <div>
          <p className="card-title">
            <span dir="ltr" className="card-number">{result.barcode}</span>
          </p>
          <p className="card-line">הספר הזה אינו בקטלוג</p>
          <div className="form-actions" style={{ justifyContent: 'flex-start', marginTop: '0.8rem' }}>
          {/* The book is in their hand and the number is on the screen.
              Making them retype it elsewhere is how books stay uncatalogued. */}
          <button type="button" className="btn btn-primary" onClick={onCatalogue}>
            קלוט ספר חדש עם המספר הזה
          </button>
          <button type="button" className="btn" onClick={onReport} disabled={reported}>
            {reported ? '✓ דווח' : 'דווח על המספר הזה'}
          </button>
            <button type="button" className="btn" onClick={onDismiss}>
              נקה
            </button>
          </div>
        </div>
        <div className="stamp stamp-none">לא בקטלוג ❓</div>
      </div>
    );
  }

  const copy = result.copy;

  return (
    <div className="index-card" role="status" aria-live="polite">
      <div>
        <p className="card-title">{copy?.bookTitle}</p>
        <p className="card-line">{copy?.bookAuthor ?? 'ללא מחבר'}</p>
        <p className="card-line">
          {copy?.categoryName ?? 'ללא קטגוריה'} · מס׳{' '}
          <span dir="ltr" className="card-number">{result.barcode}</span>
        </p>
        {result.onLoanTo !== null && (
          <p className="card-line">📕 מושאל כרגע ל{result.onLoanTo}</p>
        )}

        <div className="form-actions" style={{ justifyContent: 'flex-start', marginTop: '0.9rem' }}>
          <span className="hint" style={{ marginInlineEnd: '0.4rem' }}>
            מצב: <strong>{CONDITION_LABELS[copy?.conditionStatus ?? 'normal']}</strong>
          </span>
          {QUICK_CONDITIONS.map(({ status }) => (
            <button key={status} type="button" className="btn" onClick={() => onCorrect(status)}>
              {CONDITION_EMOJI[status]} {CONDITION_LABELS[status]}
            </button>
          ))}
          {/* The librarian is holding the book. If it is not this one, saying
              so must cost no more than saying it is damaged — otherwise nobody
              says it, and the catalogue stays wrong for ever. */}
          <button type="button" className="btn btn-report" onClick={onReport} disabled={reported}>
            {reported ? '✓ דווח' : '❓ זה לא הספר הזה'}
          </button>
          <button type="button" className="btn" onClick={onDismiss}>
            נקה
          </button>
        </div>
      </div>

      <div className={`stamp ${result.repeat ? 'stamp-repeat' : 'stamp-ok'}`}>
        {result.repeat ? 'כבר נספר 🔁' : 'נספר ✓'}
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
