/**
 * Workout Suite — Plot Time Span Utilities Test Suite
 *
 * Validates:
 * - Deterministic ISO date cutoff computation for 'all', 'year', '3months', 'month', 'week'
 * - Generic time-series point filtering across calendar and boundary dates
 * - Monday-bucketed weekly bar filtering with Sunday-inclusive overlap checks
 * - Verification of user-facing labels ('All data', 'Year', '3 months', 'Month', 'Week')
 */

import {
  getTimeSpanCutoffDate,
  filterDataByTimeSpan,
  filterWeeklyBarsByTimeSpan,
  TIME_SPAN_OPTIONS,
  PlotTimeSpan,
} from '../timeSpanUtils';

describe('Plot Time Span Utilities Suite', () => {
  const refDate = new Date('2026-10-16T12:00:00Z');

  describe('1. TIME_SPAN_OPTIONS Specifications', () => {
    test('contains exactly the 5 requested time span options with exact labels', () => {
      const expected: { key: PlotTimeSpan; label: string }[] = [
        { key: 'all', label: 'All data' },
        { key: 'year', label: 'Year' },
        { key: '3months', label: '3 months' },
        { key: 'month', label: 'Month' },
        { key: 'week', label: 'Week' },
      ];

      expect(TIME_SPAN_OPTIONS).toEqual(expected);
    });
  });

  describe('2. getTimeSpanCutoffDate Calculation', () => {
    test('returns null for "all" (unbounded historical window)', () => {
      expect(getTimeSpanCutoffDate('all', refDate)).toBeNull();
    });

    test('calculates 7-day cutoff for "week"', () => {
      // 2026-10-16 - 7 days = 2026-10-09
      expect(getTimeSpanCutoffDate('week', refDate)).toBe('2026-10-09');
    });

    test('calculates 30-day cutoff for "month"', () => {
      // 2026-10-16 - 30 days = 2026-09-16
      expect(getTimeSpanCutoffDate('month', refDate)).toBe('2026-09-16');
    });

    test('calculates 90-day cutoff for "3months"', () => {
      // 2026-10-16 - 90 days = 2026-07-18
      expect(getTimeSpanCutoffDate('3months', refDate)).toBe('2026-07-18');
    });

    test('calculates 365-day cutoff for "year"', () => {
      // 2026-10-16 - 365 days = 2025-10-16
      expect(getTimeSpanCutoffDate('year', refDate)).toBe('2025-10-16');
    });

    test('handles year boundaries and leap day transitions correctly', () => {
      const newYearRef = new Date('2026-01-05T00:00:00Z');
      // 7 days prior crosses into previous year
      expect(getTimeSpanCutoffDate('week', newYearRef)).toBe('2025-12-29');

      const marchRef = new Date('2024-03-05T00:00:00Z'); // 2024 is a leap year (Feb 29)
      // 30 days prior crosses through leap Feb
      expect(getTimeSpanCutoffDate('month', marchRef)).toBe('2024-02-04');
    });
  });

  describe('3. filterDataByTimeSpan Point Filtering', () => {
    const dataPoints = [
      { date: '2025-06-01', value: 90 }, // > 1 year ago
      { date: '2025-11-01', value: 95 }, // ~11 months ago (in year)
      { date: '2026-08-01', value: 100 }, // ~2.5 months ago (in 3months & year)
      { date: '2026-10-01', value: 105 }, // 15 days ago (in month, 3months, year)
      { date: '2026-10-12', value: 110 }, // 4 days ago (in week, month, 3months, year)
      { date: '2026-10-16', value: 112.5 }, // today (in all)
    ];

    test('returns all points unchanged when time span is "all"', () => {
      const res = filterDataByTimeSpan(dataPoints, 'all', refDate);
      expect(res).toHaveLength(6);
      expect(res).toEqual(dataPoints);
    });

    test('filters points strictly within last 365 days for "year"', () => {
      const res = filterDataByTimeSpan(dataPoints, 'year', refDate);
      expect(res).toHaveLength(5);
      expect(res.map((p) => p.date)).toEqual([
        '2025-11-01',
        '2026-08-01',
        '2026-10-01',
        '2026-10-12',
        '2026-10-16',
      ]);
    });

    test('filters points strictly within last 90 days for "3months"', () => {
      const res = filterDataByTimeSpan(dataPoints, '3months', refDate);
      expect(res).toHaveLength(4);
      expect(res.map((p) => p.date)).toEqual([
        '2026-08-01',
        '2026-10-01',
        '2026-10-12',
        '2026-10-16',
      ]);
    });

    test('filters points strictly within last 30 days for "month"', () => {
      const res = filterDataByTimeSpan(dataPoints, 'month', refDate);
      expect(res).toHaveLength(3);
      expect(res.map((p) => p.date)).toEqual([
        '2026-10-01',
        '2026-10-12',
        '2026-10-16',
      ]);
    });

    test('filters points strictly within last 7 days for "week"', () => {
      const res = filterDataByTimeSpan(dataPoints, 'week', refDate);
      expect(res).toHaveLength(2);
      expect(res.map((p) => p.date)).toEqual([
        '2026-10-12',
        '2026-10-16',
      ]);
    });

    test('returns empty array when no data points meet the cutoff', () => {
      const oldOnly = [
        { date: '2026-01-01', value: 50 },
        { date: '2026-02-01', value: 55 },
      ];
      expect(filterDataByTimeSpan(oldOnly, 'week', refDate)).toHaveLength(0);
      expect(filterDataByTimeSpan(oldOnly, 'month', refDate)).toHaveLength(0);
      expect(filterDataByTimeSpan([], 'week', refDate)).toHaveLength(0);
    });
  });

  describe('4. filterWeeklyBarsByTimeSpan Weekly Bar Filtering', () => {
    // Reference date: 2026-10-16 (Friday)
    // Week cutoffs:
    // week (7d) -> 2026-10-09
    // month (30d) -> 2026-09-16
    const bars = [
      { date: '2026-08-31', value: 12000 }, // Mon Aug 31 -> Sun Sep 06 (Sunday < Sep 16)
      { date: '2026-09-14', value: 14500 }, // Mon Sep 14 -> Sun Sep 20 (Sunday Sep 20 >= Sep 16)
      { date: '2026-09-28', value: 15200 }, // Mon Sep 28 -> Sun Oct 04 (Sunday Oct 04 < Oct 09)
      { date: '2026-10-05', value: 16000 }, // Mon Oct 05 -> Sun Oct 11 (Sunday Oct 11 >= Oct 09)
      { date: '2026-10-12', value: 16800 }, // Mon Oct 12 -> Sun Oct 18 (Sunday Oct 18 >= Oct 09)
    ];

    test('returns all weekly bars unchanged for "all"', () => {
      const res = filterWeeklyBarsByTimeSpan(bars, 'all', refDate);
      expect(res).toHaveLength(5);
    });

    test('includes weeks overlapping the 7-day cutoff for "week"', () => {
      const res = filterWeeklyBarsByTimeSpan(bars, 'week', refDate);
      // Week of Oct 05 ends Oct 11 >= Oct 09 (included)
      // Week of Oct 12 ends Oct 18 >= Oct 09 (included)
      expect(res).toHaveLength(2);
      expect(res.map((b) => b.date)).toEqual(['2026-10-05', '2026-10-12']);
    });

    test('includes weeks overlapping the 30-day cutoff for "month"', () => {
      const res = filterWeeklyBarsByTimeSpan(bars, 'month', refDate);
      // Sep 14 ends Sep 20 >= Sep 16 (included)
      // Sep 28 ends Oct 04 >= Sep 16 (included)
      // Oct 05 ends Oct 11 >= Sep 16 (included)
      // Oct 12 ends Oct 18 >= Sep 16 (included)
      expect(res).toHaveLength(4);
      expect(res.map((b) => b.date)).toEqual([
        '2026-09-14',
        '2026-09-28',
        '2026-10-05',
        '2026-10-12',
      ]);
    });
  });
});
