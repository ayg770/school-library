import { useEffect, useState } from 'react';
import { supabase } from '../supabase.js';

interface Counts {
  books: number;
  copies: number;
  students: number;
  openLoans: number;
  pending: number;
  lastSync: string | null;
}

/**
 * What the office needs to know at a glance.
 *
 * The last figure is the one that is specific to this side of the system: how
 * recently the library computer last spoke to this database. Everything shown
 * here is as fresh as that moment, and saying so is more honest than showing
 * numbers that look live.
 */
export function HomeScreen({ displayName }: { displayName: string }): JSX.Element {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const head = { count: 'exact' as const, head: true };
        const [books, copies, students, open, pending, latest] = await Promise.all([
          supabase.from('books').select('public_id', head).eq('active', true),
          supabase.from('book_copies').select('public_id', head),
          supabase.from('students').select('public_id', head).eq('active', true),
          supabase
            .from('loans')
            .select('public_id', head)
            .is('returned_at', null)
            .not('confirmed_at', 'is', null),
          supabase.from('loans').select('public_id', head).is('confirmed_at', null),
          supabase
            .from('loans')
            .select('updated_at')
            .eq('origin', 'library')
            .order('updated_at', { ascending: false })
            .limit(1),
        ]);

        if (cancelled) return;

        setCounts({
          books: books.count ?? 0,
          copies: copies.count ?? 0,
          students: students.count ?? 0,
          openLoans: open.count ?? 0,
          pending: pending.count ?? 0,
          lastSync: (latest.data?.[0] as { updated_at: string } | undefined)?.updated_at ?? null,
        });
      } catch (cause) {
        if (!cancelled) setProblem(cause instanceof Error ? cause.message : 'טעינת המצב נכשלה');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const empty = counts !== null && counts.books === 0 && counts.students === 0;

  return (
    <>
      <div className="page-head">
        <h2>שלום, {displayName}</h2>
        <p>ניהול הספרייה מהמשרד</p>
      </div>

      {problem !== null && (
        <div className="notice notice-error" role="alert">
          {problem}
        </div>
      )}

      {empty && (
        <div className="notice" role="status">
          <strong>המסד עדיין ריק.</strong>
          <p style={{ margin: '0.4rem 0 0' }}>
            הוא יתמלא כשהתוכנה בספרייה תסנכרן בפעם הראשונה. עד אז אפשר כבר להגדיר כאן קטגוריות
            ומדפים — הם יחכו לה.
          </p>
        </div>
      )}

      {counts !== null && (
        <>
          <div className="kpi-row">
            <div className="tile">
              <div className="label">בקטלוג</div>
              <div className="value">{counts.books}</div>
              <div className="note">{counts.copies} עותקים</div>
            </div>

            <div className="tile">
              <div className="label">מושאלים כעת</div>
              <div className="value">{counts.openLoans}</div>
              <div className="note">נרשמו בספרייה</div>
            </div>

            <div className={`tile ${counts.pending > 0 ? 'tile-warn' : ''}`}>
              <div className="label">ממתינות לאישור</div>
              <div className="value">{counts.pending}</div>
              <div className="note">
                {counts.pending > 0 ? 'עד הסנכרון הבא' : 'אין המלצות פתוחות'}
              </div>
            </div>

            <div className="tile">
              <div className="label">תלמידים</div>
              <div className="value">{counts.students}</div>
              <div className="note">פעילים</div>
            </div>
          </div>

          <section className="card">
            <div className="card-header">
              <h2>סנכרון</h2>
            </div>
            <p className="hint" style={{ margin: 0 }}>
              {counts.lastSync === null ? (
                <>התוכנה בספרייה עדיין לא סנכרנה. המספרים למעלה הם מה שהוזן כאן בלבד.</>
              ) : (
                <>
                  עדכון אחרון מהספרייה:{' '}
                  <strong>{new Date(counts.lastSync).toLocaleString('he-IL')}</strong>. השאלות
                  והחזרות שנעשו שם מאז יופיעו כאן בסנכרון הבא.
                </>
              )}
            </p>
          </section>
        </>
      )}
    </>
  );
}
