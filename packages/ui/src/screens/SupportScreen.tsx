import { useEffect, useState } from 'react';
import { api, type SystemInfo } from '../api.js';
import { useServiceStatus } from '../useServiceStatus.js';

/**
 * Settings and Support — PRODUCT_SPEC.md §24.
 *
 * Shows what someone needs in order to diagnose a problem on the library
 * computer without a developer present: which version is running, which schema
 * the database is at, where the data lives, and whether the service answers.
 */
export function SupportScreen(): JSX.Element {
  const { service, online } = useServiceStatus();
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    api
      .systemInfo(controller.signal)
      .then((result) => setInfo(result))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : 'לא ניתן לקרוא את פרטי המערכת');
      });

    return () => controller.abort();
  }, []);

  return (
    <>
      <section className="card">
        <h2>מצב המערכת</h2>
        <dl className="info-grid">
          <dt>השירות המקומי</dt>
          <dd>
            {service === 'checking' && <span className="status status-warn">בודק…</span>}
            {service === 'reachable' && <span className="status status-ok">פעיל</span>}
            {service === 'unreachable' && <span className="status status-error">לא זמין</span>}
          </dd>

          <dt>חיבור לאינטרנט</dt>
          <dd>
            {online ? (
              <span className="status status-ok">מחובר</span>
            ) : (
              <span className="status status-warn">לא מחובר</span>
            )}
            {/* §23: this is information, not a fault. */}
            <p className="hint" style={{ margin: '0.4rem 0 0' }}>
              המערכת פועלת גם ללא אינטרנט.
            </p>
          </dd>
        </dl>
      </section>

      {error !== null && (
        <div className="notice notice-error" role="alert">
          {error} — ודא שהשירות המקומי פועל, ורענן את הדף.
        </div>
      )}

      {info !== null && (
        <>
          <section className="card">
            <h2>גרסאות</h2>
            <dl className="info-grid">
              <dt>גרסת התוכנה</dt>
              <dd className="value-ltr">{info.appVersion}</dd>
              <dt>גרסת סכימת הנתונים</dt>
              <dd className="value-ltr">{info.schemaVersion}</dd>
            </dl>
          </section>

          <section className="card">
            <h2>מיקום הנתונים</h2>
            <p className="hint">הנתונים נשמרים מחוץ לתיקיית התוכנה, כדי שעדכון גרסה לא ייגע בהם.</p>
            <dl className="info-grid">
              <dt>תיקיית הנתונים</dt>
              <dd className="value-ltr">{info.paths.root}</dd>
              <dt>קובץ מסד הנתונים</dt>
              <dd className="value-ltr">{info.paths.database}</dd>
              <dt>גיבויים</dt>
              <dd className="value-ltr">{info.paths.backups}</dd>
              <dt>לוגים</dt>
              <dd className="value-ltr">{info.paths.logs}</dd>
            </dl>
          </section>

          <section className="card">
            <h2>הגדרות</h2>
            <p className="hint">בשלב זה להצגה בלבד. עריכה תתווסף בהמשך.</p>
            <dl className="info-grid">
              <dt>שם בית הספר</dt>
              <dd>{info.settings.school_name || '—'}</dd>
              <dt>ימי השאלה כברירת מחדל</dt>
              <dd>{info.settings.default_loan_days}</dd>
              <dt>מקסימום השאלות לתלמיד</dt>
              <dd>{info.settings.max_active_loans_per_student}</dd>
              <dt>גישה ברשת המקומית</dt>
              <dd>
                {info.settings.lan_enabled ? (
                  <span className="status status-warn">מופעלת</span>
                ) : (
                  <span className="status status-neutral">כבויה</span>
                )}
              </dd>
            </dl>
          </section>
        </>
      )}
    </>
  );
}
