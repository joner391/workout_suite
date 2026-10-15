# Workout Suite — High-Level Architecture Documentation

## 1. System Purpose & Vision
The **Workout Suite** is a unified, local-first system designed for strength athletes and lifters to track resistance training data and execute data-driven, physiologically grounded fatigue and adaptation analysis.

The system is partitioned into two major subsystems connected by a standardized data exchange pipeline:
1. **Mobile Workout Tracker (iOS & Android)**: High-speed, offline-first mobile app for friction-free in-gym logging, routine management, rest timing, body metric tracking, and immediate performance heuristics.
2. **Companion Analysis Suite (Desktop / Web)**: Advanced Python analytics engine that ingests historical training logs to run an adaptive Kalman filter for individualized 1RM and endurance estimation, and a Banister two-component impulse-response model for fatigue and adaptation modeling.

---

## 2. Major Subsystems & Responsibilities

```mermaid
flowchart TD
    subgraph Mobile ["Mobile Workout Tracker (React Native + Expo)"]
        UI["UI Layer (Logger, Calendar, Metrics, Builder)"]
        LocalDB[("Local SQLite Database (expo-sqlite)")]
        Local1RM["Tier 1: Heuristic 1RM (Lombardi Power Law)"]
        ExportModule["Export Service (expo-sharing / JSON)"]
        
        UI <--> LocalDB
        UI <--> Local1RM
        LocalDB --> ExportModule
    end

    subgraph Exchange ["Data Exchange Layer"]
        JSONExport["workout_data_export.json"]
        CloudDB[("Future Supabase Cloud DB (Phase 7)")]
    end

    subgraph Companion ["Companion Analysis Suite (Python 3.11+ / Phase 6)"]
        Ingestion["Ingestion & Validation (Pydantic v2)"]
        KalmanEngine["Tier 2: 1RM Kalman Filter (Lombardi Linearized KF)"]
        FatigueEngine["Fatigue & Adaptation Engine (Banister Model)"]
        RecoveryMod["Recovery Modifier (14-Day Rolling ΔBW / Δt)"]
        Dashboard["Interactive Dashboard (Streamlit / Plotly)"]
        
        Ingestion --> KalmanEngine
        Ingestion --> RecoveryMod
        RecoveryMod --> FatigueEngine
        KalmanEngine --> Dashboard
        FatigueEngine --> Dashboard
    end

    ExportModule -.->|"Phase 2+: Local Share"| JSONExport
    JSONExport -.-> Ingestion
    LocalDB -.->|"Phase 7: Background Sync"| CloudDB
    CloudDB -.-> Ingestion
```

### 2.1 Subsystem 1: Mobile Workout Tracker
- **Responsibility**: In-gym capture, real-time feedback, routine management, and data import/export.
- **Boundaries**: Strictly client-side on mobile devices. Does not execute heavy multi-year matrix optimizations. All weight values stored internally in **kilograms** (canonical unit); display conversion to lbs is performed at the presentation layer.
- **Key Modules**:
  - `ActiveLogger`: Dynamic set management with set type tagging (working 'Reg', warmup 'Warm', drop 'Drop', myorep 'Myo', dc 'DC'), per-set notes, ghosting placeholders from the most recent global session, set-type-specific rest timers (0s for drop, 10s for myorep, 30s for dc), superset/giant set grouping, Plate Calculator popover, in-session 1-tap exercise substitution, 1-tap implement and bar switcher (`change-gear-button-<id>`), dumbbell per-hand input with auto-doubled backend math, unilateral independent limb logging (`reps_right`), small-font gear subtext badge, total system load tracking for bodyweight/assisted movements (`is_bodyweight = 1`), and dual-load persistence (ADR-026: storing both `raw_input_weight` and normalized effective `weight` in kg).
  - `CalendarAgenda`: Accordion calendar and day agenda view (`CalendarScreen.tsx`) featuring a default collapsed current-week row (`initialExpanded = false`) expandable on demand to full Monday-start 7-column monthly grids via toggle buttons and handle bar, completed workout badges, day agenda listings, and drill-down inspection of sessions (`SessionDetailModal.tsx`) showing volume tonnage, duration, set counts, top e1RM per exercise, deterministic superset badge notation (`SS A1`, `SS A2`), and immediate post-workout summary presentation.
  - `UserSettings`: Preferences manager (`SettingsScreen.tsx`) supporting instant toggles for Weight Unit System (`kg` / `lbs`), Intensity Metric (`RPE` / `RIR`), and Pure Utility Mode (`pure_utility_mode` per ADR-024), backed by write-through storage and diagnostics display.
  - `RootNavigation`: Lightweight, zero-dependency bottom tab navigation (`App.tsx`) organizing the app into 4 dedicated hubs: `HOME (🏠)`, `WORKOUT (⚡)`, `PROFILE (👤)`, and `SETTINGS (⚙️)`, featuring state-preserving display toggling (ADR-028) and in-progress session indicators.
  - `HomeScreen`: Central training hub (`HomeScreen.tsx`) presenting a Quick Status Dashboard (active program swatch, next scheduled workout preview card without start buttons, weekly metrics: workouts this week, tonnage, streak), an interactive accordion calendar agenda, and performance intelligence analytics with interactive DOTS Progression and Symmetry Radar modal triggers (`SBDBalanceRadarChart.tsx`).
  - `WorkoutTabRouter`: Smart session router (`WorkoutTabRouter.tsx`) dynamically resolving State A (in-progress active session via `ActiveLoggerScreen`), State B (active program pre-flight screen with circular template sequencing `(lastIndex + 1) % N`, exercise previews, and 1-tap start), and State C (no active program empty-state). Serves as the sole authoritative gateway to launch workout sessions.
  - `CrashRecoveryService`: Write-through persistence of in-progress sessions (`status = 'in_progress'`); on app relaunch, detects interrupted workouts and prompts Resume / Discard.
  - `PlateCalculatorService`: Headless pure calculation of barbell plate distribution (25, 20, 15, 10, 5, 2.5, 1.25 kg) based on tare weight (20 kg standard or specialty bar) and user plate inventory.
  - `GearInventory`: Equipment inventory management (`GearInventoryScreen.tsx`, `GearInventoryService.ts`) for custom barbells with tare weights (15 kg technique bar, 20 kg Olympic, 25 kg trap bar, 29 kg SSB) and custom machine cable mechanical ratios (defaults: 1:1 for rows/pulldowns, 2:1 for functional trainers per ADR-025, ADR-040). Accessible from `UserProfileScreen` under the Profile tab and selectable across 3 levels: exercise catalog default tare, template prescriptions, and in-gym active logger.
  - `ExerciseLibrary`: Catalog management (`ExerciseLibraryScreen.tsx`), custom movement creator/editor (`ExerciseFormModal.tsx`), and variant hierarchy exploration (`parent_exercise_id` self-referencing tree per ADR-012), integrated into Settings and ActiveLogger.
  - `ExerciseSubstitutionService`: Recommends compatible movements during active workouts via `parent_exercise_id` variant tree, transfers rep prescriptions, pulls ghost numbers, and prompts session-only vs permanent template update.
  - `ProgramManager`: Multi-day training program splits (e.g., Upper/Lower, PPL) in `programs` table with program accent colors (`color_hex`), daily `workout_templates`, target rep brackets (`target_reps_min` / `target_reps_max`), target RPE/RIR, and superset groupings.
  - `ProgramCloneService`: Deep cloning and presets protection service (`programCloneService.ts`) guarding pre-built and synthesized archetypes by auto-cloning as custom (`prog_custom_<ts>_<hash>`) when an edit is initiated.
  - `ProgramOverview`: Full CRUD program builder (`ProgramOverviewScreen.tsx`) supporting template creation/reordering/deletion, exercise creation/swapping/deletion, prescription editing (`PrescriptionEditorModal.tsx`), superset pairing/unpairing, and ProgressionBuilderModal integration.
  - `ProgramBlockService`: Tracks active meso-cycle date intervals (`program_blocks`) linked to `programs.id`, powers calendar swap indicators, and generates vertical shaded bands on charts.
  - `ExerciseInspection`: Deep-dive exercise analytics (`ExerciseDetailScreen.tsx`), Rep-Max PR Board (`PRBoardTable.tsx`) with All-Time/Block date scoping and session drill-down, allometric strength standard tier badges and demographic percentile bell curves (`SBDStandardsCard.tsx`), 3-axis SBD symmetry and balance radar chart (`SBDBalanceRadarChart.tsx`), and application service orchestration (`ExerciseInspectionService.ts`).
  - `ProgressionEngine`: Evaluates built-in schemes (LP, Double Progression, DDP) and executes user-defined IF/THEN/ELSE rule builder scripts from the `progression_rules` table. Generates interactive proposal banners before the next session ("Target hit! Increase weight to 82.5 kg? [Accept / Dismiss]") so the lifter retains full control.
  - `StrengthStandardsService`: Evaluates SBD e1RM against non-linear allometric and empirical bodyweight standards; outputs classification tier (Untrained to Elite), continuous normalized score (0–100+), delta kilograms to next tier, and DOTS coefficient.
  - `UserProfileService`: Manages user demographics (sex, height, birthdate) and Training Mentality matrix (`fury`, `precision`, `get_out`) with cross-stack schema synchronization across SQLite, JSON exports, and companion Pydantic models.
  - `ProgramRecommenderEngine`: Evaluates athlete profile and synthesizes optimal splits (Full Body, Upper/Lower, PPL), set volumes, RPE targets, progression rules, and dense 15-minute routines (4 exercises in 2 antagonist pairs, 8 total sets).
  - `BodyMetrics & Plots`: Anthropometry logging (`BodyMetricsScreen.tsx` for weight, waist, neck, limbs with live DoD Navy BF% calculation and 7-day rolling average banner) and longitudinal analytics suite (`PlotsScreen.tsx` and `ProgramEraShadedChart.tsx` for e1RM progression, bodyweight SMA/EMA smoothing, body fat %, anatomical circumferences, and Monday-bucketed weekly volume tonnage bars with meso-cycle program era shading).
  - `DatabaseService`: SQLite schema management with `PRAGMA user_version` migrations, and local CRUD operations.
  - `ExportService`: Packages SQLite state into standardized JSON payloads via OS share sheet.
  - `ImportService`: Parses training history and body composition from external apps via pure RFC 4180 tokenizer (`csvImportParser.ts`) supporting Strong CSV, Hevy CSV, Liftosaur CSV, StrengthLog Training CSV, StrengthLog Body Composition CSV, and generic CSVs. Features automated exercise catalog matching, alias mapping, custom fallback creation, duplicate session detection, `imported_from` provenance tagging, date range filtering, 1-tap bundled evaluation presets for Expo Go, and interactive wizard (`ImportScreen.tsx`) integrated into Settings.
  - `CalibratedParamService`: Imports `calibrated_parameters.json` from the companion suite; writes per-exercise $(1\text{RM}, k)$ to `calibrated_params` table for Tier 1 heuristic upgrade.

### 2.2 Subsystem 2: Companion Analysis Suite
- **Responsibility**: Scientific modeling, historical parameter estimation, calibrated parameter export, and decision recommendations.
- **Boundaries**: Operates on exported data payloads or cloud database connections.
- **Key Modules**:
  - `DataIngestion`: Validates JSON structure using Pydantic models (`companion/src/ingestion/schemas.py`).
  - `Kalman1RMFilter`: Implements the state-space formulation tracking $\mathbf{x}_t = [\ln(1\text{RM}_t), k_t]^T$, accounting for high-rep noise and lift biomechanics (`companion/src/models/kalman_1rm.py`).
  - `FatigueAdaptationModel`: Calculates daily training stimulus, updates Banister impulse-response differential equations, and models net preparedness (`companion/src/models/fatigue_banister.py`).
  - `RecoveryEngine`: Computes the 14-day rolling bodyweight slope ($\Delta BW / \Delta t$) to modulate fatigue decay constants ($\tau_2$) (`companion/src/models/recovery_modifier.py`).
  - `RecommendationEngine`: Generates ACWR alerts (overload readiness, deload advisories, under-stimulation warnings) (`companion/src/models/recommendations.py`).
  - `CalibratedParamExporter`: Serializes per-exercise $(1\text{RM}, k)$ to `calibrated_parameters.json` for mobile import.
  - `VisualizationDashboard`: Interactive Streamlit dashboard with rich Plotly charts.

---

## 3. Dual-Tier 1RM Architecture

To balance real-time gym responsiveness with rigorous statistical modeling:
1. **Tier 1 (Mobile Fast Heuristic)**:
   - Evaluates submaximal sets instantly using Lombardi's power law ($w \cdot r_{\text{eff}}^{0.10}$) or pre-loaded calibrated $(1\text{RM}, k)$ parameters.
   - For deadlift exercises evaluated under static linear heuristic equations (e.g., Epley / Brzycki), a **+10% compensatory multiplier** applies strictly to counter the non-stretch-shortening cycle fatigue profile (concentric-only start).
   - Zero latency; runs synchronously on the mobile device during set entry.
2. **Tier 2 (Companion Adaptive Kalman Filter)**:
   - Processes complete longitudinal training series per exercise.
   - Filters out warm-up sets ($RIR > 3$) and caps analysis to the top 2 sets per session with the lowest RIR.
   - Scales observation variance quadratically with rep count ($R_t = \sigma_{\text{base}}^2(1 + \lambda r_{\text{eff}}^2)$) to prevent high-rep metabolic fatigue from distorting strength estimates.
   - Models deadlift fatigue mechanics natively via the continuous state variable $k_t$ (initialized with an exercise-specific prior $k_0 = 0.075$, box-clipped $k \in [0.03, 0.16]$ for numerical stability); **no +10% heuristic multiplier is applied to Kalman state estimates**.
   - Outputs calibrated endurance exponents $k_t$ and true strength $\ln(1\text{RM}_t)$ for sync back to mobile.

---

## 4. Primary Data Flows & Persistence

1. **Active Workout Execution**:
   - User opens app $\rightarrow$ Resume/Discard check for interrupted sessions $\rightarrow$ Selects template or empty workout $\rightarrow$ Exercises loaded with ghosted previous session weights/reps (global scope) $\rightarrow$ User checks off set (write-through to SQLite) $\rightarrow$ Rest timer initiates (suppressed within superset groups).
2. **Data Export & Ingestion (Step 2.3)**:
   - User taps "Export Data (JSON)" in Settings $\rightarrow$ `ExportService` serializes all 12 SQLite tables into canonical JSON conforming to `schemas/workout_export.schema.json` with ADR-026 dual-load preservation $\rightarrow$ Writes to cache via `expo-file-system` $\rightarrow$ Triggers native OS share sheet via `expo-sharing` $\rightarrow$ Shared payload is ingested by Companion and validated strictly by Pydantic v2 data models.

3. **Data Import & Evaluation**:
   - User taps "Import Data" in Settings $\rightarrow$ Chooses file picker, clipboard paste, or 1-tap "Load Evaluation Dummy Data" preset (Last 3 Months / All Time) $\rightarrow$ `ImportService` auto-detects Strong, Hevy, Liftosaur, or StrengthLog (training or body comp) $\rightarrow$ Skips unperformed routine template sets $\rightarrow$ Previews matched exercises and duplicate workouts with optional date filtering $\rightarrow$ Writes imported workouts and sets to SQLite inside a single transaction, or updates anthropometric records in `body_metrics` with `imported_from` provenance.
4. **Analytical Processing**:
   - JSON data ingested into Pandas DataFrames $\rightarrow$ Kalman filter updates $(1\text{RM}_t, k_t)$ per exercise $\rightarrow$ Stimulus computed $\rightarrow$ Bodyweight slope computed $\rightarrow$ Banister differential equations integrated $\rightarrow$ Readiness & deload signals rendered on dashboard.
5. **Calibrated Parameter Sync**:
   - Companion exports `calibrated_parameters.json` $\rightarrow$ User transfers file to mobile $\rightarrow$ `CalibratedParamService` writes per-exercise $(1\text{RM}, k)$ to `calibrated_params` table $\rightarrow$ Tier 1 heuristic upgrades from default $k = 0.10$ to individualized $k$.

---

## 5. Architectural Modularity, Layering & Boundary Rules

To guarantee long-term maintainability, independent testability, and seamless progression from Phases 1–5 local SQLite to Phase 7 cloud synchronization, the system enforces **Clean / Hexagonal Architecture (Ports and Adapters)** across both subsystems.

```mermaid
flowchart TD
    subgraph PresentationLayer ["1. Presentation Layer (Framework Bound)"]
        UIComponents["React Native Screens & Components / Streamlit Dashboard"]
    end

    subgraph ApplicationLayer ["2. Application / Service Layer (Orchestration)"]
        UseCases["ActiveSessionService / ExportService / RecommendationEngine"]
        RepoInterfaces["Repository Interfaces (IWorkoutRepo, IExerciseRepo)"]
    end

    subgraph DomainLayer ["3. Domain Core (Headless & Zero-Dependency)"]
        Math["Heuristic 1RM / Navy Body Fat / Kalman Math / Banister ODE"]
        Rules["Progression Rule Engine (Pure Evaluator)"]
        Models["Domain Entities & Aggregate Roots"]
    end

    subgraph InfrastructureLayer ["4. Infrastructure Layer (External Concerns)"]
        SQLiteRepo["SQLite Implementations (expo-sqlite)"]
        CloudRepo["Future Supabase Implementations"]
        OSAPIs["Rest Timer Background Tasks / Share Sheet"]
        FileIO["Pydantic JSON Parsers & Deserializers"]
    end

    PresentationLayer --> ApplicationLayer
    ApplicationLayer --> DomainLayer
    InfrastructureLayer -.->|Implements Interfaces| RepoInterfaces
    ApplicationLayer --> InfrastructureLayer
```

### 5.1 Strict Inward Dependency Rule
- **Domain Core**: Contains business rules, biological and mathematical models, and entity models. It has **zero dependencies** on UI libraries, React Native, Streamlit, or SQLite drivers.
- **Application Services**: Orchestrates user actions by calling Domain functions and invoking Repository interfaces.
- **Presentation**: Dumb, reactive view layer (React Native components / Streamlit UI) that handles user input and renders ViewModel state. Never invokes database queries directly.
- **Infrastructure**: Adapters for SQLite, device notifications, file systems, and network services. Implements interfaces defined by the Application layer.

### 5.2 Headless Domain Logic
All calculation engines are implemented as **pure, side-effect-free functions**:
- Tier 1 e1RM calculation: `(weight, reps, rpe, calibratedK?) => e1RM`
- SBD strength standard evaluation: `(e1RM, bodyweight, gender, liftType) => { tier, continuousScore, nextTierKgNeeded }`
- Powerlifting DOTS score: `(totalKg, bodyweightKg, gender) => dotsPoints`
- Plate loading calculator: `(targetWeight, barTareKg, plateInventory) => { platesPerSide: number[], remainderKg: number }`
- Effective set load normalizer: `(enteredWeight, loadMode, isBodyweight, currentBodyweight, addedWeight, cableRatio?) => { effectiveWeightKg: number, rawInputWeight: number }` (ADR-026)
- Profile program synthesizer: `(profile, exerciseCatalog) => { template, templateExercises, progressionRules }`
- Progression engine: `(rule, setHistory) => nextPrescription`
- Body composition: `(gender, measurements, height) => bodyFatPercentage`
- Unit conversion: `(value, fromUnit, toUnit) => convertedValue`
- Kalman state updates: `(prior_state, obs_matrix) => posterior_state`
- Banister impulse integration: `(daily_stimulus, tau1, tau2) => preparedness`

*Result*: 100% of domain math can be unit-tested in under 200ms with zero simulator/emulator overhead.

### 5.3 Repository Pattern & Storage Decoupling
UI screens never execute SQL statements or import `expo-sqlite` directly. All data access is mediated through domain repository interfaces (`IWorkoutRepository`, `IExerciseRepository`, `IBodyMetricsRepository`):
- **Testing**: Screens and services can be tested against in-memory mock repositories without file I/O.
- **Phase 7 Cloud Migration**: Migrating to Supabase PostgreSQL in Phase 7 requires writing `SupabaseWorkoutRepository` to implement the existing interface without modifying UI screens or hooks.

### 5.4 Vertical Feature Slicing
The mobile client is partitioned into self-contained feature slices (`features/logger`, `features/inspection`, `features/progression`, `features/bodyMetrics`, `features/templates`, `features/import`) rather than horizontal directories. Each slice exposes a public interface via its root `index.ts`. Cross-feature coupling is prohibited.

### 5.5 Schema-First Data Contract
The data exchange contract between TypeScript and Python is governed by a canonical JSON schema (`schemas/workout_export.schema.json`):
- TypeScript export types and Python Pydantic models are bound to this shared specification.
- Continuous Integration runs automated contract tests that validate exported JSON fixtures against Pydantic models to eliminate cross-stack schema drift.

### 5.6 Architectural Fitness Functions
Boundaries are automatically enforced via tooling:
- **Lint Boundaries**: `eslint-plugin-boundaries` forbids Presentation or Domain layers from importing Infrastructure or database packages directly.
- **Strict Typing**: TypeScript (`tsc --noEmit --strict`) and Python (`mypy --strict`) prevent implicit untyped leakage across boundaries.

---

## 6. Development, Build, & Validation Commands

All commands must be executed within their respective workspace directories to eliminate dependency bleed and working-directory confusion (see `AGENTS.md` Section 8).

### Mobile App (React Native / Expo) — Working Directory: `mobile/`
*Strict Rule: NEVER run `npm` or place `package.json` at the repository root.*
- Install dependencies: `npm install` (or from root: `npm --prefix mobile install`)
- Start Expo development server: `npx expo start`
- Run on Android: `npx expo run:android` or scan QR via Expo Go
- Run on iOS: Scan QR via Expo Go on iPhone
- Lint & Typecheck: `npm run lint` / `npx tsc --noEmit`
- Run test suite: `npm test`

### Companion Analysis Program (Python 3.11+) — Working Directory: `companion/`
*Strict Rule: All Python tools MUST run inside the virtual environment `companion/.venv`.*
- Initialize virtual environment: `python -m venv .venv`
- Activate virtual environment:
  - Windows: `.\.venv\Scripts\Activate.ps1`
  - POSIX / macOS / Linux: `source .venv/bin/activate`
- Install dependencies: `pip install -r requirements.txt`
- Run dashboard: `streamlit run src/ui/app.py`
- Run tests: `pytest`
- Typecheck: `mypy src`
- Lint & Format: `flake8 src tests` / `black --check src tests`

