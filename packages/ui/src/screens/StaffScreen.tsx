import { useCallback, useEffect, useState } from 'react';
import { ApiError, ROLE_LABELS, api, type Role, type StaffUser } from '../api.js';
import { Field } from '../components/Field.js';
import { Notice } from '../components/Notice.js';

interface StaffScreenProps {
  /** The signed-in administrator, so the screen can mark their own row. */
  readonly currentUser: StaffUser;
}

const ROLES: Role[] = ['admin', 'librarian', 'read_only'];

const ROLE_NOTES: Record<Role, string> = {
  admin: 'הכול, כולל ניהול משתמשים, גיבוי ושחזור',
  librarian: 'השאלה, החזרה, קטלוג וייבוא',
  read_only: 'צפייה בלבד, בלי לשנות דבר',
};

/** Staff accounts — administrators only (§21). */
export function StaffScreen({ currentUser }: StaffScreenProps): JSX.Element {
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [creating, setCreating] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<Role>('librarian');

  const [resetting, setResetting] = useState<StaffUser | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setUsers((await api.listStaff()).items);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'טעינת המשתמשים נכשלה');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>, success: string): Promise<void> {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      await load();
      setMessage(success);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'הפעולה נכשלה.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error !== null && <Notice kind="error">{error}</Notice>}
      {message !== null && <Notice kind="ok">{message}</Notice>}

      {creating && (
        <section className="card">
          <h2>משתמש חדש</h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(
                () => api.createStaff({ username, password, displayName, role }),
                'המשתמש נוצר.',
              ).then(() => {
                setCreating(false);
                setUsername('');
                setPassword('');
                setDisplayName('');
                setRole('librarian');
              });
            }}
          >
            <div className="field-row">
              <Field label="שם לתצוגה" htmlFor="new-display">
                <input
                  id="new-display"
                  type="text"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </Field>
              <Field label="שם משתמש" htmlFor="new-username">
                <input
                  id="new-username"
                  type="text"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  dir="ltr"
                />
              </Field>
            </div>

            <div className="field-row">
              <Field label="סיסמה" htmlFor="new-password">
                <input
                  id="new-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  dir="ltr"
                />
              </Field>
              <Field label="הרשאה" htmlFor="new-role">
                <select id="new-role" value={role} onChange={(event) => setRole(event.target.value as Role)}>
                  {ROLES.map((item) => (
                    <option key={item} value={item}>
                      {ROLE_LABELS[item]}
                    </option>
                  ))}
                </select>
                <p className="hint">{ROLE_NOTES[role]}</p>
              </Field>
            </div>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                צור
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => setCreating(false)}>
                ביטול
              </button>
            </div>
          </form>
        </section>
      )}

      {resetting !== null && (
        <section className="card">
          <h2>סיסמה חדשה ל{resetting.displayName}</h2>
          <p className="hint">שינוי סיסמה מנתק את המשתמש מכל המכשירים שבהם הוא מחובר.</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(
                () => api.updateStaff(resetting.publicId, { password: newPassword }),
                'הסיסמה עודכנה.',
              ).then(() => {
                setResetting(null);
                setNewPassword('');
              });
            }}
          >
            <Field label="סיסמה חדשה" htmlFor="reset-password">
              <input
                id="reset-password"
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                dir="ltr"
                autoFocus
              />
            </Field>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                עדכן
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => setResetting(null)}>
                ביטול
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="card">
        <div className="card-header">
          <h2>משתמשים</h2>
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            משתמש חדש
          </button>
        </div>

        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>שם</th>
                <th>שם משתמש</th>
                <th>הרשאה</th>
                <th>סטטוס</th>
                <th className="row-actions" />
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.publicId} className={user.active ? '' : 'is-inactive'}>
                  <td>
                    {user.displayName}
                    {user.publicId === currentUser.publicId && <span className="count"> · זה אתה</span>}
                  </td>
                  <td className="value-ltr">{user.username}</td>
                  <td>{ROLE_LABELS[user.role]}</td>
                  <td>
                    {user.active ? (
                      <span className="status status-ok">פעיל</span>
                    ) : (
                      <span className="status status-neutral">מנוטרל</span>
                    )}
                  </td>
                  <td className="row-actions">
                    <button type="button" className="btn-link" onClick={() => setResetting(user)}>
                      סיסמה
                    </button>
                    <button
                      type="button"
                      className="btn-link"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () => api.updateStaff(user.publicId, { active: !user.active }),
                          user.active ? 'המשתמש נוטרל.' : 'המשתמש הופעל.',
                        )
                      }
                    >
                      {user.active ? 'נטרל' : 'הפעל'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
