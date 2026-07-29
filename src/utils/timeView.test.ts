import { explodeDocBySegmentLocalDate, explodeDocsBySegmentLocalDate, type ExplodableDoc } from './timeView';

describe('explodeDocBySegmentLocalDate', () => {
  it('splits a pre-fix cross-midnight doc into one doc per local date (23:32→00:28 bug)', () => {
    const doc = {
      id: 'u1_2026-07-29',
      userId: 'u1',
      date: '2026-07-29',
      workDate: '2026-07-29',
      complete: true,
      totalWorkMinutes: 56,
      // Top-level fields spanning midnight (the corrupted shape):
      clockInManual: '23:32',
      clockOutManual: '00:28',
      currentSegment: { clockInManual: '23:32', clockOutManual: '00:28', complete: true, workMinutes: 56 },
      segments: [
        {
          id: 'seg_d1',
          clockInManual: '23:32',
          clockOutManual: '23:59',
          complete: true,
          workMinutes: 28,
          splitFromMidnight: true,
          localDate: '2026-07-29',
        },
        {
          id: 'seg_d2',
          clockInManual: '00:00',
          clockOutManual: '00:28',
          complete: true,
          workMinutes: 28,
          splitFromMidnight: true,
          localDate: '2026-07-30',
        },
      ],
    };

    const out = explodeDocBySegmentLocalDate(doc);
    expect(out).toHaveLength(2);

    // Day 1: yesterday, its own portion only, synthesized current dropped.
    expect(out[0].workDate).toBe('2026-07-29');
    expect(out[0].id).toBe('u1_2026-07-29');
    expect(out[0].segments).toHaveLength(1);
    expect(out[0].segments?.[0].clockInManual).toBe('23:32');
    expect(out[0].clockOutManual).toBe('23:59');
    expect(out[0].totalWorkMinutes).toBe(28);
    expect(out[0].currentSegment).toBeUndefined();
    expect(out[0].complete).toBe(true);

    // Day 2: today, attributed to 07/30.
    expect(out[1].workDate).toBe('2026-07-30');
    expect(out[1].id).toBe('u1_2026-07-30');
    expect(out[1].segments).toHaveLength(1);
    expect(out[1].segments?.[0].clockInManual).toBe('00:00');
    expect(out[1].clockOutManual).toBe('00:28');
    expect(out[1].totalWorkMinutes).toBe(28);
  });

  it('returns normal single-day docs unchanged (no localDate on segments)', () => {
    const doc = {
      id: 'u1_2026-07-29',
      userId: 'u1',
      date: '2026-07-29',
      segments: [{ id: 's1', clockInManual: '09:00', clockOutManual: '17:00', complete: true, workMinutes: 480 }],
    };
    const out = explodeDocBySegmentLocalDate(doc);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(doc);
  });

  it('returns same-day split-shift docs unchanged (all segments share the doc date)', () => {
    const doc = {
      id: 'u1_2026-07-29',
      userId: 'u1',
      date: '2026-07-29',
      segments: [
        { id: 's1', clockInManual: '08:00', clockOutManual: '12:00', complete: true, workMinutes: 240 },
        { id: 's2', clockInManual: '13:00', clockOutManual: '17:00', complete: true, workMinutes: 240 },
      ],
    };
    expect(explodeDocBySegmentLocalDate(doc)).toHaveLength(1);
  });

  it('returns segment-less docs unchanged', () => {
    const doc = { id: 'u1_2026-07-29', userId: 'u1', date: '2026-07-29', clockInManual: '09:00' };
    expect(explodeDocBySegmentLocalDate(doc)).toHaveLength(1);
  });

  it('explodeDocsBySegmentLocalDate flatMaps a list', () => {
    const docs: ExplodableDoc[] = [
      {
        id: 'u1_2026-07-29', userId: 'u1', date: '2026-07-29',
        segments: [
          { id: 'a', clockInManual: '23:32', clockOutManual: '23:59', complete: true, workMinutes: 28, localDate: '2026-07-29' },
          { id: 'b', clockInManual: '00:00', clockOutManual: '00:28', complete: true, workMinutes: 28, localDate: '2026-07-30' },
        ],
      },
      {
        id: 'u1_2026-07-28', userId: 'u1', date: '2026-07-28',
        segments: [{ id: 'c', clockInManual: '09:00', clockOutManual: '17:00', complete: true, workMinutes: 480 }],
      },
    ];
    const out = explodeDocsBySegmentLocalDate(docs);
    expect(out).toHaveLength(3);
    expect(out.map((d) => d.workDate ?? d.date)).toEqual(['2026-07-29', '2026-07-30', '2026-07-28']);
  });
});
