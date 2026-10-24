# ClearShift CRM — CRM-1 Contacts, Companies and Leads
## 5-Minute Operator Demo Script (Gate G4 Release Candidate)

**Module:** `CRM-1` (Contacts, Companies and Leads)  
**Target Milestone:** Gate G4 Release Candidate (Weeks 7–8)  
**Estimated Time:** 5 Minutes (300 Seconds)  
**Prerequisites:** Node.js 24 LTS, PostgreSQL running on `localhost:5432`, Fastify API server running on `http://localhost:3000`.  
**Authentication:** Valid JWT bearer token with `editor`, `migration_runner`, or `admin` role for mutations (`Bearer $TOKEN`).

---

### Demo Overview & Narrative Arc

This script guides an evaluator, release lead, or operator through the complete, end-to-end verification of CRM-1 as an integrated ClearShift V1 master data module. It demonstrates deterministic seeding, server-paged contact search with default page size 25, flat master company creation, contact linking with system Golden IDs, forward-only lead lifecycle transitions, atomic Target Adapter ingestion with durable receipts, and rejection review.

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ 1. Seed & Init   │ ──> │ 2. Paged Search  │ ──> │ 3. Create Company│
└──────────────────┘     └──────────────────┘     └──────────────────┘
                                                           │
                                                           ▼
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ 6. Ingest Import │ <── │ 5. Lead Lifecycle│ <── │ 4. Create Contact│
└──────────────────┘     └──────────────────┘     └──────────────────┘
         │
         ▼
┌──────────────────┐     ┌──────────────────┐
│ 7. Audit Rejects │ ──> │ 8. Reset & Clean │
└──────────────────┘     └──────────────────┘
```

---

### Step 1: Environment & Deterministic Seed (0:00 – 0:45)

**Operator Action:** Populate deterministic synthetic baseline fixtures into PostgreSQL and verify Dirty Data Pack checksums.

```bash
# Execute deterministic seeding with clean reset
npm run seed:crm1 -- --reset
```

**Expected Console Output:**
```text
🌱 [CRM-1] Starting deterministic seed (with reset)...
📄 Verified Dirty Data Packs:
   - dirty-pack-100.csv sha256 : a87d39a0f1432eb5e6a12c639b3f82f80d01a542802275dfd658c54cccb77062
   - dirty-data-v1.csv  sha256 : 23d214a7a308a81c4b867ec7f8907b23d1cdb87c5e24c3c05d4ce9b15d23a6d0
🔄 Resetting CRM-1 business and import tables...
✅ [CRM-1] Deterministic seed completed successfully!
   - Companies seeded    : 5 (flat V1 companies)
   - Contacts seeded     : 27 (> 25 items for server paging)
   - Leads seeded        : 4
   - Import batches      : 1
   - Import receipts     : 2
   - Import rejects      : 1
   - Dirty Data pack     : 100 rows verified
   - Persisted to DB     : YES
```

**Talking Point:** *"CRM-1 operates strictly on synthetic reference fixtures with zero real customer PII. The Dirty Data Pack fixtures match the canonical SHA-256 hashes defined in expected-profile.json, and the database seeds 27 contacts to verify server-side pagination."*

---

### Step 2: Query & Server-Paged Contact Search (0:45 – 1:30)

**Operator Action:** Search contacts by query and verify default server pagination (`pageSize: 25`).

```bash
# Query Page 1 with default pageSize 25 (returns 25 items of 27 total)
curl -X GET "http://localhost:3000/api/v1/crm-contacts/contacts?page=1&pageSize=25" \
  -H "Authorization: Bearer $VIEWER_TOKEN"
```

**Expected JSON Response (`200 OK` excerpt):**
```json
{
  "items": [
    {
      "id": "10000000-0000-4000-8000-000000000001",
      "firstName": "Sarah",
      "lastName": "Connor",
      "email": "sarah.connor@apexrobotics.example.com",
      "phone": "+1-555-0141",
      "companyId": "550e8400-e29b-41d4-a716-446655440001",
      "companyName": "Apex Robotics International",
      "leadStatus": "Qualified",
      "goldenId": "GLD-CRM1-00000001",
      "consentStatus": "granted"
    }
  ],
  "total": 27,
  "page": 1,
  "pageSize": 25,
  "totalPages": 2
}
```

```bash
# Query Page 2 (returns remaining 2 items)
curl -X GET "http://localhost:3000/api/v1/crm-contacts/contacts?page=2&pageSize=25" \
  -H "Authorization: Bearer $VIEWER_TOKEN"
```

```bash
# Filter search by name or email
curl -X GET "http://localhost:3000/api/v1/crm-contacts/contacts?search=matrix" \
  -H "Authorization: Bearer $VIEWER_TOKEN"
```

**Talking Point:** *"Per FR-CRM1-04, contact search executes case-insensitively across first name, last name, and email with indexed database queries. The default page size is strictly 25, bounding memory consumption in browser and server."*

---

### Step 3: Create a Flat Master Company (1:30 – 2:15)

**Operator Action:** Create a flat master company account.

```bash
curl -X POST http://localhost:3000/api/v1/crm-contacts/companies \
  -H "Authorization: Bearer $EDITOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Acme Industrial Technologies LLC",
    "taxNumber": "US-EIN-998877665",
    "email": "procurement@acmeindustrial.example.com",
    "phone": "+1-555-0188",
    "address": "700 Heavy Tech Blvd, Chicago, IL 60601"
  }'
```

**Expected JSON Response (`201 Created`):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440199",
  "name": "Acme Industrial Technologies LLC",
  "taxNumber": "US-EIN-998877665",
  "email": "procurement@acmeindustrial.example.com",
  "phone": "+1-555-0188",
  "address": "700 Heavy Tech Blvd, Chicago, IL 60601",
  "createdAt": "2026-10-24T12:00:00.000Z",
  "updatedAt": "2026-10-24T12:00:00.000Z"
}
```

**Talking Point:** *"Per FR-CRM1-01, V1 strictly enforces a flat company architecture. Hierarchical corporate tree selectors are out of scope. Company names are validated non-empty, and tax numbers are deterministically normalized."*

---

### Step 4: Create Contact Linked to Company (2:15 – 3:00)

**Operator Action:** Create an individual contact linked to the newly created company.

```bash
curl -X POST http://localhost:3000/api/v1/crm-contacts/contacts \
  -H "Authorization: Bearer $EDITOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Marcus",
    "lastName": "Wright",
    "email": "marcus.wright@acmeindustrial.example.com",
    "phone": "+1-555-0199",
    "address": "700 Heavy Tech Blvd, Suite 400, Chicago, IL",
    "companyId": "550e8400-e29b-41d4-a716-446655440199",
    "leadStatus": "New"
  }'
```

**Expected JSON Response (`201 Created`):**
```json
{
  "id": "10000000-0000-4000-8000-000000000199",
  "firstName": "Marcus",
  "lastName": "Wright",
  "email": "marcus.wright@acmeindustrial.example.com",
  "phone": "+1-555-0199",
  "companyId": "550e8400-e29b-41d4-a716-446655440199",
  "companyName": "Acme Industrial Technologies LLC",
  "leadStatus": "New",
  "goldenId": "GLD-CRM1-00000199",
  "consentStatus": "unknown",
  "unsubscribed": false
}
```

**Talking Point:** *"The contact is persisted with a system-assigned immutable Golden ID (`goldenId`). The company relationship is protected by a foreign key constraint with ON DELETE RESTRICT, preventing accidental dangling references."*

---

### Step 5: Advance Lead Lifecycle Stage (3:00 – 3:45)

**Operator Action:** Create a sales lead and advance its lifecycle stage.

```bash
# 1. Create lead linked to contact (starts at 'New')
curl -X POST http://localhost:3000/api/v1/crm-contacts/leads \
  -H "Authorization: Bearer $EDITOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "contactId": "10000000-0000-4000-8000-000000000199",
    "status": "New"
  }'
```

```bash
# 2. Advance stage to 'Working'
curl -X PATCH http://localhost:3000/api/v1/crm-contacts/leads/40000000-0000-4000-8000-000000000199 \
  -H "Authorization: Bearer $EDITOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "Working"
  }'
```

**Expected JSON Response (`200 OK`):**
```json
{
  "id": "40000000-0000-4000-8000-000000000199",
  "contactId": "10000000-0000-4000-8000-000000000199",
  "status": "Working",
  "updatedAt": "2026-10-24T12:02:00.000Z"
}
```

**Talking Point:** *"Per FR-CRM1-03, leads follow a strict forward-only progression: New ➔ Working ➔ Qualified ➔ Closed. Invalid backwards transitions are rejected by domain guards."*

---

### Step 6: Target Adapter Ingestion & Durable Receipt (3:45 – 4:30)

**Operator Action:** Execute in-process migration row ingestion with stable idempotency key.

```bash
curl -X POST http://localhost:3000/api/v1/crm-contacts/import/row \
  -H "Authorization: Bearer $MIGRATION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "batchId": "60000000-0000-4000-8000-000000000001",
    "sourceRow": 42,
    "entity": "contact",
    "sourceSystem": "LEGACY-CRM-EXPORT",
    "sourceId": "LEG-CONT-0042",
    "idempotencyKey": "60000000-0000-4000-8000-000000000001:42:contact:LEG-CONT-0042",
    "data": {
      "firstName": "Rachel",
      "lastName": "Tyrell",
      "email": "rachel.tyrell@nexus.example.com",
      "phone": "+1-555-0149"
    }
  }'
```

**Expected JSON Response (`201 Created`):**
```json
{
  "success": true,
  "isExisting": false,
  "targetId": "10000000-0000-4000-8000-000000000042",
  "receiptId": "70000000-0000-4000-8000-000000000042"
}
```

```bash
# Replay identical payload to demonstrate idempotency
curl -X POST http://localhost:3000/api/v1/crm-contacts/import/row \
  -H "Authorization: Bearer $MIGRATION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "batchId": "60000000-0000-4000-8000-000000000001",
    "sourceRow": 42,
    "entity": "contact",
    "sourceSystem": "LEGACY-CRM-EXPORT",
    "sourceId": "LEG-CONT-0042",
    "idempotencyKey": "60000000-0000-4000-8000-000000000001:42:contact:LEG-CONT-0042",
    "data": {
      "firstName": "Rachel",
      "lastName": "Tyrell",
      "email": "rachel.tyrell@nexus.example.com",
      "phone": "+1-555-0149"
    }
  }'
```

**Expected JSON Response (`200 OK`):**
```json
{
  "success": true,
  "isExisting": true,
  "targetId": "10000000-0000-4000-8000-000000000042",
  "receiptId": "70000000-0000-4000-8000-000000000042"
}
```

**Talking Point:** *"Target mutation and receipt persist atomically in one PostgreSQL transaction. Safe retries reuse the idempotency key and return the existing receipt without duplicate side effects."*

---

### Step 7: View Rejection Ledger & Reason Codes (4:30 – 5:00)

**Operator Action:** Inspect audit receipts and rejected rows.

```bash
curl -X GET http://localhost:3000/api/v1/crm-contacts/imports/60000000-0000-4000-8000-000000000001/rejects \
  -H "Authorization: Bearer $ANALYST_TOKEN"
```

**Expected JSON Response (`200 OK`):**
```json
{
  "items": [
    {
      "id": "80000000-0000-4000-8000-000000000001",
      "batchId": "60000000-0000-4000-8000-000000000001",
      "sourceRow": 3,
      "entity": "contact",
      "reasonCode": "INVALID_EMAIL",
      "message": "Value \"invalid-email-format\" violates RFC-5322 email syntax check.",
      "createdAt": "2026-10-24T12:00:00.000Z"
    }
  ],
  "total": 1
}
```

**Talking Point:** *"Every rejected row is captured in `crm1_import_rejects` with categorized reason codes. Raw database stack traces and internal file paths are masked to guarantee clean, secure operator visibility."*

---

### Demo Completion & Reset

To restore the clean baseline state after the demonstration:

```bash
node sample-data/crm-1/seed.ts --reset
```
