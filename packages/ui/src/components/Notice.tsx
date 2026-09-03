interface NoticeProps {
  readonly kind: 'error' | 'ok';
  readonly children: string;
}

/** §24: a short message with a clear action, never a stack trace. */
export function Notice({ kind, children }: NoticeProps): JSX.Element {
  return (
    <div
      className={`notice ${kind === 'error' ? 'notice-error' : 'notice-ok'}`}
      role={kind === 'error' ? 'alert' : 'status'}
      style={{ marginBottom: '1rem' }}
    >
      {children}
    </div>
  );
}
