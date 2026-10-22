#!/usr/bin/env bash
# ClearShift CRM - Automated Dependency Security Audit
# [PLT-12] Security baseline, secrets, dependency and export protections
#
# Blocks high and critical severity CVEs per Gate G2/G3 acceptance criteria.

set -euo pipefail

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔍 ClearShift Platform: Automated Dependency Vulnerability Audit"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

AUDIT_LEVEL="${AUDIT_LEVEL:-high}"
echo "Threshold level: ${AUDIT_LEVEL} (blocks high and critical vulnerabilities)"
echo ""

if ! command -v npm >/dev/null 2>&1; then
  echo "❌ Error: npm is required to execute dependency audit."
  exit 1
fi

echo "Running npm audit --audit-level=${AUDIT_LEVEL}..."
if npm audit --audit-level="${AUDIT_LEVEL}"; then
  echo ""
  echo "✅ Dependency vulnerability audit PASSED: No ${AUDIT_LEVEL} or critical vulnerabilities found."
  exit 0
else
  EXIT_CODE=$?
  echo ""
  echo "❌ Dependency vulnerability audit FAILED (exit code: ${EXIT_CODE})."
  echo "High or critical vulnerabilities detected! Merging is blocked."
  echo "To remediate:"
  echo "  1. Review the report above."
  echo "  2. Run 'npm audit fix' or apply package override / patch in package.json."
  echo "  3. Re-run './infra/security/dependency-audit.sh' before opening PR."
  exit ${EXIT_CODE}
fi
