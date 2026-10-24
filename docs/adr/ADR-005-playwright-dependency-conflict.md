# ADR-005: Playwright and React Testing Library (RTL) / DOM Dependency Conflicts

## Status
**Proposed**

## Context
The QA / Documentation issue for CRM-2 (*Deals, Pipeline and Quotes*) specifies:
1. An end-to-end browser test journey (`E2E-01`) using Playwright.
2. DOM-level component form state assertions (`FM-01..FM-12`) using React Testing Library (`@testing-library/react`) with user interactions and DOM queries (e.g. disabled buttons, error text, visible warning elements).

However, investigation of the active repository environment and governance baselines reveals a dependency conflict across both testing layers:
1. **Playwright Absence**: Neither `@playwright/test` nor `playwright` is listed in root or workspace `package.json` (`devDependencies` or `dependencies`). No `playwright.config.*` exists, and CI ([.github/workflows/ci.yml](../../.github/workflows/ci.yml)) does not provision headless browsers. While Project Plan §9.3 and SDS §7.2 reference Playwright as an intended testing tool, it was never added to the repository's pinned dependencies.
2. **React Testing Library & DOM Environment Absence**: Neither `@testing-library/react`, `@testing-library/dom`, nor simulated DOM environments (`jsdom` or `happy-dom`) are installed or present in `devDependencies`. The root `package.json` pins only `react: 19.2.8`, `@types/react: 19.2.18`, and `vitest: 4.1.12`. Vitest executes in a Node.js environment without DOM globals (`window`, `document`, `HTMLElement`).
3. **Strict Pinned Stack Governance**: ClearShift Core Rules mandate:
   *"Preserve the repository's pinned toolchain: Node.js 24 LTS patch, strict TypeScript, pnpm/Turborepo, Fastify 5, Zod/OpenAPI, PostgreSQL + Drizzle, Redis Streams, BullMQ and transactional outbox, React/Vite shared UI. Do not change versions or architecture without maintainer approval. Do not add dependencies outside the pinned stack without asking."*

Installing `@playwright/test` (and downloading multi-hundred-megabyte browser binaries) or `@testing-library/react` + `jsdom` directly contradicts repository governance without explicit maintainer approval.

## Decision
1. **Mark E2E-01 (Playwright Browser Journey) as BLOCKED**: The full browser journey test (`E2E-01`) is marked **BLOCKED** pending maintainer authorization to add `@playwright/test` to devDependencies and update CI.
2. **Mark RTL Form States (DOM Render & User Interaction) as BLOCKED**: Full DOM-level rendering and interaction tests requiring `@testing-library/react` and `jsdom`/`happy-dom` are marked **BLOCKED** pending maintainer approval.
3. **Retain Static Form Contract Suite**: Retain `apps/crm/modules/crm-2/web/tests/form-states.test.tsx` scoped strictly to form contract tests (React element instantiation, Zod schema validation, and field contracts) without adding unapproved dependencies.
4. **Zero Unapproved Dependencies**: Strictly obey pinned stack rules: zero external packages added to `package.json` or `package-lock.json`.

## Consequences
- Preserves 100% compliance with pinned toolchain constraints and prevents CI lockfile drift or binary download failures on clean checkouts.
- Accurately reports blocked verification items to maintainers and release leads rather than creating unauthorized workarounds.
- Both suites can be unblocked immediately once the Platform / Release Lead approves adding `@playwright/test` and `@testing-library/react` + `happy-dom` into the official root `devDependencies`.
