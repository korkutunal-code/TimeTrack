import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, doc, deleteDoc, getDocs, query, where } from 'firebase/firestore';

const firebaseConfig = {
    apiKey: "AIzaSyC_6fkVeub7ZJp4yzSAIp6yZEsrhRk5lQI",
    authDomain: "atd-time-tracking.firebaseapp.com",
    projectId: "atd-time-tracking",
    storageBucket: "atd-time-tracking.firebasestorage.app",
    messagingSenderId: "115771623376",
    appId: "1:115771623376:web:214008a8dfa2007f731bd5"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const TARGET_EMAIL = 'admin@test.com'; // Using admin to wipe
const TARGET_PASS = 'Test123!';

async function cleanupData() {
    console.log(`Authenticating as Admin...`);
    let cred;
    try {
        cred = await signInWithEmailAndPassword(auth, TARGET_EMAIL, TARGET_PASS);
    } catch (err: any) {
        console.error('Authentication failed:', err.message);
        return;
    }
    console.log(`Authenticated successfuly as: \${cred.user.uid}`);

    // Since users can't delete other users' entries, we should either login as employee2 
    // or use firebase-admin. Since we fallback to client SDK, we'll login as employee2 for deletion,
    // or if the rules allow admins to delete, we will. Wait, Firestore rules say:
    // allow delete: if isAdmin();
    // This script will use admin@test.com which has admin role.

    const BATCH_ID = 'seed_v1_month_mix';
    console.log(`Searching for entries with seededBatchId='\${BATCH_ID}'...`);

    const q = query(
        collection(db, 'timeEntries'),
        where('seededBatchId', '==', BATCH_ID)
    );

    const snap = await getDocs(q);
    console.log(`Found \${snap.size} seeded entries.`);

    let deletedCount = 0;
    for (const d of snap.docs) {
        // Double check it's definitely seeded
        const data = d.data();
        if (data.seeded === true && data.seededBatchId === BATCH_ID) {
            await deleteDoc(d.ref);
            deletedCount++;
        }
    }

    console.log(`Successfully deleted \${deletedCount} seeded entries.`);
}

cleanupData().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
