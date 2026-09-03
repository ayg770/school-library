import { useEffect, useState } from 'react';
import { ROLE_LABELS, type Role } from './api.js';
import { BackupScreen } from './screens/BackupScreen.js';
import { BooksScreen } from './screens/BooksScreen.js';
import { CatalogSetupScreen } from './screens/CatalogSetupScreen.js';
import { CheckoutScreen } from './screens/CheckoutScreen.js';
import { ImportScreen } from './screens/ImportScreen.js';
import { LoansScreen } from './screens/LoansScreen.js';
import { LoginScreen } from './screens/LoginScreen.js';
import { ReturnScreen } from './screens/ReturnScreen.js';
import { StaffScreen } from './screens/StaffScreen.js';
import { StudentsScreen } from './screens/StudentsScreen.js';
import { SupportScreen } from './screens/SupportScreen.js';
import { useSession } from './useSession.js';

type ScreenId =
  | 'checkout'
  | 'return'
  | 'loans'
  | 'students'
  | 'books'
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

// Ordered as §25 lists them: the two daily tasks first.
const SCREENS: readonly ScreenDefinition[] = [
  { id: 'checkout', label: 'השאלה', role: 'librarian' },
  { id: 'return', label: 'החזרה', role: 'librarian' },
  { id: 'loans', label: 'השאלות', role: 'read_only' },
  { id: 'students', label: 'תלמידים', role: 'read_only' },
  { id: 'books', label: 'ספרים', role: 'read_only' },
  { id: 'setup', label: 'כיתות, קטגוריות ומדפים', role: 'librarian' },
  { id: 'import', label: 'ייבוא', role: 'librarian' },
  { id: 'backup', label: 'גיבוי', role: 'admin' },
  { id: 'staff', label: 'משתמשים', role: 'admin' },
  { id: 'support', label: 'הגדרות ותמיכה', role: 'read_only' },
];

/** Screens from PRODUCT_SPEC.md §25 that later phases add. */
const PLANNED_SCREENS = ['קליטת ספרים מהמדף', 'דוחות'];

const RANK: Record<Role, number> = { read_only: 0, librarian: 1, admin: 2 };

function allows(role: Role, required: Role): boolean {
  return RANK[role] >= RANK[required];
}

export function App(): JSX.Element {
  const session = useSession();
  const role = session.user?.role;
  const available = SCREENS.filter((screen) => role !== undefined && allows(role, screen.role));

  const [screen, setScreen] = useState<ScreenId>('checkout');

  // The screen lives in the address so a reload, or the browser's back button,
  // returns where the librarian was rather than to the first tab.
  useEffect(() => {
    const sync = (): void => {
      const id = window.location.hash.replace(/^#\/?/, '');
      setScreen((current) => (SCREENS.some((item) => item.id === id) ? (id as ScreenId) : current));
    };
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  function go(id: ScreenId): void {
    window.location.hash = `/${id}`;
    setScreen(id);
  }

  if (session.loading) {
    // Nothing is drawn until the service says who is signed in, so a screen of
    // student names cannot appear before the session turns out to be invalid.
    return (
      <main>
        <p className="empty">רגע…</p>
      </main>
    );
  }

  if (session.user === null) {
    return <LoginScreen setupRequired={session.setupRequired} onSignedIn={session.refresh} />;
  }

  const user = session.user;
  // Hiding a screen is a convenience, not the control: the service refuses the
  // request regardless of what the interface offers.
  const current = available.some((item) => item.id === screen)
    ? screen
    : (available[0]?.id ?? 'support');

  return (
    <>
      <header className="app-header">
        <h1>ספריית בית הספר</h1>
        <span className="phase-tag">
          {user.displayName} · {ROLE_LABELS[user.role]}
        </span>
        <button
          type="button"
          className="btn-link"
          style={{ marginInlineStart: 'auto' }}
          onClick={() => void session.signOut()}
        >
          יציאה
        </button>
      </header>

      <nav className="nav" aria-label="ניווט ראשי">
        {available.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => go(item.id)}
            aria-current={current === item.id ? 'page' : undefined}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <main>
        {current === 'checkout' && <CheckoutScreen />}
        {current === 'return' && <ReturnScreen />}
        {current === 'loans' && <LoansScreen />}
        {current === 'students' && <StudentsScreen />}
        {current === 'books' && <BooksScreen />}
        {current === 'setup' && <CatalogSetupScreen />}
        {current === 'import' && <ImportScreen />}
        {current === 'backup' && <BackupScreen />}
        {current === 'staff' && <StaffScreen currentUser={user} />}
        {current === 'support' && <SupportScreen />}

        {current === 'support' && (
          <section className="card">
            <h2>מסכים שיתווספו בשלבים הבאים</h2>
            <ul className="menu-grid">
              {PLANNED_SCREENS.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
