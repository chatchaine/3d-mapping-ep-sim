# 02 — Clinical Cases & Curriculum

Clinical training content for the 3D electroanatomic mapping (EAM) EP simulator. The program is an original teaching tool. It does not copy or brand any vendor system.
Author role: clinical electrophysiologist and fellowship educator.
Audience: fellows in EP and general cardiology, EP nurses and allied professionals, and the developers who will encode this file as JSON case data.

> **Disclaimer for in-app display:** These cases are simplified on purpose. The numbers are typical teaching values, not patient-specific thresholds. Do not use this content to decide real patient care.

---

## 0. Conventions for encoding

- Times are in **ms**, energy in **W** (RF) or **J** (defibrillation), temperature in **°C**, and voltages in **mV**.
- Catheter names: `HRA`, `HIS`, `CS` (decapolar, poles 1-2 distal to 9-10 proximal), `RVA`, `ABL` (irrigated 3.5–4 mm tip with mini-electrodes optional), `MAP` (multipolar mapping catheter, e.g. 20-pole loop or grid).
- Anatomic positions use standard EP terms. The 3D engine should expose them as named landmarks. LAO clock-face notation is used for the annuli: the tricuspid annulus (TA) and the mitral annulus (MA).
- Every case is a sequence of **steps**. Each step has `actions_allowed`, `expected_action`, `quiz[]`, `hints[]`, and `safety_rules[]`.
- A **tolerance** field is given wherever a numeric answer is expected (for example, a trainee measuring the AH interval within ±10 ms).

Suggested top-level JSON shape (illustrative):

```json
{
  "id": "avnrt_typical_01",
  "title": "Typical slow–fast AVNRT",
  "level": "beginner",
  "patient": { "age": 34, "sex": "F", "history": "...", "meds": ["..."] },
  "ecg12": { "baseline": "...", "tachycardia": "..." },
  "baseline_intervals": { "sinus_cl": 800, "pr": 150, "qrs": 90, "qt": 380, "ah": 80, "hv": 45 },
  "induction": { "protocol": "A_extrastim", "drive_cl": 600, "s2_window": [300, 260], "iso_required": false },
  "tachycardia": { "cl": 350, "va_septal": 0, "cs_activation": "concentric", "qrs": "narrow" },
  "maneuvers": [ { "id": "rv_entrainment", "result": { "response": "VAV", "ppi_minus_tcl": 160, "sa_minus_va": 110 } } ],
  "diagnosis": { "correct": "AVNRT_typical", "distractors": ["ORT_septal_AP", "AT_septal", "JT"] },
  "ablation_target": { "landmark": "slow_pathway_region", "zone_radius_mm": 6 },
  "endpoints": ["junctional_rhythm_during_RF", "noninducible_on_iso", "no_AV_block"],
  "complications": [ { "id": "av_block", "trigger": "...", "warning": "..." } ],
  "quiz": [ ],
  "scoring_overrides": { }
}
```

---

## 1. Learning objectives by training level

### 1.1 Beginner (first year EP fellows and general cardiology fellows)
1. Name the standard catheter positions and recognise their normal electrograms (EGMs): HRA, His (A, H and V), CS, RVA.
2. Measure baseline intervals (PR, QRS, QT, AH, HV) and give the normal ranges: AH 55–125 ms, HV 35–55 ms.
3. Recognise CS activation patterns: concentric (proximal to distal) versus eccentric (distal earliest).
4. Do incremental atrial and ventricular pacing and single extrastimuli. Find the AV nodal Wenckebach CL, the VA Wenckebach CL, and the effective refractory periods (AVNERP, AERP, VERP).
5. Recognise dual AV nodal physiology: an AH jump of 50 ms or more per 10 ms decrement of A1A2.
6. Tell typical AVNRT apart from orthodromic AVRT using the VA interval and the CS activation sequence.
7. Find the triangle of Koch and the slow pathway region on the 3D shell. Recognise a junctional rhythm during RF and know when to stop.
8. Do CTI ablation for typical flutter and confirm bidirectional block.
9. Recognise VF and deliver an unsynchronised shock at once.

### 1.2 Intermediate (second year EP fellows)
1. Use and interpret the core SVT maneuvers:
   - RV entrainment (VAV versus VAAV, PPI–TCL, SA–VA)
   - His-refractory PVC
   - Para-Hisian pacing
   - Atrial overdrive pacing (VA linking)
   - AV block during tachycardia
2. Localise an accessory pathway (AP) from the delta-wave morphology. Map the earliest ventricular activation (pre-excited) or the earliest atrial activation (retrograde).
3. Build and interpret a local activation time (LAT) map: choose the window of interest and the reference, and recognise centrifugal versus reentrant patterns.
4. Map focal AT using activation and unipolar morphology (QS). Protect the phrenic nerve with high-output pacing.
5. Do PVI with wide antral circumferential ablation (WACA). Confirm entrance and exit block. Manage esophageal temperature rises.
6. Recognise and react to the main complications: AV block, tamponade (pressure drop and sliding cardiac silhouette), phrenic palsy, steam pop.

### 1.3 Advanced (third year EP fellows and early-career attendings)
1. Map atypical, left atrial macroreentry (perimitral flutter). Combine entrainment from several sites with an activation map that covers 90% or more of the TCL.
2. Create and validate a mitral isthmus line with differential pacing. Know the risk to the circumflex artery.
3. Do substrate VT mapping:
   - Voltage cut-offs: dense scar <0.5 mV, border zone 0.5–1.5 mV (bipolar)
   - Late potentials and LAVA
   - Pace mapping with long S-QRS
4. Entrainment of VT: concealed fusion, PPI–TCL ≤30 ms, S-QRS/TCL ratio for isthmus location (entry, central, exit).
5. Manage haemodynamics during unstable VT and electrical storm, including drugs, defibrillation, and substrate-only strategies.
6. Handle risk near the AV node and coronary arteries: posteroseptal APs, coronary sinus diverticulum, aortic cusp ablation. Know when to choose cryoenergy, when to titrate energy, and when coronary angiography is needed.

---

## 2. Standard case workflow (enforced state machine)

The simulator moves through these phases in order. Some actions are **gated**. For example, RF cannot be delivered before a diagnosis has been committed (except in the VF case). Trainees can go back to earlier phases. Repeated maneuvers cost time points.

| # | Phase | Required trainee actions | Simulator outputs | Gate to next phase |
|---|-------|--------------------------|-------------------|--------------------|
| P1 | **Patient briefing** | Read the vignette, review the 12-lead ECG (sinus and tachycardia if available), answer the briefing quiz | History, medications, echocardiogram, labs (K, Mg, creatinine), consent risks | Briefing quiz answered |
| P2 | **Access & catheter placement** | Choose venous or arterial access. Place HRA, HIS, CS, RVA (and ABL, MAP) on the fluoroscopy/3D view | Live EGMs. Wrong positions give realistic wrong EGMs (for example, a "His" without an H, or CS catheter in the RV) | All required catheters within 5 mm of target landmarks and correct EGM signature |
| P3 | **Baseline intervals** | Use calipers to measure sinus CL, PR, QRS, QT, AH, HV | Correct values. Tolerance ±10 ms (AH/HV ±5 ms) | All measured |
| P4 | **Programmed stimulation / induction** | Atrial and ventricular incremental pacing, extrastimuli (S1 × 8, S2, then S3 if needed), isoproterenol (1–4 µg/min) | Decremental curves, jumps, echoes, induced arrhythmia | Clinical tachycardia induced (or noninducibility recognised for the PVC case) |
| P5 | **Diagnostic maneuvers** | Choose and do maneuvers from the case menu | EGM results, intervals that can be measured | Diagnosis committed (multiple choice) |
| P6 | **3D mapping** | Choose the reference and window of interest. Acquire points (activation, voltage, pace map). Tag sites (His, phrenic, double potentials, scar) | Colour-coded map, annotations, propagation | Map density threshold met (case-specific, e.g. at least 150 points for AT and at least 400 points for VT substrate) |
| P7 | **Ablation** | Choose the target, power, duration, irrigation, and contact force (CF). Optionally choose cryo where offered | Lesion tags, impedance drop, temperature, EGM attenuation, rhythm response | Ablation target achieved or the case abandoned |
| P8 | **Endpoint confirmation** | Repeat induction (with or without iso), test block, wait period, adenosine | Pass or fail of each endpoint | All endpoints pass → debrief and score |

**Global safety monitors (all phases):** arterial pressure, SpO₂, rhythm, impedance, esophageal temperature (in LA cases), contact force, phrenic capture (right-sided or RSPV cases), fluoroscopy timer, total procedure clock.

**Lesion physics defaults (for the engine):** RF lesion efficacy depends on power × time × CF. Lesion size index model: an effective lesion needs CF of at least 10 g, ideally 10–30 g. CF above 40 g raises the perforation and steam-pop risk. An impedance drop of 8–15 Ω suggests an effective lesion. A drop of more than 20 Ω, or a sudden impedance jump, suggests a steam pop.

---

## 3. Maneuver reference (shared library used by all SVT cases)

| Maneuver | How to perform | Result favouring AVNRT | Result favouring ORT (AP) | Result favouring AT |
|---|---|---|---|---|
| RV overdrive / entrainment | Pace RV 10–40 ms shorter than the TCL. Confirm the atrium is accelerated to the pacing CL. Stop pacing | **VAV**. PPI–TCL >115 ms. Corrected SA–VA >85 ms | **VAV**. PPI–TCL <115 ms. SA–VA <85 ms | **VAAV** (or VAAHV) |
| His-refractory PVC | Deliver a PVC within ~50 ms of the expected His (His already activated) | No effect on the next A | Advances (or delays) the next A, or **ends the tachycardia without reaching the atrium** → proves an AP | No effect |
| Para-Hisian pacing (sinus rhythm) | Pace near the His at high output (His + V capture), then at low output (V only) | Nodal: the S-A interval gets longer by more than 40 ms when His capture is lost | Extranodal: S-A unchanged (septal AP) | n/a |
| Atrial overdrive pacing | Pace the atrium at several CLs and check the VA after the last captured beat | VA after the last paced beat stays fixed (VA linking, variation <10 ms) | VA linking | Variable VA (variation >14 ms) |
| Spontaneous / adenosine AV block | Observe, or give adenosine 6–12 mg | Tachycardia almost always ends (rare 2:1 lower common pathway block) | Tachycardia ends (AV block is impossible during ORT) | **Tachycardia continues with AV block** |
| Termination pattern | Observe | Ends with A (retrograde fast pathway block) | Ends with A | Ends with V → makes AT unlikely |
| Earliest A (septal VA) | Measure | VA <70 ms (typical) | VA ≥70 ms | Variable |

---

## 4. Cases

Each case includes the fields used in the JSON schema. Values are the defaults. The engine may randomise them within ±5–10% for replay variety, but should keep the diagnostic relationships intact.

---

### Case 1 — Typical (slow–fast) AVNRT · *Beginner*

**Vignette:** A 34-year-old woman has had sudden-onset palpitations for 6 years. Episodes stop with a Valsalva maneuver. One ED visit recorded a narrow-complex tachycardia at 170 bpm that ended with adenosine 6 mg. Her echocardiogram is normal. She takes no medications (she stopped a beta-blocker 5 half-lives before the study).

**Baseline ECG:** Sinus rhythm at 75 bpm. PR 150 ms, QRS 88 ms, no pre-excitation, QTc 410 ms.
**Tachycardia ECG:** Regular narrow-complex tachycardia at 170 bpm (CL 350). No P waves visible. There is a pseudo-r' in V1 and pseudo-S waves in II, III and aVF.

**Baseline intervals:** Sinus CL 800, AH 80, HV 45. AVN Wenckebach CL 360. AVNERP fast pathway 300 ms, slow pathway 240 ms. VA Wenckebach CL 400 (concentric, decremental).

**Induction:** Atrial extrastimulus. With S1 600 and S2 coupled at 310 ms, AH is 110. At S2 300 there is an **AH jump to 220 ms** (a jump of 110 ms), followed by a single echo. At S2 290 there is sustained tachycardia. Isoproterenol is not needed. Alternative: burst atrial pacing at CL 350.

**Tachycardia CL:** 350 ms.

**Key EGM findings:** Septal VA (V onset to earliest A in the His channel) is 20 ms. A and V are almost simultaneous. Retrograde atrial activation is concentric, with the earliest A in His/CS 9-10. AH 300 ms, HV 45 ms.

**Decisive maneuvers:**
- RV entrainment at CL 320 gives a **VAV** response. PPI–TCL is 165 ms. SA–VA is 115 ms.
- A His-refractory PVC does not change the A-A.
- The tachycardia ends with A (retrograde block in the fast pathway).

**Correct diagnosis:** Typical slow–fast AVNRT.
**Distractors:** Orthodromic AVRT via a septal AP, septal focal AT, junctional tachycardia.

**Ablation target:** The **slow pathway region** in the inferior/posterior triangle of Koch. This is between the CS os and the tricuspid annulus, at or just above the level of the CS os roof (right inferior extension), in the LAO "4–5 o'clock" region of the septum. The local EGM shows a small A and a large V (A:V ratio about 1:3 to 1:4), with possible fragmented "slow pathway potentials". Keep at least 10 mm inferior to the His tag.
**RF settings:** 30–40 W, irrigated, for 30–60 s. Alternative: cryo at −80 °C for 240 s, with cryomapping at −30 °C first.

**Endpoints:**
1. Accelerated junctional rhythm during RF (a marker of effective lesions) with **1:1 retrograde VA conduction**.
2. No inducible AVNRT with and without isoproterenol. A single AV nodal echo is acceptable.
3. Elimination of the slow pathway jump, or modification of it.
4. No prolongation of the PR or AH interval and no AV block.

**Complications & warnings:**
- **AV block (critical):**
  - Trigger: RF more than 5 mm superior to the CS os roof, or within 8 mm of the His tag.
  - Escalating warnings: junctional rhythm with **VA block** or a fast junctional rhythm (CL <350 ms), AH prolongation, or PR prolongation.
  - Warning text: *"STOP RF — junctional rhythm with VA block / rapid junctional. Risk of AV block."*
  - If RF continues for more than 3 s after the warning, produce transient or permanent complete heart block (CHB) and apply the safety penalty.
  - Show the His tag and a proximity ring (red <8 mm, amber 8–12 mm).
- **Tamponade:** Rare. Use the generic model (see §6).

**Quiz:**
1. *(P4)* An AH increase of 110 ms when S2 is shortened by 10 ms means:
   A) AV node Wenckebach · **B) dual AV nodal physiology** · C) AP block · D) His-Purkinje delay.
   *Explanation:* A jump of 50 ms or more per 10 ms decrement shows conduction switching from the fast to the slow pathway.
2. *(P5)* A septal VA of 20 ms during an SVT excludes which mechanism?
   A) Typical AVNRT · **B) Orthodromic AVRT** · C) AT with long PR · D) None.
   *Explanation:* In ORT the impulse must go through the ventricle and the AP, so a VA under 70 ms is essentially impossible.
3. *(P5)* After RV entrainment the response is VAV, PPI–TCL is 165 ms and SA–VA is 115 ms. The diagnosis is:
   **A) AVNRT** · B) ORT septal AP · C) AT · D) cannot tell.
   *Explanation:* A PPI–TCL above 115 ms and a corrected SA–VA above 85 ms mean the ventricle is far from the circuit.
4. *(P7)* During RF you see a junctional rhythm at CL 320 ms with retrograde VA block. You should:
   A) Continue to complete 60 s · **B) Stop RF immediately** · C) Increase power · D) Pace the atrium faster.
   *Explanation:* VA block during junctional rhythm can mean fast pathway injury, which precedes AV block.

---

### Case 2 — Orthodromic AVRT via concealed left lateral AP · *Intermediate*

**Vignette:** A 27-year-old man, a soccer player, has had palpitations since adolescence. A Holter showed a narrow-complex tachycardia at 190 bpm. His sinus ECG is normal. Echocardiogram is normal.

**Baseline ECG:** Sinus at 70 bpm, PR 160 ms, QRS 90 ms, no delta wave.
**Tachycardia ECG:** Narrow-complex tachycardia at 185 bpm. A retrograde P wave sits in the ST segment (RP about 120 ms, RP < PR) and is negative in I and aVL. QRS alternans may be present.

**Baseline intervals:** CL 850, AH 85, HV 45. V pacing at CL 600 gives an **eccentric** retrograde A sequence, earliest at CS 1-2. VA is **non-decremental**: it stays fixed at 110 ms down to CL 300.

**Induction:** A ventricular extrastimulus (S1 600, S2 260) or an atrial extrastimulus (S2 280 produces AH delay → tachycardia).

**Tachycardia CL:** 320 ms.

**Key EGM findings:**
- Eccentric atrial activation: CS 1-2 is earliest, CS 9-10 latest, His A later than CS distal.
- VA in CS 1-2 is 75 ms. His VA is 120 ms.
- 1:1 AV relationship.
- If a functional LBBB occurs, the TCL lengthens by more than 35 ms (Coumel's sign → AP on the same side as the bundle branch block).

**Decisive maneuvers:**
- A His-refractory PVC **advances the next A by 25 ms** with the same eccentric sequence → proves an AP and that it takes part in the circuit (if it advances the A).
- RV entrainment gives VAV. PPI–TCL is 95 ms. Note that a left lateral AP is far from the RVA, so PPI–TCL may be closer to the cut-off. Teach that the PPI–TCL cut-off is most useful for septal APs.
- Para-Hisian pacing in sinus rhythm: the CS 1-2 S-A interval stays unchanged (extranodal).

**Correct diagnosis:** ORT using a concealed left lateral AP.
**Distractors:** Atypical AVNRT with eccentric activation, left AT, AVNRT with left-sided input.

**Ablation target:** The **lateral mitral annulus (LAO 3 o'clock)**. Approach by transseptal puncture (atrial side) or retrograde aortic (ventricular side, under the leaflet). Target the site of earliest retrograde A during ORT or V pacing, with continuous VA (no isoelectric line) and a possible AP potential. Correlate with the bracketing position on the CS catheter.
**RF settings:** 30–40 W.

**Endpoints:**
1. Loss of AP conduction during RF within 5 s (target within 10 s, otherwise reposition).
2. During V pacing: VA dissociation or a concentric, decremental retrograde sequence.
3. Adenosine during V pacing causes VA block.
4. No inducible tachycardia (with and without iso) after a 30 min wait.

**Complications & warnings:**
- Transseptal puncture: aortic puncture or tamponade if the needle is aimed too anteriorly. Show a warning on the fluoroscopy/3D view if the needle is anterior to the "aortic root" landmark.
- Thromboembolism: warn if ACT is below 300 s once in the LA.
- Coronary (circumflex) injury is rare on the endocardium of the lateral MA. Note it in the debrief.
- Catheter-induced mechanical block of the AP ("bump"): the AP disappears with no RF. Hint: *"Bumped pathway — mark location; avoid ablating blindly."*

**Quiz:**
1. *(P4)* V pacing shows the earliest A at CS 1-2 with a fixed VA from CL 600 to 300 ms. This suggests:
   **A) a non-decremental left lateral AP** · B) retrograde fast pathway · C) retrograde slow pathway · D) AT.
2. *(P5)* A PVC delivered while the His is refractory advances the next atrial EGM. This proves:
   A) AVNRT · **B) presence of a retrogradely conducting AP** · C) AT · D) His-Purkinje reentry.
   *Explanation:* The impulse could not have used the His/AV node, so it must have reached the atrium another way. If it advances the A *and* resets the tachycardia, the AP is part of the circuit.
3. *(P7)* Retrograde aortic or transseptal approach? Which statement is correct?
   A) Only retrograde can reach the MA · **B) Both are acceptable; choose by anatomy and operator skill** · C) Transseptal is contraindicated · D) Ablation should be from the CS.

---

### Case 3 — WPW, manifest posteroseptal AP · *Intermediate → Advanced*

**Vignette:** A 19-year-old woman was referred after an episode of syncope during exercise. The ED recorded AF with an irregular wide-complex rhythm. The shortest pre-excited RR interval was **220 ms** (high-risk).

**Baseline ECG:** Sinus, PR 100 ms, QRS 130 ms, delta wave present.
- Delta wave **negative in II, III and aVF**, positive in I and aVL.
- Negative or isoelectric in V1 with an **abrupt R wave in V2** (R/S >1 by V2) → posteroseptal.
- A deeply negative delta wave in II suggests an epicardial or CS-diverticulum pathway.

**Baseline intervals:** CL 750. AH 70. **HV 5 ms** (pre-excited, short HV: V onset almost at the His). With atrial pacing, pre-excitation increases. At CL 300 the AP shows block (APERP 270 ms). V pacing gives the earliest A at CS os (CS 9-10). VA is non-decremental.

**Induction:** An atrial extrastimulus blocks in the AP (S2 260) → narrow ORT. Alternatively, AF is induced by burst pacing. Teach measurement of the SPERRI (shortest pre-excited RR) in AF.

**Tachycardia CL:** ORT at 300 ms (narrow, eccentric only at the septum, earliest A at the CS os).

**Key EGM findings:**
- During sinus rhythm the earliest ventricular activation near the CS os is **−25 ms before delta-wave onset**, with unipolar **QS**.
- A possible AP potential.
- An abrupt A-V merging.
- Venogram (optional sim step): CS diverticulum at the mouth of the middle cardiac vein.

**Decisive maneuvers:** His-refractory PVC advances the A. Adenosine during sinus rhythm gives full pre-excitation (the AH lengthens, the delta wave stays). A pacing-induced "max pre-excitation" map.

**Correct diagnosis:** Manifest posteroseptal AP (inferoparaseptal) with ORT and pre-excited AF (high risk).
**Distractors:** Mahaim (atriofascicular), right free wall AP, left posterior AP.

**Ablation target:** The **posteroseptal region at the CS os / proximal CS**. This can be the right posteroseptal endocardium, the left posteroseptal mitral annulus, or the CS diverticulum / middle cardiac vein neck if no endocardial target exists. Target the earliest V with QS unipolar and the AP potential.
**RF settings:**
- Endocardium: 25–30 W.
- **Inside the CS or MCV:** 20 W or less irrigated, with impedance monitoring. Coronary angiography is recommended before ablating in the MCV or a diverticulum.
- Cryoablation is an option if the site is within 10 mm of the compact AV node.

**Endpoints:**
1. Loss of the delta wave (sudden normalisation of the QRS and HV 45 ms).
2. No retrograde AP conduction (concentric decremental VA, or VA dissociation).
3. Adenosine challenge: no latent pre-excitation and no retrograde AP.
4. Wait 30 min, then reassess.

**Complications & warnings:**
- **AV block:** The posteroseptal region is near the compact AV node and the AV nodal artery. Trigger: RF more than 5 mm anterior/superior to the CS os, or within 10 mm of the His tag. Warn: *"Close to compact AV node — consider cryo or lower power."* Junctional rhythm during RF has the same response as Case 1.
- **Coronary injury (PDA/RCA, distal LCx in a left-dominant system):**
  - Trigger: RF inside the MCV or diverticulum without angiography, or at more than 25 W.
  - Effect: ST elevation in II, III and aVF on the 12-lead, with chest pain if the patient is under conscious sedation.
  - Warning: *"Inferior ST elevation — STOP RF, coronary angiography."*
- **CS perforation:** Impedance spike or pop inside the CS → tamponade model.

**Quiz:**
1. *(P1)* In pre-excited AF, the shortest pre-excited RR is 220 ms. This means:
   A) low risk, observe · **B) high risk for VF; ablation indicated** · C) AV node is fast · D) give verapamil.
   *Explanation:* An SPERRI of 250 ms or less is a marker of risk for sudden death. AV-nodal blockers (verapamil, digoxin) are contraindicated in pre-excited AF.
2. *(P1)* Delta wave negative in III and aVF, R>S in V2, negative in V1. Most likely location:
   A) Left lateral · **B) Posteroseptal** · C) Right anterior free wall · D) Anteroseptal.
3. *(P7)* The earliest site is in the MCV neck. Before RF you should:
   A) Deliver 40 W for 60 s · **B) Perform coronary angiography and use low power / cryo** · C) Abandon procedure · D) Ablate the His.

---

### Case 4 — WPW, manifest left lateral AP · *Beginner → Intermediate*

**Vignette:** A 22-year-old man was found to have pre-excitation on a pre-employment ECG. He has occasional palpitations. He has no structural heart disease.

**Baseline ECG:** PR 110 ms, QRS 120 ms.
- Delta wave **negative/isoelectric in I and aVL**, positive in II, III and aVF.
- **Positive in V1 (R > S)**, a "type A" pattern → left lateral.

**Baseline intervals:** CL 800, AH 75, HV 15 (pre-excited). Pre-excitation is less visible in sinus rhythm because the AP is left-sided and far from the sinus node, so the atrium-to-AP conduction time is longer. **CS pacing (distal) increases pre-excitation**, with a short AV at CS 1-2.

**Induction:** An atrial extrastimulus or burst pacing induces ORT (narrow, eccentric, earliest A at CS 1-2). Rarely, antidromic AVRT is induced at CL 280.

**Tachycardia CL:** ORT at 330 ms.

**Key EGM findings:**
- In sinus rhythm, the shortest local AV is at CS 1-2 (A-V fused).
- On the ablation catheter at the lateral MA, the local V is **−20 ms before the delta**, with continuous AV activation and an AP potential.

**Decisive maneuvers:** Pacing from the CS distal versus the HRA shows maximal pre-excitation from the CS distal. His-refractory PVC during ORT advances the A.

**Correct diagnosis:** WPW, manifest left lateral AP. Inducible ORT.

**Ablation target:** The **lateral mitral annulus (LAO 2–4 o'clock)**. Anterograde mapping (earliest V) in sinus rhythm or during CS pacing, or retrograde mapping (earliest A) during ORT or V pacing. A transseptal or retrograde aortic approach.

**Endpoints:** Loss of the delta wave within 5 s of RF, no retrograde AP conduction, noninducible ORT, and stable results after 30 min with adenosine.

**Complications & warnings:**
- Transseptal-related: aortic puncture, tamponade.
- Thromboembolism and stroke: warn if no heparin, or ACT below 300 s.
- Retrograde aortic approach: risk of aortic valve injury. Warn if the catheter is crossed with the tip straight instead of with a prolapsed curve.
- Mechanical "bump" of the AP, as in Case 2.

**Quiz:**
1. *(P1)* Positive delta in V1 with negative delta in I/aVL suggests:
   **A) Left lateral AP** · B) Right free wall AP · C) Posteroseptal AP · D) Mahaim fibre.
2. *(P3)* Why can the delta wave be subtle in sinus rhythm with a left lateral AP?
   A) The AP is concealed · **B) The atrial impulse reaches the AV node before the distant left lateral AP** · C) HV is long · D) Wrong ECG filtering.
3. *(P6)* The best anterograde target signal is:
   A) Largest A EGM · **B) Earliest V preceding the delta wave with a QS unipolar EGM** · C) Latest V · D) Fractionated A.

---

### Case 5 — Focal atrial tachycardia from the crista terminalis · *Intermediate*

**Vignette:** A 45-year-old woman has had incessant palpitations for 4 months. Her LVEF has dropped to 40% (suspected tachycardia-mediated cardiomyopathy). A beta-blocker was not effective.

**Baseline ECG:** Sinus at 85 bpm, normal intervals.
**Tachycardia ECG:** A long-RP tachycardia at 160 bpm (CL 375). The P wave looks similar to sinus but is narrower: **positive in II, III and aVF, positive in I, biphasic or positive in V1, negative in aVR**. These features point to the right lateral atrium or crista terminalis.

**Baseline intervals:** CL 700, AH 85, HV 45, normal VA (concentric, decremental).

**Induction:** Hard to induce with programmed stimulation. **Isoproterenol 2 µg/min** produces spontaneous onset with "warm-up" (CL starts at 450 and settles to 375) and "cool-down" before termination. The first P wave of the tachycardia matches later beats.

**Tachycardia CL:** 375 ms. AV relationship 1:1, with spontaneous 2:1 AV block at times.

**Key EGM findings:**
- HRA is early. CS activation is proximal to distal (concentric) and late.
- Variable VA intervals.
- **AV block does not end the tachycardia.**

**Decisive maneuvers:**
- V overdrive pacing (entrainment of the atrium) → **VAAV** response → AT.
- Adenosine causes AV block with the tachycardia continuing (or transient slowing). Note that some focal ATs are adenosine-sensitive and terminate.
- Atrial overdrive pacing gives a variable post-pacing VA.

**Correct diagnosis:** Focal AT, right atrial crista terminalis (mid-to-high).
**Distractors:** Sinus node reentry or inappropriate sinus tachycardia, atypical AVNRT, PJRT.

**3D mapping:**
- LAT map with the window of interest set from −(0.5–0.9 × TCL) to the reference (P-wave onset or a stable CS A).
- The map shows **centrifugal activation** from an earliest site on the crista. The earliest local activity is −35 ms before P onset, with unipolar **QS**.
- The total activation time is well under 50% of the TCL, which supports a focal mechanism.

**Ablation target:** The earliest site on the posterolateral crista terminalis, mid-level, about 15–20 mm inferior to the SVC–RA junction.

**Endpoints:**
1. Termination of the tachycardia during RF, ideally within 10 s.
2. Not inducible with isoproterenol and burst pacing.
3. Sinus rhythm with preserved sinus node function. P-wave morphology returns to sinus.

**Complications & warnings:**
- **Right phrenic nerve injury:**
  - Trigger: RF at a site where high-output pacing (10 mA at 2 ms) captures the diaphragm, or in the lateral/anterolateral RA near the SVC.
  - Simulation: The trainee **must do high-output pacing before RF** in lateral RA cases. If capture occurs, a "phrenic tag" appears.
  - Warning: *"Diaphragmatic capture at this site — phrenic nerve adjacent."*
  - If the trainee ablates there anyway: a diaphragm-hiccup cue, then a loss-of-diaphragm-motion message on the fluoroscopy view.
  - Mitigation options shown in the hint: reposition, or use a balloon or steerable sheath to displace the nerve.
- **Sinus node injury:** RF within 10 mm of the sinus node tag (superior crista) → junctional escape and sinus pauses. Warn: *"Proximity to sinus node."*

**Quiz:**
1. *(P5)* After V overdrive pacing during SVT, the sequence is V-A-A-V. This indicates:
   A) AVNRT · B) ORT · **C) AT** · D) Pseudo-VAAV from typical AVNRT. *Explanation:* Pseudo-VAAV is possible in atypical AVNRT, or when 1:1 VA conduction during pacing is lost. Check that pacing truly entrained the atrium, and use the AH/HA timing to confirm.
2. *(P6)* A focal AT activation map shows which pattern?
   A) Activation covers ~100% of TCL with early-meets-late · **B) Centrifugal spread from a single earliest point** · C) Two foci · D) Isochronal crowding at TA.
3. *(P7)* Before ablating on the anterolateral crista you should:
   A) Increase CF to 50 g · **B) Pace at high output to check for phrenic capture** · C) Give adenosine · D) Turn off irrigation.

---

### Case 6 — Paroxysmal AF → pulmonary vein isolation · *Intermediate*

**Vignette:** A 58-year-old man with hypertension has symptomatic paroxysmal AF (EHRA III) despite flecainide. CHA₂DS₂-VASc is 1. He is on uninterrupted DOAC. TEE or CT shows no LAA thrombus. LA diameter is 40 mm.

**Baseline ECG:** Sinus at 65 bpm. Normal intervals.
**Intra-procedure rhythm:** Starts in sinus. AF may be induced or start spontaneously with PV ectopy.

**Baseline intervals:** CL 900, AH 90, HV 45.

**Setup:** Double transseptal puncture. Heparin bolus 100 U/kg, target ACT 300–350 s. A circular or multipolar mapping catheter in each PV. An esophageal temperature probe.

**3D mapping:** LA voltage map in sinus or CS pacing. This patient has a **healthy substrate**: bipolar voltage >0.5 mV everywhere, with no low-voltage areas. PV potentials are recorded: sharp, near-field signals that follow the far-field LA signals during CS pacing.

**Key EGM findings:**
- PV potentials (PVPs) appear in all 4 veins.
- In the left PVs, the far-field LAA signal can be mistaken for a PVP. **Differential pacing from the distal CS or LAA separates them.**
- PV ectopy from the LSPV triggers AF.

**Ablation target:** **Wide antral circumferential ablation** around the left and right ipsilateral PV pairs, with point-by-point lesions. Inter-lesion distance should be 6 mm or less.
- Posterior wall: 40–50 W for 10–15 s, or high-power short-duration (HPSD) 50 W for 8–10 s. A lower energy index target is used here.
- Anterior wall and ridge: 40–50 W, up to 25–30 s.
- Alternative: cryoballoon, 180–240 s per vein. Monitor phrenic CMAP during right PV application.

**Endpoints:**
1. **Entrance block:** loss of all PVPs in sinus and CS pacing.
2. **Exit block:** pacing inside the vein captures the PV locally without conduction to the LA.
3. Wait 20 min. An adenosine challenge (12–18 mg) shows no dormant conduction. If reconnected, touch-up RF at the gap.
4. The case is not finished until all 4 PVs meet entrance and exit block.

**Complications & warnings:**
- **Esophageal heating (atrioesophageal fistula risk):**
  - Model: a virtual esophagus behind the posterior LA wall, shown as a tube on the 3D shell.
  - Trigger: the esophageal probe rises by **more than 1 °C from baseline, or above 39 °C**.
  - Warning: *"Esophageal temperature 39.4 °C — stop RF, allow cool-down, reduce power/duration at this site."*
  - If RF continues for more than 5 s after the warning, or the temperature exceeds 41 °C, apply a major safety violation. The debrief shows "risk of atrioesophageal fistula (presents 2–4 weeks later)".
- **Phrenic nerve palsy:** Right superior PV with cryo, or RF deep inside the vein. Requires CMAP or diaphragm monitoring while pacing the SVC. Stop at once if the CMAP falls by more than 30%.
- **PV stenosis:** Lesions placed more than 5 mm inside the PV ostium. Warning: *"Lesion inside vein — PV stenosis risk."*
- **Tamponade:** Especially at the LAA ridge, the roof, or with CF above 40 g. See §6.
- **Stroke / air embolism:** ACT below 300 s. Air during sheath exchange can cause transient inferior ST elevation (air in the RCA).
- **Vascular complications:** Groin hematoma (generic event).

**Quiz:**
1. *(P6)* During distal CS pacing, a low-amplitude signal in the LSPV catheter moves closer to the pacing stimulus. This signal is most likely:
   A) PV potential · **B) Far-field LAA** · C) Ventricular far field · D) Noise.
2. *(P7)* Esophageal temperature rises from 36.5 to 38.0 °C during posterior wall RF. Best action:
   **A) Stop RF, wait, move or reduce energy** · B) Continue to complete the lesion · C) Increase irrigation and continue · D) Ignore if under 40 °C.
3. *(P8)* Which result confirms that PV isolation is complete?
   A) Sinus rhythm · B) Termination of AF during ablation · **C) Entrance and exit block, persistent after waiting/adenosine** · D) Impedance drop.

---

### Case 7 — CTI-dependent typical (counter-clockwise) atrial flutter · *Beginner*

**Vignette:** A 66-year-old man with COPD has palpitations and dyspnea. ECG shows atrial flutter with 2:1 conduction (ventricular rate 150). He is anticoagulated with a DOAC for more than 3 weeks.

**Baseline ECG (flutter):**
- Negative sawtooth flutter waves in II, III and aVF, with **no isoelectric baseline**. Positive in V1, negative in V6.
- Atrial CL 240 ms (250 per min), 2:1 AV conduction.

**Baseline intervals (in sinus after the procedure, or in flutter):** AH 95, HV 50. In flutter: atrial CL 240.

**Induction:** The patient arrives in flutter. If in sinus, burst pacing from the CS os or a low lateral RA at CL 200–180 induces counter-clockwise flutter.

**Tachycardia CL:** 240 ms.

**Key EGM findings:**
- A multipolar halo or duodecapolar catheter around the TA shows **counter-clockwise** activation: up the septum and down the lateral wall (in LAO view), proximal to distal on the halo.
- CS is activated proximal to distal.

**Decisive maneuvers:**
- **Entrainment from the CTI** (between the TA and the IVC) gives concealed fusion with **PPI–TCL ≤20 ms** (for example, 10 ms).
- Entrainment from the lateral LA or distal CS gives PPI–TCL >40 ms.
- The 3D activation map covers more than 90% of the TCL around the TA, with an "early-meets-late" pattern.

**Correct diagnosis:** CTI-dependent counter-clockwise typical atrial flutter.
**Distractors:** Clockwise typical flutter, perimitral flutter, focal AT with 2:1.

**Ablation target:** A **linear lesion across the cavotricuspid isthmus**, from the ventricular edge of the TA (where the A:V ratio is about 1:4) to the IVC. Placed at about 6–7 o'clock in LAO. Avoid the septal edge near the CS os (AV node), and avoid going deep into the pouch or Eustachian ridge (high-power heating, poor contact).
**RF settings:** 40–50 W, 20–40 s per point (drag or point-by-point).

**Endpoints:**
1. Termination of flutter during RF (expected, but **not sufficient**).
2. **Bidirectional CTI block:**
   - **Pacing from the CS os:** the lateral RA is activated craniocaudally (from the top down). The low lateral RA is activated last. The time from CS os to low lateral RA is more than 150 ms, or more than 50 ms longer than baseline.
   - **Pacing from the low lateral RA:** the CS os is activated late, via the septum.
   - **Widely separated double potentials along the line** (separation more than 110 ms), with no single fractionated potentials.
   - **Differential pacing:** pacing further from the line (more lateral) shortens the stimulus-to-CS os time.
3. Block persists after 20–30 min.

**Complications & warnings:**
- **AV block:** RF at the septal CTI near the CS os, especially in the far-septal ("paraseptal") isthmus. Warn on proximity to the His tag and CS os.
- **Inferior ST changes or RCA injury:** rare, with high power at the lateral CTI near the RCA. Show only as a debrief note.
- **Steam pop:** High power in the pouch with low flow and impedance rise. A pop sound, then a possible tamponade.
- **Pain:** a sedation note for the CTI.

**Quiz:**
1. *(P5)* Entrainment from the CTI gives PPI–TCL of 10 ms with concealed fusion. Interpretation:
   **A) CTI is part of the circuit** · B) Pacing site is a bystander · C) Focal AT · D) Pacing artefact.
2. *(P8)* Flutter terminated on the third RF lesion. Can you finish the case?
   A) Yes, termination is the endpoint · **B) No — confirm bidirectional block** · C) Only if noninducible · D) Only after adenosine.
3. *(P8)* Pacing from the CS os after the line shows lateral RA activation from top to bottom. This means:
   A) Incomplete block · **B) Clockwise block (medial→lateral) is present** · C) Bystander · D) Reentry.

---

### Case 8 — Perimitral (mitral annular) flutter after prior AF ablation · *Advanced*

**Vignette:** A 64-year-old woman had a PVI plus LA posterior wall ablation 14 months ago. She now has persistent, regular atrial tachycardia at 115 bpm with 2:1 conduction. She is anticoagulated. LVEF is 50%.

**Tachycardia ECG:** Atrial CL 260 ms. Flutter waves are positive in V1 to V6 and in the inferior leads, with low amplitude in the limb leads. Note that the ECG cannot reliably localise this circuit.

**Baseline intervals:** In AT: AH 110, HV 50. 2:1 AV conduction.

**Tachycardia CL:** 260 ms. Stable within ±10 ms (typical of macroreentry).

**Key EGM findings:**
- CS activation is **distal to proximal**, which fits clockwise perimitral flutter. Counter-clockwise perimitral flutter would show proximal to distal.
- The PVs are still isolated. There are low-voltage areas on the LA posterior and anterior walls.
- The halo in the RA shows passive activation.

**Decisive maneuvers:**
1. **CTI entrainment:** PPI–TCL is 85 ms → CTI is not in the circuit. (This excludes typical flutter.)
2. **Entrainment from the proximal CS and distal CS** (opposite sides of the MA): both give PPI–TCL ≤20 ms → **perimitral circuit**.
3. LA roof or posterior wall entrainment: PPI–TCL >40 ms.
4. **LA activation map** (high density, with a multipolar grid or loop): activation around the MA covers about 95% of the TCL. The pattern is clockwise around the MA (in LAO view) with "early-meets-late" at the lateral MA. Propagation follows the annulus.

**Correct diagnosis:** Perimitral atrial flutter (clockwise), mitral isthmus dependent.
**Distractors:** Roof-dependent flutter, focal AT from a PV gap, typical flutter, LA septal reentry.

**Ablation target:** A **mitral isthmus line from the lateral mitral annulus (about 4 o'clock LAO) to the left inferior PV antral lesion set**.
- Usually endocardial RF plus **epicardial RF inside the distal CS** to complete transmurality.
- Alternatives: ethanol infusion into the vein of Marshall, or an **anterior line** from the MA (about 12–1 o'clock) to the right superior PV or roof line. The anterior line avoids the circumflex risk but can delay LAA activation.
- Settings: 35–45 W endocardial. 20–25 W in the CS (irrigated), with impedance monitoring.

**Endpoints:**
1. AT terminates or changes CL or activation during the mitral isthmus line.
2. **Bidirectional mitral isthmus block:**
   - Pacing from the **LAA** gives distal CS activation that is **proximal to distal** (the wavefront must travel around the septum) with a long LAA-to-CS-distal time (more than 150 ms).
   - **Differential pacing:** pacing at the CS distal (just lateral or posterior to the line) gives a *longer* stimulus-to-LAA time than pacing from the CS proximal.
   - Widely separated double potentials along the line.
3. Noninducible macroreentry with burst pacing.

**Complications & warnings:**
- **Circumflex coronary artery injury:**
  - Trigger: RF inside the distal CS at more than 25 W, or deep lateral MA RF in a patient with a dominant LCx.
  - Effect: ST elevation in I, aVL, V5 and V6, and chest pain.
  - Warning: *"Lateral ST elevation — suspected LCx injury: stop RF, angiography."*
  - Hint before RF in the CS: *"Consider angiography / tagging the LCx course."*
- **Tamponade:** Thin lateral LA and LAA ridge. CF above 40 g raises the risk.
- **LAA electrical isolation (anterior line):** Isolation of the LAA increases the stroke risk. Show as a debrief note if the anterior line plus septal lesions isolate the LAA.
- **Esophagus:** Not relevant to this line. But if the trainee ablates the posterior wall, use the same model as Case 6.

**Quiz:**
1. *(P5)* CTI entrainment PPI–TCL 85 ms; distal and proximal CS PPI–TCL 12 and 15 ms. Diagnosis:
   A) Typical flutter · **B) Perimitral flutter** · C) Roof flutter · D) Focal AT.
2. *(P6)* Activation map covers ~95% of the TCL around the mitral annulus. Why is this important?
   **A) Confirms a macroreentrant circuit around a central obstacle (MA)** · B) Indicates focal AT · C) Signals mapping error · D) Means scar.
3. *(P8)* After the mitral isthmus line, LAA pacing produces CS activation proximal → distal. This indicates:
   A) Conduction through the line · **B) Block across the lateral mitral isthmus** · C) Perimitral flutter restarted · D) Need to re-entrain.
4. *(P7)* The endocardial line does not block and the gap seems epicardial. Safest next step:
   A) 50 W in CS for 60 s · **B) Low-power CS ablation after LCx assessment, or vein of Marshall ethanol** · C) Abandon the line · D) Ablate anterior LAA tip.

---

### Case 9 — Ischemic scar VT (LV inferior scar, isthmus-dependent) · *Advanced*

**Vignette:** A 68-year-old man had an inferior MI 10 years ago. LVEF is 30%. He has an ICD. He received 3 appropriate shocks for monomorphic VT in a month despite amiodarone. Coronary angiography shows no new ischemia. Creatinine is normal. K 4.3, Mg 2.0.

**Baseline ECG:** Sinus at 70 bpm, PR 190 ms. Inferior Q waves (II, III, aVF). QRS 120 ms (non-specific IVCD).
**VT ECG (clinical):**
- Monomorphic VT at 145 bpm (CL 415).
- **RBBB-like morphology in V1, superior axis** (negative in II, III and aVF). Transition in V3–V4.
- These features point to a basal inferior LV / septal exit near the mitral annulus.

**Baseline intervals:** AH 110, HV 60 (mild HV prolongation).

**Induction:** Programmed ventricular stimulation from the RVA. Drive CL 600 and 400, then S2, S3, S4 down to the VERP or 200 ms. S1 600 / S2 280 / S3 240 induces the clinical VT. A second site (RVOT) may be needed. Hemodynamics: SBP falls from 110 to 85. Tolerated for up to about 3 min (a "hemodynamic budget" timer). After that, the patient becomes hypotensive and requires termination.

**Tachycardia CL:** 415 ms.

**Substrate mapping (sinus rhythm or RV pacing):**
- Bipolar voltage map: **dense scar <0.5 mV** in the basal-to-mid inferior wall, with a **border zone of 0.5–1.5 mV**.
- A channel of slightly higher voltage (0.5–0.8 mV) runs between the dense scar and the mitral annulus (a "conducting channel").
- **Late potentials (LP) and LAVA** appear inside the channel. These are signals after the end of the QRS, with an isolated potential delayed by 80–120 ms.
- Pace mapping from the channel gives a **long S-QRS (>40 ms)** and matches the VT QRS at the exit (correlation >0.9).

**Activation and entrainment mapping (if tolerated):**
- Mid-diastolic potentials appear in the channel, at about 50–60% of the TCL before QRS onset.
- **Entrainment at the isthmus site:**
  - **Concealed fusion** (paced QRS identical to VT).
  - **PPI–TCL ≤30 ms** (for example, 15 ms).
  - **S-QRS = EGM-QRS** (±20 ms).
  - **S-QRS/TCL = 45%** → central isthmus (exit <30%, central 30–50%, entry 51–70%).
- A bystander site (outer loop or dead-end) is offered as a trap: concealed fusion, but PPI–TCL >30 ms.

**Correct diagnosis:** Scar-related reentrant monomorphic VT, inferior LV isthmus between the scar and the mitral annulus.
**Distractors:** Bundle branch reentry (check HV and the RB/LB activation sequence; BBR shows H-V ≥ baseline and a LBBB pattern), focal Purkinje VT, epicardial VT.

**Ablation target:**
- The **central isthmus** first: concealed fusion, PPI–TCL ≤30 ms. VT should end within 10 s of RF.
- Then **substrate homogenisation**: ablate the LP/LAVA sites in the channel and close the channel up to the mitral annulus.
- Settings: 40–50 W, 60–90 s, CF 10–30 g. Expected impedance drop 10–15 Ω.

**Endpoints:**
1. VT ends during RF at the isthmus with no QRS change before termination.
2. **Noninducibility** of the clinical VT (and preferably all monomorphic VTs) with PES from 2 RV sites, up to 3 extrastimuli to 200 ms or refractoriness.
3. Elimination of LP/LAVA (re-map after ablation shows abolished late potentials).

**Complications & warnings:**
- **Hemodynamic collapse:**
  - Trigger: VT continues beyond the "hemodynamic budget" timer, or SBP drops below 70.
  - Warning: *"Hypotension — terminate VT (ATP / synchronized cardioversion 100–200 J)."*
  - If ignored for more than 30 s, the VT degenerates to VF (Case 11 logic).
- **Steam pop / perforation:** CF above 40 g plus power above 50 W, or an impedance rise. A "pop" event, then a pericardial effusion model.
- **Heart block:** ablation near the basal septum or His region (high-risk for patients with a long HV). Warn on proximity to the His tag.
- **Coronary injury:** This case has an endocardial approach, so the risk is low. Epicardial ablation requires angiography with a 5 mm margin from the coronaries. The epicardial option appears only in the advanced variant.
- **Mitral valve apparatus or chordal entrapment:** retrograde catheter through the mitral valve. Warn if the catheter is "trapped" (loss of manipulation feedback).
- **Thromboembolism and stroke:** ACT target above 250–300 s in the LV.

**Quiz:**
1. *(P1)* RBBB-like VT with superior axis after inferior MI suggests the exit is:
   A) Anterior apical LV · **B) Inferior basal LV / inferoseptal** · C) RVOT · D) Lateral epicardium.
2. *(P6)* Bipolar voltage cut-offs commonly used for dense scar and border zone are:
   **A) <0.5 mV and 0.5–1.5 mV** · B) <1.5 and 1.5–3 mV · C) <0.1 and 0.1–0.5 mV · D) <5 and 5–8.3 mV (unipolar RV).
3. *(P5)* Entrainment with concealed fusion, PPI–TCL 15 ms, S-QRS/TCL 45%. Site is:
   A) Exit · **B) Central isthmus** · C) Entry · D) Bystander.
4. *(P5)* Entrainment shows concealed fusion but PPI–TCL 70 ms. Most likely:
   A) Exit site · **B) Bystander (dead-end or adjacent) site** · C) Outer loop · D) Pacing artefact.

---

### Case 10 — Idiopathic RVOT PVC / VT · *Beginner → Intermediate*

**Vignette:** A 38-year-old woman has frequent palpitations. Holter shows **22% PVC burden** of one morphology with runs of nonsustained VT. Echo and cardiac MRI are normal (no scar, normal RV). Symptoms persist despite a beta-blocker.

**Baseline ECG:** Sinus, normal intervals.
**PVC morphology:**
- **LBBB-like, inferior axis** (tall positive II, III and aVF). Negative in aVL and aVR.
- **Precordial transition at V4**, later than the sinus transition at V3.
- QRS 140 ms, positive in lead I (posterior/septal RVOT).

**Baseline intervals:** CL 850, AH 80, HV 45.

**Induction:** Spontaneous PVCs (10 per minute). They are suppressed by sedation and **increase with isoproterenol (2–4 µg/min)**. Burst RV pacing with iso may cause nonsustained VT. VT, if sustained, has a CL of 360.

**Key EGM findings:**
- The activation map is built on the PVC beats (window referenced to the PVC QRS onset).
- The earliest site is on the posteroseptal RVOT, 1.5 cm below the pulmonary valve. Local bipolar activation is **−35 ms before QRS onset**, with a **unipolar QS** and a sharp downstroke.
- Pace mapping at the earliest site gives a **12/12 lead match** (correlation >0.94). A site 1 cm away gives 10/12.

**Decisive maneuvers:** Activation mapping and pace mapping. A **wrong-chamber scenario** is offered: if the transition is at V3 or earlier, or there is a "V2 transition ratio" consideration, prompt the trainee to think about an LVOT/cusp origin. In this case the RVOT is correct.

**Correct diagnosis:** Idiopathic RVOT PVC/VT (triggered activity, cAMP-mediated), posteroseptal RVOT.
**Distractors:** Aortic cusp (RCC/LCC) PVC, ARVC (excluded by MRI and normal voltage), LV summit.

**Ablation target:** The posteroseptal RVOT below the pulmonary valve, at the earliest site with the best pace map.
**RF settings:** 30–40 W, 60 s. Test lesion: PVCs should disappear within 10–15 s.

**Endpoints:**
1. Elimination of the targeted PVCs during RF.
2. **No spontaneous or iso-inducible PVCs** (iso 4 µg/min plus burst pacing) for 30 min.

**Complications & warnings:**
- **Perforation / tamponade:** the RVOT free wall is thin. CF above 30 g on the free wall raises the risk. See §6.
- **Left main / proximal LAD proximity:** if the trainee moves to the LCC or above the pulmonary valve. Require angiography or the ICE distance (more than 5–8 mm from the coronary ostium) before RF in the cusps.
- **RBBB or conduction injury:** with septal RVOT ablation near the His bundle (rare).
- **Hint about mapping pitfall:** sedation suppresses PVCs. Use iso and reduce sedation.

**Quiz:**
1. *(P1)* LBBB inferior axis PVC with transition at V4 (later than sinus) most likely originates from:
   **A) RVOT** · B) LCC · C) Inferior LV · D) Mitral annulus.
2. *(P6)* The best combined target for focal PVC ablation is:
   A) Largest bipolar EGM · **B) Earliest bipolar activation with QS unipolar and excellent pace map** · C) Pace map only · D) Lowest voltage.
3. *(P4)* No PVCs appear on the table under deep sedation. First step:
   A) Abandon the case · **B) Lighten sedation and give isoproterenol** · C) Ablate empirically · D) Give lidocaine.

---

### Case 11 — VF / electrical storm (safety-response scenario) · *All levels (mandatory)*

**Vignette (two variants):**
- **11A — Intra-procedural VF:**
  - During Case 9 (or any case), VF starts from a mechanical PVC (RV catheter manipulation) or after a long unstable VT.
  - Alternatively, during programmed stimulation with an aggressive S4.
- **11B — Electrical storm:**
  - A 61-year-old man has an ischemic cardiomyopathy with EF 25%. He has had 8 ICD shocks in 24 h for polymorphic VT/VF.
  - Each episode is triggered by a monomorphic PVC.
  - An acute coronary syndrome has been excluded (urgent angiography: stable disease, no culprit).
  - K is 3.2 (low), Mg 1.6.

**Rhythm presentation:** A chaotic, irregular baseline without discrete QRS complexes. Arterial pressure goes flat (no pulsatile waveform). SpO₂ trace is lost. Timer starts.

**Required response sequence (11A):**
1. Recognise VF and **deliver an unsynchronized shock at 200 J (biphasic, maximum)** within **30 s** of onset. Target 10 s or less.
   - Using **synchronized** mode is a critical error: the device will not fire.
   - Before the shock, stop pacing and stimulation and remove the catheter from the RV.
2. If VF persists after the shock, start CPR (simulated) and give a second shock. Give epinephrine or amiodarone per the ACLS algorithm (shown as an option checklist).
3. After return of spontaneous circulation (ROSC): check ACT and the pericardial space (echo button), and review the catheter positions.

**Required response sequence (11B storm management, scored checklist):**
1. Correct the electrolytes: K to at least 4.0 and Mg to at least 2.0.
2. Sedation and sympathetic blockade: deep sedation, intravenous beta-blocker (e.g., propranolol or esmolol). Consider stellate ganglion block in refractory cases.
3. Antiarrhythmics: **amiodarone** with or without **lidocaine**.
4. Review the ICD programming (avoid unnecessary shocks, maximize ATP).
5. Consider mechanical circulatory support if the patient is unstable.
6. **Trigger mapping:**
   - Map the triggering PVC. It is early on the LV inferior border zone or from the Purkinje network.
   - A sharp **Purkinje potential precedes the PVC QRS by 30 ms**.
   - Ablate the Purkinje trigger and the substrate.
   - Endpoint: elimination of the triggering PVC and noninducibility.

**Correct diagnosis:** VF (11A). Electrical storm triggered by a Purkinje/border-zone PVC with hypokalemia as a contributor (11B).

**Complications & warnings (engine):**
- Countdown from VF onset: at 10 s "VF — DEFIBRILLATE", at 20 s red flash, at 30 s critical warning.
- If 60 s pass with no shock, the patient outcome is "hypoxic brain injury" and the case fails.
- After 3 failed shocks, remind the trainee to check pad position and consider a different vector or a second set of pads.
- Shocking a sinus rhythm or an organised rhythm with a pulse is an error. Synchronised cardioversion is for VT with a pulse. VT without a pulse → unsynchronized.

**Quiz:**
1. *(P0 emergency)* VF during the procedure. Immediate action:
   **A) Unsynchronized shock at max energy** · B) Synchronized cardioversion 100 J · C) Overdrive pacing · D) Adenosine.
2. *(11B)* Which factor must be corrected first in storm?
   A) Change ablation catheter · **B) Hypokalemia/hypomagnesemia and adrenergic drive** · C) Increase iso · D) Stop amiodarone.
3. *(11B)* A sharp potential 30 ms before each trigger PVC near the LV inferior border zone is likely:
   A) Far-field atrium · **B) Purkinje potential — ablation target for the trigger** · C) Noise · D) His potential.

---

## 5. Additional short-format cases (optional, for replay variety)

These can reuse the engine from the main cases with parameter changes.

| ID | Case | Level | Key twist |
|----|------|-------|-----------|
| 12 | Atypical (fast–slow) AVNRT | Adv | Long RP. Earliest A at the CS os. Differentiate from PJRT with a His-refractory PVC (no effect) and the SA–VA. |
| 13 | PJRT (decremental posteroseptal AP) | Adv | Incessant long-RP. A His-refractory PVC delays or ends the tachycardia without reaching the A. |
| 14 | Clockwise typical flutter | Beg | Positive flutter waves in the inferior leads, negative in V1. Same CTI ablation. |
| 15 | Roof-dependent LA flutter | Adv | Entrainment of the roof (anterior and posterior LA) gives PPI–TCL <20. Ablate a roof line. Check block with LAA pacing (posterior wall activated caudocranially). |
| 16 | Aortic cusp (LCC) PVC | Adv | Transition V2–V3. Mandatory coronary angiography or ICE. RF at least 6 mm from the left main ostium. |
| 17 | Bundle branch reentry VT | Adv | Dilated cardiomyopathy. HV 80. LBBB VT with H-V ≥ sinus. Ablate the RBB. |

---

## 6. Generic complication models (shared engine rules)

| Complication | Trigger model | Early cues | Required response | Penalty |
|---|---|---|---|---|
| **AV block** | RF within 8 mm of the His tag, or rapid junctional / VA block not stopped within 2 s; posteroseptal or septal sites with more than 25 W | Junctional with VA block, PR/AH lengthening, transient Wenckebach | Stop RF. Pace the ventricle if CHB. Assess recovery | Permanent CHB = critical |
| **Tamponade** | Transseptal misdirection; CF >40 g for more than 5 s; steam pop; CS or RVOT/LAA perforation | Gradual SBP drop and HR rise; reduced cardiac silhouette motion on fluoroscopy; echo shows effusion | Stop RF. Echo. **Pericardiocentesis**. Reverse heparin (protamine). Surgical backup | Major. Critical if not recognised within 2 min |
| **Phrenic nerve injury** | RF or cryo at a site with diaphragmatic capture (lateral RA, SVC, RSPV, LAA in some patients) | High-output pacing capture; loss of diaphragmatic movement; CMAP decline >30% | Stop at once. Reposition | Major |
| **Esophageal injury** | Posterior LA RF with probe temperature >39 °C or Δ >1 °C, continued after the warning | Temperature rise | Stop. Cool down. Reduce energy | Major |
| **Coronary injury** | RF in the CS/MCV/cusp at more than 25 W without angiography or distance measured; distance <5 mm | ST elevation in the coronary territory, chest pain, VT/VF | Stop RF. Angiography. Nitroglycerin. Consider PCI | Critical |
| **Steam pop** | Power >50 W with CF >40 g, impedance rise >10 Ω or no drop with sustained temperature rise | Impedance rise, audible pop | Stop. Echo to check for effusion | Minor to major |
| **Stroke / air embolism** | Left-sided work with ACT <300 s, sheath not flushed | Neurological deficit warning; transient inferior ST elevation (air) | Check ACT. Heparin. Stroke pathway | Major |
| **Vascular** | Arterial puncture without ultrasound guidance (option toggled) | Groin hematoma | Pressure | Minor |

**Presentation rules (UI):**
- **Amber banner** = advisory (for example, "His tag 11 mm away").
- **Red banner** with alarm tone and auto-pause of the RF button = imminent harm. The RF button locks for 3 s until the trainee acknowledges.
- The engine records whether the trainee **stopped RF within 2 s** of a red banner, because this is scored.
- In "exam mode" the amber banners are hidden (the trainee must find the risk without prompts). Red banners stay because they reflect real physiologic cues (for example, junctional with VA block).

---

## 7. Scoring rubric (total = 100 points, plus safety deductions)

| Domain | Points | How the engine calculates it |
|---|---|---|
| **A. Pre-procedure & catheter placement** | 8 | Briefing quiz (4). Catheters placed correctly on the first attempt (4). Subtract 1 per repositioning beyond 2 per catheter |
| **B. Baseline measurements** | 7 | AH, HV, CL, PR, QRS within tolerance: 1.4 points each |
| **C. Induction & maneuvers** | 15 | Correct induction protocol (5). Each "decisive" maneuver performed and correctly interpreted (up to 10). Subtract 1 per unnecessary or repeated maneuver beyond 3 |
| **D. Diagnostic accuracy** | 20 | Correct diagnosis on the first commit: 20. Second attempt: 10. Third: 0. Choosing the wrong diagnosis and starting ablation: 0 and a "wrong target" flag |
| **E. Mapping quality** | 10 | Point density meets the threshold (4). Correct window of interest and reference (3). Correct identification of the earliest site, isthmus, or gap (3) |
| **F. Ablation efficiency (RF applications)** | 15 | Full points if the RF count is ≤ the case benchmark. Subtract 1 per application above the benchmark (minimum 0). **Benchmarks:** AVNRT 6, concealed LL AP 4, posteroseptal AP 6, LL WPW 4, focal AT 5, PVI 60–80 points (scored per 10 points over), CTI 15, mitral isthmus 25, scar VT 40, RVOT 6, storm trigger 10 |
| **G. Fluoroscopy / procedure-time proxy** | 5 | Fluoroscopy time used is the time with the fluoroscopy view active. Full points if under the case benchmark (for example, 5 min SVT, 10 min AF, 15 min VT, with 3D-guided "zero-fluoro" bonuses). Subtract 1 per 25% over |
| **H. Endpoint achievement** | 20 | All case endpoints verified (20). Partial: proportional per endpoint tested and met. **Endpoint not tested** (for example, flutter terminated but block not confirmed): 0 for that item |
| **Total** | **100** | |

**Safety deductions (applied after the domain totals; the final score cannot go below 0):**

| Event | Deduction | Flag |
|---|---|---|
| Advisory ignored (amber, then RF continued) | −2 each | — |
| Red warning ignored more than 2 s (RF continued) | −10 each | Major |
| Transient AV block, PR prolongation | −5 | Major |
| **Permanent complete heart block** | −30 | **Critical, case fail** |
| Phrenic palsy | −15 | Major |
| Esophageal temperature >41 °C or ablation continued after warning | −15 | Major |
| Tamponade caused | −10. An additional −15 if not recognised or treated within 2 min | Major |
| Coronary injury | −25 | **Critical** |
| Stroke / embolism (ACT neglected) | −20 | **Critical** |
| Delay in defibrillating VF >30 s | −20. More than 60 s = case fail | **Critical** |
| Synchronised shock attempted in VF | −5 | — |
| RF delivered before a diagnosis is committed (except storm or emergency) | −5 | — |
| Ablation in the wrong chamber or at the wrong target | −10 | Major |

**Grading bands:** ≥85 = *Proficient*; 70–84 = *Competent*; 50–69 = *Needs review*; <50 or any critical flag = *Repeat required*.
**Level weighting:**
- Beginner mode shows hints for free.
- Intermediate mode charges −1 per hint.
- Advanced and exam modes charge −2 per hint and hide amber banners.

**Debrief output:** A per-domain bar, a timeline of events (RF, warnings, maneuvers), a "what an expert would have done" path, and links to the matching pearls.

---

## 8. Teaching pearls (shown as hints)

**General**
- Check that the CS catheter is truly in the CS. It should record both A and V and point leftward on the LAO view. Otherwise you will misread every eccentric sequence.
- Measure the AH from the His catheter A to the H onset. Measure the HV from the H onset to the **earliest** ventricular activation on any channel or the surface QRS.
- In any SVT, describe four things first: the CL, the VA interval, the atrial activation sequence, and the AV relationship. After that, choose the maneuver.
- Make sure entrainment is real. Confirm the tachycardia accelerated to the pacing CL **and** that it continues after pacing stops.

**AVNRT**
- The slow pathway is anatomic and inferior. Start low (at the CS os level), then move up in small steps.
- A **slow** junctional rhythm during RF is good. A **fast** junctional rhythm, or one with VA block, means stop.
- A single echo after ablation is acceptable. A sustained AVNRT is not.

**AP / WPW**
- Pre-excitation is maximal when you pace close to the AP. Use CS distal pacing for a left-sided AP.
- An AP potential with a QS unipolar signal at the earliest site is the best target. Lack of AP block within 5–10 s means the catheter is in the wrong place.
- Posteroseptal APs can be epicardial. If the delta wave in II is deeply negative, do a CS venogram.

**Focal AT**
- Warm-up and cool-down behaviour plus AV block without termination are classic for automatic AT.
- If the activation map shows "early" over a wide area, look at the opposite atrium or the septum. The real focus may be in the left atrium or the right PV.

**AF**
- Far-field signals in the left PVs: pace the LAA or distal CS to tell them apart.
- The carina, the ridge, and the anterior right PV are the usual sites of reconnection gaps.

**Flutter**
- Terminating the flutter is not the endpoint. Bidirectional block is.
- Poor progress on the CTI usually means a pouch or a prominent Eustachian ridge. Use a long sheath, change the curve, or move the line laterally.

**VT**
- Map the substrate in sinus rhythm first. Induce the VT only to confirm the target or when hemodynamics allow.
- The S-QRS/TCL ratio tells you the location of the pacing site in the isthmus. An S-QRS that matches the EGM-QRS confirms the site is in the circuit.
- VF in the lab: shock first, then think.

---

## 9. Common pitfalls (trigger-based hints)

| Pitfall | Detection rule | Hint text |
|---|---|---|
| Calling AVNRT after one VAV response without checking PPI or SA–VA | Diagnosis committed after only the VAV result | "VAV excludes AT but not ORT — measure PPI–TCL and SA–VA." |
| Pseudo-VAAV in atypical AVNRT | VAAV result in a long-RP case | "Check whether the last A is really driven by the last V (AH vs HA timing)." |
| Ablating while the flutter is no longer inducible but block is untested | Endpoint commit with no block test | "Termination ≠ block. Perform CS os and low lateral pacing." |
| Window of interest wrong in a focal AT LAT map | WOI >TCL or reference unstable | "Your window crosses the next cycle — colours will wrap. Set WOI to ~90% TCL." |
| Ablating the AP from far away with many low-impact lesions | More than 3 RF with no AP block | "Remap: look for earlier V/A with a QS unipolar and an AP potential." |
| Ablating in the CS without considering the coronary arteries | RF inside the CS at >25 W | "Coronary arteries run close to the CS — reduce power and consider angiography." |
| Ignoring the esophageal temperature | Temperature above the threshold | "Esophageal temperature rising — stop and move." |
| VT target chosen by concealed fusion only | Target site with PPI–TCL >30 ms | "Concealed fusion can occur at bystander sites. Check PPI–TCL and S-QRS = EGM-QRS." |
| Long unstable VT mapping | Hemodynamic timer >80% | "Patient hypotensive — terminate and switch to substrate mapping." |
| Wrong chamber for an OT PVC | Earliest RVOT activation later than −20 ms with a poor pace map | "Not early enough — consider the cusps or the LVOT." |
| Applying iso at a high dose to a patient with ischemic VT | iso >2 µg/min in a scar VT case | "Isoproterenol is rarely required for scar VT and may provoke ischemia or VF." |

---

## 10. Implementation notes for developers

1. **Deterministic physiology with randomised presentation:** keep the diagnostic relationships fixed (for example, AVNRT VA <70, ORT PPI–TCL <115). Vary the CL, the amplitudes, and the catheter jitter.
2. **Maneuver engine:** each maneuver is a function `(case_state, pacing_site, pacing_cl) → EGM_sequence + measurable_intervals`. Results that depend on correct technique (for example, a His-refractory PVC delivered too early is not "His-refractory") should be computed, not pre-scripted.
3. **Ablation targets:** encode them as 3D zones (a landmark plus a radius, or a polyline with a tolerance for lines). "Success probability per lesion" = f(distance to the target, CF, power × time, stability). Each case has a target radius (for example, AVNRT slow pathway 6 mm, AP 4 mm, focal AT 5 mm, VT isthmus 8 mm) and a **danger zone** list (His tag, phrenic path, esophagus, coronary paths, sinus node).
4. **Line block:** for CTI, MI, roof, and PVI, divide the line into segments. Block = all segments transmural. A gap = a segment with an inadequate lesion index. Block tests read the gap state.
5. **Endpoints** must be *tested* by the trainee to score. The engine never auto-confirms.
6. **Logging:** every action is timestamped for the debrief and the rubric. Fluoroscopy time and RF count are first-class metrics.
