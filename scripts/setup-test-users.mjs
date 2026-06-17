/**
 * Create 2 legacy test users via client-side Firebase SDK.
 *
 * Guardrails:
 *   - Restricts to hardcoded test account emails only.
 *   - --dry-run to preview.
 *
 * Use:
 *   node scripts/setup-test-users.mjs --dry-run  # preview
 *   node scripts/setup-test-users.mjs             # actually create
 */
import { initializeApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, setDoc } from 'firebase/firestore';

// Reuse the existing config (keeps the same Firebase project)
import { firebaseConfig } from '../src/config/firebase.config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const testPassword = 'Test123!';
const TEST_ACCOUNTS = ['employee2@test.com', 'manager2@test.com'];
const DRY_RUN = process.argv.includes('--dry-run');

if (DRY_RUN) {
  console.log('[dry-run] Would create users:');
  for (const u of TEST_ACCOUNTS) console.log(`  ${u}`);
}

const usersToCreate = [
    { email: 'employee2@test.com', name: 'Test Employee 2', role: 'employee' },
    { email: 'manager2@test.com', name: 'Test Manager 2', role: 'manager' },
];

async function main() {
    for (const u of usersToCreate) {
        if (!TEST_ACCOUNTS.includes(u.email)) {
            console.error(`ERROR: setup-test-users.mjs only handles test accounts. Got: ${u.email}`);
            process.exit(1);
        }
        if (DRY_RUN) { console.log(`[dry-run] Would create: ${u.email}`); continue; }
        try {
            console.log(`Creating user ${u.email}...`);
            const cred = await createUserWithEmailAndPassword(auth, u.email, testPassword);
            const uid = cred.user.uid;
            console.log(`User created in Auth with UID: ${uid}. Setting Firestore doc...`);
            await setDoc(doc(db, 'users', uid), {
                uid,
                email: u.email,
                name: u.name,
                role: u.role,
                active: true,
                updatedAt: new Date()
            });
            console.log(`Firestore doc created for ${u.email}.`);
        } catch (e) {
            if (e.code === 'auth/email-already-in-use') {
                const { signInWithEmailAndPassword } = await import('firebase/auth');
                console.log(`User ${u.email} already exists. Signing in to get UID...`);
                try {
                    const cred = await signInWithEmailAndPassword(auth, u.email, testPassword);
                    const uid = cred.user.uid;
                    await setDoc(doc(db, 'users', uid), {
                        uid,
                        email: u.email,
                        name: u.name,
                        role: u.role,
                        active: true,
                        updatedAt: new Date()
                    });
                    console.log(`Firestore doc created for existing user ${u.email}.`);
                } catch (signinError) {
                    console.error(`Failed to sign in as existing user ${u.email}:`, signinError);
                }
            } else {
                console.error(`Failed to create ${u.email}:`, e);
            }
        }
    }
    console.log('All done!');
    process.exit(0);
}

main();
