/**
 * Delete the 3 legacy seed test users from live Firebase Auth + their Firestore profiles.
 *
 * Guardrails:
 *   - Hard-deletes Auth users and Firestore profiles. IRREVERSIBLE.
 *   - --confirm is REQUIRED to run. Without it, the script exits immediately.
 *   - --confirm alone = dry-run preview. --confirm --force-prod = actual deletion.
 *   - Only targets TEST_ACCOUNTS allowlist emails.
 *
 * Use:
 *   GOOGLE_APPLICATION_CREDENTIALS=~/secrets/timetrack-firebase-sa.json \
 *     node scripts/delete-test-users.mjs --confirm          # dry-run preview
 *   GOOGLE_APPLICATION_CREDENTIALS=~/secrets/timetrack-firebase-sa.json \
 *     node scripts/delete-test-users.mjs --confirm --force-prod  # actually delete
 */
import process from 'node:process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import admin from 'firebase-admin';

const KEY_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!KEY_PATH) { console.error('Set GOOGLE_APPLICATION_CREDENTIALS'); process.exit(1); }

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => { const [k, v] = a.replace('--', '').split('='); return [k, v ?? 'true']; }),
);
const HAS_CONFIRM = 'confirm' in args;
const FORCE_PROD = 'force-prod' in args;
const DRY_RUN = !FORCE_PROD;

const TEST_ACCOUNTS = ['admin@test.com', 'manager2@test.com', 'employee2@test.com'];

const serviceAccount = JSON.parse(readFileSync(resolve(KEY_PATH), 'utf8'));
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const auth = admin.auth();
const db = admin.firestore();

if (!HAS_CONFIRM) {
  console.error('ERROR: delete-test-users.mjs requires --confirm to proceed.');
  console.error('');
  console.error('  This script HARD-DELETES Auth users and Firestore profiles.');
  console.error('  It is IRREVERSIBLE.');
  console.error('');
  console.error('  Preview (dry run):');
  console.error('    GOOGLE_APPLICATION_CREDENTIALS=~/secrets/timetrack-firebase-sa.json \\');
  console.error('      node scripts/delete-test-users.mjs --confirm');
  console.error('');
  console.error('  Actually delete (requires --force-prod):');
  console.error('    GOOGLE_APPLICATION_CREDENTIALS=~/secrets/timetrack-firebase-sa.json \\');
  console.error('      node scripts/delete-test-users.mjs --confirm --force-prod');
  process.exit(1);
}

if (DRY_RUN) {
  console.log('[dry-run] Would delete the following users:');
  for (const u of TO_DELETE) console.log(`  - ${u.email} (${u.label})`);
  console.log('');
  console.log('[dry-run] Pass --force-prod to actually delete.');
  process.exit(0);
}

const TO_DELETE = [
  { email: 'admin@test.com',     label: 'admin' },
  { email: 'manager2@test.com',  label: 'manager' },
  { email: 'employee2@test.com', label: 'employee' },
];

async function main() {
  for (const u of TO_DELETE) {
    let fbUser;
    try {
      fbUser = await auth.getUserByEmail(u.email);
    } catch (e) {
      if (e.code === 'auth/user-not-found') {
        console.log(`auth: ${u.email} not found, skipping`);
        continue;
      }
      throw e;
    }
    try {
      await db.collection('users').doc(fbUser.uid).delete();
      console.log(`firestore: deleted profile uid=${fbUser.uid} (${u.label})`);
    } catch (e) {
      console.warn(`firestore: profile delete failed for ${u.email}: ${e.message}`);
    }
    try {
      await auth.deleteUser(fbUser.uid);
      console.log(`auth: deleted ${u.email}`);
    } catch (e) {
      console.warn(`auth: delete failed for ${u.email}: ${e.message}`);
    }
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
