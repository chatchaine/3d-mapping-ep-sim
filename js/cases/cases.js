// Case library encoded from docs/02_clinical_cases_curriculum.md.
// Numbers are teaching defaults, not patient-specific thresholds.
//
// Each case: vignette + ECG, engine configuration (substrate and mechanism for the
// propagation model), induction / maneuver / diagnosis content, ablation target and
// endpoint definitions, quizzes (by workflow phase), tiered hints and benchmarks.

const AVN_DUAL = {
  fp: { antero: { A: 60, tau: 70, erp: 305, k: 0.25 }, retro: { base: 40, A: 50, tau: 70, erp: 280 } },
  sp: { antero: { base: 230, A: 120, tau: 60, erp: 240, k: 0.1 }, retro: null },
};
const AVN_AP = { fp: { antero: { A: 60, tau: 70, erp: 250, k: 0.1 }, retro: { base: 45, A: 50, tau: 70, erp: 300 } } };

export const LEVELS = { 1: 'Beginner', 2: 'Intermediate', 3: 'Advanced' };

export const CASES = [
  // ------------------------------------------------------------------ 1
  {
    id: 'avnrt', num: 1, title: 'Typical (slow–fast) AVNRT', tag: 'AVNRT', level: 1, chamber: 'RA', mins: 20,
    patient: { age: 34, sex: 'F', summary: 'Sudden-onset palpitations for 6 years, terminated by Valsalva. ED: narrow-complex tachycardia at 170 bpm, ended with adenosine 6 mg.', history: 'Normal echocardiogram.', meds: 'None (beta-blocker stopped 5 half-lives before the study).', labs: 'K 4.1, Mg 2.0, creatinine normal' },
    ecg: { baseline: ['Sinus rhythm 75 bpm', 'PR 150 ms, QRS 88 ms', 'No pre-excitation, QTc 410 ms'], tachy: ['Regular narrow-complex tachycardia, 170 bpm (CL 350)', 'No visible P waves', 'Pseudo-r′ in V1, pseudo-S in II, III, aVF'] },
    objectives: ['Recognise dual AV nodal physiology (AH jump ≥ 50 ms)', 'Distinguish AVNRT from ORT with VA interval and maneuvers', 'Locate the slow-pathway region in Koch\'s triangle', 'Recognise a safe vs dangerous junctional rhythm during RF'],
    engine: { sinusCL: 800, ah: 80, hv: 45, avn: AVN_DUAL, mechanism: 'natural', ablChamber: 'RA', tachyLabel: 'SVT (narrow, CL ~350)', hpsRetroExtra: 40 },
    induction: { group: 'A', text: 'Atrial extrastimulus S1 600 / S2 decrementing from 320 ms (AH jump at ~300, SVT at ~290) or atrial burst ~350 ms.', iso: false },
    maneuvers: ['rv_entrainment', 'his_pvc', 'para_hisian', 'adenosine'],
    diagnosis: { options: ['Typical slow–fast AVNRT', 'Orthodromic AVRT via a septal AP', 'Septal focal atrial tachycardia', 'Junctional tachycardia'], correct: 0, explain: 'Septal VA ≈ 20 ms, concentric retrograde activation, VAV with PPI–TCL > 115 ms and no effect of a His-refractory PVC.' },
    target: { kind: 'sp', landmarkNode: 'SP_ENTRY', radius: 6, label: 'Slow-pathway region (inferior Koch\'s triangle, between CS os and TA)' },
    map: { group: 'A', ref: 'CS78', woi: [-80, 40], chamber: 'RA', min: 30 },
    rfBenchmark: 6, fluoroBenchmark: 5, rfPower: 35,
    endpoints: [
      { id: 'junctional_rf', label: 'Accelerated junctional rhythm with 1:1 VA during RF' },
      { id: 'noninducible', label: 'No inducible AVNRT (atrial S1S2 / burst)' },
      { id: 'noninducible_iso', label: 'No inducible AVNRT on isoproterenol' },
      { id: 'no_av_block', label: 'AV conduction preserved (atrial pacing after ablation)' },
    ],
    quizzes: [
      { phase: 'induction', q: 'An AH increase of 110 ms when S2 is shortened by 10 ms means:', options: ['AV node Wenckebach', 'Dual AV nodal physiology', 'AP block', 'His-Purkinje delay'], correct: 1, explain: 'A jump of ≥ 50 ms per 10 ms decrement shows conduction switching from the fast to the slow pathway.' },
      { phase: 'maneuvers', q: 'A septal VA of 20 ms during an SVT excludes which mechanism?', options: ['Typical AVNRT', 'Orthodromic AVRT', 'AT with long PR', 'None'], correct: 1, explain: 'In ORT the impulse must go through the ventricle and the AP, so a VA under 70 ms is essentially impossible.' },
      { phase: 'maneuvers', q: 'After RV entrainment: VAV, PPI–TCL 165 ms, SA–VA 115 ms. The diagnosis is:', options: ['AVNRT', 'ORT septal AP', 'AT', 'Cannot tell'], correct: 0, explain: 'PPI–TCL > 115 ms and corrected SA–VA > 85 ms mean the ventricle is far from the circuit.' },
      { phase: 'ablation', q: 'During RF you see a junctional rhythm at CL 320 ms with retrograde VA block. You should:', options: ['Continue to complete 60 s', 'Stop RF immediately', 'Increase power', 'Pace the atrium faster'], correct: 1, explain: 'VA block during junctional rhythm can mean fast-pathway injury, which precedes AV block.' },
    ],
    hints: {
      induction: ['Use the atrial extrastimulus protocol from HRA.', 'S1 600 ms; decrement S2 from 320 ms in 10 ms steps and watch the AH.', 'S2 ≈ 290 ms produces an AH jump followed by sustained SVT.'],
      maneuvers: ['Describe CL, VA, atrial sequence and AV relationship first.', 'Entrain from the RV at TCL − 20/−30 ms and read PPI–TCL.', 'Septal VA ≈ 20 ms + PPI–TCL > 115 ms: typical AVNRT.'],
      mapping: ['Map Koch\'s triangle: His, CS os and the tricuspid annulus.', 'Tag the His; the slow pathway is inferior, between CS os and TA.', 'Target region pulses on the shell.'],
      ablation: ['Start low at the level of the CS os and move up in small steps.', 'Small multicomponent A with a large V, ≥ 10 mm below the His tag.', 'Ghost target is shown: deliver 30–40 W for 30–60 s and look for slow junctional rhythm.'],
      endpoint: ['Termination alone is not enough.', 'Repeat S1S2 and burst with and without isoproterenol.', 'Then check AV conduction with atrial pacing.'],
    },
    expert: ['Baseline: AH 80, HV 45, AVWCL ~360', 'A S1S2: AH jump at S2 300, SVT at 290 (TCL ~350)', 'Septal VA ~20 ms; RV entrainment VAV, PPI–TCL > 115', 'Slow-pathway RF at the CS os level → slow junctional rhythm', 'Non-inducible ± iso; AV conduction intact'],
  },
  // ------------------------------------------------------------------ 2
  {
    id: 'ort_concealed', num: 2, title: 'ORT via concealed left lateral AP', tag: 'WPW/AP', level: 2, chamber: 'LA', mins: 25,
    patient: { age: 27, sex: 'M', summary: 'Soccer player with palpitations since adolescence. Holter: narrow-complex tachycardia at 190 bpm.', history: 'Normal sinus ECG and echocardiogram.', meds: 'None', labs: 'Normal' },
    ecg: { baseline: ['Sinus 70 bpm, PR 160 ms, QRS 90 ms', 'No delta wave'], tachy: ['Narrow-complex tachycardia 185 bpm', 'Retrograde P in the ST segment (RP ~120 ms, RP < PR)', 'P negative in I and aVL; QRS alternans possible'] },
    objectives: ['Recognise eccentric, non-decremental retrograde conduction', 'Use the His-refractory PVC to prove an AP', 'Map the earliest retrograde A on the mitral annulus'],
    engine: { sinusCL: 850, ah: 85, hv: 45, avn: AVN_AP, ap: { ring: 'MA', hour: 3, antero: null, retro: { base: 10, A: 0, tau: 50, erp: 220 }, depth: 3 }, mechanism: 'natural', ablChamber: 'LA', tachyLabel: 'SVT (narrow, CL ~320)', hpsRetroExtra: 40 },
    induction: { group: 'V', text: 'Ventricular S1 600 / S2 ~260 ms, atrial S2 ~280 ms or ventricular burst ~290 ms.', iso: false },
    maneuvers: ['his_pvc', 'rv_entrainment', 'para_hisian'],
    diagnosis: { options: ['ORT using a concealed left lateral AP', 'Atypical AVNRT with eccentric activation', 'Left atrial tachycardia', 'AVNRT with left-sided input'], correct: 0, explain: 'Eccentric retrograde activation (distal CS earliest) with a fixed, non-decremental VA indicates a left lateral AP. A His-refractory PVC that advances the A proves an AP is present; one that delays the A or terminates the SVT without atrial activation proves the AP is in the circuit. An RVA PVC often cannot reach a distant lateral AP early enough, so no change does not exclude it.' },
    target: { kind: 'ap', radius: 4, label: 'Lateral mitral annulus (LAO 3 o\'clock), earliest retrograde A' },
    map: { group: 'A', ref: 'CS78', woi: [-80, 40], chamber: 'LA', min: 40 },
    rfBenchmark: 4, fluoroBenchmark: 5, rfPower: 35, leftSided: true,
    endpoints: [
      { id: 'ap_block', label: 'Loss of AP conduction (V pacing: concentric / decremental VA)' },
      { id: 'noninducible', label: 'No inducible tachycardia' },
      { id: 'wait', label: 'Waiting period completed (re-test for reconnection)' },
    ],
    quizzes: [
      { phase: 'induction', q: 'V pacing shows the earliest A at CS 1-2 with a fixed VA from CL 600 to 300 ms. This suggests:', options: ['A non-decremental left lateral AP', 'Retrograde fast pathway', 'Retrograde slow pathway', 'AT'], correct: 0, explain: 'Eccentric, non-decremental retrograde conduction is the signature of a left free-wall AP.' },
      { phase: 'maneuvers', q: 'A PVC delivered while the His is refractory advances the next atrial EGM. This proves:', options: ['AVNRT', 'Presence of a retrogradely conducting AP', 'AT', 'His-Purkinje reentry'], correct: 1, explain: 'The impulse could not have used the His/AV node, so it reached the atrium another way. This proves an AP is present; delay of the A or termination without atrial activation proves it is part of the circuit.' },
      { phase: 'ablation', q: 'Retrograde aortic or transseptal approach?', options: ['Only retrograde can reach the MA', 'Both are acceptable; choose by anatomy and skill', 'Transseptal is contraindicated', 'Ablate from the CS'], correct: 1, explain: 'Both approaches reach the lateral mitral annulus.' },
    ],
    hints: {
      induction: ['Ventricular extrastimuli or burst from the RVA.', 'S1 600 / S2 260 ms from RVA, or V burst at ~290 ms.', 'V burst 290 ms × 12 beats induces ORT in this model.'],
      maneuvers: ['Look at the CS sequence during SVT.', 'Deliver a His-refractory PVC: does it advance the A?', 'Eccentric (distal CS earliest) fixed VA = left lateral AP; an RVA PVC may not advance a distant lateral AP.'],
      mapping: ['Map the mitral annulus during ORT or V pacing.', 'Bracket the earliest A between CS electrodes.', 'Target region pulses on the shell.'],
      ablation: ['Earliest retrograde A with continuous VA.', 'Lateral MA, LAO ~3 o\'clock; block usually occurs within ~5–10 s. If not, stop and re-map.', 'Ghost target shown.'],
      endpoint: ['Prove the AP is gone.', 'V pacing: VA should become concentric and decremental.', 'Wait 20–30 min and re-test.'],
    },
    expert: ['V pacing: eccentric fixed VA (distal CS earliest)', 'Induce ORT with V burst / S2', 'His-refractory PVC advances A', 'Transseptal mapping of earliest A at lateral MA', 'RF 35 W: AP block within ~5–10 s; wait and re-test'],
  },
  // ------------------------------------------------------------------ 3
  {
    id: 'wpw_ps', num: 3, title: 'WPW, manifest posteroseptal AP', tag: 'WPW/AP', level: 3, chamber: 'RA', mins: 30,
    patient: { age: 19, sex: 'F', summary: 'Syncope during exercise. ED recorded AF with an irregular wide-complex rhythm; shortest pre-excited RR 220 ms (high risk).', history: 'Structurally normal heart.', meds: 'None', labs: 'Normal' },
    ecg: { baseline: ['Sinus, PR 100 ms, QRS 130 ms, delta wave', 'Delta negative in II, III, aVF; positive in I, aVL', 'Negative/isoelectric V1, abrupt R in V2'], tachy: ['Narrow ORT at CL 300 (earliest A at CS os)', 'Pre-excited AF in the ED (SPERRI 220 ms)'] },
    objectives: ['Localise an AP from the delta wave (stepwise algorithm)', 'Anterograde mapping: earliest V before delta with QS unipolar', 'Manage risk near the compact AV node'],
    engine: { sinusCL: 750, ah: 70, hv: 45, avn: { fp: { antero: { A: 60, tau: 70, erp: 200, k: 0.05 }, retro: { base: 45, A: 50, tau: 70, erp: 300 } } }, ap: { landmark: [-10, 16, -22], atrialChamber: 'RA', antero: { base: 10, A: 0, tau: 50, erp: 330 }, retro: { base: 10, A: 0, tau: 50, erp: 150 }, depth: 3 }, mechanism: 'natural', ablChamber: 'RA', tachyLabel: 'SVT (narrow)', hpsRetro: false, hisErp: 220 },
    induction: { group: 'A', text: 'Ventricular pacing ~290 ms from the RVA (or atrial burst) starts ORT using the septal AP retrogradely.', iso: false },
    maneuvers: ['his_pvc', 'adenosine', 'rv_entrainment'],
    diagnosis: { options: ['Manifest posteroseptal AP with ORT', 'Mahaim (atriofascicular) fibre', 'Right free-wall AP', 'Left posterior AP'], correct: 0, explain: 'Negative delta in the inferior leads with an abrupt R in V2, earliest V at the CS os and a short HV. A negative delta in lead II also raises the possibility of an epicardial (CS/MCV) pathway.' },
    target: { kind: 'ap', radius: 5, label: 'Posteroseptal region at the CS os (earliest V, QS unipolar)' },
    map: { group: 'V', ref: 'QRS', woi: [-80, 60], chamber: 'RA', min: 40 },
    rfBenchmark: 6, fluoroBenchmark: 5, rfPower: 28,
    endpoints: [
      { id: 'delta_gone', label: 'Loss of delta wave (HV normalises)' },
      { id: 'ap_block', label: 'No retrograde AP conduction (V pacing)' },
      { id: 'wait', label: 'Waiting period / adenosine challenge' },
    ],
    quizzes: [
      { phase: 'briefing', q: 'In pre-excited AF the shortest pre-excited RR is 220 ms. This means:', options: ['Low risk, observe', 'High risk for VF; ablation indicated', 'The AV node is fast', 'Give verapamil'], correct: 1, explain: 'SPERRI ≤ 250 ms marks sudden-death risk; AV-nodal blockers are contraindicated in pre-excited AF.' },
      { phase: 'briefing', q: 'Delta negative in III and aVF, R > S in V2, negative in V1. Most likely location:', options: ['Left lateral', 'Posteroseptal', 'Right anterior free wall', 'Anteroseptal'], correct: 1, explain: 'Negative inferior delta with an early transition localises posteroseptally.' },
      { phase: 'ablation', q: 'The earliest site is in the MCV neck. Before RF you should:', options: ['Deliver 40 W for 60 s', 'Coronary angiography and low power / cryo', 'Abandon the procedure', 'Ablate the His'], correct: 1, explain: 'The PDA/RCA run close to the MCV; image the coronaries and titrate energy.' },
    ],
    hints: {
      induction: ['Atrial extrastimuli from the HRA.', 'S1 600 / S2 decrementing to ~260 ms blocks the AP anterogradely.', 'Atrial burst 300 ms also induces ORT.'],
      maneuvers: ['Compare HV in sinus with ORT.', 'A His-refractory PVC during ORT should advance (or delay/terminate) the A when a septal AP is in the circuit.', 'Pre-excitation + earliest V at CS os = posteroseptal AP.'],
      mapping: ['Map ventricular activation during sinus (pre-excited) with the QRS reference.', 'Look for the earliest V at the CS os region.', 'Target region pulses on the shell.'],
      ablation: ['Earliest V before delta, QS unipolar, AP potential.', 'Stay ≥ 10 mm from the His tag; 25–30 W.', 'Ghost target shown.'],
      endpoint: ['Delta wave should vanish.', 'Check retrograde conduction with V pacing.', 'Wait and re-test.'],
    },
    expert: ['Short HV, negative inferior delta → posteroseptal', 'A S2 260 blocks AP → ORT', 'Map earliest V at CS os in sinus', 'RF 25–30 W at earliest V with QS', 'Delta loss; no retrograde AP; wait'],
  },
  // ------------------------------------------------------------------ 4
  {
    id: 'wpw_ll', num: 4, title: 'WPW, manifest left lateral AP', tag: 'WPW/AP', level: 1, chamber: 'LA', mins: 25,
    patient: { age: 22, sex: 'M', summary: 'Pre-excitation found on a pre-employment ECG. Occasional palpitations.', history: 'No structural heart disease.', meds: 'None', labs: 'Normal' },
    ecg: { baseline: ['PR 110 ms, QRS 120 ms', 'Delta negative/isoelectric in I and aVL, positive in II, III, aVF', 'Positive V1 (R > S): "type A" → left lateral'], tachy: ['ORT at CL 330 (narrow, eccentric, earliest A distal CS)'] },
    objectives: ['Recognise left-sided pre-excitation', 'Maximise pre-excitation with CS distal pacing', 'Anterograde mapping of the earliest V'],
    engine: { sinusCL: 800, ah: 75, hv: 45, avn: AVN_AP, ap: { ring: 'MA', hour: 3, antero: { base: 10, A: 0, tau: 50, erp: 330 }, retro: { base: 10, A: 0, tau: 50, erp: 230 }, depth: 3 }, mechanism: 'natural', ablChamber: 'LA', tachyLabel: 'SVT (narrow, CL ~330)', hpsRetroExtra: 40 },
    induction: { group: 'A', text: 'Atrial burst pacing 300 ms from CS or HRA (extrastimuli rarely induce in this model).', iso: false },
    maneuvers: ['his_pvc', 'cs_pacing', 'rv_entrainment'],
    diagnosis: { options: ['WPW, manifest left lateral AP with ORT', 'Right free-wall AP', 'Posteroseptal AP', 'Mahaim fibre'], correct: 0, explain: 'Positive V1 delta with negative I/aVL and eccentric (distal CS earliest) activation in ORT.' },
    target: { kind: 'ap', radius: 4, label: 'Lateral mitral annulus (LAO 2–4 o\'clock)' },
    map: { group: 'V', ref: 'QRS', woi: [-80, 60], chamber: 'LA', min: 40 },
    rfBenchmark: 4, fluoroBenchmark: 5, rfPower: 35, leftSided: true,
    endpoints: [
      { id: 'delta_gone', label: 'Loss of delta wave' },
      { id: 'ap_block', label: 'No retrograde AP conduction' },
      { id: 'noninducible', label: 'ORT not inducible' },
      { id: 'wait', label: 'Waiting period / adenosine' },
    ],
    quizzes: [
      { phase: 'briefing', q: 'Positive delta in V1 with negative delta in I/aVL suggests:', options: ['Left lateral AP', 'Right free-wall AP', 'Posteroseptal AP', 'Mahaim fibre'], correct: 0, explain: 'Type A pattern with leftward-negative forces = left free wall.' },
      { phase: 'baseline', q: 'Why can the delta wave be subtle in sinus rhythm with a left lateral AP?', options: ['The AP is concealed', 'The atrial impulse reaches the AV node before the distant AP', 'HV is long', 'Wrong ECG filtering'], correct: 1, explain: 'The sinus impulse reaches the left lateral AP late relative to the AV node.' },
      { phase: 'mapping', q: 'The best anterograde target signal is:', options: ['Largest A EGM', 'Earliest V before the delta with a QS unipolar EGM', 'Latest V', 'Fractionated A'], correct: 1, explain: 'Earliest V with QS unipolar marks the ventricular insertion.' },
    ],
    hints: {
      induction: ['Atrial pacing from the CS or HRA.', 'Atrial burst ~300 ms from distal CS (extrastimuli rarely induce in this model).', 'CS 1-2 burst 300 ms for ~3 s induces ORT.'],
      maneuvers: ['Pace CS distal vs HRA and compare pre-excitation.', 'His-refractory PVC during ORT (an RVA PVC may not reach a lateral AP early enough to advance the A).', 'Eccentric, distal-CS-earliest activation in ORT.'],
      mapping: ['Map the lateral mitral annulus.', 'Use the QRS reference: earliest V precedes the delta.', 'Target region pulses on the shell.'],
      ablation: ['Lateral MA ~3 o\'clock.', 'Delta should disappear within ~5–10 s; if not, stop and re-map.', 'Ghost target shown.'],
      endpoint: ['Delta wave gone?', 'V pacing for retrograde conduction.', 'Wait 20–30 min.'],
    },
    expert: ['CS distal pacing maximises pre-excitation', 'Atrial burst from CS induces ORT (eccentric)', 'Map earliest V at lateral MA', 'RF 35 W: delta lost within ~5–10 s', 'No retrograde AP; non-inducible; wait'],
  },
  // ------------------------------------------------------------------ 5
  {
    id: 'focal_at', num: 5, title: 'Focal AT from the crista terminalis', tag: 'AT', level: 2, chamber: 'RA', mins: 25,
    patient: { age: 45, sex: 'F', summary: 'Incessant palpitations for 4 months; LVEF fell to 40% (suspected tachycardiomyopathy). Beta-blocker ineffective.', history: '—', meds: 'Bisoprolol (stopped)', labs: 'Normal' },
    ecg: { baseline: ['Sinus 85 bpm, normal intervals'], tachy: ['Long-RP tachycardia 160 bpm (CL 375)', 'P positive in II, III, aVF and I; biphasic/positive V1; negative aVR', 'Suggests right lateral atrium / crista terminalis'] },
    objectives: ['Recognise automatic AT (warm-up, iso-dependence, AV block without termination)', 'Build a focal activation map (centrifugal, < 50% TCL)', 'Protect the phrenic nerve with high-output pacing'],
    engine: { sinusCL: 700, ah: 85, hv: 45, mechanism: 'focalAT', focus: { pos: [-42, 20, 18], chamber: 'RA', cl: 375, warmStart: 460, isoThreshold: 2 }, ablChamber: 'RA', tachyLabel: 'Atrial tachycardia' },
    induction: { group: 'A', text: 'Hard to induce with PES. Isoproterenol 2 µg/min gives spontaneous onset with warm-up.', iso: true },
    maneuvers: ['v_overdrive', 'adenosine', 'a_overdrive'],
    diagnosis: { options: ['Focal AT, right atrial crista terminalis', 'Inappropriate sinus tachycardia / sinus node reentry', 'Atypical AVNRT', 'PJRT'], correct: 0, explain: 'Warm-up on iso, VAAV after V overdrive, AV block without termination and a crista P-wave morphology.' },
    target: { kind: 'focus', radius: 5, label: 'Earliest site on the posterolateral crista (mid-high)' },
    map: { group: 'A', ref: 'CS78', woi: [-180, 160], chamber: 'RA', min: 80 },
    rfBenchmark: 5, fluoroBenchmark: 5, rfPower: 30,
    endpoints: [
      { id: 'terminated_rf', label: 'Termination of AT during RF' },
      { id: 'noninducible_iso', label: 'Not inducible on isoproterenol + burst' },
    ],
    quizzes: [
      { phase: 'maneuvers', q: 'After V overdrive pacing during SVT the sequence is V-A-A-V. This indicates:', options: ['AVNRT', 'ORT', 'AT', 'Pseudo-VAAV from typical AVNRT'], correct: 2, explain: 'VAAV indicates AT, provided the atrium was truly entrained 1:1.' },
      { phase: 'mapping', q: 'A focal AT activation map shows:', options: ['~100% of TCL with early-meets-late', 'Centrifugal spread from a single earliest point', 'Two foci', 'Isochronal crowding at the TA'], correct: 1, explain: 'Focal mechanisms spread radially; total activation is well below the TCL.' },
      { phase: 'ablation', q: 'Before ablating on the lateral crista terminalis you should:', options: ['Increase CF to 50 g', 'Pace at high output to check for phrenic capture', 'Give adenosine', 'Turn off irrigation'], correct: 1, explain: 'High-output pacing (e.g. 10–20 mA at 2 ms) identifies the phrenic course; avoid sites with diaphragmatic capture.' },
    ],
    hints: {
      induction: ['Programmed stimulation rarely induces automatic AT.', 'Start isoproterenol 2 µg/min and wait.', 'Iso 2 µg/min starts the AT within seconds (warm-up).'],
      maneuvers: ['V overdrive pacing during the tachycardia.', 'Read the response after the last paced beat: VAAV?', 'VAAV + AV block without termination = AT.'],
      mapping: ['Set the WOI to ~90% of the TCL.', 'Map the lateral RA / crista densely.', 'Target region pulses on the shell.'],
      ablation: ['Earliest A with QS unipolar.', 'High-output pacing first (phrenic).', 'Ghost target shown.'],
      endpoint: ['AT should stop during RF.', 'Re-challenge with iso + burst.', 'Confirm sinus rhythm.'],
    },
    expert: ['Iso 2 µg/min: AT with warm-up (CL 375)', 'V overdrive → VAAV', 'LAT map: centrifugal from the crista, earliest ~−35 ms', 'High-output pacing (phrenic) then RF 30 W', 'Termination; non-inducible on iso + burst'],
  },
  // ------------------------------------------------------------------ 6
  {
    id: 'paf_pvi', num: 6, title: 'Paroxysmal AF → pulmonary vein isolation', tag: 'AF-PVI', level: 2, chamber: 'LA', mins: 40,
    patient: { age: 58, sex: 'M', summary: 'Hypertension; symptomatic paroxysmal AF (EHRA III) despite flecainide. CHA₂DS₂-VASc 1. Uninterrupted DOAC; no LAA thrombus. LA 40 mm.', history: 'Hypertension', meds: 'Flecainide, DOAC', labs: 'Normal' },
    ecg: { baseline: ['Sinus 65 bpm, normal intervals'], tachy: ['AF: no P waves, irregular f waves, irregularly irregular RR'] },
    objectives: ['Recognise PV potentials vs far-field', 'Wide antral circumferential ablation with contiguous lesions', 'Confirm entrance and exit block; manage oesophageal heating'],
    engine: { sinusCL: 900, ah: 90, hv: 45, mechanism: 'af', atrialErp: { LA: 175, RA: 220 }, ablChamber: 'LA', tachyLabel: 'Atrial fibrillation' },
    induction: { group: 'A', text: 'Atrial burst 200 → 150 ms from CS, or PV ectopy on isoproterenol (≥ 4 µg/min).', iso: false },
    maneuvers: ['cs_pacing'],
    diagnosis: { options: ['Paroxysmal AF triggered from the PVs', 'Typical atrial flutter', 'Multifocal AT', 'Perimitral flutter'], correct: 0, explain: 'PV ectopy (LSPV) triggers irregular fibrillatory activity.' },
    target: { kind: 'pvi', radius: 0, label: 'Wide antral circles around the left and right PV pairs' },
    map: { group: 'A', ref: 'CS78', woi: [-80, 60], chamber: 'LA', min: 80 },
    rfBenchmark: 80, rfBenchmarkPer: 10, fluoroBenchmark: 10, rfPower: 35, leftSided: true,
    endpoints: [
      { id: 'pv_block', label: 'Entrance and exit block in all 4 PVs' },
      { id: 'wait', label: 'Waiting period, then re-test for dormant conduction' },
    ],
    quizzes: [
      { phase: 'mapping', q: 'During distal CS pacing a low-amplitude LSPV signal moves closer to the stimulus. It is most likely:', options: ['PV potential', 'Far-field LAA', 'Ventricular far field', 'Noise'], correct: 1, explain: 'Far-field LAA signals advance with distal CS/LAA pacing; true PVPs separate.' },
      { phase: 'ablation', q: 'Oesophageal temperature rises from 36.5 to 38.0 °C during posterior wall RF. Best action:', options: ['Stop RF, wait, move or reduce energy', 'Continue to complete the lesion', 'Increase irrigation and continue', 'Ignore if < 40 °C'], correct: 0, explain: 'A 1.5 °C rise is a clear stop signal. Most labs stop at a rise of 0.5–1 °C or an absolute ~38.5–39 °C, and the temperature can keep rising for several seconds after RF stops.' },
      { phase: 'endpoint', q: 'Which result confirms complete PV isolation?', options: ['Sinus rhythm', 'AF termination during ablation', 'Entrance and exit block, persistent after waiting/adenosine', 'Impedance drop'], correct: 2, explain: 'Isolation is defined by bidirectional block that persists.' },
    ],
    hints: {
      induction: ['AF can be induced by atrial burst pacing.', 'Burst from CS at ≤ 220 ms.', 'Or isoproterenol 4 µg/min for LSPV ectopy.'],
      maneuvers: ['Look at the PV loop channel in sinus.', 'Pace CS distal to separate far-field.', 'Commit the diagnosis.'],
      mapping: ['Acquire an LA voltage/anatomy map.', 'Tag the PV ostia.', 'Antral circles shown on the shell.'],
      ablation: ['Encircle ipsilateral pairs 5–15 mm outside the ostia.', 'Inter-lesion distance ≤ 6 mm; lower power on the posterior wall.', 'Gap finder: earliest PV potential on the loop.'],
      endpoint: ['Check every vein.', 'Run the PV block test.', 'Wait 20 min and re-test.'],
    },
    expert: ['LA map with PV potentials', 'WACA around left then right pairs (ILD ≤ 6 mm)', 'Posterior wall lower power; watch oesophageal T', 'Entrance + exit block in all 4 veins', 'Wait 20 min, touch-up gaps'],
  },
  // ------------------------------------------------------------------ 7
  {
    id: 'cti_flutter', num: 7, title: 'CTI-dependent typical (CCW) flutter', tag: 'AFL', level: 1, chamber: 'RA', mins: 25,
    patient: { age: 66, sex: 'M', summary: 'COPD; palpitations and dyspnoea. Atrial flutter with 2:1 conduction (ventricular rate ~125). Anticoagulated > 3 weeks.', history: 'COPD', meds: 'DOAC', labs: 'Normal' },
    ecg: { baseline: ['Atrial flutter 2:1, ventricular rate ~125'], tachy: ['Negative saw-tooth F waves in II, III, aVF, no isoelectric baseline', 'Positive V1, negative V6', 'Atrial CL 240 ms'] },
    objectives: ['Recognise CCW flutter (CS proximal → distal)', 'Entrainment: CTI PPI–TCL ≤ 20 ms', 'Complete a CTI line and prove bidirectional block'],
    engine: { sinusCL: 850, ah: 95, hv: 50, mechanism: 'ring', cristaBlock: true, cvMul: { RA: 0.7 }, reentry: { ring: 'TV', chamber: 'RA', initial: true, seedPath: 'ctiPath', behind: [-6, -3, -2], tcl: 240, burstMax: 250 }, ablChamber: 'RA', tachyLabel: 'Atrial flutter' },
    induction: { group: 'A', arrives: true, text: 'The patient arrives in flutter. If in sinus: burst from CS os or low lateral RA at 200–180 ms.', iso: false },
    maneuvers: ['entrain_cti', 'entrain_cs'],
    diagnosis: { options: ['CTI-dependent counter-clockwise typical flutter', 'Clockwise typical flutter', 'Perimitral flutter', 'Focal AT with 2:1'], correct: 0, explain: 'CS proximal → distal, negative inferior F waves and concealed entrainment from the CTI with PPI–TCL ≤ 20 ms.' },
    target: { kind: 'cti', radius: 0, label: 'Line across the CTI from the TA (6–7 o\'clock LAO) to the IVC' },
    map: { group: 'A', ref: 'CS910', woi: [-150, 70], chamber: 'RA', min: 60 },
    rfBenchmark: 15, fluoroBenchmark: 5, rfPower: 40,
    endpoints: [
      { id: 'terminated_rf', label: 'Flutter terminated during RF (not sufficient alone)' },
      { id: 'cti_block', label: 'Bidirectional CTI block (CS os and low lateral pacing)' },
      { id: 'wait', label: 'Block persists after waiting' },
    ],
    quizzes: [
      { phase: 'maneuvers', q: 'Entrainment from the CTI gives PPI–TCL 10 ms with concealed fusion. Interpretation:', options: ['CTI is part of the circuit', 'Pacing site is a bystander', 'Focal AT', 'Pacing artefact'], correct: 0, explain: 'PPI ≈ TCL means the pacing site is in the circuit.' },
      { phase: 'endpoint', q: 'Flutter terminated on the third RF lesion. Can you finish the case?', options: ['Yes, termination is the endpoint', 'No — confirm bidirectional block', 'Only if non-inducible', 'Only after adenosine'], correct: 1, explain: 'Termination ≠ block.' },
      { phase: 'endpoint', q: 'After the line, CS os pacing shows lateral RA activated top to bottom. This means:', options: ['Incomplete block', 'Medial → lateral block is present', 'Bystander', 'Reentry'], correct: 1, explain: 'The wavefront must go around the TA to reach the low lateral RA.' },
    ],
    hints: {
      induction: ['The patient is already in flutter.', 'Check the CS sequence and the atrial CL.', 'Proceed to maneuvers.'],
      maneuvers: ['Entrain from the CTI with the ablation catheter.', 'Pace 20 ms below the TCL; read PPI–TCL at the pacing site.', 'CTI PPI–TCL ≤ 20 = CTI-dependent.'],
      mapping: ['Map around the tricuspid annulus.', 'Look for early-meets-late and ≥ 90% TCL.', 'CTI line shown on the shell.'],
      ablation: ['From the TA (ventricular edge) to the IVC at 6–7 o\'clock.', 'Contiguous lesions ≤ 4–6 mm apart.', 'Ghost line shown.'],
      endpoint: ['Termination is not the endpoint.', 'Run the CTI block test (CS os and low lateral pacing).', 'Look for gaps if conduction persists.'],
    },
    expert: ['CS prox → dist, TCL 240', 'CTI entrainment PPI–TCL ≤ 20', 'Activation map: early-meets-late around TA', 'Contiguous CTI line 40 W', 'Bidirectional block, persistent after waiting'],
  },
  // ------------------------------------------------------------------ 8
  {
    id: 'perimitral', num: 8, title: 'Perimitral flutter after prior AF ablation', tag: 'AFL', level: 3, chamber: 'LA', mins: 40,
    patient: { age: 64, sex: 'F', summary: 'PVI + LA posterior wall ablation 14 months ago. Persistent regular AT at 115 bpm with 2:1 conduction.', history: 'Prior PVI + posterior wall isolation', meds: 'DOAC', labs: 'Normal' },
    ecg: { baseline: ['Regular AT, 2:1'], tachy: ['Atrial CL 260 ms', 'Flutter waves positive V1–V6 and inferior, low amplitude limb leads', 'ECG cannot localise this circuit reliably'] },
    objectives: ['Entrainment from several sites to localise macroreentry', 'Activation map covering ≥ 90% TCL around the MA', 'Create and validate a mitral isthmus line'],
    engine: { sinusCL: 850, ah: 110, hv: 50, mechanism: 'ring', priorBox: true, cvMul: { LA: 0.6 }, reentry: { ring: 'MV', chamber: 'LA', initial: true, seedPath: 'miPath', behind: [0, 0, 1], tcl: 260, burstMax: 280 }, ablChamber: 'LA', tachyLabel: 'Atrial tachycardia (macroreentry)' },
    induction: { group: 'A', arrives: true, text: 'The patient arrives in AT. If terminated: burst pacing re-induces.', iso: false },
    maneuvers: ['entrain_cti', 'entrain_cs'],
    diagnosis: { options: ['Perimitral flutter (clockwise), mitral isthmus dependent', 'Roof-dependent flutter', 'Focal AT from a PV gap', 'Typical CTI flutter'], correct: 0, explain: 'CTI PPI–TCL long; proximal and distal CS PPI–TCL ≤ 20; activation around the MA ≈ 95% TCL.' },
    target: { kind: 'mi', radius: 0, label: 'Mitral isthmus line: lateral MA (~4 o\'clock) to the LIPV antral lesion set' },
    map: { group: 'A', ref: 'CS910', woi: [-170, 70], chamber: 'LA', min: 120 },
    rfBenchmark: 25, fluoroBenchmark: 10, rfPower: 40, leftSided: true,
    endpoints: [
      { id: 'terminated_rf', label: 'AT terminates during the mitral isthmus line' },
      { id: 'mi_block', label: 'Bidirectional mitral isthmus block (LAA pacing)' },
      { id: 'noninducible', label: 'No inducible macroreentry with burst' },
    ],
    quizzes: [
      { phase: 'maneuvers', q: 'CTI PPI–TCL 85 ms; distal and proximal CS PPI–TCL 12 and 15 ms. Diagnosis:', options: ['Typical flutter', 'Perimitral flutter', 'Roof flutter', 'Focal AT'], correct: 1, explain: 'Both sides of the MA are in the circuit.' },
      { phase: 'mapping', q: 'Activation covers ~95% of the TCL around the mitral annulus. Why is this important?', options: ['Confirms macroreentry around a central obstacle (MA)', 'Indicates focal AT', 'Mapping error', 'Means scar'], correct: 0, explain: 'Activation spanning the TCL around an obstacle = macroreentry.' },
      { phase: 'endpoint', q: 'After the MI line, LAA pacing produces CS activation proximal → distal. This indicates:', options: ['Conduction through the line', 'Block across the lateral mitral isthmus', 'Perimitral flutter restarted', 'Need to re-entrain'], correct: 1, explain: 'The wavefront must travel around the septum to reach the distal CS.' },
      { phase: 'ablation', q: 'The endocardial line does not block and the gap seems epicardial. Safest next step:', options: ['50 W in the CS for 60 s', 'Low-power CS ablation after LCx assessment, or vein of Marshall ethanol', 'Abandon the line', 'Ablate the LAA tip'], correct: 1, explain: 'Coronary risk in the CS requires assessment and low power.' },
    ],
    hints: {
      induction: ['The patient is already in AT.', 'Note the CS sequence (distal → proximal).', 'Proceed to entrainment.'],
      maneuvers: ['Entrain from the CTI first.', 'Then from the proximal and distal CS (ablation catheter at the MA).', 'Both CS sites ≤ 20 ms = perimitral.'],
      mapping: ['High-density LA map; WOI ~90% TCL.', 'Look around the MA for early-meets-late.', 'MI line shown on the shell.'],
      ablation: ['From the lateral MA to the LIPV antral lesion.', 'Contiguous, transmural lesions.', 'Ghost line shown.'],
      endpoint: ['Prove the line blocks.', 'Pace the LAA: CS should become proximal → distal.', 'Burst to confirm non-inducibility.'],
    },
    expert: ['CS distal → proximal (CW), TCL 260', 'CTI PPI–TCL long; CS sites ≤ 20 ms', 'Map ≥ 90% TCL around MA', 'MI line lateral MA → LIPV antrum', 'LAA pacing: CS prox → dist; non-inducible'],
  },
  // ------------------------------------------------------------------ 9
  {
    id: 'scar_vt', num: 9, title: 'Ischaemic scar VT (inferior LV isthmus)', tag: 'VT', level: 3, chamber: 'LV', mins: 45,
    patient: { age: 68, sex: 'M', summary: 'Inferior MI 10 years ago, LVEF 30%, ICD with 3 appropriate shocks in a month for monomorphic VT despite amiodarone.', history: 'No new ischaemia on angiography.', meds: 'Amiodarone, beta-blocker', labs: 'K 4.3, Mg 2.0, creatinine normal' },
    ecg: { baseline: ['Sinus 70 bpm, PR 190 ms', 'Inferior Q waves; QRS 120 ms (IVCD)'], tachy: ['Monomorphic VT 145 bpm (CL 415)', 'RBBB-like V1, superior axis (negative II, III, aVF)', 'Dominant R in V2–V4 (no precordial QS): basal inferior LV / inferoseptal exit'] },
    objectives: ['Substrate map: dense scar < 0.5 mV, border zone 0.5–1.5 mV', 'Entrainment classification of isthmus sites', 'Non-inducibility with full PES'],
    engine: { sinusCL: 850, ah: 110, hv: 60, mechanism: 'scarVT', hpsRetro: false, scarVT: { channelCV: 0.1 }, reentry: { tcl: 415 }, hemoBudget: 180, ablChamber: 'LV', tachyLabel: 'Monomorphic VT' },
    induction: { group: 'V', text: 'RVA drive 600, S2 280, S3 240 (down to ERP / 200 ms).', iso: false },
    maneuvers: ['entrain_isthmus', 'pace_map'],
    diagnosis: { options: ['Scar-related reentrant VT, inferior LV isthmus', 'Bundle branch reentry', 'Focal Purkinje VT', 'Epicardial VT'], correct: 0, explain: 'Monomorphic RBBB/superior-axis VT in a post-MI scar with mid-diastolic potentials and concealed entrainment with PPI–TCL ≤ 30 ms.' },
    target: { kind: 'vt', radius: 8, label: 'Central isthmus (channel between scar and mitral annulus)' },
    map: { group: 'V', ref: 'QRS', woi: [-300, 100], chamber: 'LV', min: 150 },
    rfBenchmark: 40, fluoroBenchmark: 15, rfPower: 45,
    endpoints: [
      { id: 'terminated_rf', label: 'VT terminates during RF at the isthmus' },
      { id: 'noninducible', label: 'Non-inducible with PES (S2–S3 to 200 ms)' },
    ],
    quizzes: [
      { phase: 'briefing', q: 'RBBB-like VT with superior axis after inferior MI suggests the exit is:', options: ['Anterior apical LV', 'Inferior basal LV / inferoseptal', 'RVOT', 'Lateral epicardium'], correct: 1, explain: 'RBBB = LV exit; superior axis = inferior wall exit.' },
      { phase: 'mapping', q: 'Bipolar voltage cut-offs for dense scar and border zone:', options: ['< 0.5 mV and 0.5–1.5 mV', '< 1.5 and 1.5–3 mV', '< 0.1 and 0.1–0.5 mV', '< 5 and 5–8.3 mV'], correct: 0, explain: 'Standard bipolar criteria (Marchlinski).' },
      { phase: 'maneuvers', q: 'Concealed fusion, PPI–TCL 15 ms, S-QRS/TCL 45%. The site is:', options: ['Exit', 'Central isthmus', 'Entry', 'Bystander'], correct: 1, explain: 'With concealed fusion and PPI–TCL ≤ 30 ms, S-QRS/TCL < 30% = exit, 30–50% = central isthmus, 50–70% = proximal (entry), > 70% = inner loop.' },
      { phase: 'maneuvers', q: 'Concealed fusion but PPI–TCL 70 ms. Most likely:', options: ['Exit site', 'Bystander (dead-end or adjacent)', 'Outer loop', 'Pacing artefact'], correct: 1, explain: 'Concealed fusion can occur at bystanders; PPI–TCL > 30 ms places the site outside the circuit (adjacent or dead-end bystander).' },
    ],
    hints: {
      induction: ['Programmed ventricular stimulation from the RVA.', 'Drive 600 ms with S2 280 and S3 240.', 'S1 600 / S2 280 / S3 240 induces the clinical VT.'],
      maneuvers: ['Entrain from the ablation catheter in the scar channel.', 'Concealed fusion + PPI–TCL ≤ 30 = in circuit.', 'Isthmus: S-QRS/TCL 30–50%.'],
      mapping: ['Substrate map in sinus first (voltage).', 'Find the channel of preserved voltage between scar and MA.', 'Target region pulses on the shell.'],
      ablation: ['Central isthmus first; VT should stop within 10 s.', 'Then close the channel to the annulus.', 'Ghost target shown.'],
      endpoint: ['Repeat PES with S2–S3.', 'Clinical and other monomorphic VTs must be non-inducible.', 'Re-map late potentials.'],
    },
    expert: ['Substrate map: inferior scar, channel at MA', 'PES S2 280 / S3 240 → VT CL 415', 'Isthmus entrainment PPI–TCL ≤ 30', 'RF 45 W at central isthmus → termination', 'Non-inducible with S2–S3'],
  },
  // ------------------------------------------------------------------ 10
  {
    id: 'rvot', num: 10, title: 'Idiopathic RVOT PVC / VT', tag: 'VT', level: 1, chamber: 'RV', mins: 25,
    patient: { age: 38, sex: 'F', summary: 'Frequent palpitations; Holter 22% PVC burden (single morphology) with NSVT runs.', history: 'Normal echo and cardiac MRI.', meds: 'Beta-blocker (symptoms persist)', labs: 'Normal' },
    ecg: { baseline: ['Sinus, normal intervals'], tachy: ['PVC: LBBB-like, inferior axis (tall II, III, aVF), negative aVL/aVR', 'Transition V4 (later than sinus V3), QRS 140 ms, positive lead I'] },
    objectives: ['Bring out PVCs (iso, lighten sedation)', 'Activation map the PVC (earliest −35 ms with QS)', 'Pace map and ablate the RVOT focus'],
    engine: { sinusCL: 850, ah: 80, hv: 45, mechanism: 'triggeredPVC', sedation: 'deep', focus: { pos: [4, -24, 4], chamber: 'RV', coupling: 440, cl: 360 }, ablChamber: 'RV', tachyLabel: 'RVOT VT', map: { group: 'V' } },
    induction: { group: 'V', text: 'Spontaneous PVCs — suppressed by deep sedation. Lighten sedation and give isoproterenol 2–4 µg/min; RV burst with iso gives NSVT.', iso: true, pvc: true },
    maneuvers: ['pace_map'],
    diagnosis: { options: ['Idiopathic RVOT PVC/VT (posteroseptal RVOT)', 'Aortic cusp (RCC/LCC) PVC', 'ARVC', 'LV summit PVC'], correct: 0, explain: 'LBBB inferior axis, transition V4, normal MRI and earliest RVOT activation with QS.' },
    target: { kind: 'focus', radius: 5, label: 'Posteroseptal RVOT ~1.5 cm below the pulmonary valve' },
    map: { group: 'V', ref: 'QRS', woi: [-120, 60], chamber: 'RV', min: 40 },
    rfBenchmark: 6, fluoroBenchmark: 5, rfPower: 35,
    endpoints: [
      { id: 'no_pvc_iso', label: 'No spontaneous or iso-inducible PVCs (observation on iso)' },
    ],
    quizzes: [
      { phase: 'briefing', q: 'LBBB inferior-axis PVC with transition at V4 (later than sinus) most likely originates from:', options: ['RVOT', 'LCC', 'Inferior LV', 'Mitral annulus'], correct: 0, explain: 'Late transition favours the RVOT.' },
      { phase: 'mapping', q: 'The best combined target for focal PVC ablation is:', options: ['Largest bipolar EGM', 'Earliest bipolar activation with QS unipolar and excellent pace map', 'Pace map only', 'Lowest voltage'], correct: 1, explain: 'Combine earliest activation, QS unipolar and pace map.' },
      { phase: 'induction', q: 'No PVCs appear under deep sedation. First step:', options: ['Abandon the case', 'Lighten sedation and give isoproterenol', 'Ablate empirically', 'Give lidocaine'], correct: 1, explain: 'Triggered RVOT activity is catecholamine-sensitive.' },
    ],
    hints: {
      induction: ['Sedation suppresses PVCs.', 'Lighten sedation and start iso 2–4 µg/min.', 'Iso 4 µg/min + light sedation: frequent PVCs.'],
      maneuvers: ['Look at the PVC morphology on the surface leads.', 'Compare with sinus transition.', 'Commit the diagnosis.'],
      mapping: ['Map the RVOT during PVCs with the QRS reference.', 'Earliest V should precede QRS by ≥ 20 ms with QS.', 'Target region pulses on the shell.'],
      ablation: ['Posteroseptal RVOT below the valve.', 'Free wall is thin: keep CF < 30 g.', 'Ghost target shown.'],
      endpoint: ['Observe on iso.', 'Burst RV pacing on iso.', 'No PVCs for the observation period.'],
    },
    expert: ['Light sedation + iso 4 µg/min', 'Activation map: earliest −35 ms posteroseptal RVOT, QS', 'Pace map 12/12', 'RF 35 W: PVCs vanish in 10–15 s', 'No PVCs on iso'],
  },
  // ------------------------------------------------------------------ 11
  {
    id: 'vf_storm', num: 11, title: 'VF / electrical storm (safety response)', tag: 'VT', level: 1, chamber: 'LV', mins: 20, mandatory: true,
    patient: { age: 61, sex: 'M', summary: 'Ischaemic cardiomyopathy (EF 25%); 8 ICD shocks in 24 h for polymorphic VT/VF, each triggered by a monomorphic PVC. ACS excluded.', history: 'Ischaemic CMP', meds: 'Bisoprolol (missed doses)', labs: 'K 3.2 (low), Mg 1.6 (low)' },
    ecg: { baseline: ['Sinus with frequent monomorphic PVCs'], tachy: ['Chaotic irregular baseline, no discrete QRS (VF)'] },
    objectives: ['Recognise VF and defibrillate (unsynchronised, max energy) within 30 s', 'Storm management checklist (electrolytes, sympathetic blockade, antiarrhythmics)', 'Map and ablate the Purkinje trigger'],
    engine: { sinusCL: 800, ah: 90, hv: 50, mechanism: 'storm', hpsRetro: false, labs: { K: 3.2, Mg: 1.6 }, autoVF: 22000, trigger: { pos: [28, -2, -48] }, ablChamber: 'LV', tachyLabel: 'VF', map: { group: 'V' } },
    induction: { group: 'V', text: 'VF starts spontaneously from a short-coupled PVC during the study. Defibrillate immediately.', iso: false, vf: true },
    maneuvers: ['storm_checklist'],
    diagnosis: { options: ['Electrical storm triggered by a Purkinje/border-zone PVC (hypokalaemia contributing)', 'Torsades de pointes from QT prolongation', 'Bundle branch reentry', 'Monomorphic scar VT'], correct: 0, explain: 'Short-coupled monomorphic trigger PVCs with a preceding Purkinje potential initiate VF.' },
    target: { kind: 'trigger', radius: 6, label: 'Purkinje trigger at the LV inferior border zone (Purkinje potential 30 ms pre-QRS)' },
    map: { group: 'V', ref: 'QRS', woi: [-120, 60], chamber: 'LV', min: 40 },
    rfBenchmark: 10, fluoroBenchmark: 15, rfPower: 40, rfAllowedEarly: true,
    endpoints: [
      { id: 'defib', label: 'Unsynchronised shock delivered within 30 s of VF onset' },
      { id: 'storm_checklist', label: 'Storm checklist: K ≥ 4, Mg ≥ 2, beta-blocker, amiodarone' },
      { id: 'trigger_ablated', label: 'Trigger PVC eliminated' },
    ],
    quizzes: [
      { phase: 'induction', q: 'VF during the procedure. Immediate action:', options: ['Unsynchronised shock at max energy', 'Synchronised cardioversion 100 J', 'Overdrive pacing', 'Adenosine'], correct: 0, explain: 'Shock first, then think.' },
      { phase: 'maneuvers', q: 'Which factor must be corrected first in storm?', options: ['Change the ablation catheter', 'Hypokalaemia/hypomagnesaemia and adrenergic drive', 'Increase iso', 'Stop amiodarone'], correct: 1, explain: 'Reversible drivers first.' },
      { phase: 'mapping', q: 'A sharp potential 30 ms before each trigger PVC near the LV inferior border zone is likely:', options: ['Far-field atrium', 'Purkinje potential — ablation target', 'Noise', 'His potential'], correct: 1, explain: 'Purkinje potentials preceding the trigger are the target.' },
    ],
    hints: {
      induction: ['Watch the rhythm strip closely.', 'If VF: SHOCK, unsynchronised, 200 J.', 'Press the DEFIB button (sync OFF) now.'],
      maneuvers: ['Complete the storm checklist.', 'Correct K and Mg, give beta-blocker and amiodarone.', 'Then commit the diagnosis.'],
      mapping: ['Map the trigger PVC with the QRS reference.', 'Look for a sharp Purkinje potential before the PVC.', 'Target region pulses on the shell.'],
      ablation: ['Earliest site with a Purkinje potential.', 'LV inferior border zone.', 'Ghost target shown.'],
      endpoint: ['No more trigger PVCs.', 'Observe for recurrence.', 'Finish the case.'],
    },
    expert: ['VF → unsynchronised 200 J within 10 s', 'Post-ROSC: echo, ACT, catheter review', 'K, Mg, beta-blocker, amiodarone, sedation', 'Map trigger PVC: Purkinje potential −30 ms', 'Ablate trigger; no recurrence'],
  },
];

export const SANDBOX_RHYTHMS = [
  { id: 'sinus', label: 'Sinus rhythm (dual AVN, no AP)', from: 'avnrt' },
  { id: 'avnrt', label: 'AVNRT substrate', from: 'avnrt' },
  { id: 'ort', label: 'Orthodromic AVRT (concealed LL AP)', from: 'ort_concealed' },
  { id: 'wpw', label: 'WPW left lateral', from: 'wpw_ll' },
  { id: 'afl', label: 'Typical atrial flutter (CCW)', from: 'cti_flutter' },
  { id: 'at', label: 'Focal AT (iso-dependent)', from: 'focal_at' },
  { id: 'af', label: 'AF / PV triggers', from: 'paf_pvi' },
  { id: 'vt', label: 'Scar VT substrate', from: 'scar_vt' },
  { id: 'pmf', label: 'Perimitral flutter', from: 'perimitral' },
  { id: 'rvot', label: 'RVOT PVCs', from: 'rvot' },
];

export function sandboxCase(rhythmId, chamber) {
  const r = SANDBOX_RHYTHMS.find((x) => x.id === rhythmId) || SANDBOX_RHYTHMS[0];
  const base = CASES.find((c) => c.id === r.from);
  const c = JSON.parse(JSON.stringify(base));
  c.id = 'sandbox'; c.title = 'Sandbox: ' + r.label; c.sandbox = true; c.level = 0;
  if (chamber) { c.engine.ablChamber = chamber; c.map.chamber = chamber; }
  c.quizzes = []; c.engine.autoVF = 0;
  return c;
}

// Steps of the enforced workflow (curriculum §2).
export const STEPS = [
  { id: 'briefing', label: 'Briefing', phase: 'P1' },
  { id: 'placement', label: 'Catheters', phase: 'P2' },
  { id: 'baseline', label: 'Baseline', phase: 'P3' },
  { id: 'induction', label: 'Induction', phase: 'P4' },
  { id: 'maneuvers', label: 'Diagnosis', phase: 'P5' },
  { id: 'mapping', label: 'Mapping', phase: 'P6' },
  { id: 'ablation', label: 'Ablation', phase: 'P7' },
  { id: 'endpoint', label: 'Endpoints', phase: 'P8' },
];
