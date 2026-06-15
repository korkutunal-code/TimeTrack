/**
 * Create test@test.com as a live Firebase Auth + Firestore user (employee).
 * Use:
 *   GOOGLE_APPLICATION_CREDENTIALS=~/secrets/timetrack-firebase-sa.json \
 *     node scripts/create-live-test-user.mjs
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

const EMAIL = 'test@test.com';
const PASSWORD = '123456';
const NAME = 'Test User';
const ROLE = 'employee';

async function main() {
  let fbUser;
  try {
    fbUser = await auth.getUserByEmail(EMAIL);
    console.log(`auth: already exists uid=${fbUser.uid}`);
  } catch (e) {
    if (e.code === 'auth/user-not-found') {
      fbUser = await auth.createUser({ email: EMAIL, password: PASSWORD, displayName: NAME });
      console.log(`auth: created uid=${fbUser.uid}`);
    } else throw e;
  }
  const ref = db.collection('users').doc(fbUser.uid);
  const snap = await ref.get();
  if (snap.exists) {
    console.log(`firestore: profile already exists`);
  } else {
    await ref.set({
      uid: fbUser.uid,
      email: EMAIL,
      name: NAME,
      role: ROLE,
      active: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: 'create-live-test-user',
      timezone: 'America/Los_Angeles',
      sms_opt_in: false,
    });
    console.log(`firestore: created profile uid=${fbUser.uid} role=${ROLE}`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
