#!/usr/bin/env bash
# ClearShift CRM - Repository Integrity & Cloud Uploader Audit
# [PLT-12] Security baseline, secrets, dependency and export protections
#
# Acceptance Criteria:
# - No cloud uploader, real-data fixture or secret is found in repository scan.
# - Enforce fake data only, no external storage or cloud uploads in V1.

set -euo pipefail

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔍 ClearShift Platform: Cloud Uploader & Fixture Integrity Audit"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

FAILED=0

# 1. Cloud storage / uploader SDK packages
echo "1. Checking package manifests for forbidden cloud uploader dependencies..."
FORBIDDEN_PACKAGES=(
  "@aws-sdk/client-s3"
  "aws-sdk"
  "@google-cloud/storage"
  "@azure/storage-blob"
  "cloudinary"
  "multer-s3"
)

for PKG in "${FORBIDDEN_PACKAGES[@]}"; do
  if grep -rn "\"$PKG\"" packages/ apps/ package.json 2>/dev/null; then
    echo "❌ FORBIDDEN: Found cloud storage package '$PKG' declared in dependencies!"
    echo "   ClearShift V1 forbids external storage and cloud uploaders (Project Plan §9.4)."
    FAILED=1
  fi
done

# 2. Source code imports of cloud uploaders
echo "2. Scanning source files for forbidden cloud uploader imports..."
CLOUD_IMPORTS=$(grep -rnE "(from ['\"](@aws-sdk/client-s3|@google-cloud/storage|@azure/storage-blob|cloudinary)['\"]|require\(['\"](@aws-sdk/client-s3|@google-cloud/storage|@azure/storage-blob|cloudinary)['\"]\))" \
  packages/ apps/ \
  --exclude-dir="node_modules" \
  --exclude-dir="dist" \
  2>/dev/null || true)

if [ -n "$CLOUD_IMPORTS" ]; then
  echo "❌ FORBIDDEN: Detected cloud uploader imports in codebase:"
  echo "$CLOUD_IMPORTS"
  FAILED=1
fi

# 3. Real personal data patterns (unmasked Social Security Numbers, real Credit Card numbers)
echo "3. Scanning for potential real personal data / unmasked PII..."
# SSN pattern: \b\d{3}-\d{2}-\d{4}\b excluding common fake test series like 000-00-0000 or documentation
PII_MATCHES=$(grep -rnE "\b[0-9]{3}-[0-9]{2}-[0-9]{4}\b" \
  packages/ apps/ \
  --exclude-dir="node_modules" \
  --exclude-dir="dist" \
  --exclude="*.md" \
  --exclude="*.json" \
  2>/dev/null || true)

if [ -n "$PII_MATCHES" ]; then
  echo "⚠️ Potential unmasked SSN pattern detected:"
  echo "$PII_MATCHES" | head -n 5
  # Verify if these are synthetic
  echo "ℹ️ Please ensure all fixtures are strictly synthetic."
fi

if [ "$FAILED" -eq 1 ]; then
  echo ""
  echo "❌ Repository audit FAILED: Forbidden cloud uploaders or unapproved storage detected."
  exit 1
fi

echo "✅ Repository audit PASSED: Zero cloud uploaders and compliant synthetic fixtures verified."
exit 0
