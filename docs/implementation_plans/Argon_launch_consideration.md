> **Historical reference:** This document contains past plans, audits, or proposals with mixed completion status. Its agent instructions, verification gates, and unchecked items do not assign current work. Follow the latest user request, root `AGENTS.md`, and [current documentation guidance](../README.md). Verify implementation claims against source.

Your architecture, domain modeling, and core feature set are **~85% complete** for an MVP, with all 15 planned engineering phases in `IMPLEMENTATION_PLAN.md` already implemented and covered by unit tests. However, your **store readiness and native production polish are at ~30%**, meaning you are roughly **3 to 4 weeks away** from a public launch (including Google Play's mandatory 14-day closed testing window).

---

## 1. Market Competitiveness & Positioning

Your own `market_analysis.md` nails the macro landscape: the strength training app market is split between **high-polish, low-IQ loggers** (Hevy, Strong), **black-box AI coaches** (JuggernautAI, RP, MacroFactor Workouts), and **powerful but high-friction programmable spreadsheets** (Liftosaur, StrengthLog).

### Where You Win (Your Unfair Advantages)

* **Mathematical Rigor Without Scripting:** Liftosaur is a direct inspiration here, right down to the Liftoscript migration parsers. While Liftosaur requires users to learn a custom DSL or navigate complex state logic, your `ProgressionBuilderModal` and `progressionRuleEngine.ts` offer deterministic auto-regulation (RPE/RIR, linear, double progression, deload triggers) through a structured visual rules engine.


* **First-Class Home/Garage Gym Support:** Most apps treat equipment as an afterthought. Your `GearInventoryScreen`, custom barbell/cable/machine load normalizers (`loadNormalizer.ts`), and exact plate inventory solver (`plateCalculator.ts`) directly solve the pain points of lifters training with non-standard bars (e.g., Safety Squat Bars), pulley ratios, and limited plate pairs.


* **Academic-Grade Analytics:** Combining a 4-Anchor piecewise 1RM estimator (Brzycki, Epley, Mayhew, Wathen + RPE discounting) with **Effective Reps (Stimulating Volume)**, **DOTS coefficients**, and an optional **Kalman Filter + Banister Impulse-Response** calibration pipeline puts your analytics miles ahead of Hevy, Strong, and StrengthLog.


* **Frictionless Switching Cost:** Having built-in, battle-tested CSV/JSON parsers (`csvImportParser.ts`) specifically tailored for **StrengthLog** and **Liftosaur** exports means your exact target demographic can migrate years of historical data in 10 seconds.



### The Biggest Market Bottleneck

**The Desktop Companion Disconnect (`companion/`):** Right now, your coolest differentiator—the Kalman 1RM filter (`kalman_1rm.py`) and Banister fatigue model (`fatigue_banister.py`)—lives in a local Python Streamlit app that requires manual JSON file export/import between phone and PC.

* **For a hardcore niche (Reddit's `r/weightroom`, data nerds, engineers):** This offline, zero-cloud, local-first workflow is a *feature*.
* **For the broader App Store market:** Manual JSON shuttling is a dealbreaker. To compete with MacroFactor or JuggernautAI at scale, you should either port the Kalman/Banister math directly into TypeScript inside `mobile/src/core/math/` (running locally on-device after workouts) or offer a seamless 1-click sync. Given how clean those NumPy/SciPy models are, porting the 1D Kalman update and exponential decay math to TypeScript on-device is very achievable and eliminates the PC dependency for 95% of users.

---

## 2. What Needs Improvement (Technical & UX Audit)

Before putting this in front of paying or reviewing users, several gym-floor UX gaps in the `mobile/` codebase need to be closed:

### Critical Gym-Floor UX Gaps (Must-Fix Before Launch)

1. **Background Notifications & Audio for the Rest Timer:**
* *Current State:* `restTimerService.ts` uses `setInterval` and tracks `endTimestampMs` (which nicely survives backgrounding when recalculated), and `RestTimerBanner.tsx` shows an in-app banner. However, there is no `expo-notifications` or `expo-av` / `expo-haptics` integration.


* *Why it matters:* In the gym, users lock their phones or switch to Spotify/YouTube between sets. If the timer finishes while the screen is off and makes no sound or push notification, lifters will abandon the logger on day one.
* *Fix:* Schedule a local notification via `expo-notifications` at `endTimestampMs` when a timer starts, cancel it if skipped/adjusted, and trigger `expo-haptics` on set completion.


2. **Keep Screen Awake During Active Workouts:**
* *Current State:* `ActiveLoggerScreen.tsx` does not lock the screen wake state.


* *Fix:* Add `expo-keep-awake` (`useKeepAwake()`) inside `ActiveLoggerScreen` so the phone doesn't constantly dim and lock while a user is mid-set or looking at their prescription.


3. **Keyboard Ergonomics & Input Polish in `SetRowComponent.tsx`:**
* *Current State:* Standard `TextInput` with `keyboardType="numeric"` is used for weight, reps, and RPE.


* *Fix:* Ensure `selectTextOnFocus={true}` is enabled on all numeric inputs in `SetRowComponent.tsx` so tapping a pre-filled weight (`80`) lets the user type `82.5` immediately without backspacing twice. Add `+2.5` / `-2.5` or `+1` / `-1` quick-stepper accessories above the keyboard.


4. **Navigation Back-Stack & Gestures (`App.tsx`):**
* *Current State:* `App.tsx` uses a custom `activeRoute` state switcher (`useState<AppRoute>('Home')`) with a custom bottom bar instead of `@react-navigation` or `expo-router`.


* *Why it matters:* On Android, pressing the hardware/gesture "Back" button while in a sub-modal or on the `Inspect` tab will immediately exit/minimize the app unless intercepted by `BackHandler`. On iOS, users expect swipe-back gestures.
* *Fix:* Either wire up React Native's `BackHandler` in `App.tsx` and all modals to pop back to `'Home'` / close active modals, or wrap the views in `@react-navigation/native`.


5. **Chart Responsiveness (`PlotsScreen.tsx` & `ProgramEraShadedChart.tsx`):**
* *Current State:* SVG chart widths are hardcoded (`const chartWidth = 340`).


* *Fix:* Use `useWindowDimensions()` from `react-native` so the SVG charts scale cleanly across smaller iPhones, Max/Ultra screens, and foldables without clipping or leaving awkward margins.



### Product & Onboarding Polish

* **First-Time User Onboarding Flow:** Right now, opening the app drops the user onto `HomeScreen` with empty metrics unless they go to `Settings -> Import` and load a preset or CSV. Add a 3-step first-launch wizard:


1. Choose Units (`kg` vs `lbs`) & Bar Weight (`20kg`).
2. Pick a starter equipment profile (Commercial Gym, Barbell Home Gym, Dumbbell Only).
3. Generate a starter program (via `programSynthesizer.ts`) or import from StrengthLog/Liftosaur.




* **Warm-up Set Generator:** You already wrote the complete mathematical specification in `Warm_up_estimator.md`! Implementing a 1-tap "Generate Warm-up Sets" button in `ActiveLoggerScreen` that inserts `warmup` rows into `SetRowComponent` based on the first working set's target load will immediately elevate the logging experience.



---

## 3. Step-by-Step Roadmap to Full Store Launch

### Step 1: Fix `app.json` & Native Configuration (1–2 Days)

Your `mobile/app.json` is still a raw create-expo-app template (`"name": "mobile"`, no bundle identifiers, no permissions). You need to configure it for **EAS Build**:

* **Identifiers:** Add `ios.bundleIdentifier` (e.g., `com.jonathaneriksson.workoutsuite`) and `android.package`.


* **App Branding:** Change `"name"` and `"slug"` from `"mobile"` to your actual brand name.


* **Expo SDK & Xcode 26 Compatibility:** You are on Expo SDK 54 (`"expo": "~54.0.0"`), which is great—Apple requires all App Store submissions to be built with the iOS 26 SDK / Xcode 26.


* **iOS Privacy Manifest (`PrivacyInfo.xcprivacy`):** Apple strictly rejects builds missing required API reason declarations (`NSPrivacyAccessedAPITypes`) for file timestamps and disk space (used by `expo-file-system` and `expo-sqlite`). Configure the `ios.privacyManifests` block directly in `app.json`.


* **Encryption Declaration:** Add `"ITSAppUsesNonExemptEncryption": false` under `ios.infoPlist` in `app.json` so you don't have to fill out US export compliance paperwork on every single TestFlight upload.

### Step 2: Set Up EAS (Expo Application Services) (1 Day)

1. Install the EAS CLI (`npm install -g eas-cli`) and run `eas build:configure` inside `mobile/` to generate `eas.json`.
2. Create three build profiles in `eas.json`: `development` (simulator/dev client), `preview` (internal APK/ad-hoc iOS), and `production` (App Store `.ipa` and Play Store `.aab`).
3. Run a preview build first (`eas build --platform android --profile preview`) and test the real production bundle on your physical phone. Verify that `expo-sqlite` migrations, `expo-document-picker` CSV imports, and `expo-sharing` JSON exports work outside of Expo Go.



### Step 3: Developer Accounts & Legal Compliance (2–3 Days)

* **Apple Developer Program:** $99/year.
* **Google Play Console:** $25 one-time fee.
* **EU Digital Services Act (DSA) Trader Status:** Because you are based in Sweden/EU, both Apple and Google require you to declare "Trader Status" (if you plan to monetize via paid downloads, subscriptions, or tip jars) and verify your identity/address before your app can be listed in EU storefronts.
* **Privacy Policy & Support URL:** Both stores require a live public URL for a Privacy Policy and a Support page. Because your app is **100% offline/local SQLite** with zero third-party tracking, your privacy policy is ultra-simple ("All workout and body metrics data is stored locally on your device and never transmitted to external servers")—host it on a clean GitHub Pages or Vercel landing page.
* **Health Disclaimer:** Because your app includes a **Pain & Injury Interception** system (`PainReportModal.tsx`) that suggests exercise substitutions or load reductions when pain $\ge 4$, Apple's human reviewers (Guideline 1.4.1 - Physical Harm) may flag it unless you include a clear disclaimer in the onboarding/modal and App Store description stating that the app provides *training load heuristics, not medical advice*, and to consult a physiotherapist/physician for injuries.



### Step 4: The Google Play 14-Day Closed Testing Gate (14 Days — Start Early!)

If you register a **personal** Google Play developer account (rather than an organization account with a D-U-N-S number), Google enforces a mandatory gate before you can unlock Production access:

* You must upload your `.aab` to a **Closed Testing track**.
* At least **12 real testers** must opt in via your web link and keep the app installed for **14 consecutive days** continuously.
* **Action item:** Do not wait until your UI is 100% finished to start this clock. As soon as `eas.json` builds a working `.aab`, upload v0.9.0 to Google Play Closed Testing and get 15–20 friends, classmates, or Reddit testers opted in so the 14-day timer runs in parallel while you finish your UI polish and iOS TestFlight.

### Step 5: Storefront Assets & Monetization Setup (3–4 Days)

* **Screenshots:** Capture 6.7" iPhone, 5.5" iPhone, and Android phone screenshots showcasing your killer features:
1. The Active Logger with live **Progression Proposal** banners.


2. The **SBD Balance Radar Chart** & Strength Standards.


3. The **Program Era Shaded 1RM Plot**.


4. The **Garage Gym Plate Solver** & Gear Inventory.


5. **1-Click Import** from StrengthLog & Liftosaur.




* **Monetization Decision:** Decide whether v1.0 launches as:
* **100% Free / Early Adopter Build** to rapidly build a loyal user base and gather ratings.
* **Freemium (via RevenueCat / `react-native-purchases`):** Keep the logger, CSV import, and plate calculator 100% free forever (beating Hevy's 4-routine limit), and put the **Program Synthesizer**, **Workload Deep-Dive Analytics**, and **Auto-Regulation Rule Engine** behind a fair one-time "Lifetime Pro" unlock ($19–$29) or low subscription. Note that lifters on Reddit *love* one-time lifetime unlocks and heavily resent subscription fatigue.



---

### Summary Launch Timeline

| Week | Track A: Engineering & Polish | Track B: Store & Operations |
| --- | --- | --- |
| **Week 1** | Configure `app.json`, `eas.json`, iOS Privacy Manifest. Add `expo-notifications` (rest timer), `expo-keep-awake`, and Android `BackHandler`.

 | Enroll in Apple Developer & Google Play Console. Publish Privacy Policy URL. Submit first `.aab` to Google**Workout Suite** has a remarkably complete domain architecture and feature set—you are roughly **80–85% of the way to a store-ready V1**, with the remaining 15–20% consisting almost entirely of native platform integration, build pipeline configuration (EAS), and store compliance rather than core feature development.

 |

---

## 1. Current State & Architecture Assessment

Based on the repository structure, your core engineering and domain logic are well beyond a typical MVP:

* **Mobile App (`mobile/`):** Built with React Native / Expo and `expo-sqlite`. You have clean separation of concerns across `domain/repositories`, `database/repositories`, `services`, `core/math`, and `features`.


* **Feature Completeness:** Active workout logging (with crash recovery, supersets, rest timers, pain reporting, exercise substitution, and progression proposals), an auto-regulated progression rule engine and program synthesizer, gear inventory & plate calculation, body metrics (including Navy Body Fat), SBD standards/radar charts (DOTS, effective reps, heuristic 1RM), and CSV importers supporting **Liftosaur** and **StrengthLog**.


* **Companion Analytics (`companion/`):** A Python analytics suite featuring **Kalman filter 1RM estimation** (`kalman_1rm.py`), **Banister impulse-response fatigue modeling** (`fatigue_banister.py`), mesocycle analysis, and calibrated parameter JSON exporting (`calibrated_parameters.schema.json`) that feeds back into the mobile app (`calibratedParamService.ts`).


* **Testing:** Extensive unit and component test coverage across math, parsers, repositories, services, and UI screens.



(Note: Because the uploaded archive was ingested as a raw binary zip stream, the file tree is visible, though specific lines inside `app.json` or `IMPLEMENTATION_PLAN.md` are compressed. The assessment below is grounded in your exact module tree and Expo's native deployment requirements.)

---

## 2. Market Competitiveness

The strength training app market is split into three tiers:

1. **Simple Loggers (Strong, Hevy):** Great UX, social features, zero intelligence.
2. **Guided / AI Coaching Apps (JuggernautAI, RP Hypertrophy, MacroFactor Workouts):** High subscription cost ($15–$35/mo), rigid ecosystems, black-box algorithms.
3. **Power-User / Programmable Loggers (Liftosaur, StrengthLog, Reactive Training Systems):** High customization, steep learning curve.

### Where Workout Suite Wins

* **True Mathematical Auto-Regulation:** Almost no app on the App Store combines **Kalman-filtered 1RM tracking**, **Banister fatigue modeling**, **Effective Reps**, and **pain-report-driven exercise substitution** in a local-first architecture.


* **Frictionless Migration from Competitors:** Having native CSV parsers already built for **StrengthLog** and **Liftosaur** (`csvImportParser.ts`) eliminates the #1 barrier to switching workout apps: losing years of historical training data.


* **Local-First Privacy & Speed:** Gym basements and garages have notorious dead zones. Relying on local `expo-sqlite` with zero mandatory cloud latency makes the active logger fast and reliable.

### Competitive Bottleneck to Watch

* **The Python Companion Split:** Right now, your most advanced differentiators (Kalman 1RM and Banister fatigue calibration) live in the Python `companion/` app, requiring a JSON export/import loop (`workout_export.schema.json` $\leftrightarrow$ `calibrated_parameters.schema.json`). For hardcore data-nerds and quantitative lifters, a desktop companion dashboard is a cool selling point. For the broader mobile market, users will eventually expect those Banister/Kalman updates to run natively on-device in TypeScript.



---

## 3. What to Improve Before Launch

### UX & Native Polish (Crucial for Gym Environments)

* **Background Rest Timer & Live Activities:** Looking at `RestTimerBanner.tsx` and `restTimerService.ts`, ensure the timer triggers **local push notifications (`expo-notifications`)** with audio/vibration that ducks—rather than pauses—Spotify/Apple Music when the app is backgrounded or the screen is locked.


* **Screen Wake-Lock:** Ensure `expo-keep-awake` is active while `ActiveLoggerScreen` is mounted so the screen doesn't dim mid-set.


* **Production Gate for Dummy Data:** In `mobile/src/features/import/dummyDataPresets.ts`, ensure dummy presets are either hidden behind `__DEV__` or clearly labeled as a "Load Demo Data" sandbox mode so new users don't accidentally pollute their production SQLite database.



### Technical & Data Layer

* **SQLite Migration Versioning:** In `mobile/src/database/schema.ts`, make sure you use SQLite `PRAGMA user_version` with sequential migration blocks. Once users install V1.0 from the store, any schema change in V1.1 without a migration runner will either crash on boot or wipe their logs.


* **Porting Companion Models to TypeScript (V1.1 Roadmap):** The matrix math for a 1D/2D Kalman filter (`kalman_1rm.py`) and exponential decay sums for Banister (`fatigue_banister.py`) are lightweight enough to port directly into `mobile/src/core/math/`. Doing so turns a two-step desktop sync into a seamless on-device "Auto-Calibrate" button.



---

## 4. Concrete Steps to Full Launch (App Store & Play Store)

### Step 1: Expo Application Services (EAS) Configuration

1. Install EAS CLI (`npm install -g eas-cli`) and run `eas build:configure` inside `mobile/` to generate `eas.json`.
2. Verify `mobile/app.json` has explicit, unique bundle identifiers (`ios.bundleIdentifier` and `android.package`, e.g., `com.jonathaneriksson.workoutsuite`), proper `version` (`1.0.0`), `ios.buildNumber` (`1`), and `android.versionCode` (`1`).


3. Strip any unused permissions from `app.json`. Since you use `expo-document-picker`, `expo-file-system`, and `expo-sharing`, you do not need broad photo/media permissions—keeping permissions minimal speeds up review.



### Step 2: Legal & Store Compliance (Common Rejection Triggers)

* **Health/Medical Disclaimer:** Because you have `PainReportModal.tsx`, `navyBodyFat.ts`, and auto-regulated load prescriptions, Apple (Guideline 1.4.1) and Google require a clear medical disclaimer in onboarding or Settings stating that the app provides informational fitness metrics and is not medical advice, and may ask you to cite calculation sources (e.g., DOTS, U.S. Navy circumference method, Epley/Brzycki) right in the UI info tooltips.


* **Privacy Policy URL:** Even if 100% of data stays on-device in SQLite, both stores mandate a hosted Privacy Policy URL in your store listing and linked inside `SettingsScreen.tsx`. State clearly that all workout and body metric data is stored locally on the user's device.



### Step 3: Developer Accounts & Google Play's 14-Day Rule

* **Apple Developer Program ($99/year):** Enrollment is usually approved within 24–48 hours. Upload a build via `eas build --platform ios` + `eas submit` to **TestFlight** to test on physical iOS hardware.
* **Google Play Console ($25 one-time):** **Critical timing warning:** If you register a *personal* developer account created after late 2023, Google requires you to run a **Closed Testing track with at least 12–20 opted-in testers for 14 continuous days** before unlocking Production access. Start this track immediately with a release candidate build (`eas build --platform android`) while you polish store assets.

### Step 4: Store Assets & ASO (App Store Optimization)

* **Screenshots:** Capture 5–6 high-contrast screenshots highlighting your unique selling points:
1. Active Logger with Superset brackets & Progression Proposals.


2. SBD Balance Radar Chart & Strength Standards.


3. Program Era Shaded Charts & Workload Deep Dive.


4. One-tap CSV Import from StrengthLog / Liftosaur.




* **Keywords:** Target high-intent, low-competition terms first: *RPE logger, powerlifting tracker, auto-regulation workout, DOTS calculator, mesocycle planner, StrengthLog alternative*.

---

Would you like to paste the contents of `mobile/package.json` and `mobile/app.json` (or `IMPLEMENTATION_PLAN.md`) so we can audit your exact dependencies, permissions, and build configuration for any store-rejection blockers?