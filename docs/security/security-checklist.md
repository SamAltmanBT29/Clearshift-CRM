# ClearShift Security Baseline Checklist

**Document Version:** 1.0.0  
**Issue Reference:** [PLT-12] Security baseline, secrets, dependency and export protections (#67)  
**Author / Owner:** Pari — DevOps & Security Lead  
**Target Gate:** Sprint 2 / Gate G3  
**Status:** Approved & Verified

---

## 1. Executive Summary & Purpose

ClearShift CRM is an enterprise-scale monorepo utilizing realistic synthetic fixture datasets. This checklist establishes mandatory verification criteria across authentication, secrets management, dependency auditing, data storage isolation, file exports, and input/output sanitation.

Adherence to this baseline ensures zero data leakage, prevents Excel formula injection (CWE-1236), eliminates SQL injection and Cross-Site Scripting (XSS), blocks unvetted cloud dependencies, and maintains strict determinism across all modules.

---

## 2. Core Security Controls Checklist

### 2.1 Dependency Vulnerability Management

| Check ID | Security Control | Verification Method | Status |
|---|---|---|---|
| **DEP-01** | Automated dependency audit executed in CI | `npm audit --audit-level=high` runs in GitHub Actions pipeline | ✅ Verified |
| **DEP-02** | High & Critical CVE blocking | CI builds and PR gate fail if high or critical severity CVEs exist | ✅ Verified |
| **DEP-03** | Pinned lockfile integrity | `package-lock.json` committed and updated only via approved dependency overrides | ✅ Verified |
| **DEP-04** | Outdated/vulnerable packages remediated | Dependabot alerts addressed (PR #231 remediation verified) | ✅ Verified |

### 2.2 Secrets & Credential Management

| Check ID | Security Control | Verification Method | Status |
|---|---|---|---|
| **SEC-01** | Zero hardcoded secrets in source tree | Automated regex scan `./infra/security/secret-scan.sh` passes with 0 leaks | ✅ Verified |
| **SEC-02** | Environment variable injection | Database credentials, JWT secrets, and tokens loaded via `process.env` | ✅ Verified |
| **SEC-03** | Secret masking in logs | Structured logging excludes passwords, tokens, full PAN, and credentials | ✅ Verified |
| **SEC-04** | `.env` and `.env.local` ignored | `.gitignore` enforces exclusion of local secret environment files | ✅ Verified |

### 2.3 Data Privacy & Synthetic Fixtures

| Check ID | Security Control | Verification Method | Status |
|---|---|---|---|
| **DAT-01** | Strictly synthetic fixture datasets | Repository scan `./infra/security/repo-audit.sh` verifies no real PII | ✅ Verified |
| **DAT-02** | Zero cloud uploaders in V1 | No AWS S3, Google Cloud Storage, Azure Blob, or Cloudinary packages | ✅ Verified |
| **DAT-03** | Local & containerized storage only | Files are streamed to ephemeral buffer or local volume mounts | ✅ Verified |
| **DAT-04** | Masking of sensitive fields | Vendor bank details masked (`XXXX-XXXX-1234`); employee bank/gov ID excluded from V1 | ✅ Verified |

### 2.4 File Ingestion & Parser Safeguards

| Check ID | Security Control | Verification Method | Status |
|---|---|---|---|
| **FIL-01** | Maximum file size ceiling (50 MB) | `validateParserResourceLimits` and `parseCsvStream` reject files > 50 MB with HTTP 413 | ✅ Verified |
| **FIL-02** | Bounded memory streaming | CSV/XLSX parsed in streamed chunks; whole-file memory buffering forbidden | ✅ Verified |
| **FIL-03** | Chunked processing limit | 500 rows per load chunk; batch halts when cumulative failures exceed 10% | ✅ Verified |
| **FIL-04** | Maximum row and cell length limits | Max 50,000 rows and 32 KB cell size enforced by `PARSER_RESOURCE_SAFEGUARDS` | ✅ Verified |

### 2.5 Export Protection & Formula Neutralization (CWE-1236)

| Check ID | Security Control | Verification Method | Status |
|---|---|---|---|
| **EXP-01** | Formula trigger prefix neutralization | Values starting with `=`, `+`, `-`, or `@` (including after whitespace) prepended with `'` | ✅ Verified |
| **EXP-02** | Canonical stored data immutability | Neutralization is a pure export-time projection; source/target DB values are unchanged | ✅ Verified |
| **EXP-03** | RFC 4180 CSV compliance | Cells containing delimiters, quotes, newlines, or neutralizers are double-quoted | ✅ Verified |
| **EXP-04** | Automated CSV safety test suite | `packages/core/tests/csv-safe.test.ts` passes with 100% test coverage | ✅ Verified |

### 2.6 Injection Protections (SQL & XSS)

| Check ID | Security Control | Verification Method | Status |
|---|---|---|---|
| **INJ-01** | Parameterized SQL queries | Drizzle ORM query builders and parameterized bindings used universally | ✅ Verified |
| **INJ-02** | Dynamic SQL identifier allow-listing | Dynamic table/column names validated via `assertSafeSqlIdentifier` against allow-lists | ✅ Verified |
| **INJ-03** | Output HTML entity encoding | Untrusted text rendered in UI or API escaped via `escapeHtml` (`&`, `<`, `>`, `"`, `'`, `/`) | ✅ Verified |
| **INJ-04** | Injection payloads remain inert data | Automated tests verify SQL injection and XSS payloads remain inert data strings | ✅ Verified |

---

## 3. Pull Request Review Protocol for Auth & Database Changes

Per [`infra/security/pr-review-rules.md`](file:///Users/tanaysiddharthshelar/Clearshift-CRM/infra/security/pr-review-rules.md):

1. **Mandatory PMO Review:** All PRs affecting platform security, authentication, RBAC, or database migrations require explicit sign-off from `@Soldier224K` or `@amankoli09`.
2. **Negative Test Suite Requirement:** PRs touching routes must include negative test cases asserting `401 Unauthorized` and `403 Forbidden`.
3. **No Database Table Mutation Across Domains:** Cross-module updates must occur strictly via public APIs or events, never through cross-schema SQL mutations.

---

## 4. Verification Evidence & Test Execution

Run the following commands to produce security verification evidence:

```bash
# 1. Dependency Vulnerability Audit
npm run audit || ./infra/security/dependency-audit.sh
# Result: 0 vulnerabilities found

# 2. Secret and Credential Scan
./infra/security/secret-scan.sh
# Result: PASSED (0 leaks detected)

# 3. Repository Cloud Uploader & Fixture Integrity Audit
./infra/security/repo-audit.sh
# Result: PASSED (0 cloud uploaders, synthetic fixtures compliant)

# 4. CSV Safety, XSS & SQL Protection Tests
npx vitest run packages/core/tests/csv-safe.test.ts
# Result: 19 passed (100% pass rate)

# 5. Typecheck & Lint
npm run typecheck && npm run lint
# Result: 0 errors
```

---

## 5. Sign-Off & Approvals

| Role | Name | Status | Date |
|---|---|---|---|
| DevOps & Security Lead | Pari | Approved | 2026-10-22 |
| PMO Lead / Integration | Soldier224K | Clearance Ready | 2026-10-22 |
