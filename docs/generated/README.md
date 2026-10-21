# Generated repository maps

From the repository root (PowerShell 7+):

```powershell
./scripts/generate_repo_inventory.ps1
./scripts/generate_repo_inventory.ps1 -Check
```

- `FILE_INVENTORY.md`: sorted current file paths; generated indexes exclude themselves.
- `DECISION_INDEX.md`: ADR IDs and titles extracted from `docs/DECISIONS.md`; search it and read just the matching record.

The generator prunes Git metadata, dependencies, virtual environments, caches, and build directories **before** descending into them, and skips directory symlinks/junctions. It excludes compiled Python/TypeScript cache files. The exact exclusions are in the script. Paths are normalized to forward slashes; outputs have deterministic ordering and no timestamps. `-Check` reads without changing files and fails if either output is missing or stale.

This is a checkout inventory, including untracked files outside the exclusions; it is not a list of tracked Git files. No reliable cross-language symbol/dependency graph generator is configured. Use `rg` and [CODEMAP.md](../CODEMAP.md) for symbol navigation. Static dependency information cannot establish dynamic runtime behavior. Historical decision entries do not establish current implementation or pending work.
