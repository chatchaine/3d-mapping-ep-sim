// Scenario builder: turns a case's `engine` block into a configured Engine:
// tissue assignment (crista, CTI, PV sleeves, scar, prior lesions), the conduction
// system (dual-pathway AV node, His, bundle branches, Purkinje junctions), accessory
// pathways, inter-atrial and septal connections, and per-mechanism helpers
// (reentry seeding geometry, foci, AF/VF drivers).

import { Engine, TISSUE, TISSUE_TABLE, hash01 } from './propagation.js';
import { LANDMARKS_RAW as LR, CHAMBER_INDEX, CHAMBER_DEFS, PV_DEFS, TV_N, MV_N, annulusPoint, nearestInChamber, nearestBoundary, pathThrough, vec } from './geometry.js';

const { sub, dot, len, norm, cross, scl, add } = vec;

export const DEFAULT_ENGINE_CFG = {
  sinusCL: 800,
  ah: 85,
  hv: 45,
  avn: {
    fp: { antero: { base: 60, A: 60, tau: 70, erp: 300, k: 0.25 }, retro: { base: 45, A: 50, tau: 70, erp: 300, k: 0.2 } },
    sp: null,
  },
  hpsRetro: true,
  ap: null,
  cristaBlock: false,
  cvMul: { RA: 2.0, LA: 1.8, RV: 1.15, LV: 1.15 }, // compensates graph-path inflation and the coarse mesh
  atrialErp: null,
};

function P(eng, n) { return [eng.pos[3 * n], eng.pos[3 * n + 1], eng.pos[3 * n + 2]]; }

// Distance from point p to polyline pts.
function distPolyline(p, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], ab = sub(b, a);
    let t = dot(sub(p, a), ab) / dot(ab, ab); t = Math.max(0, Math.min(1, t));
    best = Math.min(best, len(sub(p, add(a, scl(ab, t)))));
  }
  return best;
}

// Clock angle (degrees, 0 = 12 o'clock, increasing clockwise in LAO) of p about an annulus axis.
export function clockAngle(p, center, normal) {
  const n = norm(normal);
  const proj = (v) => norm(sub(v, scl(n, dot(v, n))));
  const up = proj([0, 0, 1]);
  const right = proj([0.707, 0.707, 0]);
  const d = sub(p, center);
  const a = Math.atan2(dot(d, right), dot(d, up)) * 180 / Math.PI;
  return (a + 360) % 360;
}

export function buildScenario(heart, cfgIn) {
  const cfg = mergeCfg(DEFAULT_ENGINE_CFG, cfgIn || {});
  const eng = new Engine(heart, 24);
  const nMesh = heart.count;
  const lm = heart.landmarks;
  const sys = { cfg, names: {}, regions: {}, pw: {}, foci: [], drivers: [], targets: {} };

  // ---- base tissue
  for (let n = 0; n < nMesh; n++) {
    const ch = eng.chamber[n];
    eng.setTissue(n, ch <= 1 ? TISSUE.ATRIUM : TISSUE.VENTRICLE);
    eng.wall[n] = CHAMBER_DEFS[['RA', 'LA', 'RV', 'LV'][ch]].wall;
    eng.erpNoise[n] = 1 + (hash01(n * 13 + 5) - 0.5) * 0.08;
  }
  for (const [id, m] of Object.entries(cfg.cvMul)) eng.cvMul[CHAMBER_INDEX[id]] = m;

  const RA = CHAMBER_INDEX.RA, LA = CHAMBER_INDEX.LA, RV = CHAMBER_INDEX.RV, LV = CHAMBER_INDEX.LV;
  const forChamber = (ci, fn) => { const c = heart.chambers[ci]; for (let n = c.offset; n < c.offset + c.count; n++) fn(n, P(eng, n)); };

  // ---- crista terminalis: a surface path from the SVC rim to the IVC rim along the
  // posterolateral RA (fast bundle, or a functional line of block in flutter cases).
  const raNode = (p) => nearestInChamber(heart, p, 'RA');
  const cristaPath = pathThrough(heart, [nearestBoundary(heart, [-30, 24, 52], 'RA'), raNode(LR.CRISTA_TOP), raNode([-44, 21, 18]), raNode(LR.CRISTA_MID), raNode([-40, 25, -14]), raNode(LR.CRISTA_BOTTOM), nearestBoundary(heart, [-28, 30, -56], 'RA')]);
  sys.cristaPath = cristaPath;
  sys.regions.crista = [];
  {
    const near = new Set();
    for (const n of cristaPath) heart.grid.query(P(eng, n), cfg.cristaBlock ? 2.4 : 3, (m) => { if (eng.chamber[m] === RA) near.add(m); });
    for (const n of near) { eng.setTissue(n, cfg.cristaBlock ? TISSUE.BLOCK_LINE : TISSUE.CRISTA); sys.regions.crista.push(n); }
  }
  // ---- CTI (slower, trabeculated)
  sys.regions.cti = [];
  const ctiPath = pathThrough(heart, [nearestBoundary(heart, LR.CTI_TA, 'RA'), raNode([-22, 15, -36]), nearestBoundary(heart, LR.CTI_IVC, 'RA')], (m) => eng.tissue[m] !== TISSUE.BLOCK_LINE);
  sys.ctiPath = ctiPath;
  const ctiPts = ctiPath.map((n) => P(eng, n));
  forChamber(RA, (n, p) => {
    if (eng.tissue[n] !== TISSUE.ATRIUM) return;
    if (ctiPts.length > 1 && distPolyline(p, ctiPts) < 9) { eng.setTissue(n, TISSUE.CTI); sys.regions.cti.push(n); }
  });
  // ---- PV sleeves (myocardial sleeve over the first part of each vein)
  sys.regions.pv = {};
  for (const [name, d] of Object.entries(PV_DEFS)) {
    const arr = (sys.regions.pv[name] = []);
    const ab = sub(d.b, d.a);
    forChamber(LA, (n, p) => {
      const t = dot(sub(p, d.a), ab) / dot(ab, ab);
      const radial = len(sub(sub(p, d.a), scl(ab, Math.max(0, Math.min(1, t)))));
      if (t > 0.3 && radial < d.r + 3) { eng.setTissue(n, TISSUE.PV_SLEEVE); arr.push(n); }
    });
  }
  // atrial remodelling (AF substrate) or custom atrial ERP
  if (cfg.atrialErp) {
    forChamber(LA, (n) => { if (eng.tissue[n] === TISSUE.ATRIUM) { eng.erp600[n] = cfg.atrialErp.LA; eng.erpNoise[n] = 1 + (hash01(n * 31) - 0.5) * 0.4; } });
    forChamber(RA, (n) => { if (eng.tissue[n] === TISSUE.ATRIUM) eng.erp600[n] = cfg.atrialErp.RA; });
  }

  // ---- landmark nodes (avoid nodes that sit on a block line)
  const pick = (p, ch) => heart.grid.nearest(p, 80, (i) => eng.chamber[i] === CHAMBER_INDEX[ch] && eng.cv[i] > 0);
  const nodes = (sys.nodes = {
    SN: pick(LR.SINUS_NODE, 'RA'),
    FP_ENTRY: pick(LR.FP_ENTRY, 'RA'),
    SP_ENTRY: pick(LR.SP_ENTRY, 'RA'),
    CS_OS: lm.CS_OS.node,
    HIS_A: pick(LR.HIS, 'RA'),
  });

  // ---- inter-atrial connections (Bachmann's bundle, fossa rim, CS musculature)
  const linkBoth = (a, b, delay) => { eng.addLink(a, b, { delay, kind: 'bridge' }); eng.addLink(b, a, { delay, kind: 'bridge' }); };
  const bbRA = pick([-14, -2, 26], 'RA'), bbLA = pick([12, 26, 28], 'LA');
  // Conduction delays are fixed (calibrated values): they encode the bundle's path length and
  // conduction velocity, not the straight-line distance between the two shells, so they stay
  // the same however closely the atria abut across the septum.
  linkBoth(bbRA, bbLA, 16.5); // Bachmann's bundle (~41 mm at 2.5 m/s)
  const foRA = pick(LR.FOSSA_OVALIS, 'RA'), foLA = pick(LR.FOSSA_OVALIS, 'LA');
  linkBoth(foRA, foLA, 27.2); // fossa ovalis rim
  const csLA = pick(LR.CS_9_10, 'LA');
  linkBoth(nodes.CS_OS, csLA, 25.8); // CS musculature
  sys.atrialBridges = { bbRA, bbLA, foRA, foLA, csLA };

  // ---- septal RV<->LV connections
  {
    const rv = heart.chambers[RV];
    let count = 0;
    for (let n = rv.offset; n < rv.offset + rv.count; n++) {
      const p = P(eng, n);
      const m = heart.grid.nearest(p, 8, (i) => eng.chamber[i] === LV);
      if (m < 0) continue;
      const d = len(sub(p, P(eng, m)));
      if (d < 7 && hash01(n) < 0.5) { linkBoth(n, m, 6 + d / 0.5); count++; }
    }
    sys.septalLinks = count;
  }

  // ---- conduction system
  const hisPos = P(eng, nodes.HIS_A);
  const vHIS = eng.addVirtual('HIS', hisPos, { erp: cfg.hisErp || 330, exp: 0.4, spike: { amp: 0.35, w: 1.6, r: 9 } });
  const vLBB = eng.addVirtual('LBB', LR.LBB_ORIGIN, { erp: cfg.hisErp ? cfg.hisErp + 20 : 350, exp: 0.4 });
  const vRBB = eng.addVirtual('RBB', LR.RBB_ORIGIN, { erp: cfg.hisErp ? cfg.hisErp + 20 : 350, exp: 0.4 });
  sys.names.HIS = vHIS; sys.names.LBB = vLBB; sys.names.RBB = vRBB;
  // AV node dual pathway
  const mkPw = (spec) => ({ last: -1e9, prevCL: 1500, antero: spec?.antero || null, retro: spec?.retro || null, blocked: false, erpMul: 1, delayMul: 1 });
  // the fast-pathway base delay is derived from the case AH unless pinned explicitly
  if (cfg.ah && !cfg.avn.fp.antero.pinned) cfg.avn.fp.antero = { ...cfg.avn.fp.antero, base: cfg.ah - 12 };
  sys.pw.FP = mkPw(cfg.avn.fp);
  const fpA = eng.addVirtual('FP_A', LR.FP_ENTRY, { erp: 10 });
  const fpR = eng.addVirtual('FP_R', LR.FP_ENTRY, { erp: 10 });
  eng.addLink(nodes.FP_ENTRY, fpA, { pw: sys.pw.FP, dir: 'antero', kind: 'avn' });
  eng.addLink(fpA, vHIS, { delay: 8, kind: 'avn' });
  eng.addLink(vHIS, fpR, { pw: sys.pw.FP, dir: 'retro', kind: 'avn' });
  eng.addLink(fpR, nodes.FP_ENTRY, { delay: 5, kind: 'avn' });
  if (cfg.avn.sp) {
    sys.pw.SP = mkPw(cfg.avn.sp);
    const spA = eng.addVirtual('SP_A', LR.SP_ENTRY, { erp: 10 });
    const spR = eng.addVirtual('SP_R', LR.SP_ENTRY, { erp: 10 });
    eng.addLink(nodes.SP_ENTRY, spA, { pw: sys.pw.SP, dir: 'antero', kind: 'avn' });
    eng.addLink(spA, vHIS, { delay: 8, kind: 'avn' });
    eng.addLink(vHIS, spR, { pw: sys.pw.SP, dir: 'retro', kind: 'avn' });
    eng.addLink(spR, nodes.SP_ENTRY, { delay: 5, kind: 'avn' });
  }
  // Purkinje junctions
  const pmj = { LV: [], RV: [] };
  const lvBase = [25, 12, -8], lvAxis = norm(sub(LR.LV_APEX, lvBase));
  const rvAxis = TV_N;
  forChamber(LV, (n, p) => {
    const s = dot(sub(p, lvBase), lvAxis) / 90;
    if (s > 0.3 && hash01(n * 3 + 1) < 0.035) pmj.LV.push(n);
  });
  forChamber(RV, (n, p) => {
    const s = dot(sub(p, LR.TV_CENTER), rvAxis) / 75;
    if (s > 0.35 && hash01(n * 3 + 2) < 0.03) pmj.RV.push(n);
  });
  sys.pmj = pmj;
  sys.pmjLinks = [];
  const hb = Math.max(4, cfg.hv - 15); // His -> bundle branch delay sets HV
  eng.addLink(vHIS, vLBB, { delay: hb, kind: 'hps' });
  eng.addLink(vHIS, vRBB, { delay: hb + 4, kind: 'hps' });
  eng.addLink(vLBB, vHIS, { delay: hb, kind: 'hps' });
  eng.addLink(vRBB, vHIS, { delay: hb + 4, kind: 'hps' });
  const addPmj = (bb, root, n) => {
    const d = len(sub(P(eng, n), root)) / 2.6 + 4;
    eng.addLink(bb, n, { delay: d, kind: 'hps' });
    const r = eng.addLink(n, bb, { delay: d + (cfg.hpsRetroExtra ?? 30), kind: 'hps-retro' }); // retrograde HPS conduction is slower
    r.enabled = !!cfg.hpsRetro;
    sys.pmjLinks.push(r);
  };
  for (const n of pmj.LV) addPmj(vLBB, LR.LBB_ORIGIN, n);
  for (const n of pmj.RV) addPmj(vRBB, LR.RBB_ORIGIN, n);

  // ---- accessory pathway
  if (cfg.ap) {
    const ap = cfg.ap;
    let aNode, vNode, vAnte = -1;
    if (ap.landmark) {
      aNode = pick(LR[ap.landmark] || ap.landmark, ap.atrialChamber || 'RA');
      vNode = heart.grid.nearest(P(eng, aNode), 60, (i) => (eng.chamber[i] === RV || eng.chamber[i] === LV));
      // optional antegrade ventricular insertion: a posteroseptal AP pre-excites the inferior
      // (diaphragmatic) septum near the crux, which gives the negative inferior delta wave.
      // Retrograde conduction (ORT) and the pathway position (ablation target) stay at the annulus.
      if (ap.vLandmark) { const n2 = heart.grid.nearest(ap.vLandmark, 30, (i) => (eng.chamber[i] === RV || eng.chamber[i] === LV)); if (n2 >= 0) vAnte = n2; }
    } else {
      const ring = ap.ring === 'TA' ? { c: LR.TV_CENTER, n: TV_N, ch: 'RA', vch: 'RV' } : { c: LR.MV_CENTER, n: MV_N, ch: 'LA', vch: 'LV' };
      const pt = annulusPoint(ring.c, ring.n, 17, ap.hour);
      aNode = pick(pt, ring.ch);
      vNode = pick(pt, ring.vch);
    }
    sys.pw.AP = mkPw({ antero: ap.antero, retro: ap.retro });
    const mid = scl(add(P(eng, aNode), P(eng, vNode)), 0.5);
    const apA = eng.addVirtual('AP_A', mid, { erp: 10, spike: { amp: 0.25, w: 1.2, r: 6 } });
    const apR = eng.addVirtual('AP_R', mid, { erp: 10, spike: { amp: 0.25, w: 1.2, r: 6 } });
    eng.addLink(aNode, apA, { pw: sys.pw.AP, dir: 'antero', kind: 'ap' });
    eng.addLink(apA, vAnte >= 0 ? vAnte : vNode, { delay: 2, kind: 'ap' });
    eng.addLink(vNode, apR, { pw: sys.pw.AP, dir: 'retro', kind: 'ap' });
    eng.addLink(apR, aNode, { delay: 2, kind: 'ap' });
    sys.ap = { aNode, vNode, pos: mid, depth: ap.depth || 3 };
  }

  // ---- slow-pathway "low-voltage bridge" (voltage-gradient mapping of Koch's triangle):
  // a narrow band of lower bipolar voltage runs from the anterior CS os lip toward the
  // tricuspid annulus over the slow-pathway region. Voltage only; conduction is unchanged.
  {
    // anchored on the wall: from the slow-pathway node toward the annulus
    const u = norm(sub(LR.TV_CENTER, LR.SP_ENTRY));
    const a = P(eng, pick(sub(LR.SP_ENTRY, scl(u, 2)), 'RA')), b = P(eng, pick(add(LR.SP_ENTRY, scl(u, 12)), 'RA'));
    const ab = sub(b, a), L2 = Math.max(1, dot(ab, ab));
    forChamber(RA, (n) => {
      const p = P(eng, n), tt = Math.max(0, Math.min(1, dot(sub(p, a), ab) / L2));
      if (len(sub(p, add(a, scl(ab, tt)))) < 4.5) eng.bip[n] = Math.min(eng.bip[n], 0.2 + 0.15 * hash01(n * 7 + 3));
    });
  }

  // ---- substrates
  if (cfg.priorBox) applyPriorBox(eng, heart, sys);
  if (cfg.scarVT) applyScarVT(eng, heart, sys, cfg.scarVT);
  if (cfg.ventricularErp) {
    for (const ci of [RV, LV]) forChamber(ci, (n) => {
      if (eng.tissue[n] === TISSUE.VENTRICLE) { eng.erp600[n] = cfg.ventricularErp; eng.erpNoise[n] = 1 + (hash01(n * 17) - 0.5) * 0.5; }
    });
  }

  // ---- geometry helpers for reentry seeding
  sys.ringAngle = {};
  sys.ringAngle.TV = new Float32Array(nMesh).fill(NaN);
  forChamber(RA, (n, p) => { sys.ringAngle.TV[n] = clockAngle(p, LR.TV_CENTER, TV_N); });
  sys.ringAngle.MV = new Float32Array(nMesh).fill(NaN);
  forChamber(LA, (n, p) => { sys.ringAngle.MV[n] = clockAngle(p, LR.MV_CENTER, MV_N); });

  eng.sys = sys;
  return { engine: eng, sys };
}

// Prior PVI + posterior wall "box" for the perimitral flutter case: everything posterior
// of y = 46 mm in the LA (PV antra and posterior wall) is already ablated, plus low-voltage
// patches on the anterior wall.
function applyPriorBox(eng, heart, sys) {
  const LA = CHAMBER_INDEX.LA, c = heart.chambers[LA];
  sys.regions.box = [];
  for (let n = c.offset; n < c.offset + c.count; n++) {
    const p = P(eng, n);
    if (p[1] > 47 && p[2] > -6) { eng.setTissue(n, TISSUE.ABLATED_CORE); sys.regions.box.push(n); }
    else if (len(sub(p, [22, 22, 26])) < 8 || len(sub(p, [34, 30, 30])) < 6) eng.setTissue(n, TISSUE.ATRIUM, { bip: 0.25 + 0.2 * hash01(n) });
  }
  // mitral isthmus: lateral MA rim -> nearest edge of the prior LIPV antral lesion set
  const ok = (m) => eng.tissue[m] !== TISSUE.ABLATED_CORE;
  const start = nearestBoundary(heart, [47, 9, -1], 'LA');
  const end = heart.grid.nearest([46, 45, 2], 30, (i) => eng.chamber[i] === LA && ok(i));
  sys.miPath = pathThrough(heart, [start, end], ok);
}

// Inferior basal LV scar with a slow-conducting channel along the mitral annulus
// (research spec §4.7a; curriculum case 9).
function applyScarVT(eng, heart, sys, sc) {
  const LV = CHAMBER_INDEX.LV, c = heart.chambers[LV];
  const base = [25, 12, -8];
  const axis = norm(sub(LR.LV_APEX, base));
  let inf = [0, 0, -1];
  inf = norm(sub(inf, scl(axis, dot(inf, axis))));
  const side = cross(axis, inf);
  // axial distance from the mitral rim: find the minimum axial coordinate of LV nodes
  let minS = Infinity;
  const halfCh = sc.channelHalfAngle || 50, halfScar = sc.scarHalfAngle || 47, halfBz = sc.bzHalfAngle || 60;
  // rim measured within the inferior sector (the LVOT side reaches further toward the base)
  for (let n = c.offset; n < c.offset + c.count; n++) {
    const d = sub(P(eng, n), base), r = sub(d, scl(axis, dot(d, axis)));
    if (Math.abs(Math.atan2(dot(r, side), dot(r, inf)) * 180 / Math.PI) < halfCh) minS = Math.min(minS, dot(d, axis));
  }
  sys.regions.scar = []; sys.regions.channel = []; sys.regions.bz = [];
  const chAngle = new Map();
  for (let n = c.offset; n < c.offset + c.count; n++) {
    const p = P(eng, n);
    const d = sub(p, base);
    const a = dot(d, axis) - minS; // mm from the rim
    const r = sub(d, scl(axis, dot(d, axis)));
    const phi = Math.atan2(dot(r, side), dot(r, inf)) * 180 / Math.PI;
    const aphi = Math.abs(phi);
    if (a < (sc.channelWidth || 6.5) && aphi < halfCh) {
      eng.setTissue(n, TISSUE.SLOW_CHANNEL, { cv: sc.channelCV || 0.12 });
      eng.wall[n] = 4;
      sys.regions.channel.push(n); chAngle.set(n, phi);
    } else if (a < (sc.scarDepth || 26) && aphi < halfScar) {
      eng.setTissue(n, TISSUE.DENSE_SCAR); eng.wall[n] = 4;
      sys.regions.scar.push(n);
    } else if (a < (sc.scarDepth || 26) + 6 && aphi < halfBz) {
      eng.setTissue(n, TISSUE.BORDER_ZONE); eng.wall[n] = 6;
      sys.regions.bz.push(n);
    }
  }
  sys.channelAngle = chAngle;
  // isthmus landmarks: center, exit (negative phi end), entrance (positive phi end)
  const byAngle = [...chAngle.entries()].sort((x, y) => x[1] - y[1]);
  const at = (ang) => byAngle.reduce((b, e) => (Math.abs(e[1] - ang) < Math.abs(b[1] - ang) ? e : b))[0];
  sys.targets.isthmusCenter = at(0);
  sys.targets.isthmusExit = at(-halfCh + 8);
  sys.targets.isthmusEntry = at(halfCh - 8);
}

function mergeCfg(a, b) {
  const out = Array.isArray(a) ? a.slice() : { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object') out[k] = mergeCfg(a[k], v);
    else out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------- reentry seeding
// Starts a single wavefront travelling in one direction around a ring: nodes in a
// thin angular band are stimulated and the band just "behind" them is made
// refractory, which reproduces unidirectional block (research spec §2.4 phase line).
export function seedRingReentry(eng, sys, ring, startDeg, dir, chamberId) {
  const ang = sys.ringAngle[ring];
  const ci = CHAMBER_INDEX[chamberId];
  const c = eng.heart.chambers[ci];
  const stim = [], refr = [];
  for (let n = c.offset; n < c.offset + c.count; n++) {
    let d = ((ang[n] - startDeg) * dir + 540) % 360 - 180; // signed angular offset in direction of travel
    if (d >= -8 && d <= 0) stim.push(n);
    else if (d < -8 && d > -60) refr.push(n);
  }
  const t = eng.t + 1;
  eng.makeRefractory(refr, t + 170);
  return eng.stimulate(stim, t, -5);
}

// Line seeding: stimulate a thin band along `pts` and make the band on the `behind`
// side refractory, so the wavefront leaves in the opposite direction only.
// Restitution preconditioning: pretend the chamber was last activated one tachycardia
// cycle ago so the first reentrant turn sees rate-adapted (short) refractory periods.
export function precondition(eng, chamberIds, cl) {
  for (const id of chamberIds) {
    const c = eng.heart.chambers[CHAMBER_INDEX[id]];
    for (let n = c.offset; n < c.offset + c.count; n++) {
      if (eng.lastAct[n] < eng.t - cl) eng.lastAct[n] = eng.t - cl;
    }
  }
}

export function seedLine(eng, pts, behindDir, chamberId, width = 2.6, depth = 16, refrMs = 170) {
  const ci = CHAMBER_INDEX[chamberId];
  const c = eng.heart.chambers[ci];
  const stim = [], refr = [];
  const bd = norm(behindDir);
  for (let n = c.offset; n < c.offset + c.count; n++) {
    if (eng.cv[n] <= 0) continue;
    const p = P(eng, n);
    let best = Infinity, q = null;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], ab = sub(b, a);
      let t = dot(sub(p, a), ab) / dot(ab, ab); t = Math.max(0, Math.min(1, t));
      const x = add(a, scl(ab, t)), d = len(sub(p, x));
      if (d < best) { best = d; q = x; }
    }
    if (best > depth) continue;
    const side = dot(sub(p, q), bd);
    if (best <= width) stim.push(n);
    else if (side > 0) refr.push(n);
  }
  const t = eng.t + 1;
  eng.makeRefractory(refr, t + refrMs);
  return eng.stimulate(stim, t, -5);
}

export function seedVT(eng, sys) {
  // The extrastimulus wavefront has just left the channel; reset its refractoriness so the
  // seeded wave models the unidirectional block that initiates reentry.
  const cl = sys.cfg.reentry?.tcl || 420;
  precondition(eng, ['LV', 'RV'], cl);
  for (const n of sys.channelAngle.keys()) { eng.lastAct[n] = Math.min(eng.lastAct[n], eng.t - cl); eng.refrEnd[n] = Math.min(eng.refrEnd[n], eng.t); }
  const stim = [], refr = [];
  for (const [n, phi] of sys.channelAngle) {
    if (phi >= -4 && phi <= 4) stim.push(n);
    else if (phi > 4 && phi <= 40) refr.push(n);
  }
  const t = eng.t + 1;
  eng.makeRefractory(refr, t + 260);
  // the His-Purkinje system was just engaged by the preceding beat: keep it refractory so the
  // first exit wavefront cannot short-circuit retrogradely back to the isthmus entrance
  const hps = ['HIS', 'LBB', 'RBB'].map((k) => sys.names[k]).filter((n) => n != null);
  if (hps.length) eng.makeRefractory(hps, t + 200);
  return eng.stimulate(stim, t, -5);
}
