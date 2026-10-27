import { useEffect, useRef, useState } from 'react';
import {
  ACTION_EMOJI,
  ACTION_LABELS,
  api,
  formatDate,
  type CountedAction,
  type StaffProgress,
} from '../api.js';
import { Notice } from '../components/Notice.js';

/**
 * What each librarian has done.
 *
 * A morning of counting shelves leaves nothing behind to look at: the books
 * are back where they were, and the number on the stocktake screen resets
 * with the next round. The volunteers are children, and this is the screen
 * where the work stays — their own tally, the rank it adds up to, and how far
 * the next one is.
 *
 * Everyone's name is on it, including at zero. A board that lists only people
 * who have already done something leaves out exactly the child whose first
 * morning it is.
 */

const ORDER: readonly CountedAction[] = [
  'copy.counted',
  'loan.checked_out',
  'loan.returned',
  'copy.added',
  'report.filed',
];

/** Remembers the rank each person had last time, to notice a promotion. */
const SEEN_KEY = 'school-library:rank-seen';

function readSeen(): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    return raw === null ? {} : (JSON.parse(raw) as Record<string, number>);
  } catch {
    // A browser with storage switched off still gets the screen, just without
    // the congratulations.
    return {};
  }
}

function writeSeen(seen: Record<string, number>): void {
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    /* nothing to do: the tally is on the screen either way */
  }
}

export function ProgressScreen({
  username,
}: {
  /**
   * Whose card is lifted to the top and congratulated.
   *
   * By username rather than display name: two volunteers called מנדי would
   * otherwise both be told they are each other.
   */
  readonly username: string;
}): JSX.Element {
  const [people, setPeople] = useState<readonly StaffProgress[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Set when the person looking has gone up a rank since they last looked. */
  const [promoted, setPromoted] = useState<StaffProgress | null>(null);

  const checked = useRef(false);

  useEffect(() => {
    let live = true;

    api
      .progress()
      .then((reply) => {
        if (!live) return;
        setPeople(reply.items);

        // Once per visit, and only for the person signed in: a promotion is
        // something that happened to them, not a notification about someone
        // else's morning.
        if (checked.current) return;
        checked.current = true;

        const seen = readSeen();
        const me = reply.items.find((person) => person.username === username);
        if (me === undefined) return;

        const before = seen[me.username];
        if (before !== undefined && me.rank.level > before) setPromoted(me);
        if (before !== me.rank.level) writeSeen({ ...seen, [me.username]: me.rank.level });
      })
      .catch((cause: unknown) => {
        if (!live) return;
        setError(cause instanceof Error ? cause.message : 'טעינת ההתקדמות נכשלה.');
      });

    return () => {
      live = false;
    };
  }, [username]);

  if (error !== null) {
    return (
      <>
        <div className="page-head">
          <h2>🏅 ההתקדמות שלנו</h2>
        </div>
        <Notice kind="error">{error}</Notice>
      </>
    );
  }

  if (people === null) {
    return (
      <>
        <div className="page-head">
          <h2>🏅 ההתקדמות שלנו</h2>
        </div>
        <p className="empty">רגע…</p>
      </>
    );
  }

  const me = people.find((person) => person.username === username) ?? null;
  const others = people
    .filter((person) => person !== me)
    .slice()
    .sort((a, b) => b.total - a.total);

  return (
    <>
      <div className="page-head">
        <h2>🏅 ההתקדמות שלנו</h2>
        <p>כל ספר שנספר, הושאל, הוחזר או נקלט — נרשם על שם מי שעשה אותו.</p>
      </div>

      {promoted !== null && (
        <div className="cheer" role="status">
          <span className="cheer-emoji" aria-hidden="true">
            {promoted.rank.emoji}
          </span>
          <div>
            <p className="cheer-title">כל הכבוד, {promoted.displayName}!</p>
            <p className="cheer-line">
              עלית לדרגת <strong>{promoted.rank.title}</strong> — {promoted.total.toLocaleString('he-IL')} פעולות
            </p>
          </div>
          <button type="button" className="btn" onClick={() => setPromoted(null)}>
            תודה
          </button>
        </div>
      )}

      {me !== null && <ProgressCard person={me} mine />}

      {others.length > 0 && (
        <section className="card">
          <div className="card-header">
            <h2>כל הספרנים</h2>
            <span className="count">{people.length} משתמשים</span>
          </div>
          <div className="progress-list">
            {others.map((person) => (
              <ProgressCard key={person.username} person={person} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

/** One person: the rank, the bar to the next one, and what made it up. */
function ProgressCard({
  person,
  mine = false,
}: {
  readonly person: StaffProgress;
  readonly mine?: boolean;
}): JSX.Element {
  // How far along the current rung, so the bar fills within the rank rather
  // than against the top of the ladder — the first rank would otherwise look
  // like nothing had happened at all.
  const span = person.nextRank === null ? 1 : person.nextRank.from - person.rank.from;
  const done = person.total - person.rank.from;
  const percent = person.nextRank === null ? 100 : Math.min(100, Math.round((done / span) * 100));

  return (
    <section className={mine ? 'card progress-card progress-mine' : 'progress-card'}>
      <div className="progress-head">
        <span className="rank-badge" aria-hidden="true">
          {person.rank.emoji}
        </span>
        <div>
          <p className="progress-name">
            {person.displayName}
            {mine && <span className="progress-you">זה אתה</span>}
          </p>
          <p className="progress-rank">
            {person.rank.title} · {person.total.toLocaleString('he-IL')} פעולות
          </p>
        </div>
        {person.lastActiveAt !== null && (
          <span className="progress-when">פעיל לאחרונה {formatDate(person.lastActiveAt)}</span>
        )}
      </div>

      <div
        className="rank-bar"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`התקדמות לדרגה הבאה: ${percent}%`}
      >
        <span className="rank-bar-fill" style={{ width: `${percent}%` }} />
      </div>

      <p className="progress-next">
        {person.nextRank === null ? (
          <>🎉 הדרגה הגבוהה ביותר</>
        ) : (
          <>
            עוד <strong>{person.toNextRank.toLocaleString('he-IL')}</strong> פעולות לדרגת{' '}
            {person.nextRank.emoji} {person.nextRank.title}
          </>
        )}
      </p>

      <ul className="progress-counts">
        {ORDER.map((action) => (
          <li key={action}>
            <span className="progress-count-value">
              {person.counts[action].toLocaleString('he-IL')}
            </span>
            <span className="progress-count-label">
              {ACTION_EMOJI[action]} {ACTION_LABELS[action]}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
