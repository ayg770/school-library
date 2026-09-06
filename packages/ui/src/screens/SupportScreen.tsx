import { useEffect, useState } from 'react';
import { api, formatDate, type SystemInfo, type UpdateStatus } from '../api.js';
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
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);

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

  /**
   * Only when asked.
   *
   * The check reaches the internet, and this machine is meant to work without
   * it (AD-8). Running it on load would mean a screen that is usually waiting
   * on a request that is usually going to fail.
   */
  async function checkUpdate(): Promise<void> {
    setChecking(true);
    try {
      setUpdate(await api.checkForUpdate());
    } catch {
      setUpdate({
        currentVersion: info?.appVersion ?? '',
        latestVersion: null,
        updateAvailable: false,
        downloadUrl: null,
        publishedAt: null,
        problem: 'הבדיקה נכשלה. נסה שוב.',
      });
    } finally {
      setChecking(false);
    }
  }

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
            <div className="card-header">
              <h2>גרסאות</h2>
              <button type="button" className="btn" onClick={() => void checkUpdate()} disabled={checking}>
                {checking ? 'בודק…' : 'בדוק עדכון'}
              </button>
            </div>

            <dl className="info-grid">
              <dt>גרסת התוכנה</dt>
              <dd className="value-ltr">{info.appVersion}</dd>
              <dt>גרסת סכימת הנתונים</dt>
              <dd className="value-ltr">{info.schemaVersion}</dd>
            </dl>

            {update !== null && (
              <div
                className={`notice ${update.updateAvailable ? 'notice-ok' : ''}`}
                role="status"
                aria-live="polite"
              >
                {update.problem !== null ? (
                  <>
                    {update.problem}
                    {/* Being offline is not a fault here (§23, AD-8) — the
                        library works without a connection, so the message says
                        what is true rather than what is broken. */}
                    <p className="hint" style={{ margin: '0.4rem 0 0' }}>
                      אפשר לנסות שוב כשיהיה חיבור. התוכנה פועלת כרגיל בינתיים.
                    </p>
                  </>
                ) : update.updateAvailable ? (
                  <>
                    <strong>יש גרסה חדשה: {update.latestVersion}</strong>
                    {update.publishedAt !== null && ` · פורסמה ${formatDate(update.publishedAt)}`}
                    {update.downloadUrl !== null && (
                      <p style={{ margin: '0.5rem 0 0' }}>
                        {/* Opens in the browser: inside the application, an
                            external link is handed to the system browser
                            rather than loaded over the library. */}
                        <a href={update.downloadUrl} target="_blank" rel="noreferrer">
                          פתח את דף ההורדה
                        </a>
                      </p>
                    )}
                    <p className="hint" style={{ margin: '0.5rem 0 0' }}>
                      ההתקנה לא נוגעת בנתונים — הם נשמרים מחוץ לתיקיית התוכנה. כדאי לגבות לפני,
                      מתוך זהירות.
                    </p>
                  </>
                ) : (
                  <>זו הגרסה העדכנית ביותר.</>
                )}
              </div>
            )}
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
