// 100-point rubric with safety deductions (curriculum §7).

export const GRADE_BANDS = [
  { min: 85, label: 'Proficient' }, { min: 70, label: 'Competent' }, { min: 50, label: 'Needs review' }, { min: -1, label: 'Repeat required' },
];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function scoreCase(wf) {
  const sim = wf.sim, c = wf.c, r = wf.rec, log = sim.log;
  const rows = [];
  const add = (key, label, max, got, notes = []) => rows.push({ key, label, max, got: Math.round(clamp(got, 0, max) * 10) / 10, notes });

  // A. Pre-procedure & placement (8)
  {
    const bq = c.quizzes.filter((q) => q.phase === 'briefing');
    const qScore = bq.length ? (4 * bq.filter((q) => r.quiz[q.q]?.correct).length) / bq.length : 4;
    let p = 0; const notes = [];
    for (const id of ['HRA', 'HIS', 'CS', 'RVA']) {
      const cat = sim.catheters[id];
      if (cat.correct && cat.attempts === 1) p += 1;
      else if (cat.correct) { p += 0.5; notes.push(`${cat.info.name}: ${cat.attempts} attempts`); }
      if (cat.attempts > 2) p -= cat.attempts - 2;
    }
    add('A', 'Pre-procedure & catheter placement', 8, qScore + Math.max(0, p), notes);
  }
  // B. Baseline (7)
  {
    const b = r.baseline; let got = 0; const notes = [];
    if (b) for (const [k, v] of Object.entries(b)) { if (v.ok) got += 1.4; else notes.push(`${k.toUpperCase()} ${v.value ?? '—'} vs ${v.truth} ms`); }
    else notes.push('Not measured');
    add('B', 'Baseline measurements', 7, got, notes);
  }
  // C. Induction & maneuvers (15)
  {
    let got = r.induced ? 5 : 0; const notes = [];
    if (!r.induced) notes.push('Clinical arrhythmia not induced / confirmed');
    const mq = c.quizzes.filter((q) => q.phase === 'maneuvers' || q.phase === 'induction');
    const uniq = new Set(r.maneuvers.map((m) => m.id));
    const decisive = Math.min(uniq.size, 2) * 2.5;
    const interp = mq.length ? (5 * mq.filter((q) => r.quiz[q.q]?.correct).length) / mq.length : 5;
    got += c.maneuvers.length ? decisive + interp : 10;
    const extra = Math.max(0, r.maneuvers.length - Math.max(3, uniq.size + 3));
    if (extra) { got -= extra; notes.push(`${extra} repeated maneuver(s)`); }
    add('C', 'Induction & maneuvers', 15, got, notes);
  }
  // D. Diagnosis (20)
  {
    const a = r.diagnosisAttempts; const i = a.indexOf(c.diagnosis.correct);
    let got = i === 0 ? 20 : i === 1 ? 10 : 0; const notes = [];
    if (!a.length) notes.push('No diagnosis committed');
    else if (i !== 0) notes.push(i < 0 ? 'Correct diagnosis not reached' : `Correct on attempt ${i + 1}`);
    add('D', 'Diagnostic accuracy', 20, got, notes);
  }
  // E. Mapping (10)
  {
    const m = sim.mapping, n = m.points.length, notes = [];
    let got = 4 * Math.min(1, n / c.map.min);
    if (n < c.map.min) notes.push(`${n}/${c.map.min} points`);
    const s = m.settings;
    const refOk = s.ref === c.map.ref || (c.map.group === 'A' ? ['CS78', 'CS910', 'HRA'].includes(s.ref) : ['QRS', 'RVA'].includes(s.ref));
    const span = s.woi[1] - s.woi[0];
    const tcl = sim.status.tachy ? sim.status.aCL || sim.status.vCL : 0;
    const woiOk = tcl ? span >= 0.6 * tcl && span <= 1.1 * tcl : span >= 80;
    got += (refOk ? 1.5 : 0) + (woiOk || span === c.map.woi[1] - c.map.woi[0] ? 1.5 : 0);
    if (!refOk) notes.push('Reference channel not appropriate');
    const near = wf.earliestNearTarget();
    if (['cti', 'mi', 'pvi'].includes(c.target.kind)) { if (n >= c.map.min * 0.5) got += 3; else notes.push('Circuit not delineated'); }
    else if (near) got += 3; else notes.push('Earliest mapped site not at the target');
    add('E', 'Mapping quality', 10, got, notes);
  }
  // F. Ablation efficiency (15)
  {
    const n = sim.ablation.rfCount; const b = c.rfBenchmark; const notes = [`${n} RF applications (benchmark ${b})`];
    let got = 15;
    if (c.rfBenchmarkPer) got -= Math.max(0, Math.ceil((n - b) / c.rfBenchmarkPer));
    else got -= Math.max(0, n - b);
    if (n === 0) { got = 0; notes.push('No RF delivered'); }
    if (!wf.targetAchieved()) { got = Math.min(got, 5); notes.push('Target not achieved'); }
    add('F', 'Ablation efficiency', 15, got, notes);
  }
  // G. Procedure-time proxy (5): simulated minutes vs fluoro benchmark × 4 (3D-guided)
  {
    const mins = sim.t / 60000; const bench = (c.fluoroBenchmark || 5) * 4;
    let got = 5; if (mins > bench) got -= Math.ceil(((mins - bench) / bench) / 0.25);
    add('G', 'Procedure-time proxy', 5, got, [`${mins.toFixed(1)} simulated min (benchmark ${bench})`]);
  }
  // H. Endpoints (20)
  {
    const eps = c.endpoints; const notes = [];
    let met = 0;
    for (const e of eps) { const res = r.endpoints[e.id]; if (res?.pass) met++; else notes.push(`${e.label}: ${res ? 'failed' : 'not tested'}`); }
    add('H', 'Endpoint achievement', 20, (20 * met) / eps.length, notes);
  }

  // Safety deductions
  const ded = [];
  const comp = (id) => log.filter((e) => e.type === 'complication' && e.id === id).length;
  const warns = log.filter((e) => e.type === 'warning');
  // a warning is "ignored" when RF kept running > 2 s (critical) after it
  for (const w of warns) {
    const stop = log.find((e) => e.type === 'rf_stop' && e.t >= w.t);
    const dt = stop ? stop.t - w.t : sim.t - w.t;
    if (w.level === 'critical' && dt > 2000) ded.push({ label: `Red warning ignored (${w.id})`, pts: 10, major: true });
    else if (w.level === 'warning' && dt > 4000 && !['sn', 'his-near'].includes(w.id)) ded.push({ label: `Advisory ignored (${w.id})`, pts: 2 });
  }
  if (comp('transient_av_block')) ded.push({ label: 'Transient AV block', pts: 5, major: true });
  if (comp('complete_heart_block')) ded.push({ label: 'Permanent complete heart block', pts: 30, critical: true });
  if (comp('phrenic_palsy')) ded.push({ label: 'Phrenic palsy', pts: 15, major: true });
  if (comp('esophageal')) ded.push({ label: 'Esophageal thermal injury risk', pts: 15, major: true });
  if (comp('tamponade')) { ded.push({ label: 'Tamponade', pts: 10, major: true }); if (!sim.hemo.drained) ded.push({ label: 'Tamponade not treated', pts: 15, major: true }); }
  for (const s of sim.shocks) if (s.sync && s.inVF) ded.push({ label: 'Synchronised shock attempted in VF', pts: 5 });
  const vfEpisodes = log.filter((e) => e.type === 'vf_onset');
  for (const v of vfEpisodes) {
    const sh = sim.shocks.find((s) => s.fired && s.t >= v.t);
    const delay = sh ? (sh.t - v.t) / 1000 : (sim.t - v.t) / 1000;
    if (delay > 60) ded.push({ label: `VF defibrillation delay ${delay.toFixed(0)} s`, pts: 20, critical: true });
    else if (delay > 30) ded.push({ label: `VF defibrillation delay ${delay.toFixed(0)} s`, pts: 20, major: true });
  }
  if (r.rfBeforeDx) ded.push({ label: 'RF before diagnosis committed', pts: 5 });
  if (r.wrongTargetRF) ded.push({ label: `RF in the wrong chamber / far from target (${r.wrongTargetRF}×)`, pts: 10, major: true });
  const hintCost = c.level === 1 ? 0 : c.level === 2 ? 1 : 2;
  if (r.hints && hintCost) ded.push({ label: `${r.hints} hint(s) used`, pts: r.hints * hintCost });

  const domain = rows.reduce((a, x) => a + x.got, 0);
  const deduction = ded.reduce((a, x) => a + x.pts, 0);
  const total = Math.max(0, Math.round(domain - deduction));
  const critical = ded.some((d) => d.critical);
  const grade = critical ? 'Repeat required' : GRADE_BANDS.find((g) => total >= g.min).label;
  return { rows, deductions: ded, domain: Math.round(domain), total, grade, critical };
}
