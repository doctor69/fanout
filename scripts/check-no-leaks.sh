#!/usr/bin/env bash
#
# specs/06-build-plan.md Phase 8: "Confirm no client secret or token ever
# appears in logs (grep build output / console for accidental leaks)."
#
# What this actually proves, in order of how much it matters:
#   1. No secret VALUE — from app/.env or from the function's own .dev.vars —
#      is compiled into the app bundle. This is the check that counts. Values
#      are compared, never printed.
#   2. Our own source never sets or references a client secret. (The string
#      "client_secret" does appear in the bundle, but it's expo-auth-session's
#      parameter name for an option we never set — a library naming a field is
#      not a leak, so the identifier alone is not grounds for failing.)
#   3. No console.* calls in code that handles tokens: the surest way not to
#      log a token is to have no logging there at all.
#
# Usage: npm run check:leaks
set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
failures=0

note() { printf '  %s\n' "$1"; }
fail() { printf '✗ %s\n' "$1"; failures=$((failures + 1)); }
pass() { printf '✓ %s\n' "$1"; }

echo "1/4  our source never handles a client secret"
secret_hits="$(grep -rn --include='*.ts' --include='*.tsx' -iE 'client_?secret|app_?secret' \
  app/screens app/services app/state app/App.tsx app/config.ts \
  packages/core-posting/src 2>/dev/null \
  | grep -viE 'doesNotMatch|// |\* ' || true)"
if [ -n "$secret_hits" ]; then
  fail "client-secret handling found in app or core source:"
  printf '%s\n' "$secret_hits" | sed 's/^/    /'
else
  pass "no client-secret handling outside /functions"
fi

echo "2/4  no console calls in token-handling code"
console_hits="$(grep -rn --include='*.ts' --include='*.tsx' 'console\.' \
  app/screens app/services app/state app/App.tsx app/config.ts \
  packages/core-posting/src functions/src 2>/dev/null \
  | grep -v '\.test\.ts' || true)"
if [ -n "$console_hits" ]; then
  fail "console call(s) found in code that handles tokens:"
  printf '%s\n' "$console_hits" | sed 's/^/    /'
else
  pass "no console calls in token-handling code"
fi

# --clear is not optional: Metro's transform cache will happily hand back a
# bundle built before the .env existed, and this check would pass on it.
echo "3/4  bundling the app (clean, no Metro cache)"
bundle_dir="$(mktemp -d)"
trap 'rm -rf "$bundle_dir"' EXIT
if ! (cd app && npx expo export --clear --platform android --output-dir "$bundle_dir" >/dev/null 2>&1); then
  fail "expo export failed — cannot check the bundle"
  echo
  echo "FAIL — $failures problem(s) above."
  exit 1
fi
pass "bundle built"

echo "4/4  no secret value in the bundle"
checked=0
scan_env_file() {
  local file="$1" scope="$2"
  [ -f "$file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|\#*) continue ;; esac
    local key="${line%%=*}" value="${line#*=}"
    [ -z "$value" ] && continue
    # Everything in the function's env is server-only by definition. In the
    # app's env, anything named like a secret has no business in a bundle.
    if [ "$scope" = "server" ] || printf '%s' "$key" | grep -qiE 'secret|private'; then
      checked=$((checked + 1))
      if grep -rqaF -- "$value" "$bundle_dir"; then
        fail "the value of $key ($file) is in the app bundle"
      fi
    fi
  done < "$file"
}

scan_env_file app/.env app
scan_env_file functions/.dev.vars server

if [ "$checked" -eq 0 ]; then
  note "no local .env / .dev.vars values to compare — run again once they're filled in"
else
  note "compared $checked secret value(s) against the bundle (never printed)"
fi

# Referencing a server-only variable name from the app would be a mistake even
# before it holds a value.
for needle in TIKTOK_CLIENT_SECRET META_APP_SECRET LINKEDIN_CLIENT_SECRET; do
  if grep -rqa "$needle" "$bundle_dir"; then
    fail "bundle references the server-only variable $needle"
  fi
done

if [ "$failures" -eq 0 ]; then
  pass "nothing leaked into the bundle"
  echo
  echo "PASS"
  exit 0
fi

echo
echo "FAIL — $failures problem(s) above."
exit 1
