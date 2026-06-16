/**
 * Soft-void (status=voided) the test user's timeEntries older than N days.
 * Audit logs and segments are preserved per AGENTS.md "no hard delete" rule.
 *
 * Schema note: timeEntries live at top-level as `{userId}_{YYYY-MM-DD}` (not
 * as a subcollection). We filter by `userId` field, then check `workDate` or
 * `date` for the cutoff.
 *
 * Use:
 *   GOOGLE_APPLICATION_CREDENTIALS=~/secrets/timetrack-firebase-sa.json \
 *     node scripts/cleanup-test-data.mjs [--days=7] [--dry-run] [--user=test@test.com]
 *
 * Why: the live test data dir accumulates half-baked test docs from automated
 * runs. They can mask real bugs (the UI says "locked" because of an old doc
 * with the wrong shape) and make the audit logs noisy.
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
const DAYS = parseInt(args.days ?? '7', 10);
const DRY_RUN = 'dry-run' in args;
const EMAIL = args.user ?? 'test@test.com';

const serviceAccount = JSON.parse(readFileSync(resolve(KEY_PATH), 'utf8'));
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const auth = admin.auth();
const db = admin.firestore();

const cutoff = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);
const cutoffId = cutoff.toISOString().slice(0, 10);
console.log(`Cutoff: ${cutoffId} (${DAYS} days back)`);
console.log(`User:   ${EMAIL}`);
console.log(`Mode:   ${DRY_RUN ? 'DRY RUN' : 'LIVE — will soft-void'}`);

async function main() {
  const fbUser = await auth.getUserByEmail(EMAIL);
  const uid = fbUser.uid;
  console.log(`uid:    ${uid}`);

  const coll = db.collection('timeEntries').where('userId', '==', uid);
  const snap = await coll.get();
  console.log(`Found ${snap.size} timeEntries for this user`);

  let voided = 0;
  let skipped = 0;
  for (const doc of snap.docs) {
    const data = doc.data();
    const workDate = (data.workDate ?? data.date ?? '').slice(0, 10);
    if (workDate >= cutoffId) { skipped++; continue; }
    if (data.status === 'voided') { skipped++; continue; }
    console.log(`  void ${doc.id} (workDate=${workDate}, status=${data.status ?? 'active'})`);
    if (!DRY_RUN) {
      await doc.ref.update({
        status: 'voided',
        voidedAt: admin.firestore.FieldValue.serverTimestamp(),
        voidedReason: `cleanup-test-data: older than ${DAYS} days for ${EMAIL}`,
      });
    }
    voided++;
  }

  console.log(`\nResult: voided=${voided}, skipped=${skipped}`);
  if (DRY_RUN && voided > 0) console.log('(dry run — nothing was written)');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
