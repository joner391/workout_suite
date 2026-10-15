# Phase 2 Specifications: Set Types, Rest Timer Automations, and Decimal Input Fixes

## 1. Set Type Badges & Cycling
- **Visual Presentation**:
  - Replace abbreviations/numbers with uniform spelled-out labels inside the tappable badge pill:
    - **Working sets**: Display `Reg` (regular work set, neutral/dark gray accent).
    - **Warmup sets**: Display `Warm` (amber accent).
    - **Drop sets**: Display `Drop` (purple accent).
    - **Myo-rep sets**: Display `Myo` (cyan accent).
    - **DC sets**: Display `DC` (Doggcrapp rest-pause, high-contrast accent).
  - Widen the badge pill container (`minWidth: 46px`, `paddingHorizontal: 6px`) so all labels (`Reg`, `Warm`, `Drop`, `Myo`, `DC`) fit cleanly with consistent width and vertical centering.
- **Tapping Interaction & Cycle Order**:
  - Tapping the badge cycles sequentially:
    `Reg -> Warm -> Drop -> Myo -> DC`

---

## 2. Rest Timer Triggers by Set Type
Upon toggling set completion (green checkmark):
- **Drop Set**:
  - 0 seconds rest.
  - Completing a drop set suppresses starting the rest timer banner, and immediately dismisses/cancels any active timer.
- **Myo Set**:
  - Exactly 10 seconds rest.
  - Automatically starts a 10-second rest timer countdown upon set completion.
- **DC Set**:
  - Exactly 30 seconds rest.
  - Automatically starts a 30-second rest timer countdown upon set completion.
- **Working & Warmup Sets**:
  - Retain default behavior: uses the exercise's `default_rest_seconds` (or 90s fallback), respecting superset group rest suppression rules.

---

## 3. Deletion of 'Failure' Set Type & Cross-Stack Schema Alignment (Rule 8.4)
- **SetType Definition**:
  - Purge `'failure'` from the canonical set types. Failure is redundant as it is captured directly via `rpe: 10` or `rir: 0`.
  - Add `'dc'` to the canonical set types:
    `export type SetType = 'warmup' | 'working' | 'drop' | 'myorep' | 'dc';`
- **Cross-Stack Synchronizations**:
  - `mobile/src/core/types/index.ts`: update `SetType` union.
  - `schemas/workout_export.schema.json`: update `set_type` enum to `["warmup", "working", "drop", "myorep", "dc"]`.
  - `companion/src/ingestion/schemas.py`: update `SetType = Literal["warmup", "working", "drop", "myorep", "dc"]`.
- **CSV Ingestion Parsers (`csvImportParser.ts`)**:
  - If an incoming Strong/Hevy CSV contains `f` or `failure`, gracefully map it to `working` with `rpe: 10` / `rir: 0` so legacy imports remain fully functional.

---

## 4. Keyboard Decimal Separator Input Fix ('.' and ',')
- **Problem**:
  - Currently, typing `,` is stripped by regex `text.replace(/[^0-9.]/g, '')`.
  - Furthermore, controlled numeric inputs immediately coerce `62.` or `62,` via `parseFloat("62.") = 62`, causing immediate re-renders that erase the decimal delimiter while typing.
- **Resolution**:
  - Maintain a local string state while an input field is focused.
  - Accept both `.` and `,`, automatically normalizing `,` to `.`.
  - Allow intermediate decimal states (e.g. `"62."` or `"62,"`) without premature rounding or truncation.
  - Apply across all logger numeric inputs:
    - Set row weight input (`SetRowComponent`)
    - Intensity input (`RPE`/`RIR`)
    - Plate calculator targets (`PlateCalculatorModal`)