import * as admin from 'firebase-admin';
admin.initializeApp();
const db = admin.firestore();
async function run() {
  const snapshot = await db.collection('users').get();
  snapshot.forEach(doc => {
    const data = doc.data();
    console.log(`User: ${data.email} | Role: ${data.role} | Active: ${data.active}`);
  });
}
run();
