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
// the nodes activating each millisecond; leads are projections on lead vectors. Atrial
// and ventricular contributions use separate kernels (broad, rounded P wave; narrow
// QRS). The T wave is a delayed, concordant copy at t + APD shaped by an asymmetric
// kernel (slow upstroke, faster downstroke). Surface leads get a 0.05-40 Hz style
// "monitor" look: band-limited noise and slow respiratory baseline wander.
//
// Intracardiac channels are band-pass filtered like a clinical recording system
// (bipolar 30-300 Hz): the first-order 30 Hz high-pass turns broad far-field humps
// into small biphasic deflections and keeps near-field signals sharp. Unipolar
// channels use a 0.5 Hz high-pass so the QS / rS morphology is preserved.

import { TISSUE, TISSUE_TABLE, hash01 } from './propagation.js';
import { CHAMBER_DEFS, makeChamberSDF } from './geometry.js';

export const RING = 20000; // 20 s at 1 kHz
const LAG = 120; // finalize delay (ms) so kernels and fractionation are complete
const R0SQ = 4;

const LEADS = {
  I: [1, 0, 0],
  II: [0.5, 0, -0.866],
  V1: [-0.45, -0.85, -0.1],
  aVF: [0, 0, -1],
  V6: [0.88, 0.25, -0.38],
};

const KERNELS = [makeKernel(1.4), makeKernel(3), makeKernel(6.5)];
const KERNEL_QRS = makeKernel(4);
const KERNEL_P = makeKernel(10);
const KERNEL_T = makeKernel(40, 24); // rise 40 ms, fall 24 ms
const P_SCALE = 0.3; // P wave ~10-20% of the QRS amplitude, as on a clinical ECG
// Weight of along-the-wall spread in the ventricular heart vector. In a beat conducted over
// the His-Purkinje system the endocardium activates almost at once, so the wavefront is mostly
// transmural and along-the-wall components largely cancel (small weight). In a beat that starts
// in the myocardium (pacing, PVC, VT, pre-excitation) a single slow wavefront crosses the
// ventricles: its direction dominates and gives the wide, bizarre QRS.
const TANG_HPS = 0.4, TANG_MYO = 2;
// ...and its transmural (endo -> epi) component is much less coherent than in a Purkinje-driven beat
const TM_MYO = 0.2;
// Repolarisation follows the activation sequence in myocardial beats, so the tangential part of
// the T wave is discordant (secondary ST-T change); the transmural part stays concordant.
const T_DISC = 0.75;

// Rodrigues rotation taking unit vector a onto unit vector b (3x3, row-major)
function rotBetween(a, b) {
  const v = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const c = a[0] * b[0] + a[1] * b[1] + a[2] * b[2], k = 1 / (1 + c);
  return [
    v[0] * v[0] * k + c, v[0] * v[1] * k - v[2], v[0] * v[2] * k + v[1],
    v[1] * v[0] * k + v[2], v[1] * v[1] * k + c, v[1] * v[2] * k - v[0],
    v[2] * v[0] * k - v[1], v[2] * v[1] * k + v[0], v[2] * v[2] * k + c,
  ];
}
const nrm = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const TRANSMURAL = [0, 0, 0.35, 2.6]; // by chamber index (RA, LA, RV, LV): wall-thickness weight
const SEPTAL_DAMP = 0.7;
const T_GAIN = 0.2; // T-wave impulse weight relative to depolarisation (T ≈ 25-35% of R)
const SURF_SCALE = 0.0017; // display units ≈ mV: normal sinus R wave ~1.3

// Gaussian kernel; with two widths it is asymmetric (wl = side before the impulse
// time, i.e. the rising limb of the output; wr = the falling limb).
function makeKernel(wl, wr = wl) {
  const h = Math.ceil(Math.max(wl, wr) * 3);
  const k = new Float32Array(2 * h + 1);
  for (let i = -h; i <= h; i++) { const w = i < 0 ? wl : wr; k[i + h] = Math.exp(-(i * i) / (2 * w * w)); }
  return { h, k };
}

// first-order high-pass coefficient for a cutoff fc (Hz) at 1 kHz sampling
const hpCoef = (fc) => { const rc = 1 / (2 * Math.PI * fc); return rc / (rc + 0.001); };
const HP_BIP = hpCoef(30), HP_UNI = hpCoef(0.5);
const BIP_GAIN = 1.25; // restores near-field amplitude after the high-pass

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
    this.vLast = -1e9; this.vHps = true; this.vStart = -1e9; this.hisAnte = -1e9; // current ventricular beat: conducted over the HPS?
    // surface leads
    for (const [id, v] of Object.entries(LEADS)) {
      const ch = this._mk(id, id, 'surface');
      ch.lead = v;
      ch.imp = new Float32Array(RING); ch.impA = new Float32Array(RING); ch.impT = new Float32Array(RING);
      ch.nz = 0; ch.phase = hash01(id.charCodeAt(0) * 13 + id.length) * Math.PI * 2;
    }
    // per-node transmural weight: septal surfaces of the two ventricles largely cancel
    // each other, so septal nodes contribute less than free-wall nodes
    const heart = sim.heart, nM = this.eng.nMesh;
    this.tmW = new Float32Array(nM);
    const sdfRV = makeChamberSDF(CHAMBER_DEFS.RV), sdfLV = makeChamberSDF(CHAMBER_DEFS.LV);
    for (let n = 0; n < nM; n++) {
      const c = heart.chamber[n]; if (c < 2) continue;
      const x = heart.pos[3 * n], y = heart.pos[3 * n + 1], z = heart.pos[3 * n + 2];
      const dOther = c === 3 ? sdfRV(x, y, z) : sdfLV(x, y, z);
      const septal = Math.max(0, Math.min(1, (16 - dOther) / 8)); // 1 within ~8 mm of the other cavity
      this.tmW[n] = TRANSMURAL[c] * (1 - SEPTAL_DAMP * septal);
    }
    // Optional per-patient heart orientation (case cfg.ecgAxis): the model's LV long axis
    // (base -> apex) is rotated onto that anatomical axis in the torso before projection on the
    // leads, e.g. a more horizontal heart, whose inferior (diaphragmatic) wall faces the
    // inferior leads.
    const ax = sim.cfg?.ecgAxis;
    this.vRot = ax ? rotBetween(nrm([5, -57, -70]), nrm(ax)) : null;
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
      ch.hx = 0; ch.hy = 0; // band-pass filter state
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
    // classify the ventricular beat by how its first myocardial activation arrived
    // (fusion: in a pre-excited beat the part activated after an antegrade His-Purkinje wave
    // arrives is weighted like a conducted beat; retrograde His capture during pacing is not)
    const nm = this.sim.sys.names;
    if (n === nm.HIS) this.hisAnte = !(src === nm.LBB || src === nm.RBB || (src >= 0 && src < eng.nMesh)) ? t : this.hisAnte;
    // (only working myocardium times the beat: a slow channel inside scar is active all the time)
    if (isMesh && eng.chamber[n] >= 2 && tissue === TISSUE.VENTRICLE) {
      const viaHps = src === nm.LBB || src === nm.RBB || src === nm.HIS;
      if (t - this.vLast > 180) { this.vHps = viaHps; this.vStart = t; }
      else if (!this.vHps && viaHps && this.hisAnte > this.vStart - 200) this.vHps = true;
      this.vLast = t;
    }
    // ---- ECG
    if (isMesh && tt.mass > 0 && (dx || dy || dz)) {
      const vent = eng.chamber[n] >= 2;
      const m = tt.mass * (vent ? 1 : 1.6);
      const TANG = this.vHps ? TANG_HPS : TANG_MYO;
      const ti = idx % RING, tT = (idx + Math.round(erp + 25)) % RING;
      // ventricles: add the transmural (endocardium -> epicardium) wavefront, which
      // dominates the clinical QRS; it scales with wall thickness (LV >> RV)
      let tx = 0, ty = 0, tz = 0, gx = dx, gy = dy, gz = dz;
      if (vent) {
        const N = this.sim.heart.normal, w = this.tmW[n] * m;
        tx = N[3 * n] * w; ty = N[3 * n + 1] * w; tz = N[3 * n + 2] * w;
        const R = this.vRot;
        if (R) {
          [tx, ty, tz] = [R[0] * tx + R[1] * ty + R[2] * tz, R[3] * tx + R[4] * ty + R[5] * tz, R[6] * tx + R[7] * ty + R[8] * tz];
          [gx, gy, gz] = [R[0] * dx + R[1] * dy + R[2] * dz, R[3] * dx + R[4] * dy + R[5] * dz, R[6] * dx + R[7] * dy + R[8] * dz];
        }
      }
      for (const id in LEADS) {
        const ch = this.byId[id];
        const tg = (gx * ch.lead[0] + gy * ch.lead[1] + gz * ch.lead[2]) * m;
        if (vent) {
          const tm = tx * ch.lead[0] + ty * ch.lead[1] + tz * ch.lead[2];
          ch.imp[ti] += tg * TANG + tm * (this.vHps ? 1 : TM_MYO);
          ch.impT[tT] += (tm * (this.vHps ? 1 : TM_MYO) - (this.vHps ? 0 : T_DISC) * tg * TANG) * T_GAIN;
        } else ch.impA[ti] += tg * P_SCALE;
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
    // respiration (~15/min) shared by all surface leads, each lead with its own phase
    const resp = Math.sin((s / 4000) * Math.PI * 2);
    for (const ch of this.channels) {
      let v = 0;
      if (ch.kind === 'surface') {
        v = (conv(ch.imp, KERNEL_QRS, s) + conv(ch.impA, KERNEL_P, s) + conv(ch.impT, KERNEL_T, s)) * SURF_SCALE;
        // band-limited (smoothed) muscle/amplifier noise instead of white jitter
        ch.nz = ch.nz * 0.82 + (hash01(s * 31 + ch.id.length * 7 + ch.id.charCodeAt(0)) - 0.5) * 0.18;
        v += ch.nz * 0.035;
        // slow baseline wander from respiration
        v += 0.018 * Math.sin((s / 4000) * Math.PI * 2 + ch.phase) + 0.006 * resp;
        // pacing artefact: very narrow spike on the surface ECG
        if (this.stimMark[i]) v += 1.1;
        else if (this.stimMark[(i - 1 + RING) % RING]) v -= 0.25;
      } else {
        const raw = conv(ch.imp[0], KERNELS[0], s) + conv(ch.imp[1], KERNELS[1], s) + conv(ch.imp[2], KERNELS[2], s);
        // recording-system band-pass (bipolar 30 Hz HP, unipolar 0.5 Hz HP)
        const uni = !ch.p2;
        ch.hy = (uni ? HP_UNI : HP_BIP) * (ch.hy + raw - ch.hx); ch.hx = raw;
        if (!Number.isFinite(ch.hy)) ch.hy = 0;
        v = uni ? ch.hy : ch.hy * BIP_GAIN;
        v += (hash01(s * 17 + ch.label.length * 101) - 0.5) * this.noise * 2;
        // pacing artefact: 2 ms saturated spike with an amplifier-recovery tail
        for (let k = 0; k < 12; k++) {
          const j = (i - k + RING) % RING;
          if (this.stimMark[j]) v += k < 2 ? 3 : k < 3 ? -1.2 : 0.4 * Math.exp(-k / 3);
        }
      }
      ch.out[i] = v;
    }
    // clear impulse slots that can no longer contribute
    const old = (i - 200 + RING) % RING;
    for (const ch of this.channels) {
      if (ch.kind === 'surface') { ch.imp[old] = 0; ch.impA[old] = 0; ch.impT[old] = 0; }
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
