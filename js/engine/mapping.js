// Electroanatomic mapping: point acquisition, LAT annotation within a window of interest
// relative to a reference channel, bipolar voltage, and inverse-distance interpolation
// onto the shell within a fill radius (research spec §2.5-2.6, UX spec §3).

import { TISSUE } from './propagation.js';

export const REF_OPTIONS = [
  { id: 'CS78', label: 'CS 7-8 (A)', group: 'A' },
  { id: 'CS910', label: 'CS 9-10 (A)', group: 'A' },
  { id: 'HRA', label: 'HRA (A)', group: 'A' },
  { id: 'RVA', label: 'RVA (V)', group: 'V' },
  { id: 'QRS', label: 'QRS onset', group: 'V' },
];

export class Mapping {
  constructor(sim) {
    this.sim = sim;
    const cfg = sim.caseDef?.map || sim.cfg.map || {};
    const vent = (cfg.group || (['RV', 'LV'].includes(sim.cfg.ablChamber) ? 'V' : 'A')) === 'V';
    this.settings = {
      ref: cfg.ref || (vent ? 'QRS' : 'CS78'),
      woi: cfg.woi ? cfg.woi.slice() : vent ? [-120, 60] : [-80, 40],
      fill: cfg.fill || 10,
      voltLo: vent ? 0.5 : 0.1, voltHi: vent ? 1.5 : 0.5,
      isochrones: false,
    };
    this.points = [];
    this.nextId = 1;
    this.version = 0;
    this.qrsOnsets = [];
    this._lastV = -1e9;
    const eng = sim.engine;
    sim.subscribers.push((n, t) => {
      if (n >= eng.nMesh || eng.tissue[n] !== TISSUE.VENTRICLE) return;
      if (t - this._lastV > 100) { this.qrsOnsets.push(t); if (this.qrsOnsets.length > 40) this.qrsOnsets.shift(); }
      this._lastV = t;
    });
    const N = eng.nMesh;
    this.wL = new Float32Array(N); this.sL = new Float32Array(N);
    this.wV = new Float32Array(N); this.sV = new Float32Array(N);
  }

  refTimes(refId) {
    if (refId === 'QRS') return this.qrsOnsets.slice();
    const ch = this.sim.egm.byId[refId];
    if (!ch) return [];
    return (refId === 'RVA' ? ch.actsV : ch.actsA).slice();
  }

  // Acquire one point at node n (position pos). Returns the point or {error}.
  acquireAt(n, pos, cf = 15, source = 'abl') {
    const sim = this.sim, eng = sim.engine;
    if (n < 0) return { error: 'No surface under the catheter' };
    // snapshot activation history of the node (and close neighbours for robustness)
    const hist = [];
    for (let k = 0; k < eng.H; k++) hist.push(eng.hist[n * eng.H + k]);
    // at the AV annuli the bipole also records the far-field/near ventricle: keep the
    // nearest ventricular node's history so a V-referenced map (WPW) can annotate the V
    let histV = null;
    if (eng.tissue[n] !== TISSUE.VENTRICLE && eng.tissue[n] !== TISSUE.BORDER_ZONE && eng.tissue[n] !== TISSUE.SLOW_CHANNEL) {
      let bd = 12, vn = -1; // mitral shells sit ~8-14 mm apart in this geometry
      sim.heart.grid.query(pos, 12, (m, d) => { if (m < eng.nMesh && eng.tissue[m] === TISSUE.VENTRICLE && d < bd) { bd = d; vn = m; } });
      if (vn >= 0) { histV = []; for (let k = 0; k < eng.H; k++) histV.push(eng.hist[vn * eng.H + k]); }
    }
    const refs = {};
    for (const r of REF_OPTIONS) refs[r.id] = this.refTimes(r.id);
    // bipolar amplitude: local tissue voltage, contact and wavefront incidence effects
    let b = 0, cnt = 0;
    sim.heart.grid.query(pos, 2.6, (m) => { if (eng.chamber[m] === eng.chamber[n]) { b += eng.bip[m]; cnt++; } });
    b = cnt ? b / cnt : eng.bip[n];
    const contact = cf < 5 ? 0.4 + 0.06 * cf : 1;
    const bip = b * contact * Math.exp(sim.rng.normal() * 0.15) * (0.75 + 0.25 * sim.rng());
    const p = { id: this.nextId++, pos: pos.slice(), node: n, hist, histV, refs, tAcq: sim.t, bip, cf, source, noise: sim.rng.normal() * 2.5, chamber: eng.chamber[n] };
    this._annotate(p);
    this.points.push(p);
    this._splat(p, +1);
    this.version++;
    sim.logEvent('point', { id: p.id, lat: p.lat, bip: +p.bip.toFixed(2), source });
    return p;
  }

  _annotate(p) {
    const s = this.settings;
    const refs = p.refs[s.ref] || [];
    p.lat = null; p.refT = null;
    const vRef = REF_OPTIONS.find((o) => o.id === s.ref)?.group === 'V';
    const hist = vRef && p.histV ? p.histV : p.hist;
    // most recent reference whose full window lies before the acquisition time
    for (let i = refs.length - 1; i >= 0; i--) {
      const r = refs[i];
      if (r + s.woi[1] <= p.tAcq - 2) {
        let best = NaN;
        for (const a of hist) if (a >= r + s.woi[0] && a <= r + s.woi[1] && !(a >= best)) best = a;
        p.refT = r;
        if (!isNaN(best)) p.lat = Math.round(best - r + p.noise);
        break;
      }
    }
  }

  _splat(p, sign) {
    const eng = this.sim.engine, R = this.settings.fill;
    this.sim.heart.grid.query(p.pos, R, (n, d) => {
      if (eng.chamber[n] !== p.chamber) return;
      const w = sign / (d * d + 2);
      if (p.lat != null) { this.wL[n] += w; this.sL[n] += w * p.lat; }
      this.wV[n] += w; this.sV[n] += w * Math.log(Math.max(0.01, p.bip));
    });
  }

  rebuild() {
    this.wL.fill(0); this.sL.fill(0); this.wV.fill(0); this.sV.fill(0);
    for (const p of this.points) { this._annotate(p); this._splat(p, +1); }
    this.version++;
  }

  setSettings(patch) { Object.assign(this.settings, patch); this.rebuild(); }

  deleteLast() {
    const p = this.points.pop();
    if (p) { this._splat(p, -1); this.version++; }
    return p;
  }
  deletePoint(id) {
    const i = this.points.findIndex((p) => p.id === id);
    if (i >= 0) { this.points.splice(i, 1); this.rebuild(); }
  }
  clear() { this.points = []; this.rebuild(); }

  latAt(n) { const w = this.wL[n]; return w > 1e-6 ? this.sL[n] / w : null; }
  voltAt(n) { const w = this.wV[n]; return w > 1e-6 ? Math.exp(this.sV[n] / w) : null; }

  // Summary used by the debrief, quizzes and the accessible description.
  summary() {
    const pts = this.points.filter((p) => p.lat != null);
    if (!pts.length) return { n: this.points.length, nLat: 0 };
    let e = pts[0], l = pts[0];
    for (const p of pts) { if (p.lat < e.lat) e = p; if (p.lat > l.lat) l = p; }
    return { n: this.points.length, nLat: pts.length, earliest: e, latest: l, span: l.lat - e.lat };
  }

  // Fraction of a chamber's nodes covered by the fill radius
  coverage(chamberIdx) {
    const c = this.sim.heart.chambers[chamberIdx];
    let k = 0;
    for (let n = c.offset; n < c.offset + c.count; n++) if (this.wV[n] > 1e-6) k++;
    return k / c.count;
  }
}
