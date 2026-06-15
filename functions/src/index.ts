import * as admin from 'firebase-admin';

// Initialize Firebase Admin globally once
if (!admin.apps.length) {
    admin.initializeApp();
}

export * from './reminders';
// We export the entire file so Cloud Functions router picks up `processReminders`
