/**
 * Acompanhamento semanal de treino: o treinador (especialista) lê a semana do aluno e age. Ele
 * pode pedir o ajuste do protocolo (volume, estrutura, exercícios, progressão) dentro da zona
 * segura; o rascunho novo passa pelas políticas e pela auditoria como qualquer mudança. A
 * persona conta ao aluno o que viu, o que mudou e a tentativa de progressão da semana.
 */
import { z } from 'zod';

import { weekMetricsSchema } from '@movivo/shared';

import { defineAgentTask, type Validator, type Violation } from '../../core/agents/agent-task';
import { fold, outputLanguageViolations } from '../planning/tasks/common';
import {
  commitmentReviewSchema,
  commitmentReviewViolations,
  openCommitmentSchema,
} from '../student-state/commitments';
import { loadMetricsViewSchema } from './analyst-tasks';
import type { SessionPerformance } from './session-snapshot';
import { toneViolations } from './tasks';

export const trainingFollowUpInputSchema = z.object({
  goalDirection: z.enum(['LOSE', 'GAIN', 'MAINTAIN', 'NONE']),
  /** Onde o aluno está no protocolo vigente. */
  protocol: z.object({
    weekNumber: z.number().int(),
    totalWeeks: z.number().int(),
    phaseName: z.string().max(60),
    phaseFocus: z.string().max(200),
    /** A semana é de recuperação (deload) prevista pelo próprio protocolo. */
    plannedDeloadWeek: z.boolean(),
    sessionsPerWeek: z.number().int(),
  }),
  /** Últimas semanas fechadas (planejado × feito, carga, esforço, dor, check-in). */
  weeks: z.array(weekMetricsSchema).min(1).max(4),
  loadMetrics: loadMetricsViewSchema.nullable(),
  /** Progressão dos exercícios mais frequentes: as últimas sessões de cada um. */
  progression: z
    .array(
      z.object({
        exerciseId: z.string().max(80),
        sessions: z
          .array(
            z.object({
              date: z.iso.date(),
              topLoadKg: z.number().nullable(),
              repsAtTop: z.number().nullable(),
              avgRir: z.number().nullable(),
              sets: z.number().int(),
            }),
          )
          .min(1)
          .max(4),
      }),
    )
    .max(6),
  /** Dias desde a última mudança de protocolo feita por um agente (nula: nunca mudou). */
  daysSinceProtocolChange: z.number().int().nullable(),
  /**
   * As últimas sessões lado a lado com a disposição do dia (sono, energia, corpo, estresse, se ele
   * avisou antes, se o treinador ajustou) e o padrão de rendimento contra a última vez.
   */
  sessionHistory: z
    .array(
      z.object({
        date: z.iso.date(),
        sessionKey: z.string().max(80),
        pattern: z.string().max(40),
        readiness: z.object({
          energy: z.number().nullable(),
          sleep: z.number().nullable(),
          soreness: z.number().nullable(),
          mood: z.number().nullable(),
          stress: z.number().nullable(),
          sleepHours: z.number().nullable(),
          reportedBefore: z.boolean(),
          agentAdjusted: z.string().nullable(),
        }),
        performance: z.custom<SessionPerformance>(),
      }),
    )
    .max(8),
  /** Passos combinados na semana anterior: reavalie cada um com os dados da semana. */
  openCommitments: z.array(openCommitmentSchema).max(3),
});
export type TrainingFollowUpInput = z.infer<typeof trainingFollowUpInputSchema>;

export const trainingFollowUpSchema = z.object({
  status: z.enum(['ON_TRACK', 'NEEDS_ADJUSTMENT', 'NEEDS_DATA']),
  findings: z
    .array(
      z.object({
        topic: z.enum([
          'ADHERENCE',
          'PROGRESSION',
          'INTENSITY',
          'VOLUME',
          'RECOVERY',
          'TECHNIQUE',
          'LOAD_MANAGEMENT',
        ]),
        statement: z.string().trim().min(10).max(260),
      }),
    )
    .max(4),
  /** Pedido de ajuste do protocolo (ou nenhum). */
  adjustment: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('NONE') }),
    z.object({
      kind: z.literal('ADJUST_PROTOCOL'),
      /** Instrução objetiva para quem refaz o treino (volume, exercícios, estrutura, progressão). */
      instruction: z.string().trim().min(20).max(900),
      reason: z.string().trim().min(10).max(240),
    }),
  ]),
  /** Tentativa de progressão para a semana (pode citar carga; é sugestão, não obrigação). */
  progressionTry: z.string().trim().max(260).nullable(),
  nextStep: z.string().trim().min(10).max(240),
  question: z.string().trim().max(200).nullable(),
  /** Reavaliação dos passos combinados antes (um item por compromisso em aberto). */
  commitmentReview: commitmentReviewSchema,
});
export type TrainingFollowUp = z.infer<typeof trainingFollowUpSchema>;

export const trainingFollowUpValidators: Validator<TrainingFollowUpInput, TrainingFollowUp>[] = [
  (input, output) => {
    const violations: Violation[] = [];
    if (output.adjustment.kind === 'ADJUST_PROTOCOL') {
      if (input.weeks.length < 2) {
        violations.push({
          path: 'adjustment',
          message: 'com menos de 2 semanas de dados não há base para alterar o protocolo',
        });
      }
      if (input.daysSinceProtocolChange !== null && input.daysSinceProtocolChange < 10) {
        violations.push({
          path: 'adjustment',
          message:
            'o protocolo mudou há menos de 10 dias: deixe o aluno sentir antes de mexer de novo',
        });
      }
    }
    if (output.status === 'NEEDS_DATA' && output.adjustment.kind !== 'NONE') {
      violations.push({
        path: 'adjustment',
        message: 'sem dados suficientes não se altera o protocolo',
      });
    }
    violations.push(...commitmentReviewViolations(input.openCommitments, output.commitmentReview));
    if (input.protocol.plannedDeloadWeek && output.progressionTry) {
      violations.push({
        path: 'progressionTry',
        message:
          'semana de recuperação prevista no protocolo: não proponha tentativa de progressão',
      });
    }
    return violations;
  },
  (_input, output) => {
    const text = fold(
      [
        ...output.findings.map((f) => f.statement),
        output.nextStep,
        output.progressionTry ?? '',
        output.adjustment.kind === 'ADJUST_PROTOCOL' ? output.adjustment.instruction : '',
      ].join(' '),
    );
    return /\b(diagnostic|remedio|medicamento|garant)/.test(text)
      ? [{ path: 'findings', message: 'sem diagnóstico, medicamento ou garantia de resultado' }]
      : [];
  },
  (_input, output) =>
    outputLanguageViolations(output).concat(
      toneViolations([
        ...output.findings.map((f, i) => ({ path: `findings.${i}`, text: f.statement })),
        { path: 'nextStep', text: output.nextStep },
      ]),
    ),
];

export const trainingFollowUpTask = defineAgentTask<TrainingFollowUpInput, TrainingFollowUp>({
  id: 'training.weekly_follow_up',
  role: 'Treinador da MOVIVO (força, corrida e HYROX), com formação em ciência do treinamento, que acompanha o aluno toda semana. Você lê como o corpo e a rotina responderam ao protocolo e o ajusta quando os dados pedem.',
  instructions: `Faça o acompanhamento de treino da semana do aluno.

Como ler:
- "weeks": planejado × feito, sessões-chave, carga (sRPE), esforço médio, dor e o que ele contou no check-in. "loadMetrics": razão aguda:crônica (0,8 a 1,3 é a zona segura), monotonia, strain e prontidão comparada ao normal dele.
- "progression": a evolução das últimas sessões dos exercícios principais (carga de topo, repetições, repetições em reserva). Carga e repetições subindo com RIR estável é progressão saudável; repetições caindo com RIR zerando é fadiga ou carga alta demais; tudo parado há 3 sessões pede mudança de estímulo.
- "sessionHistory": as últimas sessões lado a lado com a disposição do dia. Leia o desempenho DENTRO do contexto: queda de volume ou ritmo com sono ruim, estresse alto ou o treinador tendo ajustado a sessão é esperada e não pede mexer no protocolo; queda com a disposição boa, repetida em mais de uma sessão, pede atenção; manter ou subir o rendimento com disposição baixa é sinal de boa adaptação. Use "pattern" como pista, confirme nos números.
- "observations", "dayDigests" (estado do aluno): o que ele contou no chat e o estudo dos últimos dias (sono, estresse, alimentação, treino, peso). Cruze com a semana.
- "protocol.plannedDeloadWeek": a semana de recuperação só existe quando o protocolo a previu. Fora dela, NÃO crie semana leve.

O que você pode fazer:
1. ADJUST_PROTOCOL: pedir o ajuste do protocolo com uma "instruction" objetiva (ex.: "subir o volume de costas em 2 séries por semana e trocar o remo máquina por remo curvado; manter o restante"). Pode mexer em volume, seleção de exercícios, estrutura da semana e progressão, sempre dentro da zona segura (razão aguda:crônica até 1,3, aumento semanal de carga total de até cerca de 10%, respeitando dor e restrições). Só quando há padrão claro em pelo menos 2 semanas.
2. "progressionTry": uma tentativa para a semana ("tenta +2 kg no agachamento; se as repetições caírem abaixo de 6, volta à carga de hoje"). É sugestão que o aluno testa, não obrigação.
3. NONE quando está bom ou falta dado. Com NEEDS_DATA, converse e entenda a rotina.

Compromissos: "openCommitments" são os passos pequenos combinados com o aluno na semana anterior. Para CADA um, preencha "commitmentReview" com o veredito (KEPT, PARTIAL ou NOT_KEPT) e a evidência nos dados (sessões feitas, cargas, adesão). Sem compromissos, devolva a lista vazia. O "nextStep" novo é o próximo compromisso: um passo que dê para verificar nos dados da semana seguinte.

Princípios: hipertrofia pede séries perto da falha com técnica preservada: treino fácil demais não gera resultado e deve ser corrigido; mas nunca ignore dor, sono ruim e prontidão baixa. Adapte à rotina real dele ("memory", "conversation"). Constância vale mais que perfeição.

A avaliação física visual ("bodyComposition": faixa de gordura por foto, grupos musculares a desenvolver, postura e simetria, comparação e observações) orienta o foco do protocolo e a recuperação (mobilidade e fortalecimento ligados ao alinhamento observado) junto da progressão e da adesão: estimativa com margem de erro; só fale o número, em faixa, se o aluno perguntar, e nunca trate postura como diagnóstico.

Regras: leituras específicas, com números. "nextStep" é UM passo pequeno. Sem diagnóstico, remédio ou promessa de resultado. Sem culpa. Não repita o que já foi dito.`,
  tier: 'REASONING',
  methodology: ['STRENGTH', 'RUNNING', 'HYROX', 'HYBRID', 'RECOVERY', 'ADHERENCE'],
  state: [
    'identity',
    'goals',
    'training',
    'bodyComposition',
    'restrictions',
    'preferences',
    'safety',
    'memory',
    'conversation',
    'observations',
    'dayDigests',
  ],
  input: trainingFollowUpInputSchema,
  output: trainingFollowUpSchema,
  validators: trainingFollowUpValidators,
  maxCorrectionRounds: 2,
});

// --- Comunicação ---------------------------------------------------------------------------

export const trainingTalkInputSchema = z.object({
  firstName: z.string().max(60).nullable(),
  followUp: trainingFollowUpSchema.omit({ adjustment: true }),
  /** Resumo do ajuste pedido ao protocolo (ou nulo). */
  protocolChange: z.string().max(240).nullable(),
});
export type TrainingTalkInput = z.infer<typeof trainingTalkInputSchema>;

export const trainingTalkSchema = z.object({
  messages: z.array(z.string().trim().min(1).max(420)).min(1).max(3),
});
export type TrainingTalk = z.infer<typeof trainingTalkSchema>;

export const trainingTalkValidators: Validator<TrainingTalkInput, TrainingTalk>[] = [
  (input, output) => {
    const violations: Violation[] = [];
    const last = output.messages.at(-1) ?? '';
    if (input.followUp.question && !last.includes('?')) {
      violations.push({ path: 'messages', message: 'termine com a pergunta' });
    }
    if (/\b(diagnostic|remedio|medicamento|garant)/.test(fold(output.messages.join(' ')))) {
      violations.push({ path: 'messages', message: 'sem diagnóstico, medicamento ou garantia' });
    }
    return violations;
  },
  (_input, output) =>
    outputLanguageViolations(output).concat(
      toneViolations(output.messages.map((text, i) => ({ path: `messages.${i}`, text }))),
    ),
];

export const trainingTalkTask = defineAgentTask<TrainingTalkInput, TrainingTalk>({
  id: 'communication.training_follow_up',
  role: 'Quem acompanha o aluno de perto pelo WhatsApp (a persona da MOVIVO). Toda semana você conversa sobre o treino dele como quem acompanha de verdade: reconhece o que ele fez, explica o que viu e propõe um passo.',
  instructions: `Escreva 1 a 3 mensagens curtas de WhatsApp com o retorno de treino da semana, a partir da leitura do especialista ("followUp").

Regras:
1. Comece pelo que foi bem (um fato de "findings"). Se "firstName" existir, use-o uma vez.
2. Explique o que o especialista viu em linguagem simples. Se "protocolChange" existir, conte que o treino vai mudar e por quê, e que ele recebe o protocolo atualizado.
2b. Se "followUp.commitmentReview" tiver itens, reconheça o que foi cumprido (KEPT) com um fato dos dados e trate o resto sem cobrança: o que atrapalhou e o que dá para ajustar.
3. Se houver "progressionTry", passe como tentativa da semana, com o critério para voltar atrás. Termine com o "nextStep" e, se houver, a "question" (uma só).
4. Sem culpa, sem diagnóstico, sem remédio, sem promessa de resultado.`,
  tier: 'STANDARD',
  methodology: ['COMMUNICATION'],
  state: ['identity', 'memory', 'conversation'],
  input: trainingTalkInputSchema,
  output: trainingTalkSchema,
  validators: trainingTalkValidators,
  maxCorrectionRounds: 2,
});
