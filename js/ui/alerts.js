// Alert routing (UX spec §6.1): notify({level, id, text}) deduplicated by id.
// critical / warning -> banners over the viewport; success / info -> toasts.

const active = new Map();
let onCritical = null;
export function setCriticalHandler(fn) { onCritical = fn; }

export function notify({ level = 'info', id, text, autoAction }) {
  if (level === 'critical' || level === 'warning') return banner(level, id || text, text, autoAction);
  return toast(level, text);
}

function banner(level, id, text, autoAction) {
  const stack = document.getElementById('alert-stack');
  if (!stack) return;
  if (active.has(id)) { active.get(id).querySelector('.alert-banner__text').textContent = text; return; }
  const el = document.createElement('div');
  el.className = `alert-banner alert-banner--${level}`;
  el.innerHTML = `<span class="alert-banner__icon" aria-hidden="true">${level === 'critical' ? '⛔' : '⚠'}</span><span class="alert-banner__text"></span><button class="btn btn--sm alert-banner__ack">${level === 'critical' ? 'Acknowledge' : 'Dismiss'}</button>`;
  el.querySelector('.alert-banner__text').textContent = text;
  el.querySelector('button').addEventListener('click', () => dismiss(id));
  stack.appendChild(el);
  active.set(id, el);
  if (level === 'critical') {
    const vp = document.getElementById('viewport');
    vp?.classList.add('is-critical');
    onCritical?.(id, autoAction);
  } else {
    setTimeout(() => dismiss(id), 9000);
  }
  while (stack.children.length > 4) { const first = stack.firstElementChild; for (const [k, v] of active) if (v === first) active.delete(k); first.remove(); }
}

export function dismiss(id) {
  const el = active.get(id);
  if (!el) return;
  el.remove(); active.delete(id);
  if (![...active.values()].some((e) => e.classList.contains('alert-banner--critical'))) document.getElementById('viewport')?.classList.remove('is-critical');
}
export function clearAlerts() { for (const id of [...active.keys()]) dismiss(id); }

export function toast(level, text, ms) {
  const reg = document.getElementById('toast-region');
  if (!reg) return;
  const el = document.createElement('div');
  el.className = `toast toast--${level === 'success' ? 'success' : level === 'warn' ? 'warn' : 'info'}`;
  el.textContent = text;
  reg.appendChild(el);
  while (reg.children.length > 3) reg.firstElementChild.remove();
  setTimeout(() => el.remove(), ms || (level === 'success' ? 3000 : 4000));
}

export function announce(text) { const s = document.getElementById('sr-status'); if (s) s.textContent = text; }
