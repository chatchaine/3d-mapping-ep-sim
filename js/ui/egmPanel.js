// EGM panel (UX spec §2.5): sweeping erase-bar display of surface ECG and intracardiac
// channels, sweep speed, gain, freeze, calipers and horizontal review scrolling.
//
// Review: the 20 s ring buffer can be scrolled left (back in time) and right with the
// mouse wheel / trackpad, by dragging the strip, with the scroll bar along the bottom
// edge, or with the ← / → keys. Scrolling freezes the display; "Live" (or End) returns
// to the sweeping live view.

import { RING } from '../engine/egm.js';

const ORDER = ['I', 'II', 'aVF', 'V1', 'V6', 'HRA', 'HISd', 'HISp', 'CS910', 'CS78', 'CS56', 'CS34', 'CS12', 'RVA', 'ABLd', 'ABLp', 'MAP3', 'MAP4', 'PV'];
const LABEL = { I: 'I', II: 'II', aVF: 'aVF', V1: 'V1', V6: 'V6', HRA: 'HRA d', HISd: 'His d', HISp: 'His p', CS910: 'CS 9-10', CS78: 'CS 7-8', CS56: 'CS 5-6', CS34: 'CS 3-4', CS12: 'CS 1-2', RVA: 'RVA d', ABLd: 'ABL d', ABLp: 'ABL p', PV: 'PV loop' };
const COLOR = { I: '--c-egm-surface', II: '--c-egm-surface', aVF: '--c-egm-surface', V1: '--c-egm-surface', V6: '--c-egm-surface', HRA: '--c-egm-hra', HISd: '--c-egm-his', HISp: '--c-egm-his', CS910: '--c-egm-cs', CS78: '--c-egm-cs', CS56: '--c-egm-cs', CS34: '--c-egm-cs', CS12: '--c-egm-cs', RVA: '--c-egm-rva', ABLd: '--c-egm-abl', ABLp: '--c-egm-abl', MAP3: '--c-egm-abl', MAP4: '--c-egm-abl', PV: '--c-egm-his' };
const GUTTER = 74;
const SCROLL_H = 9; // scroll bar strip at the bottom of the canvas
const KEEP = RING - 500; // ms of history that is safe to display
const SNAP_MS = 10000; // length of a snapshot strip
const MAX_SNAPS = 20;

export class EGMPanel {
  constructor(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.speed = 100; this.gain = 1; this.frozen = false; this.freezeT = 0; this.calipers = false;
    this.cal = []; // caliper times (ms)
    this.drag = null; this.pan = null; this.thumbDrag = null;
    this.onFreezeChange = null; // set by the app so the toolbar reflects scroll-freeze
    // Snapshots: copies of all channels over a 10 s strip, kept after the live buffer has
    // moved on, for later measurement with the calipers. viewSnap = the one on screen.
    this.snaps = []; this.viewSnap = null; this.onSnapsChange = null;
    this.colors = {};
    this.refreshColors();
    new ResizeObserver(() => this.resize()).observe(canvas);
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => this._down(e));
    canvas.addEventListener('pointermove', (e) => this._move(e));
    window.addEventListener('pointerup', () => { this.drag = null; this.pan = null; this.thumbDrag = null; this.canvas.style.cursor = ''; });
    canvas.addEventListener('dblclick', () => { this.cal = []; this._report(); });
    canvas.addEventListener('wheel', (e) => this._wheel(e), { passive: false });
    this.resize();
  }
  refreshColors() {
    const cs = getComputedStyle(document.documentElement);
    for (const [k, v] of Object.entries(COLOR)) this.colors[k] = cs.getPropertyValue(v).trim();
    this.gridMaj = cs.getPropertyValue('--c-egm-grid-major').trim(); this.gridMin = cs.getPropertyValue('--c-egm-grid-minor').trim();
    this.calCol = cs.getPropertyValue('--c-egm-caliper').trim(); this.annot = cs.getPropertyValue('--c-egm-annot').trim();
    this.bg = cs.getPropertyValue('--c-bg-viewport').trim();
    this.pace = cs.getPropertyValue('--c-pace').trim();
  }
  setSim(sim) { this.sim = sim; this.cal = []; this.frozen = false; this.snaps = []; this.viewSnap = null; this._report(); this.onFreezeChange?.(false); this.onSnapsChange?.(); }

  // ---------------------------------------------------------------- snapshots
  // Capture the strip ending at the moment on screen (live: now; frozen: the reviewed time).
  snap() {
    const sim = this.sim; if (!sim) return null;
    const egm = sim.egm, fin = egm.finT - 1;
    const src = this.viewSnap;
    const t1 = src ? this.freezeT : this.frozen ? this.freezeT : fin;
    const t0 = Math.max(src ? src.t0 : fin - KEEP, t1 - SNAP_MS);
    const n = Math.max(1, Math.round(t1 - t0));
    const chs = this.channels().map((id) => {
      const ch = src ? src.chs.find((c) => c.id === id) : egm.byId[id];
      const data = new Float32Array(n);
      for (let i = 0; i < n; i++) data[i] = this._sample(id, t0 + i);
      return { id, label: src ? ch.label : (ch.group === 'ABL' ? ch.label : LABEL[id]) || id, kind: ch.kind, data };
    });
    const k = (this.snaps.length ? this.snaps[this.snaps.length - 1].num : 0) + 1;
    const s = { num: k, t0, t1: t0 + n, simT: sim.t, rhythm: sim.status.rhythm, chs };
    this.snaps.push(s);
    while (this.snaps.length > MAX_SNAPS) this.snaps.shift();
    this.showSnap(s);
    this.onSnapsChange?.();
    return s;
  }
  snapLabel(s) { const m = Math.floor(s.simT / 60000), sec = Math.floor((s.simT % 60000) / 1000); return `Snap ${s.num} · ${m}:${String(sec).padStart(2, '0')} · ${s.rhythm}`; }
  showSnap(s) {
    if (!s) return;
    this.viewSnap = s; this.cal = [];
    if (!this.frozen) { this.frozen = true; this.onFreezeChange?.(true); }
    this.freezeT = s.t1; this._clampView(); this._report(); this.onSnapsChange?.();
  }
  _sample(id, t) {
    const s = this.viewSnap;
    if (!s) return this.sim.egm.sample(id, t);
    const c = s.chs.find((x) => x.id === id); if (!c) return 0;
    const i = Math.round(t - s.t0);
    return i >= 0 && i < c.data.length ? c.data[i] : 0;
  }
  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.W = w; this.H = h;
  }
  msPerPx() { return 1000 / (this.speed * 3.78); }
  setSpeed(s) { this.speed = s; if (this.frozen) this._clampView(); }
  setFrozen(f) {
    if (!this.sim) return;
    if (f === this.frozen) return;
    this.frozen = f;
    if (f) this.freezeT = this.sim.egm.finT - 1; else { this.cal = []; if (this.viewSnap) { this.viewSnap = null; this.onSnapsChange?.(); } }
    this._report();
    this.onFreezeChange?.(f);
  }

  // ---------------------------------------------------------------- review scrolling
  plotW() { return this.W - GUTTER; }
  _range() {
    // [earliest, latest] valid right-edge times for the frozen strip
    const span = this.plotW() * this.msPerPx();
    if (this.viewSnap) { const s = this.viewSnap; return [Math.min(s.t0 + span, s.t1), s.t1]; }
    const fin = this.sim.egm.finT - 1;
    const lo = Math.max(span, fin - KEEP + span);
    return [Math.min(lo, fin), fin];
  }
  _clampView() {
    const [lo, hi] = this._range();
    this.freezeT = Math.max(lo, Math.min(hi, this.freezeT));
  }
  // positive ms = later (scroll right), negative = earlier (scroll left)
  scrollBy(ms) {
    if (!this.sim) return;
    if (!this.frozen) this.setFrozen(true);
    this.freezeT += ms;
    this._clampView();
    this._report();
  }
  scrollPage(dir) { this.scrollBy(dir * this.plotW() * this.msPerPx() * 0.8); }
  goLive() { this.setFrozen(false); }
  behindMs() { return this.frozen && this.sim && !this.viewSnap ? Math.max(0, this.sim.egm.finT - 1 - this.freezeT) : 0; }

  _wheel(e) {
    if (!this.sim) return;
    e.preventDefault();
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    const px = e.deltaMode === 1 ? d * 16 : e.deltaMode === 2 ? d * this.plotW() : d;
    this.scrollBy(px * this.msPerPx());
  }

  // time at x (frozen strip: linear; live: sweep mapping)
  timeAt(x) {
    const mpp = this.msPerPx(), plotW = this.plotW();
    if (this.frozen) return this.freezeT - (plotW - (x - GUTTER)) * mpp;
    const tEnd = this.sim.egm.finT - 1;
    const colEnd = Math.floor(tEnd / mpp) % plotW;
    const px = x - GUTTER;
    return tEnd - (((colEnd - px) % plotW) + plotW) % plotW * mpp;
  }
  xAt(t) { const mpp = this.msPerPx(), plotW = this.plotW(); return GUTTER + plotW - (this.freezeT - t) / mpp; }

  _thumb() {
    // scroll-bar geometry: track covers the stored history, thumb = visible window
    const s = this.viewSnap;
    const fin = s ? s.t1 : this.sim.egm.finT - 1, plotW = this.plotW();
    const span = plotW * this.msPerPx();
    const t0 = s ? s.t0 : Math.max(0, fin - KEEP), total = Math.max(span, fin - t0);
    const right = this.frozen ? this.freezeT : fin;
    const x0 = GUTTER + ((right - span - t0) / total) * plotW, x1 = GUTTER + ((right - t0) / total) * plotW;
    return { x0: Math.max(GUTTER, x0), x1: Math.min(this.W, Math.max(x0 + 14, x1)), t0, total };
  }

  _down(e) {
    if (!this.sim) return;
    const r = this.canvas.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top;
    if (x < GUTTER) return;
    // scroll bar
    if (y > this.H - SCROLL_H - 2) {
      const th = this._thumb();
      if (!this.frozen) this.setFrozen(true);
      if (x < th.x0 || x > th.x1) { // click on the track: centre the window there
        this.freezeT = th.t0 + ((x - GUTTER) / this.plotW()) * th.total + this.plotW() * this.msPerPx() / 2;
        this._clampView(); this._report();
      }
      this.thumbDrag = { x, t: this.freezeT, total: this._thumb().total };
      this.canvas.setPointerCapture?.(e.pointerId);
      return;
    }
    if (this.calipers) {
      if (!this.frozen) this.setFrozen(true);
      const t = this.timeAt(x);
      // grab the nearest existing caliper line, else start a new pair
      let idx = this.cal.findIndex((c) => Math.abs(this.xAt(c) - x) < 6);
      if (idx < 0) { this.cal = [t, t]; idx = 1; }
      this.drag = idx; this._report();
      return;
    }
    // drag the strip to scroll (grab-and-pull like a paper strip)
    this.pan = { x, t: this.frozen ? this.freezeT : this.sim.egm.finT - 1 };
    this.canvas.style.cursor = 'grabbing';
    this.canvas.setPointerCapture?.(e.pointerId);
  }
  _move(e) {
    const r = this.canvas.getBoundingClientRect();
    const xr = e.clientX - r.left;
    if (this.thumbDrag) {
      const d = this.thumbDrag;
      this.freezeT = d.t + ((xr - d.x) / this.plotW()) * d.total;
      this._clampView(); this._report();
      return;
    }
    if (this.pan) {
      const dx = xr - this.pan.x;
      if (!this.frozen && Math.abs(dx) < 3) return;
      if (!this.frozen) this.setFrozen(true);
      this.freezeT = this.pan.t - dx * this.msPerPx();
      this._clampView(); this._report();
      return;
    }
    if (this.drag == null) return;
    const x = Math.max(GUTTER, Math.min(this.W, xr));
    this.cal[this.drag] = this.timeAt(x); this._report();
  }
  nudge(ms) { if (this.cal.length === 2) { this.cal[1] += ms; this._report(); } }
  caliperMs() { return this.cal.length === 2 ? Math.round(Math.abs(this.cal[1] - this.cal[0])) : null; }
  _report() {
    const el = document.getElementById('egm-measure'); if (!el) return;
    const d = this.caliperMs();
    const back = this.behindMs();
    const rev = back > 50 ? ` · review −${(back / 1000).toFixed(1)} s` : '';
    const sn = this.viewSnap ? ` · Snap ${this.viewSnap.num}` : '';
    el.textContent = d != null ? `Δ ${d} ms${d > 200 ? ` ≈ ${Math.round(60000 / d)} bpm` : ''}${rev}${sn}` : this.viewSnap ? `Snap ${this.viewSnap.num} · drag the calipers to measure` : this.frozen ? `Frozen${rev} · scroll/drag to review` : '';
  }

  channels() {
    const sim = this.sim; if (!sim) return [];
    if (this.viewSnap) return this.viewSnap.chs.map((c) => c.id);
    return ORDER.filter((id) => sim.egm.byId[id] && !sim.egm.byId[id].hidden && (id !== 'PV' || sim.cfg.mechanism === 'af'));
  }

  draw() {
    const ctx = this.ctx, sim = this.sim, W = this.W, H = this.H;
    if (!W || !H) return;
    ctx.fillStyle = this.bg; ctx.fillRect(0, 0, W, H);
    if (!sim) return;
    if (this.frozen) this._clampView();
    const chs = this.channels(); const n = chs.length;
    const HP = H - SCROLL_H; // plot height above the scroll bar
    const rowH = Math.max(11, HP / n);
    const plotW = this.plotW(), mpp = this.msPerPx();
    const egm = sim.egm;
    const fin = egm.finT - 1;
    const tEnd = this.frozen ? this.freezeT : fin;
    const colEnd = Math.floor(tEnd / mpp) % plotW;
    // grid: 40 ms minor, 200 ms major (paper-style)
    if (this.speed >= 50) {
      for (let k = 0; k < plotW / (40 / mpp) + 1; k++) {
        const tt = Math.floor(tEnd / 40) * 40 - k * 40;
        const x = this.frozen ? this.xAt(tt) : GUTTER + ((((Math.floor(tt / mpp) % plotW) + plotW) % plotW));
        ctx.fillStyle = tt % 200 === 0 ? this.gridMaj : this.gridMin;
        ctx.fillRect(Math.round(x), 0, 1, HP);
      }
    }
    // labels
    ctx.font = '500 11px ' + getComputedStyle(document.body).getPropertyValue('--font-mono');
    ctx.textBaseline = 'middle';
    for (let r = 0; r < n; r++) {
      const id = chs[r], y0 = r * rowH + rowH / 2;
      ctx.fillStyle = this.colors[id] || '#ccc';
      const sc = this.viewSnap?.chs.find((c) => c.id === id);
      const ch = sc || egm.byId[id];
      ctx.fillText(sc ? sc.label : (ch.group === 'ABL' ? ch.label : LABEL[id]) || id, 6, y0);
      const surf = ch.kind === 'surface';
      const g = rowH * 0.42 * this.gain * (ch.gain || 1);
      const clip = surf ? 2.2 : 1.6; // amplifier clipping like a recording system
      ctx.strokeStyle = this.colors[id] || '#ccc'; ctx.lineWidth = surf ? 1.2 : 1.1;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      let pen = false;
      // Every pixel column owns a fixed time bin [c*mpp, (c+1)*mpp) on an absolute grid, so a
      // column's content never changes once drawn (re-binning by the moving sweep time made
      // the whole trace shimmer as the sweep advanced by fractions of a pixel).
      const cEnd = Math.floor(tEnd / mpp);
      for (let px = 0; px < plotW; px++) {
        let back;
        if (this.frozen) back = plotW - 1 - px;
        else {
          back = ((colEnd - px) % plotW + plotW) % plotW;
          if (back > plotW - 8) { pen = false; continue; } // erase gap
        }
        const c = cEnd - back;
        const sa = Math.ceil(c * mpp), sb = Math.min(Math.max(sa, Math.ceil((c + 1) * mpp) - 1), Math.floor(tEnd));
        const t = sb;
        if (sa < 0 || t < 0 || (this.viewSnap ? sa < this.viewSnap.t0 || t >= this.viewSnap.t1 : fin - sa > KEEP)) { pen = false; continue; }
        // min/max over the samples in this pixel for spikes
        let lo = Infinity, hi = -Infinity;
        for (let k = sa; k <= sb; k++) { const v = this._sample(id, k); if (v < lo) lo = v; if (v > hi) hi = v; }
        const yA = y0 - Math.max(-clip, Math.min(clip, hi)) * g, yB = y0 - Math.max(-clip, Math.min(clip, lo)) * g;
        const x = GUTTER + px + 0.5;
        if (!pen) { ctx.moveTo(x, yA); pen = true; } else ctx.lineTo(x, yA);
        if (yB - yA > 1) ctx.lineTo(x, yB);
      }
      ctx.stroke();
      // thin separator between surface ECG and intracardiac groups
      const nx = r + 1 < n ? (this.viewSnap?.chs.find((c) => c.id === chs[r + 1]) || egm.byId[chs[r + 1]]) : null;
      if (surf && nx && nx.kind !== 'surface') { ctx.fillStyle = this.gridMaj; ctx.fillRect(GUTTER, (r + 1) * rowH, plotW, 1); }
    }
    // sweep bar
    if (!this.frozen) { ctx.fillStyle = this.annot; ctx.fillRect(GUTTER + colEnd + 1, 0, 1, HP); }
    // gutter separator
    ctx.fillStyle = this.gridMaj; ctx.fillRect(GUTTER - 2, 0, 1, H);
    // calipers
    if (this.frozen && this.cal.length === 2) {
      ctx.strokeStyle = this.calCol; ctx.lineWidth = 1.5;
      for (const c of this.cal) { const x = this.xAt(c); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, HP); ctx.stroke(); }
      const x0 = this.xAt(this.cal[0]), x1 = this.xAt(this.cal[1]);
      ctx.fillStyle = this.calCol; ctx.fillText(`Δ ${this.caliperMs()} ms`, Math.min(x0, x1) + 4, 10);
    }
    // scroll bar (history track + visible window)
    const th = this._thumb();
    ctx.fillStyle = this.gridMin; ctx.fillRect(GUTTER, H - SCROLL_H + 2, plotW, SCROLL_H - 4);
    ctx.fillStyle = this.frozen ? this.calCol : this.annot; ctx.globalAlpha = this.frozen ? 0.85 : 0.45;
    ctx.fillRect(th.x0, H - SCROLL_H + 2, th.x1 - th.x0, SCROLL_H - 4);
    ctx.globalAlpha = 1;
    if (this.frozen) {
      ctx.fillStyle = this.annot;
      const back = this.behindMs();
      ctx.fillText(this.viewSnap ? `SNAP ${this.viewSnap.num}` : back > 50 ? `−${(back / 1000).toFixed(1)} s` : 'FROZEN', 6, H - SCROLL_H / 2 - 1);
    }
  }
}
