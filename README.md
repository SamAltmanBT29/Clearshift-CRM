# ClearShift CRM

Monorepo for the **ClearShift CRM** enterprise platform.

## Architecture & Workspaces

This repository is organized as a monorepo containing 5 module teams and shared platform packages:

### Feature Modules (`apps/crm/modules/`)
- **`crm-1`**: Contacts, Companies and Leads (Team: `crm-contacts`)
- **`crm-2`**: Deals, Pipeline and Quotes (Team: `crm-deals`)
- **`crm-3`**: Support Tickets and Activities (Team: `crm-support`)
- **`crm-4`**: Marketing Lists and Campaign History (Team: `crm-marketing`)
- **`crm-5`**: Migration Control Center and Reports (Team: `crm-reports`)

### Shared Packages (`packages/`)
- **`@clearshift/contracts`**: Shared Zod validation schemas and OpenAPI 3.1 specifications
- **`@clearshift/database`**: Shared Drizzle ORM models, migration runner and database client
- **`@clearshift/ui`**: Accessible design tokens and reusable UI components

---

## Getting Started

### 1. Prerequisites
- Node.js 24 LTS (`node -v`)
- npm 10+ or pnpm

### 2. Setup
```bash
# Install dependencies
npm install

# Setup environment variables
cp .env.example .env
```

### 3. Common Commands
```bash
npm run typecheck   # Typecheck TypeScript across all workspaces
npm run lint        # Lint files
npm run test        # Run test suite via Vitest
npm run db:migrate  # Run pending database migrations
```

---

## Contributing
- Every pull request must follow the standard PR template and link an issue: `Closes #<ID>`.
- All PRs must pass the automated GitHub Actions CI checks before review.
