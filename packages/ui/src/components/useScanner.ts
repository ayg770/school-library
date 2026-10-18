import { useCallback, useEffect, useRef, useState } from 'react';
import { SETTLE_MS, newBurst, observeKeystroke, type BurstState } from './scanner.js';

/**
 * A barcode scanner, as the keyboard it pretends to be.
 *
 * The decision — is this a machine or a pair of hands — lives next door in
 * `scanner.ts`, where it is tested. What is left here is the part that
 * genuinely belongs to a screen: holding the field's text, and waiting for the
 * typing to stop.
 *
 * The wait is unavoidable. The last character of a barcode looks exactly like
 * the middle of one, so the burst is only known to be finished by the silence
 * that follows it.
 */

export interface ScannerOptions {
  /** Called with the finished barcode, from the scanner or from Enter. */
  readonly onScan: (barcode: string) => void;
  /** Suspends automatic submission, e.g. while a question is on screen. */
  readonly enabled?: boolean;
}

export interface Scanner {
  readonly value: string;
  readonly setValue: (value: string) => void;
  readonly inputProps: {
    readonly value: string;
    readonly onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
    readonly onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
    readonly autoComplete: 'off';
  };
  /** Submits whatever is in the field now — for a button, or for Enter. */
  readonly submit: () => void;
  readonly clear: () => void;
}

export function useScanner({ onScan, enabled = true }: ScannerOptions): Scanner {
  const [value, setValue] = useState('');

  const burst = useRef<BurstState>(newBurst());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Read through a ref rather than captured when the timer was set, so the
  // barcode submitted is the one on screen when the typing actually stopped.
  const latest = useRef({ value, onScan, enabled });
  latest.current = { value, onScan, enabled };

  const cancel = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => cancel, [cancel]);

  const fire = useCallback(() => {
    cancel();
    const barcode = latest.current.value.trim();
    if (barcode === '') return;

    setValue('');
    burst.current = newBurst();
    latest.current.onScan(barcode);
  }, [cancel]);

  const onChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextValue = event.target.value;
      const outcome = observeKeystroke(burst.current, {
        previousValue: latest.current.value,
        nextValue,
        at: Date.now(),
      });

      burst.current = outcome.state;
      setValue(nextValue);
      cancel();

      if (!outcome.submitAfterSettling) return;

      timer.current = setTimeout(() => {
        if (latest.current.enabled) fire();
      }, SETTLE_MS);
    },
    [cancel, fire],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== 'Enter') return;
      // Stops the form submitting as well, which would send the barcode twice.
      event.preventDefault();
      fire();
    },
    [fire],
  );

  const clear = useCallback(() => {
    cancel();
    setValue('');
    burst.current = newBurst();
  }, [cancel]);

  return {
    value,
    setValue,
    inputProps: { value, onChange, onKeyDown, autoComplete: 'off' },
    submit: fire,
    clear,
  };
}
