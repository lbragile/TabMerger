#!/usr/bin/env bash
# Pre-commit scan for secrets, API keys, and PII.
# Exits non-zero if any pattern matches a staged file.

set -euo pipefail

RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Get list of staged files (excluding deleted files)
STAGED=$(git diff --cached --name-only --diff-filter=d)

if [ -z "$STAGED" ]; then
  exit 0
fi

FOUND=0

# Load ignore list
IGNORE_LIST=""
if [ -f ".secretsignore" ]; then
  IGNORE_LIST=$(grep -v '^\s*#' .secretsignore | grep -v '^\s*$' || true)
fi

filter_ignored() {
  # Always exclude the ignore-list file itself
  local result
  result=$(cat | grep -v '^\.secretsignore$' || true)
  if [ -z "$IGNORE_LIST" ]; then
    echo "$result"
  else
    echo "$result" | grep -vFf <(echo "$IGNORE_LIST") || true
  fi
}

check_pattern() {
  local label="$1"
  local pattern="$2"
  local matches
  matches=$(echo "$STAGED" | xargs grep -lE "$pattern" 2>/dev/null | filter_ignored || true)
  if [ -n "$matches" ]; then
    echo -e "${RED}[BLOCKED]${NC} ${YELLOW}${label}${NC} found in:"
    echo "$matches" | sed 's/^/  /'
    FOUND=1
  fi
}

# Hard-coded secrets
check_pattern "AWS access key"        "AKIA[0-9A-Z]{16}"
check_pattern "AWS secret key"        "aws_secret_access_key\s*=\s*['\"][^'\"]{20,}"
check_pattern "Stripe live secret"    "sk_live_[0-9a-zA-Z]{24,}"
check_pattern "Stripe test secret"    "sk_test_[0-9a-zA-Z]{24,}"
check_pattern "Stripe webhook secret" "whsec_[0-9a-zA-Z]{32,}"
check_pattern "Supabase service key"  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]{50,}"
check_pattern "Anthropic API key"     "sk-ant-[a-zA-Z0-9\-_]{32,}"
check_pattern "Generic API key var"   "(API_KEY|SECRET_KEY|ACCESS_TOKEN|PRIVATE_KEY)\s*=\s*['\"][^'\"\$\{]{8,}"
check_pattern "GitHub token"          "ghp_[0-9a-zA-Z]{36}|ghs_[0-9a-zA-Z]{36}"
check_pattern "Private key block"     "-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----"

# PII patterns
check_pattern "Email address (literal)" "[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}"

# .env files committed directly (allow .env.example and .env.local.example)
ENV_FILES=$(echo "$STAGED" | grep -E "(^|\/)\.env$|(^|\/)\.env\.[^e][a-z]*$" || true)
if [ -n "$ENV_FILES" ]; then
  echo -e "${RED}[BLOCKED]${NC} ${YELLOW}.env file staged for commit${NC}:"
  echo "$ENV_FILES" | sed 's/^/  /'
  echo "  Commit .env.example instead — never commit real .env files."
  FOUND=1
fi

if [ "$FOUND" -eq 1 ]; then
  echo ""
  echo -e "${RED}Commit blocked.${NC} Remove secrets before committing."
  echo "If this is a false positive (e.g. in a test fixture), add the file to .secretsignore"
  exit 1
fi

exit 0
