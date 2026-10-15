# Phase 4 Specifications: Program Builder & Editor, Training Mentality, 15-Minute Routines, and App Navigation Overhaul

This document defines the exact architectural, functional, and user-experience specifications for Phase 4 enhancements, resolving the program creation/editing limitations, modernizing athlete psychology inputs, and restructuring the root navigation into four dedicated hubs.

---

## 1. Custom Program Builder & Template/Exercise Full CRUD

### 1.1 Program Creation, Cloning & Presets Protection
- **Default Presets Protection**:
  - Default pre-built programs (and synthesized programs) cannot be accidentally mutated in place.
  - When a user initiates an edit on a pre-built or synthesized program, the system automatically triggers a **"Clone as Custom"** flow:
    - Generates a new program ID (e.g. `prog_custom_<timestamp>_<hash>`).
    - Prefixes/suffixes name: `[Original Name] (Custom)` (user can rename).
    - Preserves notes: `Cloned from [Original Name] on YYYY-MM-DD`.
    - Deep-clones all child `workout_templates`, `template_exercises`, and `progression_rules`.
    - Automatically sets the cloned program as the target being edited.
  - If the user is editing an existing custom program created by themselves, changes apply directly in place.
- **Top-Level Program Actions**:
  - **Create Blank Program**: Name, accent color picker (`color_hex`), notes.
  - **Duplicate / Clone Program**: 1-tap cloning of any program.
  - **Delete Program**: Cascades to all child templates, template exercises, and rules (with confirmation dialog; historical completed workouts are preserved).
  - **Set as Active**: 1-tap activation via `ProgramBlockService` (closes previous active block and opens new active meso-cycle).

### 1.2 Daily Workout Template CRUD
Within a program's detail screen, users have full control over the daily routine split:
- **Add Day / Template**: Button to append a new template (e.g. "Day 1 — Push", "Day 2 — Pull", "Legs").
- **Edit Day Metadata**: Rename template, edit instructions/notes.
- **Reorder Days**: Move templates up or down to adjust sequence.
- **Delete Day**: Delete template with confirmation (cascades to template exercises).

### 1.3 Template Exercise Prescription & Editor
Within each daily template card:
- **Add Exercise**: Launches the catalog picker with real-time search, muscle group filtering, and equipment filtering.
- **Delete Exercise**: 1-tap removal of an exercise from the template.
- **Reorder Exercises**: Move exercises up or down within the day.
- **1-Tap Exercise Swap**: Replace an exercise with a variant or catalog movement, preserving target set and rep prescriptions.
- **Prescription Configuration**:
  - **Target Sets**: Stepper or direct numeric input (e.g. `1` to `10`).
  - **Target Rep Range**: Separate minimum and maximum fields (e.g. `min: 8`, `max: 12`).
  - **Target Exertion**: Value input with toggle between `RPE` (6.0–10.0) or `RIR` (0–4).
  - **Equipment Tare / Gear Assignment**: Optional gear selection from `gear_inventory` (e.g. 29kg Safety Squat Bar, 25kg Trap Bar, 2:1 Cable ratio).
  - **Rest Interval**: Target rest timer in seconds (defaults to exercise `default_rest_seconds`).
- **Antagonist Superset Pairing**:
  - **Link Action**: Select two exercises in the template to bind them into a shared `exercise_group_id`.
  - **Unlink Action**: Disassociate an exercise or split the superset group.
- **Progression Rule Integration**:
  - Dedicated "Rules ⚙️" button launching `ProgressionBuilderModal` to attach Linear Progression (LP), Double Progression (DP), Dynamic Double Progression (DDP), or custom IF/THEN progression rules.

---

## 2. Training Mentality Model & Deprecation of "Intensity Style" (Rule 8.4)

### 2.1 The Training Mentality Matrix
Replace the legacy "Training enjoyment" questionnaire and completely eliminate the redundant "Intensity and exertion style" selector. Mindset directly determines exertion targets, volume accumulation, and progression mechanisms:

1. **Fury ⚡**:
   - *Lifter Profile*: "Loves to push themselves with high intensity and aggression; leaves nothing in the tank."
   - *Prescription*: High-intensity / low-volume (1–2 working sets to RPE 9.5–10.0 / failure).
   - *Progression*: Dynamic Double Progression (DDP) with individual set failure tracking.
2. **Precision 🎯**:
   - *Lifter Profile*: "Likes to hone their craft, knowing that every rep of practice makes them better; deliberate technical mastery."
   - *Prescription*: Moderate-to-high volume (3–4 working sets @ RPE 7.5–8.5 / RIR 1.5–2.5).
   - *Progression*: Linear Progression (LP) on primary compounds, Double Progression (DP) on accessory movements. Focus on crisp rep execution and volume accrual.
3. **I Wanna Get Out of Here ⏱️**:
   - *Lifter Profile*: "Wants to get out of the gym, doing the least work possible for meaningful results; efficiency above all."
   - *Prescription*: Minimal effective dose (2 working sets per movement), automatic antagonist supersets, tight rest pacing.
   - *Progression*: Double Progression (DP) with time-compressed execution.

### 2.2 Cross-Stack Schema & Contract Synchronization (Rule 8.4)
To ensure zero dependency bleed and contract conformity across `mobile/`, `schemas/`, and `companion/`:

1. **SQLite Database (`mobile/src/database/schema.ts`)**:
   - In `user_profiles` table:
     - Rename/replace column `training_enjoyment TEXT NOT NULL` with `training_mentality TEXT NOT NULL DEFAULT 'precision'`.
     - Remove or make optional `intensity_style`.
     - Migration logic handles existing databases smoothly.
2. **TypeScript Domain Models (`mobile/src/core/types/index.ts`)**:
   - Introduce `export type TrainingMentality = 'fury' | 'precision' | 'get_out';`.
   - Update `UserProfile` interface: `training_mentality: TrainingMentality;`.
   - Remove `intensity_style` from `UserProfile`.
3. **JSON Export Contract (`schemas/workout_export.schema.json`)**:
   - Update `user_profiles.properties`:
     - Add `training_mentality`: `{"type": "string", "enum": ["fury", "precision", "get_out"]}`.
     - Remove `intensity_style` from `required` and `properties`.
4. **Python Ingestion Schemas (`companion/src/ingestion/schemas.py`)**:
   - Update `UserProfilePayload`:
     - `training_mentality: Literal["fury", "precision", "get_out"]`.
     - Remove `intensity_style`.
5. **Program Synthesizer (`mobile/src/core/generator/programSynthesizer.ts`)**:
   - Adapt `synthesizeProgram(profile)`:
     - `fury` $\rightarrow$ sets: 2 compounds / 1 accessory @ RPE 9.5, DDP rules.
     - `precision` $\rightarrow$ sets: 3–4 compounds / 2–3 accessory @ RPE 8.0, LP/DP rules.
     - `get_out` $\rightarrow$ sets: 2 compounds / 2 accessory @ RPE 8.5, auto antagonist supersets.

---

## 3. 15-Minute Target Workout Duration

### 3.1 Questionnaire Duration Selector
- Extend duration options in `UserProfileScreen` to: `[15, 30, 45, 60, 75, 90]` minutes.

### 3.2 Synthesizer Architecture for 15-Minute Routines
When `preferred_session_duration_mins === 15`:
- **Exercise Structure**: Exactly **4 exercises**, organized into **2 antagonist superset pairs**:
  - *Pair 1 (Primary Compound Antagonist)*: e.g. Incline Dumbbell Press + Chest-Supported Row, or Dips + Chin-ups.
  - *Pair 2 (Secondary Antagonist / Accessories)*: e.g. Cable Lateral Raise + Cable Face Pull, or Bicep Curl + Tricep Pushdown.
- **Prescription**:
  - Exactly **2 sets** per exercise.
  - Total working sets: 8 sets per workout session (4 sets per superset pair $\times 2$).
- **Rest Interval Protocol**:
  - **0 seconds rest** between Exercise A and Exercise B inside each superset pair.
  - Exactly **90 seconds rest** after completing both exercises in the superset pair before beginning the next round.
- **Time Audit**:
  - 4 superset rounds $\times 60$s active lifting = 4 minutes.
  - 3 rest intervals $\times 90$s = 4.5 minutes.
  - Equipment setup & warmup transitions = ~5–6 minutes.
  - Total gym footprint: $\approx 14\text{--}15$ minutes.

---

## 4. Main Navigation Overhaul: `HOME`, `WORKOUT`, `PROFILE`, `SETTINGS`

The root bottom navigation bar transitions from 3 tabs (`Logger`, `Calendar`, `Settings`) to 4 dedicated tabs:

```
[  HOME (🏠)  ]    [  WORKOUT (⚡)  ]    [  PROFILE (👤)  ]    [  SETTINGS (⚙️)  ]
```

### 4.1 Tab 1: `HOME` (Dashboard, Calendar & Analytics Hub)
- **Top Section — Quick Status Dashboard**:
  - Current Active Program badge with color swatch.
  - "Next Scheduled Workout" quick card with 1-tap "Start Now" button (switches to `WORKOUT` tab).
  - Weekly summary metrics: Workouts completed this week, total tonnage, active training streak.
- **Middle Section — Interactive Calendar Agenda**:
  - Existing monthly 7-column grid and weekly agenda view.
  - Completed workout indicator dots and program block transition indicators.
  - Tapping any past date opens `SessionDetailModal` for workout inspection.
- **Bottom Section — Future Analytics Mount Point**:
  - Dedicated reserved layout zone for Phase 5 & 6 longitudinal charts (e1RM trends, bodyweight rolling averages, DOTS progression, symmetry radar).

### 4.2 Tab 2: `WORKOUT` (Smart Session Router & Active Logger)
Tapping `WORKOUT` dynamically resolves one of three states:

1. **State A: Workout In Progress**:
   - Instantly opens the active `ActiveLoggerScreen` with live duration ticker, set rows, half-step RPE/RIR steppers, rest timer banner, plate calculator, and crash recovery.
2. **State B: No Workout In Progress, User Has an Active Program (Pre-Flight Screen)**:
   - Displays the **Next Workout** preview:
     - Program title and accent color.
     - Next Template in circular sequence:
       - Checks the last completed workout's `template_id` in the active program.
       - Advances to the next template index (e.g. Day 1 $\rightarrow$ Day 2 $\rightarrow$ Day 3 $\rightarrow$ Day 1).
     - Template Name (e.g. "Upper Body A — Bench & Rows") and notes.
     - Planned exercise list preview with target sets, rep ranges, target RPE, and superset badges.
     - Primary CTA: **"START WORKOUT"** (creates session populated with ghost sets and template exercises, navigating directly into the active logger).
     - Secondary CTAs:
       - *"Select another day from this program"* (picker modal for Day 1, Day 2, etc.).
       - *"Start empty freestyle workout"* (starts an ad-hoc session).
3. **State C: No Workout In Progress, NO Active Program**:
   - Displays empty-state banner:
     - *"You are not currently subscribed to a training program."*
     - Primary CTA: **"Open Program Planner"** (navigates to Profile / Program Overview to pick, build, or synthesize a program).
     - Secondary CTA: **"Start Freestyle Workout"** (starts an empty session).

### 4.3 Tab 3: `PROFILE` (Training Psychology & Program Planner)
Consolidates athlete identity, questionnaire, and program management:
- **Athlete Demographics**: Sex, height, birthdate (used for DOTS score and Navy body fat).
- **Training Mentality Selector**: Fury, Precision, I Wanna Get Out of Here.
- **Goals & Logistics**: Primary/secondary goals, available days per week, target duration (including 15m), equipment access.
- **Program Synthesizer CTA**: 1-tap "Synthesize New Custom Program" button.
- **Active Program & Program Overview Hub**:
  - Active program banner showing days active in current meso-cycle.
  - Button to open the full **Program Overview & Builder** (`ProgramOverviewScreen`) for custom routine creation, cloning, day template CRUD, and progression rules.
- *(Phase 5 Extensibility)*: Direct access to bodyweight logs and circumference measurements.

### 4.4 Tab 4: `SETTINGS` (Gym Mechanics, Equipment & Data Utilities)
Clean technical configuration separated from athlete profile:
- **Display & Units**: Metric (kg) vs Imperial (lbs).
- **Exertion Metric**: RPE (6.0–10.0) vs RIR (0–4 reps).
- **Cognitive Mode**: Pure Utility Mode toggle (ADR-024).
- **Exercise Catalog & Gear**:
  - Manage Exercise Library & Variant Tree (`ExerciseLibraryScreen`).
  - Manage Gear & Equipment Inventory (`GearInventoryScreen`).
- **Data Portability**:
  - External CSV Import (Strong CSV, Hevy CSV, custom CSV).
  - Standardized JSON Export (ADR-001 / Rule 8.4 contract-verified).
- **Diagnostics**: SQLite database status, table row counts, storage utilization.