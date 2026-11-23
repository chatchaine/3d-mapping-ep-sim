// Resolves a case's ablation target into concrete positions on the shell: a point
// (focal targets) or a sequence of lesion sites (lines / circles). Used for the ghost
// target overlay (hint tier 3), the ablation-precision score and the smoke tests.

import { PV_DEFS, CHAMBER_INDEX, vec } from './geometry.js';
import { nodePos } from './catheters.js';

const { sub, len, dot, scl, add, norm, cross } = vec;

function resample(pts, spacing) {
  const out = [pts[0]];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1]; const b = pts[i];
    let seg = len(sub(b, a));
    while (acc + seg >= spacing) {
      const t = (spacing - acc) / seg;
      a = add(a, scl(sub(b, a), t)); out.push(a); seg = len(sub(b, a)); acc = 0;
    }
    acc += seg;
  }
  const last = pts[pts.length - 1];
  if (len(sub(last, out[out.length - 1])) > spacing * 0.4) out.push(last);
  return out;
}

export function resolveTarget(sim, caseDef, spacing = 4) {
  const t = caseDef.target || {};
  const sys = sim.sys, heart = sim.heart, eng = sim.engine;
  const chamber = caseDef.engine.ablChamber || caseDef.chamber;
  const P = (n) => nodePos(heart, n);
  switch (t.kind) {
    case 'sp': return { kind: 'point', chamber: 'RA', pos: sys.nodesPos.SP_ENTRY, radius: t.radius || 6 };
    case 'ap': {
      const ch = caseDef.engine.ablChamber;
      return { kind: 'point', chamber: ch, pos: ch === 'RA' || ch === 'LA' ? sys.nodesPos.AP_A : sys.nodesPos.AP_V, radius: t.radius || 5 };
    }
    case 'focus': case 'trigger': return { kind: 'point', chamber, pos: P(sys.targets.focus), radius: t.radius || 5 };
    case 'vt': return { kind: 'point', chamber: 'LV', pos: P(sys.targets.isthmusCenter), radius: t.radius || 8, extra: [P(sys.targets.isthmusExit), P(sys.targets.isthmusEntry)] };
    case 'cti': return { kind: 'line', chamber: 'RA', sites: resample(sys.ctiPath.map(P), spacing), path: sys.ctiPath };
    case 'mi': return { kind: 'line', chamber: 'LA', sites: resample(sys.miPath.map(P), spacing), path: sys.miPath };
    case 'pvi': {
      // per vein: find the most proximal cross-section of the venous tube that is complete
      // around the axis, then take one site per angular bin (antral / ostial ring)
      const LA = CHAMBER_INDEX.LA, c = heart.chambers[LA];
      const rings = [];
      for (const [name, d] of Object.entries(PV_DEFS)) {
        const ab = sub(d.b, d.a), L2 = dot(ab, ab), ax = norm(ab);
        let u = norm(cross(ax, [0, 0, 1])); if (!isFinite(u[0])) u = [1, 0, 0];
        const w = cross(ax, u);
        const info = [];
        for (let n = c.offset; n < c.offset + c.count; n++) {
          const p = P(n), q = sub(p, d.a), tt = dot(q, ab) / L2;
          if (tt < 0.05 || tt > 0.6) continue;
          const rad = sub(q, scl(ab, tt)); const rr = len(rad);
          if (rr > d.r + 5) continue;
          info.push({ p, tt, ang: Math.atan2(dot(rad, w), dot(rad, u)) });
        }
        const NB = Math.max(10, Math.ceil((2 * Math.PI * (d.r + 1)) / (spacing * 0.65)));
        let ring = null;
        for (let t0 = 0.12; t0 <= 0.55 && !ring; t0 += 0.03) {
          const bins = new Array(NB).fill(null);
          for (const it of info) {
            if (Math.abs(it.tt - t0) > 0.05) continue;
            const b = Math.floor(((it.ang + Math.PI) / (2 * Math.PI)) * NB) % NB;
            if (!bins[b] || Math.abs(it.tt - t0) < Math.abs(bins[b].tt - t0)) bins[b] = it;
          }
          if (bins.every(Boolean)) ring = bins.map((x) => x.p);
        }
        rings.push({ pv: name, sites: ring || [] });
      }
      return { kind: 'circles', chamber: 'LA', rings, sites: rings.flatMap((r) => r.sites) };
    }
    default: return null;
  }
}

// Distance from a position to the target (for precision scoring and the ghost).
export function distToTarget(tg, p) {
  if (!tg) return Infinity;
  if (tg.kind === 'point') return len(sub(p, tg.pos));
  let best = Infinity;
  for (const s of tg.sites) best = Math.min(best, len(sub(p, s)));
  return best;
}

export { dot };
