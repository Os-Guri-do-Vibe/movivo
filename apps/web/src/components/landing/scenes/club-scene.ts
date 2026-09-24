/**
 * MOVIVO CLUB — constelação da comunidade.
 *
 * Pontos são membros: nascem conforme o scroll avança, ligam-se aos vizinhos mais
 * próximos e se agrupam em núcleos. No meio da seção, parte deles converge para o
 * contorno do símbolo MOVIVO (amostrado do vetor oficial) e, sobre eles, uma linha neon
 * contínua desenha o símbolo; os pontos alcançados pela linha se fundem a ela. Depois a
 * linha apaga e os pontos voltam a se dispersar — pessoas diferentes formando a mesma
 * marca. Deriva lenta, resposta leve ao ponteiro.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CustomBlending,
  DoubleSide,
  Group,
  LineSegments,
  LinearSRGBColorSpace,
  MaxEquation,
  Mesh,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';

import { SYMBOL_PATH, SYMBOL_TRANSFORM } from '../ui/movivo-logo';

import { buildClubLayout } from './club-layout';
import { damp, type SceneFactory, type LandingScene } from './webgl';

const PULSO = new Vector3(37 / 255, 226 / 255, 126 / 255);
const FOV = 40;
const CAMERA_Z = 7;

const POINT_VERTEX = /* glsl */ `
uniform float uPixelRatio;
uniform float uSize;
attribute float aAlpha;
attribute float aScale;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vAlpha = aAlpha;
  gl_PointSize = uSize * aScale * uPixelRatio / -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const POINT_FRAGMENT = /* glsl */ `
uniform vec3 uPulse;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float core = smoothstep(0.22, 0.0, d);
  float glow = smoothstep(0.5, 0.0, d) * 0.35;
  gl_FragColor = vec4(uPulse, (core + glow) * vAlpha);
}
`;

const LINE_VERTEX = /* glsl */ `
attribute float aAlpha;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const LINE_FRAGMENT = /* glsl */ `
uniform vec3 uPulse;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(uPulse, vAlpha);
}
`;

/*
 * Linha neon: fita (dois vértices por amostra do contorno) que se desenha ao longo de
 * `aDist` (0–1). Núcleo quase branco, halo Verde Pulso e a ponta mais brilhante
 * enquanto desenha. `position` guarda o ponto do contorno já normalizado (-1..1).
 */
const NEON_VERTEX = /* glsl */ `
uniform vec2 uOffset;
uniform float uScale;
uniform float uHalfWidth;
attribute vec2 aNormal;
attribute float aSide;
attribute float aDist;
varying float vSide;
varying float vDist;
void main() {
  vSide = aSide;
  vDist = aDist;
  vec2 p = uOffset + position.xy * uScale + aNormal * aSide * uHalfWidth;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 0.0, 1.0);
}
`;

const NEON_FRAGMENT = /* glsl */ `
uniform vec3 uPulse;
uniform float uDraw;
uniform float uOpacity;
varying float vSide;
varying float vDist;
void main() {
  if (vDist > uDraw) discard;
  float d = abs(vSide);
  float core = smoothstep(0.32, 0.0, d);
  float glow = pow(1.0 - d, 2.4) * 0.6;
  float head = uDraw < 0.999 ? smoothstep(0.04, 0.0, uDraw - vDist) : 0.0;
  vec3 color = mix(uPulse, vec3(1.0), core * 0.6);
  float alpha = min(1.0, (core + glow) * uOpacity * (1.0 + head * 1.6));
  // Pré-multiplicado: a mistura por máximo (abaixo) não soma a fita sobre ela mesma.
  gl_FragColor = vec4(color * alpha, alpha);
}
`;

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

type Point2 = { x: number; y: number };

/**
 * Amostra o contorno do símbolo oficial em `count` pontos normalizados (-1..1, eixo Y
 * para cima), igualmente espaçados ao longo do caminho (um único contorno fechado).
 * Usa o motor de SVG do próprio navegador; se falhar, a cena segue sem o momento do
 * símbolo (nunca um logo deformado).
 */
function sampleSymbol(count: number): Point2[] | null {
  try {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.position = 'absolute';
    svg.style.visibility = 'hidden';
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', SYMBOL_PATH);
    svg.appendChild(path);
    document.body.appendChild(svg);
    const length = path.getTotalLength();
    const [dx = 0, dy = 0] = (SYMBOL_TRANSFORM.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    const raw = Array.from({ length: count }, (_, index) => {
      const point = path.getPointAtLength((index / count) * length);
      return { x: point.x + dx, y: point.y + dy };
    });
    svg.remove();
    if (!length || raw.length === 0) return null;
    const xs = raw.map((point) => point.x);
    const ys = raw.map((point) => point.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const half = Math.max(Math.max(...xs) - cx, Math.max(...ys) - cy) || 1;
    return raw.map((point) => ({ x: (point.x - cx) / half, y: -(point.y - cy) / half }));
  } catch {
    return null;
  }
}

/**
 * Fita da linha neon ao longo do contorno fechado: dois vértices por amostra, normal em
 * meia-esquina (miter, limitada) para as quinas do símbolo não afinarem, e distância
 * acumulada normalizada para o desenho progressivo.
 */
function buildNeonGeometry(outline: Point2[]): BufferGeometry {
  const n = outline.length;
  const at = (index: number) => outline[((index % n) + n) % n] ?? { x: 0, y: 0 };
  const lengths = [0];
  for (let i = 1; i <= n; i += 1) {
    const a = at(i - 1);
    const b = at(i);
    lengths.push((lengths[i - 1] ?? 0) + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = lengths[n] || 1;

  const positions = new Float32Array((n + 1) * 2 * 3);
  const normals = new Float32Array((n + 1) * 2 * 2);
  const sides = new Float32Array((n + 1) * 2);
  const dists = new Float32Array((n + 1) * 2);
  for (let i = 0; i <= n; i += 1) {
    const prev = at(i - 1);
    const cur = at(i);
    const next = at(i + 1);
    const t1 = new Vector2(cur.x - prev.x, cur.y - prev.y).normalize();
    const t2 = new Vector2(next.x - cur.x, next.y - cur.y).normalize();
    const tangent = t1.clone().add(t2);
    if (tangent.lengthSq() < 1e-6) tangent.copy(t2);
    tangent.normalize();
    const miter = new Vector2(-tangent.y, tangent.x);
    const scale = Math.min(1.4, 1 / Math.max(0.35, Math.abs(miter.dot(new Vector2(-t1.y, t1.x)))));
    for (let side = 0; side < 2; side += 1) {
      const v = i * 2 + side;
      positions.set([cur.x, cur.y, 0], v * 3);
      normals.set([miter.x * scale, miter.y * scale], v * 2);
      sides[v] = side === 0 ? -1 : 1;
      dists[v] = (lengths[i] ?? 0) / total;
    }
  }

  const indices: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aNormal', new BufferAttribute(normals, 2));
  geometry.setAttribute('aSide', new BufferAttribute(sides, 1));
  geometry.setAttribute('aDist', new BufferAttribute(dists, 1));
  geometry.setIndex(indices);
  return geometry;
}

export const createClubScene: SceneFactory = (canvas, options) => {
  const { mobile } = options;
  const count = mobile ? 150 : 440;
  const layout = buildClubLayout(count);
  // Contorno denso para a linha neon; os pontos usam amostras dele (mesma normalização).
  const outline = sampleSymbol(480);
  const symbolCount = Math.round(count * (mobile ? 0.85 : 0.62));
  const symbol = outline
    ? Array.from(
        { length: symbolCount },
        (_, index) => outline[Math.floor((index * outline.length) / symbolCount)] ?? outline[0],
      )
    : null;

  const renderer = new WebGLRenderer({
    canvas,
    alpha: true,
    antialias: false,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = LinearSRGBColorSpace;
  renderer.setClearColor(0x000000, 0);

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 0.1, 50);
  camera.position.set(0, 0, CAMERA_Z);
  const group = new Group();
  scene.add(group);

  // --- Pontos ---------------------------------------------------------------
  const positions = new Float32Array(count * 3);
  const alphas = new Float32Array(count);
  const scales = new Float32Array(count);
  layout.points.forEach((point, index) => {
    scales[index] = point.milestone ? 2.1 : 0.8 + ((index * 7919) % 100) / 250;
  });
  const pointGeometry = new BufferGeometry();
  const positionAttr = new BufferAttribute(positions, 3);
  const alphaAttr = new BufferAttribute(alphas, 1);
  pointGeometry.setAttribute('position', positionAttr);
  pointGeometry.setAttribute('aAlpha', alphaAttr);
  pointGeometry.setAttribute('aScale', new BufferAttribute(scales, 1));
  const pointUniforms = {
    uPixelRatio: { value: options.pixelRatio },
    uSize: { value: mobile ? 46 : 52 },
    uPulse: { value: PULSO },
  };
  const pointMaterial = new ShaderMaterial({
    vertexShader: POINT_VERTEX,
    fragmentShader: POINT_FRAGMENT,
    uniforms: pointUniforms,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const points = new Points(pointGeometry, pointMaterial);
  points.frustumCulled = false;
  group.add(points);

  // --- Conexões -------------------------------------------------------------
  const linkPositions = new Float32Array(layout.links.length * 6);
  const linkAlphas = new Float32Array(layout.links.length * 2);
  const lineGeometry = new BufferGeometry();
  const linkPositionAttr = new BufferAttribute(linkPositions, 3);
  const linkAlphaAttr = new BufferAttribute(linkAlphas, 1);
  lineGeometry.setAttribute('position', linkPositionAttr);
  lineGeometry.setAttribute('aAlpha', linkAlphaAttr);
  const lineMaterial = new ShaderMaterial({
    vertexShader: LINE_VERTEX,
    fragmentShader: LINE_FRAGMENT,
    uniforms: { uPulse: { value: PULSO } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const lines = new LineSegments(lineGeometry, lineMaterial);
  lines.frustumCulled = false;
  group.add(lines);

  // --- Linha neon do símbolo ------------------------------------------------
  const neonUniforms = {
    uPulse: { value: PULSO },
    uOffset: { value: new Vector2() },
    uScale: { value: 1 },
    uHalfWidth: { value: 0.05 },
    uDraw: { value: 0 },
    uOpacity: { value: 0 },
  };
  const neonGeometry = outline ? buildNeonGeometry(outline) : null;
  const neonMaterial = new ShaderMaterial({
    vertexShader: NEON_VERTEX,
    fragmentShader: NEON_FRAGMENT,
    uniforms: neonUniforms,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: DoubleSide,
    // Máximo em vez de soma: nas quinas agudas a fita se sobrepõe, e somar acenderia
    // pontos brilhantes; com o máximo a linha mantém o mesmo brilho em todo o contorno.
    blending: CustomBlending,
    blendEquation: MaxEquation,
  });
  const neon = neonGeometry ? new Mesh(neonGeometry, neonMaterial) : null;
  if (neon) {
    neon.frustumCulled = false;
    neon.visible = false;
    group.add(neon);
  }

  // --- Estado --------------------------------------------------------------
  let halfW = 4;
  let halfH = 2.5;
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
  const born = new Float32Array(count);

  function update(dt: number) {
    time += dt;
    progress = damp(progress, targetProgress, 4, dt || 1);
    tiltX = damp(tiltX, -pointerY * 0.08, 2.5, dt || 1);
    tiltY = damp(tiltY, pointerX * 0.12, 2.5, dt || 1);

    // Pontos convergem → a linha neon desenha o contorno → segura → apaga e dispersa.
    // O contorno fica completo quando o símbolo está no meio da tela (~0,47).
    const release = smoothstep(0.62, 0.76, progress);
    const symbolAmount = symbol ? smoothstep(0.26, 0.37, progress) * (1 - release) : 0;
    const draw = neon ? smoothstep(0.33, 0.47, progress) : 0;
    const extentX = halfW * 0.94;
    const extentY = halfH * 0.84;
    const symbolScale = Math.min(halfW, halfH) * (mobile ? 0.62 : 0.5);
    const symbolX = mobile ? 0 : halfW * 0.34;
    const symbolY = mobile ? halfH * 0.3 : 0;

    if (neon) {
      neon.visible = draw > 0 && release < 1;
      neonUniforms.uDraw.value = draw;
      neonUniforms.uOpacity.value = 1 - release;
      neonUniforms.uOffset.value.set(symbolX, symbolY);
      neonUniforms.uScale.value = symbolScale;
      neonUniforms.uHalfWidth.value = symbolScale * (mobile ? 0.06 : 0.045);
    }

    layout.points.forEach((point, index) => {
      const b = smoothstep(point.birth, point.birth + 0.1, progress);
      born[index] = b;
      let x = point.x * extentX + Math.sin(time * 0.3 + index) * 0.05;
      let y = point.y * extentY + Math.cos(time * 0.27 + index * 1.3) * 0.05;
      let z = point.z * 0.8;
      const target = symbol?.[index];
      if (target && symbolAmount > 0) {
        x += (symbolX + target.x * symbolScale - x) * symbolAmount;
        y += (symbolY + target.y * symbolScale - y) * symbolAmount;
        z += (0 - z) * symbolAmount;
      }
      positions[index * 3] = x;
      positions[index * 3 + 1] = y;
      positions[index * 3 + 2] = z;
      const twinkle = 0.62 + 0.38 * Math.sin(time * 1.1 + index * 2.7);
      // Ponto do contorno já alcançado pela linha neon se funde a ela (quase some).
      const absorbed =
        target && symbol
          ? smoothstep(index / symbol.length, index / symbol.length + 0.06, draw) * (1 - release)
          : 0;
      alphas[index] =
        b *
        (point.milestone ? 1 : twinkle) *
        (0.55 + 0.45 * (point.z + 1) * 0.5) *
        (1 - 0.85 * absorbed);
    });

    layout.links.forEach(([a, c], index) => {
      linkPositions.set(positions.subarray(a * 3, a * 3 + 3), index * 6);
      linkPositions.set(positions.subarray(c * 3, c * 3 + 3), index * 6 + 3);
      const alpha = Math.min(born[a] ?? 0, born[c] ?? 0) * 0.2 * (1 - symbolAmount * 0.9);
      linkAlphas[index * 2] = alpha;
      linkAlphas[index * 2 + 1] = alpha;
    });

    positionAttr.needsUpdate = true;
    alphaAttr.needsUpdate = true;
    linkPositionAttr.needsUpdate = true;
    linkAlphaAttr.needsUpdate = true;

    group.rotation.x = tiltX * (1 - symbolAmount);
    group.rotation.y = tiltY * (1 - symbolAmount);
    renderer.render(scene, camera);
  }

  function loop(now: number) {
    const dt = last ? Math.min((now - last) / 1000, 0.05) : 0.016;
    last = now;
    update(dt);
    frame = window.requestAnimationFrame(loop);
  }

  function resize(width: number, height: number, pixelRatio: number) {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    halfH = Math.tan(((FOV / 2) * Math.PI) / 180) * CAMERA_Z;
    halfW = halfH * camera.aspect;
    pointUniforms.uPixelRatio.value = pixelRatio;
    update(0);
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
      pointGeometry.dispose();
      pointMaterial.dispose();
      lineGeometry.dispose();
      lineMaterial.dispose();
      neonGeometry?.dispose();
      neonMaterial.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
  return api;
};
