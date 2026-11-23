// Scripted smoke test driven through the application API (?autotest=<caseId>|all).
// For each case: open → place catheters → baseline → induce → maneuver + diagnosis →
// map (LAT) → RF at the case target → endpoint tests → debrief score.
// Prints one "RESULT {...}" console line per case and "AUTOTEST DONE" at the end.

import { CASES, sandboxCase } from './cases/cases.js';
import { PLACEMENT_SITES } from './engine/catheters.js';
import { closeAll } from './ui/modals.js';
import * as EPmod from './engine/endpoints.js';

const INDUCE = {
  avnrt: [['pace', { site: 'HRA', mode: 's1s2', s1: 600, s2: 290 }], ['wait', 6000]],
  ort_concealed: [['pace', { site: 'RVA', mode: 'fixed', s1: 290, beats: 12 }], ['wait', 5000]],
  wpw_ps: [['pace', { site: 'RVA', mode: 'fixed', s1: 290, beats: 12 }], ['wait', 5000]],
  wpw_ll: [['pace', { site: 'CS12', mode: 'burst', s1: 300, duration: 3000 }], ['wait', 4500]],
  focal_at: [['iso', 2], ['wait', 9000]],
  paf_pvi: [['pace', { site: 'CS12', mode: 'burst', s1: 200, duration: 3000 }], ['wait', 4500]],
  cti_flutter: [['wait', 2000]],
  perimitral: [['wait', 2000]],
  scar_vt: [['pace', { site: 'RVA', mode: 's1s2', s1: 600, s2: 280, s3: 240 }], ['wait', 10000]],
  rvot: [['sed', 'light'], ['iso', 4], ['wait', 10000]],
  vf_storm: [['vf'], ['storm']],
};
const SECS = { point: 30, line: 12, circles: 15 };

export async function runAutotest(app, which, q) {
  const ids = which === 'all' ? [...CASES.map((c) => c.id), 'sandbox'] : which.split(',');
  const results = [];
  for (const id of ids) {
    const t0 = performance.now();
    let r;
    try { r = await runOne(app, id, q.get('until')); } catch (err) { r = { case: id, pass: false, error: String(err && err.stack || err).slice(0, 600) }; }
    r.wallMs = Math.round(performance.now() - t0);
    results.push(r);
    console.log('RESULT ' + JSON.stringify(r));
    await tick();
  }
  console.log('AUTOTEST DONE ' + JSON.stringify(results.map((r) => [r.case, r.pass ? 'PASS' : 'FAIL', r.score])));
  if (q.get('stay') !== '1' && which !== 'all') { /* keep the debrief on screen for screenshots */ }
  window.__autotest = results;
}

const tick = () => new Promise((res) => setTimeout(res, 0));

async function runOne(app, id, until) {
  const c = id === 'sandbox' ? sandboxCase('avnrt') : CASES.find((x) => x.id === id);
  if (!c) throw new Error('unknown case ' + id);
  app.autotestBusy = true;
  app.startCase(c);
  const sim = app.sim, wf = app.wf, out = { case: id, gates: {} };
  wf.rec.briefingRead = true; for (const qz of wf.pendingQuizzes('briefing')) wf.answerQuiz(qz, qz.correct);
  closeAll(); closeAll(); app.paused = false;
  const adv = (ms) => { const end = sim.t + ms; while (sim.t < end) { sim.advance(Math.min(100, end - sim.t)); sim.updateABL(); } };
  const answerAll = (phase) => { for (const qz of wf.pendingQuizzes(phase)) wf.answerQuiz(qz, qz.correct); };
  const next = () => { const g = wf.canAdvance(); out.gates[wf.step.id] = g.ok ? 'ok' : 'blocked: ' + g.why; answerAll(wf.step.id); if (!c.sandbox) wf.advance(); app.panels.renderWorkflow(); return g.ok; };

  if (!c.sandbox) {
    // P1 briefing
    if (wf.step.id === 'briefing') next(); else out.gates.briefing = 'ok';
    // P2 placement (one wrong attempt on the CS first, to exercise the wrong-EGM path)
    app.placeCatheter('CS', 'rv');
    for (const k of ['HRA', 'HIS', 'CS', 'RVA']) app.placeCatheter(k, PLACEMENT_SITES[k].find((s) => s.ok).id);
    adv(2500); next();
    // P3 baseline: emulate caliper measurements of the last sinus beat
    const b = sim.measureBeat();
    wf.submitBaseline(b ? { cl: b.cl, pr: b.pr, qrs: b.qrs, ah: b.ah, hv: b.hv } : {});
    next();
  } else adv(2500);
  // P4 induction
  for (const [act, arg] of INDUCE[c.sandbox ? 'avnrt' : id]) {
    if (act === 'pace') { sim.stim.start(arg); adv(sim.stim.active ? sim.stim.active.tEnd - sim.t + 50 : 0); }
    else if (act === 'wait') adv(arg);
    else if (act === 'iso') sim.setIso(arg);
    else if (act === 'sed') sim.drugs.sedation = arg;
    else if (act === 'vf') { let k = 0; while (!sim.mech.vf.on && k++ < 400) adv(100); out.vfAt = Math.round(sim.t); adv(2000); let n = 0; while (sim.mech.vf.on && n++ < 5) { app.defib(); adv(1500); } out.shocks = sim.shocks.length; }
    else if (act === 'storm') { sim.labs.K = 4.3; sim.labs.Mg = 2.2; sim.drugs.betaBlocker = true; sim.drugs.amiodarone = true; app.stormCheck(); adv(3000); }
  }
  if (c.induction.arrives && sim.mech.clinicalActive?.()) wf.rec.induced = true;
  if (!wf.rec.induced && (sim.mech.clinicalActive?.() || (c.induction.vf && wf._defibOK()))) wf.rec.induced = true;
  out.induced = wf.rec.induced; out.rhythm = sim.status.rhythm; out.cl = Math.round(Math.min(...[sim.status.aCL, sim.status.vCL].filter((x) => x > 0)));
  out.cs = ['CS910', 'CS78', 'CS56', 'CS34', 'CS12'].map((k) => sim.egm.lastLocal(k, 'A')).map((v, i, a) => Math.round(v - Math.min(...a))).join(',');
  if (!c.sandbox) next();
  // P5 maneuvers + diagnosis
  if (c.maneuvers[0] && !c.sandbox) { app.doManeuver(c.maneuvers[0]); adv(6500); }
  out.maneuver = app.panels.results.slice(-1)[0]?.text?.slice(0, 160);
  if (!c.sandbox) { wf.commitDiagnosis(c.diagnosis.correct); next(); }
  // P6 mapping
  const abl = sim.catheters.ABL;
  const chName = c.map.chamber; if (abl.chamber !== chName) app.setAblChamber(chName);
  const ch = sim.heart.chambers[{ RA: 0, LA: 1, RV: 2, LV: 3 }[chName]];
  const need = Math.max(c.map.min, 40);
  const annular = c.map.group === 'V' && (chName === 'RA' || chName === 'LA');
  const vCh = sim.heart.chambers[chName === 'RA' ? 2 : 3];
  const nearV = (n) => {
    const P = sim.heart.pos;
    for (let j = vCh.offset; j < vCh.offset + vCh.count; j += 2) {
      if (Math.hypot(P[3*n]-P[3*j], P[3*n+1]-P[3*j+1], P[3*n+2]-P[3*j+2]) < 10) return true;
    }
    return false;
  };
  let tries = 0;
  while (sim.mapping.points.length < need && tries++ < need * (annular ? 60 : 3)) {
    const n = ch.offset + Math.floor(sim.rng() * ch.count);
    if (sim.engine.tissue[n] === undefined) continue;
    // V-referenced map from an atrial chamber (WPW): sweep the AV annulus like a trainee would
    if (annular && !nearV(n)) continue;
    const p = [sim.heart.pos[3 * n], sim.heart.pos[3 * n + 1], sim.heart.pos[3 * n + 2]];
    abl.moveTo(p, 12); sim.updateABL();
    if (tries <= 3) { adv(600); app.acquire(false); } else { adv(120); app.acquire(true); }
  }
  const sm = sim.mapping.summary();
  out.points = sim.mapping.points.length; out.latPoints = sm.nLat; out.latSpan = sm.span;
  if (until === 'mapping') { app.autotestBusy = false; app.vp.setView('LAO'); out.pass = sm.nLat > 0; return out; }
  if (!c.sandbox) next();
  // P7 ablation at the target
  const tg = wf.target;
  if (abl.chamber !== tg.chamber) app.setAblChamber(tg.chamber);
  let sites = tg.kind === 'point' ? [tg.pos] : tg.sites;
  // PVI: up to two touch-up passes over the rings of veins that still conduct (gap finding)
  const pviPasses = tg.kind === 'circles' ? 3 : 1;
  sim.ablation.power = c.rfPower; sim.ablation.durationSet = 60;
  let blocked = 0;
  const wasTachy = sim.status.tachy || sim.mech.clinicalActive?.();
  const ablateSites = (list) => {
  for (const s of list) {
    // power is reduced only at the site that heated the oesophagus, not globally
    let tries = 0, done = false, power = c.rfPower;
    while (!done && tries++ < 3) {
      abl.moveTo(s, tries > 1 ? 20 : 15); sim.updateABL(); adv(200);
      sim.ablation.power = tries > 1 ? Math.min(power, 25) : power;
      app.toggleRF();
      if (!sim.ablation.on) { blocked++; break; }
      const end = sim.t + (tries > 1 ? Math.min(12, SECS[tg.kind]) : SECS[tg.kind]) * 1000;
      done = true;
      while (sim.t < end && sim.ablation.on) {
        adv(100);
        if (sim.ablation.warnings.eso || sim.ablation.warnings.zrise) {
          // operator response: stop, let the oesophagus cool, retry this site at lower power / shorter time
          sim.ablation.stop('operator'); power = Math.max(20, power - 5); done = false;
          let k = 0; while (sim.ablation.eso.T > sim.ablation.eso.base + 0.6 && k++ < 120) adv(1000);
          break;
        }
      }
      if (sim.ablation.on) app.toggleRF();
      if (sim.ablation.lockUntil > sim.t) adv(sim.ablation.lockUntil - sim.t + 100);
      adv(400);
    }
    if (tg.kind === 'point' && wf.targetAchieved()) break;
  }
  };
  // rings of veins that still conduct (gap finding / touch-up)
  const openRings = () => tg.rings.filter((r) => !EPmod.pvIsolated(sim, r.pv)).flatMap((r) => r.sites);
  for (let pass = 0; pass < pviPasses; pass++) {
    if (pass > 0) { sites = openRings(); if (!sites.length) break; }
    ablateSites(sites);
  }
  adv(4000);
  out.rf = sim.ablation.rfCount; out.rfBlocked = blocked;
  out.events = sim.log.filter((e) => ['tachy_onset', 'tachy_end', 'reentry_seeded', 'af_onset', 'at_stop', 'vf_onset', 'step'].includes(e.type) || (e.type === 'rf_start' && e.n === 1)).map((e) => e.type + (e.step ? ':' + e.step : '') + '@' + Math.round(e.t / 100) / 10).join(' ');
  out.targetAchieved = wf.targetAchieved();
  out.terminated = wasTachy ? !(sim.status.tachy || sim.mech.clinicalActive?.()) : null;
  if (!c.sandbox) next();
  // P8 endpoints
  out.endpoints = {};
  for (const e of c.endpoints) {
    let done = null;
    wf.runEndpoint(e.id, (r) => { done = r; });
    let k = 0; while (!done && k++ < 1200) adv(100);
    out.endpoints[e.id] = done ? (done.pass ? 'pass' : 'FAIL: ' + done.text.slice(0, 140)) : 'timeout';
    adv(1500);
  }
  // PVI: after the waiting period a trainee re-checks the veins and touches up reconnected gaps
  if (tg.kind === 'circles' && Object.values(out.endpoints).some((v) => v !== 'pass')) {
    out.touchUp = openRings().length;
    for (let pass = 0; pass < 2; pass++) { const left = openRings(); if (!left.length) break; ablateSites(left); }
    adv(3000);
    out.rf = sim.ablation.rfCount;
    for (const e of c.endpoints) {
      let done = null;
      wf.runEndpoint(e.id, (r) => { done = r; });
      let k = 0; while (!done && k++ < 1200) adv(100);
      out.endpoints[e.id] = done ? (done.pass ? 'pass' : 'FAIL: ' + done.text.slice(0, 140)) : 'timeout';
      adv(1500);
    }
  }
  // debrief
  const sc = app.finishCase();
  out.score = sc.total; out.grade = sc.grade;
  out.deductions = sc.deductions.map((d) => `${d.label} −${d.pts}`);
  out.debriefShown = !document.getElementById('screen-debrief').hidden;
  const epOK = Object.values(out.endpoints).every((v) => v === 'pass');
  out.pass = !!(out.induced && out.latPoints > 0 && out.targetAchieved && epOK && out.debriefShown && sc.total > 0);
  app.autotestBusy = false;
  return out;
}
