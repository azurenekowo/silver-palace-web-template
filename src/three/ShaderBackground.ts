import * as THREE from "three";
import { makeNoiseTexture } from "./textures";

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform sampler2D tCurrent;
uniform sampler2D tNext;
uniform sampler2D tMudNormal;
uniform sampler2D tNoise;

uniform float uProgress;
uniform float uAspect;
uniform float uTime;
uniform vec2  uResolution;
uniform vec2  uMouse;
uniform vec2  uCurrentImageSize;
uniform vec2  uNextImageSize;
uniform float uCurrentFitTop;
uniform float uNextFitTop;
uniform float uDirection;
uniform float uIsCircle;
uniform float uIsFallback;
uniform float uCurrentEdgeMul;
uniform float uNextEdgeMul;
uniform mat4  uProjectionView;
uniform vec3  uFadeCenterPoint;
uniform float uDarken;

vec2 scaleUv(vec2 uv, float scale, vec2 center) {
  return center + (uv - center) / scale;
}

vec2 coverUv(vec2 uv, vec2 imageSize, float fitTop) {
  float screenAspect = uResolution.x / uResolution.y;
  float imageAspect = imageSize.x / imageSize.y;
  vec2 ratio = vec2(
    min(screenAspect / imageAspect, 1.0),
    min(imageAspect / screenAspect, 1.0)
  );
  float anchorY = fitTop > 0.5 ? 1.0 : 0.5;
  return vec2(
    uv.x * ratio.x + (1.0 - ratio.x) * 0.5,
    uv.y * ratio.y + (1.0 - ratio.y) * anchorY
  );
}

float getLuma(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

void main() {
  vec2 uv = vUv;

  // 1. Direction field (rises from bottom when uDirection > 0)
  float verticalAxis    = uDirection > 0.0 ? uv.y : (1.0 - uv.y);
  float directionalAxis = uDirection > 0.0 ? uv.x : (1.0 - uv.x);
  float axis = mix(
    verticalAxis,
    directionalAxis,
    smoothstep(0.6, -0.4, abs(uv.x - 0.5)) * 0.5
  );

  // 2. Spatial mask center
  vec4 clipPos = uProjectionView * vec4(uFadeCenterPoint, 1.0);
  vec2 sceneCenter = (clipPos.xy / max(clipPos.w, 0.0001)) * 0.5 + 0.5;
  vec2 fallbackCenter = uDirection > 0.0 ? vec2(0.5, 0.65) : vec2(0.5, 0.35);
  vec2 spatialCenter = mix(fallbackCenter, sceneCenter, 1.0 - uIsFallback);
  vec2 maskCenter = mix(spatialCenter, uMouse, 0.1);

  float radial = length((uv - maskCenter) * vec2(uAspect, 1.0)) * 0.85;
  float circleAxis = uDirection > 0.0 ? radial : (1.0 - radial);
  axis = mix(axis, circleAxis, uIsCircle);

  // 3. Paradox-zoom UVs & clean artwork samples
  vec2 zoomCenter = mix(vec2(0.5), maskCenter, uIsCircle);
  vec2 currentBaseUv = coverUv(scaleUv(uv, mix(1.0, 1.3, uProgress), zoomCenter), uCurrentImageSize, uCurrentFitTop);
  vec2 nextBaseUv    = coverUv(scaleUv(uv, mix(1.3, 1.0, uProgress), zoomCenter), uNextImageSize,    uNextFitTop);

  vec4 current = texture2D(tCurrent, currentBaseUv);
  vec4 next    = texture2D(tNext,    nextBaseUv);

  float curLuma = getLuma(current.rgb);
  float nxtLuma = getLuma(next.rgb);


  // 4. Medium-tempo wave curve + mud_normal.jpg + noise threshold
  vec2 mudUv = vec2(uv.x * (uAspect / 1.777), uv.y) * 1.45;
  vec3 mudTex = texture2D(tMudNormal, mudUv).rgb;
  vec2 mudVec = (mudTex.rg - 0.5) * 2.0;

  float rhythmWave = sin(uv.x * 9.5 - uTime * 1.1) * 0.5 + 0.5;
  float waveCurve  = sin(uv.x * 9.5 - uTime * 1.1) * 0.036;
  float mudOffset  = (mudTex.r - 0.5) * mix(0.30, 0.50, rhythmWave);

  vec2 aspectUv = vec2(uv.x * uAspect, uv.y) + vec2(0.0, uTime * 0.008);
  float noise1 = texture2D(tNoise, aspectUv * 0.28 - uTime * 0.003).r * 2.0 - 1.0;
  float noise2 = texture2D(tNoise, aspectUv * 2.2 + mudVec * 0.24).r * 2.0 - 1.0;
  float islandNoise = texture2D(tNoise, aspectUv * 6.5 - vec2(0.0, uTime * 0.007)).r * 2.0 - 1.0;

  float contentWarp = (curLuma - nxtLuma) * 0.09;

  float threshold = (verticalAxis * 2.0 - 1.0) / 1.2
                  + waveCurve
                  + noise1 * 0.16
                  + noise2 * 0.075
                  + islandNoise * 0.042
                  + mudOffset
                  + contentWarp;
  threshold = clamp(threshold * 0.5 + 0.5, 0.0, 1.0);

  // 5. Crisp binary cut
  float front = mix(-0.02, 1.02, uProgress);
  float edge = front - threshold;
  float aa = max(fwidth(edge) * 0.85, 0.0008);
  float w = smoothstep(-aa, aa, edge);

  float transitionActive = smoothstep(0.01, 0.05, uProgress)
    * (1.0 - smoothstep(0.95, 0.995, uProgress));

  // 6. Crisp white ink-sketch wireframe above the cut
  float cleanSketch = fwidth(curLuma) * 4.2 * uCurrentEdgeMul;
  float nearAbove = (1.0 - smoothstep(0.0, 0.20, max(-edge, 0.0))) * step(edge, 0.0) * transitionActive;
  current.rgb = mix(current.rgb, next.rgb, nearAbove * 0.32);
  current.rgb += vec3(cleanSketch) * nearAbove * 0.85;

  // Faint ghosted sketch lines just under the waterline
  float nearBelow = (1.0 - smoothstep(0.0, 0.11, max(edge, 0.0))) * step(0.0, edge) * transitionActive;
  next.rgb += vec3(cleanSketch) * nearBelow * 0.42;

  if (uDarken > 0.001) {
    current.rgb = mix(current.rgb, vec3(0.02 * uDarken), uDarken);
  }

  // 7. Mix + 1px white highlight ONLY on the upper-facing crest
  vec4 outputColor = mix(current, next, w);

  float upperCrest = smoothstep(-0.0020, -0.0002, edge) * (1.0 - smoothstep(0.0, 0.0007, edge));
  float crestMod = mix(0.4, 1.0, rhythmWave);
  outputColor.rgb = min(
    outputColor.rgb + vec3(0.95, 0.97, 1.0) * upperCrest * crestMod * transitionActive * 0.8,
    vec3(1.0)
  );

  gl_FragColor = vec4(outputColor.rgb, 1.0);
}
`;

export type SectionBackground = {
  texture: THREE.Texture;
  size: THREE.Vector2;
  fitTop: boolean;
  edgeMul: number;
  fadeCenter: THREE.Vector3;
  isCircle?: boolean;
};

const textureLoader = new THREE.TextureLoader();

export function loadHeroSectionBackgrounds(): SectionBackground[] {
  const configs = [
    {
      url: "/h_bg1.jpg",
      fitTop: false,
      edgeMul: 1.0,
      fadeCenter: new THREE.Vector3(0, 0.2, 0),
    },
    {
      url: "/h_bg2.jpg",
      fitTop: false,
      edgeMul: 1.0,
      fadeCenter: new THREE.Vector3(0, -0.1, 0),
    },
    {
      url: "/h_bg3.jpg",
      fitTop: false,
      edgeMul: 1.0,
      fadeCenter: new THREE.Vector3(0.15, 0.1, 0),
    },
  ];

  return configs.map((cfg) => {
    const size = new THREE.Vector2(2560, 1440);
    const texture = textureLoader.load(cfg.url, (loaded) => {
      const img = loaded.image as HTMLImageElement | undefined;
      if (img?.naturalWidth && img?.naturalHeight) {
        size.set(img.naturalWidth, img.naturalHeight);
      }
    });
    // Keep NoColorSpace (default) so raw ShaderMaterial outputs exact 1:1 sRGB pixels
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;

    return {
      texture,
      size,
      fitTop: cfg.fitTop,
      edgeMul: cfg.edgeMul,
      fadeCenter: cfg.fadeCenter,
    };
  });
}

function loadMudNormal(): THREE.Texture {
  const tex = textureLoader.load("/mud_normal.jpg");
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

export class ShaderBackground {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  private material: THREE.ShaderMaterial;
  private mesh: THREE.Mesh;

  private raf = 0;
  private lastFrame = 0;
  private time = 0;
  private disposed = false;

  private anchorCam = new THREE.PerspectiveCamera(50, 1, 0.1, 100);

  private sections: SectionBackground[] = [];
  private currentSection = 0;
  private nextSection = 0;
  private progress = 1;
  private targetProgress = 1;
  private wheelVelocity = 0;
  private transitioning = false;

  private mouse = new THREE.Vector2(0.5, 0.5);
  private mouseTarget = new THREE.Vector2(0.5, 0.5);

  enterGuardMs = 100;
  triggerGuardMs = 150;
  private lastEnter = 0;
  private lastTrigger = 0;

  transitionMode: "wheel" | "time" = "wheel";
  timeRate = 0.45;
  onProgress?: (
    progress: number,
    direction: 1 | -1,
    fromIndex: number,
    toIndex: number,
  ) => void;

  constructor(canvas: HTMLCanvasElement, sections?: SectionBackground[]) {
    this.sections =
      sections && sections.length > 0 ? sections : loadHeroSectionBackgrounds();

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera.position.set(0, 0, 1.5);

    const first = this.sections[0];
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        tCurrent: { value: first.texture },
        tNext: { value: first.texture },
        tMudNormal: { value: loadMudNormal() },
        tNoise: { value: makeNoiseTexture() },
        uProgress: { value: 1 },
        uAspect: { value: 1 },
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uMouse: { value: this.mouse },
        uCurrentImageSize: { value: first.size },
        uNextImageSize: { value: first.size },
        uCurrentFitTop: { value: first.fitTop ? 1 : 0 },
        uNextFitTop: { value: first.fitTop ? 1 : 0 },
        uDirection: { value: 1 },
        uIsCircle: { value: first.isCircle ? 1 : 0 },
        uIsFallback: { value: 0 },
        uCurrentEdgeMul: { value: first.edgeMul },
        uNextEdgeMul: { value: first.edgeMul },
        uProjectionView: { value: new THREE.Matrix4() },
        uFadeCenterPoint: { value: first.fadeCenter.clone() },
        uDarken: { value: 0 },
      },
    });

    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.scene.add(this.mesh);

    this.resize();
    window.addEventListener("resize", this.resize);
    this.loop();
  }

  get currentSectionIndex() {
    return this.currentSection;
  }

  get isTransitioning() {
    return this.transitioning;
  }

  setMouse(x: number, y: number) {
    this.mouseTarget.set(x, y);
  }

  startTransition(
    index: number,
    direction: 1 | -1,
    opts?: { mode?: "wheel" | "time"; isCircle?: boolean },
  ): boolean {
    if (this.transitioning) return false;
    if (index === this.currentSection) return false;
    if (index < 0 || index >= this.sections.length) return false;

    const now = performance.now();
    if (now - this.lastEnter < this.enterGuardMs) return false;
    if (now - this.lastTrigger < this.triggerGuardMs) return false;

    this.lastTrigger = now;
    this.nextSection = index;
    this.progress = 0;
    this.targetProgress = opts?.mode === "time" ? 1 : 0;
    this.wheelVelocity = 0;
    this.transitionMode = opts?.mode ?? "wheel";
    this.transitioning = true;

    const u = this.material.uniforms;
    const next = this.sections[index];
    u.tNext.value = next.texture;
    u.uNextImageSize.value = next.size;
    u.uNextFitTop.value = next.fitTop ? 1 : 0;
    u.uNextEdgeMul.value = next.edgeMul;
    u.uDirection.value = direction;
    u.uIsCircle.value = (opts?.isCircle ?? next.isCircle) ? 1 : 0;
    return true;
  }

  stepWheelTransition(delta: number) {
    if (!this.transitioning) return;
    // Each tick of input maps to a fixed chunk of progress directly, so
    // identical wheel/touch input always moves the wave the same amount
    // no matter how fast or slow it arrives — timing no longer changes
    // the outcome.
    this.targetProgress = Math.max(0, Math.min(1, this.targetProgress + delta));
    // The eased stop is part of the behavior: after the input ends, the
    // decaying velocity always carries the wave a little further.
    this.wheelVelocity = Math.max(-0.02, Math.min(0.02, delta * 0.1));
  }

  private cancelTransition() {
    this.progress = 1;
    this.targetProgress = 1;
    this.wheelVelocity = 0;
    this.transitioning = false;
    this.lastEnter = performance.now();
    const u = this.material.uniforms;
    const cur = this.sections[this.currentSection];
    u.tNext.value = cur.texture;
  }

  private finishTransition() {
    this.currentSection = this.nextSection;
    this.progress = 1;
    this.targetProgress = 1;
    this.wheelVelocity = 0;
    this.transitioning = false;
    this.lastEnter = performance.now();

    const u = this.material.uniforms;
    const cur = this.sections[this.currentSection];
    u.tCurrent.value = cur.texture;
    u.uCurrentImageSize.value = cur.size;
    u.uCurrentFitTop.value = cur.fitTop ? 1 : 0;
    u.uCurrentEdgeMul.value = cur.edgeMul;
  }

  private resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);

    const u = this.material.uniforms;
    u.uAspect.value = w / h;
    u.uResolution.value.set(w, h);

    this.anchorCam.aspect = w / h;
    this.anchorCam.updateProjectionMatrix();
  };

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);

    const now = performance.now();
    if (now - this.lastFrame < 1000 / 60 - 1) return;
    const dt = now - this.lastFrame;
    this.lastFrame = now;

    this.time += 0.01;
    this.mouse.lerp(this.mouseTarget, 0.08);

    if (this.transitioning) {
      if (this.transitionMode === "time") {
        this.progress += (dt / 1000) * this.timeRate;
        if (this.progress >= 1) this.finishTransition();
      } else {
        // Wheel/touch scrub with a soft glide: velocity eases the wave along
        // and decays when the input stops. Once the glide ends past the
        // commit threshold the change auto-continues to the next section;
        // below the hold band the wave keeps its partial progress instead
        // of snapping back. Reaching either end with input finishes or
        // cancels immediately.
        this.targetProgress = Math.min(
          1,
          Math.max(0, this.targetProgress + this.wheelVelocity),
        );
        this.wheelVelocity *= 0.8;
        if (Math.abs(this.wheelVelocity) < 0.0002) {
          this.wheelVelocity = 0;
          // Input stopped and momentum died: past the commit threshold the
          // change auto-continues; near the start it rolls back; in between
          // the partial progress is kept where it stopped, so more input
          // resumes from there instead of losing ground.
          if (this.targetProgress >= 0.85) this.targetProgress = 1;
          else if (this.targetProgress <= 0.15) this.targetProgress = 0;
        }

        // The wave travels to its target at a readable pace: strong response
        // to each input tick, but never an instant snap.
        this.progress += (this.targetProgress - this.progress) * 0.08;

        if (this.progress >= 0.992 && this.targetProgress >= 0.992) {
          this.finishTransition();
        } else if (this.progress <= 0.008 && this.targetProgress <= 0.008) {
          this.cancelTransition();
        }
      }
    }

    const u = this.material.uniforms;
    u.uTime.value = this.time;
    u.uProgress.value = this.progress;
    this.onProgress?.(
      this.progress,
      u.uDirection.value as 1 | -1,
      this.currentSection,
      this.nextSection,
    );
    u.uMouse.value.copy(this.mouse);
    u.uDarken.value = 0;

    const section =
      this.sections[
        this.transitioning ? this.nextSection : this.currentSection
      ];
    const center = section.fadeCenter;
    const t = this.time * 0.5;
    this.anchorCam.position.set(
      center.x + Math.sin(t) * 1.2 + (this.mouse.x - 0.5) * 1.5,
      center.y + Math.cos(t * 0.8) * 0.8 + (0.5 - this.mouse.y) * 1.0,
      center.z + 4,
    );
    this.anchorCam.lookAt(center);
    this.anchorCam.updateMatrixWorld();
    u.uProjectionView.value.multiplyMatrices(
      this.anchorCam.projectionMatrix,
      this.anchorCam.matrixWorldInverse,
    );
    u.uFadeCenterPoint.value.copy(center);

    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resize);
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.renderer.dispose();
  }
}
