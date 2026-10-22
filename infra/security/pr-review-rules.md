# ClearShift PR Review Rules for Auth and Database Changes

**Owner:** Pari — DevOps & Security Lead  
**Stream:** Platform Baseline ([PLT-12])  
**Target:** Sprint 2 / Gate G3  
**Applicability:** All modules (CRM-1 through CRM-5, ERP-1 through ERP-5, Platform, Migration Kit)

---

## 1. Overview

Pull requests altering authentication, authorization/RBAC guards, database schemas, migrations, or data export routines introduce significant architectural and security risks. These rules define the non-negotiable verification gates required prior to merging.

---

## 2. Authentication & RBAC Changes

Any PR modifying `@cs/identity`, `@cs/rbac`, route authentication plugins, or module route handlers must verify:

1. **Explicit Permission Guard:** Every mutating route (`POST`, `PUT`, `PATCH`, `DELETE`) and read route (`GET`) must enforce explicit RBAC verification (e.g. `preHandler: [verifyToken, requireRole(...)]`).
2. **Negative Role Test Coverage:** The PR must contain automated unit or integration tests verifying `401 Unauthorized` (missing/invalid token) and `403 Forbidden` (insufficient role privileges) responses.
3. **Token Invariants:** JWT expiration must remain strictly bounded (access tokens: 15 minutes, refresh tokens: 7 days). No sensitive payload fields (passwords, encryption keys, PII) may be embedded in token claims.
4. **No Custom Auth Bypass:** No mock authentication headers or backdoor query parameters are permitted in production code paths.

---

## 3. Database Schema & Migration Changes

Any PR modifying `packages/database`, module `db/schema.ts`, or SQL migration files must verify:

1. **Schema Isolation:** Modules own their respective database schemas (e.g., `crm1`, `crm5`). Cross-module table mutation is strictly forbidden.
2. **Parameterized SQL Only:** Direct SQL string interpolation or concatenation is strictly prohibited. All SQL queries must use Drizzle ORM query builders or parameterized statements.
3. **Allow-List for Dynamic Identifiers:** Dynamic table or column names (such as sort keys or dynamic filters) must pass through an allow-list verification using `assertSafeSqlIdentifier` from `@cs/core`.
4. **Additive, Idempotent Migrations:** Migrations must use `IF NOT EXISTS` or safe additive operations. Destructive column drops or table resets require maintainer sign-off.
5. **Precision for Financial Values:** Monetary and financial numbers must use PostgreSQL `NUMERIC` / `DECIMAL` types with appropriate scale; floating-point (`REAL`, `DOUBLE PRECISION`) is strictly forbidden for financial calculations.
6. **Transaction Atomicity:** Domain state mutations and outbox event writes must commit in a single PostgreSQL transaction.

---

## 4. Export & File Parsing Changes

Any PR implementing or modifying CSV/XLSX export or ingestion must verify:

1. **Formula Injection Neutralization (CWE-1236):** All exported cell values beginning after leading whitespace with `=`, `+`, `-`, or `@` must be neutralized by prepending `'` using `exportCsvSafe` or `neutralizeFormula` from `@cs/core`.
2. **Canonical Stored Data Immutability:** Export routines must never mutate original database rows, model instances, or in-memory fixtures.
3. **Parser Limits:** Uploads must be streamed and enforce the 50 MB file size limit and 500-row batch chunking. Processing must halt when cumulative failures exceed 10%.
4. **No Cloud Uploaders:** Files must be processed locally/in-container. Uploads to external cloud storage (S3, GCS, Azure Blob, Cloudinary) are strictly out of scope for V1.

---

## 5. Review & Approval Protocol

- **Reviewer Requirement:** At least two approvals are required before merge:
  - 1 Module peer review
  - 1 PMO / Integration Lead approval (`@Soldier224K` or `@amankoli09`)
- **CI Gate:** All automated CI checks (Dependency Audit, Secret Scan, Repository Audit, Frontend & Backend tests) must be green.
