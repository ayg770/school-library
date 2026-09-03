import type { ReactNode } from 'react';

interface FieldProps {
  readonly label: string;
  readonly htmlFor: string;
  readonly error?: string | undefined;
  readonly children: ReactNode;
}

export function Field({ label, htmlFor, error, children }: FieldProps): JSX.Element {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error !== undefined && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
