import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/core/**/*.ts'],
      exclude: ['src/core/**/*.d.ts', 'src/webview-src/**'],
      // Initial baseline (P0.1). Ratchet upward as more modules get test coverage.
      // Modules already covered: riskAnalyzer (100%), expressionEvaluator (97%),
      // vtlEvaluator (95%), envVarValidator (94%), timeoutValidator (92%).
      thresholds: {
        lines: 25,
        functions: 50,
        branches: 70,
        statements: 25,
      },
    },
  },
});
