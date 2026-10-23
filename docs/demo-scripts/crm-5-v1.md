# ClearShift CRM — CRM-5 Migration Control Center & Reports
## 5-Minute Operator Demo Script (Gate G4 Release Candidate)

**Module:** `CRM-5` (Migration Control Center and Reports)  
**Target Milestone:** Gate G4 Release Candidate (Weeks 7–8)  
**Estimated Time:** 5 Minutes (300 Seconds)  
**Prerequisites:** Node.js 24 LTS, PostgreSQL running, Fastify API server active on `http://localhost:3000`.

---

### Demo Overview & Narrative Arc

This script guides an operator or evaluator through the complete, end-to-end verification of CRM-5 as an integrated V1 target module. It proves live event projections, 5-dimension quality scoring, row-level error tracking, strict conservation reconciliation (`unaccounted = 0`), and formula injection safe CSV exporting.

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ 1. Seed & Init  │ ──> │ 2. Health Check │ ──> │ 3. Runs & Filter│
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                         │
                                                         ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ 6. Reconcile OK │ <── │ 5. Rejection Log│ <── │ 4. Quality Score│
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│ 7. Safe Export  │ ──> │ 8. Reset & Clean│
└─────────────────┘     └─────────────────┘
```

---

### Step 1: Environment & Synthetic Seed Initialization (0:00 – 0:30)

**Operator Action:** Populate deterministic synthetic fixtures into the database.

```bash
# Seed 104 synthetic runs, 3 quality scorecards, 3 rejections, and 3 reconciliation balance sheets
npx tsx sample-data/crm-5/seed.ts
```

**Expected Result:**
```text
Seeding CRM-5 synthetic test fixtures...
   Seeding 100 dirty runs from dirty-data-v1.csv...
   Seeded 104 migration run records.
   Seeded 3 quality scorecard records.
   Seeded 3 rejection audit records.
   Seeded 3 balanced reconciliation reports (unaccounted=0).
CRM-5 synthetic seeding completed successfully!
```

**Talking Point:** *"CRM-5 utilizes strictly synthetic fixtures derived from our deterministic dirty-data pack. Real PII, passwords, and sensitive company data are strictly barred."*

---

### Step 2: Service Health Check & Liveness Verification (0:30 – 1:00)

**Operator Action:** Query the unauthenticated health check endpoint.

```bash
curl -s http://localhost:3000/api/v1/crm-control/health | jq .
```

**Expected Result:**
```json
{
  "status": "healthy",
  "module": "crm-5",
  "version": "1.0.0",
  "timestamp": "2026-10-23T10:00:00.000Z"
}
```

**Talking Point:** *"The public health endpoint verifies database connectivity, schema registration, and module metadata without requiring elevated privileges."*

---

### Step 3: Migration Runs Dashboard & Multi-Faceted Filtering (1:00 – 1:45)

**Operator Action:** Query paginated runs filtered by target module (`crm-1`) and terminal status (`completed`).

```bash
curl -s -H "Authorization: Bearer $ANALYST_TOKEN" \
  "http://localhost:3000/api/v1/crm-control/runs?module=crm-1&status=completed&page=1&pageSize=5" | jq .
```

**Expected Result:**
```json
{
  "data": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "batchId": "batch-contacts-v1-001",
      "module": "crm-1",
      "step": "load",
      "status": "completed",
      "recordsIn": 500,
      "recordsOut": 492,
      "recordsRejected": 8,
      "startedAt": "2026-10-23T08:00:00.000Z",
      "completedAt": "2026-10-23T08:02:15.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 5,
    "total": 1,
    "totalPages": 1
  }
}
```

**Talking Point:** *"Every run record captures input counts, output counts, and rejections. Pagination is strictly bounded at 100 rows maximum to guarantee predictable memory footprint."*

---

### Step 4: 5-Dimension Data Quality Scorecards (1:45 – 2:30)

**Operator Action:** Inspect calculated quality scorecards and system average score.

```bash
curl -s -H "Authorization: Bearer $ANALYST_TOKEN" \
  "http://localhost:3000/api/v1/crm-control/scores" | jq .
```

**Expected Result:**
```json
{
  "data": [
    {
      "batchId": "batch-contacts-v1-001",
      "module": "crm-1",
      "score": "96.40",
      "completeness": "0.9800",
      "validity": "0.9700",
      "duplicateRate": "0.0100",
      "rejectRate": "0.0160",
      "linkIntegrity": "0.9850",
      "isFullyScored": true,
      "scoredAt": "2026-10-23T08:03:00.000Z"
    }
  ],
  "averageScore": "96.40"
}
```

**Talking Point:** *"Quality scores track 5 distinct dimensions: completeness, validity, duplicate rate, reject rate, and link integrity, normalized to a 0–100 scale."*

---

### Step 5: Row-Level Rejection Audit & Payload Privacy (2:30 – 3:15)

**Operator Action:** Audit rejected records for a specific batch.

```bash
curl -s -H "Authorization: Bearer $ANALYST_TOKEN" \
  "http://localhost:3000/api/v1/crm-control/rejects?batchId=batch-contacts-v1-001" | jq .
```

**Expected Result:**
```json
{
  "data": [
    {
      "id": "33333333-3333-4333-8333-333333333331",
      "batchId": "batch-contacts-v1-001",
      "module": "crm-1",
      "rowIndex": 42,
      "errorCode": "INVALID_EMAIL",
      "reason": "Email format failed RFC 5322 validation: 'bad-email@'",
      "payloadHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "rejectedAt": "2026-10-23T08:01:30.000Z"
    }
  ],
  "pagination": { "page": 1, "pageSize": 20, "total": 1, "totalPages": 1 }
}
```

**Talking Point:** *"Rejected rows are retained with deterministic 1-based row index and error explanations. Raw sensitive payloads are hashed with SHA-256 to prevent PII leakage."*

---

### Step 6: Reconciliation Conservation Balance Sheet (3:15 – 4:00)

**Operator Action:** Verify mathematical conservation for batch `batch-contacts-v1-001`.

```bash
curl -s -H "Authorization: Bearer $ANALYST_TOKEN" \
  "http://localhost:3000/api/v1/crm-control/reconciliation/batch-contacts-v1-001" | jq .
```

**Expected Result:**
```json
{
  "batchId": "batch-contacts-v1-001",
  "sourceCount": 500,
  "loadedCount": 490,
  "rejectedCount": 8,
  "mergedCount": 2,
  "skippedCount": 0,
  "unaccountedCount": 0,
  "status": "OK",
  "reconciledAt": "2026-10-23T08:05:00.000Z"
}
```

**Talking Point:** *"Every parsed source row has exactly one terminal outcome: loaded, rejected, merged, or skipped. The invariant `source = loaded + rejected + merged + skipped` is strictly preserved, and `unaccounted = 0` guarantees zero silent row drops."*

---

### Step 7: Formula-Safe RFC 4180 CSV Export (4:00 – 4:30)

**Operator Action:** Export runs CSV and inspect security escaping.

```bash
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/api/v1/crm-control/runs/export" | head -n 5
```

**Expected Result:**
```text
Batch ID,Module,Step,Status,Records In,Records Out,Records Rejected,Started At,Completed At
batch-contacts-v1-001,crm-1,load,completed,500,492,8,2026-10-23T08:00:00.000Z,2026-10-23T08:02:15.000Z
```

**Talking Point:** *"CSV exports conform to RFC 4180 and implement spreadsheet formula injection defense by prefixing vulnerable characters (`=, +, -, @`) with single quotes."*

---

### Step 8: Teardown & Deterministic Reset (4:30 – 5:00)

**Operator Action:** Reset and clear all CRM-5 demo fixtures.

```bash
npx tsx sample-data/crm-5/seed.ts --reset
```

**Expected Result:**
```text
Resetting CRM-5 database tables...
Reset complete: All CRM-5 records removed.
```

**Talking Point:** *"The deterministic reset command restores a pristine environment, ensuring reproducible CI runs and clean team handoffs."*
