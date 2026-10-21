# Workout Suite code map

Read the rows relevant to the current request. The [generated inventory](generated/FILE_INVENTORY.md) provides the exhaustive file list; this map records responsibilities and entry points. [Documentation status](README.md) separates current guidance from historical proposals.

## Mobile navigation

All paths below start at `mobile/`. Tests normally live beside the implementation in `__tests__/`; application-service tests live in `src/services/__tests__/`.

| Task | Implementation and key entry points | Representative tests |
| --- | --- | --- |
| App composition/navigation | `index.ts`, `App.tsx`; `src/context/RepositoryContext.tsx` (`useRepositories`, `useOptionalRepositories`), `NavigationContext.tsx` | `src/context/__tests__/contextAndNavigation.test.ts` |
| Start/log/recover workouts | `src/features/logger/WorkoutTabRouter.tsx`, `ActiveLoggerScreen.tsx`; `src/services/activeSessionService.ts` (`ActiveSessionService`), `crashRecoveryService.ts`, `restTimerService.ts` | `src/services/__tests__/activeSessionService.test.ts`, `crashRecoveryService.test.ts`, `restTimerService.test.ts`; logger `__tests__/` |
| Warm-up, plate/load math, strength metrics | `src/core/math/warmupEstimator.ts`, `plateCalculator.ts`, `loadNormalizer.ts`, `heuristic1rm.ts`, `repMaxEnvelope.ts`, `strengthStandards.ts`, `effectiveReps.ts` | Matching `src/core/math/__tests__/*.test.ts`; session tests for persisted adjustments |
| Generate/rank/evolve programs | `src/core/generator/programSynthesizer.ts` (`synthesizeProgram`), `candidateScorer.ts` (`computeCandidateScore`, `resolveExerciseJoints`), `transitionWave.ts` (`calculateTransitionWave`); `src/services/programEvolutionService.ts` (`ProgramEvolutionService`), `mesocycleDiffFormatter.ts`, `mesocycleSimulation.ts` | Generator `__tests__/`; `src/services/__tests__/programEvolutionService.test.ts`, `mesocycleDiffFormatter.test.ts`, `mesocycleSimulation.test.ts` |
| Progression rules/program editing | `src/core/rules/progressionRuleEngine.ts`; `src/features/progression/ProgramOverviewScreen.tsx`, `ProgressionBuilderModal.tsx`; `src/services/programCloneService.ts`, `programBlockService.ts` | Rule `__tests__/`; progression `__tests__/progressionComponents.test.ts`; matching service tests |
| Exercise library, preferences, substitutions | `src/features/inspection/ExerciseLibraryScreen.tsx`, `ExerciseDetailScreen.tsx`; `src/services/exerciseInspectionService.ts`, `exercisePreferenceService.ts`, `exerciseSubstitutionService.ts` | Inspection `__tests__/`; matching service tests; candidate scorer tests |
| Home/calendar/history | `src/features/home/HomeScreen.tsx`, `calendar/CalendarScreen.tsx`; `src/services/dashboardMetricsService.ts` | Feature `__tests__/` and matching service tests |
| Profile, equipment, onboarding, settings | `src/features/profile/`, `gear/`, `onboarding/`, `settings/`; `src/database/repositories/SQLiteUserProfileRepository.ts`; `src/services/gearInventoryService.ts` | Feature `__tests__/` and matching service tests |
| Body metrics, workload, plots | `src/features/bodyMetrics/`, `plots/`; `src/database/repositories/SQLiteBodyMetricsRepository.ts`; `src/services/workloadAnalysisService.ts`; `src/core/math/navyBodyFat.ts` | Matching service/math tests and feature `__tests__/` |
| External imports | `src/features/import/ImportScreen.tsx`; `src/services/importService.ts`; `src/core/parsers/csvImportParser.ts` | `src/services/__tests__/importService.test.ts`; parser `__tests__/` |
| Workout exports/calibration imports | `src/services/exportService.ts` (`ExportService`), `calibratedParamService.ts` (`CalibratedParamService`); `src/core/types/index.ts` | `src/services/__tests__/exportService.test.ts`, `calibratedParamService.test.ts`; Python contract tests |
| Persistence/schema | `src/database/index.ts`, `schema.ts`, `seeds/`; `src/domain/repositories/I*Repository.ts`; `src/database/repositories/SQLite*Repository.ts`; in-memory adapters in `src/database/mocks/` | `src/database/__tests__/`; repository and mock `__tests__/` |

Extend the existing feature/service/core module for its responsibility. New persistence behavior belongs in the domain interface and appropriate adapters. Add shared entities to `src/core/types/index.ts`; keep framework/device calls out of deterministic math. Check callers when changing shared helpers or barrel exports.

## Companion navigation

All paths below start at `companion/`. Use its `.venv` for every Python command.

| Task | Implementation and key entry points | Tests |
| --- | --- | --- |
| Validate transferred JSON | `src/ingestion/schemas.py` (`WorkoutExportPayload`, `CalibratedParametersEnvelope`) | `tests/test_schemas.py` |
| Strength/endurance estimation | `src/models/kalman_1rm.py` (`Adaptive1RMKalmanFilter`, `filter_session_sets`) | `tests/test_kalman_1rm.py` |
| Fatigue/recovery/advisories | `src/models/fatigue_banister.py` (`compute_daily_banister_series`), `recovery_modifier.py`, `recommendations.py` | `tests/test_banister.py`, `test_parameter_audit.py` |
| Mesocycle length | `src/models/mesocycle_analyzer.py` (`analyze_optimal_mesocycle_length`) | `tests/test_mesocycle_analyzer.py` |
| Hypertrophy/landmarks/SFR | `src/analysis/hypertrophy_signals.py`, `muscle_landmarks.py`, `sfr_evaluator.py` | `tests/test_hypertrophy_signals.py`, `test_muscle_landmarks.py`, `test_sfr_evaluator.py` |
| Calibrated exports and orchestration | `src/export/param_exporter.py` (`export_calibrated_parameters`, `calibrate_exercise_stream`) | `tests/test_exporter.py`; schemas and parameter audit tests |
| Dashboard and charts | `src/ui/app.py`, `src/ui/charts.py` | `tests/test_ui_smoke.py` |

## Shared contracts and tooling

- Workout transfer: `schemas/workout_export.schema.json`; mobile export service/types; companion ingestion models. `schemas/fixtures/sample_workout_export.json` is written by the mobile export suite and consumed by Python contract tests.
- Calibrated transfer: `schemas/calibrated_parameters.schema.json`; companion parameter exporter; mobile calibrated parameter service.
- Validation configuration: `mobile/package.json`, `mobile/jest.config.js`, `mobile/tsconfig.json`, `companion/pyproject.toml`. [VALIDATION.md](VALIDATION.md) gives commands and scope rules.
- Navigation generation: `scripts/generate_repo_inventory.ps1`; [generated/README.md](generated/README.md) describes outputs and exclusions.

## Reference documents (read on demand)

- [ARCHITECTURE.md](ARCHITECTURE.md): current boundaries, configuration, integrations, and execution flows.
- [DECISIONS.md](DECISIONS.md): historical ADR rationale; find specific records through the [decision index](generated/DECISION_INDEX.md).
- [TRAINING_AND_BODY_DATA.md](TRAINING_AND_BODY_DATA.md): stored metrics, calculations, and gap analysis.
- `docs/training_philosophies/`: `Deep_research_1RM.md`, `1RM_calculation.txt`, `Warm_up_estimator.md`, `THEORY_VOLUME_VS_EREPS.md`, `Resistance_training_archetype_analysis.md`, `THEORY_INTEGRATION_AND_MESOCYCLE_ARCHITECTURE.md` provide algorithm background.
- `docs/implementation_plans/`: `IMPLEMENTATION_PLAN.md`, `hypertrophy_update.md`, `program_synthesis_and_mesocycle_plan.md`, `Upgrades_for_companion_suite.md`, `Description_of_dataflow.md` are historical engineering proposals. UX, launch, and market reports also live here. Their checkboxes and execution gates are not active instructions.
- `docs/archived/`: superseded sketches and phase notes retained for traceability.

