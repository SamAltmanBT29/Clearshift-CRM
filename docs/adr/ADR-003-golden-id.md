# ADR-003: Golden ID Map and Idempotent Source Identity Service

## Status
Accepted

## Context
Customer, contact, company, product, and vendor identifiers differ across CRM, ERP, support systems, and flat migration source files (CSV/Excel). Without a centralized, deterministic identity service, duplicate or unstable identities attach sales orders, invoices, and support tickets to the wrong entity, compromising financial and operational data integrity.

Traceability:
- Project Plan v3.0 §§9.3–9.6, 17
- SDS ClearShift CRM v2.0 §8.3
- SDS ClearShift Migration Kit v2.0 §§8.3, 9.2
- ClearShift Architecture Master Specification §8.3

## Decision
1. **Hub Identity Authority & Primary Key Invariant**:
   - The ClearShift Hub owns master identity resolution and assigns a unique UUID as the canonical primary identity (`goldenRecordId` / `id`).
   - Human-readable display values (formatted as `GID-<ENTITY>-<SEGMENT>`, e.g. `GID-CNT-88AB33CD`) are display-only conveniences.
   - **Non-Negotiable Constraint**: Display GIDs are NEVER used as primary keys, foreign keys, or relational join keys. All relational foreign keys must reference the UUID primary identity.

2. **Source Identity Composite Key**:
   - The unique composite key for source mapping is `(entity_type, source_system, source_id)`.
   - Distinct entity types (`contact`, `company`, `customer`, `product`, `vendor`, `employee`) partition the keyspace and never collide, even when sharing identical `source_system` and `source_id`.

3. **Lossless Source Identifier Storage**:
   - Source identifiers are preserved strictly as text strings. Lossy numeric coercion (e.g., stripping leading zeros in `"000123"` or precision loss in large 64-bit integer strings `"9223372036854775807"`) is strictly forbidden.

4. **Deterministic Exact Matching & Zero Fuzzy Auto-Merge**:
   - V1 strictly prohibits fuzzy duplicate matching scores and automatic merges (deferred to V2+).
   - Evidence normalization uses deterministic per-key normalizers (`normalizeEmail`, `normalizePhone`, `normalizeTaxNumber`, `normalizeName`, `normalizeSku`) from `@cs/core`.
   - When conflicting evidence (e.g., matching tax number but conflicting phone number, or matching email across multiple distinct existing entities) is detected, the service flags the candidate as `review_required` and opens a review candidate. It does NOT auto-merge destructively.
   - Any target-side identity merge requires the explicit human review and approval path (`POST /api/v1/hub/id-map/merge`).

5. **Idempotent Upsert & High Concurrency Semantics**:
   - The upsert endpoint (`POST /api/v1/hub/id-map`) is strictly idempotent. Repeated calls with the identical composite key return the same Golden ID.
   - Concurrent requests for the same source key use synchronized locking to guarantee that exactly one mapping row and one Golden Record are created, with all concurrent callers receiving the identical Golden ID.

6. **Explicit "Not Found" Semantics**:
   - Querying unmapped source identities or nonexistent Golden Record UUIDs returns HTTP 404 with canonical error envelopes (`{ code: "NOT_FOUND", message, correlation_id }`).

7. **Mapping History & Audit Trail**:
   - All mapping actions (`mapped`, `conflict_flagged`, `repointed`, `merged`) are recorded in an append-only mapping history log and emit privileged audit events (`identity.mapped`, `identity.conflict_flagged`, `merge.decided`) through `AuditService`.

## Acceptance Criteria & Evidence Mapping

| Acceptance Criterion | Implementation & Verification Evidence | Status |
|---|---|---|
| **AC1**: Same entity/source-system/source-id returns same Golden ID across repeated calls | `apps/hub/tests/golden-id.test.ts` ("Acceptance Criterion 1") verifying idempotency over repeated upsert and query calls | Verified |
| **AC2**: Different entity types may not collide | `apps/hub/tests/golden-id.test.ts` ("Acceptance Criterion 2") verifying `contact:salesforce:ID-100`, `company:salesforce:ID-100`, and `product:salesforce:ID-100` mint separate IDs | Verified |
| **AC3**: Concurrent upsert for same source key creates one map row | `apps/hub/tests/golden-id.test.ts` ("Acceptance Criterion 3") with 50 simultaneous parallel requests resulting in exactly 1 map row and identical UUID resolution | Verified |
| **AC4**: Conflicting tax/email/phone evidence opens review and does not auto-merge | `apps/hub/tests/golden-id.test.ts` ("Acceptance Criterion 4") testing tax number conflict, ambiguous matching, and human-authorized merge audit trail | Verified |
| **AC5**: No display GID is used as a primary or foreign key | `apps/hub/src/golden-id/generator.ts` (`assertNotDisplayGidAsKey`), route validation rejecting display GID in path parameters, and unit tests ("Acceptance Criterion 5") | Verified |

## Consequences
- Upstream modules (CRM-1, CRM-2, ERP-1 through ERP-5, and Migration Kit) interact with a single, stable identity authority via `/api/v1/hub/id-map`.
- Destructive auto-merge bugs are prevented by enforcing human review candidate gates.
- Database relational integrity is safeguarded by strictly confining display GIDs to presentation layers.
