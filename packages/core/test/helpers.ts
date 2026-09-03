import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** A temp application data root that the caller removes when done. */
export function makeTempRoot(): { root: string; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'school-library-test-'));
  return {
    root,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}
