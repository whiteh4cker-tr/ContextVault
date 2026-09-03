import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node is the default because most of the suite is pure logic; component
    // tests opt into the DOM with a `// @vitest-environment jsdom` docblock.
    environment: 'node',
    // Testing Library registers its automatic unmount in `afterEach` only when
    // globals are present; without it, every render in a file piles up in the
    // same document and queries match the previous test's DOM as well.
    globals: true,
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
