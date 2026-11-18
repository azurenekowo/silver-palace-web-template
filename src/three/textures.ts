import * as THREE from "three";

function makeCanvas(w: number, h: number) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext("2d")! };
}

const hash2 = (x: number, y: number, seed = 0) => {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return s - Math.floor(s);
};

const quintic = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Periodic value noise so tileable textures have zero visible seams */
function periodicNoise(u: number, v: number, period: number, seed = 0): number {
  const x = u * period;
  const y = v * period;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = quintic(x - xi);
  const yf = quintic(y - yi);

  const x0 = ((xi % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y0 = ((yi % period) + period) % period;
  const y1 = (y0 + 1) % period;

  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);

  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}

function fbmPeriodic(
  u: number,
  v: number,
  basePeriod: number,
  octaves: number,
  seed = 0,
): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let freq = basePeriod;
  for (let o = 0; o < octaves; o++) {
    sum += periodicNoise(u, v, freq, seed + o * 13) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/**
 * Stand-in for the site's 2560x1440 background illustrations.
 * Includes crisp architectural silhouettes & fine contour lines so the
 * shader's `fwidth(luma)` ink-sketch edge pass actually lights up.
 */
export function makeGradientTexture(
  stops: string[],
  accent: string,
  seed = 1,
): THREE.Texture {
  const w = 1280;
  const h = 720;
  const { canvas, ctx } = makeCanvas(w, h);

  const grad = ctx.createLinearGradient(0, 0, w * 0.35, h);
  stops.forEach((c, i) =>
    grad.addColorStop(i / Math.max(1, stops.length - 1), c),
  );
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Atmospheric glow behind focal point
  const focalX = w * (0.45 + (hash2(seed, 1) - 0.5) * 0.25);
  const focalY = h * 0.42;
  const halo = ctx.createRadialGradient(
    focalX,
    focalY,
    10,
    focalX,
    focalY,
    h * 0.65,
  );
  halo.addColorStop(0, accent);
  halo.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 1;

  // Crisp architectural spires & skyline silhouettes (high contrast for fwidth)
  ctx.fillStyle = "rgba(8, 10, 18, 0.88)";
  ctx.strokeStyle = "rgba(235, 242, 255, 0.35)";
  ctx.lineWidth = 1.5;
  const towers = 14;
  for (let i = 0; i < towers; i++) {
    const tx = (i / towers) * w + (hash2(i, seed) - 0.5) * 40;
    const tw = 38 + hash2(i + 3, seed) * 75;
    const th = h * (0.22 + hash2(i + 7, seed) * 0.46);
    const ty = h - th;

    ctx.beginPath();
    ctx.moveTo(tx, h);
    ctx.lineTo(tx, ty + 28);
    ctx.lineTo(tx + tw * 0.5, ty); // pointed Victorian gable/spire
    ctx.lineTo(tx + tw, ty + 28);
    ctx.lineTo(tx + tw, h);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // Fine topographic / stained-glass arc lines for silver ink-edge shimmer
  ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
  ctx.lineWidth = 1.25;
  for (let r = 90; r <= 540; r += 75) {
    ctx.beginPath();
    ctx.arc(focalX, focalY, r, -Math.PI * 0.85, Math.PI * 0.15);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** Tileable multi-octave value noise (`tex_noise` stand-in) */
export function makeNoiseTexture(size = 256): THREE.Texture {
  const { canvas, ctx } = makeCanvas(size, size);
  const img = ctx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const n = fbmPeriodic(u, v, 6, 4, 17);
      // Remap slightly for crisper contrast
      const c = Math.max(0, Math.min(255, Math.floor(n * 255)));
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = c;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

/**
 * Domain-warped liquid-ink normal map (`mud_normal` stand-in).
 * Produces organic swirling ink tendrils instead of bilinear squares.
 */
export function makeMudNormalTexture(size = 256): THREE.Texture {
  const { canvas, ctx } = makeCanvas(size, size);
  const img = ctx.createImageData(size, size);
  const heights = new Float32Array(size * size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      // Domain warp for liquid ink swirls
      const warpX = fbmPeriodic(u, v, 4, 3, 31) - 0.5;
      const warpY = fbmPeriodic(u, v, 4, 3, 59) - 0.5;
      const h = fbmPeriodic(u + warpX * 0.28, v + warpY * 0.28, 6, 4, 83);
      heights[y * size + x] = h;
    }
  }

  const strength = 3.2;
  for (let y = 0; y < size; y++) {
    const ym = (y - 1 + size) % size;
    const yp = (y + 1) % size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size;
      const xp = (x + 1) % size;

      const hL = heights[y * size + xm];
      const hR = heights[y * size + xp];
      const hD = heights[ym * size + x];
      const hU = heights[yp * size + x];

      const nx = (hL - hR) * strength;
      const ny = (hD - hU) * strength;
      const nz = 1.0;
      const len = Math.hypot(nx, ny, nz);

      const i = (y * size + x) * 4;
      img.data[i] = Math.floor(((nx / len) * 0.5 + 0.5) * 255);
      img.data[i + 1] = Math.floor(((ny / len) * 0.5 + 0.5) * 255);
      img.data[i + 2] = Math.floor(((nz / len) * 0.5 + 0.5) * 255);
      img.data[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}
