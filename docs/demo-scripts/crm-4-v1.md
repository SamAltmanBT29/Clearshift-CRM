# ClearShift CRM — CRM-4 Marketing Lists & Campaign History
## 5-Minute Operator Demo Script (Gate G4 Release Candidate)

**Module:** `CRM-4` (Marketing Lists and Campaign History)  
**Target Milestone:** Gate G4 Release Candidate (Weeks 7–8)  
**Estimated Time:** 5 Minutes (300 Seconds)  
**Prerequisites:** Node.js 24 LTS, Fastify API server active on `http://localhost:3000`.

---

### Demo Overview & Narrative Arc

This script guides an operator or evaluator through the complete, end-to-end verification of CRM-4 as an integrated V1 target module. It proves:
1. Deterministic synthetic fixture seeding with zero real PII.
2. Server-enforced Hub EdDSA JWT authentication and RBAC permissions.
3. Marketing lists segmentation and search filtering.
4. Historical campaign records with **immutable list association (`listId`)**.
5. Participant engagement tracking restricted strictly to `sent`, `opened`, and `clicked`.
6. Monotonic opt-out invariant (**BR-CRM4-01**): once `unsubscribed`, re-subscription attempts are rejected.
7. Formula-safe CSV export protecting against formula injection.
8. Deterministic state reset and cleanup.

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ 1. Seed & Init  │ ──> │ 2. Auth Check   │ ──> │ 3. Lists Search │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                         │
                                                         ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ 6. Opt-Out Lock │ <── │ 5. Member Status│ <── │ 4. Campaign Lock│
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
# Seed 10 marketing lists, 10 campaigns, 5 members, and 5 consent records
npx tsx sample-data/crm-4/seed.ts
```

**Expected Result:**
```text
🌱 [CRM-4] Starting deterministic seed...
✅ [CRM-4] Deterministic seed completed successfully!
   - Marketing Lists           : 10
   - Marketing Campaigns       : 10
   - Campaign Memberships      : 5
   - Contact Consents          : 5
   - Persisted to PostgreSQL   : YES / IN-MEMORY
```

**Talking Point:** *"CRM-4 utilizes strictly synthetic fixtures derived from our deterministic dirty-data pack. Real customer PII, credentials, and sensitive data are strictly barred."*

---

### Step 2: Service Authentication & Role Enforcement (0:30 – 1:00)

**Operator Action:** Demonstrate that unauthenticated requests are rejected, while valid EdDSA bearer tokens are accepted.

```bash
# 1. Unauthenticated request -> HTTP 401 Unauthorized
curl -s -i http://localhost:3000/api/v1/crm-marketing/lists

# 2. Authenticated request with Viewer token -> HTTP 200 OK
curl -s -H "Authorization: Bearer $VIEWER_TOKEN" \
  http://localhost:3000/api/v1/crm-marketing/lists?pageSize=2
```

**Expected Result:**
* Unauthenticated: HTTP 401 with standard ClearShift error envelope (`UNAUTHORIZED`).
* Authenticated: HTTP 200 with `{ items: [...], pagination: { ... } }`.

**Talking Point:** *"All CRM-4 endpoints enforce centralized Hub Identity EdDSA JWT verification. Disabled users, expired tokens, or forged signatures are rejected at the gateway."*

---

### Step 3: Marketing Lists Management & Search (1:00 – 1:45)

**Operator Action:** Search for lists by keyword, and create a new marketing segment.

```bash
# 1. Search lists matching 'Beta'
curl -s -H "Authorization: Bearer $VIEWER_TOKEN" \
  "http://localhost:3000/api/v1/crm-marketing/lists?search=Beta"

# 2. Create new list (requires Editor or Admin role)
curl -s -X POST -H "Authorization: Bearer $EDITOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Q1 Cloud Advocates","description":"High-affinity enterprise engineers"}' \
  http://localhost:3000/api/v1/crm-marketing/lists
```

**Expected Result:**
* Search query returns only matching lists (`Product Beta Advocates`).
* Creation returns `HTTP 201 Created` with unique UUID and initial counters (`campaignCount: 0`, `memberCount: 0`).

---

### Step 4: Campaign History & Immutable List Association (1:45 – 2:30)

**Operator Action:** Demonstrate that campaigns are linked to marketing lists, and `listId` cannot be mutated after creation.

```bash
# 1. Query existing campaign
curl -s -H "Authorization: Bearer $VIEWER_TOKEN" \
  http://localhost:3000/api/v1/crm-marketing/campaigns/44444444-2222-4444-8444-000000000001

# 2. Attempt to mutate immutable listId -> HTTP 403 Forbidden
curl -s -X PATCH -H "Authorization: Bearer $EDITOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"listId":"44444444-1111-4444-8444-000000000002"}' \
  http://localhost:3000/api/v1/crm-marketing/campaigns/44444444-2222-4444-8444-000000000001
```

**Expected Result:**
```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "Access denied: modification of immutable field 'listId' is strictly prohibited"
  }
}
```

**Talking Point:** *"In accordance with SDS §4, campaigns belong to one list throughout their lifecycle; list reassignment is strictly prohibited."*

---

### Step 5: Participant Activity & Allowed Engagement Status (2:30 – 3:15)

**Operator Action:** Add a participant and prove that engagement statuses outside `('sent', 'opened', 'clicked')` are rejected.

```bash
# 1. Attempt to add member with invalid status 'delivered' -> HTTP 400 Bad Request
curl -s -X POST -H "Authorization: Bearer $EDITOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"contactId":"11111111-1111-4111-8111-000000000003","status":"delivered"}' \
  http://localhost:3000/api/v1/crm-marketing/campaigns/44444444-2222-4444-8444-000000000001/members

# 2. Add valid member with permitted status 'clicked' -> HTTP 201 Created
curl -s -X POST -H "Authorization: Bearer $EDITOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"contactId":"11111111-1111-4111-8111-000000000003","status":"clicked"}' \
  http://localhost:3000/api/v1/crm-marketing/campaigns/44444444-2222-4444-8444-000000000001/members
```

**Expected Result:**
* Invalid status: HTTP 400 with validation error indicating allowed statuses (`sent`, `opened`, `clicked`).
* Valid status: HTTP 201 with verified member record.

---

### Step 6: Monotonic Opt-Out Invariant Verification (BR-CRM4-01) (3:15 – 4:00)

**Operator Action:** Demonstrate that once a contact has opted out, no update or migration action can overwrite their status with `subscribed`.

```bash
# 1. Query contact consent for known opt-out (contact ...0002)
curl -s -H "Authorization: Bearer $VIEWER_TOKEN" \
  http://localhost:3000/api/v1/crm-marketing/consents/11111111-1111-4111-8111-000000000002

# 2. Attempt to revert unsubscribed contact to 'subscribed' -> HTTP 409 Conflict
curl -s -X POST -H "Authorization: Bearer $EDITOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"contactId":"11111111-1111-4111-8111-000000000002","status":"subscribed","source":"email_campaign"}' \
  http://localhost:3000/api/v1/crm-marketing/consents
```

**Expected Result:**
```json
{
  "error": {
    "code": "CONFLICT",
    "message": "Domain Invariant Violation (BR-CRM4-01): A known opt-out/unsubscribe is strictly monotonic and cannot be overwritten with consent."
  }
}
```

**Talking Point:** *"Privacy compliance rule BR-CRM4-01 is cryptographically and logically monotonic. A customer who has unsubscribed cannot be re-subscribed by marketing imports or user edits."*

---

### Step 7: Formula-Safe CSV Export (4:00 – 4:30)

**Operator Action:** Export campaign participants and verify formula injection sanitization.

```bash
# Export campaign participants to CSV
curl -s -H "Authorization: Bearer $VIEWER_TOKEN" \
  http://localhost:3000/api/v1/crm-marketing/campaigns/44444444-2222-4444-8444-000000000001/export
```

**Expected Result:**
```text
MemberId,CampaignName,ContactId,Status,Unsubscribed,CreatedAt
44444444-3333-4444-8444-000000000001,Q1 Launch Blitz,11111111-1111-4111-8111-000000000001,sent,false,2026-10-15T00:00:00.000Z
44444444-3333-4444-8444-000000000002,Q1 Launch Blitz,11111111-1111-4111-8111-000000000002,opened,true,2026-10-15T00:00:00.000Z
```

**Talking Point:** *"All CSV reporting routes sanitize formula characters (`=`, `+`, `-`, `@`, `\t`, `\r`) by prepending a single quote (`'`), shielding spreadsheet applications from remote command execution."*

---

### Step 8: Deterministic Teardown & Reset (4:30 – 5:00)

**Operator Action:** Cleanly reset the module state.

```bash
# Reset CRM-4 test state back to pristine baseline
npx tsx sample-data/crm-4/seed.ts --reset
```

**Expected Result:**
```text
🌱 [CRM-4] Starting deterministic seed (with reset)...
✅ [CRM-4] Deterministic seed completed successfully!
```

**Conclusion:** *"In exactly 5 minutes, we have verified end-to-end relational schema integrity, EdDSA authentication, immutable campaign associations, status allowlists, monotonic opt-out invariants, and formula-safe CSV reporting."*
