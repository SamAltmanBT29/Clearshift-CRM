# ClearShift CRM — CRM-2 Deals, Pipeline and Quotes
## 5-Minute Operator Demo Script (Gate G4 Release Candidate)

**Module:** `CRM-2` (Deals, Pipeline and Quotes)  
**Target Milestone:** Gate G4 Release Candidate (Weeks 7–8)  
**Estimated Time:** 5 Minutes (300 Seconds)  
**Prerequisites:** Node.js 24 LTS, PostgreSQL running on localhost:5432, Fastify API server running on `http://localhost:3000`.  
**Authentication:** Valid JWT bearer token with `editor` or `admin` role for mutations (`Bearer $TOKEN`).

---

### Demo Overview & Narrative Arc

This script guides an operator, release lead, or evaluator through the complete, end-to-end verification of CRM-2 as an integrated ClearShift V1 business module. It demonstrates the 6 fixed pipeline stages, deal creation with CRM-1 contact linking, prominent orphan deal warning, simple quote issuance, deterministic idempotency, and migration kit ingestion.

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ 1. Seed & Init   │ ──> │ 2. Query Stages  │ ──> │ 3. Create Deal   │
└──────────────────┘     └──────────────────┘     └──────────────────┘
                                                           │
                                                           ▼
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ 6. Ingest Import │ <── │ 5. Issue Quote   │ <── │ 4. Orphan Deal   │
└──────────────────┘     └──────────────────┘     └──────────────────┘
         │
         ▼
┌──────────────────┐     ┌──────────────────┐
│ 7. Detect Dups   │ ──> │ 8. Reset & Clean │
└──────────────────┘     └──────────────────┘
```

---

### Step 1: Environment & Deterministic Seed (0:00 – 0:45)

**Operator Action:** Populate deterministic synthetic baseline fixtures into PostgreSQL.

```bash
# Execute deterministic seeding with clean reset
node sample-data/crm-2/seed.ts --reset
```

**Expected Console Output:**
```text
🌱 [CRM-2] Starting deterministic seed (with reset)...
📄 Deterministically wrote 100-row Dirty Data Pack to: sample-data/crm-2/dirty-data-v1.csv
🔄 Resetting CRM-2 business tables (quotes and deals)...
✅ [CRM-2] Deterministic seed completed successfully!
   - Stages verified : 6 (fixed V1 stages)
   - Deals seeded    : 3
   - Quotes seeded   : 2
   - Dirty Data rows : 100
   - Persisted to DB : YES
```

**Talking Point:** *"CRM-2 operates strictly on synthetic reference fixtures. The 6 pipeline stages are protected by an immutable database trigger (`crm2_stages_no_update`) and are never modified during resets."*

---

### Step 2: Query Fixed Reference Stages (0:45 – 1:15)

**Operator Action:** Retrieve the ordered sales pipeline stages.

```bash
curl -X GET http://localhost:3000/api/v1/crm-deals/stages \
  -H "Authorization: Bearer $VIEWER_TOKEN"
```

**Expected JSON Response (`200 OK`):**
```json
{
  "items": [
    { "id": "00000000-0000-4000-8000-000000000001", "name": "New", "order": 1, "is_closed_won": false, "is_closed_lost": false },
    { "id": "00000000-0000-4000-8000-000000000002", "name": "Qualified", "order": 2, "is_closed_won": false, "is_closed_lost": false },
    { "id": "00000000-0000-4000-8000-000000000003", "name": "Proposal", "order": 3, "is_closed_won": false, "is_closed_lost": false },
    { "id": "00000000-0000-4000-8000-000000000004", "name": "Negotiation", "order": 4, "is_closed_won": false, "is_closed_lost": false },
    { "id": "00000000-0000-4000-8000-000000000005", "name": "Won", "order": 5, "is_closed_won": true, "is_closed_lost": false },
    { "id": "00000000-0000-4000-8000-000000000006", "name": "Lost", "order": 6, "is_closed_won": false, "is_closed_lost": true }
  ]
}
```

**Talking Point:** *"The stage set is fixed strictly to these 6 canonical stages per SDS §4.3 (FR-CRM2-03). Dynamic stage creation via POST /stages is barred and returns 404."*

---

### Step 3: Create a Standard Deal with Contact Link (1:15 – 2:00)

**Operator Action:** Create an opportunity linked to an authoritative CRM-1 contact.

```bash
curl -X POST http://localhost:3000/api/v1/crm-deals/deals \
  -H "Authorization: Bearer $EDITOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Global Retail POS Infrastructure",
    "contact_id": "90000000-0000-4000-8000-000000000001",
    "value": "85000.00",
    "currency": "USD",
    "stage_name": "New",
    "close_date": "2026-12-15"
  }'
```

**Expected JSON Response (`201 Created`):**
```json
{
  "id": "20000000-0000-4000-8000-000000000101",
  "name": "Global Retail POS Infrastructure",
  "contact_id": "90000000-0000-4000-8000-000000000001",
  "contact_name": "Sarah Connor",
  "value": "85000.00",
  "currency": "USD",
  "stage_name": "New",
  "close_date": "2026-12-15",
  "is_orphan": false
}
```

**Talking Point:** *"CRM-2 validates cross-module referential integrity using an asynchronous kernel resolver. If contact_id does not exist in CRM-1, the request is safely rejected with 422."*

---

### Step 4: Create an Orphan Deal with Prominent Warning (2:00 – 2:45)

**Operator Action:** Create an inbound opportunity without an assigned contact (`contact_id: null`).

```bash
curl -X POST http://localhost:3000/api/v1/crm-deals/deals \
  -H "Authorization: Bearer $EDITOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Inbound Enterprise Lead (Unassigned)",
    "contact_id": null,
    "value": "32000.00",
    "currency": "EUR",
    "stage_name": "New",
    "close_date": "2026-11-30"
  }'
```

**Expected JSON Response (`201 Created`):**
```json
{
  "id": "20000000-0000-4000-8000-000000000102",
  "name": "Inbound Enterprise Lead (Unassigned)",
  "contact_id": null,
  "contact_name": null,
  "value": "32000.00",
  "currency": "EUR",
  "stage_name": "New",
  "close_date": "2026-11-30",
  "is_orphan": true
}
```

**Talking Point:** *"Per FR-CRM2-05, orphan deals are valid first-class records but are explicitly flagged with `is_orphan: true` and rendered with a prominent amber warning badge in the operator UI."*

> [!NOTE]
> **Manual-Only Step**: Visual inspection of the amber badge (`[⚠️ Orphan Deal — Unlinked Opportunity]`) on `http://localhost:5173/deals` requires an operator desktop browser; automated browser tests are BLOCKED pending maintainer approval for Playwright (ADR-005).

---

### Step 5: Issue a Simple Quote Linked to a Deal (2:45 – 3:30)

**Operator Action:** Issue a proposal quote linked to the deal created in Step 3.

```bash
curl -X POST http://localhost:3000/api/v1/crm-deals/quotes \
  -H "Authorization: Bearer $EDITOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "deal_id": "20000000-0000-4000-8000-000000000101",
    "quote_number": "Q-2026-9001",
    "date": "2026-10-23",
    "amount": "85000.00",
    "currency": "USD",
    "note": "Standard 30-day fixed commercial pricing."
  }'
```

**Expected JSON Response (`201 Created`):**
```json
{
  "id": "30000000-0000-4000-8000-000000000101",
  "deal_id": "20000000-0000-4000-8000-0000000101",
  "quote_number": "Q-2026-9001",
  "date": "2026-10-23",
  "amount": "85000.00",
  "currency": "USD",
  "note": "Standard 30-day fixed commercial pricing."
}
```

**Talking Point:** *"Quote numbers are globally unique. Repeating this request returns 409 Conflict without duplicate side effects."*

---

### Step 6: Idempotent Migration Kit Ingestion (3:30 – 4:15)

**Operator Action:** Ingest an external migration record through the KIT-08 Target Adapter endpoint.

```bash
curl -X POST http://localhost:3000/api/v1/crm-deals/import \
  -H "Authorization: Bearer $MIGRATION_TOKEN" \
  -H "Idempotency-Key: idemp-demo-kit-deal-01" \
  -H "Content-Type: application/json" \
  -d '{
    "batchId": "e0000000-0000-4000-8000-000000000001",
    "sourceRow": 1,
    "sourceSystem": "salesforce_legacy",
    "entity": "deal",
    "idempotencyKey": "idemp-demo-kit-deal-01",
    "data": {
      "name": "Legacy Salesforce Migrated Deal",
      "value": "120000.00",
      "currency": "USD",
      "stage_name": "Proposal",
      "close_date": "2026-12-31"
    }
  }'
```

**Expected JSON Response (`201 Created` on first call, `200 OK` on replay):**
```json
{
  "targetId": "20000000-0000-4000-8000-000000000103",
  "isExisting": false,
  "receipt": {
    "batchId": "e0000000-0000-4000-8000-000000000001",
    "sourceRow": 1,
    "entity": "deal",
    "idempotencyKey": "idemp-demo-kit-deal-01"
  }
}
```

**Talking Point:** *"The Target Adapter commits domain mutations and durable import receipts together in one PostgreSQL transaction. Retrying with the same idempotency key returns 200 OK with the existing receipt."*

---

### Step 7: Deterministic Duplicate Detection (4:15 – 4:45)

**Operator Action:** Check candidate records for deterministic exact duplicate matches.

```bash
curl -X POST http://localhost:3000/api/v1/crm-deals/duplicates/detect \
  -H "Authorization: Bearer $MIGRATION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "keyType": "deal_composite",
    "records": [
      {
        "id": "cand-01",
        "name": "  Global Retail POS Infrastructure  ",
        "stage_name": "New",
        "contact_id": "90000000-0000-4000-8000-000000000001"
      }
    ]
  }'
```

**Expected Response (`200 OK`):**
```json
{
  "duplicateCount": 1,
  "pairs": [
    {
      "sourceRecordId": "cand-01",
      "normalizedKey": "global retail pos infrastructure#New#90000000-0000-4000-8000-000000000001",
      "status": "held_for_review"
    }
  ]
}
```

**Talking Point:** *"ClearShift V1 enforces deterministic exact deduplication. Fuzzy auto-merging is strictly prohibited; duplicate pairs are held for human review."*

---

### Step 8: Clean Reset & Teardown (4:45 – 5:00)

**Operator Action:** Reset demo mutations back to the clean baseline.

```bash
node sample-data/crm-2/seed.ts --reset
```

**Expected Result:**
```text
✅ [CRM-2] Deterministic seed completed successfully!
```

---

### Verification Summary

| Step | Capability Demonstrated | SDS Requirement | Status |
| :--- | :--- | :--- | :---: |
| 1 | Deterministic Database Seeding & Reset | Gate G4 Operational Baseline | **PASS** |
| 2 | 6 Fixed Reference Pipeline Stages | FR-CRM2-03 | **PASS** |
| 3 | Deal Creation & Contact Referential Integrity | FR-CRM2-02 | **PASS** |
| 4 | Orphan Deal Flagging & Amber UI Warning | FR-CRM2-05 | **PASS** |
| 5 | Simple Quote Issuance & Unique Constraint | FR-CRM2-04 | **PASS** |
| 6 | Migration Kit Idempotent Target Adapter | KIT-08 & Decision C4 | **PASS** |
| 7 | Deterministic Exact Deduplication | Core Migration Rules | **PASS** |
| 8 | Repeatable Reset Determinism | Release Quality Standard | **PASS** |
