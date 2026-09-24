/** Hooks de UI da landing: magnetismo só com ponteiro fino; carregamento perto da tela. */
import { act, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FakeIntersectionObserver, mockMatchMedia } from '../../../../test/landing-fakes';

import MuscleMapFigures from '../sections/muscle-map-figures';

import { useMagnetic } from './use-magnetic';
import { useNearViewport } from './use-near-viewport';

function MagneticButton() {
  const ref = useRef<HTMLButtonElement>(null);
  useMagnetic(ref);
  return (
    <button ref={ref} type="button">
      magnético
    </button>
  );
}

function NearProbe() {
  const ref = useRef<HTMLDivElement>(null);
  const near = useNearViewport(ref);
  return <div ref={ref}>{near ? 'perto' : 'longe'}</div>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  FakeIntersectionObserver.reset();
});

describe('useMagnetic', () => {
  it('com mouse, desloca no máximo alguns pixels e volta ao sair', () => {
    mockMatchMedia(() => true);
    render(<MagneticButton />);
    const button = screen.getByRole('button');
    button.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 40 }) as DOMRect;
    act(() => {
      button.dispatchEvent(new PointerEvent('pointermove', { clientX: 100, clientY: 40 }));
    });
    expect(button.style.getPropertyValue('--mx')).toBe('5.00px');
    act(() => {
      button.dispatchEvent(new PointerEvent('pointerleave'));
    });
    expect(button.style.getPropertyValue('--mx')).toBe('0px');
  });

  it('em toque (sem ponteiro fino) não registra nada', () => {
    mockMatchMedia(() => false);
    render(<MagneticButton />);
    const button = screen.getByRole('button');
    act(() => {
      button.dispatchEvent(new PointerEvent('pointermove', { clientX: 100, clientY: 40 }));
    });
    expect(button.style.getPropertyValue('--mx')).toBe('');
  });
});

describe('useNearViewport', () => {
  it('vira "perto" quando o elemento se aproxima e não volta atrás', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    render(<NearProbe />);
    const probe = screen.getByText('longe');
    act(() => FakeIntersectionObserver.instances[0]?.trigger(probe, true));
    expect(screen.getByText('perto')).toBeInTheDocument();
  });

  it('sem IntersectionObserver, carrega direto', () => {
    render(<NearProbe />);
    expect(screen.getByText('perto')).toBeInTheDocument();
  });
});

describe('MuscleMapFigures', () => {
  it('renderiza frente e costas com a biblioteca oficial do projeto', () => {
    const { container } = render(
      <MuscleMapFigures groups={['chest', 'triceps']} selected="chest" onSelect={vi.fn()} />,
    );
    expect(screen.getByText('Frente')).toBeInTheDocument();
    expect(screen.getByText('Costas')).toBeInTheDocument();
    expect(container.querySelectorAll('svg').length).toBeGreaterThanOrEqual(2);
  });
});
