import { useEffect, useRef, useState } from 'react';
import { ApiError, api, ROLE_LABELS, type SignInName } from '../api.js';
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
 *
 * Signing in is two steps — pick the name, then type the code. The volunteers
 * are children, and a username typed wrong is indistinguishable from a code
 * typed wrong: the screen says the same thing either way, deliberately, so a
 * child who misspells their own name is told their code is wrong and tries
 * the code again. Picking from a list removes that half of the problem and
 * leaves the half that is meant to be secret.
 */
export function LoginScreen({ setupRequired, onSignedIn }: LoginScreenProps): JSX.Element {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** The names to choose from; null until the service answers. */
  const [people, setPeople] = useState<readonly SignInName[] | null>(null);
  /** Who was picked. Null means the list is still on screen. */
  const [chosen, setChosen] = useState<SignInName | null>(null);
  /**
   * Set when there is no list to show — an empty library, or a service that
   * did not answer. The name is then typed, which is what this screen did
   * before, so a failure here is never a way of locking everyone out.
   */
  const [typeName, setTypeName] = useState(false);

  const first = useRef<HTMLInputElement>(null);
  const code = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (setupRequired) {
      first.current?.focus();
      return;
    }

    let live = true;
    void api
      .signInNames()
      .then((reply) => {
        if (!live) return;
        setPeople(reply.items);
        // One librarian and nobody else: a list of one is a step for nothing.
        if (reply.items.length === 1) setChosen(reply.items[0] ?? null);
        if (reply.items.length === 0) setTypeName(true);
      })
      .catch(() => {
        if (!live) return;
        setPeople([]);
        setTypeName(true);
      });

    return () => {
      live = false;
    };
  }, [setupRequired]);

  // The code is what gets typed next, so that is where the cursor goes.
  useEffect(() => {
    if (chosen !== null) code.current?.focus();
  }, [chosen]);

  useEffect(() => {
    if (typeName) first.current?.focus();
  }, [typeName]);

  function pick(person: SignInName): void {
    setChosen(person);
    setUsername(person.username);
    setPassword('');
    setError(null);
  }

  /** Back to the list, with nothing typed left behind for the next person. */
  function startOver(): void {
    setChosen(null);
    setUsername('');
    setPassword('');
    setError(null);
  }

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
      // The service says "username or password", because a form where a name
      // can be typed must not reveal which of the two was wrong. A name that
      // was picked from the list cannot be the wrong one, so the screen says
      // the only thing that is actually in question.
      const wrongCode =
        chosen !== null && cause instanceof ApiError && cause.code === 'BAD_CREDENTIALS';

      setError(
        wrongCode
          ? 'הקוד שגוי. נסה שוב.'
          : cause instanceof ApiError
            ? cause.message
            : 'ההתחברות נכשלה. נסה שוב.',
      );
      // The name was picked and is still right; only the code was wrong, so
      // only the code is cleared and the cursor goes back to it.
      setPassword('');
      setBusy(false);
      if (!setupRequired) code.current?.focus();
    }
  }

  const choosing = !setupRequired && !typeName && chosen === null;

  return (
    <div className="auth-screen">
      <div className={choosing ? 'auth-card auth-card-wide' : 'auth-card'}>
        <div className="brand">
          <h1>ספריית בית הספר</h1>
        </div>

        <section className="card">
          <h2>{setupRequired ? 'הגדרה ראשונית' : choosing ? 'מי נמצא עכשיו?' : 'כניסה למערכת'}</h2>

          {setupRequired && (
            <p className="hint">
              אין עדיין משתמשים במערכת. המשתמש הראשון שתיצור יהיה מנהל המערכת, ויוכל להוסיף
              ספרנים נוספים.
            </p>
          )}

          {error !== null && <Notice kind="error">{error}</Notice>}

          {/* Step one: the names, as buttons big enough to press without
              aiming. Nothing is typed here. */}
          {choosing && (
            <>
              <p className="hint">בחר את השם שלך, ואז הקלד את הקוד.</p>

              {people === null ? (
                <p className="empty">רגע…</p>
              ) : (
                <ul className="people">
                  {people.map((person) => (
                    <li key={person.username}>
                      <button type="button" onClick={() => pick(person)}>
                        <span className="person-name">{person.displayName}</span>
                        <span className="person-role">{ROLE_LABELS[person.role]}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="form-actions">
                <button type="button" className="btn btn-link" onClick={() => setTypeName(true)}>
                  השם שלי לא ברשימה
                </button>
              </div>
            </>
          )}

          {!choosing && (
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

              {/* Step two. A picked name is shown, not offered for editing:
                  it was chosen from a list, and the only thing left here is
                  the code. */}
              {chosen !== null ? (
                <div className="chosen-person">
                  <div>
                    <span className="person-name">{chosen.displayName}</span>
                    <span className="person-role">{ROLE_LABELS[chosen.role]}</span>
                  </div>
                  {people !== null && people.length > 1 && (
                    <button type="button" className="btn" onClick={startOver}>
                      לא אני
                    </button>
                  )}
                </div>
              ) : (
                <Field label="שם משתמש" htmlFor="username">
                  <input
                    id="username"
                    ref={first}
                    type="text"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    autoComplete="username"
                    dir="auto"
                  />
                </Field>
              )}

              <Field label={setupRequired ? 'סיסמה' : 'קוד'} htmlFor="password">
                <input
                  id="password"
                  ref={code}
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={setupRequired ? 'new-password' : 'current-password'}
                  dir="ltr"
                />
              </Field>

              {setupRequired && <p className="hint">לפחות 4 תווים. ספרות בלבד זה בסדר.</p>}

              <div className="form-actions">
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? 'רגע…' : setupRequired ? 'צור מנהל מערכת' : 'כניסה'}
                </button>

                {/* A way back for someone who started typing their name and
                    then saw it was on the list all along. */}
                {!setupRequired && chosen === null && people !== null && people.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-link"
                    onClick={() => {
                      setTypeName(false);
                      startOver();
                    }}
                  >
                    חזרה לרשימת השמות
                  </button>
                )}
              </div>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
