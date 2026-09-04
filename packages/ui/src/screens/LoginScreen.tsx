import { useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../api.js';
import { Field } from '../components/Field.js';
import { Notice } from '../components/Notice.js';

interface LoginScreenProps {
  /** True while no account exists: the first run creates the administrator. */
  readonly setupRequired: boolean;
  readonly onSignedIn: () => Promise<void> | void;
}

/**
 * Sign in, or create the first administrator.
 *
 * One screen for both, because they are the same moment from the librarian's
 * side: the system is asking who you are. Which one it shows is decided by the
 * service, not by the browser.
 */
export function LoginScreen({ setupRequired, onSignedIn }: LoginScreenProps): JSX.Element {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
  }, []);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      if (setupRequired) {
        await api.setup({ username, password, displayName });
      } else {
        await api.login(username, password);
      }
      await onSignedIn();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'ההתחברות נכשלה. נסה שוב.');
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="brand">
          <h1>ספריית בית הספר</h1>
        </div>

        <section className="card">
          <h2>{setupRequired ? 'הגדרה ראשונית' : 'כניסה למערכת'}</h2>

        {setupRequired && (
          <p className="hint">
            אין עדיין משתמשים במערכת. המשתמש הראשון שתיצור יהיה מנהל המערכת, ויוכל להוסיף
            ספרנים נוספים.
          </p>
        )}

        {error !== null && <Notice kind="error">{error}</Notice>}

        <form onSubmit={(event) => void submit(event)}>
          {setupRequired && (
            <Field label="שם לתצוגה" htmlFor="displayName">
              <input
                id="displayName"
                ref={first}
                type="text"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                autoComplete="name"
              />
            </Field>
          )}

          <Field label="שם משתמש" htmlFor="username">
            <input
              id="username"
              ref={setupRequired ? undefined : first}
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              dir="ltr"
            />
          </Field>

          <Field label="סיסמה" htmlFor="password">
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={setupRequired ? 'new-password' : 'current-password'}
              dir="ltr"
            />
          </Field>

          {setupRequired && <p className="hint">לפחות 8 תווים.</p>}

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'רגע…' : setupRequired ? 'צור מנהל מערכת' : 'כניסה'}
            </button>
          </div>
        </form>
        </section>
      </div>
    </div>
  );
}
