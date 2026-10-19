```{=typst}
#page(header: none, numbering: none)[
  #align(center + horizon)[
    #text(size: 32pt, weight: "bold")[ClearShift]
    #v(8pt)
    #text(size: 14pt)[Data Migration and Cleanup for ERP and CRM]
    #v(26pt)
    #line(length: 38%, stroke: 0.8pt + black)
    #v(26pt)
    #text(size: 19pt, weight: "bold")[Software Design Specification:]
    #v(4pt)
    #text(size: 19pt, weight: "bold")[ClearShift CRM]
    #v(6pt)
    #text(size: 12pt)[White paper — Version 1.0]
    #v(30pt)
    #text(size: 10.5pt)[Prepared by: ClearShift PMO + CRM groups 1-5]
    #v(4pt)
    #text(size: 10.5pt)[Student software project — 12-week plan — 11 groups]
    #v(4pt)
    #text(size: 10.5pt)[Language level: B1 (simple English, technical words are explained)]
    #v(4pt)
    #text(size: 10.5pt)[Date: 15 October 2026 — Print style: black and white]
    #v(4pt)
    #text(size: 10.5pt)[Status: Draft for Gate G1 (Design Gate)]
  ]
]
#pagebreak()
#align(center)[#outline(title: [Table of Contents], depth: 3)]
#pagebreak()
```

# 1. Purpose and Scope

## 1.1 What this document is

This document is the **Software Design Specification (SDS)** for **ClearShift CRM**. An SDS is a detailed description of a software system: what it does, what data it keeps, what screens it shows, what APIs it offers, and what rules it must follow. "Specification" means a precise promise: this system will do exactly this.

Read it together with:

| Document | What it gives you |
|---|---|
| Project Plan and Team Guide | People, roles, dates, gates, quality rules |
| SDS: ClearShift ERP | The same specification for the ERP side |
| SDS: ClearShift Migration Kit | The full detail of the pipeline that moves and cleans data |

## 1.2 What ClearShift CRM is

**ClearShift CRM** is a small Customer Relationship Management system (software that manages customers: leads, deals, support, marketing). It has 5 modules:

| Module | Group | What it holds |
|---|---|---|
| **CRM-1** Contacts, Companies and Leads | Group 1 | Who the customers are (master data) |
| **CRM-2** Deals, Pipeline and Quotes | Group 2 | Sales chances and their value |
| **CRM-3** Support Tickets and Activities | Group 3 | Customer problems and communication history |
| **CRM-4** Marketing Lists and Campaign History | Group 4 | Marketing lists, campaigns, and consent (permission to contact) |
| **CRM-5** Migration Control Center and Reports | Group 5 | The dashboard that watches every migration run |

## 1.3 Why this CRM exists in the project

ClearShift is a data migration company. To migrate data well, you must understand the target system (the new system where data goes). This CRM is our **test target system**. Real clients in the future will use their own CRM (for example HubSpot or Zoho), and our Migration Kit will move data into those systems. Practising on our own CRM proves that the Kit works.

> **The CRM is a test bed, not a product to sell.** The Migration Kit is the product.

## 1.4 Users and roles

| Role | What they can do |
|---|---|
| **Viewer** | Read records and reports. No changes. |
| **Editor** | Create, change, delete records in the CRM modules. |
| **Migration runner** | A special technical role for the Migration Kit: load data, run dry runs, read the staging area. |
| **Analyst** | Read CRM-5 dashboards and reports, across all modules. |
| **Admin** | Everything, plus users and settings. |

One shared login (JWT-based, run by the Hub) serves all modules. JWT means a small signed token that proves who you are, so you do not log in again for every module.

## 1.5 What is out of scope (not in this SDS)

- Email sending, SMS sending (marketing campaigns are recorded, not sent).
- Real payment functions.
- Mobile apps (the web screens must work on a tablet browser, nothing more).
- Real personal data — **fake or synthetic data only** in this project.

# 2. How to Read This Specification

## 2.1 The three parts

This SDS treats the three versions **separately**, because they are delivered at different gates:

| Part | Chapter | Ready at | Gate |
|---|---|---|---|
| **V1 — Minimum deliverable** (small, but looks complete) | 4 | End of Week 8 | G4 |
| **V2 — Better enhancements** | 5 | End of Week 10 | G5 |
| **V3 — Complete version** (final demo) | 6 | End of Week 12 | G6 |

**Rule: never start V2 requirements while V1 requirements still have open critical bugs.**

## 2.2 Requirement IDs (how we refer to requirements)

Every requirement has an ID so that tests, code and defects can point to it exactly:

| Prefix | Meaning | Example |
|---|---|---|
| `FR-<module>-nn` | Functional requirement (a feature the system must do) | `FR-CRM1-03` = CRM-1, requirement 3 |
| `BR-<module>-nn` | Business rule (a law of the data that must always be true) | `BR-CRM4-01` = consent rule |
| `NFR-nn` | Non-functional requirement (speed, security, size) | `NFR-02` = list loads under 2 s |
| `EV-nn` | Event (a message sent to the Hub) | `EV-03` = `contact.merged` |
| `TS-nn` | Test scenario (proof that a requirement works) | `TS-05` |

Priority words:

- **Must** — without it the version is not delivered.
- **Should** — deliver if time allows inside the version.
- **Could** — bonus, only after all Must items work.

## 2.3 B1 note

This document uses simple English (level B1). Technical words are used when they are the correct word, and they are explained the first time or in the glossary (Chapter 10).

# 3. Overall Architecture (all three versions)

## 3.1 The shape of the system

```
 Browser (React + TypeScript screens)
            |
            v
 CRM API (NestJS / Node.js, one service per module)
            |
            +-------------------+
            |                   |
            v                   v
 PostgreSQL schema          ClearShift Hub
 crm1_contacts, ...         (login, Golden ID,
 crm5_control, ...           events, batches)
```

Each module owns its own **schema** (a named group of tables) in one PostgreSQL database. Modules never read each other's tables directly — they use APIs and events. This rule keeps the groups independent.

## 3.2 Shared technical rules (all modules)

| Area | Rule |
|---|---|
| API path style | `/api/v1/<module>/<resource>` |
| Data format | JSON only |
| Paging | Every list API accepts `page` and `pageSize` |
| Error format | `{ "code": "...", "message": "...", "details": [...] }` |
| Timestamps | ISO 8601, stored in UTC (the time in London), shown in local time |
| IDs | UUID (a long unique text code) for records; Golden ID from the Hub for customers |
| Naming | Tables and columns in `snake_case`; events `<noun>.<past_verb>` |
| Audit fields | Every table keeps `created_at`, `updated_at`, `created_by` |
| Secrets | Never in code. The DevOps Lead provides them safely. |
| Data | Fake or synthetic only. Real personal data is forbidden. |

## 3.3 Data layers (used by the kit, visible to the module)

| Layer | Schema | Rule |
|---|---|---|
| Raw copy | `raw_crm1`, `raw_crm2`, ... | Exact copy of the source file. Never edited. |
| Staging | `stg_crm1`, ... | Raw data plus `batch_id`, `source_row`, `status`, `reject_reason` |
| Clean | `clean_crm1`, ... | Cleaned and mapped, ready to load |
| Target | `crm1_contacts`, ... | The real module tables |

Every migrated record keeps: `source_system`, `source_id`, `batch_id`, `status`, `reject_reason`. This is the **audit trail** (a record of every change).

# 4. Part V1 — Minimum Deliverable Specification

V1 is small but **complete**: every feature works from start to finish, screens have an empty state (a helpful message when there is no data), and the demo runs without manual fixes.

## 4.1 V1 scope

| In V1 | Out of V1 (moves to V2/V3) |
|---|---|
| CRM-1: contacts + companies + leads (flat) | Merge screen, company hierarchy |
| CRM-2: deals + 6 fixed stages + simple quote | Drag and drop board, forecasting |
| CRM-3: tickets + notes | Activity timeline, SLA |
| CRM-4: lists + campaigns + consent protection | Statistics, segments |
| CRM-5: runs, scores, rejects, reconciliation, CSV | PDF, charts, alerts |
| Login with the 5 roles | SSO, session timeout rules |

## 4.2 Functional requirements V1 — CRM-1 Contacts, Companies and Leads

| ID | Requirement | Priority |
|---|---|---|
| FR-CRM1-01 | Show a contact list with search by name and email, paged (25 per page). | Must |
| FR-CRM1-02 | Create and edit a contact: first name, last name, email, phone, address, company link, lead status. | Must |
| FR-CRM1-03 | Create and edit a company: name, tax number, email, phone, address. | Must |
| FR-CRM1-04 | Link a contact to one company (optional field). | Must |
| FR-CRM1-05 | Lead status field with values New / Working / Qualified / Closed. | Must |
| FR-CRM1-06 | Import screen: upload one CSV file, show the profile report (problems found), start the run, watch the status. | Must |
| FR-CRM1-07 | Reject list screen: rejected rows with the reason, downloadable as CSV. | Must |
| FR-CRM1-08 | Every list screen shows an empty state ("No contacts yet — import a CSV file"). | Should |

## 4.3 Functional requirements V1 — CRM-2 Deals and Quotes

| ID | Requirement | Priority |
|---|---|---|
| FR-CRM2-01 | Deal list with search and filter by stage. | Must |
| FR-CRM2-02 | Create and edit a deal: name, contact link, value, currency, stage, close date. | Must |
| FR-CRM2-03 | Six fixed stages: New, Qualified, Proposal, Negotiation, Won, Lost. | Must |
| FR-CRM2-04 | Simple quote linked to a deal: quote number, date, amount, note. | Must |
| FR-CRM2-05 | Show a warning when a deal has no contact ("orphan deal"). | Must |

## 4.4 Functional requirements V1 — CRM-3 Tickets and Activities

| ID | Requirement | Priority |
|---|---|---|
| FR-CRM3-01 | Ticket list with filter by status and priority. | Must |
| FR-CRM3-02 | Create and edit a ticket: subject, status, priority, contact link, optional order link, note. | Must |
| FR-CRM3-03 | Ticket status values: New, Open, Waiting, Solved, Closed. Priority values: Low, Normal, High, Urgent. | Must |
| FR-CRM3-04 | Notes on a ticket: author, time, text. Newest first. | Must |
| FR-CRM3-05 | Ticket shows the linked customer name and, if present, the order number. | Should |

## 4.5 Functional requirements V1 — CRM-4 Marketing and Consent

| ID | Requirement | Priority |
|---|---|---|
| FR-CRM4-01 | Create and edit a marketing list (name, description). | Must |
| FR-CRM4-02 | Create and edit a campaign (name, date, list link). | Must |
| FR-CRM4-03 | Campaign member rows: contact, status (sent, opened, clicked), unsubscribe flag. | Must |
| FR-CRM4-04 | Consent screen per contact: status (subscribed / unsubscribed), date, source. | Must |
| FR-CRM4-05 | The unsubscribe flag is visible on the contact screen in every CRM module. | Must |
| BR-CRM4-01 | **A contact with status "unsubscribed" can never be added to a list by a migration run or by a bulk action. The system must block it and report it.** | Must |

## 4.6 Functional requirements V1 — CRM-5 Migration Control Center

| ID | Requirement | Priority |
|---|---|---|
| FR-CRM5-01 | Dashboard: cards for total runs, runs running now, runs failed, average quality score. | Must |
| FR-CRM5-02 | Run list: module, batch id, step, status, records in / out / rejected, start and end time. | Must |
| FR-CRM5-03 | Quality score per module: completeness, validity, duplicate rate, reject rate, link integrity. | Must |
| FR-CRM5-04 | Reject list view: rejected records with reason, filter by module and batch. | Must |
| FR-CRM5-05 | Reconciliation report per batch: source = loaded + rejected + merged, shown as a number and as OK / NOT OK. | Must |
| FR-CRM5-06 | Download report as CSV. | Must |
| FR-CRM5-07 | CRM-5 is **read-only**: it never writes data into other modules. | Must |

## 4.7 Data model V1

### CRM-1 tables

| Table | Key columns |
|---|---|
| `crm1_companies` | id (UUID), name, tax_number, email, phone, address_line, city, country, source_system, source_id |
| `crm1_contacts` | id, first_name, last_name, email, phone, address_line, city, country, company_id (link to companies), lead_status, golden_id, source_system, source_id |
| `crm1_leads` | id, name, email, status (New/Working/Qualified/Closed), contact_id (link, optional), source_system, source_id |

### CRM-2 tables

| Table | Key columns |
|---|---|
| `crm2_stages` | id, name, position (order), is_won (true/false) |
| `crm2_deals` | id, name, contact_id, value, currency, stage_id, close_date, source_system, source_id |
| `crm2_quotes` | id, quote_number, deal_id, quote_date, amount, note |

### CRM-3 tables

| Table | Key columns |
|---|---|
| `crm3_tickets` | id, subject, status, priority, contact_id, order_ref (text in V1), created_at, source_system, source_id |
| `crm3_notes` | id, ticket_id, author_id, note_text, created_at |

### CRM-4 tables

| Table | Key columns |
|---|---|
| `crm4_lists` | id, name, description |
| `crm4_campaigns` | id, name, campaign_date, list_id |
| `crm4_members` | id, campaign_id, contact_id, status (sent/opened/clicked), unsubscribed (true/false) |
| `crm4_consents` | id, contact_id, status (subscribed/unsubscribed), consent_date, source |

### CRM-5 tables

| Table | Key columns |
|---|---|
| `crm5_runs` | id, module, batch_id, step, status, records_in, records_out, records_rejected, started_at, finished_at |
| `crm5_scores` | id, module, batch_id, completeness, validity, duplicate_rate, reject_rate, link_integrity |

> The full data dictionary (every column, type and rule) lives in each group's `/docs/data-dictionary.md`, created by Role 4 before Gate G1.

## 4.8 API specification V1

Endpoints, and who may call them:

| Method | Path | Purpose | Roles |
|---|---|---|---|
| GET | `/api/v1/crm-contacts/contacts` | List contacts (paged, search) | viewer, editor, analyst |
| POST | `/api/v1/crm-contacts/contacts` | Create contact | editor, migration_runner |
| PATCH | `/api/v1/crm-contacts/contacts/{id}` | Edit contact | editor, migration_runner |
| GET | `/api/v1/crm-contacts/companies` | List companies | viewer, editor |
| POST | `/api/v1/crm-contacts/companies` | Create company | editor, migration_runner |
| GET | `/api/v1/crm-contacts/leads` | List leads | viewer, editor |
| POST | `/api/v1/crm-contacts/imports` | Start an import run (file + mapping) | migration_runner |
| GET | `/api/v1/crm-contacts/imports/{batch}` | Status of one run | viewer, analyst |
| GET | `/api/v1/crm-deals/deals` | List deals | viewer, editor |
| POST | `/api/v1/crm-deals/deals` | Create deal | editor, migration_runner |
| GET | `/api/v1/crm-deals/stages` | List stages | viewer, editor |
| POST | `/api/v1/crm-deals/quotes` | Create quote | editor, migration_runner |
| GET | `/api/v1/crm-tickets/tickets` | List tickets | viewer, editor |
| POST | `/api/v1/crm-tickets/tickets` | Create ticket | editor, migration_runner |
| POST | `/api/v1/crm-tickets/notes` | Add note | editor |
| GET | `/api/v1/crm-marketing/lists` | List marketing lists | viewer, editor |
| POST | `/api/v1/crm-marketing/lists` | Create list | editor |
| GET | `/api/v1/crm-marketing/consents/{contact}` | Consent of one contact | viewer, editor |
| POST | `/api/v1/crm-marketing/consents` | Set consent (subscribe / unsubscribe) | editor |
| GET | `/api/v1/crm-control/runs` | List migration runs | analyst, viewer |
| GET | `/api/v1/crm-control/scores` | Quality scores | analyst |
| GET | `/api/v1/crm-control/rejects` | Reject list | analyst |
| GET | `/api/v1/crm-control/reconciliation/{batch}` | Reconciliation of one batch | analyst |

Sample error answer (all modules use this shape):

```json
{
  "code": "VALIDATION_ERROR",
  "message": "Email is not valid.",
  "details": [
    { "field": "email", "value": "john.smith(at)mail.com" }
  ]
}
```

## 4.9 Screens V1

| Screen | Module | What it shows |
|---|---|---|
| Contact list / Contact detail / Contact form | CRM-1 | List with search; detail with fields; create/edit form |
| Company list / Company form | CRM-1 | Same pattern |
| Lead list | CRM-1 | Leads with status |
| Import wizard (4 steps: upload, profile, run, result) | CRM-1 | Upload file, see problems, run, see result |
| Reject list | CRM-1, CRM-5 | Rejected rows with reasons, CSV download |
| Deal list / Deal form / Quote form | CRM-2 | Deals with stage filter |
| Ticket list / Ticket detail | CRM-3 | Tickets with filters; notes in the detail |
| List manager / Campaign form / Consent screen | CRM-4 | Lists, campaigns, consent per contact |
| Dashboard / Runs / Scores / Reconciliation | CRM-5 | Cards, tables, CSV download |

Every screen: loading state, empty state, error message in simple language, and a link to the user manual section.

## 4.10 Events V1

| ID | Event | When | Consumers |
|---|---|---|---|
| EV-01 | `batch.extracted` | Extract step finished | Hub, CRM-5 |
| EV-02 | `batch.profiled` | Profile step finished | Hub, CRM-5 |
| EV-03 | `batch.cleaned` | Clean step finished | Hub, CRM-5 |
| EV-04 | `batch.mapped` | Map step finished | Hub, CRM-5 |
| EV-05 | `batch.loaded` | Load step finished | Hub, CRM-5, ERP side |
| EV-06 | `batch.validated` | Validate step finished | Hub, CRM-5 |
| EV-07 | `batch.failed` | Any step failed hard | Hub, CRM-5, group chat alert |
| EV-08 | `contact.merged` | Two contacts merged into one | Hub (Golden ID update) |

## 4.11 Migration kit scope V1 (what the kit moves in V1)

The kit's full design lives in the Migration Kit SDS. For the CRM in V1:

| Entity | Source (CSV columns) | Target table | Known problems in the Dirty Data Pack |
|---|---|---|---|
| Contacts | name, email, phone, city, company | `crm1_contacts` | 80 duplicates, 60 bad emails/phones, 50 empty names |
| Companies | name, tax, email, city | `crm1_companies` | Same company 3 spellings, wrong tax format |
| Deals | name, amount, stage, date, contact email | `crm2_deals` | Stage names vary, dates like 03/04/2025, orphan deals |
| Tickets | subject, status, priority, customer email, text | `crm3_tickets` | Orphans, HTML in text, status variants |
| List members | email, list name, unsubscribed | `crm4_members` | Lost unsubscribe flags, test emails |

## 4.12 Acceptance criteria V1 (the demo must pass these)

| ID | Criterion |
|---|---|
| TS-01 | Login works with all 5 roles; a viewer cannot change data (gets a clear "not allowed" message). |
| TS-02 | A CSV with 1,000 contacts runs through all 7 steps; the reject list shows every rejected row with a reason. |
| TS-03 | The reconciliation screen shows source = loaded + rejected + merged, and the numbers match the file. |
| TS-04 | Duplicate detection finds at least 95% of the 80 known duplicates; the rest go to the review list (V1: simple review list). |
| TS-05 | The consent rule works: an unsubscribed person in the file stays unsubscribed after the run. |
| TS-06 | CRM-5 shows the run with the correct counts within 30 seconds of the run finishing. |
| TS-07 | Every screen has an empty state; no screen shows a technical error to the user. |

# 5. Part V2 — Better Enhancements Specification

V2 makes the CRM **pleasant and stronger**: humans review the hard decisions, reports become presentable, and the safety net (rollback) is in place.

## 5.1 V2 scope

| In V2 | Out of V2 (moves to V3) |
|---|---|
| Merge review screen, safe auto-merge | Duplicate rules admin |
| Mapping screen (user connects old fields to new fields) | Auto-mapping suggestions |
| Rollback of a load | Cutover rehearsal |
| Campaign statistics, consent history | Segments, journeys |
| PDF export, run comparison, drill-down | Trend charts, alerts |

## 5.2 Functional requirements V2

| ID | Module | Requirement | Priority |
|---|---|---|---|
| FR-CRM1-10 | CRM-1 | Duplicate review screen: show pairs (score, fields side by side), buttons Keep both / Merge / Skip, with undo of the last merge. | Must |
| FR-CRM1-11 | CRM-1 | Safe auto-merge: if the email is identical and the name differs only by case or spaces, merge automatically and log it. | Must |
| FR-CRM1-12 | CRM-1 | Company hierarchy: a company can have a parent company (one level in V2). | Should |
| FR-CRM1-13 | CRM-1 | Bulk edit: select up to 100 contacts, change one field (for example lead status). | Should |
| FR-CRM1-14 | CRM-1 | Import history: list of past runs with user, file name, counts, and a link to the report. | Must |
| FR-CRM2-10 | CRM-2 | Pipeline board: columns per stage, drag a deal to change its stage, with a log entry. | Should |
| FR-CRM2-11 | CRM-2 | Quote line items: add product rows (product name, quantity, price, total). | Should |
| FR-CRM2-12 | CRM-2 | Win/loss reason field with a fixed list. | Should |
| FR-CRM3-10 | CRM-3 | Activity timeline: calls, emails, meetings as rows in date order on the contact and ticket. | Must |
| FR-CRM3-11 | CRM-3 | Attachments by reference: file name, size, link — no file content in the database. | Should |
| FR-CRM4-10 | CRM-4 | Campaign statistics: sent / opened / clicked / unsubscribed counts and percentages per campaign. | Must |
| FR-CRM4-11 | CRM-4 | Consent history: all consent changes with date, source and user. | Must |
| FR-CRM4-12 | CRM-4 | List membership rules: a list can be manual or filter-based (for example "all contacts with city = Pune"). | Should |
| FR-CRM5-10 | CRM-5 | Export the reconciliation report as PDF (black and white, with the ClearShift header). | Must |
| FR-CRM5-11 | CRM-5 | Compare two runs of the same module: records before, after, rejected, merged. | Must |
| FR-CRM5-12 | CRM-5 | Drill-down: click a score, see the problem records behind it (up to 100 rows). | Must |
| FR-CRM5-13 | CRM-5 | Filters on runs: by module, date range, status, user. | Must |
| FR-ALL-10 | All | **Rollback**: for every load, a button "Undo this load" restores the target tables to the state before the load, and writes an audit entry. | Must |
| FR-ALL-11 | All | **Mapping screen**: the user connects source columns to target fields and saves the mapping as a template with a name. | Must |

## 5.3 Data model changes V2

| Change | Table | New columns |
|---|---|---|
| Merge support | `crm1_contacts` | `merged_into_id`, `merged_at`, `merge_batch_id` |
| Company hierarchy | `crm1_companies` | `parent_company_id` |
| Quote lines | `crm2_quote_lines` (new) | id, quote_id, product_name, quantity, price, total |
| Timeline | `crm3_activities` (new) | id, contact_id, ticket_id, type (call/email/meeting), happened_at, summary |
| Mapping templates | `crm5_mappings` (new) | id, module, name, mapping_json, created_by |

## 5.4 API changes V2

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/crm-contacts/duplicates?batch={id}` | Candidate pairs for review |
| POST | `/api/v1/crm-contacts/merges` | Merge two contacts (body: keep_id, merge_id) |
| POST | `/api/v1/crm-contacts/merges/undo` | Undo the last merge |
| GET | `/api/v1/crm-marketing/campaigns/{id}/stats` | Campaign statistics |
| GET | `/api/v1/crm-marketing/consents/{contact}/history` | Consent history |
| GET | `/api/v1/crm-control/compare?module={m}&a={batch}&b={batch}` | Compare two runs |
| POST | `/api/v1/crm-control/export/pdf` | PDF report |
| POST | `/api/v1/crm-control/rollback/{batch}` | Roll back a load |
| POST | `/api/v1/crm-control/mappings` | Save a mapping template |

## 5.5 Events V2

| ID | Event | When |
|---|---|---|
| EV-10 | `batch.rolled_back` | A load was undone |
| EV-11 | `run.compared` | A run comparison was created (for reports) |
| EV-12 | `consent.changed` | A consent status changed (by a human or by a run) |

## 5.6 Acceptance criteria V2

| ID | Criterion |
|---|---|
| TS-10 | Rollback test: load 1,000 contacts, roll back, verify the tables and counts are exactly as before, verify the audit entry exists. |
| TS-11 | Merge test: a pair "John Smith / jon smith" with the same email merges automatically; a pair with different emails waits for a human. |
| TS-12 | Mapping template test: save a mapping, delete it, apply the saved template — the columns are mapped correctly. |
| TS-13 | Campaign statistics: the numbers on screen match the CSV of members exactly. |
| TS-14 | PDF report opens, is black and white, and shows the reconciliation numbers of the selected batch. |

# 6. Part V3 — Complete Version Specification

V3 is the **final demo version**: all Must features of all modules, proof that the whole chain works, and documents for every screen.

## 6.1 V3 scope

| In V3 |
|---|
| Duplicate rules admin screen |
| Custom fields on contacts (up to 5 text fields, named by the user) |
| Advanced filters (several conditions combined with AND) |
| Full audit trail screen (who changed which field, when, old value and new value) |
| Weighted forecasting in CRM-2 |
| SLA timers and escalation warnings in CRM-3 |
| Segment builder in CRM-4 |
| Quality trend charts, run alerts, client view in CRM-5 |
| 50,000-record performance run with published numbers |

## 6.2 Functional requirements V3

| ID | Module | Requirement | Priority |
|---|---|---|---|
| FR-CRM1-20 | CRM-1 | Admin screen: choose the duplicate rules (email exact, email fuzzy, phone, name similarity) and the safe auto-merge switches. | Should |
| FR-CRM1-21 | CRM-1 | Custom fields: up to 5 named text fields per contact, shown in the detail screen. | Should |
| FR-CRM1-22 | CRM-1 | Advanced filter builder: combine up to 5 conditions (field, operator, value) with AND. | Should |
| FR-CRM1-23 | CRM-1 | Audit trail screen: changes per record with field, old value, new value, user, time. | Must |
| FR-CRM2-20 | CRM-2 | Weighted pipeline: each stage has a probability; the board shows the weighted total per stage and the month total. | Should |
| FR-CRM2-21 | CRM-2 | Quote PDF download (black and white). | Should |
| FR-CRM3-20 | CRM-3 | SLA timer: target answer time per priority; tickets show "time left" and turn red when over. | Should |
| FR-CRM3-21 | CRM-3 | Escalation: when the SLA time is over, the ticket moves to priority High and an event `ticket.escalated` is sent. | Should |
| FR-CRM4-20 | CRM-4 | Segment builder: save a filter as a segment and use it as a campaign list. | Should |
| FR-CRM4-21 | CRM-4 | Consent audit report: every consent change with proof (source, date, user) for one contact or for the whole database. | Must |
| FR-CRM5-20 | CRM-5 | Quality trend charts: completeness, duplicate rate and reject rate over the last runs (black and white line charts). | Should |
| FR-CRM5-21 | CRM-5 | Alerts: when a run fails or the reject rate goes above the agreed limit, CRM-5 shows a warning card and sends an event `run.alert`. | Should |
| FR-CRM5-22 | CRM-5 | Client view: a read-only share link to one run report (mock link in the student project). | Could |
| FR-ALL-20 | All | Performance run: load 50,000 records in one batch; publish the time and the memory use in the report. | Must |
| FR-ALL-21 | All | Documents: every screen appears in the user manual with a screenshot and one explanation. | Must |

## 6.3 Data model changes V3

| Change | Table | New columns |
|---|---|---|
| Custom fields | `crm1_contacts` | `custom_1` ... `custom_5` |
| Audit trail | `crm1_audit` (new) | id, record_id, table_name, field_name, old_value, new_value, user_id, changed_at |
| Probabilities | `crm2_stages` | `probability` (0-100) |
| SLA | `crm3_tickets` | `sla_target_at`, `escalated` |
| Trends | `crm5_scores` | `measured_at` (for charts) |

## 6.4 API changes V3

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/crm-contacts/filters` | Save and list advanced filters |
| GET | `/api/v1/crm-contacts/{id}/audit` | Audit trail of one record |
| GET | `/api/v1/crm-deals/forecast?month={yyyy-mm}` | Weighted forecast |
| GET | `/api/v1/crm-tickets/sla` | Tickets near or past SLA |
| GET | `/api/v1/crm-marketing/segments` | List segments |
| GET | `/api/v1/crm-control/trends?module={m}` | Quality trend data |
| POST | `/api/v1/crm-control/alerts` | List and acknowledge alerts |

## 6.5 Events V3

| ID | Event | When |
|---|---|---|
| EV-20 | `ticket.escalated` | SLA time over |
| EV-21 | `run.alert` | Run failed or reject rate too high |

## 6.6 Acceptance criteria V3

| ID | Criterion |
|---|---|
| TS-20 | Performance: 50,000 contacts load in one batch; the run finishes; the time is written into the report; the reconciliation is exact. |
| TS-21 | Audit trail: change a contact field, see the change with old and new value within 5 seconds. |
| TS-22 | SLA: create a ticket with priority Urgent and a target time of 0 (already over); the ticket is marked over-SLA and an escalation event is sent. |
| TS-23 | Trend chart: after 3 runs, the chart shows 3 points with the correct values. |
| TS-24 | Full end-to-end: Excel file of customers -> clean -> Golden IDs -> CRM contacts -> a deal -> an order on the ERP side, with matching counts (project scenario 1 and 2). |

# 7. Non-Functional Requirements (all versions)

| ID | Requirement | V1 | V2 | V3 |
|---|---|---|---|---|
| NFR-01 | A list screen with 10,000 rows loads in under 2 seconds. | Target | Measured | Must |
| NFR-02 | A migration run of 10,000 records finishes in under 10 minutes on the demo machine. | Target | Measured | Must |
| NFR-03 | Only logged-in users can call the API. No login = 401 with the standard error format. | Must | Must | Must |
| NFR-04 | Role checks on every endpoint (see the tables in chapters 4-6). | Must | Must | Must |
| NFR-05 | Sensitive fields (consent source details) are masked in logs. | Must | Must | Must |
| NFR-06 | Secrets never appear in code, logs or the browser. | Must | Must | Must |
| NFR-07 | The system works in the last two versions of Chrome and Edge, and on a tablet in landscape mode. | Should | Must | Must |
| NFR-08 | Only fake or synthetic data in every environment. The DevOps Lead checks this at each gate. | Must | Must | Must |
| NFR-09 | Uptime of the demo environment during the final demo: 100% (the demo must not break). | — | Should | Must |

# 8. Interfaces with Other Systems

| System | Direction | What flows | How |
|---|---|---|---|
| ClearShift Hub | CRM -> Hub | Batch events, run status | Events via the event bus |
| ClearShift Hub | Hub -> CRM | Golden IDs for customers | API `/api/v1/hub/id-map` |
| ClearShift Hub | Hub -> CRM | Login (JWT token) | Shared login service |
| Migration Kit | Kit -> CRM | Clean records | Module APIs with role `migration_runner` |
| ClearShift ERP | CRM-2 -> ERP-3 | `deal.won` event | Event via the Hub |
| ClearShift ERP | ERP-3 -> CRM-3 | Order and invoice status | API `/api/v1/erp-orders/...` |
| ClearShift ERP | ERP-1 -> CRM-2 | Product prices for quotes | API `/api/v1/erp-products/prices` |

# 9. Test and Verification Plan Summary

| Level | Tool | Who | V1 | V2 | V3 |
|---|---|---|---|---|---|
| Unit tests (every function) | Vitest | Everyone for own code | 100% of tests pass | 100% | 100% |
| API and contract tests | Postman/Newman against the OpenAPI file | Role 2 + Role 4 | All V1 endpoints | All V2 endpoints | All |
| UI tests | React Testing Library | Role 3 | Forms and lists | Review and mapping screens | All screens |
| End-to-end tests | Playwright | Role 3 + Role 4 | Import wizard | Rollback and merge | Full journeys |
| Peer testing | Partner group (see Project Plan) | Partner group | — | Yes (Sprint 5) | Yes |
| Performance test | k6 or a script | Role 4 + DevOps Lead | — | 10,000 records | 50,000 records |
| Security checklist | OWASP ZAP + checklist | DevOps Lead | — | Basic | Basic + roles audit |

# 10. Glossary (B1 explanations)

| Term | Simple meaning |
|---|---|
| API | A way for two programs to talk with fixed rules. |
| Audit trail | A record of who changed what and when. |
| CSV | A simple text file with rows and columns, separated by commas. |
| Consent | The permission of a person to be contacted, and the right to say no. |
| Dashboard | One screen with the important numbers. |
| Dry run | A test run that saves nothing. |
| Golden ID | One main ID for one real customer, even in many systems. |
| JWT | A small signed token that proves who you are. |
| Lead | A possible customer who is not yet a customer. |
| Mapping | The rule "old field goes to new field". |
| Merge | Combining two records of the same real person into one. |
| Migration runner | The technical role that loads data. |
| OpenAPI | A standard description file for an API. |
| Pipeline | The 7 steps: Extract, Profile, Clean, Map, Load, Validate, Reconcile. |
| Profile | Looking at data and counting its problems. |
| Reconciliation | Proving with counts that nothing was lost: source = loaded + rejected + merged. |
| Reject | A record that cannot be loaded, with a written reason. |
| Rollback | Undo a load safely. |
| Schema | A named group of tables in a database. |
| SLA | Service Level Agreement: a promise like "answer within 4 hours". |
| Staging | A safe temporary area where data waits while it is cleaned. |
| UUID | A long unique text code that identifies a record. |

---

*End of document. Keep this file in the `clearshift-docs` repository. Owner: CRM-1 to CRM-5 Team Leads together with the Integration Lead. Update the version number when the PM approves a change.*
