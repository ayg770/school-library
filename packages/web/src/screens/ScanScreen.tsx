import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../supabase.js';

/**
 * A book, in the hand, away from the desk.
 *
 * The scanner and the library computer are in one room; the books are in six
 * classrooms. This is the screen for the other place: point a phone at a
 * barcode, see what the catalogue knows, and say what is true now.
 *
 * It does not count towards a stocktake round. A round belongs to the walk
 * along the shelves and is kept on the library computer; what travels is the
 * condition of a book and whether it has come back. Pretending otherwise would
 * make two counts that disagree.
 */

const CONDITIONS = [
  { value: 'normal', label: 'תקין', mark: '✓' },
  { value: 'damaged', label: 'פגום', mark: '✗' },
  { value: 'repair', label: 'דורש תיקון', mark: '🔧' },
] as const;

const CONDITION_LABELS: Record<string, string> = {
  normal: 'תקין',
  damaged: 'פגום',
  repair: 'דורש תיקון',
  lost: 'אבוד',
  withdrawn: 'הוצא משימוש',
};

interface Found {
  readonly copyId: string;
  readonly barcode: string;
  readonly title: string;
  readonly author: string | null;
  readonly category: string | null;
  readonly condition: string;
  readonly verifiedAt: string | null;
  readonly loanId: string | null;
  readonly borrower: string | null;
  readonly dueAt: string | null;
}

/** True where the browser can read a barcode from the camera itself. */
function hasDetector(): boolean {
  return typeof (window as { BarcodeDetector?: unknown }).BarcodeDetector === 'function';
}

export function ScanScreen(): JSX.Element {
  const [typed, setTyped] = useState('');
  const [found, setFound] = useState<Found | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  /** What the camera is reading right now, shown while it confirms it. */
  const [seeing, setSeeing] = useState<string | null>(null);

  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const looking = useRef(false);

  const look = useCallback(async (barcode: string): Promise<void> => {
    const code = barcode.trim();
    if (code === '') return;

    setBusy(true);
    setProblem(null);
    setMessage(null);

    try {
      const { data, error } = await supabase
        .from('book_copies')
        .select(
          'public_id, barcode, condition_status, verified_at, books(title, author_text, categories(name))',
        )
        .eq('barcode', code)
        .maybeSingle();

      if (error !== null) throw new Error(error.message);
      if (data === null) {
        setFound(null);
        setProblem(`לא נמצא ספר עם המספר ${code}.`);
        return;
      }

      // The open loan is a second question, asked separately so a copy with no
      // loan is still shown rather than disappearing behind an inner join.
      const { data: loan } = await supabase
        .from('loans')
        .select('public_id, due_at, students(first_name, last_name)')
        .eq('copy_id', data.public_id)
        .is('returned_at', null)
        .maybeSingle();

      const book = data.books as unknown as {
        title: string;
        author_text: string | null;
        categories: { name: string } | null;
      } | null;
      const who = (loan?.students ?? null) as unknown as {
        first_name: string;
        last_name: string;
      } | null;

      setFound({
        copyId: data.public_id as string,
        barcode: data.barcode as string,
        title: book?.title ?? '—',
        author: book?.author_text ?? null,
        category: book?.categories?.name ?? null,
        condition: data.condition_status as string,
        verifiedAt: (data.verified_at as string | null) ?? null,
        loanId: (loan?.public_id as string | undefined) ?? null,
        borrower: who === null ? null : `${who.first_name} ${who.last_name}`,
        dueAt: (loan?.due_at as string | undefined) ?? null,
      });
      setTyped('');
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : 'החיפוש נכשל.');
    } finally {
      setBusy(false);
    }
  }, []);

  /** Sets the condition, which is the whole reason to walk into a classroom. */
  async function mark(condition: string): Promise<void> {
    if (found === null) return;
    setBusy(true);
    setProblem(null);
    try {
      const { error } = await supabase
        .from('book_copies')
        .update({
          condition_status: condition,
          verified_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('public_id', found.copyId);

      if (error !== null) throw new Error(error.message);
      setFound({ ...found, condition, verifiedAt: new Date().toISOString() });
      setMessage(`נרשם: ${CONDITION_LABELS[condition]}`);
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : 'העדכון נכשל.');
    } finally {
      setBusy(false);
    }
  }

  /** Takes the book back, from wherever the person holding it is standing. */
  async function giveBack(): Promise<void> {
    if (found?.loanId === null || found === null) return;
    setBusy(true);
    setProblem(null);
    try {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('loans')
        .update({ returned_at: now, updated_at: now })
        .eq('public_id', found.loanId);

      if (error !== null) throw new Error(error.message);
      setFound({ ...found, loanId: null, borrower: null, dueAt: null });
      setMessage('הספר הוחזר.');
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : 'ההחזרה נכשלה.');
    } finally {
      setBusy(false);
    }
  }

  const stopCamera = useCallback(() => {
    looking.current = false;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    setCamera(false);
    setSeeing(null);
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  async function startCamera(): Promise<void> {
    setProblem(null);
    setFound(null);
    if (!hasDetector()) {
      setProblem('הדפדפן הזה לא יודע לקרוא ברקודים מהמצלמה. אפשר להקליד את המספר.');
      return;
    }

    try {
      // The back camera, because the book is in front of the phone.
      stream.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
      });
      if (video.current !== null) {
        video.current.srcObject = stream.current;
        await video.current.play();
      }
      setCamera(true);
      looking.current = true;

      const Detector = (window as unknown as { BarcodeDetector: new (o?: unknown) => {
        detect: (s: CanvasImageSource) => Promise<
          Array<{ rawValue: string; boundingBox?: { x: number; width: number } }>
        >;
      } }).BarcodeDetector;
      const detector = new Detector();

      let previous: string | null = null;

      const tick = async (): Promise<void> => {
        if (!looking.current || video.current === null) return;

        try {
          const codes = await detector.detect(video.current);

          // Only what is inside the aiming frame. A shelf of books fills the
          // picture with barcodes, and the one the phone is pointed at is the
          // one in the middle — otherwise it grabs a neighbour, which is
          // exactly what happened on the first try.
          const width = video.current.videoWidth || 1;
          const aimed = codes.filter((code) => {
            const box = code.boundingBox;
            if (box === undefined) return true;
            const centre = (box.x + box.width / 2) / width;
            return centre > 0.2 && centre < 0.8;
          });

          const candidate = aimed[0]?.rawValue ?? null;
          if (candidate !== null && candidate !== '') {
            setSeeing(candidate);

            // Twice in a row, or not at all. One blurred frame can be read as
            // a number that was never printed, and a wrong book recorded
            // silently is worse than a scan that takes another half second.
            if (candidate === previous) {
              looking.current = false;
              await look(candidate);
              // The picture stays up for a moment so the person sees which
              // book was caught, rather than a window that vanishes.
              window.setTimeout(stopCamera, 900);
              return;
            }
            previous = candidate;
          } else {
            previous = null;
            setSeeing(null);
          }
        } catch {
          // A frame that cannot be read is normal; the next one usually can.
        }

        window.setTimeout(() => void tick(), 180);
      };
      void tick();
    } catch {
      setProblem('אין גישה למצלמה. אפשר לאשר בהגדרות הדפדפן, או להקליד את המספר.');
    }
  }

  return (
    <section className="card">
      <h2>📷 סריקת ספר</h2>
      <p className="hint">
        לבדיקת ספרים בכיתות: סרוק או הקלד מספר, וראה מה הקטלוג יודע עליו.
      </p>

      {problem !== null && <p className="notice notice-error">{problem}</p>}
      {message !== null && <p className="notice notice-ok">{message}</p>}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void look(typed);
        }}
        className="scan-row"
      >
        <input
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          inputMode="numeric"
          placeholder="מספר הספר"
          aria-label="מספר הספר"
          dir="ltr"
        />
        <button type="submit" className="btn btn-primary" disabled={busy || typed.trim() === ''}>
          חפש
        </button>
      </form>

      <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
        {camera ? (
          <button type="button" className="btn" onClick={stopCamera}>
            סגור מצלמה
          </button>
        ) : (
          <button type="button" className="btn" onClick={() => void startCamera()}>
            📷 פתח מצלמה
          </button>
        )}
      </div>

      {camera && (
        <div className="viewfinder">
          <video ref={video} playsInline muted />
          {/* A window to aim through, and a line that sweeps it. Without
              these a person holds the phone at nothing in particular and the
              reader takes whichever barcode happens to be in the picture. */}
          <div className="viewfinder-frame">
            <span className="viewfinder-line" />
          </div>
          <div className="viewfinder-caption">
            {seeing === null ? 'כוון את הפס האדום אל הברקוד' : `קורא… ${seeing}`}
          </div>
        </div>
      )}

      {!camera && <video ref={video} playsInline muted style={{ display: 'none' }} />}

      {found !== null && (
        <div className="index-card" style={{ marginTop: '1.25rem' }}>
          <div>
            <p className="card-title">{found.title}</p>
            <p className="card-line">{found.author ?? 'ללא מחבר'}</p>
            <p className="card-line">
              {found.category ?? 'ללא קטגוריה'} · מס׳{' '}
              <span dir="ltr" className="card-number">{found.barcode}</span>
            </p>

            <p className="card-line">
              {found.borrower === null
                ? '📗 על המדף — לא מושאל'
                : `📕 מושאל ל${found.borrower}`}
            </p>

            <div className="form-actions" style={{ justifyContent: 'flex-start', marginTop: '0.9rem' }}>
              <span className="hint" style={{ marginInlineEnd: '0.4rem' }}>
                מצב: <strong>{CONDITION_LABELS[found.condition] ?? found.condition}</strong>
              </span>
              {CONDITIONS.map((entry) => (
                <button
                  key={entry.value}
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => void mark(entry.value)}
                >
                  {entry.mark} {entry.label}
                </button>
              ))}
              {found.loanId !== null && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void giveBack()}
                >
                  ↩️ החזר את הספר
                </button>
              )}
              <button type="button" className="btn" onClick={() => setFound(null)}>
                נקה
              </button>
            </div>
          </div>

          <div className={`stamp ${found.condition === 'normal' ? 'stamp-ok' : 'stamp-repeat'}`}>
            {CONDITION_LABELS[found.condition] ?? found.condition}
          </div>
        </div>
      )}
    </section>
  );
}
