// Catheter models: fixed diagnostic catheters (HRA, His, CS, RVA) placed at sites, and
// a steerable ablation catheter driven by deflection / torque / advance.
//
// The ablation catheter kinematics: a steerable sheath sits at the access point and can
// tilt its exit direction; the catheter shaft leaves it for `advance` mm, then a distal
// arc of length 28 mm bends by `deflect` (-1..1 -> ±180 deg, bidirectional) in the
// plane selected by the `rotate` torque angle. If the tip would leave the chamber the
// distal shaft flexes back onto the wall and the penetration depth is converted into
// contact force (with cardiac/respiratory jitter).

import { LANDMARKS_RAW as LR, CHAMBER_INDEX, CHAMBER_DEFS, makeChamberSDF, nearestInChamber, vec } from './geometry.js';

const { sub, add, scl, dot, len, norm, cross } = vec;

// Candidate placement sites per catheter. `ok` marks the correct target.
export const PLACEMENT_SITES = {
  HRA: [
    { id: 'hra', label: 'High lateral RA (SVC-RA junction)', pos: LR.HRA_CATH, chamber: 'RA', ok: true },
    { id: 'raa', label: 'RA appendage', pos: LR.RAA, chamber: 'RA' },
    { id: 'llra', label: 'Low lateral RA', pos: LR.LOW_LATERAL_RA, chamber: 'RA' },
  ],
  HIS: [
    { id: 'his', label: 'His bundle region (anterosuperior TA)', pos: LR.HIS, chamber: 'RA', ok: true },
    { id: 'midsep', label: 'Mid septum / CS os level', pos: LR.CS_OS, chamber: 'RA' },
    { id: 'rvin', label: 'Advanced into RV inflow', pos: [-10, -16, -24], chamber: 'RV' },
  ],
  CS: [
    { id: 'cs', label: 'Coronary sinus (proximal electrodes at the os)', ok: true, cs: true },
    { id: 'ivc', label: 'Low RA / not engaged (in front of the CS os)', pos: LR.CTI_MEDIAL, chamber: 'RA' },
    { id: 'rv', label: 'Prolapsed into the RV', pos: [-6, -26, -30], chamber: 'RV' },
  ],
  RVA: [
    { id: 'rva', label: 'RV apex', pos: LR.RV_APEX, chamber: 'RV', ok: true },
    { id: 'rvot', label: 'RV outflow tract', pos: LR.RVOT_FREE, chamber: 'RV' },
    { id: 'his', label: 'Basal septum (near His)', pos: [-8, -10, -16], chamber: 'RV' },
  ],
};

export const CATHETER_INFO = {
  HRA: { name: 'HRA', poles: 4, spacing: 5, color: '--c-cath-hra', channels: [{ id: 'HRA', label: 'HRA d', a: 0, b: 1 }] },
  HIS: { name: 'His', poles: 4, spacing: 3, color: '--c-cath-his', channels: [{ id: 'HISd', label: 'His d', a: 0, b: 1 }, { id: 'HISp', label: 'His p', a: 2, b: 3 }] },
  CS: {
    name: 'CS', poles: 10, spacing: 2, color: '--c-cath-cs',
    channels: [
      { id: 'CS910', label: 'CS 9-10', a: 8, b: 9 }, { id: 'CS78', label: 'CS 7-8', a: 6, b: 7 },
      { id: 'CS56', label: 'CS 5-6', a: 4, b: 5 }, { id: 'CS34', label: 'CS 3-4', a: 2, b: 3 }, { id: 'CS12', label: 'CS 1-2', a: 0, b: 1 },
    ],
  },
  RVA: { name: 'RVA', poles: 4, spacing: 5, color: '--c-cath-rva', channels: [{ id: 'RVA', label: 'RVA d', a: 0, b: 1 }] },
  ABL: { name: 'ABL', poles: 4, spacing: 2, color: '--c-cath-abl', channels: [{ id: 'ABLd', label: 'ABL d', a: 0, b: 1 }, { id: 'ABLp', label: 'ABL p', a: 2, b: 3 }, { id: 'ABLuni', label: 'ABL uni', a: 0, b: -1 }] },
};

// Access route for the ablation catheter per chamber: entry point + sheath direction.
export const ACCESS = {
  RA: { entry: [-24, 26, -48], dir: norm([0.1, -0.35, 1]), label: 'IVC (femoral venous)' },
  LA: { entry: [6, 27, 2], dir: norm([1, 0.25, 0.1]), label: 'Transseptal' },
  RV: { entry: [-20, -6, -10], dir: norm([0.45, -0.55, -0.7]), label: 'Across the tricuspid valve' },
  LV: { entry: [12, 2, -6], dir: norm([0.25, -0.5, -0.8]), label: 'Retrograde aortic' },
};

const SDF = {};
export function chamberSDF(id) { return SDF[id] || (SDF[id] = makeChamberSDF(CHAMBER_DEFS[id])); }

function sdfGrad(f, p) {
  const e = 0.4;
  return norm([f(p[0] + e, p[1], p[2]) - f(p[0] - e, p[1], p[2]), f(p[0], p[1] + e, p[2]) - f(p[0], p[1] - e, p[2]), f(p[0], p[1], p[2] + e) - f(p[0], p[1], p[2] - e)]);
}

// Fixed catheter: poles placed along the endocardial surface from a tip site.
export class FixedCatheter {
  constructor(sim, id) {
    this.sim = sim; this.id = id; this.info = CATHETER_INFO[id];
    this.placed = false; this.site = null; this.poles = []; this.attempts = 0; this.visible = true;
  }
  place(siteId) {
    const site = PLACEMENT_SITES[this.id].find((s) => s.id === siteId);
    if (!site) return false;
    this.site = site; this.attempts++;
    const heart = this.sim.heart;
    if (site.cs) {
      this.poles = csPoles(heart);
    } else {
      const tipNode = nearestInChamber(heart, site.pos, site.chamber);
      const tip = nodePos(heart, tipNode);
      const nrm = [heart.normal[3 * tipNode], heart.normal[3 * tipNode + 1], heart.normal[3 * tipNode + 2]];
      // shaft runs roughly toward the access (IVC for right-sided catheters)
      const access = site.chamber === 'RV' ? ACCESS.RV.entry : [-24, 24, -40];
      const along = norm(sub(access, tip));
      const sp = this.info.spacing;
      this.poles = [];
      for (let i = 0; i < this.info.poles; i++) {
        const raw = add(tip, scl(along, i * sp + (i % 2 ? 0 : 0)));
        // keep poles on the wall (snap to the surface, sit 0.8 mm inside)
        const n = nearestInChamber(heart, raw, site.chamber);
        const p = nodePos(heart, n), nn = [heart.normal[3 * n], heart.normal[3 * n + 1], heart.normal[3 * n + 2]];
        this.poles.push(i === 0 ? sub(tip, scl(nrm, 0.8)) : sub(p, scl(nn, 0.8)));
      }
    }
    this.placed = true;
    this.correct = !!site.ok;
    this.sim.emit('catheters', this.id);
    return this.correct;
  }
  shaft() {
    // polyline for rendering: poles then back toward the access vein
    if (!this.poles.length) return [];
    const last = this.poles[this.poles.length - 1];
    const access = this.id === 'CS' ? [-20, 26, -46] : this.site?.chamber === 'RV' ? [-22, 20, -50] : [-24, 26, -60];
    let pts = this.poles.map((p) => p.slice());
    // light smoothing so the electrode array lies on one continuous, flexible curve
    // (poles snapped to the wall one by one can zigzag by a fraction of a millimetre)
    for (let it = 0; it < 2; it++) {
      pts = pts.map((p, i) => (i === 0 || i === pts.length - 1 ? p : add(scl(p, 0.5), scl(add(pts[i - 1], pts[i + 1]), 0.25))));
    }
    // the shaft leaves the proximal electrode along the array direction, then sweeps to the vein
    const dir = norm(sub(last, this.poles[Math.max(0, this.poles.length - 3)]));
    const reach = Math.min(18, len(sub(access, last)) * 0.35);
    const lead = add(last, scl(dir, reach));
    let mid = scl(add(lead, access), 0.5);
    if (this.id !== 'CS') {
      // route the free shaft through the blood pool (RA, and RV for ventricular catheters),
      // not around the outside of the shell
      const inside = (p) => {
        for (let it = 0; it < 3; it++) {
          const fRA = chamberSDF('RA'), fRV = chamberSDF('RV');
          const a = fRA(p[0], p[1], p[2]), b = this.site?.chamber === 'RV' ? fRV(p[0], p[1], p[2]) : Infinity;
          const f = a < b ? fRA : fRV, d = Math.min(a, b);
          if (d < -3) break;
          p = sub(p, scl(sdfGrad(f, p), d + 3));
        }
        return p;
      };
      mid = inside(add(mid, scl(sub([-28, 15, 4], mid), 0.25)));
      pts.push(inside(lead), mid, access, add(access, [0, 2, -25]));
    } else pts.push(lead, mid, access, add(access, [0, 2, -25]));
    return pts;
  }
}

// CS catheter poles: in the AV groove between the LA and LV, proximal pair at the os.
function csPoles(heart) {
  const keys = ['CS_1_2', 'CS_3_4', 'CS_5_6', 'CS_7_8', 'CS_9_10'];
  const centers = keys.map((k) => {
    const raw = LR[k];
    const a = nodePos(heart, k === 'CS_9_10' ? nearestAtrial(heart, raw) : nearestInChamber(heart, raw, 'LA'));
    const vN = heart.grid.nearest(raw, 60, (i) => heart.chamber[i] === CHAMBER_INDEX.LV || heart.chamber[i] === CHAMBER_INDEX.RV);
    const v = nodePos(heart, vN);
    const d = len(sub(v, a));
    // sit ~3 mm from the atrial wall toward the ventricle
    return add(a, scl(norm(sub(v, a)), Math.min(3, d * 0.4)));
  });
  const poles = [];
  for (let i = 0; i < centers.length; i++) {
    const c = centers[i];
    const nb = centers[Math.min(i + 1, centers.length - 1)], pb = centers[Math.max(i - 1, 0)];
    const dir = norm(sub(nb, pb));
    poles.push(sub(c, scl(dir, 1)), add(c, scl(dir, 1)));
  }
  return poles; // index 0 = CS1 (distal)
}

function nearestAtrial(heart, p) {
  return heart.grid.nearest(p, 60, (i) => heart.chamber[i] <= 1);
}

export function nodePos(heart, n) { return [heart.pos[3 * n], heart.pos[3 * n + 1], heart.pos[3 * n + 2]]; }

// Steerable ablation catheter.
//
// Degrees of freedom (all continuous, so the tip can be driven anywhere in the chamber):
//   deflect     -1..1   bidirectional tip curve (±180° over the 28 mm distal segment)
//   rotate      deg     torque: turns the plane of the curve around the shaft
//   advance     mm      catheter length out of the sheath
//   sheathBend  0..120° steerable-sheath curve: tilts the exit direction off the access axis
//   sheathRot   deg     sheath rotation: which way that tilt points
// Shaft mechanics: the free path is computed first; then the shaft is kept inside the
// chamber (it rests on the wall where it touches) and wall penetration of the tip is
// removed by flexing the distal shaft (correction weighted toward the tip), so the
// catheter bows against the wall instead of kinking. Electrodes are placed by arc
// length along the final, flexed path so they follow the curve.
const ARC_L = 28; // deflectable segment length (mm)
const POLE_S = [0, 6, 12, 15]; // 3.5 mm tip + 1 mm rings, 2-5-2 mm spacing (centres, mm back from the tip along the shaft)

function perpBasis(d) {
  const e1 = norm(cross(d, Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
  return [e1, cross(d, e1)];
}

// point + tangent at arc length `s` back from the end of a polyline
function alongFromEnd(pts, s) {
  let acc = 0;
  for (let i = pts.length - 1; i > 0; i--) {
    const a = pts[i], b = pts[i - 1];
    const seg = len(sub(a, b));
    if (acc + seg >= s || i === 1) {
      const f = seg > 1e-6 ? Math.min(1, (s - acc) / seg) : 0;
      return { p: add(a, scl(sub(b, a), f)), t: norm(sub(a, b)) };
    }
    acc += seg;
  }
  return { p: pts[pts.length - 1].slice(), t: [0, 0, 1] };
}

export class AblationCatheter {
  constructor(sim) {
    this.sim = sim; this.id = 'ABL'; this.info = CATHETER_INFO.ABL;
    this.chamber = sim.cfg.ablChamber || 'RA';
    this.deflect = 0.35; this.rotate = 0; this.advance = 30; // -1..1, deg, mm
    this.sheathBend = 0; this.sheathRot = 0; // deg
    this.placed = true; this.visible = true;
    this.cf = 0; this.contact = false; this.tip = [0, 0, 0]; this.tipDir = [0, 0, 1]; this.wallNormal = [0, 0, 1];
    this.surfaceNode = -1; this.poles = []; this.path = [];
    this.history = []; // recent tip positions for stability
    this.override = null; // {offset} when snapped by shift-click / drag
    this.cfBias = 0; this.dragging = false;
    this.update(0);
  }
  setChamber(ch) {
    if (ch === this.chamber) return;
    this.chamber = ch; this.override = null; this.deflect = 0.3; this.rotate = 0; this.advance = 28;
    this.sheathBend = 0; this.sheathRot = 0;
    this.sim.logEvent('abl_chamber', { chamber: ch });
    this.update(this.sim.t);
  }
  // exit direction of the steerable sheath
  sheathDir(bend = this.sheathBend, srot = this.sheathRot) {
    const d = ACCESS[this.chamber].dir;
    if (!bend) return d;
    const [e1, e2] = perpBasis(d);
    const b = (bend * Math.PI) / 180, r = (srot * Math.PI) / 180;
    return norm(add(scl(d, Math.cos(b)), scl(add(scl(e1, Math.cos(r)), scl(e2, Math.sin(r))), Math.sin(b))));
  }
  // Free (unconstrained) catheter path. iCath = index of the sheath tip in pts.
  kinematics(defl, rot, adv, bend = this.sheathBend, srot = this.sheathRot) {
    const acc = ACCESS[this.chamber];
    const d0 = this.sheathDir(bend, srot);
    const [ref, r2] = perpBasis(d0);
    const th = (rot * Math.PI) / 180;
    const sgn = defl < 0 ? -1 : 1;
    const bendV = scl(add(scl(ref, Math.cos(th)), scl(r2, Math.sin(th))), sgn);
    const pts = [sub(acc.entry, scl(acc.dir, 40)), sub(acc.entry, scl(acc.dir, 14))];
    // sheath curve: blend from the access axis to the exit direction over the last 12 mm
    if (bend > 1) pts.push(sub(acc.entry, scl(norm(add(acc.dir, d0)), 6)));
    const iCath = pts.length;
    pts.push(acc.entry.slice());
    const nSh = Math.max(1, Math.ceil(adv / 5));
    for (let i = 1; i <= nSh; i++) pts.push(add(acc.entry, scl(d0, (adv * i) / nSh)));
    const shaftEnd = pts[pts.length - 1];
    const kappa = (Math.abs(defl) * Math.PI) / ARC_L;
    let tipDir = d0;
    for (let i = 1; i <= 12; i++) {
      const s = (ARC_L * i) / 12;
      let p;
      if (kappa < 1e-4) p = add(shaftEnd, scl(d0, s));
      else {
        const a = kappa * s;
        p = add(shaftEnd, add(scl(d0, Math.sin(a) / kappa), scl(bendV, (1 - Math.cos(a)) / kappa)));
        tipDir = norm(add(scl(d0, Math.cos(a)), scl(bendV, Math.sin(a))));
      }
      pts.push(p);
    }
    return { pts, tip: pts[pts.length - 1], tipDir, iCath };
  }
  // tip only (fast path for the inverse-kinematics search)
  tipOf(defl, rot, adv, bend, srot) {
    const acc = ACCESS[this.chamber];
    const d0 = this.sheathDir(bend, srot);
    const [ref, r2] = perpBasis(d0);
    const th = (rot * Math.PI) / 180, sgn = defl < 0 ? -1 : 1;
    const kappa = (Math.abs(defl) * Math.PI) / ARC_L;
    const base = add(acc.entry, scl(d0, adv));
    if (kappa < 1e-4) return add(base, scl(d0, ARC_L));
    const a = kappa * ARC_L;
    const bendV = scl(add(scl(ref, Math.cos(th)), scl(r2, Math.sin(th))), sgn);
    return add(base, add(scl(d0, Math.sin(a) / kappa), scl(bendV, (1 - Math.cos(a)) / kappa)));
  }
  // Inverse kinematics by grid search (used for shift-click / drag "move catheter here").
  // The current sheath setting is tried first; if the target is out of reach the sheath
  // curve is searched too, so any wall of the chamber can be reached.
  solveTo(target) {
    const evalAt = (df, rot, adv, sb, sr) => len(sub(this.tipOf(df, rot, adv, sb, sr), target));
    let best = null;
    const consider = (df, rot, adv, sb, sr) => { const d = evalAt(df, rot, adv, sb, sr); if (!best || d < best.d) best = { d, rot, df, adv, sb, sr }; };
    for (let rot = -180; rot < 180; rot += 15) for (let df = 0; df <= 1.001; df += 0.1) for (let adv = 0; adv <= 80; adv += 5) consider(df, rot, adv, this.sheathBend, this.sheathRot);
    if (best.d > 3) {
      for (let sb = 0; sb <= 90; sb += 30) for (let sr = -180; sr < 180; sr += sb ? 45 : 360)
        for (let rot = -180; rot < 180; rot += 30) for (let df = 0; df <= 1.001; df += 0.2) for (let adv = 0; adv <= 80; adv += 10) consider(df, rot, adv, sb, sr);
    }
    // local refinement
    for (let it = 0; it < 4; it++) {
      const st = [[8, 0.05, 3, 8, 12], [4, 0.02, 1.5, 4, 6], [2, 0.01, 0.75, 2, 3], [1, 0.005, 0.4, 1, 1.5]][it];
      for (let pass = 0; pass < 2; pass++) {
        const b0 = { ...best };
        for (const dr of [-1, 0, 1]) for (const dd of [-1, 0, 1]) for (const da of [-1, 0, 1]) for (const ds of [-1, 0, 1]) {
          const df = Math.max(0, Math.min(1, b0.df + dd * st[1])), adv = Math.max(0, Math.min(90, b0.adv + da * st[2]));
          const sb = Math.max(0, Math.min(120, b0.sb + ds * st[3]));
          consider(df, b0.rot + dr * st[0], adv, sb, b0.sr);
          if (sb > 0) consider(df, b0.rot + dr * st[0], adv, sb, b0.sr + ds * st[4]);
        }
      }
    }
    return best;
  }
  moveTo(target, cfTarget = 12) {
    const b = this.solveTo(target);
    this.rotate = ((b.rot + 540) % 360) - 180; this.deflect = b.df; this.advance = b.adv;
    this.sheathBend = b.sb; this.sheathRot = ((b.sr + 540) % 360) - 180;
    // residual correction keeps the tip exactly on the clicked point; it decays when the user steers
    const tip = this.tipOf(this.deflect, this.rotate, this.advance, this.sheathBend, this.sheathRot);
    const f = chamberSDF(this.chamber);
    const g = sdfGrad(f, target);
    const pushed = add(target, scl(g, cfTarget / 3.2 + 0.3)); // push beyond wall to create contact
    this.override = { offset: sub(pushed, tip) };
    this.update(this.sim.t);
  }
  steer(dDefl, dRot, dAdv, dBend = 0, dSRot = 0) {
    this.deflect = Math.max(-1, Math.min(1, this.deflect + dDefl));
    this.rotate = ((this.rotate + dRot + 540) % 360) - 180;
    this.advance = Math.max(0, Math.min(90, this.advance + dAdv));
    this.sheathBend = Math.max(0, Math.min(120, this.sheathBend + dBend));
    this.sheathRot = ((this.sheathRot + dSRot + 540) % 360) - 180;
    if (this.override) {
      // steering consumes the snap offset gradually so control feels continuous
      this.override.offset = scl(this.override.offset, 0.85);
      if (len(this.override.offset) < 0.3) this.override = null;
    }
    this.update(this.sim.t);
  }
  update(t) {
    const k = this.kinematics(this.deflect, this.rotate, this.advance);
    const pts = k.pts, n = pts.length, i0 = k.iCath;
    // arc length of each point from the sheath tip
    const sAt = new Float64Array(n);
    for (let i = i0 + 1; i < n; i++) sAt[i] = sAt[i - 1] + len(sub(pts[i], pts[i - 1]));
    const total = Math.max(1e-6, sAt[n - 1]);
    if (this.override) {
      const off = this.override.offset;
      for (let i = i0 + 1; i < n; i++) { const w = Math.pow(sAt[i] / total, 1.5); pts[i] = add(pts[i], scl(off, w)); }
    }
    const f = chamberSDF(this.chamber);
    // contact force from wall penetration of the free tip (3.2 g/mm) plus cardiac/respiratory jitter
    let tip = pts[n - 1];
    const s = f(tip[0], tip[1], tip[2]);
    const osc = Math.sin(t / 130) * 2.2 + Math.sin(t / 900) * 1.6;
    let cf = 0;
    const gTip = sdfGrad(f, tip);
    if (s > -0.4) {
      cf = Math.max(0, (s + 0.4) * 3.2 + osc);
      // flex: remove the penetration, mostly at the tip, fading back along the distal ~35 mm
      const corr = scl(gTip, -(s + 0.6));
      const flexL = Math.min(total, 35), sFlex = total - flexL;
      for (let i = i0 + 1; i < n; i++) {
        if (sAt[i] <= sFlex) continue;
        const u = (sAt[i] - sFlex) / flexL;
        pts[i] = add(pts[i], scl(corr, u * u * (3 - 2 * u)));
      }
    }
    // the shaft cannot pass through the wall: rest any interior shaft point on it
    for (let i = i0 + 1; i < n - 1; i++) {
      if (sAt[i] < 6) continue; // near the sheath tip the catheter may still be in the access route
      const p = pts[i];
      const d = f(p[0], p[1], p[2]);
      if (d > -1.3) pts[i] = sub(p, scl(sdfGrad(f, p), d + 1.3));
    }
    tip = pts[n - 1];
    if (this.dragging) cf = Math.max(cf, 0);
    this.cf = Math.min(80, cf);
    this.contact = this.cf >= 3;
    this.wallNormal = gTip;
    this.tip = tip;
    this.tipDir = alongFromEnd(pts, 2.5).t;
    this.path = pts;
    const heart = this.sim.heart;
    this.surfaceNode = nearestInChamber(heart, tip, this.chamber);
    // poles: tip electrode, then rings, by arc length along the flexed shaft
    this.poles = POLE_S.map((sp) => (sp === 0 ? tip.slice() : alongFromEnd(pts, sp).p));
    this.history.push({ t, p: tip.slice() });
    while (this.history.length > 40) this.history.shift();
  }
  stable() {
    const h = this.history.filter((x) => this.sim.t - x.t < 500);
    if (h.length < 2) return true;
    return h.every((x) => len(sub(x.p, this.tip)) < 2);
  }
  shaft() { return this.path; }
}

// Builds all catheters for a sim.
export function createCatheters(sim) {
  const c = {
    HRA: new FixedCatheter(sim, 'HRA'),
    HIS: new FixedCatheter(sim, 'HIS'),
    CS: new FixedCatheter(sim, 'CS'),
    RVA: new FixedCatheter(sim, 'RVA'),
    ABL: new AblationCatheter(sim),
  };
  return c;
}

export function autoPlace(cats) {
  for (const id of ['HRA', 'HIS', 'CS', 'RVA']) {
    const ok = PLACEMENT_SITES[id].find((s) => s.ok);
    cats[id].place(ok.id);
  }
}
