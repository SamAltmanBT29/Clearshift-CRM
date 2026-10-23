import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: [
    './packages/database/src/schema/*.ts',
    './apps/crm/modules/*/db/schema.ts',
  ],
  out: './packages/database/migrations',
  dbCredentials: {
    url:
      process.env['DATABASE_URL'] ||
      'postgresql://cs_app:app_secret_123@localhost:5432/clearshift',
  },
  strict: true,
  verbose: true,
});
