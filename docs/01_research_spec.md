# 01 — Research & Quantitative Specification

**Project:** Browser-based 3D electroanatomic mapping (EAM) training simulator for EP study and catheter ablation
**Audience:** Simulation-engine programmer, content author, clinical reviewer
**Status:** v1.0, the scientific basis for the engine. All numbers are teaching-grade defaults drawn from standard textbook ranges. They are tunable parameters, not patient-specific truth.
**Branding:** Original system. Do not use any commercial EAM vendor's names, trademarks, colour schemes, iconography or screen layouts. Use the generic terms this document uses: "activation map", "voltage map", "mapping catheter", "reference channel", "window of interest", "lesion marker", "lesion quality index (LQI)".

Conventions used throughout:
- Units: mm, ms, mV, W, g, Ω, °C. Conduction velocity (CV) is in **m/s = mm/ms**, so `travel_ms = distance_mm / cv`.
- Ranges are given as `min–max (default)`. The engine should use the default and expose the range to scenario authors.
- "ERP600" means the effective refractory period at a 600 ms drive cycle length.

---

## 1. Core electrophysiology parameters

### 1.1 Conduction velocity by tissue type

| Tissue type (engine enum) | CV longitudinal m/s | CV transverse m/s | Anisotropy ratio | Notes |
|---|---|---|---|---|
| `ATRIUM` (working myocardium) | 0.6–1.0 (0.80) | 0.3–0.5 (0.40) | ~2:1 | Use isotropic 0.8 if fibre direction is not modelled |
| `CRISTA` / `BACHMANN` (fast bundles) | 1.2–1.7 (1.40) | 0.2–0.4 (0.30) | up to 5:1 | Crista transverse conduction is poor, which gives a functional line of block in flutter |
| `CTI` (cavotricuspid isthmus) | 0.4–1.0 (0.60) | — | — | Slightly slower; pectinate trabeculation |
| `PV_SLEEVE` | 0.3–0.6 (0.45) | 0.2 | — | Short ERP; source of ectopic triggers |
| `SINUS_NODE` | 0.02–0.05 | — | — | Pacemaker; usually modelled as a timed source |
| `AVN_COMPACT` | 0.02–0.05 | — | — | Model as a **delay element** (§1.4), not with CV |
| `HIS` | 1.5–2.0 (1.7) | — | — | Insulated cable from His to the bundle branches |
| `PURKINJE` / bundle branches | 2.0–4.0 (3.0) | — | — | Endocardial fast layer; activates the ventricles rapidly |
| `VENTRICLE` (working) | 0.5–1.0 (0.60) | 0.2–0.3 (0.25) | ~2.5:1 | Transmural ~0.4 |
| `BORDER_ZONE` (scar border) | 0.1–0.4 (0.25) | 0.05–0.15 | — | Heterogeneous; fractionated EGMs |
| `SLOW_CHANNEL` (VT isthmus) | 0.03–0.2 (0.10) | — | — | Surviving bundles inside scar; diastolic potentials |
| `DENSE_SCAR` | 0 (non-conducting) | 0 | — | Electrically inert; bipolar <0.5 mV |
| `ABLATED_CORE` | 0 | 0 | — | Created at run time by RF (§5) |
| `ACCESSORY_PATHWAY` | 0.5–1.5 (1.0) | — | — | Modelled as a **link** with a 5–15 ms crossing time, non-decremental |
| `VALVE` / `ANNULUS` / `VEIN_ORIFICE` | n/a | — | — | Anatomic barrier (no nodes) |

### 1.2 Refractory periods (ERP, default drive CL 600 ms)

| Structure | ERP range ms (default) | ERP at CL 400 | Notes |
|---|---|---|---|
| Atrium (normal) | 200–270 (230) | 200 | ERP shortens with rate |
| Atrium (AF-remodelled substrate) | 120–180 (150) | 140 | Lets multiple wavelets survive (§4.6) |
| PV sleeve | 140–220 (180) | 160 | Shorter than LA |
| AVN fast pathway, anterograde | 280–450 (330) | 340 | AVN ERP can *increase* at faster rates |
| AVN slow pathway, anterograde | 200–300 (260) | 270 | In dual AVN physiology, SP ERP < FP ERP |
| AVN fast pathway, retrograde | 250–400 (300) | — | |
| AVN slow pathway, retrograde | 250–400 (330) | — | Often absent; enables atypical AVNRT when present |
| AVN functional refractory period | 330–500 (400) | — | Shortest H1H2 output |
| His–Purkinje | 330–450 (400) | 370 | Longer than ventricle at slow rates, so aberrancy and HV jumps occur |
| Ventricle | 200–290 (240) | 220 | |
| Ventricle, border zone | 250–320 (280) | 260 | Post-repolarisation refractoriness |
| Accessory pathway, anterograde | 230–400 (300) | 280 | **High-risk AP:** ERP ≤250 or shortest pre-excited RR in AF ≤250 ms |
| Accessory pathway, retrograde | 220–350 (270) | 250 | |
| AP, decremental (PJRT type) | 250–400 | — | Decremental retrograde-only pathway (§4.2) |

**Rate dependence (restitution).** Use one of these forms.
```
// Simple: ERP scales with the previous cycle length
ERP(CL) = ERP600 * (CL / 600) ^ 0.30        // clamp CL to [200, 1500]

// Better: APD restitution on the diastolic interval (DI)
APD_next = APDmax * (1 - a * exp(-DI / tau))  // atrium: APDmax=260, a=0.5, tau=80
                                              // ventricle: APDmax=290, a=0.45, tau=100
ERP ≈ APD_next - 10
```
Add a **relative refractory period** (RRP) of 20–40 ms after the ERP. During the RRP, CV is multiplied by `0.3 + 0.7 * (t - ERPend) / RRP`. This produces decremental conduction and wavebreak.

### 1.3 Baseline intervals (normal adult)

| Interval | Range ms (default) | Definition / engine source |
|---|---|---|
| Sinus CL | 600–1000 (800) | Sinus-node timer, with ±2% beat-to-beat jitter |
| P wave duration | 80–110 (100) | Atrial total activation time |
| PR | 120–200 (160) | |
| PA (P onset to His-catheter A) | 20–55 (35) | Intra-atrial conduction from SN to low septum |
| AH | 50–120 (85) | AVN delay (§1.4) |
| HV | 35–55 (45) | His to earliest ventricular myocardium. **HV < 35 ms with pre-excitation** (negative HV in manifest WPW) |
| H duration | 15–25 (20) | Width of the His deflection |
| QRS | 70–110 (90) | Ventricular total activation time |
| QT / QTc | 350–440 / <450 | Repolarisation: APD + dispersion |
| CS activation in sinus (prox to dist) | 20–50 (35) | CS 9-10 to CS 1-2, **concentric** |
| AVN Wenckebach CL (AVWCL) | 300–500 (380) | Atrial pacing CL at which AH blocks |
| VA Wenckebach CL | 300–600 (420); absent in 10–40% | Retrograde AVN conduction |
| VA during RV pacing (via AVN) | 100–200 (140) | Concentric; earliest A at His/CS os |
| Septal VA, typical AVNRT | ≤70 | V onset to earliest A |
| VA, orthodromic AVRT | ≥70 (90–140) | |

### 1.4 AV node dual-pathway delay model

The AV node is modelled as two parallel delay links from atrial "entry" nodes to a compact-node junction, then a final common path to the His.

```
// RP = recovery time = t_now - lastActivation(pathway)
condTime(RP) = base + A * exp(-(RP - ERP) / tau)     // valid only if RP >= ERP, else BLOCK

FP_antero: base=60,  A=60,  tau=70,  ERP=330   // AH ≈ 60–120 ms
SP_antero: base=180, A=120, tau=60,  ERP=260   // AH ≈ 180–350 ms
FP_retro:  base=40,  A=50,  tau=70,  ERP=300   // His→A ≈ 40–90 ms
SP_retro:  base=150, A=100, tau=60,  ERP=330   // His→A ≈ 150–250 ms (atypical)
LowerCommonPathway: 5–15 ms, UpperCommonPathway: 0–10 ms
```
- **AH jump:** at least a 50 ms increase in A2H2 for a 10 ms decrement in A1A2. This happens when A1A2 falls below FP ERP but stays at or above SP ERP.
- **Echo beat:** after SP conduction, retrograde FP conduction occurs if FP has recovered (`t_His - lastFP >= FP_retro.ERP`).
- **Wenckebach:** emerges naturally because condTime grows as RP falls, until RP < ERP.
- **Atrial entry sites:** FP enters at the superior (anterior) Koch triangle near the His. SP enters at the inferior Koch triangle between the CS os and the TA. Retrograde atrial breakthrough uses the same sites, which sets the earliest A site for typical (FP) or atypical (SP) AVNRT.
- **Conduction gate:** ablating within 4 mm of `SP_ENTRY` removes the SP link (with probability tied to LQI). Lesions within 5 mm of `HIS` or `COMPACT_AVN` carry AV-block risk (§5.5).

### 1.5 Tissue lookup table for the engine

```json
{
  "ATRIUM":       {"cv":0.80,"cvT":0.40,"erp600":230,"bipolar_mV":[1.5,5.0],"unipolar_mV":[2,6]},
  "PV_SLEEVE":    {"cv":0.45,"cvT":0.20,"erp600":180,"bipolar_mV":[0.5,3.0]},
  "CTI":          {"cv":0.60,"cvT":0.40,"erp600":230,"bipolar_mV":[0.8,3.0]},
  "VENTRICLE":    {"cv":0.60,"cvT":0.25,"erp600":240,"bipolar_mV":[1.5,8.0],"unipolar_mV":[8.3,20]},
  "PURKINJE":     {"cv":3.00,"erp600":400},
  "BORDER_ZONE":  {"cv":0.25,"cvT":0.10,"erp600":280,"bipolar_mV":[0.5,1.5],"fractionation":0.5},
  "SLOW_CHANNEL": {"cv":0.10,"erp600":280,"bipolar_mV":[0.2,0.8],"fractionation":0.8},
  "DENSE_SCAR":   {"cv":0,"bipolar_mV":[0.05,0.5]},
  "ABLATED_CORE": {"cv":0,"bipolar_mV":[0.02,0.2]}
}
```

---

## 2. Computational model

### 2.1 Design choice

| Option | Pros | Cons | Use |
|---|---|---|---|
| Biophysical / monodomain PDE | Realistic | Too slow for the browser, hard to tune | No |
| Pure eikonal (fast marching) | Fast, smooth, single activation | No reentry, no refractoriness | Static "ideal" maps, pace maps, sinus beats |
| **Graph cellular automaton (CA) + event-driven propagation** | Fast (10–50k nodes in JS/WebWorker), supports reentry, refractoriness, block, lesions | Discretisation artefacts | **Primary engine** |
| FitzHugh–Nagumo / Mitchell–Schaeffer on a graph | Smooth wavefronts, restitution | Needs dt ≤0.1 ms, heavier | Optional "high fidelity" mode (AF, VF) |

**Recommendation:** use a triangulated endocardial surface mesh per chamber, with node spacing 1.5–3 mm (about 3–8k nodes per chamber), plus explicit **link edges** for the AVN, His–Purkinje tree, accessory pathways and inter-atrial connections (Bachmann's bundle, CS musculature, fossa rim). Run an event-driven CA with a 3-state machine per node. Thick ventricular walls can use a 2-layer surface (endo/epi) joined by transmural edges, so that non-transmural lesions and epicardial circuits can be represented.

### 2.2 Node state

```
Node {
  id, pos[3], normal[3], chamber, tissue
  fibreDir[3]?                     // optional anisotropy
  wallThickness_mm                 // atrium 1–4, RV 3–5, LV 8–12, scar 2–5
  cvScale = 1.0                    // modified by lesion/edema/drug
  state: REST | EXCITED | REFRACTORY
  lastAct = -inf                   // ms
  prevCL                           // for restitution
  refrEnd, rrpEnd                  // ms
  pendingArrival = +inf            // earliest scheduled arrival in this cycle
  lat[]                            // history of activation times (ring buffer)
  bipolarBase_mV, unipolarBase_mV  // sampled from the tissue table at scenario load
  isFocus?, focusCL?, focusJitter? // automatic / triggered focus
}
Edge { a, b, length_mm, cvOverride?, delayFn?, directional? /*AP, block lines*/ }
```

### 2.3 Propagation (event-driven, dt-free)

```
priorityQueue Q   // keyed by arrival time
function stimulate(node, t): schedule(node, t, source=STIM)

function schedule(n, t, src):
  if t < n.pendingArrival:              // keep only the earliest wavefront
     n.pendingArrival = t; Q.push(t, n, src)

loop while Q.peek().t <= simTimeTarget:
  (t, n, src) = Q.pop()
  if t != n.pendingArrival: continue    // stale entry
  n.pendingArrival = +inf
  if n.tissue in {DENSE_SCAR, ABLATED_CORE}: continue
  if t < n.refrEnd: continue            // absolute refractory, so block here
  // activate
  DI = t - n.refrEnd
  n.prevCL = t - n.lastAct; n.lastAct = t; n.lat.push(t)
  ERP = restitution(n.tissue, DI) * drugFactor
  n.refrEnd = t + ERP; n.rrpEnd = n.refrEnd + RRP(n.tissue)
  emitEvent("activate", n, t)           // drives EGMs, map, ECG
  for e in edges(n):
     m = other(e, n)
     if e.directional && !e.allows(n -> m): continue
     if e.delayFn: dt = e.delayFn(t - lastPass(e))   // AVN/AP: may return BLOCK
     else:
        cv = effectiveCV(n, m, e)        // anisotropy, cvScale, relative refractoriness at m
        dt = e.length_mm / cv
     if dt == BLOCK: continue
     schedule(m, t + dt, n)

effectiveCV(n, m, e):
  cv = tissueCV(m) * m.cvScale
  if fibreDir: cv = blend(cvL, cvT, |cos(angle(e, fibreDir))|)
  tArr = n.lastAct + e.length_mm / cv
  if tArr < m.rrpEnd: cv *= 0.3 + 0.7 * clamp((tArr - m.refrEnd) / RRP, 0, 1)
  return max(cv, 0.02)
```
- **Source-sink / curvature:** to block propagation from a thin channel into a large mass, require at least 2 activated neighbours within 3 mm for nodes with `tissue == SLOW_CHANNEL` exits. This gives a "safety factor" and produces unidirectional block at isthmus entrances when extrastimuli are premature.
- **Automatic foci:** each focus node self-schedules `stimulate(node, lastAct + focusCL + N(0, jitter))`. Isoproterenol multiplies focusCL by 0.6–0.8. Overdrive pacing resets the focus (automatic: overdrive suppression with warm-up; triggered: induced after a burst, with coupling linked to the pacing CL).
- **Reentry sustainability check (for authoring):** reentry needs `circuitLength / meanCV (= TCL) > ERP(TCL) + excitable gap`. Target an excitable gap of 15–30% of TCL so that entrainment works. Example: flutter circuit ≈ 180–220 mm at a mean 0.8 m/s gives TCL ≈ 240 ms with ERP ≈ 180–200 at that rate.
- **Performance:** run in a WebWorker. Advance the simulation in 10–20 ms chunks per animation frame. Post activation events as typed arrays.

### 2.4 Static eikonal maps (optional fast path)

For sinus rhythm, pace maps and point-by-point map previews, solve `|∇T| · CV(x) = 1` with Dijkstra or the Fast Marching Method on the graph, seeded at the earliest nodes. For a reentrant circuit, cut the mesh along a "phase line" and seed one side at t=0 with the other side as the target. The CA engine remains the source of truth during live pacing.

### 2.5 Local activation time (LAT)

```
LAT_node(beat k) = lastAct within the window of interest (WOI) relative to the reference time
reference      = QRS onset (ventricle) or a stable CS bipolar channel peak (atrium)
WOI default    = [ref - 0.55*TCL, ref + 0.40*TCL]   // spans ≈ 90–95% of TCL
                 sinus or paced: [ref - 100, ref + 150] (atrium), [ref - 50, ref + 200] (ventricle)
annotation     = time of max -dV/dt on the unipolar EGM (preferred) or the bipolar peak |V|
noise          = add N(0, 2–3 ms) to simulate annotation variability
double potential: if two deflections ≥30 ms apart and both >0.1 mV, flag DP (line of block)
```
**Map rendering:** interpolate point LATs to the mesh using inverse-distance or geodesic RBF, with a fill radius of 5–15 mm (default 10). Uncovered areas are grey. Colour runs from red (earliest) through yellow, green and blue to purple (latest). Draw isochrones every 10 ms. Draw CV vectors as `∇T`-derived arrows. An "early-meets-late" boundary is where adjacent points differ by more than 70% of TCL.

### 2.6 Bipolar and unipolar voltage

| Chamber | Normal bipolar | Border zone | Scar | Unipolar normal |
|---|---|---|---|---|
| LV/RV endocardium | >1.5 mV | 0.5–1.5 mV | <0.5 mV | LV >8.3 mV; RV >5.5 mV |
| LV epicardium | >1.0 mV | 0.5–1.0 | <0.5 | — |
| Atria | >0.5 mV | 0.1–0.5 | <0.1–0.2 (dense <0.05) | — |

```
bipolarAmp(node, waveDir) = node.bipolarBase_mV
                            * (0.6 + 0.4 * |cos(angle(waveDir, catheterBipoleAxis))|)  // wavefront incidence
                            * contactFactor(CF)            // CF<5 g: 0.4–0.7; ≥10 g: 1.0
                            * lesionFactor(node)           // 0.1–0.3 after transmural ablation
                            * lognormalNoise(σ=0.15)
voltage map default thresholds: 0.5 / 1.5 mV (ventricle), 0.1 / 0.5 mV (atrium); user-adjustable.
```

### 2.7 Electrogram synthesis

Each virtual electrode `e` at position `x_e` collects contributions from nodes within a sensing radius. EGMs are sampled at 1 kHz. They are displayed at 100 / 200 mm/s.

```
// Template for a single node's contribution (unipolar), centred on activation time τ
g(t; τ, w) = -(t - τ) / w^2 * exp(-(t - τ)^2 / (2 w^2))   // derivative of a Gaussian: biphasic RS
w = 2–4 ms healthy, 4–8 ms scar/border (wider, lower slope)

unipolar_e(t) = Σ_i  A_i * K(r_ie) * g(t; LAT_i, w_i)                  // near field
              + farField_e(t)                                         // e.g. ventricular far field on atrial channels
K(r)        = 1 / (r^2 + r0^2), r0 = 1.5 mm; include nodes with r < 10 mm (near field)
A_i         = unipolarBase_i, with sign set so that approaching wavefronts give positive R
              (node activated before the electrode-closest node yields R; after yields S)

// Bipolar = difference of two closely spaced unipoles (spacing 1–4 mm)
bipolar(t) = unipolar_e1(t) - unipolar_e2(t), then band-pass 30–500 Hz, then scale to bipolarAmp

// Far field: low-amplitude, low-frequency contribution from the other chamber
farField_e(t) = Σ_j  B * (1/r_je) * g(t; LAT_j, 10 ms)   over a coarse subsample of the opposite chamber
```
- **Fractionation (border zone and slow channel):** replace a single g() by 2–6 sub-deflections spread over `span = (1 - cvScale) * 60 ms`, each with amplitude 0.05–0.5 mV.
- **Late potentials / LAVA:** a channel node whose LAT falls after QRS end gives an isolated deflection after the far-field V.
- **Mid-diastolic potentials during VT:** these are the natural output of slow-channel nodes activating during electrical diastole.
- **His EGM:** when the `HIS` link activates, add a sharp 15–20 ms, 0.1–0.5 mV biphasic spike on the His-catheter channels only (r < 8 mm). The HBE channel shows A (septal atrium), H and V.
- **Unipolar morphology at the earliest site:** a focal source gives a QS (purely negative). Use it as an ablation-target cue for focal AT, RVOT VT and AP insertion.
- **PV potentials:** sharp, high-frequency (w = 1.5 ms) deflections that follow a blunt far-field LA component. On distal CS pacing they separate from far-field LA.
- **Noise:** 0.01–0.03 mV RMS white noise plus a 50/60 Hz component toggle. Pacing artefact: a 2 ms saturated spike plus a 10 ms exponential decay on all channels.

### 2.8 Surface 12-lead ECG (dipole approximation)

```
H(t) = Σ_i  wt_i * n_i * g'(t; LAT_i, 5)                 // depolarisation heart vector
     - Σ_i  wt_i * n_i * 0.25 * g'(t; LAT_i + APD_i, 40) // repolarisation (T wave)
lead_L(t) = dot(leadVector_L, H(t))
```
- `n_i` is the local wavefront propagation direction (unit ∇T) and `wt_i` is the tissue mass (atrium 0.15, ventricle 1.0, scar 0).
- Use standard Einthoven/Frank-like lead vectors in the shared coordinate system (§3), with V1–V6 placed at their anatomical chest positions.
- Validate morphology against the delta-wave and VT-morphology tables in §4 and tune the lead vectors until they match.

---

## 3. Simplified geometry and landmarks

### 3.1 Coordinate system

- **Patient-based LPS:** +x = patient **left**, +y = **posterior**, +z = **superior**. Units are mm.
- **Origin** = His bundle recording site (the apex of Koch's triangle, at the membranous septum).
- Standard fluoroscopic camera presets: RAO 30° and LAO 45° (rotation about z), AP, and PA. Add "LAO caudal" for the CTI and Koch's triangle.

### 3.2 Chamber primitives (build as deformed ellipsoids or tubes, then remesh)

| Chamber | Primitive | Centre (x,y,z) | Semi-axes / size | Wall | Notes |
|---|---|---|---|---|---|
| RA | Ellipsoid | (-28, 15, 10) | 25 × 22 × 28 | 2 mm | SVC tube on top, IVC tube below, RAA anterior |
| LA | Ellipsoid | (28, 40, 12) | 30 × 20 × 25 (AP 40 mm) | 2–3 mm | 4 PV tubes plus a LAA tube |
| RV | Crescent wrapping LV (half ellipsoid shell) | (-5, -30, -35) | 35 × 15 × 45 | 4 mm | Inflow (TV), apex, RVOT up to the pulmonary valve |
| LV | Prolate ellipsoid, long axis 80–90 mm | (28, -12, -42) | 25 × 25 × 45 | 10 mm | Axis tilted ~45° leftward and anteroinferiorly |
| CS | Tube Ø 8–10 mm, length 60–80 mm | along the AV groove | — | — | Wraps the posterior MA from the os to the lateral wall |
| PVs | Tubes Ø 15–20 mm (inferior 12–17), length 20–25 | see 3.3 | — | 1–2 | Myocardial sleeve over the first 10–20 mm |
| SVC/IVC | Tubes Ø 18–22 / 22–26 | see 3.3 | — | — | Non-conducting beyond 10 mm |
| Aortic root | Tube Ø 25–30 with 3 cusps | (8, 5, 8) | — | — | Holds the NCC, RCC and LCC landmarks |

### 3.3 Landmark coordinates (approximate)

| Landmark (ID) | x | y | z | Notes |
|---|---|---|---|---|
| `HIS` | 0 | 0 | 0 | Apex of Koch's triangle; His EGM |
| `COMPACT_AVN` | -3 | 5 | -6 | AV-block danger zone, radius 5 mm |
| `FP_ENTRY` (anterior septum) | -4 | 3 | -3 | Earliest A in typical AVNRT |
| `SP_ENTRY` (slow pathway region) | -10 | 12 | -18 | Ablation target for AVNRT, between CS os and TA, "4–5 o'clock LAO" |
| `CS_OS` | -6 | 18 | -20 | Base of Koch's triangle (triangle sides about 15–20 mm) |
| `TV_CENTER` | -18 | -5 | -12 | TA ring Ø 35 mm; normal vector points toward the RV apex |
| `CTI_MEDIAL` (septal TA, 6 o'clock) | -14 | 8 | -30 | |
| `CTI_TA` (TA end of line, 6 o'clock LAO) | -20 | 5 | -32 | Flutter line start, ventricular edge |
| `CTI_IVC` (IVC end of line) | -24 | 25 | -40 | CTI length 25–35 mm |
| `IVC_ORIFICE` | -22 | 28 | -45 | |
| `SVC_ORIFICE` | -25 | 22 | 40 | |
| `SINUS_NODE` | -35 | 18 | 32 | Superolateral SVC–RA junction, at the top of the crista |
| `CRISTA_LINE` | from (-35,18,32) to (-32,24,-35) | | | Posterolateral RA; anisotropic fast bundle |
| `RAA` | -32 | -12 | 22 | Pectinate muscles |
| `HRA_CATH` | -33 | 14 | 28 | Standard HRA catheter position |
| `FOSSA_OVALIS` | 4 | 25 | 2 | Transseptal puncture site |
| `MV_CENTER` | 25 | 15 | -10 | MA Ø 30 mm |
| `LSPV` | 45 | 52 | 32 | Ostium; tube runs toward (+x, +y, +z) |
| `LIPV` | 45 | 56 | 8 | |
| `RSPV` | 10 | 52 | 32 | Near the phrenic nerve and SVC |
| `RIPV` | 10 | 56 | 6 | |
| `LAA` | 50 | 18 | 28 | Ridge between LAA and LSPV |
| `LA_ROOF` | 28 | 50 | 38 | Roof line from LSPV to RSPV |
| `MITRAL_ISTHMUS` | from LIPV (45,56,8) to the lateral MA (42,22,-8) | | | Perimitral flutter line, ~30–40 mm |
| `CS_9_10` (proximal) | -2 | 22 | -18 | Decapolar CS catheter, 2-8-2 mm spacing |
| `CS_7_8` | 12 | 32 | -14 | |
| `CS_5_6` | 26 | 34 | -10 | |
| `CS_3_4` | 38 | 28 | -6 | |
| `CS_1_2` (distal) | 46 | 16 | -4 | Lateral LA/MA |
| `AORTIC_NCC` / `RCC` / `LCC` | (2,8,6) / (5,-2,6) / (14,4,10) | | | Para-Hisian AT, LVOT/cusp VT |
| `PULMONARY_VALVE` | 8 | -28 | 18 | Top of the RVOT |
| `RVOT_SEPTAL` / `RVOT_FREE` | (5,-22,10) / (-8,-34,10) | | | Idiopathic VT foci |
| `RV_APEX` (RVA catheter) | 10 | -48 | -62 | |
| `LV_APEX` | 30 | -45 | -78 | |
| `LBB_ORIGIN` / `RBB_ORIGIN` | (4,0,-8) / (-2,-6,-12) | | | Purkinje tree roots |
| `PHRENIC_R` | along the lateral RA/SVC, x≈-40 | | | Complication zone |
| `ESOPHAGUS` | line x≈20–30, y≈62, z 40→-20 | | | Posterior to the LA; temperature-risk zone |

**AP insertion sites around the annuli** use a clock face in the LAO view, with MA and TA each as a ring. Parameterise as `annulusPoint(ring, clockHour)`. Left free wall APs sit at MA 1–4 o'clock (anterolateral to posterolateral). Posteroseptal APs sit at 5–7 o'clock near the CS os. Right free wall APs sit at TA 7–11 o'clock. Anteroseptal/para-Hisian APs sit at TA 12–1 o'clock near the HIS.

### 3.4 Purkinje / conduction system

- His (length 10–15 mm) splits into the RBB (thin cable down the RV septum to the moderator band and RV apex, about 40–50 mm) and the LBB (a fan of posterior and anterior fascicles to LV papillary bases).
- Terminal Purkinje–muscle junctions (PMJ) number 50–200 per ventricle, on the lower two-thirds of the endocardium, with a 5–10 ms PMJ delay.
- Earliest normal LV breakthrough is the mid-septum at about 10–15 ms after QRS onset in this model (clinically, septal activation starts around 0–10 ms after QRS onset). Latest is the basal posterolateral LV at 70–90 ms.
- **BBB toggles:** cut the RBB or LBB edge to give an RBBB/LBBB QRS (QRS ≥120 ms). This is needed to test Coumel's law in AVRT.

---

## 4. Arrhythmia scenario specifications

Catheter set (default): **HRA** (quad), **HIS** (quad: d/m/p), **CS** (deca: CS1-2 distal to CS9-10 proximal), **RVA** (quad), **ABL** (4 mm or 3.5 mm irrigated tip: ABLd 1-2, ABLp 3-4, unipolar ABL1), optional **TA 20-pole** (poles 1-2 at the lateral CTI, 19-20 at the anterolateral RA) and **circular PV catheter** (10–20 poles, loop Ø 15–25 mm).

Abbreviations: TCL = tachycardia CL, PPI = post-pacing interval, SA = stimulus-to-A, VA = V onset to earliest A, ERP = effective refractory period.

### 4.1 AVNRT

| Item | Typical (slow–fast), ~90% | Atypical fast–slow | Atypical slow–slow |
|---|---|---|---|
| Circuit | Antero SP to Retro FP | Antero FP to Retro SP | Antero SP to Retro second SP |
| TCL | 280–450 (350) | 300–550 (400) | 300–500 (380) |
| AH / HA | AH 180–350 / HA ≤ 60, A on or just after V | AH short / HA long (long RP) | AH long / HA > 70 |
| Septal VA | ≤70 ms (often −10 to +40) | >70; RP > PR | >70 |
| Earliest A | Anterior septum (His channel A; FP exit) | CS os / posterior septum | CS os / proximal CS |
| CS sequence | Concentric (CS9-10 → CS1-2) | Concentric, CS os earliest | Concentric |
| ECG | Pseudo-r′ in V1, pseudo-S in II/III/aVF | Negative P in II/III/aVF, long RP | Short–intermediate RP |

**Induction:** atrial S1S2 with A1A2 below FP ERP and at or above SP ERP causes an AH jump of at least 50 ms. Echo or tachycardia follows when the critical AH is reached (the delay lets FP recover retrogradely). Window at S1 600: **A1A2 260–320 ms** (default model). Atrial burst near AVWCL also induces. Isoproterenol at 1–3 µg/min is needed in 30–50% of cases (shortens FP retro ERP). Ventricular extrastimuli occasionally induce atypical forms.

**Diagnostic manoeuvres (expected AVNRT results):**

| Manoeuvre | AVNRT result | Cut-off |
|---|---|---|
| RV entrainment (pacing CL = TCL − 10 to −40 ms) | **PPI − TCL > 115 ms**; **SA − VA > 85 ms** | Corrected PPI (subtract the post-pacing AH increment) > 110 ms |
| Response after V overdrive | **V-A-V** | — |
| His-refractory PVC | **No change** to the next A or TCL | — |
| Para-Hisian pacing (sinus) | **Nodal response**: losing His capture increases SA by an amount near the HV interval, with HA constant | ΔSA > ~20 ms |
| ΔHA (HA pacing − HA SVT) | > 0 ms (parallel activation in SVT) | AVRT is usually < −10 ms |
| Atrial overdrive VA linking | VA of the first return beat fixed (Δ <10 ms) | AT variability > 14 ms |
| VA block during SVT | Possible (2:1 VA block with an upper common pathway). This excludes AVRT | — |
| Adenosine | Terminates, usually in the anterograde SP (ends with A) | — |

**Activation map:** not a macro-reentry chamber map. Retrograde atrial activation is centrifugal from the FP exit (anterior septum) in typical AVNRT and from the CS os in atypical. Total RA activation is about 60–90 ms, which is far below TCL.

**Ablation:**
- Target the **slow pathway region**: inferior or mid Koch's triangle between the CS os and the TA (`SP_ENTRY`), at 4–6 o'clock in the LAO view.
- Local EGM: small, multicomponent A with a large V. A:V ratio is 1:3 to 1:10. A slow-pathway potential may be present.
- RF: 30–50 W, 20–60 s. Cryoablation is an alternative near the His (−70 to −80 °C, 4 min, cryomapping at −30 °C).
- **Junctional rhythm during RF** is a marker of effect. Good: CL > 350 ms with 1:1 VA conduction. **Stop immediately** if the junctional rhythm is fast (CL < 350 ms), VA block appears, AV block appears, or PR/AH lengthens.
- **Endpoint:** non-inducibility with and without isoproterenol. Acceptable endpoint is SP elimination (no jump) or residual SP with at most 1 echo beat and no SVT. Check AV conduction (AH, AVWCL) afterwards.

### 4.2 AVRT (orthodromic, antidromic, concealed AP)

| Item | Orthodromic (ORT) | Antidromic (ART) | Concealed AP | PJRT |
|---|---|---|---|---|
| Circuit | A → AVN → His → V → AP → A | A → AP → V → His/BB (retro) → AVN → A | ORT only (retrograde-only AP) | ORT with a decremental, slow posteroseptal AP |
| TCL | 260–400 (330) | 250–400 (300) | 260–400 | 350–600, incessant |
| QRS | Narrow (or BBB aberrancy) | Wide, fully pre-excited | Narrow | Narrow |
| VA | ≥70 ms (90–140), fixed | Retro His before A | ≥70 | Long RP (RP > PR) |
| Earliest A | **AP atrial insertion**, eccentric for left free wall (CS1-2 or CS3-4 earliest) | — | Per AP | CS os |
| Mandatory | 1:1 AV relationship; A and V both required | — | — | — |

**Induction:**
- Atrial S2 below the anterograde AP ERP but above the AVN ERP blocks the AP and conducts through the AVN with enough AH delay, giving ORT. Window: **A1A2 ≈ AP-ERP down to AVN-ERP**, default 300 → 260 ms.
- Ventricular S2 that blocks in the His–Purkinje system or AVN retrogradely while conducting through the AP gives ORT. Window: **V1V2 280–230 ms**.
- Burst pacing also induces.
- For ART, the atrial S2 must block in the AVN while conducting through the AP, and the retrograde AVN must have recovered.

**Diagnostic manoeuvres (ORT):**

| Manoeuvre | Expected |
|---|---|
| RV entrainment | **PPI − TCL < 115 ms**, **SA − VA < 85 ms**, V-A-V response |
| His-refractory PVC (delivered when the anterograde His is already committed, about 0–50 ms before the expected His) | **Advances A** means a retrograde AP is present. **Terminates without reaching A** means the AP is in the circuit. **Delays A** means a decremental AP |
| Para-Hisian pacing | **Extranodal (AP) response**: SA constant whether or not the His is captured (septal APs) |
| Coumel's law | BBB ipsilateral to a free-wall AP increases VA (and TCL) by **≥35 ms**. Septal AP: 10–25 ms |
| Differential RV pacing (apex vs base) | Septal AP: VA from the base is shorter than VA from the apex |
| V pacing during sinus | Eccentric, non-decremental VA (unless decremental AP) |
| Adenosine during V pacing | Persistent VA conduction means an AP (AVN conduction is blocked) |

**Ablation:**
- Map **earliest retrograde A** during ORT or V pacing with continuous VA. Look for a possible AP potential and local VA fusion. Target at least 20–30 ms before the P/delta reference where applicable.
- Left-sided APs: transseptal or retrograde aortic approach, at the mitral annulus (ventricular or atrial side).
- RF: 30–40 W, 30–60 s. Block within 2–6 s predicts success. Stop at 10–15 s if there is no effect.
- **Endpoint:** no AP conduction in either direction. Retrograde VA becomes concentric and decremental (AVN), or VA dissociation with adenosine. Non-inducible with isoproterenol. Wait 20–30 min to check for recurrence.

### 4.3 WPW syndrome (manifest AP) and localization

**Baseline physiology:** short PR (<120 ms), delta wave, QRS >110 ms, short or negative HV. Degree of pre-excitation depends on AVN delay vs AP proximity to the SA node. Left lateral APs show less pre-excitation in sinus. **Atrial pacing** from near the AP or with AVN decrement maximises pre-excitation. **AF with pre-excitation:** risk marker SPERRI ≤250 ms.

**AP distribution (simulation scenario weighting):** left free wall 50–60%, posteroseptal 20–30%, right free wall 10–20%, anteroseptal/para-Hisian 2–5%, midseptal 2–5%. Multiple APs occur in 5–10%.

**Delta-wave polarity for ECG validation** (+ positive, − negative, ± isoelectric or biphasic):

| AP location (clock) | I | aVL | II | III | aVF | V1 | Transition | Notes |
|---|---|---|---|---|---|---|---|---|
| Left lateral (MA 2–3) | − / ± | − | + | + | + | + (R>S) | V1 | RBBB-like |
| Left posterolateral (MA 4) | + | ± | + / ± | − / ± | − / ± | + | V1 | |
| Left posterior / posteroseptal (MA 5) | + | + | − / ± | − | − | + (R≥S) | V1–V2 | |
| Right posteroseptal (TA 5–6, CS os) | + | + | − | − | − | ± / − | V2–V3 | **Steep negative delta in II** suggests an epicardial CS-diverticulum AP |
| Midseptal (TA 2–3 LAO side) | + | + | + / ± | − / ± | ± | ± / − | V2–V3 | |
| Anteroseptal / para-Hisian (TA 12–1) | + | + | + | + / ± | + | − / ± | V2–V3 | Narrowest QRS; AV-block risk |
| Right anterolateral (TA 9–11) | + | + | + | ± | + / ± | − | ≥V3–V4 | LBBB-like, left axis if posterior |
| Right posterolateral (TA 7–8) | + | + | − / ± | − | − | − | ≥V3–V4 | |

Use a stepwise algorithm as a trainee aid (Arruda-type): (1) Lead I negative/isoelectric or V1 R>S → left free wall. (2) Negative II → epicardial posteroseptal (CS). (3) Negative aVF → posteroseptal (V1 R≥S left PS, otherwise right PS). (4) Otherwise right free wall vs anteroseptal by aVF positivity and transition.

**Anterograde mapping target:**
- Earliest local V that **precedes delta onset by 0 to −15 ms**, with the shortest local AV interval (A and V fused).
- AP potential present.
- Unipolar EGM shows QS with a sharp intrinsicoid deflection.

**Endpoint:**
- **Loss of the delta wave**: PR normalises and HV returns to 35–55 ms.
- No retrograde AP conduction (concentric, decremental VA).
- AP effect within 6 s of RF.
- Wait 20–30 min, repeat testing with adenosine 12–18 mg, and check for dormant conduction.

### 4.4 Focal atrial tachycardia

| Item | Value |
|---|---|
| Mechanism | Automatic (warm-up/cool-down, not PES-inducible, iso-sensitive), triggered (burst-inducible, iso, adenosine-sensitive), or microreentry (PES-inducible, entrainable) |
| TCL | 250–550 (380); may vary ±5–10% |
| Common foci and weights | Crista terminalis 30%, TA 10–15%, CS os 5–10%, para-Hisian/NCC 5–10%, PV ostia 15–20%, MA/aortomitral continuity 5%, LAA 3%, RAA 3% |
| P wave | V1 negative/biphasic → RA lateral/TA. V1 positive → LA (PV), V1 negative-then-positive → septal. Inferior leads positive → superior focus (upper crista, superior PVs, RAA) |
| AV relationship | Long RP (RP > PR). **AV block does not terminate the AT** (A continues) |
| CS sequence | Depends on focus: concentric for RA/septal, distal-to-proximal for left lateral |
| EGM | Earliest local A at the focus. A-A intervals determine V-V intervals |
| Activation map | **Centrifugal** spread from a single earliest point (red spot). Total activation time < 50–70% of TCL. No early-meets-late |
| Target | Earliest bipolar A **≥ 20–60 ms (typ ≥30) before P-wave onset**. Unipolar **QS** with a sharp negative deflection. ≥ 1 cm² early zone indicates a deeper focus |

**Manoeuvres:**
- V overdrive during SVT gives **V-A-A-V**. Use the last captured V to the first A. Beware pseudo-VAAV in atypical AVNRT with a long HV: use the A-A-H-V sequence.
- Atrial overdrive gives a variable post-pacing VA (>14 ms difference).
- Spontaneous or adenosine-induced AV block with persistent tachycardia indicates AT.
- PPI > TCL + 20 ms from most sites (automatic: no true entrainment).

**Ablation and endpoint:** RF 25–35 W, 30–60 s, at the earliest site. Expect transient acceleration then termination within 10 s. **Endpoint:** termination and non-inducibility with burst pacing and isoproterenol 2–10 µg/min, maintained for 20–30 min. Phrenic capture check at the lateral RA and RSPV (high-output pacing at 10 mA).

### 4.5 Typical (CTI-dependent) atrial flutter and atypical flutters

| Item | Counter-clockwise (CCW), ~90% | Clockwise (CW) |
|---|---|---|
| Circuit (LAO view of TA) | Ascends septum, descends lateral wall, crosses CTI lateral → medial | Reverse |
| Anterior/posterior barriers | TA anteriorly; crista terminalis / Eustachian ridge / IVC posteriorly (functional block) | Same |
| TCL | 200–300 (240); with antiarrhythmic drugs up to 350 | 200–300 |
| ECG | Saw-tooth **negative F waves in II/III/aVF**, positive V1 | Positive inferior, negative V1 |
| AV conduction | 2:1 is typical (ventricular CL ~480), variable 3:1 / 4:1 | |
| CS | Proximal → distal (CS os activated from the septum) | Distal → proximal is not typical; CS os is activated late |
| TA 20-pole | CCW: high-lateral → low-lateral (poles 19-20 → 1-2) then CS os | Reverse |
| Activation map (RA) | **Early-meets-late** adjacent across the arbitrary reference, around the TA. Total RA activation **≥ 90% TCL** | Same, reversed |

**Entrainment** (pace 10–30 ms shorter than TCL):

| Site | PPI − TCL | Fusion |
|---|---|---|
| CTI (isthmus) | **≤ 20 ms** (≤30 acceptable) | Concealed |
| Lateral or septal RA (on the circuit) | ≤ 20–30 ms | Manifest |
| CS distal / LA | > 40 ms | Manifest (off circuit) |
| RA appendage / posterior RA | > 30 ms | Bystander |

**Ablation:**
- Line from the TA (ventricular edge, A:V ≈ 1:2–1:4) to the IVC along 6–7 o'clock in the LAO view.
- Length 25–35 mm.
- RF 35–50 W, 20–40 s per point, or drag. Inter-lesion distance ≤ 4–6 mm.

**Endpoint, bidirectional CTI block:**
- **Pacing at the CS os (proximal CS 9-10)**: lateral RA activates strictly descending (high → low). Conduction time CS os → low lateral RA **≥ 90–150 ms**, or a ≥50% increase from baseline.
- **Pacing at the low lateral RA**: the CS os activates late, from the septum. Low lateral RA → CS os time **≥ 90–150 ms**.
- **Double potentials** along the whole line, separated by **≥ 30 ms (complete block typically ≥ 110 ms)**, with no isoelectric bridging fractionation.
- **Differential pacing:** pacing from a site moved away from the line on the lateral side *shortens* the time to CS os. This confirms block (and excludes slow gap conduction, where the time would lengthen).

**Atypical / left atrial flutter (mention scenarios):**
- **Perimitral**: CL 220–320. CS activation is a proximal-distal "chevron" or sequential. Entrainment at the CS and anterior LA gives PPI − TCL < 20. The **mitral isthmus line** runs from LIPV to the lateral MA. Endpoint: differential pacing from CS 1-2 vs LAA showing block (CS distal activated late, proximal-to-distal reversal).
- **Roof-dependent**: anterior LA ascending vs posterior wall descending. Roof line LSPV–RSPV. Endpoint: pacing from the LAA activates the posterior wall caudo-cranially.
- **Scar-related RA/LA** (post-surgical, post-ablation): channel inside low voltage (<0.1–0.5 mV).

### 4.6 Atrial fibrillation (PV isolation)

| Item | Value |
|---|---|
| Mechanism (model) | PV-sleeve ectopic foci (CL 100–180 ms) trigger fibrillatory conduction in an LA with short heterogeneous ERP. Optional sustained "driver" in the PV antrum |
| Trigger distribution | PVs 80–90% (LSPV > RSPV > LIPV > RIPV). Non-PV 10–20%: SVC, posterior wall, CS, LAA, crista, ligament of Marshall |
| AF CL | LA 150–200 ms (5–7 Hz). PV 110–160 ms. RA longer (≥ 180) |
| Substrate parameters | ERP 120–180 with ±20% spatial noise. CV 0.4–0.7 m/s. Wavelength 60–100 mm, which supports 3–6 wavelets. Optional low-voltage (<0.5 mV) patches in persistent AF |
| ECG | No P waves, irregular fibrillatory f waves, irregularly irregular RR |
| EGM | CS: irregular, variable morphology and CL. Fractionation (CFAE) where CL < 120 ms |
| Circular catheter in PV | Sharp PV potentials. In sinus or CS pacing: far-field LA, then the PV potential |

**Induction:** atrial burst at 200–250 ms decreasing to 150 ms or 1:1 capture loss, from the CS or HRA. PV ectopy appears spontaneously under isoproterenol (up to 20 µg/min) in the trigger-mapping protocol.

**Ablation (PVI):**
- **Wide antral circumferential ablation**: encircle the ipsilateral PV pairs 5–15 mm outside the ostia.
- Point-by-point RF: 25–40 W standard, 30–50 W "power-guided", or 50 W high-power short-duration for 5–15 s.
- Inter-lesion distance ≤ 6 mm. Target LQI per region: posterior wall about 0.8× anterior.
- Pulsed-field mode (optional, simplified): instantaneous lesions of fixed size, no impedance drop, no oesophageal heating.

**Endpoints:**
- **Entrance block**: no PV potentials in sinus rhythm or CS pacing. Equivalent: local PV potentials disappear and only far-field signals remain.
- **Exit block**: pacing inside the PV (10 mA, 2 ms) captures the sleeve locally but does not propagate to the LA. Spontaneous dissociated PV activity is also proof.
- Optional confirmation: 20–30 min waiting period, and adenosine 12–18 mg to unmask dormant conduction.
- **Gap modelling:** a ring with any contiguous path of non-ablated nodes ≥ 1–2 node widths reconnects. Show the "earliest PV potential on the circular catheter" as a gap locator.

### 4.7 Ventricular tachycardia

#### 4.7a Scar-related reentrant VT (post-MI)

| Item | Value |
|---|---|
| Substrate | Dense scar (<0.5 mV) with a border zone (0.5–1.5 mV). Channel(s) of surviving myocardium (`SLOW_CHANNEL`, 0.2–1.0 mV) bounded by scar or annulus |
| Circuit | "Figure-of-8" or single loop: entrance → central isthmus (width 5–15 mm, length 15–40 mm, CV 0.05–0.2) → exit → outer loop around the scar → re-entry |
| TCL | 300–550 (400). Haemodynamic tolerance: CL < 300 is usually unstable (offer a "map in sinus only" mode) |
| QRS morphology | RBBB-like → LV exit. LBBB-like → RV or septal exit. Superior axis → inferior wall exit. Inferior axis → anterior/basal-superior exit. Negative concordance → apical. Positive concordance → basal |
| EGM | **Mid-diastolic potentials** (0.05–0.5 mV) on ABL in the isthmus. Fractionated border-zone EGMs |
| Sinus substrate | **Late potentials / LAVA** after QRS end. Isochronal late activation map shows **deceleration zones** (≥ 3 isochrones of 10 ms within a 1 cm radius) |
| Activation map (VT) | Early-meets-late around the scar. Narrow isthmus with crowded isochrones. Total activation ≥ 90% of TCL (if diastolic channel is mapped) |

**Entrainment classification** (pace 20–40 ms shorter than TCL):

| Site | Fusion | PPI − TCL | S-QRS vs EGM-QRS | S-QRS / TCL |
|---|---|---|---|---|
| Isthmus exit | Concealed | ≤ 30 ms | Equal (±20 ms) | < 30% |
| Central isthmus | Concealed | ≤ 30 | Equal | 30–50% |
| Proximal (entrance) | Concealed | ≤ 30 | Equal | 51–70% |
| Inner loop | Concealed | ≤ 30 | Equal | > 70% |
| Outer loop | **Manifest** | ≤ 30 | — | — |
| Adjacent bystander | Concealed | > 30 | S-QRS > EGM-QRS | — |
| Remote bystander | Manifest | > 30 | — | — |

**Pace mapping (sinus):**
- 12/12 match (correlation ≥ 94%) at the exit.
- **S-QRS > 40 ms** with a match indicates a slow-conduction region.
- Multiple morphologies from one site indicate an isthmus.

**Induction:**
- RV apex then RVOT, drive CL 600/400, S2–S4.
- Each extrastimulus decrements in 10 ms steps to ERP or a 200 ms floor.
- Isoproterenol is optional.
- Model window: **V1V2 or V2V3 ≈ 240–300 ms**, which blocks unidirectionally at the isthmus entrance (see the source-sink rule in §2.3).

**Ablation:**
- Target the isthmus (central or exit) with an irrigated tip: 30–50 W, 60–120 s per lesion, wall thickness 8–12 mm.
- Linear lesions through the channel or connecting scar to the annulus.
- Homogenise the late-potential area.

**Endpoint:**
- Termination during RF (ideally within 10 s at the isthmus).
- **Non-inducibility of clinical and all monomorphic VTs** with the full protocol.
- Elimination of LAVA / late potentials.

#### 4.7b Idiopathic RVOT focal VT/PVC

| Item | Value |
|---|---|
| Mechanism | cAMP-mediated triggered activity (DADs). Adenosine-sensitive, verapamil/β-blocker sensitive. Not reentrant |
| Focus | RVOT septal anterior (~70%), RVOT free wall, pulmonary cusp. LVOT/aortic cusp differential (RCC/LCC) |
| TCL / pattern | PVCs, salvos, NSVT, or repetitive monomorphic VT. CL 280–500 (350) |
| QRS | **LBBB-like, inferior axis** (tall R in II, III, aVF; negative aVR/aVL). Precordial transition **≥ V3–V4** (RVOT). Transition ≤ V2, or V2 transition ratio ≥ 0.6 → LVOT/cusp. Free wall: wider QRS (>140 ms), notching in inferior leads, later transition |
| Activation map | Centrifugal from a focal point. Earliest local V **−25 to −45 ms pre-QRS** (≥ −20 required) |
| Induction | **Burst pacing (CL 300–400) + isoproterenol 2–10 (up to 20) µg/min**, or during washout. PES usually ineffective |
| Target | Earliest bipolar V with **unipolar QS**. Pace map ≥ 11/12 match |
| Endpoint | Elimination of spontaneous and iso-inducible PVCs/VT for 30 min |

### 4.8 Ventricular fibrillation

| Item | Value |
|---|---|
| Mechanism (model) | Wavebreak with multiple meandering rotors. Steep APD restitution (slope >1), short ERP (ventricle 150–190), heterogeneous ±25%. Optional Purkinje-triggered short-coupled PVC (coupling < 300–350 ms) |
| CL | 150–220 ms, irregular, polymorphic. No organised activation map (the LAT map is meaningless; display a "phase map" mode instead) |
| ECG | Chaotic, amplitude 0.2–1.0 mV, no discernible QRS |
| Induction | Aggressive PES (S3/S4 coupling < 200 ms), burst < 200 ms, T-wave shock. Induction by triple extrastimuli is a **non-specific** response |
| Required simulator behaviour | Haemodynamic collapse within 5–10 s. Training cue: defibrillation 150–200 J biphasic (simulate success ~90% per shock if delivered < 60 s). External pads always available |
| Ablation (advanced, optional) | Map and ablate the PVC trigger (Purkinje potentials preceding the PVC by 10–40 ms) |

### 4.9 Summary table of default scenario parameters

| Scenario | TCL default | Inducer | Key target | Endpoint check (engine test) |
|---|---|---|---|---|
| AVNRT typical | 350 | A S1S2 ~300→260 | `SP_ENTRY` | A S1S2 + burst + iso: no SVT, ≤1 echo |
| ORT (concealed/manifest) | 330 | A S2 or V S2 | AP atrial or ventricular insertion | No VA via AP; delta absent |
| WPW | — (sinus pre-excited) | — | AP ventricular insertion | Delta loss, HV normal |
| Focal AT | 380 | iso / burst | Earliest A focus | No AT with iso + burst |
| CTI flutter | 240 | Burst 220–180 at CS os or low lateral RA | CTI line | Bidirectional block (both pacing tests) |
| Perimitral flutter | 260 | Burst | Mitral isthmus | Differential block |
| AF / PVI | 180 | Burst 200→150 or PV firing | Antral rings | Entrance + exit block, all 4 PVs |
| Scar VT | 400 | V PES up to S4 | Isthmus | Non-inducible |
| RVOT VT | 350 | Burst + iso | Earliest V focus | No PVC/VT on iso |
| VF | 180 | S3/S4 < 200 | — | Defibrillation |

---

## 5. Ablation biophysics (simulation-grade)

### 5.1 RF parameters and defaults

| Parameter | Range (default) | Notes |
|---|---|---|
| Frequency | 450–500 kHz | Display only |
| Power, irrigated | 20–50 W (30–35). HPSD 50 W × 5–15 s. Very high power 90 W × 4 s (optional) | Posterior LA and close to the oesophagus: ≤ 25–30 W |
| Power, non-irrigated 4 mm | 30–50 W, temperature-controlled | Used for AVNRT/AP |
| Temperature limit | Irrigated 43–48 °C; non-irrigated 55–60 °C | |
| Irrigation | 2 mL/min idle; 15–30 mL/min ablating | |
| Duration | 5–120 s (30) | |
| Baseline impedance | 90–160 Ω (120) | Higher in poor contact, falls in the blood pool |
| Effective impedance drop | 5–15 Ω (≥10 Ω indicates a good lesion) | **> 18–20 Ω or a sudden rise means a steam-pop / coagulum risk** |
| Contact force | 10–40 g target (15–20). < 5 g ineffective. > 40 g perforation risk (esp. LAA, roof, RVOT) | Simulated CF depends on catheter push and sheath support, plus a cardiac/respiratory oscillation of ±3–8 g |
| Force–time integral (FTI) | target ≥ 400 g·s (atrium) | |
| Lesion quality index (LQI, original) | `LQI = k · ∫ CF(t)^a · P(t)^b dt`, with a≈0.7, b≈1.0, then mapped to a 0–1000 scale | Atrial target: anterior ≥ 500, posterior ≥ 400. Ventricle ≥ 600 |
| EGM attenuation | ≥ 75–90% bipolar amplitude reduction within 10–20 s indicates an effective lesion | |

### 5.2 Lesion growth model

```
// Inputs per tick (dt = 100 ms): P (W), CF (g), irrigated (bool), catheter stability (mm drift)
contactEff = clamp((CF - 2) / 18, 0, 1.4)                  // 0 at ≤2 g, 1 at 20 g, saturates at ~27 g+
Dinf_mm    = 0.16 * P * contactEff^0.6 * (irrigated ? 1.0 : 0.8)   // asymptotic depth
tau_s      = 9 (irrigated) | 7 (non-irrigated)
depth(t)   = Dinf_mm * (1 - exp(-t / tau_s))                 // continues ~2–5 s after RF off (thermal latency)
diameter(t)= 1.4 * depth(t) + 2.5                            // surface diameter, mm (typ 6–10 mm)
drift: if catheter moves > 2 mm during a lesion, split it into separate shallower lesions (gaps!)

Expected outputs (sanity checks):
  30 W, 20 g, 30 s   → depth ≈ 4.5 mm, Ø ≈ 9 mm
  50 W, 15 g, 10 s   → depth ≈ 4.0 mm, Ø ≈ 8 mm (HPSD: wide, shallow)
  40 W, 30 g, 60 s   → depth ≈ 7–8 mm, Ø ≈ 12 mm (ventricle)
  any P, CF < 3 g    → depth < 1 mm (blood cooling)
```
**Impedance and temperature:**
```
Z(t)    = Z0 - dZmax * (1 - exp(-t / 5)) + N(0, 1.5)      // dZmax = 0.3 * P * contactEff^0.5 (Ω)
T_tip   = irrigated ? 30 + 0.25*P*contactEff : min(Tset, 37 + 0.6*P*contactEff)
popRisk = sigmoid((P * contactEff * t / 1000) - 3.5) + (dZ > 20 Ω ? 0.3 : 0)   // per lesion, sample once
```

### 5.3 Effect of lesions on the conduction model

For each mesh node within `diameter/2` (core) and `diameter/2 + 2 mm` (oedema rim) of the lesion centre, measured along the surface:

| Zone | Condition | Effect |
|---|---|---|
| **Core, transmural** | `depth ≥ wallThickness` | `tissue = ABLATED_CORE`, cv = 0 permanently. Bipolar × 0.1–0.2 |
| **Core, non-transmural** | `depth < wallThickness` | `cvScale *= max(0.1, 1 - depth/wallThickness)`. Conduction survives deep (endo/epi layer model: cut only the layers within `depth`). Bipolar × (1 − 0.8·depth/wall) |
| **Oedema rim** | within +2 mm | Transient `cvScale *= 0.5` (or transient block if overlapping lesions), recovering with τ = 20–30 min of simulated time. This represents **acute reconnection** and gap recovery, which is the reason for waiting periods |
| **Lesion contiguity** | inter-lesion edge-to-edge distance > 0 | A gap of ≥ 1 node (~2 mm) with cvScale > 0.2 conducts. Lines are complete only when cores overlap |

- **Block detection** for endpoint scoring runs graph connectivity (BFS) across the line, excluding nodes with cv = 0. It also runs a CA pacing test (CS os vs low lateral pacing for the CTI; PV-inside vs LA pacing for PVI).
- **RF on an active circuit:** if a lesion core intersects the isthmus or the critical focus node, the tachycardia terminates on the next cycle.
- **Accelerated junctional rhythm** (AVNRT slow-pathway ablation): if the lesion is within 6 mm of `SP_ENTRY`, generate junctional beats at CL 400–1000 ms (ventricle and atrium near-simultaneous), with probability ∝ heating.
- **AP ablation:** an AP link is cut when lesion core ∩ AP insertion ≠ ∅ and `depth ≥` AP depth (endocardial 2–4 mm; epicardial/CS-diverticulum AP needs CS-side ablation). Block occurs at t = 2–6 s at the correct site.

### 5.4 Cryoablation (optional mode)

- Cryomapping at −30 °C causes reversible block (`cvScale = 0` for 60 s, then recovery). Use it to test AV block risk.
- Ablation at −70 to −80 °C for 240 s. Lesion Ø 5–7 mm, depth 3–5 mm.
- Adherence prevents catheter drift. No junctional rhythm.

### 5.5 Complications to model (teaching)

| Complication | Trigger in model | Signal to the trainee |
|---|---|---|
| AV block | RF within 5 mm of `HIS`/`COMPACT_AVN`. Risk ∝ proximity, power and time; > 50% if within 2 mm | PR/AH prolongation → fast junctional rhythm with VA block → complete heart block (permanent if core covers the node) |
| Steam pop / perforation / tamponade | popRisk sample; CF > 50 g in thin wall | Audible pop, impedance spike, then falling BP after 1–5 min |
| Phrenic palsy | RF within 10 mm of the `PHRENIC_R` line (SVC, RSPV, lateral RA) | Pre-check: high-output pacing captures the diaphragm |
| Oesophageal heating | Posterior LA within 10 mm of `ESOPHAGUS` | Luminal temperature probe rise > 39–40 °C (stop) |
| PV stenosis | Lesions inside the PV ostium (> 5 mm in) | Warning |
| Coronary injury | RF in the aortic cusps within 8 mm of the coronary ostia | Warning; ST change |

---

## 6. Programmed stimulation protocols

**General settings:** pulse width 2 ms. Output 2× diastolic threshold (typically 1–2 mA, threshold ≤ 1 mA). High-output 10–20 mA for para-Hisian and exit-block testing. Drive train S1 × 8 beats. Pause 1–2 s between trains. Abort and give feedback if 1:1 capture fails.

| Protocol | Site | Parameters | Measures / purpose |
|---|---|---|---|
| **Incremental atrial (S1S1)** | HRA or CS prox | Start at 600 (or 50 ms below sinus CL). Decrease by 10–20 ms to AVWCL, then to 300 / 2:1 block (floor 250 in model) | AVWCL, AP anterograde 1:1 CL, sinus node recovery time (SNRT ≤ 1500 ms; cSNRT ≤ 525 ms) |
| **Atrial extrastimulus (S1S2)** | HRA, CS | S1 600 and 400. S2 starts at 400 (or S1 − 50) and decrements by 10 ms to atrial ERP | AVN ERP, FP/SP ERP, AH jump, echo, AP ERP |
| **Double/triple atrial (S1S2S3)** | HRA, CS | S2 fixed at ERP + 50, decrement S3 | AVNRT/AT induction when S2 fails |
| **Incremental ventricular** | RVA | 600 → VA Wenckebach / 300 | VA conduction pattern (concentric vs eccentric, decremental vs not) |
| **Ventricular extrastimulus** | RVA, then RVOT | S1 600/400; S2 → ERP; add S3, S4 (each decrement 10 ms, floor 200 ms) | VA ERP, VT induction, retrograde jump |
| **Atrial burst** | HRA/CS/LA | 300 → 200 (flutter/AF down to 150 or loss of 1:1), 5–15 s | AFL/AF/AT induction |
| **Ventricular burst** | RVA/RVOT | 400 → 250 | RVOT VT (with iso) |
| **Entrainment** | Any | Pacing CL = TCL − 10 to −40 ms, ≥ 8–15 beats, verify acceleration of all chamber EGMs to the pacing CL | PPI − TCL, fusion type, S-QRS |
| **Para-Hisian** | His region, high output | 10–20 mA, alternating His+RV and RV-only capture | Nodal vs extranodal |
| **His-refractory PVC** | RV | Single V stimulus during SVT, timed when the His is committed (≈ at expected His ± 0 to −50 ms) | AP presence / participation |
| **V overdrive in SVT** | RV | TCL − 20 to −40 ms | VAV vs VAAV |
| **Atrial overdrive in SVT** | HRA/CS | TCL − 20 to −40 ms, multiple CLs | VA linking |
| **Isoproterenol** | IV | 1–3 µg/min (SVT), 2–10 up to 20 µg/min (AT, RVOT VT, AF triggers). Effect: sinus +20–30%, AVN ERP −10–20%, FP retro ERP −15%, focus CL × 0.6–0.8 | Repeat protocols on iso |
| **Atropine** | IV | 0.5–1 mg. Effect: AVN conduction improves, ERP −10% | AVNRT induction alternative |
| **Adenosine** | IV | 6–18 mg. Effect: transient AVN block 5–15 s, shortens atrial ERP, terminates triggered AT/RVOT VT, unmasks dormant PV conduction | Diagnostic / endpoint |

**Expected induction windows (model defaults; scenario authors may perturb ±20 ms):**

| Arrhythmia | Most reliable inducer | Window |
|---|---|---|
| Typical AVNRT | Atrial S1S2 at S1 600 | A1A2 **320 → 260 ms** (FP ERP to SP ERP). Critical AH ≥ 180–200 ms. Iso if no induction |
| Atypical AVNRT | Ventricular S1S2 or atrial S1S2S3 | V1V2 300–250 (retro FP block, conduction via SP) |
| ORT (AVRT) | Atrial S2 or ventricular S2 | A1A2 = AP-ERP (300) → AVN-ERP. V1V2 = HPS/AVN retro ERP (≈ 280–230) |
| Antidromic AVRT | Atrial S2 / burst | AVN block with AP conduction, A1A2 < AVN ERP (needs AP-ERP < AVN-ERP) |
| Focal AT (triggered) | Atrial burst 300–250 ± iso | Coupling-dependent. Automatic AT: iso only |
| Focal AT (microreentry) | Atrial S1S2(S3) | A1A2 280–220 |
| CTI flutter | Burst from CS os or low lateral RA | CL 250 → 180. S1S2 at 220–200 gives unidirectional CTI block |
| AF | Burst 200 → 150; PV ectopy on iso | Atrial capture CL < atrial ERP + 30 |
| Scar VT | Ventricular PES S2–S4 | Coupling 300 → 240 (≥ ERP), 2 drive CLs, 2 sites |
| RVOT VT | Burst 400–300 + iso, or iso washout | Not PES-coupled |
| VF | S3/S4 < 200 ms, burst < 200 | Non-specific |

---

## 7. Validation checklist for the engine (quick tests)

| Test | Expected |
|---|---|
| Sinus beat | P duration 80–110. AH 85, HV 45. QRS 80–100. CS concentric prox→dist 35 ms |
| Atrial S1S2 600/decrement | Smooth AH curve, then a ≥50 ms jump at ≈ 320 (dual-pathway scenario). Atrial ERP ≈ 230 |
| RV pacing 600 | VA ≈ 140 ms, concentric (no AP). Eccentric with a left lateral AP |
| CTI flutter | TCL 240 ± 20, stable for > 60 s. CTI entrainment PPI − TCL ≤ 20. LA entrainment > 40 |
| Line with 1-node gap | No block. Pacing at CS os shows slow conduction across the CTI |
| Completed CTI line | CS os → low lateral ≥ 120 ms. Double potentials ≥ 100 ms |
| PVI ring complete | PV potentials vanish on the circular catheter. Inside-PV pacing does not propagate |
| Scar VT isthmus entrainment | Concealed fusion, PPI − TCL ≤ 30, S-QRS ≈ EGM-QRS |
| RF 30 W/20 g/30 s | Depth ≈ 4.5 mm, ΔZ ≈ 9–10 Ω |

---

## 8. Key references (titles only)

**Textbooks**
1. Josephson ME. *Josephson's Clinical Cardiac Electrophysiology: Techniques and Interpretations.*
2. Issa ZF, Miller JM, Zipes DP. *Clinical Arrhythmology and Electrophysiology: A Companion to Braunwald's Heart Disease.*
3. Huang SKS, Miller JM. *Catheter Ablation of Cardiac Arrhythmias.*
4. Zipes DP, Jalife J, Stevenson WG. *Cardiac Electrophysiology: From Cell to Bedside.*
5. Murgatroyd F, Krahn A, et al. *Handbook of Cardiac Electrophysiology.*
6. Asirvatham SJ, Cha YM, Friedman PA. *Mayo Clinic Electrophysiology Manual.*

**Guidelines and consensus**
7. 2019 ESC Guidelines for the management of patients with supraventricular tachycardia.
8. 2015 ACC/AHA/HRS Guideline for the Management of Adult Patients With Supraventricular Tachycardia.
9. 2023 ACC/AHA/ACCP/HRS Guideline for the Diagnosis and Management of Atrial Fibrillation. 2024 ESC Guidelines for the management of atrial fibrillation.
10. 2017 HRS/EHRA/ECAS/APHRS/SOLAECE Expert Consensus Statement on Catheter and Surgical Ablation of Atrial Fibrillation (and its 2024 update).
11. 2019 HRS/EHRA/APHRS/LAHRS Expert Consensus Statement on Catheter Ablation of Ventricular Arrhythmias.
12. 2022 ESC Guidelines for the management of patients with ventricular arrhythmias and the prevention of sudden cardiac death.
13. 2012 PACES/HRS Expert Consensus Statement on the Management of the Asymptomatic Young Patient with a WPW ECG Pattern.

**Key methods papers (concepts)**
14. Stevenson WG et al. Entrainment mapping criteria for post-infarction VT isthmus identification (Circulation, 1993).
15. Hirao K et al. Para-Hisian pacing (Circulation, 1996).
16. Knight BP et al. Atrial vs ventricular response after ventricular overdrive pacing, VAAV vs VAV (JACC, 2000).
17. Michaud GF et al. Differentiation of AVNRT from AVRT by RV entrainment, PPI − TCL and SA − VA (JACC, 2001).
18. Arruda MS et al. Stepwise ECG algorithm for AP localization (J Cardiovasc Electrophysiol, 1998).
19. Jaïs P et al. Elimination of local abnormal ventricular activities (Circulation, 2012). Aziz Z/Tung R. Isochronal late activation mapping and deceleration zones (2019).
20. Marchlinski FE et al. Voltage criteria for scar (bipolar 0.5/1.5 mV; unipolar 8.3 mV LV) (Circulation, 2000).
21. Sethian JA. Fast Marching Methods. Mitchell CC & Schaeffer DG. A two-current model for the dynamics of cardiac membrane (2003).
22. Haines DE / Wittkampf FHM. Biophysics of RF lesion formation and impedance monitoring. Contact-force trials (TOCCATA, EFFICAS, SMART-AF).
