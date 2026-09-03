import { useEffect, useRef, useState } from 'react';
import { ApiError, api, formatDate } from '../api.js';

interface ScanEntry {
  readonly key: number;
  readonly ok: boolean;
  readonly text: string;
  readonly at: string;
}

type Feedback =
  | { kind: 'ok' | 'warn' | 'error'; headline: string; detail: string; meta?: string }
  | null;

/**
 * Return — PRODUCT_SPEC.md §11.
 *
 * The book alone is enough. The loan already records who borrowed it, so
 * asking the librarian to find the student first would slow the queue for no
 * information. The screen shows who is returning it, which is what the
 * librarian actually wants to see.
 */
export function ReturnScreen(): JSX.Element {
  const [barcode, setBarcode] = useState('');
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [log, setLog] = useState<ScanEntry[]>([]);
  const [busy, setBusy] = useState(false);

  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  async function scan(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (barcode === '' || busy) return;

    setBusy(true);
    const scanned = barcode;
    setBarcode('');

    try {
      const { loan, wasOverdue } = await api.checkin(scanned);
      const who = `${loan.studentFirstName} ${loan.studentLastName}`;

      setFeedback({
        // Late is worth flagging, but it never blocks the return.
        kind: wasOverdue ? 'warn' : 'ok',
        headline: wasOverdue ? 'הוחזר באיחור' : 'הוחזר',
        detail: loan.bookTitle,
        meta: `${who}${loan.className === null ? '' : ` · ${loan.className}`} · היה להחזרה עד ${formatDate(loan.dueAt)}`,
      });
      setLog((entries) =>
        [
          {
            key: Date.now(),
            ok: true,
            text: `${loan.bookTitle} · ${who}${wasOverdue ? ' (באיחור)' : ''}`,
            at: new Date().toLocaleTimeString('he-IL'),
          },
          ...entries,
        ].slice(0, 12),
      );
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : 'ההחזרה נכשלה. נסה שוב.';
      setFeedback({ kind: 'error', headline: 'לא הוחזר', detail: message, meta: `ברקוד ${scanned}` });
      setLog((entries) =>
        [
          { key: Date.now(), ok: false, text: `${scanned} — ${message}`, at: new Date().toLocaleTimeString('he-IL') },
          ...entries,
        ].slice(0, 12),
      );
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  }

  return (
    <>
      {feedback !== null && (
        <div className={`result result-${feedback.kind}`} role="status" aria-live="polite">
          <p className="result-headline">{feedback.headline}</p>
          <p className="result-detail">{feedback.detail}</p>
          {feedback.meta !== undefined && <p className="result-meta">{feedback.meta}</p>}
        </div>
      )}

      <section className="card">
        <h2>החזרה</h2>
        <p className="hint">סרוק את ברקוד הספר. אין צורך בכרטיס התלמיד.</p>
        <form onSubmit={(event) => void scan(event)} className="scan-field">
          <input
            ref={input}
            type="text"
            value={barcode}
            onChange={(event) => setBarcode(event.target.value)}
            placeholder="סרוק את ברקוד הספר"
            aria-label="ברקוד הספר"
            dir="ltr"
            autoComplete="off"
          />
        </form>
      </section>

      {log.length > 0 && (
        <section className="card">
          <h2>הוחזר עכשיו</h2>
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
  );
}
