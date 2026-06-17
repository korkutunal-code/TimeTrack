/**
 * Seed a single yesterday timeEntry for employee2@test.com via client-side SDK.
 *
 * Guardrails:
 *   - Restricts to hardcoded test account UID/email only.
 *   - --dry-run to preview (replaces hard delete with soft-void in dry-run mode).
 *
 * Use:
 *   node scripts/seed-yesterday.mjs --dry-run   # preview
 *   node scripts/seed-yesterday.mjs             # actually write
 */
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, setDoc } from 'firebase/firestore';
import { firebaseConfig } from '../src/config/firebase.config.js';

const TEST_ACCOUNTS = ['employee2@test.com'];
const DRY_RUN = process.argv.includes('--dry-run');

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const uid = '5trcLNJvUXSmsfSjK0YpS0b0vxa2'; // employee2@test.com UID
const email = 'employee2@test.com';
const testPassword = 'Test123!';

const yesterday = new Date();
yesterday.setDate(yesterday.getDate() - 1);
const yesterdayStr = yesterday.toISOString().split('T')[0];
const entryId = `${uid}_${yesterdayStr}`;

const todayStr = new Date().toISOString().split('T')[0];
const todayEntryId = `${uid}_${todayStr}`;

if (!TEST_ACCOUNTS.includes(email)) {
  console.error(`ERROR: seed-yesterday.mjs is restricted to ${TEST_ACCOUNTS.join(', ')}`);
  process.exit(1);
}

if (DRY_RUN) {
  console.log('[dry-run] Would seed yesterday entry:');
  console.log(`  uid:       ${uid}`);
  console.log(`  entryId:   ${entryId}`);
  console.log(`  workDate:  ${yesterdayStr}`);
  console.log('[dry-run] Would soft-void today entry:');
  console.log(`  todayEntryId: ${todayEntryId}`);
  process.exit(0);
}

async function main() {
    console.log(`Signing in as ${email}...`);
    await signInWithEmailAndPassword(auth, email, testPassword);

    console.log(`Seeding yesterday's entry for ${uid} at ${yesterdayStr}...`);
    await setDoc(doc(db, 'timeEntries', entryId), {
        userId: uid,
        workDate: yesterdayStr,
        clockInManual: '09:00',
        clockOutManual: '17:00',
        lunchOutManual: '12:00',
        lunchInManual: '13:00',
        lunchMinutes: 60,
        totalWorkMinutes: 420,
        regularMinutes: 420,
        otMinutes: 0,
        doubleTimeMinutes: 0,
        dayComplete: true,
        currentStep: 'complete',
        createdAt: new Date(),
        updatedAt: new Date()
    }, { merge: true });
    console.log('Seeded previous day successfully!');

    console.log(`Voiding today's partial entry for ${uid} at ${todayStr}...`);
    try {
        await setDoc(doc(db, 'timeEntries', todayEntryId), {
            status: 'voided',
            voidedReason: 'seed-yesterday: cleared before seeding',
            updatedAt: new Date()
        }, { merge: true });
        console.log('Voided today\'s entry successfully!');
    } catch (e) {
        console.log('No entry to void today or permission error');
    }

    process.exit(0);
}

main().catch(console.error);
