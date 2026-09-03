import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, formatDate, type Loan } from '../api.js';
import { Notice } from '../components/Notice.js';

type StatusFilter = 'active' | 'overdue' | 'returned' | 'all';

const STATUS_LABELS: Record<StatusFilter, string> = {
  active: 'מושאלים כעת',
  overdue: 'באיחור',
  returned: 'הוחזרו',
  all: 'הכול',
};

/** Open and past loans, with the overdue view a librarian chases (§17). */
export function LoansScreen(): JSX.Element {
  const [status, setStatus] = useState<StatusFilter>('active');
  const [loans, setLoans] = useState<Loan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setLoans((await api.listLoans({ status })).items);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'טעינת ההשאלות נכשלה');
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function renew(loan: Loan): Promise<void> {
    setMessage(null);
    try {
      const renewed = await api.renew(loan.publicId);
      setMessage(`"${renewed.bookTitle}" הוארך עד ${formatDate(renewed.dueAt)}.`);
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'ההארכה נכשלה.');
    }
  }

  async function returnBook(loan: Loan): Promise<void> {
    setMessage(null);
    try {
      await api.checkin(loan.barcode);
      setMessage(`"${loan.bookTitle}" הוחזר.`);
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'ההחזרה נכשלה.');
    }
  }

  return (
    <>
      {error !== null && <Notice kind="error">{error}</Notice>}
      {message !== null && <Notice kind="ok">{message}</Notice>}

      <section className="card">
        <div className="card-header">
          <h2>השאלות</h2>
          <span className="count">{loans.length} רשומות</span>
        </div>

        <div className="toolbar">
          {(Object.keys(STATUS_LABELS) as StatusFilter[]).map((key) => (
            <button
              key={key}
              type="button"
              className={`btn ${status === key ? 'btn-primary' : ''}`}
              onClick={() => setStatus(key)}
            >
              {STATUS_LABELS[key]}
            </button>
          ))}
        </div>

        {loans.length === 0 ? (
          <p className="empty">אין השאלות להצגה.</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>ספר</th>
                  <th>ברקוד</th>
                  <th>תלמיד</th>
                  <th>כיתה</th>
                  <th>להחזרה עד</th>
                  <th>הוחזר</th>
                  <th className="row-actions" />
                </tr>
              </thead>
              <tbody>
                {loans.map((loan) => (
                  <tr key={loan.publicId}>
                    <td>{loan.bookTitle}</td>
                    <td className="value-ltr">{loan.barcode}</td>
                    <td>
                      {loan.studentLastName} {loan.studentFirstName}
                    </td>
                    <td>{loan.className ?? '—'}</td>
                    <td className={loan.overdue ? 'overdue-text' : ''}>
                      {formatDate(loan.dueAt)}
                      {loan.overdue && ` · ${loan.daysOverdue} ימי איחור`}
                    </td>
                    <td>{loan.returnedAt === null ? '—' : formatDate(loan.returnedAt)}</td>
                    <td className="row-actions">
                      {loan.returnedAt === null && (
                        <>
                          <button type="button" className="btn-link" onClick={() => void returnBook(loan)}>
                            החזרה
                          </button>
                          <button type="button" className="btn-link" onClick={() => void renew(loan)}>
                            הארכה
                          </button>
                        </>
                      )}
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
