/**
 * Ciclo de vida das cenas WebGL: nada de WebGL com movimento reduzido ou sem suporte;
 * cena criada só perto da viewport, pausada fora dela, descartada no mobile quando
 * longe e sempre limpa ao desmontar.
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as WebglModule from './webgl';

import { FakeIntersectionObserver, mockMatchMedia } from '../../../../test/landing-fakes';

const { webgl } = vi.hoisted(() => ({ webgl: { available: true } }));
vi.mock('./webgl', async (importOriginal) => ({
  ...(await importOriginal<typeof WebglModule>()),
  isWebGLAvailable: () => webgl.available,
}));

import { SceneCanvas } from './scene-canvas';
import { buildClubLayout } from './club-layout';
import { damp, scenePixelRatio, seededRandom } from './webgl';

function fakeScene() {
  return {
    setProgress: vi.fn(),
    setPointer: vi.fn(),
    setActive: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
  };
}

beforeEach(() => {
  FakeIntersectionObserver.reset();
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  webgl.available = true;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SceneCanvas', () => {
  it('movimento reduzido: fica o fallback, nenhuma cena é carregada', () => {
    mockMatchMedia(() => false);
    const load = vi.fn();
    render(<SceneCanvas load={load} fallback={<span>estático</span>} />);
    expect(screen.getByText('estático')).toBeInTheDocument();
    expect(FakeIntersectionObserver.instances).toHaveLength(0);
    expect(load).not.toHaveBeenCalled();
  });

  it('sem WebGL: fallback estático, sem observers', () => {
    mockMatchMedia((query) => query.includes('no-preference'));
    webgl.available = false;
    render(<SceneCanvas load={vi.fn()} fallback={<span>estático</span>} />);
    expect(FakeIntersectionObserver.instances).toHaveLength(0);
  });

  it('perto da viewport cria a cena; visível roda; ao desmontar descarta', async () => {
    mockMatchMedia((query) => query.includes('no-preference') || query.includes('pointer'));
    const scene = fakeScene();
    const factory = vi.fn(() => scene);
    const onScene = vi.fn();
    const { container, unmount } = render(
      <SceneCanvas load={() => Promise.resolve(factory)} onScene={onScene} fallback={null} />,
    );
    const host = container.firstElementChild as HTMLElement;
    const [near, inView] = FakeIntersectionObserver.instances;

    await act(async () => near?.trigger(host, true));
    expect(factory).toHaveBeenCalledTimes(1);
    expect(host.querySelector('canvas')).not.toBeNull();
    expect(onScene).toHaveBeenLastCalledWith(scene);
    expect(host).toHaveAttribute('data-scene-state', 'webgl');

    act(() => inView?.trigger(host, true));
    expect(scene.setActive).toHaveBeenLastCalledWith(true);

    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 10, clientY: 10 }));
    });
    expect(scene.setPointer).toHaveBeenCalled();

    unmount();
    expect(scene.dispose).toHaveBeenCalled();
    expect(onScene).toHaveBeenLastCalledWith(null);
  });

  it('no mobile, longe da viewport o contexto WebGL é liberado', async () => {
    mockMatchMedia((query) => query.includes('no-preference') || query.includes('max-width'));
    const scene = fakeScene();
    const { container } = render(
      <SceneCanvas load={() => Promise.resolve(() => scene)} fallback={null} />,
    );
    const host = container.firstElementChild as HTMLElement;
    const [near] = FakeIntersectionObserver.instances;
    await act(async () => near?.trigger(host, true));
    act(() => near?.trigger(host, false));
    expect(scene.dispose).toHaveBeenCalled();
    expect(host.querySelector('canvas')).toBeNull();
  });

  it('erro ao criar a cena volta ao fallback sem quebrar a página', async () => {
    mockMatchMedia((query) => query.includes('no-preference'));
    const { container } = render(
      <SceneCanvas load={() => Promise.reject(new Error('shader'))} fallback={<span>ok</span>} />,
    );
    const host = container.firstElementChild as HTMLElement;
    await act(async () => FakeIntersectionObserver.instances[0]?.trigger(host, true));
    expect(host).toHaveAttribute('data-scene-state', 'fallback');
    expect(screen.getByText('ok')).toBeInTheDocument();
  });
});

describe('utilitários WebGL', () => {
  it('damp converge para o alvo sem ultrapassar', () => {
    const value = damp(0, 1, 5, 0.1);
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(1);
    expect(damp(0, 1, 5, 100)).toBeCloseTo(1);
  });

  it('gerador determinístico: mesma semente, mesma sequência', () => {
    const a = seededRandom(7);
    const b = seededRandom(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('DPR limitado a 1,5 no mobile e 2 no desktop', () => {
    vi.stubGlobal('devicePixelRatio', 3);
    expect(scenePixelRatio(true)).toBe(1.5);
    expect(scenePixelRatio(false)).toBe(2);
  });

  it('constelação do Club: pontos dentro do campo e ligações únicas', () => {
    const { points, links } = buildClubLayout(120);
    expect(points).toHaveLength(120);
    expect(points.every((point) => Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1)).toBe(true);
    const keys = links.map(([a, b]) => `${Math.min(a, b)}-${Math.max(a, b)}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(buildClubLayout(120)).toEqual({ points, links });
  });
});
