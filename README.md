<div align="center">

# <span style="color: #fda4af;">ClearShift</span> <span style="color: #9ca3af;">CRM</span>

<p style="font-size: 16px;">
  <span style="color: #fda4af; font-weight: 600;">Customer Relationship Management</span>
  <span style="color: #6b7280;">&bull;</span>
  <span style="color: #9ca3af;">Data Migration & Cleanup Target System</span>
</p>

<p>
  <span style="background-color: #2b1b24; color: #fda4af; padding: 4px 10px; border-radius: 6px; font-size: 12px; border: 1px solid #4a2838;">Node 24 LTS</span>
  <span style="background-color: #1f242c; color: #9ca3af; padding: 4px 10px; border-radius: 6px; font-size: 12px; border: 1px solid #374151;">TypeScript Strict</span>
  <span style="background-color: #2b1b24; color: #fda4af; padding: 4px 10px; border-radius: 6px; font-size: 12px; border: 1px solid #4a2838;">PostgreSQL 18</span>
  <span style="background-color: #1f242c; color: #9ca3af; padding: 4px 10px; border-radius: 6px; font-size: 12px; border: 1px solid #374151;">Drizzle ORM</span>
  <span style="background-color: #2b1b24; color: #fda4af; padding: 4px 10px; border-radius: 6px; font-size: 12px; border: 1px solid #4a2838;">Fastify 5</span>
  <span style="background-color: #1f242c; color: #9ca3af; padding: 4px 10px; border-radius: 6px; font-size: 12px; border: 1px solid #374151;">Vitest</span>
</p>

</div>

---

### <span style="color: #fda4af;">✦ Overview</span>

<span style="color: #9ca3af;">ClearShift CRM is the customer engagement and migration command platform in the ClearShift data transformation ecosystem. It couples modular customer lifecycle features (leads, deals, quotes, support, marketing) with an automated Migration Kit designed to clean, deduplicate, and reliably ingest legacy customer records into a unified Golden ID model.</span>

---

### <span style="color: #fda4af;">✦ Module Teams & Architecture</span>

Each module operates in an isolated workspace under `apps/crm/modules/` communicating exclusively via public contracts and outbox events:

| Team | Module Name | Scope & Responsibilities |
| :--- | :--- | :--- |
| <span style="color: #fda4af; font-weight: bold;">CRM-1</span> | **Contacts, Companies & Leads** | <span style="color: #9ca3af;">Owns customer master data, deduplication engine, lead qualification, and Golden ID syncing.</span> |
| <span style="color: #fda4af; font-weight: bold;">CRM-2</span> | **Deals, Pipeline & Quotes** | <span style="color: #9ca3af;">Tracks sales pipelines, deal progression stages, probability weighting, and quote generation.</span> |
| <span style="color: #fda4af; font-weight: bold;">CRM-3</span> | **Support, Tickets & Activities** | <span style="color: #9ca3af;">Handles customer ticketing, SLA routing, notes/calls activity history, and order tracking.</span> |
| <span style="color: #fda4af; font-weight: bold;">CRM-4</span> | **Marketing Lists & Campaigns** | <span style="color: #9ca3af;">Manages marketing audience segments, campaign metrics, and strict unsubscribe/consent protection.</span> |
| <span style="color: #fda4af; font-weight: bold;">CRM-5</span> | **Migration Control Center & Reports** | <span style="color: #9ca3af;">Central command dashboard tracking all migration runs, reconciliation proof, and quality metrics.</span> |
| <span style="color: #fda4af; font-weight: bold;">PTL</span> | **Platform & Governance** | <span style="color: #9ca3af;">Monorepo tooling, CI pipeline gates, transactional outbox relays, and release coordination.</span> |

---

### <span style="color: #fda4af;">✦ The 7-Step Migration Pipeline</span>

<span style="color: #9ca3af;">Every CRM module implements the standardized 7-step Migration Kit:</span>

1. <span style="color: #fda4af; font-weight: bold;">Extract</span>: <span style="color: #9ca3af;">Read legacy source data (CSV/Excel) into `raw_<module>` without altering source values.</span>
2. <span style="color: #fda4af; font-weight: bold;">Profile</span>: <span style="color: #9ca3af;">Analyze data health, counting empty values, syntax anomalies, and duplicate rows.</span>
3. <span style="color: #fda4af; font-weight: bold;">Clean</span>: <span style="color: #9ca3af;">Standardize emails, phone numbers, addresses, and detect duplicate candidates.</span>
4. <span style="color: #fda4af; font-weight: bold;">Map</span>: <span style="color: #9ca3af;">Map legacy attributes to target domain models with human-in-the-loop review.</span>
5. <span style="color: #fda4af; font-weight: bold;">Load</span>: <span style="color: #9ca3af;">Execute atomic database writes with dry-run and transaction rollback support.</span>
6. <span style="color: #fda4af; font-weight: bold;">Validate</span>: <span style="color: #9ca3af;">Assert post-load business invariants (e.g. contact linkage, consent flags).</span>
7. <span style="color: #fda4af; font-weight: bold;">Reconcile</span>: <span style="color: #9ca3af;">Mathematically verify: <code>Source Count = Loaded + Rejected + Merged (100%)</code>.</span>

---

### <span style="color: #fda4af;">✦ Shared Packages</span>

* **`packages/contracts`**: <span style="color: #9ca3af;">Shared Zod validation schemas and OpenAPI 3.1 specifications.</span>
* **`packages/database`**: <span style="color: #9ca3af;">Shared Drizzle models, schema migrations, and idempotent migration runner.</span>
* **`packages/ui`**: <span style="color: #9ca3af;">Accessible UI design tokens and shared React components.</span>

---

### <span style="color: #fda4af;">✦ Getting Started</span>

```bash
# 1. Install dependencies across all workspaces
npm install

# 2. Configure environment variables
cp .env.example .env

# 3. Common developer commands
npm run typecheck   # Typecheck TypeScript across all workspaces
npm run lint        # Lint codebase with ESLint
npm test            # Run Vitest test suite
npm run db:migrate  # Run database migrations
```

---

### <span style="color: #fda4af;">✦ Pull Request Rules for Teams</span>

* <span style="color: #9ca3af;">Always link your issue: <code>Closes #<ID></code> in your PR description.</span>
* <span style="color: #9ca3af;">Follow PR title format: <code>[MODULE-ID] Brief description of changes</code></span>
* <span style="color: #9ca3af;">Ensure all automated CI checks pass before requesting review.</span>
