import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    passWithNoTests: true,
    include: [
      'apps/**/*.test.ts',
      'packages/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'apps/crm/modules/**/domain/**',
        'packages/contracts/src/**',
        'packages/database/src/**',
      ],
    },
  },
  resolve: {
    alias: {
      '@clearshift/database': resolve(__dirname, './packages/database/src/index.ts'),
      '@clearshift/contracts': resolve(__dirname, './packages/contracts/src/index.ts'),
      '@clearshift/ui': resolve(__dirname, './packages/ui/src/index.ts'),
    },
  },
});
