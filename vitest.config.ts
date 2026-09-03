import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node is the default because most of the suite is pure logic; component
    // tests opt into the DOM with a `// @vitest-environment jsdom` docblock.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      include: ['src/shared/**', 'src/ui/render/**'],
      reporter: ['text', 'html'],
    },
  },
  // Vite's default extension order puts .js before .ts, so a relative import
  // could resolve to a stale compiled dist-electron/*.js instead of the source.
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
  },
});
