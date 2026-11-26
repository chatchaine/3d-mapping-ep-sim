// Clinical 12-lead ECG for the case briefing: standard 3 x 4 layout (2.5 s per lead) plus a
// 10 s lead II rhythm strip on ECG paper (25 mm/s, 10 mm/mV), with calibration pulses and
// a measurement header.
//
// Waveforms come from a cardiac dipole model: every P wave, QRS complex and T wave is a sum
// of time-shifted vector lobes (x = left, y = inferior, z = anterior, mV) that is projected
// onto the 12 lead axes. Einthoven's law, the frontal axis and the precordial transition
// are therefore consistent across leads, and each morphology (pre-excitation, retrograde P,
// flutter F waves, VT, PVCs, VF) is a different set of vectors and timings.

const FS = 250; // samples per second
const LIMB = { I: [1, 0, 0], II: [0.5, 0.866, 0] };
const CHEST_ANG = { V1: 115, V2: 94, V3: 74, V4: 54, V5: 30, V6: 8 };
const CHEST_GAIN = { V1: 1.15, V2: 1.55, V3: 1.6, V4: 1.55, V5: 1.35, V6: 1.1 };
const LAYOUT = [['I', 'aVR', 'V1', 'V4'], ['II', 'aVL', 'V2', 'V5'], ['III', 'aVF', 'V3', 'V6']];

const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const chestVec = (id) => { const a = (CHEST_ANG[id] * Math.PI) / 180, g = CHEST_GAIN[id]; return [Math.cos(a) * g, 0.15 * g, Math.sin(a) * g]; };
const LEADVEC = { I: LIMB.I, II: LIMB.II, V1: chestVec('V1'), V2: chestVec('V2'), V3: chestVec('V3'), V4: chestVec('V4'), V5: chestVec('V5'), V6: chestVec('V6') };

function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// ------------------------------------------------------------------ morphologies
// lobe: [tc ms from complex onset, width ms (sd), [x, y, z] mV]
const QRS = {
  normal: { d: 90, lobes: [[12, 6, [-0.12, 0.04, 0.2]], [30, 8, [0.45, 0.3, 0.45]], [46, 10, [0.85, 0.95, -0.85]], [72, 8, [-0.22, -0.32, -0.25]]] },
  // old inferior MI (initial forces point away from the inferior wall) + IVCD
  imi: { d: 120, lobes: [[20, 13, [0.08, -0.55, 0.06]], [58, 16, [0.95, 0.35, -0.6]], [96, 12, [-0.3, -0.2, -0.25]]] },
  // ventricular complexes
  vt_scar: { d: 160, lobes: [[45, 24, [0.05, -0.85, 0.75]], [105, 22, [-0.35, -0.35, 0.45]]] },
  pvc_rvot: { d: 140, lobes: [[40, 20, [0.18, 0.9, -0.3]], [85, 22, [0.12, 0.75, -0.42]], [118, 12, [-0.05, 0.1, -0.12]]] },
  pvc_lv: { d: 130, lobes: [[35, 18, [-0.35, -0.55, 0.55]], [85, 20, [-0.3, -0.25, 0.5]]] },
};
const TW = {
  normal: [0.2, 0.24, 0.09],
  imi: [0.22, -0.04, 0.1],
  vt_scar: [0.1, 0.4, -0.45],
  pvc_rvot: [-0.08, -0.38, 0.28],
  pvc_lv: [0.25, 0.3, -0.35],
};
// pre-excitation: delta lobe direction by AP site; the rest of the QRS fuses with it
const DELTA = {
  ps: [0.45, -0.45, 0.3], // posteroseptal: negative inferior, positive I/aVL, abrupt R in V2
  ll: [-0.35, 0.5, 0.6], // left lateral: negative I/aVL, positive inferior, positive V1
};
const P_LOBES = {
  sinus: [[32, 15, [0.04, 0.1, 0.07]], [68, 17, [0.08, 0.06, -0.08]]],
  at_crista: [[35, 18, [0.11, 0.21, 0.08]], [70, 18, [0.07, 0.09, -0.03]]],
  retro_ap_left: [[25, 16, [-0.14, -0.05, 0.03]], [55, 16, [-0.07, -0.06, 0.0]]], // negative in I/aVL
  retro_septal: [[22, 11, [-0.03, -0.15, 0.12]], [42, 11, [0.0, -0.08, 0.02]]], // negative inferior, positive V1
};

function mkQrs(name) { return QRS[name]; }
function preexcited(ap, degree = 1) {
  const n = QRS.normal, dv = DELTA[ap];
  // delta (slow initial forces) followed by the late, partly fused His-Purkinje QRS
  // (no septal q: the septum is not the first part activated)
  const lobes = [[24, 16, dv.map((v) => v * (0.6 + 0.4 * degree))]];
  for (const [tc, w, v] of n.lobes.slice(1)) lobes.push([tc + 36 * degree, w * (1 + 0.9 * degree), v.map((x, i) => x * (1 - 0.65 * degree) + dv[i] * 1.0 * degree)]);
  return { d: 90 + 40 * degree, lobes, t: TW.normal.map((x, i) => x * (1 - 0.6 * degree) - dv[i] * 0.35 * degree) };
}

// ------------------------------------------------------------------ rhythm builders
// Each returns { events: [{ t, kind: 'P'|'QRS', ... }], cont: (t) => [x,y,z] | null, meas }
const qtFor = (rr, qtc = 0.41) => Math.round(1000 * qtc * Math.sqrt(rr / 1000));

function beat(ev, t, { p = 'sinus', pr = 150, qrs = 'normal', rr = 800, qt, morph, retro, retroRP, alt = 1, pAmp = 1 }) {
  if (p) ev.push({ t: t - pr, kind: 'P', lobes: P_LOBES[p], amp: pAmp });
  const m = morph || mkQrs(qrs);
  ev.push({ t, kind: 'QRS', m, tv: m.t || TW[qrs] || TW.normal, qt: qt || qtFor(rr), amp: alt });
  if (retro) ev.push({ t: t + retroRP, kind: 'P', lobes: P_LOBES[retro], amp: 1 });
}

function sinus({ rr = 800, pr = 150, qrs = 'normal', jitter = 15, morph, qtc }, r) {
  const ev = [];
  for (let t = 420; t < 10600; t += rr + (r() - 0.5) * jitter) beat(ev, t, { pr, qrs, rr, morph, qt: qtFor(rr, qtc) });
  return { events: ev };
}

const RHYTHMS = {
  sinus: (o, r) => sinus(o, r),
  svt: ({ rr, retro, retroRP, alternans = 0 }, r) => {
    const ev = []; let k = 0;
    for (let t = 250; t < 10600; t += rr + (r() - 0.5) * 4) beat(ev, t, { p: null, rr, retro, retroRP, alt: 1 + (k++ % 2 ? -alternans : alternans) });
    return { events: ev };
  },
  longRP: ({ rr, pr, p }, r) => {
    const ev = [];
    for (let t = 300; t < 10600; t += rr + (r() - 0.5) * 6) beat(ev, t, { p, pr, rr });
    return { events: ev };
  },
  af: ({ morph = null, preex = null, rrMin = 420, rrMax = 950, fAmp = 0.06 }, r) => {
    const ev = [];
    for (let t = 200; t < 10600;) {
      const rr = rrMin + (rrMax - rrMin) * Math.pow(r(), 1.3);
      const deg = preex ? 0.55 + 0.45 * r() : 0;
      beat(ev, t, { p: null, rr, morph: preex ? preexcited(preex, deg) : morph });
      t += rr;
    }
    const ph = [r() * 6.3, r() * 6.3, r() * 6.3, r() * 6.3];
    const cont = (t) => {
      const s = t / 1000;
      const a = Math.sin(2 * Math.PI * 6.1 * s + ph[0]) + 0.6 * Math.sin(2 * Math.PI * 7.3 * s + ph[1]) + 0.4 * Math.sin(2 * Math.PI * 4.9 * s + ph[2]);
      const b = Math.sin(2 * Math.PI * 5.6 * s + ph[3]) * 0.7;
      return [-0.25 * fAmp * a, 0.35 * fAmp * b, 0.9 * fAmp * a];
    };
    return { events: ev, cont };
  },
  // macro-reentrant atrial flutter: continuous F waves, fixed or variable AV conduction
  flutter: ({ acl = 240, ratio = [2], fvec, shape = 'saw', pr = 220 }, r) => {
    const ev = [];
    let t = 260, k = 0;
    while (t < 10600) {
      beat(ev, t, { p: null, rr: acl * ratio[k % ratio.length] });
      t += acl * ratio[k++ % ratio.length];
    }
    const off = 260 - pr; // F-wave phase so that conduction follows a flutter wave
    const cont = (tt) => {
      let ph = ((tt - off) / acl) % 1; if (ph < 0) ph += 1;
      let s;
      if (shape === 'saw') s = ph < 0.6 ? 0.25 - 1.25 * (ph / 0.6) : ph < 0.78 ? -1 + 1.55 * ((ph - 0.6) / 0.18) : 0.55 - 0.3 * ((ph - 0.78) / 0.22);
      else s = ph < 0.45 ? Math.sin((Math.PI * ph) / 0.45) : 0; // discrete F waves with an isoelectric interval
      return fvec.map((v) => v * s);
    };
    return { events: ev, cont };
  },
  vt: ({ rr, morph, sinusRR = 860 }, r) => {
    const ev = [];
    for (let t = 200; t < 10600; t += rr + (r() - 0.5) * 6) beat(ev, t, { p: null, rr, qrs: morph });
    // AV dissociation: sinus P waves marching through
    for (let t = 150 + r() * 300; t < 10600; t += sinusRR) ev.push({ t, kind: 'P', lobes: P_LOBES.sinus, amp: 0.9 });
    return { events: ev };
  },
  pvcs: ({ rr = 860, pr = 150, pvc, coupling = 440, every = 2, salvo = 0 }, r) => {
    const ev = [];
    let t = 380, k = 0;
    while (t < 10600) {
      beat(ev, t, { pr, rr });
      k++;
      if (k % every === 0) {
        const tv = t + coupling;
        beat(ev, tv, { p: null, rr, qrs: pvc });
        if (salvo && k === every * 2) { beat(ev, tv + 360, { p: null, rr: 360, qrs: pvc }); beat(ev, tv + 720, { p: null, rr: 360, qrs: pvc }); t = tv + 720 + 900; continue; }
        t += 2 * rr; // fully compensatory pause
      } else t += rr + (r() - 0.5) * 15;
    }
    return { events: ev };
  },
  vf: ({ onset = 1500, rr = 820, pvc = 'pvc_lv' }, r) => {
    const ev = [];
    let t = 300;
    for (; t < onset - 300; t += rr) beat(ev, t, { pr: 160, rr });
    const tpvc = t - rr + 300; // R-on-T PVC triggers VF
    beat(ev, tpvc, { p: null, rr: 300, qrs: pvc });
    const t0 = tpvc + 220;
    const comps = Array.from({ length: 5 }, () => ({ f: 3.8 + r() * 3.2, ph: r() * 6.3, v: [r() - 0.5, r() - 0.4, r() - 0.5].map((x) => x * 1.1) }));
    const cont = (tt) => {
      if (tt < t0) return null;
      const s = (tt - t0) / 1000, env = Math.min(1, s * 3) * (0.75 + 0.35 * Math.sin(2 * Math.PI * 0.45 * s));
      const out = [0, 0, 0];
      for (const c of comps) { const a = Math.sin(2 * Math.PI * c.f * s + c.ph + 0.8 * Math.sin(2 * Math.PI * 0.3 * s)) * env; for (let i = 0; i < 3; i++) out[i] += c.v[i] * a * 0.45; }
      return out;
    };
    return { events: ev, cont };
  },
};

// ------------------------------------------------------------------ case specs
// Each case: baseline + clinical tracing (and optional extras), matching the case text.
const SPECS = {
  avnrt: {
    baseline: { r: 'sinus', o: { rr: 800, pr: 150 } },
    tachy: { r: 'svt', o: { rr: 350, retro: 'retro_septal', retroRP: 62 } },
  },
  ort_concealed: {
    baseline: { r: 'sinus', o: { rr: 860, pr: 160 } },
    tachy: { r: 'svt', o: { rr: 325, retro: 'retro_ap_left', retroRP: 118, alternans: 0.12 } },
  },
  wpw_ps: {
    baseline: { r: 'sinus', o: { rr: 800, pr: 100, morph: preexcited('ps') } },
    tachy: { r: 'svt', o: { rr: 300, retro: 'retro_septal', retroRP: 110 } },
    extra: [{ title: 'ED: pre-excited AF (shortest pre-excited RR 220 ms)', r: 'af', o: { preex: 'ps', rrMin: 220, rrMax: 520 } }],
  },
  wpw_ll: {
    baseline: { r: 'sinus', o: { rr: 820, pr: 110, morph: preexcited('ll', 0.8) } },
    tachy: { r: 'svt', o: { rr: 330, retro: 'retro_ap_left', retroRP: 120 } },
  },
  focal_at: {
    baseline: { r: 'sinus', o: { rr: 705, pr: 150 } },
    tachy: { r: 'longRP', o: { rr: 375, pr: 165, p: 'at_crista' } },
  },
  paf_pvi: {
    baseline: { r: 'sinus', o: { rr: 920, pr: 160 } },
    tachy: { r: 'af', o: { rrMin: 430, rrMax: 900 } },
  },
  cti_flutter: {
    baseline: { r: 'flutter', o: { acl: 240, ratio: [2], fvec: [0.08, 0.27, -0.14] } },
    tachy: { r: 'flutter', o: { acl: 240, ratio: [4, 2, 4, 3], fvec: [0.08, 0.27, -0.14] } },
  },
  perimitral: {
    baseline: { r: 'flutter', o: { acl: 260, ratio: [2], fvec: [0.02, 0.06, 0.15], shape: 'discrete' } },
    tachy: { r: 'flutter', o: { acl: 260, ratio: [2, 3, 2, 4], fvec: [0.02, 0.06, 0.15], shape: 'discrete' } },
  },
  scar_vt: {
    baseline: { r: 'sinus', o: { rr: 860, pr: 190, qrs: 'imi', qtc: 0.44 } },
    tachy: { r: 'vt', o: { rr: 415, morph: 'vt_scar' } },
  },
  rvot: {
    baseline: { r: 'sinus', o: { rr: 860, pr: 150 } },
    tachy: { r: 'pvcs', o: { rr: 860, pvc: 'pvc_rvot', coupling: 450, every: 2, salvo: 1 } },
  },
  vf_storm: {
    baseline: { r: 'pvcs', o: { rr: 820, pvc: 'pvc_lv', coupling: 380, every: 3 } },
    tachy: { r: 'vf', o: { onset: 1900 } },
  },
};

// ------------------------------------------------------------------ synthesis
function synth(spec, seed) {
  const r = rng(seed);
  const rh = RHYTHMS[spec.r](spec.o, r);
  const ev = rh.events.sort((a, b) => a.t - b.t);
  const N = FS * 10;
  const vec = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const t = (i * 1000) / FS;
    let x = 0, y = 0, z = 0;
    for (const e of ev) {
      const dt = t - e.t;
      if (dt < -40 || dt > 800) continue;
      if (e.kind === 'P') {
        for (const [tc, w, v] of e.lobes) { const g = e.amp * Math.exp(-0.5 * ((dt - tc) / w) ** 2); x += v[0] * g; y += v[1] * g; z += v[2] * g; }
      } else {
        const a = e.amp;
        for (const [tc, w, v] of e.m.lobes) { const g = a * Math.exp(-0.5 * ((dt - tc) / w) ** 2); x += v[0] * g; y += v[1] * g; z += v[2] * g; }
        // T wave: asymmetric (slow upstroke, faster downstroke), peaking ~70% into the ST-T
        const tp = e.qt - 85, w = dt < tp ? 0.33 * (e.qt - e.m.d) : 50;
        let u = Math.max(0, Math.min(1, (dt - 0.5 * e.m.d) / (0.6 * e.m.d))); u = u * u * (3 - 2 * u);
        const g = Math.exp(-0.5 * ((dt - tp) / w) ** 2) * u;
        x += e.tv[0] * g; y += e.tv[1] * g; z += e.tv[2] * g;
      }
    }
    const c = rh.cont?.(t);
    if (c) { x += c[0]; y += c[1]; z += c[2]; }
    vec[3 * i] = x; vec[3 * i + 1] = y; vec[3 * i + 2] = z;
  }
  // per-lead signals (derived limb leads follow Einthoven / Goldberger)
  const lead = {};
  const proj = (L) => { const out = new Float32Array(N); for (let i = 0; i < N; i++) out[i] = L[0] * vec[3 * i] + L[1] * vec[3 * i + 1] + L[2] * vec[3 * i + 2]; return out; };
  for (const k of ['I', 'II', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6']) lead[k] = proj(LEADVEC[k]);
  const I = lead.I, II = lead.II;
  lead.III = II.map((v, i) => v - I[i]);
  lead.aVR = I.map((v, i) => -(v + II[i]) / 2);
  lead.aVL = I.map((v, i) => v - II[i] / 2);
  lead.aVF = II.map((v, i) => v - I[i] / 2);
  // acquisition: mild baseline wander and low-level noise, independent per lead
  for (const k of Object.keys(lead)) {
    const ph = r() * 6.3, nz = r;
    let s = 0;
    for (let i = 0; i < N; i++) { s = 0.8 * s + 0.2 * (nz() - 0.5); lead[k][i] += 0.025 * Math.sin((2 * Math.PI * 0.22 * i) / FS + ph) + 0.018 * s; }
  }
  return { lead, events: ev };
}

function measurements(spec, ev) {
  const q = ev.filter((e) => e.kind === 'QRS').map((e) => e.t);
  const rrs = q.slice(1).map((t, i) => t - q[i]);
  const rr = rrs.reduce((a, b) => a + b, 0) / Math.max(1, rrs.length);
  const rate = Math.round(60000 / rr);
  const first = ev.find((e) => e.kind === 'QRS');
  const o = spec.o;
  const qrsd = Math.round(first?.m.d || 90);
  const qt = first?.qt || qtFor(rr);
  if (spec.r === 'vf') return 'Ventricular fibrillation (onset after an R-on-T PVC) · no measurable intervals';
  const out = [`Vent rate ${rate} bpm`];
  if (spec.r === 'sinus' || spec.r === 'pvcs' || spec.r === 'longRP') out.push(`PR ${o.pr || 150} ms`);
  if (spec.r === 'flutter') out.push(`Atrial rate ${Math.round(60000 / o.acl)} bpm`);
  if (spec.r !== 'vf') out.push(`QRS ${qrsd} ms`, `QT/QTc ${qt}/${Math.round(qt / Math.sqrt(rr / 1000))} ms`);
  return out.join(' · ');
}

// ------------------------------------------------------------------ rendering (SVG, mm units)
const ROW_H = 30, CAL_W = 10, STRIP_W = 250, LEFT = 2;
function path(sig, i0, i1, x0, y0) {
  const mmPerSample = 25 / FS;
  let d = '';
  for (let i = i0; i < i1; i++) d += (i === i0 ? 'M' : 'L') + (x0 + (i - i0) * mmPerSample).toFixed(2) + ' ' + (y0 - sig[i] * 10).toFixed(2);
  return d;
}
const calPulse = (x, y) => `M${x} ${y} h1 v-10 h5 v10 h1`;

export function ecgSVG(caseId, which, opts = {}) {
  const spec = which === 'extra' ? SPECS[caseId]?.extra?.[opts.index || 0] : SPECS[caseId]?.[which];
  if (!spec) return '';
  const { lead, events } = synth(spec, (caseId.length * 977 + (which === 'tachy' ? 31 : which === 'extra' ? 57 : 7)) >>> 0);
  const W = LEFT + CAL_W + STRIP_W + 2, H = ROW_H * 4 + 12;
  const seg = FS * 2.5;
  let traces = '', labels = '', ticks = '';
  LAYOUT.forEach((row, ri) => {
    const y0 = 8 + ri * ROW_H + ROW_H / 2;
    traces += calPulse(LEFT + 1, y0) + ' ';
    row.forEach((id, ci) => {
      const x0 = LEFT + CAL_W + ci * 62.5;
      traces += path(lead[id], ci * seg, (ci + 1) * seg, x0, y0) + ' ';
      labels += `<text x="${x0 + 1.5}" y="${y0 - 9}">${id}</text>`;
      if (ci) ticks += `M${x0} ${y0 - 4} v8 `;
    });
  });
  const yR = 8 + 3 * ROW_H + ROW_H / 2;
  traces += calPulse(LEFT + 1, yR) + ' ' + path(lead.II, 0, FS * 10, LEFT + CAL_W, yR);
  labels += `<text x="${LEFT + CAL_W + 1.5}" y="${yR - 9}">II</text>`;
  const meas = measurements(spec, events);
  const uid = 'ecg' + Math.random().toString(36).slice(2, 8);
  return `<svg class="ecg12" viewBox="0 0 ${W} ${H}" role="img" aria-label="12-lead ECG: ${meas}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <pattern id="${uid}m" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M1 0V1H0" fill="none" stroke="#f2b8b8" stroke-width="0.06"/></pattern>
      <pattern id="${uid}M" width="5" height="5" patternUnits="userSpaceOnUse"><rect width="5" height="5" fill="url(#${uid}m)"/><path d="M5 0V5H0" fill="none" stroke="#e08a8a" stroke-width="0.16"/></pattern>
    </defs>
    <rect width="${W}" height="${H}" fill="#fff8f6"/><rect width="${W}" height="${H}" fill="url(#${uid}M)"/>
    <text class="ecg12__meas" x="${LEFT + 1}" y="4.6">${meas}</text>
    <path d="${traces}${ticks}" fill="none" stroke="#141414" stroke-width="0.3" stroke-linejoin="round" stroke-linecap="round"/>
    <g class="ecg12__lab">${labels}</g>
    <text class="ecg12__foot" x="${W - 2}" y="${H - 1.6}" text-anchor="end">25 mm/s · 10 mm/mV · 0.05–150 Hz</text>
  </svg>`;
}

export function hasEcg(caseId) { return !!SPECS[caseId]; }
export function ecgExtras(caseId) { return SPECS[caseId]?.extra || []; }
