/**
 * Acompanhamento nutricional proativo: toda semana o especialista de nutrição lê a semana
 * alimentar do aluno (registros × meta, refeições que somem, como ele diz que está, peso, carga de
 * treino, o que se sabe dele) e age: ajusta a meta de energia ou a orientação de uma refeição
 * dentro dos limites das políticas. A persona conta ao aluno, em conversa, o que viu e um passo
 * pequeno. Sem dado, ela pergunta e convida a registrar.
 */
import { z } from 'zod';

import { mealSlotSchema } from '@movivo/shared';

import { defineAgentTask, type Validator, type Violation } from '../../core/agents/agent-task';
import { fold, outputLanguageViolations } from '../planning/tasks/common';
import { loadMetricsViewSchema } from './analyst-tasks';
import {
  commitmentReviewSchema,
  commitmentReviewViolations,
  openCommitmentSchema,
} from '../student-state/commitments';
import { toneViolations } from './tasks';

/** Passo máximo de energia por ajuste: correção gradual, nunca salto. */
export const MAX_ENERGY_STEP_KCAL = 250;

const nutritionWeekSchema = z.object({
  loggedDays: z.number().int(),
  fullDays: z.number().int(),
  avgEnergyKcal: z.number().nullable(),
  avgProteinG: z.number().nullable(),
  avgFiberG: z.number().nullable(),
  energyRatio: z.number().nullable(),
  proteinRatio: z.number().nullable(),
  fiberRatio: z.number().nullable(),
  daysBySlot: z.record(z.string(), z.number().int()),
  checkIn: z.object({
    onTrack: z.number().int(),
    partial: z.number().int(),
    off: z.number().int(),
  }),
  weight: z.object({
    points: z.number().int(),
    firstKg: z.number().nullable(),
    lastKg: z.number().nullable(),
    slopeKgPerWeek: z.number().nullable(),
    /** Pesagens das últimas 8 semanas (check-in de domingo), da mais antiga à mais nova. */
    history: z.array(z.object({ date: z.iso.date(), kg: z.number() })).max(8),
    lastChangeKg: z.number().nullable(),
    daysSinceLast: z.number().int().nullable(),
  }),
});

export const nutritionFollowUpInputSchema = z.object({
  /** Refeições que o plano prevê (e o aluno costuma fazer). */
  planSlots: z.array(mealSlotSchema).max(8),
  targets: z.object({
    trainingDayKcal: z.object({ min: z.number(), max: z.number() }),
    restDayKcal: z.object({ min: z.number(), max: z.number() }),
    proteinG: z.number(),
    fiberG: z.number(),
  }),
  /** Menor meta de energia permitida (piso de segurança): o ajuste nunca passa dele. */
  energyFloorKcal: z.number(),
  goalDirection: z.enum(['LOSE', 'GAIN', 'MAINTAIN', 'NONE']),
  week: nutritionWeekSchema,
  /** Carga de treino da semana (energia gasta muda com ela). */
  loadMetrics: loadMetricsViewSchema.nullable(),
  /** Última orientação enviada sobre alimentação, para não repetir. */
  daysSinceLastFollowUp: z.number().int().nullable(),
  /** Passos combinados com o aluno que vencem agora: reavalie cada um com os dados da semana. */
  openCommitments: z.array(openCommitmentSchema).max(3),
});
export type NutritionFollowUpInput = z.infer<typeof nutritionFollowUpInputSchema>;

export const nutritionFollowUpSchema = z.object({
  status: z.enum(['ON_TRACK', 'NEEDS_ADJUSTMENT', 'NEEDS_DATA']),
  /** Leituras específicas da semana (o que está bom, o que falta), com números. */
  findings: z
    .array(
      z.object({
        topic: z.enum([
          'ENERGY',
          'PROTEIN',
          'FIBER',
          'CONSISTENCY',
          'MEAL_PATTERN',
          'WEIGHT',
          'RECOVERY',
        ]),
        statement: z.string().trim().min(10).max(260),
      }),
    )
    .max(4),
  /** Ajuste que o especialista faz agora no plano (ou nenhum). */
  adjustment: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('NONE') }),
    z.object({
      kind: z.literal('ENERGY'),
      deltaKcal: z.number().int().min(-MAX_ENERGY_STEP_KCAL).max(MAX_ENERGY_STEP_KCAL),
      reason: z.string().trim().min(10).max(240),
    }),
    z.object({
      kind: z.literal('MEAL_GUIDANCE'),
      slot: mealSlotSchema,
      guidance: z.string().trim().min(10).max(300),
      examples: z.array(z.string().trim().min(3).max(200)).min(1).max(5),
      reason: z.string().trim().min(10).max(240),
    }),
    z.object({
      kind: z.literal('REBUILD_PLAN'),
      /** Instrução objetiva para refazer a estrutura do plano alimentar de forma permanente. */
      instruction: z.string().trim().min(20).max(900),
      reason: z.string().trim().min(10).max(240),
    }),
  ]),
  /** Um passo pequeno e concreto para a próxima semana. */
  nextStep: z.string().trim().min(10).max(240),
  /** Pergunta simples para o aluno responder (opcional). */
  question: z.string().trim().max(200).nullable(),
  /** Reavaliação dos passos combinados antes (um item por compromisso em aberto). */
  commitmentReview: commitmentReviewSchema,
});
export type NutritionFollowUp = z.infer<typeof nutritionFollowUpSchema>;

export const nutritionFollowUpValidators: Validator<NutritionFollowUpInput, NutritionFollowUp>[] = [
  (input, output) => {
    const violations: Violation[] = [];
    const { adjustment } = output;
    if (adjustment.kind === 'ENERGY') {
      // Piso de segurança: o único limite fixo. Quando e quanto ajustar é decisão do nutricionista.
      const floor = Math.min(input.targets.trainingDayKcal.min, input.targets.restDayKcal.min);
      if (floor + adjustment.deltaKcal < input.energyFloorKcal) {
        violations.push({
          path: 'adjustment.deltaKcal',
          message: `o ajuste levaria a energia abaixo do piso de segurança (${input.energyFloorKcal} kcal)`,
        });
      }
    }
    violations.push(...commitmentReviewViolations(input.openCommitments, output.commitmentReview));
    if (
      output.status === 'NEEDS_ADJUSTMENT' &&
      adjustment.kind === 'NONE' &&
      output.findings.length === 0
    ) {
      violations.push({
        path: 'findings',
        message: 'ajuste pedido precisa de ao menos uma leitura',
      });
    }
    return violations;
  },
  (_input, output) => {
    const text = fold([...output.findings.map((f) => f.statement), output.nextStep].join(' '));
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

export const nutritionFollowUpTask = defineAgentTask<NutritionFollowUpInput, NutritionFollowUp>({
  id: 'nutrition.weekly_follow_up',
  role: 'Nutricionista da MOVIVO que acompanha o aluno toda semana, com visão de saúde, desempenho e rotina real. Você lê o que ele comeu, como se sentiu e como o corpo respondeu, e ajusta o plano alimentar com critério.',
  instructions: `Faça o acompanhamento nutricional da semana do aluno.

Como ler "week":
- Registro: "fullDays" são dias com 3 refeições ou mais registradas; as razões ("energyRatio", "proteinRatio", "fiberRatio") comparam a média desses dias com a meta (1 = na meta). Poucos dias completos significam pouco dado: não conclua demais.
- "daysBySlot": em quantos dias cada refeição foi registrada. Refeição do plano que quase nunca aparece é padrão a conversar (esquecimento, não gosta, não cabe na rotina), não "falha".
- "checkIn": como o aluno diz que está seguindo o plano nos dias de check-in.
- "weight": o peso entra toda semana pelo check-in de domingo. "history" traz as últimas pesagens, "lastChangeKg" a variação da última, "slopeKgPerWeek" a tendência (kg por semana) e "daysSinceLast" há quanto tempo ele não se pesa. Uma pesagem isolada oscila com água e sal: olhe a tendência. Compare com "goalDirection": perder gordura saudável é cerca de 0,25 a 1% do peso por semana; ganhar massa, 0,1 a 0,5%; manter, estável.
- Peso é leitura semanal sua: comente a evolução (ou a falta de pesagem) no retorno da semana.

Você tem autonomia para ajustar o plano alimentar quando julgar necessário: não existe regra mínima de dados ou de calendário que o impeça. Decida como um nutricionista decidiria, com o que viu, e explique o motivo.
1. ENERGY: ajuste de meta de energia de até ${MAX_ENERGY_STEP_KCAL} kcal/dia, nunca abaixo do piso de segurança ("energyFloorKcal"). Se o aluno não está seguindo o plano, o problema costuma ser adesão, não a meta: considere a orientação da refeição ou o passo seguinte antes de mexer na energia.
2. MEAL_GUIDANCE: reescrever a orientação e os exemplos de UMA refeição quando há um padrão claro (proteína baixa no jantar, refeição que some, pouca fibra). Os exemplos têm que caber na rotina e nas preferências dele ("memory", "preferences").
3. REBUILD_PLAN: refazer a ESTRUTURA do plano alimentar de forma permanente (outra distribuição de refeições, nova estratégia de energia ou de macros, cardápio que não cabe mais na vida dele). É uma mudança grande: use quando um ajuste pontual não resolve. O aluno recebe o novo PDF do plano. Escreva em "instruction" o que deve mudar e por quê, de forma objetiva. Mudança temporária ou pequena NÃO é REBUILD_PLAN.
4. NONE: quando está bom.
Com "NEEDS_DATA" (pouco registro e sem check-in), prefira conversar e convidar a registrar de um jeito fácil (foto ou texto curto) a mexer no plano, mas se a situação pedir ajuste você pode fazê-lo.

Compromissos: "openCommitments" são os passos pequenos combinados com o aluno antes. Para CADA um, preencha "commitmentReview" com o veredito (KEPT, PARTIAL ou NOT_KEPT) e a evidência nos dados da semana. Se não há compromissos, devolva a lista vazia. O novo "nextStep" é o próximo compromisso: um passo que dê para verificar nos dados.

Pense como nutricionista: além de macros, olhe variedade, fibras, hidratação, energia para o treino da semana ("loadMetrics"), contexto de vida e preferências. Não liste micronutrientes nem metas novas para o aluno: o critério é interno.

A avaliação física visual ("bodyComposition": faixa de gordura por foto, comparação e observações) é parte da leitura: cruze com o peso, as medidas e a tendência da semana antes de mexer na energia; é estimativa com margem de erro; só fale o número, em faixa, se o aluno perguntar.

Regras: 1. Leituras específicas, com números da semana. 2. "nextStep" é UM passo pequeno e concreto. 3. Sem diagnóstico, remédio, suplemento fora do plano, nem promessa de resultado. 4. Sem culpa: dia fora do plano é dado, não falha. 5. Não repita o que já foi dito se "daysSinceLastFollowUp" for baixo: traga algo novo.`,
  tier: 'REASONING',
  methodology: ['NUTRITION', 'ADHERENCE', 'RECOVERY'],
  state: [
    'identity',
    'goals',
    'nutrition',
    'body',
    'bodyComposition',
    'restrictions',
    'preferences',
    'training',
    'memory',
    'conversation',
  ],
  input: nutritionFollowUpInputSchema,
  output: nutritionFollowUpSchema,
  validators: nutritionFollowUpValidators,
  maxCorrectionRounds: 2,
});

// --- Comunicação ---------------------------------------------------------------------------

export const nutritionTalkInputSchema = z.object({
  firstName: z.string().max(60).nullable(),
  followUp: nutritionFollowUpSchema.omit({ adjustment: true }),
  /** O que mudou no plano agora (vazio quando nada mudou). */
  changed: z.object({
    energyDeltaKcal: z.number().int().nullable(),
    mealSlot: mealSlotSchema.nullable(),
    /** A estrutura do plano foi refeita e o aluno recebe o novo PDF. */
    rebuilt: z.boolean(),
  }),
});
export type NutritionTalkInput = z.infer<typeof nutritionTalkInputSchema>;

export const nutritionTalkSchema = z.object({
  messages: z.array(z.string().trim().min(1).max(420)).min(1).max(3),
});
export type NutritionTalk = z.infer<typeof nutritionTalkSchema>;

export const nutritionTalkValidators: Validator<NutritionTalkInput, NutritionTalk>[] = [
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

export const nutritionTalkTask = defineAgentTask<NutritionTalkInput, NutritionTalk>({
  id: 'communication.nutrition_follow_up',
  role: 'Quem acompanha o aluno de perto pelo WhatsApp (a persona da MOVIVO). Você conversa sobre a alimentação dele como alguém que acompanha de verdade: reconhece o que está bom, explica o que viu e dá um passo pequeno.',
  instructions: `Escreva 1 a 3 mensagens curtas de WhatsApp com o retorno nutricional da semana, a partir da leitura do especialista ("followUp").

Regras:
1. Comece pelo que está bom (use um fato de "findings"). Se "firstName" existir, use-o uma vez.
2. Explique o que o especialista viu em linguagem simples, uma coisa por vez. Comente a evolução do peso da semana quando "followUp" trouxer (ou a falta de pesagem). Se "changed" traz um ajuste (energia ou refeição), conte o que mudou no plano e por quê, em poucas palavras. Se "changed.rebuilt" for verdadeiro, conte que o plano alimentar foi refeito e que o novo PDF está indo para ele.
2b. Se "followUp.commitmentReview" tiver itens, reconheça o que foi cumprido (KEPT) com um fato, e trate o resto sem cobrança (o que atrapalhou, o que dá para ajustar).
3. Termine com o "nextStep" e, se houver, a "question" (uma pergunta só, fácil de responder).
4. Sem numerologia desnecessária, sem culpa, sem lista de nutrientes, sem remédio ou diagnóstico, sem promessa de resultado.`,
  tier: 'STANDARD',
  methodology: ['COMMUNICATION'],
  state: ['identity', 'memory', 'conversation'],
  input: nutritionTalkInputSchema,
  output: nutritionTalkSchema,
  validators: nutritionTalkValidators,
  maxCorrectionRounds: 2,
});
