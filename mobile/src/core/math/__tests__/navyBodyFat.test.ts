import {
  calculateNavyBodyDensity,
  calculateNavyBodyFat,
  calculate7DaySMA,
  calculate7DayEMA,
  calculateBodyweightRollingAverages,
  parseIsoDateToMs,
  BodyweightEntry,
} from '../navyBodyFat';

describe('navyBodyFat core math module', () => {
  describe('parseIsoDateToMs', () => {
    it('parses YYYY-MM-DD correctly into UTC midnight timestamp', () => {
      const ms = parseIsoDateToMs('2026-10-15');
      const date = new Date(ms);
      expect(date.getUTCFullYear()).toBe(2026);
      expect(date.getUTCMonth()).toBe(9); // 0-indexed October
      expect(date.getUTCDate()).toBe(15);
      expect(date.getUTCHours()).toBe(0);
    });

    it('returns NaN for malformed date strings', () => {
      expect(isNaN(parseIsoDateToMs('invalid-date'))).toBe(true);
      expect(isNaN(parseIsoDateToMs(''))).toBe(true);
    });
  });

  describe('calculateNavyBodyFat & calculateNavyBodyDensity for Men', () => {
    it('computes expected body fat for a standard male lifter', () => {
      // 178 cm, 82 cm waist, 38 cm neck -> ~14.0%
      const bf = calculateNavyBodyFat({
        gender: 'male',
        heightCm: 178,
        waistCm: 82,
        neckCm: 38,
      });

      expect(bf).toBe(14.0);

      const density = calculateNavyBodyDensity({
        gender: 'male',
        heightCm: 178,
        waistCm: 82,
        neckCm: 38,
      });
      expect(density).not.toBeNull();
      expect(density!).toBeGreaterThan(1.05);
      expect(density!).toBeLessThan(1.08);
    });

    it('computes expected body fat for a lean athletic male', () => {
      // 185 cm, 76 cm waist, 41 cm neck -> ~4.9%
      const bf = calculateNavyBodyFat({
        gender: 'male',
        heightCm: 185,
        waistCm: 76,
        neckCm: 41,
      });

      expect(bf).toBe(4.9);
    });

    it('returns null if waist <= neck for a male', () => {
      expect(
        calculateNavyBodyFat({
          gender: 'male',
          heightCm: 180,
          waistCm: 40,
          neckCm: 40,
        })
      ).toBeNull();

      expect(
        calculateNavyBodyFat({
          gender: 'male',
          heightCm: 180,
          waistCm: 38,
          neckCm: 40,
        })
      ).toBeNull();
    });

    it('returns null for non-positive or missing dimensions', () => {
      expect(
        calculateNavyBodyFat({
          gender: 'male',
          heightCm: 0,
          waistCm: 85,
          neckCm: 40,
        })
      ).toBeNull();

      expect(
        calculateNavyBodyFat({
          gender: 'male',
          heightCm: 180,
          waistCm: -85,
          neckCm: 40,
        })
      ).toBeNull();

      expect(
        calculateNavyBodyFat({
          gender: 'male',
          heightCm: 180,
          waistCm: 85,
          neckCm: 0,
        })
      ).toBeNull();
    });
  });

  describe('calculateNavyBodyFat & calculateNavyBodyDensity for Women', () => {
    it('computes expected body fat for a standard female lifter', () => {
      // 165 cm, 68 cm waist, 34 cm neck, 92 cm hip -> ~21.1%
      const bf = calculateNavyBodyFat({
        gender: 'female',
        heightCm: 165,
        waistCm: 68,
        neckCm: 34,
        hipCm: 92,
      });

      expect(bf).toBe(21.1);

      const density = calculateNavyBodyDensity({
        gender: 'female',
        heightCm: 165,
        waistCm: 68,
        neckCm: 34,
        hipCm: 92,
      });
      expect(density).not.toBeNull();
      expect(density!).toBeGreaterThan(1.04);
      expect(density!).toBeLessThan(1.07);
    });

    it('computes expected body fat for an athletic female', () => {
      // 170 cm, 64 cm waist, 32 cm neck, 88 cm hip -> ~16.6%
      const bf = calculateNavyBodyFat({
        gender: 'female',
        heightCm: 170,
        waistCm: 64,
        neckCm: 32,
        hipCm: 88,
      });

      expect(bf).toBe(16.6);
    });

    it('returns null if hip measurement is missing or zero for female', () => {
      expect(
        calculateNavyBodyFat({
          gender: 'female',
          heightCm: 165,
          waistCm: 68,
          neckCm: 34,
        })
      ).toBeNull();

      expect(
        calculateNavyBodyFat({
          gender: 'female',
          heightCm: 165,
          waistCm: 68,
          neckCm: 34,
          hipCm: 0,
        })
      ).toBeNull();

      expect(
        calculateNavyBodyFat({
          gender: 'female',
          heightCm: 165,
          waistCm: 68,
          neckCm: 34,
          hipCm: null,
        })
      ).toBeNull();
    });

    it('returns null if waist + hip <= neck for female', () => {
      expect(
        calculateNavyBodyFat({
          gender: 'female',
          heightCm: 165,
          waistCm: 20,
          neckCm: 50,
          hipCm: 25,
        })
      ).toBeNull();
    });
  });

  describe('Clamping behavior', () => {
    it('clamps body fat to minimum 2.0% for extreme sub-physiological estimates', () => {
      // Artificially large height & tiny waist
      const bf = calculateNavyBodyFat({
        gender: 'male',
        heightCm: 220,
        waistCm: 50,
        neckCm: 48,
      });
      expect(bf).toBe(2.0);
    });

    it('clamps body fat to maximum 70.0% for extreme high adiposity estimates', () => {
      // Very short height with very large waist-to-neck differential
      const bf = calculateNavyBodyFat({
        gender: 'male',
        heightCm: 120,
        waistCm: 170,
        neckCm: 30,
      });
      expect(bf).toBe(70.0);
    });
  });

  describe('calculate7DaySMA (Calendar-Aware Simple Moving Average)', () => {
    it('returns empty array when provided with no entries', () => {
      expect(calculate7DaySMA([])).toEqual([]);
    });

    it('returns the same bodyweight as SMA for a single entry', () => {
      const result = calculate7DaySMA([{ date: '2026-10-01', bodyweight: 80.5 }]);
      expect(result).toEqual([{ date: '2026-10-01', bodyweight: 80.5, sma7: 80.5 }]);
    });

    it('computes 7-consecutive-day rolling average correctly', () => {
      const entries: BodyweightEntry[] = [
        { date: '2026-10-01', bodyweight: 80.0 },
        { date: '2026-10-02', bodyweight: 80.2 },
        { date: '2026-10-03', bodyweight: 80.4 },
        { date: '2026-10-04', bodyweight: 80.6 },
        { date: '2026-10-05', bodyweight: 80.8 },
        { date: '2026-10-06', bodyweight: 81.0 },
        { date: '2026-10-07', bodyweight: 81.2 }, // Day 7: avg of all 7 days = 80.60
        { date: '2026-10-08', bodyweight: 81.4 }, // Day 8: window drops day 1 (80.0) -> avg 80.80
      ];

      const result = calculate7DaySMA(entries);

      expect(result.length).toBe(8);
      expect(result[0].sma7).toBe(80.0);
      expect(result[1].sma7).toBe(80.1); // (80.0 + 80.2) / 2
      expect(result[6].sma7).toBe(80.6); // 80.0..81.2 avg
      expect(result[7].sma7).toBe(80.8); // 80.2..81.4 avg
    });

    it('correctly handles irregular logging gaps (e.g. logging every 3 days)', () => {
      const entries: BodyweightEntry[] = [
        { date: '2026-10-01', bodyweight: 80.0 },
        { date: '2026-10-04', bodyweight: 81.0 }, // 3 days later: window includes 10-01 and 10-04 -> (80+81)/2 = 80.50
        { date: '2026-10-12', bodyweight: 82.0 }, // 8 days later: 10-04 is outside 7-day window -> 82.00
      ];

      const result = calculate7DaySMA(entries);

      expect(result[0].sma7).toBe(80.0);
      expect(result[1].sma7).toBe(80.5);
      expect(result[2].sma7).toBe(82.0);
    });

    it('averages multiple logs occurring on the same calendar day before smoothing', () => {
      const entries: BodyweightEntry[] = [
        { date: '2026-10-01', bodyweight: 80.0 },
        { date: '2026-10-01', bodyweight: 81.0 }, // Average on 10-01 is 80.50
        { date: '2026-10-02', bodyweight: 81.5 },
      ];

      const result = calculate7DaySMA(entries);

      expect(result.length).toBe(2);
      expect(result[0].bodyweight).toBe(80.5);
      expect(result[0].sma7).toBe(80.5);
      expect(result[1].sma7).toBe(81.0); // (80.5 + 81.5) / 2
    });

    it('sorts unsorted date entries into chronological order', () => {
      const entries: BodyweightEntry[] = [
        { date: '2026-10-03', bodyweight: 82.0 },
        { date: '2026-10-01', bodyweight: 80.0 },
        { date: '2026-10-02', bodyweight: 81.0 },
      ];

      const result = calculate7DaySMA(entries);

      expect(result.map((r) => r.date)).toEqual([
        '2026-10-01',
        '2026-10-02',
        '2026-10-03',
      ]);
      expect(result[2].sma7).toBe(81.0); // (80 + 81 + 82) / 3
    });
  });

  describe('calculate7DayEMA (Exponential Moving Average)', () => {
    it('returns empty array when provided with no entries', () => {
      expect(calculate7DayEMA([])).toEqual([]);
    });

    it('computes EMA with default alpha = 0.25 (N = 7)', () => {
      const entries: BodyweightEntry[] = [
        { date: '2026-10-01', bodyweight: 80.0 },
        { date: '2026-10-02', bodyweight: 84.0 }, // EMA_1 = 0.25 * 84 + 0.75 * 80 = 21 + 60 = 81.00
        { date: '2026-10-03', bodyweight: 88.0 }, // EMA_2 = 0.25 * 88 + 0.75 * 81 = 22 + 60.75 = 82.75
      ];

      const result = calculate7DayEMA(entries);

      expect(result[0].ema7).toBe(80.0);
      expect(result[1].ema7).toBe(81.0);
      expect(result[2].ema7).toBe(82.75);
    });

    it('supports custom alpha smoothing parameter', () => {
      const entries: BodyweightEntry[] = [
        { date: '2026-10-01', bodyweight: 100.0 },
        { date: '2026-10-02', bodyweight: 110.0 },
      ];

      // Alpha = 0.5: 0.5 * 110 + 0.5 * 100 = 105.00
      const result = calculate7DayEMA(entries, 0.5);
      expect(result[1].ema7).toBe(105.0);
    });
  });

  describe('calculateBodyweightRollingAverages (Combined SMA + EMA)', () => {
    it('outputs unified RollingAveragePoint array with both curves', () => {
      const entries: BodyweightEntry[] = [
        { date: '2026-10-01', bodyweight: 80.0 },
        { date: '2026-10-02', bodyweight: 82.0 },
      ];

      const result = calculateBodyweightRollingAverages(entries);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        date: '2026-10-01',
        bodyweight: 80.0,
        sma7: 80.0,
        ema7: 80.0,
      });
      expect(result[1]).toEqual({
        date: '2026-10-02',
        bodyweight: 82.0,
        sma7: 81.0,
        ema7: 80.5,
      });
    });
  });
});
