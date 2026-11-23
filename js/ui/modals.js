// Modal dialogs with focus trap (UX spec §5): generic, briefing, quiz, diagnosis, help.
import { KEYMAP } from './keymap.js';

let stack = [];
export function isModalOpen() { return stack.length > 0; }

export function openModal({ title, body, size = 'md', buttons = [], dismissable = true, onClose }) {
  const root = document.getElementById('modal-root');
  const prev = document.activeElement;
  const id = 'm' + Math.random().toString(36).slice(2, 8);
  const el = document.createElement('div');
  el.className = `modal modal--${size}`;
  el.innerHTML = `<div class="modal__scrim"></div><div class="modal__dialog" role="dialog" aria-modal="true" aria-labelledby="${id}">
    <div class="modal__header"><h2 class="modal__title" id="${id}"></h2></div><div class="modal__body"></div><div class="modal__footer"></div></div>`;
  el.querySelector('.modal__title').textContent = title;
  const b = el.querySelector('.modal__body');
  if (typeof body === 'string') b.innerHTML = body; else if (body) b.appendChild(body);
  const footer = el.querySelector('.modal__footer');
  const api = {
    el, body: b, footer,
    close(val) { if (!el.isConnected) return; el.remove(); stack = stack.filter((x) => x !== api); prev?.focus?.(); onClose?.(val); },
  };
  for (const bt of buttons) {
    const btn = document.createElement('button');
    btn.className = 'btn ' + (bt.primary ? 'btn--primary' : 'btn--secondary');
    btn.textContent = bt.label;
    if (bt.id) btn.id = bt.id;
    btn.addEventListener('click', () => { const r = bt.onClick?.(api); if (r !== false) api.close(bt.value); });
    footer.appendChild(btn);
  }
  if (dismissable) el.querySelector('.modal__scrim').addEventListener('click', () => api.close());
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dismissable) { e.stopPropagation(); api.close(); }
    if (e.key === 'Tab') {
      const f = [...el.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });
  api.dismissable = dismissable;
  root.appendChild(el);
  stack.push(api);
  setTimeout(() => (el.querySelector('.modal__footer .btn--primary') || el.querySelector('button'))?.focus(), 0);
  return api;
}
export function closeTop() { const m = stack[stack.length - 1]; if (m && m.dismissable) { m.close(); return true; } return false; }
export function closeAll() { for (const m of [...stack]) m.close(); }

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export { esc };

// Schematic ECG strip (SVG) for the briefing: narrow / wide / flutter / irregular.
function ecgSVG(kind) {
  let d = 'M0 30';
  const W = 600;
  for (let x = 0; x < W;) {
    if (kind === 'flutter') { d += ` l10 6 l10 -6`; x += 20; if (x % 80 === 0) d += ' l2 -18 l3 26 l3 -8'; continue; }
    if (kind === 'vf') { const a = 6 + 10 * Math.abs(Math.sin(x / 50)); d += ` l6 ${-a} l6 ${a}`; x += 12; continue; }
    const cl = kind === 'tachy' ? 60 : kind === 'irregular' ? 50 + ((x * 37) % 60) : 110;
    const wide = kind === 'wide';
    d += ` l${cl * 0.3} 0 q4 -5 8 0 l${cl * 0.12} 0 l2 3 l${wide ? 6 : 3} -24 l${wide ? 6 : 3} 28 l2 -7 l${cl * 0.15} 0 q8 -8 16 0`;
    x += cl * 0.57 + 34 + (wide ? 6 : 0);
  }
  return `<svg class="ecg-strip" viewBox="0 0 600 60" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" fill="none" stroke="var(--c-egm-surface)" stroke-width="1.4"/></svg>`;
}

export function briefingBody(c) {
  const p = c.patient;
  const tachyKind = { AFL: 'flutter', 'AF-PVI': 'irregular', VT: c.id === 'vf_storm' ? 'vf' : 'wide' }[c.tag] || 'tachy';
  return `<div class="cols"><div>
      <h3>Patient</h3><p><b>${p.age} ${p.sex}.</b> ${esc(p.summary)}</p>
      <p class="note">History: ${esc(p.history)} · Medications: ${esc(p.meds)} · Labs: ${esc(p.labs)}</p>
      <h3>12-lead ECG — baseline</h3>${ecgSVG(c.id === 'wpw_ps' || c.id === 'wpw_ll' ? 'wide' : 'sinus')}<ul>${c.ecg.baseline.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <h3>12-lead ECG — clinical arrhythmia</h3>${ecgSVG(tachyKind)}<ul>${c.ecg.tachy.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    </div><div>
      <h3>Learning objectives</h3><ul>${c.objectives.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <h3>Catheters</h3><p class="note">HRA, His, CS (decapolar), RVA, and a steerable irrigated ablation catheter (${esc(c.engine.ablChamber)}).</p>
      <h3>Induction</h3><p class="note">${esc(c.induction.text)}</p>
      <h3>Scoring</h3><p class="note">100-point rubric: placement 8 · baseline 7 · induction & maneuvers 15 · diagnosis 20 · mapping 10 · RF efficiency 15 (benchmark ${c.rfBenchmark}) · time 5 · endpoints 20, minus safety deductions.</p>
      <h3>Time target</h3><p class="note">~${c.mins} min</p>
    </div></div>`;
}

// Single-choice quiz; resolves with the chosen index after feedback.
export function quizModal(q, { title = 'Checkpoint quiz', onAnswer, onDone } = {}) {
  const body = document.createElement('div');
  body.innerHTML = `<p>${esc(q.q)}</p>`;
  let answered = false;
  const m = openModal({ title, body, dismissable: false, buttons: [{ label: 'Continue', primary: true, id: 'quiz-continue', onClick: () => (answered ? undefined : false) }], onClose: () => onDone?.() });
  const btnC = m.footer.querySelector('#quiz-continue'); btnC.disabled = true;
  q.options.forEach((o, i) => {
    const b = document.createElement('button');
    b.className = 'quiz-option'; b.dataset.idx = i;
    b.innerHTML = `<span class="quiz-option__marker">${String.fromCharCode(65 + i)}</span><span class="quiz-option__text"></span>`;
    b.querySelector('.quiz-option__text').textContent = o;
    b.addEventListener('click', () => {
      if (answered) return; answered = true;
      const ok = onAnswer ? onAnswer(i) : i === q.correct;
      body.querySelectorAll('.quiz-option').forEach((x, j) => { x.disabled = true; if (j === q.correct) x.classList.add('is-correct'); else if (j === i) x.classList.add('is-wrong'); });
      const ex = document.createElement('div'); ex.className = 'explain';
      ex.innerHTML = `<b>${ok ? '✔ Correct.' : '✖ Not quite.'}</b> `; ex.append(q.explain || '');
      body.appendChild(ex);
      btnC.disabled = false; btnC.focus();
    });
    body.appendChild(b);
  });
  return m;
}

export function helpModal() {
  const rows = KEYMAP.map((k) => `<tr><td><kbd>${esc(k.keys)}</kbd></td><td>${esc(k.label)}</td></tr>`).join('');
  return openModal({
    title: 'Help', size: 'lg', buttons: [{ label: 'Close', primary: true }],
    body: `<div class="cols"><div><h3>Keyboard shortcuts</h3><table class="kbd-table">${rows}</table></div>
      <div><h3>Map colours</h3><p class="note"><b>LAT:</b> red = earliest → orange → yellow → green → cyan → blue → purple = latest, relative to the reference channel within the window of interest (WOI). Grey = not mapped (outside the fill radius).</p>
      <p class="note"><b>Bipolar voltage:</b> red &lt; lower threshold (scar), purple &gt; upper threshold (healthy).</p>
      <p class="note"><b>Lesion tags:</b> yellow = weak, orange = good, red = strong, white = excessive (LQI 0–10 from contact force × power × time).</p>
      <h3>Workflow</h3><p class="note">Briefing → catheter placement → baseline intervals (calipers) → induction → diagnostic maneuvers and diagnosis → mapping → ablation → endpoint tests → debrief. Steps unlock in order; RF is enabled after a diagnosis is committed.</p>
      <h3>Glossary</h3><p class="note">LAT local activation time · WOI window of interest · PPI post-pacing interval · TCL tachycardia cycle length · CF contact force · LQI lesion quality index · CTI cavotricuspid isthmus · PVI pulmonary vein isolation.</p>
      <p class="note">Educational simulator only: not a medical device and not affiliated with any mapping-system vendor.</p></div></div>`,
  });
}
