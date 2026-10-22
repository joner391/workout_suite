# Documentation entry point

## Current work and document authority

The active goal is the latest user request in the current chat. This repository has no maintained, authoritative feature backlog; do not infer the next task from old checkboxes. When a user authorizes a multi-step feature, track its remaining work in that task and update relevant maps on completion.

For current behavior, inspect source and tests using [CODEMAP.md](CODEMAP.md). [ARCHITECTURE.md](ARCHITECTURE.md) describes the current system and its boundaries. Proposed behavior requires explicit task scope even when it appears in an old plan.

| Material | Status and when to read |
| --- | --- |
| [AGENTS.md](../AGENTS.md) | Active contributor instructions; small startup guide. |
| [CODEMAP.md](CODEMAP.md) | Current navigation; read the relevant subsystem rows. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Current boundaries and execution flows. |
| [VALIDATION.md](VALIDATION.md) | Current check selection and commands. |
| [PROGRAM_GENERATION_GUIDE.md](PROGRAM_GENERATION_GUIDE.md) | Reproduce the six reviewed program examples from live source, inspect dose/time/protocols and retain provenance. Includes an explicitly unimplemented split-choice proposal. |
| [DECISIONS.md](DECISIONS.md) | Historical rationale; search by topic or ADR number, then read the matching record. [Generated decision index](generated/DECISION_INDEX.md). |
| [TRAINING_AND_BODY_DATA.md](TRAINING_AND_BODY_DATA.md) | Detailed data/metrics reference and gap analysis; verify claims against source for the affected metric. |
| [TRAINING_EVOLUTION.md](TRAINING_EVOLUTION.md) | Current automatic evolution, recovery, pain-return and companion evidence policy; includes operational defaults and persistence. |
| `implementation_plans/` | Historical designs, audits, and proposals with mixed completion status. Old execution rules and verification gates are inactive. |
| `training_philosophies/` | Scientific/theoretical background; read only for an affected algorithm. Proposals here do not establish implemented behavior. |
| [Goal-aware generation analysis](implementation_plans/Goal_aware_program_generation_analysis.md) | Audit and current policy: weekly volume, direct arm/core reservations, Fury variations, advanced targets, antagonist pairing, structured myo/DC and shared scheduling. Personal muscle emphasis and strength back fillers remain separate future work. |
| `archived/` | Superseded sketches and phase notes; historical reference only. |
| [generated/README.md](generated/README.md) | Generated facts and reproduction instructions; search inventories instead of loading them wholesale. |

## Known planning inconsistencies

The historical implementation plan has Phase 9 marked pending in its table but completed in later sections. Exercise preferences and candidate scoring already exist in source. Cloud/Supabase synchronization and social features remain proposals: there is no sync engine in the current source. Old test counts and claims of passing suites describe past runs, not current validation evidence.

Keep historical records for rationale and traceability. Do not repeatedly reconcile every old plan during unrelated development; update the current maps when implementation changes.
