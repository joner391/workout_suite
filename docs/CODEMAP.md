# Workout Suite — Code & Repository Map

## 1. Directory Structure Overview

```
c:/Programmering/Eget/Workout_suite/
├── AGENTS.md                   # Agent navigation, conventions, and maintenance protocols
├── .gitignore                  # Git ignore rules for React Native/Expo, Python, and SQLite
├── Rough_sketch.md             # Primary product specification and comprehensive requirements
├── IMPLEMENTATION_PLAN.md      # Engineering blueprint, phases, schemas, and milestones
├── 1RM_calculation.txt         # State-space Kalman Filter mathematical specification
├── Deep_research_1RM.md        # Scientific research foundation on 1RM models & biomechanics
├── market_analysis.md          # Market ergonomics, competitor taxonomy, and user retention research
├── schemas/                    # Contract-first JSON Schema definitions
│   ├── workout_export.schema.json
│   ├── calibrated_parameters.schema.json
│   └── fixtures/
│       └── sample_workout_export.json
├── mobile/                     # Isolated React Native (Expo TypeScript) workspace
│   ├── app.json
│   ├── App.tsx
│   ├── index.ts
│   ├── jest.config.js
│   ├── package.json
│   ├── tsconfig.json
│   ├── README.md
│   └── src/
│       ├── core/
│       │   ├── math/
│       │   │   ├── index.ts
│       │   │   ├── unitConversion.ts
│       │   │   ├── heuristic1rm.ts
│       │   │   ├── repMaxEnvelope.ts
│       │   │   ├── loadNormalizer.ts
│       │   │   ├── plateCalculator.ts
│       │   │   ├── dotsCoefficients.ts
│       │   │   ├── strengthStandards.ts
│       │   │   ├── navyBodyFat.ts
│       │   │   ├── effectiveReps.ts
│       │   │   └── __tests__/
│       │   │       ├── unitConversion.test.ts
│       │   │       ├── heuristic1rm.test.ts
│       │   │       ├── repMaxEnvelope.test.ts
│       │   │       ├── loadNormalizer.test.ts
│       │   │       ├── plateCalculator.test.ts
│       │   │       ├── dotsCoefficients.test.ts
│       │   │       ├── strengthStandards.test.ts
│       │   │       ├── navyBodyFat.test.ts
│       │   │       └── effectiveReps.test.ts
│       │   ├── generator/
│       │   │   ├── programSynthesizer.ts
│       │   │   └── __tests__/
│       │   │       └── programSynthesizer.test.ts
│       │   ├── parsers/
│       │   │   ├── csvImportParser.ts
│       │   │   └── __tests__/
│       │   │       └── csvImportParser.test.ts
│       │   ├── rules/
│       │   │   ├── progressionRuleEngine.ts
│       │   │   └── __tests__/
│       │   │       └── progressionRuleEngine.test.ts
│       │   └── types/
│       │       ├── index.ts
│       │       └── __tests__/types.test.ts
│       ├── domain/
│       │   └── repositories/
│       │       ├── index.ts
│       │       ├── IExerciseRepository.ts
│       │       ├── IWorkoutRepository.ts
│       │       ├── IGearRepository.ts
│       │       ├── IUserSettingsRepository.ts
│       │       ├── IProgramRepository.ts
│       │       ├── IUserProfileRepository.ts
│       │       ├── IBodyMetricsRepository.ts
│       │       └── IPainReportRepository.ts
│       ├── services/
│       │   ├── index.ts
│       │   ├── activeSessionService.ts
│       │   ├── restTimerService.ts
│       │   ├── exerciseSubstitutionService.ts
│       │   ├── crashRecoveryService.ts
│       │   ├── gearInventoryService.ts
│       │   ├── exportService.ts
│       │   ├── importService.ts
│       │   ├── exerciseInspectionService.ts
│       │   ├── programBlockService.ts
│       │   ├── programCloneService.ts
│       │   ├── dashboardMetricsService.ts
│       │   ├── calibratedParamService.ts
│       │   └── __tests__/
│       │       ├── activeSessionService.test.ts
│       │       ├── restTimerService.test.ts
│       │       ├── exerciseSubstitutionService.test.ts
│       │       ├── crashRecoveryService.test.ts
│       │       ├── gearInventoryService.test.ts
│       │       ├── exportService.test.ts
│       │       ├── importService.test.ts
│       │       ├── exerciseInspectionService.test.ts
│       │       ├── programBlockService.test.ts
│       │       ├── programCloneService.test.ts
│       │       ├── workloadAnalysisService.test.ts
│       │       └── calibratedParamService.test.ts
│       ├── features/
│       │   ├── home/
│       │   │   ├── index.ts
│       │   │   └── HomeScreen.tsx
│       │   ├── logger/
│       │   │   ├── index.ts
│       │   │   ├── ActiveLoggerScreen.tsx
│       │   │   ├── WorkoutTabRouter.tsx
│       │   │   ├── SetRowComponent.tsx
│       │   │   ├── RestTimerBanner.tsx
│       │   │   ├── PlateCalculatorModal.tsx
│       │   │   ├── ExerciseSubstitutionModal.tsx
│       │   │   ├── CrashRecoveryDialog.tsx
│       │   │   ├── SupersetBracketGroup.tsx
│       │   │   ├── ProgressionProposalBanner.tsx
│       │   │   ├── PainReportModal.tsx
│       │   │   └── __tests__/
│       │   │       ├── loggerComponents.test.ts
│       │   │       └── progressionProposalBanner.test.ts
│       │   ├── profile/
│       │   │   ├── index.ts
│       │   │   ├── UserProfileScreen.tsx
│       │   │   └── __tests__/
│       │   │       └── userProfileComponents.test.ts
│       │   ├── gear/
│       │   │   ├── index.ts
│       │   │   ├── GearInventoryScreen.tsx
│       │   │   └── __tests__/
│       │   │       └── gearComponents.test.ts
│       │   ├── progression/
│       │   │   ├── index.ts
│       │   │   ├── ProgramOverviewScreen.tsx
│       │   │   ├── ProgressionBuilderModal.tsx
│       │   │   ├── CatalogPickerModal.tsx
│       │   │   ├── PrescriptionEditorModal.tsx
│       │   │   ├── EditTemplateModal.tsx
│       │   │   └── __tests__/
│       │   │       └── progressionComponents.test.ts
│       │   ├── calendar/
│       │   │   ├── index.ts
│       │   │   ├── CalendarScreen.tsx
│       │   │   ├── SessionDetailModal.tsx
│       │   │   └── __tests__/
│       │   │       └── calendarComponents.test.ts
│       │   ├── inspection/
│       │   │   ├── index.ts
│       │   │   ├── ExerciseLibraryScreen.tsx
│       │   │   ├── ExerciseFormModal.tsx
│       │   │   ├── ExerciseDetailScreen.tsx
│       │   │   ├── PRBoardTable.tsx
│       │   │   ├── SBDStandardsCard.tsx
│       │   │   ├── SBDBalanceRadarChart.tsx
│       │   │   └── __tests__/
│       │   │       ├── exerciseLibraryComponents.test.ts
│       │   │       └── exerciseInspectionComponents.test.ts
│       │   ├── plots/
│       │   │   ├── index.ts
│       │   │   ├── PlotsScreen.tsx
│       │   │   ├── ProgramEraShadedChart.tsx
│       │   │   ├── WorkloadDeepDiveModal.tsx
│       │   │   ├── timeSpanUtils.ts
│       │   │   └── __tests__/
│       │   │       ├── plotsComponents.test.ts
│       │   │       ├── timeSpanUtils.test.ts
│       │   │       └── workloadDeepDiveComponents.test.ts
│       │   ├── bodyMetrics/
│       │   │   ├── index.ts
│       │   │   ├── BodyMetricsScreen.tsx
│       │   │   └── __tests__/
│       │   │       └── bodyMetricsComponents.test.ts
│       │   ├── import/
│       │   │   ├── ImportScreen.tsx
│       │   │   ├── dummyDataPresets.ts
│       │   │   └── __tests__/
│       │   │       └── importComponents.test.ts
│       │   └── settings/
│       │       ├── index.ts
│       │       ├── SettingsScreen.tsx
│       │       └── __tests__/
│       │           └── settingsComponents.test.ts
│       ├── __tests__/
│       │   └── App.test.ts
│       └── database/
│           ├── index.ts
│           ├── schema.ts
│           ├── seeds/
│           │   ├── defaultExercises.ts
│           │   └── strengthStandardsSeed.ts
│           ├── repositories/
│           │   ├── index.ts
│           │   ├── SQLiteExerciseRepository.ts
│           │   ├── SQLiteWorkoutRepository.ts
│           │   ├── SQLiteGearRepository.ts
│           │   ├── SQLiteUserSettingsRepository.ts
│           │   ├── SQLiteProgramRepository.ts
│           │   ├── SQLiteUserProfileRepository.ts
│           │   ├── SQLiteBodyMetricsRepository.ts
│           │   ├── SQLitePainReportRepository.ts
│           │   └── __tests__/
│           │       ├── SQLiteExerciseRepository.test.ts
│           │       ├── SQLiteWorkoutRepository.test.ts
│           │       ├── SQLiteGearRepository.test.ts
│           │       ├── SQLiteUserSettingsRepository.test.ts
│           │       ├── SQLiteProgramRepository.test.ts
│           │       ├── SQLiteUserProfileRepository.test.ts
│           │       ├── SQLiteBodyMetricsRepository.test.ts
│           │       └── SQLitePainReportRepository.test.ts
│           ├── mocks/
│           │   ├── index.ts
│           │   ├── MockExerciseRepository.ts
│           │   ├── MockWorkoutRepository.ts
│           │   ├── MockGearRepository.ts
│           │   ├── MockUserSettingsRepository.ts
│           │   ├── MockProgramRepository.ts
│           │   ├── MockUserProfileRepository.ts
│           │   ├── MockBodyMetricsRepository.ts
│           │   ├── MockPainReportRepository.ts
│           │   └── __tests__/
│           │       ├── MockExerciseRepository.test.ts
│           │       ├── MockWorkoutRepository.test.ts
│           │       ├── MockGearRepository.test.ts
│           │       ├── MockUserSettingsRepository.test.ts
│           │       ├── MockProgramRepository.test.ts
│           │       ├── MockUserProfileRepository.test.ts
│           │       ├── MockBodyMetricsRepository.test.ts
│           │       └── MockPainReportRepository.test.ts
│           └── __tests__/
│               ├── MockSQLiteDatabase.ts
│               └── schema.test.ts
├── companion/                  # Isolated Python 3.11+ analytics workspace
│   ├── pyproject.toml
│   ├── requirements.txt
│   ├── README.md
│   ├── src/
│   │   ├── __init__.py
│   │   ├── ingestion/
│   │   │   ├── __init__.py
│   │   │   └── schemas.py      # Pydantic v2 export & calibration models
│   │   ├── export/
│   │   │   ├── __init__.py
│   │   │   └── param_exporter.py    # Serializes Kalman posteriors to calibrated_parameters.json
│   │   ├── ui/
│   │   │   ├── __init__.py
│   │   │   ├── charts.py            # Interactive Plotly figures (1RM, k, Banister, BW)
│   │   │   └── app.py               # Streamlit interactive desktop dashboard
│   │   └── models/
│   │       ├── __init__.py
│   │       ├── kalman_1rm.py        # Tier 2 Adaptive Linear Kalman Filter
│   │       ├── recovery_modifier.py # Dynamic recoverability (Delta BW / Delta t)
│   │       ├── fatigue_banister.py  # Banister two-component impulse-response ODEs
│   │       └── recommendations.py   # ACWR and actionable training advisories
│   └── tests/
│       ├── __init__.py
│       ├── test_schemas.py          # Schema validation and boundary test suite
│       ├── test_kalman_1rm.py       # 1RM Kalman filter mathematical tests
│       ├── test_banister.py         # Banister & recoverability test suite
│       ├── test_exporter.py         # Calibrated parameter export & schema contract tests
│       └── test_ui_smoke.py         # Streamlit & Plotly headless smoke test suite
└── docs/                       # Architecture documentation and decision records
    ├── ARCHITECTURE.md         # Subsystem responsibilities, data flow, and build commands
    ├── CODEMAP.md              # Current navigation index and symbol directory
    ├── DECISIONS.md            # Architecture Decision Records (ADRs)
    └── TRAINING_AND_BODY_DATA.md # Training & body data specifications, companion calculations & gap analysis
```

### 1.1 Workspace Boundary & Execution Invariants
- **Root Directory (`/`)**: Documentation, `schemas/`, and cross-project orchestration ONLY. Never run `npm install` or create `package.json` at root.
- **Mobile (`mobile/`)**: Working directory for all Node/Expo/TypeScript commands (`npm`, `npx`, `tsc`, `jest`).
- **Companion (`companion/`)**: Working directory for all Python commands (`pip`, `pytest`, `mypy`, `streamlit`), executed strictly within `companion/.venv`.
- **Cross-Stack Synchrony**: Any SQLite or export payload alteration impacting JSON must simultaneously update `schemas/*.schema.json` and `companion/src/ingestion/schemas.py`.

### 1.2 Current Implementation Status
- **Phase 0: Repository Governance, Contracts & Workspace Scaffolding** — **COMPLETED ✅**
  - **Step 0.1**: `[x]` Completed — Workspace governance in `AGENTS.md`, ADR-026/ADR-027 in `docs/DECISIONS.md`, JSON schemas in `schemas/`.
  - **Step 0.2**: `[x]` Completed — Mobile Expo SDK init, strict `tsconfig.json`, `jest.config.js`, `mobile/src/core/types/index.ts`, and Jest smoke tests verified.
  - **Step 0.3**: `[x]` Completed — Companion virtual environment, `pyproject.toml`, `requirements.txt`, Pydantic v2 `schemas.py`, and 8/8 pytest suite verified with strict mypy.
- **Phase 1: Foundation & Minimum Viable Logger (Core In-Gym Tracking)**
  - **Step 1.1**: `[x]` Completed — Domain Core Math (`unitConversion.ts`, `heuristic1rm.ts`, `loadNormalizer.ts`, `plateCalculator.ts`), 75 unit tests passing with strict TypeScript verification.
  - **Step 1.2**: `[x]` Completed — Repository Interfaces & In-Memory Mocks (`IExerciseRepository.ts`, `IWorkoutRepository.ts`, `IGearRepository.ts`, `IUserSettingsRepository.ts`, and mock implementations with 62 unit tests passing).
  - **Step 1.3**: `[x]` Completed — SQLite Schema Migrations, Seed Catalog & Concrete Repositories (`schema.ts`, `defaultExercises.ts`, `SQLiteExerciseRepository.ts`, `SQLiteWorkoutRepository.ts`, `SQLiteGearRepository.ts`, `SQLiteUserSettingsRepository.ts`, 52 SQL driver unit tests passing).
  - **Step 1.4**: `[x]` Completed — Core Logger Application Services (`activeSessionService.ts`, `restTimerService.ts`, `exerciseSubstitutionService.ts`, `crashRecoveryService.ts`), 50 unit tests passing with strict TypeScript verification (242 tests passing across mobile).
  - **Step 1.5**: `[x]` Completed — Active Workout Logger UI & QoL Popovers (`ActiveLoggerScreen.tsx`, `SetRowComponent.tsx`, `RestTimerBanner.tsx`, `PlateCalculatorModal.tsx`, `ExerciseSubstitutionModal.tsx`, `CrashRecoveryDialog.tsx`), 16 unit tests passing (258 mobile tests total, `npx tsc --noEmit` and `npm run lint` verified).
  - **Step 1.6**: `[x]` Completed — Calendar View, Basic Settings & Root Navigation (`CalendarScreen.tsx`, `SessionDetailModal.tsx`, `SettingsScreen.tsx`, `App.tsx`), 275 mobile tests passing total, `npx tsc --noEmit` and `npm run lint` verified. Phase 1 Minimum Viable Logger MVP is now complete and gym-ready.
  - **Step 1.7 (Phase 1 Refinements)**: `[x]` Completed — Implemented ADR-029: Rebranded app to **MomentRM**, integrated `react-native-safe-area-context` for Android 15 / Xiaomi 15 edge-to-edge support, implemented compact set rows with single-set accordion editor drawer, eliminated redundant "working" badges and mixed RPE/RIR in `SessionDetailModal.tsx`, made RPE/RIR optional with per-exercise inheritance, and added e1RM exclusion guardrails for sets under 6.0 RPE (283 mobile tests passing total).
  - **Step 1.8 (Active Logger Accordion & Incomplete Sets Handling)**: `[x]` Completed — Implemented ADR-030: Single-exercise accordion focus with auto-advance upon exercise completion, minimal collapsed headers, subtle green tint for completed collapsed exercise cards (`#0F1A12`, `#14532D`, `#00E676`), interactive finish modal warning with toggle checkbox (`[ ] Log remaining sets as complete`, default unchecked: exclude/delete uncompleted sets from SQLite to preserve volume/summary/ghost purity), and write-through persistence of completed sets in `user_settings` (288 mobile tests passing total, `npx tsc --noEmit` verified).
- **Phase 2: Advanced Workout Mechanics, Hierarchy & Data Onboarding**
  - **Step 2.1: Superset Grouping & Unilateral Limb Mechanics**: `[x]` Completed — Implemented ADR-009 & ADR-021: Superset/giant set grouping/ungrouping (`groupExercises`, `ungroupExercise`, `ungroupSuperset`, `getSupersetGroups` in `activeSessionService.ts`), superset rest timer suppression logic (`RestTimerService.shouldTriggerForExerciseInGroup`), visual connector bracket component (`SupersetBracketGroup.tsx`), and dual unilateral rep inputs (`reps` L / `reps_right` R) with independent L/R steppers and formatted ghost display in `SetRowComponent.tsx` (301 mobile tests passing total, 58/58 services tests, `npx tsc --noEmit` and `npm run lint` verified).
  - **Step 2.2: Exercise Library Manager, Variant Tree & Gear Inventory UI**: `[x]` Completed — Implemented ADR-012, ADR-024, ADR-025: Equipment inventory CRUD and application service (`GearInventoryService.ts`, `GearInventoryScreen.tsx`), barbell tare weights in kg/lbs, cable pulley ratios (1:1, 2:1), catalog search/filtering, custom exercise creation and editing (`ExerciseFormModal.tsx`), and variant tree hierarchy (`ExerciseLibraryScreen.tsx` with `parent_exercise_id`), fully integrated into `SettingsScreen.tsx` and `ActiveLoggerScreen.tsx` (338 mobile tests passing total, `npx tsc --noEmit` and `npm run lint` verified).
  - **Step 2.3: Standardized JSON Export Service (Contract-Verified)**: `[x]` Completed — Implemented ADR-026 & ADR-027: Full 12-table SQLite database state serialization conforming strictly to `schemas/workout_export.schema.json`, ADR-026 dual-weight load preservation, boolean transformations, progression rule/user profile JSON parsing, 1-tap Settings export with `expo-file-system` and `expo-sharing`, and sample fixture `schemas/fixtures/sample_workout_export.json` verified cross-stack by Jest (347/347 tests) and Pytest (9/9 tests including Draft-07 JSON Schema validation).
  - **Step 2.4: External Data Import Engine (Strong CSV, Hevy CSV, Generic CSV)**: `[x]` Completed — Implemented ADR-033: Pure zero-dependency RFC 4180 CSV tokenizer (`csvImportParser.ts`) supporting `,` and `;` auto-detection, quoted fields, multiline notes, Imperial lbs-to-kg conversion, Strong and Hevy format signatures, multi-stage exercise catalog matching & custom fallback synthesis (`importService.ts`), duplicate session detection, provenance tagging (`imported_from`), and full interactive wizard (`ImportScreen.tsx`) integrated into SettingsScreen (383 mobile tests passing total, 29 test suites, `npx tsc --noEmit` and `npm run lint` verified).
  - **Step 2.5 (Phase 2 Refinements — Completed Workout Superset Summary & Post-Workout Modal)**: `[x]` Completed — Implemented specification in `edits_for_phase_2.md`: Deterministic superset badge computation (`computeSupersetInfo` mapping `exercise_group_id` to `SS A1`, `SS A2`...), subtle superset badges in exercise headers and set rows in `SessionDetailModal.tsx` while preserving original sequential exercise ordering, and seamless immediate post-workout summary presentation in `ActiveLoggerScreen.tsx` upon tapping "Save & Finish" before returning to Calendar (389 mobile tests passing total, `npx tsc --noEmit` and `npm run lint` verified).
- **Phase 3: SBD Strength Standards & Performance Intelligence**
  - **Step 3.1: Allometric Strength Standards, DOTS & Cohort Math Engine**: `[x]` Completed — Implemented ADR-034: Official IPF DOTS 4th-degree polynomial formula (`dotsCoefficients.ts`) with male and female coefficients and SBD total calculation, 95-row empirical benchmark catalog (`strengthStandardsSeed.ts`) across Squat, Bench, Deadlift, OHP, and Row for Male and Female, bilinear quantile interpolation (`interpolateStandards`), continuous normalized strength scoring (`calculateContinuousScore` mapping 0–100+ across Untrained, Novice, Intermediate, Advanced, Elite), demographic population percentiles (`calculateDemographicPercentile` mapping 0.1%–99.9%), and composite SBD symmetry/balance profiling (`calculateSBDBalanceProfile` with radar coordinates) (426 mobile tests passing total, 31 test suites, `npx tsc --noEmit` and `npm run lint` verified).
  - **Step 3.2: Exercise Inspection Service & Rep-Max Record (PR Board) Queries**: `[x]` Completed — Implemented ADR-035: Heaviest load lifted per unique repetition count queries with SQLite window functions (`PARTITION BY s.reps ORDER BY s.weight DESC, intensity DESC`), date scoping for program blocks, cross-variant family aggregation (`parent_exercise_id`), set e1RM benchmark calculations ($w \cdot r_{\text{eff}}^k$), peak e1RM record resolution, SBD standard classification integration, and comprehensive exercise inspection overviews (`ExerciseInspectionService.ts`) (440 mobile tests passing total, 32 test suites, `npx tsc --noEmit` and `npm run lint` verified).
- **Phase 4: Training Psychology, Program Generation & Rule Builder**
  - **Step 4.1: Declarative Progression Rule Engine Pure Evaluator**: `[x]` Completed — Implemented ADR-037: Pure side-effect-free progression evaluator (`progressionRuleEngine.ts`) with priority ordering, composite proposals, and Dynamic Double Progression (DDP) set-level granularity, supporting conditions (`ALL_SETS_HIT_TARGET_REPS`, `ANY_SET_HIT_TOP_REP_RANGE`, `AVERAGE_RPE_LESS_THAN`, `CONSECUTIVE_SUCCESSFUL_SESSIONS`, `CONSECUTIVE_FAILED_SESSIONS`, `MISSED_REPS_COUNT`, `TOP_SET_RIR_GREATER_THAN`) and actions (`INCREASE_LOAD_FIXED`, `INCREASE_LOAD_PERCENT`, `DECREASE_LOAD_FIXED`, `INCREASE_TARGET_REPS`, `ADD_WORKING_SET`, `RESET_TO_BASELINE`, `TRIGGER_DELOAD`, `RESET_WEIGHT_PERCENT`), plus built-in presets for LP, DP, and DDP (483 mobile tests passing total, 34 test suites, `npx tsc --noEmit` and `npm run lint` verified).
  - **Step 4.2: Profile-Driven Program Synthesizer Pure Generator**: `[x]` Completed — Implemented ADR-038: Pure deterministic generator (`programSynthesizer.ts`) mapping `UserProfile` matrix (days per week, intensity style, primary goal, session duration, equipment access, training enjoyment) into complete multi-day program splits (Full Body, Upper/Lower, PPLUL 5-day, PPL 6-day) with set counts (1–2 @ RPE 9.5 vs 3–4 @ RPE 7.5), antagonist superset grouping (`exercise_group_id`) for minimalist / short sessions, equipment resolution, and progression rules (503 mobile tests passing total, 35 test suites, `npx tsc --noEmit` and `npm run lint` verified).
  - **Step 4.3: Programs, Templates, Meso-Cycle Blocks & Profile Repositories**: `[x]` Completed — Full persistence for `programs`, `workout_templates`, `template_exercises`, `progression_rules`, `program_blocks`, and `user_profiles` across repository interfaces (`IProgramRepository.ts`, `IUserProfileRepository.ts`), concrete SQLite repositories (`SQLiteProgramRepository.ts`, `SQLiteUserProfileRepository.ts`), in-memory mock repositories (`MockProgramRepository.ts`, `MockUserProfileRepository.ts`), and application service `ProgramBlockService.ts` for 1-tap program swapping and meso-cycle era resolution (552 mobile tests passing total, 40 test suites, `npx tsc --noEmit` and `npm run lint` verified).
  - **Step 4.4: Questionnaire UI, Program Builder, Rule Editor & Interactive Progression Banner**: `[x]` Completed — Implemented ADR-039 & ADR-040: Athlete psychological profile & logistics questionnaire (`UserProfileScreen.tsx`) with 1-tap custom program generation wiring `programSynthesizer.ts` and `ProgramBlockService`, visual IF/THEN/ELSE progression rule editor modal (`ProgressionBuilderModal.tsx`) with LP, DP, and DDP quick presets, multi-day split overview manager (`ProgramOverviewScreen.tsx`) with 1-tap program swapping and prescription inspection, high-contrast OLED logger progression proposal banner (`ProgressionProposalBanner.tsx`), and calendar month/week swap badges and meso-cycle headers (`CalendarScreen.tsx`) (568 mobile tests passing total, 43 test suites, `npx tsc --noEmit` and `npm run lint` verified).
  - **Step 4.5: Program Builder & Editor, Training Mentality Matrix, 15m Routines & 4-Hub Navigation Overhaul**: `[x]` Completed — Implemented ADR-041 per `edits_for_phase_4.md`:
    - *Custom Program Builder & Presets Protection*: Program deep-cloning service (`programCloneService.ts`, `prog_custom_<ts>_<hash>`), top-level program actions (Create blank custom, Duplicate/clone, cascade delete, Set as active), template CRUD (add day, edit metadata, up/down reorder, delete day), and template exercise editor (catalog picker modal with search/filters, delete, up/down reorder, 1-tap swap, sets/reps/exertion/gear/rest configuration modal, antagonist superset linking/unlinking, and ProgressionBuilderModal integration).
    - *Training Mentality Model (Rule 8.4)*: Unified `TrainingMentality = 'fury' | 'precision' | 'get_out'` replacing `training_enjoyment` and deprecating `intensity_style` across `mobile/`, `schemas/`, and `companion/`.
    - *15-Minute Target Duration*: Exactly 4 exercises in 2 antagonist pairs, 2 sets each (8 total working sets), 0s intra-pair rest, 90s inter-pair rest.
    - *4-Hub Navigation Overhaul*: Root navigation transitioned to `HOME (🏠)` (`HomeScreen.tsx` with status dashboard, calendar agenda, analytics mount point), `WORKOUT (⚡)` (`WorkoutTabRouter.tsx` resolving State A in-progress logger, State B pre-flight screen with circular template sequencing, and State C empty state), `PROFILE (👤)` (`UserProfileScreen.tsx`), and `SETTINGS (⚙️)` (`SettingsScreen.tsx`). (577 mobile tests passing total, 44 test suites, `npx tsc --noEmit` and `pytest` 9/9 passing verified).
  - **Step 4.6 (Phase 4 Refinements — Equipment Access & 3-Level Implement Assignment)**: `[x]` Completed — Implemented ADR-040: Relocated Equipment Inventory to `UserProfileScreen` under 'Equipment Access', removed misleading full-card green default highlights in `GearInventoryScreen`, restricted global 'Set Default' on specialty bars (SSB, Trap Bar) while preserving fallback on standard barbells, added 3-level gear selection (Exercise catalog presets in `ExerciseFormModal`, Program template prescriptions in `PrescriptionEditorModal`, and Active Logger 1-tap switcher `GearPickerModal` in `ActiveLoggerScreen`), and confirmed bar tare isolation preventing specialty bars from ever swapping onto Bench Press or Deadlift (582 mobile tests passing total, 44 test suites, `npx tsc --noEmit` and `pytest` 9/9 passing verified).
  - **Step 4.8 (UI Refinements — Home Hub, Calendar Accordion & Inspection Unit Formatting)**: `[x]` Completed —
    - *PR Board & Inspection Unit Formatting*: Resolved double-unit bug ("kg kg" / "kg lbs") across `PRBoardTable.tsx`, `ExerciseDetailScreen.tsx`, `SBDBalanceRadarChart.tsx`, and `SBDStandardsCard.tsx` by relying strictly on `formatWeight(kg, unitSystem)` without manual suffix concatenation or duplicate `kgToLbs` conversions.
    - *Calendar Accordion Overhaul*: Re-architected `CalendarScreen.tsx` with `initialExpanded` prop (defaulting `false`), rendering only the active 7-day week row when collapsed and expanding on demand to the full 7-column monthly grid via header toggle buttons and an interactive accordion bar handle (`calendar-accordion-handle`).
    - *Workout Start Mitigation*: Removed all 3 workout start trigger buttons from the Home screen (`home-start-next-workout-btn`, `home-start-freestyle-btn`, and Calendar embedded `addWorkoutButton`/`startSessionOutlineButton`) to strictly funnel session initialization into Tab 2 `WORKOUT` (`WorkoutTabRouter.tsx`).
    - *Interactive DOTS & Symmetry Analytics*: Removed the lightning badge (`⚡`) from the DOTS Progression card and transformed both "DOTS Progression" and "Symmetry Radar" cards into touchable triggers opening the `SBDBalanceRadarChart` modal with live allometric multi-axis balance and composite DOTS powerlifting scores (665 mobile tests passing total across 49 test suites, `npx tsc --noEmit` verified).
  - **Step 4.9 (UI Polish — Plot Partitioning, Calendar Rest Day Collapse & Persistent DOTS)**: `[x]` Completed —
    - *Calendar Rest Day Collapse*: In `CalendarScreen.tsx`, suppressed `emptyAgendaContainer` and conditionalized `agendaHeaderRow` to collapse rest/recovery days into 0 vertical height when no workouts are logged, saving extensive scroll real estate.
    - *Plot Group Partitioning*: In `PlotsScreen.tsx`, split 5 time-series charts into two distinct groups (`targetGroup?: 'performance' | 'body_composition'`) with `PERFORMANCE_CHARTS` (`e1rm`, `volume`) and `BODY_COMPOSITION_CHARTS` (`bodyweight`, `body_fat`, `circumferences`), plus an interactive group segment toggle when `targetGroup` is unset.
    - *Home Dashboard Dual-Section Split*: In `HomeScreen.tsx`, partitioned the lower dashboard into **Performance Analytics** (with persistent, full-width `DOTS Progression` card showing live DOTS coefficient and tapping to inspect SBD Balance) and **Body Composition** (with `Log Body ⚖️` quick action and dedicated physique plots). Removed redundant half-width `Symmetry Radar` button. (669 mobile tests passing across 49 test suites, `npx tsc --noEmit` verified).
  - **Step 4.10 (Workload, Volume Landmarks & Dual Intensity Intelligence Suite)**: `[x]` Completed —
    - *Workload Analysis Engine (`workloadAnalysisService.ts`)*: Implemented calendar-aware Monday–Sunday weekly workload synthesizer calculating hypertrophy volume landmarks per muscle group (categorized into Low/Maintenance, Optimal MAV 8–18 sets, High, and Fatigue Risk), daily session tonnage and working set distributions across all 7 days, and dual intensity profiling.
    - *Dual-Faceted Intensity Intelligence*: Developed simultaneous calculation of Effort Intensity (mean working RPE, stimulating set ratio for RPE $\ge 8.0$, and 4-tier distribution) alongside Relative Load Intensity (volume-load weighted % of e1RM via Lombardi power law, with Heavy $>85\%$, Moderate $70–85\%$, and Light $<70\%$ training load zones).
    - *Workload Deep Dive Modal (`WorkloadDeepDiveModal.tsx`)*: Full-screen interactive inspection modal accessible via `home-workload-deep-dive-btn` in the Home screen's Performance Analytics header. Includes calendar week navigation (with "THIS WEEK" active indicator), 4-metric KPI summary strip, muscle group landmark progress tracks, daily session comparison cards, and dual intensity distribution charts. (674 mobile tests passing across 51 test suites, `npx tsc --noEmit` verified).
- **Phase 5: Anthropometry, Body Composition & Longitudinal Plotting**
  - **Step 5.1: U.S. Navy Body Fat, Rolling Averages & Body Metrics Repository**: `[x]` Completed — Implemented ADR-041: Official DoD metric body density formula with Siri equation (`navyBodyFat.ts`) with male and female circumference equations in cm, strict anatomical guards, physiological bounds clamping, dual-curve bodyweight smoothing (calendar-aware 7-day SMA and exponential smoothing EMA $\alpha=0.25$), abstract repository interface (`IBodyMetricsRepository.ts`), in-memory mock (`MockBodyMetricsRepository.ts`), and concrete SQLite repository (`SQLiteBodyMetricsRepository.ts`) with automatic active `user_profiles` resolution and persistence (618 mobile tests passing total across 47 test suites, `npx tsc --noEmit` and `npm run lint` verified).
  - **Step 5.2: Body Metrics Screen & Longitudinal Plots with Program Era Shading**: `[x]` Completed — Implemented ADR-042, ADR-045 & ADR-061: Reusable SVG time-series chart wrapper with meso-cycle program era shading (`ProgramEraShadedChart.tsx`), complete 6-chart longitudinal suite (`PlotsScreen.tsx` for e1RM progression, bodyweight with 7-day rolling SMA/EMA, body fat %, estimated Lean Body Mass (eLBM), circumferences, and Monday-bucketed volume tonnage), anthropometry logger (`BodyMetricsScreen.tsx` with live Navy BF% and eLBM estimates, rolling average banner, and historical logs), bidirectional metric/imperial unit conversion (`unitConversion.ts`), robust circumference-only optional bodyweight export synchronization (`schemas/workout_export.schema.json` & `schemas.py`), and HomeScreen inline integration (737 mobile tests passing total across 54 test suites, `npx tsc --noEmit` and `pytest companion/tests` passing verified).
- **Phase 6: Companion Scientific Analysis Suite (Python Engine & Dashboard)**
  - **Step 6.1: Tier 2 Adaptive Linear Kalman Filter Engine (`kalman_1rm.py`)**: `[x]` Completed — Implemented ADR-044: Discrete state-space Linear Kalman Filter tracking $\mathbf{x}_t = [\ln(1\text{RM}_t), k_t]^T$ under linearized Lombardi power law, quadratic measurement noise variance $R_t = \sigma_{\text{base}}^2 (1 + \lambda r_{\text{eff}}^2)$, diagonal process noise $\mathbf{Q}$, lift-specific priors (Bench 0.085, Squat 0.095, Deadlift 0.075, Default 0.10), deadlift +10% heuristic exclusion invariant (ADR-026), true 1RM bypass ($r_{\text{eff}}=1.0 \implies \mathbf{H}=[1, 0]$), intra-session pre-processing (top 2 sets with lowest RIR / highest weight, discarding RIR > 3, warmups, and failed reps), and box-clipping heuristic $k \in [0.03, 0.16]$ (13/13 pytest unit tests passing, 22/22 total companion tests passing, strict mypy verified).
  - **Step 6.2: Dynamic Recoverability & Banister Impulse-Response Engine**: `[x]` Completed — Implemented ADR-045: 14-day rolling bodyweight OLS linear regression slope ($\Delta BW / \Delta t$) scaling fatigue decay constant $\tau_2$ dynamically (shortened 10–25% in surplus, lengthened 15–30% in deficit) in `recovery_modifier.py`; Effective Stimulating Sets ($\text{RPE} \ge 7.0$ scaled by $\text{weight}/1\text{RM}$) and two-component Fitness ($P_t, \tau_1=42\text{d}$) and Fatigue ($F_t, \text{dynamic } \tau_2$) ODE integrator in `fatigue_banister.py`; rolling Acute:Chronic Workload Ratio (ACWR) and structured training advisories (`OPTIMAL_OVERLOAD`, `DELOAD_WARNING`, `UNDER_STIMULATION`, `OVERREACHING`) in `recommendations.py` (13/13 pytest unit tests passing, 35/35 total companion tests passing, strict mypy verified).
- **Next Up**: **Phase 6: Companion Scientific Analysis Suite — Step 6.3: Calibrated Parameter Exporter & Mobile Ingestion Round-Trip**.

- For complete phase-by-phase status, refer to the [Implementation Progress & Milestone Tracker](file:///c:/Programmering/Eget/Workout_suite/IMPLEMENTATION_PLAN.md#3-step-by-step-atomic-execution-plan).



---

## 2. Core Specification Documents & Reference Index

| File | Type | Primary Role & Responsibility |
| :--- | :--- | :--- |
| [Rough_sketch.md](file:///c:/Programmering/Eget/Workout_suite/Rough_sketch.md) | Specification | Comprehensive requirements document covering mobile tracker, companion analysis, progression builder, Navy body fat, and dual-tier 1RM. |
| [IMPLEMENTATION_PLAN.md](file:///c:/Programmering/Eget/Workout_suite/IMPLEMENTATION_PLAN.md) | Engineering Plan | Phased technical roadmap, SQLite database DDL schema, Banister model formulas, and Gantt milestones. |
| [1RM_calculation.txt](file:///c:/Programmering/Eget/Workout_suite/1RM_calculation.txt) | Algorithm Spec | Python algorithm and state-space equations for the Adaptive Linear Kalman Filter ($x_t = [\ln(1\text{RM}), k]^T$). |
| [Deep_research_1RM.md](file:///c:/Programmering/Eget/Workout_suite/Deep_research_1RM.md) | Scientific Research | Meta-regressive and biomechanical literature review detailing accuracy profiles across bench press, back squat, and deadlift. |
| [AGENTS.md](file:///c:/Programmering/Eget/Workout_suite/AGENTS.md) | Governance | Project architecture rules, exploration protocol, and documentation maintenance requirements. |
| [docs/ARCHITECTURE.md](file:///c:/Programmering/Eget/Workout_suite/docs/ARCHITECTURE.md) | Architecture | Subsystem boundaries, runtime execution flows, and build/test commands. |
| [docs/DECISIONS.md](file:///c:/Programmering/Eget/Workout_suite/docs/DECISIONS.md) | Architecture Decisions | Documented design rationales (ADRs) explaining technical trade-offs. |
| [docs/TRAINING_AND_BODY_DATA.md](file:///c:/Programmering/Eget/Workout_suite/docs/TRAINING_AND_BODY_DATA.md) | Data & Metrics Spec | Detailed description of saved training/body metrics, Companion calculations, and gap analysis. |

---

## 3. Implementation Target Locations (Planned Codebase Layout)

When code generation begins in subsequent phases, components must be placed into the following directory conventions:

### 3.1 Shared Exchange Contract (`schemas/`)
- `schemas/workout_export.schema.json` — Canonical JSON Schema defining the data export contract between Mobile and Companion.
- `schemas/calibrated_parameters.schema.json` — JSON Schema for companion-exported calibrated $(1\text{RM}, k)$ parameters.

### 3.2 Mobile App Directory (`mobile/`)
> **Workspace Execution Rule**: All Node/Expo/TypeScript commands (`npm`, `npx`, `tsc`, `jest`) MUST be executed with `mobile/` as the working directory (e.g. `cd mobile && npm ...` or via `npm --prefix mobile`). Never execute npm in the repository root.

- `mobile/src/core/` — Zero-dependency Domain Core (pure mathematical functions & entity types).
  - `math/heuristic1rm.ts` — Lombardi power law ($w \cdot r_{\text{eff}}^{0.10}$) calculation; accepts optional calibrated $k$.
  - `math/plateCalculator.ts` — Pure plate loading solver (`targetWeight`, `barTareKg`, `inventory`).
  - `math/loadNormalizer.ts` — Normalizes dumbbell per-hand input, bodyweight total system load, and cable ratios (ADR-026: computes normalized effective mechanical load in kg alongside lifter's raw input weight).
  - `math/strengthStandards.ts` — Evaluates SBD e1RM against empirical & allometric bodyweight tiers (Untrained to Elite) and computes continuous score + kg delta.
  - `math/dotsCoefficients.ts` — Official powerlifting DOTS formula score calculator.
  - `math/navyBodyFat.ts` — U.S. Navy circumference body fat algorithm (DoD metric density + Siri equation) and calendar-aware 7-day rolling SMA / EMA smoothing engines.
  - `math/effectiveReps.ts` — Hypertrophic effective reps ($e_{\text{reps}}$) model and weekly volume landmark corridors ($<20$ Low/MED, $20–48$ Optimal MAV, $49–65$ High, $>65$ Peak) with strict unrated set exclusion and auto-failure handling (ADR-064).
  - `math/unitConversion.ts` — Pure kg ↔ lbs conversion functions.
  - `generator/programSynthesizer.ts` — Pure profile-driven program synthesizer mapping user demographics, schedule, exertion intensity, and equipment access to complete multi-day splits with antagonist supersets and progression rules.
  - `rules/progressionRuleEngine.ts` — Pure side-effect-free evaluator for declarative progression rules, supporting condition matching, priority sorting, DDP set-level proposals, and LP/DP/DDP presets.
  - `parsers/csvImportParser.ts` — Pure zero-dependency RFC 4180 CSV tokenizer and format auto-detector.
  - `types/` — Shared domain types (Exercise, Set, SetType, Unit, RPE/RIR, ProgressionRule, UserProfile, StrengthStandard, LiftType, GearItem, PainType, PainReport).
- `mobile/src/domain/repositories/` — Abstract repository interfaces (Ports).
  - `IProgramRepository.ts`, `IWorkoutRepository.ts`, `IExerciseRepository.ts`, `IGearRepository.ts`, `IBodyMetricsRepository.ts`, `IProgramBlockRepository.ts`, `IProgressionRuleRepository.ts`, `ICalibratedParamRepository.ts`, `IUserProfileRepository.ts`, `IPainReportRepository.ts`.
- `mobile/src/features/` — Vertical feature slices (encapsulated screens, hooks, and local components).
  - `features/home/` — `HomeScreen.tsx`, Quick Status Dashboard (active program, next workout quick card, weekly metrics: workouts this week, tonnage, streak), interactive calendar agenda, reserved analytics mount point.
  - `features/logger/` — `WorkoutTabRouter.tsx` (resolving State A active logger, State B circular template pre-flight screen, State C empty state), `ActiveLoggerScreen.tsx` (with on-the-fly implement switcher `GearPickerModal` and PlateCalculator tare synchronization), `PlateCalculatorModal.tsx`, `ExerciseSubstitutionModal.tsx`, `PainReportModal.tsx` (in-session joint vs muscle discomfort modal, 1–10 severity rating, automatic pruning of uncompleted sets when severity > 6, and physiotherapist disclaimer banner), ghosting logic, set checklist, spelled-out set type selector (`Reg`, `Warm`, `Drop`, `Myo`, `DC`), per-set notes, superset bracket UI, set-type-specific rest timer triggers (0s drop, 10s myo, 30s dc), crash recovery Resume/Discard prompt.
  - `features/calendar/` — `CalendarScreen.tsx`, monthly agenda, meso-cycle swap indicators.
  - `features/inspection/` — `ExerciseDetailScreen.tsx`, Rep-Max Record PR board (all-time / per-program toggle), SBD Strength Standards tier badge, progress bar to next tier, set e1RM benchmarks, variant hierarchy display.
  - `features/progression/` — `ProgramOverviewScreen.tsx` (full CRUD builder with cloning protection, template CRUD/reordering, exercise CRUD/reordering/swap/superset), `ProgressionBuilderModal.tsx` (visual IF/THEN/ELSE condition-action rule builder with LP/DP/DDP presets), `CatalogPickerModal.tsx`, `PrescriptionEditorModal.tsx` (with implement/gear assignment chips), `EditTemplateModal.tsx`.
  - `features/gear/` — `GearInventoryScreen.tsx`, accessible gym equipment inventory, specialty barbell tare weights, custom machine cable ratios manager, accessed via Profile hub Equipment Access modal.
  - `features/profile/` — `UserProfileScreen.tsx`, Training Mentality matrix (`fury`, `precision`, `get_out`), demographics, logistics (including 15m duration), Equipment Access hub (`GearInventoryScreen` modal integration), 1-tap generator, active program banner.
  - `features/bodyMetrics/` — `BodyMetricsScreen.tsx`, tape measurement inputs, body fat estimator, 7-day rolling average.
  - `features/plots/` — `PlotsScreen.tsx`, `timeSpanUtils.ts` (time span window calculation & point filtering: All data, Year, 3 months, Month, Week), time-series charts with program era shaded bands, SBD Symmetry & Balance Radar chart, demographic cohort percentiles.
  - `features/import/` — `ImportScreen.tsx`, `dummyDataPresets.ts`, Strong CSV / Hevy CSV / Liftosaur CSV / StrengthLog Training & Body Comp CSV parsers, 1-tap Expo Go evaluation preset loaders, exercise mapping wizard UI, duplicate session detection, and date range filtering.
  - `features/settings/` — `SettingsScreen.tsx`, units, RPE/RIR preferences, `pure_utility_mode` toggle, export trigger, calibrated parameter import trigger.
- `mobile/src/services/` — Application orchestration services.
  - `programCloneService.ts` — Deep cloning service protecting pre-built/synthesized templates by cloning to custom (`prog_custom_<ts>_<hash>`).
  - `dashboardMetricsService.ts` — Computes weekly workouts count, total tonnage in kg, and consecutive active training streak.
  - `plateCalculatorService.ts` — Manages plate breakdown popover state and bar tare calculation.
  - `exerciseSubstitutionService.ts` — Recommends variant movements during active sessions and transfers targets.
  - `gearInventoryService.ts` — Equipment inventory and mechanical advantage resolver (defaults: 20kg bar, 1:1 rows/pulldowns, 2:1 functional trainers).
  - `strengthStandardsService.ts` — SBD standard tier lookups, continuous score interpolation, and SBD total aggregation.
  - `programRecommenderService.ts` — Profile-driven routine synthesizer mapping psychology and goals to template exercises and progression rules.
  - `cohortBenchmarkService.ts` — Local-first population percentile comparisons (Phase 3) and cloud social leaderboard synchronization (Phase 7).
  - `exportService.ts` — JSON serializer and OS Share Sheet integration (`expo-sharing`).
  - `importService.ts` — External app CSV/JSON parser, multi-source exercise catalog mapper, AMRAP detection, body metrics importer, duplicate session detector, and provenance tagger.
  - `calibratedParamService.ts` — Reads `calibrated_parameters.json` and writes to `calibrated_params` table.
  - `crashRecoveryService.ts` — Detects `status = 'in_progress'` sessions on startup and triggers Resume/Discard flow.
  - `restTimerService.ts` — Background timer triggers, superset group awareness, and audio/haptic cues.
  - `progressionEngine.ts` — Pure condition-action rule evaluation engine (supports increase, decrease, reset, deload actions).
  - `programBlockService.ts` — Meso-cycle date interval resolver and color band calculator.
- `mobile/src/database/` — Infrastructure Layer (Adapters).
  - `index.ts` — Production barrel exporting schema and repositories (decoupled from mocks to guarantee tree-shaking).
  - `schema.ts` — SQLite table DDL (12 tables) and transactional `PRAGMA user_version = 4` migration framework (`expo-sqlite`), featuring composite index `idx_workout_sets_ex_created`, `pain_reports` table with workout/exercise foreign keys and indexes, and cascading constraints.
  - `repositories/` — Concrete SQLite implementations of domain repository interfaces (`SQLiteProgramRepository.ts`, `SQLiteWorkoutRepository.ts`, `SQLiteGearRepository.ts`, `SQLiteUserProfileRepository.ts`, `SQLiteBodyMetricsRepository.ts` with `imported_from` provenance, `SQLiteUserSettingsRepository.ts`, `SQLitePainReportRepository.ts`, etc.).
  - `mocks/` — In-memory test repositories (`MockProgramRepository.ts`, `MockWorkoutRepository.ts`, `MockGearRepository.ts`, `MockUserProfileRepository.ts`, `MockBodyMetricsRepository.ts`, `MockUserSettingsRepository.ts`, `MockPainReportRepository.ts`, etc.), consumed strictly within unit tests.

### 3.3 Companion Analysis Suite (`companion/`)
> **Workspace Execution Rule**: All Python commands (`pip`, `pytest`, `mypy`, `streamlit`) MUST be executed within the virtual environment `companion/.venv`.

- `companion/pyproject.toml` — Companion package specification, build configuration, pytest, and strict mypy settings.
- `companion/requirements.txt` — Pinned/bounded runtime and dev dependencies.
- `companion/tests/` — Test suite for companion schemas, models, and export.
- `companion/src/ingestion/` — Ingestion & contract validation.
  - `parser.py` — File reader for `workout_data_export.json`.
  - `schemas.py` — Pydantic v2 data models enforcing schema conformity.
- `companion/src/models/` — Headless scientific modeling engine (pure NumPy/SciPy math).
  - `kalman_1rm.py` — Linear Kalman Filter updating $(1\text{RM}_t, k_t)$ per exercise via single top-set selection (`max_session_sets=1`) ranked by projected e1RM ($w \cdot r_{\text{eff}}^k$), single consolidated daily batch evaluation, 3-stage gating pipeline (intra-session reference, Huber M-estimation, physical load floor), Joseph stabilized covariance form, soft Tikhonov prior anchor, and Simon's covariance-weighted boundary projection.
  - `fatigue_banister.py` — Two-component impulse-response ODE solver with per-exercise and session-level diminishing returns saturation ($\kappa_{\text{ex}} = 4.0$) and scale-invariant unit-gain EWMA discretization bounding $P(t), F(t) \in [0, 100]$.
  - `mesocycle_analyzer.py` — Survival analysis and change-point detection engine for individual optimal mesocycle length ($L_{\text{opt}}$). Combines Kalman e1RM gain velocity stall, iso-load RPE drift, and Page's CUSUM systemic exhaustion with empirical Banister boundary segmentation and conjugate Normal-Normal Bayesian updating.
  - `recovery_modifier.py` — 14-day rolling bodyweight slope ($\Delta BW / \Delta t$) fatigue scaler.
  - `recommendations.py` — ACWR calculation, deload trigger, and progressive overload advisory engine.
- `companion/src/export/` — Calibrated parameter output.
  - `param_exporter.py` — Serializes per-exercise $(1\text{RM}, k)$ to `calibrated_parameters.json` for mobile import with configurable `default_working_rir`.
- `companion/src/ui/` — Presentation Layer.
  - `app.py` — Streamlit / Plotly interactive web dashboard with exercise coverage strip, actual 1RM performance tracking callouts, unrated working set toggles, Mesocycle Optimizer tab ($L_{\text{opt}}$ and deload window), and round-trip export.
  - `charts.py` — Interactive Plotly chart builders: Kalman 1RM trajectory with ±1 SD uncertainty envelope and distinct crimson star markers (★) for tested actual 1RMs vs amber diamonds for submaximal sets, repetition endurance drift ($k_t$), Banister impulse-response curves (Fitness/Fatigue/Readiness), longitudinal bodyweight OLS slope, and 2-panel Mesocycle Survival & Fatigue Curve with shaded 90% Bayesian credible interval deload window.
- `companion/tests/` — Test suite for companion analytics.
  - `test_banister.py` — Tests for Banister fitness-fatigue ODE integration, saturation, and ACWR alerts.
  - `test_exporter.py` — Tests for calibrated parameter export conformity.
  - `test_kalman_1rm.py` — Tests for Tier 2 adaptive Kalman filtering and endurance estimation.
  - `test_mesocycle_analyzer.py` — Tests for boundary segmentation, RPE drift clamping, and Bayesian mesocycle updates.
  - `test_schemas.py` — Tests for Pydantic v2 schemas.
  - `test_ui_smoke.py` — Headless smoke tests for Streamlit UI and Plotly chart generators.



