/**
 * Template de fallback pré-aprovado (US-2.3 / TASK-2.3.3).
 *
 * ⚠️ RASCUNHO — A VALIDAR PELO RT CREF / ALEXANDRE. Usado quando a geração é bloqueada
 * pelo validador E a regeração com o modelo de fallback também falha (o Worker orquestra
 * essa cascata — US-2.4). É um protocolo genérico, conservador e dentro dos guardrails,
 * com respaldo CREF visível, e SEMPRE acompanha `humanReviewRequired=true` — um humano
 * revisa antes de qualquer entrega.
 *
 * Texto sem termos proibidos (nada de diagnóstico/tratamento/cura/garantia). Schema-válido.
 */
import type { GenerationGoal, ProtocolStructure } from '@movivo/shared';

export const FALLBACK_TEMPLATE_VERSION = 'fallback-template-2026-07-draft-v1';

const CREF_RESPALDO =
  'Este é um plano inicial conservador, gerado enquanto um profissional de Educação Física ' +
  'registrado no CREF revisa seu caso. Ele entra em contato com você em breve. Vá no seu ritmo ' +
  'e pare se sentir qualquer desconforto.';

/**
 * Monta um `ProtocolStructure` de fallback válido para o objetivo do usuário. Usa exercícios
 * de baixo risco e faixas conservadoras que passam nas faixas plausíveis do validador.
 */
export function buildFallbackProtocol(goal: GenerationGoal): ProtocolStructure {
  return {
    promptVersion: FALLBACK_TEMPLATE_VERSION,
    goal,
    phase: 'ADAPTACAO',
    weeklyFrequency: 3,
    sessions: [
      {
        dayLabel: 'Sessão base',
        focus: 'Corpo inteiro — adaptação',
        exercises: [
          {
            exerciseId: 'dead_bug',
            name: 'Dead bug',
            sets: 2,
            // Faixa que cabe nos 8 objetivos de geração (a mais estreita é GAIN_STRENGTH, 3-10).
            reps: { min: 8, max: 10 },
            loadStrategy: 'BODYWEIGHT',
            restSeconds: 60,
            notes: 'Movimento controlado, mantendo a lombar apoiada.',
          },
          {
            exerciseId: 'brisk_walk',
            name: 'Caminhada acelerada',
            sets: 1,
            // Faixa conservadora que passa nas faixas plausíveis de todos os objetivos.
            // Faixa que cabe nos 8 objetivos de geração (a mais estreita é GAIN_STRENGTH, 3-10).
            reps: { min: 8, max: 10 },
            loadStrategy: 'BODYWEIGHT',
            restSeconds: 60,
            notes: 'Ritmo confortável em que ainda consegue conversar.',
          },
        ],
      },
    ],
    generalNotes: CREF_RESPALDO,
  };
}
