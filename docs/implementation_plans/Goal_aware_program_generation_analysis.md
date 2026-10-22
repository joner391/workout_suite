# Goal-aware program generation: analysis and proposed policy

Initial audit: 2026-10-21. Updated requirements and corrective implementation: 2026-10-22. Original audit findings below describe the old source. The current implementation and remaining work are distinguished here.

## Latest changes: density, advanced volume and Fury variations

- Get Out generation now treats the scheduling budget as a constraint. It pairs eligible chest/back, shoulder/back and accessory antagonists, supports unequal rounds, and uses structured myo/DC only for unpaired suitable exercises when this saves time. If these options and coverage-aware reductions still cannot fit the budget, generation fails explicitly before saving/activation.
- Squats, deadlifts/hinges, exercises flagged high axial load and protected strength work are excluded from automatic rest-pause conversion. High-axial/free squat/hinge work is also excluded from dense pairing. Beginners retain straight sets rather than automatic rest-pause.
- A myo prescription consists of one 12–15 activation set plus three 3–5-rep mini-sets with 15-second rests. A DC-style prescription consists of one 8–12 activation set plus two 3–5-rep mini-sets with 30-second rests. Each effort targets one RIR initially; the finite mini-set count bounds the protocol. These are explicit app protocols, not a claim to reproduce every branded variant.
- SQLite v12 adds `rest_pause_json`. Templates, exports, companion validation, cloning, preview/startup, logger timers and adaptation carry the same protocol. Preview expands the activation and minis into actual rows at the same load. Warm-ups use ordinary rest; activations/minis use the protocol rest. Rest-pause is not stacked inside a superset. Recovery/pain-return previews use straight work instead.
- Full/activation sets and mini-sets have separate summaries. Compressed-dose planning estimates activation stimulating reps from target RIR and adds a conservative estimate bounded by mini reps. It compares against a three-stimulating-rep reference per ordinary target set, while ordinary Fury sets retain their original count requirement. This is an uncertain planning heuristic, not a physiological equivalence or guarantee. Shortfalls remain visible.
- Advanced starting defaults are now 16 chest/back/quad sets, 14 hamstring/delt/glute sets, 12 direct biceps/triceps sets, 10 calf sets and 8 core sets per week. Intermediate/beginner defaults are unchanged. Volume remains subject to experience, time/equipment and later performance evidence.
- Fury prefers complementary variations once a slot exceeds three sets. Four unprotected incline-press sets can become two incline sets + two fly sets; the variation respects equipment, exclusions, preferences and candidate scoring. Protected main work is retained when adding assistance. If no viable variation exists, additional same-exercise sets are allowed rather than losing required work. Other moods can add variations above five sets when necessary to meet a weekly target.
- Pruning uses relative weekly coverage rather than reverse exercise order. This avoids repeatedly sacrificing the last arm/core slot and reports any remaining dose shortfall.

The higher advanced targets are programming defaults rather than individual guarantees. [Rest-pause research](https://pubmed.ncbi.nlm.nih.gov/34260860/) supports considering it as an alternative execution method; it does not establish a fixed mini-set/full-set conversion. The preference for distributing Fury work follows the user's requested programming style rather than a claim that every variation is superior to another straight set.

Personal muscle-emphasis settings/demographic presets and the optional low-RPE back-filler exception for strength mains remain future work. Existing saved programs are not automatically rewritten.

Latest default-catalog reproductions: the two-day, 30-minute dumbbell Get Out example fits at 30/30 modeled minutes using antagonist pairs and DC/myo phases. It still exposes dose/equipment shortfalls, including unavailable calf work. The advanced five-day, 75-minute Fury example contains 122 full sets across 64/71/69/67/65 modeled minutes; chest/back/quads receive 16 sets, biceps/triceps 12 each, core 8, with no starting-target shortfalls. These are template starting prescriptions, not individualized dose or measured session durations.

Latest validation: 82 mobile suites / 1,142 tests passed, including protocol expansion, phase-specific adaptation, activation/mini timers, Fury 2+2 distribution, Get Out budget rejection/fitting and SQLite v11→v12 migration. Mobile typecheck and strict companion mypy passed. After the mobile export producer, all 129 companion tests passed, including rest-pause contract round-trip/range validation. All six example selections were regenerated and checked for exercise rows, mini-set labels, rest labels and duration data. No device timing validation was performed.

## Earlier corrective volume and timing implementation (2026-10-22)

The first goal-removal/main-pairing change did not fix initial program volume. The six subsequently generated examples exposed that omission. The following records the next corrective stage; the latest changes above supersede its advanced defaults and cluster limitations:

- Weekly starting targets are allocated by experience rather than fixed Fury/Precision set counts. Fury changes effort (initial accessory RPE 9); it does not force one-set accessories or delete sets during block evolution.
- Direct biceps, triceps and core work is reserved before redundant compound variations. Extra exposures are added across the week where the catalog/equipment permit. The optional-arm filter and positional exercise caps have been removed.
- Initial weekly defaults are: chest/back/quads 6/10/12 sets for beginner/intermediate/advanced; hamstrings/delts/glutes 4/8/10; direct biceps/triceps/calves 4/6/8; core 4/6/6. These are configurable code defaults, not validated universal minimums, maximums or guarantees of growth. Main strength practice starts at three sets per slot; hypertrophy slots start at two and are allocated up to five per exposure.
- Resolved exercise targets determine coverage. Deadlifts count toward hamstrings/glutes rather than horizontal/vertical back work; glute secondary involvement receives half credit; hammer curls count toward biceps. Direct arms/core are not satisfied by generic compound involvement. Incompatible fallback muscles are no longer silently counted as requested coverage; missing suitable exercises produce shortfalls.
- The shared scheduling model includes a five-minute general warm-up allowance, station setup, compound ramp-up, rep time, unilateral work and actual stored rest. Per-session estimates and their maximum are calculated from final prescriptions, without clamping them to the requested time.
- Optional stored `rest_seconds` flows through SQLite v11, repositories, cloning, exports, companion ingestion, previews and logger timers. Hypertrophy-enabled plans can shorten accessory rests (45 seconds for isolations, 90 for eligible non-strength compounds). Compatible isolation pairs use equal round counts; strength compound rests/grouping remain protected.
- If targets or a session budget cannot fit, generation summaries/program notes show explicit shortfalls or overruns. Existing days/time preferences are preserved. The next-block fitter also reports remaining conflicts rather than silently reducing productive sets to one. Changed rest/grouping breaks performance comparability.
- Automatic myo conversion has been removed: a single tagged row cannot honestly represent an activation set plus mini-sets or claim a fixed stimulus/time equivalence. Existing explicit method tags are preserved by preview/startup; structured automated protocols remain outstanding.

The reported intermediate strength → hypertrophy/Fury/four-day/45-minute case now retains 6 direct biceps, 6 direct triceps and 6 core sets, with 42–45 minute scheduling estimates. Chest/back/delt targets still show time-related shortfalls. The advanced hypertrophy/Fury/five-day/75-minute case now has 8 direct biceps, 8 direct triceps and 6 core sets, with 52–59 minute scheduling estimates and no starting-target shortfalls. These are deterministic default-catalog reproductions, not device measurements.

Corrective implementation validation: full mobile Jest passed 82 suites / 1,136 tests; mobile typecheck passed. After the mobile export producer completed, full companion pytest passed 129 tests, including schemas/export contracts; strict mypy passed. SQLite v10→v11 migration, rest persistence/export/clone behavior, duration arithmetic, direct volume across moods and evolution without silent time-driven set loss have regression coverage. Reproduced all six example profiles and checked their visible rest/duration/shortfall data. No device timing measurement was performed.

At this earlier stage, personal muscle emphasis, structured myo/DC and easy back fillers were unimplemented. Structured protocols are now implemented as described above; the other two remain future work. Existing saved programs are not automatically rewritten.

Research context: [the trained-men volume trial](https://pubmed.ncbi.nlm.nih.gov/30153194/) found greater hypertrophy with greater training volume across the tested conditions; [the weekly volume/frequency dose-response analysis](https://pubmed.ncbi.nlm.nih.gov/41343037/) distinguishes direct/fractional work and examines graded responses. Neither establishes that a particular set count guarantees growth for every advanced athlete, or that near-failure effort can replace any amount of weekly work.

## Requirements from the user

- Strength primary with hypertrophy secondary means strength training for designated main lifts and bodybuilding-style accessory work.
- Hypertrophy primary with strength secondary keeps physique development primary, with a strength component.
- Remove powerbuilding as a selectable primary or secondary goal. Its intended use is already represented by ordered strength/hypertrophy goals combined with Fury. Mood remains a separate preference, not a third training objective.
- Hypertrophy anywhere in the selected goals requires space for physique-relevant muscle groups, including groups that can disappear when only compounds are retained.
- Muscle emphasis should accommodate differing preferences among men and women.
- When time is tight, use suitable supersets, myo-reps/DC rest-pause work, and shorter accessory rests before removing important muscle coverage. Meeting minimum required volume/stimulus can justify less-than-optimal rest: some productive stimulus is preferable to leaving the muscle untrained.
- For strength-only training, preserve main-lift rest intervals and do not superset main lifts. Exception: a time-crunched athlete may do low-RPE non-barbell back work between main-lift sets, while preserving main-lift recovery and performance.

These are product semantics. The word powerbuilding may remain in historical programs or compatibility inputs, but is not a selectable training objective.

### Limited implementation in this change

- Removed powerbuilding from both goal pickers and the canonical mobile/Python goal types. Renamed the generated strength/hypertrophy archetype to remove the redundant label.
- Legacy primary powerbuilding is read as strength primary + hypertrophy secondary; legacy secondary powerbuilding expands to strength/hypertrophy excluding the primary goal and duplicates. Existing mood is preserved because the old label does not prove that the athlete selected Fury. SQLite reads, writes, mocks and new exports normalize these goals; companion ingestion accepts and normalizes old exports. The wire schema retains legacy acceptance explicitly. Saved workout templates are not rewritten.
- New strength-only generation does not automatically group blueprint main compounds or standard strength-main exercises, and does not convert protected mains to myo-reps. Superset summary flags now inspect actual final groups.
- The back-filler exception is specified below but not yet scheduled. Existing ordinary superset grouping cannot express preserved main-lift recovery.

This first limited step left weekly coverage, actual shorter rests and shared timing unfixed. The corrective implementation above supersedes that state; structured clusters and personal emphasis are still outstanding.

## What the source currently does

Relevant implementation:

- [Generator](../../mobile/src/core/generator/programSynthesizer.ts): `resolveArchetype`, `getUpperLowerBlueprints`, `synthesizeProgram`, `resolveExerciseId`.
- [Candidate scoring](../../mobile/src/core/generator/candidateScorer.ts): `computeCandidateScore`.
- [Types](../../mobile/src/core/types/index.ts): `UserProfile`, `TemplateExercise`, `TrainingArchetype`, `SetType`.
- [Evolution](../../mobile/src/services/programEvolutionService.ts): `ProgramEvolutionService`.
- [Adaptation helpers](../../mobile/src/core/rules/trainingAdaptation.ts): `isStrengthMain`, `estimateSessionMinutes`.
- [Preview/startup](../../mobile/src/services/workoutPreviewService.ts): `buildWorkoutPreview`; [WorkoutTabRouter](../../mobile/src/features/logger/WorkoutTabRouter.tsx).
- [Logger timers](../../mobile/src/features/logger/ActiveLoggerScreen.tsx).

### Goal ordering mostly changes labels and rep ranges

The split is selected by days and the special 15-minute case, before goal resolution. Strength + hypertrophy resolves to `archetype_ii_powerbuilding`; hypertrophy + strength resolves to `archetype_iii_hypertrophy_strength`. Both use the same blueprints. The meaningful archetype-specific candidate preference currently targets pure hypertrophy, favoring non-SBD options. Secondary hypertrophy does not create weekly muscle-coverage requirements.

`isPrimaryCompound` is a blueprint flag, not a persisted training role. A row can be flagged primary while OHP is an accessory. That flag controls sets, reps, effort and protection against myo conversion. Adaptation uses a different main-lift definition: goal plus exercise controls or standard lift type. Hypertrophy-primary strength-secondary does not receive that same strength-main classification through `isStrengthMain`.

Fury also selects DDP rules before the strength-specific branch. Goal, role, mood and progression need distinct responsibilities; mood should not accidentally redefine which lifts are strength work.

### Coverage is lost before time is evaluated

At 45 minutes or less, optional upper-day arm slots are removed unconditionally. Then `.slice(0, maxExercisesPerSession)` keeps the first five slots. Both lower-day abs slots are sixth and disappear. There is no weekly repair pass. Reordering a blueprint can therefore change which muscle groups survive.

Gender currently changes descriptive notes, not allocation. There is no profile field for muscle priorities. Glute-focused exercises exist in the catalog, including hip thrusts, but this does not establish glute emphasis in the plan.

Candidate fallback can return any eligible exercise if ranked candidates are exhausted. Some explicit fallbacks also target unrelated muscles, such as push-ups for an abs slot. A coverage audit must use the resolved exercise's actual targets, not the blueprint's requested muscle label.

### Time estimates and execution disagree

- Generation estimates 40 seconds per set, 90/120 seconds rest, or 45 seconds for grouped work, plus a fixed five-minute warm-up. It does not model lift-specific ramp-up, setup, equipment transitions or an ordered superset timeline.
- Evolution uses another estimator based on reps, catalog rest and per-exercise overhead. It trims sets from the end instead of applying a shared goal-aware compression policy.
- The displayed summary duration is derived from the requested duration and a fixed cap, not the computed schedule. `hasSupersets` reflects the global trigger rather than inspecting final groups.
- Short sessions can pair main bench and row automatically, including strength-only programs. The logger suppresses a timer between group members and uses the final exercise's default rest after the group. This differs from the generator's flat grouped-rest estimate.
- Templates cannot store prescribed rest intervals. The logger normally uses the exercise catalog default; changing the estimate alone cannot implement shorter accessory rest.

### Myo/DC support is incomplete for generated execution

The generator converts any non-primary slot when over budget, without checking actual exercise suitability. It assumes a 90-second activation-plus-three-mini-set sequence, but stores one set tagged `myorep`, with no explicit mini-set prescription or termination rule. Being non-primary does not make an OHP or other demanding compound suitable for this conversion.

`buildWorkoutPreview` creates `target_sets` rows and selects `proposal?.suggestedSetType ?? 'working'`; it does not fall back to the template's `set_type`. Startup consumes those rows. Thus generated myo type can be lost even before execution. Myo/DC timer branches exist (10/30 seconds), but timer support alone is not an end-to-end rest-pause protocol. DC is not generated by the current compression pass.

## Reproduced comparison

Executed the current TypeScript generator through the installed TypeScript transpiler, without modifying source or saved programs. Used the default catalog, commercial gym, intermediate experience, Fury, four days and 45 minutes. Other profile constraints and user-specific exercise preferences were not supplied.

| Ordered goals | Current archetype | Working sets/week | Direct biceps/triceps/abs sets |
| --- | --- | ---: | ---: |
| Strength → hypertrophy | II / powerbuilding | 28 | 0 / 0 / 0 |
| Hypertrophy → strength | III / hypertrophy-strength | 28 | 0 / 0 / 0 |
| Legacy powerbuilding (before removal) | II / powerbuilding | 28 | 0 / 0 / 0 |
| Strength alone | I / pure strength | 28 | 0 / 0 / 0 |

All four retain the same exercises and set counts, including a bench/row superset. Rep prescriptions differ by primary goal. Changing gender to female leaves the strength → hypertrophy prescription unchanged. A separate 20-minute Precision run generated six myo-tagged slots, establishing the relevance of the preview/startup gap.

These are structural reproductions, not device validation or evidence that every possible saved profile produces identical output. Primary-muscle set totals also are not a complete measure of stimulus: the current catalog labels deadlift as Back, for example.

## Proposed goal policy

Resolve ordered goals into explicit policy rather than making the archetype enum carry all behavior.

| Selection | Main-lift policy | Accessory and coverage policy | Time-pressure policy |
| --- | --- | --- | --- |
| Strength only | Prioritize designated lifts, skill and performance; protect recovery between sets | Assistance chosen for lift needs; no mandatory bodybuilding allocation | Keep prescribed rests; no main-lift supersets except eligible low-RPE non-barbell back fillers under time pressure |
| Strength → hypertrophy | Protect designated strength lifts and their progression/rest | Reserve bodybuilding work across relevant muscles; accessories are not all strength assistance | Compress accessories before reducing coverage; keep main-lift recovery |
| Hypertrophy → strength | Maintain selected strength anchors, subordinate to physique allocation | Hypertrophy volume and chosen muscle emphasis drive the week | Compress suitable hypertrophy work; preserve recovery on retained strength anchors |
| Hypertrophy only | No compulsory SBD anchors; compounds remain useful | Muscle coverage, emphasis and productive volume drive selection | Suitable supersets/rest-pause and bounded shorter rests; still protect productive performance |

Treat hypertrophy in any selected goal as activating the physique-coverage policy. Normalize legacy powerbuilding before resolving that policy. Define conflicts involving multiple secondary goals explicitly. Avoid an arbitrary SBD percentage as the sole interpretation of user intent. An archetype can remain display metadata, but must describe the effective policy accurately. Fury may steer effort, volume and technique choices in either ordered goal combination; it must not erase minimum muscle coverage.

Persist main-lift roles for each template slot. Honor explicit main/anchor controls while keeping their meanings separate: an anchor preserves exercise identity; a main role establishes strength treatment. Do not infer all roles solely from `is_compound`, exercise name, or list position.

## Weekly muscle coverage and preferences

Proposed behavior:

1. Build a weekly coverage ledger before filling individual sessions. Include chest, back, delts, biceps, triceps, quads, hamstrings, glutes, calves and core. Assess subdivisions where the catalog supports useful distinctions.
2. Track direct/targeted work separately from secondary involvement. Compounds contribute, but pressing cannot silently satisfy every triceps priority and bracing cannot automatically replace targeted core work. Conversely, glute-targeting compounds need not be discounted merely because the catalog's primary label says Quads.
3. Give each group a baseline coverage requirement and selected priority groups additional allocation. Distinguish minimum required stimulus from preferred volume at generous rest. Under time pressure, preserve productive exposure with shorter accessory rests rather than allocating zero volume to that muscle. Coverage is a minimum constraint, not a claim that one token set is an adequate hypertrophy dose.
4. Express starting volume and frequency as configurable, experience- and recovery-aware policy. Final numerical floors require calibration; the current 32-eRep default is not sufficient evidence for a universal dose or exact conversion between training methods.
5. Spread work across the week. Remove redundant same-muscle slots before eliminating the only direct exposure for another required group.

Proposed preference defaults: an upper-body emphasis can weight delts, chest, back and arms more; a lower-body emphasis can weight glutes, quads and hamstrings more. Men/women can receive different initial emphasis suggestions as requested, but all groups remain represented and the user can override them. These are product preference assumptions, not biological requirements or a claim that every man/woman wants the same physique. Explicit muscle choices take precedence over demographic defaults, likes and historical exercise frequency.

Introduce an editable muscle-emphasis preference without requiring the user to design the program. Changing gender later should not overwrite an already explicit preference. Core should have a place in both defaults; neither demographic preset should delete upper- or lower-body coverage.

## Time-budget algorithm

Use a shared schedule model for generation, evolution, preview and logger prescriptions. Schedule actual events, including warm-ups/ramp-up, working-set duration, setup/transitions, superset rounds, cluster mini-sets and prescribed rests. Count recovery between sets of the same exercise, including time spent on its partner. Include practical overhead rather than presenting a theoretical lower bound as a guaranteed finish time.

Proposed optimization order:

1. Reserve designated main work and its rest, then reserve weekly coverage and priority-muscle allocation.
2. Remove redundant exercise overlap and rearrange compatible work across the fixed training days.
3. Pair suitable accessory exercises with low interference and feasible equipment logistics. Do not automatically pair heavy squat/RDL or main bench/row merely because muscle tags look antagonistic. A superset saving on paper is not enough if it damages the priority exercise's performance.
4. For hypertrophy-enabled goals, allow shorter accessory rests to fit minimum required volume/stimulus, even when the rest is suboptimal for per-set performance. Estimate the resulting repetitions, effort and fatigue honestly; do not demand zero performance cost when the alternative is no exposure. Keep main-lift recovery protected. For strength-only goals, do not shorten prescribed rests as a time-budget maneuver.
5. If still needed, use explicitly supported myo-rep or DC-style rest-pause on suitable accessories. Consider experience, stability, fatigue, pain and ability to stop/re-rack. Do not stack a rest-pause cluster inside a superset by default. Keep straight sets when already faster: converting a one-set Fury accessory into a cluster may add time and fatigue.
6. Reduce lower-priority volume only after those options, while checking remaining coverage and main-lift requirements again.
7. If constraints cannot all fit, return an explicit infeasible/compromised result with reasons. Do not silently omit a goal, fake the duration, shorten strength rest, or alter the user's days/time preference. Present concrete feasible alternatives separately.

The two compression options in steps 4–5 should be compared on estimated savings and training cost, rather than always applying both. Compression is a tool, not a goal or a justification for taking every accessory to failure.

### Strength-only back-filler exception

This is active recovery-period scheduling, not a conventional main-lift superset. Eligibility requires a real time constraint, a back-targeting exercise, non-barbell equipment, low prescribed RPE and low interference with the main lift. A supported machine/cable movement is a possible candidate; a demanding unsupported dumbbell row does not qualify merely because it is non-barbell.

The next main set cannot start earlier than its prescribed recovery interval. Filler work plus transitions must fit inside that interval without delaying setup/readiness. Avoid overlap that compromises grip, bracing, the pulling muscles required by the main lift or systemic recovery. A filler before a heavy pull needs particular scrutiny. It is optional; skip it if main performance or recovery is affected.

An initial RPE ceiling of 6 (at least four RIR) is a proposed default, not a user-agreed numeric threshold. The UI should explain easy back work during the existing rest window and retain the main rest timer. Do not use a shared group with the current between-exercise timer suppression. Protect the main-lift schedule in the estimator, preview, startup and logger, including unequal set counts. Do not count easy filler touches as a full replacement for a hypertrophy goal's minimum stimulus without checking actual effort and volume.

Myo/DC prescriptions must state activation set, mini-set targets/count or cap, rest, effort, and stopping rule. Logging must represent those phases and retain the method across preview, startup, completion and history. Report straight sets and clusters separately; do not assume one cluster equals a fixed number of ordinary sets or eReps.

## Research informing the proposed safeguards

These studies inform design constraints; they do not establish the app's exact starting volumes or demographic preferences.

- [Schoenfeld et al., longer versus shorter rest (randomized trial)](https://pubmed.ncbi.nlm.nih.gov/26605807/): in 21 trained men over eight weeks, three-minute rests outperformed one-minute rests on measured squat/bench strength; some hypertrophy outcomes also favored longer rests. Short rest is a time tradeoff, not intrinsically better bodybuilding training.
- [Superset versus traditional whole-body training (randomized trial)](https://pubmed.ncbi.nlm.nih.gov/39072654/): time-efficient pairing did not preserve every strength outcome equally; traditional training improved pulldown more. This supports checking interference and protecting priority lifts.
- [Upper/lower alternating sets trial](https://pubmed.ncbi.nlm.nih.gov/36846453/): particular moderate-load squat/bench configurations produced similar strength improvements with improved time efficiency. This supports selective pairing, not universal pairing rules.
- [Prestes et al., rest-pause versus traditional sets](https://pubmed.ncbi.nlm.nih.gov/28617715/): a six-week study in 18 trained subjects found similar strength improvements and greater thigh hypertrophy with rest-pause. It supports rest-pause as an option; it does not validate every branded myo/DC protocol, a fixed cluster-to-set equivalence, or automatic conversion of heavy main lifts.

## Implementation boundaries and acceptance criteria

Suggested delivery sequence:

1. Add explicit ordered-goal policy, slot roles, muscle-emphasis settings and weekly coverage accounting. Preserve legacy saved programs through defined defaults; do not rewrite active programs unexpectedly.
2. Add persisted rest and structured cluster prescriptions, and a shared event-based estimator. Wire preview/startup/logger/history before generation starts relying on compressed methods. User-facing explanations must match actual prescriptions.
3. Replace optional-arm filtering and list truncation with weekly allocation and goal-aware fitting. Require resolved exercise targets to satisfy the requested role/coverage; report unavailable coverage honestly.
4. Apply the same policy to next-block evolution so later fitting, substitutions and mood changes cannot reintroduce omissions or remove protected main-lift rest. Preserve existing productive work and active-session behavior.
5. Update goal/archetype presentation, summaries and explanations around final behavior. State meaningful tradeoffs such as a paired arm block or reduced redundant chest work.

Regression criteria:

- The reported four-day/45-minute Fury strength → hypertrophy case retains protected strength work, direct arms and core, with a schedule that fits or an explicit constraint explanation.
- Reversing goals changes allocation and priority decisions, not only labels and rep brackets. Fury steers execution without adding a redundant goal.
- Powerbuilding is absent from primary/secondary pickers. Legacy inputs normalize to ordered strength/hypertrophy goals without silently changing mood or rewriting saved workouts.
- Hypertrophy as a secondary goal still activates coverage.
- Men/women defaults can alter emphasis; explicit priorities override both. Both defaults retain whole-body coverage.
- Strength-only time pressure never lowers prescribed rest or automatically converts main work into dense supersets/rest-pause.
- Time-crunched strength-only back fillers are low-RPE, non-barbell, back-targeting and compatible with the main lift; preserve the main recovery window and timer. Otherwise leave main lifts unpaired.
- Under hypertrophy time pressure, shorter rests are preferred to dropping a required muscle to zero volume when they can retain productive minimum stimulus. Compare achieved work, not theoretical full-rest volume.
- Coverage survives blueprint reorderings, exercise substitutions, equipment restrictions and next-block evolution. Unavailable target-compatible exercises produce a reason rather than unrelated replacements.
- Myo/DC retains method and phases through preview/startup/logging/history; elapsed-time accounting includes the complete protocol.
- One-set accessories are not converted to longer clusters under the pretense of time savings.
- All final superset groups have at least two distinct compatible exercises; main-lift recovery is checked on the actual schedule.
- Duration and superset summaries derive from final prescriptions; impossible 15/30/45-minute cases are explicit.
- Test across days, durations, goals, experience, mood, emphasis and equipment. Include boundary cases at 35/45 minutes rather than only nominal 60-minute programs.

Validation for implementation must follow [VALIDATION.md](../VALIDATION.md). Shared types/repository/schema work requires the full mobile suite and typecheck. If persisted/exported JSON changes, update shared JSON schemas and companion ingestion models together and run ordered cross-stack contract checks. Analysis-only validation consists of source reproduction, checking cited paths/symbols, and regenerating/checking repository indexes.

### Validation executed for the limited implementation (2026-10-22)

- Full mobile Jest suite: 81 suites, 1,126 tests passed; mobile typecheck passed.
- After the mobile export producer completed, full companion pytest: 128 passed, including schema/export contract checks. Strict mypy passed for all 18 source files.
- Initial test attempts hit sandbox temporary-directory/cache permission errors. Successful runs used Jest's `node_modules/.cache/jest-goals` and a Python temporary directory under companion `.pytest_cache`; no application change was needed for those environment errors.
- Regenerated repository indexes and checked with `generate_repo_inventory.ps1 -Check`; analysis document local links resolve; `git diff --check` passed.
- No device test was executed. The remaining weekly allocator, shorter-rest scheduler and back-filler execution are not covered by these passing results because they are not implemented here.
