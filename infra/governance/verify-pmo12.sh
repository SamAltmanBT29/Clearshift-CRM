#!/usr/bin/env bash
set -euo pipefail

echo "=========================================================="
echo "🛡️ ClearShift PMO-12 Governance & Recovery Verification"
echo "=========================================================="

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${REPO_ROOT}"

RUNBOOK="docs/runbooks/v1-operational-recovery-runbook.md"
INCIDENT_ROLES="docs/governance/incident-response-roles.md"
DEMO_SCHEDULE="docs/governance/gate-g4-demo-rehearsal-schedule.md"
ADR_004="docs/adr/ADR-004-v1-recovery-boundary-and-incident-model.md"

echo "1. Checking required PMO-12 documentation artifacts..."

for FILE in "${RUNBOOK}" "${INCIDENT_ROLES}" "${DEMO_SCHEDULE}" "${ADR_004}"; do
  if [[ ! -f "${FILE}" ]]; then
    echo "❌ Missing mandatory artifact: ${FILE}"
    exit 1
  fi
  echo "   ✅ Found ${FILE}"
done

echo "2. Validating non-negotiable V1 architectural boundaries in Runbook..."
# Must mention stop conditions and 10% threshold
grep -q "STP-01" "${RUNBOOK}" || { echo "❌ STP-01 not found in ${RUNBOOK}"; exit 1; }
grep -q "10%" "${RUNBOOK}" || { echo "❌ 10% threshold not found in ${RUNBOOK}"; exit 1; }
# Must mention safe batch stoppage
grep -q "Safe Batch Stoppage" "${RUNBOOK}" || { echo "❌ Safe Batch Stoppage not found in ${RUNBOOK}"; exit 1; }
# Must mention master reconciliation formula
grep -q "source = loaded + rejected + merged + skipped" "${RUNBOOK}" || { echo "❌ Reconciliation formula missing in ${RUNBOOK}"; exit 1; }
grep -q "unaccounted = 0" "${RUNBOOK}" || { echo "❌ unaccounted = 0 missing in ${RUNBOOK}"; exit 1; }

echo "3. Validating Incident Response Hierarchy..."
grep -q "Incident Commander" "${INCIDENT_ROLES}" || { echo "❌ Incident Commander missing in ${INCIDENT_ROLES}"; exit 1; }
grep -q "Communications Lead" "${INCIDENT_ROLES}" || { echo "❌ Communications Lead missing in ${INCIDENT_ROLES}"; exit 1; }
grep -q "SEV-1" "${INCIDENT_ROLES}" || { echo "❌ SEV-1 missing in ${INCIDENT_ROLES}"; exit 1; }
grep -q "Post-Mortem" "${INCIDENT_ROLES}" || { echo "❌ Post-Mortem missing in ${INCIDENT_ROLES}"; exit 1; }

echo "4. Validating Gate G4 Demo Rehearsal Schedule..."
grep -q "Rehearsal 1" "${DEMO_SCHEDULE}" || { echo "❌ Rehearsal 1 missing in ${DEMO_SCHEDULE}"; exit 1; }
grep -q "Rehearsal 2" "${DEMO_SCHEDULE}" || { echo "❌ Rehearsal 2 missing in ${DEMO_SCHEDULE}"; exit 1; }
grep -q "Rehearsal 3" "${DEMO_SCHEDULE}" || { echo "❌ Rehearsal 3 missing in ${DEMO_SCHEDULE}"; exit 1; }
grep -q "Gate G4 Showcase" "${DEMO_SCHEDULE}" || { echo "❌ Gate G4 Showcase missing in ${DEMO_SCHEDULE}"; exit 1; }
grep -q "45 Minutes Total" "${DEMO_SCHEDULE}" || { echo "❌ 45 Minutes Total missing in ${DEMO_SCHEDULE}"; exit 1; }

echo "5. Executing Automated Test Suite..."
npx vitest run packages/core/tests/recovery-governance.test.ts

echo "=========================================================="
echo "✅ All PMO-12 Governance & Recovery checks PASSED (100%)"
echo "=========================================================="
