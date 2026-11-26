// Side panels and top bar (UX spec §2.1, §2.2, §2.4): workflow & step actions,
// catheter placement, map settings, stimulator, drugs/patient, RF generator.

import { STEPS } from '../cases/cases.js';
import { PLACEMENT_SITES, ABL_TYPES } from '../engine/catheters.js';
import { REF_OPTIONS } from '../engine/mapping.js';
import { esc } from './modals.js';

const $ = (id) => document.getElementById(id);
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

const MANEUVERS = {
  rv_entrainment: 'RV entrainment (TCL − 20 ms)',
  v_overdrive: 'V overdrive pacing (TCL − 20 ms)',
  a_overdrive: 'A overdrive pacing (TCL − 20 ms)',
  his_pvc: 'His-refractory PVC',
  para_hisian: 'Para-Hisian pacing (sinus)',
  adenosine: 'Adenosine 12 mg IV',
  cs_pacing: 'CS distal pacing 600 ms',
  entrain_cti: 'Entrain from the CTI (ABL)',
  entrain_cs: 'Entrain from distal CS',
  entrain_isthmus: 'Entrain from scar channel (ABL)',
  pace_map: 'Pace map at ABL tip',
  storm_checklist: 'Storm checklist (drugs panel)',
};

export class Panels {
  constructor(app) { this.app = app; this.results = []; }

  build() {
    const { sim, wf, c } = this.app;
    $('tb-case').textContent = c.title; $('tb-case').title = c.title;
    $('tb-steps').innerHTML = STEPS.map((s, i) => `<li class="step-progress__pip" data-i="${i}" title="${s.label}"></li>`).join('');
    this.results = [];
    this.buildCatheters(); this.buildMapSettings(); this.buildStim(); this.buildDrugs(); this.buildRF();
    this.renderWorkflow();
    $('abl-chamber').value = sim.catheters.ABL.chamber;
    document.querySelector('.app-shell').dataset.mode = wf.sandbox ? 'sandbox' : 'case';
    $('hint-card').hidden = true;
  }

  // ------------------------------------------------------------ workflow
  renderWorkflow() {
    const { wf } = this.app;
    const list = $('workflow-list');
    list.innerHTML = '';
    STEPS.forEach((s, i) => {
      const cls = i < wf.stepIdx ? 'is-done' : i === wf.stepIdx ? 'is-current' : 'is-locked';
      const li = h(`<li class="workflow-step ${cls}" ${i === wf.stepIdx ? 'aria-current="step"' : ''}><span class="workflow-step__index">${i + 1}</span><span class="workflow-step__title">${s.label}</span></li>`);
      if (i === wf.stepIdx || (wf.sandbox && i === wf.stepIdx)) {
        const ul = h('<ul class="workflow-step__tasks"></ul>');
        for (const t of wf.tasks(s.id)) ul.appendChild(h(`<li class="workflow-step__task ${t.done ? 'is-complete' : t.tested ? 'is-failed' : ''}">${esc(t.text)}</li>`));
        li.appendChild(ul);
      }
      list.appendChild(li);
    });
    document.querySelectorAll('.step-progress__pip').forEach((p, i) => { p.className = 'step-progress__pip ' + (i < wf.stepIdx ? 'is-done' : i === wf.stepIdx ? 'is-current' : 'is-pending'); });
    this.renderStepActions();
  }

  refreshTasks() {
    const { wf } = this.app;
    const cur = document.querySelector('.workflow-step.is-current .workflow-step__tasks');
    if (!cur) return;
    const tasks = wf.tasks();
    const html = tasks.map((t) => `<li class="workflow-step__task ${t.done ? 'is-complete' : t.tested ? 'is-failed' : ''}">${esc(t.text)}</li>`).join('');
    if (cur.innerHTML !== html) cur.innerHTML = html;
    const nb = $('btn-next'); if (nb) nb.disabled = !wf.canAdvance().ok;
  }

  renderStepActions() {
    const { wf, c, sim } = this.app;
    const box = $('step-actions'); box.innerHTML = '';
    const step = wf.step.id;
    const add = (el) => { box.appendChild(el); return el; };
    const btn = (label, fn, cls = '') => { const b = h(`<button class="btn btn--sm ${cls}">${esc(label)}</button>`); b.addEventListener('click', fn); return add(b); };
    if (step === 'briefing') {
      btn('Open briefing', () => this.app.showBriefing());
    } else if (step === 'placement') {
      add(h('<p class="note">Choose a site for each catheter below and check the EGM signatures (His: A-H-V; CS: A and V; RVA: large V).</p>'));
    } else if (step === 'baseline') {
      add(h('<p class="note">Freeze the EGM and use calipers on a sinus beat. Enter your measurements (ms).</p>'));
      const f = h(`<div class="baseline-form">${['cl', 'pr', 'qrs', 'ah', 'hv'].map((k) => `<label class="field"><span>${k.toUpperCase()}</span><input type="number" id="bl-${k}" min="0" max="2000" step="1"></label>`).join('')}</div>`);
      add(f);
      btn('Submit measurements', () => {
        const vals = {}; for (const k of ['cl', 'pr', 'qrs', 'ah', 'hv']) vals[k] = $('bl-' + k).value;
        const r = wf.submitBaseline(vals);
        if (!r) { this.app.toast('info', 'Wait for a conducted sinus beat'); return; }
        const okN = Object.values(r).filter((x) => x.ok).length;
        this.addResult(`Baseline: ${okN}/5 within tolerance. ` + Object.entries(r).map(([k, v]) => `${k.toUpperCase()} ${v.value ?? '—'}${v.ok ? ' ✔' : ` ✖ (${v.truth})`}`).join(' · '), okN >= 4);
        this.refreshTasks();
      }, 'btn--primary');
    } else if (step === 'induction') {
      add(h(`<p class="note">${esc(c.induction.text)}</p>`));
    } else if (step === 'maneuvers') {
      for (const m of c.maneuvers) btn(MANEUVERS[m] || m, () => this.app.doManeuver(m));
      btn('Commit diagnosis…', () => this.app.diagnosisModal(), 'btn--primary');
    } else if (step === 'mapping') {
      add(h(`<p class="note">Map the ${c.map.chamber}: Space acquires at the ablation tip, Shift+click acquires on the shell. Suggested reference ${c.map.ref}, WOI ${c.map.woi.join('…')} ms.</p>`));
    } else if (step === 'ablation') {
      add(h(`<p class="note">Target: ${esc(c.target.label)}. Set power (${c.rfPower} W suggested), check contact (10–30 g) and press A / START RF.</p>`));
    } else if (step === 'endpoint') {
      for (const e of c.endpoints) {
        const r = wf.rec.endpoints[e.id];
        btn(`${r ? (r.pass ? '✔ ' : '✖ ') : ''}Test: ${e.label}`, () => this.app.runEndpoint(e.id));
      }
      btn('Finish case → debrief', () => this.app.finishCase(), 'btn--primary');
    }
    if (step !== 'endpoint') {
      const nb = btn(step === 'ablation' ? 'Proceed to endpoints →' : 'Next step →', () => this.app.nextStep(), 'btn--primary');
      nb.id = 'btn-next'; nb.disabled = !wf.canAdvance().ok;
      if (wf.sandbox) nb.disabled = false;
    }
    for (const r of this.results.slice(-5)) box.appendChild(h(`<div class="result ${r.ok === true ? 'is-ok' : r.ok === false ? 'is-bad' : ''}">${esc(r.text)}</div>`));
    void sim;
  }
  addResult(text, ok) { this.results.push({ text, ok }); this.renderStepActions(); }

  // ------------------------------------------------------------ catheters
  buildCatheters() {
    const { sim } = this.app;
    const box = $('cath-list'); box.innerHTML = '';
    const cs = getComputedStyle(document.documentElement);
    for (const id of ['HRA', 'HIS', 'CS', 'RVA']) {
      const cat = sim.catheters[id];
      const row = h(`<div class="cath-row" id="cath-${id}"><span class="cath-row__swatch" style="background:${cs.getPropertyValue(cat.info.color)}"></span><span class="cath-row__name">${cat.info.name}</span>
        <select class="select" aria-label="${cat.info.name} catheter position"><option value="">— not placed —</option>${PLACEMENT_SITES[id].map((s) => `<option value="${s.id}">${esc(s.label)}</option>`).join('')}</select></div>`);
      const sel = row.querySelector('select');
      if (cat.placed) sel.value = cat.site.id;
      sel.addEventListener('change', () => { if (sel.value) this.app.placeCatheter(id, sel.value); });
      box.appendChild(row);
    }
    const abl = sim.catheters.ABL;
    const arow = h(`<div class="cath-row" id="cath-ABL"><span class="cath-row__swatch" style="background:${cs.getPropertyValue('--c-cath-abl')}"></span><span class="cath-row__name">ABL</span>
      <select class="select" id="abl-type" aria-label="Steerable catheter type" title="Swap the steerable catheter: ablation, or a multipolar mapping catheter for high-density maps">${Object.entries(ABL_TYPES).map(([k, t]) => `<option value="${k}">${esc(t.label)}</option>`).join('')}</select></div>`);
    const tsel = arow.querySelector('select'); tsel.value = abl.type;
    tsel.addEventListener('change', () => this.app.setAblType(tsel.value));
    box.appendChild(arow);
    this.refreshCatheters();
  }
  refreshCatheters() {
    const { sim, wf } = this.app;
    for (const id of ['HRA', 'HIS', 'CS', 'RVA']) {
      const row = $('cath-' + id); if (!row) continue;
      const cat = sim.catheters[id];
      row.classList.toggle('is-ok', cat.placed && cat.correct); row.classList.toggle('is-bad', cat.placed && !cat.correct);
      const sel = row.querySelector('select'); sel.disabled = !wf.reached('placement');
      if (cat.placed && sel.value !== cat.site.id) sel.value = cat.site.id;
    }
  }

  // ------------------------------------------------------------ map settings
  buildMapSettings() {
    const { sim } = this.app;
    const s = sim.mapping.settings;
    const box = $('map-settings');
    box.innerHTML = `
      <label class="field"><span>Reference</span><select class="select" id="ms-ref">${REF_OPTIONS.map((r) => `<option value="${r.id}">${r.label}</option>`).join('')}</select></label>
      <label class="field"><span>WOI start (ms)</span><input type="number" id="ms-woi0" step="5" value="${s.woi[0]}"></label>
      <label class="field"><span>WOI end (ms)</span><input type="number" id="ms-woi1" step="5" value="${s.woi[1]}"></label>
      <label class="field"><span>Fill radius (mm)</span><input type="number" id="ms-fill" min="5" max="30" step="1" value="${s.fill}"></label>
      <label class="field"><span>Voltage low / high (mV)</span><span class="row"><input type="number" id="ms-vlo" step="0.05" value="${s.voltLo}" style="width:58px"><input type="number" id="ms-vhi" step="0.05" value="${s.voltHi}" style="width:58px"></span></label>
      <label class="field"><span>Palette</span><select class="select" id="ms-pal"><option value="">Default</option><option value="cb">Colorblind-safe</option></select></label>
      <div class="row"><button class="btn btn--sm" id="ms-clear">Clear map</button><span class="note mono" id="ms-count"></span></div>
      <p class="note mono" id="ms-woi-warn"></p>`;
    $('ms-ref').value = s.ref;
    const apply = () => {
      sim.mapping.setSettings({ ref: $('ms-ref').value, woi: [Number($('ms-woi0').value), Number($('ms-woi1').value)], fill: Number($('ms-fill').value) || 10, voltLo: Number($('ms-vlo').value) || 0.5, voltHi: Number($('ms-vhi').value) || 1.5 });
      this.app.updateColorbar();
    };
    for (const id of ['ms-ref', 'ms-woi0', 'ms-woi1', 'ms-fill', 'ms-vlo', 'ms-vhi']) $(id).addEventListener('change', apply);
    $('ms-pal').value = document.documentElement.dataset.palette || '';
    $('ms-pal').addEventListener('change', (e) => this.app.setPalette(e.target.value));
    $('ms-clear').addEventListener('click', () => { sim.mapping.clear(); });
  }

  // ------------------------------------------------------------ stimulator
  buildStim() {
    const box = $('stim-body');
    box.innerHTML = `
      <label class="field"><span>Site</span><select class="select" id="st-site"></select></label>
      <div class="segmented" role="radiogroup" aria-label="Pacing mode" id="st-mode">
        <button role="radio" class="segmented__option" data-mode="fixed" aria-checked="true">S1</button>
        <button role="radio" class="segmented__option" data-mode="s1s2" aria-checked="false">S1S2</button>
        <button role="radio" class="segmented__option" data-mode="burst" aria-checked="false">Burst</button>
        <button role="radio" class="segmented__option" data-mode="decremental" aria-checked="false">Decr</button>
      </div>
      <label class="field"><span>S1 CL (ms)</span><input type="number" id="st-s1" min="200" max="1000" step="10" value="600" aria-label="S1 cycle length"></label>
      <label class="field st-x"><span>S2 (ms) <button class="btn btn--sm" id="st-dec" title="Decrement S2 by 10 ms">▾10</button></span><input type="number" id="st-s2" min="150" max="600" step="10" value="320"></label>
      <label class="field st-x"><span>S3 (ms, 0 = off)</span><input type="number" id="st-s3" min="0" max="600" step="10" value="0"></label>
      <label class="field"><span>Beats / drive</span><input type="number" id="st-n" min="3" max="60" step="1" value="8"></label>
      <label class="field"><span>Output (mA)</span><input type="number" id="st-ma" min="0.5" max="20" step="0.5" value="5"></label>
      <p class="note">Pulse width 2 ms</p>
      <button class="btn btn-pace btn--block" id="btn-pace" aria-pressed="false" title="Pace (P)">■ PACE</button>`;
    box.querySelectorAll('#st-mode .segmented__option').forEach((b) => b.addEventListener('click', () => {
      box.querySelectorAll('#st-mode .segmented__option').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      this.stimMode = b.dataset.mode; this.toggleStimFields();
    }));
    this.stimMode = 'fixed'; this.toggleStimFields();
    $('st-dec').addEventListener('click', (e) => { e.preventDefault(); $('st-s2').value = Math.max(150, Number($('st-s2').value) - 10); });
    $('btn-pace').addEventListener('click', () => this.app.togglePace());
    this.refreshSites();
  }
  toggleStimFields() { document.querySelectorAll('.st-x').forEach((el) => { el.hidden = this.stimMode !== 's1s2'; }); }
  refreshSites() {
    const sel = $('st-site'); if (!sel) return;
    const cur = sel.value;
    const sites = this.app.sim.stim.sites();
    sel.innerHTML = sites.map((s) => `<option value="${s.id}">${s.label}</option>`).join('');
    if (sites.some((s) => s.id === cur)) sel.value = cur;
  }
  stimOptions() {
    const n = (id) => Number($(id).value);
    const o = { site: $('st-site').value, mode: this.stimMode, s1: n('st-s1'), mA: n('st-ma') };
    if (o.mode === 's1s2') { o.s2 = n('st-s2'); if (n('st-s3') > 0) o.s3 = n('st-s3'); o.nDrive = n('st-n'); }
    else if (o.mode === 'fixed') o.beats = n('st-n') >= 60 ? 0 : n('st-n');
    else if (o.mode === 'burst') o.duration = Math.max(1000, n('st-n') * o.s1);
    return o;
  }

  // ------------------------------------------------------------ drugs / patient
  buildDrugs() {
    const { sim, c } = this.app;
    const box = $('drug-body');
    box.innerHTML = `
      <div class="vitals"><div>HR<b id="vt-hr">--</b></div><div>BP<b id="vt-bp">--</b></div><div>SpO₂<b id="vt-spo2">--</b></div>
      <div>K⁺<b id="vt-k">--</b></div><div>Mg²⁺<b id="vt-mg">--</b></div><div>Eso °C<b id="vt-eso">--</b></div></div>
      <label class="field"><span>Isoproterenol (µg/min)</span><select class="select" id="dr-iso"><option value="0">off</option><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option></select></label>
      <label class="field"><span>Sedation</span><select class="select" id="dr-sed"><option value="light">light</option><option value="deep">deep</option></select></label>
      <div class="row"><button class="btn btn--sm" id="dr-ado">Adenosine 12 mg</button><button class="btn btn--sm" id="dr-k">KCl 20 mmol</button><button class="btn btn--sm" id="dr-mg">Mg 2 g</button></div>
      <div class="row"><button class="btn btn--sm" id="dr-bb">Beta-blocker IV</button><button class="btn btn--sm" id="dr-amio">Amiodarone 150 mg</button></div>
      <div class="row"><button class="btn btn-defib" id="btn-defib" title="Defibrillate (D)">⚡ DEFIB 200 J</button><label class="note"><input type="checkbox" id="dr-sync"> Sync</label></div>
      <button class="btn btn--sm" id="dr-pcc" hidden>Pericardiocentesis</button>`;
    $('dr-iso').value = String(sim.drugs.iso); $('dr-sed').value = sim.drugs.sedation;
    $('dr-iso').addEventListener('change', (e) => { sim.setIso(Number(e.target.value)); this.app.toast('info', `Isoproterenol ${e.target.value} µg/min`); });
    $('dr-sed').addEventListener('change', (e) => { sim.drugs.sedation = e.target.value; sim.logEvent('drug', { drug: 'sedation', level: e.target.value }); });
    $('dr-ado').addEventListener('click', () => this.app.doManeuver('adenosine'));
    $('dr-k').addEventListener('click', () => { sim.labs.K = Math.min(5, sim.labs.K + 0.6); sim.logEvent('drug', { drug: 'KCl' }); this.app.stormCheck(); });
    $('dr-mg').addEventListener('click', () => { sim.labs.Mg = Math.min(3, sim.labs.Mg + 0.5); sim.logEvent('drug', { drug: 'Mg' }); this.app.stormCheck(); });
    $('dr-bb').addEventListener('click', () => { sim.drugs.betaBlocker = true; sim.logEvent('drug', { drug: 'beta-blocker' }); this.app.toast('info', 'Beta-blocker given'); this.app.stormCheck(); });
    $('dr-amio').addEventListener('click', () => { sim.drugs.amiodarone = true; sim.logEvent('drug', { drug: 'amiodarone' }); this.app.toast('info', 'Amiodarone 150 mg given'); this.app.stormCheck(); });
    $('btn-defib').addEventListener('click', () => this.app.defib());
    $('dr-pcc').addEventListener('click', () => { sim.hemo.drained = true; sim.hemo.tamponade = false; sim.logEvent('treatment', { id: 'pericardiocentesis' }); this.app.toast('success', 'Pericardiocentesis: effusion drained, BP recovering'); });
    void c;
  }

  // ------------------------------------------------------------ RF generator
  buildRF() {
    const { sim } = this.app;
    const a = sim.ablation;
    $('rf-body').innerHTML = `
      <div class="row row--between"><label class="field"><span>Power (W)</span><input type="number" id="rf-p" min="1" max="50" step="1" value="${a.power}"></label>
      <label class="field"><span>Time (s)</span><input type="number" id="rf-d" min="5" max="120" step="5" value="${a.durationSet}"></label></div>
      <div class="readouts" aria-live="off">
        <div class="readout" id="ro-pow"><div class="readout__label">Power</div><span class="readout__value">0</span><span class="readout__unit">W</span></div>
        <div class="readout" id="ro-time"><div class="readout__label">Elapsed</div><span class="readout__value">0</span><span class="readout__unit">s</span></div>
        <div class="readout" id="ro-cf"><div class="readout__label">Contact</div><span class="readout__value">0</span><span class="readout__unit">g</span><div class="force-bar" data-band="low"><i class="force-bar__seg"></i><i class="force-bar__seg"></i><i class="force-bar__seg"></i><i class="force-bar__seg"></i></div></div>
        <div class="readout" id="ro-z"><div class="readout__label">Impedance</div><span class="readout__value">--</span><span class="readout__unit">Ω</span><div class="readout__delta"></div></div>
        <div class="readout" id="ro-temp"><div class="readout__label">Temp</div><span class="readout__value">--</span><span class="readout__unit">°C</span></div>
        <div class="readout" id="ro-lqi"><div class="readout__label">LQI</div><span class="readout__value">--</span><span class="readout__unit">/10</span></div>
      </div>
      <button class="btn btn-rf is-ready" id="btn-rf" aria-pressed="false" title="RF start/stop (A)">▶ START RF</button>
      <div class="reason" id="rf-reason"></div>`;
    $('rf-p').addEventListener('change', (e) => { a.power = Math.max(1, Math.min(50, Number(e.target.value) || 30)); });
    $('rf-d').addEventListener('change', (e) => { a.durationSet = Math.max(5, Math.min(120, Number(e.target.value) || 60)); });
    $('btn-rf').addEventListener('click', () => this.app.toggleRF());
  }

  // ------------------------------------------------------------ periodic refresh (~5 Hz)
  tick() {
    const { sim, wf } = this.app;
    const a = sim.ablation, abl = sim.catheters.ABL;
    const set = (id, v, cls) => { const el = $(id); if (!el) return; el.querySelector('.readout__value').textContent = v; el.classList.remove('is-ok', 'is-warn', 'is-danger'); if (cls) el.classList.add(cls); };
    set('ro-pow', a.on ? a.power : 0, a.on ? 'is-ok' : '');
    set('ro-time', a.on ? Math.floor(a.elapsed) : 0);
    const cf = abl.cf; const band = cf < 5 ? 'low' : cf < 10 ? 'fair' : cf <= 40 ? 'good' : 'excess';
    if (abl.array) set('ro-cf', '—', ''); // multipolar mapping catheters have no force sensor
    else set('ro-cf', cf.toFixed(0), cf > 40 ? 'is-danger' : cf >= 10 ? 'is-ok' : 'is-warn');
    $('ro-cf').querySelector('.force-bar').dataset.band = band;
    const dz = a.Z0 - a.Z;
    set('ro-z', a.Z.toFixed(0), a.on ? (a.Z - a.zMin > 10 ? 'is-danger' : dz >= 5 ? 'is-ok' : '') : '');
    $('ro-z').querySelector('.readout__delta').textContent = a.on ? (dz >= 0 ? `↓${dz.toFixed(0)} Ω` : `↑${(-dz).toFixed(0)} Ω`) : `base ${a.Z0.toFixed(0)}`;
    set('ro-temp', a.temp.toFixed(0));
    set('ro-lqi', a.on || a.lqi ? a.lqi.toFixed(1) : '--', a.lqi > 7 ? 'is-danger' : a.lqi >= 3.5 ? 'is-ok' : '');
    const b = $('btn-rf');
    const why = a.on ? '' : a.canStart();
    b.className = 'btn btn-rf ' + (a.on ? 'is-active' : why ? 'is-blocked' : 'is-ready');
    b.textContent = a.on ? `■ STOP RF · ${Math.floor(a.elapsed)} s` : '▶ START RF';
    b.setAttribute('aria-pressed', String(a.on));
    $('rf-reason').textContent = why;
    // vitals
    const hr = sim.status.vCL ? Math.round(60000 / sim.status.vCL) : '--';
    $('vt-hr').textContent = sim.mech.vf?.on ? 'VF' : hr;
    const hemo = sim.hemo; $('vt-bp').textContent = `${Math.round(hemo.sbp)}/${Math.round(hemo.dbp)}`;
    $('vt-spo2').textContent = Math.round(hemo.spo2); $('vt-k').textContent = sim.labs.K.toFixed(1); $('vt-mg').textContent = sim.labs.Mg.toFixed(1);
    $('vt-eso').textContent = abl.chamber === 'LA' ? a.eso.T.toFixed(1) : '--';
    $('dr-pcc').hidden = !hemo.tamponade;
    $('btn-pace').setAttribute('aria-pressed', String(sim.stim.isPacing()));
    $('btn-pace').textContent = sim.stim.isPacing() ? '■ STOP PACING' : '▶ PACE';
    // top bar
    const st = sim.status; const rh = $('tb-rhythm');
    // show the faster chamber's CL (VT with AV dissociation: V; AT/flutter with block: A)
    const tcl = Math.min(...[st.aCL, st.vCL].filter((x) => x > 0));
    rh.textContent = `${st.rhythm}${st.tachy && isFinite(tcl) ? ` · CL ${Math.round(tcl)}` : ''}`;
    rh.className = 'chip chip--status' + (sim.mech.vf?.on ? ' is-danger' : st.tachy ? ' is-warn' : '');
    const p = $('tb-pacing');
    if (sim.stim.isPacing()) { const ac = sim.stim.active; p.hidden = false; p.textContent = `⚡ Pacing ${ac.site} @ ${ac.s1} ms`; } else p.hidden = true;
    const secs = Math.floor(sim.t / 1000);
    const tm = $('tb-timer'); tm.textContent = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
    tm.classList.toggle('is-overtime', secs > this.app.c.mins * 60);
    $('tb-rf').textContent = `RF ${Math.round(a.totalRF + (a.on ? a.elapsed : 0))} s`;
    // map count
    const mc = $('ms-count'); if (mc) mc.textContent = `${sim.mapping.points.length} pts`;
    const ww = $('ms-woi-warn');
    if (ww) { const tcl = st.tachy ? Math.min(...[st.aCL, st.vCL].filter((x) => x > 0), Infinity) : 0; const span = sim.mapping.settings.woi[1] - sim.mapping.settings.woi[0]; ww.textContent = tcl && isFinite(tcl) && (span > tcl || span < 0.7 * tcl) ? `WOI ${span} ms vs TCL ${Math.round(tcl)} ms: map may be incomplete` : ''; }
    this.refreshTasks();
    void wf;
  }
}
