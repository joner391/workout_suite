# Workout Suite contributor instructions

## Start with the current task

The latest user request defines the active goal. Historical phase numbers, unchecked plan items, and ADRs do not assign work. Preserve unrelated working-tree changes.

1. Read [docs/README.md](docs/README.md) for document status and priorities.
2. Consult only the relevant rows of [docs/CODEMAP.md](docs/CODEMAP.md); read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) when boundaries or flows matter.
3. Search the named implementation, callers, and tests with `rg`; inspect the smallest sufficient set of files. Expand only if evidence is missing or contradictory.
4. Select checks using [docs/VALIDATION.md](docs/VALIDATION.md). Do not run every suite after every edit.

Search historical plans, research, and [docs/DECISIONS.md](docs/DECISIONS.md) only for task-specific rationale. Do not load them all at startup or follow their old agent execution instructions. Source code is authoritative for implemented behavior; verify stale descriptions against it.

## Workspace boundaries

- Root: high-level documentation, `schemas/`, and cross-project orchestration only. Never run `npm install`, create `package.json`, or initialize a Python environment or `requirements.txt` here.
- `mobile/`: all Node, Expo, TypeScript, npm, npx, and Jest commands must run with this working directory (or `npm --prefix mobile`). Keep mobile code, configuration, and dependencies here.
- `companion/`: all Python, pip, pytest, mypy, and Streamlit commands must use `companion/.venv`; keep Python source, tests, and dependencies in this workspace.
- SQLite/export changes affecting exchanged JSON must update `schemas/*.schema.json` and `companion/src/ingestion/schemas.py` together and pass cross-stack contract checks. See the ordered commands in `docs/VALIDATION.md`.

## Architecture and navigation maintenance

Maintain these established maps without duplicating them:

- `docs/ARCHITECTURE.md`: purpose, subsystem responsibilities and boundaries, dependency direction, primary execution flows, configuration, persistence, integrations, extension points, and links to build/test commands.
- `docs/CODEMAP.md`: actionable paths and key symbols, entry points, representative features, related tests, and extension points.
- `docs/DECISIONS.md`: significant design constraints and reasons for non-obvious choices; historical records are read on demand.
- `docs/generated/`: reproducible file and decision indexes; see its README for exclusions and limitations.

After adding, removing, moving, or substantially restructuring code:

1. Update only affected curated maps; remove stale paths/symbols and document new responsibilities, dependencies, interfaces, flows, tests, and extension points.
2. Regenerate affected indexes from root with `./scripts/generate_repo_inventory.ps1`. Prefer generated inventories over manually maintained trees. Do not treat static dependencies as proof of dynamic runtime behavior.
3. Verify documented paths, symbols, links, and commands. Run `./scripts/generate_repo_inventory.ps1 -Check` to check generated files.
4. Include necessary documentation/index changes in the same commit as code. Do not refresh unrelated documents for trivial changes.

Navigation/architecture work is incomplete until affected maps are updated and validated. Report any stale map, failed command, and remaining work honestly; never claim checks you did not execute. Do not change source merely to match incorrect documentation.
