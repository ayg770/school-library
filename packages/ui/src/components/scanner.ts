/**
 * Telling a barcode scanner from a pair of hands.
 *
 * The device on the library desk types its digits into whatever field has
 * focus and then, depending on how it left the factory, may or may not press
 * Enter. The library's does not. The result was a field that filled with a
 * barcode and sat there, waiting for a hand to leave the scanner and reach the
 * keyboard — once per book, two thousand books.
 *
 * What separates the machine from the person is speed, and nothing else: both
 * arrive as ordinary keystrokes. So the gaps between characters are measured,
 * and a burst delivered at machine speed is submitted on its own once it
 * stops.
 *
 * The rule errs towards doing nothing. Submitting a half-typed barcode on
 * someone's behalf is worse than the problem being solved — it would check in
 * the wrong book — so anything that is not clearly mechanical waits for Enter.
 *
 * It is kept apart from the React hook that uses it because it is a decision
 * rather than a rendering concern: as plain functions over numbers it can be
 * tested without a browser, and a timing rule that nothing can test is one
 * nobody will dare change later.
 */

/**
 * The slowest gap between characters still considered mechanical.
 *
 * Scanners sit between 1 and 10ms. Fast human typing reaches roughly 120ms
 * between characters, and someone reading digits off a damaged label is far
 * slower still, so 40ms is clear of both with room on either side.
 */
export const MACHINE_GAP_MS = 40;

/** Quiet after the last character before a burst counts as finished. */
export const SETTLE_MS = 90;

/** Below this, a burst is a stray keypress rather than a barcode. */
export const MIN_BARCODE_LENGTH = 3;

export interface BurstState {
  /** False once any gap has been too slow to have come from a machine. */
  readonly machineSpeed: boolean;
  readonly lastKeyAt: number;
}

export function newBurst(): BurstState {
  return { machineSpeed: true, lastKeyAt: 0 };
}

export interface Keystroke {
  readonly previousValue: string;
  readonly nextValue: string;
  /** Milliseconds, from any clock that only moves forwards. */
  readonly at: number;
}

export interface BurstOutcome {
  readonly state: BurstState;
  /**
   * Whether to submit this value once `SETTLE_MS` passes with no more input.
   *
   * Deliberately not "submit now": the last character of a barcode is
   * indistinguishable from the middle of one until the typing stops.
   */
  readonly submitAfterSettling: boolean;
}

/**
 * Takes one keystroke and says whether the burst still looks mechanical.
 *
 * A field going from empty begins a fresh burst whatever came before it, so a
 * librarian who types one barcode by hand and then scans the next is not
 * punished for the first.
 */
export function observeKeystroke(state: BurstState, stroke: Keystroke): BurstOutcome {
  const gap = stroke.at - state.lastKeyAt;

  const machineSpeed =
    stroke.previousValue === '' ? true : state.machineSpeed && gap <= MACHINE_GAP_MS;

  const next: BurstState = { machineSpeed, lastKeyAt: stroke.at };

  return {
    state: next,
    submitAfterSettling: machineSpeed && stroke.nextValue.trim().length >= MIN_BARCODE_LENGTH,
  };
}
