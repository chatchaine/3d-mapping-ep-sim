// Three.js viewport: chamber shells with LAT / voltage / live-propagation colouring,
// points, lesion tags, catheters, landmarks, ghost target, view presets (UX spec §2.3, §3).
// Model coordinates are LPS millimetres; one group rotation maps them to three.js Y-up
// (x → x, superior → up, anterior → toward the AP camera).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CHAMBER_IDS, CHAMBER_INDEX, LANDMARKS_RAW as LR, PV_DEFS, TV_N, MV_N, buildVisualHeart } from '../engine/geometry.js';

let visualCache = null; // display meshes are built once per session (same anatomy for every case)

const ZERO3 = [0, 0, 0];
const arr_half = () => 10; // Orion basket half-length (mm)
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
    this.scene.add(new THREE.HemisphereLight(0xe8eef5, 0x1a2028, 0.75));
    this.key = new THREE.DirectionalLight(0xffffff, 1.5); this.camera.add(this.key); this.key.position.set(40, 80, 60);
    const fill = new THREE.DirectionalLight(0xbfd4ff, 0.45); this.camera.add(fill); fill.position.set(-70, -20, 30);
    const rim = new THREE.DirectionalLight(0xffe2d0, 0.5); this.camera.add(rim); rim.position.set(0, 40, -80);
    this.scene.add(this.camera);
    this.root = new THREE.Group(); this.root.rotation.x = -Math.PI / 2; this.scene.add(this.root);
    this.mode = 'lat'; this.opacityMode = 0; this.show = { points: true, tags: true, cath: true, labels: true, others: false, context: false, beat: false };
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
      // moist endocardium look: soft diffuse with a light clear-coat sheen
      const m = new THREE.MeshPhysicalMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.62, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.45, transparent: true, opacity: 1 });
      const mesh = new THREE.Mesh(g, m);
      mesh.userData = { chamber: c, id: c.id, nodeOf: null, pos: c.positions };
      this.root.add(mesh);
      this.meshes.push(mesh);
    }
    this.nodeCol = new Float32Array(heart.count * 3);
    this._initBeat();
    this._buildContext();
    // swap in the finer display shells (built once, off the first frame)
    const swap = () => { if (this.sim === sim) this._useVisual(visualCache); };
    if (visualCache) swap();
    else setTimeout(() => { if (this.sim !== sim) return; visualCache = buildVisualHeart(heart, 1.5); swap(); }, 30);
    // points & tags (instanced)
    const sph = new THREE.SphereGeometry(1, 10, 8);
    this.ptMesh = new THREE.InstancedMesh(sph, new THREE.MeshPhongMaterial({ color: 0xffffff }), 4000); this.ptMesh.count = 0; this.root.add(this.ptMesh);
    this.tagMesh = new THREE.InstancedMesh(sph, new THREE.MeshPhongMaterial({ color: 0xffffff, transparent: true, opacity: 0.92 }), 600); this.tagMesh.count = 0; this.root.add(this.tagMesh);
    this.specMesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(2.2), new THREE.MeshPhongMaterial({ color: 0xffffff }), 60); this.specMesh.count = 0; this.root.add(this.specMesh);
    this.ptMesh.frustumCulled = this.tagMesh.frustumCulled = this.specMesh.frustumCulled = false;
    this.specialTags = [];
    // catheters
    this.cathGroup = new THREE.Group(); this.root.add(this.cathGroup); this.cfArrow = null;
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
    if (this.context) this.context.visible = this.show.context;
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
    const NC = this.nodeCol;
    for (const mesh of this.meshes) {
      if (!mesh.visible) continue;
      const c = mesh.userData.chamber;
      // 1) colour per engine node
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
        NC[3 * n] = r; NC[3 * n + 1] = g; NC[3 * n + 2] = b;
      }
      // 2) expand to the display vertices
      const col = mesh.geometry.attributes.color.array, nodeOf = mesh.userData.nodeOf;
      const nv = col.length / 3;
      for (let v = 0; v < nv; v++) {
        const n = nodeOf ? nodeOf[v] : c.offset + v;
        col[3 * v] = NC[3 * n]; col[3 * v + 1] = NC[3 * n + 1]; col[3 * v + 2] = NC[3 * n + 2];
      }
      mesh.geometry.attributes.color.needsUpdate = true;
    }
  }

  // Replace the engine-resolution shells with the finer, relief-detailed display shells.
  _useVisual(vis) {
    if (!vis) return;
    this.meshes.forEach((mesh, i) => {
      const vc = vis[i];
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(vc.positions.slice(), 3)); // animated copy; vc.positions stays the rest shape
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vc.positions.length).fill(0.55), 3));
      g.setIndex(new THREE.BufferAttribute(vc.indices, 1));
      g.computeVertexNormals();
      g.computeBoundingSphere();
      mesh.geometry.dispose();
      mesh.geometry = g;
      mesh.userData.nodeOf = vc.nodeOf; mesh.userData.pos = vc.positions;
      mesh.frustumCulled = false;
    });
    this.dirty = true;
  }

  // Surrounding anatomy (CT-merge style context): great vessels, caval and pulmonary
  // vein extensions, coronary sinus, and valve annulus rings. Translucent, not mapped.
  _buildContext() {
    const grp = new THREE.Group(); grp.renderOrder = 3;
    const V = (p) => new THREE.Vector3(p[0], p[1], p[2]);
    const mat = (hex, op) => new THREE.MeshPhongMaterial({ color: hex, transparent: true, opacity: op, depthWrite: false, shininess: 30, side: THREE.DoubleSide });
    const tube = (pts, r, m, closed = false) => {
      const curve = new THREE.CatmullRomCurve3(pts.map(V), closed, 'centripetal');
      const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, pts.length * 10, r, 20, closed), m);
      mesh.renderOrder = 3; grp.add(mesh); return mesh;
    };
    const ring = (c, n, r, m, w = 0.9) => {
      const mesh = new THREE.Mesh(new THREE.TorusGeometry(r, w, 8, 64), m);
      mesh.position.copy(V(c)); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), V(n).normalize());
      mesh.renderOrder = 3; grp.add(mesh);
    };
    const art = mat(0xc4525a, 0.26), pa = mat(0x5d7fc9, 0.26), vein = mat(0x6f86b5, 0.24), cs = mat(0x9b7fd4, 0.4), valve = mat(0xe9d28c, 0.7);
    // aorta: root at the cusps, ascending, arch, descending (left-posterior of the oesophagus)
    tube([[8, 3, 6], [6, -2, 26], [3, 0, 48], [6, 8, 64], [18, 40, 74], [30, 66, 60], [35, 80, 30], [33, 80, -10], [30, 76, -70]], 12, art);
    tube([[7, 12, 68], [2, 10, 96]], 5, art); tube([[16, 30, 74], [18, 32, 100]], 4, art); tube([[25, 50, 72], [31, 54, 98]], 4.5, art);
    // pulmonary trunk and branches (RPA runs behind the ascending aorta and SVC)
    tube([[8, -28, 18], [14, -24, 34], [18, -14, 47]], 12, pa);
    tube([[18, -14, 47], [34, 0, 54], [52, 20, 50]], 8.5, pa);
    tube([[18, -14, 47], [6, 10, 52], [-8, 28, 50], [-24, 40, 46], [-38, 44, 42]], 8, pa);
    // caval veins beyond the RA shell openings
    tube([[-25, 22, 46], [-25, 21, 70], [-23, 19, 98]], 10, vein);
    tube([[-22, 30, -50], [-20, 33, -80], [-16, 36, -112]], 12, vein);
    // pulmonary vein extensions
    for (const d of Object.values(PV_DEFS)) {
      const ab = [d.b[0] - d.a[0], d.b[1] - d.a[1], d.b[2] - d.a[2]], l = Math.hypot(...ab);
      const u = ab.map((x) => x / l);
      tube([d.b.map((x, i) => x - u[i] * 4), d.b.map((x, i) => x + u[i] * 14), d.b.map((x, i) => x + u[i] * 26)], d.r - 1, vein);
    }
    // coronary sinus / great cardiac vein in the AV groove
    tube([LR.CS_OS, LR.CS_9_10, LR.CS_7_8, LR.CS_5_6, LR.CS_3_4, LR.CS_1_2, [49, 4, 0], [44, -10, 6]], 3.6, cs);
    // valve annuli
    ring(LR.TV_CENTER, TV_N, 17, valve);
    ring(LR.MV_CENTER, MV_N, 16, valve);
    ring([9, 2, 6], [-0.45, 0.2, 0.87], 11, valve, 0.7);
    ring([8, -28, 17], [0.3, 0.1, 1], 11.5, valve, 0.7);
    if (this.context) { this.root.remove(this.context); this.context.traverse((o) => o.geometry?.dispose?.()); }
    this.context = grp; grp.visible = this.show.context; this.root.add(grp);
  }

  updatePoints() {
    const map = this.sim.mapping, s = map.settings, M = new THREE.Matrix4(), col = new THREE.Color();
    const pts = map.points;
    const n = Math.min(pts.length, 4000);
    for (let i = 0; i < n; i++) {
      const p = pts[pts.length - n + i];
      const o = this._off(p.node);
      M.makeScale(1, 1, 1).setPosition(p.pos[0] + o[0], p.pos[1] + o[1], p.pos[2] + o[2]);
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
      const o = this._off(les.node);
      M.makeScale(r, r, r).setPosition(les.pos[0] + o[0], les.pos[1] + o[1], les.pos[2] + o[2]);
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
        o = this.cathObjs[id] = { group: new THREE.Group(), key: '' };
        o.shaftMat = new THREE.MeshPhongMaterial({ color: new THREE.Color(css(c.info.color)), shininess: 45 });
        o.elecMat = new THREE.MeshPhongMaterial({ color: 0xe4e8ee, specular: 0xffffff, shininess: 140 }); // platinum-iridium
        this.cathGroup.add(o.group);
      }
      const poles = c.placed ? c.poles : [];
      // the catheter moves with the wall it touches (cardiac motion)
      const tipNode = id === 'ABL' ? c.surfaceNode : (poles.length ? (o.tipFor === poles[0] ? o.tipNode : (o.tipFor = poles[0], o.tipNode = this.sim.heart.grid.nearest(poles[0], 40))) : -1);
      const to = this._off(tipNode); o.group.position.set(to[0], to[1], to[2]);
      const key = pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(';') + '|' + poles.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(';') + (c.array ? '|' + c.array.contact.map(Number).join('') : '');
      if (key === o.key) continue;
      o.key = key;
      for (const ch of [...o.group.children]) { o.group.remove(ch); ch.geometry.dispose(); }
      if (pts.length < 2) continue;
      if (id === 'ABL' && c.array) { this._drawArray(o, pts, c.array); continue; }
      const abl = id === 'ABL';
      const R = abl ? 1.17 : id === 'CS' ? 0.9 : 1.0; // 7 Fr ablation, 6 Fr diagnostic
      const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'centripetal');
      const L = curve.getLength();
      o.group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(24, Math.round(L / 1.5)), R, 12, false), o.shaftMat));
      // electrodes: short tubes cut from the shaft curve itself, so every band bends with the shaft
      const NS = Math.max(120, Math.round(L * 3));
      const samp = []; for (let i = 0; i <= NS; i++) samp.push(curve.getPointAt(i / NS));
      const uOf = (p) => { const v = new THREE.Vector3(p[0], p[1], p[2]); let bi = 0, bd = Infinity; for (let i = 0; i <= NS; i++) { const d = samp[i].distanceToSquared(v); if (d < bd) { bd = d; bi = i; } } return bi / NS; };
      const tipEndU = poles.length && uOf(poles[0]) > 0.5 ? 1 : 0;
      const band = (u0, u1) => {
        u0 = Math.max(0, Math.min(1, u0)); u1 = Math.max(0, Math.min(1, u1));
        if (u1 - u0 < 1e-5) return;
        const m = 6, sp = []; for (let j = 0; j <= m; j++) sp.push(curve.getPointAt(u0 + ((u1 - u0) * j) / m));
        const sub = new THREE.CatmullRomCurve3(sp, false, 'centripetal');
        o.group.add(new THREE.Mesh(new THREE.TubeGeometry(sub, 10, R * 1.07, 12, false), o.elecMat));
      };
      for (let i = 0; i < poles.length; i++) {
        if (i === 0) {
          // distal tip electrode (3.5 mm ablation tip, 2 mm diagnostic) with a rounded cap
          const tl = (abl ? 3.5 : 2) / L;
          if (tipEndU === 1) band(1 - tl, 1); else band(0, tl);
          const cap = new THREE.Mesh(new THREE.SphereGeometry(R * 1.07, 14, 10), o.elecMat);
          cap.position.copy(curve.getPointAt(tipEndU)); o.group.add(cap);
        } else {
          const u = uOf(poles[i]), hw = 0.55 / L; // 1.1 mm ring electrodes
          band(u - hw, u + hw);
        }
      }
    }
    // contact-force arrow on the ablation tip
    const abl = cats.ABL;
    if (!this.cfArrow) { this.cfArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), 10, 0x3ccf7a, 3, 2); this.cathGroup.add(this.cfArrow); }
    const len = Math.max(0.01, abl.cf * 0.35);
    this.cfArrow.visible = abl.cf > 1 && !abl.array;
    const ao = this._off(abl.surfaceNode);
    this.cfArrow.position.set(abl.tip[0] + ao[0], abl.tip[1] + ao[1], abl.tip[2] + ao[2]);
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

  // ------------------------------------------------------------------ heartbeat
  // Wall motion driven by the simulated activation: each engine node contracts after its
  // own activation (atria ~70 ms upstroke, ventricles ~160 ms with a plateau, so motion
  // tracks the ECG, arrhythmias and dyssynchrony). Radial motion is inward along the
  // wall normal; in ventricular systole the base (AV plane) descends toward the apex and
  // pulls the atria with it. Non-conducting scar is akinetic. Display only: the engine,
  // mapping and catheter physics keep the rest shape.
  _initBeat() {
    const heart = this.sim.heart, N = heart.count;
    this.nodeDisp = new Float32Array(N * 3);
    this.beatState = new Float32Array(N);
    this.beatWasOn = false;
    const base = [25, 12, -8], ap = LR.LV_APEX;
    const ax = [ap[0] - base[0], ap[1] - base[1], ap[2] - base[2]], al = Math.hypot(...ax);
    this.beatAxis = ax.map((v) => v / al);
    this.beatLong = new Float32Array(N); // longitudinal amplitude per node (mm)
    for (let n = 0; n < N; n++) {
      const sAx = (heart.pos[3 * n] - base[0]) * this.beatAxis[0] + (heart.pos[3 * n + 1] - base[1]) * this.beatAxis[1] + (heart.pos[3 * n + 2] - base[2]) * this.beatAxis[2];
      this.beatLong[n] = heart.chamber[n] >= 2 ? 6 * Math.max(0, 1 - Math.max(0, sAx) / al) : 5 * Math.max(0, Math.min(1, 1 + sAx / 45));
    }
  }
  // Multipolar mapping catheter: 8 Fr shaft, then the HD Grid paddle or the Orion basket.
  // Electrodes in wall contact are bright; the others are dimmed.
  _drawArray(o, pts, arr) {
    const V = (p) => new THREE.Vector3(p[0], p[1], p[2]);
    if (!o.dimMat) { o.dimMat = new THREE.MeshPhongMaterial({ color: 0x7d8794, shininess: 60 }); o.splineMat = new THREE.MeshPhongMaterial({ color: 0x2b3440, shininess: 30 }); }
    const shaft = new THREE.CatmullRomCurve3(pts.map(V), false, 'centripetal');
    const L = shaft.getLength();
    const grid = arr.kind === 'grid';
    // the shaft ends where the array begins
    const cut = grid ? 3 : 20;
    const uEnd = Math.max(0.05, 1 - cut / L);
    const sp = []; for (let i = 0; i <= 40; i++) sp.push(shaft.getPointAt((uEnd * i) / 40));
    const sc = new THREE.CatmullRomCurve3(sp, false, 'centripetal');
    o.group.add(new THREE.Mesh(new THREE.TubeGeometry(sc, Math.max(24, Math.round(L / 1.5)), 1.3, 12, false), o.shaftMat));
    const end = sp[sp.length - 1];
    const ns = arr.splines, ne = arr.perSpline;
    const add3 = (a, b, k) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
    let prox, dist;
    if (grid) { prox = V(add3(arr.C, arr.u, -7.5)); dist = null; }
    else { prox = V(add3(arr.C, arr.a, -arr_half(arr))); dist = V(add3(arr.C, arr.a, arr_half(arr))); }
    // neck from the shaft end to the array hub
    o.group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(end, prox), 4, 0.8, 8, false), o.shaftMat));
    for (let i = 0; i < ns; i++) {
      const e = []; for (let j = ne - 1; j >= 0; j--) e.push(V(arr.pos[i * ne + j])); // proximal → distal
      let cp;
      if (grid) {
        // paddle splines fan out from the neck and loop back at the distal end
        const off = (i - 1.5) * 3;
        const dEnd = V(add3(add3(arr.C, arr.u, 6.2), arr.v, off * 0.55));
        cp = [prox, ...e, dEnd];
      } else cp = [prox, ...e, dist];
      const curve = new THREE.CatmullRomCurve3(cp, false, 'centripetal');
      o.group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 30, grid ? 0.3 : 0.25, 6, false), o.splineMat));
    }
    if (grid) {
      // distal loops joining A-B and C-D
      for (const [a, b] of [[0, 1], [2, 3], [1, 2]]) {
        const pa = V(add3(add3(arr.C, arr.u, 6.2), arr.v, (a - 1.5) * 3 * 0.55)), pb = V(add3(add3(arr.C, arr.u, 6.2), arr.v, (b - 1.5) * 3 * 0.55));
        o.group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(pa, pb), 2, 0.3, 6, false), o.splineMat));
      }
    } else {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8), o.splineMat); cap.position.copy(dist); o.group.add(cap);
    }
    const eg = new THREE.SphereGeometry(grid ? 0.55 : 0.5, 10, 8);
    for (let k = 0; k < arr.pos.length; k++) {
      const m = new THREE.Mesh(eg, arr.contact[k] ? o.elecMat : o.dimMat);
      m.position.copy(V(arr.pos[k])); o.group.add(m);
    }
  }

  _off(n) {
    const D = this.nodeDisp;
    if (!D || n == null || n < 0 || n >= this.beatState.length) return ZERO3;
    return [D[3 * n], D[3 * n + 1], D[3 * n + 2]];
  }
  _beat() {
    const sim = this.sim, eng = sim.engine, heart = sim.heart, N = heart.count;
    const D = this.nodeDisp, S = this.beatState, nrm = heart.normal, ax = this.beatAxis;
    const on = this.show.beat;
    const now = sim.t;
    const smooth = (a) => a * a * (3 - 2 * a);
    // contraction curve: delay, upstroke, plateau, relaxation (ms)
    const curve = (tau, d, rise, hold, fall) => {
      tau -= d;
      if (tau <= 0) return 0;
      if (tau < rise) return smooth(tau / rise);
      tau -= rise; if (tau < hold) return 1;
      tau -= hold; return tau < fall ? 1 - smooth(tau / fall) : 0;
    };
    const AMP = [1.6, 1.4, 3.0, 4.2]; // radial excursion by chamber (mm)
    let vSum = 0, vN = 0;
    for (let n = 0; n < N; n++) {
      const ch = heart.chamber[n];
      const tau = now - eng.lastAct[n];
      const tgt = on ? (ch >= 2 ? curve(tau, 25, 160, 70, 150) : curve(tau, 15, 70, 30, 90)) : 0;
      S[n] += (tgt - S[n]) * 0.45;
      if (ch >= 2) { vSum += S[n]; vN++; }
    }
    const gV = vN ? vSum / vN : 0; // global ventricular systole (drives AV-plane descent)
    for (let n = 0; n < N; n++) {
      const ch = heart.chamber[n];
      const kin = eng.cv[n] > 0 ? 1 : 0.08; // dense scar / ablated core is akinetic
      const r = -AMP[ch] * S[n] * kin;
      const l = this.beatLong[n] * (ch >= 2 ? S[n] * kin : gV) * (on ? 1 : 0);
      D[3 * n] = nrm[3 * n] * r + ax[0] * l;
      D[3 * n + 1] = nrm[3 * n + 1] * r + ax[1] * l;
      D[3 * n + 2] = nrm[3 * n + 2] * r + ax[2] * l;
    }
    for (const mesh of this.meshes) {
      const nodeOf = mesh.userData.nodeOf; if (!nodeOf || !mesh.visible) continue;
      const P = mesh.geometry.attributes.position.array, B = mesh.userData.pos;
      for (let v = 0; v < nodeOf.length; v++) {
        const k = 3 * nodeOf[v];
        P[3 * v] = B[3 * v] + D[k]; P[3 * v + 1] = B[3 * v + 1] + D[k + 1]; P[3 * v + 2] = B[3 * v + 2] + D[k + 2];
      }
      mesh.geometry.attributes.position.needsUpdate = true;
    }
    // after switching off, run until the walls have settled back to rest
    this.beatWasOn = on || S.some((x) => x > 0.002);
  }

  // ------------------------------------------------------------------ picking
  pickSurface(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(v, this.camera);
    const hits = this.raycaster.intersectObjects(this.meshes.filter((m) => m.visible && m.material.opacity > 0.5), false);
    if (!hits.length) return null;
    const h = hits[0];
    const c = h.object.userData.chamber, P = h.object.userData.pos, nodeOf = h.object.userData.nodeOf;
    const local = this.root.worldToLocal(h.point.clone());
    const face = h.face;
    let best = -1, bd = Infinity;
    for (const vi of [face.a, face.b, face.c]) {
      const dx = P[3 * vi] - local.x, dy = P[3 * vi + 1] - local.y, dz = P[3 * vi + 2] - local.z;
      const d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; best = vi; }
    }
    const node = nodeOf ? nodeOf[best] : c.offset + best;
    return { node, pos: [local.x, local.y, local.z], chamber: c.id };
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
      if (this.show.beat || this.beatWasOn) {
        this._beat();
        this.updatePoints(); this.updateTags();
      }
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
