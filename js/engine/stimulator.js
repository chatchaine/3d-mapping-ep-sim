// Programmed stimulator (research spec §6): fixed S1 pacing, S1S2(S3S4) extrastimuli,
// burst and decremental pacing from any deployed electrode pair, plus computed
// maneuvers: entrainment (PPI - TCL), V-overdrive response (VAV / VAAV),
// His-refractory PVC and para-Hisian pacing. Nothing is pre-scripted: results are
// measured from the engine's activation times.

import { CHAMBER_INDEX } from './geometry.js';

export class Stimulator {
  constructor(sim) {
    this.sim = sim;
    this.active = null; // running protocol
    this.timers = [];
    this.results = [];
  }

  // Pacing sites available from the deployed catheters.
  sites() {
    const out = [];
    const cats = this.sim.catheters;
    for (const [id, c] of Object.entries(cats)) {
      if (!c.placed || !c.poles.length) continue;
      for (const ch of c.info.channels) {
        if (ch.b < 0) continue;
        out.push({ id: ch.id, label: ch.label, cath: id, pole: () => c.poles[ch.a] });
      }
    }
    return out;
  }

  // Nodes captured by a stimulus of `mA` from the given site.
  captureSet(siteId, mA) {
    const site = this.sites().find((s) => s.id === siteId);
    if (!site) return { nodes: [], group: null };
    const sim = this.sim, eng = sim.engine, heart = sim.heart;
    const p = site.pole();
    const r = 2.2 + 0.42 * mA;
    let group;
    if (site.cath === 'RVA') group = 'V';
    else if (site.cath === 'HIS') group = 'V';
    else if (site.cath === 'HRA' || site.cath === 'CS') group = 'A';
    else {
      const n = heart.grid.nearest(p, 30);
      group = n >= 0 && eng.chamber[n] >= 2 ? 'V' : 'A';
    }
    const nodes = [];
    heart.grid.query(p, r, (n) => {
      const ch = eng.chamber[n];
      if ((group === 'V') === (ch >= 2)) nodes.push(n);
    });
    if (!nodes.length) {
      // out of contact: capture only at high output with the nearest node of that group
      if (mA >= 8) {
        const n = heart.grid.nearest(p, 6, (i) => (group === 'V') === (eng.chamber[i] >= 2));
        if (n >= 0) nodes.push(n);
      }
    }
    // para-Hisian: high output from the His catheter also captures the His bundle
    if (site.cath === 'HIS' && mA >= 10) nodes.push(sim.sys.names.HIS);
    // ablation catheter in contact with the conduction system region
    if (site.cath === 'ABL' && mA >= 10 && sim.catheters.ABL.cf < 3) nodes.length = 0;
    return { nodes, group, site, r };
  }

  _pulse(t, siteId, mA, label) {
    const sim = this.sim;
    const cap = this.captureSet(siteId, mA);
    const n = sim.engine.stimulate(cap.nodes, t, -2);
    sim.egm.markStim(t, cap.group);
    sim.lastStimT = t;
    if (this.active) { this.active.pulses.push({ t, captured: n > 0, label }); if (n === 0) this.active.missed++; }
    // phrenic capture check (high output near the phrenic course)
    if (mA >= 10) sim.ablation?.checkPhrenicPacing(cap.site);
    sim.emit('stim', { t, label, captured: n > 0 });
    return n > 0;
  }

  // opts: {site, mode:'fixed'|'s1s2'|'burst'|'decremental', s1, s2, s3, s4, nDrive, mA, duration, minCL}
  start(opts) {
    this.stop(true);
    const sim = this.sim, eng = sim.engine;
    const o = Object.assign({ mode: 'fixed', s1: 600, nDrive: 8, mA: 5, duration: 6000, minCL: 250 }, opts);
    const cap = this.captureSet(o.site, o.mA);
    if (!cap.site) { sim.emit('info', 'Pacing site not available'); return false; }
    const pre = { aCL: sim.status.aCL, vCL: sim.status.vCL, tachy: sim.status.tachy, rhythm: sim.status.rhythm };
    this.active = { ...o, group: cap.group, pulses: [], missed: 0, t0: eng.t, pre };
    const t0 = eng.t + 20;
    const sched = [];
    if (o.mode === 's1s2') {
      for (let i = 0; i < o.nDrive; i++) sched.push([t0 + i * o.s1, 'S1']);
      let t = t0 + (o.nDrive - 1) * o.s1;
      for (const [k, v] of [['S2', o.s2], ['S3', o.s3], ['S4', o.s4]]) { if (!v) break; t += v; sched.push([t, k]); }
    } else if (o.mode === 'burst') {
      const n = Math.max(3, Math.round(o.duration / o.s1));
      for (let i = 0; i < n; i++) sched.push([t0 + i * o.s1, 'S1']);
    } else if (o.mode === 'decremental') {
      let t = t0, cl = o.s1;
      while (cl >= o.minCL && sched.length < 200) { for (let i = 0; i < 8; i++) { sched.push([t, 'S1']); t += cl; } cl -= 10; }
    } else if (o.mode === 'fixed') {
      const n = o.beats || 10000;
      for (let i = 0; i < Math.min(n, 2000); i++) sched.push([t0 + i * o.s1, 'S1']);
    }
    for (const [t, label] of sched) this.timers.push(eng.addTimer(t, (tt) => this._pulse(tt, o.site, o.mA, label)));
    const tEnd = sched[sched.length - 1][0];
    this.active.tEnd = tEnd;
    if (o.mode !== 'fixed' || o.beats) this.timers.push(eng.addTimer(tEnd + 5, () => this._finish()));
    sim.logEvent('pace_start', { site: o.site, mode: o.mode, s1: o.s1, s2: o.s2, s3: o.s3, s4: o.s4, mA: o.mA, iso: sim.drugs.iso });
    sim.emit('pacing', true);
    return true;
  }

  stop(silent = false) {
    for (const id of this.timers) this.sim.engine.cancelTimer(id);
    this.timers = [];
    if (this.active && !silent) this._finish();
    this.active = null;
    this.sim.emit('pacing', false);
  }

  isPacing() { return !!this.active; }

  _finish() {
    const a = this.active;
    if (!a) return;
    for (const id of this.timers) this.sim.engine.cancelTimer(id);
    this.timers = [];
    this.active = null;
    const sim = this.sim;
    const cls = a.pulses.slice(1).map((p, i) => p.t - a.pulses[i].t);
    const minCL = cls.length ? Math.min(...cls) : a.s1;
    const extras = a.pulses.filter((p) => p.label !== 'S1');
    const extraCouplings = extras.map((p) => p.t - a.pulses[a.pulses.indexOf(p) - 1].t);
    const kind = a.mode === 's1s2' ? 'extra' : minCL < 320 || a.mode === 'burst' || a.mode === 'decremental' ? 'burst' : 'fixed';
    const info = {
      kind, mode: a.mode, chamberGroup: a.group, site: a.site, minCL, nExtra: extras.length,
      minCoupling: extraCouplings.length ? Math.min(...extraCouplings) : minCL,
      captureFail: extras.some((p) => !p.captured), missed: a.missed, iso: sim.drugs.iso, pre: a.pre,
    };
    const lastT = a.pulses.length ? a.pulses[a.pulses.length - 1].t : sim.engine.t;
    sim.logEvent('pace_end', info);
    sim.mech.onStimProtocol(info);
    sim.emit('pacing', false);
    // post-pacing analysis once the return cycles are available
    sim.engine.addTimer(lastT + 1600, () => this._analyse(a, info, lastT));
  }

  _analyse(a, info, lastT) {
    const sim = this.sim, egm = sim.egm;
    const res = { t: sim.t, site: a.site, mode: a.mode, s1: a.s1, group: a.group, pre: a.pre, induced: false };
    // entrainment / overdrive during tachycardia
    if (a.pre.tachy && (a.mode === 'fixed' || a.mode === 'burst')) {
      const tcl = a.group === 'A' ? a.pre.aCL || a.pre.vCL : a.pre.vCL || a.pre.aCL;
      const siteGroup = a.group;
      const ppiAt = egm.firstLocalAfter(a.site, siteGroup, lastT + 8);
      res.tcl = Math.round(tcl);
      res.continues = sim.status.tachy;
      if (!isNaN(ppiAt)) { res.ppi = Math.round(ppiAt - lastT); res.ppiMinusTcl = Math.round(res.ppi - tcl); }
      // response after ventricular overdrive: sequence of the next chamber events
      if (a.group === 'V') {
        const aT = [], vT = [];
        const ach = sim.egm.byId.HISp ? 'HISp' : 'HRA';
        for (const t of sim.egm.byId[ach]?.actsA || []) if (t > lastT + 5) aT.push(t);
        for (const t of sim.egm.byId.RVA?.actsV || []) if (t > lastT + 30) vT.push(t);
        if (aT.length && vT.length) {
          const firstV = vT[0];
          const asBefore = aT.filter((t) => t < firstV).length;
          res.response = asBefore >= 2 ? 'V-A-A-V' : asBefore === 1 ? 'V-A-V' : 'V-V (no A)';
        }
        // stimulus-to-A during entrainment vs VA in tachycardia
        const lastA = (sim.egm.byId.HRA?.actsA || []).filter((t) => t > lastT - 400 && t < lastT + 300);
        if (lastA.length) res.sa = Math.round(lastA[lastA.length - 1] - (lastA[lastA.length - 1] > lastT ? lastT : a.pulses[a.pulses.length - 2]?.t ?? lastT));
      }
    }
    // induction outcome
    if (!a.pre.tachy && sim.status.tachy) res.induced = true;
    res.outcome = sim.status.tachy ? (a.pre.tachy ? 'tachycardia continues' : 'tachycardia induced') : (a.pre.tachy ? 'terminated' : 'no sustained arrhythmia');
    if (a.mode === 's1s2') res.ah = this.lastAH(lastT);
    this.results.push(res);
    sim.logEvent('pace_result', res);
    sim.emit('measure', res);
  }

  // AH of the beat after time t (from the His catheter A to the His spike)
  lastAH(t) {
    const sim = this.sim, eng = sim.engine;
    const h = eng.firstActInWindow(sim.sys.names.HIS, t, t + 600);
    const aT = eng.actInWindow(sim.sys.nodes.HIS_A, t - 50, h);
    return isNaN(h) || isNaN(aT) ? null : Math.round(h - aT);
  }

  // ---------------------------------------------------------------- maneuvers
  hisRefractoryPVC() {
    const sim = this.sim, eng = sim.engine;
    if (!sim.status.tachy) { sim.emit('info', 'His-refractory PVC requires a sustained SVT'); return null; }
    const his = sim.sys.names.HIS;
    const tcl = sim.status.vCL || sim.status.aCL;
    const nextHis = eng.lastAct[his] + tcl;
    const tStim = Math.max(eng.t + 20, nextHis - 10);
    const aArr = sim.egm.byId.HRA?.actsA || [];
    const lastA = aArr[aArr.length - 1];
    const expectedA = lastA + Math.ceil((tStim - lastA) / (sim.status.aCL || tcl)) * (sim.status.aCL || tcl);
    eng.addTimer(tStim, (t) => {
      // His is (about to be) activated: deliver a single RV stimulus
      const cap = this.captureSet('RVA', 5);
      eng.stimulate(cap.nodes, t, -2);
      sim.egm.markStim(t, 'V'); sim.lastStimT = t;
    });
    eng.addTimer(tStim + 1200, () => {
      const nextA = (sim.egm.byId.HRA?.actsA || []).find((t) => t > tStim - 40);
      const hisAct = eng.firstActInWindow(his, tStim - 60, tStim + 80);
      const res = { maneuver: 'his_refractory_pvc', tStim: Math.round(tStim) };
      res.hisRefractory = !isNaN(hisAct) && hisAct <= tStim + 30;
      if (!sim.status.tachy && (!nextA || nextA > expectedA + 60)) res.result = 'terminated without reaching the atrium';
      else if (nextA != null) {
        const d = Math.round(expectedA - nextA);
        res.advanceMs = d;
        res.result = d >= 10 ? `advanced the next A by ${d} ms` : d <= -10 ? `delayed the next A by ${-d} ms` : 'no change in the next A';
      }
      sim.logEvent('maneuver', res); sim.emit('measure', res);
    });
    return true;
  }

  // Para-Hisian pacing in sinus rhythm: alternate His+V capture (high output) and V-only
  // capture (low output) and compare stimulus-to-atrium times.
  paraHisian() {
    const sim = this.sim, eng = sim.engine;
    if (!sim.catheters.HIS.placed) { sim.emit('info', 'Place the His catheter first'); return null; }
    if (sim.status.tachy) { sim.emit('info', 'Para-Hisian pacing is performed in sinus rhythm'); return null; }
    const t0 = eng.t + 50, cl = 600;
    const rec = [];
    for (let i = 0; i < 8; i++) {
      const high = i % 2 === 0;
      const t = t0 + i * cl;
      eng.addTimer(t, (tt) => {
        const cap = this.captureSet('HISd', high ? 15 : 2.5);
        if (!high) { const h = sim.sys.names.HIS; const k = cap.nodes.indexOf(h); if (k >= 0) cap.nodes.splice(k, 1); }
        eng.stimulate(cap.nodes, tt, -2); sim.egm.markStim(tt, 'V'); sim.lastStimT = tt;
        rec.push({ t: tt, high });
      });
    }
    eng.addTimer(t0 + 8 * cl + 200, () => {
      const earliestA = (t) => {
        let best = Infinity;
        for (const id of ['HISp', 'CS910', 'CS12', 'HRA']) { const v = sim.egm.firstLocalAfter(id, 'A', t + 5); if (v < best && v < t + cl) best = v; }
        return best - t;
      };
      const sa = { high: [], low: [] };
      for (const r of rec) { const v = earliestA(r.t); if (isFinite(v)) sa[r.high ? 'high' : 'low'].push(v); }
      const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
      const res = { maneuver: 'para_hisian', saHisCapture: avg(sa.high), saVOnly: avg(sa.low) };
      if (res.saHisCapture != null && res.saVOnly != null) {
        res.deltaSA = res.saVOnly - res.saHisCapture;
        res.result = res.deltaSA > 20 ? `nodal response (SA +${res.deltaSA} ms when His capture is lost)` : `extranodal response (SA change ${res.deltaSA} ms): septal AP`;
      } else res.result = 'no VA conduction';
      sim.logEvent('maneuver', res); sim.emit('measure', res);
    });
    return true;
  }
}

export { CHAMBER_INDEX };
