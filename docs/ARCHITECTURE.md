# Workout Suite architecture

Workout Suite is a local-first strength-training tracker with a separate scientific analytics companion. Mobile logging uses SQLite offline; files carry data between the Expo app and Python companion. Cloud sync, Supabase, social leaderboards, and remote coach writes are historical proposals, not current execution paths.

## Subsystems and dependency direction

| Subsystem | Responsibility and boundary |
| --- | --- |
| `mobile/src/features/`, `context/` | React Native screens, navigation, and repository injection. `mobile/App.tsx` composes repositories and the root UI. |
| `mobile/src/services/` | Application use cases: session lifecycle, imports/exports, substitutions, workload analysis, program evolution, and device integrations. Services use repository ports and core logic. |
| `mobile/src/core/` | Shared TypeScript entities, deterministic math, parsers, program generation, and progression rules. Keep calculations independent of React Native and SQLite. |
| `mobile/src/domain/repositories/` | Persistence interfaces consumed by services and screens. |
| `mobile/src/database/` | SQLite connection, schema/migrations, seeds, concrete adapters, and in-memory test adapters implementing the ports. |
| `schemas/` | JSON contracts for workout exports and calibrated parameters, plus a shared example fixture. |
| `companion/src/ingestion/` | Pydantic validation of transferred workout data. |
| `companion/src/models/`, `analysis/` | Adaptive Kalman strength estimation, Banister fatigue/readiness, recovery, mesocycle analysis, hypertrophy signals, volume landmarks, and SFR evaluation. |
| `companion/src/export/` | Calibration orchestration and serialized parameter output. |
| `companion/src/ui/` | Streamlit application and Plotly chart builders; consumes ingestion, analysis, models, and exports. |

Dependency intent: presentation calls services/models; services call core calculations and repository interfaces; SQLite and in-memory adapters implement those interfaces. `App.tsx` is the mobile composition root. Avoid SQL in screens and framework dependencies in domain math. These boundaries are conventions, not checks enforced by a dedicated architecture linter. The Python models depend on scientific libraries and Pydantic; they are not dependency-free.

## Primary execution flows

1. **Startup and logging:** Expo starts through `mobile/index.ts` and `mobile/App.tsx`; database initialization applies migrations and seeds. Repository context exposes adapters to screens. `WorkoutTabRouter` resolves an active session, a program template, or an empty state. `ActiveSessionService` persists set edits and completion through repositories. Crash recovery can resume or discard interrupted workouts. Warm-up adjustment, progression, and rest timing run through services and core rules.
2. **Programs:** profile/questionnaire input feeds `synthesizeProgram`; `candidateScorer` ranks exercises using biomechanical and preference constraints. Program repositories persist templates, exercises, and progression rules. Non-beginner generation/evolution adds effort-adjusted estimated-capacity progression alongside LP/DP/DDP rules, without automatic AMRAP checkpoints. The rule uses median working-set Lombardi e1RM (and its e10RM equivalent), projects to the prescription's base reps and RIR, and caps increases at one floor-rounded implement step. It requires complete work, known effort within 0–3 RIR, and the existing 1–12-rep reliability range; fatigue techniques and effort overshoots are excluded. AMRAP supplies a 0-RIR observation; explicit legacy AMRAP rules remain supported. Existing programs can select the effort-based builder preset or receive the new defaults at evolution. `ProgramEvolutionService` evaluates completed-cycle history and proposes the next mesocycle; transition-wave and diff helpers support review and activation. Load proposals are applied through logger confirmation, rather than claimed as applied by evolution's diff.
3. **Import/export:** `ImportService` parses supported external logs and persists matched workouts/body metrics. `ExportService` serializes SQLite data to the workout export contract and uses Expo file/sharing APIs. Companion validates the transferred JSON with `WorkoutExportPayload`.
4. **Analysis:** `companion/src/ui/app.py` loads workout data; model and analysis modules derive strength/endurance, fatigue/readiness, recovery, mesocycle recommendations, landmarks, and audits. Plotly builders render the results. Tier 1 mobile strength calculations are immediate heuristics; Tier 2 companion estimates use longitudinal adaptive models.
5. **Calibration round trip:** `param_exporter.py` builds calibrated parameter JSON; mobile `CalibratedParamService` validates/imports it into local persistence. This transfer is file-based, with no background cloud synchronization.

## Persistence, configuration, and integrations

Mobile navigation separates recent training from athlete setup. Home uses `loadTrainingOverview` for rolling local-calendar 7/14-day windows, comparisons, completed-session drill-downs, and rep PRs against earlier completed sessions with matching equipment. The period preference is stored in user settings. Home and Workout preflight share next-template selection and prescription rendering through `workoutPreviewService` and `WorkoutPrescription`; progression results are labeled suggestions and remain subject to logger confirmation. Program management is accessible from Workout, Home, and Profile through the root program hub without unmounting an active logger. Profile provides direct records, SBD/DOTS, gear, and body-metric destinations plus separate editors for training preferences, personal details, and equipment access. `mergeProfileEditorChanges` preserves unrelated profile fields and stages training changes for the next cycle. SBD history uses running best lift estimates and bodyweight recorded on or before each session; estimated totals/DOTS are labeled separately from tested or competition results.

SQLite is the mobile source of truth, including active workouts. Keep canonical loads in kilograms and convert at presentation boundaries; preserve raw versus effective load semantics for gear, per-hand, assisted, and bodyweight exercises. Schema DDL and versioned migrations live in `mobile/src/database/schema.ts`; defaults live in `database/seeds/`. Types live in `core/types/index.ts`; persistence ports live in `domain/repositories/`.

Mobile configuration is in `mobile/app.json`, `package.json`, `tsconfig.json`, and `jest.config.js`. Expo adapters provide SQLite, document selection, files/sharing, haptics, and notifications. Companion dependencies and pytest/mypy settings live in `companion/pyproject.toml`, with runtime dependencies also in `requirements.txt`. Use only its local `.venv`.

Exchange changes must synchronize mobile payload/types, `schemas/*.schema.json`, and companion Pydantic models. The mobile export test writes the shared fixture; Python then validates it against both JSON Schema and Pydantic. Run those checks in that order. There is currently no repository CI workflow, dedicated ESLint configuration, or configured native production build script.

## Extension and validation

Add UI within the relevant feature slice, calculations in core/models, orchestration in services/export, and persistence behind repository interfaces with both SQLite and test adapters as needed. [CODEMAP.md](CODEMAP.md) links representative implementations and their tests. Add significant architectural rationale to [DECISIONS.md](DECISIONS.md); historical proposals do not change these boundaries.

Use [VALIDATION.md](VALIDATION.md) for scoped tests, contract verification, full regression gates, and documentation checks. Mobile dev commands (working directory `mobile/`): `npm install`, `npm start`, `npm run android`, `npm run ios`, `npm run web`. The latter commands start Expo for the chosen target. Companion dashboard (working directory `companion/`): `.\.venv\Scripts\python.exe -m streamlit run src/ui/app.py`. See workspace READMEs for environment setup. Run platform/device checks when a change depends on native behavior; mocked unit tests cannot establish that behavior.
