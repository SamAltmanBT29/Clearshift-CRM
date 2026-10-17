# ADR-001: ClearShift CRM Monorepo Architecture & Pinned Toolchain

## Context
ClearShift CRM is divided across 5 feature teams (CRM-1 through CRM-5) plus Platform/QA. To prevent contract drift, duplicate tooling, and schema fragmentation, all modules reside in a single monorepo.

## Decision
- Node.js 24 LTS pinned runtime.
- Monorepo workspace with modular isolation:
  - `apps/crm/modules/*` for isolated feature module development
  - `packages/contracts` for shared OpenAPI & Zod contracts
  - `packages/database` for shared Drizzle migrations
  - `packages/ui` for shared design tokens and components
- TypeScript strict mode and automated CI gating on all PRs.

## Consequences
- Independent module velocity without dependency hell.
- Single source of truth for contracts and migrations.
