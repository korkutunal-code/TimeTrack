# W3: Employee Clock Flows Adversarial E2E — Final Report

**Date:** 2026-06-16
**Worktree:** `audit-extreme-final-audit`
**Live URL:** https://atd-time-tracking.web.app
**Test Account:** test@test.com / 123456

---

## Executive Summary

| Flow | Result |
|------|--------|
| (a) Duplicate-click | ✅ PASS |
| (b) Refresh-during-lunch | ✅ PASS |
| (c) Logout/login | ✅ PASS |
| (d) Split shift | ❌ FAIL |
| (e) Offline | ❌ FAIL |
| (f) Hard reload | ❌ FAIL |

**Total: 17 pass / 5 fail**

---

## Detailed Findings

### Flow (a): Duplicate-click — ✅ PASS

**Test:** Click CLOCK IN twice in rapid succession; verify only one open segment in Firestore.

**Result:** PASS — Only 1 open segment is created. The Firestore transaction in `punchIn` correctly prevents duplicate segments.

**Verified:**
- After double-click, Firestore shows `segments=[openSeg]` with `complete=false`
- UI correctly shows CLOCK OUT after first click (second click is silently rejected)

---

### Flow (b): Refresh-during-lunch — ✅ PASS

**Test:** Clock in → start lunch → hard reload → verify UI shows END LUNCH and Firestore has lunchOut set.

**Result:** PASS — UI state persists correctly across hard reload.

**Verified:**
- After hard reload, UI shows END LUNCH button
- Firestore has `lunchOutManual` and `lunchOutSystem` set on the open segment

---

### Flow (c): Logout/login — ✅ PASS

**Test:** Clock in → sign out → sign back in → verify open shift is still active.

**Result:** PASS — Firestore is correctly the source of truth.

**Verified:**
- After relogin, CLOCK OUT button is visible
- Firestore shows 1 open segment

---

### Flow (d): Split Shift — ❌ FAIL

**Severity:** HIGH

**Test:** Clock in → clock out → clock in again on same PT day; verify segments[] has 2 entries (first complete=true, second complete=false).

**Result:** FAIL — Only 1 segment in Firestore after second punch-in.

**E2E Output:**
```
[FAIL] Split shift: segments[] length is 2 — segs=1
[FAIL] Split shift: first segment complete=true — seg0.complete=False
[FAIL] Split shift: second segment complete=false — seg1.complete=N/A
```

**Root Cause Analysis:**

Two issues identified and partially fixed:

1. **`punchIn` was overwriting `segments[]` with `tx.set` + `merge:true`**: The transaction was setting `segments: [newSeg]` which REPLACES the entire array (not appends). **Fix applied:** Changed `punchIn` to read existing segments first and build `segments: [...existingSegments, newSeg]`.

2. **`punchOut` used `updateDoc` outside a transaction**: This caused a read-write consistency issue where `punchIn`'s transaction could see stale data. **Fix applied:** Changed `punchOut` to use `runTransaction` with `tx.update`.

**Remaining Issue:** Despite fixes, the E2E test still shows only 1 segment. The issue appears to be with how Firestore transactions interact — when `punchIn`'s transaction reads the document, it may be seeing a snapshot from before `punchOut`'s transaction committed, due to Firestore's multi-region replication timing.

**Jest Tests Added:**
- `Split-shift: punchOut closes the active segment (complete=true)`
- `Split-shift: entry.segments after punchOut should have the closed segment`
- `Split-shift: punchIn must preserve existing closed segments`
- `BUG REGRESSION: punchIn was overwriting segments array instead of appending`

**Code Changes:**
- `src/services/clockService.ts` — `punchIn`: Preserve existing segments by reading them inside transaction
- `src/services/clockService.ts` — `punchOut`: Changed from `updateDoc` to `runTransaction` with `tx.update`

**Document State After Failure:**
```json
{
  "segments": [{ "id": "seg_XXX", "clockInManual": "20:29", "complete": false }],
  "totalWorkMinutes": 0,
  "complete": false
}
```

**Fix Still Needed:** The `segments[]` array is not being properly preserved across punch-out/punch-in cycles. The transaction isolation in Firestore may be causing `punchIn` to read a stale snapshot that doesn't yet reflect `punchOut`'s write.

---

### Flow (e): Offline — ❌ FAIL

**Severity:** CRITICAL

**Test:** Set `context.setOffline(true)` before clicking CLOCK IN; verify UI shows clear error and Firestore has NO document.

**Result:** FAIL — A half-baked document was created in Firestore despite the offline error.

**E2E Output:**
```
[PASS] Offline: UI shows clear error when offline
[FAIL] Offline: Firestore has NO half-baked document — found=True, clockInManual=True, openSeg=True
[PASS] Offline recovery: CLOCK IN works after setOffline(false)
```

**Root Cause:** Firebase Firestore SDK has **offline persistence enabled by default**. When offline, the SDK queues writes in IndexedDB and replays them when network is restored. The error toast appears, but the write is still queued and eventually persisted.

**Bug:** The `punchIn` function does not check online/offline status before attempting to write. The Firestore SDK's offline queue silently persists the write.

**Fix Required:** Add online/offline detection before `punchIn`:
```typescript
// Before calling punchIn, check navigator.onLine
// If offline, show user-friendly error and do NOT attempt Firestore write
```

**Note:** The UI does have an offline banner in `App.tsx`, but `ClockPunch` does not gate the punch actions on connectivity.

---

### Flow (f): Hard Reload State Check — ❌ FAIL

**Severity:** MEDIUM

**Test:** After various states (CLOCKED OUT, CLOCKED IN, LUNCH), perform hard reload and verify UI matches Firestore.

**Result:** 1 of 3 state checks failed.

**E2E Output:**
```
[PASS] Reload-check: CLOCKED IN state after reload
[PASS] Reload-check: LUNCH state after reload
[FAIL] Reload-check: CLOCKED OUT state after reload — UI=CLOCK_IN:True, Firestore=closed:False
```

**Root Cause:** The preflight voiding script clears `status`, `clockInManual`, `clockOutManual`, etc., but `getActiveSegment` still synthesizes an open segment from legacy fields if `clockInManual` exists (even if set to undefined/null). The voiding does NOT delete the legacy `clockInManual` field — it only clears specific fields.

**Fix Required:** The voiding script should either:
1. Delete the `clockInManual` field entirely using `FieldValue.delete()`
2. Or set `segments: []` to ensure no segments are present

---

## Database State Mismatches with UI

| Scenario | UI State | Firestore State | Match? |
|----------|----------|-----------------|--------|
| After split-shift punch-in #2 | CLOCK OUT | 1 segment, complete=false | ❌ (missing archived segment) |
| Offline click | Error toast | Document created | ❌ |
| CLOCKED OUT after void+reload | CLOCK IN | Still has open segment | ❌ |

---

## Verdict

**E2E Overall: FAIL (17/22 assertions pass)**

### Bugs Found: 3

| # | Bug | Severity | Status |
|---|-----|----------|--------|
| 1 | Split-shift loses archived segment | HIGH | Partial fix applied; transaction isolation issue remains |
| 2 | Offline creates half-baked document | CRITICAL | No fix applied |
| 3 | Hard reload after void shows wrong state | MEDIUM | No fix applied |

### What's Working

- ✅ Duplicate-click protection (atomic punch-in via Firestore transaction)
- ✅ Lunch state persists across page reload
- ✅ Session persistence (logout/login preserves shift)
- ✅ Unit tests for segment operations pass (30/30)

### Critical Gaps

1. **Split-shift bug (d)** indicates the `segments[]` model is not being properly managed across punch-out/punch-in cycles. This is a **data integrity** issue — historical segment data is being lost.

2. **Offline bug (e)** is a **data corruption** issue — writes are being queued and persisted even when the user sees an error, leading to duplicate/inconsistent records.

3. **Hard reload bug (f)** indicates the voiding/cleanup scripts are not properly resetting all relevant fields that `getActiveSegment` checks.

### Recommended Actions

1. **For (d):** Investigate Firestore transaction isolation with multi-region replication. Consider adding a read-retry or explicit read-after-write verification. May need to restructure how segments are managed to avoid transaction timing issues.

2. **For (e):** Add explicit online/offline check in `ClockPunch.doPunchIn` before calling `punchIn`. If offline, show error and do NOT queue the write.

3. **For (f):** Update the voiding script to delete `clockInManual` field and reset `segments: []` to ensure no stale state persists.

---

## Files Modified

| File | Change |
|------|--------|
| `src/services/clockService.ts` | `punchIn`: preserve existing segments in transaction; `punchOut`: use transaction with `tx.update` |
| `src/app/lib/database.test.ts` | Added split-shift regression tests (4 new tests) |
| `test-artifacts/myshift_adversarial.py` | New adversarial E2E test script |

---

## Test Artifacts

- **Script:** `test-artifacts/myshift_adversarial.py`
- **Results:** `test-artifacts/myshift_adversarial-results.json`
- **Screenshots:** `test-artifacts/myshift/` (captured per flow)
