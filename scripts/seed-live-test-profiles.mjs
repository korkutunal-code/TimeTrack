/**
 * Live profile bootstrap for the 3 test accounts in atd-time-tracking.
 *
 * Why this exists: the test accounts (admin@test.com, manager2@test.com,
 * employee2@test.com) have Firebase Auth entries but no Firestore users/{uid}
 * document, so login fails with "Account not initialized or access revoked".
 * The seed scripts in scripts/ only run against the emulator.
 *
 * Run:
 *   GOOGLE_APPLICATION_CREDENTIALS=~/secrets/timetrack-firebase-sa.json node scripts/seed-live-test-profiles.mjs
 */
import process from 'node:process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Firebase Admin SDK — needs the service account JSON
import admin from 'firebase-admin';

const KEY_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!KEY_PATH) {
  console.error('Set GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json');
  process.exit(1);
}

const PROJECT_ID = 'atd-time-tracking';
const serviceAccount = JSON.parse(readFileSync(resolve(KEY_PATH), 'utf8'));

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();
const auth = admin.auth();

const USERS = [
  { email: 'admin@test.com', name: 'Test Admin', role: 'admin' },
  { email: 'manager2@test.com', name: 'Test Manager 2', role: 'manager' },
  { email: 'employee2@test.com', name: 'Test Employee 2', role: 'employee' },
];

async function main() {
  for (const u of USERS) {
    console.log(`\n[seed-live] ${u.email} (${u.role})`);
    let fbUser;
    try {
      fbUser = await auth.getUserByEmail(u.email);
      console.log(`  auth: uid=${fbUser.uid}, exists=true`);
    } catch (e) {
      console.error(`  auth: NOT FOUND — ${e.message}`);
      continue;
    }
    const ref = db.collection('users').doc(fbUser.uid);
    const snap = await ref.get();
    if (snap.exists) {
      console.log(`  firestore: profile already exists`);
      continue;
    }
    const profile = {
      uid: fbUser.uid,
      email: u.email,
      name: u.name,
      role: u.role,
      active: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: 'seed-live-test-profiles',
      timezone: 'America/Los_Angeles',
      sms_opt_in: false,
    };
    await ref.set(profile);
    console.log(`  firestore: created profile uid=${fbUser.uid}`);
  }
  console.log('\n[seed-live] done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[seed-live] FAILED:', err);
  process.exit(1);
});
