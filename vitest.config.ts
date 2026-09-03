import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
    // Each test opens its own SQLite file in a temp directory, so tests are
    // independent, but keep the pool modest to avoid exhausting file handles.
    pool: 'threads',
  },
});
