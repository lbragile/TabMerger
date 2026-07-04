#!/usr/bin/env bash
# =============================================================================
# TabMerger 2.0 — Developer Setup Script
# =============================================================================
# Usage: bash scripts/setup.sh
# Run from the repository root.
# =============================================================================

set -euo pipefail

# Terminal colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

info()    { echo -e "${BLUE}[info]${NC}  $*"; }
success() { echo -e "${GREEN}[ok]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[warn]${NC}  $*"; }
error()   { echo -e "${RED}[error]${NC} $*" >&2; exit 1; }
header()  { echo -e "\n${BOLD}$*${NC}"; }

# -----------------------------------------------------------------------
# 1. Check required tools
# -----------------------------------------------------------------------
header "Checking prerequisites..."

if ! command -v pnpm &>/dev/null; then
  error "pnpm is not installed. Install it with:\n\n  npm install -g pnpm\n\nor visit https://pnpm.io/installation"
fi
success "pnpm $(pnpm --version) found"

if ! command -v node &>/dev/null; then
  error "Node.js is not installed. Download it from https://nodejs.org (v20 LTS recommended)"
fi
NODE_VERSION=$(node --version | sed 's/v//')
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 20 ]; then
  warn "Node.js $NODE_VERSION detected. Node 20+ is recommended for this project."
else
  success "Node.js $NODE_VERSION found"
fi

if command -v supabase &>/dev/null; then
  success "Supabase CLI $(supabase --version 2>/dev/null | head -1) found"
else
  warn "Supabase CLI not found. Install it to run the local database:"
  warn "  brew install supabase/tap/supabase   (macOS/Linux)"
  warn "  scoop install supabase               (Windows)"
  warn "  https://supabase.com/docs/guides/cli/getting-started"
fi

# -----------------------------------------------------------------------
# 2. Install dependencies
# -----------------------------------------------------------------------
header "Installing workspace dependencies..."
pnpm install
success "Dependencies installed"

# -----------------------------------------------------------------------
# 3. Copy .env.example -> packages/web/.env.local
# -----------------------------------------------------------------------
header "Setting up environment files..."

WEB_ENV="packages/web/.env.local"
EXT_ENV="packages/extension/.env"

if [ ! -f "$WEB_ENV" ]; then
  if [ -f ".env.example" ]; then
    cp .env.example "$WEB_ENV"
    success "Created $WEB_ENV from .env.example"
    warn "Edit $WEB_ENV and fill in real values before running the web app."
  else
    warn ".env.example not found — skipping $WEB_ENV creation"
  fi
else
  info "$WEB_ENV already exists, skipping."
fi

if [ ! -f "$EXT_ENV" ]; then
  if [ -f ".env.example" ]; then
    cp .env.example "$EXT_ENV"
    success "Created $EXT_ENV from .env.example"
    warn "Edit $EXT_ENV and fill in NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY."
  fi
else
  info "$EXT_ENV already exists, skipping."
fi

# -----------------------------------------------------------------------
# 4. Supabase local setup instructions
# -----------------------------------------------------------------------
header "Supabase local development"

if command -v supabase &>/dev/null; then
  echo ""
  echo "  Run the following commands to start the local Supabase stack:"
  echo ""
  echo -e "    ${BOLD}supabase start${NC}"
  echo "      Starts Postgres, Auth, Storage, Studio, and Realtime."
  echo "      On first run this will pull Docker images (requires Docker Desktop)."
  echo ""
  echo -e "    ${BOLD}supabase db reset${NC}"
  echo "      Applies all migrations in supabase/migrations/ and runs supabase/seed.sql."
  echo "      Re-run whenever you add a new migration or want a clean slate."
  echo ""
  echo "  Studio UI:   http://127.0.0.1:54323"
  echo "  API URL:     http://127.0.0.1:54321"
  echo "  DB URL:      postgresql://postgres:postgres@127.0.0.1:54322/postgres"
  echo ""
  echo "  The anon and service_role keys are printed by \`supabase start\`."
  echo "  Copy them into $WEB_ENV and $EXT_ENV."
else
  warn "Install the Supabase CLI then run:"
  warn "  supabase start && supabase db reset"
fi

# -----------------------------------------------------------------------
# 5. Chrome Web Store OAuth credentials
# -----------------------------------------------------------------------
header "Chrome Web Store OAuth credentials"
echo ""
echo "  To publish to the Chrome Web Store you need OAuth 2.0 credentials."
echo "  Follow the official guide:"
echo ""
echo -e "    ${BOLD}https://developer.chrome.com/docs/webstore/using-api/${NC}"
echo ""
echo "  Quick summary:"
echo "  1. Go to https://console.cloud.google.com/"
echo "  2. Create a project and enable the 'Chrome Web Store API'."
echo "  3. Create an OAuth 2.0 Client ID (Application type: Desktop app)."
echo "  4. Run the token exchange to get a refresh token."
echo "  5. Add CHROME_EXTENSION_ID, CHROME_CLIENT_ID, CHROME_CLIENT_SECRET,"
echo "     and CHROME_REFRESH_TOKEN as GitHub Actions secrets."
echo ""

# -----------------------------------------------------------------------
# Done
# -----------------------------------------------------------------------
header "Setup complete!"
echo ""
echo "  Next steps:"
echo "  1. Edit $WEB_ENV with your Supabase and Stripe credentials."
echo "  2. Start the local Supabase stack:  supabase start && supabase db reset"
echo "  3. Start the web app:               pnpm --filter @tabmerger/web dev"
echo "  4. Start the extension:             pnpm --filter @tabmerger/extension dev"
echo ""
