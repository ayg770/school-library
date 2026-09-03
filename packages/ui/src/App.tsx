import { useEffect, useState } from 'react';
import { BooksScreen } from './screens/BooksScreen.js';
import { CatalogSetupScreen } from './screens/CatalogSetupScreen.js';
import { StudentsScreen } from './screens/StudentsScreen.js';
import { SupportScreen } from './screens/SupportScreen.js';

type ScreenId = 'students' | 'books' | 'setup' | 'support';

const SCREENS: ReadonlyArray<{ id: ScreenId; label: string }> = [
  { id: 'students', label: 'תלמידים' },
  { id: 'books', label: 'ספרים' },
  { id: 'setup', label: 'כיתות, קטגוריות ומדפים' },
  { id: 'support', label: 'הגדרות ותמיכה' },
];

/** Screens from PRODUCT_SPEC.md §25 that later phases add. */
const PLANNED_SCREENS = ['השאלה', 'החזרה', 'קליטת ספרים מהמדף', 'דוחות', 'ייבוא', 'גיבוי'];

const DEFAULT_SCREEN: ScreenId = 'students';

function screenFromHash(): ScreenId {
  const id = window.location.hash.replace(/^#\/?/, '');
  return SCREENS.some((item) => item.id === id) ? (id as ScreenId) : DEFAULT_SCREEN;
}

export function App(): JSX.Element {
  // The screen lives in the address so a reload, or the browser's back button,
  // returns where the librarian was rather than to the first tab.
  const [screen, setScreen] = useState<ScreenId>(screenFromHash);

  useEffect(() => {
    const sync = (): void => setScreen(screenFromHash());
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  function go(id: ScreenId): void {
    window.location.hash = `/${id}`;
    setScreen(id);
  }

  return (
    <>
      <header className="app-header">
        <h1>ספריית בית הספר</h1>
        <span className="phase-tag">שלב 1 — קטלוג</span>
      </header>

      <nav className="nav" aria-label="ניווט ראשי">
        {SCREENS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => go(item.id)}
            aria-current={screen === item.id ? 'page' : undefined}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <main>
        {screen === 'students' && <StudentsScreen />}
        {screen === 'books' && <BooksScreen />}
        {screen === 'setup' && <CatalogSetupScreen />}
        {screen === 'support' && <SupportScreen />}

        {screen === 'support' && (
          <section className="card">
            <h2>מסכים שיתווספו בשלבים הבאים</h2>
            <p className="hint">ההשאלה וההחזרה מגיעות בשלב 2.</p>
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
