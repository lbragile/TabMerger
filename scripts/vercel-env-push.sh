#!/usr/bin/env bash
# Pushes a local env file to one Vercel environment of the linked project.
#
#   scripts/vercel-env-push.sh packages/web/.env.preview preview           # dry run: shows what would change
#   scripts/vercel-env-push.sh packages/web/.env.preview preview --apply   # uploads
#
# Start the file with `vercel env pull packages/web/.env.preview --environment=preview`.
# Secrets come back as the literal placeholder "[SENSITIVE]" — Vercel never returns a
# saved secret — so this script SKIPS any value that is still "[SENSITIVE]" (it's left
# unchanged on Vercel). Replace a placeholder with the real value to update that one.
#
# Also skipped: variables Vercel sets itself (VERCEL*, TURBO_*, NX_DAEMON), which the
# pull writes into the file but which must never be uploaded.
#
# NEXT_PUBLIC_* values are stored as plain config (they ship to the browser anyway), and so
# are the non-secret server values in BUILD_TIME_CONFIG below; everything else as a Secret.
# Why the list exists: the web app is built on the CI runner (vercel pull → vercel build →
# deploy --prebuilt), and `vercel pull` only ever returns "[SENSITIVE]" for a secret. A secret
# that a server function reads while running is fine, but one read during the build (e.g. in
# next.config.ts) would build with the literal text "[SENSITIVE]". Values go to the CLI on stdin, never as arguments, so
# they don't appear in the process list. Values are never printed.
#
# Run from the repo root (the directory linked with `vercel link`).
set -euo pipefail

file="${1:?usage: $0 <env-file> <preview|production|development> [--apply]}"
target="${2:?usage: $0 <env-file> <preview|production|development> [--apply]}"
apply="${3:-}"

case "$target" in preview|production|development) ;; *) echo "environment must be preview, production or development" >&2; exit 1 ;; esac
[ -f "$file" ] || { echo "no such file: $file" >&2; exit 1; }
[ -f .vercel/project.json ] || { echo "run from the repo root (no .vercel/project.json here — run 'vercel link' first)" >&2; exit 1; }
if ! git check-ignore -q "$file"; then
  echo "refusing: $file is not gitignored — a file of real secrets must never be committable" >&2
  exit 1
fi

# Non-secret server variables read at BUILD time — must stay plain config (see above).
BUILD_TIME_CONFIG=(FIREFOX_BETA_BLOB_BASE_URL)
is_build_time_config() {
  local k
  for k in "${BUILD_TIME_CONFIG[@]}"; do [ "$k" = "$1" ] && return 0; done
  return 1
}

pushed=0; skipped=0
while IFS= read -r line || [ -n "$line" ]; do
  line="${line%$'\r'}"
  case "$line" in ''|\#*) continue ;; esac
  key="${line%%=*}"
  val="${line#*=}"
  # Strip one pair of surrounding quotes, as `vercel env pull` writes them.
  if [[ "$val" == \"*\" && ${#val} -ge 2 ]]; then val="${val:1:${#val}-2}"; fi

  case "$key" in
    VERCEL|VERCEL_*|TURBO_*|NX_DAEMON) continue ;;
  esac
  if [ "$val" = "[SENSITIVE]" ]; then
    printf '  skip   %-40s (still the [SENSITIVE] placeholder — unchanged on Vercel)\n' "$key"
    skipped=$((skipped + 1)); continue
  fi
  if [ -z "$val" ]; then
    printf '  skip   %-40s (empty)\n' "$key"
    skipped=$((skipped + 1)); continue
  fi

  if [[ "$key" == NEXT_PUBLIC_* ]] || is_build_time_config "$key"; then
    kind="--no-sensitive"; label=config
  else
    kind="--sensitive"; label=secret
  fi

  if [ "$apply" = "--apply" ]; then
    # printf, not echo: no trailing newline gets stored as part of the value.
    if printf '%s' "$val" | vercel env add "$key" "$target" --force --yes "$kind" >/dev/null 2>&1; then
      printf '  set    %-40s (%s)\n' "$key" "$label"
    else
      printf '  FAIL   %-40s — retry: vercel env add %s %s --force\n' "$key" "$key" "$target"
    fi
  else
    printf '  would set %-37s (%s)\n' "$key" "$label"
  fi
  pushed=$((pushed + 1))
done < "$file"

echo
if [ "$apply" = "--apply" ]; then
  echo "$pushed pushed, $skipped skipped. Redeploy for the change to take effect — Vercel applies env changes to NEW deployments only."
else
  echo "Dry run: $pushed would be set, $skipped skipped. Re-run with --apply to upload."
fi
