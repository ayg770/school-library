import { SupportScreen } from './SupportScreen.js';

/** Screens from PRODUCT_SPEC.md §25, none of them built yet. */
const PLANNED_SCREENS = [
  'השאלה',
  'החזרה',
  'קליטת ספרים מהמדף',
  'חיפוש',
  'תלמידים',
  'ספרים',
  'דוחות',
  'ייבוא',
  'גיבוי',
];

export function App(): JSX.Element {
  return (
    <>
      <header className="app-header">
        <h1>ספריית בית הספר</h1>
        <span className="phase-tag">שלב 0 — תשתית</span>
      </header>

      <main>
        <SupportScreen />

        <section className="card">
          <h2>מסכים שיתווספו בשלבים הבאים</h2>
          <p className="hint">אף אחד מהם עדיין לא פעיל. ההשאלה וההחזרה מגיעות בשלב 2.</p>
          <ul className="menu-grid">
            {PLANNED_SCREENS.map((screen) => (
              <li key={screen}>{screen}</li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}
