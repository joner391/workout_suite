# Workout Suite — Architecture Decision Records (ADRs)

## ADR-001: Local-First Architecture with SQLite for Mobile
- **Context**: Mobile workout loggers are used in gym environments with unreliable or non-existent cellular reception (e.g., basements). High latency or cloud dependency ruins the UX during set logging.
- **Decision**: Adopt a local-first architecture using `expo-sqlite` embedded on the device. All CRUD operations happen instantly against the local database. Data export is achieved via a standardized JSON format in Phase 2+, transitioning seamlessly to Supabase PostgreSQL in Phase 7.
- **Consequences**:
  - *Pros*: Zero network latency, 100% offline reliability, full user data privacy, zero recurring cloud hosting costs during development.
  - *Cons*: Multi-device real-time sync is deferred to Phase 7; data backup relies on local file export until cloud sync is activated.

---

## ADR-002: Dual-Tier 1RM Estimation Architecture
- **Context**: The user identified a 1RM estimator in `1RM_calculation.txt` utilizing a state-space Linear Kalman Filter, questioning whether it should run on mobile or in the companion suite.
- **Decision**: Separate 1RM estimation into a dual-tier architecture:
  1. **Tier 1 (Mobile Fast Heuristic)**: Evaluates submaximal sets instantaneously using the Lombardi power law ($w \cdot r_{\text{eff}}^{0.10}$) or pre-loaded calibrated $(1\text{RM}, k)$ parameters.
  2. **Tier 2 (Companion Kalman Engine)**: Ingests the full longitudinal training history, fits exercise-specific state vectors $\mathbf{x}_t = [\ln(1\text{RM}_t), k_t]^T$, filters high-rep noise via quadratic variance scaling, compensates for biomechanical lift differences (bench vs. squat vs. deadlift), and exports calibrated parameters back to the mobile client.
- **Consequences**:
  - *Pros*: Keeps the mobile app lightweight and instant while providing rigorous sports-science modeling in the companion tool. Solves the issue where lifters have different rep endurance ($k$) on squats vs. deadlifts.
  - *Cons*: Requires exporting/importing parameter states between the two systems.

---

## ADR-003: Dynamic Recoverability in Banister Impulse-Response Modeling
- **Context**: Standard Banister impulse-response models use static decay constants ($\tau_1 \approx 45$ days, $\tau_2 \approx 11$ days). In real-world strength training, an athlete's recovery capacity varies dramatically depending on nutritional state (caloric surplus vs. caloric deficit).
- **Decision**: Dynamically scale the fatigue decay constant $\tau_2$ using the 14-day rolling bodyweight slope ($\Delta BW / \Delta t$):
  - Caloric surplus ($\Delta BW > 0$): Accelerates fatigue dissipation by 10%–25% (shortens $\tau_2$).
  - Caloric deficit ($\Delta BW < 0$): Impairs recovery, lengthening $\tau_2$ by 15%–30% and reducing Maximum Recoverable Volume (MRV).
- **Consequences**:
  - *Pros*: Reflects physiological reality: cutting lifters accumulate fatigue faster and cannot tolerate bulking volumes.
  - *Cons*: Requires regular bodyweight logging to maintain an accurate rolling derivative.

---

## ADR-004: Declarative Condition-Action Schema for Progression Builder
- **Context**: Lifters utilize diverse progression strategies (Linear Progression, Double Progression, Dynamic Double Progression, RPE caps). Hardcoding every variant is inflexible, while allowing arbitrary code execution on mobile poses security and UX challenges.
- **Decision**: Implement a declarative JSON schema for progression rules based on Condition $\rightarrow$ Action primitives:
  - Conditions: `ALL_SETS_HIT_TARGET_REPS`, `AVERAGE_RPE_LESS_THAN`, `CONSECUTIVE_SUCCESSFUL_SESSIONS`, etc.
  - Actions: `INCREASE_LOAD_FIXED`, `INCREASE_LOAD_PERCENT`, `INCREASE_TARGET_REPS`, `TRIGGER_DELOAD`.
- **Consequences**:
  - *Pros*: Safe, serializable into SQLite, easy to build a drag-and-drop or visual block UI around.
  - *Cons*: Complex multi-variable conditional flows must be decomposed into supported atomic primitives.

---

## ADR-005: Technology Stack Selection (React Native / Expo + Python)
- **Context**: The system must run on iOS and Android devices, developed from a Windows host machine, while the companion analysis requires rich data science libraries (NumPy, SciPy, Pandas, Plotly).
- **Decision**:
  - Mobile: React Native with **Expo SDK** (TypeScript).
  - Companion: **Python 3.11+** with Pydantic, Pandas, NumPy, and Streamlit / Plotly.
- **Consequences**:
  - *Pros*: Expo allows testing and developing native iOS and Android apps on a Windows workstation via Expo Go without requiring a local macOS Xcode build environment. Python provides access to state-space Kalman filters and sports science numerical solvers.
  - *Cons*: Two languages (TypeScript and Python), requiring clean schema synchronization across the JSON data exchange boundary.

---

## ADR-006: Meso-Cycle Program Era Tracking, Synchronized Plot Shading & Rep-Max PR Profiles
- **Context**: Lifters transition between programs or meso-cycles over time (e.g., Hypertrophy vs. Peaking vs. Deload). Understanding how long-term metrics (e1RM, bodyweight, muscle circumferences) correlate with specific training programs requires visual continuity across both calendar scheduling and longitudinal charts. Additionally, lifters need to inspect exercises to understand their personal bests across different rep ranges and determine which rep set represented their peak estimated strength.
- **Decision**:
  1. Associate each workout template with a distinct `color_hex` accent and maintain a `program_blocks` interval table tracking the active date range of each program swap.
  2. Display program swap cues on the calendar on the start date of each block.
  3. Render semi-transparent vertical background bands tinted with the program's color across all time-series plots (e1RM, bodyweight, muscle circumferences).
  4. Implement an Exercise Inspection screen with a Rep-Max Record Table that groups completed sets by unique rep count, extracts the maximum weight lifted, and computes the corresponding e1RM ($w \cdot r_{\text{eff}}^{0.10}$).
- **Consequences**:
  - *Pros*: Provides instant context on plots connecting physical progress to specific training programs; solves the challenge of comparing strength achievements across differing repetition zones (e.g., comparing a 5RM vs a 10RM).
  - *Cons*: Requires joining `program_blocks` date intervals during chart rendering and executing aggregation queries (`GROUP BY reps`) on the sets table.

---

## ADR-007: Clean Architecture, Headless Domain Logic, and Boundary Enforcement
- **Context**: As features grow across the mobile tracker (React Native / Expo) and companion analysis suite (Python), monolithic or unstructured horizontal organization risks high coupling, sluggish testing, schema drift, and brittle refactors when transitioning persistence layers (SQLite to Supabase).
- **Decision**:
  1. **Strict Inward Dependency Flow (Ports & Adapters)**: Organize both codebases into concentric layers: `Domain Core` (pure business and mathematical logic) $\rightarrow$ `Application/Services` (use case orchestration) $\rightarrow$ `Infrastructure` (SQLite, OS APIs, file systems) $\rightarrow$ `Presentation` (React components, Streamlit UI). Domain logic must never import from UI, framework, or database drivers.
  2. **Headless Domain Logic**: All scientific formulas (1RM power law, Navy body fat, Banister ODEs, Kalman state-space) and progression rule evaluators are implemented as pure, side-effect-free functions with zero framework dependencies.
  3. **Repository Pattern for Storage Abstraction**: Decouple UI screens from SQLite using domain repository interfaces (`IWorkoutRepository`, `IExerciseRepository`, etc.). This enables trivial mocking during testing and seamless migration to Supabase cloud sync in Phase 7 without altering UI components.
  4. **Schema-First Data Exchange Contract**: Formalize the mobile-to-companion export format via a shared JSON schema (`schemas/workout_export.schema.json`) with automated contract validation tests across TypeScript and Python in CI.
  5. **Vertical Feature Slicing**: Structure mobile code into self-contained feature slices (`features/logger`, `features/progression`, `features/inspection`, `features/bodyMetrics`) exposing public API barrels (`index.ts`) to prevent cross-module coupling.
- **Consequences**:
  - *Pros*: 
    - Domain math can be unit-tested in milliseconds without launching simulators or database engines.
    - Zero code churn on UI screens when upgrading the database from local SQLite to Supabase.
    - Cross-language schema changes are caught by CI contract tests before causing runtime deserialization bugs.
    - Features can be developed and refactored in complete isolation.
  - *Cons*:
    - Requires interface boilerplate (DTOs, repository interfaces, and public barrels) upfront.
    - Developers must strictly adhere to boundary rules and linting configurations.

---

## ADR-008: Canonical Kilogram Storage with Display-Layer Unit Conversion
- **Context**: Users may toggle between kg and lbs during training. If raw values are stored with no unit context, historical data becomes ambiguous after a unit switch.
- **Decision**: Store all weight values in the database in **kilograms** as the canonical unit. Conversion to lbs ($\text{lbs} = \text{kg} \times 2.20462$) is performed exclusively at the display/presentation layer based on the `unit_system` user setting.
- **Consequences**:
  - *Pros*: All analytical calculations, JSON exports, and companion ingestion operate on a single consistent unit. No risk of mixed-unit historical data. Simpler queries and aggregations.
  - *Cons*: If a user enters weight in lbs, it must be converted to kg before storage, introducing a floating-point conversion step. Plate loading display must also account for the conversion.

---

## ADR-009: Superset, Giant Set & Circuit Exercise Grouping
- **Context**: Serious lifters frequently superset antagonist pairs (e.g., bench press ↔ barbell rows) or run giant sets for metabolic stress. A strictly sequential set model cannot represent these patterns.
- **Decision**: Support grouping exercises within a session via a shared `exercise_group_id` on both `template_exercises` and `workout_sets`. Grouped exercises share a visual bracket in the logger UI. The rest timer is suppressed between exercises within a group and triggers only after the final exercise in the group completes its set.
- **Consequences**:
  - *Pros*: Captures real-world training patterns; enables accurate rest interval tracking; no schema migration needed for future circuit support since it reuses the same grouping mechanism.
  - *Cons*: Adds UI complexity to the logger (drag-and-drop grouping, visual brackets). Rest timer logic must handle both grouped and ungrouped sets.

---

## ADR-010: Write-Through Crash Recovery for Active Sessions
- **Context**: Gym environments are hostile to mobile apps — phones get dropped, apps get force-killed, battery dies mid-workout. Losing a partially logged session is unacceptable for lifters.
- **Decision**: Every set completion and field edit is persisted to SQLite immediately (write-through, not batched). Active sessions are marked with `status = 'in_progress'`. On app relaunch, any in-progress session triggers a "Resume interrupted workout?" prompt with Resume and Discard options.
- **Consequences**:
  - *Pros*: Zero data loss on crash, force-kill, or accidental navigation. Deterministic recovery behavior.
  - *Cons*: Slightly higher write I/O during active logging (mitigated by SQLite WAL mode). Requires a `status` column on the `workouts` table and startup recovery check logic.

---

## ADR-011: Phase 2 Data Import from External Workout Apps
- **Context**: New users switching from established apps (Strong, Hevy, FitNotes) have months or years of training history. Without an import path, onboarding friction is high and the PR Board / companion analysis suite starts with zero data. However, implementing multiple CSV parsers and exercise mapping algorithms in Phase 1 would expand MVP scope and delay delivering a functional in-gym logger.
- **Decision**: Position external data import as a **Phase 2** milestone. Support Strong CSV, Hevy CSV, and a generic CSV/JSON format with a column-mapping UI. Imported exercises are mapped to library entries or created as custom exercises. Sessions are tagged with `imported_from` for provenance tracking. Duplicate detection warns before overwriting.
- **Consequences**:
  - *Pros*: Keeps Phase 1 strictly focused on the minimum viable in-gym logger with zero external parser overhead. Strong onboarding differentiator delivered immediately after MVP stabilization. Immediately populates PR Board, progression history, and companion analysis once deployed. Provenance tagging keeps imported data distinguishable.
  - *Cons*: Users switching from other apps cannot import their history until Phase 2 is completed. Parsing external CSV formats is fragile — each app's export schema may change across versions. Requires maintaining format-specific parsers.

---

## ADR-012: Exercise Variant Hierarchy with `parent_exercise_id`
- **Context**: Lifters routinely rotate exercise variations within a mesocycle (e.g., switching between incline, flat, and decline bench press). Without grouping these as related movements, the PR Board and companion analysis treat each as fully independent, losing cross-variant strength insights.
- **Decision**: Add an optional `parent_exercise_id` self-referencing foreign key on the `exercises` table. Each exercise may have at most one parent. The PR Board and companion suite can optionally aggregate e1RM data across a variant group.
- **Consequences**:
  - *Pros*: Enables cross-variant strength comparisons without duplicating data. Simple tree structure (max depth 1) avoids complexity.
  - *Cons*: Users must manually link variants during exercise creation. Aggregation queries must handle optional parent joins.

---

## ADR-013: Allometric & Tabular Strength Standards for Squat, Bench Press, and Deadlift (SBD)
- **Context**: Lifters observing their Squat, Bench Press, and Deadlift require clear indications of how their performance ranks relative to recognized strength benchmarks. Simple linear bodyweight multipliers ($w / \text{BW}$) violate the geometric square-cube law (mass scales with volume $\propto L^3$, whereas muscle cross-sectional area and tension scale with surface area $\propto L^2$), severely penalizing heavier athletes and flattering lighter athletes.
- **Decision**: Implement a dual-model strength standards evaluation engine:
  1. **Empirical Weight-Bracket Lookup Tables**: Seeded standard thresholds derived from empirical strength science datasets (ExRx, Symmetric Strength, OpenPowerlifting) across 5 discrete tiers: Untrained, Novice, Intermediate, Advanced, Elite, stratified by Sex (Male/Female) and Bodyweight (50 kg to 140+ kg).
  2. **Continuous Normalized Strength Score (0–100+) & Progress Bar**: Piecewise linear interpolation between bodyweight brackets and tiers, computing exact fractional placement (e.g., "Intermediate — 72% to Advanced") and the precise kilograms needed to unlock the next milestone.
  3. **Composite Powerlifting DOTS Score**: Calculates the official powerlifting relative strength coefficient for the SBD total ($1\text{RM}_{\text{Squat}} + 1\text{RM}_{\text{Bench}} + 1\text{RM}_{\text{Deadlift}}$) to normalize across differing weight classes.
- **Consequences**:
  - *Pros*: Scientifically accurate across all bodyweight categories; provides both qualitative motivation (named badges) and quantitative micro-goals (exact kg to next tier); enables lift balance analysis via radar/spider charts.
  - *Cons*: Requires maintaining pre-seeded tabular benchmark constants in the local database or domain assets.

---

## ADR-014: Multi-Dimensional User Profile & Psychological Preference Matrix for Automated Program Generation
- **Context**: Lifters possess vastly different psychological dispositions (enthusiasts who love the gym vs. minimalists who view training as a necessary chore), effort styles (high-intensity HIT to failure vs. high-volume submaximal accumulation), goals (strength vs. hypertrophy vs. powerbuilding vs. endurance), and time constraints. A rigid, one-size-fits-all routine generates poor adherence or burnout.
- **Decision**: Introduce a dedicated `user_profiles` schema capturing 4 foundational psychological and physiological dimensions:
  1. **Training Enjoyment Index**: `Enthusiast` (4–6 days, 60–90 min, high variety), `Disciplined Routine` (3–4 days, 45–60 min), `Minimalist Efficiency` (2–3 days, 30–45 min, strict compound supersets, zero fluff).
  2. **Effort & Intensity Style**: `High Intensity / Low Volume` (1–2 all-out working sets to RPE 9.5–10 / failure, rest-pause, DDP progression), `Volume Accumulation` (3–5 working sets at RPE 7–8, submaximal fatigue management), `Balanced` (3 sets at RPE 8).
  3. **Primary & Secondary Goals**: `Strength`, `Hypertrophy` ("Look Strong"), `Powerbuilding` (hybrid), `Endurance`, `Longevity`.
  4. **Logistics**: Available weekly training days, session duration, and equipment access.
  An automated Program Generator service evaluates these parameters to synthesize custom `workout_templates`, `template_exercises`, and `progression_rules` with 1 tap.
- **Consequences**:
  - *Pros*: Delivers personalized training prescriptions respecting user psychology and schedule; drastically lowers onboarding friction; enables minimalist lifters who dislike the gym to train effectively in 35 minutes via compound supersets.
  - *Cons*: Adds a multi-step profile configuration wizard in settings/onboarding; program generator requires comprehensive heuristic mapping tables.

---

## ADR-015: Privacy-Preserving Relative Strength Benchmarking & Multi-User Cohort Comparison
- **Context**: The user identified a desire to compare performance between lifters (e.g., friends or peer cohorts). However, the app follows an offline-first architecture in early phases without mandatory cloud accounts or internet dependency.
- **Decision**: Decouple multi-user benchmarking into two progressive phases:
  1. **Phase 3 (Local Demographic Norms)**: Perform offline percentile placement against curated demographic distributions (OpenPowerlifting and ExRx empirical cohorts) matched to the user's sex, age bracket, and bodyweight class. Zero network activity, 100% privacy.
  2. **Phase 7 (Cloud Backend Social & Cohort Comparison)**: When Supabase cloud synchronization is established, provide opt-in peer profiles, friends leaderboards, normalized DOTS comparisons, and cohort progress comparisons based on matched psychological and goal profiles.
- **Consequences**:
  - *Pros*: Delivers immediate benchmarking satisfaction in Phase 3 without network latency or cloud server costs; guarantees data privacy; cleanly prepares the data models for social features in Phase 7.
  - *Cons*: Direct real-time friend-to-friend leaderboard competition is deferred until Phase 7 cloud infrastructure is deployed.

---

## ADR-016: 7-Phase Incremental Architecture and Modular Milestone Decomposition
- **Context**: As requirements expanded to incorporate SBD strength standards, exercise variant trees, superset mechanics, user psychological profiling, automated program generation, external app CSV onboarding, and multi-user benchmarking, the original 3-phase roadmap became heavily front-loaded. Phase 1 alone encompassed 10 complex, heterogeneous subsystems. Attempting to implement this as a single monolithic phase would delay working software, complicate code reviews, and increase bug surface area.
- **Decision**: Restructure the roadmap into **7 discrete, incrementally testable phases**:
  1. **Phase 1: Foundation & Minimum Viable Logger (MVP)** — Core in-gym logging loop, crash recovery, ghosting, rest timer.
  2. **Phase 2: Advanced Workout Mechanics & Historical Onboarding** — Supersets, exercise variants, Strong/Hevy CSV imports, JSON export.
  3. **Phase 3: SBD Strength Standards & Performance Intelligence** — PR board, empirical & allometric SBD tiers, DOTS calculation, balance radar, local percentiles.
  4. **Phase 4: Training Psychology, Program Generation & Rule Builder** — User profile questionnaire, meso-cycle blocks, profile-driven routine generator, IF/THEN progression rule builder.
  5. **Phase 5: Anthropometry, Body Composition & Longitudinal Plotting** — Navy body fat, 7-day rolling weight, charts with synchronized program era background shading.
  6. **Phase 6: Companion Scientific Suite (Python Analysis Engine)** — Adaptive Kalman Filter, Banister impulse-response ODEs, dynamic recoverability modifier, Streamlit dashboard. Runs in parallel once Phase 2 export contract is locked.
  7. **Phase 7: Cloud Synchronization, Social Benchmarking & Cross-Platform Sync** — Supabase cloud database, background sync, automated backups, opt-in peer leaderboards.
- **Consequences**:
  - *Pros*:
    - High-velocity feedback: Phase 1 yields an immediately usable in-gym workout tracker within days.
    - Decoupled testing: Each phase has a crisp, testable Definition of Done before advancing to the next.
    - Parallel execution: Data science modeling in Phase 6 can proceed independently in Python once Phase 2 defines the JSON schema.
    - Prevents architectural bloat and cognitive overload during implementation.
  - *Cons*: Requires disciplined phase tracking and incremental schema migrations via `PRAGMA user_version`.

---

## ADR-017: Multi-Day Program Hierarchy with Parent `programs` Table
- **Context**: A structured meso-cycle training program (e.g., Push/Pull/Legs, Upper/Lower) consists of multiple distinct daily workout templates (e.g., Push Day, Pull Day, Leg Day). Linking `program_blocks` directly to `workout_templates` broke down when a program spanned multiple alternating session days, forcing each day to act as an isolated program block.
- **Decision**: Introduce a parent `programs` table that groups multiple `workout_templates` via `program_id`. `program_blocks` tracks the active meso-cycle dates for the entire program using `program_id`. All templates in the program share the program's accent color (`color_hex`) for calendar cues and longitudinal chart shading.
- **Consequences**:
  - *Pros*: Natural support for real-world multi-day splits; cohesive program accent coloring across all templates in a split; simplified meso-cycle tracking in `program_blocks`.
  - *Cons*: Adds one additional relational layer between programs, templates, and template exercises.

---

## ADR-018: Total System Load Modeling for Bodyweight and Assisted Exercises
- **Context**: In strength analytics and 1RM calculation ($w \cdot r_{\text{eff}}^k$), bodyweight movements (pull-ups, dips, push-ups) involve moving the lifter's entire body mass plus or minus external load. If only added load (+10 kg) is stored in `weight`, e1RM and volume load math collapses (e.g., a 10 kg weighted pull-up set would calculate an e1RM of ~12 kg instead of ~100 kg), severely distorting stimulus and Kalman filter estimation.
- **Decision**: For exercises designated as bodyweight movements (`is_bodyweight = 1`), `workout_sets.weight` stores the **total effective system load** (user's active bodyweight + added load, or bodyweight minus assistance load). An optional `added_weight` column stores the raw external delta (+10 kg, -15 kg assist) for UI display.
- **Consequences**:
  - *Pros*: Biomechanically and mathematically accurate 1RM, volume load, and Kalman tracking across bodyweight, weighted, and assisted movements. Presentation layer clearly displays "+10 kg" or "-15 kg assist" without confusing the lifter.
  - *Cons*: Requires reading user bodyweight when logging bodyweight movements and calculating total system load.

---

## ADR-019: Interactive Progression Confirmation UX
- **Context**: Automatically altering workout template prescriptions without lifter awareness leads to frustration when a lifter feels fatigued, injured, or prefers to consolidate a weight before progressing.
- **Decision**: When a workout satisfies active progression rules in `progression_rules`, the runtime marks a pending progression proposal. Upon starting or viewing the next workout for that template, the UI surfaces an interactive proposal banner: "Progression target met! Increase load to 82.5 kg? [Accept / Modify / Dismiss]".
- **Consequences**:
  - *Pros*: Keeps the athlete in full control of their loading; prevents surprise weight changes; provides transparent explanation of why progression was triggered.
  - *Cons*: Requires maintaining a pending progression state until reviewed by the user.

---

## ADR-020: Streamlit & Plotly Presentation Layer for Scientific Companion
- **Context**: The Python companion analysis suite requires an interactive dashboard to visualize Kalman 1RM trajectories, Banister fitness/fatigue curves, ACWR alerts, and calibrated parameter exports.
- **Decision**: Select **Streamlit** with **Plotly** as the presentation technology for Phase 6.
- **Consequences**:
  - *Pros*: Zero JavaScript or frontend build toolchain overhead; rapid iteration in pure Python; Plotly offers rich interactive hover tooltips, zoom, and export features natively; seamlessly binds to NumPy/Pandas dataframes.
  - *Cons*: Less flexible than a custom React frontend for complex multi-pane drag-and-drop web interfaces (which can be introduced in Phase 7 if needed).

---

## ADR-021: Dumbbell Per-Hand Input & Unilateral Limb Data Modeling
- **Context**: In resistance training, dumbbells are stamped with single-implement weights (e.g. "30 kg"). If users log 30 kg, but the database treats it as total bilateral load, volume tonnage ($\sum w \cdot r$) and estimated 1RM calculations are cut in half. Conversely, forcing lifters to mentally double weights to 60 kg creates cognitive friction. Additionally, unilateral movements (lunges, single-arm cables) often suffer from left/right rep imbalances that cannot be represented cleanly in a single bilateral set row.
- **Decision**: 
  1. Add `load_mode` (`'per_hand'` vs `'total'`) and `is_unilateral` flags to `exercises`.
  2. In the UI, users enter the exact number stamped on the dumbbell (e.g. 30 kg). The UI displays `30 kg (×2)`, and domain math automatically doubles the effective load to 60 kg for volume tonnage, e1RM, and Banister stimulus models.
  3. Support independent limb logging within a single set row via `workout_sets.reps` (Left/primary) and `workout_sets.reps_right` (Right) for unilateral movements.
- **Consequences**:
  - *Pros*: Eliminates mental arithmetic under fatigue; protects the scientific accuracy of volume and 1RM calculations; cleanly tracks strength asymmetries without creating confusing duplicate set rows.
  - *Cons*: Domain calculations must inspect `load_mode` before aggregating volume load.

---

## ADR-022: In-Logger Plate Loading Calculator & Cognitive Offloading
- **Context**: Calculating barbell plate distributions (e.g. 142.5 kg on a 20 kg barbell with available 25, 20, 15, 10, 5, 2.5, 1.25 kg plates) causes unnecessary mental friction under physical fatigue and oxygen debt.
- **Decision**: Build a pure-domain plate calculator function (`calculatePlateLoading(targetWeight, barTare, inventory)`) paired with a 1-tap popover in the active logger. Supports standard 20 kg Olympic bars, custom gear tare weights, and customizable plate inventories.
- **Consequences**:
  - *Pros*: Significant in-gym cognitive relief; highly valued usability differentiator; pure headless function easily unit-tested.
  - *Cons*: Requires storing user plate inventory preferences in `user_settings`.

---

## ADR-023: In-Session 1-Tap Exercise Substitution with Hierarchy Fallback
- **Context**: Real-world gym conditions involve occupied equipment (e.g. squat rack or leg press taken). Rigid applications that prevent swapping movements during a session or fail to preserve progression targets cause lifters to abandon the app.
- **Decision**: Provide a 1-tap "Swap Exercise" action on active workout exercise headers. The selector prioritizes compatible movements using the `parent_exercise_id` variant hierarchy, transfers target rep brackets, pulls ghost values from the substitute exercise's history, and prompts the user: *"Swap for this session only"* (default) or *"Update template permanently"*.
- **Consequences**:
  - *Pros*: Zero friction when equipment is busy; protects program templates from accidental permanent modifications; maintains continuity of historical ghosting.
  - *Cons*: Active workout state must track transient exercise replacements.

---

## ADR-024: Pure Utility Mode for Distraction-Free Training
- **Context**: Experienced strength athletes and powerlifters often defect from modern workout apps to spreadsheets and physical logbooks because of social feeds, gamified popups, unskippable achievement animations, and UI clutter.
- **Decision**: Establish a first-class `pure_utility_mode` setting in `user_settings` (enabled by default for solo lifters). When active, the application completely suppresses all community feeds, share prompts, public profiles, and leaderboards, rendering an ultra-fast, OLED-black distraction-free training ledger.
- **Consequences**:
  - *Pros*: Directly attracts the underserved minimalist and powerlifting audience; insulates solo trainees from future Phase 7 social features.
  - *Cons*: Requires conditional rendering logic at the root navigation layer to hide social tabs when enabled.

---

## ADR-025: Equipment Mechanical Advantage Profiles (Bar Tare Weights & Cable Pulley Ratios)
- **Context**: Lifting equipment varies across gyms. Barbells range from 20 kg (Olympic standard) to 15 kg (technique/women's), 25 kg (trap bar), and 29 kg (Safety Squat Bar). Cable machines feature different mechanical advantages: lat pulldowns and seated rows are typically 1:1, whereas functional trainers and cable crossovers are typically 2:1 (moving 50 kg stack generates only 25 kg effective force). Logging stack weight without ratio context corrupts cross-gym performance analysis.
- **Decision**:
  1. Default standard barbell tare weight to 20.0 kg.
  2. Default cable exercises to 1:1 for rows/pulldowns, and 2:1 (effective factor 0.5) for functional trainers, while allowing users to customize machine ratios.
  3. Introduce a `gear_inventory` table for managing specialty barbells and custom cable stacks.
  4. When an exercise uses non-default gear from the inventory, render a subtle small-font indicator beneath the exercise title (e.g. `Safety Squat Bar (29 kg)` or `Cable (2:1)`).
- **Consequences**:
  - *Pros*: Precise physical force modeling across gyms; lifters with specialty bars (SSB, Trap Bar) get accurate plate calculations and tonnage; small font indicator keeps the UI uncluttered.
  - *Cons*: Adds a gear selector popover and inventory management screen in settings.

---

## ADR-026: Mechanical Load Normalization and Persistence Contract
- **Context**: Resistance training exercises use diverse loading conventions:
  - Dumbbell exercises: The lifter inputs the single implement load stamped on the bell (e.g., 30 kg).
  - Cable/machine exercises: The lifter inputs the pin stack load (e.g., 50 kg) which is governed by a pulley ratio (e.g., 2:1 ratio yields 25 kg effective force).
  - Bodyweight exercises: The lifter inputs external added load (+10 kg) or assistance (-15 kg), while their actual mechanical load is $\text{bodyweight} \pm \text{load}$.
  If the persistence layer only stores the normalized load (60 kg, 25 kg, 90 kg), displaying numbers back to the lifter requires reverse-calculating the input from equipment metadata, introducing floating-point rounding errors and cognitive confusion. If the database only stores raw input, analytical queries (volume tonnage $\sum w \cdot r$, 1RM power laws, and Banister ODEs) require complex conditional joins across equipment ratios on every single set query.
- **Decision**: Establish a dual-field persistence contract in `workout_sets`:
  1. `workout_sets.weight`: Always stores the **normalized effective mechanical load** in kilograms (dumbbell per-hand load doubled, cable pulley ratio applied, active bodyweight included for bodyweight movements). Used strictly for all analytical calculations, 1RM estimations, Kalman filtering, and Banister fatigue modeling.
  2. `workout_sets.raw_input_weight`: Stores **exactly what the lifter typed in the UI** (e.g., single dumbbell weight or pin stack weight). Used exclusively for presentation layer display and ghost value pre-filling without reverse-calculation artifacts.
- **Consequences**:
  - *Pros*: Completely decouples in-gym logging ergonomics from sports science analytics; eliminates reverse-calculation floating-point rounding errors; ensures instant analytical queries without dynamic equipment joins.
  - *Cons*: Adds one additional floating-point column (`raw_input_weight`) to `workout_sets`. Requires application services to populate both fields via `loadNormalizer` upon set completion.

---

## ADR-027: Polyglot Monorepo Workspace Isolation and Working Directory Invariants
- **Context**: The repository combines a React Native (Expo TypeScript) mobile application with a Python 3.11+ scientific modeling companion suite and shared JSON contract schemas. Autonomous agents and developers frequently suffer from working-directory confusion (e.g. running `npm` commands in the repository root or creating top-level Python virtual environments), causing dependency bleed, broken tooling, and package manager collisions.
- **Decision**:
  1. Root Directory (`/`) is strictly reserved for high-level documentation, `schemas/`, and cross-project orchestration. No `package.json` or root `.venv` is permitted.
  2. Mobile Workspace (`mobile/`) isolates all Node/Expo/TypeScript commands and packages.
  3. Companion Workspace (`companion/`) isolates all Python tools (`pip`, `pytest`, `mypy`, `streamlit`) within `companion/.venv`.
  4. Cross-stack changes affecting SQLite exports must update `schemas/*.schema.json` and `companion/src/ingestion/schemas.py` synchronously.
- **Consequences**:
  - *Pros*: Eliminates root dependency pollution; ensures predictable tool execution across agent sessions; guarantees strong contract alignment across languages.
  - *Cons*: Requires commands targeting mobile or companion to be prefixed or run from within their respective workspace directories.

---

## ADR-028: Zero-Dependency State-Preserving Tab Navigation & Pure Calendar Grid Math
- **Context**: Root bottom tab navigation and calendar agenda views are foundational to Phase 1 mobile in-gym tracking. Heavy navigation frameworks (such as `@react-navigation/bottom-tabs` with native reanimated and screens dependencies) and external date/calendar libraries (such as `react-native-calendars` or `moment.js`) add substantial bundle weight, potential native linking hurdles on Expo Go, and lifecycle unmounting that would destroy active in-progress workout form state when a lifter navigates to the calendar or toggles settings between sets.
- **Decision**:
  1. Implement a lightweight, zero-dependency bottom tab navigation container in `App.tsx` utilizing state-preserving display toggling (`display: 'flex'` / `display: 'none'`) for `ActiveLoggerScreen`. This guarantees that active rest timers, incomplete set inputs, and cognitive modal states are never unmounted or re-initialized on tab changes.
  2. Implement pure mathematical date and calendar algorithms (`buildMonthGrid`, `buildWeekDays`, `toIsoDate`, `parseIsoDate`) using standard JavaScript `Date` primitives, supporting Monday-start international fitness calendars, leap years, and month boundary transitions with zero third-party dependencies.
  3. Architect `App.tsx` and all feature screens with optional repository dependency injection (`AppProps`), allowing complete headless Jest verification of navigation transitions and database initialization without native device drivers.
- **Consequences**:
  - *Pros*: Zero bundle bloat; sub-millisecond execution; zero risk of losing active in-gym workout state during navigation; 100% headless Jest testability.
  - *Cons*: Deep nested sub-screen routing (e.g., complex multi-screen configuration wizards in Phase 4) will either use modal stacks or lightweight screen state switching until a full navigation container is required.

---

## ADR-029: Edge-to-Edge Safe Area Insets, Inline Set Editor Accordion & Intensity Reliability Guardrails
- **Context**: In Phase 1 mobile in-gym logging, five UX and biological integrity issues emerged:
  1. Deprecation of React Native's built-in `SafeAreaView` in Expo Go, paired with Android 15 (Xiaomi 15 HyperOS 2) edge-to-edge rendering causing headers to overlap the system battery/status bar.
  2. Mobile logger row crowdedness: cramming set type tags, previous ghost numbers, weight inputs, dumbbell badges, barbell plate buttons, reps, and +/- stepper buttons into a single row left lifters with ~35-45px of width on standard phone screens, making weight input nearly unreadable and error-prone.
  3. Redundant "working set" badges (`W`) in workout summaries that clashed with Warmup badges (`W`), along with mixed RPE/RIR display.
  4. Hardcoded default RPE (8.0) forcing lifters who do not track exertion metrics to persist unwanted intensity values.
  5. Extrapolating e1RM on low-effort warmup sets (< 6.0 RPE or > 4.0 RIR) producing distorted strength benchmarks.
- **Decision**:
  1. Adopt `react-native-safe-area-context` with `<SafeAreaProvider>` and `<SafeAreaView edges={['top', 'bottom', 'left', 'right']}>` in `App.tsx` for cross-platform status bar and gesture navigation compliance.
  2. Rename application to **MomentRM** (`name: 'MomentRM'`, `slug: 'momentrm'` in `app.json` and splash initialization).
  3. Transition `SetRowComponent` to a clean, compact display row by default (expanding weight input touch target to ~87px on standard mobile viewports). Implement a single-set accordion editor drawer that opens on tap or input focus, revealing:
     - Quick weight adjustment pills (`-2.5`, `+2.5`, `-5`, `+5` for barbells) and the plate calculator popover trigger.
     - Rep adjustment pills (`-1`, `+1`).
     - Exertion steppers with half-step increments and an explicit `[Clear]` button.
     - Note toggle and delete actions.
  4. In `SessionDetailModal`, keep the `TYPE` column but leave working sets completely blank, badging only special sets (**W** warmup, **D** drop, **F** failure, **M** myo-rep). Align exertion display strictly to the user's preferred metric (`RPE` or `RIR`) with conversion ($\text{RPE} = 10 - \text{RIR}$) to prevent mixing.
  5. Make RPE/RIR optional: new exercises start with `null` intensity. Adding set 2+ inherits the previous set's intensity if present. Allow lifters to log sub-6.0 RPE sets for warmups, but enforce an algorithmic filter in `calculateHeuristic1RM` that discards sets with $\text{RPE} < 6.0$ or $\text{RIR} > 4.0$ from e1RM estimation.
- **Consequences**:
  - *Pros*: Fixes top info bar clipping on Android 15; dramatically improves input touch targets and legibility in the gym; prevents mathematical pollution of 1RM models from warmup sets; provides consistent intensity metrics across all summary views.
  - *Cons*: Editing weights via steppers requires tapping to expand the accordion drawer if not typing directly into the text input.

---

## ADR-030: Active Logger Exercise Accordion, Auto-Advance, Completed Green State & Incomplete Set Exclusion Strategy
- **Context**: In Phase 1 mobile workout logging, two in-gym usability challenges were identified:
  1. **Visual Clutter & Excessive Scrolling**: Displaying all exercises and their full set tables simultaneously forced lifters to repeatedly scroll up and down on mobile screens during fatigue. Lifters need focus exclusively on the "current" exercise, with completed and upcoming exercises collapsed.
  2. **Incomplete Sets Ambiguity on Finish**: When finishing a workout where prescribed or generated sets remained uncompleted, previous implementations saved all sets into the database. Consequently, unexecuted sets with default or placeholder weights were counted in total volume (tonnage), distorted session statistics in `SessionDetailModal`, and appeared in future progressive overload ghost sets.
- **Decision**:
  1. **Auto-Advance Hybrid Accordion ("Always Keep One Open")**:
     - Maintain an `expandedExerciseId` state variable in `ActiveLoggerScreen`. Exactly one exercise card is expanded at any time.
     - On initial workout load, the logger automatically expands the first exercise containing at least one incomplete set (falling back to the first exercise if all sets are complete or empty).
     - When the lifter checks off the final uncompleted set of the active exercise:
       - The active exercise collapses.
       - The collapsed exercise card takes on the completed green tint (`backgroundColor: '#0F1A12'`, `borderColor: '#14532D'`, `expandChevron: '#00E676'`) matching `SetRowComponent` completed styling.
       - The logger automatically advances and expands the next sequential exercise that contains incomplete sets.
       - The rest timer triggers per ADR-009.
     - Lifters can tap any collapsed exercise header at any time to inspect sets, modify weights/reps, or tap `+ ADD SET`. Tapping the currently expanded exercise header keeps it open.
     - When an exercise card is collapsed, it maintains a minimal profile: displaying only the exercise name, dumbbell/gear/superset subtext, the `SWAP` action button, and the directional chevron (`▶`).
  2. **Incomplete Sets Finish Prompt & Exclusion Protocol**:
     - When tapping **FINISH**, if uncompleted sets exist, the finish modal presents a prominent interactive banner:
       - Displays: `⚠️ You have X uncompleted sets across Y exercises.`
       - Checkbox: `[ ] Log remaining X sets as complete` (default: **Unchecked** / Exclude by default).
       - Helper caption: Explains that uncompleted sets will be excluded from the finished ledger and future summaries when unchecked, or logged as completed when checked.
     - If the lifter finishes with the checkbox **unchecked**:
       - All uncompleted sets are deleted from SQLite via `sessionService.deleteSet()` prior to finalizing the workout status as `'completed'`.
       - This guarantees that `SessionDetailModal`, volume tonnage aggregations, best e1RM, and future progressive overload ghost sets (`getMostRecentCompletedSetsForExercise`) purely reflect executed sets.
       - Avoids schema migrations or updates to `schemas/workout_export.schema.json` and `companion/src/ingestion/schemas.py`, preserving cross-stack contract synchrony.
     - If the lifter checks the box: all sets are marked as completed and retained in the workout ledger.
  3. **Crash Recovery Synchrony**:
     - Completed set IDs are persisted write-through to `user_settings` (`active_completed_set_ids_<workoutId>`) whenever a set checkmark is toggled. On session reload or crash resumption, completion states are immediately restored. The key is cleanly deleted when the session completes or is discarded.
- **Consequences**:
  - *Pros*:
    - Completely eliminates unnecessary vertical scrolling in the gym; maintains lifter focus on the immediate task.
    - Clear visual feedback with vivid green completion states for finished exercises.
    - Zero data pollution from skipped sets in historical summaries, volume calculations, or future ghost sets.
    - Zero schema migration overhead and zero cross-stack contract drift.
  - *Cons*:
    - Sets skipped and excluded are not stored in the final workout record (though original prescriptions remain preserved in `workout_templates`).

---

## ADR-031: Exercise Variant Tree Visualization, Equipment Inventory CRUD & In-Gym Navigation
- **Context**: In real-world gym environments, lifters train with diverse equipment (e.g., 15 kg technique bars, 25 kg trap bars, 29 kg safety squat bars, and 2:1 functional trainer cable pulleys) and frequently perform exercise variants (e.g., Incline Bench Press as a variant of Barbell Bench Press, or Deficit Deadlift as a variant of Conventional Deadlift). Without dedicated catalog and gear management interfaces, lifters cannot configure equipment tare weights or create custom movements, and the variant tree hierarchy established in ADR-012 remains inaccessible in the UI.
- **Decision**:
  1. **Gear & Equipment Inventory Management (`GearInventoryScreen.tsx`, `GearInventoryService.ts`)**:
     - Provide full CRUD interface for `gear_inventory`.
     - Support category-specific specifications: tare weights in kg or lbs (automatically converted and persisted canonically in kilograms per ADR-008) and cable pulley mechanical ratios (1.0 for 1:1 direct stacks, 0.5 for 2:1 functional trainers per ADR-025).
     - Support 1-tap "Set Default" designating the primary barbell or cable stack for each equipment category.
  2. **Exercise Catalog & Variant Tree UI (`ExerciseLibraryScreen.tsx`, `ExerciseFormModal.tsx`)**:
     - Dual-mode visualization:
       - **Catalog List**: Fast alphabetical listing with text search (name and muscle substring) and filter chips for Muscle Groups (Chest, Back, Quads, etc.), Equipment (Barbell, Dumbbell, Cable, Machine, Bodyweight), and Custom-only.
       - **Variant Tree (ADR-012)**: Hierarchical view grouping root movements with expandable nested child variants.
     - `ExerciseFormModal`: Comprehensive editor for custom exercises, including muscle group, equipment, compound/bodyweight/unilateral flags, load mode (`total` vs `per_hand`), default bar tare, cable ratio, rest seconds, and root parent selection (`parent_exercise_id`).
  3. **Seamless In-Gym Integration**:
     - Embed navigation cards in `SettingsScreen.tsx` for standalone inventory and catalog management.
     - Integrate a "Browse Library & Variant Tree ➔" shortcut directly into `ActiveLoggerScreen.tsx`'s "Add Exercise" modal, allowing lifters to create custom movements or inspect variants mid-workout without losing active session state.
- **Consequences**:
  - *Pros*:
    - Lifters can accurately model any gym equipment and custom movements with correct mechanical loads.
    - Variant tree relationships are fully visual and interactive.
    - Zero session loss when browsing library or adding custom movements during an active workout.
    - Clean headless architecture with 100% Jest test coverage.
---

## ADR-032: Contract-First Standardized JSON Export Architecture & Dependency Injection
- **Context**: Step 2.3 requires serializing the complete SQLite database state into the exact structure defined by `schemas/workout_export.schema.json`, integrating with `expo-file-system` and `expo-sharing` for 1-tap mobile export from Settings, and emitting a sample fixture `schemas/fixtures/sample_workout_export.json` for cross-stack Python validation.
- **Decision**:
  1. **Comprehensive 12-Table Serialization**:
     - `ExportService` extracts and normalizes all 12 SQLite relational tables: `programs`, `program_blocks`, `workout_templates`, `template_exercises`, `progression_rules`, `workouts`, `workout_sets`, `exercises`, `gear_inventory`, `body_metrics`, `user_settings`, and `user_profiles`.
     - Preserves dual-weight load modeling per ADR-026: canonical effective mechanical load in `weight` vs exact lifter typed value in `raw_input_weight`.
     - Converts SQLite integer flags (`0` / `1`) to strict JSON booleans (`is_compound`, `is_bodyweight`, `is_unilateral`, `is_custom`, `is_default`).
     - Deserializes serialized JSON string columns (`progression_rules.rule_json` and `user_profiles.secondary_goals`).
     - Collapses relational `user_settings` key-value rows into a single `Record<string, string>` dictionary matching the schema contract.
  2. **Dependency Injection & Test Isolation**:
     - Default implementations leverage `expo-file-system/legacy` (`FileSystem.cacheDirectory`, `FileSystem.writeAsStringAsync`) and `expo-sharing` (`Sharing.isAvailableAsync`, `Sharing.shareAsync`).
     - `ExportService` accepts an optional `ExportServiceDependencies` parameter (`fileWriter`, `fileSharer`, `getCacheDirectory`), enabling headless execution and unit test verification in Jest without native bridge requirements.
  3. **Cross-Stack Contract Synchronization & Verification Gate**:
     - Synchronized `equipment_access` enum across `schemas/workout_export.schema.json`, `companion/src/ingestion/schemas.py`, and `mobile/src/core/types/index.ts`.
     - Test execution writes `schemas/fixtures/sample_workout_export.json`.
     - Pytest in `companion/tests/test_schemas.py` validates the emitted fixture against both the canonical Draft-07 JSON Schema (`jsonschema.validate`) and Companion Pydantic v2 models (`WorkoutExportPayload.model_validate`).
- **Consequences**:
  - *Pros*:
    - Guaranteed zero schema drift between mobile SQLite, JSON schemas, and companion analytics.
    - Pure, headless, and fast test execution in both Jest and Pytest.
    - 1-tap mobile export experience in `SettingsScreen.tsx`.
  - *Cons*:
    - Any future SQLite table schema modifications require simultaneous updates to `schemas/workout_export.schema.json` and `companion/src/ingestion/schemas.py` per AGENTS.md rule 8.4.

---

## ADR-033: External Training History Import Engine (Strong, Hevy & Generic CSV)
- **Context**: Lifters onboarding to Workout Suite frequently possess extensive historical logs in external apps (Strong, Hevy, FitNotes, or generic spreadsheets). Importing these logs is critical for longitudinal modeling, PR benchmarks, and ghosting without manual re-entry. However, third-party CSV exports present diverse column conventions, varied date/duration formats, semicolon vs comma delimiters, Imperial loads (lbs), superset tags, and naming discrepancies.
- **Decision**:
  1. **Pure, Zero-Dependency RFC 4180 CSV Tokenizer (`csvImportParser.ts`)**:
     - Auto-detects `,` vs `;` delimiters by scanning header line content outside quotes.
     - Fully supports RFC 4180 quoted fields enclosing delimiters, escaped quotes (`""`), and multiline set notes.
     - Parses diverse timestamp encodings: ISO (`2026-06-25 09:45:13`), textual Hevy month strings (`15 Jul 2026, 09:52`), European slashes (`25/06/2026 14:30`), and duration strings (`1h 14m`, `45m`, `3600`).
     - Normalizes Imperial loads (`lbs`) to canonical kilograms (`lbsToKg`) while preserving both `raw_input_weight` and `weight` per ADR-008 and ADR-026.
     - Automatically classifies set types: `warmup`, `drop`, `failure`, and `working`.
  2. **Multi-Stage Exercise Matching & Fallback Synthesis (`ImportService.ts`)**:
     - *Stage 1 (Exact)*: Case-insensitive, trimmed match against `IExerciseRepository`.
     - *Stage 2 (Alias Table)*: Pre-seeded alias mapping for 60+ common third-party naming conventions (e.g. `Bench Press (Barbell)` $\rightarrow$ `barbell_bench_press`, `Military Press` $\rightarrow$ `barbell_overhead_press`, `Dips` $\rightarrow$ `bodyweight_dip`).
     - *Stage 3 (Structural Inversion)*: Parenthetical category inversion (e.g. `Incline Bench Press (Barbell)` $\rightarrow$ `Barbell Incline Bench Press`).
     - *Stage 4 (Token Similarity)*: Jaccard token overlap ($\ge 0.60$).
     - *Stage 5 (Custom Synthesis)*: Automatically generates a valid `Exercise` entity with smart category and muscle group inferral if no catalog match exists.
  3. **Duplicate Session Detection & Provenance Tagging**:
     - Inspects existing workouts in `IWorkoutRepository` on matching session dates.
     - Flags duplicate sessions sharing identical exercises and set counts, preventing duplicate entries when re-importing full histories.
     - Allows users to toggle `skipDuplicates` (default: **ON**).
     - Tags all imported sessions with `imported_from = 'strong' | 'hevy' | 'csv'`.
  4. **Interactive Wizard & Test Isolation (`ImportScreen.tsx`)**:
     - Multi-step UI wizard (`select` $\rightarrow$ `analyzing` $\rightarrow$ `preview` $\rightarrow$ `importing` $\rightarrow$ `complete`) with document picking via `expo-document-picker` and direct CSV text paste for testing/accessibility.
     - Employs dependency injection (`documentPicker`, `fileReader`) allowing headless, deterministic unit testing in Jest without native bridge requirements.
     - Integrated directly into `SettingsScreen.tsx` under `DATA & BACKUP`.
- **Consequences**:
  - *Pros*:
    - Complete data portability for lifters moving from Strong or Hevy.
    - Zero data corruption or unit distortion: all imported weights are stored canonically in kilograms.
    - Robust duplicate detection avoids redundant logs.
    - Pure TypeScript zero-dependency core parsers with 100% Jest test coverage.
  - *Cons*:
---

## ADR-032: Phase 2 Set Types, Spelled-Out Badges, Set-Specific Rest Timer Automations, and Decimal Separator Normalization
- **Context**: In Phase 2 mobile logger refinement, three ergonomic and functional issues were addressed:
  1. **Ambiguous Set Types & Badges**: Single-letter abbreviations ('D', 'M', 'F') caused cognitive friction in the gym. 'Failure' was redundant because set intensity is tracked directly via RPE 10 / RIR 0. Doggcrapp (DC) rest-pause sets were unrepresented.
  2. **Rest Timer Inflexibility**: All completed sets universally triggered the exercise default rest timer (e.g. 90s–180s), forcing lifters to manually skip the timer on Drop sets (which require immediate execution) or repeatedly adjust the timer for high-intensity techniques like Myo-reps (10s rest) and DC sets (30s rest).
  3. **Keyboard Decimal Separator Discarding**: Typing on software or hardware keyboards with decimal separators was broken: `,` was stripped by regex `replace(/[^0-9.]/g, '')`, and typing `.` or `,` was immediately erased because controlled inputs coerced `"62."` to `parseFloat("62.") = 62`, re-rendering the value as `"62"`.
- **Decision**:
  1. **Spelled-Out Badge Pills**: Widen the set badge pill (`minWidth: 46px`) and use uniform 2-to-4 letter labels:
     - `Reg` (regular working set, dark gray)
     - `Warm` (warmup set, amber)
     - `Drop` (drop set, purple)
     - `Myo` (myo-rep set, cyan)
     - `DC` (Doggcrapp rest-pause set, high-contrast blue)
     - Tapping cycles sequentially: `Reg -> Warm -> Drop -> Myo -> DC`.
  2. **Cross-Stack SetType Alignment (Rule 8.4)**:
     - Purged `failure` from `SetType` across Mobile, `schemas/workout_export.schema.json`, and `companion/src/ingestion/schemas.py`.
     - Added `dc` to `SetType`: `'warmup' | 'working' | 'drop' | 'myorep' | 'dc'`.
     - In CSV import parsers (`csvImportParser.ts`), mapped legacy `f` / `failure` rows to `working` with `rpe: 10` / `rir: 0`.
  3. **Set-Type-Specific Rest Timer Automations**:
     - `Drop` set: 0 seconds rest — immediately resets and dismisses any active rest timer.
     - `Myo` set: exactly 10 seconds rest auto-starts on set completion.
     - `DC` set: exactly 30 seconds rest auto-starts on set completion.
     - `Reg` and `Warm` sets: retain exercise default rest duration (or 90s fallback), respecting superset group rest suppression rules.
  4. **Local String Buffers for Decimal Input**:
     - Maintain local string buffer state (`weightInput`, `intensityInput`) while text inputs are focused.
     - Automatically normalize `,` to `.`.
     - Preserve intermediate typing states like `"62."` or `"62,"` until blur or commit, preventing premature coercion from erasing the delimiter.
- **Consequences**:
  - *Pros*:
    - Clear, recognizable badges with zero confusion between working numbers and set types.
    - Zero manual timer interaction needed when doing drop sets or rest-pause sets.
    - Seamless weight and RPE typing regardless of locale (European `,` or US/UK `.`).
    - Full contract and schema conformity across Mobile, JSON export schemas, and Companion Python ingestion.
---

## ADR-034: Allometric Strength Standards, DOTS Polynomial Coefficients, and Bilinear Quantile Interpolation
- **Context**:
  Comparing strength across lifters of varying bodyweights requires addressing the allometric square-cube law: muscle contractile force scales with cross-sectional area ($\propto L^2$), whereas body mass scales with volume ($\propto L^3$). Simple linear strength-to-bodyweight ratios ($w / \text{BW}$) heavily penalize heavier athletes and artificially inflate lighter lifters' relative scores. Powerlifting utilizes the official DOTS coefficient formula for inter-weight-class fairness, while general resistance training benchmarks (ExRx, Symmetric Strength) rely on empirical quantile tables stratified across 5 progression tiers (`Untrained`, `Novice`, `Intermediate`, `Advanced`, `Elite`).
- **Decision**:
  1. **Official Powerlifting DOTS Engine**:
     - Implement the official IPF DOTS 4th-degree polynomial formula in `mobile/src/core/math/dotsCoefficients.ts`:
       $$\text{DOTS} = \frac{\text{Total} \times 500}{a \cdot \text{BW}^4 + b \cdot \text{BW}^3 + c \cdot \text{BW}^2 + d \cdot \text{BW} + e}$$
       with official male and female coefficients, denominator positivity guards, and non-positive weight clamping.
     - Include `calculateSBDTotal(squat, bench, deadlift)` with float rounding.
  2. **Empirical Benchmark Seed Catalog**:
     - Pre-seed 95 empirical benchmark rows in `mobile/src/database/seeds/strengthStandardsSeed.ts` across 5 primary compound movements (`squat`, `bench`, `deadlift`, `ohp`, `row`) for both `male` (50–140 kg across 10 brackets) and `female` (40–120 kg across 9 brackets).
  3. **Bilinear Quantile Interpolation**:
     - Implement continuous bodyweight interpolation in `mobile/src/core/math/strengthStandards.ts`:
       $$T(\text{BW}) = T(\text{BW}_{\text{low}}) + \frac{\text{BW} - \text{BW}_{\text{low}}}{\text{BW}_{\text{high}} - \text{BW}_{\text{low}}} \times (T(\text{BW}_{\text{high}}) - T(\text{BW}_{\text{low}}))$$
       Clamping safely to edge brackets for lifters outside the standard 40–140 kg range to prevent unconstrained polynomial divergence.
  4. **Continuous Normalized Strength Score ($0.0\text{--}100.0+$)**:
     - Map estimated 1RM ($w \cdot r_{\text{eff}}^k$) to a smooth piecewise score ensuring continuity at every tier boundary:
       - 0.0–19.9: `Untrained` (Next tier: `Novice`)
       - 20.0–39.9: `Novice` (Next tier: `Intermediate`)
       - 40.0–59.9: `Intermediate` (Next tier: `Advanced`)
       - 60.0–79.9: `Advanced` (Next tier: `Elite`)
       - 80.0+: `Elite` (Next tier: `null`, uncapped scaling above elite threshold)
  5. **Demographic Percentile & SBD Symmetry Radar**:
     - Map continuous scores to empirical active-lifter population percentiles ($0.1\% \dots 99.9\%$).
     - Implement `calculateSBDBalanceProfile` to evaluate Squat, Bench, and Deadlift symmetry, detect dominant or lagging movements ($\pm 4.0$ score threshold divergence), and generate 0–100 normalized radar coordinates for subsequent inspection screens.
- **Consequences**:
  - *Pros*:
    - Completely fair, scientifically validated strength comparisons across all body sizes and genders.
    - Eliminates harsh "tier cliffs": lifters see continuous incremental progress toward the next classification tier to the tenth of a point.
    - 100% offline, local-first execution with zero third-party API dependencies.
---

## ADR-035: Rep-Max Records Extraction via SQL Window Functions and Exercise Inspection Service
- **Context**:
  Lifters inspecting an exercise want to evaluate their personal records (PR Board) across all repetition ranges ($1\text{RM}, 2\text{RM}, 3\text{RM}, 5\text{RM}, 8\text{RM}, 10\text{RM}, \dots$) to evaluate which rep count represents their peak strength capability. Furthermore, athletes running periodized blocks require toggling between All-Time PRs and current Program Block PRs (scoped to a `program_blocks` date range), as well as viewing aggregated PRs across exercise variants (e.g., combining Incline and Flat Bench Press). Loading all historical sets into JavaScript memory and grouping in client memory degrades performance as workout volume accumulates over years of training.
- **Decision**:
  1. **SQL Window-Function Aggregation (`PARTITION BY s.reps`)**:
     - Delegate rep-max record ranking directly to SQLite using:
       ```sql
       ROW_NUMBER() OVER (
         PARTITION BY s.reps 
         ORDER BY s.weight DESC, 
                  COALESCE(s.rpe, 10.0 - COALESCE(s.rir, 0.0)) DESC, 
                  w.date DESC, 
                  s.created_at DESC
       ) AS rn
       ```
     - Filters only completed workouts (`w.status = 'completed'`) and valid sets (`s.reps > 0`, `s.weight > 0`), ensuring $O(1)$ client memory overhead and rapid query execution even across thousands of logged sets.
     - Implemented identically in `MockWorkoutRepository` for headless unit testing.
  2. **Application Service Orchestration (`ExerciseInspectionService`)**:
     - Handles cross-variant hierarchy resolution via `exerciseRepository.findVariants(rootId)` when `includeVariants === true`.
     - Enriches raw rows with domain mathematical benchmarks: effective reps ($r_{\text{eff}} = \text{reps} + \text{RIR}$) and estimated 1RM ($w \cdot r_{\text{eff}}^k$) using the Lombardi power law.
     - Identifies the `peakRecord` (determining which specific repetition performance represents the lifter's absolute peak strength capability).
     - Resolves SBD standard classification tiers using `evaluateStrengthStandard` when inspecting standard compound movements (`squat`, `bench`, `deadlift`, `ohp`, `row`).
     - Aggregates historical volume summary (total sessions, total completed sets, total tonnage volume in kg, earliest and latest dates).
- **Consequences**:
  - *Pros*:
    - High-performance, database-level extraction that scales indefinitely with dataset size.
    - Decouples raw set retrieval from domain math (e1RM, standards, variant hierarchy).
    - Seamlessly supports All-Time vs Program-Block date scoping and cross-variant analysis.
  - *Cons*:
    - Requires SQLite 3.25+ window function support (fully supported by `expo-sqlite`).

---

## ADR-036: Exercise Inspection UI, SVG Radar Symmetry, and Conditional Allometric Standards Display
- **Context**:
  In Step 3.3, mobile presentation components were required to render the Exercise Deep-Dive profile, Rep-Max PR Board, allometric strength tier classifications, and powerlifting SBD balance symmetry. Key technical and ergonomic challenges included:
  1. **Vector Graphics & Geometry**: Rendering 3-axis radar polygons and continuous demographic bell curves without layout jitter or pixelated canvas artifacts.
  2. **Demographic Dependency on Athlete Bodyweight**: Both the empirical allometric classification tables and the official IPF 4th-degree DOTS polynomial scale non-linearly with continuous bodyweight ($\text{BW}$) and biological gender. If an athlete has not yet logged their bodyweight, calculating a DOTS score or allometric percentile produces invalid or misleading data.
  3. **Visual Ergonomics & Scoping**: The multi-lift 3-axis SBD Radar assesses composite balance across Squat, Bench, and Deadlift. Single-exercise detail views (especially accessories like Bicep Curls or Lateral Raises) should display lift-specific metrics without clutter, keeping the composite multi-lift SBD Radar in a dedicated modal/view.
- **Decision**:
  1. **Adopt `react-native-svg` with Headless Jest Mocks**:
     - Installed `react-native-svg` in `mobile/` for high-performance vector rendering of concentric equilateral polygon grid webs, axis guidelines, filled user data polygons, and bell curve distribution paths.
     - Added `<rootDir>/__mocks__/react-native-svg.ts` and Jest `moduleNameMapper` configuration so headless unit tests execute reliably in Node without native bridge dependencies.
  2. **User Profile Persistence for Gender & Bodyweight**:
     - Extended `IUserSettingsRepository`, `SQLiteUserSettingsRepository`, and `MockUserSettingsRepository` with typed accessors:
       - `getUserGender(): Promise<Gender>` (defaults to `'male'`).
       - `setUserGender(gender: Gender): Promise<void>`.
       - `getUserBodyweight(): Promise<number | null>` (returns kilograms or `null` if unset).
       - `setUserBodyweight(weightKg: number | null): Promise<void>`.
     - Preserves bodyweight canonically in kilograms while formatting to `lbs` or `kg` according to the active `unit_system`.
  3. **Conditional SBD Standards & DOTS Display (`SBDStandardsCard.tsx`)**:
     - When bodyweight is `null` / unset:
       - Displays a prominent prompt banner: *"Bodyweight Needed for Standards — Allometric strength tiers and DOTS scores scale with body mass."* with inline Male/Female toggle and bodyweight numeric input.
       - Strictly suppresses the DOTS score box to avoid showing uncalibrated numbers.
     - When bodyweight is provided:
       - Displays the tier classification badge (`Untrained`, `Novice`, `Intermediate`, `Advanced`, `Elite`) with tier-specific accent colors.
       - Renders continuous score (`0.0 - 100.0+`) and progress bar to next tier (`+X.X kg needed`).
       - Renders an SVG demographic percentile bell curve marking the athlete's placement (e.g. *"Top 22% of Lifters"*).
       - Prominently displays the official single-lift DOTS coefficient box.
  4. **Rep-Max PR Board Table (`PRBoardTable.tsx`)**:
     - Displays heaviest load lifted per unique repetition count ($1\text{RM}, 2\text{RM}, 3\text{RM}, \dots$).
     - Renders Lombardi set e1RM benchmark alongside each record ($w \cdot r_{\text{eff}}^k$) and badges the set with the highest overall e1RM with a golden `★ PEAK` badge.
     - Provides All-Time vs. Program Block scope buttons and a variant toggle (`+ Include Variants`).
     - Tapping any PR row invokes `onSelectWorkout(workoutId)`, launching `SessionDetailModal.tsx` for immediate drill-down inspection.
  5. **Composite SBD Balance Radar (`SBDBalanceRadarChart.tsx`)**:
     - Dedicated modal visualizing 3-axis symmetry across Squat (top), Bench (bottom-right), and Deadlift (bottom-left).
     - Renders concentric polygon web rings (25%, 50%, 75%, 100%) and filled user balance polygon.
     - Classifies symmetry (`Balanced Triad`, `Dominant Lift`, `Lagging Lift`) using the $\pm 4.0$ point divergence threshold.
     - Displays composite SBD Total load and full powerlifting DOTS score.
  6. **Exercise Deep-Dive Container (`ExerciseDetailScreen.tsx`)**:
     - Displays lifetime tonnage volume, total completed sessions, and total sets.
     - Integrates `SBDStandardsCard` (for standard lifts) and `PRBoardTable`.
     - Provides button to open `SBDBalanceRadarChart` for SBD movements.
     - Integrated into `ExerciseLibraryScreen.tsx` with an `Inspect PRs ➔` card button.
- **Consequences**:
  - *Pros*:
    - Adheres strictly to Pure Utility Mode (ADR-024) with OLED-friendly high-contrast dark theme.
    - Zero misleading calculations: DOTS and allometric tiers only activate when bodyweight is logged.
    - Full end-to-end user journey: browsing the library $\rightarrow$ inspecting PRs $\rightarrow$ drilling into past historical workouts $\rightarrow$ analyzing SBD symmetry.
    - 100% headless testability with zero crashes in Jest (451/451 tests passing).

---

## ADR-037: Declarative Progression Rule Engine with Priority Ordering and Dynamic Double Progression Set Proposals
- **Context**:
  In Step 4.1, the mobile domain core required a pure, side-effect-free progression rule evaluator to power progressive overload coaching across different training philosophies (Linear Progression, Double Progression, Dynamic Double Progression, RPE caps, plateau deloads). Key requirements included:
  1. **Strict Sandboxing & Safety**: Rules are stored as declarative JSON in SQLite (`progression_rules.rule_json`) and exported in JSON schemas without arbitrary code execution.
  2. **Multi-Rule Evaluation Semantics**: A template exercise may have multiple competing progression rules (e.g., a priority-1 easy RPE bonus jump vs. a priority-2 standard increment vs. a priority-3 failure deload).
  3. **Dynamic Double Progression (DDP) Set-Level Granularity**: Unlike standard Double Progression where all sets must reach the rep ceiling before advancing together, HIT and bodybuilder protocols (Dorian Yates, Jordan Peters) advance sets independently as each set qualifies.
  4. **Robust Chronological Invariance**: Session history passed from UI or repositories might arrive in descending order or mixed dates, and may contain warmup sets or sets from other exercises.
- **Decision**:
  1. **Pure Functional Evaluator (`mobile/src/core/rules/progressionRuleEngine.ts`)**:
     - Evaluates `evaluateProgressionRules(rules, recentSessions, currentPrescription, options)` with zero database mutations or side effects.
     - Automatically filters sessions to `prescription.exercise_id`, excludes `warmup` sets, and sorts sessions chronologically (oldest $\rightarrow$ newest).
  2. **Priority Ordering and Composite Evaluation Result**:
     - Rules are parsed (supporting both in-memory objects and serialized strings) and evaluated by `priority ASC`.
     - Returns `ProgressionEvaluationResult`:
       - `hasMatches: boolean`: True if at least one rule matched.
       - `primaryProposal: ProgressionProposal | null`: The highest-priority triggered proposal for primary banner rendering.
       - `matchedProposals: ProgressionProposal[]`: All triggered rules in priority order.
  3. **Dual-Tier DDP Set Proposal Architecture**:
     - When a rule evaluates `ANY_SET_HIT_TOP_REP_RANGE`, the evaluator produces both a high-level summary proposal and a detailed `setProposals: SetProgressionProposal[]` array (`{ setIndex, currentWeightKg, suggestedWeightKg, currentReps, targetHit, status: 'increase' | 'maintain', explanation }`).
     - Allows future logger UI (Step 4.4) to pre-fill individual set rows with different prescribed weights.
  4. **Supported Conditions & Actions**:
     - Conditions: `ALL_SETS_HIT_TARGET_REPS`, `ANY_SET_HIT_TOP_REP_RANGE`, `AVERAGE_RPE_LESS_THAN` (with automatic RIR conversion $10 - \text{RIR}$), `CONSECUTIVE_SUCCESSFUL_SESSIONS`, `CONSECUTIVE_FAILED_SESSIONS`, `MISSED_REPS_COUNT`, `TOP_SET_RIR_GREATER_THAN`.
     - Actions: `INCREASE_LOAD_FIXED`, `INCREASE_LOAD_PERCENT`, `DECREASE_LOAD_FIXED`, `INCREASE_TARGET_REPS`, `ADD_WORKING_SET`, `RESET_TO_BASELINE`, `TRIGGER_DELOAD`, `RESET_WEIGHT_PERCENT`.
     - Uses `roundToStep` from `unitConversion.ts` to prevent IEEE-754 precision artifacts.
  5. **Built-in Progression Presets**:
     - `createLinearProgressionRule`: +2.5 kg upon success; 10% deload after 3 consecutive plateaus.
     - `createDoubleProgressionRule`: +2.5 kg and rep bracket reset to baseline upon all sets hitting ceiling; plateau deload.
     - `createDynamicDoubleProgressionRule`: independent set-level promotion upon hitting ceiling; plateau deload.
- **Consequences**:
  - *Pros*:
    - 100% deterministic and unit-tested (32/32 tests passing in Jest, 483/483 total mobile tests passing).
    - Fully decoupled from React and SQLite; can run in mobile services, background workers, or even node scripts.
    - Directly feeds into Step 4.2 Program Synthesizer and Step 4.4 Interactive Progression Banner.

---

## ADR-038: Profile-Driven Program Synthesizer (Pure Generator Architecture)
- **Context**:
  In Step 4.2, the mobile domain core required an automated generator capable of synthesizing personalized, periodized multi-day workout programs directly from the athlete's psychological and demographic profile matrix (`UserProfile`). Key challenges included:
  1. **Strict Decoupling from SQLite**: Routine generation should run as pure domain math/logic without touching database tables or requiring active transactions, allowing dry-run previews in onboarding and unit testing in Node/Jest.
  2. **Split Selection Geometry**: Weekly training frequencies range from 1 to 7 days. The generator must select optimal splits:
     - 1–3 days: Full Body (Full Body A, B, C)
     - 4 days: Upper / Lower (Upper A, Lower A, Upper B, Lower B)
     - 5 days: PPLUL (Push, Pull, Legs, Upper, Lower)
     - 6–7 days: PPL x2 (Push A, Pull A, Legs A, Push B, Pull B, Legs B)
  3. **Antagonist Superset Optimization**: Minimalist athletes or lifters with limited session durations ($\le 45$ mins) require density optimization without compromising compound performance.
  4. **Equipment Adaptation**: A home gym or dumbbell-only athlete must never be prescribed barbell back squats or dual-pulley cable crossovers.
- **Decision**:
  1. **Pure Synthesis Function (`mobile/src/core/generator/programSynthesizer.ts`)**:
     - `synthesizeProgram(profile: UserProfile, options?: ProgramSynthesizerOptions): SynthesizedProgram` takes profile and optional custom exercise catalog, returning `{ program, templates, templateExercises, progressionRules, summary }`.
  2. **Intensity Style & Exertion Calibration**:
     - `high_intensity_low_volume`: 1–2 working sets per exercise @ target RPE 9.5 (RIR 0.5), automatically equipped with Dynamic Double Progression (`createDynamicDoubleProgressionRule`).
     - `volume_accumulation`: 3–4 working sets per exercise @ target RPE 7.5 (RIR 2.5), equipped with Standard Double Progression (`createDoubleProgressionRule`).
     - `balanced`: 3 working sets @ target RPE 8.5 (RIR 1.5).
  3. **Antagonist Superset Pairing Trigger**:
     - Automatically active when `training_enjoyment === 'minimalist'` OR `preferred_session_duration_mins <= 45`.
     - Pairs complementary movement patterns into shared `exercise_group_id` (`ss-{templateId}-{idx}`) for Chest + Back, Quads + Hamstrings, and Biceps + Triceps.
     - Compresses session exercise count down to 4–5 for ultra-short sessions ($\le 35$ mins).
  4. **Strict Equipment Eligibility Resolver**:
     - `resolveExerciseId`: Matches candidates strictly against `equipment_access`:
       - `garage_gym`: Barbell + Dumbbell + Bodyweight only (excludes commercial cables and pin machines).
       - `dumbbells_only`: Dumbbell + Bodyweight only.
       - `bodyweight_only`: Strict bodyweight only (`is_bodyweight: true`).
       - `commercial_gym`: Full equipment access.
  5. **Goal-Driven Reps & Progression**:
     - `strength`: 3–5 reps on primary compounds with Linear Progression (`createLinearProgressionRule`, +2.5 kg).
     - `hypertrophy`: 6–10 on primary compounds, 10–15 on accessories with Double Progression.
     - `powerbuilding`: 4–6 on primary compounds, 8–12 on accessories.
     - `endurance`: 12–18 reps.
- **Consequences**:
  - *Pros*:
    - 100% deterministic and unit-tested (20/20 generator tests, 503/503 mobile tests passing).
    - Produces clean relational entities with foreign keys ready for immediate bulk insertion in Step 4.3 (`SQLiteProgramRepository`).
    - Provides instant preview summary (`summary: SynthesizedProgramSummary`).

---

## ADR-039: Hierarchical Program Persistence, Aggregate Hydration & 1-Tap Meso-Cycle Era Swapping
- **Context**:
  Following the pure progression rule engine (Step 4.1) and profile-driven routine synthesizer (Step 4.2), the system required concrete persistence and service orchestration across the relational program hierarchy:
  1. **Relational Hierarchy Depth**: A training program is a 4-level deep relational tree: `programs` $\rightarrow$ `workout_templates` $\rightarrow$ `template_exercises` $\rightarrow$ `progression_rules`. Deletions, updates, and deep inspection queries must handle cascade semantics and aggregate hydration without N+1 query overhead or data leakage.
  2. **1-Tap Meso-Cycle Swapping**: Lifters transition between programs across training eras (`program_blocks`). Swapping programs should be an atomic 1-tap operation that closes the preceding block's open interval (`end_date = startDate`) and initiates a new active interval (`end_date = null`) tagged with the program's `color_hex`.
  3. **Athlete Profile Persistence**: The `user_profiles` schema contains serialized arrays (`secondary_goals`) and strict enums, which must be stored reliably and queried instantly for program generation.
  4. **Headless Unit-Testing Rigor**: All application services and UI screens must be testable headlessly in Jest without native SQLite binary drivers.
- **Decision**:
  1. **Port Interfaces (`mobile/src/domain/repositories/`)**:
     - `IProgramRepository`: Defines contract for `programs`, `workout_templates`, `template_exercises`, `progression_rules`, `program_blocks`, `getProgramWithDetails(programId)`, and `saveSynthesizedProgram(synthesized)`.
     - `IUserProfileRepository`: Defines contract for `getProfile()`, `findById()`, `saveProfile()`, and `hasProfile()`.
  2. **Concrete SQLite Repositories (`mobile/src/database/repositories/`)**:
     - `SQLiteProgramRepository`: Uses modern `expo-sqlite` async API (`runAsync`, `getAllAsync`, `getFirstAsync`). Serializes `rule_json` as JSON strings on write and parses on read. Implements `saveSynthesizedProgram` using `INSERT OR REPLACE` across all 4 entity tiers.
     - `SQLiteUserProfileRepository`: Implements `INSERT OR REPLACE` with `JSON.stringify` serialization for `secondary_goals`.
  3. **In-Memory Mock Repositories (`mobile/src/database/mocks/`)**:
     - `MockProgramRepository` & `MockUserProfileRepository`: Provide full in-memory Map-backed persistence with cascade deletion logic matching SQLite foreign keys for fast, headless testing in Node/Jest.
  4. **ProgramBlockService Orchestration (`mobile/src/services/programBlockService.ts`)**:
     - `swapActiveProgram(programId, startDate)`: Validates program existence, closes active block by updating `end_date = startDate`, and opens a new block. Idempotent if re-activating the currently active program.
     - `closeActiveProgram(endDate)`: Closes current active block without opening a new one.
     - `getBlockForDate(date)`: Finds the program block active on any arbitrary date (`start_date <= date AND (end_date IS NULL OR end_date >= date)`) enriched with `program_name` and `color_hex`.
     - `getActiveProgram()`, `getActiveTemplates()`, `getActiveProgramDetail()`.
- **Consequences**:
  - *Pros*:
    - Full persistence across all 6 Phase 4 entities without schema drift.
    - 49 new unit tests verifying both SQLite driver query mapping and in-memory mock fidelity (552/552 total mobile tests passing).
    - Prepares clean, decoupled domain interfaces for Step 4.4 UI screens (`UserProfileScreen`, `ProgramOverviewScreen`, `ProgressionProposalBanner`).

---

## ADR-040: Interactive Progression Proposals, Visual Rule Editor & Questionnaire Program Builder Integration
- **Context**:
  In Step 4.4, user interface features were required to operationalize the psychological profile engine, routine synthesizer, and rule evaluator in daily training:
  1. **Psychological Profile Onboarding**: Lifters need a clean, focused questionnaire to declare biological statistics (sex, height, birthdate), training enjoyment style, effort/intensity tolerance, schedule availability, and primary goals without feeling overwhelmed.
  2. **1-Tap Program Generation**: Upon configuring or updating an athlete profile, the app should synthesize a tailored multi-day program split, write all 4 relational entity levels to SQLite, and activate the meso-cycle era in a single seamless user action.
  3. **Visual IF/THEN/ELSE Progression Builder**: Lifters need an intuitive, visual modal to configure progressive overload logic on individual prescribed movements without writing JSON strings manually, while offering 1-tap quick presets for Linear Progression (LP), Double Progression (DP), and Dynamic Double Progression (DDP).
  4. **In-Logger Progressive Overload Coaching**: When opening or logging a session from a programmed template, the logger should evaluate historical performance against declarative progression rules and surface pending load/rep increases or deload advisories in a high-contrast, non-intrusive banner with 1-tap `[Accept]` and `[Dismiss]` actions.
  5. **Meso-Cycle Calendar Representation**: Transitioning between programs marks new training eras. The calendar should clearly indicate program swap boundaries using the program's designated accent color (`color_hex`).
- **Decision**:
  1. **Athlete Profile Questionnaire (`UserProfileScreen.tsx`)**:
     - Grouped into multi-step interactive sections: Biological Info, Training Enjoyment (Minimalist / Neutral / Enthusiast), Effort Style (High Intensity Low Volume / Volume Accumulation / Balanced), Goal Focus, Schedule Availability (2–6 days, 30–90 mins), and Equipment Constraints.
     - Features a primary 1-tap *"⚡ Generate Custom Program"* action button that calls `synthesizeProgram(profile)`, stores the synthesized program hierarchy via `programRepo.saveSynthesizedProgram`, and activates the new meso-cycle era via `programBlockService.swapActiveProgram`.
  2. **Program Overview & Split Manager (`ProgramOverviewScreen.tsx`)**:
     - Visual horizontal program selector with custom color swatches (`color_hex`), active program badges, and a 1-tap *"★ Set as Active Program"* button that calls `ProgramBlockService`.
     - Expandable multi-day template cards detailing prescribed exercises, set counts, rep brackets, target RPE/RIR, superset indicators, and an *"⚙ Progression Rules"* button launching the rule builder modal.
     - Includes a *"Create New Program"* modal for manual program drafting.
  3. **Visual Progression Builder Modal (`ProgressionBuilderModal.tsx`)**:
     - Dedicated full-screen modal managing rules for a specific `TemplateExercise`.
     - 1-tap quick preset buttons for Linear Progression (`createLinearProgressionRule`), Double Progression (`createDoubleProgressionRule`), and Dynamic Double Progression (`createDynamicDoubleProgressionRule`).
     - Visual IF/THEN custom rule builder with condition type dropdown, threshold input, action type dropdown, value stepper, and priority selector.
     - Color-coded badges for conditions and actions with human-readable explanations and 1-tap rule deletion.
  4. **Interactive Progression Proposal Banner (`ProgressionProposalBanner.tsx`)**:
     - OLED high-contrast logger banner mounted directly beneath the rest timer banner in `ActiveLoggerScreen.tsx`.
     - Distinct visual presentation for load progression (📈 green accent `#00E676`) versus deload advisories (🛡️ amber accent `#F59E0B`).
     - Renders set-level advancement breakdown pills for Dynamic Double Progression (DDP) protocols.
     - Tapping *"Accept Proposal"* immediately updates active uncompleted sets with proposed loads/reps via write-through persistence and dismisses the banner; tapping *"Dismiss"* preserves existing targets.
  5. **Calendar Meso-Cycle Swap Dots & Header (`CalendarScreen.tsx`)**:
     - Extended `buildMonthGrid` and `buildWeekDays` with optional `programSwapsByDate` dictionary mapping ISO dates to active program blocks.
     - Displays program-colored swap dots on calendar day cells where an active program change occurred.
     - Displays an active meso-cycle banner in the Agenda header showing current program name and era duration.
- **Consequences**:
  - *Pros*:
    - Completely bridges the gap between pure algorithmic domain logic (Steps 4.1–4.3) and active in-gym lifter experience.
    - Zero cognitive overload in the gym: progression math is pre-calculated and actionable in 1 tap.
    - Strictly adheres to Pure Utility Mode (ADR-024) with OLED blacks, high-contrast borders, and accessibility labels.
    - 16 new unit tests across 3 feature suites (568/568 mobile tests passing, `npx tsc --noEmit` and `npm run lint` verified).

---

## ADR-041: Custom Program Builder & Full CRUD, Training Mentality Matrix, 15-Minute Routines, and 4-Hub Navigation Overhaul
- **Context**:
  Following initial delivery of the Step 4.4 progression builder and synthesizer, lifters faced operational constraints:
  1. Programs could not be edited in place without risking mutation of stock pre-built or synthesized archetypes.
  2. Lifters lacked daily template CRUD (adding/deleting/reordering workout days) and exercise-level prescription control (steppers for sets, rep ranges, RPE/RIR toggles, movement swapping, and antagonist superset pairing).
  3. The questionnaire featured redundant questions ("Training enjoyment" vs. "Intensity style") that caused confusion and failed to clearly map lifter psychological intent directly to overload mechanics.
  4. Time-crunched lifters required ultra-dense 15-minute workouts with strict antagonistic pairing and rest pacing.
  5. The 3-tab navigation (`Logger`, `Calendar`, `Settings`) lacked a centralized high-level status dashboard and required a smarter session router for pre-workout flight checks.
- **Decision**:
  1. **Default Presets Protection & Deep Cloning Service (`programCloneService.ts`)**:
     - Pre-built and synthesized programs are strictly read-only.
     - Initiating an edit on a protected program triggers an automatic `cloneProgramAsCustom` flow that generates a new program (`prog_custom_<timestamp>_<hash>`), prefixes `[Name] (Custom)`, deep-clones all templates, template exercises, superset mappings, and progression rules, and selects the clone for editing.
     - Full CRUD delivered in `ProgramOverviewScreen.tsx`: template add/rename/reorder/delete; exercise add/swap/reorder/delete; prescription configuration (`PrescriptionEditorModal.tsx`); and superset link/unlink.
  2. **Training Mentality Model (Rule 8.4 Cross-Stack Synchronization)**:
     - Replaced `training_enjoyment` and completely deprecated `intensity_style`.
     - Standardized `TrainingMentality = 'fury' | 'precision' | 'get_out'` across:
       - `mobile/src/core/types/index.ts`
       - SQLite schema migration v1 -> v2 in `mobile/src/database/schema.ts`
       - JSON export contract in `schemas/workout_export.schema.json`
       - Python Pydantic v2 ingestion model in `companion/src/ingestion/schemas.py`
       - Synthesizer rules in `programSynthesizer.ts`:
         - `fury` ⚡: 2 compounds / 1 accessory @ RPE 9.5 DDP.
         - `precision` 🎯: 3–4 compounds / 2–3 accessories @ RPE 8.0 LP/DP.
         - `get_out` ⏱️: 2 compounds / 2 accessories @ RPE 8.5 with automatic antagonist supersets.
  3. **15-Minute Target Workout Architecture**:
     - Extended duration selector in `UserProfileScreen` to `[15, 30, 45, 60, 75, 90]` minutes.
     - Synthesizer generates exactly 4 exercises in 2 antagonist pairs (chest/back, quad/hamstring, bicep/tricep, delts/rear delts).
     - Exactly 2 sets per exercise (8 total working sets); 0s intra-pair rest, 90s inter-pair rest ($\approx 14\text{--}15$m total gym footprint).
  4. **4-Hub Root Navigation Overhaul (`App.tsx`)**:
     - Transitions from 3 tabs to 4 bottom hubs: `HOME (🏠)`, `WORKOUT (⚡)`, `PROFILE (👤)`, `SETTINGS (⚙️)`.
     - `HOME` (`HomeScreen.tsx`): Status dashboard (active program, next workout quick card, weekly metrics: workouts, tonnage, streak), interactive calendar agenda, and reserved analytics mount zone.
     - `WORKOUT` (`WorkoutTabRouter.tsx`): Smart session router:
       - State A: Active workout in progress $\rightarrow$ `ActiveLoggerScreen`.
       - State B: Active program $\rightarrow$ Pre-Flight screen with circular template sequencing (`(lastIndex + 1) % count`), planned exercise previews, primary "START WORKOUT", and secondary day selector / freestyle triggers.
       - State C: No active program $\rightarrow$ Empty state with "Open Program Planner" and "Start Freestyle Workout".
     - `PROFILE` (`UserProfileScreen.tsx`): Demographics, mentality matrix, logistics, 1-tap generator, and program overview launcher.
     - `SETTINGS` (`SettingsScreen.tsx`): Display units, exertion metric, cognitive mode, exercise/gear inventory, import/export, diagnostics.
- **Consequences**:
  - *Pros*:
    - Completely eliminates template editing barriers and protects system presets.
    - Simplifies athlete psychology into 3 distinct, actionable training philosophies.
    - Zero schema bleed or deserialization drift across mobile, schemas, and companion.
    - 44 test suites passed (577 tests), clean `tsc` typecheck, and companion tests verified.

---

## ADR-040: Three-Level Implement & Gear Assignment Architecture and Profile Co-Location
- **Context**: Serious lifters frequently utilize specialty implements (such as Safety Squat Bars, Trap Bars, or specialized cable pulleys) for specific movements without wanting those bars to globally replace standard barbells for unrelated movements (e.g. Bench Press or Deadlift). Furthermore, managing gym equipment inventory naturally belongs within the athlete's training environment profile rather than application display settings.
- **Decision**:
  1. **Co-Locate Gear Inventory in Profile**:
     - Moved "Gear & Equipment Inventory" from `SettingsScreen` to `UserProfileScreen` directly beneath the "Equipment Access" section.
     - Gear repository (`gearRepo`) and user settings are injected into `UserProfileScreen` to power full-screen equipment management (`GearInventoryScreen`).
  2. **Three-Level Implement & Bar Assignment**:
     - **Level 1 (Active Logger)**: Added an interactive 1-tap implement switcher button (`change-gear-button-<id>`) on Barbell and Cable exercise cards in `ActiveLoggerScreen`. Tapping opens `GearPickerModal` displaying compatible equipment from inventory. Selecting an implement (e.g., Safety Squat Bar 29kg) updates all sets of that exercise in real time and automatically informs the Plate Calculator tare weight without touching other exercises in the session.
     - **Level 2 (Program Planner Prescriptions)**: Added `availableGear` implement assignment chips to `PrescriptionEditorModal` in `ProgramOverviewScreen`. Users can bind specific specialty bars or cable ratios to individual template exercises (persisted to `template_exercises.gear_id`).
     - **Level 3 (Exercise Catalog Presets)**: Enhanced `ExerciseFormModal` with quick bar tare chips with descriptive implement labels (Olympic 20kg, Tech 15kg, Trap 25kg, SSB 29kg).
  3. **Bar Tare Isolation & Specialty Bar Safety**:
     - Confirmed and enforced that specialty bars (`type === 'specialty_bar'`) cannot be designated as global fallback defaults.
     - Generic barbell resolution (`resolveBarTareWeight`) exclusively resolves standard Olympic barbells (`type === 'barbell'`), ensuring that having an SSB in inventory or configuring specialty equipment NEVER alters non-applicable lifts such as Barbell Bench Press, Incline Bench, or Deadlift.
  4. **Visual De-Cluttering & Inventory Unification**:
     - Removed aggressive card-wide green backgrounds (`gearCardDefault`) in `GearInventoryScreen`.
     - Standardized all cards to an OLED high-contrast inventory look where every item is clearly presented as available equipment in the lifter's gym.
- **Consequences**:
  - *Pros*:
    - Solves user confusion: athletes can possess a Safety Squat Bar in their gym and select it exclusively for squats without needing to make it a global default.
    - Guaranteed safety: Bench Press, Overhead Press, and Deadlift retain standard 20 kg barbell tare weights unless explicitly configured otherwise.
    - Complete flexibility across all 3 levels of the app lifecycle (catalog, program design, and in-gym active logging).
  - *Cons*:
    - Requires passing `gearRepo` to `UserProfileScreen` and `ProgramOverviewScreen`.

---

## ADR-041: U.S. Navy Body Fat Formulation, Automatic Profile Resolution & Bodyweight Rolling Smoothing
- **Context**: Longitudinal physique and body composition tracking requires estimating body fat percentage from circumference tape measurements and smoothing daily bodyweight fluctuations (water weight, glycogen, and sodium variations). The historical U.S. Navy circumference equations (Hodgdon & Beckett, 1984) were empirically derived using inches ($86.010, 70.041, 36.76$ for men and $163.205, 97.684, -78.387$ for women). Directly inserting centimeter measurements into the imperial linear log form without adjustment produces mathematically invalid results (e.g. an athletic female at 21% body fat calculates as ~48%). Furthermore, while circumference values (`waist_cm`, `neck_cm`, `hip_cm`) are logged in `body_metrics`, the athlete's biological `gender` and `height_cm` reside in the separate `user_profiles` table.
- **Decision**:
  1. **Official DoD Metric Density Equation & Siri Formula (`navyBodyFat.ts`)**:
     - Implement the standard metric Department of Defense body density ($D$) equations directly using centimeters:
       - **Men**: $D = 1.0324 - 0.19077 \cdot \log_{10}(\text{waist} - \text{neck}) + 0.15456 \cdot \log_{10}(\text{height})$
       - **Women**: $D = 1.29579 - 0.35004 \cdot \log_{10}(\text{waist} + \text{hip} - \text{neck}) + 0.22100 \cdot \log_{10}(\text{height})$
     - Apply Siri's equation: $\text{Body Fat } \% = \frac{495}{D} - 450$.
     - Include strict anatomical guards (returning `null` if waist $\le$ neck for men, waist + hip $\le$ neck for women, non-positive dimensions, or missing hip for women).
     - Clamp output to realistic physiological bounds $[2.0\%, 70.0\%]$ rounded to 1 decimal place.
  2. **Dual-Curve Bodyweight Longitudinal Smoothing Engine (`navyBodyFat.ts`)**:
     - **Calendar-Aware 7-Day SMA (`calculate7DaySMA`)**: Groups and averages multi-log days, then for each logged date $D_i$ computes the arithmetic mean over the inclusive 7-calendar-day window $[D_i - 6\text{ days}, D_i]$. This gracefully accommodates intermittent logging schedules (e.g. 3–4 days/week) without artificial synthetic point interpolation.
     - **Exponential Moving Average (`calculate7DayEMA`)**: Implements step-wise smoothing with $\alpha = \frac{2}{N + 1} = 0.25$ for $N=7$ ($\text{EMA}_t = \alpha \cdot w_t + (1 - \alpha) \cdot \text{EMA}_{t-1}$).
     - **Unified Pipeline (`calculateBodyweightRollingAverages`)**: Emits `RollingAveragePoint` objects containing raw weight, `sma7`, and `ema7` for presentation in Phase 5.2 plots.
  3. **Automatic Profile Resolution in `SQLiteBodyMetricsRepository` & `MockBodyMetricsRepository`**:
     - Domain interface `IBodyMetricsRepository` accepts an optional `profileOverride?: BodyMetricProfileContext`.
     - When `save()` is called without an explicit `navy_body_fat`, the repository automatically checks `profileOverride`; if missing, it queries `SELECT gender, height_cm FROM user_profiles ORDER BY updated_at DESC LIMIT 1;`.
     - If both `gender` and `height_cm` are resolved and required circumference metrics are present, `navy_body_fat` is automatically calculated and persisted to SQLite `body_metrics.navy_body_fat`.
- **Consequences**:
  - *Pros*:
    - 100% scientifically accurate metric U.S. Navy body fat estimation adhering to Department of Defense and Siri standards.
    - Zero redundant manual input: athletes do not need to re-enter height or gender when logging daily body measurements.
    - Seamless support for both calendar-window SMA and exponential EMA smoothing for longitudinal progression charts.
    - Full test coverage across both in-memory mocks and SQLite drivers (618 passing mobile tests total).
---

## ADR-042: Longitudinal Visualization Suite, Meso-Cycle Program Era Shading & Unit-Aware Anthropometry Logging
- **Context**:
  Athletes need to visualize multi-month progression across strength (estimated 1RM), body composition (bodyweight with 7-day smoothing, body fat %), anatomical muscle circumferences (waist, arms, chest, thighs, calves), and weekly training volume tonnage.
  Crucially, athletes want to correlate their physical progress with specific training splits and meso-cycle phases (e.g. "Did my bench press and chest circumference jump during the PPL meso-cycle or the Upper/Lower strength phase?").
  Furthermore, user preferences dictate that athletes logging tape measurements in imperial mode (`lbs`) expect to read and write in inches, while metric users expect centimeters, while the database persists canonically in centimeters and kilograms (ADR-008).
- **Decision**:
  1. **Reusable SVG Time-Series Chart Wrapper with Program Era Shading (`ProgramEraShadedChart.tsx`)**:
     - Built natively with `react-native-svg` to ensure zero pixelation and consistent layout scaling on mobile screens.
     - Calculates horizontal gridlines and Y-axis tick values from data min/max with neat rounding.
     - Maps timestamps chronologically onto the X-axis pixel width using linear interpolation.
     - Renders semi-transparent vertical background spans (`opacity: 0.18`) corresponding to historical and active `program_blocks`, tinted using each program's distinctive `color_hex`.
     - Supports both multi-line continuous time-series (`ChartSeries` with line paths and circular node markers) and discrete weekly volume bar histograms (`ChartBarPoint`).
     - Interactive point selection displaying a tooltip callout with exact date, formatted value, and era name.
  2. **5-Tab Longitudinal Analytics Suite (`PlotsScreen.tsx`)**:
     - **Tab 1: 1RM Progression**: Filters completed workouts for compound movements, evaluates session peak estimated 1RM using the Lombardi power law ($w \cdot r_{\text{eff}}^k$) with RPE/RIR proximity to failure, and provides a 1-tap compound lift picker (`Squat`, `Bench Press`, `Deadlift`, `Overhead Press`, `Barbell Row`).
     - **Tab 2: Bodyweight Trend**: Renders dual smoothed trendlines: 7-day simple moving average (SMA) and exponential moving average (EMA $\alpha=0.25$) over raw weigh-ins.
     - **Tab 3: Body Fat %**: Displays U.S. Navy DoD metric body fat curve with comparison against manual DEXA/caliper entries.
     - **Tab 4: Circumferences**: Segmented picker for anatomical tape measurement sites (`Waist`, `Neck`, `Hips`, `Biceps`, `Chest`, `Thighs`, `Calves`) with automatic conversion between inches and cm.
     - **Tab 5: Weekly Volume**: Monday-bucketed volume bar chart accumulating tonnage ($w \times \text{reps}$) exclusively from working sets (`working`, `drop`, `myorep`, `dc`), excluding warmups, with 4-week rolling average line and peak week indicator.
  3. **Unit-Aware Anthropometry Logging (`BodyMetricsScreen.tsx`)**:
     - Automatically adapts input placeholders and labels based on `userSettingsRepo.get('unit_system')` (inches and lbs vs cm and kg).
     - Performs real-time bidirectional conversion: converts entered inches to cm via `inchesToCm` before persisting to SQLite (ADR-008), and displays history in inches via `formatLength` and `cmToInches`.
     - Live Navy body fat recalculation badge that dynamically responds as the user types waist, neck, and hip measurements.
     - 7-day rolling average summary card showing the athlete's current rolling average weight and 7-day delta.
     - Historical entry cards with 1-tap delete confirmation.
  4. **HomeScreen Integration & Ergonomic Access**:
     - Inline embedding in `HomeScreen`'s bottom section providing immediate at-a-glance performance inspection without leaving the home dashboard.
     - Dedicated modal view accessible via "Expand Charts" button on Home and "Body Metrics & Composition" button in Profile demographics card.
- **Consequences**:
  - *Pros*:
    - High-performance, zero external graphing library bloat (pure `react-native-svg`).
    - Clear visual feedback linking training splits (color-coded eras) to physical adaptations and strength gains.
    - Full fidelity unit conversion respecting ADR-008 canonical database storage.
    - Zero type errors and 100% test coverage across all calculations, unit conversions, and chart data mappings (644 passing tests across 49 test suites).
  - *Cons*:
    - Requires charting computations to execute in JS thread (optimized via `useCallback` and `useMemo`).

---

## ADR-043: Athlete Questionnaire Consolidation, Profile Accordion Architecture & Radar Presentation Formatting
- **Context**:
  1. The athlete questionnaire and psychological preference form was previously rendered in two separate surfaces: expanded permanently in full across the Profile tab, and accessible via a full-screen modal launched from the Settings tab.
  2. Having the entire questionnaire permanently expanded on the Profile screen created significant cognitive friction and visual clutter when lifters accessed their profile simply to view or swap their active training program, inspect gear, or review body metrics.
  3. Redundant access in Settings blurred the separation of concerns between operational app mechanics (Settings: units, imports, exports, exercise catalog) and athlete identity / program synthesis (Profile).
  4. In the SBD Strength Balance Radar view (`SBDBalanceRadarChart.tsx`), educational guidance for symmetry balance contained a raw LaTeX string (`$\ge 8.0$`), appearing unrendered as literal code in React Native text.
- **Decision**:
  1. **Consolidate Questionnaire Exclusively to Profile**:
     - Remove the "Athlete Questionnaire & Profile" card and full-screen modal from `SettingsScreen.tsx`. Keep Settings focused strictly on gym mechanics, utilities, exercise catalog, imports, and backups.
     - Rename the Settings section from `TRAINING PSYCHOLOGY & PROGRAMS` to `TRAINING PROGRAMS & PROGRESSION`.
  2. **Collapsible Accordion in UserProfileScreen**:
     - Wrap Sections 1 through 4 (Demographics, Mentality, Goals, Schedule & Equipment) and program synthesis action buttons inside a collapsible accordion card.
     - Accordion starts collapsed by default (`initialQuestionnaireExpanded: false`), displaying a high-contrast OLED header card with a summary of active preferences (e.g., `MALE • PRECISION • HYPERTROPHY • 4D/WK • 60M`), expand/collapse toggle chevrons (`▼` / `▲`), and accessible toggle button.
     - When expanded, reveals the complete questionnaire form and actions cleanly.
  3. **Radar Text Typography Fix**:
     - Replace raw LaTeX syntax `$\ge 8.0$` with native Unicode character `≥ 8.0` in `SBDBalanceRadarChart.tsx`.
- **Consequences**:
  - *Pros*:
    - Streamlined navigation and zero redundancy across tabs.
    - Profile tab loads cleanly without overwhelming scroll length, prioritizing active program inspection while keeping preference edits 1 tap away.
    - Pristine mobile typography without unparsed LaTeX artifacts.
    - Verified by 647 unit tests across 49 test suites with zero TypeScript errors.
  - *Cons*:
    - Lifters editing questionnaire preferences must tap the accordion card to expand the form fields.

---

## ADR-044: Tier 2 Adaptive Linear Kalman Filter Engine for Individualized 1RM and Endurance Modeling
- **Context**:
  1. Lifters exhibit significant variation in repetition endurance ($k$) across movements. Squats frequently exhibit greater rep stamina ($k \approx 0.095$) than bench press ($k \approx 0.085$) or deadlifts ($k \approx 0.075$).
  2. While the mobile app uses a fast heuristic (Tier 1: Lombardi power law $w \cdot r_{\text{eff}}^{0.10}$), accurate long-term strength and fatigue modeling requires estimating individualized $(1\text{RM}_t, k_t)$ in the Companion Suite (Tier 2).
  3. High-repetition sets (>10–12 reps) introduce substantial non-linear variance due to peripheral and cardiovascular exhaustion, which must not disproportionately distort 1RM tracking.
  4. True 1RM testing ($r_{\text{eff}} = 1.0$) measures pure strength and should not perturb the endurance exponent $k$.
  5. In empirical literature, static linear formulas often apply a +10% heuristic scalar to deadlifts, but Tier 2 models fatigue kinetics natively.
- **Decision**:
  1. **State-Space Formulation**:
     - State vector: $\mathbf{x}_t = [\ln(1\text{RM}_t), k_t]^T$.
     - Observation: $z_t = \ln(w_t)$ with observation matrix $\mathbf{H}_t = [1.0, -\ln(r_{\text{eff}, t})]$.
     - Discrete state transition: $\mathbf{x}_{t|t-1} = \mathbf{x}_{t-1}$, $\mathbf{P}_{t|t-1} = \mathbf{P}_{t-1} + \mathbf{Q}$.
  2. **Noise Modeling**:
     - Quadratic measurement variance: $R_t = \sigma_{\text{base}}^2 (1 + \lambda r_{\text{eff}, t}^2)$ with $\sigma_{\text{base}} = 0.025$ and $\lambda = 0.015$, naturally discounting high-rep sets.
     - Diagonal process noise: $\mathbf{Q} = \text{diag}([10^{-4}, 10^{-6}])$, reflecting that maximal strength drifts dynamically while endurance slope $k$ is biological and relatively stationary.
  3. **Intra-Session Filtering**:
     - Ingest only the top 2 sets with lowest RIR per exercise per session.
     - Break ties among lowest RIR sets by selecting the highest loads.
     - Discard sets with $\text{RIR} > 3.0$ (or $\text{RPE} < 7.0$), warm-up sets, and failed sets ($\text{reps} \le 0$).
  4. **Priors and Stability Corridor**:
     - Seed exercise-specific priors: Bench $k_0 = 0.085$, Squat $k_0 = 0.095$, Deadlift $k_0 = 0.075$, Default $k_0 = 0.10$ with $\mathbf{P}_0 = \text{diag}([0.04, 0.002])$.
     - Enforce operational heuristic stability boundary: $k_t \in [0.03, 0.16]$ box-clipping.
     - Invariant (ADR-026): Strictly zero +10% heuristic scalar applied to deadlift Kalman state.
  5. **True 1RM Test Bypassing**:
     - When $r_{\text{eff}} = 1.0$, $\ln(r_{\text{eff}}) = 0.0 \implies \mathbf{H} = [1.0, 0.0]$. With diagonal or zero cross-covariance, Kalman gain $K_1 = 0$, mathematically bypassing $k$ updates and updating only $1\text{RM}$.
- **Consequences**:
  - *Pros*:
    - Mathematically rigorous, individualized $(1\text{RM}, k)$ tracking without arbitrary manual tuning.
    - Zero drift from warmup sets or high-rep burnout.
    - Full round-trip integration with Pydantic v2 `CalibratedParameter` models.
    - Verified by 13 unit tests in pytest (22/22 companion tests passing) and strict mypy verification.
  - *Cons*:
    - Requires at least a few submaximal sets near failure ($\text{RIR} \le 3$) to calibrate $k$ away from prior $k_0$.

---

## ADR-045: Dynamic Recoverability Scaling, Banister Impulse-Response Engine, and ACWR Workload Thresholds
- **Context**:
  1. Standard Banister two-component models assume static decay constants ($\tau_1 \approx 42$ days, $\tau_2 \approx 11$ days). In human physiology, an athlete's recovery capacity varies significantly depending on energy balance (caloric surplus accelerates recovery, deficit impairs recovery).
  2. Raw volume metrics (sets $\times$ reps $\times$ load) overestimate the fatigue impact of submaximal warmup sets while underestimating high-exertion compound sets near failure.
  3. Actionable training recommendations require tracking acute fatigue accumulation against chronic workload tolerance (Acute:Chronic Workload Ratio, ACWR) to detect injury and non-functional overreaching risks.
- **Decision**:
  1. **Dynamic Recoverability ($\Delta BW / \Delta t$)**:
     - Compute the 14-day rolling OLS linear regression slope of bodyweight: $\beta = \text{polyfit}(t, BW, 1)[0]$ in kg/day, scaled to weekly slope $\Delta BW / \Delta t = \beta \times 7.0$ kg/week.
     - Caloric surplus ($\Delta BW / \Delta t \ge +0.10$ kg/week): Shorten $\tau_2$ dynamically by 10% to 25% (multiplier $0.90 \rightarrow 0.75$).
     - Caloric deficit ($\Delta BW / \Delta t \le -0.10$ kg/week): Lengthen $\tau_2$ dynamically by 15% to 30% (multiplier $1.15 \rightarrow 1.30$).
     - Maintenance / Insufficient data (<2 points in 14d): Keep baseline $\tau_2 = 11.0$ days (multiplier 1.0).
  2. **Effective Stimulating Sets & Stimulus Quantification**:
     - Sets with $\text{RPE} < 7.0$ ($\text{RIR} > 3.0$), warmups, and failed reps contribute 0 effective stimulus.
     - Stimulating sets are weighted by relative load and exertion proximity:
       $$\text{Stimulus}_{\text{set}} = \left(1.0 + \frac{\text{eff\_rpe} - 7.0}{3.0}\right) \times \frac{\text{weight}}{1\text{RM}}$$
     - 1RM is resolved from the exercise's Kalman filter estimate or Lombardi fallback ($w \cdot r_{\text{eff}}^{0.10}$).
  3. **Banister Impulse-Response Integration**:
     - Discretely integrate daily Fitness ($P_t = P_{t-1} e^{-1/\tau_1} + S_t$) and Fatigue ($F_t = F_{t-1} e^{-1/\tau_2(t)} + S_t$) over a continuous calendar timeline.
     - Net Preparedness: $\text{Preparedness}_t = k_1 P_t - k_2 F_t$ with $k_1 = 1.0, k_2 = 2.0$.
  4. **ACWR & Structured Training Advisories**:
     - $\text{ACWR} = \frac{\text{Acute Workload (7-day rolling mean)}}{\text{Chronic Workload (28-day rolling mean)}}$.
     - `DELOAD_WARNING`: Triggered when $\text{ACWR} > 1.50$ (or acute fatigue $>2\times$ fitness with severe negative preparedness). Recommends 1-week deload (-30% volume, -10% load).
     - `UNDER_STIMULATION`: Triggered when $\text{ACWR} < 0.80$. Recommends +20% volume (+1–2 sets per muscle group).
     - `OPTIMAL_OVERLOAD`: Triggered when $0.80 \le \text{ACWR} \le 1.30$ and $\text{Preparedness} \ge 0.0$. Recommends +2.5% load or +1 rep on key lifts.
     - `OVERREACHING`: Triggered when $1.30 < \text{ACWR} \le 1.50$. Recommends holding volume steady.
- **Consequences**:
  - *Pros*:
    - Physiologically sound, energy-balance-aware fatigue tracking.
    - Zero arbitrary static deload schedules; deloads are triggered dynamically by actual workload spikes and fatigue accumulation.
    - 100% test coverage with 13 unit tests in `test_banister.py` and strict typing across all models.
  - *Cons*:
    - Requires regular bodyweight logs (at least 2 entries per 14-day window) to activate dynamic recoverability scaling; defaults gracefully to baseline when data is sparse.

## ADR-046: Multi-Format Historical Ingestion Engine (StrengthLog & Liftosaur), SQLite Batch Optimization, and Expo Go Evaluation Presets
- **Context**:
  1. Users have historical training exports spanning several years from other workout logging apps (`Liftosaur`, `StrengthLog`), including training sessions and longitudinal anthropometry/body composition.
  2. Liftosaur exports CSV files containing routine template structures where unperformed sets are included as empty rows (`Completed Reps`, `Completed Weight Value`, `Completed Reps Time` blank). Importing these unperformed rows corrupts volume, PRs, and completion metrics with spurious 0-rep / 0-kg sets.
  3. StrengthLog splits exports into a training CSV (`workout,start,end,exercise,specialset,weight,bodyweight,extraWeight,distanceKM,reps...`) with Unix epoch millisecond timestamps and planned/unchecked set markers (`checked === '0'`), and a body composition CSV (`type,timestamp,value,unit`) with longitudinal scale weights, body fat percentages, and tape measurements.
  4. Testing historical data import inside mobile simulators or physical devices using Expo Go can be cumbersome when relying solely on the device's native document picker. Furthermore, importing 3,000+ historical sets via sequential SQLite queries causes noticeable UI latency without transaction batching.
- **Decision**:
  1. **Zero-Dependency RFC 4180 Parser Extensions (`csvImportParser.ts`)**:
     - Added format auto-detection signatures for `liftosaur` (`workout_datetime`, `program`, `day_name`, `completed_reps`) and `strengthlog` (`workout`, `specialset`, `extraweight`, `checked`).
     - Added specialized `parseStrengthLogBodyCompCsv` parser for anthropometric records (`bodyweight`, `body-comp` body fat %, and circumferences for waist, neck, hips, chest, biceps, thighs, calves).
     - Trimmed leading/trailing underscores in normalized headers to properly match punctuation-terminated headers (e.g. `Is Warmup Set?` $\rightarrow$ `is_warmup_set`).
     - Handled epoch milliseconds (`1711728000000`) and ISO-8601 strings uniformly via `parseDateString`.
     - Filtered unperformed planned sets in Liftosaur (`!compRepsStr && (!compTimeStr || !compWeightStr)`) and StrengthLog (`checked === '0'` with `reps === '0'`).
  2. **SQLite Batch Insertion Optimization (`SQLiteWorkoutRepository.ts`)**:
     - Wrapped `saveSets(sets)` batch operations in explicit SQLite transactions (`BEGIN TRANSACTION` / `COMMIT`, with `ROLLBACK` on exception).
     - Reduced disk I/O fsync overhead from $O(N)$ sequential transactions to 1 single transaction, delivering a ~100x speedup for 1,000–4,000 set imports.
  3. **Dual Ingestion Routing & Body Metrics Ingestion (`importService.ts`)**:
     - Extended `ImportService` with `IBodyMetricsRepository` injection.
     - Automatically routes StrengthLog body comp CSVs to `bodyMetricsRepo.logMeasurement` and `logBodyweight`, tagging sources with `imported_from = 'strengthlog'`.
     - Added interactive date range filtering (`filterPreviewByDateRange`) on the preview wizard to allow users to constrain imports to any timeframe (e.g. last 3 months).
  4. **1-Tap Expo Go Evaluation Presets (`dummyDataPresets.ts`, `ImportScreen.tsx`)**:
     - Bundled historical evaluation datasets directly in the mobile codebase:
       - **Preset 1 ("Last 3 Months")**: Focused evaluation subset containing workouts and body metrics from the most recent 90 days.
       - **Preset 2 ("All Time - Full History")**: Complete multi-year historical archive (3,000+ sets across Liftosaur and StrengthLog).
     - Added high-visibility 1-tap "Load Evaluation Dummy Data" cards on `ImportScreen.tsx` allowing instantaneous testing in Expo Go without needing external file sharing.
- **Consequences**:
  - *Pros*:
    - Flawless, zero-overhead testing on Expo Go without requiring device file transfer or copy-pasting.
    - Full preservation of bodyweight and body composition history directly feeding the Longitudinal Plots screen, DoD Navy body fat calculations, and Companion Banister recoverability engine.
    - Zero data corruption from skipped/unperformed template sets.
    - 100% test coverage across all 49 mobile test suites (661 tests) and verified zero TypeScript errors (`npx tsc --noEmit`).

---

## ADR-041: UI Render Optimization, SQLite Keystroke Debouncing & Timer Lifecycle Isolation
- **Context**:
  1. Comprehensive audit of mobile architecture identified three critical performance bottlenecks:
     - **Keystroke Write-Through Churn**: In `SetRowComponent.tsx`, text inputs for weight, reps, intensity, and notes triggered `onUpdateSet` on every `onChangeText` event. Each keystroke invoked `ActiveSessionService.updateSet`, performing 2 SQLite `SELECT` queries and 1 SQLite `UPDATE` per character typed (e.g. typing "100" fired 9 database operations and 6 full component tree re-renders).
     - **Root-Level 1-Second Timer Storm**: `ActiveLoggerScreen.tsx` maintained an `elapsedDurationText` state string updating every 1,000ms via `setInterval`. Because `SetRowComponent` and `SupersetBracketGroup` were not memoized and received inline callback closures, every active set row across the workout re-rendered every single second.
     - **Redundant Exercise & Gear Disk Queries**: On every set modification, `ActiveSessionService.updateSet` re-queried the exercise catalog and gear inventory tables from SQLite even though metadata is static during active sessions.
     - **Background Resiliency**: `RestTimerService` used wall-clock comparison (`endTimeMs - Date.now()`) to prevent timer drift, but lacked an explicit `AppState` listener hook to refresh state immediately upon returning from the OS background.
     - **Dual-Repository Testing Overhead**: 7 mock repositories and 7 mock test files were maintained alongside SQLite implementations because `MockSQLiteDatabase.ts` is only a query pattern matcher rather than a full SQL engine.
- **Decision**:
  1. **Input Debouncing & Draft State Buffering (`SetRowComponent.tsx`)**:
     - Introduced local draft string buffers (`weightInput`, `repsInput`, `repsRightInput`, `intensityInput`, `notesText`).
     - Added a 350ms debounce queue (`queueUpdate` / `pendingUpdatesRef`) that batches rapid typing into a single update.
     - Added guaranteed synchronous flushes (`flushPendingUpdates`) on input `onBlur`, steppers, set-type cycling, ghost copying, intensity clearing, and component unmount.
  2. **Isolated Duration Clock & Component Memoization (`ActiveLoggerScreen.tsx`, `SetRowComponent.tsx`, `SupersetBracketGroup.tsx`)**:
     - Extracted elapsed session duration ticking out of `ActiveLoggerScreen` root state into an isolated, memoized `<WorkoutDurationTicker startedAt={...} />` component.
     - Extracted a pure helper `formatElapsedDuration(startedAt)` for modal summaries.
     - Wrapped `SetRowComponent` in `React.memo` with a custom shallow comparator matching on `set`, `exercise`, `ghostSet`, `unitSystem`, `intensityMetric`, `isCompleted`, and `isExpanded`.
     - Wrapped `SupersetBracketGroup` in `React.memo`.
     - Memoized `handleUpdateSet` with `useCallback`.
  3. **In-Memory Catalog Caching (`ActiveSessionService.ts`)**:
     - Added `exerciseCache` and `gearCache` Maps inside `ActiveSessionService` to eliminate redundant database reads during set updates.
  4. **AppState Wall-Clock Re-synchronization (`RestTimerService.ts`, `ActiveLoggerScreen.tsx`)**:
     - Added `syncWithWallClock()` method to `RestTimerService`.
     - Attached React Native `AppState` event listener in `ActiveLoggerScreen` to immediately trigger `syncWithWallClock()` when the app transitions from `background` $\rightarrow$ `active`.
  5. **List Virtualization (`ExerciseLibraryScreen.tsx`, `CalendarScreen.tsx`)**:
     - Converted `CalendarScreen.tsx` day agenda from `ScrollView` to `FlatList`.
     - Memoized `renderItem` in `ExerciseLibraryScreen.tsx` with `useCallback` and added virtualization props (`initialNumToRender={15}`, `maxToRenderPerBatch={15}`, `windowSize={7}`, `removeClippedSubviews={true}`).
  6. **Repository Mock Consolidation Roadmap**:
     - Clarified that in-memory mock repositories are retained for rapid (<5s) headless Jest testing without native C binary dependencies. Documented Phase 7 path to replace mock classes with an in-memory SQLite driver adapter (e.g. `better-sqlite3`).
- **Consequences**:
  - *Pros*:
    - Typing a 3-digit weight or reps count reduces database operations from 9 to 1, eliminating mobile input latency and keyboard frame drops.
    - Zero re-render cascading on the 1-second clock; `ActiveLoggerScreen` remains completely idle between athlete interactions.
    - Returning to the app from background instantly syncs rest timers and workout elapsed clocks.
    - 100% test pass rate across all 51 test suites (676 tests).
  - *Cons*:
    - Keystroke updates are held in memory for 350ms before writing to disk if the input is not explicitly blurred (safeguarded by unmount flush and blur handlers).

---

## ADR-042: Pre-Phase 7 Schema Synchronization, Sync Outbox Strategy, and Bundle Optimization
- **Context**:
  A rigorous architectural and contract audit prior to Phase 7 (Supabase Cloud Migration) surfaced several structural risks and schema drifts:
  1. **Direct Swap to Supabase Trap (`ARCHITECTURE.md` Section 5.3)**:
     - The architecture doc suggested swapping `SQLiteWorkoutRepository` with `SupabaseWorkoutRepository` in Phase 7. In basement gym environments with spotty or nonexistent cellular reception, awaiting network roundtrips during set check-offs (`CrashRecoveryService` write-through) would destroy the offline-first zero-latency guarantee.
  2. **Migration Fall-Through & Unwrapped Transactions (`schema.ts`)**:
     - Database migrations used `if (currentVersion < 1) { ... } else if (currentVersion < 2) { ... }`. Using `else if` prevented multi-step migrations from chaining in a single pass (e.g. an upgrade from v1 $\rightarrow$ v3 skipped v2 until next launch).
     - Initial seeding loops executed $N$ separate auto-committing `runAsync` statements outside an explicit transaction, causing UI freezes on cold boot.
     - Migration v2 attempted an invalid SQL update: `WHERE training_enjoyment = 'minimalist'` on `user_profiles`, which caused execution failures if reached.
  3. **Foreign Key Deletion Constraint Crash**:
     - `template_exercises.exercise_id` and `workout_sets.exercise_id` lacked explicit `ON DELETE` clauses, defaulting to `RESTRICT` under `PRAGMA foreign_keys = ON;`. Deleting a custom exercise referenced by any template or set triggered unhandled SQLite constraint exceptions.
  4. **Schema Drift across SQLite, JSON Contracts & Python Companion**:
     - `calibrated_params` omitted posterior error covariance diagonal elements `cov_p00` and `cov_p11`, which are required by the Kalman filter in Companion to resume incremental estimation without recomputing history from $t=0$.
     - `workout_export.schema.json` omitted `calibrated_params` entirely.
     - `calibrated_parameters.schema.json` contained polymorphic `oneOf` branching (bare array vs. envelope object), burdening both TypeScript and Python deserializers.
     - `body_metrics` lacked the `imported_from` provenance column claimed in `ARCHITECTURE.md` Section 4.3.
     - `user_profiles` retained dead column `intensity_style` in SQLite, not present in JSON contracts.
     - `workout_sets` indexed `exercise_id` and `workout_id` separately, forcing table scans or joins when resolving ghost sets (`exercise_id, created_at DESC`).
  5. **Production Bundle Bloat**:
     - `mobile/src/database/index.ts` re-exported `./mocks`, bundling all 7 mock repository classes into production binaries.
     - `dummyDataPresets.ts` (~700 KB of raw CSV text) was bundled unconditionally into production builds.
     - SQLite schema declared a `strength_standards` table that was never seeded or queried (static mathematical lookup tables already existed in `mobile/src/core/math/strengthStandards.ts`).
- **Decision**:
  1. **Architectural Invariant Reaffirmation (`ARCHITECTURE.md`)**:
     - Explicitly codified that local embedded SQLite remains the sole data source for UI components, custom hooks, and active workout sessions.
     - Phase 7 cloud synchronization is designated to an asynchronous background **Sync Engine & Outbox Service** (`SyncEngine`) that queues local mutations and syncs with Supabase PostgreSQL without blocking user interactions.
  2. **SQLite Migration Framework Hardening (`schema.ts`)**:
     - Bumped `CURRENT_SCHEMA_VERSION = 3`.
     - Wrapped initial database setup, default seeds, and sequential version migrations inside explicit `BEGIN TRANSACTION; ... COMMIT;` blocks with `ROLLBACK;` on error.
     - Replaced `else if` branching with independent sequential `if (currentVersion < X)` blocks.
     - Configured explicit foreign key behaviors: `template_exercises.exercise_id ON DELETE CASCADE` and `workout_sets.exercise_id ON DELETE RESTRICT`.
     - Replaced single-column index with composite `idx_workout_sets_ex_created ON workout_sets(exercise_id, created_at DESC)`.
  3. **Cross-Stack Schema Synchronization (`schema.ts`, `schemas/`, `companion/`)**:
     - Added `cov_p00 REAL NOT NULL DEFAULT 0.0` and `cov_p11 REAL NOT NULL DEFAULT 0.0` to `calibrated_params` across SQLite, `mobile/src/core/types/index.ts`, `schemas/workout_export.schema.json`, and `companion/src/ingestion/schemas.py`.
     - Added `calibrated_params` to `WorkoutExportPayload`, serialized in `ExportService.ts` and ingested by Companion.
     - Locked `calibrated_parameters.schema.json` strictly to the versioned envelope object `{ version, exported_at, parameters }`, removing `oneOf` polymorphism.
     - Added `imported_from TEXT` to `body_metrics` table, types, repository (`SQLiteBodyMetricsRepository.ts`), CSV import parser (`csvImportParser.ts`), export service, and Pydantic schema (`BodyMetric`).
     - Dropped dead column `intensity_style` from `user_profiles` and removed the erroneous `WHERE training_enjoyment` statement.
     - Dropped unused `strength_standards` SQLite table from DDL and reset routines.
  4. **Tree-Shaking & Bundle Optimization**:
     - Removed `export * from './mocks';` from `mobile/src/database/index.ts`. Mocks are imported directly from `src/database/mocks` only inside `*.test.ts` files.
     - Gated `dummyDataPresets.ts` evaluation UI cards in `ImportScreen.tsx` behind `__DEV__ || process.env.NODE_ENV !== 'production'`.
- **Consequences**:
  - *Pros*:
    - Migration pipeline cleanly chains multi-version transitions (v1 $\rightarrow$ v2 $\rightarrow$ v3) in a single cold boot.
    - Batch seeding executes inside a single transaction, preventing cold-boot UI freezes.
    - Zero production leakage of mock repository classes or 700 KB evaluation CSV strings.
    - Kalman filter covariance parameters are persisted and synchronized across mobile and companion, enabling true incremental state estimation.
    - Deleting custom exercises cascades cleanly to templates and fails gracefully on existing workout sets.
    - 100% test pass rate maintained: 51/51 mobile test suites (678 tests), 0 TypeScript errors, 35/35 pytest tests, 0 mypy errors across 8 Python files.
  - *Cons*:
    - Schema version bumped to 3; existing dev databases must execute migration v3 or reset.

---

## ADR-043: Dynamic Monotonic Upper Envelope for Rep-Max PR Records
- **Context**:
  - In longitudinal strength training, empirical PR boards occasionally exhibit non-monotonic artifacts where an older set at repetition count $r_a$ (e.g., 40 kg × 20 reps) remains logged, while subsequent progression establishes a higher load at a greater repetition count $r_b > r_a$ (e.g., 62.5 kg × 21 reps).
  - From a physical and mathematical standpoint, lifting 62.5 kg for 21 reps proves the athlete possesses the capacity to lift at least 62.5 kg for 20 reps (as well as 1..19 reps).
  - Two architectural options were evaluated to resolve this non-monotonicity:
    1. **Option B (Hard Deletion/Pruning of Dominated Sets in SQLite)**: Permanently deleting the 40 kg × 20 set from `workout_sets`.
       - *Companion Impact*: **Catastrophic model degradation**. Deleting historical sets erases past session volume and training impulse (TRIMP), corrupting Banister acute and chronic fatigue calculations ($P(t), F(t), \text{ACWR}$). It also removes valid observation points from the Kalman filter, artificially inflating error covariance $P_t$.
    2. **Option A (Dynamic Monotonic Upper Envelope at Query/Display Layer)**: Preserving all raw database sets and computing the reverse running maximum at query time:
       $$M(r) = \max_{k \ge r} W_k$$
- **Decision**:
  - Adopt **Option A**: Implement pure mathematical function `applyMonotonicUpperEnvelope` in `mobile/src/core/math/repMaxEnvelope.ts`, called within `ExerciseInspectionService.getPRBoard`.
  - Raw SQLite tables and JSON export payloads remain 100% authentic and un-mutated.
  - Enveloped records are enriched with metadata:
    - `weightKg = M(r)` (e.g., 62.5 kg).
    - `isEnveloped = true`.
    - `derivedFromReps` identifies the source rep performance (e.g., 21).
    - `originalWeightKg` preserves the direct empirical set load (e.g., 40 kg).
    - `workoutId`, `setId`, `setDate` point to the session proving the capacity, ensuring tap-to-drilldown routes to the authentic performance.
  - In `PRBoardTable.tsx`, enveloped records render a distinct sky-blue pill badge (`↑ 21RM`) and include educational subtext.
- **Consequences**:
  - *Pros*:
    - Guarantees strict monotonicity: $r_a \le r_b \implies M(r_a) \ge M(r_b)$ across all exercises and variant families.
    - Zero distortion or loss of training history for the Companion data science suite.
    - Full transparency in the UI: lifters see their effective PR and can inspect both the deriving workout and original logged attempt.
  - *Cons*:
    - Requires a negligible $O(N)$ right-to-left sweep across PR rows ($N \le 30$, $<0.1\text{ ms}$).




















