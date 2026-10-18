This implementation plan is structured into **6 modular, zero-ambiguity phases** optimized for execution by **Gemini Flash**. Each phase has strict file-boundary isolation, explicit mathematical formulas, and concrete validation gates so you can feed them sequentially (or as parallel sub-tasks) into your coding agent without hitting context drift.

---

## Architectural Guardrails for the Coding Agent

* **Zero SQLite Schema Breaking Changes:** Do not alter existing mandatory columns in `workout_sets`, `workouts`, `body_metrics`, `pain_reports`, or `exercises`. All new hypertrophy signals must be derived from existing fields (`created_at`, `set_type`, `rpe`/`rir`, `reps_right`, `parent_exercise_id`, circumferences).


* **Backwards-Compatible Data Contract:** Any additions to `schemas/calibrated_parameters.schema.json` must use optional/nullable fields with sensible defaults so older Mobile Tracker builds do not crash on import.


* **Vectorized Computation:** Implement all Companion Suite equations in Python 3.11+ using vectorized NumPy/Pandas/SciPy operations (`companion/src/`).



---

## Phase 1: Hypertrophy Signal Extraction & Intra-Session Kinetics

**Target Files:** `companion/src/analysis/hypertrophy_signals.py` *(new)*, `companion/tests/test_hypertrophy_signals.py` *(new)*

**Objective:** Extract effective hypertrophic repetitions ($e\text{Reps}$), implicit rest intervals ($\Delta t_{\text{rest}}$), multi-set fatigue drop-off, and rolling e10RM trajectories from raw `WorkoutSet` logs.

### 1.1 Mathematical Specifications

1. **Effective Repetitions ($e\text{Reps}$) per Set:**
Exclude sets where `set_type == 'warmup'`. Resolve $\text{RIR} = 10.0 - \text{RPE}$ (defaulting unrated working sets to $\text{RIR} = 2.0$, and `amrap` sets to $\text{RIR} = 0.0$):


* For `working` sets:



$$e\text{Reps}_{\text{set}} = \min\left(\text{reps}, \, \max(0.0, \, 5.0 - \text{RIR})\right)$$


* For `myorep`, `drop`, or `dc` sets where implicit rest $\Delta t_{\text{rest}} \le 45\text{s}$:



$$e\text{Reps}_{\text{set}} = \min\left(\text{reps}, \, \max(0.0, \, 5.0 - \text{RIR}) + 0.5 \cdot \max(0, \, \text{reps} - 5)\right)$$




2. **Implicit Inter-Set Rest Interval ($\Delta t_{\text{rest}}$):**
Sort sets within a `workout_id` by `created_at`. For consecutive sets $i-1$ and $i$ of the same `exercise_id` (or shared `exercise_group_id`):



$$\Delta t_{\text{rest}, i} = \max\left(0, \, (\text{created\_at}_i - \text{created\_at}_{i-1}) - t_{\text{TUT}} \right)$$



where estimated time under tension $t_{\text{TUT}} = 3.0 \times \text{reps}_i$ seconds.
3. **Intra-Exercise Multi-Set Fatigue Decay ($\delta_{\text{drop}}$):**
Using the athlete's calibrated $k_t$ (or prior $k_0 = 0.10$) from `kalman_1rm.py`, compute the set-level e1RM for all working sets $s \in \{1 \dots N\}$ of an exercise in a session:



$$\text{e1RM}_s = w_s \cdot (\text{reps}_s + \text{RIR}_s)^{k_t}$$



Calculate the fractional drop-off slope across sets $s = 1 \dots N$ (for $N \ge 2$):

$$\delta_{\text{drop}} = \frac{\text{e1RM}_1 - \text{e1RM}_N}{\text{e1RM}_1 \cdot (N - 1)}$$


4. **Hypertrophy-Specific Benchmark ($\text{e10RM}_t$):**
Using the Kalman state vector $\mathbf{x}_t = [\ln(\text{1RM}_t), k_t]^T$, project the athlete's true 10-Repetition Maximum capacity:



$$\text{e10RM}_t = \exp(x_{0, t}) \cdot 10^{-k_t}$$



### 1.2 Verification Gate

* Unit test verifying `warmup` sets yield $0$ $e\text{Reps}$, an 8-rep set @ RPE 8 ($\text{RIR } 2$) yields $3.0$ $e\text{Reps}$, and an 8-rep set @ RPE 10 ($\text{RIR } 0$) yields $5.0$ $e\text{Reps}$.
* Unit test confirming `created_at` ISO 8601 timestamps 150 seconds apart on a 10-rep set yield $\Delta t_{\text{rest}} = 120\text{s}$.



---

## Phase 2: Muscle-Group Partitioned Banister & Volume Landmark Estimator

**Target Files:** `companion/src/analysis/muscle_landmarks.py` *(new)*, `companion/src/analysis/fatigue_banister.py` *(modify)*, `companion/tests/test_muscle_landmarks.py` *(new)*

**Objective:** Split systemic Banister readiness into 12 localized muscle-group readiness scores and empirically solve for individualized `[MEV, MAV, MRV]` landmarks per muscle group.

### 2.1 Mathematical Specifications

1. **Muscle Volume Credit Routing:**
For every completed non-warmup set, assign direct volume ($1.0 \times e\text{Reps}_{\text{set}}$ and $1.0 \text{ fractional set}$) to `exercises.muscle_group`, and indirect volume ($0.5 \times e\text{Reps}_{\text{set}}$ and $0.5 \text{ fractional set}$) to each muscle in `exercises.secondary_muscles`.


2. **Category-Weighted Systemic vs. Local Fatigue:**
Define axial/systemic fatigue multiplier $m_{\text{sys}}$ by `exercises.category` and `is_compound`:


* `Barbell` + `is_compound == 1`: $m_{\text{sys}} = 1.35$
* `Dumbbell` / `Bodyweight` + `is_compound == 1`: $m_{\text{sys}} = 1.00$
* `Machine` / `Cable` or `is_compound == 0`: $m_{\text{sys}} = 0.65$
Run lightweight localized EWMA ODEs per muscle group $m \in \{1 \dots 12\}$ using local recovery time constant $\tau_{2, m} = 0.65 \cdot \tau_2(t)$ (since local peripheral recovery is faster than systemic CNS recovery $\tau_2(t)$).




3. **Empirical Bayesian Volume Landmarks (`MEV`, `MAV`, `MRV`):**
Aggregate weekly direct+indirect fractional sets $V_{m, w}$ and weekly mean $\text{e10RM}_{m, w}$ slope ($\Delta \ln(\text{e10RM}_{m, w})$) per muscle group $m$:
* **Population Priors (Sets/Week):** $\text{MEV}_0 = 6.0, \, \text{MAV}_0 = 14.0, \, \text{MRV}_0 = 20.0$.
* Fit a quadratic dose-response curve over historical mesocycle weeks ($w$) when $\ge 6$ weeks of data exist for muscle $m$:

$$\Delta \ln(\text{e10RM}_{m, w}) = \beta_0 + \beta_1 V_{m, w} - \beta_2 V_{m, w}^2$$



Constrained via bounded ridge regression ($\beta_1 > 0, \, \beta_2 > 0$):
* $\text{MEV}_m$: Smallest root where expected gain $\ge 0$ (clamped to $[3, 10]$).
* $\text{MAV}_m$: Vertex of parabola $\frac{\beta_1}{2\beta_2}$ (clamped to $[\text{MEV}_m + 2, 22]$).
* $\text{MRV}_m$: Upper root or empirical volume threshold where intra-session drop-off $\delta_{\text{drop}} > 0.18$ or iso-load RPE drift $> +0.5$ (clamped to $[\text{MAV}_m + 2, 30]$).


* Apply energy balance scaling from `recovery_modifier.py`: multiply `[MAV, MRV]` by $1.12$ if `SURPLUS`, or $0.82$ if `DEFICIT`.





### 2.2 Verification Gate

* Test confirming a Barbell Squat credits $1.0$ to `Quads`, $0.5$ to `Glutes`/`Hamstrings`, and scales systemic fatigue by $1.35\times$.


* Test verifying fallback to population priors when $< 6$ weeks of history exist, and smooth posterior blending when $\ge 6$ weeks exist.

---

## Phase 3: Empirical SFR, Variant Substitution & Asymmetry Engine

**Target Files:** `companion/src/analysis/sfr_evaluator.py` *(new)*, `companion/tests/test_sfr_evaluator.py` *(new)*

**Objective:** Score each exercise's Stimulus-to-Fatigue Ratio (SFR), recommend catalog substitutions via `parent_exercise_id`, and flag unilateral limb asymmetries via `reps_right`.

### 3.1 Mathematical Specifications

1. **Empirical Exercise SFR Score ($\text{SFR}_{\text{ex}} \in [0, 100]$):**
For each exercise with $\ge 3$ sessions in the last 56 days:

$$\text{Raw SFR}_{\text{ex}} = \frac{\left(\frac{\overline{e\text{Reps}}_{\text{set}}}{5.0}\right) \cdot \left(1 + \max(-0.5, \, 10 \cdot \dot{x}_{10\text{RM}})\right)}{\left(1 + 3.0 \cdot \overline{\delta}_{\text{drop}}\right) \cdot \left(1 + 0.25 \sum_{p \in \text{joint}} \text{severity}_p + 0.08 \sum_{p \in \text{muscle}} \text{severity}_p\right)}$$



where $\dot{x}_{10\text{RM}}$ is the 28-day OLS slope of $\ln(\text{e10RM}_t)$, and pain severities are summed over the last 28 days from `pain_reports`. Map to a $0\text{–}100$ percentile/logistic score and classify into tiers: `OPTIMAL` ($\ge 65$), `MODERATE` ($40\text{–}64$), `POOR_SWAP_RECOMMENDED` ($< 40$ or any single `joint` pain report with `severity` $\ge 5$).


2. **Variant Tree Substitution Resolver:**
When an exercise is flagged `POOR_SWAP_RECOMMENDED`:
* Query `exercises` where `parent_exercise_id == current.parent_exercise_id` (or `id == current.parent_exercise_id` / `parent_exercise_id == current.id`) and `id != current.id`.


* Filter candidates by the athlete's `user_profiles.equipment_access` and `gear_inventory`, ranking candidates with lower historical joint pain and lower $m_{\text{sys}}$ first.




3. **Unilateral Limb Asymmetry Index:**
For exercises with `is_unilateral == 1` and non-null `reps_right`:



$$\text{Asymmetry}_{\text{ex}} = \frac{1}{M} \sum_{m=1}^{M} \frac{\vert{}\text{reps}_m - \text{reps\_right}_m\vert{}}{\max(\text{reps}_m, \text{reps\_right}_m)}$$



Flag if $\text{Asymmetry}_{\text{ex}} > 0.12$ ($12\%$) across $M \ge 3$ consecutive sessions.

### 3.2 Verification Gate

* Unit test demonstrating that injecting two `joint` pain reports (`severity = 6`) drops an exercise's SFR into `POOR_SWAP_RECOMMENDED` and returns a valid sibling `exercise_id` from the `parent_exercise_id` tree.


* Unit test verifying unilateral asymmetry detection when `reps = 10` and `reps_right = 8` over 3 sessions.



---

## Phase 4: Anthropometric Partitioning ($P$-Ratio) & Parameter Audit Rules

**Target Files:** `companion/src/analysis/recovery_modifier.py` *(modify)*, `companion/src/analysis/recommendations.py` *(modify)*, `companion/tests/test_parameter_audit.py` *(new)*

**Objective:** Upgrade energy balance tracking to evaluate lean-mass partitioning ($P$-Ratio) and generate concrete program parameter adjustments.

### 4.1 Mathematical Specifications

1. **Body Composition Partitioning ($P$-Ratio Proxy) in `recovery_modifier.py`:**
Compute 28-day rolling OLS slopes for `bodyweight` ($\beta_{\text{BW}}$), `waist_cm` ($\beta_{\text{waist}}$), `navy_body_fat` ($\beta_{\text{BF}}$), and aggregate upper/lower limb girths $G_{\text{limb}} = \text{bicep\_cm} + \text{chest\_cm} + \text{thigh\_cm} + \text{calf\_cm}$ ($\beta_{\text{limb}}$):


* Estimate Lean Body Mass $\text{eLBM}_i = \text{BW}_i \cdot \left(1 - \frac{\text{navy\_body\_fat}_i}{100}\right)$.


* Flag `CALORIC_OVERSHOOT` if $\beta_{\text{BW}} > +0.35\text{ kg/wk}$ AND ($\beta_{\text{waist}} > +0.20\text{ cm/wk}$ OR $\frac{\beta_{\text{eLBM}}}{\beta_{\text{BW}}} < 0.45$).


2. **Program Parameter Audit Matrix in `recommendations.py`:**
Add a deterministic rule evaluator `generate_parameter_audits()` outputting structured advisory objects:
* `REST_TOO_SHORT`: `is_compound == 1` AND median $\Delta t_{\text{rest}} < 90\text{s}$ AND $\overline{\delta}_{\text{drop}} > 0.15$ $\rightarrow$ Recommend setting `optimal_rest_seconds = 180`.


* `JUNK_VOLUME`: Muscle weekly sets $> \text{MAV}_m$ AND mean working $\text{RPE} < 7.3$ AND $\dot{x}_{10\text{RM}} \le 0$ $\rightarrow$ Recommend reducing sets by $25\%$ and increasing target RPE to $8.5\text{–}9.0$.
* `AXIAL_BOTTLENECK`: Global Banister $F(t) > 1.35 P(t)$ AND local muscle Readiness $> 70\%$ AND Barbell share of volume $> 60\%$ $\rightarrow$ Recommend swapping 1 compound `Barbell` movement for a `Machine`/`Cable` variant.


* `REP_MONOTONY`: $> 85\%$ of working sets for an exercise over 28 days fall within a $\pm 1\text{ rep}$ band AND $\dot{x}_{10\text{RM}} \le 0$ $\rightarrow$ Recommend undulating rep brackets (e.g., top set $5\text{–}7$ reps + back-off sets $10\text{–}14$ reps).



### 4.2 Verification Gate

* Test confirming `CALORIC_OVERSHOOT` triggers when bodyweight rises $+0.5\text{ kg/wk}$ alongside $+0.3\text{ cm/wk}$ waist growth.
* Test verifying each of the 4 parameter audit rules fires accurately on synthetic dataset fixtures.

---

## Phase 5: Data Contract Expansion (`schemas/` & Export Pipeline)

**Target Files:** `schemas/calibrated_parameters.schema.json`, `companion/src/ingestion/schemas.py`, `mobile/src/database/schema.ts`

**Objective:** Extend the JSON bridge between the Companion Suite and Mobile Tracker without breaking existing v1 imports.

### 5.1 Schema Additions (`calibrated_parameters.schema.json` & Pydantic `schemas.py`)

Keep existing per-exercise fields (`exercise_id`, `calibrated_1rm`, `calibrated_k`, `cov_p00`, `cov_p11`, `calibrated_at`) and append optional hypertrophy fields:

* Inside each exercise calibration entry:
* `calibrated_10rm`: ` Optional[float]`
* `sfr_score`: `Optional[float]` ($0\text{–}100$)
* `sfr_tier`: `Optional[Literal["OPTIMAL", "MODERATE", "POOR_SWAP_RECOMMENDED"]]`
* `recommended_swap_exercise_id`: `Optional[str]` (UUID)
* `optimal_rest_seconds`: `Optional[int]`
* `asymmetry_ratio`: `Optional[float]`


* Top-level optional collections in `calibrated_parameters.json`:


* `muscle_landmarks`: `Optional[Dict[str, MuscleLandmarkPayload]]` containing `{ "mev": float, "mav": float, "mrv": float, "readiness_pct": float }`.
* `program_audits`: `Optional[List[ProgramAuditPayload]]` containing `{ "rule_code": str, "target_id": str, "message": str, "suggested_parameter": str, "suggested_value": float }`.



### 5.2 Verification Gate

* Run Pydantic v2 validation (`companion/src/ingestion/schemas.py`) against both legacy v1 `calibrated_parameters.json` files and newly enriched v2 payloads to confirm 100% backwards and forwards compatibility.



---

## Phase 6: Companion Streamlit UI & Mobile Client Consumption

**Target Files:** `companion/src/ui/` *(Streamlit views)*, `mobile/src/services/calibrationImport.ts`, `mobile/src/components/WorkloadDeepDive.tsx`

**Objective:** Surface the new hypertrophy intelligence in both the Companion dashboard and the in-gym Mobile Tracker.

### 6.1 UI & Mobile Integration Tasks

1. **Companion Streamlit UI (`companion/src/`):**
* Add a **"Hypertrophy & Program Audit"** tab featuring:
* A 12-muscle radar/bar chart comparing current weekly $e\text{Reps}$ & fractional sets against individualized `[MEV, MAV, MRV]` zones.
* An **Exercise SFR Matrix** scatter plot (Stimulus on Y-axis vs. Fatigue/Pain penalty on X-axis) with 1-click substitution recommendations.
* The **Program Parameter Audit** table listing specific rest timer, set count, rep range, and caloric adjustments.




2. **Mobile Tracker (`mobile/src/`):**
* Update the calibration import handler to persist `muscle_landmarks` and `optimal_rest_seconds` into SQLite (`calibrated_params` or local settings store).


* Update **Weekly Workload Deep Dive** to read dynamic `[mev, mav, mrv]` per muscle group when available, falling back to static population constants otherwise.


* Display a non-intrusive warning badge on exercises in the workout screen when `sfr_tier == 'POOR_SWAP_RECOMMENDED'`, wiring the badge directly into the existing 1-tap `parent_exercise_id` substitution modal.





---