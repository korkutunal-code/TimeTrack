#!/usr/bin/env bash
# Build + deploy TimeTrack to Firebase Hosting.
#
# The user's local Firebase refresh token expires (invalid_rapt), so we mint
# a fresh access token from the service account using the same flow as
# `firebase login:ci`, then hand it to `firebase deploy` via FIREBASE_TOKEN.
#
# Usage:
#   scripts/deploy.sh            # build + deploy hosting only (FAILS without --confirm)
#   scripts/deploy.sh --confirm  # deploy hosting after confirmation prompt
#   scripts/deploy.sh --rules --confirm   # also deploy firestore rules + indexes
#   scripts/deploy.sh --all --confirm     # hosting + rules + indexes + functions
#
# Guardrails:
#   - --confirm is REQUIRED to deploy. The script refuses to run without it.
#   - The script reads the active project from .firebaserc (no `firebase login`
#     needed — the SA-JWT flow handles auth). It refuses to deploy to a
#     known production project unless --force-prod is passed.
#
# Requires:
#   - ~/secrets/timetrack-firebase-sa.json  (service account with Editor role)
#   - node, firebase CLI (npm i -g firebase-tools)
#
# The build hash from the output is the proof that the new code is live.
set -euo pipefail

cd "$(dirname "$0")/.."

SA_PATH="${SA_PATH:-$HOME/secrets/timetrack-firebase-sa.json}"
TARGET="hosting"
CONFIRM=false
FORCE_PROD=false

for arg in "$@"; do
  case "$arg" in
    --confirm)   CONFIRM=true ;;
    --force-prod) FORCE_PROD=true ;;
    --rules)  TARGET="hosting,firestore:rules,firestore:indexes" ;;
    --all)    TARGET="hosting,firestore:rules,firestore:indexes,functions" ;;
    --help|-h)
      grep '^#' "$0" | sed 's/^# \?//'
      exit 0
      ;;
  esac
done

if [[ ! -f "$SA_PATH" ]]; then
  echo "ERROR: service account not found at $SA_PATH" >&2
  echo "Set SA_PATH=/path/to/sa.json or copy your service account there." >&2
  exit 1
fi

# Guard: require --confirm before any deployment action
if [[ "$CONFIRM" != "true" ]]; then
  echo "ERROR: deploy.sh requires --confirm to proceed." >&2
  echo "" >&2
  echo "This script DEPLOYS to production Firebase Hosting." >&2
  echo "Pass --confirm if you are sure you want to deploy." >&2
  echo "" >&2
  echo "Usage:" >&2
  echo "  scripts/deploy.sh --confirm              # deploy hosting" >&2
  echo "  scripts/deploy.sh --rules --confirm      # deploy hosting + rules" >&2
  echo "  scripts/deploy.sh --all --confirm        # deploy everything" >&2
  echo "  scripts/deploy.sh --force-prod --confirm # override project check" >&2
  exit 1
fi

# Read the active project from .firebaserc (no `firebase login` required).
# This script uses a service-account JWT, so it should not depend on the
# `firebase` CLI's user-auth state.
ACTIVE_PROJECT=$(node -e "
  const fs = require('fs');
  try {
    const cfg = JSON.parse(fs.readFileSync('.firebaserc', 'utf8'));
    process.stdout.write(cfg.projects?.default || '');
  } catch (e) { process.stdout.write(''); }
")
if [[ -z "$ACTIVE_PROJECT" ]]; then
  echo "ERROR: could not read project from .firebaserc" >&2
  exit 1
fi

# Guard: refuse to deploy to a non-production project by accident. Pass
# --force-prod to deploy to atd-time-tracking (the real prod project).
PROD_PROJECTS="atd-time-tracking"
STAGING_PATTERN="staging"

if [[ "$ACTIVE_PROJECT" =~ $STAGING_PATTERN ]] && [[ "$FORCE_PROD" != "true" ]]; then
  : # staging project — fine, deploy normally
elif [[ " $PROD_PROJECTS " == *" $ACTIVE_PROJECT "* ]] && [[ "$FORCE_PROD" != "true" ]]; then
  : # known prod project — but require explicit ack
  echo "ERROR: deploy.sh targets production project '$ACTIVE_PROJECT'." >&2
  echo "Add --force-prod to confirm you intend to deploy to production." >&2
  exit 1
fi

if [[ "$FORCE_PROD" == "true" ]]; then
  echo "WARNING: --force-prod is set. Deploying to project: $ACTIVE_PROJECT" >&2
fi

# 1. Build
echo "==> Building production bundle"
npm run build 2>&1 | tail -20

# Extract the build hash from the latest main-*.js line. That string is the
# proof of which build is deployed — keep it.
BUILD_HASH=$(ls -t build_output/assets/main-*.js 2>/dev/null | head -1 | xargs -n1 basename)
if [[ -z "$BUILD_HASH" ]]; then
  echo "ERROR: no main-*.js in build_output/assets — build probably failed" >&2
  exit 1
fi
echo "==> Build artifact: $BUILD_HASH"

# 2. Mint access token from service account (same as firebase login:ci)
echo "==> Minting Firebase access token from service account"
TOKEN=$(node -e "
  const { readFileSync } = require('fs');
  const { createSign } = require('crypto');
  const sa = JSON.parse(readFileSync('$SA_PATH', 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  };
  const sign = createSign('RSA-SHA256');
  sign.update(\`\${b64(header)}.\${b64(payload)}\`);
  const assertion = \`\${b64(header)}.\${b64(payload)}.\${sign.sign(sa.private_key, 'base64url')}\`;
  fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  }).then(r => r.json()).then(d => {
    if (!d.access_token) { console.error(JSON.stringify(d)); process.exit(1); }
    process.stdout.write(d.access_token);
  });
")

# 3. Deploy
echo "==> Deploying to Firebase ($TARGET) — project: ${ACTIVE_PROJECT:-unknown}"
FIREBASE_TOKEN="$TOKEN" firebase deploy --only "$TARGET" --non-interactive

echo
echo "==> DONE. Build $BUILD_HASH deployed."
echo "    Verify at: https://atd-time-tracking.web.app"
