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




