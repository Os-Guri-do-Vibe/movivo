'use client';

import React, { useEffect, useRef } from 'react';
import { Mesh, Program, Renderer, RenderTarget, Triangle, type Texture } from 'ogl';

import './acid-squares.css';

export type AcidSquaresDetail = 'low' | 'medium' | 'high';

export interface AcidSquaresProps {
  color1?: string;
  color2?: string;
  color3?: string;
  detail?: AcidSquaresDetail;
  speed?: number;
  waveDepth?: number;
  zoom?: number;
  density?: number;
  glow?: number;
  exposure?: number;
  spread?: number;
  stepSize?: number;
  colorShift?: number;
  contrast?: number;
  brightness?: number;
  opacity?: number;
  mouseInteraction?: boolean;
  mouseStrength?: number;
  mouseRadius?: number;
  blur?: number;
  grain?: boolean;
  grainIntensity?: number;
  lightMode?: boolean;
  className?: string;
}

/** Um valor de uniform do `ogl` (`Program.uniforms` é `Record<string, any>` na lib). */
interface UniformBox<T> {
  value: T;
}

interface MainUniforms {
  iTime: UniformBox<number>;
  iResolution: UniformBox<Float32Array>;
  uSpeed: UniformBox<number>;
  uWaveDepth: UniformBox<number>;
  uZoom: UniformBox<number>;
  uDensity: UniformBox<number>;
  uSpread: UniformBox<number>;
  uStepSize: UniformBox<number>;
  uGlow: UniformBox<number>;
  uExposure: UniformBox<number>;
  uColorShift: UniformBox<number>;
  uContrast: UniformBox<number>;
  uBrightness: UniformBox<number>;
  uOpacity: UniformBox<number>;
  uSteps: UniformBox<number>;
  uColor1: UniformBox<Float32Array>;
  uColor2: UniformBox<Float32Array>;
  uColor3: UniformBox<Float32Array>;
  uMouse: UniformBox<Float32Array>;
  uMouseStrength: UniformBox<number>;
  uMouseRadius: UniformBox<number>;
  uEnableMouse: UniformBox<number>;
  uMouseActive: UniformBox<number>;
  uGrain: UniformBox<number>;
  uGrainIntensity: UniformBox<number>;
  uLightMode: UniformBox<number>;
}

interface PostUniforms {
  tMap: UniformBox<Texture | null>;
  iResolution: UniformBox<Float32Array>;
  uDirection: UniformBox<Float32Array>;
  uRadius: UniformBox<number>;
  uGrain: UniformBox<number>;
  uGrainIntensity: UniformBox<number>;
  iTime: UniformBox<number>;
}

const hexToRgb = (hex: string): [number, number, number] => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  const r = result?.[1];
  const g = result?.[2];
  const b = result?.[3];
  if (!r || !g || !b) return [1, 1, 1];
  return [parseInt(r, 16) / 255, parseInt(g, 16) / 255, parseInt(b, 16) / 255];
};

const DETAIL_STEPS: Record<AcidSquaresDetail, number> = { low: 20, medium: 32, high: 48 };
const stepsFor = (detail: AcidSquaresDetail): number => DETAIL_STEPS[detail] || DETAIL_STEPS.medium;

const vertex = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fragment = `#version 300 es
precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform float uSpeed;
uniform float uWaveDepth;
uniform float uZoom;
uniform float uDensity;
uniform float uSpread;
uniform float uStepSize;
uniform float uGlow;
uniform float uExposure;
uniform float uColorShift;
uniform float uContrast;
uniform float uBrightness;
uniform float uOpacity;
uniform float uSteps;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform vec2 uMouse;
uniform float uMouseStrength;
uniform float uMouseRadius;
uniform float uEnableMouse;
uniform float uMouseActive;
uniform float uGrain;
uniform float uGrainIntensity;
uniform float uLightMode;
out vec4 fragColor;

void main() {
  vec2 frag = gl_FragCoord.xy;
  float zoom = max(uZoom, 0.05);
  float aspect = iResolution.x / iResolution.y;
  vec2 ndc = (2.0 * frag - iResolution.xy) / iResolution.y;
  vec2 dir = ndc * (0.5 / zoom);

  vec2 mouseNdc = vec2(uMouse.x * aspect, uMouse.y);
  float mr = max(uMouseRadius, 0.01);
  vec2 md = ndc - mouseNdc;
  float dent = exp(-dot(md, md) / (mr * mr)) * (3.0 * uMouseStrength * uEnableMouse * uMouseActive);

  float travel = sin(iTime * uSpeed) * uWaveDepth;
  float density = max(uDensity, 1.0);
  float spread = clamp(uSpread, 0.05, 0.6);
  float stepSize = max(uStepSize, 0.0005);
  float glowGain = max(uGlow, 0.0);

  vec3 tOffset = vec3(0.0, dent, travel);
  vec3 p = vec3(0.0);
  float s = 0.0;
  float glow = 0.0;

  for (int i = 0; i < 64; i++) {
    if (float(i) >= uSteps) break;
    p += vec3(dir * s, s);
    vec3 q = p + tOffset;
    s += density - length(q.xz) + length(ceil(q).xy);
    s = stepSize + abs(s) * spread;
    glow += glowGain / s;
  }

  float e = glow / max(uExposure, 1.0);
  float shimmer = 0.5 + 0.5 * dot(cos(iTime * uColorShift + p), vec3(0.3333));
  float v = tanh(e * uBrightness * mix(0.7, 1.05, shimmer));
  v = clamp((v - 0.5) * uContrast + 0.5, 0.0, 1.0);

  vec3 col = mix(uColor1, uColor2, smoothstep(0.0, 0.55, v));
  col = mix(col, uColor3, smoothstep(0.55, 1.0, v));
  col *= v;

  float a = clamp(v, 0.0, 1.0) * uOpacity;
  vec3 outRgb = col * a;
  if (uGrain > 0.5) {
    float gv = (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + iTime) * 43758.5453) - 0.5) * uGrainIntensity;
    outRgb = clamp(outRgb + gv, 0.0, 1.0);
    a = clamp(a + gv, 0.0, 1.0);
  }
  if (uLightMode > 0.5) {
    float peak = max(col.r, max(col.g, col.b));
    vec3 chroma = pow(clamp(col / max(peak, 0.0001), 0.0, 1.0), vec3(1.16));
    fragColor = vec4(mix(vec3(1.0), chroma, a * 0.94), 1.0);
  } else {
    fragColor = vec4(outRgb, a);
  }
}
`;

const postFragment = `#version 300 es
precision highp float;
uniform sampler2D tMap;
uniform vec2 iResolution;
uniform vec2 uDirection;
uniform float uRadius;
uniform float uGrain;
uniform float uGrainIntensity;
uniform float iTime;
out vec4 fragColor;

vec4 samp(vec2 uv) {
  return texture(tMap, uv);
}

void main() {
  vec2 uv = gl_FragCoord.xy / iResolution;
  vec2 texel = uDirection / iResolution;
  float st = uRadius * 0.25;
  vec4 sum = samp(uv) * 0.2026;
  sum += (samp(uv + texel * st) + samp(uv - texel * st)) * 0.179;
  sum += (samp(uv + texel * (st * 2.0)) + samp(uv - texel * (st * 2.0))) * 0.124;
  sum += (samp(uv + texel * (st * 3.0)) + samp(uv - texel * (st * 3.0))) * 0.0672;
  sum += (samp(uv + texel * (st * 4.0)) + samp(uv - texel * (st * 4.0))) * 0.0285;
  vec4 col = sum;
  if (uGrain > 0.5) {
    float gv = (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + iTime) * 43758.5453) - 0.5) * uGrainIntensity;
    col.rgb = clamp(col.rgb + gv, 0.0, 1.0);
    col.a = clamp(col.a + gv, 0.0, 1.0);
  }
  fragColor = col;
}
`;

interface AcidSquaresCtx {
  renderer: Renderer;
  program: Program;
  mesh: Mesh;
}
const ctxMap = new WeakMap<HTMLDivElement, AcidSquaresCtx>();

const AcidSquares: React.FC<AcidSquaresProps> = ({
  color1 = '#5227FF',
  color2 = '#A855F7',
  color3 = '#FFFFFF',
  detail = 'medium',
  speed = 0.7,
  waveDepth = 1,
  zoom = 1.3,
  density = 10.0,
  glow = 1.0,
  exposure = 2700,
  spread = 0.3,
  stepSize = 0.002,
  colorShift = 0,
  contrast = 1,
  brightness = 1.0,
  opacity = 1.0,
  mouseInteraction = true,
  mouseStrength = 0.1,
  mouseRadius = 0.35,
  blur = 0,
  grain = true,
  grainIntensity = 0.05,
  lightMode = false,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mouseTarget = useRef<[number, number]>([0, 0]);
  const mouseCurrent = useRef<[number, number]>([0, 0]);
  const enableMouseRef = useRef<boolean>(mouseInteraction);
  const mouseStrengthRef = useRef<number>(mouseStrength);
  const mouseActive = useRef<number>(0);
  const mouseActiveTarget = useRef<number>(0);
  const blurRef = useRef<number>(blur);
  const grainRef = useRef<boolean>(grain);
  const grainIntensityRef = useRef<number>(grainIntensity);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new Renderer({
      webgl: 2,
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      dpr: Math.min(window.devicePixelRatio || 1, 2),
    });

    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);
    const canvas = gl.canvas;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    container.appendChild(canvas);

    const geometry = new Triangle(gl);
    const program = new Program(gl, {
      vertex,
      fragment,
      uniforms: {
        iTime: { value: 0 },
        iResolution: { value: new Float32Array([1, 1]) },
        uSpeed: { value: 0.7 },
        uWaveDepth: { value: 1 },
        uZoom: { value: 1.3 },
        uDensity: { value: 10.0 },
        uSpread: { value: 0.3 },
        uStepSize: { value: 0.002 },
        uGlow: { value: 1.0 },
        uExposure: { value: 2700 },
        uColorShift: { value: 0 },
        uContrast: { value: 1 },
        uBrightness: { value: 1.0 },
        uOpacity: { value: 1.0 },
        uSteps: { value: 32 },
        uColor1: { value: new Float32Array([1, 1, 1]) },
        uColor2: { value: new Float32Array([1, 1, 1]) },
        uColor3: { value: new Float32Array([1, 1, 1]) },
        uMouse: { value: new Float32Array([0, 0]) },
        uMouseStrength: { value: 0.1 },
        uMouseRadius: { value: 0.35 },
        uEnableMouse: { value: 1.0 },
        uMouseActive: { value: 0.0 },
        uGrain: { value: 1.0 },
        uGrainIntensity: { value: 0.05 },
        uLightMode: { value: 0.0 },
      },
    });
    const mu = program.uniforms as MainUniforms;

    const mesh = new Mesh(gl, { geometry, program });

    const postProgram = new Program(gl, {
      vertex,
      fragment: postFragment,
      uniforms: {
        tMap: { value: null },
        iResolution: { value: new Float32Array([1, 1]) },
        uDirection: { value: new Float32Array([1, 0]) },
        uRadius: { value: 0 },
        uGrain: { value: 0 },
        uGrainIntensity: { value: 0.05 },
        iTime: { value: 0 },
      },
    });
    const pu = postProgram.uniforms as PostUniforms;
    const postMesh = new Mesh(gl, { geometry, program: postProgram });

    // As duas metades de um blur em dois passes (horizontal + vertical). `null` até o
    // primeiro frame com `blur > 0` — a maioria dos usos (incluindo o fundo do login)
    // não precisa alocar os framebuffers extras.
    let targets: { a: RenderTarget; b: RenderTarget } | null = null;
    const ensureTargets = (): { a: RenderTarget; b: RenderTarget } => {
      if (!targets) {
        const bw = gl.drawingBufferWidth;
        const bh = gl.drawingBufferHeight;
        targets = {
          a: new RenderTarget(gl, { width: bw, height: bh, depth: false }),
          b: new RenderTarget(gl, { width: bw, height: bh, depth: false }),
        };
      }
      return targets;
    };

    const renderFrame = () => {
      const grainOn = grainRef.current ? 1.0 : 0.0;
      const grainAmt = grainIntensityRef.current;
      mu.uGrainIntensity.value = grainAmt;
      pu.uGrainIntensity.value = grainAmt;
      if (blurRef.current > 0) {
        const { a, b } = ensureTargets();
        mu.uGrain.value = 0.0;
        renderer.render({ scene: mesh, target: a });
        pu.uRadius.value = blurRef.current * 14.0;
        pu.tMap.value = a.texture;
        pu.uDirection.value[0] = 1;
        pu.uDirection.value[1] = 0;
        pu.uGrain.value = 0.0;
        renderer.render({ scene: postMesh, target: b });
        pu.tMap.value = b.texture;
        pu.uDirection.value[0] = 0;
        pu.uDirection.value[1] = 1;
        pu.uGrain.value = grainOn;
        renderer.render({ scene: postMesh });
      } else {
        mu.uGrain.value = grainOn;
        renderer.render({ scene: mesh });
      }
    };

    ctxMap.set(container, { renderer, program, mesh });

    const setSize = () => {
      const rect = container.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      renderer.setSize(w, h);
      const bw = gl.drawingBufferWidth;
      const bh = gl.drawingBufferHeight;
      mu.iResolution.value[0] = bw;
      mu.iResolution.value[1] = bh;
      pu.iResolution.value[0] = bw;
      pu.iResolution.value[1] = bh;
      if (targets) {
        targets.a.setSize(bw, bh);
        targets.b.setSize(bw, bh);
      }
      renderFrame();
    };

    const ro = new ResizeObserver(setSize);
    ro.observe(container);
    setSize();

    const handleMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width - 0.5) * 2.0;
      const y = -((e.clientY - rect.top) / rect.height - 0.5) * 2.0;
      mouseTarget.current = [x, y];
      mouseActiveTarget.current = 1;
    };
    const handleMouseLeave = () => {
      mouseActiveTarget.current = 0;
    };
    container.addEventListener('mousemove', handleMouseMove);
    container.addEventListener('mouseleave', handleMouseLeave);

    let raf = 0;
    let isVisible = true;
    let isPageVisible = !document.hidden;
    const t0 = performance.now();

    const loop = (t: number) => {
      mu.iTime.value = (t - t0) * 0.001;

      const cur = mouseCurrent.current;
      const tgt = mouseTarget.current;
      cur[0] += 0.05 * (tgt[0] - cur[0]);
      cur[1] += 0.05 * (tgt[1] - cur[1]);
      mu.uMouse.value[0] = cur[0];
      mu.uMouse.value[1] = cur[1];
      const activeTarget = enableMouseRef.current ? mouseActiveTarget.current : 0;
      mouseActive.current += 0.05 * (activeTarget - mouseActive.current);
      mu.uMouseActive.value = mouseActive.current;
      mu.uEnableMouse.value = enableMouseRef.current ? 1.0 : 0.0;
      mu.uMouseStrength.value = mouseStrengthRef.current;

      pu.iTime.value = mu.iTime.value;
      renderFrame();
      raf = requestAnimationFrame(loop);
    };

    const tryStart = () => {
      if (isVisible && isPageVisible && raf === 0) raf = requestAnimationFrame(loop);
    };
    const tryStop = () => {
      if (raf !== 0) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        isVisible = entry.isIntersecting;
        if (isVisible) tryStart();
        else tryStop();
      },
      { threshold: 0 },
    );
    io.observe(container);

    const onVisibility = () => {
      isPageVisible = !document.hidden;
      if (isPageVisible) tryStart();
      else tryStop();
    };
    document.addEventListener('visibilitychange', onVisibility);

    tryStart();

    return () => {
      tryStop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      container.removeEventListener('mousemove', handleMouseMove);
      container.removeEventListener('mouseleave', handleMouseLeave);
      ctxMap.delete(container);
      if (targets) {
        gl.deleteFramebuffer(targets.a.buffer);
        gl.deleteFramebuffer(targets.b.buffer);
        targets.a.textures.forEach((tex) => gl.deleteTexture(tex.texture));
        targets.b.textures.forEach((tex) => gl.deleteTexture(tex.texture));
      }
      try {
        container.removeChild(canvas);
      } catch {
        /* o container já pode ter sido desmontado antes deste cleanup rodar */
      }
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ctx = ctxMap.get(container);
    if (!ctx) return;
    const u = ctx.program.uniforms as MainUniforms;

    u.uSpeed.value = speed;
    u.uWaveDepth.value = waveDepth;
    u.uZoom.value = zoom;
    u.uDensity.value = density;
    u.uSpread.value = spread;
    u.uStepSize.value = stepSize;
    u.uGlow.value = glow;
    u.uExposure.value = exposure;
    u.uColorShift.value = colorShift;
    u.uContrast.value = contrast;
    u.uBrightness.value = brightness;
    u.uOpacity.value = opacity;
    u.uLightMode.value = lightMode ? 1.0 : 0.0;
    u.uSteps.value = stepsFor(detail);
    u.uMouseRadius.value = mouseRadius;

    const c1 = hexToRgb(color1);
    u.uColor1.value[0] = c1[0];
    u.uColor1.value[1] = c1[1];
    u.uColor1.value[2] = c1[2];
    const c2 = hexToRgb(color2);
    u.uColor2.value[0] = c2[0];
    u.uColor2.value[1] = c2[1];
    u.uColor2.value[2] = c2[2];
    const c3 = hexToRgb(color3);
    u.uColor3.value[0] = c3[0];
    u.uColor3.value[1] = c3[1];
    u.uColor3.value[2] = c3[2];

    enableMouseRef.current = mouseInteraction;
    mouseStrengthRef.current = mouseStrength;
    blurRef.current = blur;
    grainRef.current = grain;
    grainIntensityRef.current = grainIntensity;
  }, [
    color1,
    color2,
    color3,
    detail,
    speed,
    waveDepth,
    zoom,
    density,
    glow,
    exposure,
    spread,
    stepSize,
    colorShift,
    contrast,
    brightness,
    opacity,
    mouseInteraction,
    mouseStrength,
    mouseRadius,
    blur,
    grain,
    grainIntensity,
    lightMode,
  ]);

  return <div ref={containerRef} className={`acid-squares-container ${className}`.trim()} />;
};

export default AcidSquares;
