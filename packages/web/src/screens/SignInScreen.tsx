import { useState } from 'react';
import { supabase } from '../supabase.js';

/**
 * Signing in to the office side.
 *
 * Two doors, deliberately: an account has to be created once before it can be
 * used, and a person who has never done it will otherwise sit typing a
 * password that was never set and being told it is wrong.
 *
 * Creating an account grants nothing by itself. Permission comes from a staff
 * row an administrator prepared, matched on this address — so the honest thing
 * to say after a successful sign-up is "ask to be given access", not "welcome".
 */
export function SignInScreen(): JSX.Element {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setProblem(null);
    setNotice(null);

    try {
      if (mode === 'in') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error !== null) {
          // The same message for a wrong address and a wrong password, so the
          // form cannot be used to find out which accounts exist.
          setProblem('שם משתמש או סיסמה שגויים.');
        }
        return;
      }

      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error !== null) {
        setProblem(error.message);
        return;
      }
      // Supabase may require the address to be confirmed first; when it does,
      // there is no session yet and saying "you are in" would be a lie.
      setNotice(
        data.session === null
          ? 'החשבון נוצר. בדוק את תיבת הדואר שלך כדי לאשר את הכתובת, ואז התחבר.'
          : 'החשבון נוצר.',
      );
      setMode('in');
    } catch {
      setProblem('לא ניתן להתחבר כרגע. בדוק את החיבור לאינטרנט ונסה שוב.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="brand">
          <h1>ספריית בית הספר</h1>
          <p>ניהול — מהמשרד</p>
        </div>

        <section className="card">

        {problem !== null && (
          <div className="notice notice-error" role="alert">
            {problem}
          </div>
        )}
        {notice !== null && (
          <div className="notice notice-ok" role="status">
            {notice}
          </div>
        )}

        <form onSubmit={(event) => void submit(event)}>
          <div className="field">
            <label htmlFor="email">כתובת דוא״ל</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
              dir="ltr"
              required
            />
          </div>

          <div className="field">
            <label htmlFor="password">סיסמה</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
              dir="ltr"
              required
              minLength={8}
            />
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'רגע…' : mode === 'in' ? 'התחבר' : 'צור חשבון'}
            </button>
          </div>
        </form>

        <p className="hint">
          {mode === 'in' ? (
            <>
              פעם ראשונה?{' '}
              <button type="button" className="btn-link" onClick={() => setMode('up')}>
                צור חשבון
              </button>
            </>
          ) : (
            <>
              כבר יש לך חשבון?{' '}
              <button type="button" className="btn-link" onClick={() => setMode('in')}>
                התחבר
              </button>
            </>
          )}
        </p>
        </section>
      </div>
    </div>
  );
}
