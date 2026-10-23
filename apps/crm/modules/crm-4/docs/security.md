# CRM-4 Marketing Lists and Campaign History: Security Architecture and Controls

## 1. Executive Summary

This specification defines the security architecture, authorization policies, sensitive data protection, and audit logging controls implemented in the **CRM-4 Marketing Lists and Campaign History** module for ClearShift CRM V1.

All mechanisms strictly satisfy the **ClearShift CRM System Design Specification (SDS) v2.0 §4 / §7.1**, **ClearShift Project Plan v3.0 §7.4, §9.3–9.6, §17**, and the constraints of Gate G4.

---

## 2. Authentication & JWT Validation

The CRM-4 module delegates identity issuance to ClearShift Hub Identity (`@cs/identity`) and enforces server-side verification using asymmetric key cryptography (EdDSA):

* **Algorithm**: EdDSA (Ed25519) asymmetric signatures.
* **Issuer (`iss`)**: Must equal `clearshift-hub`.
* **Audience (`aud`)**: Must equal `clearshift`.
* **Token Expiration (`exp`)**: Strict timestamp validation against system time.
* **Account Status**: Tokens for disabled accounts (`disabled: true` or `status: "disabled"`) are rejected immediately with HTTP `401 Unauthorized`.
* **Missing/Invalid Header**: Requests lacking an `Authorization: Bearer <token>` header or carrying malformed/tampered tokens fail closed with HTTP `401 Unauthorized`.

The Fastify authentication plugin (`crm4AuthPlugin`) registers pre-handler hooks across all `/api/v1/crm-marketing/*` routes, attaching validated `HubTokenClaims` to `request.user`.

---

## 3. Role-Based Access Control (RBAC)

CRM-4 implements exact route-level role enforcement according to the SDS Endpoint Matrix. The allowable roles are:
* `viewer`: Read-only access to marketing lists, campaigns, campaign members, and consent records.
* `editor`: Full create/edit privileges on marketing lists, campaigns, campaign members, and consent records.
* `analyst`: Read access across marketing lists, campaigns, campaign members, and consent status.
* `admin`: Complete administrative privileges across all CRM-4 endpoints.
* `migration_runner`: Strictly prohibited from directly invoking CRM-4 marketing endpoints (HTTP 403 Forbidden). In V1, marketing data cannot be bulk-modified without explicit consent verification and human review.

### Endpoint Role Matrix

| Endpoint Route | HTTP Method | Allowed Roles | Prohibited Roles (HTTP 403) |
|---|---|---|---|
| `/api/v1/crm-marketing/lists` | `GET` | `viewer`, `editor`, `analyst`, `admin` | `migration_runner` |
| `/api/v1/crm-marketing/lists` | `POST` | `editor`, `admin` | `viewer`, `analyst`, `migration_runner` |
| `/api/v1/crm-marketing/lists/:id` | `GET` | `viewer`, `editor`, `analyst`, `admin` | `migration_runner` |
| `/api/v1/crm-marketing/lists/:id` | `PATCH` | `editor`, `admin` | `viewer`, `analyst`, `migration_runner` |
| `/api/v1/crm-marketing/campaigns` | `GET` | `viewer`, `editor`, `analyst`, `admin` | `migration_runner` |
| `/api/v1/crm-marketing/campaigns` | `POST` | `editor`, `admin` | `viewer`, `analyst`, `migration_runner` |
| `/api/v1/crm-marketing/campaigns/:id` | `GET` | `viewer`, `editor`, `analyst`, `admin` | `migration_runner` |
| `/api/v1/crm-marketing/campaigns/:id` | `PATCH` | `editor`, `admin` | `viewer`, `analyst`, `migration_runner` |
| `/api/v1/crm-marketing/campaigns/:id/members` | `GET` | `viewer`, `editor`, `analyst`, `admin` | `migration_runner` |
| `/api/v1/crm-marketing/campaigns/:id/members` | `POST` | `editor`, `admin` | `viewer`, `analyst`, `migration_runner` |
| `/api/v1/crm-marketing/consents` | `POST` | `editor`, `admin` | `viewer`, `analyst`, `migration_runner` |
| `/api/v1/crm-marketing/consents/:contact` | `GET` | `viewer`, `editor`, `analyst`, `admin` | `migration_runner` |
| `/api/v1/crm-marketing/campaigns/:id/export` | `GET` | `viewer`, `editor`, `analyst`, `admin` | `migration_runner` |

---

## 4. Sensitive Field Protection & Masking

Field-level protection is enforced on the server **prior to serialization and export**, ensuring that sensitive attributes cannot leak even if the user bypasses UI presentation layers:

1. **Bank Details**:
   * Masked format: `XXXX-XXXX-7890` (preserving only the terminal 4 digits).
   * Short values (fewer than 4 digits) mask completely as `XXXX-XXXX-XXXX`.
2. **Salary Information**:
   * Formatted numeric values are masked as `XX,XXX`.
   * Unformatted or missing values are converted to `"salary hidden"`.
3. **Credentials & Tokens**:
   * Auth tokens, passwords, bearer headers, and client secrets are stripped or replaced with `[REDACTED]` prior to logging.
4. **CSV Export Injection Defense**:
   * Cell values beginning with formula prefixes (`=`, `+`, `-`, `@`, `\t`, `\r`) are automatically escaped with a leading single quote (`'`) to prevent spreadsheet formula injection.
5. **Log Redaction**:
   * `maskSensitiveLog()` inspects log strings and object keys to prevent accidental leakage of PII, account numbers, or authorization headers into stdout or error collectors.

---

## 5. Audit Logging Architecture

The CRM-4 module maintains an append-only audit trail via `Crm4AuditService`:

* **Recorded Events**:
  * Marketing list creation and updates (`crm4.list.created`, `crm4.list.updated`).
  * Campaign creation and updates (`crm4.campaign.created`, `crm4.campaign.updated`).
  * Campaign member additions (`crm4.member.added`).
  * Contact consent assertions and opt-outs (`crm4.consent.updated`).
  * CSV exports (`crm4.campaign.exported`).
* **Event Structure**:
  * `actor`: Authenticated User ID (`sub` / `userId`) and role set.
  * `action`: Action verb matching standard taxonomy.
  * `timestamp`: ISO-8601 UTC timestamp.
  * `entity`: Entity type (`marketing_list`, `campaign`, `campaign_member`, `consent`).
  * `entityId`: Primary UUID of the affected entity.
  * `result`: Status outcome (`success` or `failure`).
  * `diffRedacted`: Pre-redacted diff attributes.
  * `metadata`: Contextual details with sensitive fields pre-redacted.
* **Safe Logging Invariant**:
  * Raw rows, passwords, bearer tokens, full bank accounts, and raw national identifiers are never written to audit records or system logs.

---

## 6. Object-Level & Multi-Tenant Guards

1. **Multi-Tenant Boundary Isolation (`assertTenantIsolation`)**:
   * Evaluates request tenant context against JWT claims (`tenant_id`, `tenantId`, `org_id`).
   * Validates header tenant indicators (`x-tenant-id`, `x-organization-id`, `x-org-id`).
   * Rejects header-token mismatches and cross-tenant resource mutations with `HTTP 403 Forbidden`.
2. **Cross-User Record Ownership (`assertRecordOwnership`)**:
   * Restricts mutations on records with assigned owners/creators to the record owner (`employee_id` or `sub`).
   * Administrator users (`admin` role) possess universal override for operational maintenance.
3. **Immutable Field Mutation Guard (`assertNoImmutableFieldMutation`)**:
   * Campaigns belong to exactly one marketing list throughout their lifecycle; updating `listId` on `PATCH /campaigns/:id` is strictly prohibited and returns `HTTP 403 Forbidden`.
   * Record primary keys (`id`) and audit creation timestamps (`createdAt`) are read-only and cannot be altered.

---

## 7. Domain Invariants & Business Rules

1. **Deterministic Monotonic Opt-Out (BR-CRM4-01)**:
   * A known opt-out / unsubscribe is strictly monotonic. Once a contact is marked `unsubscribed`, neither migration imports, bulk action, nor API mutations may revert the status to `subscribed`.
   * Any attempt to overwrite an `unsubscribed` status with `subscribed` raises an invariant violation and returns `HTTP 409 Conflict`.
2. **Member Status Allowlist**:
   * Campaign member status is strictly restricted to `sent`, `opened`, and `clicked`. Arbitrary member states are rejected with `HTTP 400 Validation Error`.
3. **Consent Verification at Action Time**:
   * Membership creation and CSV exports verify the current contact consent status at execution time.
4. **Campaign Transmission Out of Scope**:
   * Outbound email, SMS, SMTP, or delivery queue integrations are strictly out of scope for V1 (campaign history and engagement recording only).

---

## 8. Synthetic Data Constraint

In strict compliance with ClearShift Core Rules:
* All development, testing, and demonstration data consists solely of 100% synthetic fixtures.
* Real customer, employee, or corporate data is strictly prohibited.
* No credentials, `.env` files, or production secrets may ever be committed to the repository.
