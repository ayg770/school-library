import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, formatDateTime, type SyncReport, type SyncStatus } from '../api.js';
import { Notice } from '../components/Notice.js';

/**
 * The link to the online library — ARCHITECTURE.md AD-9.
 *
 * The screen has one job beyond the button: to make it obvious that lending
 * books does not depend on any of this. The catalogue and the pupils are
 * decided in the office and arrive here; what happens at the desk is recorded
 * here and goes up when it can. A librarian who never opens this screen is not
 * doing anything wrong.
 */

const TABLE_LABELS: Record<string, string> = {
  categories: 'קטגוריות',
  shelf_locations: 'מיקומי מדף',
  classes: 'כיתות',
  staff_users: 'משתמשים',
  books: 'ספרים',
  students: 'תלמידים',
  book_copies: 'עותקים',
  loans: 'השאלות',
};

export function SyncScreen({ isAdmin }: { readonly isAdmin: boolean }): JSX.Element {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [report, setReport] = useState<SyncReport | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setStatus(await api.syncStatus());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'טעינת מצב הסנכרון נכשלה');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function connect(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      setStatus(await api.connectSync(email, password));
      setPassword('');
      setMessage('המחשב חובר לספרייה שבאונליין. אפשר לסנכרן.');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'החיבור נכשל.');
    } finally {
      setBusy(false);
    }
  }

  async function run(): Promise<void> {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.runSync();
      setReport(result.report);
      setStatus(result.status);
      setMessage('הסנכרון הסתיים.');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'הסנכרון נכשל.');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(): Promise<void> {
    setBusy(true);
    try {
      setStatus(await api.disconnectSync());
      setReport(null);
      setMessage('החיבור נותק. כל מה שכבר ירד נשאר כאן.');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'הניתוק נכשל.');
    } finally {
      setBusy(false);
    }
  }

  if (status === null) {
    return (
      <>
        <div className="page-head">
          <h2>סנכרון</h2>
        </div>
        {error !== null && <Notice kind="error">{error}</Notice>}
        {error === null && <p className="empty">רגע…</p>}
      </>
    );
  }

  const received = report?.pulled.filter((table) => table.added + table.updated > 0) ?? [];

  return (
    <>
      <div className="page-head">
        <h2>סנכרון עם הספרייה שבאונליין</h2>
        <p>הקטלוג והתלמידים יורדים מהמשרד. ההשאלות וההחזרות שנעשו כאן עולות לשם.</p>
      </div>

      {error !== null && <Notice kind="error">{error}</Notice>}
      {message !== null && <Notice kind="ok">{message}</Notice>}

      <div className="notice" role="note">
        <strong>הספרייה עובדת גם בלי אינטרנט.</strong>
        <p style={{ margin: '0.4rem 0 0' }}>
          השאלה והחזרה נרשמות כאן תמיד. הסנכרון רק מעדכן את שני הצדדים כשיש חיבור.
        </p>
      </div>

      {!status.connected ? (
        <section className="card">
          <div className="card-header">
            <h2>חיבור ראשון</h2>
          </div>
          {isAdmin ? (
            <>
              <p className="hint">
                הזן את כתובת הדוא״ל והסיסמה של חשבון שהוגדר באתר הניהול. הסיסמה אינה נשמרת כאן.
              </p>
              <form onSubmit={(event) => void connect(event)}>
                <div className="field">
                  <label htmlFor="sync-email">כתובת דוא״ל</label>
                  <input
                    id="sync-email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="username"
                    dir="ltr"
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="sync-password">סיסמה</label>
                  <input
                    id="sync-password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="current-password"
                    dir="ltr"
                    required
                  />
                </div>
                <div className="form-actions">
                  <button type="submit" className="btn btn-primary" disabled={busy}>
                    {busy ? 'מתחבר…' : 'חבר את המחשב'}
                  </button>
                </div>
              </form>
            </>
          ) : (
            <p className="hint">המחשב עדיין לא חובר לאונליין. מנהל המערכת מבצע את החיבור פעם אחת.</p>
          )}
        </section>
      ) : (
        <>
          <div className="kpi-row">
            <div className="tile">
              <div className="label">עדכון אחרון מהמשרד</div>
              <div className="value" style={{ fontSize: '1.1rem' }}>
                {status.lastPulledAt === null ? 'עדיין לא' : formatDateTime(status.lastPulledAt)}
              </div>
              <div className="note">{status.connectedEmail ?? ''}</div>
            </div>

            <div className={`tile ${status.waitingToSend > 0 ? 'tile-warn' : ''}`}>
              <div className="label">ממתין לעלות</div>
              <div className="value">{status.waitingToSend}</div>
              <div className="note">השאלות והחזרות שנרשמו כאן</div>
            </div>

            <div className={`tile ${status.waitingSuggestions > 0 ? 'tile-warn' : ''}`}>
              <div className="label">המלצות מהמשרד</div>
              <div className="value">{status.waitingSuggestions}</div>
              <div className="note">
                {status.waitingSuggestions > 0 ? 'הספר מושאל כאן למישהו אחר' : 'אין ממתינות'}
              </div>
            </div>
          </div>

          <section className="card">
            <div className="card-header">
              <h2>סנכרן עכשיו</h2>
            </div>
            <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
              <button type="button" className="btn btn-primary" onClick={() => void run()} disabled={busy}>
                {busy ? 'מסנכרן…' : 'סנכרן'}
              </button>
              {isAdmin && (
                <button type="button" className="btn" onClick={() => void disconnect()} disabled={busy}>
                  נתק את המחשב
                </button>
              )}
            </div>

            {status.lastError !== null && (
              <p className="hint" style={{ marginTop: '0.8rem' }}>
                הניסיון האחרון נכשל: {status.lastError}
              </p>
            )}

            {status.accountsWithoutPassword > 0 && (
              <p className="hint" style={{ marginTop: '0.8rem' }}>
                {status.accountsWithoutPassword} משתמשים הגיעו מהמשרד ועדיין אין להם סיסמה כאן. קבע להם
                סיסמה במסך <strong>משתמשים</strong>.
              </p>
            )}
          </section>
        </>
      )}

      {report !== null && (
        <section className="card">
          <div className="card-header">
            <h2>מה קרה בסנכרון האחרון</h2>
          </div>

          <p style={{ marginTop: 0 }}>
            עלו <strong>{report.pushed}</strong> השאלות והחזרות.
            {report.confirmed > 0 && <> אושרו <strong>{report.confirmed}</strong> המלצות מהמשרד.</>}
            {report.stillPending > 0 && (
              <> <strong>{report.stillPending}</strong> המלצות עדיין ממתינות.</>
            )}
          </p>

          {received.length === 0 ? (
            <p className="hint">לא הגיעו שינויים חדשים מהמשרד.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>מה</th>
                    <th>נוספו</th>
                    <th>עודכנו</th>
                  </tr>
                </thead>
                <tbody>
                  {received.map((table) => (
                    <tr key={table.table}>
                      <td>{TABLE_LABELS[table.table] ?? table.table}</td>
                      <td>{table.added}</td>
                      <td>{table.updated}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {report.problems.length > 0 && (
            <>
              <h3 style={{ marginBottom: '0.4rem' }}>דברים שדורשים תשומת לב</h3>
              <ul>
                {report.problems.map((problem, index) => (
                  <li key={`${problem.what}-${index}`}>
                    <strong>{problem.what}</strong> — {problem.why}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </>
  );
}
