# CRM-4 Mapping & Value Translation Configuration

**Module:** CRM-4 Marketing Lists and Campaign History  
**Issue:** #181 (`[CRM4-28]`)  
**Requirement ID:** `FR-CRM4-28`  
**Milestone:** Sprint 3 — Gate G3  
**Owning Team:** Group 4 — Role 4 — Data / QA Lead  
**Governing Documents:** SDS ClearShift CRM v2.0 §4.5 & §4.7; Master Architecture Baseline 1.0-A; ClearShift Core Rules.

---

## 1. Executive Summary

This specification governs the mapping, value translation, and dry-run validation engine for **CRM-4 Marketing Lists and Campaign History**. During ingestion, extraction, and migration pipelines, external dirty or legacy datasets must be translated deterministically into ClearShift CRM-4 schemas (`crm4_lists`, `crm4_campaigns`, `crm4_members`, `crm4_consents`).

All mapping operations adhere to non-negotiable ClearShift principles:
1. **Deterministic Type Coercion:** Pure deterministic conversions with strict validation guards.
2. **Enum Translation Dictionaries:** Normalizing varied source values (e.g. `delivered`, `open`, `opt_in`) to strict domain allowlists.
3. **Required Column Enforcement:** Blocking dry-run execution with standard `AppError('MAPPING_INCOMPLETE', ...)` if mandatory target attributes lack source mappings.
4. **Reproducible Versioned Templates:** Templates are named, versioned, immutable, and produce verifiable SHA-256 digests.
5. **Monotonic Opt-Out Guard (BR-CRM4-01):** Once a contact has an unsubscribed status, no migration, bulk update, or mapping operation may overwrite this state with consent (`subscribed`).

---

## 2. Versioned Mapping Templates

CRM-4 defines canonical and legacy export templates for each owned domain entity.

### 2.1 Marketing Lists (`crm4_lists`)
- **Canonical (`crm4-lists-canonical@v1`):**
  - `id` $\to$ `id` (`uuid`, optional)
  - `name` $\to$ `name` (`string`, **required**)
  - `description` $\to$ `description` (`string`, optional)
  - `campaign_count` $\to$ `campaignCount` (`integer`, default `0`)
  - `member_count` $\to$ `memberCount` (`integer`, default `0`)
  - `created_at` $\to$ `createdAt` (`date`, omit when blank)
  - `updated_at` $\to$ `updatedAt` (`date`, optional)
- **Legacy Export (`crm4-lists-legacy@v1`):**
  - `ListId` $\to$ `id` (`uuid`)
  - `ListName` $\to$ `name` (`string`, **required**)
  - `ListDescription` $\to$ `description` (`string`)
  - `TotalCampaigns` $\to$ `campaignCount` (`integer`, default `0`)
  - `TotalMembers` $\to$ `memberCount` (`integer`, default `0`)

### 2.2 Campaigns (`crm4_campaigns`)
- **Canonical (`crm4-campaigns-canonical@v1`):**
  - `id` $\to$ `id` (`uuid`, optional)
  - `name` $\to$ `name` (`string`, **required**)
  - `campaign_date` $\to$ `campaignDate` (`date`, **required**, format `YYYY-MM-DD`)
  - `list_id` $\to$ `listId` (`uuid`, **required**, references `crm4_lists.id`)
  - `member_count` $\to$ `memberCount` (`integer`, default `0`)
  - `created_at` $\to$ `createdAt` (`date`, omit when blank)
  - `updated_at` $\to$ `updatedAt` (`date`, optional)
- **Legacy Export (`crm4-campaigns-legacy@v1`):**
  - `CampaignId` $\to$ `id` (`uuid`)
  - `CampaignName` $\to$ `name` (`string`, **required**)
  - `ScheduledDate` $\to$ `campaignDate` (`date`, **required**)
  - `TargetListId` $\to$ `listId` (`uuid`, **required**)
  - `TotalAudience` $\to$ `memberCount` (`integer`, default `0`)

### 2.3 Campaign Members (`crm4_members`)
- **Canonical (`crm4-members-canonical@v1`):**
  - `id` $\to$ `id` (`uuid`, optional)
  - `campaign_id` $\to$ `campaignId` (`uuid`, **required**, cascade on campaign)
  - `contact_id` $\to$ `contactId` (`uuid`, **required**)
  - `status` $\to$ `status` (`string`, **required**, enum `member_status`, default `sent`)
  - `unsubscribed` $\to$ `unsubscribed` (`boolean`, default `false`)
  - `created_at` $\to$ `createdAt` (`date`, omit when blank)
- **Legacy Export (`crm4-members-legacy@v1`):**
  - `MemberId` $\to$ `id` (`uuid`)
  - `CampaignRef` $\to$ `campaignId` (`uuid`, **required**)
  - `ContactRef` $\to$ `contactId` (`uuid`, **required**)
  - `DeliveryStatus` $\to$ `status` (`string`, **required**, enum `member_status`, default `sent`)
  - `OptOutIndicator` $\to$ `unsubscribed` (`boolean`, default `false`)

### 2.4 Contact Consents (`crm4_consents`)
- **Canonical (`crm4-consents-canonical@v1`):**
  - `id` $\to$ `id` (`uuid`, optional)
  - `contact_id` $\to$ `contactId` (`uuid`, **required**, unique 1:1)
  - `status` $\to$ `status` (`string`, **required**, enum `consent_status`, default `subscribed`)
  - `source` $\to$ `source` (`string`, **required**, non-empty)
  - `consent_date` $\to$ `consentDate` (`date`, omit when blank)
  - `created_at` $\to$ `createdAt` (`date`, omit when blank)
  - `updated_at` $\to$ `updatedAt` (`date`, optional)
- **Legacy Export (`crm4-consents-legacy@v1`):**
  - `RecordId` $\to$ `id` (`uuid`)
  - `ContactRef` $\to$ `contactId` (`uuid`, **required**)
  - `SubscriptionState` $\to$ `status` (`string`, **required**, enum `consent_status`, default `subscribed`)
  - `AcquisitionChannel` $\to$ `source` (`string`, **required**)
  - `Timestamp` $\to$ `consentDate` (`date`)

---

## 3. Enum Translation Dictionaries

ClearShift enforces strict domain allowlists while normalizing common dirty/legacy variants:

### 3.1 Member Status (`member_status`)
- **Allowlist:** `['sent', 'opened', 'clicked']`
- **Synonym Mappings:**
  - `sent`, `send`, `delivered`, `deliver`, `dispatched`, `queued`, `outbound` $\to$ `'sent'`
  - `opened`, `open`, `read`, `viewed`, `view` $\to$ `'opened'`
  - `clicked`, `click`, `engaged`, `tap`, `tapped` $\to$ `'clicked'`
  - Any unknown string (e.g. `bounced`, `failed`) is rejected with `INVALID_ENUM_VALUE`.

### 3.2 Consent Status (`consent_status`)
- **Allowlist:** `['subscribed', 'unsubscribed']`
- **Synonym Mappings:**
  - `subscribed`, `subscribe`, `sub`, `opt_in`, `opt-in`, `optin`, `granted`, `grant`, `yes`, `true`, `1`, `active`, `consented`, `agreed` $\to$ `'subscribed'`
  - `unsubscribed`, `unsubscribe`, `unsub`, `opt_out`, `opt-out`, `optout`, `withdrawn`, `withdraw`, `revoked`, `revoke`, `no`, `false`, `0`, `rejected` $\to$ `'unsubscribed'`

### 3.3 Boolean (`boolean`)
- **Allowlist:** `['true', 'false']`
- **Synonym Mappings:**
  - `true`, `yes`, `1`, `t`, `y`, `subscribed`, `opt_in` $\to$ `'true'` (coerced to boolean `true`)
  - `false`, `no`, `0`, `f`, `n`, `unsubscribed`, `opt_out` $\to$ `'false'` (coerced to boolean `false`)

---

## 4. Dry-Run Readiness & Validation Guards

The dry-run pipeline validates mapping configuration prior to processing records:

```ts
assertDryRunReady(template: MappingTemplate, sourceColumns: readonly string[]): void
```

1. Inspects all required fields in the active template (`name`, `campaign_date`, `list_id`, `contact_id`, etc.).
2. Cross-references source column headers (including configured aliases/alternate sources).
3. If any mandatory attribute lacks a corresponding source column, throws `AppError('MAPPING_INCOMPLETE', ...)` with HTTP 400 and structured error details (`MISSING_SOURCE_COLUMN`).

---

## 5. Domain Invariant: BR-CRM4-01 Monotonic Opt-Out

In accordance with SDS ClearShift CRM v2.0 §4.5, consent state for migration is strictly monotonic:
- If a source record includes prior or existing consent state (`prior_consent_status`, `existing_status`, `current_status`) indicating `unsubscribed`, any attempt to map or import a subsequent status of `subscribed` is blocked.
- The mapper raises `MONOTONIC_OPT_OUT_VIOLATION`:
  `Domain Invariant Violation (BR-CRM4-01): Opt-out is strictly monotonic. Once unsubscribed, re-subscription via migration or bulk load is prohibited.`

---

## 6. Cryptographic Reproducibility

Every template generates a deterministic SHA-256 digest:
```ts
export function templateChecksum(template: MappingTemplate): string {
  return createHash('sha256').update(JSON.stringify(template)).digest('hex');
}
```
This ensures template configurations can be verified across runs, pipeline stages, and audit receipts.

---

## 7. Fastify API Endpoints

The module exposes standard mapping routes under `/api/v1/crm-marketing`:
- `GET /mappings/templates`: List all registered templates, optionally filtered by `?entity=crm4_lists`.
- `GET /mappings/templates/:id`: Get a specific template by ID with its checksum and fields.
- `POST /mappings/validate`: Validate that a template is ready for dry-run against supplied source columns.
- `POST /mappings/map`: Execute deterministic batch mapping of source rows using a designated template.
