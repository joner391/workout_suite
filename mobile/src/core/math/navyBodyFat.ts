import { Gender } from '../types';

/**
 * Input parameters required for the U.S. Navy circumference-based body fat estimation.
 * All length measurements MUST be provided in centimeters (cm).
 */
export interface NavyBodyFatInputs {
  gender: Gender;
  heightCm: number;
  waistCm: number;
  neckCm: number;
  hipCm?: number | null; // Required for females
}

/**
 * Minimal data point for bodyweight longitudinal tracking.
 */
export interface BodyweightEntry {
  date: string; // ISO8601 date string (YYYY-MM-DD)
  bodyweight: number; // Canonical load in kg
}

/**
 * Output data point combining raw bodyweight with 7-day rolling SMA and EMA.
 */
export interface RollingAveragePoint {
  date: string;
  bodyweight: number;
  sma7: number;
  ema7: number;
}

const MS_PER_DAY = 86_400_000;

/**
 * Helper to convert a YYYY-MM-DD string into UTC midnight timestamp in milliseconds.
 */
export function parseIsoDateToMs(dateStr: string): number {
  const parts = dateStr.split('-');
  if (parts.length < 3) return NaN;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);
  if (isNaN(year) || isNaN(month) || isNaN(day)) return NaN;
  return Date.UTC(year, month - 1, day);
}

/**
 * Computes body density (D) using the official Department of Defense / U.S. Navy
 * metric equations (Hodgdon & Beckett, 1984).
 *
 * Men:
 *   D = 1.0324 - 0.19077 * log10(waist - neck) + 0.15456 * log10(height)
 *
 * Women:
 *   D = 1.29579 - 0.35004 * log10(waist + hip - neck) + 0.22100 * log10(height)
 *
 * Returns null if inputs fail anatomical or mathematical validation.
 */
export function calculateNavyBodyDensity(inputs: NavyBodyFatInputs): number | null {
  const { gender, heightCm, waistCm, neckCm, hipCm } = inputs;

  if (!heightCm || isNaN(heightCm) || heightCm <= 0) return null;
  if (!waistCm || isNaN(waistCm) || waistCm <= 0) return null;
  if (!neckCm || isNaN(neckCm) || neckCm <= 0) return null;

  if (gender === 'male') {
    const diff = waistCm - neckCm;
    if (diff <= 0) return null;

    const density =
      1.0324 - 0.19077 * Math.log10(diff) + 0.15456 * Math.log10(heightCm);
    return isNaN(density) || density <= 0 ? null : density;
  }

  if (gender === 'female') {
    if (hipCm == null || isNaN(hipCm) || hipCm <= 0) return null;
    const diff = waistCm + hipCm - neckCm;
    if (diff <= 0) return null;

    const density =
      1.29579 - 0.35004 * Math.log10(diff) + 0.221 * Math.log10(heightCm);
    return isNaN(density) || density <= 0 ? null : density;
  }

  return null;
}

/**
 * Calculates estimated body fat percentage using the U.S. Navy circumference method
 * combined with the Siri equation:
 *   Body Fat % = (495 / Body Density) - 450
 *
 * Results are clamped to a physiological range of [2.0%, 70.0%] and rounded to 1 decimal place.
 * Returns null if the required measurements are incomplete or anatomically invalid.
 */
export function calculateNavyBodyFat(inputs: NavyBodyFatInputs): number | null {
  const density = calculateNavyBodyDensity(inputs);
  if (density === null) return null;

  const rawBf = 495 / density - 450;
  if (isNaN(rawBf)) return null;

  // Clamp to physiological boundaries
  const clampedBf = Math.max(2.0, Math.min(70.0, rawBf));
  return Number(clampedBf.toFixed(1));
}

/**
 * Groups and averages multiple entries on the same date, then sorts ascending by date.
 */
function normalizeAndSortEntries(entries: BodyweightEntry[]): BodyweightEntry[] {
  const valid = entries.filter(
    (e) =>
      Boolean(e.date) &&
      typeof e.bodyweight === 'number' &&
      !isNaN(e.bodyweight) &&
      e.bodyweight > 0
  );

  if (valid.length === 0) return [];

  // Group by date to average multiple entries on the same calendar day
  const dateMap = new Map<string, { totalWeight: number; count: number }>();
  for (const entry of valid) {
    const existing = dateMap.get(entry.date);
    if (existing) {
      existing.totalWeight += entry.bodyweight;
      existing.count += 1;
    } else {
      dateMap.set(entry.date, { totalWeight: entry.bodyweight, count: 1 });
    }
  }

  const normalized: BodyweightEntry[] = [];
  for (const [date, data] of dateMap.entries()) {
    normalized.push({
      date,
      bodyweight: Number((data.totalWeight / data.count).toFixed(2)),
    });
  }

  return normalized.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Calculates a calendar-aware 7-day Simple Moving Average (SMA).
 *
 * For each logged date D_i, considers all logged weights within [D_i - 6 days, D_i]
 * (a 7-calendar-day window inclusive) and calculates their arithmetic mean.
 * This naturally accommodates irregular logging frequencies (e.g. 3-4 days/week)
 * without requiring artificial synthetic interpolation.
 */
export function calculate7DaySMA(
  entries: BodyweightEntry[]
): Array<{ date: string; bodyweight: number; sma7: number }> {
  const sorted = normalizeAndSortEntries(entries);
  if (sorted.length === 0) return [];

  const msList = sorted.map((e) => parseIsoDateToMs(e.date));

  return sorted.map((entry, idx) => {
    const currentMs = msList[idx];
    const windowStartMs = currentMs - 6 * MS_PER_DAY;

    let windowSum = 0;
    let windowCount = 0;

    for (let j = 0; j <= idx; j++) {
      if (msList[j] >= windowStartMs && msList[j] <= currentMs) {
        windowSum += sorted[j].bodyweight;
        windowCount += 1;
      }
    }

    const avg = windowCount > 0 ? windowSum / windowCount : entry.bodyweight;
    return {
      date: entry.date,
      bodyweight: entry.bodyweight,
      sma7: Number(avg.toFixed(2)),
    };
  });
}

/**
 * Calculates an Exponential Moving Average (EMA) across chronological weight observations.
 *
 * For N = 7 days, standard smoothing factor alpha = 2 / (7 + 1) = 0.25.
 * EMA_0 = Weight_0
 * EMA_t = alpha * Weight_t + (1 - alpha) * EMA_{t-1}
 */
export function calculate7DayEMA(
  entries: BodyweightEntry[],
  alpha: number = 0.25
): Array<{ date: string; bodyweight: number; ema7: number }> {
  const sorted = normalizeAndSortEntries(entries);
  if (sorted.length === 0) return [];

  let currentEma = sorted[0].bodyweight;

  return sorted.map((entry, idx) => {
    if (idx === 0) {
      currentEma = entry.bodyweight;
    } else {
      currentEma = alpha * entry.bodyweight + (1 - alpha) * currentEma;
    }

    return {
      date: entry.date,
      bodyweight: entry.bodyweight,
      ema7: Number(currentEma.toFixed(2)),
    };
  });
}

/**
 * Combined longitudinal bodyweight rolling averages engine returning
 * both 7-day calendar SMA and step-wise EMA for each date entry.
 */
export function calculateBodyweightRollingAverages(
  entries: BodyweightEntry[],
  alpha: number = 0.25
): RollingAveragePoint[] {
  const smaList = calculate7DaySMA(entries);
  const emaList = calculate7DayEMA(entries, alpha);

  return smaList.map((smaItem, idx) => ({
    date: smaItem.date,
    bodyweight: smaItem.bodyweight,
    sma7: smaItem.sma7,
    ema7: emaList[idx]?.ema7 ?? smaItem.sma7,
  }));
}
