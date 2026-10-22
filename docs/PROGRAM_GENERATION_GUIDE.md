# Program generation and example review

Status: current reproduction/review workflow. The split preference proposal below is **not implemented**.

## Reproduce the reviewed examples

Run from `mobile/`, using the existing development dependencies:

```powershell
node scripts/generate-program-examples.cjs
# Optionally preserve a named review run outside the default cache:
node scripts/generate-program-examples.cjs node_modules/.cache/program-review-before
```

The runner reads [six profile fixtures](../mobile/scripts/fixtures/program-example-profiles.json), calls the actual `synthesizeProgram` with the default exercise catalog, and writes `program-examples.json` and `program-examples.md`. The default destination is `mobile/node_modules/.cache/program-examples/` (ignored by Git). Copy outputs to a lasting review location when retaining a comparison; the default files are overwritten on each run. No app database or user program is changed.

The fixtures reproduce the profiles used in the reviewed third set of examples: original strength + hypertrophy/Fury, strength only/Fury, hypertrophy + strength/Precision, beginner hypertrophy, dumbbell Get Out, and advanced five-day hypertrophy/Fury. The runner derives enjoyment/intensity style from mood as those examples did. These are explicit example inputs, not an assertion that all saved users have that mapping. Age, body size, exercise preferences, injury history and learned performance are unspecified. For individual cases, add the relevant inputs and options rather than pretending these generic examples represent that athlete.

JSON retains the resolved profile, program, templates, prescriptions, progression rules and summary. Provenance includes the Git revision, dirty-tree indicator, runtime versions and SHA-256 hashes of loaded source files, runner and fixtures. An uncommitted checkout cannot be reconstructed from its Git revision alone: preserve the relevant source/diff with a retained report. Stable program IDs and omitted entity timestamps make prescriptions comparable. The script uses a process-local TypeScript transpilation hook; it does not replace `npm run typecheck`.

The Markdown report presents muscle credits, full/activation sets, mini-sets, estimated stimulating reps, session estimates, every exercise, pairing IDs, rests and rest-pause protocols. Identical group IDs mark a superset; unequal set counts mean remaining rounds are done alone. These quantities are distinct: a mini-set is not a full working set, muscle credits can overlap or be fractional, and estimated stimulating reps are an uncertain planning heuristic. Do not sum muscle credits to infer total performed sets.

### Reference run

The reviewed 2026-10-22 source produced the following starting examples. These are recorded observations, not targets to hard-code or proof of physiological adequacy.

| Fixture | Estimated session minutes | Weekly full/activation sets | Weekly mini-sets |
| --- | --- | ---: | ---: |
| original | 45 / 45 / 45 / 45 | 63 | 9 |
| strength | 45 / 41 / 44 / 38 | 54 | 0 |
| precision | 60 / 52 / 59 / 58 | 74 | 3 |
| beginner | 57 / 38 / 54 | 50 | 0 |
| minimal | 30 / 30 | 19 | 8 |
| advanced | 64 / 71 / 69 / 67 / 65 | 122 | 0 |

The original case still reported a back-dose shortfall. The minimal case reported several dose/equipment compromises. Preserve and inspect warnings; the absence of warnings does not validate a program. No real-world session timing was measured.

## Review process and policy

1. Record the exact inputs first: ordered goals, mood, experience, days, duration, equipment and any individual constraints. Generate from live code before presenting examples. Never hand-edit the displayed plan while attributing it to the app.
2. Review the entire cycle by muscle, including direct biceps, triceps, core and user-priority muscles. Check the actual exercise rows as well as aggregated credits. If hypertrophy appears anywhere in the goals, high effort must not erase productive volume. Advanced prescriptions must not assume one near-failure set replaces an adequate weekly dose.
3. Preserve goal order. Strength primary + hypertrophy secondary means strength-oriented main lifts and bodybuilding accessories. Hypertrophy primary + strength secondary can put greater emphasis on size while retaining strength practice. Powerbuilding is no longer a separate selectable goal; legacy normalization is compatibility behavior.
4. Treat Fury as an effort/variation preference, not a mandatory low-volume cap. When work exceeds roughly three sets of one movement, prefer suitable complementary variations where available (for example, two incline presses plus two fly sets). Preserve main-lift practice and avoid arbitrary swaps just to satisfy a label.
5. Inspect each day's complete time model: general warm-up, ramp-up, setup, repetitions, unilateral execution, prescribed rest, superset rounds and every mini-set/rest. Compare each day with the requested limit. Estimates need practical validation; never clamp the displayed number to the request. Get Out currently rejects a remaining modeled overrun; other moods can surface unresolved conflicts.
6. Fit productive work using compatible antagonist supersets first and suitable unpaired myo/DC protocols when needed. Do not apply rest-pause to high-axial movements such as squats/deadlifts. Do not treat low-RPE technical work as equivalent hypertrophy stimulus. Shorter accessory rests can be preferable to omitting a muscle entirely when hypertrophy matters.
7. For strength-only training, preserve main-lift rest and avoid supersets of main lifts. The discussed exception is easy, low-RPE non-barbell back work between sets under time pressure, provided it does not impair the lift. That exception is **not implemented**. Personal muscle-priority selection also remains future work; do not infer individual priorities from gender alone.
8. Report remaining dose/time/equipment compromises explicitly, then verify that saved protocols reach preview, startup, logger timers and progression consistently. Passing an example report is not a substitute for relevant regression tests or device execution checks.

Use [VALIDATION.md](VALIDATION.md) to select checks. For scheduling changes, inspect `programVolumePlanner.test.ts` plus generator callers; for split implementation, include generator split cases and persistence/UI consumers. Run the report before/after a change and compare prescriptions, warnings and time estimates, not just totals. Check new scheduling boundaries such as 1, 2, 3, 4, 5, 6 and 7 days, short durations, equipment restrictions and beginner safety.

The implementation entry points are in [CODEMAP.md](CODEMAP.md). The detailed [goal-aware generation analysis](implementation_plans/Goal_aware_program_generation_analysis.md), [training evolution policy](TRAINING_EVOLUTION.md), and ADR-103 in [DECISIONS.md](DECISIONS.md) explain the constraints behind the current workflow.

## Proposed split preference

Proposal only: add **Recommended**, **Full Body**, **Upper/lower**, **PPL**, and **Bro-split** to program creation, with Recommended as the default. Separate the requested preference from the resolved schedule. Split controls where work is placed; goals, experience, recovery, equipment and session budgets still determine appropriate work. Mood must not redefine the split or silently remove volume.

Current source automatically selects full body for 1–3 days, upper/lower for 4, PPL + upper/lower for 5, and six PPL templates for 6–7. Fifteen-minute routines have a separate blueprint path. Seven requested days currently still produce six templates, so metadata is not evidence of an exact seven-session schedule. Full-body A/B/C labels do not currently implement a general heavy/medium/light policy.

Suggested design:

| Choice | Intended behavior |
| --- | --- |
| Recommended | Compare feasible schedules against volume, coverage, exercise practice and time. Retain useful hybrids such as the current five-day PPL + upper/lower. Explain the resolved choice. |
| Full Body | Distribute major muscle work across sessions. For 3+ days, offer a heavy/medium/light stress pattern when appropriate, with rotated lift emphasis. More training days should not create repeated heavy axial sessions automatically. |
| Upper/lower | Alternate upper and lower sessions. For odd day counts, carry the sequence across weeks so one half does not permanently lose a session. |
| PPL | Rotate push, pull and legs across the actual training schedule; six days permits two rounds. At nonmultiples of three, continue the cycle rather than resetting every Monday. |
| Bro-split | Clearly described body-part days, preferably with editable emphasis. Usually easier to organize over 4–6 days; evaluate concentrated session volume and time rather than banning it or promising superiority. |

Those day ranges are product design starting points, not hard physiological rules. If an explicit choice cannot meet time or dose constraints, show the concrete conflict and alternatives before saving; do not silently substitute Recommended. Rotating splits require cycle-aware volume accounting and next-session selection: a seven-day sum of a partial cycle can misrepresent the actual program.

For full body, heavy/medium/light should describe planned load/stress and exercise emphasis. A light day need not mean low stimulus or token accessories; it can reduce axial/technical fatigue while retaining useful bodybuilding work. Beginners can retain simpler repeated practice. With strength primary, anchor main-lift loading to the strength objective; with hypertrophy primary, ensure the pattern still supplies productive weekly muscle work. Do not apply a universal H/M/L rotation without considering recovery and the actual days trained.

Evidence supports offering choice: a [2024 systematic review and meta-analysis](https://pubmed.ncbi.nlm.nih.gov/38595233/) found similar strength and hypertrophy outcomes for split and full-body routines when volume was equated. That does not establish that every split/day/time combination is equally feasible or that H/M/L is always preferable. The proposed defaults above are engineering and coaching judgments to validate against the example/review process.

Implementation would need profile persistence/defaults, creation and editing UI, requested/resolved split types, blueprint/scheduling changes, cycle-aware volume/time planning, next-session/evolution compatibility, export/schema updates where the preference is exchanged, and regression cases. Adding only a dropdown would leave the current scheduling assumptions intact.
