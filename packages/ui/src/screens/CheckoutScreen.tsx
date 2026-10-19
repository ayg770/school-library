import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiError,
  CONDITION_LABELS,
  api,
  formatDate,
  type BookCopyWithLoan,
  type Loan,
  type Student,
} from '../api.js';
import { Notice } from '../components/Notice.js';
import { useScanner } from '../components/useScanner.js';

/**
 * Lending a book — PRODUCT_SPEC.md §11.
 *
 * In the order the desk actually works: a child arrives holding a book, so the
 * book comes first and the child second. It used to be the other way round,
 * which meant the screen jumped to asking for a pupil the moment a book was
 * scanned, with no sign of what had just been read.
 *
 * The two steps are drawn as two steps, and the one being worked on is lit.
 * The volunteers are children; a screen that silently becomes a different
 * screen is one they cannot follow, and they will not ask — they will guess.
 *
 * Nothing is written until both halves are known, so a wrong book is put down
 * by scanning the right one rather than by undoing a loan.
 */

type Stage = 'book' | 'student' | 'done';

interface Done {
  readonly loan: Loan;
  readonly student: Student;
}

export function CheckoutScreen(): JSX.Element {
  const [copy, setCopy] = useState<BookCopyWithLoan | null>(null);
  const [student, setStudent] = useState<Student | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  /** A pupil chosen for the next book too, waiting for it to be scanned. */
  const [pending, setPending] = useState<Student | null>(null);

  const [students, setStudents] = useState<Student[]>([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const bookInput = useRef<HTMLInputElement>(null);
  const studentInput = useRef<HTMLInputElement>(null);

  const stage: Stage = done !== null ? 'done' : copy === null ? 'book' : 'student';

  // Loaded once and filtered here: a school has hundreds of pupils, not
  // thousands, and a list that answers as you type is the difference between
  // picking a name and giving up on a card nobody has issued.
  useEffect(() => {
    void (async () => {
      try {
        setStudents((await api.listStudents({ active: true })).items);
      } catch {
        // The list is a convenience; scanning a card still works without it.
      }
    })();
  }, []);

  useEffect(() => {
    if (stage === 'book') bookInput.current?.focus();
    if (stage === 'student') studentInput.current?.focus();
  }, [stage]);

  const findBook = useCallback(async (barcode: string): Promise<void> => {
    setError(null);
    try {
      const found = await api.copyByBarcode(barcode);
      if (found.onLoan) {
        setError(
          `הספר הזה כבר מושאל${found.borrowerName === null ? '' : ` ל${found.borrowerName}`}. צריך להחזיר אותו קודם.`,
        );
        return;
      }
      setCopy(found);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? `${cause.message} (מספר ${barcode})`
          : `לא נמצא ספר עם המספר ${barcode}.`,
      );
    }
  }, []);

  const findStudentByCard = useCallback(async (barcode: string): Promise<void> => {
    try {
      setStudent(await api.studentByBarcode(barcode));
      setError(null);
    } catch {
      // Not a card. Whatever was typed is a name, so it searches instead.
      setFilter(barcode);
    }
  }, []);

  const bookScanner = useScanner({
    onScan: (barcode) => void findBook(barcode),
    enabled: stage === 'book',
  });

  const cardScanner = useScanner({
    onScan: (barcode) => void findStudentByCard(barcode),
    enabled: stage === 'student',
  });

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const list =
      needle === ''
        ? students
        : students.filter((entry) =>
            `${entry.firstName} ${entry.lastName} ${entry.className ?? ''} ${entry.localBarcode ?? ''}`
              .toLowerCase()
              .includes(needle),
          );
    return list.slice(0, 60);
  }, [filter, students]);

  const lend = useCallback(
    async (chosen: Student, barcode: string): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        const loan = await api.checkout({ studentPublicId: chosen.publicId, barcode });
        setDone({ loan, student: chosen });
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : 'ההשאלה נכשלה.');
        setStudent(null);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  // Choosing a pupil is the last decision, so it is also the moment to act.
  // There is no confirm step: the loan is undone by returning the book, which
  // is a thing the desk does all day anyway.
  //
  // It re-runs when the request finishes, which is why the guard checks
  // `done` as well: by then the loan exists, and without that check the same
  // book would be lent twice.
  useEffect(() => {
    if (student !== null && copy !== null && done === null && !busy) {
      void lend(student, copy.barcode);
    }
  }, [student, copy, busy, done, lend]);

  // The same child's next book: the pupil is remembered, so only the book is
  // asked for again.
  useEffect(() => {
    if (pending !== null && copy !== null && student === null) {
      setStudent(pending);
      setPending(null);
    }
  }, [copy, pending, student]);

  function startOver(keepStudent: boolean): void {
    const previous = done?.student ?? null;
    setDone(null);
    setCopy(null);
    setStudent(null);
    setFilter('');
    setError(null);
    bookScanner.clear();
    cardScanner.clear();
    setPending(keepStudent ? previous : null);
  }

  return (
    <>
      <div className="page-head">
        <h2>השאלה</h2>
        <p>קודם הספר, אחר כך הילד.</p>
      </div>

      <ol className="steps" aria-label="שלבי ההשאלה">
        <Step index={1} label="הספר" state={stepState(stage, 'book')} />
        <Step index={2} label="הילד" state={stepState(stage, 'student')} />
        <Step index={3} label="נרשם" state={stepState(stage, 'done')} />
      </ol>

      {error !== null && <Notice kind="error">{error}</Notice>}

      {pending !== null && (
        <Notice kind="ok">{`הספר הבא יירשם על ${pending.firstName} ${pending.lastName}. סרוק אותו.`}</Notice>
      )}

      {stage === 'book' && (
        <section className="card">
          <h2>1 · סרוק את הספר</h2>
          <p className="hint" style={{ marginTop: 0 }}>
            סרוק עם המכשיר, או הקלד את המספר שעל המדבקה ולחץ Enter.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              bookScanner.submit();
            }}
            className="scan-row"
          >
            <input
              {...bookScanner.inputProps}
              ref={bookInput}
              type="text"
              inputMode="numeric"
              placeholder="סרוק או הקלד מספר"
              aria-label="ברקוד הספר"
              dir="ltr"
              autoFocus
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={bookScanner.value.trim() === ''}
            >
              חפש
            </button>
          </form>
        </section>
      )}

      {copy !== null && done === null && (
        <section className="card">
          <div className="card-header">
            <h2>{copy.bookTitle}</h2>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setCopy(null);
                setError(null);
                bookScanner.clear();
              }}
            >
              ספר אחר
            </button>
          </div>
          <p className="result-detail">
            {copy.bookAuthor ?? 'ללא מחבר'}
            {copy.categoryName !== null && ` · ${copy.categoryName}`} · מס׳{' '}
            <span dir="ltr">{copy.barcode}</span> · {CONDITION_LABELS[copy.conditionStatus]}
          </p>
        </section>
      )}

      {stage === 'student' && (
        <section className="card">
          <h2>2 · מי לוקח את הספר?</h2>
          <p className="hint" style={{ marginTop: 0 }}>
            סרוק כרטיס, הקלד שם, או בחר מהרשימה.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              cardScanner.submit();
            }}
            className="scan-row"
          >
            <input
              {...cardScanner.inputProps}
              ref={studentInput}
              type="text"
              placeholder="סרוק כרטיס או הקלד שם"
              aria-label="תלמיד"
              onChange={(event) => {
                cardScanner.inputProps.onChange(event);
                setFilter(event.target.value);
              }}
              autoFocus
            />
          </form>

          {students.length === 0 ? (
            <p className="empty">עדיין אין תלמידים במערכת.</p>
          ) : shown.length === 0 ? (
            <p className="empty">אין תלמיד בשם הזה.</p>
          ) : (
            <ul className="pick-list">
              {shown.map((entry) => (
                <li key={entry.publicId}>
                  <button type="button" onClick={() => setStudent(entry)} disabled={busy}>
                    <span className="pick-name">
                      {entry.firstName} {entry.lastName}
                    </span>
                    <span className="pick-meta">{entry.className ?? 'ללא כיתה'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {done !== null && (
        <section className="card">
          <div className="result result-ok" role="status" aria-live="polite">
            <p className="result-headline">
              {done.loan.bookTitle} → {done.student.firstName} {done.student.lastName}
            </p>
            <p className="result-detail">
              {done.student.className ?? 'ללא כיתה'} · להחזרה עד {formatDate(done.loan.dueAt)}
            </p>
          </div>

          <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
            <button type="button" className="btn btn-primary" onClick={() => startOver(true)}>
              עוד ספר לאותו ילד
            </button>
            <button type="button" className="btn" onClick={() => startOver(false)}>
              השאלה חדשה
            </button>
          </div>
        </section>
      )}
    </>
  );
}

type StepState = 'done' | 'current' | 'waiting';

function stepState(stage: Stage, step: Stage): StepState {
  const order: readonly Stage[] = ['book', 'student', 'done'];
  const at = order.indexOf(stage);
  const mine = order.indexOf(step);
  if (mine < at) return 'done';
  return mine === at ? 'current' : 'waiting';
}

function Step({
  index,
  label,
  state,
}: {
  readonly index: number;
  readonly label: string;
  readonly state: StepState;
}): JSX.Element {
  return (
    <li className={`step step-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
      <span className="step-index">{state === 'done' ? '✓' : index}</span>
      <span className="step-label">{label}</span>
    </li>
  );
}
