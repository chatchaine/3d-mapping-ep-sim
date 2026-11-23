// Catheter models: fixed diagnostic catheters (HRA, His, CS, RVA) placed at sites, and
// a steerable ablation catheter driven by deflection / torque / advance.
//
// The ablation catheter kinematics: a straight shaft leaves the access point along the
// sheath direction for `advance` mm, then a distal arc of length 28 mm bends by
// `deflect` (0..1 -> 0..180 deg) in the plane selected by the `rotate` torque angle.
// If the tip would leave the chamber, it is projected back onto the wall and the
// penetration depth is converted into contact force (with cardiac/respiratory jitter).

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
    const pts = this.poles.map((p) => p.slice());
    const mid = add(scl(add(last, access), 0.5), [-6, 0, 0]);
    pts.push(mid, access, add(access, [0, 2, -25]));
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
export class AblationCatheter {
  constructor(sim) {
    this.sim = sim; this.id = 'ABL'; this.info = CATHETER_INFO.ABL;
    this.chamber = sim.cfg.ablChamber || 'RA';
    this.deflect = 0.35; this.rotate = 0; this.advance = 30; // 0..1, deg, mm
    this.placed = true; this.visible = true;
    this.cf = 0; this.contact = false; this.tip = [0, 0, 0]; this.tipDir = [0, 0, 1];
    this.surfaceNode = -1; this.poles = []; this.path = [];
    this.history = []; // recent tip positions for stability
    this.override = null; // {target, dir} when snapped by shift-click
    this.cfBias = 0; this.dragging = false;
    this.update(0);
  }
  setChamber(ch) {
    if (ch === this.chamber) return;
    this.chamber = ch; this.override = null; this.deflect = 0.3; this.rotate = 0; this.advance = 28;
    this.sim.logEvent('abl_chamber', { chamber: ch });
    this.update(this.sim.t);
  }
  // Compute the free (unconstrained) catheter path.
  kinematics(defl, rot, adv) {
    const acc = ACCESS[this.chamber];
    const d0 = acc.dir;
    const ref = norm(cross(d0, Math.abs(d0[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
    const r2 = cross(d0, ref);
    const th = rot * Math.PI / 180;
    const bend = add(scl(ref, Math.cos(th)), scl(r2, Math.sin(th)));
    const pts = [];
    const sheathBack = sub(acc.entry, scl(d0, 40));
    pts.push(sheathBack);
    const shaftEnd = add(acc.entry, scl(d0, adv));
    pts.push(acc.entry, shaftEnd);
    const Lc = 28, kappa = (defl * Math.PI) / Lc;
    let tipDir = d0;
    for (let i = 1; i <= 12; i++) {
      const s = (Lc * i) / 12;
      let p;
      if (kappa < 1e-4) p = add(shaftEnd, scl(d0, s));
      else {
        const a = kappa * s;
        p = add(shaftEnd, add(scl(d0, Math.sin(a) / kappa), scl(bend, (1 - Math.cos(a)) / kappa)));
        tipDir = norm(add(scl(d0, Math.cos(a)), scl(bend, Math.sin(a))));
      }
      pts.push(p);
    }
    return { pts, tip: pts[pts.length - 1], tipDir };
  }
  // Inverse kinematics by grid search (used for shift-click "move catheter here").
  solveTo(target) {
    let best = null;
    for (let rot = -180; rot < 180; rot += 15) for (let df = 0; df <= 1.001; df += 0.1) for (let adv = 0; adv <= 70; adv += 5) {
      const k = this.kinematics(df, rot, adv);
      const d = len(sub(k.tip, target));
      if (!best || d < best.d) best = { d, rot, df, adv };
    }
    // local refinement
    for (let it = 0; it < 3; it++) {
      const steps = [[5, 0.03, 2], [2, 0.01, 1], [1, 0.005, 0.5]][it];
      for (const dr of [-1, 0, 1]) for (const dd of [-1, 0, 1]) for (const da of [-1, 0, 1]) {
        const rot = best.rot + dr * steps[0], df = Math.max(0, Math.min(1, best.df + dd * steps[1])), adv = Math.max(0, Math.min(80, best.adv + da * steps[2]));
        const k = this.kinematics(df, rot, adv);
        const d = len(sub(k.tip, target));
        if (d < best.d) best = { d, rot, df, adv };
      }
    }
    return best;
  }
  moveTo(target, cfTarget = 12) {
    const b = this.solveTo(target);
    this.rotate = ((b.rot + 540) % 360) - 180; this.deflect = b.df; this.advance = b.adv;
    // residual correction keeps the tip exactly on the clicked point; it decays when the user steers
    const k = this.kinematics(this.deflect, this.rotate, this.advance);
    const f = chamberSDF(this.chamber);
    const g = sdfGrad(f, target);
    const pushed = add(target, scl(g, cfTarget / 3.2 + 0.3)); // push beyond wall to create contact
    this.override = { offset: sub(pushed, k.tip) };
    this.update(this.sim.t);
  }
  steer(dDefl, dRot, dAdv) {
    this.deflect = Math.max(0, Math.min(1, this.deflect + dDefl));
    this.rotate = ((this.rotate + dRot + 540) % 360) - 180;
    this.advance = Math.max(0, Math.min(80, this.advance + dAdv));
    if (this.override) {
      // steering consumes the snap offset gradually so control feels continuous
      this.override.offset = scl(this.override.offset, 0.85);
      if (len(this.override.offset) < 0.3) this.override = null;
    }
    this.update(this.sim.t);
  }
  update(t) {
    const k = this.kinematics(this.deflect, this.rotate, this.advance);
    let tip = k.tip;
    if (this.override) {
      tip = add(tip, this.override.offset);
      const n = k.pts.length;
      for (let i = 3; i < n; i++) k.pts[i] = add(k.pts[i], scl(this.override.offset, (i - 2) / (n - 3)));
    }
    const f = chamberSDF(this.chamber);
    const s = f(tip[0], tip[1], tip[2]);
    // contact force from wall penetration (3.2 g/mm) plus cardiac/respiratory jitter
    const osc = Math.sin(t / 130) * 2.2 + Math.sin(t / 900) * 1.6;
    let cf = 0;
    if (s > -0.4) {
      cf = Math.max(0, (s + 0.4) * 3.2 + osc);
      const g = sdfGrad(f, tip);
      tip = sub(tip, scl(g, s + 0.6)); // sit just inside the wall
    }
    if (this.dragging) cf = Math.max(cf, 0);
    this.cf = Math.min(80, cf);
    this.contact = this.cf >= 3;
    this.tip = tip; this.tipDir = k.tipDir;
    k.pts[k.pts.length - 1] = tip;
    this.path = k.pts;
    const heart = this.sim.heart;
    this.surfaceNode = nearestInChamber(heart, tip, this.chamber);
    // poles: tip electrode (3.5 mm) then rings at 1, 2 mm spacing back along the catheter
    const back = scl(k.tipDir, -1);
    this.poles = [tip, add(tip, scl(back, 4.5)), add(tip, scl(back, 7)), add(tip, scl(back, 9.5))];
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
