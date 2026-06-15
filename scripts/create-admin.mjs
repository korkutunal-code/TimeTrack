import { initializeApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, setDoc } from 'firebase/firestore';
import { firebaseConfig } from '../src/config/firebase.config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const args = process.argv.slice(2);
if (args.length !== 3) {
    console.log('Usage: node scripts/create-admin.mjs <Email> <Password> <"First Last">');
    console.log('Example: node scripts/create-admin.mjs admin@mycompany.com MySecurePass123! "Jane Doe"');
    process.exit(1);
}

const [email, password, name] = args;

async function main() {
    console.log(`Creating Admin account for: ${email}...`);
    try {
        // 1. Create Auth User
        let uid;
        try {
            const userCred = await createUserWithEmailAndPassword(auth, email, password);
            uid = userCred.user.uid;
        } catch (e) {
            if (e.code === 'auth/email-already-in-use') {
                console.log('Account already exists in Auth, signing in to force Admin role...');
                const { signInWithEmailAndPassword } = await import('firebase/auth');
                const userCred = await signInWithEmailAndPassword(auth, email, password);
                uid = userCred.user.uid;
            } else {
                throw e;
            }
        }

        // 2. Create Firestore Profile with 'admin' role
        await setDoc(doc(db, 'users', uid), {
            email: email,
            name: name,
            role: 'admin',
            active: true,
            createdAt: new Date(),
            updatedAt: new Date()
        });

        console.log('');
        console.log('✅ Success! Admin account created.');
        console.log(`UID: ${uid}`);
        console.log('You can now log into https://atd-time-tracking.web.app with these credentials.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error creating admin:', error.message);
        process.exit(1);
    }
}

main();
