/**
 * Workout Suite — CSV Import Parser Unit Tests
 *
 * Verifies Step 2.4: Pure RFC 4180 parsing, Strong CSV, Hevy CSV, and generic column-mapped CSVs.
 */

import {
  parseRawCsv,
  detectCsvFormat,
  normalizeHeader,
  parseDateString,
  parseDurationSeconds,
  mapSetType,
  parseStrongCsv,
  parseHevyCsv,
  parseGenericCsv,
  parseWorkoutCsv,
} from '../csvImportParser';

describe('CSV Import Parser', () => {
  describe('Low-Level RFC 4180 Tokenizer', () => {
    it('parses simple comma-separated values', () => {
      const csv = 'Date,Workout Name,Exercise Name\n2026-06-25,Push Day,Bench Press\n2026-06-26,Pull Day,Deadlift';
      const rows = parseRawCsv(csv);
      expect(rows).toHaveLength(3);
      expect(rows[0]).toEqual(['Date', 'Workout Name', 'Exercise Name']);
      expect(rows[1]).toEqual(['2026-06-25', 'Push Day', 'Bench Press']);
      expect(rows[2]).toEqual(['2026-06-26', 'Pull Day', 'Deadlift']);
    });

    it('parses semicolon-separated values automatically', () => {
      const csv = 'Date;Workout Name;Exercise Name\n2026-06-25;Leg Day;Squat\n2026-06-27;Arm Day;Curl';
      const rows = parseRawCsv(csv);
      expect(rows).toHaveLength(3);
      expect(rows[0]).toEqual(['Date', 'Workout Name', 'Exercise Name']);
      expect(rows[1]).toEqual(['2026-06-25', 'Leg Day', 'Squat']);
    });

    it('handles quoted fields with commas and semicolons', () => {
      const csv = 'Name,Notes,Weight\n"Barbell Bench Press","Heavy, with pause; good tempo",100';
      const rows = parseRawCsv(csv);
      expect(rows).toHaveLength(2);
      expect(rows[1][0]).toBe('Barbell Bench Press');
      expect(rows[1][1]).toBe('Heavy, with pause; good tempo');
      expect(rows[1][2]).toBe('100');
    });

    it('handles escaped double quotes ("")', () => {
      const csv = 'Name,Notes\n"Dumbbell Press","Using the ""heavy"" 30kg bells"';
      const rows = parseRawCsv(csv);
      expect(rows).toHaveLength(2);
      expect(rows[1][1]).toBe('Using the "heavy" 30kg bells');
    });

    it('handles multiline fields within quotes and CRLF line breaks', () => {
      const csv = 'Date,Notes\r\n2026-06-25,"Line 1\r\nLine 2\r\nLine 3"';
      const rows = parseRawCsv(csv);
      expect(rows).toHaveLength(2);
      expect(rows[1][1]).toContain('Line 1');
      expect(rows[1][1]).toContain('Line 2');
    });

    it('ignores empty trailing lines', () => {
      const csv = 'Header1,Header2\nVal1,Val2\n\n   \n';
      const rows = parseRawCsv(csv);
      expect(rows).toHaveLength(2);
    });
  });

  describe('Format Detection & Header Normalization', () => {
    it('normalizes header names cleanly', () => {
      expect(normalizeHeader('  Workout Name  ')).toBe('workout_name');
      expect(normalizeHeader('Exercise Title (Barbell)')).toBe('exercise_title_barbell');
      expect(normalizeHeader('Weight-lbs')).toBe('weight_lbs');
      expect(normalizeHeader('Set Order')).toBe('set_order');
    });

    it('detects Strong App CSV headers', () => {
      const headers = ['Date', 'Workout Name', 'Exercise Name', 'Set Order', 'Weight', 'Weight Unit', 'Reps', 'RPE'];
      expect(detectCsvFormat(headers)).toBe('strong');
    });

    it('detects Hevy App CSV headers', () => {
      const headers = ['title', 'start_time', 'end_time', 'description', 'exercise_title', 'superset_id', 'set_index', 'set_type', 'weight_kg', 'reps'];
      expect(detectCsvFormat(headers)).toBe('hevy');
    });

    it('falls back to generic csv for unrecognized headers', () => {
      const headers = ['day', 'lift', 'kilograms', 'count'];
      expect(detectCsvFormat(headers)).toBe('csv');
    });
  });

  describe('Date & Duration Parsing', () => {
    it('parses standard ISO date timestamps', () => {
      const res = parseDateString('2026-06-25 09:45:13');
      expect(res.date).toBe('2026-06-25');
      expect(res.startedAt).toBe('2026-06-25T09:45:13.000Z');
    });

    it('parses Hevy textual date format', () => {
      const res = parseDateString('15 Jul 2026, 09:52');
      expect(res.date).toBe('2026-07-15');
      expect(res.startedAt).toBe('2026-07-15T09:52:00.000Z');
    });

    it('parses slash date formats (DD/MM/YYYY)', () => {
      const res = parseDateString('25/06/2026 14:30');
      expect(res.date).toBe('2026-06-25');
      expect(res.startedAt).toBe('2026-06-25T14:30:00.000Z');
    });

    it('parses duration strings into seconds', () => {
      expect(parseDurationSeconds('1h 14m')).toBe(4440);
      expect(parseDurationSeconds('45m')).toBe(2700);
      expect(parseDurationSeconds('2h')).toBe(7200);
      expect(parseDurationSeconds('01:14:00')).toBe(4440);
      expect(parseDurationSeconds('3600')).toBe(3600);
      expect(parseDurationSeconds(null)).toBeNull();
      expect(parseDurationSeconds('')).toBeNull();
    });

    it('maps set type indicators accurately', () => {
      expect(mapSetType('W')).toBe('warmup');
      expect(mapSetType('warmup')).toBe('warmup');
      expect(mapSetType('D')).toBe('drop');
      expect(mapSetType('dropset')).toBe('drop');
      expect(mapSetType('F')).toBe('failure');
      expect(mapSetType('failure')).toBe('failure');
      expect(mapSetType('myorep')).toBe('myorep');
      expect(mapSetType('1')).toBe('working');
      expect(mapSetType('normal')).toBe('working');
    });
  });

  describe('Strong App CSV Parser', () => {
    it('parses a complete Strong export with semicolon delimiter and mixed units', () => {
      const strongCsv = `Date;Workout Name;Exercise Name;Set Order;Weight;Weight Unit;Reps;RPE;Distance;Distance Unit;Seconds;Notes;Workout Notes;Workout Duration
2026-06-25 09:45:13;Full Body A;Barbell Bench Press;1;100;kg;8;8;;;;First set easy;Felt strong today;1h 15m
2026-06-25 09:45:13;Full Body A;Barbell Bench Press;2;100;kg;8;8.5;;;;Beltless;Felt strong today;1h 15m
2026-06-25 09:45:13;Full Body A;Barbell Bench Press;W;60;kg;10;;;;Warmup set;Felt strong today;1h 15m
2026-06-25 09:45:13;Full Body A;Barbell Back Squat;1;315;lbs;5;9;;;;Heavy triple;Felt strong today;1h 15m
2026-06-27 10:00:00;Upper B;Overhead Press (OHP);1;60;kg;6;8;;;;Strict;Quick session;45m`;

      const result = parseStrongCsv(strongCsv);
      expect(result.source).toBe('strong');
      expect(result.workouts).toHaveLength(2);
      expect(result.totalSets).toBe(5);
      expect(result.totalExercisesCount).toBe(3);

      const w1 = result.workouts[0];
      expect(w1.name).toBe('Full Body A');
      expect(w1.date).toBe('2026-06-25');
      expect(w1.durationSeconds).toBe(4500); // 1h 15m
      expect(w1.notes).toBe('Felt strong today');
      expect(w1.exercises).toHaveLength(2);

      const bench = w1.exercises[0];
      expect(bench.rawExerciseName).toBe('Barbell Bench Press');
      expect(bench.sets).toHaveLength(3);
      expect(bench.sets[0].weightKg).toBe(100);
      expect(bench.sets[0].reps).toBe(8);
      expect(bench.sets[0].rpe).toBe(8);
      expect(bench.sets[0].rir).toBe(2);
      expect(bench.sets[0].setType).toBe('working');
      expect(bench.sets[0].notes).toBe('First set easy');

      const warmupSet = bench.sets[2];
      expect(warmupSet.setType).toBe('warmup');
      expect(warmupSet.weightKg).toBe(60);

      const squat = w1.exercises[1];
      expect(squat.rawExerciseName).toBe('Barbell Back Squat');
      expect(squat.sets).toHaveLength(1);
      // 315 lbs converted to kg canonical
      expect(squat.sets[0].weightUnit).toBe('lbs');
      expect(squat.sets[0].weight).toBe(315);
      expect(squat.sets[0].weightKg).toBeCloseTo(142.88, 1);
      expect(squat.sets[0].rawInputWeightKg).toBeCloseTo(142.88, 1);

      const w2 = result.workouts[1];
      expect(w2.name).toBe('Upper B');
      expect(w2.date).toBe('2026-06-27');
      expect(w2.durationSeconds).toBe(2700); // 45m
      expect(w2.exercises[0].rawExerciseName).toBe('Overhead Press (OHP)');
    });
  });

  describe('Hevy App CSV Parser', () => {
    it('parses a complete Hevy export with supersets and timestamps', () => {
      const hevyCsv = `title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe
Legs & Abs,"15 Jul 2026, 09:30","15 Jul 2026, 10:30","Squat focus session",Barbell Back Squat,,Heavy,1,normal,140,5,,,8.5
Legs & Abs,"15 Jul 2026, 09:30","15 Jul 2026, 10:30","Squat focus session",Barbell Back Squat,,,2,normal,140,5,,,9
Legs & Abs,"15 Jul 2026, 09:30","15 Jul 2026, 10:30","Squat focus session",Leg Extension,superset_1,Burnout,1,dropset,60,12,,,10
Legs & Abs,"15 Jul 2026, 09:30","15 Jul 2026, 10:30","Squat focus session",Seated Leg Curl,superset_1,,1,normal,50,12,,,8`;

      const result = parseHevyCsv(hevyCsv);
      expect(result.source).toBe('hevy');
      expect(result.workouts).toHaveLength(1);
      expect(result.totalSets).toBe(4);
      expect(result.totalExercisesCount).toBe(3);

      const w = result.workouts[0];
      expect(w.name).toBe('Legs & Abs');
      expect(w.date).toBe('2026-07-15');
      expect(w.durationSeconds).toBe(3600); // 1h
      expect(w.notes).toBe('Squat focus session');

      const squat = w.exercises[0];
      expect(squat.sets[0].weightKg).toBe(140);
      expect(squat.sets[0].setType).toBe('working');
      expect(squat.sets[0].rpe).toBe(8.5);

      const legExt = w.exercises[1];
      expect(legExt.sets[0].setType).toBe('drop');
      expect(legExt.sets[0].exerciseGroupId).toBe('superset_1');

      const legCurl = w.exercises[2];
      expect(legCurl.sets[0].exerciseGroupId).toBe('superset_1');
    });

    it('handles weight_lbs column in Hevy export', () => {
      const hevyCsv = `title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_lbs,reps,distance_miles,duration_seconds,rpe
Push,"20 Jul 2026, 18:00","20 Jul 2026, 19:00",Notes,Incline Barbell Bench Press,,Set note,1,normal,200,6,,,8`;

      const result = parseHevyCsv(hevyCsv);
      expect(result.workouts).toHaveLength(1);
      const set = result.workouts[0].exercises[0].sets[0];
      expect(set.weight).toBe(200);
      expect(set.weightUnit).toBe('lbs');
      expect(set.weightKg).toBeCloseTo(90.72, 1);
    });
  });

  describe('Generic / Custom Column-Mapped CSV Parser', () => {
    it('parses generic CSV with auto-inferred columns', () => {
      const genericCsv = `Date,Routine,Exercise,Weight,Reps,RPE,Notes
2026-08-01,Day 1,Conventional Deadlift,180,5,8.5,Paused reps
2026-08-01,Day 1,Conventional Deadlift,180,5,9.0,
2026-08-01,Day 1,Pull-Up,0,10,8.0,Bodyweight`;

      const result = parseGenericCsv(genericCsv);
      expect(result.source).toBe('csv');
      expect(result.workouts).toHaveLength(1);
      expect(result.totalSets).toBe(3);
      expect(result.workouts[0].name).toBe('Day 1');
      expect(result.workouts[0].exercises).toHaveLength(2);
      expect(result.workouts[0].exercises[0].sets[0].weightKg).toBe(180);
    });

    it('parses generic CSV with explicit column mapping', () => {
      const customCsv = `SessionDate,CustomLift,LoadKg,RepCount,EffortScore
2026-08-05,Barbell Hip Thrust,120,10,8`;

      const result = parseGenericCsv(customCsv, {
        dateColumn: 'SessionDate',
        exerciseNameColumn: 'CustomLift',
        weightColumn: 'LoadKg',
        repsColumn: 'RepCount',
        rpeColumn: 'EffortScore',
        defaultWeightUnit: 'kg',
      });

      expect(result.workouts).toHaveLength(1);
      const w = result.workouts[0];
      expect(w.date).toBe('2026-08-05');
      expect(w.exercises[0].rawExerciseName).toBe('Barbell Hip Thrust');
      expect(w.exercises[0].sets[0].weightKg).toBe(120);
      expect(w.exercises[0].sets[0].reps).toBe(10);
      expect(w.exercises[0].sets[0].rpe).toBe(8);
    });
  });

  describe('Universal parseWorkoutCsv Dispatcher', () => {
    it('auto-dispatches to Strong parser when Strong headers are provided', () => {
      const strongCsv = `Date;Workout Name;Exercise Name;Set Order;Weight;Weight Unit;Reps;RPE
2026-06-25;Upper;Barbell Bench Press;1;100;kg;8;8`;

      const result = parseWorkoutCsv(strongCsv);
      expect(result.source).toBe('strong');
      expect(result.workouts).toHaveLength(1);
    });

    it('auto-dispatches to Hevy parser when Hevy headers are provided', () => {
      const hevyCsv = `title,start_time,end_time,description,exercise_title,superset_id,set_index,set_type,weight_kg,reps
Upper,"15 Jul 2026, 09:30","15 Jul 2026, 10:30",,Barbell Bench Press,,1,normal,100,8`;

      const result = parseWorkoutCsv(hevyCsv);
      expect(result.source).toBe('hevy');
      expect(result.workouts).toHaveLength(1);
    });

    it('handles empty string or single header gracefully', () => {
      const emptyResult = parseWorkoutCsv('');
      expect(emptyResult.workouts).toHaveLength(0);
      expect(emptyResult.errors.length).toBeGreaterThan(0);

      const headerOnly = parseWorkoutCsv('Date,Workout Name,Exercise Name');
      expect(headerOnly.workouts).toHaveLength(0);
    });
  });
});
