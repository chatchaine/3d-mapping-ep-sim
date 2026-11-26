// Procedural heart geometry.
//
// Each chamber is defined as a signed distance field (SDF): a smooth union of
// ellipsoids and capsules (veins, appendages, vestibules). The SDF is polygonised
// with "surface nets" on a ~2 mm grid, which gives a fairly uniform triangulated
// endocardial shell (node spacing 1.5-3 mm, research spec §2.1). Valve and vein
// orifices are then opened by removing vertices (they are anatomic barriers with
// no nodes). Coordinates are patient LPS in mm: +x left, +y posterior, +z superior,
// origin at the His bundle recording site (research spec §3).

export const LANDMARKS_RAW = {
  HIS: [0, 0, 0],
  COMPACT_AVN: [-3, 5, -6],
  FP_ENTRY: [-4, 3, -3],
  SP_ENTRY: [-10, 12, -18],
  CS_OS: [-6, 18, -20],
  TV_CENTER: [-18, -5, -12],
  CTI_MEDIAL: [-14, 8, -30],
  CTI_TA: [-20, 5, -32],
  CTI_IVC: [-24, 25, -40],
  IVC_ORIFICE: [-22, 28, -45],
  SVC_ORIFICE: [-25, 22, 40],
  SINUS_NODE: [-35, 18, 32],
  CRISTA_TOP: [-35, 18, 32],
  CRISTA_MID: [-44, 22, 6],
  CRISTA_BOTTOM: [-32, 26, -30],
  LOW_LATERAL_RA: [-46, 6, -14],
  RAA: [-32, -12, 22],
  HRA_CATH: [-33, 14, 28],
  FOSSA_OVALIS: [4, 25, 2],
  MV_CENTER: [25, 15, -10],
  LSPV: [45, 52, 32],
  LIPV: [45, 56, 8],
  RSPV: [10, 52, 32],
  RIPV: [10, 56, 6],
  LAA: [55, 10, 30],
  LA_ROOF: [28, 50, 38],
  LAT_MA: [42, 22, -8],
  CS_9_10: [-2, 22, -18],
  CS_7_8: [12, 32, -14],
  CS_5_6: [26, 34, -10],
  CS_3_4: [38, 28, -6],
  CS_1_2: [46, 16, -4],
  AORTIC_NCC: [2, 8, 6],
  AORTIC_RCC: [5, -2, 6],
  AORTIC_LCC: [14, 4, 10],
  PULMONARY_VALVE: [8, -28, 18],
  RVOT_SEPTAL: [5, -22, 10],
  RVOT_FREE: [-8, -34, 10],
  RV_APEX: [10, -48, -62],
  LV_APEX: [30, -45, -78],
  LBB_ORIGIN: [4, 0, -8],
  RBB_ORIGIN: [-2, -6, -12],
  PHRENIC_R: [-48, 10, 20],
  ESOPHAGUS: [24, 62, 10],
};

export const CHAMBER_IDS = ['RA', 'LA', 'RV', 'LV'];
export const CHAMBER_INDEX = { RA: 0, LA: 1, RV: 2, LV: 3 };
export const CHAMBER_GROUP = ['A', 'A', 'V', 'V'];

// ---------------------------------------------------------------- vector utils
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const vec = { sub, add, scl, dot, len, norm, cross };

function basisFromAxis(u) {
  u = norm(u);
  const ref = Math.abs(u[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const v = norm(cross(ref, u));
  const w = cross(u, v);
  return [u, v, w];
}

// ---------------------------------------------------------------- SDF primitives
function ellipsoid(c, r, axis) {
  const B = axis ? basisFromAxis(axis) : [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  return { type: 'ell', c, r, B };
}
function capsule(a, b, r) { return { type: 'cap', a, b, r, ab: sub(b, a), abl2: dot(sub(b, a), sub(b, a)) }; }

function primSDF(pr, x, y, z) {
  if (pr.type === 'ell') {
    const dx = x - pr.c[0], dy = y - pr.c[1], dz = z - pr.c[2];
    const B = pr.B, r = pr.r;
    const qx = dx * B[0][0] + dy * B[0][1] + dz * B[0][2];
    const qy = dx * B[1][0] + dy * B[1][1] + dz * B[1][2];
    const qz = dx * B[2][0] + dy * B[2][1] + dz * B[2][2];
    const k0 = Math.hypot(qx / r[0], qy / r[1], qz / r[2]);
    const k1 = Math.hypot(qx / (r[0] * r[0]), qy / (r[1] * r[1]), qz / (r[2] * r[2]));
    if (k1 < 1e-9) return -Math.min(r[0], r[1], r[2]);
    return (k0 * (k0 - 1)) / k1;
  }
  // capsule
  const px = x - pr.a[0], py = y - pr.a[1], pz = z - pr.a[2];
  let h = (px * pr.ab[0] + py * pr.ab[1] + pz * pr.ab[2]) / pr.abl2;
  h = h < 0 ? 0 : h > 1 ? 1 : h;
  return Math.hypot(px - pr.ab[0] * h, py - pr.ab[1] * h, pz - pr.ab[2] * h) - pr.r;
}

function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
function smax(a, b, k) { return -smin(-a, -b, k); }

// ---------------------------------------------------------------- chamber definitions
const L = LANDMARKS_RAW;
const TV_N = norm(sub(L.RV_APEX, L.TV_CENTER)); // TV normal, toward RV apex
const MV_N = norm(sub(L.LV_APEX, L.MV_CENTER)); // MV normal, toward LV apex
const LV_BASE = [25, 12, -8];
const LV_AXIS = norm(sub(L.LV_APEX, LV_BASE));
const LV_CENTER = scl(add(LV_BASE, L.LV_APEX), 0.5);

const PV_DEFS = {
  LSPV: { a: [40, 50, 26], b: [58, 64, 40], r: 8 },
  LIPV: { a: [40, 52, 8], b: [60, 70, 2], r: 7 },
  RSPV: { a: [14, 50, 26], b: [-2, 64, 40], r: 8 },
  RIPV: { a: [14, 52, 6], b: [-4, 72, 0], r: 7 },
};
export { PV_DEFS };

// LV: bullet shape, a broad basal body blended into a tapered apical cap
function lvPrims() {
  return [
    ellipsoid(add(LV_BASE, scl(LV_AXIS, 36)), [40, 26.5, 26.5], LV_AXIS),
    ellipsoid(add(LV_BASE, scl(LV_AXIS, 64)), [27, 15, 15], LV_AXIS),
    capsule([19, -2, -16], [9, 3, 4], 10), // LVOT toward the aortic valve
  ];
}

// RV free-wall crescent: wraps the septal (right-anterior) side of the LV. Its cavity
// lies between the septum (LV + `inner`) and a free wall whose distance from the LV
// is largest facing the RV and tapers to zero at the crescent edges and toward the apex.
const RV_SIDE = norm([-0.8, -0.55, 0.12]);
const RV_WRAP = { inner: 3.5, thick: 15, c0: 0.35, apexS: 76 };
function rvCrescentSDF(e, x, y, z) {
  const d = [x - LV_BASE[0], y - LV_BASE[1], z - LV_BASE[2]];
  const sAx = dot(d, LV_AXIS);
  const r = sub(d, scl(LV_AXIS, sAx));
  const rl = len(r) || 1;
  const cosT = dot(r, RV_SIDE) / rl;
  const ang = Math.max(0, (cosT - RV_WRAP.c0) / (1 - RV_WRAP.c0));
  const along = Math.max(0, Math.min(1, sAx / RV_WRAP.apexS));
  // cavity depth: deepest facing the RV, still ~45% at the edges so the rim is rounded
  const outer = RV_WRAP.inner + RV_WRAP.thick * (0.45 + 0.55 * Math.pow(ang, 0.8)) * (1 - 0.35 * along);
  let c = smax(e - outer, -(e - RV_WRAP.inner), 3);
  c = smax(c, (RV_WRAP.c0 - cosT) * rl, 7); // anterior/posterior edges of the crescent
  c = smax(c, sAx - RV_WRAP.apexS, 10); // RV apex sits short of the LV apex
  c = smax(c, 4 - sAx, 6); // no wrap above the LV base (around the outflow / aortic root)
  return c;
}

export const CHAMBER_DEFS = {
  RA: {
    wall: 2,
    k: 8,
    prims: [
      ellipsoid([-28, 15, 8], [24, 22, 27]),
      capsule([-26, 20, 26], [-25, 22, 62], 10), // SVC
      capsule([-24, 24, -18], [-22, 30, -68], 12), // IVC
      // RAA: broad-based triangular pouch on the anterolateral wall, apex hooking
      // anteromedially toward the aortic root
      ellipsoid([-33, -6, 21], [15, 8, 11], [0.25, -0.9, 0.2]),
      ellipsoid([-25, -15, 25], [12, 6.5, 6], [0.75, -0.6, 0.25]),
      capsule([-26, 10, 0], [-18, -5, -12], 16), // TV vestibule
      ellipsoid([-12, 14, -12], [11, 10, 12]), // septal / Koch region
      capsule([-18, 2, -24], [-24, 24, -38], 9), // CTI floor
    ],
    holes: [
      { kind: 'disc', c: L.TV_CENTER, n: TV_N, r: 17, off: -1 },
      { kind: 'zabove', z: 50 },
      { kind: 'zbelow', z: -54 },
    ],
    csOsHole: 4.5,
  },
  LA: {
    wall: 2.5,
    k: 7,
    prims: [
      ellipsoid([28, 40, 12], [28, 19, 22]),
      // septal wall: the LA abuts the RA across the interatrial septum (fossa ovalis),
      // lying posterior and leftward of it; carved against the RA below (subtract)
      ellipsoid([5, 29, 8], [14, 12, 17]),
      capsule(PV_DEFS.LSPV.a, PV_DEFS.LSPV.b, PV_DEFS.LSPV.r),
      capsule(PV_DEFS.LIPV.a, PV_DEFS.LIPV.b, PV_DEFS.LIPV.r),
      capsule(PV_DEFS.RSPV.a, PV_DEFS.RSPV.b, PV_DEFS.RSPV.r),
      capsule(PV_DEFS.RIPV.a, PV_DEFS.RIPV.b, PV_DEFS.RIPV.r),
      // LAA: narrow neck, tubular body curving anterolaterally, hooked tip with a
      // small secondary lobe (chicken-wing-like morphology)
      capsule([43, 25, 22], [50, 16, 27], 5.5),
      capsule([50, 16, 27], [57, 8, 31], 7),
      capsule([57, 8, 31], [60, 2, 25], 5.5),
      capsule([60, 2, 25], [57, 0, 18], 4),
      capsule([55, 11, 32], [55, 9, 39], 3.5),
      capsule([27, 32, 0], [25, 15, -10], 15), // mitral vestibule
    ],
    // interatrial septum ~4 mm: the LA stops short of the RA body, septum and SVC
    subtract: { prims: [ellipsoid([-28, 15, 8], [24, 22, 27]), ellipsoid([-12, 14, -12], [11, 10, 12]), capsule([-26, 20, 26], [-25, 22, 62], 10)], inflate: 4, k: 3 },
    holes: [
      { kind: 'disc', c: L.MV_CENTER, n: MV_N, r: 16, off: -1 },
      ...Object.values(PV_DEFS).map((d) => ({ kind: 'tubeEnd', a: d.a, b: d.b, r: d.r + 3, t: 0.92 })),
    ],
  },
  RV: {
    wall: 4,
    k: 7,
    prims: [
      capsule([-4, -32, -14], [6, -28, 18], 11), // RVOT (infundibulum)
      capsule([-12, -16, -22], [-18, -5, -12], 15), // inflow
    ],
    wrap: true, // + crescent around the LV (rvCrescentSDF)
    boundsExtra: [[-40, -70, -95], [40, 40, 30]],
    subtract: { prims: lvPrims(), inflate: 3.5, k: 4 },
    holes: [
      { kind: 'disc', c: L.TV_CENTER, n: scl(TV_N, -1), r: 17, off: -1 },
      { kind: 'disc', c: [6, -28, 14], n: norm([0.3, 0.1, 1]), r: 13, off: 0 },
    ],
  },
  LV: {
    wall: 10,
    k: 6,
    prims: lvPrims(),
    holes: [
      { kind: 'disc', c: add(LV_BASE, scl(LV_AXIS, 9)), n: scl(LV_AXIS, -1), r: 17, off: 0 },
      { kind: 'tubeEnd', a: [19, -2, -16], b: [9, 3, 4], r: 13, t: 0.85 },
    ],
  },
};

export function makeChamberSDF(def) {
  const prims = def.prims, k = def.k;
  const sp = def.subtract ? def.subtract.prims : null;
  const inflate = def.subtract ? def.subtract.inflate : 0;
  const ks = def.subtract ? def.subtract.k : 1;
  return (x, y, z) => {
    let d = primSDF(prims[0], x, y, z);
    for (let i = 1; i < prims.length; i++) d = smin(d, primSDF(prims[i], x, y, z), k);
    if (sp) {
      let e = primSDF(sp[0], x, y, z);
      for (let i = 1; i < sp.length; i++) e = smin(e, primSDF(sp[i], x, y, z), 6);
      if (def.wrap) d = smin(d, rvCrescentSDF(e, x, y, z), k);
      d = smax(d, -(e - inflate), ks);
    }
    return d;
  };
}

// ---------------------------------------------------------------- surface nets
function boundsOf(def) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const p of def.prims) {
    if (p.type === 'ell') {
      const r = Math.max(...p.r);
      for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], p.c[i] - r); mx[i] = Math.max(mx[i], p.c[i] + r); }
    } else {
      for (let i = 0; i < 3; i++) {
        mn[i] = Math.min(mn[i], p.a[i] - p.r, p.b[i] - p.r);
        mx[i] = Math.max(mx[i], p.a[i] + p.r, p.b[i] + p.r);
      }
    }
  }
  if (def.boundsExtra) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], def.boundsExtra[0][i]); mx[i] = Math.max(mx[i], def.boundsExtra[1][i]); }
  for (let i = 0; i < 3; i++) { mn[i] -= 6; mx[i] += 6; }
  return [mn, mx];
}

function surfaceNets(sdf, mn, mx, h) {
  const nx = Math.ceil((mx[0] - mn[0]) / h) + 1;
  const ny = Math.ceil((mx[1] - mn[1]) / h) + 1;
  const nz = Math.ceil((mx[2] - mn[2]) / h) + 1;
  const vals = new Float32Array(nx * ny * nz);
  const idx = (i, j, k) => i + nx * (j + ny * k);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    vals[idx(i, j, k)] = sdf(mn[0] + i * h, mn[1] + j * h, mn[2] + k * h);
  }
  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const cellVert = new Int32Array(cx * cy * cz).fill(-1);
  const cidx = (i, j, k) => i + cx * (j + cy * k);
  const verts = [];
  const corner = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float32Array(8);
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) {
      const v = vals[idx(i + corner[c][0], j + corner[c][1], k + corner[c][2])];
      cv[c] = v; if (v < 0) mask |= 1 << c;
    }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of edges) {
      const va = cv[a], vb = cv[b];
      if ((va < 0) === (vb < 0)) continue;
      const t = va / (va - vb);
      sx += corner[a][0] + t * (corner[b][0] - corner[a][0]);
      sy += corner[a][1] + t * (corner[b][1] - corner[a][1]);
      sz += corner[a][2] + t * (corner[b][2] - corner[a][2]);
      n++;
    }
    cellVert[cidx(i, j, k)] = verts.length / 3;
    verts.push(mn[0] + (i + sx / n) * h, mn[1] + (j + sy / n) * h, mn[2] + (k + sz / n) * h);
  }
  const tris = [];
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) tris.push(a, c, b, a, d, c); else tris.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < cz; k++) for (let j = 1; j < cy; j++) for (let i = 0; i < cx; i++) {
    const v0 = vals[idx(i, j, k)], v1 = vals[idx(i + 1, j, k)];
    if ((v0 < 0) === (v1 < 0)) continue;
    quad(cellVert[cidx(i, j - 1, k - 1)], cellVert[cidx(i, j, k - 1)], cellVert[cidx(i, j, k)], cellVert[cidx(i, j - 1, k)], v0 < 0);
  }
  for (let k = 1; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 1; i < cx; i++) {
    const v0 = vals[idx(i, j, k)], v1 = vals[idx(i, j + 1, k)];
    if ((v0 < 0) === (v1 < 0)) continue;
    quad(cellVert[cidx(i - 1, j, k - 1)], cellVert[cidx(i - 1, j, k)], cellVert[cidx(i, j, k)], cellVert[cidx(i, j, k - 1)], v0 < 0);
  }
  for (let k = 0; k < cz; k++) for (let j = 1; j < cy; j++) for (let i = 1; i < cx; i++) {
    const v0 = vals[idx(i, j, k)], v1 = vals[idx(i, j, k + 1)];
    if ((v0 < 0) === (v1 < 0)) continue;
    quad(cellVert[cidx(i - 1, j - 1, k)], cellVert[cidx(i, j - 1, k)], cellVert[cidx(i, j, k)], cellVert[cidx(i - 1, j, k)], v0 < 0);
  }
  return { verts, tris };
}

function holeTest(h, p) {
  switch (h.kind) {
    case 'disc': {
      const d = sub(p, h.c);
      const a = dot(d, h.n);
      if (a < (h.off || 0)) return false;
      const radial = len(sub(d, scl(h.n, a)));
      return radial < h.r;
    }
    case 'zabove': return p[2] > h.z;
    case 'zbelow': return p[2] < h.z;
    case 'tubeEnd': {
      const ab = sub(h.b, h.a), ap = sub(p, h.a);
      const t = dot(ap, ab) / dot(ab, ab);
      if (t < h.t) return false;
      const radial = len(sub(ap, scl(ab, t)));
      return radial < h.r;
    }
    case 'sphere': return len(sub(p, h.c)) < h.r;
    default: return false;
  }
}

// Builds a single chamber mesh. Returns positions, normals, triangle indices.
function buildChamber(id, h, def = CHAMBER_DEFS[id]) {
  const sdf = makeChamberSDF(def);
  const [mn, mx] = boundsOf(def);
  const { verts, tris } = surfaceNets(sdf, mn, mx, h);
  const nv = verts.length / 3;
  const holes = def.holes.slice();
  if (def.csOsHole) {
    // CS os is opened at the RA surface point nearest the landmark
    let best = -1, bd = Infinity;
    for (let i = 0; i < nv; i++) {
      const d = Math.hypot(verts[3 * i] - L.CS_OS[0], verts[3 * i + 1] - L.CS_OS[1], verts[3 * i + 2] - L.CS_OS[2]);
      if (d < bd) { bd = d; best = i; }
    }
    holes.push({ kind: 'sphere', c: [verts[3 * best], verts[3 * best + 1], verts[3 * best + 2]], r: def.csOsHole });
  }
  const keep = new Uint8Array(nv);
  for (let i = 0; i < nv; i++) {
    const p = [verts[3 * i], verts[3 * i + 1], verts[3 * i + 2]];
    keep[i] = holes.some((hh) => holeTest(hh, p)) ? 0 : 1;
  }
  // keep the largest connected component
  const adj = Array.from({ length: nv }, () => []);
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    if (!keep[a] || !keep[b] || !keep[c]) continue;
    adj[a].push(b, c); adj[b].push(a, c); adj[c].push(a, b);
  }
  const comp = new Int32Array(nv).fill(-1);
  let bestComp = -1, bestSize = 0, cid = 0;
  for (let i = 0; i < nv; i++) {
    if (!keep[i] || comp[i] >= 0) continue;
    const stack = [i]; comp[i] = cid; let size = 0;
    while (stack.length) {
      const v = stack.pop(); size++;
      for (const w of adj[v]) if (comp[w] < 0) { comp[w] = cid; stack.push(w); }
    }
    if (size > bestSize) { bestSize = size; bestComp = cid; }
    cid++;
  }
  const remap = new Int32Array(nv).fill(-1);
  const pos = [];
  for (let i = 0; i < nv; i++) {
    if (comp[i] === bestComp) { remap[i] = pos.length / 3; pos.push(verts[3 * i], verts[3 * i + 1], verts[3 * i + 2]); }
  }
  const idx = [];
  for (let t = 0; t < tris.length; t += 3) {
    const a = remap[tris[t]], b = remap[tris[t + 1]], c = remap[tris[t + 2]];
    if (a >= 0 && b >= 0 && c >= 0 && a !== b && b !== c && a !== c) idx.push(a, b, c);
  }
  const n = pos.length / 3;
  const normals = new Float32Array(n * 3);
  const e = 0.5;
  for (let i = 0; i < n; i++) {
    const x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2];
    const g = norm([sdf(x + e, y, z) - sdf(x - e, y, z), sdf(x, y + e, z) - sdf(x, y - e, z), sdf(x, y, z + e) - sdf(x, y, z - e)]);
    normals[3 * i] = g[0]; normals[3 * i + 1] = g[1]; normals[3 * i + 2] = g[2];
  }
  return { id, positions: new Float32Array(pos), normals, indices: new Uint32Array(idx), sdf, wall: def.wall };
}

// ---------------------------------------------------------------- spatial grid
export class SpatialGrid {
  constructor(pos, count, cell = 5) {
    this.pos = pos; this.cell = cell; this.map = new Map();
    for (let i = 0; i < count; i++) {
      const key = this._key(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]);
      let arr = this.map.get(key);
      if (!arr) { arr = []; this.map.set(key, arr); }
      arr.push(i);
    }
  }
  _key(x, y, z) {
    const c = this.cell;
    return ((Math.floor(x / c) + 512) * 1024 + (Math.floor(y / c) + 512)) * 1024 + (Math.floor(z / c) + 512);
  }
  // Calls fn(index, distance) for every node within radius r of p.
  query(p, r, fn) {
    const c = this.cell, pos = this.pos;
    const x0 = Math.floor((p[0] - r) / c), x1 = Math.floor((p[0] + r) / c);
    const y0 = Math.floor((p[1] - r) / c), y1 = Math.floor((p[1] + r) / c);
    const z0 = Math.floor((p[2] - r) / c), z1 = Math.floor((p[2] + r) / c);
    const r2 = r * r;
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      const arr = this.map.get(((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512));
      if (!arr) continue;
      for (const i of arr) {
        const dx = pos[3 * i] - p[0], dy = pos[3 * i + 1] - p[1], dz = pos[3 * i + 2] - p[2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 <= r2) fn(i, Math.sqrt(d2));
      }
    }
  }
  nearest(p, maxR = 40, filter = null) {
    let best = -1, bd = Infinity;
    for (let r = 4; r <= maxR && best < 0; r *= 2) {
      this.query(p, r, (i, d) => { if (d < bd && (!filter || filter(i))) { bd = d; best = i; } });
    }
    return best;
  }
}

// ---------------------------------------------------------------- whole heart
// Builds all four chambers, merges them into one global node array and builds the
// mesh-edge adjacency (CSR). Inter-chamber connections are added later by the
// scenario builder as explicit links.
export function buildHeart(h = 2.2) {
  const chambers = CHAMBER_IDS.map((id) => buildChamber(id, h));
  let total = 0;
  for (const c of chambers) { c.offset = total; c.count = c.positions.length / 3; total += c.count; }
  const pos = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  const chamber = new Uint8Array(total);
  const edgeSet = new Map();
  for (const [ci, c] of chambers.entries()) {
    pos.set(c.positions, c.offset * 3);
    normal.set(c.normals, c.offset * 3);
    chamber.fill(ci, c.offset, c.offset + c.count);
    const I = c.indices;
    for (let t = 0; t < I.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        let a = I[t + e] + c.offset, b = I[t + ((e + 1) % 3)] + c.offset;
        if (a > b) { const tmp = a; a = b; b = tmp; }
        edgeSet.set(a * 100000 + b, 1);
      }
    }
  }
  const deg = new Int32Array(total + 1);
  const pairs = [];
  for (const key of edgeSet.keys()) {
    const a = Math.floor(key / 100000), b = key % 100000;
    pairs.push(a, b); deg[a]++; deg[b]++;
  }
  const off = new Int32Array(total + 1);
  for (let i = 0; i < total; i++) off[i + 1] = off[i] + deg[i];
  const fill = off.slice(0, total);
  const to = new Int32Array(off[total]);
  const elen = new Float32Array(off[total]);
  for (let p = 0; p < pairs.length; p += 2) {
    const a = pairs[p], b = pairs[p + 1];
    const d = Math.hypot(pos[3 * a] - pos[3 * b], pos[3 * a + 1] - pos[3 * b + 1], pos[3 * a + 2] - pos[3 * b + 2]);
    to[fill[a]] = b; elen[fill[a]++] = d;
    to[fill[b]] = a; elen[fill[b]++] = d;
  }
  // boundary (hole rim) nodes: vertices on an edge used by only one triangle
  const boundary = new Uint8Array(total);
  for (const c of chambers) {
    const cnt = new Map();
    const I = c.indices;
    for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) {
      let a = I[t + e], b = I[t + ((e + 1) % 3)];
      if (a > b) { const tmp = a; a = b; b = tmp; }
      const k = a * 100000 + b; cnt.set(k, (cnt.get(k) || 0) + 1);
    }
    for (const [k, v] of cnt) if (v === 1) { boundary[Math.floor(k / 100000) + c.offset] = 1; boundary[(k % 100000) + c.offset] = 1; }
  }
  const grid = new SpatialGrid(pos, total, 5);
  const heart = { chambers, count: total, pos, normal, chamber, adjOff: off, adjTo: to, adjLen: elen, grid, boundary };
  heart.landmarks = snapLandmarks(heart);
  return heart;
}

// Which chamber each landmark lives on (for snapping to the shell).
const LANDMARK_CHAMBER = {
  HIS: 'RA', COMPACT_AVN: 'RA', FP_ENTRY: 'RA', SP_ENTRY: 'RA', CS_OS: 'RA', TV_CENTER: null,
  CTI_MEDIAL: 'RA', CTI_TA: 'RA', CTI_IVC: 'RA', IVC_ORIFICE: 'RA', SVC_ORIFICE: 'RA', SINUS_NODE: 'RA',
  CRISTA_TOP: 'RA', CRISTA_MID: 'RA', CRISTA_BOTTOM: 'RA', LOW_LATERAL_RA: 'RA', RAA: 'RA', HRA_CATH: 'RA',
  FOSSA_OVALIS: 'LA', MV_CENTER: null, LSPV: 'LA', LIPV: 'LA', RSPV: 'LA', RIPV: 'LA', LAA: 'LA', LA_ROOF: 'LA',
  LAT_MA: 'LA', CS_9_10: 'LA', CS_7_8: 'LA', CS_5_6: 'LA', CS_3_4: 'LA', CS_1_2: 'LA',
  AORTIC_NCC: null, AORTIC_RCC: null, AORTIC_LCC: null, PULMONARY_VALVE: 'RV', RVOT_SEPTAL: 'RV', RVOT_FREE: 'RV',
  RV_APEX: 'RV', LV_APEX: 'LV', LBB_ORIGIN: null, RBB_ORIGIN: null, PHRENIC_R: 'RA', ESOPHAGUS: null,
};

export function nearestInChamber(heart, p, chamberId) {
  const ci = CHAMBER_INDEX[chamberId];
  return heart.grid.nearest(p, 80, (i) => heart.chamber[i] === ci);
}

function snapLandmarks(heart) {
  const out = {};
  for (const [k, p] of Object.entries(LANDMARKS_RAW)) {
    const ch = LANDMARK_CHAMBER[k];
    if (ch) {
      const n = nearestInChamber(heart, p, ch);
      out[k] = { node: n, pos: [heart.pos[3 * n], heart.pos[3 * n + 1], heart.pos[3 * n + 2]], chamber: ch, raw: p };
    } else {
      out[k] = { node: -1, pos: p.slice(), chamber: null, raw: p };
    }
  }
  return out;
}

// Shortest path along mesh edges from node a to node b (Dijkstra). `ok(n)` may veto nodes.
export function geodesicPath(heart, a, b, ok = null) {
  const N = heart.count;
  const dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
  const open = [[0, a]]; dist[a] = 0;
  const push = (d, n) => { open.push([d, n]); let i = open.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (open[p][0] <= open[i][0]) break; [open[p], open[i]] = [open[i], open[p]]; i = p; } };
  const pop = () => { const top = open[0], last = open.pop(); if (open.length) { open[0] = last; let i = 0; for (;;) { let c = 2 * i + 1; if (c >= open.length) break; if (c + 1 < open.length && open[c + 1][0] < open[c][0]) c++; if (open[i][0] <= open[c][0]) break; [open[c], open[i]] = [open[i], open[c]]; i = c; } } return top; };
  while (open.length) {
    const [d, n] = pop();
    if (d > dist[n]) continue;
    if (n === b) break;
    for (let e = heart.adjOff[n]; e < heart.adjOff[n + 1]; e++) {
      const m = heart.adjTo[e];
      if (ok && !ok(m) && m !== b) continue;
      const nd = d + heart.adjLen[e];
      if (nd < dist[m]) { dist[m] = nd; prev[m] = n; push(nd, m); }
    }
  }
  if (prev[b] < 0 && a !== b) return [];
  const path = [];
  for (let n = b; n >= 0; n = prev[n]) { path.push(n); if (n === a) break; }
  return path.reverse();
}

// Nearest hole-rim node to p within a chamber.
export function nearestBoundary(heart, p, chamberId) {
  const ci = CHAMBER_INDEX[chamberId];
  return heart.grid.nearest(p, 80, (i) => heart.chamber[i] === ci && heart.boundary[i]);
}

// Polyline of nodes through a list of anchor nodes.
export function pathThrough(heart, anchors, ok = null) {
  let out = [];
  for (let i = 0; i < anchors.length - 1; i++) {
    const seg = geodesicPath(heart, anchors[i], anchors[i + 1], ok);
    out = out.concat(i === 0 ? seg : seg.slice(1));
  }
  return out;
}

// LAO clock-face position on an annulus. 12 o'clock = superior, 3 o'clock = toward the
// viewer's right in LAO 45 (patient left-posterior). Used to place accessory pathways.
export function annulusPoint(center, normal, radius, hour) {
  const n = norm(normal);
  const proj = (v) => norm(sub(v, scl(n, dot(v, n))));
  const up = proj([0, 0, 1]);
  const right = proj([0.707, 0.707, 0]);
  const th = (hour % 12) * Math.PI / 6;
  return add(center, scl(add(scl(up, Math.cos(th)), scl(right, Math.sin(th))), radius));
}
export { TV_N, MV_N, LV_AXIS, LV_BASE, RV_SIDE };

// ---------------------------------------------------------------- display mesh
// A finer shell built from the same SDFs and orifices as the engine mesh, with
// endocardial relief for realism: ventricular trabeculations (densest toward the apex),
// RA pectinate muscles anterior to the crista terminalis, a raised crista ridge, and
// LAA pectinates. The relief is purely visual (<= ~1.5 mm); every display vertex maps to
// its nearest engine node in the same chamber for map colouring and picking.

function hash3(i, j, k) {
  let h = (i * 374761393 + j * 668265263 + k * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v), l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
// ridged noise in [0,1]: thin raised ridges where the noise crosses 0.5
const ridge = (x, y, z) => { const r = 1 - Math.abs(2 * vnoise(x, y, z) - 1); return r * r * r; };
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function distToPolyline(p, line) {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], ab = sub(line[i + 1], a), ap = sub(p, a);
    const t = Math.max(0, Math.min(1, dot(ap, ab) / dot(ab, ab)));
    best = Math.min(best, len(sub(ap, scl(ab, t))));
  }
  return best;
}
const CRISTA_LINE = [[-30, 21, 40], L.CRISTA_TOP, L.CRISTA_MID, L.CRISTA_BOTTOM, [-28, 27, -40]];
const RV_BASE = L.TV_CENTER, RV_AX = norm(sub(L.RV_APEX, L.TV_CENTER)), RV_AXL = len(sub(L.RV_APEX, L.TV_CENTER));
const LV_AXL = len(sub(L.LV_APEX, LV_BASE));
const LAA_C = [55, 10, 28];
const perpLV = (v) => norm(sub(v, scl(LV_AXIS, dot(v, LV_AXIS))));
const LV_PM_DIRS = [perpLV(norm([0.75, -0.65, 0.1])), perpLV(norm([0.2, 0.55, -0.8]))]; // anterolateral, posteromedial

// coordinates in a frame whose first axis is `ax`, scaled so ridges elongate along ax
const FRAMES = new Map();
function stretched(p, ax, sAlong, sAcross) {
  let B = FRAMES.get(ax);
  if (!B) { B = basisFromAxis(ax); FRAMES.set(ax, B); }
  return [dot(p, B[0]) * sAlong, dot(p, B[1]) * sAcross, dot(p, B[2]) * sAcross];
}

// inward relief (mm, positive = protrudes into the cavity)
function relief(id, p) {
  const base = (vnoise(p[0] * 0.06 + 11, p[1] * 0.06, p[2] * 0.06) - 0.5) * 0.6; // gentle irregularity
  if (id === 'LV' || id === 'RV') {
    const ax = id === 'LV' ? LV_AXIS : RV_AX, b0 = id === 'LV' ? LV_BASE : RV_BASE, L0 = id === 'LV' ? LV_AXL : RV_AXL;
    const apical = sstep(0.15, 0.95, dot(sub(p, b0), ax) / L0);
    const q = stretched(p, ax, 0.09, 0.32);
    const tr = ridge(q[0], q[1], q[2]) * 0.75 + ridge(q[0] * 1.9 + 5, q[1] * 1.9, q[2] * 1.9) * 0.35;
    const amp = id === 'RV' ? 1.6 * (0.35 + 0.65 * apical) : 1.15 * apical;
    let pm = 0;
    if (id === 'LV') {
      // anterolateral and posteromedial papillary muscles: columns rising from the
      // mid/apical free wall toward the base (chordae not modelled)
      const d = sub(p, LV_BASE), sAx = dot(d, LV_AXIS), r = sub(d, scl(LV_AXIS, sAx)), rl = len(r) || 1;
      const win = sstep(28, 38, sAx) * sstep(70, 58, sAx) * (0.55 + 0.45 * sstep(62, 40, sAx));
      for (const dir of LV_PM_DIRS) {
        const arc = Math.acos(Math.max(-1, Math.min(1, dot(r, dir) / rl))) * rl; // mm along the wall
        pm = Math.max(pm, 9.5 * Math.exp(-(arc * arc) / (2 * 4.2 * 4.2)) * win);
      }
    }
    return base + tr * amp + pm;
  }
  if (id === 'RA') {
    const dc = distToPolyline(p, CRISTA_LINE);
    const crista = 1.4 * Math.exp(-(dc * dc) / 10);
    // pectinates: parallel ridges on the anterolateral wall / appendage (anterior to the crista)
    const anterior = sstep(20, 10, p[1]) * sstep(-20, -34, p[0]) * sstep(-40, -26, p[2]);
    const pm = Math.pow(Math.abs(Math.sin(p[2] * 0.6 + vnoise(p[0] * 0.08, p[1] * 0.08, p[2] * 0.04) * 2)), 8);
    return base * 0.6 + crista + pm * 0.7 * anterior;
  }
  // LA: smooth body, pectinate ridges in the appendage only
  const dA = len(sub(p, LAA_C));
  const laa = sstep(15, 7, dA);
  return base * 0.6 + laa * ridge(p[0] * 0.35, p[1] * 0.35, p[2] * 0.35) * 0.9;
}

export function buildVisualHeart(heart, h = 1.5) {
  return heart.chambers.map((ec, ci) => {
    const vc = buildChamber(ec.id, h);
    const n = vc.positions.length / 3;
    const P = vc.positions, N = vc.normals;
    const nodeOf = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const p = [P[3 * i], P[3 * i + 1], P[3 * i + 2]];
      nodeOf[i] = heart.grid.nearest(p, 40, (k) => heart.chamber[k] === ci);
      // fade the relief out at orifice rims so valve / vein openings stay clean
      const rim = heart.boundary[nodeOf[i]] ? 0.2 : 1;
      const d = relief(ec.id, p) * rim;
      P[3 * i] -= N[3 * i] * d; P[3 * i + 1] -= N[3 * i + 1] * d; P[3 * i + 2] -= N[3 * i + 2] * d;
    }
    return { id: ec.id, positions: P, indices: vc.indices, nodeOf };
  });
}
