// Microbes — renderer interface.
//
// JSDoc-only typedef shared by Canvas2DRenderer and PixiRenderer. The
// frame loop in `app.js` calls only methods declared here, so swapping
// renderers is a single line in app.js.

/**
 * @typedef {Object} Cell
 *   The mutable per-cell state owned by Sim. Renderers read these fields
 *   and must not write them.
 *
 * @property {number} id
 * @property {number} x       world-space coords
 * @property {number} y
 * @property {number} r
 * @property {number} vx
 * @property {number} vy
 * @property {string} type    key into CELL_TYPES
 * @property {'NORMAL'|'SPLITTING'} state
 * @property {number} splitProgress 0..1 while SPLITTING
 * @property {number} splitAngle    radians
 * @property {number} bondTimer
 * @property {number} phase
 * @property {number} orientation
 * @property {number} wobbleSeed
 * @property {number} wobbleFreq
 * @property {number} flash         0..1 fading after a tap
 * @property {{x:number,y:number}|null} target
 * @property {number} alarmTimer
 * @property {Cell|null} alarmTarget
 * @property {'good'|'bad'} category
 * @property {number} nextBlink     ms-stamp for the next eye-blink
 * @property {Object} _colors       cached ref to CELL_TYPES[type].colors
 */

/**
 * @typedef {Object} Shape
 *   A renderable disk derived from a Cell. A NORMAL cell maps to one
 *   Shape; a SPLITTING cell maps to two.
 * @property {number} x
 * @property {number} y
 * @property {number} r
 * @property {Cell} cell        back-pointer for renderer-side state lookup
 */

/**
 * @typedef {Object} Camera
 * @property {number} scale
 * @property {number} tx
 * @property {number} ty
 */

/**
 * @typedef {Object} TargetMarker
 * @property {number} x
 * @property {number} y
 * @property {number} t0
 */

/**
 * @typedef {Object} IRenderer
 *   Common interface for all renderer backends. Each frame the app
 *   calls beginFrame → drawBackground → drawCells → drawSelection →
 *   (drawDebug) → endFrame. The Sim instance is passed to the
 *   constructor; the renderer reads sim.cells / sim.selectedCells /
 *   sim.targetMarker / sim.camera. The renderer must NOT mutate sim
 *   state except `sim.targetMarker = null` when the marker has aged
 *   out (a small concession to keeping the lifetime fade fully
 *   renderer-side).
 *
 * @property {() => void} init
 *   One-time setup. Construct programs / FBOs / static buffers here.
 *
 * @property {(W:number, H:number, dpr:number, renderScale:number) => void} resize
 *   Called whenever the window resizes or S.renderScale changes.
 *   The renderer must reconfigure its canvas backing-store, FBO sizes,
 *   and any size-dependent uniforms.
 *
 * @property {(timeMs:number, dt:number) => void} beginFrame
 *   Begin a frame. Canvas2D treats this as a no-op; WebGL2 binds the
 *   default framebuffer and clears.
 *
 * @property {(timeMs:number) => void} drawBackground
 *   Paint the full background under the camera transform — fill +
 *   spots + decor + vignette as configured by the active background.
 *
 * @property {(shapes:Shape[], time:number, timeMs:number) => void} drawCells
 *   Paint every cell: metaball mask, outline, cytoplasm, inner
 *   highlight, granules, decorations, membrane, nucleus, cartoon
 *   faces. The renderer is free to fold these into fewer passes.
 *
 * @property {(shapes:Shape[], time:number) => void} drawSelection
 *   Paint the selection ring + target-marker dashed lines + flash
 *   overlay. Renderer is allowed to clear `sim.targetMarker` once it
 *   has fully faded.
 *
 * @property {(shapes:Shape[]) => void} drawDebug
 *   Optional debug overlay (cell-radius circles + count/zoom text).
 *   Called only when S.showDebugField is true.
 *
 * @property {() => void} endFrame
 *   Flush / present. No-op for Canvas2D; for WebGL2, blit back-buffer.
 *
 * @property {() => void} destroy
 *   Release GPU resources. Called when swapping renderers at runtime.
 */

// ---------- Shared base ----------
// Trivially small; mostly a place to hang shared camera-transform
// helpers if both renderers turn out to want them.

export class RendererBase {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('../core/sim.js').Sim} sim
   */
  constructor(canvas, sim) {
    this.canvas = canvas;
    this.sim = sim;
    this.W = 0;
    this.H = 0;
    this.dpr = 1;
    this.renderScale = 1;
  }

  /** @returns {Camera} */
  get camera() { return this.sim.camera; }

  // Default no-ops; subclasses override what they need.
  init() {}
  beginFrame(/* timeMs, dt */) {}
  endFrame() {}
  drawDebug(/* shapes */) {}
  /** Optional: draw free-floating particles released by Sim.killCell(). */
  drawParticles(/* particles, time, timeMs */) {}
  destroy() {}
}
