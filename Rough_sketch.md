# Workout Suite — Comprehensive Concept & Requirements Specification

## 1. Core Vision & System Architecture

The **Workout Suite** is a two-part ecosystem designed for serious resistance training:
1. **Mobile Workout Tracker (iOS & Android)**: A clean, lightning-fast, offline-first mobile application for logging workouts in the gym, managing training programs, tracking body composition, and visualizing progress.
2. **Companion Analysis Suite (Desktop / Web)**: An advanced data science companion program that ingests exported workout data to model fatigue, adaptation, recoverability, and true strength progression, providing scientific recommendations for progressive overload.

```
┌────────────────────────────────────────────────────────────────────────┐
│                   MOBILE WORKOUT TRACKER (iOS & Android)               │
│  - Offline-first SQLite database                                       │
│  - Active Workout Logger (ghosting, rest timer, RPE/RIR)               │
│  - Calendar, Templates, Progression Builder, Body Metrics (Navy)       │
│  - Instant In-App Heuristic 1RM & Progress Plots                       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Data Export (JSON / Local Sync)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   COMPANION ANALYSIS & STATISTICS SUITE                │
│  - Advanced 1RM Kalman Filter (Adaptive Lombardi Power Law)            │
│  - Banister Fitness-Fatigue Impulse-Response Modeling                  │
│  - Caloric Balance / Dynamic Recoverability Engine (ΔBW / Δt)          │
│  - Actionable Overload & Deload Recommendations                        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Model Parameters & Calibrated k
                                    ▼ (Optional Feedback Sync)
```

---

## 2. Component 1: Mobile Workout Tracker

### 2.1 Interface Principles & Core UX
- **Frictionless In-Gym Logging**: Fast single-tap set completion, clear visual contrast for gym lighting, minimal keyboard toggling.
- **Pure Utility Mode**: Global setting that strips all community feeds, share cards, and gamified prompts for solo lifters who demand an ultra-fast, OLED-black distraction-free training ledger.
- **Offline-First & Local-First**: Zero loading spinners, instant responsiveness with an embedded on-device SQLite database.
- **Cross-Platform**: Full parity across Android and Apple (iOS) devices.

### 2.2 Active Workout Logger
- **Dynamic Set Management**: Add, duplicate, delete, and reorder sets effortlessly.
- **Set Attributes & Mechanics**:
  - `Set Number`
  - `Weight` (stored internally in kg; displayed in the user's preferred unit via settings toggle)
  - `Dumbbell Mechanics`: Configurable `load_mode` ('per_hand' vs 'total'). For dumbbell exercises, entering the single-dumbbell load stamped on the bell (e.g. 30 kg) automatically displays `30 kg (×2)` and doubles to 60 kg in backend analytics for volume and 1RM calculation.
  - `Unilateral Limb Tracking`: Supports independent L/R reps (`reps` for Left, `reps_right` for Right) within a single set row for lunges, split squats, and single-arm movements.
  - `Gear Subtext Indicator`: Subtle, small-font badge under exercise title or weight field when using specialty barbells or custom cable ratios (e.g., `Safety Squat Bar (29 kg)` or `Cable (2:1)`).
  - `Reps Completed`
  - `Intensity Metric`: Rate of Perceived Exertion (RPE 6.0–10.0, half-value increments) or Reps in Reserve (RIR 0.0–4.0, half-value increments), switchable via user settings. Both fields support decimal precision for consistent bidirectional conversion ($\text{RIR} = 10 - \text{RPE}$).
  - `Set Type Tag`: Warmup, Working, Drop Set, Myo-rep, Failure Set.
  - `Set Notes` *(optional)*: Free-text annotation per individual set (e.g., "belt on", "paused rep", "left shoulder tight").
- **Cognitive Offloading via Plate Loading Calculator**:
  - 1-tap popover accessible directly from barbell weight inputs.
  - Calculates exact plate stack distribution (25, 20, 15, 10, 5, 2.5, 1.25 kg) based on selected barbell tare weight (20 kg standard, or specialty bar from Gear Inventory) and available plates.
- **In-Session 1-Tap Exercise Substitution**:
  - Instant exercise swap when equipment is occupied (e.g., squat rack or leg press busy).
  - Surfaces compatible movements via the `parent_exercise_id` variant tree, transfers target rep brackets, pulls ghost values from the substitute movement's historical logs, and prompts: *"Swap for this session only"* (default) or *"Update template permanently"*.
- **Equipment Gear Inventory & Mechanical Ratios**:
  - Manage specialty barbells (15 kg technique bar, 25 kg trap bar, 29 kg SSB) and custom machine cable ratios in Settings.
  - Defaults: 20 kg barbell tare, 1:1 ratio for rows/pulldowns, 2:1 for functional trainers. Users can customize machine ratios and add specialty implements.
- **Superset & Exercise Grouping**:
  - Exercises within a session can be grouped into **supersets**, **giant sets**, or **circuits** via a drag-and-drop grouping UI.
  - Grouped exercises share a visual bracket in the logger view. Checking off a set in one exercise within a group immediately makes the next grouped exercise's input active.
  - Rest timers between grouped exercises are shortened or suppressed (configurable), with the full rest timer triggering only after the final exercise in the group completes its set.
  - Each exercise in a superset group shares a common `exercise_group_id`. Ungrouped exercises have no group assignment.
- **Previous Session Ghosting (Auto-Reference)**:
  - When opening an exercise, automatically display the weight and reps achieved in the **most recent prior session globally** (regardless of the active program block) for that exercise and set number as subtle placeholder values.
  - Allows lifters to instantly know what numbers to beat for progressive overload.
- **Intelligent Rest Timer**:
  - Automatically triggers immediately upon checking off a set.
  - Default rest durations configurable per exercise type (e.g., 180s for heavy compound lifts, 90s for isolation accessories).
  - For superset groups: rest timer is suppressed between grouped exercises and triggers only after the last exercise in the group completes its set.
  - Background notifications with vibration and audio cue on iOS and Android when the timer expires.
  - Quick-adjust buttons (+30s, -30s, Skip).
- **Session Metadata**: Tracks workout start time, duration, total volume load, and optional workout notes.
- **Crash Recovery & Auto-Save**:
  - Every set completion and field edit is persisted to SQLite immediately (write-through).
  - An active workout session is stored with an `in_progress` state. If the app crashes, is force-closed, or the user navigates away, the session is automatically recovered and resumed on the next app launch.
  - The user is prompted with a "Resume interrupted workout?" dialog offering Resume or Discard options.

### 2.3 Exercise Library, Inspection & Routine Management
- **Exercise Database**:
  - Built-in library of primary barbell, dumbbell, cable, and machine exercises categorized by target muscle groups (Chest, Back, Quads, Hamstrings, Shoulders, Arms, Calves, Core).
  - Support for creating custom exercises with custom tags and category classification (Compound vs. Isolation).
- **Exercise Variant Grouping**:
  - Exercises can be linked as **variants** of a parent movement (e.g., "Incline Dumbbell Press" and "Flat Dumbbell Press" are both variants under "Dumbbell Bench Press").
  - Variant grouping enables optional cross-variant analysis in the PR Board and companion suite — e.g., viewing combined e1RM trends across all bench press variants.
  - Each exercise may have at most one `parent_exercise_id` reference. Exercises without a parent are standalone root movements.
- **Exercise Deep-Dive & Rep-Max Record Profile**:
  - Tapping any exercise opens an in-depth inspection view.
  - **Rep-Max Record Table (PR Board)**: Automatically extracts and displays the heaviest load used for each unique completed repetition count (e.g., 1RM, 2RM, 3RM, 4RM, 5RM, 6RM, 8RM, 10RM, 12RM, etc.).
  - **Scope**: Defaults to **all-time** records. A filter toggle allows viewing per-program-block records, scoping the query to sets logged within a specific `program_blocks` date range.
  - **Set e1RM Benchmark**: Next to each unique rep record, displays the calculated estimated 1RM ($w \cdot r_{\text{eff}}^{0.10}$ or calibrated power law) achieved on that specific set. This allows the lifter to instantly analyze which rep-max performance represents their true peak strength capability (e.g., evaluating whether 140 kg × 3 reps yielded a higher e1RM than 120 kg × 8 reps).
  - Includes timestamp, date achieved, logged RPE/RIR, and direct navigation to view the complete historical session.
- **Program & Template Overview**:
  - Create, view, and organize custom workout routines (e.g., Upper/Lower, Push/Pull/Legs, Full Body, 5/3/1).
  - Pre-configure target exercises, set counts, rep brackets, and initial target RPE/RIR.
  - Assign an identifiable **Program Accent Color** (e.g., Blue for Hypertrophy Meso 1, Amber for Strength Peaking).
  - Tap a template to launch an active session with one tap.

### 2.4 Progression Models & Progression Model Builder
The app provides built-in standardized progression schemes and an interactive **Progression Model Builder**:

#### Built-in Progression Schemes
1. **Linear Progression (LP)**: Add a fixed increment (e.g., +2.5 kg / +5 lbs) every session whenever target sets and reps are completed.
2. **Double Progression**: Fix the load and work within a rep bracket (e.g., 3 sets of 8–12 reps). Once all target sets reach the top rep threshold (12 reps), increase weight by a defined step and reset to the bottom threshold (8 reps).
3. **Dynamic Double Progression (DDP)**: Increment weight on individual sets independently as each set hits the top rep target, rather than waiting for all sets to hit it simultaneously.
4. **Autoregulated / RPE-based Progression**: Prescribe load based on target RPE and estimated 1RM lookup tables.

#### Custom "Progression Model Builder"
A visual rule-engine that lets users configure custom progression logic using structured `IF / AND / THEN / ELSE` blocks:
- **Condition Triggers**:
  - `ALL_SETS_HIT_TARGET_REPS` (e.g., completed all sets $\ge 10$ reps).
  - `ANY_SET_HIT_TOP_REP_RANGE` (for individual set progression).
  - `AVERAGE_RPE_LESS_THAN` (e.g., average RPE $\le 8.0$).
  - `CONSECUTIVE_SUCCESSFUL_SESSIONS == N` (e.g., succeeded 2 workouts in a row).
  - `CONSECUTIVE_FAILED_SESSIONS == N` (e.g., missed reps 2 workouts in a row).
- **Action Outcomes**:
  - `INCREASE_LOAD_FIXED(amount)` (e.g., +2.5 kg / +5 lbs).
  - `INCREASE_LOAD_PERCENT(percentage)` (e.g., +2.5%).
  - `DECREASE_LOAD_FIXED(amount)` (e.g., -2.5 kg / -5 lbs).
  - `DECREASE_LOAD_PERCENT(percentage)` (e.g., -5%).
  - `INCREASE_TARGET_REPS(count)` (e.g., +1 rep).
  - `DECREASE_TARGET_REPS(count)` (e.g., -1 rep).
  - `ADD_WORKING_SET(count)` (e.g., +1 set).
  - `REMOVE_WORKING_SET(count)` (e.g., -1 set).
  - `RESET_TO_BASELINE(field)` (resets load or reps to the value defined in the template).
  - `TRIGGER_DELOAD(load_reduction_percent, volume_reduction_percent)` (e.g., -10% load, -30% sets for 1 week).

### 2.5 Calendar View & History
- **Interactive Calendar**:
  - Monthly and weekly agenda views with visual badges indicating days with completed workouts.
  - Color-coded badges based on workout template or volume intensity.
- **Program Transition & Meso-Cycle Cues**:
  - Distinct visual cue on the calendar date when a training program was swapped or initiated (e.g., colored marker badge, accented date border, or ribbon tinted with that program's designated accent color).
  - Allows the lifter to visually segment their training journey into distinct meso-cycles at a glance.
- **Session History & Review**:
  - Tap any past date to inspect logged sets, loads, total volume, duration, and personal notes.
  - Ability to retroactively edit past logs or log missed sessions.

### 2.6 Body Composition & Anthropometric Tracking
- **Logged Metrics**:
  - Bodyweight (daily or weekly entries).
  - Body Fat % (direct manual entry from DEXA, calipers, or bioimpedance).
  - Circumference Measurements: Neck, Waist, and Hips (plus optional tracking for Arms, Chest, Thighs, Calves).
- **7-Day Rolling Average**:
  - Calculates a 7-day moving average of bodyweight to smooth out transient water weight, sodium, and glycogen fluctuations.
- **U.S. Navy Body Fat Estimation**:
  - Automatically calculated whenever Neck, Waist, and Height are logged (plus Hip for females):
  - **Men**:
    $$\text{Body Fat } \% = 86.010 \cdot \log_{10}(\text{waist} - \text{neck}) - 70.041 \cdot \log_{10}(\text{height}) + 36.76$$
  - **Women**:
    $$\text{Body Fat } \% = 163.205 \cdot \log_{10}(\text{waist} + \text{hip} - \text{neck}) - 97.684 \cdot \log_{10}(\text{height}) - 78.387$$
  *(All measurements in cm)*.

### 2.7 In-App Metrics & Plots with Program Block Shading
- **Synchronized Program Color Shading across All Plots**:
  - Each program's designated accent color from the calendar is rendered as a **faded, semi-transparent background band / vertical era span** across the timeline in all historical progression charts.
  - Provides instant visual context connecting performance milestones to specific training programs (e.g., seeing how bodyweight or lift e1RM progressed specifically during "Hypertrophy Block A" vs. "Strength Peaking Block B").
- **Interactive Time-Series Plots**:
  - **Exercise 1RM Trend Line**: Visualizes strength progression per exercise over time, shaded by program era.
  - **Bodyweight & 7-Day Rolling Average Curve**: Line plot displaying weight trajectory over time, with background shading identifying dietary/program phases (bulk, cut, maintenance).
  - **Muscle Circumference Plots**: Tracks changes in waist, arms, chest, thighs, etc., mapped across shaded program eras.
  - **Body Fat Trend**: Comparison between manual inputs and the U.S. Navy formula estimate.
  - **Total Volume Load per Session / per Week**: Bars showing tonnage progression.

### 2.8 Strength Standards & SBD Performance Benchmarking
- **Core Lifts Covered**:
  - Primary "Big 3" (SBD): Barbell Back Squat, Barbell Flat Bench Press, Conventional / Sumo Barbell Deadlift.
  - Extended compounds: Standing Overhead Press (OHP), Barbell Bent-Over Row, Weighted Pull-Up / Dip.
- **Classification Tiers**:
  1. **Untrained**: Little or no formal resistance training (general population baseline).
  2. **Novice**: 3–9 months of consistent training; learned technical fundamentals; built foundational neuromuscular coordination.
  3. **Intermediate**: 1–2+ years of structured progression; substantially stronger than typical gym-goers.
  4. **Advanced**: 3–5+ years of dedicated, periodized training; top ~5% of lifters; near physiological ceiling without specialization.
  5. **Elite**: Top ~1% of drug-free strength athletes; competitive national powerlifting caliber.
- **Mathematical Modeling & Non-linear Bodyweight Scaling**:
  - Simple linear multipliers ($w / \text{BW}$) fail due to the allometric square-cube law (mass scales with volume $\propto L^3$, while muscle cross-sectional area and force scale $\propto L^2$).
  - **Dual Modeling Approach**:
    1. **Tabular Quantile Interpolation**: Normalized benchmark tables derived from empirical strength datasets (ExRx, Symmetric Strength, OpenPowerlifting) stratified by Sex (Male / Female) and Bodyweight (50 kg to 140+ kg).
    2. **Continuous Normalized Strength Score ($0\text{--}100+$)**: Smooth monotonic piecewise scoring function:
       $$\text{Score} = \text{TierBase} + 20 \times \frac{e1RM - 1RM_{\text{lower}}(BW)}{1RM_{\text{upper}}(BW) - 1RM_{\text{lower}}(BW)}$$
       - 0–19: Untrained | 20–39: Novice | 40–59: Intermediate | 60–79: Advanced | 80+: Elite
- **SBD Total & Balance Profiling**:
  - **Powerlifting SBD Total**: Aggregates $e1RM(\text{Squat}) + e1RM(\text{Bench}) + e1RM(\text{Deadlift})$ into a composite strength standard tier.
  - **DOTS Formula Score**: Calculates the official powerlifting relative strength coefficient:
    $$\text{DOTS} = \frac{\text{Total} \times 500}{a \cdot BW^4 + b \cdot BW^3 + c \cdot BW^2 + d \cdot BW + e}$$
  - **Lift Symmetry & Balance Radar**: Visualizes relative strength balance across the Big 3 (e.g., identifies "Squat-dominant", "Bench-lagging", or "Posterior-chain deficient" profiles) to inform targeted programming.
- **In-App Visual Integration**:
  - Displayed prominently in the Exercise Inspection screen (PR Board) and active workout logger when viewing SBD movements.
  - Progress bar illustrating current e1RM within the active tier and the exact kilograms required to unlock the next classification tier.

### 2.9 User Profile, Training Psychology & Goal Architecture
- **Multi-Dimensional Profile Matrix**:
  1. **Training Sentiment / Enjoyment Index**:
     - `Enthusiast ("Loves Training")`: High intrinsic motivation; thrives on high training frequency (4–6 days/week), longer workouts (60–90 min), exercise variety, and accessory volume.
     - `Disciplined / Neutral ("Routine Oriented")`: Views training as a necessary health habit; prefers predictable, balanced 3–4 day programs (45–60 min).
     - `Minimalist / Efficiency-Driven ("Dislikes Training / Busy")`: Training is a chore or time is severely restricted; demands maximum return on investment with minimal gym time (2–3 days/week, 30–45 min); emphasizes strict compound movements, antagonist supersets/circuits, and zero fluff.
  2. **Effort & Intensity Style Preference**:
     - `High Intensity / Low Volume (HIT / Push to Failure)`: Enjoys pushing every working set to maximum exertion (RPE 9.5–10, 0 RIR / failure, rest-pause, myo-reps); prefers fewer total sets (1–2 all-out working sets per exercise); requires longer rest intervals.
     - `Volume Accumulation / Submaximal (RP / Sheiko Style)`: Dislikes technical grinding; prefers leaving 2–3 reps in reserve (RPE 7–8); prefers multiple working sets (3–5 sets); accumulates fatigue progressively with lower single-set neuromuscular stress.
     - `Balanced / Classic`: Standard 3 working sets per exercise at RPE 8 (2 RIR).
  3. **Primary & Secondary Training Goals**:
     - `Strength / Powerlifting`: Maximal 1RM expression on compound lifts; low rep brackets (1–5 reps), long rest periods (3–5 min), neural efficiency focus.
     - `Hypertrophy / Aesthetics ("Look Strong")`: Maximum muscular hypertrophy; moderate rep brackets (6–15 reps), weekly volume landmarks (10–20 sets/muscle group/week), metabolic stress and mind-muscle connection.
     - `Powerbuilding (Hybrid)`: Peak strength on core compounds + high-volume hypertrophy back-off accessories.
     - `Endurance / Work Capacity`: High rep brackets (15–25 reps), short rest periods (<60s), circuit density, cardiovascular conditioning.
     - `Longevity & Joint Health`: Joint-friendly angles, controlled tempos, balanced agonist-antagonist ratios.
  4. **Logistical Constraints**:
     - Available days per week: 2, 3, 4, 5, or 6 days.
     - Available session duration: 30, 45, 60, or 90 minutes.
     - Available equipment: Commercial Gym, Home Barbell Gym, Dumbbells Only, Bodyweight / Calisthenics.

### 2.10 Multi-User Benchmarking & Peer Comparisons
- **Phase 3 (Local-First Demographic Norms)**:
  - Completely private and offline; compares the user's SBD lifts, DOTS score, and volume metrics against curated population distributions (OpenPowerlifting and ExRx empirical cohorts) filtered by sex and bodyweight class.
  - Surfaces actionable percentile placement (e.g., "Your Bench Press ranks in the top 22% of lifters in the 80–85 kg male demographic").
- **Phase 7 (Cloud Backend Social & Peer Comparison)**:
  - **Peer Connections**: Follow friends, share workout summaries, and compare progress asynchronously.
  - **Normalized Strength Leaderboard**: Compares lifters fairly across different weight classes and sexes using DOTS scores and Normalized Strength Scores.
  - **Cohort Matching**: "Compare against lifters with similar profiles" (e.g., comparing strength progression among users who also train 3 days/week with a High-Intensity preference).
  - **Strict Privacy Controls**: Opt-in public leaderboards, friends-only sharing, or 100% private local-only mode.

### 2.11 Profile-Driven Program Generator & Recommender Engine
- Translates the User Profile matrix directly into personalized workout routines and progression rules:
  - **Inputs**: `(enjoyment_index, intensity_style, primary_goal, days_per_week, session_duration, equipment_access, sbd_standards)`.
  - **Recommender Logic**:
    - **Split Selection**: Selects Full Body (2–3 days), Upper/Lower (4 days), or Push/Pull/Legs (3 or 6 days) based on schedule and enjoyment.
    - **Volume & Set Prescription**:
      - If `High Intensity`: Prescribes 1–2 heavy working sets at target RPE 9–10 with Dynamic Double Progression (DDP).
      - If `Volume Accumulator`: Prescribes 3–4 working sets at target RPE 7.5–8.0 with Standard Double Progression.
      - If `Minimalist`: Prescribes antagonist superset pairings (`exercise_group_id`) to compress 6 exercises into a 35-minute window.
    - **Goal Alignment**: Prioritizes low-rep heavy compounds for Strength; adds multi-angle isolation movements for Hypertrophy.
    - Directly instantiates output into `workout_templates`, `template_exercises`, and `progression_rules` tables with 1 tap.

---

## 3. Dual-Tier 1RM Estimation Architecture

A central requirement is handling 1RM estimation accurately across both environments:

```
┌─────────────────────────────────────────────────────────────┐
│ TIER 1: In-App Fast Heuristic Estimator (Mobile)            │
│  - Immediate feedback during workout                        │
│  - Uses Lombardi equation or pre-loaded calibrated k values │
│  - Instant calculation: e1RM = w * (reps + RIR)^0.10        │
└──────────────────────────────┬──────────────────────────────┘
                               │ Workout logs exported
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ TIER 2: Adaptive Kalman Filter Engine (Companion Suite)     │
│  - Ingests full historical dataset                          │
│  - State vector: x = [ln(1RM), k]^T                         │
│  - Filters high-rep noise and adjusts for lift biomechanics │
│  - Updates calibrated 1RM & k parameters                    │
└──────────────────────────────┬──────────────────────────────┘
                               │ Sync calibrated parameters back
                               ▼ (Optional)
```

### Tier 1: In-App Fast Heuristic Estimator (Mobile)
- Runs locally in real-time on device.
- For completed sets, calculates an immediate estimated 1RM using effective repetitions ($r_{\text{eff}} = \text{reps} + \text{RIR}$ or $\text{reps} + (10 - \text{RPE})$):
  $$\text{e1RM}_{\text{mobile}} = w \cdot r_{\text{eff}}^{0.10}$$
- If calibrated parameters $(1\text{RM}, k)$ have been synced from the companion program, the mobile app uses the individualized power law: $w \cdot r_{\text{eff}}^{k}$.

### Tier 2: Adaptive Kalman Filter Engine (Companion Suite)
- As specified in [1RM_calculation.txt](file:///c:/Programmering/Eget/Workout_suite/1RM_calculation.txt) and supported by empirical research in [Deep_research_1RM.md](file:///c:/Programmering/Eget/Workout_suite/Deep_research_1RM.md):
  - Solves the linearized Lombardi model: $\ln(w) = \ln(1\text{RM}) - k \cdot \ln(r_{\text{eff}})$.
  - **State Vector**: $\mathbf{x}_t = [\ln(1\text{RM}_t),\, k_t]^T$, where $k_t$ represents the athlete's movement-specific repetition endurance.
  - **Noise Covariance Modeling**: Measurement noise $R_t$ scales quadratically with rep count ($R_t = \sigma_{\text{base}}^2 (1 + \lambda r_{\text{eff}}^2)$) to heavily discount noisy sets with $\ge 10$ reps.
  - **Biomechanics & Movement Corrections**:
    - Bench press: tightly calibrated prime mover failure.
    - Back squat: compensates for intra-set axial recovery pauses and high-rep overestimation.
    - Deadlift: accounts for the absence of stretch-shortening cycle (dead stop) and grip/posture fatigue bottlenecks.
  - **Calibrated Feedback**: The updated $1\text{RM}$ and individual endurance slope $k$ for each exercise can be exported back to the mobile app for superior on-device targeting.

---

## 4. Component 2: Companion Analysis & Statistics Suite

### 4.1 Theoretical Foundation: Stimulus, Fatigue, and Adaptation
Progressive overload is driven by past training stimuli. To optimize progression without triggering injury or non-functional overreaching, the companion program models the interaction between training stress, fatigue accumulation, and bodily recovery.

### 4.2 Training Stimulus Quantification
Raw volume (Sets $\times$ Reps $\times$ Weight) overvalues light, high-rep sets and undervalues heavy compound efforts. The companion engine computes:
1. **Total Tonnage Load**: $\sum (\text{sets} \times \text{reps} \times \text{weight})$.
2. **Effective Stimulating Sets**: Sets performed at $RPE \ge 7.0$ ($RIR \le 3$), scaled by relative intensity:
   $$\text{Stimulus} = \sum_{\text{sets}} \left(1.0 + \frac{\text{RPE} - 7}{3}\right) \times \frac{\text{weight}}{1\text{RM}}$$
3. **Training Frequency**: Number of exposures per muscle group per rolling 7-day window.

### 4.3 Banister Two-Component Impulse-Response Model
Every training session imposes both a positive fitness adaptation and negative fatigue:
- **Fitness ($P$)**: Represents long-term physiological adaptation. Decays slowly with time constant $\tau_1 \approx 30\text{--}45$ days.
- **Fatigue ($F$)**: Represents acute muscular, metabolic, and central nervous system depletion. Decays rapidly with time constant $\tau_2 \approx 7\text{--}14$ days.
- **Net Preparedness (Readiness to Perform)**:
  $$\text{Preparedness}(t) = k_1 \sum_{i} \text{Stimulus}_i \cdot e^{-\frac{t - t_i}{\tau_1}} - k_2 \sum_{i} \text{Fatigue}_i \cdot e^{-\frac{t - t_i}{\tau_2}}$$

### 4.4 Dynamic Recoverability Engine (Energy Balance & Physiology)
Individual recovery rate ($\tau_2$) is not static—it dynamically shifts based on the lifter's nutritional status and physiology:
1. **Caloric Balance / Bodyweight Slope ($\Delta BW / \Delta t$)**:
   - Calculated from the 14-day rolling slope of bodyweight:
     - **Positive $\Delta BW$ (Caloric Surplus / Bulking)**: Enhanced glycogen repletion and protein synthesis accelerate fatigue dissipation ($\tau_2$ shortened by 10%–25%). Higher Maximum Recoverable Volume (MRV).
     - **Negative $\Delta BW$ (Caloric Deficit / Cutting)**: Reduced energetic availability impairs recovery ($\tau_2$ lengthened by 15%–30%). Lower MRV, requiring volume reduction to avoid overtraining.
2. **Body Fat % & Lean Mass**: Modulates baseline systemic fatigue accumulation on heavy multi-joint exercises.
3. **Age & Biological Factors**: Adjusts baseline decay constants and maximum recoverable set thresholds.

### 4.5 Actionable Decision Engine & Recommendations
The companion program analyzes the fitness-fatigue balance to output actionable advice:
- **Optimal Overload Signal**: Preparedness high + Fatigue low $\rightarrow$ Recommend progressive overload (+2.5% load or +1 rep on key lifts).
- **Deload / Overreaching Warning**: Acute:Chronic Workload Ratio (ACWR) $> 1.5$ or fatigue outpacing fitness accumulation $\rightarrow$ Recommend a deload week (-30% volume, -10% load).
- **Under-stimulation Alert**: ACWR $< 0.8$ or frequency $< 1.5\times$/week per muscle group $\rightarrow$ Recommend adding 1–2 working sets or increasing training frequency.

---

## 5. Data Exchange & Integration Architecture

### 5.1 Local-First Data Exchange (Phase 2)
- **Export Mechanism**: Single-tap "Export Data" in the mobile app packages all SQLite tables into a validated, standardized `workout_data_export.json` file.
- **Native OS Sharing**: Uses native iOS Share Sheet / Android Intent to export via AirDrop, local file save, Google Drive, iCloud, or email.
- **Companion Ingestion**: Python companion reads and validates the JSON file via Pydantic schemas, checking data integrity and foreign keys.

### 5.2 Data Import from External Apps (Phase 2)
- **Supported Formats**: The mobile app supports importing training history from common workout tracker export formats:
  - **Strong App**: CSV export (exercise name, date, weight, reps, RPE, duration, notes).
  - **Hevy App**: CSV export (exercise, sets, reps, weight, RPE).
  - **Generic CSV/JSON**: A flexible importer with column-mapping UI for unsupported formats.
- **Import Flow**:
  - User selects an import file via the OS file picker.
  - The app parses the file, presents a preview of detected exercises and sessions, and allows the user to map imported exercise names to existing library entries or create new custom exercises.
  - Imported data is tagged with an `imported_from` metadata field for provenance tracking.
  - Duplicate detection: if a session with the same date, exercise, and set count already exists, the user is warned before overwriting.

### 5.3 Companion Parameter Feedback Sync (Optional / Phase 6)
- The companion suite can export calibrated $(1\text{RM}, k)$ parameters per exercise as a `calibrated_parameters.json` file.
- **Format**: A JSON array of objects, each containing `exercise_id`, `calibrated_1rm` (kg), `calibrated_k` (float), and `calibrated_at` (ISO8601 timestamp).
- **Mobile Ingestion**: The mobile app imports this file via the same OS file picker / share sheet. Upon import, the Tier 1 heuristic estimator switches from the default Lombardi exponent ($k = 0.10$) to the individualized $k$ value for each calibrated exercise.
- Calibrated parameters are stored in a local `calibrated_params` table and are always optional — the app degrades gracefully to the default heuristic if no calibration exists.

### 5.4 Seamless Cloud Synchronization Path (Phase 7)
- Direct synchronization with a cloud backend (e.g. Supabase / PostgreSQL) without changing UI components or database relations.
- Companion program can query the cloud database directly, while mobile retains 100% offline functionality with local SQLite caching.
- **Backup**: Automated backup of the SQLite database to iCloud / Google Drive is deferred to Phase 7, where cloud sync inherently provides redundancy. Until then, the manual JSON export serves as the backup mechanism.

---

## 6. Comprehensive Feature Matrix

| Feature Domain | Mobile Workout Tracker | Companion Analysis Suite |
| :--- | :--- | :--- |
| **Workout Logging** | Real-time set/rep/weight/RPE/RIR logging with set type tags, per-set notes, superset grouping, ghosting (global), rest timer | Ingests logs, runs validation & statistical aggregation |
| **Crash Recovery** | Write-through auto-save, `in_progress` session detection, Resume/Discard prompt on relaunch | N/A |
| **1RM Estimation** | Fast heuristic (Lombardi / calibrated $k$ lookup from companion import) | Full adaptive Linear Kalman Filter with movement corrections; exports calibrated $(1\text{RM}, k)$ to mobile |
| **Progression Management** | Built-in models + visual IF/THEN/ELSE custom rule builder with increase, decrease, reset, and deload actions | Evaluates historical response & recommends optimal progression rate |
| **Exercise Library** | Muscle group / equipment filtering, custom exercises, variant hierarchy (`parent_exercise_id`), PR Board (all-time / per-program) | Cross-variant e1RM aggregation |
| **Body Composition** | Bodyweight (kg canonical), Navy formula, manual BF%, circumference measurements, 7-day rolling average | 14-day $\Delta BW$ derivative, energy balance classification |
| **Fatigue & Adaptation** | Displays volume load and set counts | Banister impulse-response model, ACWR, preparedness curves |
| **Strength Standards (SBD)** | Real-time classification tier badge (Untrained to Elite), progress bar, SBD total & radar balance | Advanced population percentile modeling & longitudinal standard tracking |
| **User Profile & Psychology** | Multi-dimensional matrix (enjoyment, effort style, goals, schedule, equipment) | Ingests profile to optimize fatigue sensitivity & recovery parameters |
| **User & Cohort Benchmarking** | Local-first demographic percentiles (Phase 3); friends & normalized DOTS leaderboards (Phase 7) | Cross-user statistical cohort modeling and anonymized demographic distributions |
| **Profile-Driven Program Generator**| Generates customized splits, set volumes, RPE targets, and progression rules from profile | Recommends periodization phases and mesocycle volume landmarks |
| **Data Import/Export** | JSON export via share sheet; import from Strong CSV, Hevy CSV, generic CSV/JSON; calibrated parameter import | Reads exported JSON; exports `calibrated_parameters.json` |
| **Data Storage** | Local-first SQLite on device (kg canonical, `PRAGMA user_version` migrations) | Local SQLite/Parquet or cloud sync via Python analysis pipeline |