// Arrhythmia mechanism controllers (research spec §4).
//
// AV-nodal and accessory-pathway tachycardias (AVNRT, AVRT/WPW) need no controller:
// they emerge from the pathway links in the engine. Macro-reentry on the mesh
// (flutter, perimitral flutter, scar VT) is *maintained* by the cellular automaton
// but *initiated* by rule-based unidirectional-block seeding when the stimulation
// protocol falls inside the research-spec induction window. Focal and triggered
// mechanisms (AT, RVOT, AF drivers, VF, storm trigger) are foci with rules.

import { seedRingReentry, seedVT, seedLine, precondition } from './scenario.js';
import { CHAMBER_INDEX, LANDMARKS_RAW as LR, PV_DEFS, vec } from './geometry.js';
import { TISSUE, hash01 } from './propagation.js';

const { sub, scl, add } = vec;

class BaseMech {
  constructor(sim, cfg) { this.sim = sim; this.cfg = cfg; this.type = cfg.mechanism || 'none'; this.vf = new VFController(sim); }
  tick(t) { this.vf.tick(t); this.tickHemo(t); }
  tickHemo(t) {
    const s = this.sim, st = s.status, h = s.hemo;
    let sbp = 120;
    if (this.vf.on) sbp = 0;
    else if (st.tachy) {
      const vcl = st.vCL || 800;
      sbp = vcl < 280 ? 70 : vcl < 340 ? 88 : vcl < 420 ? 100 : 112;
      if (this.isVT?.()) sbp = Math.max(55, 92 - (t - (st.tachyStart || t)) / 6000);
    }
    if (h.tamponade) sbp = Math.min(sbp, Math.max(45, 110 - h.effusion * 0.5));
    h.sbp += (sbp - h.sbp) * 0.02;
    h.dbp = h.sbp * 0.58;
    h.spo2 = this.vf.on ? Math.max(70, h.spo2 - 0.01) : Math.min(98, h.spo2 + 0.01);
    if (h.tamponade && !h.drained) h.effusion = Math.min(200, h.effusion + 0.004 * 10);
  }
  rhythmLabel() {
    if (this.vf.on) return 'VF';
    const st = this.sim.status;
    if (!st.tachy) return this.sim.engine.t - this.sim.lastStimT < 1200 ? 'Paced' : 'Sinus';
    return this.cfg.tachyLabel || 'Tachycardia';
  }
  // Is the case's clinical arrhythmia currently running?
  clinicalActive() { return this.sim.status.tachy; }
  onStimProtocol() {}
  onDrug() {}
  onShock(sync) {
    if (this.vf.on) { this.vf.stop(); return true; }
    return true;
  }
}

// --------------------------------------------------------------- VF controller
// Multiple wandering ventricular sources with heterogeneous CL and ERP produce chaotic,
// polymorphic activation (research spec §4.8).
class VFController {
  constructor(sim) {
    this.sim = sim; this.on = false; this.drivers = []; this.onsetT = 0;
  }
  start() {
    if (this.on) return;
    const s = this.sim, eng = s.engine, rng = s.rng;
    if (!this.drivers.length) {
      const vnodes = [];
      for (let n = 0; n < eng.nMesh; n++) if (eng.chamber[n] >= 2 && eng.tissue[n] === TISSUE.VENTRICLE) vnodes.push(n);
      for (let k = 0; k < 6; k++) {
        const n = vnodes[Math.floor(rng() * vnodes.length)];
        this.drivers.push(s.addFocus(n, { name: 'vf', cl: 150 + rng() * 60, jitter: 0.18, active: false }));
      }
    }
    for (const d of this.drivers) { d.cl = 150 + this.sim.rng() * 60; d.setActive(true, eng.t + this.sim.rng() * 100); }
    // shorten ventricular refractoriness during VF
    this._erpSave = eng.erpMulV; eng.erpMulV = 0.75;
    this.on = true; this.onsetT = s.t;
    s.logEvent('vf_onset');
    s.emit('vf', true);
  }
  stop() {
    if (!this.on) return;
    for (const d of this.drivers) d.setActive(false);
    this.sim.engine.erpMulV = this._erpSave ?? 1;
    this.on = false;
    this.sim.logEvent('vf_end', { dur: this.sim.t - this.onsetT });
    this.sim.emit('vf', false);
  }
  tick() {}
}

// --------------------------------------------------------------- ring reentry (flutter)
class RingReentryMech extends BaseMech {
  constructor(sim, cfg) {
    super(sim, cfg);
    const r = cfg.reentry;
    this.ring = r.ring; this.chamber = r.chamber; this.dir = r.dir; this.startDeg = r.startDeg;
    this.targetTCL = r.tcl;
    if (r.initial) sim.engine.addTimer(400, () => this.seed());
  }
  seed() {
    const s = this.sim, r = this.cfg.reentry;
    precondition(s.engine, [this.chamber], r.tcl || 250);
    const pathName = r.seedPath; // e.g. 'ctiPath' or 'miPath' (node paths built by the scenario)
    if (pathName && s.sys[pathName]) {
      // an ablation line across the isthmus prevents the circuit from re-forming
      const path = s.sys[pathName], eng = s.engine;
      const dead = path.filter((n) => eng.cv[n] <= 0 || eng.cvScale[n] < 0.2).length;
      if (dead / path.length > 0.25) { s.logEvent('reentry_blocked', { ring: this.ring }); return; }
      const pts = s.sys[pathName].map((n) => [s.engine.pos[3 * n], s.engine.pos[3 * n + 1], s.engine.pos[3 * n + 2]]);
      seedLine(s.engine, pts, r.behind, this.chamber, 2.6, r.seedDepth || 16, r.refrMs || 170);
    } else if (r.seedLine) seedLine(s.engine, r.seedLine, r.behind, this.chamber, 2.6, r.seedDepth || 16, r.refrMs || 170);
    else seedRingReentry(s.engine, s.sys, this.ring, this.startDeg, this.dir, this.chamber);
    s.logEvent('reentry_seeded', { ring: this.ring });
  }
  clinicalActive() {
    const st = this.sim.status;
    return st.tachy && st.aCL > 0 && st.aCL < 360;
  }
  onStimProtocol(info) {
    if (info.chamberGroup !== 'A') return;
    const crit = (info.kind === 'burst' && info.minCL <= (this.cfg.reentry.burstMax || 250)) ||
      (info.kind === 'extra' && info.minCoupling <= 220 && info.minCoupling >= 180);
    if (!crit) return;
    if (this.clinicalActive() || info.pre?.tachy) return; // pacing during flutter = entrainment, not induction
    // seed shortly after the last paced beat (unidirectional block in the isthmus)
    this.sim.engine.addTimer(this.sim.engine.t + 120, () => this.seed());
  }
}

// --------------------------------------------------------------- scar VT
class ScarVTMech extends BaseMech {
  constructor(sim, cfg) { super(sim, cfg); this.budgetMs = (cfg.hemoBudget || 180) * 1000; this.hypoWarned = 0; }
  isVT() { return this.sim.status.tachy && !this.vf.on; }
  seed() { seedVT(this.sim.engine, this.sim.sys); this.sim.logEvent('reentry_seeded', { ring: 'VT isthmus' }); }
  onStimProtocol(info) {
    if (info.chamberGroup !== 'V' || info.kind !== 'extra') return;
    const n = info.nExtra, c = info.minCoupling;
    const crit = (n >= 2 && c <= 260 && c >= 200) || (n >= 3 && c >= 200) || (n === 1 && c <= 250 && c >= 230 && this.sim.drugs.iso > 0);
    if (!crit || this.clinicalActive()) return;
    if (info.captureFail) return;
    this.sim.engine.addTimer(this.sim.engine.t + 480, () => this.seed());
  }
  tick(t) {
    super.tick(t);
    const st = this.sim.status;
    if (this.isVT() && st.tachyStart != null) {
      const dur = t - st.tachyStart;
      if (dur > this.budgetMs * 0.8 && this.hypoWarned === 0) { this.hypoWarned = 1; this.sim.emit('hemo', { level: 'warning', text: 'Patient hypotensive: terminate VT and switch to substrate mapping.' }); }
      if (dur > this.budgetMs && this.hypoWarned === 1) { this.hypoWarned = 2; this.sim.emit('hemo', { level: 'critical', id: 'vt-hypo', text: 'Hypotension (SBP < 70): terminate VT now (ATP / synchronized cardioversion 100-200 J).' }); this.hypoT = t; }
      if (this.hypoWarned === 2 && t - this.hypoT > 30000) { this.hypoWarned = 3; this.vf.start(); }
    } else if (!st.tachy) this.hypoWarned = 0;
  }
  rhythmLabel() {
    if (this.vf.on) return 'VF';
    if (this.sim.status.tachy) return 'Monomorphic VT';
    return super.rhythmLabel();
  }
}

// --------------------------------------------------------------- focal AT (automatic)
class FocalATMech extends BaseMech {
  constructor(sim, cfg) {
    super(sim, cfg);
    const f = cfg.focus;
    const ch = CHAMBER_INDEX[f.chamber || 'RA'];
    const eng = sim.engine;
    this.node = sim.heart.grid.nearest(f.pos, 60, (i) => eng.chamber[i] === ch && eng.cv[i] > 0);
    this.target = f.cl;
    this.focus = sim.addFocus(this.node, {
      name: 'AT', cl: f.cl, jitter: 0.015, active: false,
      clFn: (fo) => {
        if (this.coolDown) return this.target * (1 + 0.05 * (fo.beats - this.coolDownStart));
        return this.target + (f.warmStart - this.target) * Math.exp(-fo.beats / 4);
      },
      onFire: (t) => {
        if (this.coolDown && this.focus.beats - this.coolDownStart > 6) { this.focus.setActive(false); this.sim.logEvent('at_stop'); }
      },
    });
    sim.sys.targets.focus = this.node;
  }
  focusAlive() { return this.sim.engine.cv[this.node] * this.sim.engine.cvScale[this.node] > 0.05; }
  onDrug(drug, dose) {
    if (drug !== 'iso') return;
    if (dose >= (this.cfg.focus.isoThreshold ?? 2) && this.focusAlive()) {
      this.coolDown = false;
      if (!this.focus.active) { this.focus.beats = 0; this.sim.engine.addTimer(this.sim.engine.t + 3000, () => { if (this.sim.drugs.iso >= (this.cfg.focus.isoThreshold ?? 2) && this.focusAlive()) { this.focus.setActive(true); this.sim.logEvent('at_start'); } }); }
    } else if (this.focus.active) { this.coolDown = true; this.coolDownStart = this.focus.beats; }
  }
  onStimProtocol(info) {
    // automatic AT: not PES-inducible; burst on iso may provoke it if the focus is alive
    if (info.chamberGroup === 'A' && info.kind === 'burst' && this.sim.drugs.iso >= 1 && this.focusAlive() && !this.focus.active) {
      this.focus.beats = 0; this.coolDown = false; this.focus.setActive(true); this.sim.logEvent('at_start');
    }
  }
  tick(t) {
    super.tick(t);
    if (this.focus.active && !this.focusAlive()) { this.focus.setActive(false); this.sim.logEvent('at_stop', { cause: 'ablation' }); this.sim.emit('success', 'Atrial tachycardia terminated'); }
  }
  clinicalActive() { return this.focus.active && this.sim.status.tachy; }
  rhythmLabel() { return this.focus.active && this.sim.status.tachy ? 'Atrial tachycardia' : super.rhythmLabel(); }
}

// --------------------------------------------------------------- triggered PVC / RVOT VT
class TriggeredPVCMech extends BaseMech {
  constructor(sim, cfg) {
    super(sim, cfg);
    const f = cfg.focus, eng = sim.engine;
    const ch = CHAMBER_INDEX[f.chamber || 'RV'];
    this.node = sim.heart.grid.nearest(f.pos, 60, (i) => eng.chamber[i] === ch && eng.cv[i] > 0);
    sim.sys.targets.focus = this.node;
    this.pvcCount = 0; this.runLeft = 0; this.lastSinusV = -1e9; this.lastFire = -1e9;
    this.coupling = f.coupling || 440; this.runCL = f.cl || 360;
    sim.subscribers.push((n, t, src) => {
      if (n !== this.node || src === -3) return;
      if (t - this.lastFire < 600) return;
      // a conducted (sinus) beat reached the focus: maybe trigger a PVC
      if (!this.focusAlive()) return;
      const p = this.prob();
      if (this.sim.rng() < p) {
        const run = this.sim.rng() < p * 0.4 ? 3 + Math.floor(this.sim.rng() * 5) : 1;
        this.fire(t + this.coupling, run);
      }
    });
  }
  prob() {
    const d = this.sim.drugs;
    let p = d.sedation === 'deep' ? 0.01 : 0.12;
    if (d.iso >= 1) p += 0.12 * Math.min(d.iso, 4);
    if (d.betaBlocker) p *= 0.4;
    return Math.min(0.75, p);
  }
  fire(t, run) {
    this.sim.engine.addTimer(t, (tt) => {
      if (!this.focusAlive()) return;
      this.lastFire = tt;
      this.sim.engine.stimulate([this.node], tt, -3);
      this.pvcCount++;
      this.sim.logEvent('pvc', { run });
      if (run > 1) this.fire(tt + this.runCL * (1 + 0.03 * this.sim.rng.normal()), run - 1);
    });
  }
  focusAlive() { return this.sim.engine.cv[this.node] * this.sim.engine.cvScale[this.node] > 0.05; }
  onStimProtocol(info) {
    if (info.chamberGroup === 'V' && info.kind === 'burst' && this.sim.drugs.iso >= 2 && this.focusAlive()) {
      this.fire(this.sim.engine.t + this.runCL, 6 + Math.floor(this.sim.rng() * 10));
    }
  }
  clinicalActive() { return this.pvcCount > 0; }
  rhythmLabel() {
    if (this.vf.on) return 'VF';
    if (this.sim.status.tachy) return 'RVOT VT';
    return this.sim.engine.t - this.lastFire < 2000 ? 'Sinus + PVCs' : super.rhythmLabel();
  }
}

// --------------------------------------------------------------- AF (PV drivers)
class AFMech extends BaseMech {
  constructor(sim, cfg) {
    super(sim, cfg);
    const eng = sim.engine;
    this.drivers = [];
    this.afOn = false;
    for (const [name, d] of Object.entries(PV_DEFS)) {
      const p = add(d.a, scl(sub(d.b, d.a), 0.62));
      const n = sim.heart.grid.nearest(p, 40, (i) => eng.chamber[i] === CHAMBER_INDEX.LA && eng.tissue[i] === TISSUE.PV_SLEEVE);
      const cl = { LSPV: 125, LIPV: 150, RSPV: 140, RIPV: 165 }[name];
      this.drivers.push({ name, focus: sim.addFocus(n, { name: 'pv-' + name, cl, jitter: 0.12, active: false }) });
    }
    sim.sys.targets.pvDrivers = this.drivers.map((d) => d.focus.node);
    this.ectopicNext = 0;
  }
  startAF(cause) {
    if (this.afOn) return;
    this.afOn = true;
    for (const d of this.drivers) d.focus.setActive(true, this.sim.engine.t + this.sim.rng() * 150);
    this.sim.logEvent('af_onset', { cause });
  }
  stopAF(cause) {
    if (!this.afOn) return;
    this.afOn = false;
    for (const d of this.drivers) d.focus.setActive(false);
    this.sim.logEvent('af_end', { cause });
  }
  onStimProtocol(info) {
    if (info.chamberGroup === 'A' && info.kind === 'burst' && info.minCL <= 220) this.startAF('burst');
  }
  onShock() { this.stopAF('cardioversion'); return super.onShock(); }
  tick(t) {
    super.tick(t);
    // PV ectopy on isoproterenol (LSPV trigger) can start AF
    if (!this.afOn && this.sim.drugs.iso >= 4 && t > this.ectopicNext) {
      this.ectopicNext = t + 4000 + this.sim.rng() * 4000;
      const d = this.drivers[0];
      this.sim.engine.stimulate([d.focus.node], t, -3);
      this.sim.logEvent('pv_ectopy', { pv: d.name });
      if (this.sim.rng() < 0.5) this.sim.engine.addTimer(t + 400, () => this.startAF('pv_ectopy'));
    }
  }
  clinicalActive() { return this.afOn && this.sim.status.tachy; }
  rhythmLabel() {
    if (this.vf.on) return 'VF';
    if (this.afOn && this.sim.status.tachy) return 'Atrial fibrillation';
    if (this.afOn) return 'Sinus (isolated PV activity)';
    return super.rhythmLabel();
  }
}

// --------------------------------------------------------------- VF / storm
class StormMech extends BaseMech {
  constructor(sim, cfg) {
    super(sim, cfg);
    const eng = sim.engine;
    // Purkinje trigger: a virtual Purkinje node linked to an LV border-zone site with a
    // 30 ms delay; it carries a sharp Purkinje spike on nearby electrodes.
    const site = cfg.trigger?.pos || [28, -2, -48];
    const vNode = sim.heart.grid.nearest(site, 60, (i) => eng.chamber[i] === CHAMBER_INDEX.LV && eng.cv[i] > 0);
    const p = [eng.pos[3 * vNode], eng.pos[3 * vNode + 1], eng.pos[3 * vNode + 2]];
    this.pk = eng.addVirtual('PK', p, { erp: 200, spike: { amp: 0.4, w: 1.0, r: 7 } });
    this.pkLink = eng.addLink(this.pk, vNode, { delay: 30, kind: 'pk' });
    this.vNode = vNode;
    sim.sys.targets.focus = vNode;
    this.pvcs = 0; this.nextPVC = 6000;
    this.autoVF = cfg.autoVF ?? 20000; // VF starts this long after case begins (case 11A)
  }
  triggerAlive() { return this.pkLink.enabled && this.sim.engine.cv[this.vNode] * this.sim.engine.cvScale[this.vNode] > 0.05; }
  riskScore() {
    const L = this.sim.labs, d = this.sim.drugs;
    let r = 1;
    if (L.K < 4) r += 1; if (L.Mg < 2) r += 0.5;
    if (!d.betaBlocker) r += 0.7; if (!d.amiodarone) r += 0.5; if (d.lidocaine) r -= 0.3;
    if (d.sedation === 'deep') r -= 0.3;
    return Math.max(0.2, r);
  }
  tick(t) {
    super.tick(t);
    if (this.autoVF && t > this.autoVF && !this.vf.on && !this.vfTriggeredOnce) {
      this.vfTriggeredOnce = true; this.firePVC(t, true);
    }
    if (!this.vf.on && t > this.nextPVC && this.armed) {
      const r = this.riskScore();
      this.nextPVC = t + 9000 / r + this.sim.rng() * 4000;
      if (this.triggerAlive()) this.firePVC(t, this.sim.rng() < 0.12 * r);
    }
  }
  firePVC(t, causeVF) {
    if (!this.triggerAlive()) return;
    this.sim.engine.stimulate([this.pk], t, -3);
    this.pvcs++;
    this.sim.logEvent('pvc', { trigger: 'purkinje' });
    if (causeVF) this.sim.engine.addTimer(t + 250, () => this.vf.start());
  }
  onStimProtocol(info) {
    if (info.chamberGroup === 'V' && ((info.kind === 'extra' && info.minCoupling < 200) || (info.kind === 'burst' && info.minCL < 200))) {
      this.sim.engine.addTimer(this.sim.engine.t + 100, () => this.vf.start());
    }
  }
  clinicalActive() { return this.vf.on; }
}

class GenericVFMech extends BaseMech {
  onStimProtocol(info) {
    if (info.chamberGroup === 'V' && ((info.kind === 'extra' && info.nExtra >= 3 && info.minCoupling < 200) || (info.kind === 'burst' && info.minCL < 200))) {
      this.sim.engine.addTimer(this.sim.engine.t + 100, () => this.vf.start());
    }
  }
}

class NaturalMech extends BaseMech {
  // AVNRT / AVRT: the reentry lives in the pathway links; nothing to seed.
  clinicalActive() { return this.sim.status.tachy; }
  onStimProtocol(info) {
    if (info.chamberGroup === 'V' && ((info.kind === 'extra' && info.nExtra >= 3 && info.minCoupling < 190) || (info.kind === 'burst' && info.minCL < 190))) {
      if (this.sim.rng() < 0.3) this.sim.engine.addTimer(this.sim.engine.t + 100, () => this.vf.start());
    }
  }
}

export function createMechanism(sim, cfg) {
  switch (cfg.mechanism) {
    case 'ring': return new RingReentryMech(sim, cfg);
    case 'scarVT': return new ScarVTMech(sim, cfg);
    case 'focalAT': return new FocalATMech(sim, cfg);
    case 'triggeredPVC': return new TriggeredPVCMech(sim, cfg);
    case 'af': return new AFMech(sim, cfg);
    case 'storm': return new StormMech(sim, cfg);
    case 'vf': return new GenericVFMech(sim, cfg);
    default: return new NaturalMech(sim, cfg);
  }
}
