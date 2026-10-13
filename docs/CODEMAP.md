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
│   └── calibrated_parameters.schema.json
├── mobile/                     # Isolated React Native (Expo TypeScript) workspace
│   ├── app.json
│   ├── App.tsx
│   ├── index.ts
│   ├── jest.config.js
│   ├── package.json
│   ├── tsconfig.json
│   ├── README.md
│   └── src/
│       └── core/
│           └── types/
│               ├── index.ts
│               └── __tests__/types.test.ts
├── companion/                  # Isolated Python 3.11+ analytics workspace
│   ├── pyproject.toml
│   ├── requirements.txt
│   ├── README.md
│   ├── src/
│   │   ├── __init__.py
│   │   └── ingestion/
│   │       ├── __init__.py
│   │       └── schemas.py      # Pydantic v2 export & calibration models
│   └── tests/
│       ├── __init__.py
│       └── test_schemas.py     # Schema validation and boundary test suite
└── docs/                       # Architecture documentation and decision records
    ├── ARCHITECTURE.md         # Subsystem responsibilities, data flow, and build commands
    ├── CODEMAP.md              # Current navigation index and symbol directory
    └── DECISIONS.md            # Architecture Decision Records (ADRs)
```

### 1.1 Workspace Boundary & Execution Invariants
- **Root Directory (`/`)**: Documentation, `schemas/`, and cross-project orchestration ONLY. Never run `npm install` or create `package.json` at root.
- **Mobile (`mobile/`)**: Working directory for all Node/Expo/TypeScript commands (`npm`, `npx`, `tsc`, `jest`).
- **Companion (`companion/`)**: Working directory for all Python commands (`pip`, `pytest`, `mypy`, `streamlit`), executed strictly within `companion/.venv`.
- **Cross-Stack Synchrony**: Any SQLite or export payload alteration impacting JSON must simultaneously update `schemas/*.schema.json` and `companion/src/ingestion/schemas.py`.

### 1.2 Current Implementation Status
- **Current Phase**: **Phase 0: Repository Governance, Contracts & Workspace Scaffolding** — **COMPLETED ✅**
  - **Step 0.1**: `[x]` Completed — Workspace governance in `AGENTS.md`, ADR-026/ADR-027 in `docs/DECISIONS.md`, JSON schemas in `schemas/`.
  - **Step 0.2**: `[x]` Completed — Mobile Expo SDK init, strict `tsconfig.json`, `jest.config.js`, `mobile/src/core/types/index.ts`, and Jest smoke tests verified.
  - **Step 0.3**: `[x]` Completed — Companion virtual environment, `pyproject.toml`, `requirements.txt`, Pydantic v2 `schemas.py`, and 8/8 pytest suite verified with strict mypy.
- **Next Up**: **Phase 1: Foundation & Minimum Viable Logger (Core In-Gym Tracking)** $\rightarrow$ **Step 1.1: Domain Core Math** (1RM Heuristic, Load Normalizer, Plate Solver, Units).
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
  - `math/navyBodyFat.ts` — U.S. Navy circumference body fat algorithm.
  - `math/unitConversion.ts` — Pure kg ↔ lbs conversion functions.
  - `types/` — Shared domain types (Exercise, Set, SetType, Unit, RPE/RIR, ProgressionRule, UserProfile, StrengthStandard, LiftType, GearItem).
- `mobile/src/domain/repositories/` — Abstract repository interfaces (Ports).
  - `IProgramRepository.ts`, `IWorkoutRepository.ts`, `IExerciseRepository.ts`, `IGearRepository.ts`, `IBodyMetricsRepository.ts`, `IProgramBlockRepository.ts`, `IProgressionRuleRepository.ts`, `ICalibratedParamRepository.ts`, `IUserProfileRepository.ts`.
- `mobile/src/features/` — Vertical feature slices (encapsulated screens, hooks, and local components).
  - `features/logger/` — `ActiveLoggerScreen.tsx`, `PlateCalculatorModal.tsx`, `ExerciseSubstitutionModal.tsx`, ghosting logic (global scope), set checklist, set type selector, per-set notes, superset bracket UI, rest timer hooks, crash recovery Resume/Discard prompt.
  - `features/calendar/` — `CalendarScreen.tsx`, monthly agenda, meso-cycle swap indicators.
  - `features/inspection/` — `ExerciseDetailScreen.tsx`, Rep-Max Record PR board (all-time / per-program toggle), SBD Strength Standards tier badge, progress bar to next tier, set e1RM benchmarks, variant hierarchy display.
  - `features/progression/` — `ProgressionBuilderScreen.tsx`, visual IF/THEN/ELSE condition-action rule builder, `ProgramGeneratorModal.tsx` (profile-driven routine wizard), `progression_rules` CRUD.
  - `features/gear/` — `GearInventoryScreen.tsx`, specialty barbell tare weights, custom machine cable ratios manager.
  - `features/profile/` — `UserProfileScreen.tsx`, multi-step psychological questionnaire (enjoyment, effort style, primary/secondary goals, schedule, equipment).
  - `features/bodyMetrics/` — `BodyMetricsScreen.tsx`, tape measurement inputs, body fat estimator, 7-day rolling average.
  - `features/plots/` — `PlotsScreen.tsx`, time-series charts with program era shaded bands, SBD Symmetry & Balance Radar chart, demographic cohort percentiles.
  - `features/import/` — `ImportScreen.tsx`, Strong CSV / Hevy CSV / generic parsers, exercise mapping UI, duplicate detection.
  - `features/settings/` — `SettingsScreen.tsx`, units, RPE/RIR preferences, `pure_utility_mode` toggle, export trigger, calibrated parameter import trigger.
- `mobile/src/services/` — Application orchestration services.
  - `plateCalculatorService.ts` — Manages plate breakdown popover state and bar tare calculation.
  - `exerciseSubstitutionService.ts` — Recommends variant movements during active sessions and transfers targets.
  - `gearInventoryService.ts` — Equipment inventory and mechanical advantage resolver (defaults: 20kg bar, 1:1 rows/pulldowns, 2:1 functional trainers).
  - `strengthStandardsService.ts` — SBD standard tier lookups, continuous score interpolation, and SBD total aggregation.
  - `programRecommenderService.ts` — Profile-driven routine synthesizer mapping psychology and goals to template exercises and progression rules.
  - `cohortBenchmarkService.ts` — Local-first population percentile comparisons (Phase 3) and cloud social leaderboard synchronization (Phase 7).
  - `exportService.ts` — JSON serializer and OS Share Sheet integration (`expo-sharing`).
  - `importService.ts` — External app CSV/JSON parser, exercise mapper, and provenance tagger.
  - `calibratedParamService.ts` — Reads `calibrated_parameters.json` and writes to `calibrated_params` table.
  - `crashRecoveryService.ts` — Detects `status = 'in_progress'` sessions on startup and triggers Resume/Discard flow.
  - `restTimerService.ts` — Background timer triggers, superset group awareness, and audio/haptic cues.
  - `progressionEngine.ts` — Pure condition-action rule evaluation engine (supports increase, decrease, reset, deload actions).
  - `programBlockService.ts` — Meso-cycle date interval resolver and color band calculator.
- `mobile/src/database/` — Infrastructure Layer (Adapters).
  - `schema.ts` — SQLite table DDL and `PRAGMA user_version` migration framework (`expo-sqlite`).
  - `repositories/` — Concrete SQLite implementations of domain repository interfaces (`SQLiteProgramRepository.ts`, `SQLiteWorkoutRepository.ts`, `SQLiteGearRepository.ts`, `SQLiteUserProfileRepository.ts`, `SQLiteProgressionRuleRepository.ts`, `SQLiteCalibratedParamRepository.ts`, etc.).

### 3.3 Companion Analysis Suite (`companion/`)
> **Workspace Execution Rule**: All Python commands (`pip`, `pytest`, `mypy`, `streamlit`) MUST be executed within the virtual environment `companion/.venv`.

- `companion/pyproject.toml` — Companion package specification, build configuration, pytest, and strict mypy settings.
- `companion/requirements.txt` — Pinned/bounded runtime and dev dependencies.
- `companion/tests/` — Test suite for companion schemas, models, and export.
- `companion/src/ingestion/` — Ingestion & contract validation.
  - `parser.py` — File reader for `workout_data_export.json`.
  - `schemas.py` — Pydantic v2 data models enforcing schema conformity.
- `companion/src/models/` — Headless scientific modeling engine (pure NumPy/SciPy math).
  - `kalman_1rm.py` — Linear Kalman Filter updating $(1\text{RM}_t, k_t)$ per exercise.
  - `fatigue_banister.py` — Two-component impulse-response ODE solver.
  - `recovery_modifier.py` — 14-day rolling bodyweight slope ($\Delta BW / \Delta t$) fatigue scaler.
  - `recommendations.py` — ACWR calculation, deload trigger, and progressive overload advisory engine.
- `companion/src/export/` — Calibrated parameter output.
  - `param_exporter.py` — Serializes per-exercise $(1\text{RM}, k)$ to `calibrated_parameters.json` for mobile import.
- `companion/src/ui/` — Presentation Layer.
  - `app.py` — Streamlit / Plotly interactive web dashboard.


