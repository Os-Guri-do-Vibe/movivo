/**
 * Anamnese — DTOs de contrato (US-1.3 / TASK-1.3.1). Fonte única de verdade do
 * shape dos 3 blocos e do PAR-Q, consumida pelo backend (`AnamnesisController`)
 * e pelo frontend (US-1.6).
 *
 * Estrutura (Sofia §§8-9):
 *  - Bloco 1: identificação — nome, telefone (E.164), e-mail. Dado pessoal comum.
 *  - Bloco 2: saúde — PAR-Q (Q1..Q9), lesões, medicação contínua. **Dado sensível
 *    (LGPD Art. 11)**: cifrado em repouso e barrado sem consentimento de saúde.
 *  - Bloco 3: rotina — disponibilidade semanal e equipamentos. Dado pessoal comum.
 *
 * O PAR-Q usa o conjunto autoritativo `parq-2026-07-v1` (Alexandre §2). A avaliação
 * de risco é 100% determinística no backend (`evaluateParq`), nunca por IA.
 */
import { z } from 'zod';

/** Objetivo pré-qualificado na landing (chip de 1 clique — Sofia §9.1). */
export const primaryGoalSchema = z.enum(['LOSE_WEIGHT', 'GAIN_MUSCLE', 'CONDITIONING']);
export type PrimaryGoal = z.infer<typeof primaryGoalSchema>;

/** Telefone em E.164 (`+5511999999999`) — identificador funcional do produto. */
export const phoneE164Schema = z
  .string()
  .regex(
    /^\+[1-9]\d{7,14}$/,
    'Telefone deve estar em formato internacional E.164 (ex.: +5511999999999).',
  );

// ---------------------------------------------------------------------------
// PAR-Q (conjunto autoritativo `parq-2026-07-v1` — Alexandre §2.1)
// ---------------------------------------------------------------------------

/** Identificador imutável do conjunto de perguntas. Trava a versão exibida↔avaliada. */
export const PARQ_VERSION = 'parq-2026-07-v1';

/** As 9 perguntas oficiais. Toda binária (Não/Sim); Q9 exige motivo quando "Sim". */
export const PARQ_QUESTION_IDS = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9'] as const;
export type ParqQuestionId = (typeof PARQ_QUESTION_IDS)[number];

/** Uma resposta do PAR-Q. `answer=true` é o "Sim" (resposta de risco). */
export const parqAnswerSchema = z.object({
  questionId: z.enum(PARQ_QUESTION_IDS),
  answer: z.boolean(),
  /** Follow-up opcional ("Conta um pouco mais?"). Obrigatório em Q9=Sim. */
  detail: z.string().trim().max(500).optional(),
});
export type ParqAnswer = z.infer<typeof parqAnswerSchema>;

/** Conjunto completo: exatamente uma resposta por pergunta Q1..Q9. */
export const parqSchema = z
  .object({
    version: z.literal(PARQ_VERSION),
    answers: z.array(parqAnswerSchema).length(9),
  })
  .superRefine((val, ctx) => {
    const ids = new Set(val.answers.map((a) => a.questionId));
    for (const id of PARQ_QUESTION_IDS) {
      if (!ids.has(id)) {
        ctx.addIssue({ code: 'custom', message: `Resposta ausente para ${id}.` });
      }
    }
    // Q9 = "Sim" precisa de motivo (Alexandre §2.1: campo obrigatório).
    const q9 = val.answers.find((a) => a.questionId === 'Q9');
    if (q9?.answer === true && !q9.detail) {
      ctx.addIssue({ code: 'custom', message: 'Q9 marcada como "Sim" exige o motivo.' });
    }
  });
export type Parq = z.infer<typeof parqSchema>;

// ---------------------------------------------------------------------------
// Blocos
// ---------------------------------------------------------------------------

export const anamnesisBlock1Schema = z.object({
  name: z.string().trim().min(2).max(120),
  phoneNumber: phoneE164Schema,
  email: z.email().max(255).optional(),
});
export type AnamnesisBlock1 = z.infer<typeof anamnesisBlock1Schema>;

/** -- LGPD Art. 11: dado sensível de saúde. Cifrado em repouso; gated por consentimento. */
export const anamnesisBlock2Schema = z.object({
  parq: parqSchema,
  injuries: z.array(z.string().trim().max(60)).max(20).optional(),
  continuousMedication: z.string().trim().max(500).optional(),
});
export type AnamnesisBlock2 = z.infer<typeof anamnesisBlock2Schema>;

export const anamnesisBlock3Schema = z.object({
  daysPerWeek: z.number().int().min(1).max(7),
  sessionMinutes: z.number().int().min(10).max(240).optional(),
  location: z.enum(['HOME', 'GYM', 'BOTH']).optional(),
  equipment: z.array(z.string().trim().max(40)).max(30).optional(),
});
export type AnamnesisBlock3 = z.infer<typeof anamnesisBlock3Schema>;

/** Seleciona o schema do bloco `n` (1|2|3). Usado pelo `PATCH .../block/{n}`. */
export const anamnesisBlockSchemas = {
  1: anamnesisBlock1Schema,
  2: anamnesisBlock2Schema,
  3: anamnesisBlock3Schema,
} as const;

// ---------------------------------------------------------------------------
// Contratos de request/response
// ---------------------------------------------------------------------------

export const startAnamnesisSchema = z.object({
  primaryGoal: primaryGoalSchema.optional(),
});
export type StartAnamnesisInput = z.infer<typeof startAnamnesisSchema>;
