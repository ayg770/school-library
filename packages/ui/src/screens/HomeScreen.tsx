import { useEffect, useState } from 'react';
import { api, formatDate, plural, type DashboardSummary, type Loan, type Role } from '../api.js';
import { Notice } from '../components/Notice.js';

interface HomeScreenProps {
  readonly displayName: string;
  readonly role: Role;
  readonly onGo: (screen: string) => void;
}

/**
 * The home screen — PRODUCT_SPEC.md §25.
 *
 * A KPI row rather than a chart: these are a handful of headline numbers, and
 * a bar chart of four counts would say less than the numbers themselves. Each
 * tile carries a word as well as a colour, so nothing depends on hue alone.
 *
 * Below them, the two things a librarian does all day, as targets big enough
 * to hit without looking.
 */
export function HomeScreen({ displayName, role, onGo }: HomeScreenProps): JSX.Element {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [overdue, setOverdue] = useState<Loan[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [dashboard, loans] = await Promise.all([
          api.dashboard(),
          api.listLoans({ status: 'overdue' }),
        ]);
        if (cancelled) return;
        setSummary(dashboard);
        setOverdue(loans.items.slice(0, 8));
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'טעינת המצב נכשלה');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const canLend = role !== 'read_only';

  return (
    <>
      <div className="page-head">
        <h2>שלום, {displayName}</h2>
        <p>תמונת מצב של הספרייה</p>
      </div>

      {error !== null && <Notice kind="error">{error}</Notice>}

      {summary !== null && (
        <>
          <div className="kpi-row">
            <div className="tile">
              <div className="label">מושאלים כעת</div>
              <div className="value">{summary.activeLoans}</div>
              <div className="note">{summary.copiesOnShelf} על המדף</div>
            </div>

            <div className={`tile ${summary.overdue > 0 ? 'tile-error' : 'tile-ok'}`}>
              <div className="label">באיחור</div>
              <div className="value">{summary.overdue}</div>
              <div className="note">{summary.overdue > 0 ? 'דורש טיפול' : 'אין איחורים'}</div>
            </div>

            <div className="tile">
              <div className="label">הושאלו היום</div>
              <div className="value">{summary.checkedOutToday}</div>
              <div className="note">{summary.returnedToday} הוחזרו</div>
            </div>

            <div className="tile">
              <div className="label">בקטלוג</div>
              <div className="value">{summary.titles}</div>
              <div className="note">
                {plural(summary.copies, 'עותק', 'עותקים')} ·{' '}
                {plural(summary.students, 'תלמיד', 'תלמידים')}
              </div>
            </div>
          </div>

          {canLend && (
            <div className="action-row">
              <button type="button" className="action action-primary" onClick={() => onGo('checkout')}>
                <div className="title">השאלה</div>
                <div className="subtitle">סרוק כרטיס תלמיד, ואז ספרים</div>
              </button>
              <button type="button" className="action" onClick={() => onGo('return')}>
                <div className="title">החזרה</div>
                <div className="subtitle">סריקת הספר בלבד</div>
              </button>
              <button type="button" className="action" onClick={() => onGo('intake')}>
                <div className="title">קליטת ספרים</div>
                <div className="subtitle">הוספת ספר חדש למדף</div>
              </button>
            </div>
          )}
        </>
      )}

      <section className="card">
        <div className="card-header">
          <h2>ספרים באיחור</h2>
          <button type="button" className="btn-link" onClick={() => onGo('loans')}>
            כל ההשאלות
          </button>
        </div>

        {overdue.length === 0 ? (
          <p className="empty">אין ספרים באיחור.</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>ספר</th>
                  <th>תלמיד</th>
                  <th>כיתה</th>
                  <th>היה להחזרה עד</th>
                </tr>
              </thead>
              <tbody>
                {overdue.map((loan) => (
                  <tr key={loan.publicId}>
                    <td>{loan.bookTitle}</td>
                    <td>
                      {loan.studentLastName} {loan.studentFirstName}
                    </td>
                    <td>{loan.className ?? '—'}</td>
                    <td className="overdue-text">
                      {formatDate(loan.dueAt)} · {loan.daysOverdue} ימי איחור
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
