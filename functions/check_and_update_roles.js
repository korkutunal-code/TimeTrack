const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'atd-time-tracking' });
const db = admin.firestore();

async function run() {
  const snapshot = await db.collection('users').get();

  for (const doc of snapshot.docs) {
    const data = doc.data();
    console.log(`Found firestore user: ${data.email} | Role: ${data.role} | UID: ${doc.id}`);

    // Auto-fix role
    let targetRole = '';
    if (data.email === 'employee2@test.com') targetRole = 'employee';
    if (data.email === 'manager2@test.com') targetRole = 'manager';
    if (data.email === 'admin@test.com') targetRole = 'admin';

    if (targetRole && data.role !== targetRole) {
      console.log(`Updating ${data.email} from ${data.role} to ${targetRole}...`);
      await doc.ref.update({ role: targetRole });
      console.log(`Update complete for ${data.email}`);
    }
  }
}
run();
