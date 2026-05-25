/**
 * Pure business-rule tests for punch clock (Phase 1 — Clock Agent)
 * These run in Jest without hitting Firebase / ESM import.meta issues in the base repo.
 * They directly validate the double-punch prevention and lunch state machine that the
 * clockService + ClockPunch UI rely on.
 */

import * as timeValidation from '../../../../utils/timeValidation';
import type { TimeEntry, TimeSegment } from '../../../lib/database';

const openSegment: TimeSegment = {
  id: 's1',
  clockInManual: '08:30',
  clockInSystem: Date.now(),
  complete: false,
};

const closedSegment: TimeSegment = {
  ...openSegment,
  complete: true,
  clockOutManual: '17:05',
  clockOutSystem: Date.now() + 1000 * 60 * 60 * 8,
  workMinutes: 455,
};

const entryWithOpen: TimeEntry = {
  id: 'u_2026-05-25',
  userId: 'u',
  date: '2026-05-25',
  segments: [closedSegment, openSegment],
  complete: false,
} as any;

const entryNoOpen: TimeEntry = {
  id: 'u_2026-05-25',
  userId: 'u',
  date: '2026-05-25',
  segments: [closedSegment],
  complete: true,
} as any;

describe('Punch business rules (double-punch prevention + lunch toggle)', () => {
  it('BLOCKS punch-in when an open segment already exists for the PT day', () => {
    const result = timeValidation.validateCanPunchIn(entryWithOpen);
    expect(result.valid).toBe(false);
    expect(result.message).toMatch(/already have an open shift today/i);
  });

  it('ALLOWS punch-in when the last (or only) segment is complete', () => {
    const result = timeValidation.validateCanPunchIn(entryNoOpen);
    expect(result.valid).toBe(true);
    expect(result.message).toBeUndefined();
  });

  it('BLOCKS punch-out when there is no open segment', () => {
    const result = timeValidation.validateCanPunchOut(entryNoOpen);
    expect(result.valid).toBe(false);
    expect(result.message).toMatch(/No open shift to clock out/i);
  });

  it('ALLOWS punch-out when there is an open segment', () => {
    const result = timeValidation.validateCanPunchOut(entryWithOpen);
    expect(result.valid).toBe(true);
  });

  it('BLOCKS lunch toggle when the employee is not clocked in at all', () => {
    const result = timeValidation.validateCanToggleLunch(null);
    expect(result.valid).toBe(false);
    expect(result.message).toMatch(/must be clocked in/i);
  });

  it('ALLOWS lunch toggle when clocked in (service will decide start vs end)', () => {
    const result = timeValidation.validateCanToggleLunch(entryWithOpen);
    expect(result.valid).toBe(true);
  });

  it('getLunchActionLabel returns the correct next user-facing label', () => {
    expect(timeValidation.getLunchActionLabel(null)).toBe('LUNCH');
    expect(timeValidation.getLunchActionLabel({ id: 's', clockInManual: '09:00' } as any)).toBe('START LUNCH');
    expect(timeValidation.getLunchActionLabel({ id: 's', clockInManual: '09:00', lunchOutManual: '12:15' } as any)).toBe('END LUNCH');
    expect(timeValidation.getLunchActionLabel({ id: 's', clockInManual: '09:00', lunchOutManual: '12:15', lunchInManual: '13:00' } as any)).toBe('LUNCH DONE');
  });
});
