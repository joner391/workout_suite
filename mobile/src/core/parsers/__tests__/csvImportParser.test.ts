/**
 * Workout Suite — CSV Import Parser Unit Tests
 *
 * Verifies Step 2.4: Pure RFC 4180 parsing, Strong CSV, Hevy CSV, and generic column-mapped CSVs.
 */

import {
  parseRawCsv,
  detectCsvFormat,
  isStrengthLogBodyCompCsv,
  normalizeHeader,
  parseDateString,
  parseDurationSeconds,
  mapSetType,
  parseStrongCsv,
  parseHevyCsv,
  parseGenericCsv,
  parseWorkoutCsv,
  parseLiftosaurCsv,
  parseStrengthLogTrainingCsv,
  parseStrengthLogBodyCompCsv,
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
      expect(mapSetType('F')).toBe('working');
      expect(mapSetType('failure')).toBe('working');
      expect(mapSetType('myorep')).toBe('myorep');
      expect(mapSetType('myo')).toBe('myorep');
      expect(mapSetType('DC')).toBe('dc');
      expect(mapSetType('doggcrapp')).toBe('dc');
      expect(mapSetType('amrap')).toBe('amrap');
      expect(mapSetType('AMRAP')).toBe('amrap');
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

    it('auto-dispatches to Liftosaur parser when Liftosaur headers are provided', () => {
      const liftosaurCsv = `Workout DateTime,Program,Day Name,Exercise,Is Warmup Set?,Required Reps,Completed Reps,Completed Weight Value,Completed Weight Unit
2026-10-13T09:18:42.935Z,Bullmastiff,Bench Day,Bench Press,0,5,5,62.5,kg`;

      const result = parseWorkoutCsv(liftosaurCsv);
      expect(result.source).toBe('liftosaur');
      expect(result.workouts).toHaveLength(1);
      expect(result.workouts[0].name).toBe('Bullmastiff - Bench Day');
    });

    it('auto-dispatches to StrengthLog parser when StrengthLog headers are provided', () => {
      const strengthlogCsv = `workout,start,end,exercise,weight,reps,warmup,fail,checked
Upper A,1775031006719,1775034205476,Bench Press,70,5,false,false,1775031975149`;

      const result = parseWorkoutCsv(strengthlogCsv);
      expect(result.source).toBe('strengthlog');
      expect(result.workouts).toHaveLength(1);
      expect(result.workouts[0].name).toBe('Upper A');
    });
  });

  describe('Liftosaur CSV Parser', () => {
    it('parses multi-exercise workouts, RPE, and skips unperformed template rows', () => {
      const csv = `Workout DateTime,Program,Day Name,Exercise,Is Warmup Set?,Required Reps,Completed Reps,Is AMRAP?,Required RPE,Completed RPE,Log RPE?,Required Weight Value,Required Weight Unit,Completed Weight Value,Completed Weight Unit,Ask Weight?,Completed Reps Time,Notes
2026-10-13T09:18:42.935Z,Bullmastiff,Bench Day,Bench Press,1,5,5,0,,,0,20,kg,20,kg,0,2026-10-13T09:18:49.634Z,Warmup note
2026-10-13T09:18:42.935Z,Bullmastiff,Bench Day,Bench Press,0,5,8,1,8,8.5,0,62.5,kg,62.5,kg,0,2026-10-13T09:33:53.294Z,Working AMRAP
2026-10-13T09:18:42.935Z,Bullmastiff,Bench Day,Bench Press,0,6,,0,8,,0,80,kg,,,0,,Unperformed template row
2026-10-13T09:18:42.935Z,Bullmastiff,Bench Day,Face Pull,0,12,12,0,6,7,0,8,kg,15,kg,0,2026-10-13T10:01:39.146Z,`;

      const result = parseLiftosaurCsv(csv);
      expect(result.source).toBe('liftosaur');
      expect(result.workouts).toHaveLength(1);

      const w = result.workouts[0];
      expect(w.name).toBe('Bullmastiff - Bench Day');
      expect(w.date).toBe('2026-10-13');
      expect(w.exercises).toHaveLength(2); // Bench Press and Face Pull

      // Bench Press should have 2 completed sets (1 warmup, 1 working), unperformed set skipped
      const bench = w.exercises.find((e) => e.rawExerciseName === 'Bench Press')!;
      expect(bench.sets).toHaveLength(2);
      expect(bench.sets[0].setType).toBe('warmup');
      expect(bench.sets[0].weightKg).toBe(20);
      expect(bench.sets[0].reps).toBe(5);

      expect(bench.sets[1].setType).toBe('working');
      expect(bench.sets[1].weightKg).toBe(62.5);
      expect(bench.sets[1].reps).toBe(8);
      expect(bench.sets[1].rpe).toBe(8.5);
      expect(bench.sets[1].rir).toBe(1.5);
      expect(bench.sets[1].notes).toBe('Working AMRAP');

      // Duration should be computed between first and last completed reps time
      expect(w.durationSeconds).toBeGreaterThan(0);
    });

    it('respects startDate and endDate options', () => {
      const csv = `Workout DateTime,Program,Day Name,Exercise,Is Warmup Set?,Required Reps,Completed Reps,Completed Weight Value,Completed Weight Unit,Completed Reps Time
2026-05-01T09:00:00.000Z,ProgA,Day 1,Squat,0,5,5,100,kg,2026-05-01T09:10:00.000Z
2026-08-01T09:00:00.000Z,ProgB,Day 2,Bench Press,0,5,5,80,kg,2026-08-01T09:10:00.000Z
2026-10-01T09:00:00.000Z,ProgC,Day 3,Deadlift,0,5,5,140,kg,2026-10-01T09:10:00.000Z`;

      const result = parseLiftosaurCsv(csv, { startDate: '2026-07-01', endDate: '2026-09-01' });
      expect(result.workouts).toHaveLength(1);
      expect(result.workouts[0].date).toBe('2026-08-01');
      expect(result.workouts[0].exercises[0].rawExerciseName).toBe('Bench Press');
    });

    it('automatically evaluates unrated AMRAP sets as 0 RIR / 10 RPE', () => {
      const csv = `Workout DateTime,Program,Day Name,Exercise,Is Warmup Set?,Required Reps,Completed Reps,Is AMRAP?,Required RPE,Completed RPE,Log RPE?,Required Weight Value,Required Weight Unit,Completed Weight Value,Completed Weight Unit,Completed Reps Time,Notes
2026-10-14T09:00:00.000Z,Bullmastiff,Squat Day,Back Squat,0,5,10,1,,,0,100,kg,100,kg,2026-10-14T09:15:00.000Z,AMRAP set`;

      const result = parseLiftosaurCsv(csv);
      const set = result.workouts[0].exercises[0].sets[0];
      expect(set.rpe).toBe(10.0);
      expect(set.rir).toBe(0.0);
      expect(set.setType).toBe('working');
    });
  });

  describe('StrengthLog Training CSV Parser', () => {
    it('parses timestamps, weights, extraWeight, fail sets, and notes', () => {
      const csv = `workout,start,end,exercise,weight,bodyweight,extraWeight,reps,warmup,fail,checked,setComment,workoutComment
Upper A,1775031006719,1775034205476,Bench Press,70,,0,5,false,false,1775031975149,Good pause,Felt strong
Upper A,1775031006719,1775034205476,Bench Press,80,,0,0,false,true,1775033014967,Failed at chest,Felt strong
Upper A,1775031006719,1775034205476,Bench Press,90,,0,0,false,false,,Planned set not done,Felt strong
Upper A,1775031006719,1775034205476,Pull-Up,,85.2,5,5,false,false,1775031243545,Weighted,Felt strong`;

      const result = parseStrengthLogTrainingCsv(csv);
      expect(result.source).toBe('strengthlog');
      expect(result.workouts).toHaveLength(1);

      const w = result.workouts[0];
      expect(w.name).toBe('Upper A');
      expect(w.notes).toBe('Felt strong');
      expect(w.durationSeconds).toBe(Math.round((1775034205476 - 1775031006719) / 1000));
      expect(w.exercises).toHaveLength(2); // Bench Press & Pull-Up

      const bench = w.exercises.find((e) => e.rawExerciseName === 'Bench Press')!;
      // 3 sets: 1 successful, 1 fail set, 1 unperformed skipped
      expect(bench.sets).toHaveLength(2);
      expect(bench.sets[0].weightKg).toBe(70);
      expect(bench.sets[0].reps).toBe(5);
      expect(bench.sets[0].notes).toBe('Good pause');

      // Fail set
      expect(bench.sets[1].weightKg).toBe(80);
      expect(bench.sets[1].reps).toBe(0);
      expect(bench.sets[1].rpe).toBe(10);
      expect(bench.sets[1].rir).toBe(0);

      // Pull-Up with extraWeight
      const pullUp = w.exercises.find((e) => e.rawExerciseName === 'Pull-Up')!;
      expect(pullUp.sets).toHaveLength(1);
      expect(pullUp.sets[0].weightKg).toBe(5);
      expect(pullUp.sets[0].reps).toBe(5);
    });

    it('respects startDate and endDate options', () => {
      // 1711033200000 = 2024-03-21, 1775031006719 = 2026-04-01
      const csv = `workout,start,end,exercise,weight,reps,warmup,fail,checked
Old Workout,1711033200000,1711036800000,Squat,80,5,false,false,1711034000000
New Workout,1775031006719,1775034205476,Squat,100,5,false,false,1775032000000`;

      const result = parseStrengthLogTrainingCsv(csv, { startDate: '2026-01-01' });
      expect(result.workouts).toHaveLength(1);
      expect(result.workouts[0].name).toBe('New Workout');
    });

    it('evaluates AMRAP set comments as 0 RIR / 10 RPE', () => {
      const csv = `workout,start,end,exercise,weight,bodyweight,extraWeight,reps,warmup,fail,checked,setComment,workoutComment
Leg Day,1760432400000,1760436000000,Barbell Squat,120,,0,8,false,false,true,AMRAP set,Heavy lower`;

      const result = parseStrengthLogTrainingCsv(csv);
      const set = result.workouts[0].exercises[0].sets[0];
      expect(set.rpe).toBe(10.0);
      expect(set.rir).toBe(0.0);
    });
  });

  describe('StrengthLog Body Composition CSV Parser', () => {
    it('parses bodyweight, body fat %, and circumference measurements grouped by date', () => {
      const csv = `type,timestamp,value,unit
bodyweight,1767171881662,83,kg
body-comp,1767172155336,22.6,%
waist,1767172155336,87,cm
neck,1767172155336,39.5,cm
hips,1767172155336,102,cm
right-upperarm,1767172155336,37,cm
right-thigh,1767172155336,60,cm
right-calf,1767172155336,38,cm`;

      const result = parseStrengthLogBodyCompCsv(csv);
      expect(result.errors).toHaveLength(0);
      expect(result.metrics).toHaveLength(1);

      const m = result.metrics[0];
      expect(m.date).toBe('2025-12-31');
      expect(m.bodyweight).toBe(83);
      expect(m.body_fat_manual).toBe(22.6);
      expect(m.waist_cm).toBe(87);
      expect(m.neck_cm).toBe(39.5);
      expect(m.hip_cm).toBe(102);
      expect(m.bicep_cm).toBe(37);
      expect(m.thigh_cm).toBe(60);
      expect(m.calf_cm).toBe(38);
    });

    it('identifies body comp header with isStrengthLogBodyCompCsv', () => {
      expect(isStrengthLogBodyCompCsv(['type', 'timestamp', 'value', 'unit'])).toBe(true);
      expect(isStrengthLogBodyCompCsv(['workout', 'start', 'end', 'exercise'])).toBe(false);
    });

    it('parses circumference-only measurements with null bodyweight when no bodyweight row is present', () => {
      const csv = `type,timestamp,value,unit
waist,1715212800000,87,cm
chest,1715212800000,103,cm
right-upperarm,1715212800000,31.5,cm`;

      const result = parseStrengthLogBodyCompCsv(csv);
      expect(result.errors).toHaveLength(0);
      expect(result.metrics).toHaveLength(1);

      const m = result.metrics[0];
      expect(m.bodyweight).toBeNull();
      expect(m.waist_cm).toBe(87);
      expect(m.chest_cm).toBe(103);
      expect(m.bicep_cm).toBe(31.5);
    });
  });
});
