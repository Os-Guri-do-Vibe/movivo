/**
 * Aurora: faixa de luz Verde Pulso que ondula no alto da seção do WhatsApp. Porte do
 * componente Aurora (ogl) para o Three.js que a landing já carrega sob demanda — mesmo
 * shader, mesmos parâmetros (`colorStops`, `blend`, `amplitude`, `speed`) — dentro do
 * ciclo de vida do `SceneCanvas` (lazy, pausa fora da tela, descarte no mobile).
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

import type { LandingScene, SceneFactory } from './webgl';

/** Parâmetros definidos para a seção (iguais aos da referência). */
const AURORA = {
  colorStops: ['#25E27E', '#25E27E', '#25E27E'],
  blend: 0.59,
  amplitude: 1.0,
  speed: 0.4,
} as const;

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

uniform float uTime;
uniform float uAmplitude;
uniform vec3 uColorStops[3];
uniform vec2 uResolution;
uniform float uBlend;

vec3 permute(vec3 x) {
  return mod(((x * 34.0) + 1.0) * x, 289.0);
}

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

/* Rampa de três paradas (0, 0,5, 1) ao longo do eixo x. */
vec3 ramp(float x) {
  return x < 0.5
    ? mix(uColorStops[0], uColorStops[1], x * 2.0)
    : mix(uColorStops[1], uColorStops[2], (x - 0.5) * 2.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec3 rampColor = ramp(uv.x);

  float height = snoise(vec2(uv.x * 2.0 + uTime * 0.1, uTime * 0.25)) * 0.5 * uAmplitude;
  height = exp(height);
  height = (uv.y * 2.0 - height + 0.2);
  float intensity = 0.6 * height;

  float midPoint = 0.20;
  float auroraAlpha = smoothstep(midPoint - uBlend * 0.5, midPoint + uBlend * 0.5, intensity);
  vec3 auroraColor = intensity * rampColor;

  gl_FragColor = vec4(auroraColor * auroraAlpha, auroraAlpha);
}
`;

export const createAuroraScene: SceneFactory = (canvas, options) => {
  const renderer = new WebGLRenderer({
    canvas,
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    powerPreference: 'low-power',
  });
  renderer.setClearColor(0x000000, 0);

  const uniforms = {
    uTime: { value: 0 },
    uAmplitude: { value: AURORA.amplitude },
    uColorStops: { value: AURORA.colorStops.map(hexToVec3) },
    uResolution: { value: new Vector2(1, 1) },
    uBlend: { value: AURORA.blend },
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

  let time = 0;
  let frame = 0;
  let last = 0;
  let active = false;

  function render() {
    uniforms.uTime.value = time * AURORA.speed;
    renderer.render(scene, camera);
  }

  function loop(now: number) {
    const dt = last ? Math.min((now - last) / 1000, 0.05) : 0.016;
    last = now;
    time += dt;
    render();
    frame = window.requestAnimationFrame(loop);
  }

  function resize(width: number, height: number, pixelRatio: number) {
    // Luz difusa não precisa de retina: DPR 1 poupa fill-rate sem perda visível.
    renderer.setPixelRatio(Math.min(pixelRatio, 1));
    renderer.setSize(Math.max(1, width), Math.max(1, height), false);
    renderer.getDrawingBufferSize(uniforms.uResolution.value);
    render();
  }

  resize(options.width, options.height, options.pixelRatio);

  const api: LandingScene = {
    setProgress() {},
    setPointer() {},
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
