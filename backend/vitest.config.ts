import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 15000,
    // WHY fileParallelism false: Integration tests interact with a shared development
    // PostgreSQL instance. Running suites sequentially prevents test data contamination
    // (e.g. schema.test.ts temporary parties interfering with seed.test.ts assertions).
    fileParallelism: false,
  },
});
