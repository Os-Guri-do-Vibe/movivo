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
 *
 * Uma sessão por dia declarado (achado 2026-08-18, decisão do fundador): antes disso o
 * fallback tinha 1 sessão genérica só, incoerente com `weeklyFrequency` — um aluno de
 * 4x/semana via 1 card só na revisão. Não é geração "de verdade" (isso é trabalho da IA
 * com a metodologia do RT — ver `protocol-generator.service.ts`), mas alterna entre DOIS
 * templates conservadores fixos (A/B) pra nunca repetir a sessão idêntica em dois dias
 * seguidos, mantendo a estrutura coerente com a rotina real do aluno.
 */
import type { GenerationGoal, ProtocolStructure, Weekday } from '@movivo/shared';

export const FALLBACK_TEMPLATE_VERSION = 'fallback-template-2026-08-v2';

const CREF_RESPALDO =
  'Este é um plano inicial conservador, gerado enquanto um profissional de Educação Física ' +
  'registrado no CREF revisa seu caso. Ele entra em contato com você em breve. Vá no seu ritmo ' +
  'e pare se sentir qualquer desconforto.';

/** Sem dias declarados (caso legado/parse falhou): 3x/semana alternados, nunca 1 sessão só. */
const DEFAULT_WEEKDAYS: readonly Weekday[] = ['MON', 'WED', 'FRI'];

type FallbackExercise = ProtocolStructure['sessions'][number]['exercises'][number];

/** Template A: core (isométrico) + cardio contínuo. Faixas conservadoras válidas para
 *  qualquer um dos 8 objetivos de geração (a mais estreita é GAIN_STRENGTH, 3-10 reps). */
function templateA(): { focus: string; exercises: FallbackExercise[] } {
  return {
    focus: 'Corpo inteiro, adaptação (core e cardio)',
    exercises: [
      {
        exerciseId: 'dead_bug',
        name: 'Dead bug',
        sets: 2,
        reps: { min: 8, max: 10 },
        loadStrategy: 'BODYWEIGHT',
        restSeconds: 60,
        notes: 'Movimento controlado, mantendo a lombar apoiada.',
      },
      {
        exerciseId: 'brisk_walk',
        name: 'Caminhada acelerada',
        sets: 1,
        durationSeconds: 600,
        loadStrategy: 'BODYWEIGHT',
        restSeconds: 0,
        notes: 'Ritmo confortável em que ainda consegue conversar.',
      },
    ],
  };
}

/** Template B: empurrar (superior) + quadril (posterior). Mesmas faixas conservadoras. */
function templateB(): { focus: string; exercises: FallbackExercise[] } {
  return {
    focus: 'Corpo inteiro, adaptação (superior e quadril)',
    exercises: [
      {
        exerciseId: 'knee_pushup',
        name: 'Flexão de joelhos',
        sets: 2,
        reps: { min: 8, max: 10 },
        loadStrategy: 'BODYWEIGHT',
        restSeconds: 60,
        notes: 'Desça até onde o controle do movimento permitir.',
      },
      {
        exerciseId: 'glute_bridge',
        name: 'Elevação de quadril',
        sets: 2,
        reps: { min: 8, max: 10 },
        loadStrategy: 'BODYWEIGHT',
        restSeconds: 60,
        notes: 'Aperte o glúteo no topo do movimento, sem hiperextender a lombar.',
      },
    ],
  };
}

/**
 * Monta um `ProtocolStructure` de fallback válido para o objetivo do usuário, com uma
 * sessão por dia declarado (`preferredDays`), alternando os dois templates conservadores
 * acima. Vazio/ausente → `DEFAULT_WEEKDAYS`.
 */
export function buildFallbackProtocol(
  goal: GenerationGoal,
  preferredDays: readonly Weekday[] = [],
): ProtocolStructure {
  const weekdays = preferredDays.length ? preferredDays : DEFAULT_WEEKDAYS;
  const dayLabels = ['Treino A', 'Treino B'];

  return {
    promptVersion: FALLBACK_TEMPLATE_VERSION,
    goal,
    phase: 'ADAPTACAO',
    weeklyFrequency: weekdays.length,
    sessions: weekdays.map((weekday, index) => {
      const template = index % 2 === 0 ? templateA() : templateB();
      return {
        dayLabel: dayLabels[index % 2] as string,
        weekday,
        focus: template.focus,
        exercises: template.exercises,
      };
    }),
    generalNotes: CREF_RESPALDO,
  };
}
