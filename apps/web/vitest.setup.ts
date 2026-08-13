/**
 * Setup global dos testes de componente (US-0.8).
 *
 * `@testing-library/jest-dom` adiciona os matchers semânticos (`toBeDisabled`,
 * `toHaveAccessibleName`, etc.) que deixam a asserção descrever a intenção de
 * acessibilidade, não a estrutura do DOM. `cleanup` desmonta a árvore entre testes
 * para não vazar estado de um teste para o outro.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

/**
 * `window.matchMedia` não existe no jsdom, e o `next-themes` o consulta para resolver
 * o tema do sistema (`enableSystem`). Sem este stub, o `ThemeProvider` quebra ao montar.
 * O default `matches: false` = sistema em tema claro — base determinística dos testes.
 */
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});

/* jsdom ainda não implementa o ciclo do elemento nativo <dialog>. */
if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
}
if (typeof HTMLDialogElement.prototype.close !== 'function') {
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}

/*
 * O `ResponsiveContainer` do Recharts (usado pelo `ChartContainer` do shadcn) observa
 * o próprio tamanho; o jsdom não implementa `ResizeObserver`. O stub inerte basta:
 * sem redimensionamento no teste, o container fica no `initialDimension` do shadcn.
 */
globalThis.ResizeObserver ??= class {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback(
      [{ target, contentRect: { width: 600, height: 190 } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
};

afterEach(() => {
  cleanup();
});
