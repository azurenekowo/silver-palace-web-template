# threejs-canvas-web

Vue 3 + TypeScript + Vite template with a WebGL shader background: full-screen artworks cross-fade through an organic "ink wipe" instead of a plain fade. This document explains how the effect works.

## Demo
### https://silver-palace-web-template.pages.dev/

https://github.com/user-attachments/assets/752ab7ea-945d-4b35-9295-bcee6d657bae

## Getting started

```bash
npm install     # or bun install
npm run dev     # start Vite dev server
npm run build   # vue-tsc -b && vite build
npm run preview # serve the production build
```

Replace the artworks in `public/` (`h_bg1.jpg` … `h_bg3.jpg`) with your own; the loader in `src/three/ShaderBackground.ts` reads their natural size after load.

## How the effect works

### Architecture

- `src/components/ShaderBackground.vue` — fixed, full-viewport `<canvas>` (z-index 0). Owns one `ShaderBackground` instance; forwards pointer position with `setMouse()`, disposes on unmount.
- `src/three/ShaderBackground.ts` — the engine class. Creates a `THREE.WebGLRenderer` on the canvas and renders a single full-screen quad (`PlaneGeometry(2, 2)`) with an orthographic camera, so the whole screen is one fragment-shader invocation.
- `src/three/textures.ts` — procedural texture generators (periodic fBm value noise, a domain-warped "mud" normal map, and stand-in artwork) used by the shader.
- `src/App.vue` — section state machine. Listens to `wheel`/`keydown`, drives transitions, and renders the nav dots.

### The transition model

The engine holds a list of section backgrounds (`SectionBackground` = texture + cover-fit metadata + a 3D fade anchor point). A transition between the current and next section is a single scalar, `uProgress` (0 → 1), with two drive modes:

- **wheel mode** — progress is tied to scroll input. `App.vue` accumulates wheel deltas; once past a 45px threshold it starts a transition. While it runs, each wheel event adds to `wheelVelocity` (clamped, decaying by 0.89/frame), and the wipe advances or retreats with the user's hand. If progress drops back near 0 the transition cancels; near 1 it commits.
- **time mode** — progress advances on a fixed clock (`timeRate = 0.45`, ~2.2s). Used for keyboard and dot navigation.

Both must pass debounce guards (`enterGuardMs` / `triggerGuardMs`) so a finished transition cannot instantly re-trigger. `startTransition()` uploads the *next* section's uniforms (texture, size, fit, direction); on commit, that texture becomes the *current* one. The direction (`uDirection`, ±1) flips the wipe axis so scrolling down wipes up and scrolling down-from-bottom wipes down.

### The shader (the visual meat)

Everything happens in one fragment shader over the full-screen quad. Per pixel:

1. **Direction field** — a progress axis built from screen UV. Mostly vertical (bottom-up for forward transitions), but blended 50% toward horizontal near the left/right edges so the wipe line bows outward instead of staying flat.

2. **Mask center** — each section defines a 3D `fadeCenter` point. A hidden `PerspectiveCamera` orbits that point every frame (following a slow Lissajous drift plus the mouse), and its projection-view matrix is uploaded as `uProjectionView`. The shader projects the anchor point to screen space to get the spatial center of the wipe. This is why the reveal appears anchored to the artwork's focal point. A small mouse tug (`uMouse`, lerped 0.08/frame) is blended in, and a `uIsCircle` mode swaps the axis for a radial distance field around that center.

3. **Paradox zoom** — both images are sampled with counter-scaling UVs: the outgoing image scales 1.0 → 1.3 while the incoming scales 1.3 → 1.0 (both centered on the mask center). The two images appear to zoom through each other during the wipe. A `coverUv()` helper handles "cover" fit (the same math as `object-fit: cover`) using each texture's natural size, with a per-section top/bottom crop anchor.

4. **Noise threshold** — the heart of the organic edge. Instead of cutting where `axis == progress`, the cut line is deformed by stacking several displacements:
   - a traveling sine wave (`rhythmWave`) that slows and swells the line as it crosses the screen,
   - samples from tileable fBm noise at three frequencies (large blooms, mid ripples, tiny islands), scrolling slowly with time,
   - a vortex-like offset from the `mud_normal` texture (its red channel displaces the threshold, its RG channels warp the noise sampling → swirling ink tendrils),
   - a `contentWarp` term: the luminance difference between the current and incoming pixel nudges the line, so the wipe lingers where image content changes.

   Combined into a `threshold` value per pixel: the pixel switches to the incoming image when `progress` crosses its personal threshold.

5. **Crisp binary cut** — `front = mix(-0.02, 1.02, uProgress)`; the edge is resolved with one `smoothstep` whose width is a single `fwidth()` (screen-space derivative), giving a razor-sharp line with exactly ~1px of anti-aliasing regardless of zoom or resolution.

6. **Ink-sketch fringe** — near the cut line, `fwidth(luma)` (per-pixel luminance change) is amplified into white "sketch lines" mimicking hand-drawn ink hatching. Two bands: a bright band on the outgoing side just above the waterline (which also blends 32% of the incoming image through, like paper showing through wet ink), and a fainter ghost band just below it on the incoming side. Both are gated by `transitionActive` so they only exist while a wipe is in progress.

7. **White crest highlight** — a paper-cut ridge of near-white (`~0.95,0.97,1.0`) additive light exactly on the upper-facing lip of the cut, modulated by the same rhythm wave so the crest sparkles unevenly along the line. Clamped to 1.0.

The result per frame: every pixel is either the current image (zooming out), the incoming image (zooming in), or within a ~1px band of an organically warped boundary carrying the sketch fringe and crest highlight.

### Runtime loop

The class runs its own rAF loop at a ~60fps gate, with time, mouse, and progress uniforms updated each frame and `onProgress` notified so `App.vue` can keep its section state in sync (including reverting if a wheel transition is scrubbed back below its start). Geometry, material, and renderer are disposed on unmount; the resize handler keeps the aspect uniforms in step with the viewport.

### Supporting components

- `HelloWorld.vue` — template demo component (unused by the effect).
- `ParallaxLayer.vue` — optional decorative drift: translates its slot along a slow Lissajous sway blended with the pointer position, suitable for hero art above the canvas.
