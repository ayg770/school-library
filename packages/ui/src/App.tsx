import { useEffect, useState } from 'react';
import { ROLE_LABELS, type Role } from './api.js';
import { BackupScreen } from './screens/BackupScreen.js';
import { BooksScreen } from './screens/BooksScreen.js';
import { CatalogSetupScreen } from './screens/CatalogSetupScreen.js';
import { CheckoutScreen } from './screens/CheckoutScreen.js';
import { HomeScreen } from './screens/HomeScreen.js';
import { ImportScreen } from './screens/ImportScreen.js';
import { IntakeScreen } from './screens/IntakeScreen.js';
import { LoansScreen } from './screens/LoansScreen.js';
import { LoginScreen } from './screens/LoginScreen.js';
import { ReturnScreen } from './screens/ReturnScreen.js';
import { StaffScreen } from './screens/StaffScreen.js';
import { StudentsScreen } from './screens/StudentsScreen.js';
import { SupportScreen } from './screens/SupportScreen.js';
import { useSession } from './useSession.js';

type ScreenId =
  | 'home'
  | 'checkout'
  | 'return'
  | 'loans'
  | 'intake'
  | 'books'
  | 'students'
  | 'setup'
  | 'import'
  | 'backup'
  | 'staff'
  | 'support';

interface ScreenDefinition {
  readonly id: ScreenId;
  readonly label: string;
  /** The least privileged role that may open it. */
  readonly role: Role;
}

interface NavGroup {
  readonly title: string;
  readonly screens: readonly ScreenDefinition[];
}

/**
 * Grouped by when a librarian reaches for them, not by how the code is
 * organised: the daily tasks first, the catalogue behind them, administration
 * last.
 */
const NAV: readonly NavGroup[] = [
  {
    title: 'יומיומי',
    screens: [
      { id: 'home', label: 'בית', role: 'read_only' },
      { id: 'checkout', label: 'השאלה', role: 'librarian' },
      { id: 'return', label: 'החזרה', role: 'librarian' },
      { id: 'loans', label: 'השאלות', role: 'read_only' },
    ],
  },
  {
    title: 'קטלוג',
    screens: [
      { id: 'intake', label: 'קליטת ספרים', role: 'librarian' },
      { id: 'books', label: 'ספרים', role: 'read_only' },
      { id: 'students', label: 'תלמידים', role: 'read_only' },
      { id: 'setup', label: 'כיתות וקטגוריות', role: 'librarian' },
    ],
  },
  {
    title: 'ניהול',
    screens: [
      { id: 'import', label: 'ייבוא מקובץ', role: 'librarian' },
      { id: 'backup', label: 'גיבוי', role: 'admin' },
      { id: 'staff', label: 'משתמשים', role: 'admin' },
      { id: 'support', label: 'הגדרות ותמיכה', role: 'read_only' },
    ],
  },
];

const RANK: Record<Role, number> = { read_only: 0, librarian: 1, admin: 2 };

function allows(role: Role, required: Role): boolean {
  return RANK[role] >= RANK[required];
}

const ALL_SCREENS = NAV.flatMap((group) => group.screens);

export function App(): JSX.Element {
  const session = useSession();
  const [screen, setScreen] = useState<ScreenId>('home');

  // The screen lives in the address so a reload, or the browser's back button,
  // returns where the librarian was rather than to the first tab.
  useEffect(() => {
    const sync = (): void => {
      const id = window.location.hash.replace(/^#\/?/, '');
      setScreen((current) =>
        ALL_SCREENS.some((item) => item.id === id) ? (id as ScreenId) : current,
      );
    };
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  function go(id: string): void {
    window.location.hash = `/${id}`;
    setScreen(id as ScreenId);
  }

  if (session.loading) {
    // Nothing is drawn until the service says who is signed in, so a screen of
    // student names cannot appear before the session turns out to be invalid.
    return (
      <div className="auth-screen">
        <p className="empty">רגע…</p>
      </div>
    );
  }

  if (session.user === null) {
    return <LoginScreen setupRequired={session.setupRequired} onSignedIn={session.refresh} />;
  }

  const user = session.user;
  const groups = NAV.map((group) => ({
    ...group,
    screens: group.screens.filter((item) => allows(user.role, item.role)),
  })).filter((group) => group.screens.length > 0);

  // Hiding a screen is a convenience, not the control: the service refuses the
  // request regardless of what the interface offers.
  const permitted = groups.flatMap((group) => group.screens);
  const current = permitted.some((item) => item.id === screen)
    ? screen
    : (permitted[0]?.id ?? 'support');

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <h1>ספריית בית הספר</h1>
          <div className="who">
            {user.displayName} · {ROLE_LABELS[user.role]}
          </div>
        </div>

        <nav aria-label="ניווט ראשי">
          {groups.map((group) => (
            <div className="sidebar-group" key={group.title}>
              <h2>{group.title}</h2>
              {group.screens.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => go(item.id)}
                  aria-current={current === item.id ? 'page' : undefined}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button type="button" className="btn" onClick={() => void session.signOut()}>
            יציאה
          </button>
        </div>
      </aside>

      <main className="content">
        {current === 'home' && (
          <HomeScreen displayName={user.displayName} role={user.role} onGo={go} />
        )}
        {current === 'checkout' && <CheckoutScreen />}
        {current === 'return' && <ReturnScreen />}
        {current === 'loans' && <LoansScreen />}
        {current === 'intake' && <IntakeScreen />}
        {current === 'books' && <BooksScreen />}
        {current === 'students' && <StudentsScreen />}
        {current === 'setup' && <CatalogSetupScreen />}
        {current === 'import' && <ImportScreen />}
        {current === 'backup' && <BackupScreen />}
        {current === 'staff' && <StaffScreen currentUser={user} />}
        {current === 'support' && <SupportScreen />}
      </main>
    </div>
  );
}
