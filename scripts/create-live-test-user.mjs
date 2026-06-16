/**
 * Create a live Firebase Auth + Firestore user with a given role.
 * The script is idempotent: re-running is safe.
 *
 * Use:
 *   GOOGLE_APPLICATION_CREDENTIALS=~/secrets/timetrack-firebase-sa.json \
 *     node scripts/create-live-test-user.mjs [--role=admin] [--email=admin@test.com] [--password=123456]
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
const EMAIL = args.email ?? 'test@test.com';
const PASSWORD = args.password ?? '123456';
const ROLE = args.role ?? 'employee';
const NAME = args.name ?? `Test ${ROLE[0].toUpperCase() + ROLE.slice(1)}`;

if (!['employee', 'manager', 'admin'].includes(ROLE)) {
  console.error(`Invalid --role=${ROLE} (must be employee|manager|admin)`);
  process.exit(1);
}

const serviceAccount = JSON.parse(readFileSync(resolve(KEY_PATH), 'utf8'));
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const auth = admin.auth();
const db = admin.firestore();

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
    const prev = snap.data();
    if (prev.role !== ROLE) {
      console.log(`firestore: role mismatch (existing=${prev.role}, requested=${ROLE}) — updating`);
      await ref.update({ role: ROLE, name: NAME, active: true });
    } else {
      console.log(`firestore: profile already exists role=${prev.role}`);
    }
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
  console.log(`\nLogin: ${EMAIL} / ${PASSWORD}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
