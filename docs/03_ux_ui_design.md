# 03 — UX/UI Design Specification

Product: **VectraEP 3D** (working name, short form "VectraEP"). It is an original, browser-based training simulator for 3D electroanatomic mapping. It does not use any real vendor's name, logo, color scheme or layout. The UI uses a "dark clinical console" look with a teal-cyan accent. That accent was chosen on purpose so it does not look like any commercial mapping system.

Alternative names (all checked only informally, so legal should clear them before release): *CardioAtlas Sim*, *EPTrainer 3D*, *Isochrone Lab*.

Target: a static SPA (HTML/CSS/vanilla JS + Three.js from CDN). Minimum viewport 1280×720. Tablet layout ≥ 1024×768 in landscape. Below 1024 px, show the "Rotate / use larger screen" notice.

---

## 1. Visual identity

### 1.1 Principles
- **Dark, low-glare surfaces.** Labs are dimmed and the 3D map and EGMs must stand out. Never use pure black (#000) for panels; keep it only for the viewport background.
- **Color is reserved for data.** Use chrome neutrals for everything else. Saturated color appears only in maps, EGM channels, alerts and the one interactive accent.
- **Numbers are monospace and tabular**, so values like `35 W` don't jitter while they update.
- **Every state change shows in two channels.** Use color plus icon or text, never color alone (see §7).

### 1.2 Color tokens (`/css/tokens.css`)
```css
:root {
  /* Surfaces */
  --c-bg-viewport:   #05080c;  /* 3D canvas + EGM canvas background */
  --c-bg-app:        #0b1016;  /* page background */
  --c-bg-panel:      #121922;  /* side/bottom panels */
  --c-bg-panel-alt:  #18212c;  /* panel headers, nested groups */
  --c-bg-raised:     #1f2a37;  /* cards, inputs, buttons (rest) */
  --c-bg-hover:      #273445;
  --c-bg-pressed:    #2e3d51;
  --c-border:        #2a3646;
  --c-border-strong: #3b4a5e;
  --c-overlay:       rgba(3, 6, 10, 0.72); /* modal scrim */

  /* Text */
  --c-text:          #e6edf3;  /* primary   (15.8:1 on panel) */
  --c-text-muted:    #9aa8b8;  /* secondary (7.4:1 on panel)  */
  --c-text-faint:    #6b7a8c;  /* disabled / tertiary (4.1:1, large text only) */
  --c-text-inverse:  #05080c;

  /* Accent (interactive) */
  --c-accent:        #2ec4c9;  /* teal-cyan: focus, selected, primary buttons */
  --c-accent-hover:  #4fd6da;
  --c-accent-dim:    #1a5f63;
  --c-focus-ring:    #7fe9ec;

  /* Semantic */
  --c-ok:            #3ccf7a;
  --c-info:          #5aa9ff;
  --c-warn:          #f2b33d;
  --c-danger:        #ff5a5f;
  --c-danger-bg:     #3a1416;
  --c-warn-bg:       #3a2c10;
  --c-ok-bg:         #0f3020;
  --c-info-bg:       #10243d;

  /* RF / generator */
  --c-rf-on:         #ff7a1a;  /* RF energy delivery active */
  --c-rf-ready:      #3ccf7a;
  --c-pace:          #c58cff;  /* pacing active indicator */

  /* EGM channel colors (on --c-bg-viewport) */
  --c-egm-surface:   #e6edf3;  /* I, II, V1 */
  --c-egm-hra:       #ffd166;
  --c-egm-his:       #7bdff2;
  --c-egm-cs:        #b8f28b;
  --c-egm-rva:       #f7a1c4;
  --c-egm-abl:       #ff9f5a;
  --c-egm-grid-major:#1c2836;
  --c-egm-grid-minor:#111a24;
  --c-egm-caliper:   #2ec4c9;
  --c-egm-annot:     #9aa8b8;

  /* Catheter rendering in 3D */
  --c-cath-abl:      #ff9f5a;
  --c-cath-cs:       #b8f28b;
  --c-cath-his:      #7bdff2;
  --c-cath-hra:      #ffd166;
  --c-cath-rva:      #f7a1c4;
  --c-shell-nomap:   #8a96a3;  /* un-mapped shell grey */

  /* LAT scale (default; 7 stops early→late) */
  --lat-0: #e8262b; /* red    — earliest */
  --lat-1: #f57c1f; /* orange */
  --lat-2: #f7d02c; /* yellow */
  --lat-3: #44c25a; /* green  */
  --lat-4: #2bb3d9; /* cyan   */
  --lat-5: #3a5fe0; /* blue   */
  --lat-6: #8e3fd1; /* purple — latest */

  /* Voltage scale (bipolar; low→high) */
  --volt-scar:   #e8262b; /* < 0.5 mV  */
  --volt-low-1:  #f7d02c;
  --volt-low-2:  #44c25a;
  --volt-low-3:  #2bb3d9;
  --volt-normal: #8e3fd1; /* > 1.5 mV  */

  /* Lesion tag colors (see §3.6) */
  --tag-weak:    #f7d02c;
  --tag-good:    #ff7a1a;
  --tag-strong:  #e8262b;
  --tag-excess:  #ffffff;
  --tag-his:     #f2e600; /* His location marker */
  --tag-phrenic: #3ccf7a; /* phrenic capture site */

  /* Typography */
  --font-ui:   system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-mono: "JetBrains Mono", "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace;
  --fs-xs: 11px; --fs-sm: 12px; --fs-md: 13px; --fs-base: 14px;
  --fs-lg: 16px; --fs-xl: 20px; --fs-2xl: 28px;
  --fw-regular: 400; --fw-medium: 500; --fw-bold: 650;
  --lh-tight: 1.2; --lh-base: 1.45;

  /* Spacing (4 px base) */
  --sp-0: 0; --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px;
  --sp-5: 20px; --sp-6: 24px; --sp-8: 32px; --sp-10: 40px; --sp-12: 48px;

  /* Shape & depth */
  --radius-sm: 4px; --radius-md: 6px; --radius-lg: 10px; --radius-pill: 999px;
  --shadow-1: 0 1px 2px rgba(0,0,0,.4);
  --shadow-2: 0 6px 24px rgba(0,0,0,.55);
  --dur-fast: 120ms; --dur-base: 200ms; --ease: cubic-bezier(.2,.7,.2,1);

  /* Layout */
  --topbar-h: 48px; --left-w: 260px; --right-w: 300px; --bottom-h: 260px;
}
@media (prefers-reduced-motion: reduce) { :root { --dur-fast: 0ms; --dur-base: 0ms; } }
```
Implementation notes: The JetBrains Mono webfont is optional. If it is offline, the stack falls back to Menlo or Consolas. All numeric readouts use `font-variant-numeric: tabular-nums`.

### 1.3 Typography usage
| Role | Font | Size/weight |
|---|---|---|
| Panel section header | ui | `--fs-sm`, bold, uppercase, letter-spacing .06em, `--c-text-muted` |
| Body / labels | ui | `--fs-base` regular |
| Generator big readouts (W, °C, Ω, g) | mono | `--fs-2xl` bold |
| Small readouts, timer, score | mono | `--fs-lg` medium |
| EGM channel labels | mono | `--fs-xs` medium |
| Modal title | ui | `--fs-xl` bold |

---

## 2. Main screen layout

CSS grid on `.app-shell`:
```css
.app-shell { display:grid; height:100vh;
  grid-template-columns: var(--left-w) 1fr var(--right-w);
  grid-template-rows: var(--topbar-h) 1fr var(--bottom-h);
  grid-template-areas: "top top top" "left view right" "left egm right"; }
```
The left and right panels span both middle rows, so the EGM sits under the viewport only. That keeps the traces wide while the controls stay visible.

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ ◈ VectraEP 3D │ Case: AVNRT – typical slow/fast │ ●●●◐○○ Step 4/6 Map │ ⏱ 12:41 │ ★ 820 │?│≡│ top-bar
├──────────────┬────────────────────────────────────────────────────────┬──────────────────┤
│ WORKFLOW     │ [Map: LAT ▾] [Shell ◐] [Pts ☑] [Tags ☑] [Cath ☑]  ⟲ ⌂   │ STIMULATOR       │
│ ✔ 1 Access   │                                                ┌───┐   │ Site [CS 9-10 ▾] │
│ ✔ 2 Cath pos │                                                │SUP│   │ Mode S1 ▸ S1S2 ▸ │
│ ✔ 3 Baseline │              .-~~~~~-.                         │L ■ R│ │ S1  [600] ms     │
│ ▶ 4 Map      │           .'  RED    '.  ← LAT colored shell   └───┘   │ S2  [300] ms ▾10 │
│ ○ 5 Ablate   │          /  ⊙ABL  orange\                     AP LAO   │ mA  [ 5.0]       │
│ ○ 6 Verify   │         |  ●●● tags  yel |                    RAO PA   │ [■ PACE  P]      │
│──────────────│          \ green  blue  /                    LL  RL    │──────────────────│
│ CATHETERS    │           '. purple   .'   ◇CS  ◇His  ◇RVA             │ RF GENERATOR     │
│ ◉ ABL  [◎]   │             '-~~~~~-'                                  │ ┌─────┐┌─────┐   │
│ ○ CS   [◎]   │  ┌ LAT ms ───────────────┐                             │ │ 30 W││ 0 s │   │
│ ○ His  [◎]   │  │-80 ███████████████ +40│ pts 142  WOI -80…+40       │ └─────┘└─────┘   │
│ ○ HRA  [◎]   │  └───────────────────────┘                             │ CF  14 g ▮▮▮▯    │
│ ○ RVA  [◎]   │                                    ┌ STEER (ABL) ──┐   │ Imp 112 Ω ↓8     │
│──────────────│                                    │  ▲     ⟲  ⟳  │   │ Temp 38 °C       │
│ MAPS         │                                    │◀ ● ▶  ⇡adv ⇣ │   │ Set [30]W [60]s  │
│ ● LAT-1 (RA) │                                    │  ▼  defl 42% │   │ [ ▶ START RF  A ]│
│ ○ Volt-1     │                                    └──────────────┘   │ ABL idx/LSI 4.2  │
│ [+ New map]  │ [⊕ Acquire pt ␣] [🗑 Undo pt] [Ref: CS 7-8]           │                  │
├──────────────┼────────────────────────────────────────────────────────┤ [💡 Hint H]       │
│ (left cont.) │ EGM  [25|50|100|200 mm/s] [Gain ±] [Calipers C] [Frz ⇧F]│                │
│              │ I    ─╮╭──────╮╭─────                                    │                │
│              │ II   ─╯╰──────╯╰─────                                    │                │
│              │ V1   ───╮╭─────╮╭────                                    │                │
│              │ HRA  ─|────────|─────                                    │                │
│              │ His d ─|╫|──────|╫|──      ├── 52 ms ──┤ caliper         │                │
│              │ His p …                                                   │                │
│              │ CS9-10 … CS1-2 (5 ch)                                     │                │
│              │ RVA  ───|──────|────                                      │                │
│              │ ABL d / ABL p                                              │                │
└──────────────┴────────────────────────────────────────────────────────┴──────────────────┘
```

### 2.1 Top bar (`.top-bar`, `role="banner"`)
Left to right:
1. Logo glyph ◈ (inline SVG, a hexagon with a center dot) and the wordmark. Clicking it returns to Home after a confirm dialog when a case is in progress.
2. Case name (`.top-bar__case`), truncated with an ellipsis. The full name is in the title attribute.
3. Step progress (`.step-progress`), one pip per workflow step. States are done / current / pending / failed. Hovering a pip shows the step name.
4. Timer (`.top-bar__timer`, mono). It shows elapsed mm:ss and turns `--c-warn` once past the case's target time. Separately, show the fluoro-equivalent "RF time total".
5. Score (`.top-bar__score`, mono), with a pulse animation on change (+n floats up in green, −n in red).
6. Icon buttons: Help `?` (F1), Settings/menu `≡` (palette toggle, sound, units, exit case).

### 2.2 Left panel (`.panel--left`, `role="complementary"`, `aria-label="Workflow and catheters"`)
Three collapsible sections (`.panel-section`), each with a header and caret.
- **Workflow:** an ordered list of `.workflow-step`. The current step expands to show its task checklist, e.g. "Acquire ≥ 80 points with fill < 15 mm". Steps the user has not reached yet are locked unless the case is in Sandbox.
- **Catheters:** one row per catheter. The radio button selects the *active steering catheter*. There is a visibility eye toggle and a colored swatch matching its 3D color. Click a row's label to center the camera on the catheter tip.
- **Maps:** the list of maps (LAT / Voltage / Activation propagation) with a radio to display one, a "⋯" menu (rename, delete, duplicate with new WOI), and a "+ New map" button that opens the map settings popover.

### 2.3 Center viewport (`.viewport`, `role="application"`, `aria-label="3D cardiac map"`)
- **Toolbar** (`.viewport__toolbar`, overlaid top-left):
  - Map type dropdown.
  - Shell opacity toggle that cycles opaque → 60% → wire.
  - Toggles for points, lesion tags, catheters and anatomy labels (SVC, IVC, CS os, TV, His).
  - Reset view ⟲ and Home ⌂.
- **Orientation cube** (`.orient-cube`, top-right, 80×80). It is a second small Three.js scene synced to the main camera. Faces read SUP/INF/ANT/POST/L/R. Click a face to snap to it.
  - Below it sits a preset-view button grid (`.view-presets`): **AP, PA, LAO 45°, RAO 30°, LL, RL**, plus "LAO caudal" in an overflow menu.
  - Snap transitions are tweened over 400 ms (0 ms under reduced motion).
- **Heart shell:** a triangulated mesh. It renders `--c-shell-nomap` until points exist, then shows vertex colors interpolated from points. Faces outside the fill threshold (default 15 mm) stay grey.
- **Points:** small spheres, 2 mm. The selected point is ringed with `--c-accent`. Hover shows a tooltip `#57 · LAT −42 ms · 0.84 mV`.
- **Catheters:** tubes with electrode rings. The ablation tip shows a contact-force vector arrow whose length scales with grams and whose color follows the CF band (§3.6). On the ablation catheter, the tip and its "shadow" projection onto the shell are both shown.
- **Color bar legend** (`.colorbar`, bottom-left of viewport): see §3.3.
- **Status strip** (`.viewport__status`, bottom): point count, WOI, reference channel, current map name and fill threshold.
- **Steering widget** (`.steer-pad`, bottom-right, draggable and collapsible): see §4.3.
- **Acquire bar** (`.viewport__actions`, bottom-left above colorbar): buttons for Acquire point (Space), Delete last point (Backspace), and Tag (T) with a dropdown of tag type.

### 2.4 Right panel (`.panel--right`, `role="complementary"`, `aria-label="Stimulator and generator"`)
**Stimulator (`.stim`):**
- Pacing site select. It lists only the electrode pairs that exist on the deployed catheters.
- Mode segmented control: *Fixed (S1)*, *S1S2 extrastim*, *Burst*, *Decremental*.
- Numeric steppers: S1 cycle length (200–1000 ms, step 10), S2 (150–600 ms; "▾10" auto-decrement button), number of S1 drives (8), and output in mA (0.5–20, step 0.5).
- Pulse width is fixed at 2 ms and shown as read-only.
- Big toggle **PACE** (P). While pacing, the button and the pacing site's catheter glow in `--c-pace` and a "⚡ Pacing CS 9-10 @ 600 ms" chip appears in the top bar.

**RF Generator (`.rfgen`):**
- Mode: Power control (default) or Temperature control (sandbox only).
- Setpoints: power W (1–50, step 1; default 30) and duration s (5–120; default 60). There is a temp limit field (43 °C, read-only in power mode).
- **Live readouts** (large mono tiles, `.readout`):
  - *Power* (actual W).
  - *Elapsed* s over set s, with a radial progress ring.
  - *Contact force* g, with a 4-segment band bar: <5 low (warn), 5–10 fair, 10–30 good (ok), >40 excessive (danger).
  - *Impedance* Ω, showing baseline and Δ (e.g. "↓12 Ω"). A drop of 5–15 Ω is shown in ok color, and any rise turns danger.
  - *Temperature* °C.
  - A derived *Lesion Index* (generic name, "LQI", 0–10).
- **START RF / STOP RF** primary button (A).
  - Ready: green outline and the label "▶ START RF".
  - Active: solid `--c-rf-on` with a pulsing border and the label "■ STOP RF · 23 s".
  - Disabled (contact < 3 g or catheter not in chamber): greyed out, with the reason shown below it.
- An emergency stop is always available with Esc.
- **Hint** button (H) at the bottom, with the remaining-hint count badge.

### 2.5 Bottom EGM panel (`.egm`, `role="region"`, `aria-label="Intracardiac electrograms"`)
- **Toolbar:**
  - Sweep speed segmented control `25 | 50 | 100 | 200 mm/s` (keys 1–4).
  - Gain −/+ per selected channel (or all when none is selected).
  - Calipers toggle (C), Freeze/Review (Shift+F), "Mark" (M) to drop an annotation.
  - Channel visibility menu.
- **Canvas** (`<canvas class="egm__canvas">`):
  - A single canvas drawn at devicePixelRatio, with a 160 px label gutter on the left.
  - Default channel order, top to bottom: **I, II, V1, HRA d, His d, His p, CS 9-10, CS 7-8, CS 5-6, CS 3-4, CS 1-2, RVA d, ABL d, ABL p** (14 rows).
  - When the panel is short, rows compress to a minimum of 14 px each. Below that, the panel scrolls vertically and the label gutter stays sticky.
  - The display is a sweeping erase-bar (6 px gap) moving left→right, not a scrolling strip. This mimics clinical recorders and is cheaper to draw.
  - A grid is shown at 50+ mm/s (major every 200 ms, minor every 40 ms).
  - Stim artifacts are drawn as thin `--c-pace` vertical ticks on all channels, labelled "S1"/"S2" in the top row.
- **Calipers:**
  - Click-drag on the frozen or live trace to place two vertical lines. A floating label shows `Δ 52 ms` (and `≈ 1154 bpm` if Δ > 200 ms, as a CL hint).
  - Drag either line to adjust it. Shift-drag moves the pair. Double-click clears.
  - With the keyboard: `[` and `]` nudge the selected line by 1 ms, or 10 ms with Shift.
- **LAT annotation:** in Review mode, the ABL d channel shows a reference marker on the reference channel (default CS 7-8) and a LAT marker on ABL d. The user can drag the LAT marker. Releasing it updates the point's LAT and recolors the map.

---

## 3. Map display conventions

### 3.1 LAT map
- Values are LAT in ms relative to the reference channel's activation (marker on the reference).
- The scale is **red (earliest) → orange → yellow → green → cyan → blue → purple (latest)**, using `--lat-0…6`. Interpolate linearly in OKLab between stops; a helper `lerpOKLab()` lives in `color.js`.
- Values outside the WOI are clamped to the end colors, and those faces get a faint diagonal hatch overlay to show "out of window".
- **Early-meets-late** (re-entry) is an optional overlay drawn as a white dashed line where neighboring points differ by > 80% of the WOI.

### 3.2 Voltage map (bipolar)
- **Purple when > 1.5 mV (healthy). Red when < 0.5 mV (scar).** Between those, interpolate red → yellow → green → cyan → purple.
- The user can change the thresholds with two numeric inputs (upper default 1.50, lower default 0.50 mV, step 0.05). Faces below 0.05 mV ("dense scar / no capture") render **grey #6b6b6b** with a hatch.

### 3.3 Color bar legend (`.colorbar`)
- A 220×18 px horizontal gradient bar with tick labels in mono `--fs-xs` at the ends and center.
- The title above it is "LAT (ms)" or "Bipolar (mV)".
- For LAT, a caret on the bar marks the current hovered point's value.
- Clicking the legend opens the **map settings popover** (`.popover--map`): WOI start/end, reference channel, fill threshold (5–30 mm), voltage thresholds, interpolation on/off and palette (default / colorblind-safe, §7.2).
- For LAT the end labels read "Early" and "Late" in addition to the numbers. For voltage they read "Scar" and "Normal".

### 3.4 Window of interest (WOI)
- Defined relative to the reference: default **−80 ms … +40 ms** for atrial maps and −120 … +60 ms for ventricular maps. Cases can override it.
- In Review mode it shows as a translucent teal band (`--c-accent` at 15% alpha) across the EGM canvas, with draggable edges.
- The total WOI should be about 90% of the tachycardia cycle length. The UI shows a warning chip when WOI > CL or WOI < 70% of CL ("WOI 120 ms vs TCL 300 ms: map may be incomplete").

### 3.5 Point acquisition
Two methods:
1. **Catheter acquisition (realistic, default):** press **Space** or "⊕ Acquire pt". This records a point at the ABL tip position, *only if* CF ≥ 3 g and the tip is stable (< 2 mm movement over 500 ms).
   - On success: a point sphere pops in with a 150 ms scale animation, a soft tick sound plays, and the map recolors.
   - On failure: a toast says "No contact: point rejected (CF 1 g)".
2. **Surface click (training aid):** **Shift+click** on the shell places a point there and the catheter auto-moves to it. Cases may disable this, and it lowers the "realism" score component.

Each point stores `{id, xyz, lat, bipolar, unipolar, cf, timestamp, rejected?}`. Click a point to select it. **Delete** removes it and **Backspace** removes the last point. A point list drawer under the Maps section lets users sort points by LAT.

### 3.6 Lesion tags
Spheres of radius 3 mm, placed automatically when RF stops after ≥ 3 s. Color follows the delivered lesion quality (LQI, computed from force-time integral, power and duration):

| Tag | Condition (LQI or FTI) | Color token | Label |
|---|---|---|---|
| Weak | LQI < 3.5 or RF < 10 s or mean CF < 5 g | `--tag-weak` yellow | "Weak" |
| Good | LQI 3.5–5.5 | `--tag-good` orange | "Good" |
| Strong | LQI 5.5–7 | `--tag-strong` red | "Strong" |
| Excessive | LQI > 7 or mean CF > 40 g | `--tag-excess` white with red ring | "Excessive" |

- While RF is on, the tag grows and changes color live.
- Special tags (placed with **T**): His (yellow-lime), Phrenic capture (green), and Custom (accent).
- Tag hover tooltip: `RF #4 · 30 W · 42 s · CF 14 g · ΔZ −11 Ω · LQI 5.1`.
- Colorblind mode also changes tag *shape*: Weak = ring, Good = sphere, Strong = sphere with black core dot, Excessive = sphere with X.

---

## 4. Interaction model

### 4.1 Viewport mouse
| Input | Action |
|---|---|
| Left-drag | Orbit (OrbitControls, damping 0.1) |
| Right-drag / Ctrl+left-drag | Pan |
| Wheel / pinch | Zoom (clamped 0.3×–4×) |
| Click point/tag | Select and show tooltip pinned |
| Double-click shell | Re-center orbit target on that surface point |
| Shift+click shell | Place point (if allowed) |
| Alt+drag | Rotate lighting (subtle; optional) |

### 4.2 Keyboard shortcuts
Shortcuts are global, except they are disabled while focus is in a text or number input, apart from Esc.

| Key | Action | Key | Action |
|---|---|---|---|
| Space | Acquire point | A | RF start/stop toggle |
| Esc | **Stop RF and stop pacing** (always), then close modal | P | Pace on/off |
| W / S | Deflect ABL tip + / − | Q / E | Rotate (torque) CCW / CW |
| R / F* | Advance / retract | Tab-cycle | Focus next control |
| 1 / 2 / 3 / 4 | Sweep 25/50/100/200 | C | Calipers |
| Shift+F | Freeze EGM | M | Mark EGM |
| T | Drop tag | Backspace | Delete last point |
| V | Cycle map type | O | Cycle shell opacity |
| Num 1/3/5/7 or Ctrl+1…6 | AP / LAO / RAO / PA / LL / RL presets | H | Hint |
| ? / F1 | Help overlay | [ / ] | Nudge caliper |
| Ctrl+Z | Undo last point/tag | `/` | Shortcut cheat sheet |

*Because Freeze lives on Shift+F, plain F means retract. Keep this consistent in the help overlay. Holding a steering key gives continuous motion: rate ramps from 2%/frame to 6%/frame after 400 ms.

### 4.3 Catheter steering widget (`.steer-pad`)
It acts on the *active catheter* chosen in the left panel.
- **Deflect:** a vertical slider (0–100%), with ▲/▼ buttons to its left. It shows the curve state (e.g. "D-curve 42%").
- **Rotate (torque):** ⟲/⟳ buttons and a circular dial showing the clockwise angle (−180…180°).
- **Advance/retract:** ⇡/⇣ buttons and a horizontal slider showing the insertion depth in mm.
- **Sheath** toggle (sandbox only).
- Every button supports press-and-hold. The pad shows a live **CF mini-gauge** and a contact LED (grey none / yellow light / green good / red excessive).
- Haptic hint: on touch devices with `navigator.vibrate`, a 10 ms buzz fires when contact is gained.

### 4.4 Touch
- One-finger drag orbits, two-finger pinch zooms, and two-finger drag pans. A long-press of 500 ms acts as point select.
- All tap targets are ≥ 40×40 px. On a `(pointer: coarse)` media query, controls grow to 44 px.
- Tablet layout (< 1280 px wide): the left and right panels become slide-over drawers toggled from the top bar (☰ left, ⚙ right). The EGM panel height drops to 200 px. The steer pad is docked bottom-right, always visible.
- The Space and A actions get floating buttons (`.fab--acquire`, `.fab--rf`) on touch devices.

---

## 5. Screens and modals

All modals use `.modal` with `role="dialog"`, `aria-modal="true"` and `aria-labelledby`. Focus is trapped inside, Esc closes (except the RF-active confirm) and focus returns to the trigger. The scrim uses `--c-overlay`. Size variants are `.modal--sm` 420 px, `.modal--md` 640 px and `.modal--lg` 960 px.

### 5.1 Home / Case library (`#screen-home`)
- Header: wordmark, tagline "3D electroanatomic mapping trainer", and buttons for Sandbox, Tutorial and Settings.
- Filter bar: chips for arrhythmia (AVNRT, AFL, AT, WPW/AP, AF-PVI, VT), difficulty, a "completed" filter and a search field.
- **Case cards** (`.case-card`), 4-column responsive grid with min width 260 px. Each card has:
  - Schematic thumbnail (an SVG of the chamber) and title.
  - `.badge--difficulty` with data-level `1|2|3`. Labels are "Beginner" (ok color), "Intermediate" (warn) and "Advanced" (danger). Each label also has 1–3 pip icons so color isn't the only cue.
  - Chamber tag (RA / LA / RV / LV).
  - Estimated time ("~15 min").
  - Best score and a completion check.
- Card states: rest / hover (raised and accent border) / focus (ring) / locked (dim, 🔒 icon, with "Complete *X* first" on hover).

### 5.2 Case briefing (`.modal--lg #modal-briefing`)
Two columns:
- **Left:** a patient vignette (age, sex, symptoms, history, meds), an indication, and a **12-lead ECG description** in a structured list (rhythm, rate, axis, P-wave morphology, QRS, notable findings). An optional static SVG strip gives a schematic 12-lead.
- **Right:** learning objectives (3–5 bullets), the catheters to be deployed, the scoring rubric preview and a time target.
- Footer: [Back] and [Begin case →] (primary).

### 5.3 Quiz modal (`.modal--md #modal-quiz`)
It triggers at workflow checkpoints, for example "Based on this map, where is the earliest activation?"
- Types: single choice (radio cards), multiple choice, **click-on-map** (the modal minimizes into a banner while the user clicks the 3D shell, and the target zone is scored by geodesic distance) and **caliper-measure** (enter a value in ms).
- After submitting, the correct answer is highlighted with ok color and ✔. A wrong answer gets danger color and ✖ plus an explanation paragraph. Then the user clicks [Continue].
- Points are shown, e.g. "+50".

### 5.4 End-of-case debrief (`#screen-debrief`)
A full screen with:
- A total score dial (0–1000) and a grade label (Expert ≥ 900 / Proficient ≥ 750 / Developing ≥ 550 / Needs review).
- **Score breakdown table** (`.score-table`), where each category shows earned/max and a bar:
  - Diagnosis/quiz
  - Mapping quality (point density, fill, WOI choice)
  - Ablation efficacy (target hit, LQI)
  - Safety (penalties itemized: AV block, steam pop, excessive CF, phrenic)
  - Efficiency (time, RF time, number of lesions)
- **Timeline**, a horizontal strip of events: points, RF bursts and alerts, as icons over time.
- **Replay snapshot:** a static render of the final map with lesion tags, plus a "compare with expert map" toggle.
- Actions: [Retry case], [Next case], [Export summary (JSON/print)] and [Home].

### 5.5 Help / tutorial overlay (`.coach`)
- **Coach-marks:** a dimmed scrim with a spotlight cutout (CSS `box-shadow: 0 0 0 9999px var(--c-overlay)` on a positioned ring) plus a callout card with Next/Back/Skip and "3 / 9".
- Tutorial sequence: viewport orbit → presets → catheter select → steering → acquire point → colorbar/WOI → EGM sweep/calipers → stimulator → RF.
- **F1 / ?** opens the static help modal, with tabs for Shortcuts, Map colors and Glossary.

### 5.6 Sandbox mode
- Banner chip "SANDBOX" in `--c-info` in the top bar. There is no score or timer, only elapsed time.
- The left panel workflow is replaced by **Scenario controls**:
  - Rhythm select (sinus, AVNRT, typical AFL, focal AT, orthodromic AVRT).
  - Chamber/anatomy select.
  - Toggles for "show truth activation" overlay, "allow surface-click", and complication injection buttons (force impedance rise, trigger phrenic capture).
- Everything is unlocked, including Temperature mode and sheath.

---

## 6. Feedback design

### 6.1 Alert levels
| Level | Component | Behavior |
|---|---|---|
| Critical | `.alert-banner--critical` across top of viewport plus a red border flash on the viewport and a 2-tone audio | Persistent until acknowledged. Auto-actions run (see below). |
| Warning | `.alert-banner--warning` | Persistent while the condition is true. Dismissable. |
| Success | `.toast--success` bottom-center of viewport | Disappears after 3 s. |
| Info | `.toast--info` | Disappears after 4 s. |

Toasts stack upward with a maximum of 3. The toast region uses `role="status"` with `aria-live="polite"`. Critical banners use `role="alert"` with `aria-live="assertive"`.

### 6.2 Safety alerts (content plus auto-behavior)
- **AV block (critical):** "⚠ AV BLOCK: PR prolongation / dropped beats during RF near His. RF stopped." RF stops automatically. The His tag pulses and the EGM row flashes. Early warning (warning level) fires when junctional rhythm with VA block appears or when RF is applied within 5 mm of the His tag: "Junctional rhythm with VA block: stop RF now".
- **Impedance rise (warning → critical):** a rise of +10 Ω above the minimum is a warning: "Impedance rising (+10 Ω): risk of coagulum". A rise of +20 Ω is critical and RF stops automatically.
- **Steam pop (critical):** an audible "pop" plays, the viewport shakes for 300 ms (skipped under reduced motion), and the message reads "STEAM POP: tissue overheating. Check pericardial effusion." It costs a safety penalty, and an "effusion check" quiz may follow.
- **Phrenic capture (warning):** during high-output pacing from the SVC/RA lateral wall, the message reads "Phrenic nerve capture at this site: avoid ablation here. [Tag site]".
- **Excessive contact (warning):** CF > 40 g for more than 2 s gives "Excessive contact force (48 g): perforation risk".
- **Low contact (info):** if RF is started with CF < 5 g: "Low contact: lesion likely ineffective".

### 6.3 Success feedback
- Examples: "Point accepted (#58)" (silent tick, no toast after the first 3 points to avoid spam), "Map fill 92%: good coverage", "Tachycardia terminated during RF at 6.2 s ✔", "Bidirectional block confirmed".
- Score deltas float up from the top-bar score.

### 6.4 Hints
- Three hints per case by default. Each used hint costs 20 points, disclosed on the button tooltip. Hints are tiered per step:
  1. Nudge: "Consider where the CS activation sequence is earliest."
  2. Directed: "Map the septal region between CS os and the His."
  3. Reveal: a ghost target region pulses on the shell.
- UI: a `.hint-card` slides in from the right panel bottom with a "Show more specific hint (−20)" button.
- Idle detection: after 90 s with no progress, the hint button pulses gently once.

---

## 7. Accessibility

### 7.1 Contrast
- Text on panels: `--c-text` 15.8:1 and `--c-text-muted` 7.4:1. Both meet WCAG AA, and AAA for primary text.
- Use `--c-text-faint` only for disabled text or text ≥ 18 px.
- Interactive borders need ≥ 3:1 against adjacent surfaces. `--c-border-strong` meets this on `--c-bg-panel`, so use it for inputs.
- Alert text always sits on the matching `*-bg` token with ≥ 4.5:1.

### 7.2 Colorblind-safe palette toggle
Settings → "Map palette: Default / Colorblind-safe". It sets `data-palette="cb"` on `<html>`, which overrides the tokens:
```css
[data-palette="cb"] {
  /* LAT: perceptually-uniform, CVD-safe (viridis-like reversed: early=bright yellow → late=dark purple) */
  --lat-0:#fde725; --lat-1:#a0da39; --lat-2:#4ac16d; --lat-3:#1fa187;
  --lat-4:#277f8e; --lat-5:#365c8d; --lat-6:#46327e;
  --volt-scar:#fde725; --volt-low-1:#4ac16d; --volt-low-2:#1fa187; --volt-low-3:#365c8d; --volt-normal:#46327e;
  --tag-weak:#f0e442; --tag-good:#e69f00; --tag-strong:#d55e00; --tag-excess:#ffffff;
  --c-ok:#009e73; --c-danger:#d55e00; --c-warn:#e69f00;
}
```
- Legend end labels ("Early"/"Late", "Scar"/"Normal") stay in place, so meaning never depends on hue.
- An optional **isochrone lines** toggle draws contour lines every 10 ms, which helps everyone.
- Tags change shape (§3.6).

### 7.3 Focus and keyboard
- `:focus-visible { outline: 2px solid var(--c-focus-ring); outline-offset: 2px; }`. Never remove it.
- Logical tab order: top bar → left panel → viewport toolbar → viewport (canvas is focusable, `tabindex="0"`) → steer pad → right panel → EGM toolbar.
- When the viewport has focus, arrow keys orbit by 5° steps and +/− zoom.
- A skip link "Skip to 3D map" appears first in the DOM.

### 7.4 ARIA and semantics
- Panels use `<aside>` with labels. The top bar is `<header>`. The workflow list is `<ol>` with `aria-current="step"` on the current step.
- Segmented controls are `role="radiogroup"` with `role="radio"` children and `aria-checked`.
- Toggle buttons use `aria-pressed` (PACE, RF, Calipers, layers).
- Numeric steppers are `<input type="number">` plus inc/dec buttons with `aria-label="Increase S1 cycle length"`.
- Sliders are native `<input type="range">` with `aria-valuetext="Deflection 42 percent"`.
- Live readouts: the generator readout container uses `aria-live="off"`, which avoids spamming screen readers. A visually hidden `role="status"` region announces only threshold crossings, e.g. "Impedance dropped 10 ohms".
- Canvas alternatives: the viewport has `aria-describedby` pointing to a hidden summary that updates every 5 s, e.g. "LAT map, 142 points, earliest −78 ms at posterior septum". The EGM has a "Measurements" text list of caliper values.
- Respect `prefers-reduced-motion`, which disables shake, pulse and tween. Audio is muted by default and enabled in Settings, and every audio cue has a visual twin.

---

## 8. Component inventory

BEM naming. State modifiers are `.is-*` classes plus ARIA attributes. JS only toggles classes and attributes and never sets inline colors, except on canvas and WebGL.

| Component | Class(es) | Elements | States / modifiers |
|---|---|---|---|
| App shell | `.app-shell` | — | `.is-tablet`, `.is-left-open`, `.is-right-open`, `[data-mode="case|sandbox"]` |
| Top bar | `.top-bar` | `__logo`, `__case`, `__timer`, `__score`, `__actions` | timer `.is-overtime`; score `.is-up`, `.is-down` (300 ms) |
| Step progress | `.step-progress` | `__pip` | pip `.is-done`, `.is-current`, `.is-pending`, `.is-failed` |
| Panel | `.panel` | `--left`, `--right`; `.panel-section`, `__header`, `__body` | section `.is-collapsed` |
| Workflow step | `.workflow-step` | `__index`, `__title`, `__tasks`, `__task` | `.is-done`, `.is-current`, `.is-locked`; task `.is-complete` |
| Catheter row | `.cath-row` | `__radio`, `__swatch`, `__name`, `__eye` | `.is-active`, `.is-hidden`, `.is-in-contact` |
| Map list item | `.map-item` | `__name`, `__type`, `__menu` | `.is-shown`, `.is-editing` |
| Button | `.btn` | `--primary`, `--secondary`, `--ghost`, `--danger`, `--icon`, `--lg` | `:hover`, `:active`, `:focus-visible`, `:disabled`, `.is-loading` |
| RF button | `.btn-rf` | `__label`, `__timer` | `.is-ready`, `.is-active` (pulse), `.is-blocked` with `__reason` |
| Pace button | `.btn-pace` | — | `[aria-pressed="true"]` with glow `--c-pace` |
| Segmented control | `.segmented` | `__option` | `[aria-checked="true"]`, `:disabled` |
| Stepper | `.stepper` | `__input`, `__dec`, `__inc`, `__unit` | `.is-invalid`, `:disabled` |
| Select | `.select` | native `<select>` styled | `:focus-visible`, `:disabled` |
| Toggle chip | `.chip` | `--toggle`, `--status`, `--sandbox` | `[aria-pressed]`, `.is-warn`, `.is-danger` |
| Readout tile | `.readout` | `__label`, `__value`, `__unit`, `__delta`, `__bar` | `.is-ok`, `.is-warn`, `.is-danger`, `.is-stale` (no data, shows "--") |
| Force bar | `.force-bar` | `__seg` ×4 | `[data-band="low|fair|good|excess"]` |
| Progress ring | `.ring` | SVG `__track`, `__fill` | `--rf` color variant |
| Viewport | `.viewport` | `__canvas`, `__toolbar`, `__status`, `__actions` | `.is-shaking`, `.is-critical` (red inset border), `.is-placing` (crosshair cursor) |
| Orientation cube | `.orient-cube` | canvas + `.view-presets__btn` | preset `.is-current` |
| Color bar | `.colorbar` | `__title`, `__gradient`, `__ticks`, `__caret`, `__labels` | `[data-map="lat|voltage"]` |
| Map popover | `.popover` | `--map`; `__row` | `.is-open` |
| Point tooltip | `.tip3d` | `__line` | `.is-pinned` |
| Steer pad | `.steer-pad` | `__deflect`, `__rotate`, `__advance`, `__contact-led`, `__grip` | `.is-collapsed`, `.is-dragging`; LED `[data-contact="none|light|good|excess"]` |
| EGM panel | `.egm` | `__toolbar`, `__canvas`, `__gutter`, `__measure-list` | `.is-frozen`, `.is-calipers` |
| Caliper (canvas-drawn + DOM label) | `.caliper-label` | — | `.is-selected` |
| Alert banner | `.alert-banner` | `--critical`, `--warning`; `__icon`, `__text`, `__ack` | `.is-entering`, `.is-acked` |
| Toast | `.toast` | `--success`, `--info`, `--warn`; `__icon`, `__text` | `.is-leaving` |
| Hint card | `.hint-card` | `__tier`, `__text`, `__more` | `.is-open`; button `.btn-hint.is-nudge` (idle pulse) |
| Modal | `.modal` | `--sm`, `--md`, `--lg`; `__scrim`, `__dialog`, `__header`, `__body`, `__footer` | `.is-open` |
| Quiz option | `.quiz-option` | `__marker`, `__text` | `.is-selected`, `.is-correct`, `.is-wrong`, `:disabled` |
| Case card | `.case-card` | `__thumb`, `__title`, `__meta`, `__best` | `:hover`, `:focus-visible`, `.is-locked`, `.is-completed` |
| Difficulty badge | `.badge` | `--difficulty` `[data-level="1|2|3"]` | — |
| Score table | `.score-table` | `__row`, `__bar`, `__penalty` | row `.is-perfect`, `.is-penalty` |
| Coach mark | `.coach` | `__spot`, `__card`, `__step`, `__nav` | `.is-active` |
| FAB (touch) | `.fab` | `--acquire`, `--rf` | `.is-active` |

### 8.1 Base component CSS snippets
```css
.btn{font:var(--fw-medium) var(--fs-base)/1 var(--font-ui);padding:var(--sp-2) var(--sp-3);
  min-height:32px;border-radius:var(--radius-md);border:1px solid var(--c-border-strong);
  background:var(--c-bg-raised);color:var(--c-text);cursor:pointer;
  transition:background var(--dur-fast) var(--ease),border-color var(--dur-fast);}
.btn:hover{background:var(--c-bg-hover)} .btn:active{background:var(--c-bg-pressed)}
.btn:disabled{opacity:.45;cursor:not-allowed}
.btn--primary{background:var(--c-accent);border-color:var(--c-accent);color:var(--c-text-inverse)}
.btn--primary:hover{background:var(--c-accent-hover)}
.btn-rf{min-height:56px;width:100%;font-size:var(--fs-lg);font-weight:var(--fw-bold)}
.btn-rf.is-ready{border:2px solid var(--c-rf-ready);color:var(--c-rf-ready);background:var(--c-ok-bg)}
.btn-rf.is-active{background:var(--c-rf-on);color:var(--c-text-inverse);animation:rfPulse 1s infinite}
@keyframes rfPulse{50%{box-shadow:0 0 0 6px rgba(255,122,26,.25)}}
.readout__value{font:var(--fw-bold) var(--fs-2xl)/1 var(--font-mono);font-variant-numeric:tabular-nums}
.readout.is-warn .readout__value{color:var(--c-warn)} .readout.is-danger .readout__value{color:var(--c-danger)}
.panel-section__header{font-size:var(--fs-sm);font-weight:var(--fw-bold);text-transform:uppercase;
  letter-spacing:.06em;color:var(--c-text-muted);padding:var(--sp-2) var(--sp-3);background:var(--c-bg-panel-alt)}
.viewport.is-critical{box-shadow:inset 0 0 0 3px var(--c-danger)}
@media (pointer:coarse){.btn,.segmented__option,.stepper button{min-height:44px;min-width:44px}}
```

### 8.2 Z-index scale
`--z-viewport-ui: 10; --z-steer: 20; --z-popover: 30; --z-drawer: 40; --z-banner: 50; --z-toast: 60; --z-modal: 70; --z-coach: 80;`

---

## 9. Implementation checklist for the programmer
1. Build `tokens.css`, then `components.css`, then `layout.css`, in that order. Do not hard-code hex values outside `tokens.css`. Shaders read LAT and voltage colors by calling `getComputedStyle(document.documentElement)` and update when the palette toggles.
2. Drive the EGM from `requestAnimationFrame` with a fixed 500 Hz sample buffer. Pixels per ms = sweep (mm/s) × 3.78 px/mm ÷ 1000 at 96 dpi.
3. Route all shortcuts through one `keymap.js` table so the Help overlay renders from the same data.
4. Route all alerts through `notify({level, id, text, autoAction})`, deduplicated by `id`.
5. Test at 1280×720, 1920×1080 and an iPad landscape 1024×768, with both palettes and with reduced motion on.
