/**
 * Workout Suite — Plot Time Span Utilities
 *
 * Implements time-window resolution and point-filtering algorithms for longitudinal plots:
 * - 'all': All data (unbounded history)
 * - 'year': 1 year (365 days)
 * - '3months': 3 months (90 days)
 * - 'month': 1 month (30 days)
 * - 'week': 1 week (7 days)
 */

export type PlotTimeSpan = 'all' | 'year' | '3months' | 'month' | 'week';

export interface TimeSpanOption {
  key: PlotTimeSpan;
  label: string;
}

export const TIME_SPAN_OPTIONS: TimeSpanOption[] = [
  { key: 'all', label: 'All data' },
  { key: 'year', label: 'Year' },
  { key: '3months', label: '3 months' },
  { key: 'month', label: 'Month' },
  { key: 'week', label: 'Week' },
];

/**
 * Calculates the ISO8601 YYYY-MM-DD cutoff date string for a given time span relative to a reference date.
 * Returns null for 'all' (indicating no date filtering).
 */
export function getTimeSpanCutoffDate(
  timeSpan: PlotTimeSpan,
  refDate: Date = new Date()
): string | null {
  if (timeSpan === 'all') {
    return null;
  }

  const d = new Date(refDate);
  switch (timeSpan) {
    case 'week':
      d.setDate(d.getDate() - 7);
      break;
    case 'month':
      d.setDate(d.getDate() - 30);
      break;
    case '3months':
      d.setDate(d.getDate() - 90);
      break;
    case 'year':
      d.setDate(d.getDate() - 365);
      break;
  }

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Filters a generic collection of items with an ISO date (YYYY-MM-DD) property
 * against a designated time span window.
 */
export function filterDataByTimeSpan<T extends { date: string }>(
  items: T[],
  timeSpan: PlotTimeSpan,
  refDate?: Date
): T[] {
  const cutoff = getTimeSpanCutoffDate(timeSpan, refDate);
  if (!cutoff) {
    return items;
  }
  return items.filter((item) => item.date >= cutoff);
}

/**
 * Filters Monday-bucketed weekly volume bars.
 * A weekly bar (representing Monday through Sunday) is included if its week
 * contains days on or after the cutoff date (i.e. Sunday of that week >= cutoff).
 */
export function filterWeeklyBarsByTimeSpan<T extends { date: string }>(
  bars: T[],
  timeSpan: PlotTimeSpan,
  refDate?: Date
): T[] {
  const cutoff = getTimeSpanCutoffDate(timeSpan, refDate);
  if (!cutoff) {
    return bars;
  }

  const [cYear, cMonth, cDay] = cutoff.split('-').map((v) => parseInt(v, 10));
  const cutoffMs = Date.UTC(cYear, cMonth - 1, cDay);

  return bars.filter((b) => {
    const [bYear, bMonth, bDay] = b.date.split('-').map((v) => parseInt(v, 10));
    const mondayMs = Date.UTC(bYear, bMonth - 1, bDay);
    const sundayMs = mondayMs + 6 * 86_400_000;
    return sundayMs >= cutoffMs;
  });
}
