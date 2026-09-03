import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  BACKUP_REASON_LABELS,
  api,
  formatBytes,
  formatDateTime,
  type BackupCheck,
  type BackupFile,
} from '../api.js';
import { Notice } from '../components/Notice.js';

/**
 * Backup and restore — PRODUCT_SPEC.md §18.
 *
 * Restore replaces everything the library has recorded, so it asks twice and
 * says plainly what will be lost. The safety snapshot taken automatically
 * before every restore is what makes a wrong choice recoverable, and the
 * screen says so rather than leaving the librarian to hope.
 */
export function BackupScreen(): JSX.Element {
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [checks, setChecks] = useState<Record<string, BackupCheck>>({});
  const [confirming, setConfirming] = useState<BackupFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setBackups((await api.listBackups()).items);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'טעינת הגיבויים נכשלה');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createNow(): Promise<void> {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const backup = await api.createBackup();
      setMessage(`נוצר גיבוי בגודל ${formatBytes(backup.sizeBytes)}.`);
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'יצירת הגיבוי נכשלה.');
    } finally {
      setBusy(false);
    }
  }

  async function check(backup: BackupFile): Promise<void> {
    try {
      const result = await api.verifyBackup(backup.id);
      setChecks((current) => ({ ...current, [backup.id]: result }));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'בדיקת הגיבוי נכשלה.');
    }
  }

  async function restore(backup: BackupFile): Promise<void> {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const result = await api.restoreBackup(backup.id);
      setConfirming(null);
      setMessage(
        `המערכת שוחזרה מהגיבוי של ${formatDateTime(backup.createdAt)}. ` +
          `המצב הקודם נשמר כגיבוי בשם ${result.safetyBackup.id}.`,
      );
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'השחזור נכשל.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error !== null && <Notice kind="error">{error}</Notice>}
      {message !== null && <Notice kind="ok">{message}</Notice>}

      {confirming !== null && (
        <section className="card">
          <h2>שחזור מגיבוי</h2>
          <div className="notice notice-error" role="alert" style={{ marginBottom: '1rem' }}>
            כל מה שנוסף למערכת אחרי {formatDateTime(confirming.createdAt)} יימחק — השאלות, ספרים
            ותלמידים.
          </div>
          <p className="hint">
            לפני השחזור המערכת שומרת אוטומטית גיבוי של המצב הנוכחי, כך שאפשר לחזור אחורה אם
            תשחזר בטעות את הגיבוי הלא נכון.
          </p>
          <div className="form-actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void restore(confirming)}>
              {busy ? 'משחזר…' : 'שחזר בכל זאת'}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => setConfirming(null)}>
              ביטול
            </button>
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-header">
          <h2>גיבויים</h2>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void createNow()}>
            {busy ? 'מגבה…' : 'גבה עכשיו'}
          </button>
        </div>

        <p className="hint">
          המערכת מגבה אוטומטית לפני כל עדכון גרסה ולפני כל שחזור. גיבויים אלה נשמרים תמיד, גם
          כשגיבויים ידניים ישנים נמחקים.
        </p>

        {backups.length === 0 ? (
          <p className="empty">אין עדיין גיבויים. לחץ "גבה עכשיו".</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>מתי</th>
                  <th>סוג</th>
                  <th>גודל</th>
                  <th>גרסת סכימה</th>
                  <th>תקינות</th>
                  <th className="row-actions" />
                </tr>
              </thead>
              <tbody>
                {backups.map((backup) => {
                  const result = checks[backup.id];
                  return (
                    <tr key={backup.id}>
                      <td>{formatDateTime(backup.createdAt)}</td>
                      <td>{BACKUP_REASON_LABELS[backup.reason]}</td>
                      <td>{formatBytes(backup.sizeBytes)}</td>
                      <td>{backup.schemaVersion ?? '—'}</td>
                      <td>
                        {result === undefined ? (
                          <button type="button" className="btn-link" onClick={() => void check(backup)}>
                            בדוק
                          </button>
                        ) : result.ok ? (
                          <span className="status status-ok">תקין</span>
                        ) : (
                          <span className="status status-error" title={result.problems.join(' ')}>
                            בעיה
                          </span>
                        )}
                      </td>
                      <td className="row-actions">
                        <button type="button" className="btn-link" onClick={() => setConfirming(backup)}>
                          שחזר
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
