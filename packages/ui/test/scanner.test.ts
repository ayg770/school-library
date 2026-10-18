import { describe, expect, it } from 'vitest';
import {
  MACHINE_GAP_MS,
  MIN_BARCODE_LENGTH,
  newBurst,
  observeKeystroke,
  type BurstState,
} from '../src/components/scanner.js';

/**
 * Telling the scanner from the librarian.
 *
 * The cost of being wrong is not symmetric. Failing to recognise a scan means
 * someone presses Enter — mildly annoying. Mistaking typing for a scan means
 * submitting half a barcode, which checks in the wrong book and is discovered
 * weeks later, if ever. Every case below is written with that asymmetry in
 * mind.
 */

/** Feeds a barcode through the rule at a fixed speed, returning the outcome. */
function type(barcode: string, gapMs: number, startAt = 1_000): BurstState & { submit: boolean } {
  let state = newBurst();
  let submit = false;
  let at = startAt;
  let value = '';

  for (const character of barcode) {
    const previousValue = value;
    value += character;
    const outcome = observeKeystroke(state, { previousValue, nextValue: value, at });
    state = outcome.state;
    submit = outcome.submitAfterSettling;
    at += gapMs;
  }

  return { ...state, submit };
}

describe('telling a scanner from a pair of hands', () => {
  it('recognises a scanner, which delivers a barcode in milliseconds', () => {
    const result = type('001796', 3);

    expect(result.machineSpeed).toBe(true);
    expect(result.submit).toBe(true);
  });

  it('leaves typing alone, so half a barcode is never submitted', () => {
    // 150ms between characters is brisk human typing.
    const result = type('001796', 150);

    expect(result.machineSpeed).toBe(false);
    expect(result.submit).toBe(false);
  });

  it('will not submit a stray keypress', () => {
    expect(type('0', 3).submit).toBe(false);
    expect(type('01', 3).submit).toBe(false);
    expect(type('012', 3).submit).toBe(true);
    expect(MIN_BARCODE_LENGTH).toBe(3);
  });

  it('gives up on a burst the moment one gap is too slow, and does not change its mind', () => {
    let state = newBurst();
    let at = 1_000;

    // Fast, fast, then a human-length pause, then fast again.
    for (const [previousValue, nextValue, gap] of [
      ['', '0', 0],
      ['0', '01', 3],
      ['01', '017', 400],
      ['017', '0179', 3],
      ['0179', '01796', 3],
    ] as Array<[string, string, number]>) {
      at += gap;
      state = observeKeystroke(state, { previousValue, nextValue, at }).state;
    }

    // Somebody typed, paused, and carried on. That is not a scan, and no
    // amount of fast typing afterwards makes it one.
    expect(state.machineSpeed).toBe(false);
  });

  it('starts a fresh burst when the field goes back to empty', () => {
    let state = newBurst();

    state = observeKeystroke(state, { previousValue: '', nextValue: '1', at: 1_000 }).state;
    state = observeKeystroke(state, { previousValue: '1', nextValue: '12', at: 1_500 }).state;
    expect(state.machineSpeed).toBe(false);

    // The librarian cleared the field and scanned the next book. The previous
    // barcode having been typed by hand must not disable the scanner.
    const after = observeKeystroke(state, { previousValue: '', nextValue: '0', at: 9_000 });
    expect(after.state.machineSpeed).toBe(true);
  });

  it('treats the threshold itself as mechanical, and one millisecond past it as not', () => {
    const atLimit = observeKeystroke(
      { machineSpeed: true, lastKeyAt: 1_000 },
      { previousValue: '00', nextValue: '001', at: 1_000 + MACHINE_GAP_MS },
    );
    expect(atLimit.state.machineSpeed).toBe(true);

    const past = observeKeystroke(
      { machineSpeed: true, lastKeyAt: 1_000 },
      { previousValue: '00', nextValue: '001', at: 1_000 + MACHINE_GAP_MS + 1 },
    );
    expect(past.state.machineSpeed).toBe(false);
  });

  it('handles a barcode arriving as one paste, which is what some scanners do', () => {
    const outcome = observeKeystroke(newBurst(), {
      previousValue: '',
      nextValue: '001796',
      at: 1_000,
    });

    expect(outcome.submitAfterSettling).toBe(true);
  });

  it('ignores a value that is only whitespace', () => {
    const outcome = observeKeystroke(newBurst(), {
      previousValue: '',
      nextValue: '    ',
      at: 1_000,
    });

    expect(outcome.submitAfterSettling).toBe(false);
  });
});
