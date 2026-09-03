import { useEffect, useState } from 'react';
import { ApiError, api, type Category, type SchoolClass, type ShelfLocation } from '../api.js';
import { Notice } from '../components/Notice.js';

/**
 * The small lists a student or a book refers to: classes, categories, shelf
 * locations. Each is a name plus a couple of optional details, so they share
 * one screen rather than three.
 */
export function CatalogSetupScreen(): JSX.Element {
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [shelves, setShelves] = useState<ShelfLocation[]>([]);

  const [className, setClassName] = useState('');
  const [categoryName, setCategoryName] = useState('');
  const [categoryParent, setCategoryParent] = useState('');
  const [shelfName, setShelfName] = useState('');
  const [shelfRoom, setShelfRoom] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function reload(): Promise<void> {
    const [classResult, categoryResult, shelfResult] = await Promise.all([
      api.listClasses(),
      api.listCategories(),
      api.listShelves(),
    ]);
    setClasses(classResult.items);
    setCategories(categoryResult.items);
    setShelves(shelfResult.items);
  }

  useEffect(() => {
    void reload().catch(() => setError('טעינת הרשימות נכשלה. ודא שהשירות המקומי פועל.'));
  }, []);

  async function run(action: () => Promise<unknown>, success: string): Promise<void> {
    setError(null);
    setMessage(null);
    try {
      await action();
      await reload();
      setMessage(success);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'הפעולה נכשלה. נסה שוב.');
    }
  }

  return (
    <>
      {error !== null && <Notice kind="error">{error}</Notice>}
      {message !== null && <Notice kind="ok">{message}</Notice>}

      <section className="card">
        <h2>כיתות</h2>
        <form
          className="toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => api.createClass({ name: className }), 'הכיתה נוספה.').then(() => setClassName(''));
          }}
        >
          <div className="grow">
            <input
              type="text"
              placeholder="שם הכיתה, למשל ז-1"
              value={className}
              onChange={(event) => setClassName(event.target.value)}
              aria-label="שם כיתה חדשה"
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={className.trim() === ''}>
            הוסף
          </button>
        </form>
        {classes.length === 0 ? (
          <p className="empty">אין כיתות. הוסף כיתה כדי לשייך אליה תלמידים.</p>
        ) : (
          <ul className="menu-grid">
            {classes.map((schoolClass) => (
              <li key={schoolClass.publicId}>{schoolClass.name}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>קטגוריות</h2>
        <form
          className="toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () =>
                api.createCategory({
                  name: categoryName,
                  parentPublicId: categoryParent === '' ? null : categoryParent,
                }),
              'הקטגוריה נוספה.',
            ).then(() => {
              setCategoryName('');
              setCategoryParent('');
            });
          }}
        >
          <div className="grow">
            <input
              type="text"
              placeholder="שם הקטגוריה"
              value={categoryName}
              onChange={(event) => setCategoryName(event.target.value)}
              aria-label="שם קטגוריה חדשה"
            />
          </div>
          <select
            value={categoryParent}
            onChange={(event) => setCategoryParent(event.target.value)}
            aria-label="קטגוריית אב"
            style={{ width: 'auto' }}
          >
            <option value="">ללא קטגוריית אב</option>
            {categories.map((category) => (
              <option key={category.publicId} value={category.publicId}>
                {category.name}
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-primary" disabled={categoryName.trim() === ''}>
            הוסף
          </button>
        </form>
        {categories.length === 0 ? (
          <p className="empty">אין קטגוריות.</p>
        ) : (
          <ul className="menu-grid">
            {categories.map((category) => (
              <li key={category.publicId}>{category.name}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>מיקומי מדף</h2>
        <form
          className="toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () => api.createShelf({ name: shelfName, room: shelfRoom === '' ? null : shelfRoom }),
              'המיקום נוסף.',
            ).then(() => {
              setShelfName('');
              setShelfRoom('');
            });
          }}
        >
          <div className="grow">
            <input
              type="text"
              placeholder="שם המיקום, למשל מדף 3"
              value={shelfName}
              onChange={(event) => setShelfName(event.target.value)}
              aria-label="שם מיקום חדש"
            />
          </div>
          <input
            type="text"
            placeholder="חדר"
            value={shelfRoom}
            onChange={(event) => setShelfRoom(event.target.value)}
            aria-label="חדר"
            style={{ width: '10rem' }}
          />
          <button type="submit" className="btn btn-primary" disabled={shelfName.trim() === ''}>
            הוסף
          </button>
        </form>
        {shelves.length === 0 ? (
          <p className="empty">אין מיקומי מדף.</p>
        ) : (
          <ul className="menu-grid">
            {shelves.map((shelf) => (
              <li key={shelf.publicId}>{shelf.room === null ? shelf.name : `${shelf.name} · ${shelf.room}`}</li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
