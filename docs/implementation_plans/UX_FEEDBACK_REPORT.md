> **Historical reference:** This document contains past plans, audits, or proposals with mixed completion status. Its agent instructions, verification gates, and unchecked items do not assign current work. Follow the latest user request, root `AGENTS.md`, and [current documentation guidance](../README.md). Verify implementation claims against source.

# datSet — UX & Navigation Feedback Report

> Full-codebase audit of every screen, modal, and component in the mobile app.
> Identifies systemic patterns that make the app feel clunky, with concrete
> change proposals ranked by impact.

---

## Executive Summary

The app has an impressive feature set — program generation, progression rules,
plate calculators, SBD radar charts, crash recovery — but **navigating between
these features is where the friction lives**. Five systemic patterns account for
the vast majority of the "clunkiness":

| # | Pattern | Where It Hurts |
|---|---------|---------------|
| 1 | **Modal-as-Screen stacking** | Tapping through Profile → Gear → Edit Gear creates 3 nested `<Modal>` layers |
| 2 | **Kitchen-sink screens** | HomeScreen, SettingsScreen, and UserProfileScreen each try to be everything |
| 3 | **Tiny touch targets & button overload** | SetRow crams 7 interactive elements into 360px; exercise rows have 6 mini-buttons |
| 4 | **Broken navigation handoffs** | "View in Calendar" closes a modal but leaves you on Settings; import onboarding dead-ends |
| 5 | **Missing scroll virtualization** | ActiveLoggerScreen maps 200+ views; BodyMetrics renders months of history without windowing |

---

## Part 1 — Systemic Architecture Issues

### 1.1 Modal-as-Screen Antipattern

**The problem:** The app has no navigation stack (React Navigation / Expo Router).
Every secondary screen is wrapped in a React Native `<Modal>`. This causes:

- **Android hardware back** doesn't dismiss modals properly; you can get trapped
- **3-deep modal stacking** (e.g. Settings → ExerciseLibrary → ExerciseDetail → SessionDetailModal)
- **No URL/deep-link state** — you can't restore where the user was after a crash
- **No shared transition animations** — every screen pops in with a jarring slide/fade

**Where it happens (every instance):**

| Parent Screen | Modal Opened | File |
|---------------|-------------|------|
| [App.tsx](../../mobile/App.tsx) | WorkoutTabRouter (kept mounted), other tabs conditional-rendered | Root |
| [UserProfileScreen](../../mobile/src/features/profile/UserProfileScreen.tsx) | ProgramOverviewScreen, GearInventoryScreen, BodyMetricsScreen | 3 modals |
| [SettingsScreen](../../mobile/src/features/settings/SettingsScreen.tsx) | ProgramOverviewScreen, ExerciseLibraryScreen, ImportScreen | 3 modals |
| [ActiveLoggerScreen](../../mobile/src/features/logger/ActiveLoggerScreen.tsx) | **9 modals** (Gear Picker, Add Exercise, Full Library, Finish Confirm, Superset, CrashRecovery, PlateCalc, Pain, Substitution) | 9 modals |
| [ExerciseLibraryScreen](../../mobile/src/features/inspection/ExerciseLibraryScreen.tsx) | ExerciseDetailScreen, ExerciseFormModal | 2 modals |
| [ExerciseDetailScreen](../../mobile/src/features/inspection/ExerciseDetailScreen.tsx) | SessionDetailModal, SBDBalanceRadarChart | 2 modals |
| [ProgramOverviewScreen](../../mobile/src/features/progression/ProgramOverviewScreen.tsx) | EditTemplateModal, CatalogPickerModal, PrescriptionEditorModal, ProgressionBuilderModal + 2 inline | **6 modals** |
| [HomeScreen](../../mobile/src/features/home/HomeScreen.tsx) | BodyMetricsScreen, SBDBalanceRadarChart, WorkloadDeepDiveModal + embedded CalendarScreen's modal | 4 modals |

> [!IMPORTANT]
> **Proposed fix:** Introduce a lightweight navigation stack (React Navigation
> `createNativeStackNavigator` or Expo Router file-based routes). Convert
> full-screen modals into stack screens. Keep only small, transient overlays
> (confirmation dialogs, plate calculator, pain report) as true modals.

---

### 1.2 Kitchen-Sink Screens

Several screens try to do too many things, producing enormous scroll heights
and cognitive overload.

#### HomeScreen — "The Infinite Dashboard"

[HomeScreen.tsx](../../mobile/src/features/home/HomeScreen.tsx) stacks **4 major subsystems** vertically:

```
┌─────────────────────────────┐
│ Active Program + Next WO    │  ~200px
│ Weekly Summary (3 cards)    │  ~100px
├─────────────────────────────┤
│ FULL CalendarScreen embed   │  ~400px (month) or ~200px (week)
├─────────────────────────────┤
│ Performance Analytics       │
│   DOTS Card + PlotsScreen   │  ~500px
├─────────────────────────────┤
│ Body Composition            │
│   PlotsScreen (2nd instance)│  ~400px
└─────────────────────────────┘
         Total: ~1600px+
```

**Concrete problems:**
- The **Next Workout card looks like a primary CTA** (green `#00E676` border)
  but is **completely non-tappable** — `onNavigateToWorkout` prop exists but is
  never wired to any `<TouchableOpacity>`. ([Lines 318–332](../../mobile/src/features/home/HomeScreen.tsx#L318-L332))
- **Nested scroll conflict**: CalendarScreen's inner `FlatList` sits inside
  HomeScreen's outer `ScrollView` — classic RN virtualization warning, erratic
  scroll physics, momentum lockups
- **Two PlotsScreen instances mount simultaneously**, each querying all workout
  history on mount via `Promise.all` across 7 data loaders

> [!TIP]
> **Proposed fix:** Make HomeScreen a focused dashboard with summary cards only.
> Move the full Calendar, Performance plots, and Body Composition plots to their
> own tab or sub-screen. The Next Workout card should be the **primary tappable
> CTA** that jumps you into the Workout tab.

#### SettingsScreen — "Everything Drawer"

[SettingsScreen.tsx](../../mobile/src/features/settings/SettingsScreen.tsx) (1,005 lines) mixes:

- Quick daily toggles (kg/lbs, RPE/RIR)
- Feature launchers (Exercise Library, Program Builder)
- File I/O operations (CSV import, JSON export, calibrated param import)
- Developer diagnostics (SQLite WAL mode, foreign key constraints)
- Multi-paragraph scientific citations and legal disclaimers

A user changing their weight units must scroll past program management, import
wizards, database internals, and Epley/Brzycki citations.

> [!TIP]
> **Proposed fix:** Split into sections with clear hierarchy:
> - **Preferences** (top): Units, intensity metric, utility mode, warm-ups
> - **Tools** (middle): Exercise Library, Programs — or better, make these stack screens
> - **Data** (collapsible): Export/Import operations
> - **About** (separate sub-screen): Diagnostics, citations, legal

#### UserProfileScreen — "The Giant Form"

[UserProfileScreen.tsx](../../mobile/src/features/profile/UserProfileScreen.tsx) (1,301 lines) hides the Gear Inventory button inside
"Section 4: Schedule & Equipment Constraints" of a collapsible questionnaire.
When expanded, the scroll height exceeds **1500pt**.

---

### 1.3 Prop Drilling Overload

Without React Context or a DI container, repository interfaces are manually
threaded through every layer:

```
App.tsx (8 repos)
  └─► WorkoutTabRouter (13 props)
       └─► ActiveLoggerScreen (14 props)
            └─► SetRowComponent (12 props each, × N rows)
```

```
App.tsx (8 repos)
  └─► SettingsScreen (13 props)
       └─► ProgramOverviewScreen (6 props)
            └─► PrescriptionEditorModal (6 props)
```

**Why this hurts UX (not just DX):** Adding a new feature requires updating
prop interfaces across 4+ intermediate components, which slows iteration and
creates coupling that discourages refactoring screens into smaller units.

> [!TIP]
> **Proposed fix:** Introduce a `RepositoryContext` provider at the app root
> that exposes all repositories via `useRepositories()`. This eliminates ~60%
> of the prop threading and makes it practical to split screens into smaller
> components.

---

### 1.4 Missing Keyboard Avoidance

Multiple modal forms lack `KeyboardAvoidingView`, causing the soft keyboard to
obscure inputs and action buttons:

| Component | Issue |
|-----------|-------|
| [EditTemplateModal](../../mobile/src/features/progression/EditTemplateModal.tsx) | Notes input + Save button pushed off-screen |
| [PrescriptionEditorModal](../../mobile/src/features/progression/PrescriptionEditorModal.tsx) | Nested scroll with `maxHeight: 80%` clips under keyboard |
| [PainReportModal](../../mobile/src/features/logger/PainReportModal.tsx) | Notes field at `maxHeight: 460` clips Submit buttons |
| [GearInventoryScreen](../../mobile/src/features/gear/GearInventoryScreen.tsx) | Hardcoded `maxHeight: 400` modal form |
| [BodyMetricsScreen](../../mobile/src/features/bodyMetrics/BodyMetricsScreen.tsx) | 9 raw text inputs without keyboard handling |

---

## Part 2 — Screen-by-Screen Concrete Issues

### 2.1 Calendar

**File:** [CalendarScreen.tsx](../../mobile/src/features/calendar/CalendarScreen.tsx)

| Issue | Impact | Suggested Fix |
|-------|--------|--------------|
| **Duplicate view-mode controls** — top-right pill toggle (`Week`/`Month`) AND bottom accordion bar (`▲ Collapse`/`▼ Expand`) do the same thing | Wastes vertical space, confusing | Remove the accordion bar; keep only the top toggle |
| **No horizontal swipe gestures** on week strip or month grid to navigate weeks/months | Users must tap 38×34px arrow buttons | Add `PanResponder` or `react-native-gesture-handler` swipe detection |
| **Month/selection desync** — navigating to a different month keeps `selectedDate` on the old month; collapsing to week view snaps back violently | Disorienting jump | Auto-select the 1st of the navigated month when arrows are pressed |
| **Empty day = blank agenda** — tapping a day with no workouts returns `null` below the calendar | Feels unresponsive | Always show the date header + "No workouts logged" + "Start workout" CTA |
| **Cramped day cells** — 48×45px with day number, completed dots, and program swap dots | Hard to tap accurately | Increase minimum height to 56px; consolidate dots |

---

### 2.2 Session Detail Modal

**File:** [SessionDetailModal.tsx](../../mobile/src/features/calendar/SessionDetailModal.tsx)

| Issue | Impact | Suggested Fix |
|-------|--------|--------------|
| **6-column set table squished** on 360px screens — superset + type badges overflow, unilateral reps (`12 / 12`) wrap | Ugly cell stretching | Collapse TYPE into a colored dot or icon; move superset badge to exercise header |
| **No swipe-to-dismiss** — looks like a bottom sheet (`height: 92%`, rounded corners) but is a plain `<Modal>` | Must reach for `✕` button | Use `@gorhom/bottom-sheet` or add a drag gesture responder |
| **Read-only, delete-only** — spotting a typo (100 kg instead of 10 kg) means deleting the entire workout | Destructive-only data correction | Add an "Edit Session" route or inline field editing |

---

### 2.3 Active Logger (The God Component)

**File:** [ActiveLoggerScreen.tsx](../../mobile/src/features/logger/ActiveLoggerScreen.tsx) — **2,415 lines**

> [!WARNING]
> This single file manages crash recovery, plate math, progression evaluation,
> superset grouping, warm-up generation, timer syncing, **9 modal flows**, and
> renders every exercise and set without virtualization. It is the #1 source of
> UX friction in the app.

#### 2.3a — Set Row Density Crisis

**File:** [SetRowComponent.tsx](../../mobile/src/features/logger/SetRowComponent.tsx) (1,105 lines)

7 interactive elements packed into ~360px of horizontal width:

```
[Type 46px] [Ghost flex] [Weight 68px] [Reps 48px] [RPE 48px] [▼ 24px] [✓ 38px]
```

- In **unilateral mode**, two inputs + slash squeezed into 48px reps column
- **Tapping any input** simultaneously: (1) opens software keyboard, (2) expands
  the accordion drawer (+170px), causing a **double layout jolt** that pushes
  the active input off-screen
- **Weight/rep steppers** (`-2.5`, `+2.5`, etc.) are hidden inside the drawer —
  the most common gym action requires an extra tap to reveal

> [!TIP]
> **Proposed fixes:**
> - Do NOT auto-expand the drawer on input focus — expand only on chevron tap
> - Show the most common steppers (`+2.5 kg`, `+1 rep`) as swipe gestures or
>   inline buttons without requiring drawer expansion
> - In unilateral mode, use a single input with an L/R toggle rather than
>   two micro-inputs side by side

#### 2.3b — Exercise Card Header Overload

Each exercise header crams **7 touch targets** in a ~44px bar:

1. Exercise Name + Dumbbell Badge + Superset Badge
2. Implement Pill (`⚙ 20 kg Bar ▾`)
3. SFR Warning Badge
4. Superset Link/Unlink
5. Swap Button
6. Pain Button (`🩹`)
7. Expand Chevron (`▼`)

> [!TIP]
> **Proposed fix:** Move Swap, Pain, Link/Unlink into a `⋯` overflow menu.
> Keep only the exercise name, implement pill, and expand chevron visible.

#### 2.3c — Progression Banner Blocks Content

[ProgressionProposalBanner.tsx](../../mobile/src/features/logger/ProgressionProposalBanner.tsx)
occupies 140–180px when active, pushing exercise cards off-screen on phones under
800px. Additionally, only **one proposal is shown at a time** even if 4 exercises
qualify — the rest are silently dropped.

> [!TIP]
> **Proposed fix:** Show proposals as compact inline banners within each
> exercise card rather than a single global banner at the top.

#### 2.3d — Plate Calculator UX Gaps

[PlateCalculatorModal.tsx](../../mobile/src/features/logger/PlateCalculatorModal.tsx)

- **No direct numeric input** — to calculate plates for 142.5 kg starting
  from 20 kg, you must tap `+5` twenty-four times
- **Stale state on re-open** — opening for Set 1 (80 kg) then Set 2 (100 kg)
  retains the old weight because `useState` doesn't watch `initialWeightKg`

#### 2.3e — Pain Report Cognitive Overload

[PainReportModal.tsx](../../mobile/src/features/logger/PainReportModal.tsx)

Mid-workout with an elevated heart rate, athletes are asked to:
1. Select a joint from chips
2. Choose pain category (joint vs muscle)
3. Rate severity 1–10
4. Read a medical disclaimer
5. Type notes
6. Submit

> [!TIP]
> **Proposed fix:** Offer a quick-report mode: one tap on a body region → one
> tap on a severity face emoji → done. Expand the detailed report as an
> optional "Add Details" accordion.

#### 2.3f — Rest Timer Button Cluster

[RestTimerBanner.tsx](../../mobile/src/features/logger/RestTimerBanner.tsx)

4 buttons (`-30s`, `+30s`, `⏸`, `SKIP`) are ~32px wide with 6px gap.
Fatigued fingers between sets will frequently mis-tap.

> [!TIP]
> **Proposed fix:** Make pause/skip full-height touch targets on the left/right
> edges. Use swipe gestures for ±30s adjustments.

---

### 2.4 Program Builder

**File:** [ProgramOverviewScreen.tsx](../../mobile/src/features/progression/ProgramOverviewScreen.tsx)

| Issue | Impact | Suggested Fix |
|-------|--------|--------------|
| **6 mini-buttons per exercise row** (`▲ ▼ ⇄ 🔗 ⚙️ ✕`) — each under 30px wide | Accidental taps, violates 44px HIG guideline | Consolidate into a swipe-to-reveal action drawer or `⋯` overflow menu |
| **No list virtualization** — a 5-day program with 8 exercises/day creates ~200 touchable views | Performance lag on lower-end devices | Use `SectionList` or `FlashList` |
| **Modal architecture instead of drill-down** — editing stays on one page, opening dialogs on top of dialogs | Feels claustrophobic, no sense of navigation depth | Use stack screens: Program → Day → Exercise → Rules |
| **Reordering requires repeated taps** — each `▲`/`▼` fires an async DB transaction and re-fetches the entire program | Slow, frustrating | Implement drag-to-reorder with `react-native-reorderable-list` |

#### Progression Builder — Missing Threshold Input

[ProgressionBuilderModal.tsx](../../mobile/src/features/progression/ProgressionBuilderModal.tsx)

> [!CAUTION]
> **Bug:** The component declares `conditionThreshold` state but **renders no
> TextInput for it**. Selecting conditions like `AVERAGE_RPE_LESS_THAN` or
> `CONSECUTIVE_SUCCESSFUL_SESSIONS` produces an `undefined` threshold.

Additionally, existing rules display as cryptic uppercase pseudo-code:
```
IF [ALL_SETS_HIT_TARGET_REPS] ➔ THEN [INCREASE_LOAD_FIXED: 2.5]
```
instead of human-readable text:
```
When all sets hit target reps → add +2.5 kg
```

---

### 2.5 Profile & Body Metrics

#### UserProfileScreen

| Issue | Suggested Fix |
|-------|--------------|
| Gear Inventory buried inside questionnaire Section 4 | Surface it as a top-level card or move to Settings |
| Raw text inputs for height (`TextInput` with "Height (cm)") and birthdate (`YYYY-MM-DD` string) | Use native pickers (`@react-native-community/datetimepicker`, unit-aware numeric stepper) |
| 11 props threaded through as a conduit for child modals | Use `RepositoryContext` |

#### BodyMetricsScreen

[BodyMetricsScreen.tsx](../../mobile/src/features/bodyMetrics/BodyMetricsScreen.tsx) (1,074 lines)

| Issue | Suggested Fix |
|-------|--------------|
| **9 raw text inputs** displayed simultaneously (bodyweight, BF%, waist, neck, hips, arm, chest, thigh, calf) | Progressive disclosure — show bodyweight + waist/neck by default, expand "More measurements" on tap |
| **String-based date** (`TextInput` with `YYYY-MM-DD` placeholder) | Native date picker |
| **Unvirtualized history** — `metricsHistory.map(...)` inside a `ScrollView` | Convert to `FlatList` |
| **Charts button orphaned** — `onOpenPlots` not passed when opened from Profile | Always provide the callback or embed a mini-chart inline |

---

### 2.6 Exercise Library & Inspection

#### ExerciseLibraryScreen

[ExerciseLibraryScreen.tsx](../../mobile/src/features/inspection/ExerciseLibraryScreen.tsx)

| Issue | Suggested Fix |
|-------|--------------|
| **~200px of filter controls** (search + view mode + muscle chips + category chips) before first exercise card | Collapse filters into a single expandable filter bar; use a search icon that expands on tap |
| **Overloaded card press** — 4 conditional branches depending on which props exist | Standardize: always navigate to detail; provide Edit/Delete in detail screen |

#### ExerciseFormModal — Extremely Tall Form

[ExerciseFormModal.tsx](../../mobile/src/features/inspection/ExerciseFormModal.tsx)

9 field groups inside a 90% modal card. Users scroll 3–4 viewport lengths.

> [!TIP]
> **Proposed fix:** Convert to a multi-step wizard (Step 1: Name + Muscle +
> Equipment, Step 2: Variant + Standards, Step 3: Mechanics + Rest) or use
> collapsible sections with sensible defaults pre-filled.

---

### 2.7 Charts & Analytics

#### PlotsScreen — Monolithic Data Loader

[PlotsScreen.tsx](../../mobile/src/features/plots/PlotsScreen.tsx) (1,528 lines, 16 props)

| Issue | Suggested Fix |
|-------|--------------|
| **All 7 data loaders fire simultaneously** on mount via `Promise.all`, even if user only views one chart | Lazy-load data for the selected chart tab only |
| **3 stacked horizontal scroll rows** (group pills + sub-pills + time span) create gesture ambiguity | Combine into a single segmented control + dropdown |
| **No outer vertical scroll** — on iPhone SE (< 670px height), controls + chart overflow the screen | Wrap in a `ScrollView` or make the chart container flex-shrink |

#### ProgramEraShadedChart — Invisible Touch Targets

[ProgramEraShadedChart.tsx](../../mobile/src/features/plots/ProgramEraShadedChart.tsx)

- Data point circles are **3.5px radius** (7px diameter) — impossible to tap accurately
- Beyond 35 points, circles are **hidden entirely** with no visible tap target
- Only 3 x-axis date markers regardless of time span

> [!TIP]
> **Proposed fix:** Add invisible expanded hit slop circles (radius 16px);
> keep visible dots at 3.5px. Show a crosshair tooltip on touch-move.

#### WorkloadDeepDiveModal — Endlessly Long

[WorkloadDeepDiveModal.tsx](../../mobile/src/features/plots/WorkloadDeepDiveModal.tsx)

4 KPI cards + 12 muscle group bars + 7 daily cards + 2 intensity panels with
8 distribution bars = **4–5 screen lengths** of content with zero collapsible
sections.

> [!TIP]
> **Proposed fix:** Add collapsible accordion headers for each major section.
> Default to showing only KPIs + muscle volume; expand daily breakdown and
> intensity analysis on tap.

---

### 2.8 Onboarding & Import

#### OnboardingWizardModal — Broken Import Handoff

[OnboardingWizardModal.tsx](../../mobile/src/features/onboarding/OnboardingWizardModal.tsx)

When a new user selects "Import Existing History", `App.tsx` does:
```tsx
onNavigateToImport={() => {
  setShowOnboarding(false);
  handleNavigateToTab('settings');
}}
```
This dumps them on the **top of SettingsScreen** with no indication they need to
scroll past 5 sections to find "Import Workouts (CSV Wizard)".

#### ImportScreen — Navigation Dead-End

[ImportScreen.tsx](../../mobile/src/features/import/ImportScreen.tsx)

After completing an import, the "View Workouts in Calendar ➔" button just calls
`onClose()`, leaving the user wherever they were (usually Settings), rather than
navigating to the Calendar.

---

## Part 3 — Prioritized Action Plan

### 🔴 Critical (High Impact, Affects Core Workflows)

| # | Change | Effort | Why |
|---|--------|--------|-----|
| 1 | **Wire the Next Workout card** as a tappable `TouchableOpacity` that navigates to the Workout tab | Trivial | Dead primary CTA is the first thing users see |
| 2 | **Add a numeric TextInput to PlateCalculatorModal** | Small | Currently unusable for arbitrary target weights |
| 3 | **Fix the missing `conditionThreshold` input** in ProgressionBuilderModal | Small | Actual bug — rules with thresholds produce `undefined` |
| 4 | **Fix import/onboarding navigation** — deep-link directly to ImportScreen | Small | New users hit a dead-end on first launch |
| 5 | **Stop auto-expanding SetRow drawer on input focus** | Small | Eliminates the double-jolt layout shift during logging |

### 🟡 High Priority (Significant UX Improvement)

| # | Change | Effort | Why |
|---|--------|--------|-----|
| 6 | **Introduce `RepositoryContext`** to eliminate prop drilling | Medium | Unblocks all future refactoring |
| 7 | **Introduce a Navigation Stack** for full-screen sub-features | Medium | Fixes back-button, deep-linking, and modal stacking |
| 8 | **Virtualize ActiveLoggerScreen** — replace `ScrollView` + `.map()` with `SectionList`/`FlashList` | Medium | Prevents lag on long workouts |
| 9 | **Split HomeScreen** — summary dashboard only; Calendar and Plots as separate screens/tabs | Medium | Fixes nested scroll conflict and mount performance |
| 10 | **Consolidate exercise row actions** into an overflow menu | Small | Reduces 6 mini-buttons to 1 menu trigger |
| 11 | **Add `KeyboardAvoidingView`** to all modal forms | Small | Fixes keyboard clipping across 5+ modals |

### 🟢 Nice to Have (Polish & Delight)

| # | Change | Effort | Why |
|---|--------|--------|-----|
| 12 | Add swipe gestures to Calendar (week/month navigation) | Medium | Standard mobile calendar expectation |
| 13 | Add swipe-to-dismiss on SessionDetailModal | Small | Looks like a bottom sheet, should act like one |
| 14 | Convert BodyMetrics date input to native picker | Small | `YYYY-MM-DD` text input is error-prone |
| 15 | Add drag-to-reorder in Program Builder | Medium | Replaces tedious `▲`/`▼` button tapping |
| 16 | Humanize progression rule display | Small | `"When all sets hit target → add +2.5 kg"` vs enum code |
| 17 | Lazy-load PlotsScreen data per selected chart | Medium | Avoids loading all 7 datasets on mount |
| 18 | Add collapsible sections to WorkloadDeepDiveModal | Small | Reduces scroll fatigue on a 4–5 screen-length modal |
| 19 | Quick-report mode for PainReportModal | Medium | Body region tap → severity face → done |
| 20 | Split SettingsScreen into Preferences / Tools / About | Medium | Separates daily toggles from admin features |

---

## Part 4 — Root Cause Analysis: Why These Patterns Emerged

Understanding *why* the current architecture exists helps avoid repeating the
same patterns:

### Custom Tab Bar Without Navigation Library

[App.tsx](../../mobile/App.tsx#L56-L135) implements tab navigation via raw `useState` and conditional rendering. This
was likely chosen for simplicity and to keep the Workout tab mounted during
active sessions (`display: 'none'` pattern at [line 337–341](../../mobile/App.tsx#L337-L341)). The trade-off is that **every sub-screen must
be a Modal** because there's no stack navigator to push onto.

**The keep-mounted pattern is valid** — React Navigation supports it via
`unmountOnBlur: false` on a bottom tab navigator, getting the best of both worlds.

### Repositories as Props (Not Context)

The repository pattern is clean and well-structured (`domain/repositories/`
interfaces, `database/repositories/` SQLite implementations, `database/mocks/`
for testing). Props were likely chosen to make testing straightforward — and
they do! But as the feature count grew from 3 screens to 30+ components, the
prop threading became unwieldy. A thin Context wrapper preserves testability
(override via `<RepositoryContext.Provider value={mockRepos}>` in tests) while
eliminating the drilling.

### God Components

[ActiveLoggerScreen.tsx](../../mobile/src/features/logger/ActiveLoggerScreen.tsx) (2,415 lines) and
[PlotsScreen.tsx](../../mobile/src/features/plots/PlotsScreen.tsx) (1,528 lines) grew
organically as features were added. Extracting custom hooks
(`useActiveWorkout`, `useCrashRecovery`, `useProgressionProposal`,
`useExerciseModals`) would reduce these to manageable sizes without changing
any user-facing behavior.

---

## Appendix: Component Complexity Heatmap

| Component | Lines | Props | Modals | Scroll Issues |
|-----------|------:|------:|-------:|:---:|
| [ActiveLoggerScreen](../../mobile/src/features/logger/ActiveLoggerScreen.tsx) | 2,415 | 14 | 9 | ⚠️ No virtualization |
| [PlotsScreen](../../mobile/src/features/plots/PlotsScreen.tsx) | 1,528 | 16 | 0 | ⚠️ No outer scroll, eager loading |
| [UserProfileScreen](../../mobile/src/features/profile/UserProfileScreen.tsx) | 1,301 | 11 | 3 | ⚠️ 1500pt+ expanded height |
| [ImportScreen](../../mobile/src/features/import/ImportScreen.tsx) | 1,182 | 5 | 0 | ⚠️ Unvirtualized exercise map |
| [SetRowComponent](../../mobile/src/features/logger/SetRowComponent.tsx) | 1,105 | 12 | 0 | ⚠️ Double jolt on focus |
| [GearInventoryScreen](../../mobile/src/features/gear/GearInventoryScreen.tsx) | 1,091 | 4 | 1 | ⚠️ Fixed maxHeight modal |
| [BodyMetricsScreen](../../mobile/src/features/bodyMetrics/BodyMetricsScreen.tsx) | 1,074 | 5 | 0 | ⚠️ Unvirtualized history |
| [SettingsScreen](../../mobile/src/features/settings/SettingsScreen.tsx) | 1,005 | 13 | 3 | ⚠️ 2000pt+ scroll |
| [ProgramOverviewScreen](../../mobile/src/features/progression/ProgramOverviewScreen.tsx) | ~900 | 6 | 6 | ⚠️ No virtualization |
| [HomeScreen](../../mobile/src/features/home/HomeScreen.tsx) | ~800 | 11 | 4 | ⚠️ Nested FlatList in ScrollView |
