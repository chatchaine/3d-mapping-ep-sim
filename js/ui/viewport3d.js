// Three.js viewport: chamber shells with LAT / voltage / live-propagation colouring,
// points, lesion tags, catheters, landmarks, ghost target, view presets (UX spec §2.3, §3).
// Model coordinates are LPS millimetres; one group rotation maps them to three.js Y-up
// (x → x, superior → up, anterior → toward the AP camera).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CHAMBER_IDS, LANDMARKS_RAW as LR, PV_DEFS } from '../engine/geometry.js';

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
const toRGB = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

// OKLab interpolation between colour stops (UX spec §3.1).
function srgbToLin(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function linToSrgb(c) { return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }
function toOK([r, g, b]) {
  r = srgbToLin(r); g = srgbToLin(g); b = srgbToLin(b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function fromOK([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map((v) => Math.max(0, Math.min(1, linToSrgb(v))));
}
export function makeRamp(hexes, n = 256) {
  const stops = hexes.map((h) => toOK(toRGB(h)));
  const lut = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * (stops.length - 1); const k = Math.min(stops.length - 2, Math.floor(t)); const f = t - k;
    const c = fromOK([0, 1, 2].map((j) => stops[k][j] * (1 - f) + stops[k + 1][j] * f));
    lut.set(c, i * 3);
  }
  return lut;
}

const VIEWS = {
  AP: [0, -1, 0], PA: [0, 1, 0], LAO: [0.71, -0.71, 0], RAO: [-0.5, -0.87, 0], LL: [1, 0, 0], RL: [-1, 0, 0],
};
const LABELS = [
  ['SVC', [-30, 26, 56], 'RA'], ['IVC', [-28, 30, -58], 'RA'], ['CS os', LR.CS_OS, 'RA'], ['His', LR.HIS, 'RA'], ['TV', [-22, 0, -14], 'RA'],
  ['MV', LR.MV_CENTER, 'LA'], ['LAA', LR.LAA, 'LA'], ['LSPV', PV_DEFS.LSPV.b, 'LA'], ['LIPV', PV_DEFS.LIPV.b, 'LA'], ['RSPV', PV_DEFS.RSPV.b, 'LA'], ['RIPV', PV_DEFS.RIPV.b, 'LA'],
  ['RV apex', LR.RV_APEX, 'RV'], ['RVOT', LR.RVOT_FREE, 'RV'], ['LV apex', LR.LV_APEX, 'LV'], ['Mitral annulus', [25, 10, -14], 'LV'],
];

export class Viewport3D {
  constructor(canvas, container) {
    this.canvas = canvas; this.container = container;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(css('--c-bg-viewport'));
    this.camera = new THREE.PerspectiveCamera(40, 1, 1, 2000);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.1;
    this.controls.minDistance = 40; this.controls.maxDistance = 600;
    this.scene.add(new THREE.HemisphereLight(0xdfe8f0, 0x202830, 0.9));
    this.key = new THREE.DirectionalLight(0xffffff, 1.4); this.camera.add(this.key); this.key.position.set(40, 80, 60);
    this.scene.add(this.camera);
    this.root = new THREE.Group(); this.root.rotation.x = -Math.PI / 2; this.scene.add(this.root);
    this.mode = 'lat'; this.opacityMode = 0; this.show = { points: true, tags: true, cath: true, labels: true, others: false };
    this.ghost = null; this.labels = [];
    this.raycaster = new THREE.Raycaster();
    this.tween = null;
    this.refreshPalette();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  refreshPalette() {
    this.latLUT = makeRamp([0, 1, 2, 3, 4, 5, 6].map((i) => css(`--lat-${i}`)));
    this.voltLUT = makeRamp(['--volt-scar', '--volt-low-1', '--volt-low-2', '--volt-low-3', '--volt-normal'].map(css));
    this.grey = toRGB(css('--c-shell-nomap'));
    this.tagColors = { weak: css('--tag-weak'), good: css('--tag-good'), strong: css('--tag-strong'), excess: css('--tag-excess') };
    this.dirty = true;
    return { lat: [0, 1, 2, 3, 4, 5, 6].map((i) => css(`--lat-${i}`)), volt: ['--volt-scar', '--volt-low-1', '--volt-low-2', '--volt-low-3', '--volt-normal'].map(css) };
  }

  // ------------------------------------------------------------------ setup per case
  setSim(sim, focusChamber) {
    this.sim = sim;
    for (const o of [...this.root.children]) { this.root.remove(o); o.geometry?.dispose?.(); }
    for (const l of this.labels) l.el.remove();
    this.labels = [];
    const heart = sim.heart;
    this.meshes = [];
    for (const c of heart.chambers) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(c.positions, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(c.normals, 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(c.count * 3).fill(0.55), 3));
      g.setIndex(new THREE.BufferAttribute(c.indices, 1));
      g.computeBoundingSphere();
      const m = new THREE.MeshPhongMaterial({ vertexColors: true, side: THREE.DoubleSide, shininess: 22, specular: 0x222222, transparent: true, opacity: 1 });
      const mesh = new THREE.Mesh(g, m);
      mesh.userData = { chamber: c, id: c.id };
      this.root.add(mesh);
      this.meshes.push(mesh);
    }
    // points & tags (instanced)
    const sph = new THREE.SphereGeometry(1, 10, 8);
    this.ptMesh = new THREE.InstancedMesh(sph, new THREE.MeshPhongMaterial({ color: 0xffffff }), 4000); this.ptMesh.count = 0; this.root.add(this.ptMesh);
    this.tagMesh = new THREE.InstancedMesh(sph, new THREE.MeshPhongMaterial({ color: 0xffffff, transparent: true, opacity: 0.92 }), 600); this.tagMesh.count = 0; this.root.add(this.tagMesh);
    this.specMesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(2.2), new THREE.MeshPhongMaterial({ color: 0xffffff }), 60); this.specMesh.count = 0; this.root.add(this.specMesh);
    this.ptMesh.frustumCulled = this.tagMesh.frustumCulled = this.specMesh.frustumCulled = false;
    this.specialTags = [];
    // catheters
    this.cathGroup = new THREE.Group(); this.root.add(this.cathGroup);
    this.cathObjs = {};
    // landmark labels
    const host = this.container;
    for (const [txt, p, ch] of LABELS) {
      const el = document.createElement('div'); el.className = 'label3d'; el.textContent = txt; host.appendChild(el);
      this.labels.push({ el, p, ch });
    }
    this.lastPtVersion = -1; this.lastLesionN = -1;
    this.setFocus(focusChamber || 'RA', true);
    this.setView('AP', true);
    this.dirty = true;
  }

  setFocus(ch, snap = false) {
    this.focus = ch;
    const ci = CHAMBER_IDS.indexOf(ch);
    const m = this.meshes[ci];
    const c = m.geometry.boundingSphere.center.clone();
    this.focusCenter = c;
    this.updateVisibility();
    this.root.updateMatrixWorld(true);
    const tgt = this.root.localToWorld(c.clone());
    if (snap) { this.controls.target.copy(tgt); }
    else this._tweenTo(this.camera.position.clone().sub(this.controls.target).add(tgt), tgt);
  }

  updateVisibility() {
    const ci = CHAMBER_IDS.indexOf(this.focus);
    const op = [1, 0.6, 0.25][this.opacityMode];
    this.meshes.forEach((m, i) => {
      const main = i === ci;
      m.visible = main || this.show.others;
      m.material.opacity = main ? op : Math.min(op, 0.22);
      m.material.wireframe = main && this.opacityMode === 2;
      m.material.depthWrite = main && op === 1;
      m.renderOrder = main ? 1 : 2;
    });
    this.dirty = true;
  }

  setView(name, snap = false) {
    const d = VIEWS[name]; if (!d) return;
    this.currentView = name;
    const tgt = this.controls.target.clone();
    const dist = snap ? 230 : this.camera.position.distanceTo(tgt);
    const dir3 = new THREE.Vector3(d[0], d[2], -d[1]).normalize();
    const pos = tgt.clone().add(dir3.multiplyScalar(dist));
    this.camera.up.set(0, 1, 0);
    if (snap || matchMedia('(prefers-reduced-motion: reduce)').matches) { this.camera.position.copy(pos); this.controls.update(); }
    else this._tweenTo(pos, tgt);
    document.querySelectorAll('.view-presets__btn').forEach((b) => b.classList.toggle('is-current', b.dataset.view === name));
  }
  _tweenTo(pos, tgt) {
    this.tween = { p0: this.camera.position.clone(), t0: this.controls.target.clone(), p1: pos, t1: tgt, s: performance.now(), d: 400 };
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  // ------------------------------------------------------------------ colouring
  colorShell() {
    const sim = this.sim, map = sim.mapping, eng = sim.engine, s = map.settings;
    const [lo, hi] = s.woi;
    const vlo = Math.log(s.voltLo), vhi = Math.log(s.voltHi);
    const now = sim.t;
    for (const mesh of this.meshes) {
      if (!mesh.visible) continue;
      const c = mesh.userData.chamber, col = mesh.geometry.attributes.color.array;
      for (let v = 0; v < c.count; v++) {
        const n = c.offset + v;
        let r = this.grey[0], g = this.grey[1], b = this.grey[2];
        if (this.mode === 'lat') {
          const L = map.latAt(n);
          if (L != null) { const t = Math.max(0, Math.min(1, (L - lo) / (hi - lo))); const k = Math.round(t * 255) * 3; r = this.latLUT[k]; g = this.latLUT[k + 1]; b = this.latLUT[k + 2]; }
        } else if (this.mode === 'volt') {
          const V = map.voltAt(n);
          if (V != null) {
            if (V < 0.05) { r = g = b = 0.42; } else { const t = Math.max(0, Math.min(1, (Math.log(V) - vlo) / (vhi - vlo))); const k = Math.round(t * 255) * 3; r = this.voltLUT[k]; g = this.voltLUT[k + 1]; b = this.voltLUT[k + 2]; }
          }
        } else if (this.mode === 'prop') {
          // live wavefront ("truth" propagation, teaching view)
          const dt = now - eng.lastAct[n];
          if (eng.cv[n] <= 0) { r = g = b = 0.3; }
          else if (dt >= 0 && dt < 260) { const t = dt / 260; const k = Math.round(t * 255) * 3; r = this.latLUT[k]; g = this.latLUT[k + 1]; b = this.latLUT[k + 2]; }
          else { r = 0.16; g = 0.2; b = 0.32; }
        }
        col[3 * v] = r; col[3 * v + 1] = g; col[3 * v + 2] = b;
      }
      mesh.geometry.attributes.color.needsUpdate = true;
    }
  }

  updatePoints() {
    const map = this.sim.mapping, s = map.settings, M = new THREE.Matrix4(), col = new THREE.Color();
    const pts = map.points;
    const n = Math.min(pts.length, 4000);
    for (let i = 0; i < n; i++) {
      const p = pts[pts.length - n + i];
      M.makeScale(1, 1, 1).setPosition(p.pos[0], p.pos[1], p.pos[2]);
      this.ptMesh.setMatrixAt(i, M);
      if (this.mode === 'volt') { const t = Math.max(0, Math.min(1, (Math.log(Math.max(0.01, p.bip)) - Math.log(s.voltLo)) / (Math.log(s.voltHi) - Math.log(s.voltLo)))); const k = Math.round(t * 255) * 3; col.setRGB(this.voltLUT[k], this.voltLUT[k + 1], this.voltLUT[k + 2]); }
      else if (p.lat != null) { const t = Math.max(0, Math.min(1, (p.lat - s.woi[0]) / (s.woi[1] - s.woi[0]))); const k = Math.round(t * 255) * 3; col.setRGB(this.latLUT[k], this.latLUT[k + 1], this.latLUT[k + 2]); }
      else col.setRGB(0.85, 0.85, 0.85);
      this.ptMesh.setColorAt(i, col);
    }
    this.ptMesh.count = n;
    this.ptMesh.instanceMatrix.needsUpdate = true;
    if (this.ptMesh.instanceColor) this.ptMesh.instanceColor.needsUpdate = true;
    this.ptMesh.visible = this.show.points && this.mode !== 'none';
  }

  updateTags() {
    const L = this.sim.ablation.lesions, M = new THREE.Matrix4(), col = new THREE.Color();
    let k = 0;
    for (const les of L) {
      if (les.dur != null && les.dur < 3 && !les.active) continue;
      const r = les.active ? Math.max(1.2, Math.min(3, les.diam / 2)) : 1.6;
      M.makeScale(r, r, r).setPosition(les.pos[0], les.pos[1], les.pos[2]);
      this.tagMesh.setMatrixAt(k, M);
      col.set(this.tagColors[les.tier || 'weak'] || '#ffffff');
      this.tagMesh.setColorAt(k, col);
      k++;
      if (k >= 600) break;
    }
    this.tagMesh.count = k;
    this.tagMesh.instanceMatrix.needsUpdate = true;
    if (this.tagMesh.instanceColor) this.tagMesh.instanceColor.needsUpdate = true;
    this.tagMesh.visible = this.show.tags;
    let j = 0;
    for (const t of this.specialTags) {
      M.makeScale(1, 1, 1).setPosition(t.pos[0], t.pos[1], t.pos[2]);
      this.specMesh.setMatrixAt(j, M); col.set(t.type === 'his' ? css('--tag-his') : t.type === 'phrenic' ? css('--tag-phrenic') : css('--c-accent'));
      this.specMesh.setColorAt(j, col); j++;
    }
    this.specMesh.count = j; this.specMesh.instanceMatrix.needsUpdate = true; if (this.specMesh.instanceColor) this.specMesh.instanceColor.needsUpdate = true;
    this.specMesh.visible = this.show.tags;
  }
  addSpecialTag(type, pos) { this.specialTags.push({ type, pos: pos.slice() }); this.updateTags(); }

  updateCatheters() {
    const cats = this.sim.catheters;
    for (const [id, c] of Object.entries(cats)) {
      const pts = c.placed ? c.shaft() : [];
      let o = this.cathObjs[id];
      if (!o) {
        o = this.cathObjs[id] = { tube: null, poles: new THREE.InstancedMesh(new THREE.CylinderGeometry(1.25, 1.25, 1.4, 12), new THREE.MeshPhongMaterial({ color: 0xdddddd, shininess: 80 }), 10), key: '' };
        o.color = new THREE.Color(css(c.info.color));
        o.poles.frustumCulled = false;
        this.cathGroup.add(o.poles);
      }
      const key = pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(';');
      if (key === o.key) continue;
      o.key = key;
      if (o.tube) { this.cathGroup.remove(o.tube); o.tube.geometry.dispose(); o.tube = null; }
      if (pts.length >= 2) {
        const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
        const geo = new THREE.TubeGeometry(curve, Math.max(16, pts.length * 6), id === 'ABL' ? 1.15 : 0.9, 8, false);
        o.tube = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ color: o.color, shininess: 40 }));
        this.cathGroup.add(o.tube);
      }
      const M = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
      const poles = c.placed ? c.poles : [];
      for (let i = 0; i < poles.length; i++) {
        const p = new THREE.Vector3(...poles[i]);
        const nb = new THREE.Vector3(...(poles[i + 1] || poles[i - 1] || poles[i]));
        const dir = nb.clone().sub(p); if (i === poles.length - 1 && i > 0) dir.negate();
        if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
        q.setFromUnitVectors(up, dir.normalize());
        const sc = id === 'ABL' && i === 0 ? new THREE.Vector3(1.05, 2.6, 1.05) : new THREE.Vector3(1, 1, 1);
        M.compose(p, q, sc); o.poles.setMatrixAt(i, M);
      }
      o.poles.count = poles.length; o.poles.instanceMatrix.needsUpdate = true;
    }
    // contact-force arrow on the ablation tip
    const abl = cats.ABL;
    if (!this.cfArrow) { this.cfArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), 10, 0x3ccf7a, 3, 2); this.cathGroup.add(this.cfArrow); }
    const len = Math.max(0.01, abl.cf * 0.35);
    this.cfArrow.visible = abl.cf > 1;
    this.cfArrow.position.set(...abl.tip);
    this.cfArrow.setDirection(new THREE.Vector3(...abl.tipDir).normalize());
    this.cfArrow.setLength(len + 0.5, 2, 1.4);
    this.cfArrow.setColor(abl.cf > 40 ? css('--c-danger') : abl.cf >= 10 ? css('--c-ok') : css('--c-warn'));
    this.cathGroup.visible = this.show.cath;
  }

  setGhost(target) {
    if (this.ghost) { this.root.remove(this.ghost); this.ghost = null; }
    if (!target) return;
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: css('--c-accent'), transparent: true, opacity: 0.45, depthTest: false });
    const sites = target.kind === 'point' ? [target.pos] : target.sites;
    const r = target.kind === 'point' ? Math.max(3, target.radius * 0.7) : 1.6;
    for (const p of sites) { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), mat); m.position.set(...p); g.add(m); }
    g.renderOrder = 10;
    this.ghost = g; this.root.add(g);
  }

  // ------------------------------------------------------------------ picking
  pickSurface(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(v, this.camera);
    const hits = this.raycaster.intersectObjects(this.meshes.filter((m) => m.visible && m.material.opacity > 0.5), false);
    if (!hits.length) return null;
    const h = hits[0];
    const c = h.object.userData.chamber;
    const local = this.root.worldToLocal(h.point.clone());
    const face = h.face;
    let best = -1, bd = Infinity;
    for (const vi of [face.a, face.b, face.c]) {
      const dx = c.positions[3 * vi] - local.x, dy = c.positions[3 * vi + 1] - local.y, dz = c.positions[3 * vi + 2] - local.z;
      const d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; best = vi; }
    }
    return { node: c.offset + best, pos: [local.x, local.y, local.z], chamber: c.id };
  }
  pickPoint(clientX, clientY) {
    if (!this.ptMesh.count) return null;
    const rect = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(v, this.camera);
    const hits = this.raycaster.intersectObject(this.ptMesh, false);
    if (!hits.length) return null;
    const pts = this.sim.mapping.points; const n = this.ptMesh.count;
    return pts[pts.length - n + hits[0].instanceId];
  }

  // ------------------------------------------------------------------ frame
  render() {
    const now = performance.now();
    if (this.tween) {
      const tw = this.tween; let f = Math.min(1, (now - tw.s) / tw.d); f = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
      this.camera.position.lerpVectors(tw.p0, tw.p1, f); this.controls.target.lerpVectors(tw.t0, tw.t1, f);
      if (f >= 1) this.tween = null;
    }
    this.controls.update();
    const sim = this.sim;
    if (sim) {
      const map = sim.mapping;
      if (this.mode === 'prop' || map.version !== this.lastPtVersion || this.dirty) {
        this.colorShell(); this.updatePoints(); this.lastPtVersion = map.version;
      }
      const L = sim.ablation.lesions;
      if (sim.ablation.on || L.length !== this.lastLesionN || this.dirty) { this.updateTags(); this.lastLesionN = L.length; }
      this.updateCatheters();
      if (this.ghost) { const s = 1 + 0.15 * Math.sin(now / 250); this.ghost.children.forEach((m) => m.scale.setScalar(s)); }
      this.dirty = false;
    }
    this.renderer.render(this.scene, this.camera);
    this._labels();
  }

  _labels() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const v = new THREE.Vector3();
    for (const l of this.labels) {
      const vis = this.show.labels && (l.ch === this.focus || this.show.others);
      if (!vis) { l.el.style.display = 'none'; continue; }
      v.set(l.p[0], l.p[1], l.p[2]); this.root.localToWorld(v); v.project(this.camera);
      if (v.z > 1) { l.el.style.display = 'none'; continue; }
      l.el.style.display = ''; l.el.style.left = ((v.x + 1) / 2) * w + 'px'; l.el.style.top = ((1 - v.y) / 2) * h + 'px';
    }
  }

  snapshot() { this.render(); return this.renderer.domElement.toDataURL('image/png'); }
}
