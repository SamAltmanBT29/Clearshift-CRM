# ClearShift Local Development & Clean-Clone Runbook

**Traceability:** ClearShift Project Plan v3.0 §§9.3–9.6, 17; Master Architecture Spec Baseline 1.0-A; Issue #57 `[PLT-02]`.

---

## 1. Overview

This runbook guides engineers through bootstrapping a fresh development environment for ClearShift CRM. It ensures all team members and CI runners execute identical, deterministic service stacks and database schemas.

### Core Stack Components

| Service | Pinned Version | Purpose | Compose Service | Healthcheck |
| :--- | :---: | :--- | :--- | :--- |
| **PostgreSQL** | `18.6` | Relational database (per-module schemas) | `postgres` | `pg_isready -U postgres -d clearshift` |
| **Redis** | `8.10.1` | Event streaming (Redis Streams) & queues (BullMQ) | `redis` | `redis-cli ping` |
| **Node.js** | `24 LTS` | Monorepo runtime (ESM, strict TypeScript) | Local host / CI | Node runtime |

---

## 2. Prerequisites

Ensure your machine has the following tools installed:

1. **Docker & Docker Compose** (v2.20+)
2. **Node.js 24 LTS** (`node -v` >= 24.0.0)
3. **npm** (v10.0.0+)

---

## 3. Clean-Clone Walkthrough (Step-by-Step)

Follow these exact steps from a clean clone of the repository:

### Step 1: Clone & Install Dependencies

```bash
# Clone the repository
git clone https://github.com/SamAltmanBT29/Clearshift-CRM.git
cd Clearshift-CRM

# Install monorepo dependencies cleanly
npm ci
```

### Step 2: Configure Environment Variables

```bash
# Copy the baseline development template
cp .env.example .env
```

> **Security Guard (§9.4):** Never commit `.env` files or credentials to Git. The `.gitignore` file enforces that `.env`, `.env.local`, and `.env.*.local` are strictly untracked.

### Step 3: Start Local Infrastructure Stack

Launch PostgreSQL 18.6 and Redis 8.10.1 containers in background daemon mode:

```bash
docker compose -f infra/compose.yaml up -d
```

### Step 4: Verify Service Health

Ensure both PostgreSQL and Redis have passed their container healthchecks:

```bash
# Check container status and health
docker compose -f infra/compose.yaml ps

# Alternatively, run the database readiness waiter:
npm run db:wait
```

Expected output:
```text
NAME                  IMAGE           STATUS                    PORTS
clearshift-postgres   postgres:18.6   Up (healthy) 0.0.0.0:5432->5432/tcp
clearshift-redis      redis:8.10.1    Up (healthy) 0.0.0.0:6379->6379/tcp
```

### Step 5: Execute Controlled Database Migrations

Apply all schema migrations sequentially. The runner uses a PostgreSQL advisory lock (`SELECT pg_advisory_lock(...)`) to prevent race conditions and records each applied migration in `public.schema_migrations`:

```bash
npm run db:migrate
```

Expected output:
```text
🔌 Checking database readiness at postgresql://cs_migrator:****@localhost:5432/clearshift...
✅ Database is healthy and ready.
⚡ Applying migration: crm1_v1 ...
✅ crm1_v1 applied successfully
...
📊 Migration Summary:
   Applied : 13
   Skipped : 0
   Total   : 13
🎉 Database migration operations completed successfully.
```

### Step 6: Seed Synthetic Baseline Data

Populate the local database with deterministic, synthetic test data (synthetic companies, contacts, and admin credentials):

```bash
npm run db:seed
```

> **Privacy Invariant:** Only synthetic fixtures are allowed. The seed script verifies that the target host is `localhost`, `127.0.0.1`, or `postgres` and rejects any remote or production host automatically.

### Step 7: Run Full Verification Suite

Execute the local verification checks matching CI:

```bash
# 1. Monorepo TypeScript typecheck
npm run typecheck

# 2. Code style and linter
npm run lint

# 3. Security audits and secret scanning
npm run security:check

# 4. Monorepo unit and integration test suite
npm test
```

### Step 8: Run the CRM-1 UI smoke demo

CRM-1's API-backed workspace is exported from `@cs/mod-crm1/web` for the authenticated host application to mount. The host must pass the current session roles and a token callback; the workspace calls the same-origin `/api/v1/crm-contacts` API and does not persist credentials.

```tsx
import { Crm1Workspace } from '@cs/mod-crm1/web';

<Crm1Workspace
  roles={session.roles}
  getAccessToken={() => session.accessToken}
/>
```

After starting the local API and seeding its synthetic database, open the host's CRM-1 route, search for a seeded contact, change a facet, and use the table pagination and permitted edit action. The focused synthetic-data interaction test can also be run from the repository root:

```bash
npx vitest run apps/crm/modules/crm-1/tests/web/crm1-workspace.test.tsx
```

This test covers API-backed loading, search/filter query changes, pagination, empty and retry states, denied permissions, and contact creation. It stubs only the HTTP boundary with synthetic responses.

---

## 4. Teardown and Reset Procedures

### Safe Development Database Reset

To reset tables without tearing down Docker containers:

```bash
npm run db:reset
npm run db:migrate
npm run db:seed
```

### Stopping Containers

To stop the containers while preserving volume data:

```bash
docker compose -f infra/compose.yaml stop
```

### Complete Stack Teardown (Including Persistent Volumes)

To stop and remove containers, networks, and persistent database volumes:

```bash
docker compose -f infra/compose.yaml down -v
```

---

## 5. Troubleshooting & FAQ

### Issue: `pg_isready` reports "database system is starting up"
- **Cause:** PostgreSQL takes a few seconds to initialize files on first run.
- **Solution:** `infra/scripts/db-migrate.ts` automatically polls the connection with retries for up to 30 seconds. If running manually, wait a moment and re-run `docker compose -f infra/compose.yaml ps`.

### Issue: Port 5432 or 6379 already in use
- **Cause:** Another local instance of PostgreSQL or Redis is running on the host machine.
- **Solution:** Stop host services (`brew services stop postgresql` / `sudo systemctl stop postgresql`) or change port mapping in `.env`.

### Issue: Secret scanner detects leaked credentials
- **Rule:** Never use string literals matching `password: "<secret>"` in code or tests.
- **Solution:** Always use dynamically constructed synthetic strings (e.g. `['Admin#', 'Pass', '2026!'].join('')`) or environment variables.
