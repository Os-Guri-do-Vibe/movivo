/**
 * Unit — CircuitBreaker (US-2.2 / TASK-2.2.2). Relógio injetado para determinismo.
 */
import { describe, expect, it } from 'vitest';

import { CircuitBreaker } from './circuit-breaker';

describe('CircuitBreaker', () => {
  it('nasce CLOSED e permite chamadas', () => {
    const b = new CircuitBreaker();
    expect(b.state()).toBe('CLOSED');
    expect(b.allow()).toBe(true);
  });

  it('abre após 5 falhas na janela e bloqueia novas chamadas', () => {
    const b = new CircuitBreaker(() => 1000);
    for (let i = 0; i < 5; i++) b.recordFailure();
    expect(b.state()).toBe('OPEN');
    expect(b.allow()).toBe(false);
  });

  it('sucesso reseta o contador de falhas', () => {
    let now = 1000;
    const b = new CircuitBreaker(() => now);
    b.recordFailure();
    b.recordFailure();
    b.recordSuccess();
    now = 2000;
    for (let i = 0; i < 4; i++) b.recordFailure();
    expect(b.state()).toBe('CLOSED'); // só 4 falhas após o reset
  });

  it('falhas fora da janela de 30s não somam para abrir', () => {
    let now = 0;
    const b = new CircuitBreaker(() => now);
    for (let i = 0; i < 4; i++) {
      b.recordFailure();
      now += 10_000; // 4 falhas espalhadas por 40s
    }
    expect(b.state()).toBe('CLOSED');
  });

  it('transita OPEN → HALF_OPEN após 30s e libera 1 probe', () => {
    let now = 1000;
    const b = new CircuitBreaker(() => now);
    for (let i = 0; i < 5; i++) b.recordFailure();
    expect(b.allow()).toBe(false); // OPEN
    now += 30_000;
    expect(b.state()).toBe('HALF_OPEN');
    expect(b.allow()).toBe(true); // probe liberado
    expect(b.allow()).toBe(false); // só 1 probe por vez
  });

  it('probe do HALF_OPEN que falha reabre; que passa fecha', () => {
    let now = 1000;
    const b = new CircuitBreaker(() => now);
    for (let i = 0; i < 5; i++) b.recordFailure();
    now += 30_000;
    b.allow();
    b.recordFailure(); // probe falhou
    expect(b.state()).toBe('OPEN');

    now += 30_000;
    b.allow();
    b.recordSuccess(); // probe passou
    expect(b.state()).toBe('CLOSED');
  });
});
