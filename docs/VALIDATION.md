# Validation guide

Choose checks from the actual behavior changed and its callers. Run focused checks during iteration, then the required final checks once after the last relevant edit. Broaden after failures, shared impact, or uncertainty; do not repeat successful suites without a new reason. Keep all existing regression tests available.

## Select the scope

| Change | Required validation |
| --- | --- |
| Documentation/maps only | Check affected paths, symbols, and Markdown links. Regenerate indexes if paths or ADR headings change; run the generator with `-Check`. No application test suite is needed. |
| Isolated mobile UI/service/math | Related tests including callers affected by behavior changes, plus mobile typecheck once after the final code edit. Search imports/callers as well as matching filenames. |
| Shared mobile types, context, repository interfaces, schema/migrations, dependencies, compiler/Jest configuration, or broad refactor | Full mobile Jest suite and typecheck. Add contract checks when exported data is affected. |
| Isolated companion model/analysis/UI | Related pytest modules and tests of downstream consumers; strict mypy once after the final code edit. |
| Shared companion ingestion/models, dependencies, test configuration, or broad refactor | Full companion pytest and mypy. Add contract checks when exchange behavior changes. |
| Cross-stack payload, schema, serialization, calibration, or load semantics | Ordered contract checks below plus affected producer/consumer behavior tests and typechecks. Broad shared changes also require both full suites. |
| Release/merge readiness for accumulated feature work | Full tests and typechecks in each changed workspace, plus ordered contract checks for exchange changes. Validate platform-dependent behavior on a device/emulator when affected. |

If impact cannot be bounded confidently, run the full suite in the affected workspace. A large dirty working tree is not automatically part of an isolated task; state which changes were checked and which belong to other work. Focused results are not evidence that the entire project passes.

## Mobile commands (working directory `mobile/`)

```powershell
# Exact test file (add related caller test paths as needed)
npm test -- --runInBand --runTestsByPath src/core/math/__tests__/effectiveReps.test.ts
# Dependency-aware selection for source imports; inspect selection before trusting scope
npm test -- --runInBand --findRelatedTests src/core/math/effectiveReps.ts
# Static check
npm run typecheck
# Full regression
npm test -- --runInBand
```

`npm run lint` currently executes the same `tsc --noEmit` as `typecheck`; run one, not both. `--runInBand` avoids spawning multiple Jest workers during local agent validation; it is not a measured universal speed improvement. Jest related-test discovery only sees static dependencies: include tests manually for dynamic loading, source-text assertions, database behavior, and native integration. Do not use a pass-with-no-tests option to hide an empty selection.

## Companion commands (working directory `companion/`)

```powershell
# Focused tests; add downstream modules as needed
.\.venv\Scripts\python.exe -m pytest tests/test_hypertrophy_signals.py -q
# Static check
.\.venv\Scripts\python.exe -m mypy src
# Full regression
.\.venv\Scripts\python.exe -m pytest -q
# Diagnose slow tests only when needed
.\.venv\Scripts\python.exe -m pytest --durations=10 -q
```

Python has no configured automatic affected-test selector. Choose explicit modules using the codemap, imports, and callers. For example, recovery or fatigue changes can affect mesocycle analysis, parameter exports, and UI smoke tests. On POSIX, use `.venv/bin/python` for the same commands.

## Ordered cross-stack contract checks

1. In `mobile/`, run:

   ```powershell
   npm test -- --runInBand --runTestsByPath src/services/__tests__/exportService.test.ts src/services/__tests__/calibratedParamService.test.ts
   ```

2. After mobile completes, in `companion/`, run:

   ```powershell
   .\.venv\Scripts\python.exe -m pytest tests/test_schemas.py tests/test_exporter.py -q
   ```

The mobile export suite **writes** `schemas/fixtures/sample_workout_export.json`. Review that diff and preserve intentional contract changes; do not run producer/consumer checks concurrently against this shared file. When the full mobile suite has already run after the final code edit, its producer checks need not be repeated before Python validation.

## Documentation/index checks (repository root)

```powershell
./scripts/generate_repo_inventory.ps1
./scripts/generate_repo_inventory.ps1 -Check
```

Generated inventory excludes dependency/cache/build directories before descending into them. Search the generated decision index to locate ADR headings instead of reading the full historical log. No test/lint/build command is configured in CI; local results must state what actually ran. Historical test counts and past green status in ADRs/plans are not validation of the current checkout.
