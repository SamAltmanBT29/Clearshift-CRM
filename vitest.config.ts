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
    alias: [
      { find: /^@clearshift\/contracts\/crm-1$/, replacement: resolve(__dirname, './packages/contracts/src/crm-1.ts') },
      { find: /^@clearshift\/database$/, replacement: resolve(__dirname, './packages/database/src/index.ts') },
      { find: /^@clearshift\/contracts$/, replacement: resolve(__dirname, './packages/contracts/src/index.ts') },
      { find: /^@clearshift\/ui$/, replacement: resolve(__dirname, './packages/ui/src/index.ts') },
      { find: /^@cs\/kernel$/, replacement: resolve(__dirname, './packages/kernel/src/index.ts') },
      { find: /^@cs\/core$/, replacement: resolve(__dirname, './packages/core/src/index.ts') },
      { find: /^@cs\/kit$/, replacement: resolve(__dirname, './packages/kit/src/index.ts') },
      { find: /^@cs\/identity$/, replacement: resolve(__dirname, './packages/identity/src/index.ts') },
      { find: /^@cs\/rbac$/, replacement: resolve(__dirname, './packages/rbac/src/index.ts') },
      { find: /^@cs\/db$/, replacement: resolve(__dirname, './packages/database/src/index.ts') },
      { find: /^@cs\/ui$/, replacement: resolve(__dirname, './packages/ui/src/index.ts') },
      { find: /^@cs\/mod-crm1$/, replacement: resolve(__dirname, './apps/crm/modules/crm-1/src/index.ts') },
      { find: /^@cs\/mod-crm5$/, replacement: resolve(__dirname, './apps/crm/modules/crm-5/src/index.ts') }
    ]
  },
});
