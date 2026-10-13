# Repository Architecture and Code Map Rules

## Purpose

Maintain an accurate, searchable understanding of the repository so that future development tasks can locate existing functionality without repeatedly exploring the entire codebase.

Architecture documentation and navigation indexes are part of the project, not optional deliverables.

## 1. Required repository maps

Maintain the following artifacts, adapting their locations to the existing repository conventions:

- `AGENTS.md` — repository navigation, development conventions, and instructions for maintaining maps.
- `docs/ARCHITECTURE.md` — high-level architecture, module responsibilities, dependency direction, and primary execution flows.
- `docs/CODEMAP.md` — key files, classes, functions, interfaces, entry points, tests, and extension points.
- `docs/DECISIONS.md` — significant architectural decisions, constraints, and reasons for non-obvious design choices.
- `docs/generated/` — machine-generated file inventories, symbol indexes, and dependency information where supported.

Do not create duplicate documentation if equivalent artifacts already exist. Extend the established structure instead.

## 2. Mandatory maintenance after code changes

After adding, removing, moving, or substantially restructuring code:

1. Identify which architecture maps and indexes are affected.
2. Update the relevant curated documentation.
3. Regenerate any affected machine-generated indexes or graphs.
4. Verify that documented paths, symbols, dependencies, and commands exist.
5. Remove references to deleted or renamed components.
6. Include documentation and index changes in the same commit as the code change when they are necessary for correctness.

Do not update unrelated documentation for trivial changes that do not affect navigation or architecture.

## 3. Architecture documentation requirements

`ARCHITECTURE.md` must describe:

- The project's purpose and major subsystems.
- The responsibility and boundaries of each subsystem.
- The main entry points and execution flows.
- Important dependencies and the permitted direction of dependencies.
- Where configuration, shared types, interfaces, persistence, external integrations, and tests belong.
- The existing extension points for adding features.
- The commands required to build, test, lint, and validate the project.

`CODEMAP.md` must provide actionable navigation guidance:

- Important directories and their responsibilities.
- Key files, classes, functions, and interfaces.
- Where representative existing features are implemented.
- Where new functionality of each major type should be added.
- The relationship between implementation files and their tests.
- Links to more detailed documentation where necessary.

Prefer specific paths and symbol names over vague descriptions.

## 4. Prefer generated facts over manually maintained facts

Generate file inventories, symbol listings, and dependency information from the current source code whenever practical.

Do not manually maintain information that can be reliably extracted from the repository.

Generated artifacts must be reproducible, and their generation process must be documented. Exclude build outputs, dependency directories, caches, virtual environments, and other irrelevant files.

Do not treat a generated dependency graph as proof of runtime behavior when dependencies are dynamic or resolved at runtime.

## 5. Repository exploration protocol

Before implementing a feature:

1. Read the applicable agent instructions.
2. Consult the relevant architecture map and codemap.
3. Search for the existing implementation, related symbols, callers, and tests.
4. Inspect the smallest set of files sufficient to understand the change.
5. Reuse established interfaces, abstractions, and conventions.
6. Expand the search only when the initial evidence is insufficient or contradictory.

Avoid repeatedly rediscovering documented facts. Verify documentation against source code whenever there is reason to suspect it is stale.

## 6. New modules and architectural changes

Whenever a new subsystem, module, public interface, or significant execution path is introduced:

- Document its responsibility and boundaries.
- Record its key entry points and dependencies.
- Identify the intended extension points.
- Link relevant tests and examples.
- Record significant design decisions and constraints.
- Update generated indexes and graphs.

Keep documentation concise and focused on helping a future contributor implement the next feature.

## 7. Validation and completion criteria

A task that changes architecture or repository navigation is not complete until the affected maps are updated and validated.

Where automation exists, verify that:

- Documented file paths resolve.
- Referenced symbols exist.
- Generated artifacts match the current source.
- Documentation links resolve.
- Required generation and validation commands succeed.

Do not claim that maps have been regenerated or validated unless the corresponding commands have actually been executed.

If a map cannot be updated reliably, report what is stale, why it could not be updated, and what remains to be done.

Do not modify source code merely to make documentation appear consistent with an incorrect description. Treat the implementation as authoritative unless the task explicitly changes the architecture.

## 8. Monorepo Execution & Working Directory Rules

To prevent working-directory confusion and dependency bleed in this polyglot monorepo (`mobile/` for React Native Expo TypeScript, `companion/` for Python 3.11+, and `schemas/` for shared JSON contracts), all agents and developers must strictly adhere to the following execution boundaries:

### 8.1 Root Directory (`/`)
- Contains **ONLY** high-level documentation (`docs/`, `*.md`), shared contracts (`schemas/`), and cross-project orchestration.
- **NEVER** run `npm install` or create a `package.json` in the repository root.
- **NEVER** initialize a global Python virtual environment (`.venv`) or `requirements.txt` in the repository root.

### 8.2 Mobile Workspace (`mobile/`)
- All Node/Expo/TypeScript commands (`npm`, `npx`, `tsc`, `jest`) **MUST** be executed with `mobile/` as the working directory (e.g., `cd mobile && npm ...` or via `npm --prefix mobile`).
- Node dependencies, build configurations (`tsconfig.json`, `app.json`, `package.json`), and mobile source code belong strictly within `mobile/`.

### 8.3 Companion Workspace (`companion/`)
- All Python commands (`pip`, `pytest`, `mypy`, `streamlit`) **MUST** be executed using the virtual environment inside `companion/.venv` (e.g., `companion/.venv/bin/...` or `companion\.venv\Scripts\...` on Windows, or from within `companion/` after activating `.venv`).
- Python dependencies, environment files (`pyproject.toml`, `requirements.txt`), tests, and analytics source code belong strictly within `companion/`.

### 8.4 Cross-Stack Changes & Contract Synchronization
- Any change to SQLite tables or export payloads in `mobile/` that affects exported JSON **MUST** be accompanied by a corresponding update to `schemas/*.schema.json` and `companion/src/ingestion/schemas.py` in the same task.
- Automated tests or schema validators must verify cross-stack schema conformity before completing any task that alters data exchange models.