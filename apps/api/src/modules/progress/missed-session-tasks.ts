/**
 * Treino perdido: busca ativa, sem cobrança. O especialista de hábitos lê o padrão do aluno
 * (quantas sessões perdidas, quais dias, prontidão, carga) e escolhe UMA abordagem; a persona
 * conversa com uma pergunta simples. Quem decide o que muda na agenda é o aluno, na resposta.
 */
import { z } from 'zod';

import { defineAgentTask, type Validator, type Violation } from '../../core/agents/agent-task';
import { fold, outputLanguageViolations } from '../planning/tasks/common';
import { loadMetricsViewSchema } from './analyst-tasks';
import { toneViolations } from './tasks';

export const MISSED_STRATEGIES = [
  'CHECK_IN',
  'OFFER_REORGANIZE',
  'OFFER_SHORT_VERSION',
  'ENCOURAGE_NEXT',
  'ESCALATE',
] as const;

export const missedSessionInputSchema = z.object({
  missed: z
    .array(
      z.object({
        date: z.iso.date(),
        title: z.string().max(80),
        priority: z.string().max(16),
        modality: z.string().max(16),
        estimatedMinutes: z.number().int(),
      }),
    )
    .min(1)
    .max(6),
  /** Padrão recente: sessões previstas, feitas e perdidas nos últimos 14 dias. */
  last14Days: z.object({
    planned: z.number().int(),
    done: z.number().int(),
    missed: z.number().int(),
    /** Dias da semana (0 = domingo) em que mais se perdeu, se houver padrão. */
    missedWeekdays: z.array(z.number().int().min(0).max(6)).max(7),
  }),
  /** Dias dos próximos 4 sem sessão marcada (contexto da semana; a sessão perdida não é compensada nem empilhada). */
  freeDays: z.array(z.iso.date()).max(4),
  /** Sessões marcadas nos próximos 4 dias. */
  upcoming: z.array(z.object({ date: z.iso.date(), title: z.string().max(80) })).max(6),
  /** Dias desde o último treino concluído; `null` se nunca treinou. */
  daysSinceLastTraining: z.number().int().nullable(),
  checkIn: z
    .object({
      energy: z.number().nullable(),
      sleep: z.number().nullable(),
      mood: z.number().nullable(),
      stress: z.number().nullable(),
    })
    .nullable(),
  loadMetrics: loadMetricsViewSchema.nullable(),
});
export type MissedSessionInput = z.infer<typeof missedSessionInputSchema>;

export const missedSessionPlanSchema = z.object({
  strategy: z.enum(MISSED_STRATEGIES),
  /** Leituras cautelosas do porquê (rotina, cansaço, motivação), nunca certezas. */
  hypotheses: z.array(z.string().trim().min(5).max(200)).max(2),
  /** A pergunta única e fácil de responder que a conversa vai fazer. */
  question: z.string().trim().min(5).max(200),
  rationale: z.string().trim().min(10).max(300),
});
export type MissedSessionPlan = z.infer<typeof missedSessionPlanSchema>;

export const ESCALATE_MIN_MISSED = 3;

export const missedSessionPlanValidators: Validator<MissedSessionInput, MissedSessionPlan>[] = [
  (input, output) => {
    const violations: Violation[] = [];
    if (output.strategy === 'ESCALATE' && input.last14Days.missed < ESCALATE_MIN_MISSED) {
      violations.push({
        path: 'strategy',
        message: `ESCALATE só com ${ESCALATE_MIN_MISSED} ou mais sessões perdidas em 14 dias`,
      });
    }
    return violations;
  },
  (_input, output) =>
    outputLanguageViolations(output).concat(
      toneViolations([
        ...output.hypotheses.map((text, i) => ({ path: `hypotheses.${i}`, text })),
        { path: 'rationale', text: output.rationale },
      ]),
    ),
];

export const missedSessionPlanTask = defineAgentTask<MissedSessionInput, MissedSessionPlan>({
  id: 'habits.plan_missed_session',
  role: 'Especialista em hábitos e comportamento da MOVIVO. Você entende por que o aluno deixou de treinar e escolhe a melhor forma de reaproximar sem culpa, protegendo a constância a longo prazo.',
  instructions: `O aluno perdeu sessão(ões). Escolha UMA abordagem para a conversa de hoje.

Abordagens:
- CHECK_IN: perdeu uma vez, sem padrão. Só perguntar como ele está e o que aconteceu, sem propor nada.
- OFFER_REORGANIZE: a rotina da semana mudou (viagem, plantão, semana cheia). Ofereça reorganizar o RESTO da semana e pergunte quais dias ele consegue treinar. A sessão perdida não é compensada nem empilhada: o plano segue.
- OFFER_SHORT_VERSION: falta de tempo ou cansaço aparente, ou não há dia livre. Ofereça uma versão curta (cerca de 20 minutos) em vez de zerar a semana.
- ENCOURAGE_NEXT: a sessão perdida era complementar, a semana já está boa ou ele precisa descansar (prontidão baixa, carga alta). Normalize e olhe para a próxima sessão.
- ESCALATE: ${ESCALATE_MIN_MISSED} ou mais sessões perdidas em 14 dias. A conversa é de acolhimento e escuta ("o que está difícil?"); o caso também vai para a equipe acompanhar.

Regras:
1. Constância vale mais que a sessão isolada: a sessão perdida não é compensada nem empilhada. Perdeu, perdeu: o plano segue.
2. "freeDays" são os dias sem treino marcado, só contexto para a conversa. "hypotheses" são leituras cautelosas do motivo (rotina, cansaço, estresse, motivação) com base nos dados ("checkIn", "loadMetrics", dias da semana que se repetem). Não afirme motivo.
3. "question" é UMA pergunta simples, que se responde com uma palavra ou frase curta.
4. Sem culpa, sem cobrança, sem comparar com outros. Tom de quem está do lado dele.
5. Nunca sugira treinar com dor, doença ou exaustão.`,
  tier: 'STANDARD',
  methodology: ['ADHERENCE', 'COMMUNICATION'],
  state: [
    'goals',
    'availability',
    'preferences',
    'adherence',
    'restrictions',
    'safety',
    'memory',
    'conversation',
  ],
  input: missedSessionInputSchema,
  output: missedSessionPlanSchema,
  validators: missedSessionPlanValidators,
  maxCorrectionRounds: 2,
});

// --- Comunicação ---------------------------------------------------------------------------

export const missedSessionMessageInputSchema = z.object({
  firstName: z.string().max(60).nullable(),
  missedTitles: z.array(z.string().max(80)).min(1).max(6),
  plan: missedSessionPlanSchema,
});
export type MissedSessionMessageInput = z.infer<typeof missedSessionMessageInputSchema>;

export const missedSessionMessageSchema = z.object({
  /** Mensagens curtas de WhatsApp (1 a 2); a última termina na pergunta. */
  messages: z.array(z.string().trim().min(1).max(360)).min(1).max(2),
});
export type MissedSessionMessage = z.infer<typeof missedSessionMessageSchema>;

const GUILT = [
  /\bvoce faltou|\bvoce falhou|\bnao cumpriu|\bdesisti|\bpreguic|\bfrac[ao]\b|\bdecepcion/,
];

export const missedSessionMessageValidators: Validator<
  MissedSessionMessageInput,
  MissedSessionMessage
>[] = [
  (_input, output) => {
    const violations: Violation[] = [];
    const last = output.messages[output.messages.length - 1] ?? '';
    if (!last.includes('?')) {
      violations.push({ path: 'messages', message: 'termine com a pergunta do plano' });
    }
    if (GUILT.some((pattern) => pattern.test(fold(output.messages.join(' '))))) {
      violations.push({ path: 'messages', message: 'sem cobrança nem culpa' });
    }
    return violations;
  },
  (_input, output) =>
    outputLanguageViolations(output).concat(
      toneViolations(output.messages.map((text, i) => ({ path: `messages.${i}`, text }))),
    ),
];

export const missedSessionMessageTask = defineAgentTask<
  MissedSessionMessageInput,
  MissedSessionMessage
>({
  id: 'communication.missed_session',
  role: 'Quem acompanha o aluno de perto pelo WhatsApp (a persona da MOVIVO). Quando o aluno perde um treino você aparece sem cobrança, com cuidado e uma pergunta fácil de responder.',
  instructions: `Escreva 1 a 2 mensagens curtas de WhatsApp, na sua voz, seguindo a abordagem escolhida pelo especialista ("plan").

Regras:
1. Não comece falando do treino perdido como falta. Abra com cuidado ("e aí, como você está?", "vi que ontem não rolou o treino…") e normalize em uma frase.
2. Siga "plan.strategy": CHECK_IN pergunta o que aconteceu; OFFER_REORGANIZE oferece reorganizar o resto da semana e pergunta quais dias ele consegue; OFFER_SHORT_VERSION oferece uma versão curta de uns 20 minutos; ENCOURAGE_NEXT olha para a próxima sessão; ESCALATE acolhe e pergunta o que está difícil.
3. Termine com a pergunta de "plan.question", com as suas palavras. Uma pergunta só.
4. Se "firstName" existir, use-o uma vez. Sem culpa, sem cobrança, sem promessa de resultado.`,
  tier: 'STANDARD',
  methodology: ['COMMUNICATION', 'ADHERENCE'],
  state: ['identity', 'memory', 'conversation'],
  input: missedSessionMessageInputSchema,
  output: missedSessionMessageSchema,
  validators: missedSessionMessageValidators,
  maxCorrectionRounds: 2,
});
