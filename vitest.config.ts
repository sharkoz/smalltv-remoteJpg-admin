import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    // Render integration tests launch a real Chromium; give them room.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Keep a single fork to avoid spawning multiple Chromium instances at once.
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
