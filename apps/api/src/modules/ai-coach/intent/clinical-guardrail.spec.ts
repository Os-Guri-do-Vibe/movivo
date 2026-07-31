import { describe, expect, it } from 'vitest';

import { clinicalGuardrail } from './clinical-guardrail';

describe('clinicalGuardrail', () => {
  it('marca SAFETY em sinal de emergência clínica', () => {
    expect(clinicalGuardrail('estou com dor no peito agora')).toBe('SAFETY');
    expect(clinicalGuardrail('não consigo respirar direito')).toBe('SAFETY');
    expect(clinicalGuardrail('acho que vou desmaiar')).toBe('SAFETY');
  });

  it('marca SCOPE em pergunta fora do escopo (não é emergência)', () => {
    expect(clinicalGuardrail('posso tomar dipirona pra dor?')).toBe('SCOPE');
    expect(clinicalGuardrail('que suplemento devo tomar?')).toBe('SCOPE');
    expect(clinicalGuardrail('qual dieta seguir?')).toBe('SCOPE');
  });

  it('SAFETY tem prioridade sobre SCOPE', () => {
    expect(clinicalGuardrail('tô com dor no peito e tomei um remédio')).toBe('SAFETY');
  });

  it('retorna null em mensagem comum de treino', () => {
    expect(clinicalGuardrail('como faço o agachamento?')).toBeNull();
    expect(clinicalGuardrail('tô sem vontade hoje')).toBeNull();
  });
});
