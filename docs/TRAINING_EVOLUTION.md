# Automatic training evolution

This describes implemented mobile policy for beginners and intermediates. Thresholds are engineering defaults, not validated physiological cutoffs or evidence of measured muscle growth.

## Decisions and ownership

- `core/rules/trainingAdaptation.ts`: deterministic effort/load math, comparable-exposure classification, strength roles, equipment eligibility and scheduling estimates.
- `services/trainingAdaptationService.ts`: settings-backed state and snapshots, recovery overrides, pain returns, and completed-session processing.
- `services/programEvolutionService.ts`: block review and activation, preference/mood adjustments and companion evidence gates.
- `workoutPreviewService.ts`: shared Home/preflight/startup resolution, load normalization and legacy-rule suppression during automatic management.
- Logger: final working-set RIR/RPE entry, immediate pain stops, completion processing and automatic review. Router retries unprocessed completed snapshots before the next session.

## Stable training and comparison

Four weeks is the initial accumulation length, expressed as preferred training days multiplied by weeks. Only completed workouts belonging to this program count. New snapshots include block IDs so the last workout of an old block cannot count again on a same-day transition. Calendar time without training does not finish a block.

Productive prescriptions retain exercises, identities, rules, sets, reps and effort. Flat performance is four consecutive comparable exposures with identical total reps; it permits a small adjustment next block, without asserting that muscle growth stopped. Comparison requires identical exercise/gear, prescribed set count, rep range, target effort, rest/grouping prescription, and planned/actual load vectors. Reported final-set effort must be within one RIR. An incomparable exposure breaks the streak; unknown effort provides no comparable evidence. Unilateral totals use the lower limb's rep count.

A miss is a rep count below the minimum or lower total reps than the prior comparable exposure. Incomplete prescribed work also counts as a miss. Two consecutive misses establish deterioration. Two distinct deteriorating main movements trigger systemic recovery for strength/powerbuilding; hypertrophy counts two distinct exercises without a main designation. Default strength mains are squat, bench, deadlift and overhead press, independent of session order; exercise detail offers an override. An isolated stall waits for block review.

## Block adjustments and preferences

The initial sequence is a 10% load reset, rep-range adjustment, available variation, then a one-set reduction. An anchor prevents the variation step. Disliked/blacklisted candidates are excluded, liked candidates rank higher, and equipment access is respected. If a disliked exercise has no acceptable replacement, review reports an error rather than inventing a substitution.

Fury nudges justified changes toward lower RIR; Precision favors repeatable effort of at least two RIR; Get Out favors time-efficient execution. Mood alone no longer reduces set counts. Explicit staged mood changes can also nudge next-block effort, including main lifts. Initial generation allocates weekly experience-based volume targets, reserves direct arms/core and reports unmet targets. These are starting defaults, not equivalent-stimulus/eRep calculations. Evolution does not increase days or the session-time preference and does not strip productive sets to make a time estimate fit. It first tries compatible accessory groups and, for hypertrophy goals, prescribed shorter accessory rest. Strength compound recovery is preserved. The shared estimator includes warm-up/setup and actual stored rest; any remaining time conflict is reported for review. Estimates do not guarantee actual gym duration.

Time fitting can pair eligible antagonistic compounds when no strength-main protection or axial-load exclusion applies. If unpaired suitable work still exceeds the budget, structured myo/DC can replace straight-set execution: the actual activation and mini rows, reps and rests are stored and explained. Full sets and minis remain separate; estimated stimulating reps provide a conservative, uncertain compressed-dose comparison against the starting target, without claiming exact set equivalence. Generic progression evaluates activation sets rather than treating the short mini reps as failed full sets. Adaptation includes protocol/rest/grouping in comparability and checks mini reps against their own range; pain-return and deload previews suppress clusters. Fresh Get Out generation rejects a remaining overrun instead of activating an over-budget plan.

## Fatigue and recovery

Recovery lasts one week's preferred number of completed sessions. Sets, rep ranges and exercises are retained; target RIR increases by two, with a minimum of four. Progression is suspended. Recovery snapshots are excluded from performance-stall evidence and local strength updates. Completion retries cannot consume extra recovery sessions.

After recovery, the next block begins one RIR easier than its normal prescription. That introductory effort lasts one performed exposure per slot, then the stored normal target is restored. Subsequent block review preserves successful training rather than automatically increasing volume.

## Pain return

Pain 7–10 stops all unfinished sets of the affected exercise, preserving completed sets. The next exposure starts at 50% estimated 1RM. Without an eligible estimate, the fallback is half the last known working load. Any reported returning discomfort stops remaining sets and schedules a next-exposure substitution, overriding an anchor. If no compatible substitute exists, the slot is omitted and preflight explains the omission.

Only the first return session shows the automatic discomfort prompt; manual reporting remains available. Each completed return without a discomfort report increases the recovery load factor by five percentage points of a fixed pre-return reference. The rebuild stops at the normal prescription's estimated load, rather than approaching maximal strength. Ordinary prescription-based loading then resumes. Pain recovery evidence does not establish a plateau or update local strength.

## Personalized prediction and evidence

Load prediction reverses the exercise model: `load = e1RM / (reps + RIR)^k`. The companion's e10RM is a projection of this same curve, not independent corroboration. Ordinary predictions support 1–10 reps at 0–4 RIR; recovery permits up to eight RIR. Local strength updates use the median eligible rated working-set capacity, with 1–10 reps and 0–3 RIR, retaining personalized `k`. Pre-calibration observations do not overwrite a newer companion strength level. Late imports are ordered by workout date. Loads are converted back to entered/per-hand/cable/bodyweight values and floor-rounded to the existing 0.5 kg default.

Companion exports carry actual Kalman histories into mesocycle analysis. Explicit completed block intervals and snapshot membership take precedence over inferred deload troughs when available. Exported snapshots exclude fatigue/pain recovery work from strength calibration while retaining actual work for workload analysis. `mesocycle_feedback` includes accumulation weeks, confidence score/tier, contributing block count, rated-exposure coverage, observation/export dates, and goal. Mobile requires matching goal, four contributing blocks, score at least 45, non-LOW confidence, at least 50% rated exercise-exposure coverage, and observation/export ages no greater than 42 days. Future dates are rejected. Length is bounded to 3–12 weeks; a currently progressing block retains its length. Missing, stale or insufficient feedback retains the current length. These gates qualify existing model output; they do not validate the model's physiological assumptions.

## Persistence and validation

State uses existing `user_settings` keys: `training_state_<programId>`, `training_snapshot_<workoutId>`, `training_processed_<workoutId>`, `training_ease_<slotId>`, `training_exercise_controls`, `training_personal_curves`, and `training_meso_feedback`. Curves also remain in `calibrated_params`; clearing calibration removes its prediction cache and mesocycle feedback. Existing programs accumulate new comparable snapshots rather than inferring historical target effort from logged effort.

The JSON Schema and companion Pydantic envelope both accept optional `mesocycle_feedback`; legacy calibration files remain accepted. Relevant checks are service integration tests, generator/preview/logger callers, full mobile Jest and typecheck, companion pytest/mypy, ordered transfer contract checks and generated documentation checks described in [VALIDATION.md](VALIDATION.md). Native UI behavior still requires device validation.
