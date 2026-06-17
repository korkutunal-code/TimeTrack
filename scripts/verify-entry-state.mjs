#!/usr/bin/env node
/**
 * scripts/verify-entry-state.mjs
 *
 * Read-only verification script for timeEntries documents.
 * Used in audit W6 (Cross-Cutting Edge Cases) to verify document state
 * after E2E flows without mutating data.
 *
 * Usage:
 *   node scripts/verify-entry-state.mjs --email=test@test.com --date=2026-06-16
 *   node scripts/verify-entry-state.mjs --email=test@test.com --date=2026-06-16 --dry-run  # default
 *
 * Exit codes:
 *   0 - document retrieved successfully (or not found)
 *   1 - error (missing args, Firestore error, non-test account without --force)
 */

import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Load config - try worktree path first, then project root
const configPaths = [
  join(__dirname, '..', 'config', 'firebase.config.js'),
  join(__dirname, '..', '..', 'config', 'firebase.config.js'),
];

let firebaseConfig;
for (const p of configPaths) {
  try {
    firebaseConfig = require(p);
    break;
  } catch {}
}

if (!firebaseConfig) {
  console.error('ERROR: Could not find firebase.config.js');
  process.exit(1);
}

// ALLOWLIST guard — only test accounts
const ALLOWED_EMAILS = ['test@test.com', 'admin@test.com', 'manager-audit@test.com'];
const ALLOWED_DOMAINS = ['@test.com']; // backup if specific email not in allowlist

function isAllowedEmail(email) {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return ALLOWED_EMAILS.includes(normalized) ||
         ALLOWED_DOMAINS.some(d => normalized.endsWith(d));
}

// Parse args
const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  acc[key] = value === undefined ? true : value;
  return acc;
}, {});

const email = args.email;
const date = args.date || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' })
  .format(new Date());
const dryRun = args['dry-run'] !== false; // default true
const verbose = args.verbose || args.v;

if (!email) {
  console.error('ERROR: --email is required');
  console.error('Usage: node scripts/verify-entry-state.mjs --email=test@test.com [--date=2026-06-16] [--dry-run] [--verbose]');
  process.exit(1);
}

// Allowlist guard
if (!isAllowedEmail(email)) {
  console.error(`ERROR: Email "${email}" is not in the allowlist.`);
  console.error(`Allowed: ${ALLOWED_EMAILS.join(', ')}`);
  console.error(`Or domains: ${ALLOWED_DOMAINS.join(', ')}`);
  console.error('Use --force to override (not recommended for production accounts).');
  process.exit(1);
}

if (verbose) {
  console.error(`[verify-entry-state] email=${email} date=${date} dryRun=${dryRun}`);
}

if (dryRun) {
  console.log(`[DRY RUN] Would fetch timeEntries document for ${email} on ${date}`);
}

// Initialize Firebase
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Compute entryId from email and date
// This mirrors the client-side logic: uid_date
async function getUidForEmail(email) {
  const { signInWithEmailAndPassword } = await import('firebase/auth');
  // Use a service account approach for server-side read
  // For simplicity, we use the REST API via the Admin SDK or a simple query
  // Since this is a read-only script, we'll use the web SDK with a cached auth
  // For production scripts, use firebase-admin SDK instead
  // This script uses the web SDK for simplicity in the worktree context
  return null; // Caller must provide uid, or we derive from email via a lookup
}

// Actually, we need the UID to compute the document ID. Since this is a read-only
// verification script for audit purposes, we require the caller to know the UID.
// The document ID format is `${userId}_${date}`.
//
// For audit purposes, let's provide the document path pattern and let the caller
// derive the full path from the Firestore console or a prior output.

async function verifyEntryState() {
  // First, look up the user by email to get their uid
  const { collection, query, where, limit, getDocs } = await import('firebase/firestore');

  try {
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('email', '==', email.toLowerCase().trim()), limit(1));
    const userSnap = await getDocs(q);

    if (userSnap.empty) {
      console.log(`User not found: ${email}`);
      if (!dryRun) {
        console.log('ERROR: User not found in Firestore');
        process.exit(1);
      }
      return;
    }

    const uid = userSnap.docs[0].id;

    if (verbose) {
      console.error(`[verify-entry-state] uid=${uid} for ${email}`);
    }

    const entryId = `${uid}_${date}`;
    const entryRef = doc(db, 'timeEntries', entryId);

    if (dryRun) {
      console.log(`[DRY RUN] Would fetch: timeEntries/${entryId}`);
      return;
    }

    const entrySnap = await getDoc(entryRef);

    if (!entrySnap.exists()) {
      console.log(JSON.stringify({
        found: false,
        entryId,
        email,
        date,
        message: 'No timeEntry document found for this email and date',
      }, null, 2));
      return;
    }

    const data = entrySnap.data();

    // Hydrate the document similar to how mapEntry does it
    // For audit purposes, we just print the raw document
    console.log(JSON.stringify({
      found: true,
      entryId,
      email,
      date,
      uid,
      documentPath: `timeEntries/${entryId}`,
      raw: data,
      segments: data.segments || [],
      legacyFields: {
        clockInManual: data.clockInManual,
        clockOutManual: data.clockOutManual,
        lunchOutManual: data.lunchOutManual,
        lunchInManual: data.lunchInManual,
        complete: data.dayComplete || data.complete,
        status: data.status,
        totalWorkMinutes: data.totalWorkMinutes,
      },
      // Synthesized view
      synthesized: {
        hasOpenSegment: !data.clockOutManual && !data.dayComplete,
        currentSegment: data.clockInManual ? {
          clockInManual: data.clockInManual,
          clockInSystemTime: data.clockInSystemTime,
          lunchOutManual: data.lunchOutManual,
          lunchInManual: data.lunchInManual,
          clockOutManual: data.clockOutManual,
          complete: !!data.clockOutManual || data.dayComplete,
        } : null,
      },
    }, null, 2));

  } catch (error) {
    console.error('ERROR fetching document:', error.message);
    process.exit(1);
  }
}

verifyEntryState();
