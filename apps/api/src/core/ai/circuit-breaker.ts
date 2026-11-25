/**
 * Circuit breaker por provedor (US-2.2 / TASK-2.2.2 · Victor §1.2).
 *
 * Estado: CLOSED → OPEN → HALF_OPEN. 5 falhas em janela de 30s → OPEN por 30s → HALF_OPEN
 * (1 probe). Enquanto OPEN, o provedor é pulado e o router vai direto ao fallback — é isso
 * que garante failover <2s sem re-tentar um primário degradado.
 *
 * ponytail: contador + janela deslizante simples (array de timestamps), sem lib de
 * resiliência nova. O relógio é injetável só para o teste ser determinístico.
 */
const FAILURE_THRESHOLD = 5;
const WINDOW_MS = 30_000;
const OPEN_MS = 30_000;

export type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitBreaker {
  private failures: number[] = [];
  private openedAt: number | null = null;
  private halfOpenInFlight = false;

  constructor(private readonly now: () => number = Date.now) {}

  /** Estado atual (deriva do relógio — OPEN vira HALF_OPEN após `OPEN_MS`). */
  state(): BreakerState {
    if (this.openedAt === null) return 'CLOSED';
    return this.now() - this.openedAt >= OPEN_MS ? 'HALF_OPEN' : 'OPEN';
  }

  /** `true` se o router pode tentar este provedor agora (libera 1 probe no HALF_OPEN). */
  allow(): boolean {
    const state = this.state();
    if (state === 'OPEN') return false;
    if (state === 'HALF_OPEN') {
      if (this.halfOpenInFlight) return false;
      this.halfOpenInFlight = true;
    }
    return true;
  }

  recordSuccess(): void {
    this.failures = [];
    this.openedAt = null;
    this.halfOpenInFlight = false;
  }

  recordFailure(): void {
    const t = this.now();
    // Probe do HALF_OPEN falhou → reabre a janela.
    if (this.state() === 'HALF_OPEN') {
      this.openedAt = t;
      this.halfOpenInFlight = false;
      return;
    }
    this.failures = this.failures.filter((ts) => t - ts < WINDOW_MS);
    this.failures.push(t);
    if (this.failures.length >= FAILURE_THRESHOLD) {
      this.openedAt = t;
      this.failures = [];
    }
  }
}
