# 04 — Clinical accuracy review (EP attending)

Scope: `js/cases/cases.js` (all 11 cases), `js/workflow.js`, `js/scoring.js`, and the safety model in `js/engine/ablation.js`. I also spot-checked the maneuver code in `js/engine/stimulator.js` and the block tests in `js/engine/endpoints.js`, because the teaching text depends on them. I reviewed these against the specs (`docs/01–03`), the latest `tests/out/run_*.log` results and the screenshots.

The two known approximations were accepted as given: the posteroseptal ORT CL of 236 ms and oesophageal heating of about 0.2 °C/s.

---

## 1. Text fixes applied (`js/cases/cases.js` only)

No quiz `correct` index was changed. Every quiz's keyed answer was already clinically correct. After the edits, `avnrt` (97, Proficient) and `wpw_ll` (93, Proficient) both pass the autotest with no Uncaught errors.

| Case | Field | Change | Why |
|---|---|---|---|
| 2 ORT concealed LL | `diagnosis.explain` | It now separates **presence** of an AP (the His-refractory PVC advances the A) from **participation** (the PVC delays the A, or terminates the SVT without atrial activation). It also notes that an RVA PVC often cannot advance a distant lateral AP. "CS 1-2 earliest" became "distal CS earliest". | The old text said that advancing the A proves the AP is "in the circuit", which is a classic fellow error. The model also returns "no change" for this case (see run_ort_concealed.log), so the text has to explain why a negative result does not exclude a lateral AP. |
| 2 | quiz 2 `explain` | Added the same presence-versus-participation sentence. | Same reason. |
| 2 | hints (maneuvers tier 3, ablation tier 2), `expert` | "Distal CS earliest". The AP-block time changed from "< 5 s" to "~5–10 s; if not, stop and re-map". | In the model the earliest A is at CS 3-4 (run log CS = 51,15,8,0,6). Current practice is to stop and re-map if there is no effect by about 10 s. At 35 W and 20 g the model blocks at about 5–7 s, so "< 5 s" would make correct lesions look like failures. |
| 3 WPW posteroseptal | `diagnosis.explain` | Added: a negative delta in lead II raises the possibility of an epicardial CS/MCV pathway. | This is a standard localisation pearl (Arruda). It connects the ECG to the MCV quiz in the same case. |
| 3 | hints maneuvers tier 2 | "Should advance (or delay/terminate) the A when a septal AP is in the circuit." | Accurate wording (but see engine recommendation R3). |
| 4 WPW LL | ECG tachy line, `diagnosis.explain`, maneuver hints | "CS 1-2" became "distal CS". Added a note that an RVA His-refractory PVC may not advance a lateral AP. | Matches what the model shows and is correct physiology. |
| 4 | induction hints, `expert` | Atrial burst from the CS replaced the "S1 600 / S2 < 280" route. | The hints contradicted the case's own induction text ("extrastimuli rarely induce in this model"). |
| 4 | ablation hint, `expert` | Delta loss "< 5 s" became "~5–10 s; if not, stop and re-map". | Same reason as for Case 2. |
| 5 Focal AT | ablation quiz question | "Anterolateral crista" became "lateral crista terminalis". | The target is the posterolateral or mid crista. The right phrenic nerve runs along the lateral and posterolateral RA and the SVC, so "anterolateral" was both inconsistent and anatomically misleading. |
| 5 | ablation quiz `explain` | "10 mA" became "e.g. 10–20 mA at 2 ms; avoid sites with capture". | This matches usual practice. |
| 6 PVI | oesophageal quiz `explain` | The old line was "a rise > 1 °C is a stop signal". The new text says a 1.5 °C rise is a clear stop signal, most labs stop at a rise of 0.5–1 °C or an absolute temperature of about 38.5–39 °C, and the temperature keeps rising after RF stops. | The old line was stated as a universal rule, and the engine only alerts at a 1.5 °C rise (see R6). Thermal latency is a key teaching point. |
| 7 CTI flutter | vignette and baseline ECG | "Ventricular rate 150" / "125–150" became "~125". | An atrial CL of 240 ms with 2:1 conduction gives 125 bpm, not 150. |
| 9 Scar VT | tachy ECG line | "Transition V3–V4: basal…" became "Dominant R in V2–V4 (no precordial QS): basal inferior LV / inferoseptal exit". | For an RBBB-morphology VT, an R→S transition at V3–V4 implies a more apical exit, which contradicted "basal". |
| 9 | quiz 3 `explain` | It now gives the full Stevenson S-QRS/TCL ranges (exit < 30%, central 30–50%, proximal/entry 50–70%, inner loop > 70%). | The old text gave only the central-isthmus range. |
| 9 | quiz 4 `explain` | "PPI–TCL > 30 excludes the circuit" became "places the site outside the circuit (adjacent or dead-end bystander)". | More precise wording. |

I verified the following and left them unchanged, because they are correct:

- **Case 1 (AVNRT):** a jump of ≥ 50 ms per 10 ms decrement; a septal VA < 70 ms excludes ORT; VAV with PPI–TCL > 115 ms and SA–VA > 85 ms means AVNRT; junctional rhythm with VA block means stop RF.
- **Case 3:** SPERRI ≤ 250 ms means high risk, and AV-nodal blockers are contraindicated.
- **Case 3:** at an MCV site, image the coronaries and use low power or cryo.
- **Cases 5 and 8:**
  - VAAV indicates AT, provided 1:1 atrial entrainment was confirmed.
  - Far-field LAA signals advance with distal CS/LAA pacing.
  - CS proximal→distal with CCW typical flutter.
  - Descending lateral RA with CS-os pacing means medial→lateral block.
  - CTI PPI–TCL 85 ms with both CS sites ≤ 20 ms means perimitral flutter.
  - LAA pacing with CS proximal→distal means lateral MI block.
- **Case 8:** for an epicardial MI gap, assess the LCx first or use Marshall ethanol.
- **Cases 9–11:**
  - Marchlinski voltage cut-offs (< 0.5 mV dense scar, 0.5–1.5 mV border zone).
  - RVOT: transition later than in sinus rhythm.
  - VF: unsynchronised maximum-energy shock first.
  - Storm: correct K and Mg and reduce adrenergic drive.
  - A Purkinje potential before the trigger PVC marks the target.

---

## 2. Recommended engine/logic changes (not applied), ranked by teaching impact

**R1. Steam pop, perforation and tamponade rates are far too high and teach under-dosed lesions** (`ablation.js` `_safety`, `_steamPop`). I integrated the current pop hazard per lesion:

| Settings | Steam-pop probability per lesion |
|---|---|
| 35 W, 20 g, 60 s | ≈ 15 % |
| 40 W, 20 g, 60 s | ≈ 23 % |
| 45 W, 30 g, 60 s (VT) | ≈ 80 % |

In the model a pop then causes tamponade with a probability of 40 %, or 100 % if CF > 30 g. Real irrigated-RF pop rates are about 0.1–1.5 % per lesion, and tamponade after a pop is uncommon, especially in the thick-walled LV. Trainees will learn to deliver 10–20 s lesions, which gives non-durable CTI, PVI and VT lesions.

Separately, the perforation draw at CF > 50 g (`sim.rng() < 0.02`) runs every 10 ms tick. That makes tamponade almost certain within about 1 s once the CF has been above 50 g for 5 s, and the rate changes with tick size. Recommended changes:

- Scale the pop hazard to about 1–3 % for a 60-s lesion at high power and CF.
- Tie the pop hazard mainly to a large impedance drop (> 15–20 Ω) and high CF × power.
- Set the probability of tamponade after a pop to about 5–10 % in the atria and about 2 % in the LV.
- Make the perforation hazard per second (`× dt`).

**R2. PPI−TCL can come out impossibly negative.** Examples: perimitral PPI 167 ms against TCL 228 ms, giving PPI−TCL **−61 ms**; and in AF, **−120 ms**. Entrainment from the CTI in the flutter run printed no PPI at all. Entrainment is the core diagnostic tool for Cases 7 and 8, and also for 1 and 9, so a negative PPI−TCL actively mis-teaches. In `stimulator._analyse`, three fixes are needed:

- Confirm capture at the pacing CL and acceleration of the tachycardia to it.
- Measure PPI to the first local activation that is a return cycle, ignoring the last captured beat and far-field signals.
- Refuse to report entrainment in AF or other irregular rhythms ("entrainment not applicable").

Also add a concealed versus manifest fusion read-out, by comparing surface P/QRS during pacing with the tachycardia.

**R3. The His-refractory PVC is delivered at one fixed time (expected His − 10 ms) from the RVA only.** It returned "no change" in all three AP cases, including the posteroseptal WPW case, where a septal AP should normally be advanced. The case text teaches advancement, so the trainee sees a contradiction. Recommendations:

- Scan the coupling interval from late to early, keeping His timing unchanged (up to about the time of expected His activation).
- Report the His timing.
- Classify the result as advance (AP present), delay (AP participates, decremental), terminate without A (AP participates) or no effect.
- Optionally, allow the PVC from the LV or a site near the AP.

**R4. The AVNRT danger signals are text-only.** The "rapid junctional rhythm with VA block" critical alert fires purely on distance (tip < 8 mm from the His or compact node). The EGMs never show a fast junctional rhythm (CL < 350 ms), VA block, or AH/PR prolongation. Also, junctional rhythm is generated only when the tip is ≥ 8 mm from the His. A fellow therefore learns to react to a banner, not to the EGM, which is exactly the wrong habit. Recommendations:

- When heating approaches the fast pathway or compact node, render a fast junctional rhythm and intermittent retrograde VA block (or AH prolongation) on the EGMs.
- Grade the alert by severity, and score how fast RF is stopped.
- Optionally, let a lesion without any junctional rhythm after 15–20 s prompt "stop and reposition".

**R5. Non-inducibility testing is too weak and fixed** (`workflow._inducibility`). It runs one HRA S2 at 290 ms plus one burst, or for the V group only S1 600/S2 280/S3 240 plus a burst. This differs from practice in three ways:

- **AVNRT, AP and AT cases:** testing should include an atrial S2 down to AVNERP or atrial ERP, double extrastimuli, and burst pacing to AV Wenckebach, with and without isoproterenol. Accept a single AV-nodal echo but no sustained SVT.
- **Scar VT:** testing should use 2 drive CLs, up to 3 extrastimuli to refractoriness or 200 ms, and 2 RV sites. The endpoint label already promises "to 200 ms", but the test does not deliver it.
- **Trainee role:** let the trainee run the protocol and score how complete it is, rather than auto-passing.

**R6. The oesophageal alert threshold is 1.5 °C rise or > 39 °C.** The curriculum says > 1 °C, and many labs use 0.5–1 °C or an absolute 38.5–39 °C. Recommendations:

- Set the warning at a rise of ≥ 1.0 °C or ≥ 39 °C. Optionally add an advisory at a 0.5 °C rise.
- Add thermal latency, so that oesophageal temperature keeps rising for about 10–20 s after RF stops. That teaches trainees not to stack lesions.

**R7. Phrenic logic is purely distance-based and penalises correct behaviour.** The PVI autotest took 3 "Advisory ignored (phrenic)" deductions around the RSPV antrum. Recommendations:

- If high-output pacing at that spot (within 3 mm) showed no capture, suppress the advisory and give credit.
- If capture was shown, escalate to critical.
- Model loss of diaphragmatic capture during phrenic pacing-while-ablating as the stop signal.

**R8. The para-Hisian classification is off** (`stimulator.paraHisian`). It uses ΔSA > 20 ms, while the curriculum says > 40 ms. It labels every non-nodal result "septal AP", which is wrong for the left lateral AP in Case 2. It looks only at the earliest A, not at each site. Recommendations:

- Compare SA and HA at both His and CS 1-2, and compare the retrograde activation sequence.
- Report nodal, extranodal (AP) or mixed (AP + node) responses.
- Avoid calling the location "septal".

**R9. The RVOT endpoint observes for only 15 s on isoproterenol.** Practice is 20–30 min on and off isoproterenol, with burst pacing. Recommendations:

- Simulate a compressed but longer window (≥ 2–5 min of model time).
- Re-check the PVC morphology, because a different exit can take over.

**R10. Coronary injury is not modelled.** It matters for MCV/CS ablation (Case 3) and CS ablation for the mitral isthmus (Case 8), where it is the reason for the "angiography / low power" quizzes. Add a coronary proximity check, or at least a warning, for RF inside the CS or MCV.

**R11. The block tests should require differential pacing.**

- **CTI:** the test checks transisthmus timing ≥ 110 ms and a descending lateral wall. Add widely split double potentials (≥ 90–110 ms) along the line, and differential pacing, so that slow conduction is not called block.
- **Mitral isthmus:** the test uses one LAA site. Add differential pacing from distal versus proximal CS.

**R12. Scoring nuances.**

- `junctional_rf` is weighted as 25 % of the AVNRT endpoint score. It is a surrogate marker, not an endpoint, so reduce its weight or move it to process credit.
- A wrong diagnosis still unlocks RF, with a flat −5. Consider requiring the correct diagnosis, or a second attempt, before RF in level 2–3 cases.
- The RF-count penalty (−1 per lesion over benchmark) is fine. Make sure an AVNRT "insurance" lesion is not discouraged: allow +1 lesion over benchmark after junctional rhythm.
- No deduction for skipping the post-ablation AV-conduction check: this is acceptable, because it is an endpoint.

**R13. Model tachycardia CLs drift from the case text.**

| Case | Text CL | Model CL |
|---|---|---|
| Perimitral | 260 ms (115 bpm at 2:1) | 228 ms |
| ORT, left lateral | about 320–330 ms | about 295–301 ms |

Either tune the model or update the text so that the calipers agree with the vignette.

---

## 3. Verdict

**Ready for supervised fellow training as a workflow and reasoning trainer. Not yet safe as a standalone trainer for maneuvers or energy titration.**

These parts are solid and teach good habits:

- the enforced P1–P8 workflow and its gating (diagnosis before RF, endpoints after "termination");
- the case selection and the vignette → ECG → maneuver → map → endpoint logic;
- the quiz content;
- the safety ethos: critical alerts, Repeat-required grading for CHB or delayed defibrillation, and the storm checklist.

All 12 smoke tests pass, and the text now matches standard teaching.

Caveats before unsupervised use:

1. **R1 (steam pop and tamponade rates).** It will train systematically under-dosed lesions.
2. **R2 and R3 (PPI−TCL and the His-refractory PVC).** These are the two maneuvers the cases are built around. They currently give impossible or contradictory results in several cases, so a supervisor must debrief them.
3. **R4 (junctional rhythm).** Junctional-rhythm safety is taught via banners rather than EGMs.
4. **R5 (non-inducibility).** The automated test under-represents the stimulation protocol fellows must learn to run.
5. **Missing modalities.** There is no PFA, cryo or very-high-power short-duration option. That matters for PVI teaching in 2026, when PFA is the dominant PVI energy.
6. **Thresholds.** All numeric thresholds are teaching defaults, not patient-specific values. Faculty should state their own lab's cut-offs, for example for oesophageal temperature and RF power.
