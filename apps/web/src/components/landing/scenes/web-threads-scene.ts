/**
 * Web Threads: fios de luz Verde Pulso que se abrem a partir do centro, no fundo do CTA
 * final ("Move it."). Porte do componente WebThreads (ogl) para o Three.js que a landing
 * já carrega sob demanda — mesmo shader e os parâmetros definidos para a seção — dentro
 * do ciclo de vida do `SceneCanvas` (lazy, pausa fora da tela, descarte no mobile). O
 * modo claro do original ficou de fora: a seção é sempre escura.
 */
import {
  Camera,
  Mesh,
  NoBlending,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';

import { damp, type LandingScene, type SceneFactory } from './webgl';

/** Parâmetros definidos para a seção (iguais aos da referência). */
const WEB_THREADS = {
  colors: ['#25E27E', '#25E27E', '#25E27E'],
  speed: 0.5,
  threadCount: 6,
  frequency: 5,
  spread: 0.18,
  taper: 1,
  position: 0.5,
  /** 0 = centro, 1 = esquerda, 2 = direita (ponto onde os fios se encontram). */
  fanMode: 0,
  glow: 0.02,
  falloff: 0.6,
  thickness: 1.1,
  brightness: 0.6,
  opacity: 1,
  mirror: true,
  shimmer: true,
  grain: true,
  grainIntensity: 0.05,
  mouseStrength: 1,
} as const;

/** O original suaviza o mouse em 5% por quadro a 60 fps: -ln(0,95) × 60 ≈ 3,1/s. */
const MOUSE_DAMPING = 3.1;

/** Cor em sRGB 0–1, sem conversão linear — o shader original usa os valores crus. */
function hexToVec3(hex: string): Vector3 {
  const value = Number.parseInt(hex.slice(1), 16);
  return new Vector3(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

const VERTEX = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;

uniform vec2 iResolution;
uniform float iTime;
uniform float uSpeed;
uniform float uThreadCount;
uniform float uFrequency;
uniform float uSpread;
uniform float uTaper;
uniform float uPosition;
uniform float uFanMode;
uniform float uGlow;
uniform float uFalloff;
uniform float uThickness;
uniform float uBrightness;
uniform float uOpacity;
uniform float uMirror;
uniform float uShimmer;
uniform float uGrain;
uniform float uGrainIntensity;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform vec2 uMouse;
uniform float uMouseStrength;
uniform float uEnableMouse;
uniform float uMouseActive;

#define TAU 6.28318530718
#define MAX_THREADS 10

float glow(float x, float str, float dist) {
  return dist / pow(max(x, 1e-4), str);
}

void main() {
  vec2 uv = gl_FragCoord.xy / iResolution.xy;
  float n = max(uThreadCount, 1.0);

  float pinchX = uFanMode < 0.5 ? 0.5 : (uFanMode < 1.5 ? 0.0 : 1.0);
  if (uEnableMouse > 0.5) {
    pinchX = mix(pinchX, uMouse.x, clamp(uMouseStrength, 0.0, 1.0) * uMouseActive);
  }

  float spreadDx = uSpread * abs(uv.x - pinchX);
  float baseT = iTime * uSpeed;
  float tauOverN = TAU / n;
  float mirror = uMirror > 0.5 ? sign(pinchX - uv.x) : 1.0;
  bool doShimmer = uShimmer > 0.5;
  float shimmerT = iTime * 1.7;
  float invThickness = 1.0 / max(uThickness, 0.01);
  float xFreq = uv.x * uFrequency;
  float yOff = uv.y - uPosition;
  float ciScale = n > 1.0 ? 1.0 / (n - 1.0) : 0.0;

  vec3 col = vec3(0.0);
  float gsum = 0.0;

  for (int idx = 0; idx < MAX_THREADS; idx++) {
    float i = float(idx);
    if (i >= n) break;

    float amplitude = spreadDx * (1.0 + i * uTaper);
    float shimmer = doShimmer ? sin(shimmerT + i * 1.3) * 0.35 : 0.0;
    float phase = (baseT + i * tauOverN) * mirror + shimmer;

    float sdf = abs(yOff + sin(xFreq + phase) * amplitude) * invThickness;

    float g = glow(sdf, uFalloff, uGlow);
    float ci = i * ciScale;
    vec3 threadCol = mix(uColor1, uColor2, ci);

    col += g * threadCol;
    gsum += g;
  }

  float coreAmt = smoothstep(0.5, 2.2, gsum);
  col = mix(col, uColor3 * gsum, coreAmt * 0.5);

  float bright = uBrightness;
  if (uEnableMouse > 0.5) {
    vec2 md = uv - uMouse;
    float d2 = dot(md, md);
    bright += clamp(uMouseStrength, 0.0, 1.0) * uMouseActive * exp(-d2 * 6.0) * 0.6;
  }
  col *= bright;

  float alpha = clamp(gsum, 0.0, 1.0) * uOpacity;
  vec3 outRgb = col * alpha;

  if (uGrain > 0.5) {
    float gv = (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + iTime) * 43758.5453) - 0.5) * uGrainIntensity;
    outRgb = clamp(outRgb + gv, 0.0, 1.0);
    alpha = clamp(alpha + gv, 0.0, 1.0);
  }

  gl_FragColor = vec4(outRgb, alpha);
}
`;

export const createWebThreadsScene: SceneFactory = (canvas, options) => {
  const renderer = new WebGLRenderer({
    canvas,
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    powerPreference: 'low-power',
  });
  renderer.setClearColor(0x000000, 0);

  const uniforms = {
    iResolution: { value: new Vector2(1, 1) },
    iTime: { value: 0 },
    uSpeed: { value: WEB_THREADS.speed },
    uThreadCount: { value: WEB_THREADS.threadCount },
    uFrequency: { value: WEB_THREADS.frequency },
    uSpread: { value: WEB_THREADS.spread },
    uTaper: { value: WEB_THREADS.taper },
    uPosition: { value: WEB_THREADS.position },
    uFanMode: { value: WEB_THREADS.fanMode },
    uGlow: { value: WEB_THREADS.glow },
    uFalloff: { value: WEB_THREADS.falloff },
    uThickness: { value: WEB_THREADS.thickness },
    uBrightness: { value: WEB_THREADS.brightness },
    uOpacity: { value: WEB_THREADS.opacity },
    uMirror: { value: WEB_THREADS.mirror ? 1 : 0 },
    uShimmer: { value: WEB_THREADS.shimmer ? 1 : 0 },
    uGrain: { value: WEB_THREADS.grain ? 1 : 0 },
    uGrainIntensity: { value: WEB_THREADS.grainIntensity },
    uColor1: { value: hexToVec3(WEB_THREADS.colors[0]) },
    uColor2: { value: hexToVec3(WEB_THREADS.colors[1]) },
    uColor3: { value: hexToVec3(WEB_THREADS.colors[2]) },
    uMouse: { value: new Vector2(0.5, 0.5) },
    uMouseStrength: { value: WEB_THREADS.mouseStrength },
    // Sem ponteiro fino (toque), o `SceneCanvas` nunca chama `setPointer`: o mouse fica
    // inativo e os fios seguem só o próprio ritmo.
    uEnableMouse: { value: 1 },
    uMouseActive: { value: 0 },
  };
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms,
    transparent: true,
    // A saída já vem pré-multiplicada, como no original: escreve direto no canvas limpo.
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
  });
  const geometry = new PlaneGeometry(2, 2);
  const quad = new Mesh(geometry, material);
  quad.frustumCulled = false;
  const scene = new Scene();
  scene.add(quad);
  const camera = new Camera();

  const mouseTarget = new Vector2(0.5, 0.5);
  let mouseActiveTarget = 0;
  let time = 0;
  let frame = 0;
  let last = 0;
  let active = false;

  function render() {
    uniforms.iTime.value = time;
    renderer.render(scene, camera);
  }

  function loop(now: number) {
    const dt = last ? Math.min((now - last) / 1000, 0.05) : 0.016;
    last = now;
    time += dt;
    const mouse = uniforms.uMouse.value;
    mouse.set(
      damp(mouse.x, mouseTarget.x, MOUSE_DAMPING, dt),
      damp(mouse.y, mouseTarget.y, MOUSE_DAMPING, dt),
    );
    uniforms.uMouseActive.value = damp(
      uniforms.uMouseActive.value,
      mouseActiveTarget,
      MOUSE_DAMPING,
      dt,
    );
    render();
    frame = window.requestAnimationFrame(loop);
  }

  function resize(width: number, height: number, pixelRatio: number) {
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(Math.max(1, width), Math.max(1, height), false);
    renderer.getDrawingBufferSize(uniforms.iResolution.value);
    render();
  }

  resize(options.width, options.height, options.pixelRatio);

  const api: LandingScene = {
    setProgress() {},
    setPointer(x, y) {
      // O ponteiro chega em -1..1 relativo à seção; fora dela, os fios voltam ao centro.
      const inside = Math.abs(x) <= 1 && Math.abs(y) <= 1;
      mouseActiveTarget = inside ? 1 : 0;
      if (inside) mouseTarget.set((x + 1) / 2, (y + 1) / 2);
    },
    setActive(next) {
      if (next === active) return;
      active = next;
      if (active) {
        last = 0;
        frame = window.requestAnimationFrame(loop);
      } else if (frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
    },
    resize,
    dispose() {
      api.setActive(false);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    },
  };
  return api;
};
