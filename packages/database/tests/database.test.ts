import { describe, it, expect } from 'vitest';
import { CRM_DB_VERSION } from '../src/index.js';

describe('Database Smoke Test', () => {
  it('exports correct database version', () => {
    expect(CRM_DB_VERSION).toBe('1.0.0');
  });
});
