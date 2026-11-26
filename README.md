# 3D Mapping EP Sim

3D Mapping EP Sim is an interactive, browser-based **3D electroanatomic mapping simulator** for training in cardiac electrophysiology (EP). It is a static site (plain HTML, CSS and vanilla ES modules) that uses three.js and needs no build step.

> **Educational disclaimer.** This is a teaching simulator only. It is **not a medical device**, it is not validated for clinical use, and it must not guide patient care. It is **not affiliated with, endorsed by or derived from any mapping-system vendor**. All names, UI and models are original. The physiology is a simplified teaching approximation.

## Screenshots

![Case library](docs/screenshot-home.png)

![Scar VT: LV voltage map, catheters and live intracardiac EGMs](docs/screenshot-mapping.png)

## Features
- **Case library.** 11 encoded cases plus a Sandbox, each with a difficulty badge, chamber and estimated time:
  1. Typical AVNRT
  2. ORT via a concealed left lateral AP
  3. WPW, posteroseptal
  4. WPW, left lateral
  5. Focal AT from the crista terminalis
  6. Paroxysmal AF / PVI
  7. CTI-dependent flutter
  8. Perimitral flutter after prior ablation
  9. Ischaemic scar VT
  10. RVOT PVC/VT
  11. VF / electrical storm
- **Case briefing ECGs.** Each case shows standard 12-lead printouts (3 × 4 layout plus a lead II rhythm strip, 25 mm/s, 10 mm/mV, with measurements). They are generated from a cardiac dipole model that is projected onto all twelve lead axes, and they match the case: pre-excitation by pathway site, retrograde P waves, typical and perimitral flutter, AF, VT with AV dissociation, RVOT PVCs and VF onset. Click an ECG to enlarge it.
- **Enforced workflow.** The steps are briefing (vignette, clinical 12-lead ECGs of the baseline rhythm and the clinical arrhythmia, quiz), catheter placement, baseline intervals with calipers, induction, diagnostic maneuvers and diagnosis commit, mapping, ablation, endpoint tests, and debrief. RF is gated until a diagnosis is committed (except in the VF case).
- **3D viewport.** Procedural RA/LA/RV/LV shells (about 15k engine nodes) with landmarks.
  - **Shapes:** the LV is bullet-shaped with a tapered apex, and the RV is a crescent wrapped around the septal side of the LV, with inflow and infundibulum, tapering to a rounded RV apex just short of the LV apex. The RAA is a broad-based triangular pouch, and the LAA is narrow-necked, tubular and hooked.
  - **Display:** finer shells with endocardial relief (ventricular trabeculations, LV anterolateral and posteromedial papillary muscles, RA pectinate muscles and crista terminalis, LAA pectinates). The LA lies posterior and leftward of the RA and shares the interatrial septum with it (fossa ovalis on the common wall).
  - **Heartbeat:** the walls move with the simulated activation. Each region contracts after it activates, so arrhythmias, pacing and dyssynchrony show up in the motion. The motion is radial thickening plus descent of the AV plane toward the apex in systole, and non-conducting scar is akinetic. Catheters, points and tags move with the wall. It is off by default; turn it on with the **Beat** chip.
  - **Anatomy toggle:** optional translucent surrounding anatomy (great vessels, coronary sinus, valve annuli). It is off by default.
  - **Maps:** LAT and bipolar voltage maps built from acquired points, using the reference channel, window of interest (WOI), fill radius and colour bar. A live propagation view is also available.
  - **Point acquisition:** Space at the catheter tip, or Shift+click on the shell.
  - **Map–target correlation:** each case's default map points at its ablation target.
    - Focal AT, PVC/VT focus and APs: the earliest LAT sits at the target. The RVOT case uses PVC template matching, so only beats starting at the PVC focus are annotated.
    - WPW: anterograde maps (QRS reference, in pre-excited sinus) annotate the ventricular signal at the annulus only, so the earliest V marks the AP.
    - CTI and perimitral flutter: the default window of interest is anchored so that early meets late at the isthmus line.
    - Scar VT: the window opens at the isthmus, which lies in the low-voltage border zone.
    - AVNRT: the slow-pathway region shows a low-voltage "bridge" between the CS os and the tricuspid annulus on the voltage map.
  - **Views:** AP/PA/LAO/RAO/LL/RL presets, orbit and zoom.
  - **Ablation catheter:** bidirectional deflection, torque and advance, plus a sheath that tilts the whole catheter about the access point in X (patient left/right) and Y (anterior/posterior), up to 40°, so the tip can reach any wall of the chamber. Ctrl/Alt+drag moves the tip over the wall directly. The distal shaft flexes against the wall, and a contact-force arrow is shown.
  - **Catheters:** the electrodes are placed along the curved shaft and bend with it (3.5 mm ablation tip, 2-5-2 mm ring spacing).
  - **Mapping catheters:** the steerable catheter can be swapped (ABL row, Catheters panel) for an HD Grid (16 electrodes on a flat 4 × 4 paddle, 3 mm spacing) or an Orion (64-pole mini-basket, 8 splines × 8 electrodes). The paddle lies flat on the wall and the basket splines conform to it. Each acquisition records every electrode in contact, giving tens of points per beat for high-density LAT and voltage maps. Four bipoles (Grid A–D 1-2, Orion A/C/E/G 1-2) are shown on the EGM panel. The mapping catheters have no RF and no contact-force sensor; the steer pad shows how many electrodes are in contact.
- **Propagation engine.** An event-driven graph cellular automaton with restitution, decremental AV-nodal pathways (dual physiology, Wenckebach), accessory pathways and a His–Purkinje system. Mechanisms include:
  - macro-reentry (CTI, perimitral, scar isthmus)
  - automatic and triggered foci
  - AF drivers in the pulmonary veins
  - VF
- **EGM panel.** A sweeping display of I, II, aVF, V1, V6, HRA, His d/p, CS 9-10…1-2, RVA and ABL d/p (or the mapping catheter's bipoles), plus a PV loop in AF,, synthesised from the live activation.
  - **Surface ECG:** the heart vector includes the transmural (endocardium to epicardium) wavefront. Sinus rhythm gives a small P wave, septal q in I/V6, an rS complex in V1, a concordant asymmetric T wave, and mild baseline wander. Beats that start in the myocardium (ventricular pacing, PVCs, VT, the delta wave of pre-excitation) are wide and follow their site of origin, with discordant T waves: RV apex pacing captures with an LBBB-like, superior-axis QRS, and pre-excited beats fuse with the His-Purkinje wave. Cases can set the patient's heart orientation (e.g. a more horizontal heart in the scar VT case).
  - **Intracardiac EGMs:** band-pass filtered like a recording system (bipolar 30 Hz high-pass), so near-field signals are sharp and far-field signals are small.
  - **Controls:** sweep speed, gain, freeze and calipers. **Snap** (or N) saves a 10 s strip of every channel at that moment and opens it with calipers. Saved snaps stay available from the snap list after the live buffer has moved on. The last 20 s can be scrolled left and right with the mouse wheel, by dragging the strip, with the scroll bar, with ◀ ▶ or with ←/→. **Live** (or End) returns to the live sweep.
- **Stimulator.** S1, S1S2(S3), burst and decremental pacing, with entrainment analysis (PPI, PPI−TCL, VAV/VAAV, SA). Also offers a His-refractory PVC, para-Hisian pacing, isoproterenol, adenosine and storm drugs.
- **RF generator.**
  - **Delivery:** power, duration and contact force settings, with live impedance, temperature and a lesion quality index (LQI). Lesion tags are tiered weak/good/strong/excessive.
  - **Lesion effects:** lesions block conduction. Gaps in a line still conduct. Oedema recovers after the waiting period, and weak lesions on pathways can reconnect.
  - **Safety model:** AV block near the His, impedance rise, steam pop and tamponade, excessive contact force, phrenic nerve, oesophageal temperature, PV stenosis. The generator auto-stops on red alerts.
  - **Defibrillation:** synchronised or unsynchronised.
- **Scoring and debrief.**
  - **Quizzes:** checkpoint quizzes per phase, plus 3 tiered hints per step (tier 3 shows a ghost target).
  - **Rubric:** the 100-point rubric (domains A–H) with safety deductions and grade bands.
  - **Debrief screen:** shows a timeline, a final map snapshot, the "expert path" and a JSON export.
- **Accessibility.** Dark theme built from the spec tokens, a colorblind-safe palette, keyboard shortcuts (press `?` or F1 for help), ARIA roles and live regions, focus trapping in modals and reduced-motion support.

## Running locally
```bash
cd "3D mapping EP sim"
python3 -m http.server 8000
# open http://localhost:8000/
```
You need an internet connection for three.js, which is loaded from `cdn.jsdelivr.net` (pinned to `three@0.160.0`) through an import map. All paths are relative, so the folder can be published as-is on GitHub Pages.

Useful URL parameters:
- `?case=<id>` opens a case directly, for example `?case=avnrt`.
- `?autotest=<id>|all` runs the scripted smoke test.

## Project structure
```
index.html              app shell, import map
css/tokens.css          design tokens (docs/03 §1.2, colorblind palette §7.2)
css/styles.css          layout and components
js/main.js              app: library, case flow, render loop, keyboard, debrief
js/workflow.js          step gating, maneuvers, diagnosis, endpoint tests
js/scoring.js           100-point rubric + safety deductions
js/autotest.js          scripted end-to-end smoke test
js/cases/cases.js       11 cases + sandbox (vignettes, engine config, quizzes, hints, endpoints)
js/engine/              geometry (SDF chambers, surface nets), propagation, scenario,
                        mechanisms, sim, catheters, egm, stimulator, ablation, mapping,
                        endpoints, targets
js/ui/                  viewport3d, egmPanel, panels, modals, alerts, keymap
js/util/heap.js         event heap
tests/                  headless harness (autotest.sh, run.sh, engine tests)
docs/                   research spec, clinical curriculum, UX/UI design
```

## Tests
With a local server on port 8765 and a headless Chromium:
- `tests/autotest.sh all` runs every case end to end. Each case is placed, measured, induced, mapped, ablated at its target, put through its endpoint tests and scored, and the script prints one `RESULT` line per case.
- `tests/st.py` and `tests/script_test.html` drive the engine directly.

## Known limitations
- The anatomy is procedural, made of smooth ellipsoid/capsule unions and not patient-derived. The wall is modelled as a single surface layer with a nominal thickness.
- EGMs and the surface ECG are synthesised kernels, not biophysical. The live surface ECG computes I, II, aVF, V1 and V6; the briefing shows a separately generated reference 12-lead for each case.
- Pace mapping is a distance-based score. There is no fluoroscopy view, so the time domain uses simulated procedure time as a proxy.
- Some mechanism onsets are rule-based: reentry is seeded when the stimulation criteria are met, not purely emergent.

## Credits
Content and behaviour follow the project specifications in `docs/`:
- `01_research_spec.md` (physiology and engine model)
- `02_clinical_cases_curriculum.md` (cases, workflow, rubric, pearls)
- `03_ux_ui_design.md` (visual identity, layout, interaction, accessibility)

3D rendering uses [three.js](https://threejs.org) (MIT).

## License
MIT © chatchaine. See [LICENSE](LICENSE).
