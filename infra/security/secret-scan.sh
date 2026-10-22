#!/usr/bin/env bash
# ClearShift CRM - Secret & Credential Scanner
# [PLT-12] Security baseline, secrets, dependency and export protections
#
# Scans the repository for accidental credentials, private keys, and tokens.

set -euo pipefail

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔍 ClearShift Platform: Automated Secret & Credential Scanner"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

FOUND_LEAKS=0

# Regex patterns for common secrets and high-risk tokens
PATTERNS=(
  "(?i)(api_key|apikey|secret_key|private_key|auth_token|access_token|aws_secret_access_key)\s*[:=]\s*['\"][A-Za-z0-9\/+=_-]{16,}['\"]"
  "-----BEGIN (RSA|OPENSSH|EC|DSA|PGP) PRIVATE KEY-----"
  "(?i)password\s*[:=]\s*['\"][^'\"]{8,}['\"]"
  "(?i)ghp_[A-Za-z0-9_]{36}"
  "(?i)github_pat_[A-Za-z0-9_]{82}"
  "(?i)xox[baprs]-[0-9A-Za-z-]{10,48}"
  "AKIA[0-9A-Z]{16}"
)

# Scan target directory (default: repo root)
TARGET_DIR="${1:-.}"

echo "Scanning target: ${TARGET_DIR}"

for PATTERN in "${PATTERNS[@]}"; do
  MATCHES=$(grep -rnIP "$PATTERN" "$TARGET_DIR" \
    --exclude-dir=".git" \
    --exclude-dir="node_modules" \
    --exclude-dir=".github" \
    --exclude-dir="dist" \
    --exclude-dir="build" \
    --exclude="*.md" \
    --exclude="*.example" \
    --exclude="*.sample" \
    --exclude="secret-scan.sh" \
    2>/dev/null || true)

  if [ -n "$MATCHES" ]; then
    echo "❌ Detected potential secret pattern match:"
    echo "$MATCHES" | head -n 5
    FOUND_LEAKS=1
  fi
done

if [ "$FOUND_LEAKS" -eq 1 ]; then
  echo ""
  echo "❌ Hardcoded secrets detected! Please use environment variables or secret vaults."
  echo "Remember: ClearShift rule §9.4 forbids committing real secrets or personal credentials."
  exit 1
fi

echo "✅ Secret scanner PASSED: No secrets or credentials found in scanned files."
exit 0
