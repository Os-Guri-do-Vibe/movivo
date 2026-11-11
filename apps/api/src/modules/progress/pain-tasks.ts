/**
 * Dor relatada no fechamento do treino: o especialista de recuperação interpreta (hipóteses,
 * sinais de alerta, o que adaptar, quando procurar um profissional) e o comunicador, na voz da
 * persona, conversa com o aluno. O especialista nunca fala com o aluno e nenhum dos dois
 * diagnostica: o que muda no treino é decidido pelo código dentro das políticas.
 */
import { z } from 'zod';

import { painReportSchema } from '@movivo/shared';

import { defineAgentTask, type Validator, type Violation } from '../../core/agents/agent-task';
import { fold, outputLanguageViolations } from '../planning/tasks/common';
import { toneViolations } from './tasks';

/** Regiões do corpo que o catálogo de exercícios sabe contraindicar. */
export const BODY_REGIONS = [
  'SHOULDER',
  'ELBOW',
  'WRIST',
  'LOWER_BACK',
  'HIP',
  'KNEE',
  'ANKLE',
  'NECK',
] as const;
export type BodyRegion = (typeof BODY_REGIONS)[number];

/** Texto livre do formulário ("ombro", "joelho"…) → região do catálogo; `null` se não houver. */
export function regionOf(text: string): BodyRegion | null {
  const folded = fold(text);
  const table: ReadonlyArray<[RegExp, BodyRegion]> = [
    [/ombro|escapula/, 'SHOULDER'],
    [/cotovelo/, 'ELBOW'],
    [/punho|pulso|mao/, 'WRIST'],
    [/lombar|coluna|costas/, 'LOWER_BACK'],
    [/quadril|virilha|gluteo/, 'HIP'],
    [/joelho/, 'KNEE'],
    [/tornozelo|pe\b|calcanhar|canela/, 'ANKLE'],
    [/pescoco|cervical/, 'NECK'],
  ];
  return table.find(([pattern]) => pattern.test(folded))?.[1] ?? null;
}

export const painAssessmentInputSchema = z.object({
  reports: z.array(painReportSchema).min(1).max(6),
  session: z.object({
    modality: z.string().max(16),
    title: z.string().max(80).nullable(),
    rpe: z.number().nullable(),
    status: z.string().max(16),
  }),
  /** Dias com dor por região nos últimos 21 dias (sem contar hoje). */
  history: z.array(z.object({ region: z.string().max(40), days: z.number().int() })).max(8),
  /** Sinais de segurança ativos (tipos). */
  activeSignals: z.array(z.string().max(40)).max(8),
  /** Sessões dos próximos 7 dias e os exercícios de cada uma. */
  upcoming: z
    .array(
      z.object({
        date: z.iso.date(),
        title: z.string().max(80),
        exercises: z.array(z.string().max(120)).max(15),
      }),
    )
    .max(8),
  /** Contexto de hoje no check-in diário. */
  checkIn: z
    .object({
      energy: z.number().nullable(),
      sleep: z.number().nullable(),
      soreness: z.number().nullable(),
    })
    .nullable(),
});
export type PainAssessmentInput = z.infer<typeof painAssessmentInputSchema>;

export const painAssessmentSchema = z.object({
  /**
   * MONITOR: segue treinando e observa. ADAPT: troca o que sobrecarrega a região. REST: poupa a
   * região e alivia o volume por alguns dias. REFER: procurar um profissional.
   */
  level: z.enum(['MONITOR', 'ADAPT', 'REST', 'REFER']),
  /** Leituras cautelosas do que pode estar por trás (nunca diagnóstico). */
  hypotheses: z.array(z.string().trim().min(1).max(200)).max(3),
  /** Sinais de alerta presentes no relato. */
  redFlags: z.array(z.string().trim().min(1).max(160)).max(4),
  /** Regiões a poupar nos próximos treinos. */
  avoidRegions: z.array(z.enum(BODY_REGIONS)).max(3),
  /** Redução do volume da semana (0–30%); 0 = não mexe. */
  volumeReductionPercent: z.number().int().min(0).max(30),
  referral: z
    .object({
      specialty: z.enum(['ORTHOPEDIST', 'PHYSIOTHERAPIST', 'SPORTS_DOCTOR', 'DOCTOR']),
      urgency: z.enum(['ROUTINE', 'SOON', 'URGENT']),
      reason: z.string().trim().min(1).max(200),
    })
    .nullable(),
  /** Pontos que o comunicador deve passar ao aluno, na ordem. */
  guidance: z.array(z.string().trim().min(1).max(220)).min(1).max(4),
});
export type PainAssessment = z.infer<typeof painAssessmentSchema>;

const SEVERE = 8;

/** Regras determinísticas sobre a leitura do especialista (a segurança não depende do modelo). */
export const painAssessmentValidators: Validator<PainAssessmentInput, PainAssessment>[] = [
  (input, output) => {
    const violations: Violation[] = [];
    const maxPain = Math.max(...input.reports.map((r) => r.intensity));
    const sharpOrLimiting = input.reports.some(
      (r) => r.character === 'SHARP' || r.limitsMovement === true,
    );
    if (output.level === 'REFER' && !output.referral) {
      violations.push({ path: 'referral', message: 'encaminhar exige informar a especialidade' });
    }
    if (output.referral && output.level !== 'REFER') {
      violations.push({ path: 'level', message: 'com encaminhamento, o nível é REFER' });
    }
    if (output.referral?.urgency === 'URGENT' && output.redFlags.length === 0) {
      violations.push({
        path: 'redFlags',
        message: 'urgência pede o sinal de alerta que a justifica',
      });
    }
    if (maxPain >= SEVERE && output.level !== 'REFER') {
      violations.push({
        path: 'level',
        message: `dor ${maxPain}/10: a leitura precisa encaminhar a um profissional`,
      });
    }
    if (sharpOrLimiting && maxPain >= 5 && output.level === 'MONITOR') {
      violations.push({
        path: 'level',
        message: 'dor em pontada ou que limita o movimento, forte, pede adaptar ou poupar a região',
      });
    }
    if (
      output.level !== 'MONITOR' &&
      output.avoidRegions.length === 0 &&
      output.level !== 'REFER'
    ) {
      violations.push({ path: 'avoidRegions', message: 'adaptar exige dizer qual região poupar' });
    }
    return violations;
  },
  (_input, output) =>
    outputLanguageViolations(output).concat(
      toneViolations([
        ...output.hypotheses.map((text, i) => ({ path: `hypotheses.${i}`, text })),
        ...output.guidance.map((text, i) => ({ path: `guidance.${i}`, text })),
      ]),
    ),
];

export const painAssessmentTask = defineAgentTask<PainAssessmentInput, PainAssessment>({
  id: 'recovery.assess_pain',
  role: 'Especialista em recuperação e saúde do movimento da MOVIVO. Você interpreta a dor que o aluno relatou ao terminar o treino, sem diagnosticar, para decidir o que adaptar e quando procurar um profissional.',
  instructions: `Interprete o relato de dor e decida o nível de resposta.

Como ler:
- Intensidade, tipo ("character"), momento ("during") e se limita o movimento ("limitsMovement") importam mais que a região. Dor muscular de treino (MUSCLE, até 4/10, aparece depois e passa em 1 a 3 dias, em quem treinou forte) costuma ser esperada: MONITOR, sem assustar o aluno.
- Dor articular, em pontada ou queimação, que limita o movimento, que piora, que aparece no início do exercício ou que se repete nos mesmos dias ("history") pede ADAPT (poupar a região trocando exercícios) ou REST (poupar e aliviar o volume uns dias).
- Dor de 8/10 ou mais, dor após trauma, inchaço importante, perda súbita de força, dormência ou formigamento, dor que acorda à noite, dor no peito ou falta de ar são sinais de alerta: REFER, e com sinal de alerta grave a urgência é URGENT.
- Dor que persiste por mais de uma semana, mesmo leve, ou que volta sempre na mesma região: REFER com urgência ROUTINE ou SOON (fisioterapeuta ou ortopedista).
- Considere o contexto do aluno (sono, energia, sinais ativos, histórico de condições no Estado do Aluno).

Regras:
1. Nunca diagnostique nem nomeie doença ou lesão como se fosse certa: "hypotheses" são leituras cautelosas ("pode ser sobrecarga na região…"), sem certeza.
2. Nunca indique medicamento, suplemento ou tratamento.
3. "avoidRegions" são as regiões a poupar (do vocabulário fechado); "volumeReductionPercent" só quando REST ou ADAPT com dor repetida (até 30).
4. "guidance": 1 a 4 pontos que o comunicador vai passar ao aluno (o que fazer hoje, sinais para ficar atento, o que muda nos próximos treinos, quando procurar um profissional). Sem culpa, sem alarmismo, sem prometer resultado.
5. Dor sem sinal de gravidade não é motivo para parar de treinar o resto do corpo: o objetivo é seguir evoluindo com segurança.`,
  tier: 'REASONING',
  methodology: ['RECOVERY', 'SAFETY'],
  state: ['training', 'restrictions', 'safety', 'memory'],
  input: painAssessmentInputSchema,
  output: painAssessmentSchema,
  validators: painAssessmentValidators,
  maxCorrectionRounds: 2,
});

// --- Comunicação ---------------------------------------------------------------------------

export const painGuidanceInputSchema = z.object({
  firstName: z.string().max(60).nullable(),
  assessment: painAssessmentSchema,
  reports: z.array(painReportSchema).min(1).max(6),
  /** Trocas já feitas nos próximos treinos (o aluno precisa saber). */
  adaptations: z
    .array(
      z.object({
        sessionTitle: z.string().max(80),
        date: z.iso.date(),
        from: z.string().max(120),
        to: z.string().max(120),
      }),
    )
    .max(8),
  /** Redução de volume aplicada nesta semana (%), 0 se nenhuma. */
  volumeReductionApplied: z.number().int().min(0).max(30),
});
export type PainGuidanceInput = z.infer<typeof painGuidanceInputSchema>;

export const painGuidanceSchema = z.object({
  /** Mensagens curtas de WhatsApp, na ordem em que o aluno lê (1 a 3). */
  messages: z.array(z.string().trim().min(1).max(420)).min(1).max(3),
});
export type PainGuidance = z.infer<typeof painGuidanceSchema>;

const FORBIDDEN_TERMS = [
  /\bdiagnostic/,
  /\bremedio|medicamento|anti-?inflamatorio|ibuprofeno|dipirona|paracetamol|analgesico/,
  /\blesao (confirmada|grave)|rompeu|rompimento|fratura\b/,
  /\bgarant/,
];

export const painGuidanceValidators: Validator<PainGuidanceInput, PainGuidance>[] = [
  (input, output) => {
    const violations: Violation[] = [];
    const text = fold(output.messages.join(' '));
    FORBIDDEN_TERMS.forEach((pattern) => {
      if (pattern.test(text)) {
        violations.push({
          path: 'messages',
          message: 'sem diagnóstico, medicamento, lesão afirmada ou garantia de resultado',
        });
      }
    });
    if (input.assessment.referral && !/profissional|fisioterapeuta|ortoped|medic/.test(text)) {
      violations.push({
        path: 'messages',
        message: 'a leitura encaminha a um profissional: diga isso ao aluno com clareza',
      });
    }
    if (
      input.assessment.referral?.urgency === 'URGENT' &&
      !/atendimento|urgenc|pronto|samu|192/.test(text)
    ) {
      violations.push({
        path: 'messages',
        message: 'sinal de alerta grave: oriente a buscar atendimento agora',
      });
    }
    if (
      input.adaptations.length > 0 &&
      !/tro[cq]|ajust|mud|adapt|poup|no lugar|substitu/.test(text)
    ) {
      violations.push({
        path: 'messages',
        message: 'o treino foi adaptado: conte ao aluno o que mudou nos próximos treinos',
      });
    }
    return violations;
  },
  (_input, output) =>
    outputLanguageViolations(output).concat(
      toneViolations(output.messages.map((text, i) => ({ path: `messages.${i}`, text }))),
    ),
];

export const painGuidanceTask = defineAgentTask<PainGuidanceInput, PainGuidance>({
  id: 'communication.pain_guidance',
  role: 'Quem acompanha o aluno de perto pelo WhatsApp (a persona da MOVIVO). Você conversa com ele depois de ele relatar dor num treino: acolhe, explica com clareza o que fazer e o que muda no treino, e encaminha a um profissional quando a leitura do especialista pede.',
  instructions: `Escreva 1 a 3 mensagens curtas de WhatsApp para o aluno, na sua voz, com base na leitura do especialista ("assessment") e no que já foi adaptado.

Regras:
1. Comece acolhendo (ele relatou dor) sem dramatizar. Se "firstName" existir, use-o uma vez.
2. Passe os pontos de "assessment.guidance" em linguagem simples, sem jargão, na ordem. Não invente orientação além deles.
3. Se há "adaptations", conte o que mudou nos próximos treinos (ex.: "troquei X por Y no treino de quinta"). Se "volumeReductionApplied" > 0, diga que aliviou o volume da semana.
4. Com encaminhamento, diga qual profissional procurar e em que prazo (ROUTINE: quando puder; SOON: nos próximos dias; URGENT: buscar atendimento agora, SAMU 192 se piorar).
5. Termine convidando o aluno a contar como está nos próximos dias.
6. Nunca diagnostique, nunca nomeie lesão como certa, nunca indique remédio, nunca prometa resultado. Tom humano e próximo, sem culpa.`,
  tier: 'STANDARD',
  methodology: ['COMMUNICATION'],
  state: ['identity', 'memory'],
  input: painGuidanceInputSchema,
  output: painGuidanceSchema,
  validators: painGuidanceValidators,
  maxCorrectionRounds: 2,
});
