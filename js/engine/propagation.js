// Event-driven graph cellular automaton (research spec §2.2-2.3).
//
// Nodes are the mesh vertices of all chambers plus a handful of "virtual" nodes that
// represent the conduction system (AV-node pathways, His, bundle branches, accessory
// pathways, Purkinje trigger). Mesh edges conduct with travel = length / CV. Explicit
// links carry fixed delays (inter-atrial bundles, septum, Purkinje) or pathway delay
// functions with recovery-dependent conduction (AVN dual pathway, AP).
//
// Each node has REST / EXCITED / REFRACTORY behaviour encoded by lastAct + refrEnd.
// Arrivals are scheduled in a priority queue; only the earliest pending arrival per
// node is kept; arrivals during the absolute refractory period are dropped.

import { EventHeap } from '../util/heap.js';

export const TISSUE = {
  ATRIUM: 0, CRISTA: 1, CTI: 2, PV_SLEEVE: 3, VENTRICLE: 4, BORDER_ZONE: 5, SLOW_CHANNEL: 6,
  DENSE_SCAR: 7, ABLATED_CORE: 8, VIRTUAL: 9, BLOCK_LINE: 10, AF_ATRIUM: 11,
};
export const TISSUE_NAME = Object.fromEntries(Object.entries(TISSUE).map(([k, v]) => [v, k]));

// Tissue lookup table (research spec §1.5); cv in mm/ms, bipolar range in mV.
export const TISSUE_TABLE = {
  [TISSUE.ATRIUM]: { cv: 0.8, erp600: 230, bip: [1.5, 5.0], exp: 0.3, mass: 0.15, w: 3 },
  [TISSUE.AF_ATRIUM]: { cv: 0.6, erp600: 150, bip: [0.8, 3.0], exp: 0.3, mass: 0.15, w: 3 },
  [TISSUE.CRISTA]: { cv: 1.2, erp600: 230, bip: [1.5, 4.0], exp: 0.3, mass: 0.15, w: 3 },
  [TISSUE.CTI]: { cv: 0.6, erp600: 230, bip: [0.8, 3.0], exp: 0.3, mass: 0.15, w: 3 },
  [TISSUE.PV_SLEEVE]: { cv: 0.45, erp600: 180, bip: [0.5, 3.0], exp: 0.3, mass: 0.05, w: 1.5 },
  [TISSUE.VENTRICLE]: { cv: 0.6, erp600: 240, bip: [1.5, 8.0], exp: 0.3, mass: 1.0, w: 3 },
  [TISSUE.BORDER_ZONE]: { cv: 0.25, erp600: 280, bip: [0.5, 1.5], exp: 0.3, mass: 0.3, w: 6, frac: 0.5 },
  [TISSUE.SLOW_CHANNEL]: { cv: 0.10, erp600: 280, bip: [0.3, 0.8], exp: 0.3, mass: 0.1, w: 6, frac: 0.8 },
  [TISSUE.DENSE_SCAR]: { cv: 0, erp600: 0, bip: [0.05, 0.45], exp: 0.3, mass: 0, w: 6 },
  [TISSUE.ABLATED_CORE]: { cv: 0, erp600: 0, bip: [0.02, 0.2], exp: 0.3, mass: 0, w: 6 },
  [TISSUE.BLOCK_LINE]: { cv: 0, erp600: 0, bip: [0.8, 2.0], exp: 0.3, mass: 0.1, w: 3 },
  [TISSUE.VIRTUAL]: { cv: 1, erp600: 100, bip: [0, 0], exp: 0.3, mass: 0, w: 2 },
};

export const SRC = { STIM: -2, FOCUS: -3, LINK: -4, NONE: -1, SEED: -5 };

export class Engine {
  constructor(heart, extraVirtual = 24) {
    this.heart = heart;
    this.nMesh = heart.count;
    const N = (this.N = heart.count + extraVirtual);
    this.nVirtual = 0;
    this.pos = new Float32Array(N * 3); this.pos.set(heart.pos);
    this.chamber = new Uint8Array(N); this.chamber.set(heart.chamber);
    this.tissue = new Uint8Array(N);
    this.cv = new Float32Array(N);
    this.cvScale = new Float32Array(N).fill(1);
    this.erp600 = new Float32Array(N);
    this.erpExp = new Float32Array(N).fill(0.3);
    this.erpNoise = new Float32Array(N).fill(1);
    this.bip = new Float32Array(N);
    this.wall = new Float32Array(N);
    this.lastAct = new Float64Array(N).fill(-1e9);
    this.refrEnd = new Float64Array(N).fill(-1e9);
    this.pending = new Float64Array(N).fill(Infinity);
    this.actSrc = new Int32Array(N).fill(-1);
    this.H = 8; // activation history depth (for LAT lookup)
    this.hist = new Float64Array(N * this.H).fill(-1e9);
    this.histIdx = new Uint8Array(N);
    this.links = new Array(N); // sparse: array of link objects per node
    this.virtualInfo = new Array(N); // {name, pw, spike}
    this.heap = new EventHeap(1 << 15);
    this.t = 0;
    this.timers = []; // {t, fn, id}
    this.timerSeq = 1;
    this.rrp = 30;
    this.erpMulA = 1; this.erpMulV = 1; // drug multipliers
    this.cvMul = new Float32Array(4).fill(1); // per chamber CV multiplier (case tuning)
    this.onActivate = null; // callback(node, t, src)
    this.actCount = 0;
    this.names = {};
  }

  // --------------------------------------------------------------- setup helpers
  setTissue(n, tissue, opts = {}) {
    const tt = TISSUE_TABLE[tissue];
    this.tissue[n] = tissue;
    this.cv[n] = opts.cv ?? tt.cv;
    this.erp600[n] = opts.erp ?? tt.erp600;
    this.erpExp[n] = opts.exp ?? tt.exp;
    if (opts.bip != null) this.bip[n] = opts.bip;
    else {
      const [lo, hi] = tt.bip;
      // log-uniform sample within the range, deterministic per node
      const u = hash01(n * 7 + tissue);
      this.bip[n] = lo * Math.pow(hi / lo, 0.25 + 0.6 * u);
    }
  }

  addVirtual(name, pos, opts = {}) {
    const n = this.nMesh + this.nVirtual++;
    if (n >= this.N) throw new Error('Too many virtual nodes');
    this.pos[3 * n] = pos[0]; this.pos[3 * n + 1] = pos[1]; this.pos[3 * n + 2] = pos[2];
    this.chamber[n] = 9;
    this.setTissue(n, TISSUE.VIRTUAL, { erp: opts.erp ?? 100, exp: opts.exp ?? 0.3, bip: 0 });
    this.virtualInfo[n] = { name, pw: opts.pw || null, spike: opts.spike || null, group: opts.group || null };
    this.names[name] = n;
    return n;
  }

  // link: {to, delay} or {to, pw, dir:'antero'|'retro'}
  addLink(from, to, props) {
    const L = Object.assign({ from, to, enabled: true }, props);
    (this.links[from] || (this.links[from] = [])).push(L);
    return L;
  }

  // --------------------------------------------------------------- timers
  addTimer(t, fn) {
    const id = this.timerSeq++;
    this.timers.push({ t, fn, id });
    return id;
  }
  cancelTimer(id) { this.timers = this.timers.filter((x) => x.id !== id); }

  _nextTimer() {
    let best = null;
    for (const tm of this.timers) if (!best || tm.t < best.t) best = tm;
    return best;
  }

  // --------------------------------------------------------------- propagation
  erpOf(n, prevCL) {
    const cl = prevCL < 200 ? 200 : prevCL > 1500 ? 1500 : prevCL;
    const ch = this.chamber[n];
    const mul = ch <= 1 ? this.erpMulA : ch <= 3 ? this.erpMulV : 1;
    return this.erp600[n] * this.erpNoise[n] * Math.pow(cl / 600, this.erpExp[n]) * mul;
  }

  schedule(n, t, src) {
    if (t < this.refrEnd[n]) return; // absolute refractory: blocked
    if (t < this.pending[n]) {
      this.pending[n] = t;
      this.heap.push(t, n, src);
    }
  }

  // External stimulus to a set of nodes. Returns number of nodes that can capture.
  stimulate(nodes, t = this.t, src = SRC.STIM) {
    let ok = 0;
    for (const n of nodes) {
      if (this.cv[n] * this.cvScale[n] <= 0) continue;
      if (t >= this.refrEnd[n]) { ok++; this.schedule(n, t, src); }
    }
    return ok;
  }

  _activate(n, t, src) {
    const prevCL = t - this.lastAct[n];
    this.lastAct[n] = t;
    this.actSrc[n] = src;
    const erp = this.erpOf(n, prevCL);
    this.refrEnd[n] = t + erp;
    const hi = this.histIdx[n];
    this.hist[n * this.H + hi] = t;
    this.histIdx[n] = (hi + 1) % this.H;
    this.actCount++;
    if (this.onActivate) this.onActivate(n, t, src, erp);

    // mesh neighbours
    const off = this.heart.adjOff;
    if (n < this.nMesh) {
      const to = this.heart.adjTo, len = this.heart.adjLen;
      for (let e = off[n], end = off[n + 1]; e < end; e++) {
        const m = to[e];
        let cv = this.cv[m] * this.cvScale[m] * this.cvMul[this.chamber[m]];
        if (cv <= 0) continue;
        let tArr = t + len[e] / cv;
        if (tArr < this.refrEnd[m]) continue;
        // relative refractory period slows conduction (decrement, wavebreak)
        if (tArr < this.refrEnd[m] + this.rrp && this.lastAct[m] > -1e8) {
          const f = 0.3 + 0.7 * (tArr - this.refrEnd[m]) / this.rrp;
          cv *= f < 0.3 ? 0.3 : f;
          tArr = t + len[e] / Math.max(cv, 0.02);
        }
        this.schedule(m, tArr, n);
      }
    }
    // explicit links
    const Ls = this.links[n];
    if (Ls) {
      for (const L of Ls) {
        if (!L.enabled) continue;
        const m = L.to;
        if (this.cv[m] * this.cvScale[m] <= 0) continue;
        let d;
        if (L.pw) {
          // Pathway with recovery-dependent conduction (research spec §1.4):
          // condTime(RP) = base + A*exp(-(RP-ERP)/tau), BLOCK if RP < ERP.
          // RP is measured from the previous *entry* into the pathway (either
          // direction, so retrograde concealment counts). ERP lengthens when the
          // preceding cycle was short (k term), so Wenckebach emerges with
          // incremental pacing while S1S2 at a 600 ms drive gives the nominal ERP.
          const pw = L.pw;
          if (pw.blocked) continue;
          const prm = L.dir === 'antero' ? pw.antero : pw.retro;
          if (!prm) continue;
          const rp = t - pw.last;
          const prevCL = pw.prevCL > 1500 ? 1500 : pw.prevCL;
          const erpP = (prm.erp + (prm.k || 0) * Math.max(0, 600 - prevCL)) * (pw.erpMul || 1);
          if (rp < erpP) continue; // pathway refractory: block
          d = prm.base * (pw.delayMul || 1) + prm.A * Math.exp(-(rp - erpP) / prm.tau);
          pw.prevCL = rp; pw.last = t; pw.lastDir = L.dir; pw.count = (pw.count || 0) + 1;
        } else {
          d = L.delay;
        }
        this.schedule(m, t + d, n);
      }
    }
  }

  // Advance simulation to time `target` (ms).
  advance(target) {
    const heap = this.heap;
    let guard = 0;
    for (;;) {
      const tq = heap.size ? heap.t[0] : Infinity;
      const tm = this.timers.length ? this._nextTimer() : null;
      const tt = tm ? tm.t : Infinity;
      const tn = tq < tt ? tq : tt;
      if (tn > target) break;
      if (tt <= tq) {
        this.timers.splice(this.timers.indexOf(tm), 1);
        this.t = tt;
        tm.fn(tt);
        continue;
      }
      heap.pop();
      const t = heap.outT, n = heap.outN, s = heap.outS;
      if (t !== this.pending[n]) continue; // stale entry
      this.pending[n] = Infinity;
      if (t < this.refrEnd[n]) continue;
      if (this.cv[n] * this.cvScale[n] <= 0) continue;
      this.t = t;
      this._activate(n, t, s);
      if (++guard > 2e6) { console.warn('engine guard hit'); break; }
    }
    this.t = target;
  }

  // Most recent activation of node n within [t0, t1], or NaN.
  actInWindow(n, t0, t1) {
    const H = this.H, base = n * H;
    let best = NaN;
    for (let k = 0; k < H; k++) {
      const v = this.hist[base + k];
      if (v >= t0 && v <= t1 && !(v <= best)) best = v;
    }
    return best;
  }
  // First activation of node n within [t0, t1], or NaN.
  firstActInWindow(n, t0, t1) {
    const H = this.H, base = n * H;
    let best = NaN;
    for (let k = 0; k < H; k++) {
      const v = this.hist[base + k];
      if (v >= t0 && v <= t1 && !(v >= best)) best = v;
    }
    return best;
  }

  // Force nodes refractory until time tEnd (used for reentry seeding and defibrillation).
  makeRefractory(nodes, tEnd) {
    for (const n of nodes) {
      if (this.refrEnd[n] < tEnd) this.refrEnd[n] = tEnd;
      this.pending[n] = Infinity;
    }
  }

  // Global reset of pending wavefronts (defibrillation): every node refractory for dur ms.
  shock(dur = 250) {
    const tEnd = this.t + dur;
    for (let n = 0; n < this.N; n++) {
      this.pending[n] = Infinity;
      if (this.refrEnd[n] < tEnd) this.refrEnd[n] = tEnd;
    }
    this.heap.clear();
  }
}

// Deterministic hash in [0,1).
export function hash01(i) {
  let x = (i | 0) * 2654435761;
  x ^= x >>> 15; x = Math.imul(x, 2246822519); x ^= x >>> 13; x = Math.imul(x, 3266489917); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
