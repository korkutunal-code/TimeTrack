#!/usr/bin/env bash
# Build + deploy TimeTrack to Firebase Hosting.
#
# The user's local Firebase refresh token expires (invalid_rapt), so we mint
# a fresh access token from the service account using the same flow as
# `firebase login:ci`, then hand it to `firebase deploy` via FIREBASE_TOKEN.
#
# Usage:
#   scripts/deploy.sh            # build + deploy hosting only
#   scripts/deploy.sh --rules    # also deploy firestore rules + indexes
#   scripts/deploy.sh --all      # hosting + rules + indexes + functions
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

for arg in "$@"; do
  case "$arg" in
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
echo "==> Deploying to Firebase ($TARGET)"
FIREBASE_TOKEN="$TOKEN" firebase deploy --only "$TARGET" --non-interactive

echo
echo "==> DONE. Build $BUILD_HASH deployed."
echo "    Verify at: https://atd-time-tracking.web.app"
