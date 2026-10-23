import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const moduleRoot = fileURLToPath(new URL('../../', import.meta.url));
const sourceDirs = ['src', 'db'].map((dir) => join(moduleRoot, dir));

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return listSourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

const files = sourceDirs.flatMap(listSourceFiles).map((file) => ({
  path: relative(moduleRoot, file),
  text: readFileSync(file, 'utf8'),
}));

const OTHER_MODULE_SCHEMAS = ['crm1', 'crm2', 'crm4', 'crm5', 'erp1', 'erp2', 'erp3', 'erp4', 'erp5'];

describe('CRM-3 ownership boundaries (#31 / CRM3-07)', () => {
  it('scans the module source', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('never imports another module, internal or public', () => {
    const offenders = files.flatMap(({ path, text }) =>
      [...text.matchAll(/from\s+['"]([^'"]+)['"]/g)]
        .map((m) => m[1] ?? '')
        .filter((spec) => /modules\/(?!crm-3\/)|\.\.\/\.\.\/\.\.\/|@clearshift\/(crm|erp)-/.test(spec))
        .map((spec) => `${path}: ${spec}`)
    );
    expect(offenders).toEqual([]);
  });

  it('never references another module schema or table', () => {
    const offenders = files.flatMap(({ path, text }) =>
      OTHER_MODULE_SCHEMAS.filter((schema) =>
        new RegExp(`\\b${schema}[._]`, 'i').test(text)
      ).map((schema) => `${path}: ${schema}`)
    );
    expect(offenders).toEqual([]);
  });
});
