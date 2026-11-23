// Electrogram and surface ECG synthesis (research spec §2.7, §2.8).
//
// Every node activation adds an impulse into per-channel ring buffers; a deferred
// "finalize" pass convolves the impulses with Gaussian kernels (sharp / normal /
// broad), adds noise and pacing artefacts, and writes the displayable 1 kHz samples.
//
// Unipolar model: a node at distance r contributes A*K(r) with K = 1/(r^2 + r0^2) and
// a sign that is + while the local wavefront moves toward the electrode and - when it
// moves away. Bipolar = unipole1 - unipole2, so near-field signals are sharp and
// far-field contributions largely cancel. At a focal origin every neighbour activates
// "away", which yields the unipolar QS used as an ablation cue.
//
// ECG: the heart vector is the sum of (local propagation direction x tissue mass) of
// the nodes activating each millisecond; leads are projections on lead vectors. The T
// wave is a delayed, broad, concordant copy at t + APD.

import { TISSUE, TISSUE_TABLE, hash01 } from './propagation.js';

export const RING = 20000; // 20 s at 1 kHz
const LAG = 120; // finalize delay (ms) so kernels and fractionation are complete
const R0SQ = 4;

const LEADS = {
  I: [1, 0, 0],
  II: [0.5, 0, -0.866],
  V1: [-0.45, -0.85, -0.1],
  aVF: [0, 0, -1],
};

const KERNELS = [makeKernel(1.4), makeKernel(3), makeKernel(6.5)];
const KERNEL_ECG = makeKernel(5);
const KERNEL_T = makeKernel(32);

function makeKernel(w) {
  const h = Math.ceil(w * 3);
  const k = new Float32Array(2 * h + 1);
  for (let i = -h; i <= h; i++) k[i + h] = Math.exp(-(i * i) / (2 * w * w));
  return { h, k };
}

export class EGMSystem {
  constructor(sim) {
    this.sim = sim;
    this.eng = sim.engine;
    this.channels = [];
    this.byId = {};
    this.finT = 0; // samples finalized up to (exclusive), ms
    this.stimMark = new Float32Array(RING);
    this.cal = 2.2; // global amplitude calibration
    this.noise = 0.012;
    // surface leads
    for (const [id, v] of Object.entries(LEADS)) {
      const ch = this._mk(id, id, 'surface');
      ch.lead = v;
      ch.imp = new Float32Array(RING); ch.impT = new Float32Array(RING);
    }
    sim.subscribers.push((n, t, src, erp) => this.onAct(n, t, src, erp));
  }

  _mk(id, label, kind) {
    const ch = { id, label, kind, out: new Float32Array(RING), visible: true, gain: 1 };
    this.channels.push(ch); this.byId[id] = ch;
    return ch;
  }

  // Define / redefine an intracardiac channel from pole positions (p2 null -> unipolar).
  setChannel(id, label, group, p1, p2) {
    let ch = this.byId[id];
    if (!ch) {
      ch = this._mk(id, label, 'icd');
      ch.group = group;
      ch.imp = [new Float32Array(RING), new Float32Array(RING), new Float32Array(RING)];
      ch.entryOf = new Int32Array(this.eng.N).fill(-1);
      ch.entries = [];
      ch.actsA = []; ch.actsV = [];
    }
    for (const n of ch.entries) ch.entryOf[n] = -1;
    ch.p1 = p1; ch.p2 = p2;
    ch.center = p2 ? [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2, (p1[2] + p2[2]) / 2] : p1;
    ch.entries = []; ch.k1 = []; ch.k2 = []; ch.local = [];
    if (!p1) return ch;
    const eng = this.eng;
    this.sim.heart.grid.query(ch.center, 16, (n) => {
      const x = eng.pos[3 * n], y = eng.pos[3 * n + 1], z = eng.pos[3 * n + 2];
      const r1 = (x - p1[0]) ** 2 + (y - p1[1]) ** 2 + (z - p1[2]) ** 2;
      const k1 = 1 / (r1 + R0SQ);
      let k2 = 0, r2 = r1;
      if (p2) { r2 = (x - p2[0]) ** 2 + (y - p2[1]) ** 2 + (z - p2[2]) ** 2; k2 = 1 / (r2 + R0SQ); }
      ch.entryOf[n] = ch.entries.length;
      ch.entries.push(n); ch.k1.push(k1); ch.k2.push(k2);
      ch.local.push(Math.min(r1, r2) < 20 ? 1 : 0); // within ~4.5 mm: local activation
    });
    // virtual-node spikes (His, AP, Purkinje) near the poles
    ch.spikes = [];
    for (let v = eng.nMesh; v < eng.nMesh + eng.nVirtual; v++) {
      const vi = eng.virtualInfo[v];
      if (!vi || !vi.spike) continue;
      const d = Math.hypot(eng.pos[3 * v] - ch.center[0], eng.pos[3 * v + 1] - ch.center[1], eng.pos[3 * v + 2] - ch.center[2]);
      if (d < vi.spike.r) { ch.entryOf[v] = -2 - ch.spikes.length; ch.spikes.push({ v, amp: vi.spike.amp * (1 - d / vi.spike.r) }); ch.entries.push(v); }
    }
    return ch;
  }

  markStim(t, chamberGroup) {
    this.stimMark[Math.floor(t) % RING] = 1;
    this.lastStim = t;
  }

  onAct(n, t, src, erp) {
    const eng = this.eng;
    const idx = Math.floor(t);
    const tissue = eng.tissue[n];
    const isMesh = n < eng.nMesh;
    // propagation direction
    let dx = 0, dy = 0, dz = 0;
    if (isMesh && src >= 0 && src < eng.nMesh) {
      dx = eng.pos[3 * n] - eng.pos[3 * src]; dy = eng.pos[3 * n + 1] - eng.pos[3 * src + 1]; dz = eng.pos[3 * n + 2] - eng.pos[3 * src + 2];
      const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
    }
    const tt = TISSUE_TABLE[tissue];
    // ---- ECG
    if (isMesh && tt.mass > 0 && (dx || dy || dz)) {
      const m = tt.mass * (eng.chamber[n] >= 2 ? 1 : 1.6);
      const ti = idx % RING, tT = (idx + Math.round(erp + 25)) % RING;
      for (const id in LEADS) {
        const ch = this.byId[id];
        const pr = (dx * ch.lead[0] + dy * ch.lead[1] + dz * ch.lead[2]) * m;
        ch.imp[ti] += pr;
        if (eng.chamber[n] >= 2) ch.impT[tT] += pr * 0.07;
      }
    }
    // ---- intracardiac channels
    const chs = this.channels;
    for (let c = 0; c < chs.length; c++) {
      const ch = chs[c];
      if (ch.kind !== 'icd' || !ch.entryOf) continue;
      const e = ch.entryOf[n];
      if (e === -1) continue;
      if (e <= -2) { // spike
        const sp = ch.spikes[-2 - e];
        const i0 = idx % RING;
        ch.imp[0][i0] += sp.amp * 6; ch.imp[0][(idx + 2) % RING] -= sp.amp * 6;
        continue;
      }
      if (!isMesh) continue;
      const x = eng.pos[3 * n], y = eng.pos[3 * n + 1], z = eng.pos[3 * n + 2];
      const p1 = ch.p1, p2 = ch.p2;
      const toward = (p) => {
        if (!(dx || dy || dz)) return -1; // origin of activation: receding everywhere
        const s = dx * (p[0] - x) + dy * (p[1] - y) + dz * (p[2] - z);
        return s >= 0 ? 1 : -1;
      };
      const amp = eng.bip[n] * this.cal;
      let v = toward(p1) * ch.k1[e];
      if (p2) v -= toward(p2) * ch.k2[e];
      v *= amp;
      const kernel = tt.w <= 1.6 ? 0 : tt.w >= 5 ? 2 : 1;
      if (tt.frac) {
        // fractionated, multicomponent electrogram
        const span = 15 + tt.frac * 45;
        const k = 3 + Math.floor(hash01(n + idx) * 3);
        for (let j = 0; j < k; j++) {
          const off = Math.floor(hash01(n * 7 + j * 13 + idx) * span);
          ch.imp[1][(idx + off) % RING] += v * (j % 2 ? -0.7 : 0.9) / k * 2;
        }
      } else ch.imp[kernel][idx % RING] += v;
      if (ch.local[e]) this._localAct(ch, eng.chamber[n] >= 2 ? ch.actsV : ch.actsA, t);
    }
  }

  _localAct(ch, arr, t) {
    if (arr.length && t - arr[arr.length - 1] < 45) return;
    arr.push(t);
    if (arr.length > 64) arr.shift();
  }

  // Finalize samples up to engine time - LAG.
  finalize() {
    const target = Math.floor(this.eng.t) - LAG;
    if (target <= this.finT) return;
    // after a long jump only the last ring length is meaningful
    if (target - this.finT > RING - 400) this.finT = target - (RING - 400);
    for (let s = this.finT; s < target; s++) this._finalizeSample(s);
    this.finT = target;
  }

  _finalizeSample(s) {
    const i = ((s % RING) + RING) % RING;
    const stim = this.stimMark[i];
    for (const ch of this.channels) {
      let v = 0;
      if (ch.kind === 'surface') {
        v = conv(ch.imp, KERNEL_ECG, s) * 0.022 + conv(ch.impT, KERNEL_T, s) * 0.022;
        v += (hash01(s * 31 + ch.id.length) - 0.5) * 0.02;
      } else {
        v = conv(ch.imp[0], KERNELS[0], s) + conv(ch.imp[1], KERNELS[1], s) + conv(ch.imp[2], KERNELS[2], s);
        v += (hash01(s * 17 + ch.label.length * 101) - 0.5) * this.noise * 2;
      }
      // pacing artefact: 2 ms saturated spike with exponential tail
      for (let k = 0; k < 12; k++) {
        const j = (i - k + RING) % RING;
        if (this.stimMark[j]) v += k < 2 ? 3 : 0.4 * Math.exp(-k / 3);
      }
      ch.out[i] = v;
    }
    // clear impulse slots that can no longer contribute
    const old = (i - 200 + RING) % RING;
    for (const ch of this.channels) {
      if (ch.kind === 'surface') { ch.imp[old] = 0; ch.impT[old] = 0; }
      else { ch.imp[0][old] = 0; ch.imp[1][old] = 0; ch.imp[2][old] = 0; }
    }
    this.stimMark[(i - 200 + RING) % RING] = 0;
    void stim;
  }

  sample(chId, t) {
    const ch = this.byId[chId];
    return ch ? ch.out[((Math.floor(t) % RING) + RING) % RING] : 0;
  }

  // Latest local activation on a channel (atrial 'A' or ventricular 'V') after t0.
  firstLocalAfter(chId, group, t0) {
    const ch = this.byId[chId];
    if (!ch) return NaN;
    const arr = group === 'V' ? ch.actsV : ch.actsA;
    for (const t of arr) if (t > t0) return t;
    return NaN;
  }
  lastLocal(chId, group) {
    const ch = this.byId[chId];
    if (!ch) return NaN;
    const arr = group === 'V' ? ch.actsV : ch.actsA;
    return arr.length ? arr[arr.length - 1] : NaN;
  }
}

function conv(buf, K, s) {
  const h = K.h, k = K.k;
  let acc = 0;
  for (let j = -h; j <= h; j++) {
    const v = buf[(((s - j) % RING) + RING) % RING];
    if (v !== 0) acc += v * k[j + h];
  }
  return acc;
}
