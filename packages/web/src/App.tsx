import { useEffect, useState } from 'react';
import { currentStaff, supabase, type StaffUser } from './supabase.js';
import { SignInScreen } from './screens/SignInScreen.js';
import { HomeScreen } from './screens/HomeScreen.js';
import { CatalogueScreen } from './screens/CatalogueScreen.js';
import { TaxonomyScreen } from './screens/TaxonomyScreen.js';

type Screen = 'home' | 'catalogue' | 'categories' | 'shelves';

const NAV: { id: Screen; label: string }[] = [
  { id: 'home', label: 'בית' },
  { id: 'catalogue', label: 'קטלוג' },
  { id: 'categories', label: 'קטגוריות' },
  { id: 'shelves', label: 'מיקומי מדף' },
];

/**
 * The office side of the library.
 *
 * Three states, and they are genuinely different: signed out, signed in but
 * not recognised as staff, and at work. The middle one is the easy one to get
 * wrong — anyone may create a Supabase account, and someone who does would
 * otherwise land on an application showing nothing, with no explanation.
 */
export function App(): JSX.Element {
  const [staff, setStaff] = useState<StaffUser | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [screen, setScreen] = useState<Screen>(
    () => (window.location.hash.replace('#', '') as Screen) || 'home',
  );

  useEffect(() => {
    // Both the current session and every later change: a token that expires
    // while the page is open should return the person to the sign-in screen,
    // not to a screen that quietly stops loading anything.
    const apply = async (hasSession: boolean): Promise<void> => {
      setSignedIn(hasSession);
      setStaff(hasSession ? await currentStaff() : null);
    };

    void supabase.auth.getSession().then(({ data }) => void apply(data.session !== null));

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      void apply(session !== null);
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const onHash = (): void =>
      setScreen((window.location.hash.replace('#', '') as Screen) || 'home');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (signedIn === null) {
    return (
      <div className="auth-screen">
        <p className="empty">רגע…</p>
      </div>
    );
  }

  if (!signedIn) return <SignInScreen />;

  if (staff === null) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="brand">
            <h1>אין לך עדיין הרשאה</h1>
          </div>
          <section className="card">
          <p>
            החשבון נוצר בהצלחה, אבל הוא עוד לא משויך לספרייה. מנהל המערכת צריך להוסיף את כתובת
            הדוא״ל שלך לרשימת המשתמשים.
          </p>
          <p className="hint">אחרי שזה ייעשה — התנתק והתחבר שוב.</p>
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => void supabase.auth.signOut()}>
                התנתק
              </button>
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <h1>ספריית בית הספר</h1>
          <div className="who">
            {staff.display_name} · {staff.role === 'admin' ? 'מנהל מערכת' : 'ניהול'}
          </div>
        </div>

        <nav aria-label="ניווט ראשי">
          <div className="sidebar-group">
            <h2>ניהול</h2>
            {NAV.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  window.location.hash = item.id;
                  setScreen(item.id);
                }}
                aria-current={screen === item.id ? 'page' : undefined}
              >
                {item.label}
              </button>
            ))}
          </div>
        </nav>

        <div className="sidebar-footer">
          <button type="button" className="btn" onClick={() => void supabase.auth.signOut()}>
            התנתק
          </button>
        </div>
      </aside>

      <main className="content">
        {screen === 'home' && <HomeScreen displayName={staff.display_name} />}
        {screen === 'catalogue' && <CatalogueScreen />}
        {screen === 'categories' && <TaxonomyScreen kind="categories" />}
        {screen === 'shelves' && <TaxonomyScreen kind="shelf_locations" />}
      </main>
    </div>
  );
}
