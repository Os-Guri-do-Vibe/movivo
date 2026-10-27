/**
 * Preço dos modelos para o custo registrado em cada chamada (`model_runs`, `ai_jobs`).
 *
 * Modelo fora da tabela usa `DEFAULT_PRICING`, que é deliberadamente alto: custo
 * superestimado é um alerta falso; subestimado esconde prejuízo por aluno.
 */
/** Preço por 1M tokens (USD), snapshot das páginas oficiais em 2026-08-27. */
interface Pricing {
  input: number;
  cached: number;
  output: number;
}
const DEFAULT_PRICING: Pricing = { input: 2.0, cached: 0.5, output: 8.0 };
const PRICING: Record<string, Pricing> = {
  'deepseek-v4-pro': { input: 0.435, cached: 0.003625, output: 0.87 },
  // Snapshot 2026-09-03 (api-docs.deepseek.com/quick_start/pricing) — tarifa de horário
  // de pico (a fora-de-pico é metade); usar o teto de propósito pra nunca subestimar custo.
  'deepseek-v4-flash': { input: 0.44, cached: 0.014, output: 1.32 },
  'gpt-4.1': DEFAULT_PRICING,
  'claude-sonnet-4-5': { input: 3.0, cached: 0.3, output: 15.0 },
};

export function costBrl(
  model: string,
  usage: { tokensInput: number; tokensCached: number; tokensOutput: number },
  usdBrlRate: number,
): number {
  const p = PRICING[model] ?? DEFAULT_PRICING;
  const usd =
    (usage.tokensInput * p.input + usage.tokensCached * p.cached + usage.tokensOutput * p.output) /
    1_000_000;
  return usd * usdBrlRate;
}
