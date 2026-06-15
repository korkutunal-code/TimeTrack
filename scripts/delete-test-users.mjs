/**
 * Delete the 3 legacy seed test users from live Firebase Auth + their Firestore profiles.
 * Use:
 *   GOOGLE_APPLICATION_CREDENTIALS=~/secrets/timetrack-firebase-sa.json \
 *     node scripts/delete-test-users.mjs
 */
import process from 'node:process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import admin from 'firebase-admin';

const KEY_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!KEY_PATH) { console.error('Set GOOGLE_APPLICATION_CREDENTIALS'); process.exit(1); }

const serviceAccount = JSON.parse(readFileSync(resolve(KEY_PATH), 'utf8'));
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const auth = admin.auth();
const db = admin.firestore();

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
