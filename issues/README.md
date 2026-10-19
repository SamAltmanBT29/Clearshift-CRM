# ClearShift V1 Canonical 360-Issue Catalog

This package contains the official V1 implementation issue backlog, standardized to **exactly 30 issues per workstream** across all 12 teams.

## Structure

- **ERP Modules (150 Issues):** 5 modules × 30 issues (`ERP1-01..30` to `ERP5-01..30`)
- **CRM Modules (150 Issues):** 5 modules × 30 issues (`CRM1-01..30` to `CRM5-01..30`)
- **Group 11 Platform & Migration Kit (30 Issues):** `PLT-01..12` (12) + `KIT-01..18` (18)
- **Workstream 12 PMO & QA (30 Issues):** `INT-01..06` (6) + `QA-01..08` (8) + `REL-01..04` (4) + `PMO-01..12` (12)
- **Total:** **360 Issue Specifications**

## Files

- `issues.md` — Canonical, complete issue specifications following Section 13 format.
- `validation.json` — Structural validation results (360 issues, 683 edges, 0 missing, 0 cycles).
- `issues.pdf` — Publication-ready PDF companion.

## Sizing & Role Balance
- **Role 1 (Team Lead & Core Backend):** Issues `01–08` (8 issues)
- **Role 2 (Integration & DevOps):** Issues `09–15` (7 issues)
- **Role 3 (Frontend & Review UI):** Issues `16–23` (8 issues)
- **Role 4 (Data Reliability & QA Lead):** Issues `24–30` (7 issues)
- **Sizing:** 0.5–2 developer-days per issue. Average 0.9375 issues/developer-week over 8 V1 weeks.
