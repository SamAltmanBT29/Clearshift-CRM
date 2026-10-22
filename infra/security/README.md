# ClearShift Security Baseline & Protections (`infra/security/`)

**Owner:** Pari — DevOps & Security Lead  
**Stream:** Platform Stream ([PLT-12])  
**Target:** Sprint 2 / Gate G3  
**Status:** Operational

---

## Overview

The `infra/security/` directory houses automated security tooling, policy definitions, resource safeguard configurations, and PR governance rules for ClearShift CRM.

ClearShift operates on synthetic student data while simulating enterprise CRM and ERP workloads. Strong security baselines guarantee that no secrets, cloud uploaders, unmasked PII, or insecure file exports enter the codebase.

---

## Tooling & Scripts

| Tool | Path | Description |
|---|---|---|
| **Dependency Vulnerability Audit** | [`./dependency-audit.sh`](./dependency-audit.sh) | Runs automated `npm audit` with `--audit-level=high`. Fails build on high or critical CVEs. |
| **Secret & Credential Scanner** | [`./secret-scan.sh`](./secret-scan.sh) | Scans repository tree for hardcoded API keys, private keys, passwords, and tokens. |
| **Cloud Uploader & Integrity Audit** | [`./repo-audit.sh`](./repo-audit.sh) | Verifies absence of cloud storage SDKs (S3, GCS, Azure, Cloudinary) and validates synthetic fixture compliance. |
| **Resource Safeguards Config** | [`./resource-safeguards.json`](./resource-safeguards.json) | Declares platform limits (50 MB file ceiling, 50k rows, 500-row chunks, 10% halt threshold). |
| **PR Review Rules** | [`./pr-review-rules.md`](./pr-review-rules.md) | Enforces dual sign-off, RBAC tests, and parameterized SQL invariants on sensitive PRs. |

---

## Local Developer Workflow

Before submitting a pull request, run the security suite locally:

```bash
# 1. Dependency audit
./infra/security/dependency-audit.sh

# 2. Secret scan
./infra/security/secret-scan.sh

# 3. Repository integrity & cloud uploader audit
./infra/security/repo-audit.sh

# 4. Unit & export safety tests
npm test packages/core/tests/csv-safe.test.ts
```

All four checks are automated in CI via `.github/workflows/ci.yml` and `.github/workflows/4-ci-pipeline.yml`.
