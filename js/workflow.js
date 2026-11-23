// Enforced case workflow (curriculum §2): step gating, maneuvers, diagnosis commit,
// endpoint tests and the record used by the scoring rubric.

import { STEPS } from './cases/cases.js';
import * as EP from './engine/endpoints.js';
import { resolveTarget, distToTarget } from './engine/targets.js';
import { nodePos } from './engine/catheters.js';

const REQUIRED_CATHS = ['HRA', 'HIS', 'CS', 'RVA'];

export class Workflow {
  constructor(sim, caseDef) {
    this.sim = sim; this.c = caseDef;
    this.stepIdx = 0;
    this.sandbox = !!caseDef.sandbox;
    this.rec = {
      quiz: {}, // quiz key -> {correct, phase}
      placement: {}, baseline: null, induced: false, inductionProtocol: null,
      maneuvers: [], diagnosisAttempts: [], diagnosisCorrect: false, wrongTargetRF: 0,
      endpoints: {}, hints: 0, hintsByStep: {}, rfBeforeDx: 0, startWall: Date.now(), finished: false,
      surfaceClicks: 0,
    };
    this.listeners = [];
    this.target = resolveTarget(sim, caseDef);
    sim.rfGate = () => this.rfGate();
    sim.on((type, d) => this._onSim(type, d));
  }

  on(fn) { this.listeners.push(fn); }
  emit(type, d) { for (const f of this.listeners) f(type, d); }

  get step() { return STEPS[this.stepIdx]; }
  stepIndex(id) { return STEPS.findIndex((s) => s.id === id); }
  reached(id) { return this.sandbox || this.stepIdx >= this.stepIndex(id); }

  rfGate() {
    if (this.sandbox) return '';
    if (this.c.rfAllowedEarly) return '';
    if (!this.rec.diagnosisCorrect && this.rec.diagnosisAttempts.length === 0) return 'Commit a diagnosis before delivering RF';
    if (this.stepIdx < this.stepIndex('mapping')) return 'Proceed to mapping/ablation first';
    return '';
  }

  // Task checklist for each step with completion state.
  tasks(stepId = this.step.id) {
    const s = this.sim, r = this.rec, c = this.c;
    switch (stepId) {
      case 'briefing': return [{ text: 'Read the vignette and 12-lead ECG', done: this.stepIdx > 0 || !!this.rec.briefingRead }, { text: 'Answer the briefing quiz', done: this._phaseQuizzesDone('briefing') }];
      case 'placement': return REQUIRED_CATHS.map((id) => ({ text: `${s.catheters[id].info.name} catheter at its target`, done: !!(s.catheters[id].placed && s.catheters[id].correct) }));
      case 'baseline': return [{ text: 'Measure CL, PR, QRS, AH, HV with calipers and submit', done: !!r.baseline }];
      case 'induction': {
        const t = c.induction;
        if (t.vf) return [{ text: 'Recognise VF and deliver an unsynchronised shock', done: this._defibOK() }];
        if (t.pvc) return [{ text: 'Bring out the clinical PVCs (sedation / isoproterenol)', done: r.induced }];
        return [{ text: t.arrives ? 'Confirm the presenting tachycardia (rhythm, CL, CS sequence)' : 'Induce the clinical tachycardia', done: r.induced }];
      }
      case 'maneuvers': return [
        { text: 'Perform at least one decisive maneuver', done: r.maneuvers.length > 0 || c.maneuvers.length === 0 },
        { text: 'Commit the diagnosis', done: r.diagnosisAttempts.length > 0 },
      ];
      case 'mapping': {
        const n = s.mapping.points.length;
        return [{ text: `Acquire ≥ ${c.map.min} points (${n})`, done: n >= c.map.min }, { text: `Reference / WOI set (${s.mapping.settings.ref}, ${s.mapping.settings.woi.join('…')} ms)`, done: true }];
      }
      case 'ablation': return [{ text: 'Deliver RF at the target', done: this.targetAchieved() }];
      case 'endpoint': return c.endpoints.map((e) => ({ text: e.label, done: !!r.endpoints[e.id]?.pass, tested: !!r.endpoints[e.id], id: e.id }));
      default: return [];
    }
  }

  _phaseQuizzesDone(phase) { return this.c.quizzes.filter((q) => q.phase === phase).every((q) => this.rec.quiz[q.q]); }
  pendingQuizzes(phase) { return this.c.quizzes.filter((q) => q.phase === phase && !this.rec.quiz[q.q]); }

  canAdvance() {
    if (this.sandbox) return { ok: true };
    const id = this.step.id;
    if (id === 'endpoint') return { ok: false, why: 'Final step: finish the case' };
    if (id === 'ablation') return { ok: true }; // the case may proceed (or be abandoned)
    const tasks = this.tasks(id).filter((t) => !t.done);
    return tasks.length ? { ok: false, why: tasks[0].text } : { ok: true };
  }

  advance(force = false) {
    const g = this.canAdvance();
    if (!g.ok && !force) return g;
    if (this.stepIdx < STEPS.length - 1) {
      this.stepIdx++;
      this.sim.logEvent('step', { step: this.step.id });
      this.emit('step', this.step);
    }
    return { ok: true };
  }

  // ---------------------------------------------------------------- placement
  place(cathId, siteId) {
    const cat = this.sim.catheters[cathId];
    const ok = cat.place(siteId);
    this.sim.syncChannels();
    this.rec.placement[cathId] = { attempts: cat.attempts, correct: ok };
    this.sim.logEvent('placement', { cath: cathId, site: siteId, ok });
    return ok;
  }

  // ---------------------------------------------------------------- baseline
  submitBaseline(values) {
    const truth = this.sim.measureBeat();
    if (!truth) return null;
    const tol = { cl: 10, pr: 10, qrs: 10, ah: 5, hv: 5 };
    const res = {};
    for (const k of Object.keys(tol)) {
      const v = Number(values[k]);
      res[k] = { value: isFinite(v) && values[k] !== '' ? v : null, truth: truth[k], ok: isFinite(v) && values[k] !== '' && Math.abs(v - truth[k]) <= tol[k] };
    }
    this.rec.baseline = res;
    this.sim.logEvent('baseline', { ok: Object.values(res).filter((x) => x.ok).length });
    return res;
  }

  // ---------------------------------------------------------------- maneuvers
  maneuver(id, detail = {}) {
    this.rec.maneuvers.push({ id, t: this.sim.t, ...detail });
    this.sim.logEvent('maneuver', { id });
  }

  commitDiagnosis(idx) {
    const ok = idx === this.c.diagnosis.correct;
    this.rec.diagnosisAttempts.push(idx);
    if (ok) this.rec.diagnosisCorrect = true;
    this.sim.logEvent('diagnosis', { choice: idx, ok });
    return ok;
  }

  answerQuiz(q, idx) {
    if (this.rec.quiz[q.q]) return this.rec.quiz[q.q].correct;
    const ok = idx === q.correct;
    this.rec.quiz[q.q] = { correct: ok, phase: q.phase };
    this.sim.logEvent('quiz', { phase: q.phase, ok });
    return ok;
  }

  useHint() {
    const id = this.step.id;
    const tiers = this.c.hints?.[id] || [];
    const used = this.rec.hintsByStep[id] || 0;
    if (used >= tiers.length) return null;
    this.rec.hintsByStep[id] = used + 1; this.rec.hints++;
    this.sim.logEvent('hint', { step: id, tier: used + 1 });
    return { tier: used + 1, text: tiers[used], ghost: used + 1 >= 3 || (id === 'ablation' && used + 1 >= 3), max: tiers.length };
  }

  // ---------------------------------------------------------------- truth helpers
  _defibOK() {
    const s = this.sim;
    return s.shocks.some((x) => x.fired && x.inVF && x.success) || (s.shocks.some((x) => x.fired && x.inVF) && !s.mech.vf.on);
  }

  targetAchieved() {
    const s = this.sim, sys = s.sys, k = this.c.target.kind, has = (type) => s.log.some((e) => e.type === type);
    switch (k) {
      case 'sp': return !!sys.pw.SP?.permBlock;
      case 'ap': return !!sys.pw.AP?.permBlock;
      case 'focus': return this.c.engine.mechanism === 'triggeredPVC' ? !s.mech.focusAlive() : has('at_stop') && !this._focusAlive();
      case 'trigger': return has('trigger_ablated');
      case 'vt': return EP.lineBlocked ? this._vtCut() : false;
      case 'cti': return EP.lineBlocked(s.engine, sys.ctiPath, [-6, -3, -2]);
      case 'mi': return EP.lineBlocked(s.engine, sys.miPath, [0, 0, 1]);
      case 'pvi': return Object.keys(sys.regions.pv).every((pv) => EP.pvIsolated(s, pv));
      default: return false;
    }
  }
  _focusAlive() { const e = this.sim.engine, n = this.sim.sys.targets.focus; return e.cv[n] * e.cvScale[n] > 0.05; }
  _vtCut() {
    const e = this.sim.engine;
    const ch = [...this.sim.sys.channelAngle.entries()].filter(([, phi]) => Math.abs(phi) < 12).map(([n]) => n);
    return ch.length > 0 && ch.filter((n) => e.cv[n] * e.cvScale[n] < 0.2).length / ch.length > 0.5;
  }

  // ---------------------------------------------------------------- sim events
  _onSim(type, d) {
    const s = this.sim;
    if (type === 'measure' && d && d.ppi != null) this.maneuver('entrainment', { site: d.site, ppiMinusTcl: d.ppiMinusTcl, response: d.response });
    if (type !== 'log') return;
    const e = d;
    if (e.type === 'tachy_onset' || e.type === 'af_onset' || e.type === 'vf_onset' || e.type === 'pvc' || e.type === 'at_start') {
      if (this.stepIdx >= this.stepIndex('placement') && !this.rec.induced) {
        const clin = e.type === 'pvc' ? this.c.induction.pvc : e.type === 'vf_onset' ? this.c.induction.vf : true;
        if (clin && (e.type !== 'tachy_onset' || s.mech.clinicalActive?.() !== false || this.c.engine.mechanism === 'natural')) {
          this.rec.induced = true; this.rec.inductionProtocol = s.log.filter((x) => x.type === 'pace_start').slice(-1)[0] || { drug: s.drugs.iso };
          this.emit('induced', e);
        }
      }
    }
    if (e.type === 'rf_start') {
      const tip = s.catheters.ABL.tip;
      const dist = distToTarget(this.target, tip);
      const wrongChamber = this.target && s.catheters.ABL.chamber !== this.target.chamber;
      e.dTarget = dist;
      if (!this.sandbox && (wrongChamber || (dist > 25 && this.target.kind === 'point'))) { this.rec.wrongTargetRF++; }
      if (!this.rec.diagnosisCorrect && !this.c.rfAllowedEarly && !this.sandbox) this.rec.rfBeforeDx++;
    }
  }

  // ---------------------------------------------------------------- endpoints
  // Each test runs on the live model; `done(result)` receives {pass, text}.
  runEndpoint(id, done) {
    const s = this.sim, c = this.c, log = s.log;
    const finish = (pass, text, extra = {}) => { const r = { pass, text, t: s.t, ...extra }; this.rec.endpoints[id] = r; s.logEvent('endpoint', { id, pass }); done?.(r); this.emit('endpoint', { id, ...r }); };
    const rfWindows = () => { const w = []; let st = null; for (const e of log) { if (e.type === 'rf_start') st = e.t; if (e.type === 'rf_stop' && st != null) { w.push([st, e.t + 2600]); st = null; } } if (st != null) w.push([st, s.t]); return w; };
    switch (id) {
      case 'junctional_rf': { const ok = log.some((e) => e.type === 'junctional_rhythm'); return finish(ok, ok ? 'Accelerated junctional rhythm with 1:1 VA was seen during RF.' : 'No junctional rhythm was recorded during RF.'); }
      case 'terminated_rf': {
        const w = rfWindows();
        const ok = log.some((e) => (e.type === 'tachy_end' || e.type === 'at_stop') && w.some(([a, b]) => e.t >= a && e.t <= b + 2600));
        return finish(ok, ok ? 'Tachycardia terminated during RF delivery.' : 'No termination during RF was documented.');
      }
      case 'noninducible': case 'noninducible_iso': return this._inducibility(id === 'noninducible_iso', finish);
      case 'no_av_block': {
        const ok = !s.ablation.flags.avBlock && !s.ablation.flags.transientAVB;
        const b = s.measureBeat();
        return finish(ok, ok ? `AV conduction intact (AH ${b?.ah ?? '--'} ms, HV ${b?.hv ?? '--'} ms).` : 'AV conduction impaired after ablation.');
      }
      case 'ap_block': return this._vPaceTest(finish);
      case 'delta_gone': {
        s.advance(1);
        const b = s.measureBeat();
        const ok = b && b.hv >= 30 && !(s.sys.pw.AP && !s.sys.pw.AP.permBlock && s.sys.pw.AP.antero !== false && this.c.engine.ap?.antero);
        return finish(!!ok, b ? `Sinus beat: PR ${b.pr} ms, HV ${b.hv} ms, QRS ${b.qrs} ms → ${ok ? 'no pre-excitation' : 'pre-excitation persists'}.` : 'No conducted beat to analyse.');
      }
      case 'wait': {
        const i0 = log.length; // only reconnections from this waiting period count
        const rec = s.ablation.wait(20);
        const recon = log.slice(i0).filter((e) => e.type === 'reconnection').length;
        let ok = recon === 0 && this.targetAchieved();
        // PVI: name the veins that reconnected so the trainee knows where to touch up
        const tg = this.target;
        const openPVs = tg && tg.kind === 'circles' ? tg.rings.map((r) => r.pv).filter((pv) => !EP.pvIsolated(s, pv)) : [];
        const where = openPVs.length ? ` Reconnected: ${openPVs.join(', ')}.` : '';
        return finish(ok, `20-minute waiting period simulated (oedema resolved at ${rec} sites). ${ok ? 'Block persists.' : 'Conduction recovered or the target is not achieved — touch-up needed.'}${where}`);
      }
      case 'cti_block': return EP.ctiBlockTest(s, (r) => finish(r.pass, r.text));
      case 'mi_block': return EP.miBlockTest(s, (r) => finish(r.pass, r.text));
      case 'pv_block': return EP.pvBlockTest(s, (r) => finish(r.pass, r.text));
      case 'no_pvc_iso': {
        if (s.drugs.iso < 2) s.setIso(4);
        const n0 = s.mech.pvcCount || 0, t0 = s.t;
        const check = () => { const n = (s.mech.pvcCount || 0) - n0; finish(n === 0, `Observed ${(15).toFixed(0)} s on isoproterenol ${s.drugs.iso} µg/min: ${n} PVC(s).`); };
        s.engine.addTimer(t0 + 15000, check);
        return;
      }
      case 'defib': {
        const vfOn = log.find((e) => e.type === 'vf_onset');
        const sh = s.shocks.find((x) => x.fired && x.inVF);
        const ok = !!(sh && sh.vfDelay != null && sh.vfDelay <= 30);
        return finish(ok, sh ? `First unsynchronised shock ${sh.vfDelay.toFixed(1)} s after VF onset (${sh.energy} J).` : vfOn ? 'VF was not defibrillated.' : 'No VF episode recorded.');
      }
      case 'storm_checklist': {
        const L = s.labs, d = s.drugs;
        const ok = L.K >= 4 && L.Mg >= 2 && d.betaBlocker && d.amiodarone;
        return finish(ok, `K ${L.K.toFixed(1)}, Mg ${L.Mg.toFixed(1)}, beta-blocker ${d.betaBlocker ? 'given' : 'missing'}, amiodarone ${d.amiodarone ? 'given' : 'missing'}.`);
      }
      case 'trigger_ablated': { const ok = log.some((e) => e.type === 'trigger_ablated'); return finish(ok, ok ? 'Trigger PVC eliminated.' : 'Trigger site still active.'); }
      default: return finish(false, 'Unknown endpoint');
    }
  }

  // Re-run the case's induction protocol automatically and report the result.
  _inducibility(withIso, finish) {
    const s = this.sim, c = this.c;
    if (withIso) s.setIso(2);
    const g = c.induction.group;
    const protocols = g === 'V'
      ? [{ site: 'RVA', mode: 's1s2', s1: 600, s2: 280, s3: 240 }, { site: 'RVA', mode: 'burst', s1: 290, duration: 3000 }]
      : [{ site: 'HRA', mode: 's1s2', s1: 600, s2: 290 }, { site: 'CS12', mode: 'burst', s1: c.engine.mechanism === 'ring' ? 220 : 300, duration: 3000 }];
    if (c.engine.mechanism === 'af') protocols[1].s1 = 200;
    let induced = false;
    const run = (i) => {
      if (i >= protocols.length || induced) {
        if (withIso) s.engine.addTimer(s.t + 50, () => s.setIso(0));
        return finish(!induced, `${protocols.map((p) => `${p.site} ${p.mode} ${p.s1}${p.s2 ? '/' + p.s2 : ''}${p.s3 ? '/' + p.s3 : ''}`).join(', ')}${withIso ? ' on isoproterenol 2 µg/min' : ''}: ${induced ? 'tachycardia INDUCED' : 'non-inducible'}.`);
      }
      s.stim.start(protocols[i]);
      const tEnd = s.stim.active ? s.stim.active.tEnd : s.t;
      s.engine.addTimer(tEnd + 6000, () => {
        if (s.mech.clinicalActive?.() || (s.status.tachy && s.status.vCL < 500 && c.engine.mechanism === 'natural')) {
          induced = true;
        }
        run(i + 1);
      });
    };
    run(0);
  }

  _vPaceTest(finish) {
    const s = this.sim;
    s.stim.start({ site: 'RVA', mode: 'fixed', s1: 500, beats: 8 });
    const tEnd = s.stim.active.tEnd;
    s.engine.addTimer(tEnd + 300, () => {
      const ids = ['CS910', 'CS78', 'CS56', 'CS34', 'CS12', 'HISd'];
      const L = ids.map((id) => s.egm.lastLocal(id, 'A'));
      const ap = s.sys.pw.AP;
      const conc = !ap || ap.permBlock || ap.blocked;
      const earliest = ids[L.indexOf(Math.min(...L.filter(isFinite)))] || '—';
      finish(conc, `RV pacing 500 ms: earliest retrograde A at ${earliest.replace('HISd', 'His').replace('CS', 'CS ')} → ${conc ? 'concentric, nodal retrograde conduction (no AP)' : 'eccentric / non-decremental: AP still conducting'}.`);
    });
  }

  // Map-quality truth: earliest LAT point near the target?
  earliestNearTarget() {
    const sm = this.sim.mapping.summary();
    if (!sm.earliest || !this.target) return false;
    return distToTarget(this.target, sm.earliest.pos) <= Math.max(12, this.target.radius || 0 + 8);
  }

  targetPositions() { return this.target; }
  nodePos(n) { return nodePos(this.sim.heart, n); }
}
