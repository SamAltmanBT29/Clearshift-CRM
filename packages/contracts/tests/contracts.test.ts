import { describe, it, expect } from 'vitest';
import { CRM_CONTRACT_VERSION } from '../src/index.js';

describe('Contracts Smoke Test', () => {
  it('exports correct contract version', () => {
    expect(CRM_CONTRACT_VERSION).toBe('1.0.0');
  });
});
