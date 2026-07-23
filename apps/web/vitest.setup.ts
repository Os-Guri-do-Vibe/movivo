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

afterEach(() => {
  cleanup();
});
