/**
 * Workout Suite — External Data Import Engine: CSV Parser
 *
 * Implements Step 2.4: Pure, zero-dependency CSV parsers for Strong CSV exports,
 * Hevy CSV exports, and custom column-mapped generic CSVs.
 *
 * Implements RFC 4180 parsing with full support for:
 * - Semicolon (;) and comma (,) delimiters
 * - Quoted fields enclosing delimiters, newlines, and escaped quotes ("")
 * - Unit conversions (lbs -> kg canonical load)
 * - RPE/RIR parsing and set type classification ('working', 'warmup', 'drop', 'failure')
 * - Workout grouping by date/session and exercise hierarchy
 */

import { BodyMetric, ImportSource, SetType, WeightUnit } from '../types';
import { lbsToKg } from '../math/unitConversion';

// ============================================================================
// Core Import Parser Contracts
// ============================================================================

export interface ParsedCsvSet {
  setNumber: number;
  weight: number; // raw value parsed from CSV
  weightUnit: WeightUnit;
  weightKg: number; // canonical converted load in kg
  rawInputWeightKg: number; // exact typed load normalized to kg
  reps: number;
  repsRight?: number | null;
  rpe?: number | null;
  rir?: number | null;
  setType: SetType;
  notes?: string | null;
  exerciseGroupId?: string | null;
}

export interface ParsedCsvExercise {
  rawExerciseName: string;
  sets: ParsedCsvSet[];
}

export interface ParsedCsvWorkout {
  source: ImportSource;
  name: string;
  date: string; // ISO8601: YYYY-MM-DD
  startedAt: string; // ISO8601 timestamp
  durationSeconds?: number | null;
  notes?: string | null;
  exercises: ParsedCsvExercise[];
}

export interface CsvParseResult {
  source: ImportSource;
  workouts: ParsedCsvWorkout[];
  totalSets: number;
  totalExercisesCount: number;
  errors: string[];
}

export interface CsvColumnMapping {
  dateColumn: string;
  workoutNameColumn?: string;
  exerciseNameColumn: string;
  setOrderColumn?: string;
  weightColumn: string;
  weightUnitColumn?: string;
  defaultWeightUnit?: WeightUnit;
  repsColumn: string;
  rpeColumn?: string;
  rirColumn?: string;
  setTypeColumn?: string;
  notesColumn?: string;
  workoutNotesColumn?: string;
  durationColumn?: string;
  supersetIdColumn?: string;
}

export interface CsvParseOptions {
  startDate?: string; // YYYY-MM-DD (inclusive)
  endDate?: string;   // YYYY-MM-DD (inclusive)
}

// ============================================================================
// Low-Level RFC 4180 CSV Tokenizer
// ============================================================================

/**
 * Pure, zero-dependency RFC 4180 compliant CSV tokenizer.
 * Correctly handles commas, semicolons, quoted fields, multiline fields, and escaped quotes ("").
 */
export function parseRawCsv(text: string, forcedDelimiter?: string): string[][] {
  if (!text || typeof text !== 'string') {
    return [];
  }

  // Detect delimiter if not forced: sample first line (outside quotes)
  const delimiter = forcedDelimiter || detectDelimiter(text);

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let insideQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const char = text[i];
    const nextChar = i + 1 < len ? text[i + 1] : '';

    if (insideQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped quote ("") inside quoted field
          currentField += '"';
          i += 2;
          continue;
        } else {
          // Closing quote
          insideQuotes = false;
          i++;
          continue;
        }
      } else {
        currentField += char;
        i++;
        continue;
      }
    } else {
      if (char === '"') {
        insideQuotes = true;
        i++;
        continue;
      }

      if (char === delimiter) {
        currentRow.push(currentField.trim());
        currentField = '';
        i++;
        continue;
      }

      if (char === '\r') {
        if (nextChar === '\n') {
          i++; // Consume \n in \r\n
        }
        currentRow.push(currentField.trim());
        rows.push(currentRow);
        currentRow = [];
        currentField = '';
        i++;
        continue;
      }

      if (char === '\n') {
        currentRow.push(currentField.trim());
        rows.push(currentRow);
        currentRow = [];
        currentField = '';
        i++;
        continue;
      }

      currentField += char;
      i++;
    }
  }

  // Final field and row if any content remains
  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    rows.push(currentRow);
  }

  // Filter out empty rows (e.g. trailing blank lines)
  return rows.filter((r) => r.some((cell) => cell.trim().length > 0));
}

/**
 * Detects whether comma or semicolon is the primary delimiter by checking the first line.
 */
function detectDelimiter(text: string): string {
  let commaCount = 0;
  let semicolonCount = 0;
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes) {
      if (char === ',') commaCount++;
      if (char === ';') semicolonCount++;
      if (char === '\n' || char === '\r') break;
    }
  }

  return semicolonCount > commaCount ? ';' : ',';
}

/**
 * Normalizes header names for case-insensitive and punctuation-free matching.
 */
export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .trim()
    .replace(/[\s\-_?]+/g, '_')
    .replace(/[^\w]/g, '')
    .replace(/^_+|_+$/g, '');
}

// ============================================================================
// Format Auto-Detection
// ============================================================================

/**
 * Checks whether the CSV header corresponds to StrengthLog body composition export.
 */
export function isStrengthLogBodyCompCsv(headerRow: string[]): boolean {
  const normalized = headerRow.map(normalizeHeader);
  const set = new Set(normalized);
  return set.has('type') && set.has('timestamp') && set.has('value') && set.has('unit');
}

/**
 * Automatically inspects the CSV header row to identify the export origin.
 */
export function detectCsvFormat(headerRow: string[]): ImportSource {
  const normalized = headerRow.map(normalizeHeader);
  const set = new Set(normalized);

  // Liftosaur detection:
  // Usually has: 'workout_datetime', 'program', 'day_name', 'exercise', 'is_warmup_set', 'completed_reps'
  if (
    set.has('workout_datetime') ||
    (set.has('day_name') && (set.has('is_warmup_set') || set.has('completed_reps') || set.has('required_reps')))
  ) {
    return 'liftosaur';
  }

  // StrengthLog training detection:
  // Usually has: 'workout', 'start', 'end', 'exercise', 'specialset', 'warmup', 'checked'
  if (
    set.has('workout') &&
    (set.has('start') || set.has('exercise')) &&
    (set.has('specialset') || set.has('workoutcomment') || set.has('checked') || set.has('distancekm') || set.has('bodyweight'))
  ) {
    return 'strengthlog';
  }

  // Strong app detection:
  // Usually has: 'date', 'workout_name', 'exercise_name', 'set_order', 'weight_unit', 'workout_notes'
  if (
    set.has('workout_name') &&
    (set.has('exercise_name') || set.has('set_order') || set.has('weight_unit'))
  ) {
    return 'strong';
  }

  // Hevy app detection:
  // Usually has: 'exercise_title', 'start_time', 'set_index', 'set_type', 'weight_lbs'/'weight_kg', 'superset_id'
  if (
    set.has('exercise_title') ||
    (set.has('start_time') && (set.has('set_index') || set.has('superset_id') || set.has('weight_kg') || set.has('weight_lbs')))
  ) {
    return 'hevy';
  }

  return 'csv';
}

// ============================================================================
// Helper Parsers: Dates, Durations, Set Types
// ============================================================================

/**
 * Parses diverse date formats into { date: 'YYYY-MM-DD', startedAt: ISO8601 }.
 */
export function parseDateString(raw: string): { date: string; startedAt: string } {
  const trimmed = raw.trim();
  const now = new Date();

  if (!trimmed) {
    const today = now.toISOString().split('T')[0];
    return { date: today, startedAt: now.toISOString() };
  }

  // Format 1: ISO or SQL format 'YYYY-MM-DD HH:mm:ss' or 'YYYY-MM-DD'
  const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (isoMatch) {
    const year = isoMatch[1];
    const month = isoMatch[2].padStart(2, '0');
    const day = isoMatch[3].padStart(2, '0');
    const hours = (isoMatch[4] || '12').padStart(2, '0');
    const minutes = (isoMatch[5] || '00').padStart(2, '0');
    const seconds = (isoMatch[6] || '00').padStart(2, '0');

    const date = `${year}-${month}-${day}`;
    const startedAt = `${date}T${hours}:${minutes}:${seconds}.000Z`;
    return { date, startedAt };
  }

  // Format 2: Hevy format '15 Jul 2026, 09:52' or '15 Jul 2026 09:52:00'
  const monthNames: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };
  const textualMatch = trimmed.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})(?:,?\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (textualMatch) {
    const day = textualMatch[1].padStart(2, '0');
    const monthKey = textualMatch[2].toLowerCase();
    const month = monthNames[monthKey] || '01';
    const year = textualMatch[3];
    const hours = (textualMatch[4] || '12').padStart(2, '0');
    const minutes = (textualMatch[5] || '00').padStart(2, '0');
    const seconds = (textualMatch[6] || '00').padStart(2, '0');

    const date = `${year}-${month}-${day}`;
    const startedAt = `${date}T${hours}:${minutes}:${seconds}.000Z`;
    return { date, startedAt };
  }

  // Format 3: DD/MM/YYYY or MM/DD/YYYY
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[T\s](\d{1,2}):(\d{1,2}))?/);
  if (slashMatch) {
    // Assume DD/MM/YYYY (common European/gym format)
    const p1 = parseInt(slashMatch[1], 10);
    const p2 = parseInt(slashMatch[2], 10);
    const year = slashMatch[3];

    let day = p1;
    let month = p2;
    if (p1 > 12 && p2 <= 12) {
      day = p1;
      month = p2;
    } else if (p2 > 12 && p1 <= 12) {
      month = p1;
      day = p2;
    }

    const dStr = String(day).padStart(2, '0');
    const mStr = String(month).padStart(2, '0');
    const hours = (slashMatch[4] || '12').padStart(2, '0');
    const minutes = (slashMatch[5] || '00').padStart(2, '0');

    const date = `${year}-${mStr}-${dStr}`;
    const startedAt = `${date}T${hours}:${minutes}:00.000Z`;
    return { date, startedAt };
  }

  // Fallback: standard Date.parse
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    const date = parsed.toISOString().split('T')[0];
    return { date, startedAt: parsed.toISOString() };
  }

  const today = now.toISOString().split('T')[0];
  return { date: today, startedAt: now.toISOString() };
}

/**
 * Parses workout duration strings (e.g. '1h 14m', '45m', '01:14:00', '3600') into total seconds.
 */
export function parseDurationSeconds(raw?: string | null): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Numeric seconds
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10);
  }

  // 'Xh Ym' or 'Xh' or 'Ym' or 'Xs'
  let totalSeconds = 0;
  let matched = false;

  const hoursMatch = trimmed.match(/(\d+)\s*h(?:ours?)?/i);
  if (hoursMatch) {
    totalSeconds += parseInt(hoursMatch[1], 10) * 3600;
    matched = true;
  }

  const minutesMatch = trimmed.match(/(\d+)\s*m(?:in(?:utes?)?)?/i);
  if (minutesMatch) {
    totalSeconds += parseInt(minutesMatch[1], 10) * 60;
    matched = true;
  }

  const secondsMatch = trimmed.match(/(\d+)\s*s(?:ec(?:onds?)?)?/i);
  if (secondsMatch) {
    totalSeconds += parseInt(secondsMatch[1], 10);
    matched = true;
  }

  if (matched) return totalSeconds;

  // 'HH:MM:SS' or 'MM:SS'
  const timeParts = trimmed.split(':');
  if (timeParts.length === 3) {
    const h = parseInt(timeParts[0], 10) || 0;
    const m = parseInt(timeParts[1], 10) || 0;
    const s = parseInt(timeParts[2], 10) || 0;
    return h * 3600 + m * 60 + s;
  } else if (timeParts.length === 2) {
    const m = parseInt(timeParts[0], 10) || 0;
    const s = parseInt(timeParts[1], 10) || 0;
    return m * 60 + s;
  }

  return null;
}

/**
 * Maps Strong and Hevy set type notations to canonical Workout Suite SetType.
 */
export function mapSetType(raw: string): SetType {
  const norm = raw.trim().toLowerCase();
  if (norm === 'w' || norm === 'warmup' || norm.includes('warm')) {
    return 'warmup';
  }
  if (norm === 'd' || norm === 'drop' || norm === 'dropset') {
    return 'drop';
  }
  if (norm === 'myo' || norm === 'myorep') {
    return 'myorep';
  }
  if (norm === 'dc' || norm === 'doggcrapp') {
    return 'dc';
  }
  if (norm === 'amrap') {
    return 'amrap';
  }
  // Legacy 'failure' sets map to 'working' set (with RPE 10 / RIR 0)
  if (norm === 'f' || norm === 'failure') {
    return 'working';
  }
  return 'working';
}

// ============================================================================
// Strong App CSV Parser
// ============================================================================

/**
 * Parses Strong App CSV exports.
 * Typical headers: Date;Workout Name;Exercise Name;Set Order;Weight;Weight Unit;Reps;RPE;Distance;Distance Unit;Seconds;Notes;Workout Notes;Workout Duration
 */
export function parseStrongCsv(text: string): CsvParseResult {
  const rows = parseRawCsv(text);
  if (rows.length < 2) {
    return {
      source: 'strong',
      workouts: [],
      totalSets: 0,
      totalExercisesCount: 0,
      errors: ['File is empty or contains no data rows.'],
    };
  }

  const headerRow = rows[0];
  const colIndex: Record<string, number> = {};
  headerRow.forEach((col, idx) => {
    colIndex[normalizeHeader(col)] = idx;
  });

  const getCol = (row: string[], colName: string): string => {
    const idx = colIndex[colName];
    return idx !== undefined && idx < row.length ? row[idx].trim() : '';
  };

  const workoutsMap = new Map<string, ParsedCsvWorkout>();
  const errors: string[] = [];
  let totalSets = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length === 0 || !row.some((c) => c.length > 0)) continue;

    const rawDate = getCol(row, 'date');
    const workoutName = getCol(row, 'workout_name') || 'Workout';
    const exerciseName = getCol(row, 'exercise_name');

    if (!exerciseName) {
      continue; // Skip rows without exercise
    }

    const { date, startedAt } = parseDateString(rawDate);
    const workoutKey = `${date}_${workoutName}_${startedAt}`;

    if (!workoutsMap.has(workoutKey)) {
      const workoutNotes = getCol(row, 'workout_notes');
      const durationStr = getCol(row, 'workout_duration');
      const durationSeconds = parseDurationSeconds(durationStr);

      workoutsMap.set(workoutKey, {
        source: 'strong',
        name: workoutName,
        date,
        startedAt,
        durationSeconds,
        notes: workoutNotes || null,
        exercises: [],
      });
    }

    const workout = workoutsMap.get(workoutKey)!;

    // Find or create exercise in workout
    let exercise = workout.exercises.find((e) => e.rawExerciseName === exerciseName);
    if (!exercise) {
      exercise = {
        rawExerciseName: exerciseName,
        sets: [],
      };
      workout.exercises.push(exercise);
    }

    // Set attributes
    const rawSetOrder = getCol(row, 'set_order');
    const rawWeight = parseFloat(getCol(row, 'weight')) || 0;
    const rawUnit = getCol(row, 'weight_unit').toLowerCase();
    const weightUnit: WeightUnit = rawUnit.includes('lb') ? 'lbs' : 'kg';

    // ADR-008 & ADR-026: Calculate canonical load in kg
    const weightKg = weightUnit === 'lbs' ? lbsToKg(rawWeight) : rawWeight;
    const rawInputWeightKg = weightKg;

    const reps = parseInt(getCol(row, 'reps'), 10) || 0;
    const rawRpe = getCol(row, 'rpe');
    const rpe = rawRpe ? parseFloat(rawRpe) : null;
    const rir = rpe != null ? Math.max(0, 10 - rpe) : null;

    const normRawOrder = rawSetOrder.trim().toLowerCase();
    const setNotes = getCol(row, 'notes');
    const isAmrap = normRawOrder === 'amrap' || (setNotes ? setNotes.toLowerCase().includes('amrap') : false);
    const isFailureSet = normRawOrder === 'f' || normRawOrder === 'failure' || isAmrap;
    const effectiveRpe = rpe && !isNaN(rpe) ? rpe : (isFailureSet ? 10.0 : null);
    const effectiveRir = rir && !isNaN(rir) ? rir : (isFailureSet ? 0.0 : null);

    const setType = mapSetType(rawSetOrder);

    const setNumber = exercise.sets.length + 1;

    exercise.sets.push({
      setNumber,
      weight: rawWeight,
      weightUnit,
      weightKg,
      rawInputWeightKg,
      reps,
      repsRight: null,
      rpe: effectiveRpe,
      rir: effectiveRir,
      setType,
      notes: setNotes || null,
      exerciseGroupId: null,
    });

    totalSets++;
  }

  const workouts = Array.from(workoutsMap.values());
  const uniqueExercises = new Set<string>();
  workouts.forEach((w) => w.exercises.forEach((e) => uniqueExercises.add(e.rawExerciseName)));

  return {
    source: 'strong',
    workouts,
    totalSets,
    totalExercisesCount: uniqueExercises.size,
    errors,
  };
}

// ============================================================================
// Hevy App CSV Parser
// ============================================================================

/**
 * Parses Hevy App CSV exports.
 * Typical headers: title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_lbs/weight_kg,reps,distance_miles/distance_km,duration_seconds,rpe
 */
export function parseHevyCsv(text: string): CsvParseResult {
  const rows = parseRawCsv(text);
  if (rows.length < 2) {
    return {
      source: 'hevy',
      workouts: [],
      totalSets: 0,
      totalExercisesCount: 0,
      errors: ['File is empty or contains no data rows.'],
    };
  }

  const headerRow = rows[0];
  const colIndex: Record<string, number> = {};
  headerRow.forEach((col, idx) => {
    colIndex[normalizeHeader(col)] = idx;
  });

  const getCol = (row: string[], colName: string): string => {
    const idx = colIndex[colName];
    return idx !== undefined && idx < row.length ? row[idx].trim() : '';
  };

  const isLbs = Object.keys(colIndex).some((k) => k.includes('weight_lbs') || k.includes('lbs'));
  const weightColName = isLbs
    ? Object.keys(colIndex).find((k) => k.includes('weight_lbs')) || 'weight_lbs'
    : Object.keys(colIndex).find((k) => k.includes('weight_kg')) || 'weight_kg';

  const workoutsMap = new Map<string, ParsedCsvWorkout>();
  const errors: string[] = [];
  let totalSets = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length === 0 || !row.some((c) => c.length > 0)) continue;

    const rawStartTime = getCol(row, 'start_time');
    const rawEndTime = getCol(row, 'end_time');
    const workoutName = getCol(row, 'title') || 'Workout';
    const exerciseName = getCol(row, 'exercise_title');

    if (!exerciseName) continue;

    const { date, startedAt } = parseDateString(rawStartTime);
    const workoutKey = `${date}_${workoutName}_${startedAt}`;

    if (!workoutsMap.has(workoutKey)) {
      const description = getCol(row, 'description');
      let durationSeconds: number | null = null;

      if (rawEndTime) {
        const startMs = new Date(startedAt).getTime();
        const endParsed = parseDateString(rawEndTime);
        const endMs = new Date(endParsed.startedAt).getTime();
        if (!isNaN(startMs) && !isNaN(endMs) && endMs > startMs) {
          durationSeconds = Math.round((endMs - startMs) / 1000);
        }
      }

      workoutsMap.set(workoutKey, {
        source: 'hevy',
        name: workoutName,
        date,
        startedAt,
        durationSeconds,
        notes: description || null,
        exercises: [],
      });
    }

    const workout = workoutsMap.get(workoutKey)!;

    // Find or create exercise in workout
    let exercise = workout.exercises.find((e) => e.rawExerciseName === exerciseName);
    if (!exercise) {
      exercise = {
        rawExerciseName: exerciseName,
        sets: [],
      };
      workout.exercises.push(exercise);
    }

    const rawWeightVal = weightColName ? getCol(row, weightColName) : getCol(row, 'weight');
    const rawWeight = parseFloat(rawWeightVal) || 0;
    const weightUnit: WeightUnit = isLbs ? 'lbs' : 'kg';

    const weightKg = weightUnit === 'lbs' ? lbsToKg(rawWeight) : rawWeight;
    const rawInputWeightKg = weightKg;

    const reps = parseInt(getCol(row, 'reps'), 10) || 0;
    const rawRpe = getCol(row, 'rpe');
    const rpe = rawRpe ? parseFloat(rawRpe) : null;
    const rir = rpe != null ? Math.max(0, 10 - rpe) : null;

    const rawSetType = getCol(row, 'set_type');
    const normSetType = rawSetType.trim().toLowerCase();
    const setNotes = getCol(row, 'exercise_notes');
    const isAmrap = normSetType === 'amrap' || (setNotes ? setNotes.toLowerCase().includes('amrap') : false);
    const isFailureSet = normSetType === 'f' || normSetType === 'failure' || isAmrap;
    const effectiveRpe = rpe && !isNaN(rpe) ? rpe : (isFailureSet ? 10.0 : null);
    const effectiveRir = rir && !isNaN(rir) ? rir : (isFailureSet ? 0.0 : null);

    const setType = mapSetType(rawSetType);
    const supersetId = getCol(row, 'superset_id') || null;

    const setNumber = exercise.sets.length + 1;

    exercise.sets.push({
      setNumber,
      weight: rawWeight,
      weightUnit,
      weightKg,
      rawInputWeightKg,
      reps,
      repsRight: null,
      rpe: effectiveRpe,
      rir: effectiveRir,
      setType,
      notes: setNotes || null,
      exerciseGroupId: supersetId,
    });

    totalSets++;
  }

  const workouts = Array.from(workoutsMap.values());
  const uniqueExercises = new Set<string>();
  workouts.forEach((w) => w.exercises.forEach((e) => uniqueExercises.add(e.rawExerciseName)));

  return {
    source: 'hevy',
    workouts,
    totalSets,
    totalExercisesCount: uniqueExercises.size,
    errors,
  };
}

// ============================================================================
// Generic / Custom Column-Mapped CSV Parser
// ============================================================================

/**
 * Parses generic or customized CSV files using explicit column mappings or auto-inferred columns.
 */
export function parseGenericCsv(
  text: string,
  customMapping?: Partial<CsvColumnMapping>
): CsvParseResult {
  const rows = parseRawCsv(text);
  if (rows.length < 2) {
    return {
      source: 'csv',
      workouts: [],
      totalSets: 0,
      totalExercisesCount: 0,
      errors: ['File is empty or contains no data rows.'],
    };
  }

  const headerRow = rows[0];
  const colIndex: Record<string, number> = {};
  headerRow.forEach((col, idx) => {
    colIndex[normalizeHeader(col)] = idx;
  });

  // Resolve column names
  const findCol = (candidates: string[]): string | undefined => {
    return candidates.find((c) => colIndex[normalizeHeader(c)] !== undefined);
  };

  const dateCol = customMapping?.dateColumn || findCol(['date', 'workout_date', 'timestamp', 'day']);
  const workoutNameCol = customMapping?.workoutNameColumn || findCol(['workout_name', 'workout', 'routine', 'title', 'name']);
  const exerciseCol = customMapping?.exerciseNameColumn || findCol(['exercise', 'exercise_name', 'movement', 'lift']);
  const weightCol = customMapping?.weightColumn || findCol(['weight', 'load', 'weight_kg', 'weight_lbs']);
  const weightUnitCol = customMapping?.weightUnitColumn || findCol(['weight_unit', 'unit', 'units']);
  const repsCol = customMapping?.repsColumn || findCol(['reps', 'repetitions', 'rep_count']);
  const rpeCol = customMapping?.rpeColumn || findCol(['rpe', 'intensity', 'effort']);
  const rirCol = customMapping?.rirColumn || findCol(['rir', 'reps_in_reserve']);
  const setTypeCol = customMapping?.setTypeColumn || findCol(['set_type', 'type', 'tag']);
  const notesCol = customMapping?.notesColumn || findCol(['notes', 'comment', 'set_notes']);
  const workoutNotesCol = customMapping?.workoutNotesColumn || findCol(['workout_notes', 'description', 'session_notes']);
  const durationCol = customMapping?.durationColumn || findCol(['duration', 'workout_duration', 'duration_seconds', 'time']);
  const supersetCol = customMapping?.supersetIdColumn || findCol(['superset_id', 'group_id', 'group']);

  if (!dateCol || !exerciseCol) {
    return {
      source: 'csv',
      workouts: [],
      totalSets: 0,
      totalExercisesCount: 0,
      errors: ['Required columns (date and exercise name) could not be identified.'],
    };
  }

  const getCol = (row: string[], colName?: string): string => {
    if (!colName) return '';
    const idx = colIndex[normalizeHeader(colName)];
    return idx !== undefined && idx < row.length ? row[idx].trim() : '';
  };

  const workoutsMap = new Map<string, ParsedCsvWorkout>();
  const errors: string[] = [];
  let totalSets = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length === 0 || !row.some((c) => c.length > 0)) continue;

    const rawDate = getCol(row, dateCol);
    const exerciseName = getCol(row, exerciseCol);
    if (!exerciseName) continue;

    const workoutName = getCol(row, workoutNameCol) || 'Workout';
    const { date, startedAt } = parseDateString(rawDate);
    const workoutKey = `${date}_${workoutName}_${startedAt}`;

    if (!workoutsMap.has(workoutKey)) {
      const workoutNotes = getCol(row, workoutNotesCol);
      const durationSeconds = parseDurationSeconds(getCol(row, durationCol));

      workoutsMap.set(workoutKey, {
        source: 'csv',
        name: workoutName,
        date,
        startedAt,
        durationSeconds,
        notes: workoutNotes || null,
        exercises: [],
      });
    }

    const workout = workoutsMap.get(workoutKey)!;

    let exercise = workout.exercises.find((e) => e.rawExerciseName === exerciseName);
    if (!exercise) {
      exercise = {
        rawExerciseName: exerciseName,
        sets: [],
      };
      workout.exercises.push(exercise);
    }

    const rawWeightVal = getCol(row, weightCol);
    const rawWeight = parseFloat(rawWeightVal) || 0;

    let weightUnit: WeightUnit = customMapping?.defaultWeightUnit || 'kg';
    const parsedUnit = getCol(row, weightUnitCol).toLowerCase();
    if (parsedUnit.includes('lb')) {
      weightUnit = 'lbs';
    } else if (parsedUnit.includes('kg')) {
      weightUnit = 'kg';
    } else if (weightCol && weightCol.toLowerCase().includes('lbs')) {
      weightUnit = 'lbs';
    }

    const weightKg = weightUnit === 'lbs' ? lbsToKg(rawWeight) : rawWeight;
    const rawInputWeightKg = weightKg;

    const reps = parseInt(getCol(row, repsCol), 10) || 0;
    const rawRpe = getCol(row, rpeCol);
    const rawRir = getCol(row, rirCol);

    const rpe = rawRpe ? parseFloat(rawRpe) : null;
    const rir = rawRir ? parseFloat(rawRir) : rpe != null ? Math.max(0, 10 - rpe) : null;

    const rawSetType = getCol(row, setTypeCol);
    const normSetType = rawSetType.trim().toLowerCase();
    const setNotes = getCol(row, notesCol);
    const isAmrap = normSetType === 'amrap' || (setNotes ? setNotes.toLowerCase().includes('amrap') : false);
    const isFailureSet = normSetType === 'f' || normSetType === 'failure' || isAmrap;
    const effectiveRpe = rpe && !isNaN(rpe) ? rpe : (isFailureSet ? 10.0 : null);
    const effectiveRir = rir && !isNaN(rir) ? rir : (isFailureSet ? 0.0 : null);

    const setType = mapSetType(rawSetType);
    const supersetId = getCol(row, supersetCol) || null;

    const setNumber = exercise.sets.length + 1;

    exercise.sets.push({
      setNumber,
      weight: rawWeight,
      weightUnit,
      weightKg,
      rawInputWeightKg,
      reps,
      repsRight: null,
      rpe: effectiveRpe,
      rir: effectiveRir,
      setType,
      notes: setNotes || null,
      exerciseGroupId: supersetId,
    });

    totalSets++;
  }

  const workouts = Array.from(workoutsMap.values());
  const uniqueExercises = new Set<string>();
  workouts.forEach((w) => w.exercises.forEach((e) => uniqueExercises.add(e.rawExerciseName)));

  return {
    source: 'csv',
    workouts,
    totalSets,
    totalExercisesCount: uniqueExercises.size,
    errors,
  };
}

// ============================================================================
// Liftosaur CSV Parser
// ============================================================================

/**
 * Parses Liftosaur CSV exports.
 * Typical headers: Workout DateTime,Program,Day Name,Exercise,Is Warmup Set?,Required Reps,Completed Reps,
 * Is AMRAP?,Required RPE,Completed RPE,Log RPE?,Required Weight Value,Required Weight Unit,
 * Completed Weight Value,Completed Weight Unit,Completed Reps Time,Notes...
 */
export function parseLiftosaurCsv(text: string, options?: CsvParseOptions): CsvParseResult {
  const rows = parseRawCsv(text);
  if (rows.length < 2) {
    return {
      source: 'liftosaur',
      workouts: [],
      totalSets: 0,
      totalExercisesCount: 0,
      errors: ['File is empty or contains no data rows.'],
    };
  }

  const headerRow = rows[0];
  const colIndex: Record<string, number> = {};
  headerRow.forEach((col, idx) => {
    colIndex[normalizeHeader(col)] = idx;
  });

  const getCol = (row: string[], colName: string): string => {
    const idx = colIndex[colName];
    return idx !== undefined && idx < row.length ? row[idx].trim() : '';
  };

  const workoutsMap = new Map<string, ParsedCsvWorkout>();
  const workoutSetTimes = new Map<string, number[]>();
  const errors: string[] = [];
  let totalSets = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length === 0 || !row.some((c) => c.length > 0)) continue;

    const rawDateTime = getCol(row, 'workout_datetime');
    const exerciseName = getCol(row, 'exercise');
    if (!exerciseName) continue;

    const compRepsStr = getCol(row, 'completed_reps');
    const compWeightStr = getCol(row, 'completed_weight_value');
    const compTimeStr = getCol(row, 'completed_reps_time');

    // Rule: Skip unperformed planned template sets (where completed reps is empty and completion time or weight is empty)
    if (!compRepsStr && (!compTimeStr || !compWeightStr)) {
      continue;
    }

    const { date, startedAt } = parseDateString(rawDateTime);

    if (options?.startDate && date < options.startDate) continue;
    if (options?.endDate && date > options.endDate) continue;

    const program = getCol(row, 'program');
    const dayName = getCol(row, 'day_name');
    let workoutName = 'Workout';
    if (program && dayName) {
      workoutName = `${program} - ${dayName}`;
    } else if (dayName) {
      workoutName = dayName;
    } else if (program) {
      workoutName = program;
    }

    const workoutKey = `${date}_${workoutName}_${startedAt}`;

    if (!workoutsMap.has(workoutKey)) {
      workoutsMap.set(workoutKey, {
        source: 'liftosaur',
        name: workoutName,
        date,
        startedAt,
        durationSeconds: null,
        notes: null,
        exercises: [],
      });
      workoutSetTimes.set(workoutKey, []);
    }

    const workout = workoutsMap.get(workoutKey)!;
    const times = workoutSetTimes.get(workoutKey)!;

    if (compTimeStr) {
      const parsedTime = new Date(compTimeStr).getTime();
      if (!isNaN(parsedTime)) times.push(parsedTime);
    }

    let exercise = workout.exercises.find((e) => e.rawExerciseName === exerciseName);
    if (!exercise) {
      exercise = {
        rawExerciseName: exerciseName,
        sets: [],
      };
      workout.exercises.push(exercise);
    }

    const rawWeightVal = compWeightStr || getCol(row, 'required_weight_value');
    const rawWeight = parseFloat(rawWeightVal) || 0;
    const rawUnit = (getCol(row, 'completed_weight_unit') || getCol(row, 'required_weight_unit')).toLowerCase();
    const weightUnit: WeightUnit = rawUnit.includes('lb') ? 'lbs' : 'kg';

    const weightKg = weightUnit === 'lbs' ? lbsToKg(rawWeight) : rawWeight;
    const rawInputWeightKg = weightKg;

    const repsVal = compRepsStr || getCol(row, 'required_reps');
    const reps = parseInt(repsVal, 10) || 0;

    const rawRpe = getCol(row, 'completed_rpe') || getCol(row, 'required_rpe');
    const rpe = rawRpe ? parseFloat(rawRpe) : null;
    const rir = rpe != null ? Math.max(0, 10 - rpe) : null;

    const setNotes = getCol(row, 'notes');
    const rawIsAmrap = getCol(row, 'is_amrap').toLowerCase();
    const isAmrap = rawIsAmrap === '1' || rawIsAmrap === 'true' || (setNotes ? setNotes.toLowerCase().includes('amrap') : false);
    const effectiveRpe = rpe && !isNaN(rpe) ? rpe : (isAmrap ? 10.0 : null);
    const effectiveRir = rir && !isNaN(rir) ? rir : (isAmrap ? 0.0 : null);

    const isWarmup = getCol(row, 'is_warmup_set') === '1';
    const setType: SetType = isWarmup ? 'warmup' : 'working';

    const setNumber = exercise.sets.length + 1;

    exercise.sets.push({
      setNumber,
      weight: rawWeight,
      weightUnit,
      weightKg,
      rawInputWeightKg,
      reps,
      repsRight: null,
      rpe: effectiveRpe,
      rir: effectiveRir,
      setType,
      notes: setNotes || null,
      exerciseGroupId: null,
    });

    totalSets++;
  }

  // Calculate duration if timestamps exist
  for (const [key, times] of workoutSetTimes.entries()) {
    if (times.length >= 2) {
      const minT = Math.min(...times);
      const maxT = Math.max(...times);
      if (maxT > minT) {
        const w = workoutsMap.get(key);
        if (w) {
          w.durationSeconds = Math.round((maxT - minT) / 1000);
        }
      }
    }
  }

  const workouts = Array.from(workoutsMap.values());
  const uniqueExercises = new Set<string>();
  workouts.forEach((w) => w.exercises.forEach((e) => uniqueExercises.add(e.rawExerciseName)));

  return {
    source: 'liftosaur',
    workouts,
    totalSets,
    totalExercisesCount: uniqueExercises.size,
    errors,
  };
}

// ============================================================================
// StrengthLog Training CSV Parser
// ============================================================================

/**
 * Parses StrengthLog training CSV exports.
 * Typical headers: workout,start,end,exercise,specialset,weight,bodyweight,extraWeight,distanceKM,reps,warmup,max,fail,checked,setComment,workoutComment...
 */
export function parseStrengthLogTrainingCsv(text: string, options?: CsvParseOptions): CsvParseResult {
  const rows = parseRawCsv(text);
  if (rows.length < 2) {
    return {
      source: 'strengthlog',
      workouts: [],
      totalSets: 0,
      totalExercisesCount: 0,
      errors: ['File is empty or contains no data rows.'],
    };
  }

  const headerRow = rows[0];
  const colIndex: Record<string, number> = {};
  headerRow.forEach((col, idx) => {
    colIndex[normalizeHeader(col)] = idx;
  });

  const getCol = (row: string[], colName: string): string => {
    const idx = colIndex[colName];
    return idx !== undefined && idx < row.length ? row[idx].trim() : '';
  };

  const workoutsMap = new Map<string, ParsedCsvWorkout>();
  const errors: string[] = [];
  let totalSets = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length === 0 || !row.some((c) => c.length > 0)) continue;

    const exerciseName = getCol(row, 'exercise');
    if (!exerciseName) continue;

    const repsRaw = getCol(row, 'reps');
    const checked = getCol(row, 'checked');
    const isFail = getCol(row, 'fail') === 'true';

    const reps = parseInt(repsRaw, 10);
    // Rule: Skip unperformed planned sets (empty reps or 0 reps without checkmark and not failed)
    if (isNaN(reps) || (reps === 0 && !checked && !isFail)) {
      continue;
    }

    const startMs = parseInt(getCol(row, 'start'), 10);
    const endMs = parseInt(getCol(row, 'end'), 10);
    const startedAt = !isNaN(startMs)
      ? new Date(startMs).toISOString()
      : new Date().toISOString();
    const date = startedAt.split('T')[0];

    if (options?.startDate && date < options.startDate) continue;
    if (options?.endDate && date > options.endDate) continue;

    const workoutName = getCol(row, 'workout') || 'Workout';
    const workoutKey = `${date}_${workoutName}_${startedAt}`;

    if (!workoutsMap.has(workoutKey)) {
      const workoutNotes = getCol(row, 'workoutcomment');
      let durationSeconds: number | null = null;
      if (!isNaN(startMs) && !isNaN(endMs) && endMs > startMs) {
        durationSeconds = Math.round((endMs - startMs) / 1000);
      }

      workoutsMap.set(workoutKey, {
        source: 'strengthlog',
        name: workoutName,
        date,
        startedAt,
        durationSeconds,
        notes: workoutNotes || null,
        exercises: [],
      });
    }

    const workout = workoutsMap.get(workoutKey)!;

    let exercise = workout.exercises.find((e) => e.rawExerciseName === exerciseName);
    if (!exercise) {
      exercise = {
        rawExerciseName: exerciseName,
        sets: [],
      };
      workout.exercises.push(exercise);
    }

    const weightVal = parseFloat(getCol(row, 'weight'));
    const extraVal = parseFloat(getCol(row, 'extraweight'));
    // StrengthLog canonical weights are in kg
    const weightKg = !isNaN(weightVal) ? weightVal : (!isNaN(extraVal) ? extraVal : 0);
    const rawInputWeightKg = weightKg;

    const isWarmup = getCol(row, 'warmup') === 'true';
    const setType: SetType = isWarmup ? 'warmup' : 'working';

    const setNotes = getCol(row, 'setcomment');
    const isAmrap = setNotes ? setNotes.toLowerCase().includes('amrap') : false;
    const isFailureSet = isFail || isAmrap;
    const rpe = isFailureSet ? 10.0 : null;
    const rir = isFailureSet ? 0.0 : null;
    const setNumber = exercise.sets.length + 1;

    exercise.sets.push({
      setNumber,
      weight: weightKg,
      weightUnit: 'kg',
      weightKg,
      rawInputWeightKg,
      reps,
      repsRight: null,
      rpe,
      rir,
      setType,
      notes: setNotes || null,
      exerciseGroupId: null,
    });

    totalSets++;
  }

  const workouts = Array.from(workoutsMap.values());
  const uniqueExercises = new Set<string>();
  workouts.forEach((w) => w.exercises.forEach((e) => uniqueExercises.add(e.rawExerciseName)));

  return {
    source: 'strengthlog',
    workouts,
    totalSets,
    totalExercisesCount: uniqueExercises.size,
    errors,
  };
}

// ============================================================================
// StrengthLog Body Composition CSV Parser
// ============================================================================

/**
 * Parses StrengthLog body composition CSV exports into BodyMetric records.
 * Headers: type,timestamp,value,unit
 */
export function parseStrengthLogBodyCompCsv(
  text: string,
  options?: CsvParseOptions
): { metrics: BodyMetric[]; errors: string[] } {
  const rows = parseRawCsv(text);
  if (rows.length < 2) {
    return { metrics: [], errors: ['File is empty or contains no data rows.'] };
  }

  const byDate = new Map<string, BodyMetric>();
  const errors: string[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length < 3) continue;

    const type = row[0].trim().toLowerCase();
    const ts = parseInt(row[1].trim(), 10);
    const val = parseFloat(row[2].trim());

    if (isNaN(ts) || isNaN(val)) continue;

    const date = new Date(ts).toISOString().split('T')[0];
    if (options?.startDate && date < options.startDate) continue;
    if (options?.endDate && date > options.endDate) continue;

    if (!byDate.has(date)) {
      byDate.set(date, {
        id: `bm_imp_${date}`,
        date,
        bodyweight: null,
        body_fat_manual: null,
        waist_cm: null,
        neck_cm: null,
        hip_cm: null,
        bicep_cm: null,
        chest_cm: null,
        thigh_cm: null,
        calf_cm: null,
        navy_body_fat: null,
        imported_from: 'strengthlog',
      });
    }

    const m = byDate.get(date)!;
    if (type === 'bodyweight') {
      m.bodyweight = val > 0 ? val : null;
    } else if (type === 'body-comp') {
      m.body_fat_manual = val;
    } else if (type === 'waist') {
      m.waist_cm = val;
    } else if (type === 'neck') {
      m.neck_cm = val;
    } else if (type === 'hips') {
      m.hip_cm = val;
    } else if (type === 'chest') {
      m.chest_cm = val;
    } else if (type === 'right-upperarm' || type === 'left-upperarm') {
      m.bicep_cm = val;
    } else if (type === 'right-thigh') {
      m.thigh_cm = val;
    } else if (type === 'right-calf') {
      m.calf_cm = val;
    }
  }

  // Sort chronologically ascending
  const metrics = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  return { metrics, errors };
}

// ============================================================================
// Main Dispatcher
// ============================================================================

/**
 * Universal workout CSV parser dispatching to the appropriate parser based on formatHint
 * or automatic header detection.
 */
export function parseWorkoutCsv(
  text: string,
  formatHint?: ImportSource,
  customMapping?: Partial<CsvColumnMapping>,
  options?: CsvParseOptions
): CsvParseResult {
  const rows = parseRawCsv(text);
  if (rows.length < 2) {
    return {
      source: formatHint || 'csv',
      workouts: [],
      totalSets: 0,
      totalExercisesCount: 0,
      errors: ['File is empty or contains no valid CSV rows.'],
    };
  }

  const detected = formatHint || detectCsvFormat(rows[0]);

  switch (detected) {
    case 'liftosaur':
      return parseLiftosaurCsv(text, options);
    case 'strengthlog':
      return parseStrengthLogTrainingCsv(text, options);
    case 'strong':
      return parseStrongCsv(text);
    case 'hevy':
      return parseHevyCsv(text);
    case 'csv':
    default:
      return parseGenericCsv(text, customMapping);
  }
}
