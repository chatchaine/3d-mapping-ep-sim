// 3D Mapping EP Sim — application entry: home / case library, case flow, render loop,
// keyboard shortcuts, debrief. Educational simulator; not a medical device.

import { CASES, LEVELS, SANDBOX_RHYTHMS, sandboxCase, STEPS } from './cases/cases.js';
import { Sim, getHeart } from './engine/sim.js';
import { Workflow } from './workflow.js';
import { scoreCase } from './scoring.js';
import { Viewport3D } from './ui/viewport3d.js';
import { EGMPanel } from './ui/egmPanel.js';
import { Panels } from './ui/panels.js';
import { notify, toast, clearAlerts, announce, setCriticalHandler } from './ui/alerts.js';
import { openModal, quizModal, helpModal, briefingBody, closeTop, closeAll, isModalOpen, esc } from './ui/modals.js';
import { PLACEMENT_SITES } from './engine/catheters.js';
import { nearestInChamber } from './engine/geometry.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem('epsim.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('epsim.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

class App {
  constructor() {
    this.sim = null; this.wf = null; this.c = null;
    this.paused = false; this.held = new Set(); this.lastFrame = performance.now(); this.lastTick = 0; this.speed = 1;
    this.vp = new Viewport3D($('viewport-canvas'), $('viewport'));
    this.egm = new EGMPanel($('egm-canvas'));
    this.panels = new Panels(this);
    this.filter = { tag: 'All', q: '' };
    const pal = store.get('palette', '');
    if (pal) document.documentElement.dataset.palette = pal;
    this.bindGlobal();
    this.renderHome();
    setCriticalHandler((id) => { if (this.sim?.ablation.on) this.sim.ablation.stop('alert:' + id); });
    requestAnimationFrame((t) => this.frame(t));
  }

  // ================================================================== HOME
  renderHome() {
    const tags = ['All', 'AVNRT', 'WPW/AP', 'AT', 'AF-PVI', 'AFL', 'VT'];
    $('filter-chips').innerHTML = tags.map((t) => `<button class="chip chip--toggle" data-tag="${t}" aria-pressed="${t === this.filter.tag}">${t}</button>`).join('');
    $('filter-chips').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { this.filter.tag = b.dataset.tag; this.renderHome(); }));
    const best = store.get('best', {});
    const q = this.filter.q.toLowerCase();
    const list = CASES.filter((c) => (this.filter.tag === 'All' || c.tag === this.filter.tag) && (!q || (c.title + c.tag + c.chamber).toLowerCase().includes(q)));
    $('case-grid').innerHTML = list.map((c) => `
      <button class="case-card ${best[c.id] != null ? 'is-completed' : ''}" role="listitem" data-case="${c.id}" aria-label="Case ${c.num}: ${esc(c.title)}, ${LEVELS[c.level]}">
        <div class="case-card__head"><span class="case-card__num" aria-hidden="true">${c.num}</span><span class="case-card__title">${esc(c.title)}</span></div>
        <div class="case-card__meta"><span class="badge badge--difficulty" data-level="${c.level}"><span class="badge__pips" aria-hidden="true">${'●'.repeat(c.level)}${'○'.repeat(3 - c.level)}</span>${LEVELS[c.level]}</span>
          <span class="tag-chip">${c.chamber}</span><span class="tag-chip">${c.tag}</span><span>~${c.mins} min</span>${c.mandatory ? '<span class="tag-chip">mandatory</span>' : ''}</div>
        <div class="case-card__best">${best[c.id] != null ? `✔ Best score ${best[c.id]}/100` : 'Not completed'}</div>
      </button>`).join('') + `
      <button class="case-card" role="listitem" data-sandbox="1" aria-label="Sandbox mode">
        <div class="case-card__head"><span class="case-card__num" aria-hidden="true">∞</span><span class="case-card__title">Sandbox</span></div>
        <div class="case-card__meta"><span class="badge badge--difficulty" data-level="0">Free play</span><span>no score</span></div>
        <div class="case-card__best">Choose rhythm and chamber; everything unlocked</div></button>`;
    $('case-grid').querySelectorAll('[data-case]').forEach((b) => b.addEventListener('click', () => this.startCase(CASES.find((c) => c.id === b.dataset.case))));
    $('case-grid').querySelector('[data-sandbox]').addEventListener('click', () => this.sandboxDialog());
  }

  sandboxDialog() {
    const body = `<label class="field"><span>Rhythm / substrate</span><select class="select" id="sb-r">${SANDBOX_RHYTHMS.map((r) => `<option value="${r.id}">${r.label}</option>`).join('')}</select></label>
      <label class="field"><span>Ablation chamber</span><select class="select" id="sb-c"><option value="">Case default</option><option>RA</option><option>LA</option><option>RV</option><option>LV</option></select></label>
      <p class="note">Sandbox: no score, all steps and RF unlocked, catheters pre-placed.</p>`;
    openModal({ title: 'Sandbox', size: 'sm', body, buttons: [{ label: 'Cancel' }, { label: 'Start', primary: true, onClick: () => { const r = $('sb-r').value, ch = $('sb-c').value; setTimeout(() => this.startCase(sandboxCase(r, ch)), 0); } }] });
  }

  // ================================================================== CASE FLOW
  startCase(c) {
    clearAlerts(); closeAll();
    this.c = c;
    this.sim = new Sim(c, { seed: 1000 + (c.num || 0) });
    this.wf = new Workflow(this.sim, c);
    window.__app = this;
    if (c.sandbox) { for (const id of ['HRA', 'HIS', 'CS', 'RVA']) this.wf.place(id, PLACEMENT_SITES[id].find((s) => s.ok).id); this.wf.stepIdx = STEPS.length - 1; }
    $('screen-home').hidden = true; $('screen-debrief').hidden = true; $('screen-app').hidden = false;
    this.vp.resize(); this.egm.resize();
    this.vp.setSim(this.sim, c.map.chamber);
    this.vp.mode = c.engine.mechanism === 'scarVT' ? 'volt' : 'lat';
    $('map-type').value = this.vp.mode;
    this.egm.setSim(this.sim);
    this.panels.build();
    this.updateColorbar();
    this.bindSim();
    this.wf.on((type, d) => this.onWorkflow(type, d));
    if (!c.sandbox) this.showBriefing(true);
    else toast('info', 'Sandbox: catheters placed, all steps unlocked.');
  }

  bindSim() {
    const sim = this.sim;
    sim.on((type, d) => {
      if (type === 'alert') {
        notify(d);
        if (d.pop && !matchMedia('(prefers-reduced-motion: reduce)').matches) { const v = $('viewport'); v.classList.add('is-shaking'); setTimeout(() => v.classList.remove('is-shaking'), 320); }
      } else if (type === 'hemo') notify({ level: d.level, id: d.id || 'hemo', text: d.text });
      else if (type === 'info') toast('info', d);
      else if (type === 'success') { toast('success', d); announce(d); }
      else if (type === 'measure') this.panels.addResult(formatMeasure(d), d.pass ?? null);
      else if (type === 'tag') this.vp.addSpecialTag(d.type, d.pos);
      else if (type === 'rhythm') announce(`Rhythm: ${sim.status.rhythm}`);
      else if (type === 'catheters') this.panels.refreshSites?.();
      else if (type === 'log' && d.type === 'vf_onset') notify({ level: 'critical', id: 'vf', text: 'VENTRICULAR FIBRILLATION: defibrillate now (unsynchronised, 200 J) — press D or ⚡ DEFIB.' });
      else if (type === 'log' && d.type === 'tachy_end' && sim.ablation.on) toast('success', `Tachycardia terminated during RF at ${sim.ablation.elapsed.toFixed(1)} s`);
    });
  }

  onWorkflow(type, d) {
    if (type === 'induced') toast('success', `Clinical arrhythmia ${this.c.induction.vf ? 'recognised' : 'induced'}: ${this.sim.status.rhythm}`);
    if (type === 'step') { this.panels.renderWorkflow(); this.panels.refreshCatheters(); announce(`Step: ${d.label}`); }
    if (type === 'endpoint') { this.panels.addResult(`${d.pass ? '✔' : '✖'} ${d.text}`, d.pass); }
  }

  showBriefing(first = false) {
    const c = this.c;
    this.paused = true;
    openModal({
      title: `Case ${c.num}: ${c.title}`, size: 'lg', body: briefingBody(c), dismissable: !first,
      buttons: first ? [{ label: 'Back to library', onClick: () => { setTimeout(() => this.goHome(true), 0); } }, { label: 'Begin case →', primary: true, id: 'btn-begin' }] : [{ label: 'Close', primary: true }],
      onClose: (v) => { if (this.wf) this.wf.rec.briefingRead = true; if (!first) { this.paused = false; return; } if ($('screen-app').hidden) return; this.runQuizzes('briefing', () => { this.paused = false; if (this.wf.stepIdx === 0) this.nextStep(); }); void v; },
    });
  }

  runQuizzes(phase, done) {
    const qs = this.wf.pendingQuizzes(phase);
    if (!qs.length || this.c.sandbox) { done?.(); return; }
    this.paused = true;
    const q = qs[0];
    quizModal(q, { onAnswer: (i) => this.wf.answerQuiz(q, i), onDone: () => this.runQuizzes(phase, () => { this.paused = false; done?.(); }) });
  }

  nextStep() {
    const wf = this.wf;
    const g = wf.canAdvance();
    if (!g.ok && !wf.sandbox) { toast('info', `To continue: ${g.why}`); return; }
    const phase = wf.step.id;
    this.runQuizzes(phase === 'briefing' ? '__none' : phase, () => {
      wf.advance(true);
      const id = wf.step.id;
      if (id === 'induction' && this.c.induction.arrives && this.sim.mech.clinicalActive?.()) { wf.rec.induced = true; toast('info', `Presenting rhythm: ${this.sim.status.rhythm}`); }
      if (id === 'ablation' || id === 'mapping') { const ch = this.c.engine.ablChamber; if (this.sim.catheters.ABL.chamber !== ch) this.setAblChamber(ch); }
      this.panels.renderWorkflow();
    });
  }

  placeCatheter(id, site) {
    const ok = this.wf.place(id, site);
    this.panels.refreshCatheters(); this.panels.refreshSites(); this.panels.refreshTasks();
    if (!ok) toast('warn', `${this.sim.catheters[id].info.name}: check the EGM — the signature does not look right for this catheter.`);
  }

  setAblChamber(ch) {
    this.sim.catheters.ABL.setChamber(ch); $('abl-chamber').value = ch; this.vp.setFocus(ch);
    toast('info', `Ablation catheter: ${ch} (${{ RA: 'femoral venous', LA: 'transseptal', RV: 'across the TV', LV: 'retrograde aortic' }[ch]})`);
  }

  // ---------------------------------------------------------------- maneuvers
  tcl() { const st = this.sim.status; if (!st.tachy) return 0; const v = this.c.induction.group === 'V'; return Math.round(v ? st.vCL || st.aCL : st.aCL || st.vCL); }
  doManeuver(id) {
    const sim = this.sim, stim = sim.stim, tcl = this.tcl();
    const pace = (site, cl, beats = 12) => { if (!tcl && id !== 'cs_pacing') { toast('info', 'Entrainment requires a sustained tachycardia'); return false; } stim.start({ site, mode: 'fixed', s1: cl, beats }); return true; };
    const ablTo = (pos) => { sim.catheters.ABL.moveTo(pos, 12); sim.updateABL(); };
    let ok = true;
    switch (id) {
      case 'rv_entrainment': case 'v_overdrive': ok = pace('RVA', tcl - 20); break;
      case 'a_overdrive': ok = pace('HRA', tcl - 20); break;
      case 'his_pvc': ok = !!stim.hisRefractoryPVC(); break;
      case 'para_hisian': ok = !!stim.paraHisian(); break;
      case 'adenosine': sim.giveAdenosine(12); toast('info', 'Adenosine 12 mg IV given'); break;
      case 'cs_pacing': stim.start({ site: 'CS12', mode: 'fixed', s1: 600, beats: 8 }); break;
      case 'entrain_cti': if (sim.catheters.ABL.chamber !== 'RA') this.setAblChamber('RA'); ablTo(this.wf.nodePos(sim.sys.ctiPath[Math.floor(sim.sys.ctiPath.length / 2)])); ok = pace('ABLd', tcl - 20); break;
      case 'entrain_cs': ok = pace('CS12', tcl - 20); break;
      case 'entrain_isthmus': if (sim.catheters.ABL.chamber !== 'LV') this.setAblChamber('LV'); ablTo(this.wf.nodePos(sim.sys.targets.isthmusCenter)); ok = pace('ABLd', tcl - 30); break;
      case 'pace_map': {
        const tg = this.wf.target; const d = Math.hypot(...sim.catheters.ABL.tip.map((v, i) => v - tg.pos[i]));
        const m = Math.max(0, Math.min(12, Math.round(12 - d / 2.5)));
        stim.start({ site: 'ABLd', mode: 'fixed', s1: 500, beats: 6 });
        this.panels.addResult(`Pace map at ABL tip: ${m}/12 leads match the clinical morphology${m >= 11 ? ' (excellent)' : m >= 9 ? ' (good)' : ''}.`, m >= 11);
        break;
      }
      case 'storm_checklist': this.stormCheck(true); return;
      default: break;
    }
    if (ok) { this.wf.maneuver(id); this.panels.refreshTasks(); }
  }
  stormCheck(explicit) {
    const s = this.sim; const ok = s.labs.K >= 4 && s.labs.Mg >= 2 && s.drugs.betaBlocker && s.drugs.amiodarone;
    if (ok && !this.wf.rec.maneuvers.some((m) => m.id === 'storm_checklist')) { this.wf.maneuver('storm_checklist'); toast('success', 'Storm checklist complete: K, Mg, beta-blockade, amiodarone'); }
    else if (explicit && !ok) toast('info', 'Correct K (≥ 4.0) and Mg (≥ 2.0), give a beta-blocker and amiodarone (Drugs panel).');
    this.panels.refreshTasks();
  }

  diagnosisModal() {
    const c = this.c, wf = this.wf;
    const q = { q: 'What is the mechanism? (first attempt scores 20, second 10)', options: c.diagnosis.options, correct: c.diagnosis.correct, explain: c.diagnosis.explain };
    if (wf.rec.diagnosisCorrect) { toast('info', 'Diagnosis already committed'); return; }
    this.paused = true;
    quizModal(q, { title: 'Commit diagnosis', onAnswer: (i) => wf.commitDiagnosis(i), onDone: () => { this.paused = false; this.panels.refreshTasks(); this.panels.renderStepActions(); if (!wf.rec.diagnosisCorrect && wf.rec.diagnosisAttempts.length < 3) toast('info', 'You may review the maneuvers and commit again.'); } });
  }

  // ---------------------------------------------------------------- actions
  acquire(viaClick) {
    const sim = this.sim, abl = sim.catheters.ABL;
    if (!this.wf.reached('mapping') && !this.wf.reached('maneuvers')) { toast('info', 'Mapping opens after the induction step'); return null; }
    if (abl.isMapping() && !viaClick) return this.acquireArray();
    if (!viaClick) {
      if (abl.cf < 3) { toast('info', `No contact: point rejected (CF ${abl.cf.toFixed(0)} g)`); return null; }
      if (!abl.stable()) { toast('info', 'Catheter unstable: point rejected'); return null; }
    }
    const p = sim.mapping.acquireAt(abl.surfaceNode, abl.tip, abl.cf, viaClick ? 'click' : 'abl');
    if (p.error) { toast('info', p.error); return null; }
    if (sim.mapping.points.length <= 3) toast('success', `Point accepted (#${p.id}${p.lat != null ? ` · LAT ${p.lat} ms` : ''} · ${p.bip.toFixed(2)} mV)`);
    return p;
  }
  // Multipolar mapping catheter: one acquisition records every electrode in wall contact
  // (high-density mapping). Electrodes over the same mesh node are merged.
  acquireArray(viaClick = false) {
    const sim = this.sim, abl = sim.catheters.ABL, arr = abl.array;
    if (!arr) return null;
    if (!viaClick && !abl.stable()) { toast('info', 'Catheter unstable: beat rejected'); return null; }
    const used = new Set(), got = [];
    for (let i = 0; i < arr.pos.length; i++) {
      if (!arr.contact[i]) continue;
      const n = nearestInChamber(sim.heart, arr.pos[i], abl.chamber);
      if (n < 0 || used.has(n)) continue;
      used.add(n);
      const p = sim.mapping.acquireAt(n, arr.pos[i], 10, abl.type.toLowerCase());
      if (!p.error) got.push(p);
    }
    if (!got.length) { toast('info', `${abl.info.name}: no electrodes in contact`); return null; }
    const lat = got.filter((p) => p.lat != null).map((p) => p.lat);
    toast('success', `${abl.info.name}: ${got.length} points${lat.length ? ` · LAT ${Math.min(...lat)}…${Math.max(...lat)} ms` : ''}`);
    return got[0];
  }
  setAblType(type) {
    const abl = this.sim.catheters.ABL;
    if (abl.type === type) return;
    if (this.sim.ablation.on) this.sim.ablation.stop('user');
    abl.setType(type); this.sim.updateABL();
    const sel = $('abl-type'); if (sel) sel.value = type;
    this.egm.draw();
    toast('info', abl.isMapping() ? `${abl.info.name} mapping catheter: Acquire records every electrode in contact (no RF, no contact-force sensing)` : 'Ablation catheter (3.5 mm irrigated tip)');
  }
  surfaceClick(ev) {
    const hit = this.vp.pickSurface(ev.clientX, ev.clientY);
    if (!hit) return;
    const abl = this.sim.catheters.ABL;
    if (hit.chamber !== abl.chamber) this.setAblChamber(hit.chamber);
    abl.moveTo(hit.pos, 12); this.sim.updateABL();
    this.wf.rec.surfaceClicks++;
    if (abl.isMapping()) { if (this.wf.reached('mapping') || this.wf.reached('maneuvers')) this.acquireArray(true); else toast('info', 'Mapping opens after the induction step'); }
    else this.acquire(true);
  }
  toggleRF() {
    const a = this.sim.ablation;
    if (a.on) { a.stop('user'); return; }
    if (!a.start()) toast('info', 'RF not delivered: ' + a.blockReason);
  }
  togglePace() {
    const st = this.sim.stim;
    if (st.isPacing()) { st.stop(); return; }
    const o = this.panels.stimOptions();
    if (!o.site) { toast('info', 'Place a catheter to pace from'); return; }
    if (o.site === 'ABLd' && o.mA >= 10) this.sim.ablation.checkPhrenicPacing({ cath: 'ABL' });
    st.start(o);
  }
  defib() {
    const sync = $('dr-sync').checked;
    const r = this.sim.shock(200, sync);
    if (r.fired) toast(r.success ? 'success' : 'warn', r.inVF ? (r.success ? `Shock delivered (${r.vfDelay.toFixed(1)} s after VF onset): sinus rhythm restored` : 'Shock delivered: VF persists — shock again') : 'Shock delivered');
    if (r.success) { clearAlerts(); }
  }
  tagHis() { const tip = this.sim.catheters.ABL.tip; this.vp.addSpecialTag('his', tip); this.sim.logEvent('tag', { type: 'his', pos: tip.slice() }); toast('info', 'His tag placed'); }
  useHint() {
    const r = this.wf.useHint();
    const card = $('hint-card');
    if (!r) { toast('info', 'No more hints for this step'); return; }
    card.hidden = false;
    card.innerHTML = `<div class="hint-card__tier">Hint ${r.tier}/${r.max}${this.c.level > 1 ? ` · −${this.c.level === 2 ? 1 : 2} pt` : ' · free (beginner)'}</div><div>${esc(r.text)}</div>`;
    if (r.tier >= 3 && ['mapping', 'ablation', 'endpoint'].includes(this.wf.step.id)) this.vp.setGhost(this.wf.target);
  }
  runEndpoint(id) {
    toast('info', 'Running endpoint test…');
    this.wf.runEndpoint(id, () => this.panels.renderStepActions());
  }
  updateColorbar() {
    const pal = this.vp.refreshPalette();
    const s = this.sim.mapping.settings, lat = this.vp.mode !== 'volt';
    $('cb-grad').style.background = `linear-gradient(90deg, ${(lat ? pal.lat : pal.volt).join(',')})`;
    $('cb-title').textContent = lat ? 'LAT (ms)' : 'Bipolar (mV)';
    $('cb-lo').textContent = lat ? `${s.woi[0]} Early` : `${s.voltLo} Scar`;
    $('cb-hi').textContent = lat ? `+${s.woi[1]} Late` : `${s.voltHi} Normal`;
    $('colorbar').dataset.map = lat ? 'lat' : 'voltage';
    $('colorbar').hidden = this.vp.mode === 'none';
    this.vp.dirty = true;
  }
  setPalette(p) { if (p) document.documentElement.dataset.palette = p; else delete document.documentElement.dataset.palette; store.set('palette', p); this.egm.refreshColors(); if (this.sim) this.updateColorbar(); }

  // ---------------------------------------------------------------- finish / debrief
  finishCase() {
    const sim = this.sim, wf = this.wf;
    sim.ablation.stop('end'); sim.stim.stop(true);
    wf.rec.finished = true;
    const sc = scoreCase(wf);
    this.lastScore = sc;
    if (!this.c.sandbox) { const best = store.get('best', {}); best[this.c.id] = Math.max(best[this.c.id] ?? 0, sc.total); store.set('best', best); }
    const snap = this.vp.snapshot();
    $('screen-app').hidden = true; clearAlerts();
    const d = $('screen-debrief'); d.hidden = false;
    const C = 2 * Math.PI * 62, frac = sc.total / 100;
    const evColor = { rf_start: 'var(--c-rf-on)', warning: 'var(--c-warn)', complication: 'var(--c-danger)', tachy_onset: 'var(--c-info)', tachy_end: 'var(--c-ok)', maneuver: 'var(--c-pace)', endpoint: 'var(--c-accent)', shock: 'var(--c-danger)' };
    const T = Math.max(1, sim.t);
    const evs = sim.log.filter((e) => evColor[e.type]).slice(0, 400).map((e) => `<i class="timeline__ev" style="left:${(100 * e.t / T).toFixed(2)}%;background:${evColor[e.type]}" title="${e.type} @ ${(e.t / 1000).toFixed(0)} s"></i>`).join('');
    const idx = CASES.findIndex((x) => x.id === this.c.id);
    d.innerHTML = `<div class="debrief">
      <div class="debrief__head">
        <svg class="score-dial" viewBox="0 0 150 150" role="img" aria-label="Score ${sc.total} of 100"><circle cx="75" cy="75" r="62" fill="none" stroke="var(--c-bg-raised)" stroke-width="12"/>
          <circle cx="75" cy="75" r="62" fill="none" stroke="${sc.critical ? 'var(--c-danger)' : 'var(--c-accent)'}" stroke-width="12" stroke-dasharray="${(C * frac).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 75 75)" stroke-linecap="round"/>
          <text x="75" y="80" text-anchor="middle" class="score-dial__num">${sc.total}</text><text x="75" y="102" text-anchor="middle" class="score-dial__lbl">/ 100</text></svg>
        <div><h1 id="debrief-title">Debrief — ${esc(this.c.title)}</h1><div class="grade ${sc.critical ? 'is-critical' : ''}" id="debrief-grade">${sc.grade}</div>
          <p class="note">Domain points ${sc.domain} − safety deductions ${sc.domain - sc.total < 0 ? 0 : sc.domain - sc.total} · simulated time ${(sim.t / 60000).toFixed(1)} min · ${sim.ablation.rfCount} RF · ${sim.mapping.points.length} points</p></div>
      </div>
      <div class="card"><h3>Score breakdown</h3><table class="score-table"><thead><tr><th>Domain</th><th>Points</th><th></th><th>Notes</th></tr></thead><tbody>
        ${sc.rows.map((r) => `<tr class="score-table__row ${r.got >= r.max ? 'is-perfect' : ''}"><td>${r.key}. ${esc(r.label)}</td><td class="mono">${r.got}/${r.max}</td><td><div class="score-table__bar"><i style="width:${(100 * r.got / r.max).toFixed(0)}%"></i></div></td><td class="note">${esc(r.notes.join('; '))}</td></tr>`).join('')}
        ${sc.deductions.map((x) => `<tr class="score-table__penalty"><td>Safety: ${esc(x.label)}${x.critical ? ' (critical)' : ''}</td><td class="mono">−${x.pts}</td><td></td><td></td></tr>`).join('')}
      </tbody></table></div>
      <div class="card"><h3>Timeline</h3><div class="timeline">${evs}</div><p class="note">orange RF · amber warning · red complication/shock · blue onset · green termination · violet maneuver · teal endpoint</p></div>
      <div class="cols"><div class="card"><h3>Final map</h3><img class="debrief__snap" src="${snap}" alt="Final map with lesion tags"></div>
        <div class="card"><h3>What an expert would have done</h3><ol>${this.c.expert.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
        <h3>Endpoints</h3><ul>${this.c.endpoints.map((e) => `<li>${wf.rec.endpoints[e.id]?.pass ? '✔' : '✖'} ${esc(e.label)}${wf.rec.endpoints[e.id] ? ` — ${esc(wf.rec.endpoints[e.id].text)}` : ' — not tested'}</li>`).join('')}</ul></div></div>
      <div class="row"><button class="btn" id="db-retry">Retry case</button>${idx >= 0 && idx < CASES.length - 1 ? '<button class="btn btn--primary" id="db-next">Next case</button>' : ''}<button class="btn" id="db-export">Export summary (JSON)</button><button class="btn" id="db-print">Print</button><button class="btn" id="db-home">Home</button></div>
    </div>`;
    $('db-retry').addEventListener('click', () => this.startCase(this.c.sandbox ? this.c : CASES.find((x) => x.id === this.c.id)));
    $('db-next')?.addEventListener('click', () => this.startCase(CASES[idx + 1]));
    $('db-home').addEventListener('click', () => this.goHome());
    $('db-print').addEventListener('click', () => window.print());
    $('db-export').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify({ case: this.c.id, score: sc, endpoints: wf.rec.endpoints, rf: sim.ablation.rfCount, points: sim.mapping.points.length, log: sim.log.filter((e) => e.type !== 'point') }, null, 1)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `epsim-${this.c.id}-debrief.json`; a.click();
    });
    return sc;
  }

  goHome(force) {
    if (!force && this.sim && !$('screen-app').hidden && !this.wf.rec.finished) {
      openModal({ title: 'Leave case?', size: 'sm', body: '<p>Progress in this case will be lost.</p>', buttons: [{ label: 'Stay' }, { label: 'Leave', primary: true, onClick: () => { setTimeout(() => this.goHome(true), 0); } }] });
      return;
    }
    if (this.sim) { this.sim.ablation.stop('exit'); this.sim.stim.stop(true); }
    closeAll(); clearAlerts();
    this.sim = null; this.wf = null;
    $('screen-app').hidden = true; $('screen-debrief').hidden = true; $('screen-home').hidden = false;
    this.renderHome();
  }

  // ================================================================== INPUT
  bindGlobal() {
    $('case-search').addEventListener('input', (e) => { this.filter.q = e.target.value; this.renderHome(); });
    $('btn-sandbox').addEventListener('click', () => this.sandboxDialog());
    for (const id of ['btn-help-home', 'btn-help']) $(id).addEventListener('click', () => helpModal());
    for (const id of ['btn-settings-home', 'btn-settings']) $(id).addEventListener('click', () => this.settingsModal());
    $('btn-home').addEventListener('click', () => this.goHome());
    $('btn-acquire').addEventListener('click', () => this.acquire(false));
    $('btn-undo-pt').addEventListener('click', () => this.sim?.mapping.deleteLast());
    $('btn-tag').addEventListener('click', () => this.tagHis());
    $('btn-hint').addEventListener('click', () => this.useHint());
    $('map-type').addEventListener('change', (e) => { this.vp.mode = e.target.value; this.updateColorbar(); });
    $('abl-chamber').addEventListener('change', (e) => this.setAblChamber(e.target.value));
    const tg = (id, key, fn) => $(id).addEventListener('click', (e) => { const b = e.currentTarget; const on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(on)); if (key) this.vp.show[key] = on; fn?.(on); this.vp.dirty = true; });
    tg('tg-points', 'points'); tg('tg-tags', 'tags'); tg('tg-cath', 'cath'); tg('tg-labels', 'labels'); tg('tg-others', 'others', () => this.vp.updateVisibility()); tg('tg-context', 'context', () => this.vp.updateVisibility()); tg('tg-beat', 'beat');
    $('tg-opacity').addEventListener('click', () => this.cycleOpacity());
    document.querySelectorAll('.view-presets__btn').forEach((b) => b.addEventListener('click', () => this.vp.setView(b.dataset.view)));
    document.querySelectorAll('#sweep-seg .segmented__option').forEach((b) => b.addEventListener('click', () => this.setSweep(Number(b.dataset.speed))));
    $('egm-gain-up').addEventListener('click', () => { this.egm.gain = Math.min(4, this.egm.gain * 1.25); });
    $('egm-gain-dn').addEventListener('click', () => { this.egm.gain = Math.max(0.25, this.egm.gain / 1.25); });
    $('egm-cal').addEventListener('click', () => this.toggleCalipers());
    $('egm-freeze').addEventListener('click', () => this.toggleFreeze());
    $('egm-live').addEventListener('click', () => { this.egm.goLive(); this.syncFreeze(); });
    $('egm-snap').addEventListener('click', () => this.snapEGM());
    $('egm-snaps').addEventListener('change', (e) => {
      const s = this.egm.snaps.find((x) => String(x.num) === e.target.value);
      if (s) { this.egm.showSnap(s); if (!this.egm.calipers) this.toggleCalipers(); this.syncFreeze(); } else { this.egm.goLive(); this.syncFreeze(); }
    });
    this.egm.onSnapsChange = () => this.syncSnaps();
    $('egm-back').addEventListener('click', () => this.egm.scrollPage(-1));
    $('egm-fwd').addEventListener('click', () => this.egm.scrollPage(1));
    this.egm.onFreezeChange = () => this.syncFreeze();
    $('colorbar').addEventListener('click', () => $('ms-ref')?.focus());
    // steering pad: press and hold
    document.querySelectorAll('[data-steer]').forEach((b) => {
      const k = b.dataset.steer;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); this.held.add(k); });
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => this.held.delete(k));
    });
    // viewport mouse
    const cv = $('viewport-canvas');
    cv.addEventListener('pointerdown', (e) => { if (e.shiftKey && this.sim) { e.preventDefault(); e.stopPropagation(); this.surfaceClick(e); } }, true);
    // Ctrl/Alt + drag: drag the ablation tip freely over the wall of its chamber
    cv.addEventListener('pointerdown', (e) => {
      if (!(e.ctrlKey || e.altKey) || !this.sim || e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      this.tipDrag = true; this.sim.catheters.ABL.dragging = true; cv.setPointerCapture?.(e.pointerId);
      this.dragTip(e);
    }, true);
    cv.addEventListener('pointermove', (e) => { if (this.tipDrag) { e.stopPropagation(); this.dragTip(e); } }, true);
    window.addEventListener('pointerup', () => { if (this.tipDrag) { this.tipDrag = false; if (this.sim) this.sim.catheters.ABL.dragging = false; } });
    cv.addEventListener('pointermove', (e) => this.hover(e));
    cv.addEventListener('dblclick', (e) => { const h = this.vp.pickSurface(e.clientX, e.clientY); if (h) this.vp.controls.target.copy(this.vp.root.localToWorld(new (this.vp.camera.position.constructor)(...h.pos))); });
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('keyup', (e) => { this.held.delete(STEER_KEYS[e.key.toLowerCase()]); });
    window.addEventListener('blur', () => this.held.clear());
  }

  dragTip(e) {
    const now = performance.now(); if (now - (this._drg || 0) < 35) return; this._drg = now;
    const abl = this.sim.catheters.ABL;
    const hit = this.vp.pickSurface(e.clientX, e.clientY);
    if (!hit || hit.chamber !== abl.chamber) return;
    abl.moveTo(hit.pos, 10); this.sim.updateABL();
  }

  hover(e) {
    if (!this.sim || e.buttons) return;
    const now = performance.now(); if (now - (this._hov || 0) < 80) return; this._hov = now;
    const p = this.vp.pickPoint(e.clientX, e.clientY);
    let tip = document.querySelector('.tip3d');
    if (!p) { tip?.remove(); return; }
    if (!tip) { tip = document.createElement('div'); tip.className = 'tip3d'; $('viewport').appendChild(tip); }
    const r = $('viewport').getBoundingClientRect();
    tip.style.left = e.clientX - r.left + 12 + 'px'; tip.style.top = e.clientY - r.top + 12 + 'px';
    tip.textContent = `#${p.id} · LAT ${p.lat ?? '—'} ms · ${p.bip.toFixed(2)} mV`;
  }

  setSweep(s) { this.egm.setSpeed(s); document.querySelectorAll('#sweep-seg .segmented__option').forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.speed) === s))); }
  toggleCalipers() { this.egm.calipers = !this.egm.calipers; $('egm-cal').setAttribute('aria-pressed', String(this.egm.calipers)); $('egm-canvas').classList.toggle('is-calipers', this.egm.calipers); if (this.egm.calipers && !this.egm.frozen) this.toggleFreeze(); }
  snapEGM() {
    const s = this.egm.snap(); if (!s) return;
    if (!this.egm.calipers) this.toggleCalipers();
    this.syncFreeze();
    toast('info', `${this.egm.snapLabel(s)} saved: drag on the strip to place calipers`);
  }
  syncSnaps() {
    const sel = $('egm-snaps'), e = this.egm;
    sel.hidden = !e.snaps.length;
    sel.innerHTML = `<option value="">Live / review</option>` + e.snaps.slice().reverse().map((s) => `<option value="${s.num}">${esc(e.snapLabel(s))}</option>`).join('');
    sel.value = e.viewSnap ? String(e.viewSnap.num) : '';
  }
  toggleFreeze() { this.egm.setFrozen(!this.egm.frozen); this.syncFreeze(); }
  syncFreeze() { const f = this.egm.frozen; $('egm-freeze').setAttribute('aria-pressed', String(f)); $('egm-live').hidden = !f; document.querySelector('.egm').classList.toggle('is-frozen', f); }
  cycleOpacity() { this.vp.opacityMode = (this.vp.opacityMode + 1) % 3; this.vp.updateVisibility(); $('tg-opacity').setAttribute('aria-pressed', String(this.vp.opacityMode > 0)); }

  onKey(e) {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = ['input', 'select', 'textarea'].includes(tag);
    if (e.key === 'Escape') {
      if (this.sim) { this.sim.ablation.stop('esc'); this.sim.stim.stop(); }
      closeTop(); return;
    }
    if (e.key === 'F1' || (e.key === '?' && !typing)) { e.preventDefault(); helpModal(); return; }
    if (typing || isModalOpen() || !this.sim || $('screen-app').hidden) return;
    const k = e.key.toLowerCase();
    if (e.ctrlKey && /^[1-6]$/.test(e.key)) { e.preventDefault(); this.vp.setView(['AP', 'PA', 'LAO', 'RAO', 'LL', 'RL'][Number(e.key) - 1]); return; }
    if (e.ctrlKey && k === 'z') { e.preventDefault(); this.sim.mapping.deleteLast(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (STEER_KEYS[k] && !(k === 'f' && e.shiftKey)) { this.held.add(STEER_KEYS[k]); e.preventDefault(); return; }
    switch (k) {
      case ' ': e.preventDefault(); this.acquire(false); break;
      case 'a': this.toggleRF(); break;
      case 'p': this.togglePace(); break;
      case 'c': this.toggleCalipers(); break;
      case 'n': this.snapEGM(); break;
      case 'f': if (e.shiftKey) this.toggleFreeze(); break;
      case 't': this.tagHis(); break;
      case 'backspace': case 'delete': e.preventDefault(); this.sim.mapping.deleteLast(); break;
      case 'v': { const m = ['lat', 'volt', 'prop', 'none']; this.vp.mode = m[(m.indexOf(this.vp.mode) + 1) % m.length]; $('map-type').value = this.vp.mode; this.updateColorbar(); break; }
      case 'o': this.cycleOpacity(); break;
      case 'h': this.useHint(); break;
      case 'd': this.defib(); break;
      case '1': case '2': case '3': case '4': this.setSweep([25, 50, 100, 200][Number(k) - 1]); break;
      case '[': this.egm.nudge(e.shiftKey ? -10 : -1); break;
      case ']': this.egm.nudge(e.shiftKey ? 10 : 1); break;
      case 'arrowleft': e.preventDefault(); this.egm.scrollBy(e.shiftKey ? -2000 : -250); break;
      case 'arrowright': e.preventDefault(); this.egm.scrollBy(e.shiftKey ? 2000 : 250); break;
      case 'end': e.preventDefault(); this.egm.goLive(); break;
      default: break;
    }
  }

  settingsModal() {
    const body = `<label class="field"><span>Map palette</span><select class="select" id="set-pal"><option value="">Default</option><option value="cb">Colorblind-safe</option></select></label>
      <label class="field"><span>Simulation speed</span><select class="select" id="set-speed"><option value="0.5">0.5×</option><option value="1">1×</option><option value="2">2×</option></select></label>
      ${this.sim ? '<button class="btn btn--sm" id="set-exit">Exit case</button>' : ''}`;
    const m = openModal({ title: 'Settings', size: 'sm', body, buttons: [{ label: 'Close', primary: true }] });
    $('set-pal').value = document.documentElement.dataset.palette || '';
    $('set-speed').value = String(this.speed);
    $('set-pal').addEventListener('change', (e) => { this.setPalette(e.target.value); const ms = $('ms-pal'); if (ms) ms.value = e.target.value; });
    $('set-speed').addEventListener('change', (e) => { this.speed = Number(e.target.value); });
    $('set-exit')?.addEventListener('click', () => { m.close(); this.goHome(); });
  }

  // ================================================================== LOOP
  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(50, now - this.lastFrame); this.lastFrame = now;
    const sim = this.sim;
    if (!sim || $('screen-app').hidden) return;
    if (this.autotestBusy) return;
    if (this.held.size) {
      const abl = sim.catheters.ABL; const r = 0.012;
      for (const k of this.held) {
        if (k === 'defl+') abl.steer(r, 0, 0); else if (k === 'defl-') abl.steer(-r, 0, 0);
        else if (k === 'rot+') abl.steer(0, 2.5, 0); else if (k === 'rot-') abl.steer(0, -2.5, 0);
        else if (k === 'adv+') abl.steer(0, 0, 0.6); else if (k === 'adv-') abl.steer(0, 0, -0.6);
        else if (k === 'sb+') abl.steer(0, 0, 0, 1.2); else if (k === 'sb-') abl.steer(0, 0, 0, -1.2);
        else if (k === 'sr+') abl.steer(0, 0, 0, 0, 2.5); else if (k === 'sr-') abl.steer(0, 0, 0, 0, -2.5);
      }
    }
    if (!this.paused && !isModalOpen()) sim.advance(dt * this.speed);
    sim.updateABL();
    this.vp.render();
    this.egm.draw();
    if (now - this.lastTick > 200) {
      this.lastTick = now;
      this.panels.tick();
      const wf = this.wf;
      if (wf.step.id === 'induction' && !wf.rec.induced && (sim.mech.clinicalActive?.() || (this.c.induction.vf && wf._defibOK()))) { wf.rec.induced = true; this.onWorkflow('induced'); }
      const abl = sim.catheters.ABL; const led = $('steer-led');
      if (abl.array) {
        const k = abl.array.contact.filter(Boolean).length;
        led.dataset.contact = k === 0 ? 'none' : k < abl.array.pos.length / 4 ? 'light' : 'good';
        $('steer-cf').textContent = `${k}/${abl.array.pos.length} in contact`;
      } else {
        led.dataset.contact = abl.cf < 3 ? 'none' : abl.cf < 10 ? 'light' : abl.cf <= 40 ? 'good' : 'excess';
        $('steer-cf').textContent = `${abl.cf.toFixed(0)} g`;
      }
      $('steer-read').textContent = `defl ${abl.deflect > 0 ? '+' : ''}${Math.round(abl.deflect * 100)}% · rot ${Math.round(abl.rotate)}° · adv ${Math.round(abl.advance)} mm`;
      $('steer-read2').textContent = `sheath ${Math.round(abl.sheathBend)}° @ ${Math.round(abl.sheathRot)}°`;
      const s = sim.mapping.settings;
      $('vp-status').textContent = `${sim.mapping.points.length} pts · ${this.vp.mode.toUpperCase()} · ref ${s.ref} · WOI ${s.woi[0]}…${s.woi[1]} ms · fill ${s.fill} mm · ABL ${abl.chamber}`;
      if (now - (this._desc || 0) > 5000) {
        this._desc = now; const sm = sim.mapping.summary();
        $('viewport-desc').textContent = `${this.vp.mode} map, ${sm.n} points${sm.earliest ? `, earliest ${sm.earliest.lat} ms` : ''}. Rhythm ${sim.status.rhythm}.`;
      }
    }
  }
}

const STEER_KEYS = { w: 'defl+', s: 'defl-', q: 'rot-', e: 'rot+', r: 'adv+', f: 'adv-', i: 'sb+', k: 'sb-', j: 'sr-', l: 'sr+' };

function formatMeasure(d) {
  if (d.text) return d.text;
  if (d.maneuver === 'his_refractory_pvc') return `His-refractory PVC (His ${d.hisRefractory ? 'refractory' : 'NOT refractory'}): ${d.result || 'no result'}.`;
  if (d.maneuver === 'para_hisian') return `Para-Hisian pacing: SA ${d.saHisCapture ?? '—'} ms (His+V) vs ${d.saVOnly ?? '—'} ms (V only) → ${d.result}.`;
  const parts = [`${d.site} ${d.mode} ${d.s1}${d.s2 ? '/' + d.s2 : ''}${d.s3 ? '/' + d.s3 : ''} ms: ${d.outcome}`];
  if (d.ah != null) parts.push(`AH ${d.ah} ms`);
  if (d.ppi != null) parts.push(`PPI ${d.ppi} ms, PPI−TCL ${d.ppiMinusTcl} ms`);
  if (d.response) parts.push(`response ${d.response}`);
  if (d.sa != null) parts.push(`SA ${d.sa} ms`);
  return parts.join(' · ');
}

const app = new App();
window.__app = app;
// warm the anatomy cache so the first case opens quickly
setTimeout(() => getHeart(), 50);

const q = new URLSearchParams(location.search);
if (q.get('autotest')) import('./autotest.js').then((m) => m.runAutotest(app, q.get('autotest'), q));
else if (q.get('case')) { const c = CASES.find((x) => x.id === q.get('case')); if (c) app.startCase(c); }
