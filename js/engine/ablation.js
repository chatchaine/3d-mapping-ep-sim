// RF generator, lesion growth and safety model (research spec §5; curriculum §6).
//
// Lesions grow toward an asymptotic depth set by power and contact force
// (depth = Dinf (1 - e^{-t/tau}), Dinf = 0.16 P contactEff^0.6). Nodes inside the core
// become ABLATED_CORE when the lesion is transmural (depth >= wall); otherwise CV is
// scaled down so conduction survives deep. An oedema rim transiently halves CV and
// recovers after the "waiting period". Lesions therefore block conduction, terminate
// circuits and leave gaps when contiguity is poor.

import { TISSUE } from './propagation.js';
import { LANDMARKS_RAW as LR, PV_DEFS, vec } from './geometry.js';

const { sub, len, dot, scl, add } = vec;

const PHRENIC_PATH = [[-40, 14, 46], [-46, 10, 28], [-49, 8, 10], [-47, 6, -10], [-42, 6, -26]];
const PHRENIC_PATH_LA = [[2, 50, 40], [-2, 56, 30], [-2, 58, 18]];
const ESO_PATH = [[25, 62, 40], [25, 62, -20]];

function distPoly(p, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], ab = sub(b, a);
    let t = dot(sub(p, a), ab) / dot(ab, ab); t = Math.max(0, Math.min(1, t));
    best = Math.min(best, len(sub(p, add(a, scl(ab, t)))));
  }
  return best;
}

export class Ablation {
  constructor(sim) {
    this.sim = sim;
    this.power = sim.cfg.rfPower || 30; this.durationSet = 60; this.irrigated = true; this.mode = 'power';
    this.on = false; this.elapsed = 0; this.Z0 = 118; this.Z = 118; this.temp = 34; this.lqi = 0; this.lqiRaw = 0;
    this.lesions = []; this.current = null; this.rfCount = 0; this.totalRF = 0;
    this.eso = { base: 36.4, T: 36.4, max: 36.4 };
    this.edema = new Map(); // node -> original cvScale before oedema
    this.flags = { avBlock: null, phrenic: false, esoWarnT: null, popCount: 0 };
    this.warnings = {}; // id -> time raised (for "ignored > 2 s" scoring)
    this.junctional = null;
    this.blockReason = '';
    sim.postStep = sim.postStep || [];
    sim.postStep.push((t, dt) => this.tick(t, dt));
  }

  canStart() {
    const abl = this.sim.catheters.ABL;
    if (this.sim.rfGate) { const r = this.sim.rfGate(); if (r) return r; }
    if (this.lockUntil && this.sim.t < this.lockUntil) return 'Acknowledge the safety alert first';
    if (abl.cf < 3) return `No contact (CF ${abl.cf.toFixed(0)} g)`;
    return '';
  }

  start() {
    if (this.on) return true;
    const why = this.canStart();
    if (why) { this.blockReason = why; this.sim.emit('info', 'RF not delivered: ' + why); return false; }
    const abl = this.sim.catheters.ABL;
    this.on = true; this.elapsed = 0; this.lqiRaw = 0; this.cfSum = 0; this.cfN = 0;
    this.Z0 = 105 + Math.min(30, abl.cf) * 0.6 + this.sim.rng() * 6; this.Z = this.Z0; this.zMin = this.Z0;
    this.rfCount++;
    this._newLesion(abl.tip);
    if (abl.cf < 5) this.sim.emit('alert', { level: 'info', id: 'lowcf', text: `Low contact (${abl.cf.toFixed(0)} g): lesion likely ineffective` });
    this.sim.logEvent('rf_start', { n: this.rfCount, power: this.power, pos: abl.tip.map((v) => +v.toFixed(1)), cf: +abl.cf.toFixed(1), chamber: abl.chamber });
    this.sim.emit('rf', true);
    return true;
  }

  stop(reason = 'user') {
    if (!this.on) return;
    this.on = false;
    this.totalRF += this.elapsed;
    const L = this.current;
    if (L) {
      L.dur = this.elapsed; L.lqi = this.lqi; L.dZ = Math.round(this.Z0 - this.zMin);
      L.cf = this.cfN ? this.cfSum / this.cfN : 0;
      L.tier = this.elapsed < 3 ? null : tierOf(L.lqi, L.cf, this.elapsed);
      L.active = false;
      L.coolUntil = this.sim.t + 3000; // thermal latency
      // durability: a pathway blocked by this lesion stays blocked if the full lesion is adequate
      for (const k of ['AP', 'SP']) { const pw = this.sim.sys.pw[k]; if (pw && pw.blockLesion === L) pw.weak = L.lqi < (k === 'AP' ? 3 : 3.5); }
    }
    if (this.junctional) { this.junctional.setActive(false); this.junctional = null; }
    this.sim.logEvent('rf_stop', { reason, dur: +this.elapsed.toFixed(1), lqi: +this.lqi.toFixed(1), n: this.rfCount });
    for (const id of Object.keys(this.warnings)) delete this.warnings[id];
    this.sim.emit('rf', false);
  }

  _newLesion(pos) {
    const abl = this.sim.catheters.ABL;
    const L = { id: this.lesions.length + 1, pos: pos.slice(), node: abl.surfaceNode, chamber: abl.chamber, depth: 0, diam: 0, power: this.power, t0: this.sim.t, active: true, applied: new Set() };
    this.lesions.push(L); this.current = L;
    this.sim.emit('lesion', L);
    return L;
  }

  tick(t, dtMs) {
    const dt = dtMs / 1000;
    // oesophageal temperature relaxes toward baseline
    this.eso.T += (this.eso.base - this.eso.T) * (dt / 40);
    if (!this.on) {
      this.Z += (this.Z0 - this.Z) * dt * 0.5; this.popZ = (this.popZ || 0) * 0.9;
      this.temp += (32 - this.temp) * dt * 0.8;
      // thermal latency: lesions keep growing a little after RF off
      for (const L of this.lesions) if (L.coolUntil && t < L.coolUntil) { L.depth = Math.min(L.depthMax || L.depth, L.depth + 0.02); this._apply(L); }
      return;
    }
    const sim = this.sim, abl = sim.catheters.ABL;
    this.elapsed += dt;
    const cf = abl.cf, P = this.power;
    this.cfSum += cf; this.cfN++;
    const ce = Math.max(0, Math.min(1.4, (cf - 2) / 18));
    // catheter drift > 2 mm splits the lesion (gaps!)
    if (len(sub(abl.tip, this.current.pos)) > 2.5) {
      const old = this.current; old.active = false; old.dur = this.elapsed; old.tier = tierOf(this.lqi, cf, this.elapsed);
      this._newLesion(abl.tip); this.current.t0 = t;
    }
    const L = this.current;
    const tl = (t - L.t0) / 1000;
    const Dinf = 0.16 * P * Math.pow(ce, 0.6) * (this.irrigated ? 1 : 0.8);
    const tau = this.irrigated ? 9 : 7;
    L.depth = Math.max(L.depth, Dinf * (1 - Math.exp(-tl / tau)));
    L.depthMax = Dinf;
    L.diam = 1.4 * L.depth + (L.depth > 0.3 ? 2.5 : 0);
    // impedance, temperature, lesion quality index
    const dZmax = 0.3 * P * Math.sqrt(ce);
    this.Z = this.Z0 - dZmax * (1 - Math.exp(-this.elapsed / 5)) + sim.rng.normal() * 0.6 + (this.popZ || 0);
    this.zMin = Math.min(this.zMin, this.Z);
    this.temp = this.irrigated ? 30 + 0.25 * P * ce : Math.min(60, 37 + 0.6 * P * ce);
    this.lqiRaw += Math.pow(Math.max(cf, 0), 0.7) * P * dt;
    this.lqi = Math.min(10, this.lqiRaw * 8.4e-4);
    L.lqi = this.lqi; L.cf = this.cfN ? this.cfSum / this.cfN : cf; L.dur = this.elapsed; L.tier = tierOf(L.lqi, L.cf, this.elapsed);
    this._apply(L);
    this._safety(t, dt, P, cf, ce, L);
    if (this.elapsed >= this.durationSet) this.stop('duration');
  }

  // Apply lesion effects to tissue and conduction-system links.
  _apply(L) {
    const sim = this.sim, eng = sim.engine, heart = sim.heart;
    if (L.diam <= 0.5) return;
    const rc = L.diam / 2;
    heart.grid.query(L.pos, rc + 2, (n, d) => {
      if (eng.chamber[n] !== eng.chamber[L.node]) return;
      if (d <= rc) {
        const wall = eng.wall[n] || 3;
        if (L.depth >= wall) {
          if (eng.tissue[n] !== TISSUE.ABLATED_CORE) {
            eng.tissue[n] = TISSUE.ABLATED_CORE; eng.cv[n] = 0; eng.bip[n] = Math.min(eng.bip[n], 0.05 + 0.1 * sim.rng());
            this.edema.delete(n);
          }
        } else {
          const f = Math.max(0.1, 1 - L.depth / wall);
          if (eng.cvScale[n] > f) eng.cvScale[n] = f;
          eng.bip[n] = Math.min(eng.bip[n], eng.bip[n] * (1 - 0.8 * L.depth / wall) + 0.05);
        }
      } else if (L.depth > 1 && eng.tissue[n] !== TISSUE.ABLATED_CORE) {
        if (!this.edema.has(n)) this.edema.set(n, eng.cvScale[n]);
        eng.cvScale[n] = Math.min(eng.cvScale[n], 0.5);
      }
    });
    // conduction-system links
    const sys = sim.sys;
    const dist = (p) => len(sub(p, L.pos));
    if (sys.pw.SP && !sys.pw.SP.permBlock) {
      const dSP = dist(sys.nodesPos.SP_ENTRY);
      if (dSP <= rc + 3 && L.depth >= 2.5) { sys.pw.SP.blocked = sys.pw.SP.permBlock = true; sys.pw.SP.weak = this.lqi < 3.5; sys.pw.SP.blockLesion = L; sim.logEvent('sp_ablated', { lqi: this.lqi }); }
    }
    if (sys.ap && sys.pw.AP && !sys.pw.AP.permBlock) {
      const dAP = Math.min(dist(sys.ap.pos), dist(sys.nodesPos.AP_A), dist(sys.nodesPos.AP_V));
      if (dAP <= rc + 2 && L.depth >= sys.ap.depth && sim.t - L.t0 > 1500) {
        sys.pw.AP.blocked = sys.pw.AP.permBlock = true; sys.pw.AP.weak = this.lqi < 3; sys.pw.AP.blockLesion = L;
        sim.logEvent('ap_blocked', { t: (sim.t - L.t0) / 1000 });
        sim.emit('success', `Accessory pathway conduction lost at ${((sim.t - L.t0) / 1000).toFixed(1)} s`);
      }
    }
    if (sys.pkLink && sys.pkLink.enabled && dist(sys.nodesPos.PK) <= rc + 3 && L.depth > 2) { sys.pkLink.enabled = false; sim.logEvent('trigger_ablated'); }
  }

  _safety(t, dt, P, cf, ce, L) {
    const sim = this.sim, sys = sim.sys, abl = sim.catheters.ABL;
    const tip = abl.tip;
    const warn = (id, level, text, autoStop = false) => {
      if (!this.warnings[id]) { this.warnings[id] = t; sim.emit('alert', { level, id, text }); sim.logEvent('warning', { id, level }); }
      if (autoStop) { this.stop('safety:' + id); this.lockUntil = sim.t + 3000; }
    };
    const ignored = (id, ms) => this.warnings[id] && t - this.warnings[id] > ms;
    // ---- AV block near the compact node / His
    const dHis = Math.min(len(sub(tip, sys.nodesPos.HIS_A)), len(sub(tip, LR.COMPACT_AVN)));
    if (abl.chamber === 'RA' || abl.chamber === 'RV' || abl.chamber === 'LV') {
      if (dHis < 12 && dHis >= 8) warn('his-near', 'warning', `His tag ${dHis.toFixed(0)} mm away: risk to AV conduction`);
      if (dHis < 8 && this.elapsed > 1) {
        warn('va-block', 'critical', 'STOP RF: rapid junctional rhythm with VA block. Risk of AV block.');
        if (ignored('va-block', 2000) && !this.flags.transientAVB) {
          this.flags.transientAVB = true; sys.pw.FP.delayMul = 1.6; sim.logEvent('complication', { id: 'transient_av_block' });
          sim.emit('alert', { level: 'critical', id: 'avb', text: 'AV BLOCK: PR prolongation / dropped beats during RF near His. RF stopped.' });
          this.stop('av_block'); this.lockUntil = sim.t + 3000;
        }
        if (dHis < Math.max(3, L.diam / 2) && L.depth > 2.5 && !this.flags.avBlock) this._completeHeartBlock();
      }
    }
    // ---- junctional rhythm during slow-pathway ablation (marker of effect)
    if (sys.pw.SP && !this.junctional && len(sub(tip, sys.nodesPos.SP_ENTRY)) < 7 && this.elapsed > 3 && dHis >= 8) {
      const jcl = 600 + sim.rng() * 300;
      this.junctional = sim.addFocus(sim.sys.names.HIS, { name: 'junctional', cl: jcl, jitter: 0.04, active: true });
      sim.logEvent('junctional_rhythm', { cl: Math.round(jcl), vaBlock: false });
      sim.emit('alert', { level: 'info', id: 'junc', text: `Accelerated junctional rhythm (CL ${Math.round(jcl)} ms, 1:1 VA): marker of slow-pathway heating` });
    }
    // ---- impedance rise / steam pop
    const rise = this.Z - this.zMin;
    if (rise > 10) warn('zrise', 'warning', `Impedance rising (+${rise.toFixed(0)} Ω): risk of coagulum`);
    if (rise > 20) warn('zcrit', 'critical', 'Impedance rise > 20 Ω: RF stopped automatically', true);
    const popX = (P * ce * this.elapsed) / 1000 - 3.5;
    const popP = (1 / (1 + Math.exp(-popX * 2))) * 0.02 * dt * 10 + (cf > 40 && P > 45 ? 0.03 * dt : 0) + (this.Z0 - this.Z > 20 ? 0.02 * dt : 0);
    if (this.on && sim.rng() < popP) this._steamPop(cf);
    // ---- contact force
    if (cf > 40) { this.highCF = (this.highCF || 0) + dt; if (this.highCF > 2) warn('cf-high', 'warning', `Excessive contact force (${cf.toFixed(0)} g): perforation risk`); if (this.highCF > 5 && cf > 50 && !sim.hemo.tamponade && sim.rng() < 0.02) this._tamponade('perforation'); } else this.highCF = 0;
    // ---- phrenic nerve
    const dPh = Math.min(distPoly(tip, PHRENIC_PATH), abl.chamber === 'LA' ? distPoly(tip, PHRENIC_PATH_LA) : 99);
    if (dPh < 10 && (abl.chamber === 'RA' || abl.chamber === 'LA')) {
      warn('phrenic', 'warning', 'Ablating near the phrenic nerve course: check for diaphragmatic capture');
      if (this.elapsed > 6 && !this.flags.phrenic && dPh < 7) { this.flags.phrenic = true; sim.logEvent('complication', { id: 'phrenic_palsy' }); sim.emit('alert', { level: 'critical', id: 'phrenic-palsy', text: 'Loss of diaphragmatic motion: phrenic nerve injury. Stop RF.' }); this.stop('phrenic'); }
    }
    // ---- sinus node
    if (len(sub(tip, sim.engine.pos.subarray(3 * sys.nodes.SN, 3 * sys.nodes.SN + 3))) < 10) warn('sn', 'warning', 'Proximity to sinus node');
    // ---- oesophagus (LA posterior wall)
    if (abl.chamber === 'LA') {
      const dE = distPoly(tip, ESO_PATH);
      if (dE < 16) this.eso.T += (P * ce * 0.012 * dt) / Math.max(1, (dE - 4) * 0.35); // ~0.2 °C/s at 30 W directly over the oesophagus
      this.eso.max = Math.max(this.eso.max, this.eso.T);
      if (this.eso.T > 39 || this.eso.T - this.eso.base > 1.5) { warn('eso', 'warning', `Esophageal temperature ${this.eso.T.toFixed(1)} °C: stop RF, allow cool-down, reduce power here`); this.flags.esoWarnT = this.flags.esoWarnT ?? t; }
      if ((this.eso.T > 41 || ignored('eso', 5000)) && !this.flags.esoInjury) { this.flags.esoInjury = true; sim.logEvent('complication', { id: 'esophageal' }); sim.emit('alert', { level: 'critical', id: 'eso-crit', text: 'Esophageal temperature > 41 °C / RF continued after warning: risk of atrioesophageal fistula' }); this.stop('esophagus'); }
      // PV stenosis: lesion deep inside a vein
      for (const d of Object.values(PV_DEFS)) {
        const ab = sub(d.b, d.a); const tt = dot(sub(tip, d.a), ab) / dot(ab, ab);
        if (tt > 0.45 && len(sub(sub(tip, d.a), scl(ab, tt))) < d.r + 3) warn('pvs', 'warning', 'Lesion inside vein: PV stenosis risk');
      }
    }
  }

  _completeHeartBlock() {
    const sim = this.sim, sys = sim.sys;
    this.flags.avBlock = 'permanent';
    for (const pw of [sys.pw.FP, sys.pw.SP]) if (pw) { pw.blocked = pw.permBlock = true; }
    // ventricular escape rhythm
    const rv = sim.refNodes.ventricular;
    sim.addFocus(rv, { name: 'escape', cl: 1500, jitter: 0.03 }).schedule(sim.engine.t);
    sim.logEvent('complication', { id: 'complete_heart_block' });
    sim.emit('alert', { level: 'critical', id: 'chb', text: 'COMPLETE HEART BLOCK: compact AV node ablated. Pace the ventricle.' });
    this.stop('chb'); this.lockUntil = sim.t + 3000;
  }

  _steamPop(cf) {
    const sim = this.sim;
    this.flags.popCount++;
    this.popZ = 25;
    sim.logEvent('complication', { id: 'steam_pop' });
    sim.emit('alert', { level: 'critical', id: 'pop', text: 'STEAM POP: tissue overheating. Check for pericardial effusion.', pop: true });
    this.stop('steam_pop'); this.lockUntil = sim.t + 3000;
    if (cf > 30 || sim.rng() < 0.4) this._tamponade('steam pop');
  }

  _tamponade(cause) {
    const sim = this.sim;
    if (sim.hemo.tamponade) return;
    sim.hemo.tamponade = true; sim.hemo.drained = false; sim.hemo.tamponadeT = sim.t;
    sim.logEvent('complication', { id: 'tamponade', cause });
    sim.engine.addTimer(sim.t + 40000, () => { if (sim.hemo.tamponade && !sim.hemo.drained) sim.emit('alert', { level: 'critical', id: 'tamp', text: 'Falling blood pressure with rising heart rate: suspect tamponade (echo, pericardiocentesis)' }); });
  }

  // High-output pacing from the ablation catheter: diaphragmatic capture check.
  checkPhrenicPacing(site) {
    const sim = this.sim;
    if (!site || site.cath !== 'ABL') return;
    const tip = sim.catheters.ABL.tip;
    const d = Math.min(distPoly(tip, PHRENIC_PATH), distPoly(tip, PHRENIC_PATH_LA));
    if (d < 8 && !this._phrenicTagged?.some((p) => len(sub(p, tip)) < 3)) {
      (this._phrenicTagged = this._phrenicTagged || []).push(tip.slice());
      sim.logEvent('phrenic_capture', { pos: tip.slice() });
      sim.emit('alert', { level: 'warning', id: 'phrenic-cap', text: 'Phrenic nerve capture at this site: avoid ablation here (site tagged).' });
      sim.emit('tag', { type: 'phrenic', pos: tip.slice() });
    } else if (d >= 8) sim.emit('info', 'High-output pacing: no diaphragmatic capture at this site');
  }

  // Waiting period: oedema resolves; weak lesions on pathways recover (acute reconnection).
  wait(minutes = 20) {
    const sim = this.sim, eng = sim.engine;
    let rec = 0;
    for (const [n, orig] of this.edema) { if (eng.tissue[n] !== TISSUE.ABLATED_CORE) { eng.cvScale[n] = Math.max(eng.cvScale[n], orig); rec++; } }
    this.edema.clear();
    for (const k of ['AP', 'SP']) {
      const pw = sim.sys.pw[k];
      if (pw && pw.permBlock && pw.weak) { pw.blocked = pw.permBlock = false; pw.weak = false; sim.logEvent('reconnection', { pathway: k }); sim.emit('alert', { level: 'warning', id: 'recon-' + k, text: `${k === 'AP' ? 'Accessory pathway' : 'Slow pathway'} conduction recovered after the waiting period` }); }
    }
    sim.logEvent('wait', { minutes, recovered: rec });
    return rec;
  }
}

export function tierOf(lqi, cf, dur) {
  if (cf > 40 || lqi > 7) return 'excess';
  if (lqi < 3.5 || dur < 10 || cf < 5) return 'weak';
  if (lqi < 5.5) return 'good';
  return 'strong';
}
