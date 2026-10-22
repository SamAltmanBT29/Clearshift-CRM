# ClearShift V1 Append-Only Audit Trail Policy & Sensitive Data Safety

## Document Control
- **Issue Reference**: [PLT-10] Append-only audit trail and sensitive-data-safe logs (#65)
- **Status**: APPROVED
- **Enforcement Level**: Non-Negotiable Core Invariant

---

## 1. Executive Summary
This policy defines the append-only audit trail and sensitive data redaction standard for the ClearShift CRM platform, complying with Project Plan v3.0 §§9.3-9.6, 17 and ClearShift SDS §3.10.

---

## 2. Invariants & Architecture Guarantees

### 2.1 Append-Only Immutability
1. **Database-Level Protection**:
   - The application database role is granted `SELECT` and `INSERT` permissions exclusively on the `audit_logs` table.
   - `UPDATE`, `DELETE`, and `TRUNCATE` operations are strictly revoked.
2. **Application-Level Enforcement**:
   - The `AuditService` and `IAuditRepository` interfaces reject mutations at runtime by throwing `AuditImmutabilityError`.
   - No update or delete endpoints exist for audit records.

### 2.2 Privileged Operations Coverage
The following privileged domain operations must produce an immutable audit entry:
- `export.generated`: Any data export creation (CSV, JSON, XLSX).
- `merge.decided`: Golden ID and entity merge/deduplication decisions.
- `role.changed`: Role, privilege, or permission changes for users.
- `load.requested`: Migration Kit batch ingestion requests.
- `rollback.requested`: Ingestion batch rollback or purge requests.
- `journal.posted` / `journal.reversed`: Financial transaction lifecycle events.
- `auth.succeeded` / `auth.failed`: User authentication attempts.

### 2.3 Strict Sensitive Data Redaction
Under no circumstances may sensitive data enter logs, errors, or audit trails:
- **Passwords & Hashes**: `password`, `passwd`, `argon2Hash`, `passwordHash` are replaced with `[REDACTED_SECRET]`.
- **Bearer & JWT Tokens**: Bearer headers and JWT payloads are masked to `Bearer [REDACTED_TOKEN]` and `[REDACTED_JWT]`.
- **Financial Details**: Bank accounts are masked to only their final 4 digits (`****1234`); salary/compensation numbers are replaced with `[REDACTED_FINANCIAL]`.
- **Government & Tax Identifiers**: SSN, National ID, Aadhaar, PAN, and Tax IDs are replaced with `[REDACTED_ID]`.
- **Raw Payloads**: Complete unvalidated CSV/XLSX input rows (`raw_row`, `raw_payload`) are prohibited from being saved in audit metadata. Audits store entity IDs and summary counts.

---

## 3. Schema Reference (`platform.audit_logs`)

| Column Name | Type | Description |
|---|---|---|
| `id` | `UUID` | Primary key, default randomly generated. |
| `occurred_at` | `TIMESTAMPTZ` | Timestamp of action execution. |
| `actor` | `TEXT` | User identifier, service account, or worker name. |
| `actor_role` | `TEXT` | Role of actor at execution time. |
| `action` | `TEXT` | Privileged operation identifier. |
| `target_entity` | `TEXT` | Domain entity name (`company`, `contact`, `deal`, `batch`). |
| `target_id` | `TEXT` | Entity identifier or primary reference key. |
| `correlation_id`| `TEXT` | Request or worker trace correlation identifier. |
| `batch_id` | `TEXT` | Associated migration batch ID (optional). |
| `result` | `TEXT` | Execution outcome (`success` or `failure`). |
| `reason` | `TEXT` | Sanitized explanation or error code. |
| `metadata` | `JSONB` | Redacted non-sensitive auxiliary context. |
| `ip_address` | `TEXT` | Client IP address where applicable. |
| `user_agent` | `TEXT` | Client User-Agent string where applicable. |
