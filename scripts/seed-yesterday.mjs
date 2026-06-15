import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { firebaseConfig } from '../src/config/firebase.config.js';

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

    console.log(`Deleting today's partial entry for ${uid} at ${todayStr}...`);
    try {
        await deleteDoc(doc(db, 'timeEntries', todayEntryId));
        console.log('Deleted today\'s entry successfully!');
    } catch (e) {
        console.log('No entry to delete today or permission error');
    }

    process.exit(0);
}

main().catch(console.error);
