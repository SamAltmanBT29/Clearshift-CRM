import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  css: false,
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
      '@cs/kernel': resolve(__dirname, './packages/kernel/src/index.ts'),
      '@cs/core': resolve(__dirname, './packages/core/src/index.ts'),
      '@cs/kit': resolve(__dirname, './packages/kit/src/index.ts'),
      '@cs/identity': resolve(__dirname, './packages/identity/src/index.ts'),
      '@cs/rbac': resolve(__dirname, './packages/rbac/src/index.ts'),
      '@cs/db': resolve(__dirname, './packages/database/src/index.ts'),
      '@cs/ui': resolve(__dirname, './packages/ui/src/index.ts'),
      '@cs/mod-crm5': resolve(__dirname, './apps/crm/modules/crm-5/src/index.ts'),
    },
  },
});
