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

import { PHASE_DURATION_WEEKS_RANGE } from '../protocol-timeline';

export const FALLBACK_TEMPLATE_VERSION = 'fallback-template-2026-09-v3';

const CREF_RESPALDO =
  'Este é um plano inicial conservador, gerado enquanto um profissional de Educação Física ' +
  'registrado no CREF revisa seu caso. Ele entra em contato com você em breve. Vá no seu ritmo ' +
  'e pare se sentir qualquer desconforto.';

/** Sem dias declarados (caso legado/parse falhou): 3x/semana alternados, nunca 1 sessão só. */
const DEFAULT_WEEKDAYS: readonly Weekday[] = ['MON', 'WED', 'FRI'];

/**
 * Duração do mesociclo deste template (achado 2026-09-02): a fase é sempre `ADAPTACAO`
 * (2-4 semanas, ver `protocol-timeline.ts`) — usa o piso da faixa. É um bloco conservador
 * de fallback com revisão humana obrigatória logo em seguida (`humanReviewRequired: true`),
 * então o horizonte mais curto plausível é o certo: o RT decide a duração real do próximo
 * mesociclo já revisando o caso, não este template genérico.
 */
const FALLBACK_PHASE_DURATION_WEEKS = PHASE_DURATION_WEEKS_RANGE.ADAPTACAO.minWeeks;

type FallbackExercise = ProtocolStructure['sessions'][number]['exercises'][number];

/** Template A: dois isométricos de core, por tempo. Faixas conservadoras válidas para
 *  qualquer um dos 8 objetivos de geração (a mais estreita é GAIN_STRENGTH, 3-10 reps). */
function templateA(): { focus: string; exercises: FallbackExercise[] } {
  return {
    focus: 'Corpo inteiro, adaptação (core)',
    exercises: [
      {
        // v7 (achado 2026-09-02): ids trocados de `dead_bug`/`brisk_walk` (catálogo
        // legado v1-v6) pros equivalentes da Biblioteca MOVIVO (marco 0, 413
        // exercícios) — o array antigo foi substituído, não mesclado. Peso do corpo,
        // sem equipamento: funciona em qualquer local, mesmo o catálogo só listando
        // HOME/OUTDOOR pra este id — este template nunca passa pelo filtro de local do
        // validador (é o caminho de exaustão de retries, não a geração normal).
        // Catálogo v7 reclassificou `dead_bug` como `measurement: DURATION` (isométrico
        // controlado) — prescrito por tempo, não reps, igual prancha.
        exerciseId: 'dead_bug',
        name: 'Dead Bug',
        sets: 2,
        durationSeconds: 30,
        loadStrategy: 'BODYWEIGHT',
        restSeconds: 60,
        notes: 'Movimento controlado, mantendo a lombar apoiada.',
      },
      {
        // Achado 2026-09-03: `caminhada` saiu daqui — a classificação por regra do
        // catálogo v7 marca TODO exercício `pattern: 'CARDIO'` como contraindicado para
        // CARDIAC (RASCUNHO A VALIDAR PELO RT, ver cabeçalho de `exercise-catalog.ts`).
        // Este template é exatamente o caminho usado para PAR-Q bloqueante — inclusive
        // usuário com flag CARDIAC — então um exercício CARDIO aqui contradiz a própria
        // razão do template existir: `ValidationService` bloqueia a assinatura
        // (`PROTOCOL_NOT_SAFE_TO_SIGN`) antes que o RT sequer veja o caso. `prancha` é
        // outro isométrico de core (mesmo formato de dead_bug acima), sem contraindicação
        // CARDIAC — o RT ainda revisa o caso antes de qualquer entrega
        // (`humanReviewRequired: true`), então perder a variedade cardio aqui não perde
        // segurança nenhuma.
        exerciseId: 'prancha',
        name: 'Prancha',
        sets: 2,
        durationSeconds: 30,
        loadStrategy: 'BODYWEIGHT',
        restSeconds: 60,
        notes: 'Corpo alinhado, sem deixar o quadril cair.',
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
        exerciseId: 'flexao_com_apoio_dos_joelhos',
        name: 'Flexão com Apoio dos Joelhos',
        sets: 2,
        reps: { min: 8, max: 10 },
        loadStrategy: 'BODYWEIGHT',
        restSeconds: 60,
        notes: 'Desça até onde o controle do movimento permitir.',
      },
      {
        exerciseId: 'elevacao_pelvica_no_solo',
        name: 'Elevação Pélvica no Solo',
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
    phaseDurationWeeks: FALLBACK_PHASE_DURATION_WEEKS,
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
