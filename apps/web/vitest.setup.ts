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

/*
 * Lacunas do jsdom que o Radix Select (`FilterSelect` do Control Center) exige para
 * montar: o gatilho captura o ponteiro ao abrir e o menu rola até o item marcado.
 * Nenhuma delas tem efeito observável em teste — sem layout real não há rolagem nem
 * captura de ponteiro —, então o stub inerte basta.
 */
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

/*
 * O jsdom define `window.scrollTo` só para avisar "Not implemented". A landing volta ao
 * topo ao montar; sem layout real não há rolagem a observar, então o stub é inerte.
 * Quem precisa verificar a chamada usa `vi.spyOn(window, 'scrollTo')`.
 */
window.scrollTo = () => {};

/*
 * Regressão do jsdom 30.1.0 (https://github.com/jsdom/jsdom/issues/4347, sem correção
 * publicada): remover um elemento focado e focar outro em seguida passou a disparar um
 * `blur` espúrio na `window`, com o elemento recém-focado como `relatedTarget`. O
 * `cleanup()` do Testing Library desmonta a árvore com foco ativo entre testes, então
 * o próximo `focus()` — inclusive o do próprio Testing Library ao montar um novo teste —
 * dispara esse `blur`. O Radix Select fecha no `blur` da `window`; o combo abria e
 * fechava no mesmo clique. O guard replica a correção recusada a montante (PR fechado
 * sem merge): ignora apenas o `blur` sintético da própria `window` (bolha nunca chega
 * de um elemento real) que carrega `relatedTarget`, sinal exclusivo dessa regressão.
 */
window.addEventListener(
  'blur',
  (event) => {
    if (event.target === event.currentTarget && (event as FocusEvent).relatedTarget !== null) {
      event.stopImmediatePropagation();
    }
  },
  { capture: true },
);

afterEach(() => {
  cleanup();
});
