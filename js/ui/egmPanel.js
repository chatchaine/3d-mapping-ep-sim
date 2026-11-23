// EGM panel (UX spec §2.5): sweeping erase-bar display of surface ECG and intracardiac
// channels, sweep speed, gain, freeze and calipers.

const ORDER = ['I', 'II', 'V1', 'HRA', 'HISd', 'HISp', 'CS910', 'CS78', 'CS56', 'CS34', 'CS12', 'RVA', 'ABLd', 'ABLp', 'PV'];
const LABEL = { I: 'I', II: 'II', V1: 'V1', HRA: 'HRA d', HISd: 'His d', HISp: 'His p', CS910: 'CS 9-10', CS78: 'CS 7-8', CS56: 'CS 5-6', CS34: 'CS 3-4', CS12: 'CS 1-2', RVA: 'RVA d', ABLd: 'ABL d', ABLp: 'ABL p', PV: 'PV loop' };
const COLOR = { I: '--c-egm-surface', II: '--c-egm-surface', V1: '--c-egm-surface', HRA: '--c-egm-hra', HISd: '--c-egm-his', HISp: '--c-egm-his', CS910: '--c-egm-cs', CS78: '--c-egm-cs', CS56: '--c-egm-cs', CS34: '--c-egm-cs', CS12: '--c-egm-cs', RVA: '--c-egm-rva', ABLd: '--c-egm-abl', ABLp: '--c-egm-abl', PV: '--c-egm-his' };
const GUTTER = 74;

export class EGMPanel {
  constructor(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.speed = 100; this.gain = 1; this.frozen = false; this.freezeT = 0; this.calipers = false;
    this.cal = []; // caliper times (ms)
    this.drag = null;
    this.colors = {};
    this.refreshColors();
    new ResizeObserver(() => this.resize()).observe(canvas);
    canvas.addEventListener('pointerdown', (e) => this._down(e));
    canvas.addEventListener('pointermove', (e) => this._move(e));
    window.addEventListener('pointerup', () => { this.drag = null; });
    canvas.addEventListener('dblclick', () => { this.cal = []; this._report(); });
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
  setSim(sim) { this.sim = sim; this.cal = []; this.frozen = false; this._report(); }
  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.W = w; this.H = h;
  }
  msPerPx() { return 1000 / (this.speed * 3.78); }
  setSpeed(s) { this.speed = s; }
  setFrozen(f) { if (!this.sim) return; this.frozen = f; if (f) this.freezeT = this.sim.egm.finT - 1; else this.cal = []; this._report(); }

  channels() {
    const sim = this.sim; if (!sim) return [];
    return ORDER.filter((id) => sim.egm.byId[id] && (id !== 'PV' || sim.cfg.mechanism === 'af'));
  }

  // time at x (frozen strip: linear; live: sweep mapping)
  timeAt(x) {
    const mpp = this.msPerPx(), plotW = this.W - GUTTER;
    if (this.frozen) return this.freezeT - (plotW - (x - GUTTER)) * mpp;
    const tEnd = this.sim.egm.finT - 1;
    const colEnd = Math.floor(tEnd / mpp) % plotW;
    const px = x - GUTTER;
    return tEnd - (((colEnd - px) % plotW) + plotW) % plotW * mpp;
  }
  xAt(t) { const mpp = this.msPerPx(), plotW = this.W - GUTTER; return GUTTER + plotW - (this.freezeT - t) / mpp; }

  _down(e) {
    if (!this.calipers || !this.sim) return;
    if (!this.frozen) this.setFrozen(true);
    const r = this.canvas.getBoundingClientRect(); const x = e.clientX - r.left;
    if (x < GUTTER) return;
    const t = this.timeAt(x);
    // grab the nearest existing caliper line, else start a new pair
    let idx = this.cal.findIndex((c) => Math.abs(this.xAt(c) - x) < 6);
    if (idx < 0) { this.cal = [t, t]; idx = 1; }
    this.drag = idx; this._report();
  }
  _move(e) {
    if (this.drag == null) return;
    const r = this.canvas.getBoundingClientRect(); const x = Math.max(GUTTER, Math.min(this.W, e.clientX - r.left));
    this.cal[this.drag] = this.timeAt(x); this._report();
  }
  nudge(ms) { if (this.cal.length === 2) { this.cal[1] += ms; this._report(); } }
  caliperMs() { return this.cal.length === 2 ? Math.round(Math.abs(this.cal[1] - this.cal[0])) : null; }
  _report() {
    const el = document.getElementById('egm-measure'); if (!el) return;
    const d = this.caliperMs();
    el.textContent = d != null ? `Δ ${d} ms${d > 200 ? ` ≈ ${Math.round(60000 / d)} bpm` : ''}` : this.frozen ? 'Frozen — drag to measure' : '';
  }

  draw() {
    const ctx = this.ctx, sim = this.sim, W = this.W, H = this.H;
    if (!W || !H) return;
    ctx.fillStyle = this.bg; ctx.fillRect(0, 0, W, H);
    if (!sim) return;
    const chs = this.channels(); const n = chs.length;
    const rowH = Math.max(14, H / n);
    const plotW = W - GUTTER, mpp = this.msPerPx();
    const egm = sim.egm;
    const tEnd = this.frozen ? this.freezeT : egm.finT - 1;
    const colEnd = Math.floor(tEnd / mpp) % plotW;
    // grid
    if (this.speed >= 50) {
      for (let k = 0; k < plotW / (40 / mpp) + 1; k++) {
        const tt = Math.floor(tEnd / 40) * 40 - k * 40;
        const x = this.frozen ? this.xAt(tt) : GUTTER + ((((Math.floor(tt / mpp) % plotW) + plotW) % plotW));
        ctx.fillStyle = tt % 200 === 0 ? this.gridMaj : this.gridMin;
        ctx.fillRect(Math.round(x), 0, 1, H);
      }
    }
    // labels
    ctx.font = '500 11px ' + getComputedStyle(document.body).getPropertyValue('--font-mono');
    ctx.textBaseline = 'middle';
    for (let r = 0; r < n; r++) {
      const id = chs[r], y0 = r * rowH + rowH / 2;
      ctx.fillStyle = this.colors[id] || '#ccc';
      ctx.fillText(LABEL[id] || id, 6, y0);
      const ch = egm.byId[id];
      const surf = ch.kind === 'surface';
      const g = (surf ? rowH * 0.28 : rowH * 0.42) * this.gain * (ch.gain || 1);
      ctx.strokeStyle = this.colors[id] || '#ccc'; ctx.lineWidth = 1.1;
      ctx.beginPath();
      let pen = false;
      for (let px = 0; px < plotW; px++) {
        let t;
        if (this.frozen) t = tEnd - (plotW - 1 - px) * mpp;
        else {
          const back = ((colEnd - px) % plotW + plotW) % plotW;
          if (back > plotW - 8) { pen = false; continue; } // erase gap
          t = tEnd - back * mpp;
        }
        if (t < 0 || tEnd - t > 19500) { pen = false; continue; }
        // min/max over the samples in this pixel for spikes
        let lo = Infinity, hi = -Infinity;
        for (let k = 0; k < Math.max(1, mpp); k++) { const v = egm.sample(id, t - k); if (v < lo) lo = v; if (v > hi) hi = v; }
        const yA = y0 - Math.max(-1.6, Math.min(1.6, hi)) * g, yB = y0 - Math.max(-1.6, Math.min(1.6, lo)) * g;
        const x = GUTTER + px + 0.5;
        if (!pen) { ctx.moveTo(x, yA); pen = true; } else ctx.lineTo(x, yA);
        if (yB - yA > 1) ctx.lineTo(x, yB);
      }
      ctx.stroke();
    }
    // sweep bar
    if (!this.frozen) { ctx.fillStyle = this.annot; ctx.fillRect(GUTTER + colEnd + 1, 0, 1, H); }
    // gutter separator
    ctx.fillStyle = this.gridMaj; ctx.fillRect(GUTTER - 2, 0, 1, H);
    // calipers
    if (this.frozen && this.cal.length === 2) {
      ctx.strokeStyle = this.calCol; ctx.lineWidth = 1.5;
      for (const c of this.cal) { const x = this.xAt(c); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      const x0 = this.xAt(this.cal[0]), x1 = this.xAt(this.cal[1]);
      ctx.fillStyle = this.calCol; ctx.fillText(`Δ ${this.caliperMs()} ms`, Math.min(x0, x1) + 4, 10);
    }
    if (this.frozen) { ctx.fillStyle = this.annot; ctx.fillText('FROZEN', W - 56, H - 8); }
  }
}
