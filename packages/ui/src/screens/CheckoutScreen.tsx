import { useEffect, useRef, useState } from 'react';
import {
  ApiError,
  api,
  formatDate,
  type Loan,
  type Student,
  type StudentLibrarySummary,
} from '../api.js';
import { Notice } from '../components/Notice.js';

interface ScanEntry {
  readonly key: number;
  readonly ok: boolean;
  readonly text: string;
  readonly at: string;
}

type Feedback = { kind: 'ok' | 'error'; headline: string; detail: string; meta?: string } | null;

/**
 * Checkout — PRODUCT_SPEC.md §11.
 *
 * The shape of the screen follows the queue at the desk: find the student
 * once, then scan book after book. The barcode field holds focus and takes it
 * back after every scan, so a librarian with a queue never touches the mouse,
 * and there is no confirmation dialog on a normal checkout.
 *
 * A generic USB scanner in HID keyboard mode types the barcode and sends
 * Enter, which submits the form — the same thing typing by hand does, so both
 * work without the app caring which happened (§10).
 */
export function CheckoutScreen(): JSX.Element {
  const [studentQuery, setStudentQuery] = useState('');
  const [matches, setMatches] = useState<Student[]>([]);
  const [summary, setSummary] = useState<StudentLibrarySummary | null>(null);

  const [barcode, setBarcode] = useState('');
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [log, setLog] = useState<ScanEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const studentInput = useRef<HTMLInputElement>(null);
  const barcodeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    studentInput.current?.focus();
  }, []);

  // Once a student is chosen the scan field takes over, and keeps focus.
  useEffect(() => {
    if (summary !== null) barcodeInput.current?.focus();
  }, [summary]);

  async function selectStudent(student: Student): Promise<void> {
    setMatches([]);
    setStudentQuery('');
    setFeedback(null);
    setLog([]);
    try {
      setSummary(await api.studentSummary(student.publicId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'טעינת התלמיד נכשלה');
    }
  }

  async function findStudent(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (studentQuery.trim() === '') return;

    setError(null);
    try {
      const result = await api.listStudents({ query: studentQuery, active: true });
      if (result.items.length === 1) {
        // A scanned card, or an unambiguous name: go straight in.
        await selectStudent(result.items[0]!);
      } else if (result.items.length === 0) {
        setError('לא נמצא תלמיד פעיל שמתאים לחיפוש.');
        setMatches([]);
      } else {
        setMatches(result.items);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'החיפוש נכשל');
    }
  }

  async function scanBook(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (summary === null || barcode === '' || busy) return;

    setBusy(true);
    const scanned = barcode;
    setBarcode('');

    try {
      const loan: Loan = await api.checkout({
        studentPublicId: summary.student.publicId,
        barcode: scanned,
      });

      setFeedback({
        kind: 'ok',
        headline: 'הושאל',
        detail: loan.bookTitle,
        meta: `ברקוד ${loan.barcode} · להחזרה עד ${formatDate(loan.dueAt)}`,
      });
      setLog((entries) =>
        [
          { key: Date.now(), ok: true, text: `${loan.bookTitle} · ${loan.barcode}`, at: new Date().toLocaleTimeString('he-IL') },
          ...entries,
        ].slice(0, 12),
      );
      setSummary(await api.studentSummary(summary.student.publicId));
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : 'ההשאלה נכשלה. נסה שוב.';
      setFeedback({ kind: 'error', headline: 'לא הושאל', detail: message, meta: `ברקוד ${scanned}` });
      setLog((entries) =>
        [
          { key: Date.now(), ok: false, text: `${scanned} — ${message}`, at: new Date().toLocaleTimeString('he-IL') },
          ...entries,
        ].slice(0, 12),
      );
    } finally {
      setBusy(false);
      // §11: focus returns immediately, ready for the next book.
      barcodeInput.current?.focus();
    }
  }

  return (
    <>
      {error !== null && <Notice kind="error">{error}</Notice>}

      {summary === null ? (
        <section className="card">
          <h2>השאלה — בחירת תלמיד</h2>
          <p className="hint">סרוק כרטיס תלמיד, או הקלד שם ולחץ Enter.</p>

          <form onSubmit={(event) => void findStudent(event)} className="scan-field">
            <input
              ref={studentInput}
              type="text"
              value={studentQuery}
              onChange={(event) => setStudentQuery(event.target.value)}
              placeholder="ברקוד כרטיס או שם התלמיד"
              aria-label="חיפוש תלמיד"
            />
          </form>

          {matches.length > 0 && (
            <ul className="pick-list">
              {matches.map((student) => (
                <li key={student.publicId}>
                  <button type="button" onClick={() => void selectStudent(student)}>
                    {student.lastName} {student.firstName}
                    {student.className !== null && <span className="meta"> · {student.className}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <>
          <div className="student-banner">
            <div>
              <div className="who">
                {summary.student.lastName} {summary.student.firstName}
              </div>
              <div className="meta">
                {summary.student.className ?? 'ללא כיתה'} · {summary.activeLoanCount} ספרים מושאלים
                {summary.overdueCount > 0 && (
                  <span className="overdue-text"> · {summary.overdueCount} באיחור</span>
                )}
              </div>
            </div>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setSummary(null);
                setFeedback(null);
                setLog([]);
                window.setTimeout(() => studentInput.current?.focus(), 0);
              }}
            >
              תלמיד אחר
            </button>
          </div>

          {feedback !== null && (
            <div className={`result result-${feedback.kind}`} role="status" aria-live="polite">
              <p className="result-headline">{feedback.headline}</p>
              <p className="result-detail">{feedback.detail}</p>
              {feedback.meta !== undefined && <p className="result-meta">{feedback.meta}</p>}
            </div>
          )}

          <section className="card">
            <h2>סריקת ספר</h2>
            <form onSubmit={(event) => void scanBook(event)} className="scan-field">
              <input
                ref={barcodeInput}
                type="text"
                value={barcode}
                onChange={(event) => setBarcode(event.target.value)}
                placeholder="סרוק את ברקוד הספר"
                aria-label="ברקוד הספר"
                dir="ltr"
                autoComplete="off"
              />
            </form>
            <p className="hint" style={{ marginTop: '0.75rem' }}>
              הסורק מקליד את הברקוד ושולח Enter. אפשר גם להקליד ידנית.
            </p>
          </section>

          {summary.activeLoans.length > 0 && (
            <section className="card">
              <h2>מושאל כרגע לתלמיד</h2>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>ספר</th>
                      <th>ברקוד</th>
                      <th>להחזרה עד</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.activeLoans.map((loan) => (
                      <tr key={loan.publicId}>
                        <td>{loan.bookTitle}</td>
                        <td className="value-ltr">{loan.barcode}</td>
                        <td className={loan.overdue ? 'overdue-text' : ''}>
                          {formatDate(loan.dueAt)}
                          {loan.overdue && ` · ${loan.daysOverdue} ימי איחור`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {log.length > 0 && (
            <section className="card">
              <h2>נסרק בהשאלה הזו</h2>
              <ul className="scan-log">
                {log.map((entry) => (
                  <li key={entry.key}>
                    <span className={`mark ${entry.ok ? 'mark-ok' : 'mark-error'}`}>
                      {entry.ok ? '✓' : '✗'}
                    </span>
                    <span>{entry.text}</span>
                    <span className="time">{entry.at}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  );
}
