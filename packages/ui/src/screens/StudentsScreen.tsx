import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, type SchoolClass, type Student } from '../api.js';
import { Field } from '../components/Field.js';
import { Notice } from '../components/Notice.js';

interface FormState {
  firstName: string;
  lastName: string;
  classPublicId: string;
  localBarcode: string;
  notes: string;
  active: boolean;
}

const EMPTY_FORM: FormState = {
  firstName: '',
  lastName: '',
  classPublicId: '',
  localBarcode: '',
  notes: '',
  active: true,
};

function toForm(student: Student): FormState {
  return {
    firstName: student.firstName,
    lastName: student.lastName,
    classPublicId: student.classPublicId ?? '',
    localBarcode: student.localBarcode ?? '',
    notes: student.notes ?? '',
    active: student.active,
  };
}

export function StudentsScreen(): JSX.Element {
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [searchText, setSearchText] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const [editing, setEditing] = useState<Student | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const result = await api.listStudents({
        query: searchText,
        classPublicId: classFilter,
        ...(showInactive ? {} : { active: true }),
      });
      setStudents(result.items);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'טעינת התלמידים נכשלה');
    }
  }, [searchText, classFilter, showInactive]);

  useEffect(() => {
    void api
      .listClasses()
      .then((result) => setClasses(result.items))
      .catch(() => setClasses([]));
  }, []);

  useEffect(() => {
    // Debounced so typing in the search box does not fire a request per keystroke.
    const timer = window.setTimeout(() => void load(), 200);
    return () => window.clearTimeout(timer);
  }, [load]);

  function startCreate(): void {
    setEditing('new');
    setForm(EMPTY_FORM);
    setFieldError(undefined);
    setMessage(null);
  }

  function startEdit(student: Student): void {
    setEditing(student);
    setForm(toForm(student));
    setFieldError(undefined);
    setMessage(null);
  }

  function cancel(): void {
    setEditing(null);
    setFieldError(undefined);
  }

  async function save(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (editing === null) return;

    setSaving(true);
    setFieldError(undefined);
    setError(null);

    const payload = {
      firstName: form.firstName,
      lastName: form.lastName,
      classPublicId: form.classPublicId === '' ? null : form.classPublicId,
      localBarcode: form.localBarcode === '' ? null : form.localBarcode,
      notes: form.notes === '' ? null : form.notes,
      active: form.active,
    };

    try {
      if (editing === 'new') {
        await api.createStudent(payload);
        setMessage('התלמיד נוסף.');
      } else {
        await api.updateStudent(editing.publicId, payload);
        setMessage('התלמיד עודכן.');
      }
      setEditing(null);
      await load();
    } catch (cause) {
      if (cause instanceof ApiError) {
        setFieldError(cause.message);
      } else {
        setError('השמירה נכשלה. נסה שוב.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {error !== null && <Notice kind="error">{error}</Notice>}
      {message !== null && <Notice kind="ok">{message}</Notice>}

      {editing !== null && (
        <section className="card">
          <h2>{editing === 'new' ? 'תלמיד חדש' : 'עריכת תלמיד'}</h2>
          <form onSubmit={(event) => void save(event)}>
            <div className="field-row">
              <Field label="שם פרטי" htmlFor="firstName">
                <input
                  id="firstName"
                  type="text"
                  value={form.firstName}
                  onChange={(event) => setForm({ ...form, firstName: event.target.value })}
                  autoFocus
                />
              </Field>
              <Field label="שם משפחה" htmlFor="lastName">
                <input
                  id="lastName"
                  type="text"
                  value={form.lastName}
                  onChange={(event) => setForm({ ...form, lastName: event.target.value })}
                />
              </Field>
            </div>

            <div className="field-row">
              <Field label="כיתה" htmlFor="classPublicId">
                <select
                  id="classPublicId"
                  value={form.classPublicId}
                  onChange={(event) => setForm({ ...form, classPublicId: event.target.value })}
                >
                  <option value="">ללא כיתה</option>
                  {classes.map((schoolClass) => (
                    <option key={schoolClass.publicId} value={schoolClass.publicId}>
                      {schoolClass.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="ברקוד כרטיס (לא חובה)" htmlFor="localBarcode" error={fieldError}>
                <input
                  id="localBarcode"
                  type="text"
                  value={form.localBarcode}
                  onChange={(event) => setForm({ ...form, localBarcode: event.target.value })}
                  dir="ltr"
                />
              </Field>
            </div>

            <Field label="הערות" htmlFor="notes">
              <textarea
                id="notes"
                value={form.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
              />
            </Field>

            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(event) => setForm({ ...form, active: event.target.checked })}
              />
              תלמיד פעיל
            </label>
            <p className="hint">תלמיד שעזב מסומן כלא פעיל. הרשומה נשמרת, כדי שהיסטוריית ההשאלות תישאר שלמה.</p>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'שומר…' : 'שמור'}
              </button>
              <button type="button" className="btn" onClick={cancel} disabled={saving}>
                ביטול
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="card">
        <div className="card-header">
          <h2>תלמידים</h2>
          <button type="button" className="btn btn-primary" onClick={startCreate}>
            תלמיד חדש
          </button>
        </div>

        <div className="toolbar">
          <div className="grow">
            <input
              type="search"
              placeholder="חיפוש לפי שם או ברקוד כרטיס"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              aria-label="חיפוש תלמידים"
            />
          </div>
          <select value={classFilter} onChange={(event) => setClassFilter(event.target.value)} aria-label="סינון לפי כיתה" style={{ width: 'auto' }}>
            <option value="">כל הכיתות</option>
            {classes.map((schoolClass) => (
              <option key={schoolClass.publicId} value={schoolClass.publicId}>
                {schoolClass.name}
              </option>
            ))}
          </select>
          <label className="checkbox-field" style={{ margin: 0 }}>
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(event) => setShowInactive(event.target.checked)}
            />
            הצג גם לא פעילים
          </label>
          <span className="count">{students.length} תלמידים</span>
        </div>

        {students.length === 0 ? (
          <p className="empty">אין תלמידים להצגה.</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>שם</th>
                  <th>כיתה</th>
                  <th>ברקוד כרטיס</th>
                  <th>סטטוס</th>
                  <th className="row-actions" />
                </tr>
              </thead>
              <tbody>
                {students.map((student) => (
                  <tr key={student.publicId} className={student.active ? '' : 'is-inactive'}>
                    <td>
                      {student.lastName} {student.firstName}
                    </td>
                    <td>{student.className ?? '—'}</td>
                    <td className="value-ltr">{student.localBarcode ?? '—'}</td>
                    <td>
                      {student.active ? (
                        <span className="status status-ok">פעיל</span>
                      ) : (
                        <span className="status status-neutral">לא פעיל</span>
                      )}
                    </td>
                    <td className="row-actions">
                      <button type="button" className="btn-link" onClick={() => startEdit(student)}>
                        עריכה
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
