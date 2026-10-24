# ClearShift CRM — CRM-3 Support Tickets & Activities
## 5-Minute Operator Demo Script (Gate G4 Release Candidate)

**Module:** `CRM-3` (Support Tickets and Activities)
**Target Milestone:** Gate G4 Release Candidate (Weeks 7–8)
**Estimated Time:** 5 Minutes (300 Seconds)
**Prerequisites:** Node.js 24 LTS, Fastify API server active on `http://localhost:3000`.

---

### Demo Overview & Narrative Arc

This script guides an operator or evaluator through the complete, end-to-end verification of CRM-3 as an integrated V1 target module. It proves:
1. Deterministic synthetic fixture seeding with zero real customer/employee PII.
2. Server-enforced Hub EdDSA JWT authentication and RBAC permissions.
3. Support ticket queue search and faceted filtering.
4. Ticket creation and validation against external CRM-1 contacts.
5. Strict enforcement of the approved ticket status lifecycle graph (**New -> Open -> Waiting/Solved -> Closed**).
6. Append-only activity notes with server-resolved author identity and newest-first chronology.
7. Field-level sensitive data masking and append-only audit trail logging.
8. Deterministic state reset and cleanup without manual SQL edits.

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ 1. Seed & Init  │ ──> │ 2. Auth Check   │ ──> │ 3. Queue Filter │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                         │
                                                         ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ 6. Append Notes │ <── │ 5. State Machine│ <── │ 4. Create Ticket│
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│ 7. Audit & Mask │ ──> │ 8. Reset State  │
└─────────────────┘     └─────────────────┘
```

---

### Step 1: Environment & Synthetic Seed Initialization (0:00 – 0:30)

**Operator Action:** Populate deterministic synthetic fixtures into the database.

```bash
# Seed 25 synthetic tickets, 26 notes, and 100 dirty data pack rows
npx tsx sample-data/crm-3/seed.ts
```

**Expected Result:**
```text
🌱 [CRM-3] Seeding PostgreSQL database...
✅ [CRM-3] Deterministic seed & Dirty Data Pack completed successfully!
   - Synthetic Tickets Seeded : 25
   - Append-Only Notes Seeded : 26
   - Dirty Data Pack Rows     : 100
   - Persisted to PostgreSQL  : YES / IN-MEMORY
```

---

### Step 2: Authentication & RBAC Enforcement (0:30 – 1:00)

**Operator Action:** Verify fail-closed security for unauthenticated and forbidden requests.

```bash
# A. Unauthenticated request to /tickets must return 401 Unauthorized
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/v1/crm-tickets/tickets
# Expected: 401

# B. Viewer token attempting to create a ticket (POST /tickets) must return 403 Forbidden
VIEWER_TOKEN=$(node -e 'import("@cs/identity").then(i => i.signAccessToken("demo-viewer", ["viewer"])).then(console.log)')
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST http://localhost:3000/api/v1/crm-tickets/tickets \
  -H "Authorization: Bearer $VIEWER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"subject": "Viewer trying to create ticket", "contactId": "90000000-0000-4000-8000-000000000001"}'
# Expected: 403
```

---

### Step 3: Ticket Queue Filtering & Pagination (1:00 – 1:45)

**Operator Action:** Query active tickets filtered by status and priority using an editor token.

```bash
EDITOR_TOKEN=$(node -e 'import("@cs/identity").then(i => i.signAccessToken("demo-editor", ["editor"])).then(console.log)')

# Query tickets in 'Open' status with 'High' priority
curl -s -X GET "http://localhost:3000/api/v1/crm-tickets/tickets?status=Open&priority=High&page=1&pageSize=10" \
  -H "Authorization: Bearer $EDITOR_TOKEN" | jq .
```

**Expected Result:**
- HTTP status `200 OK`.
- JSON array containing tickets matching `status == 'Open'` and `priority == 'High'`.
- Pagination metadata contains `total`, `page: 1`, `pageSize: 10`.

---

### Step 4: Create Support Ticket & Contact Verification (1:45 – 2:30)

**Operator Action:** Create a new ticket linked to an existing CRM-1 contact and optional order reference.

```bash
# Create ticket for contact Sarah Connor
curl -s -X POST http://localhost:3000/api/v1/crm-tickets/tickets \
  -H "Authorization: Bearer $EDITOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "Demo Incident: Cloud gateway connection timeout",
    "contactId": "90000000-0000-4000-8000-000000000001",
    "priority": "Urgent",
    "orderRef": "ORD-DEMO-2026"
  }' | jq .
```

**Expected Result:**
- HTTP status `201 Created`.
- Response contains newly generated ticket UUID, `status: "New"`, `priority: "Urgent"`, and `orderRef: "ORD-DEMO-2026"`.

---

### Step 5: Lifecycle State Machine Transitions (2:30 – 3:15)

**Operator Action:** Prove status lifecycle enforcement. Transitions must follow the approved graph.

```bash
TICKET_ID="30000000-0000-4000-8000-000000000001"

# A. Valid transition: New -> Open
curl -s -X PATCH "http://localhost:3000/api/v1/crm-tickets/tickets/$TICKET_ID" \
  -H "Authorization: Bearer $EDITOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "Open"}' | jq .status
# Expected: "Open"

# B. Illegal transition: New -> Closed (skipping active triage)
NEW_TICKET_ID="30000000-0000-4000-8000-000000000006"
curl -s -X PATCH "http://localhost:3000/api/v1/crm-tickets/tickets/$NEW_TICKET_ID" \
  -H "Authorization: Bearer $EDITOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "Closed"}' | jq .
# Expected: HTTP 400 with code "INVALID_TICKET_STATUS_TRANSITION"
```

---

### Step 6: Append-Only Notes & Newest-First Chronology (3:15 – 4:00)

**Operator Action:** Append support activity notes and verify chronological ordering.

```bash
# A. Append a note as the authenticated editor
curl -s -X POST "http://localhost:3000/api/v1/crm-tickets/tickets/$TICKET_ID/notes" \
  -H "Authorization: Bearer $EDITOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"noteText": "Engineering verified gateway timeout resolved on staging cluster."}' | jq .

# B. Retrieve all notes for this ticket
curl -s -X GET "http://localhost:3000/api/v1/crm-tickets/tickets/$TICKET_ID/notes" \
  -H "Authorization: Bearer $EDITOR_TOKEN" | jq .
```

**Expected Result:**
- Newly added note appears at index `0` (`items[0]`), proving newest-first ordering.
- `authorId` is set to `"demo-editor"` (cryptographically derived from the JWT claims).

---

### Step 7: Sensitive-Field Protection & Audit Log Verification (4:00 – 4:30)

**Operator Action:** Verify that sensitive fields are never leaked in application logs or audit records.

```bash
# Verify audit events for the ticket
node -e '
  import("@cs/mod-crm3").then(async ({ crm3Audit }) => {
    const events = crm3Audit.getAuditEvents({ entity: "ticket" });
    console.log("Total Ticket Audit Events Recorded:", events.length);
    if (events.length > 0) {
      console.log("Latest Audit Event:", {
        actor: events[events.length - 1].actor,
        action: events[events.length - 1].action,
        result: events[events.length - 1].result,
        diff: events[events.length - 1].diffRedacted
      });
    }
  });
'
```

**Expected Result:**
- Audit events reflect state changes without capturing raw rows, tokens, passwords, or full bank identifiers.

---

### Step 8: Deterministic State Reset & Teardown (4:30 – 5:00)

**Operator Action:** Cleanly reset all records back to canonical baseline.

```bash
# Reset database back to clean baseline
npx tsx sample-data/crm-3/seed.ts --reset
```

**Expected Result:**
```text
🔄 [CRM-3] Resetting existing CRM-3 records...
🌱 [CRM-3] Seeding PostgreSQL database...
✅ [CRM-3] Deterministic seed & Dirty Data Pack completed successfully!
```

---

### Summary Checklist for Gate G4 Sign-off

- [x] **Zero manual SQL required** during demo execution.
- [x] **Zero PII or credentials** used (100% synthetic fixtures).
- [x] **Server-side RBAC & multi-tenant checks** verified.
- [x] **Ticket status lifecycle graph** strictly enforced.
- [x] **Append-only notes chronology** verified newest-first.
- [x] **Reversible idempotent seed** returns to clean baseline.
