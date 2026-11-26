// Simulation wrapper: owns the engine and all sub-models (EGM, ECG, stimulator,
// ablation, catheters, mapping, mechanism). The UI talks to this object only.

import { buildHeart, CHAMBER_INDEX, LANDMARKS_RAW as LR, PV_DEFS } from './geometry.js';
import { buildScenario } from './scenario.js';
import { TISSUE, SRC } from './propagation.js';
import { createMechanism } from './mechanisms.js';
import { EGMSystem } from './egm.js';
import { createCatheters } from './catheters.js';
import { Stimulator } from './stimulator.js';
import { Ablation } from './ablation.js';
import { Mapping } from './mapping.js';

let heartCache = null;
export function getHeart() {
  if (!heartCache) heartCache = buildHeart(2.2);
  return heartCache;
}

// Simple seeded RNG (mulberry32)
export function makeRng(seed = 1234) {
  let a = seed >>> 0;
  const f = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.normal = () => { const u = Math.max(1e-9, f()), v = f(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  return f;
}

export class Focus {
  constructor(sim, node, opts) {
    this.sim = sim; this.node = node;
    this.cl = opts.cl; this.jitter = opts.jitter ?? 0.02;
    this.name = opts.name || 'focus';
    this.active = opts.active ?? true;
    this.clFn = opts.clFn || null; // dynamic CL (iso, warm-up)
    this.onFire = opts.onFire || null;
    this.timer = 0;
    this.beats = 0;
  }
  currentCL() {
    const base = this.clFn ? this.clFn(this) : this.cl;
    return base * (1 + this.sim.rng.normal() * this.jitter);
  }
  schedule(fromT) {
    const eng = this.sim.engine;
    if (this.timer) eng.cancelTimer(this.timer);
    this.timer = 0;
    if (!this.active) return;
    this.timer = eng.addTimer(fromT + this.currentCL(), (t) => this.fire(t));
  }
  fire(t) {
    this.timer = 0;
    if (!this.active) return;
    const eng = this.sim.engine;
    this.beats++;
    if (this.onFire) this.onFire(t);
    eng.stimulate([this.node], t, SRC.FOCUS);
    // provisional reschedule in case the stimulus did not capture
    this.schedule(t);
  }
  setActive(on, t) {
    this.active = on;
    if (on) this.schedule(t ?? this.sim.engine.t); else if (this.timer) { this.sim.engine.cancelTimer(this.timer); this.timer = 0; }
  }
}

export class Sim {
  constructor(caseDef, opts = {}) {
    this.caseDef = caseDef;
    this.cfg = caseDef.engine || {};
    this.rng = makeRng(opts.seed ?? 4242);
    this.heart = getHeart();
    const { engine, sys } = buildScenario(this.heart, this.cfg);
    this.engine = engine; this.sys = sys;
    this.t = 0;
    this.listeners = [];
    this.log = [];
    this.drugs = { iso: 0, adenosineUntil: -1, atropine: false, sedation: this.cfg.sedation || 'light', betaBlocker: false, amiodarone: false, lidocaine: false };
    this.labs = Object.assign({ K: 4.2, Mg: 2.0, ACT: 150 }, this.cfg.labs || {});
    this.hemo = { sbp: 120, dbp: 70, spo2: 98, effusion: 0, tamponade: false };
    this.focusByNode = new Map();
    this.foci = [];
    this.vMon = []; this.aMon = []; // recent atrial / ventricular beat times (reference nodes)
    this.lastStimT = -1e9;
    this.status = { rhythm: 'sinus', tachy: false, aCL: 0, vCL: 0 };
    this.beatLog = [];

    // reference nodes for rhythm monitoring
    const nearest = (p, ch) => this.heart.grid.nearest(p, 60, (i) => engine.chamber[i] === CHAMBER_INDEX[ch] && engine.cv[i] > 0);
    this.refNodes = {
      atrial: sys.nodes.HIS_A,
      atrialHRA: nearest(LR.HRA_CATH, 'RA'),
      ventricular: nearest(LR.RV_APEX, 'RV'),
      lv: nearest([30, -20, -50], 'LV'),
    };

    // sinus node
    const sinusCL = this.cfg.sinusCL || 800;
    this.sinus = this.addFocus(sys.nodes.SN, {
      name: 'sinus', cl: sinusCL, jitter: 0.02,
      clFn: () => sinusCL * (1 - Math.min(0.35, 0.08 * this.drugs.iso)),
    });

    engine.onActivate = (n, t, src, erp) => this._onActivate(n, t, src, erp);
    this.subscribers = []; // other models' onActivate hooks
    this.mech = createMechanism(this, this.cfg);
    const pos = (n) => [engine.pos[3 * n], engine.pos[3 * n + 1], engine.pos[3 * n + 2]];
    sys.nodesPos = { SP_ENTRY: pos(sys.nodes.SP_ENTRY), HIS_A: pos(sys.nodes.HIS_A), FP_ENTRY: pos(sys.nodes.FP_ENTRY) };
    if (sys.ap) { sys.nodesPos.AP_A = pos(sys.ap.aNode); sys.nodesPos.AP_V = pos(sys.ap.vNode); }
    if (this.mech.pk != null) { sys.pkLink = this.mech.pkLink; sys.nodesPos.PK = pos(this.mech.vNode); }
    this.egm = new EGMSystem(this);
    this.catheters = createCatheters(this);
    this.stim = new Stimulator(this);
    this.ablation = new Ablation(this);
    this.mapping = new Mapping(this);
    this.shocks = [];
    this.syncChannels();
    this.sinus.schedule(0);
  }

  // (Re)define EGM channels from catheter electrode positions.
  syncChannels() {
    for (const [id, c] of Object.entries(this.catheters)) {
      for (const ch of c.info.channels) {
        const p1 = c.placed && c.poles.length ? c.poles[ch.a] : null;
        const p2 = ch.b >= 0 && p1 ? c.poles[ch.b] : null;
        this.egm.setChannel(ch.id, ch.label, id, p1, p2);
      }
    }
    if (this.cfg.mechanism === 'af') this.setPVLoop(this.pvLoop || 'LSPV');
  }

  // Circular mapping catheter at a PV ostium (AF case)
  setPVLoop(pv) {
    this.pvLoop = pv;
    const d = PV_DEFS[pv];
    const a = [d.a[0] + (d.b[0] - d.a[0]) * 0.42, d.a[1] + (d.b[1] - d.a[1]) * 0.42, d.a[2] + (d.b[2] - d.a[2]) * 0.42];
    const off = [0, 0, d.r * 0.8];
    this.egm.setChannel('PV', 'PV loop', 'MAP', [a[0] + off[0], a[1] + off[1], a[2] + off[2]], [a[0] - off[0], a[1] - off[1], a[2] - off[2]]);
  }

  // Called every frame by the UI: updates ablation catheter contact/channels.
  updateABL() {
    const abl = this.catheters.ABL;
    const prev = abl.tip.slice();
    abl.update(this.t);
    const moved = Math.hypot(prev[0] - abl.tip[0], prev[1] - abl.tip[1], prev[2] - abl.tip[2]);
    if (moved > 0.4 || this._ablSynced !== abl.type) {
      this._ablSynced = abl.type;
      const ids = new Set();
      for (const ch of abl.info.channels) {
        const c = this.egm.setChannel(ch.id, ch.label, 'ABL', abl.poles[ch.a], ch.b >= 0 ? abl.poles[ch.b] : null);
        c.label = ch.label; c.hidden = false; ids.add(ch.id);
      }
      // extra bipoles of a multipolar catheter are hidden when the ablation catheter is back
      for (const id of ['MAP3', 'MAP4']) if (!ids.has(id) && this.egm.byId[id]) this.egm.byId[id].hidden = true;
    }
  }

  // External defibrillation / cardioversion.
  shock(energy = 200, sync = false) {
    const vf = this.mech.vf.on;
    const rec = { t: this.t, energy, sync, inVF: vf, vfDelay: vf ? (this.t - this.mech.vf.onsetT) / 1000 : null };
    this.shocks.push(rec);
    if (sync && vf) { rec.fired = false; this.logEvent('shock', rec); this.emit('alert', { level: 'warning', id: 'sync-vf', text: 'Synchronized mode: no R wave sensed in VF, the device will not fire. Switch to UNSYNCHRONIZED.' }); return rec; }
    rec.fired = true;
    if (!vf && !this.status.tachy) { rec.error = 'shock_without_indication'; }
    this.stim.stop(true);
    if (this.ablation.on) this.ablation.stop('shock');
    this.engine.shock(260);
    this.mech.onShock(sync);
    if (vf && this.rng() > (energy >= 150 ? 0.9 : 0.6)) {
      rec.success = false;
      this.engine.addTimer(this.t + 300, () => this.mech.vf.start());
    } else rec.success = true;
    this.logEvent('shock', rec);
    return rec;
  }

  addFocus(node, opts) {
    const f = new Focus(this, node, opts);
    this.foci.push(f);
    if (!this.focusByNode.has(node)) this.focusByNode.set(node, []);
    this.focusByNode.get(node).push(f);
    return f;
  }

  on(fn) { this.listeners.push(fn); }
  emit(type, data) { for (const fn of this.listeners) fn(type, data); }
  logEvent(type, data = {}) {
    const e = { t: this.t, type, ...data };
    this.log.push(e);
    this.emit('log', e);
    return e;
  }

  _onActivate(n, t, src, erp) {
    // focus reset: any activation of a focus node resets its timer (overdrive suppression)
    const fl = this.focusByNode.get(n);
    if (fl) for (const f of fl) if (f.active) f.schedule(t);
    if (n === this.refNodes.atrial) { this.aMon.push(t); if (this.aMon.length > 40) this.aMon.shift(); }
    if (n === this.refNodes.ventricular) { this.vMon.push(t); if (this.vMon.length > 40) this.vMon.shift(); }
    for (const s of this.subscribers) s(n, t, src, erp);
  }

  // Advance simulated time by dt ms.
  advance(dt) {
    const target = this.t + dt;
    // step in chunks so models with per-tick behaviour (ablation, mechanism) stay in sync
    while (this.t < target - 1e-9) {
      const step = Math.min(10, target - this.t);
      const tNext = this.t + step;
      for (const m of this.preStep || []) m(this.t, tNext);
      this.engine.advance(tNext);
      this.t = tNext;
      this.mech.tick?.(this.t);
      for (const m of this.postStep || []) m(this.t, step);
    }
    this._updateRhythm();
    this.egm.finalize();
  }

  _updateRhythm() {
    const cl = (arr) => {
      if (arr.length < 4) return 0;
      const d = [];
      for (let i = arr.length - 4; i < arr.length; i++) d.push(arr[i] - arr[i - 1]);
      d.sort((a, b) => a - b);
      return (d[1] + d[2]) / 2;
    };
    const t = this.t;
    const aRecent = this.aMon.length && t - this.aMon[this.aMon.length - 1] < 2500;
    const vRecent = this.vMon.length && t - this.vMon[this.vMon.length - 1] < 2500;
    this.status.aCL = aRecent ? cl(this.aMon) : 0;
    this.status.vCL = vRecent ? cl(this.vMon) : 0;
    const sinusCL = this.cfg.sinusCL || 800;
    const pacing = t - this.lastStimT < 1200;
    const fast = (x) => x > 0 && x < Math.min(560, 0.8 * sinusCL * (1 - Math.min(0.35, 0.08 * this.drugs.iso)));
    const tachy = !pacing && (fast(this.status.aCL) || fast(this.status.vCL));
    if (tachy && !this.status.tachy) { this.status.tachyStart = t; this.logEvent('tachy_onset', { aCL: this.status.aCL, vCL: this.status.vCL }); this.emit('rhythm', this.status); }
    if (!tachy && this.status.tachy && !pacing) { this.logEvent('tachy_end', { dur: t - (this.status.tachyStart || t) }); this.emit('rhythm', this.status); }
    this.status.tachy = tachy;
    this.status.sustained = tachy && t - (this.status.tachyStart || t) > 8000;
    this.status.rhythm = this.mech.rhythmLabel ? this.mech.rhythmLabel() : tachy ? 'tachycardia' : 'sinus';
  }

  // ------------------------------------------------------------ measurements
  // Truth intervals of the most recent conducted sinus-like beat (used to grade the
  // trainee's caliper measurements and to drive the briefing summary).
  measureBeat() {
    const eng = this.engine, his = this.sys.names.HIS;
    let tH = eng.lastAct[his];
    if (this.t - tH < 300) { const H = eng.H; let best = -1e9; for (let k = 0; k < H; k++) { const v = eng.hist[his * H + k]; if (v < tH - 1 && v > best) best = v; } tH = best; }
    if (tH < 0) return null;
    const A_his = eng.actInWindow(this.sys.nodes.HIS_A, tH - 400, tH);
    let pOn = Infinity, vOn = Infinity, vEnd = -Infinity, aEnd = -Infinity;
    for (let n = 0; n < eng.nMesh; n++) {
      const ch = eng.chamber[n];
      if (ch <= 1) {
        const a = eng.firstActInWindow(n, tH - 400, tH + 40);
        if (a < pOn) pOn = a;
        const b = eng.actInWindow(n, tH - 400, tH + 40);
        if (b > aEnd) aEnd = b;
      } else if (eng.tissue[n] === TISSUE.VENTRICLE) {
        const a = eng.firstActInWindow(n, tH - 60, tH + 250);
        if (a < vOn) vOn = a;
        if (a > vEnd) vEnd = a;
      }
    }
    const sn = this.sys.nodes.SN;
    const hist = [];
    for (let k = 0; k < eng.H; k++) hist.push(eng.hist[sn * eng.H + k]);
    hist.sort((a, b) => b - a);
    const cl = hist[0] - hist[1];
    return {
      cl: Math.round(cl), pr: Math.round(vOn - pOn), ah: Math.round(tH - A_his), hv: Math.round(vOn - tH),
      qrs: Math.round(vEnd - vOn), p: Math.round(aEnd - pOn), qt: Math.round(vEnd - vOn + 300),
      tH, pOn, vOn,
    };
  }

  // ------------------------------------------------------------ drugs
  setIso(dose) {
    this.drugs.iso = dose;
    const fp = this.sys.pw.FP, sp = this.sys.pw.SP;
    const k = Math.min(1, dose / 3);
    for (const pw of [fp, sp, this.sys.pw.AP]) if (pw) { pw.erpMul = 1 - 0.15 * k; pw.delayMul = 1 - 0.1 * k; }
    this.engine.erpMulA = this.engine.erpMulV = 1 - 0.06 * k;
    this.logEvent('drug', { drug: 'isoproterenol', dose });
    this.mech.onDrug?.('iso', dose);
  }
  giveAdenosine(mg = 12) {
    const dur = 6000 + mg * 300;
    this.drugs.adenosineUntil = this.t + dur;
    const pws = [this.sys.pw.FP, this.sys.pw.SP].filter(Boolean);
    for (const pw of pws) pw.blocked = true;
    this.logEvent('drug', { drug: 'adenosine', dose: mg });
    this.engine.addTimer(this.t + dur, () => { for (const pw of pws) if (!pw.permBlock) pw.blocked = false; this.emit('info', 'Adenosine effect wearing off'); });
    this.mech.onDrug?.('adenosine', mg);
  }
}
