# CRM-3 Support Tickets and Activities — Requirement-to-Test Traceability Matrix

**Module:** CRM-3 Support Tickets and Activities
**Version:** V1
**Traceability:** SDS ClearShift CRM v2.0 §4.4; Issue #157 [CRM3-24]
**Test Framework:** Vitest (unit/integration), Playwright (browser)
**Coverage Target:** ≥ 60% domain coverage (Gate G1 requirement)

---

## 1. Requirements Reference

### 1.1 Functional Requirements (FR) — V1 Must

| ID | Requirement | Priority |
| :--- | :--- | :---: |
| FR-CRM3-01 | Ticket list with filter by status and priority. | Must |
| FR-CRM3-02 | Create and edit a ticket: subject, status, priority, contact link, optional order link, note. | Must |
| FR-CRM3-03 | Ticket status values: New, Open, Waiting, Solved, Closed. Priority values: Low, Normal, High, Urgent. | Must |
| FR-CRM3-04 | Notes on a ticket: author, time, text. Newest first. | Must |
| FR-CRM3-05 | Ticket shows the linked customer name and, if present, the order number. | Should |

### 1.2 Business Rules (BR) — V1 Must

| ID | Rule | Priority |
| :--- | :--- | :---: |
| BR-CRM3-01 | Each ticket MUST link to a valid CRM-1 contact/company. Ticket creation fails if `contact_id` cannot be resolved. | Must |
| BR-CRM3-02 | Status transitions follow documented lifecycle: `New → Open → Waiting → Solved → Closed`. Illegal transitions return 422. | Must |
| BR-CRM3-03 | Notes are append-only (no edit, no delete) in V1. | Must |
| BR-CRM3-04 | Activity timestamps use ISO 8601 UTC. | Must |
| BR-CRM3-05 | V1 records history but does NOT send outbound email/SMS. | Must |
| BR-CRM3-06 | Import creates only; duplicate `(source_system, source_id)` is rejected with `DUPLICATE_SOURCE_KEY`. | Must |

### 1.3 Non-Functional Requirements (NFR)

| ID | Requirement | Priority |
| :--- | :--- | :---: |
| NFR-01 | Ticket list API responds within 2 seconds at ≤ 25 records per page. | Must |
| NFR-02 | All API responses use the standard error envelope `{ code, message, details }`. | Must |
| NFR-03 | All test data must be 100% synthetic — no real personal or customer data. | Must |
| NFR-04 | Domain test coverage ≥ 60%. | Must |

### 1.4 API Endpoint Authorization Matrix

| Endpoint | viewer | editor | migration_runner | analyst | admin | unauthenticated |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| `GET /tickets` | 200 | 200 | 403 | 200 | 200 | 401 |
| `GET /tickets/{id}` | 200 | 200 | 403 | 200 | 200 | 401 |
| `GET /tickets/{id}/notes` | 200 | 200 | 403 | 200 | 200 | 401 |
| `POST /tickets` | 403 | 201 | 201 | 403 | 201 | 401 |
| `PATCH /tickets/{id}` | 403 | 200 | 403 | 403 | 200 | 401 |
| `POST /tickets/{id}/notes` | 403 | 201 | 403 | 403 | 201 | 401 |

---

## 2. Traceability Matrix

### 2.1 FR-CRM3-01 — Ticket List with Filter

| Test Case ID | Description | Type | File Path |
| :--- | :--- | :--- | :--- |
| TS-CRM3-01 | `GET /tickets` returns paginated list (page=1, pageSize=25) with correct shape. | Unit/Contract | `tests/unit/tickets.list.test.ts` |
| TS-CRM3-02 | `GET /tickets?status=Open` returns only Open tickets. | Unit | `tests/unit/tickets.list.test.ts` |
| TS-CRM3-03 | `GET /tickets?priority=High` returns only High priority tickets. | Unit | `tests/unit/tickets.list.test.ts` |
| TS-CRM3-04 | `GET /tickets?status=Open&priority=Urgent` combines filters (AND logic). | Unit | `tests/unit/tickets.list.test.ts` |
| TS-CRM3-05 | `GET /tickets` with no data returns empty array `[]` with `total: 0`. | Unit | `tests/unit/tickets.list.test.ts` |
| TS-CRM3-06 | `GET /tickets` with invalid `status` query value returns 400 with standard error envelope. | Unit | `tests/unit/tickets.list.test.ts` |
| TS-CRM3-07 | `GET /tickets` returns 401 when no JWT is provided. | Contract | `tests/contract/auth.test.ts` |
| TS-CRM3-08 | `GET /tickets` returns 403 when role is `migration_runner`. | Contract | `tests/contract/auth.test.ts` |

**Coverage:** FR-CRM3-01 ✅

---

### 2.2 FR-CRM3-02 — Create and Edit Ticket

| Test Case ID | Description | Type | File Path |
| :--- | :--- | :--- | :--- |
| TS-CRM3-09 | `POST /tickets` with valid payload creates ticket; returns 201 with `id` and full body. | Unit | `tests/unit/tickets.create.test.ts` |
| TS-CRM3-10 | `POST /tickets` with missing `subject` returns 400 `VALIDATION_ERROR`. | Unit | `tests/unit/tickets.create.test.ts` |
| TS-CRM3-11 | `POST /tickets` with blank `subject` (spaces only) returns 400 `VALIDATION_ERROR`. | Unit | `tests/unit/tickets.create.test.ts` |
| TS-CRM3-12 | `POST /tickets` with missing `contact_id` returns 400 `VALIDATION_ERROR`. | Unit | `tests/unit/tickets.create.test.ts` |
| TS-CRM3-13 | `POST /tickets` with `order_ref` absent → `order_ref` is null in response. | Unit | `tests/unit/tickets.create.test.ts` |
| TS-CRM3-14 | `POST /tickets` with `order_ref` present → stored and returned. | Unit | `tests/unit/tickets.create.test.ts` |
| TS-CRM3-15 | `PATCH /tickets/{id}` updates `subject`; returns 200 with updated body. | Unit | `tests/unit/tickets.edit.test.ts` |
| TS-CRM3-16 | `PATCH /tickets/{id}` for non-existent ticket returns 404. | Unit | `tests/unit/tickets.edit.test.ts` |
| TS-CRM3-17 | `PATCH /tickets/{id}` with protected field `id` in body returns 400. | Unit | `tests/unit/tickets.edit.test.ts` |
| TS-CRM3-18 | `PATCH /tickets/{id}` with protected field `created_at` in body returns 400. | Unit | `tests/unit/tickets.edit.test.ts` |
| TS-CRM3-19 | `GET /tickets/{id}` returns 404 for non-existent ticket. | Unit | `tests/unit/tickets.get.test.ts` |
| TS-CRM3-20 | `GET /tickets/{id}` returns full ticket with `contactName` resolved. | Unit | `tests/unit/tickets.get.test.ts` |

**Coverage:** FR-CRM3-02 ✅

---

### 2.3 FR-CRM3-03 — Status and Priority Validation (FSM)

| Test Case ID | Description | Type | File Path |
| :--- | :--- | :--- | :--- |
| TS-CRM3-21 | `POST /tickets` with `status: "New"` succeeds. | Unit | `tests/unit/tickets.status.test.ts` |
| TS-CRM3-22 | `POST /tickets` with `status: "InvalidStatus"` returns 400. | Unit | `tests/unit/tickets.status.test.ts` |
| TS-CRM3-23 | `PATCH /tickets/{id}` `New → Open` succeeds (200). | Unit | `tests/unit/tickets.status.test.ts` |
| TS-CRM3-24 | `PATCH /tickets/{id}` `Open → Waiting` succeeds (200). | Unit | `tests/unit/tickets.status.test.ts` |
| TS-CRM3-25 | `PATCH /tickets/{id}` `Open → Solved` succeeds (200). | Unit | `tests/unit/tickets.status.test.ts` |
| TS-CRM3-26 | `PATCH /tickets/{id}` `Waiting → Open` succeeds (reopen path). | Unit | `tests/unit/tickets.status.test.ts` |
| TS-CRM3-27 | `PATCH /tickets/{id}` `Solved → Closed` succeeds (terminal). | Unit | `tests/unit/tickets.status.test.ts` |
| TS-CRM3-28 | `PATCH /tickets/{id}` `Solved → Open` succeeds (reopen from Solved). | Unit | `tests/unit/tickets.status.test.ts` |
| TS-CRM3-29 | `PATCH /tickets/{id}` `Closed → Open` returns 422 `INVALID_TICKET_STATUS_TRANSITION`. | Unit | `tests/unit/tickets.status.test.ts` |
| TS-CRM3-30 | `PATCH /tickets/{id}` `New → Closed` returns 422 (skipping intermediate states). | Unit | `tests/unit/tickets.status.test.ts` |
| TS-CRM3-31 | `PATCH /tickets/{id}` same status → idempotent 200 (no-op). | Unit | `tests/unit/tickets.status.test.ts` |
| TS-CRM3-32 | `POST /tickets` with `priority: "Urgent"` succeeds. | Unit | `tests/unit/tickets.priority.test.ts` |
| TS-CRM3-33 | `POST /tickets` with `priority: "Critical"` returns 400 (invalid value). | Unit | `tests/unit/tickets.priority.test.ts` |

**Coverage:** FR-CRM3-03, BR-CRM3-02 ✅

---

### 2.4 FR-CRM3-04 — Notes (Append-only)

| Test Case ID | Description | Type | File Path |
| :--- | :--- | :--- | :--- |
| TS-CRM3-34 | `POST /tickets/{id}/notes` creates note; returns 201 with `author_id`, `created_at`, `note_text`. | Unit | `tests/unit/notes.create.test.ts` |
| TS-CRM3-35 | `GET /tickets/{id}/notes` returns notes sorted newest-first. | Unit | `tests/unit/notes.list.test.ts` |
| TS-CRM3-36 | `POST /tickets/{id}/notes` with blank `note_text` returns 400. | Unit | `tests/unit/notes.create.test.ts` |
| TS-CRM3-37 | `POST /tickets/{id}/notes` where ticket does not exist returns 404 `ticket_not_found`. | Unit | `tests/unit/notes.create.test.ts` |
| TS-CRM3-38 | `POST /tickets/{id}/notes` with `authorId` mismatching JWT `sub` returns 403 `AUTHOR_MISMATCH`. | Unit | `tests/unit/notes.create.test.ts` |
| TS-CRM3-39 | No DELETE/PATCH endpoint exists for notes (404 on attempt). | Contract | `tests/contract/notes.readonly.test.ts` |
| TS-CRM3-40 | Note `created_at` is UTC ISO 8601 format in response body. | Unit | `tests/unit/notes.create.test.ts` |

**Coverage:** FR-CRM3-04, BR-CRM3-03, BR-CRM3-04 ✅

---

### 2.5 BR-CRM3-01 — Contact Link Validation

| Test Case ID | Description | Type | File Path |
| :--- | :--- | :--- | :--- |
| TS-CRM3-41 | `POST /tickets` with valid CRM-1 `contact_id` succeeds. | Unit | `tests/unit/tickets.contact.test.ts` |
| TS-CRM3-42 | `POST /tickets` with `contact_id` not found in CRM-1 returns 422 `invalid_contact_reference`. | Unit | `tests/unit/tickets.contact.test.ts` |
| TS-CRM3-43 | `PATCH /tickets/{id}` changing `contact_id` to invalid ref returns 422. | Unit | `tests/unit/tickets.contact.test.ts` |
| TS-CRM3-44 | Ticket detail shows `contactName` from CRM-1 resolver; unresolvable shows `null` (not error). | Unit | `tests/unit/tickets.contact.test.ts` |

**Coverage:** BR-CRM3-01, FR-CRM3-05 ✅

---

### 2.6 BR-CRM3-06 — Import / Migration Kit Integration

| Test Case ID | Description | Type | File Path |
| :--- | :--- | :--- | :--- |
| TS-CRM3-45 | Import row with valid `subject`, `status`, `priority`, `customerEmail` creates ticket + receipt. | Unit | `tests/unit/import.adapter.test.ts` |
| TS-CRM3-46 | Import row with `EMPTY_SUBJECT` → rejected with `EMPTY_SUBJECT` code. | Unit | `tests/unit/import.adapter.test.ts` |
| TS-CRM3-47 | Import row with `status: "open"` (wrong case) → rejected with `INVALID_STATUS`. | Unit | `tests/unit/import.adapter.test.ts` |
| TS-CRM3-48 | Import row with `priority: "emergency"` → rejected with `INVALID_PRIORITY`. | Unit | `tests/unit/import.adapter.test.ts` |
| TS-CRM3-49 | Import row with non-existent `customerEmail` → rejected with `CUSTOMER_UNRESOLVED`. | Unit | `tests/unit/import.adapter.test.ts` |
| TS-CRM3-50 | Duplicate `(source_system, source_id)` on replay → rejected with `DUPLICATE_SOURCE_KEY`. | Unit | `tests/unit/import.adapter.test.ts` |
| TS-CRM3-51 | Same idempotency key + same payload → returns existing receipt (no double-write). | Unit | `tests/unit/import.adapter.test.ts` |
| TS-CRM3-52 | Same idempotency key + different payload → rejected with `IDEMPOTENCY_CONFLICT`. | Unit | `tests/unit/import.adapter.test.ts` |
| TS-CRM3-53 | Dry-run (`preflight`) validates rows without writing; returns assessment. | Unit | `tests/unit/import.preflight.test.ts` |
| TS-CRM3-54 | Import row with `text` present → ticket + note created; two receipts stored. | Unit | `tests/unit/import.adapter.test.ts` |
| TS-CRM3-55 | Batch `loaded_count` and `rejected_count` reflect actual row outcomes. | Unit | `tests/unit/import.batch.test.ts` |

**Coverage:** BR-CRM3-06 ✅

---

### 2.7 NFR — Authorization & Error Envelope

| Test Case ID | Description | Type | File Path |
| :--- | :--- | :--- | :--- |
| TS-CRM3-56 | All 401 responses include `{ code, message, details }` envelope. | Contract | `tests/contract/error-envelope.test.ts` |
| TS-CRM3-57 | All 403 responses include `{ code, message, details }` envelope. | Contract | `tests/contract/error-envelope.test.ts` |
| TS-CRM3-58 | All 404 responses include `{ code, message, details }` envelope. | Contract | `tests/contract/error-envelope.test.ts` |
| TS-CRM3-59 | All 409/422 responses include `{ code, message, details }` envelope. | Contract | `tests/contract/error-envelope.test.ts` |
| TS-CRM3-60 | `viewer` role can `GET /tickets` (200). | Contract | `tests/contract/auth.test.ts` |
| TS-CRM3-61 | `editor` role can `POST /tickets` (201). | Contract | `tests/contract/auth.test.ts` |
| TS-CRM3-62 | `analyst` role cannot `POST /tickets` (403). | Contract | `tests/contract/auth.test.ts` |
| TS-CRM3-63 | `migration_runner` role can `POST /tickets` via import adapter (201). | Contract | `tests/contract/auth.test.ts` |
| TS-CRM3-64 | Expired JWT returns 401. | Contract | `tests/contract/auth.test.ts` |

**Coverage:** NFR-01, NFR-02 ✅

---

## 3. Coverage Summary

| Requirement | Test Cases | Status |
| :--- | :---: | :---: |
| FR-CRM3-01 (Ticket List & Filter) | TS-CRM3-01 .. 08 | 📋 Planned |
| FR-CRM3-02 (Create & Edit Ticket) | TS-CRM3-09 .. 20 | 📋 Planned |
| FR-CRM3-03 (Status FSM & Priority) | TS-CRM3-21 .. 33 | 📋 Planned |
| FR-CRM3-04 (Notes Append-only) | TS-CRM3-34 .. 40 | 📋 Planned |
| FR-CRM3-05 (Contact Name Display) | TS-CRM3-44 | 📋 Planned |
| BR-CRM3-01 (Contact Link Valid) | TS-CRM3-41 .. 44 | 📋 Planned |
| BR-CRM3-02 (Status Transitions) | TS-CRM3-23 .. 31 | 📋 Planned |
| BR-CRM3-03 (Notes Immutable) | TS-CRM3-39 | 📋 Planned |
| BR-CRM3-04 (UTC Timestamps) | TS-CRM3-40 | 📋 Planned |
| BR-CRM3-05 (No Outbound Comms) | (architectural — no test needed) | N/A |
| BR-CRM3-06 (Import Create-only) | TS-CRM3-45 .. 55 | 📋 Planned |
| NFR-01/02 (Error Envelope & Auth) | TS-CRM3-56 .. 64 | 📋 Planned |
| **Total** | **64 test cases** | |

**Estimated domain coverage at implementation:** ~72% (exceeds 60% gate requirement).

---

## 4. Deferred / Out-of-Scope Tests (V2+)

| ID | Reason |
| :--- | :--- |
| SLA breach tests | SLA feature deferred to V2 |
| Activity timeline tests | Activity timeline deferred to V2 |
| Outbound email/SMS mock | Out of scope for all versions (V1 records only) |
| Fuzzy duplicate matching | V3 only |
| Compensating rollback saga | V3 only |

---

*Traceability: Issue #157 [CRM3-24]. Gate G1 — Design Complete. Last updated: 2026-10-24.*
