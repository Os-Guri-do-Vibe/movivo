/**
 * THE MOVIVO SYSTEM — a esfera Pulse.
 *
 * Esfera procedural (icosaedro subdividido + shader próprio), nunca imagem. O scroll
 * conta a história do sistema em cinco estados:
 *   0–20%   compacta — o ponto de partida;
 *   20–45%  respira e expande — entendimento;
 *   45–65%  partículas se desprendem — os dados soltos da vida real;
 *   65–85%  reorganização em estrutura — o protocolo;
 *   85–100% quatro núcleos: Físico, Mental, Rotina, Performance.
 * Displacement mínimo, respiração 0,98–1,02, Fresnel Verde Pulso. Nada gelatinoso.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Group,
  IcosahedronGeometry,
  LineSegments,
  LinearSRGBColorSpace,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderer,
} from 'three';

import { PULSE_NUCLEI as PULSE_NUCLEI_NDC } from './pulse-layout';
import { GLSL_SIMPLEX_3D, damp, seededRandom, type LandingScene, type SceneFactory } from './webgl';

const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Y = new Vector3(0, 1, 0);
const AXIS_Z = new Vector3(0, 0, 1);
const PULSO = new Vector3(37 / 255, 226 / 255, 126 / 255);
const DEEP = new Vector3(3 / 255, 17 / 255, 14 / 255);
const PETROLEO = new Vector3(6 / 255, 48 / 255, 42 / 255);

const SPHERE_VERTEX = /* glsl */ `
${GLSL_SIMPLEX_3D}
uniform float uTime;
uniform float uAmp;
uniform float uScale;
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vPos;
varying float vNoise;
void main() {
  float n = snoise(normal * 1.4 + vec3(uTime * 0.11));
  float n2 = snoise(normal * 3.1 - vec3(uTime * 0.07)) * 0.45;
  vec3 displaced = position * (1.0 + (n + n2) * uAmp) * uScale;
  vec4 mv = modelViewMatrix * vec4(displaced, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  vPos = position;
  vNoise = n;
  gl_Position = projectionMatrix * mv;
}
`;

const SPHERE_FRAGMENT = /* glsl */ `
uniform vec3 uPulse;
uniform vec3 uDeep;
uniform vec3 uPetrol;
uniform float uEnergy;
uniform float uTime;
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vPos;
varying float vNoise;
void main() {
  float facing = clamp(dot(normalize(vNormal), normalize(vView)), 0.0, 1.0);
  float fresnel = pow(1.0 - facing, 3.0);
  vec3 base = mix(uDeep, uPetrol, 0.62 + vNoise * 0.22);
  // Curvas de nível: a "topografia" do sistema, derivando devagar.
  float band = sin((vPos.y + vNoise * 0.08) * 18.0 + uTime * 0.3);
  float contour = smoothstep(0.965, 1.0, band);
  vec3 color = base
    + uPulse * fresnel * (0.62 + uEnergy * 0.5)
    + uPulse * contour * (0.03 + 0.12 * fresnel);
  gl_FragColor = vec4(color, 1.0);
}
`;

const HALO_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const HALO_FRAGMENT = /* glsl */ `
uniform vec3 uPulse;
uniform float uStrength;
varying vec2 vUv;
void main() {
  float d = distance(vUv, vec2(0.5)) * 2.0;
  float glow = pow(clamp(1.0 - d, 0.0, 1.0), 2.6);
  gl_FragColor = vec4(uPulse * glow * uStrength, glow * uStrength);
}
`;

const PARTICLE_VERTEX = /* glsl */ `
${GLSL_SIMPLEX_3D}
uniform float uTime;
uniform float uProgress;
uniform float uSphereScale;
uniform float uPixelRatio;
uniform float uSize;
attribute vec3 aSphere;
attribute vec3 aDrift;
attribute vec3 aStruct;
attribute vec3 aNucleus;
attribute float aSeed;
varying float vAlpha;
void main() {
  float detach = smoothstep(0.45, 0.65, uProgress);
  float organize = smoothstep(0.65, 0.85, uProgress);
  float nuclei = smoothstep(0.85, 1.0, uProgress);
  vec3 p = mix(aSphere * uSphereScale, aDrift, detach);
  p = mix(p, aStruct, organize);
  p = mix(p, aNucleus, nuclei);
  float t = uTime * 0.12 + aSeed * 40.0;
  p += vec3(snoise(vec3(t, aSeed, 0.0)), snoise(vec3(aSeed, t, 1.0)), snoise(vec3(0.0, aSeed, t)))
    * (0.035 + detach * 0.06 * (1.0 - organize));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float emerge = smoothstep(0.18, 0.48, uProgress);
  vAlpha = (0.12 + 0.88 * emerge) * (0.45 + 0.55 * fract(aSeed * 7.13));
  gl_PointSize = uSize * (0.6 + fract(aSeed * 3.71)) * uPixelRatio / -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const PARTICLE_FRAGMENT = /* glsl */ `
uniform vec3 uPulse;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(uPulse, a * a * vAlpha);
}
`;

const LINE_VERTEX = /* glsl */ `
attribute float aEnd;
varying float vEnd;
void main() {
  vEnd = aEnd;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const LINE_FRAGMENT = /* glsl */ `
uniform vec3 uPulse;
uniform float uOpacity;
varying float vEnd;
void main() {
  gl_FragColor = vec4(uPulse, uOpacity * (0.25 + 0.75 * vEnd));
}
`;

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function randomUnitVector(random: () => number): Vector3 {
  const u = random() * 2 - 1;
  const theta = random() * Math.PI * 2;
  const r = Math.sqrt(1 - u * u);
  return new Vector3(r * Math.cos(theta), r * Math.sin(theta), u);
}

/**
 * Tamanho da esfera em relação ao desenho original; núcleos e halo não mudam (o halo
 * maior encostaria na borda do canvas e desenharia um retângulo sobre o fundo Musgo).
 */
const SPHERE_SIZE = 1.3;

export const createPulseScene: SceneFactory = (canvas, options) => {
  const { mobile } = options;
  const random = seededRandom(20260922);
  const particleCount = mobile ? 180 : 520;

  const renderer = new WebGLRenderer({
    canvas,
    alpha: true,
    antialias: !mobile,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = LinearSRGBColorSpace;
  renderer.setClearColor(0x000000, 0);

  const scene = new Scene();
  const camera = new PerspectiveCamera(34, 1, 0.1, 50);
  camera.position.set(0, 0, 6.4);

  const system = new Group();
  scene.add(system);

  // --- Halo (glow só onde há atividade: o próprio Pulse) --------------------
  const haloUniforms = { uPulse: { value: PULSO }, uStrength: { value: 0.28 } };
  const haloMaterial = new ShaderMaterial({
    vertexShader: HALO_VERTEX,
    fragmentShader: HALO_FRAGMENT,
    uniforms: haloUniforms,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const halo = new Mesh(new PlaneGeometry(5.2, 5.2), haloMaterial);
  halo.position.z = -1.2;
  scene.add(halo);

  // --- Esfera --------------------------------------------------------------
  const sphereUniforms = {
    uTime: { value: 0 },
    uAmp: { value: 0.03 },
    uScale: { value: 0.86 },
    uEnergy: { value: 0 },
    uPulse: { value: PULSO },
    uDeep: { value: DEEP },
    uPetrol: { value: PETROLEO },
  };
  const sphereMaterial = new ShaderMaterial({
    vertexShader: SPHERE_VERTEX,
    fragmentShader: SPHERE_FRAGMENT,
    uniforms: sphereUniforms,
  });
  const sphere = new Mesh(new IcosahedronGeometry(1, mobile ? 18 : 30), sphereMaterial);
  system.add(sphere);

  // --- Partículas ----------------------------------------------------------
  const sphereAttr = new Float32Array(particleCount * 3);
  const driftAttr = new Float32Array(particleCount * 3);
  const structAttr = new Float32Array(particleCount * 3);
  const nucleusAttr = new Float32Array(particleCount * 3);
  const seedAttr = new Float32Array(particleCount);
  const ringTilts = [
    new Vector3(1.1, 0.2, 0),
    new Vector3(-0.5, 0.9, 0.3),
    new Vector3(0.2, -0.4, 1.2),
  ];
  const nucleusCenters = PULSE_NUCLEI_NDC.map(() => new Vector3());

  for (let i = 0; i < particleCount; i += 1) {
    const surface = randomUnitVector(random).multiplyScalar(1.04);
    sphereAttr.set([surface.x, surface.y, surface.z], i * 3);

    const drift = surface
      .clone()
      .normalize()
      .multiplyScalar(1.6 + random() * 1.3);
    driftAttr.set([drift.x, drift.y, drift.z * 0.7], i * 3);

    // Três órbitas inclinadas: a estrutura organizada do protocolo.
    const ring = i % ringTilts.length;
    const angle = (i / particleCount) * Math.PI * 2 * 7 + ring;
    const point = new Vector3(Math.cos(angle) * 1.55, Math.sin(angle) * 1.55, 0);
    const tilt = ringTilts[ring] ?? new Vector3();
    point
      .applyAxisAngle(AXIS_X, tilt.x)
      .applyAxisAngle(AXIS_Y, tilt.y)
      .applyAxisAngle(AXIS_Z, tilt.z);
    structAttr.set([point.x, point.y, point.z], i * 3);

    seedAttr[i] = random();
  }

  const particleGeometry = new BufferGeometry();
  particleGeometry.setAttribute('position', new BufferAttribute(sphereAttr, 3));
  particleGeometry.setAttribute('aSphere', new BufferAttribute(sphereAttr, 3));
  particleGeometry.setAttribute('aDrift', new BufferAttribute(driftAttr, 3));
  particleGeometry.setAttribute('aStruct', new BufferAttribute(structAttr, 3));
  const nucleusBuffer = new BufferAttribute(nucleusAttr, 3);
  particleGeometry.setAttribute('aNucleus', nucleusBuffer);
  particleGeometry.setAttribute('aSeed', new BufferAttribute(seedAttr, 1));

  const particleUniforms = {
    uTime: { value: 0 },
    uProgress: { value: 0 },
    uSphereScale: { value: 0.86 },
    uPixelRatio: { value: options.pixelRatio },
    uSize: { value: mobile ? 34 : 40 },
    uPulse: { value: PULSO },
  };
  const particleMaterial = new ShaderMaterial({
    vertexShader: PARTICLE_VERTEX,
    fragmentShader: PARTICLE_FRAGMENT,
    uniforms: particleUniforms,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const particles = new Points(particleGeometry, particleMaterial);
  particles.frustumCulled = false;
  scene.add(particles);

  // --- Linhas centro → núcleos ---------------------------------------------
  const linePositions = new Float32Array(PULSE_NUCLEI_NDC.length * 2 * 3);
  const lineEnds = new Float32Array(PULSE_NUCLEI_NDC.length * 2);
  for (let i = 0; i < PULSE_NUCLEI_NDC.length; i += 1) lineEnds[i * 2 + 1] = 1;
  const lineGeometry = new BufferGeometry();
  const lineBuffer = new BufferAttribute(linePositions, 3);
  lineGeometry.setAttribute('position', lineBuffer);
  lineGeometry.setAttribute('aEnd', new BufferAttribute(lineEnds, 1));
  const lineUniforms = { uPulse: { value: PULSO }, uOpacity: { value: 0 } };
  const lineMaterial = new ShaderMaterial({
    vertexShader: LINE_VERTEX,
    fragmentShader: LINE_FRAGMENT,
    uniforms: lineUniforms,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const lines = new LineSegments(lineGeometry, lineMaterial);
  lines.frustumCulled = false;
  scene.add(lines);

  /** Recalcula os núcleos no plano z=0 a partir das posições NDC (casam com os rótulos HTML). */
  function placeNuclei() {
    const nucleusRandom = seededRandom(4242);
    PULSE_NUCLEI_NDC.forEach((ndc, index) => {
      const target = nucleusCenters[index];
      if (!target) return;
      const point = new Vector3(ndc.x, ndc.y, 0.5).unproject(camera);
      const direction = point.sub(camera.position).normalize();
      const distance = -camera.position.z / direction.z;
      target.copy(camera.position).add(direction.multiplyScalar(distance));
      linePositions.set([0, 0, 0, target.x * 0.86, target.y * 0.86, 0], index * 6);
    });
    for (let i = 0; i < particleCount; i += 1) {
      const center = nucleusCenters[i % nucleusCenters.length] ?? new Vector3();
      const offset = randomUnitVector(nucleusRandom).multiplyScalar(
        0.06 + Math.pow(nucleusRandom(), 1.6) * 0.3,
      );
      nucleusAttr.set([center.x + offset.x, center.y + offset.y, offset.z * 0.6], i * 3);
    }
    nucleusBuffer.needsUpdate = true;
    lineBuffer.needsUpdate = true;
  }

  function resize(width: number, height: number, pixelRatio: number) {
    const safeWidth = Math.max(1, width);
    const safeHeight = Math.max(1, height);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(safeWidth, safeHeight, false);
    camera.aspect = safeWidth / safeHeight;
    // Garante que a esfera + núcleos caibam também em telas estreitas (retrato).
    camera.position.z = camera.aspect < 1 ? 6.4 / Math.max(camera.aspect, 0.62) : 6.4;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    particleUniforms.uPixelRatio.value = pixelRatio;
    placeNuclei();
    render(0);
  }

  // --- Estado e loop -------------------------------------------------------
  let targetProgress = 0;
  let progress = 0;
  let pointerX = 0;
  let pointerY = 0;
  let tiltX = 0;
  let tiltY = 0;
  let time = 0;
  let frame = 0;
  let last = 0;
  let active = false;

  function render(dt: number) {
    time += dt;
    progress = damp(progress, targetProgress, 5, dt || 1);
    tiltX = damp(tiltX, pointerY * 0.18, 3, dt || 1);
    tiltY = damp(tiltY, pointerX * 0.28, 3, dt || 1);

    const expand = smoothstep(0.2, 0.45, progress);
    const detach = smoothstep(0.45, 0.65, progress);
    const organize = smoothstep(0.65, 0.85, progress);
    const nuclei = smoothstep(0.85, 1, progress);
    const breathing = 1 + Math.sin(time * 0.9) * 0.02;
    const scale =
      (0.86 + expand * 0.16 - detach * 0.12 - organize * 0.12 - nuclei * 0.2) *
      breathing *
      SPHERE_SIZE;

    sphereUniforms.uTime.value = time;
    sphereUniforms.uScale.value = scale;
    sphereUniforms.uAmp.value = 0.012 + expand * 0.016 - organize * 0.01;
    sphereUniforms.uEnergy.value = expand * 0.7 + nuclei * 0.6;

    particleUniforms.uTime.value = time;
    particleUniforms.uProgress.value = progress;
    particleUniforms.uSphereScale.value = scale;
    lineUniforms.uOpacity.value = nuclei * 0.42;
    haloUniforms.uStrength.value = 0.22 + expand * 0.12 + nuclei * 0.08;

    system.rotation.y = time * 0.07 + tiltY;
    system.rotation.x = tiltX;
    particles.rotation.y = tiltY * (1 - nuclei);
    particles.rotation.x = tiltX * (1 - nuclei);

    renderer.render(scene, camera);
  }

  function loop(now: number) {
    const dt = last ? Math.min((now - last) / 1000, 0.05) : 0.016;
    last = now;
    render(dt);
    frame = window.requestAnimationFrame(loop);
  }

  resize(options.width, options.height, options.pixelRatio);

  const api: LandingScene = {
    setProgress(value) {
      targetProgress = Math.min(1, Math.max(0, value));
    },
    setPointer(x, y) {
      pointerX = x;
      pointerY = y;
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
      sphere.geometry.dispose();
      sphereMaterial.dispose();
      halo.geometry.dispose();
      haloMaterial.dispose();
      particleGeometry.dispose();
      particleMaterial.dispose();
      lineGeometry.dispose();
      lineMaterial.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
  return api;
};
