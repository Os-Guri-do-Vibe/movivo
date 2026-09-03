/**
 * Protocolo de treino — DTO de contrato (US-2.1 / TASK-2.1.2).
 *
 * Fonte única de verdade do shape do `ProtocolStructure` — a saída da geração por IA
 * (US-2.1), o que o `ValidationService` (US-2.3) veta, o que o Worker (US-2.4) persiste
 * e o que a página read-only (US-2.6) renderiza.
 *
 * Decisão do fundador (2026-07): o protocolo é **planejado pela IA** (não por um motor
 * determinístico), com autonomia para individualizar, mas restrito ao vocabulário da
 * base de referência e sob a metodologia do RT CREF. A **garantia** de segurança é do
 * `ValidationService` (US-2.3), não deste schema — aqui só garantimos a FORMA (parseável
 * e tipada); a semântica segura (exercício existe, carga plausível) é vetada na US-2.3.
 */
import { z } from 'zod';

import { ProtocolApprovalStatus, ProtocolStatus } from '../enums';
import { generationGoalSchema, weekdaySchema } from './anamnesis.schema';
import { uuidSchema } from './common.schema';

/**
 * Fase de periodização (Rafael §5.2 `TrainingPhase`). A IA escolhe a fase inicial
 * coerente com objetivo/nível; a progressão entre fases é da geração/ajuste futuro.
 */
export const trainingPhaseSchema = z.enum(['ADAPTACAO', 'HIPERTROFIA', 'FORCA', 'DELOAD']);
export type TrainingPhase = z.infer<typeof trainingPhaseSchema>;

/** Rótulos exibidos (a UI não inventa texto de fase — mesmo padrão de `PRIMARY_GOAL_LABELS`). */
export const TRAINING_PHASE_LABELS: Readonly<Record<TrainingPhase, string>> = {
  ADAPTACAO: 'Adaptação',
  HIPERTROFIA: 'Hipertrofia',
  FORCA: 'Força',
  DELOAD: 'Recuperação (deload)',
};

/**
 * Estratégia de carga (Rafael §5.2 `WeightStrategy`). `DOUBLE_PROGRESSION` = sobe repetição
 * até o topo da faixa, depois sobe carga (dupla progressão). `RPE` = por percepção de esforço.
 */
export const loadStrategySchema = z.enum(['BODYWEIGHT', 'FIXED_LOAD', 'DOUBLE_PROGRESSION', 'RPE']);
export type LoadStrategy = z.infer<typeof loadStrategySchema>;

/**
 * Rótulos exibidos da estratégia de carga (coluna "Estratégia", ao lado de "Técnica" — dado
 * de treino como qualquer outro, exibido no dashboard do CREF e no PDF enviado ao aluno; a
 * conversa com o AI Coach complementa, não substitui a exibição).
 */
export const LOAD_STRATEGY_LABELS: Readonly<Record<LoadStrategy, string>> = {
  BODYWEIGHT: 'Peso corporal',
  FIXED_LOAD: 'Carga fixa',
  DOUBLE_PROGRESSION: 'Progressão de carga',
  RPE: 'Percepção de esforço (RPE)',
};

/**
 * Divisão de treino (metodologia do RT CREF, item 1). O RT **não usa divisão fixa**: escolhe
 * conforme objetivo, nível, condicionamento, disponibilidade semanal, histórico de lesão e
 * recuperação. `FOCO_MUSCULAR` = "um ou dois grupos musculares por dia".
 *
 * Opcional no schema: protocolos gerados antes da v2 da metodologia (e o template de fallback)
 * não têm o campo, e ausência não é insegura — o que é inseguro é uma divisão INCOERENTE com o
 * nível, e isso o `ValidationService` (US-2.3) veta quando o campo está presente.
 */
export const workoutSplitSchema = z.enum([
  'FULL_BODY',
  'CIRCUITO',
  'UPPER_LOWER',
  'ABC',
  'ABCD',
  'ABCDE',
  'PUSH_PULL_LEGS',
  'FOCO_MUSCULAR',
]);
export type WorkoutSplit = z.infer<typeof workoutSplitSchema>;

/**
 * Técnica avançada por exercício (metodologia do RT CREF, item 4). O RT foi explícito:
 * são "principalmente para intermediários e avançados" e "não precisam aparecer em todos os
 * exercícios ou em todos os treinos". Opcional/ausente = série tradicional (o padrão).
 */
export const advancedTechniqueSchema = z.enum([
  'DROP_SET',
  'REST_PAUSE',
  'CLUSTER_SET',
  'BI_SET',
  'TRI_SET',
  'SUPERSET',
  'ISOMETRIA',
  'REPETICOES_CONTROLADAS',
  'PIRAMIDE',
  'DESCANSO_ATIVO',
]);
export type AdvancedTechnique = z.infer<typeof advancedTechniqueSchema>;

/** Rótulos exibidos da técnica avançada (coluna "Estratégia" da página do protocolo). */
export const ADVANCED_TECHNIQUE_LABELS: Readonly<Record<AdvancedTechnique, string>> = {
  DROP_SET: 'Drop-set',
  REST_PAUSE: 'Rest-pause',
  CLUSTER_SET: 'Cluster set',
  BI_SET: 'Bi-set',
  TRI_SET: 'Tri-set',
  SUPERSET: 'Superset',
  ISOMETRIA: 'Isometria',
  REPETICOES_CONTROLADAS: 'Repetições controladas',
  PIRAMIDE: 'Pirâmide',
  DESCANSO_ATIVO: 'Descanso ativo',
};

/** Faixa de repetições (Rafael §5.2 `RepsRange`). `min <= max` validado no superRefine. */
export const repsRangeSchema = z
  .object({
    min: z.number().int().min(1).max(100),
    max: z.number().int().min(1).max(100),
  })
  .refine((r) => r.min <= r.max, { message: 'repsRange.min não pode ser maior que max.' });
export type RepsRange = z.infer<typeof repsRangeSchema>;

/**
 * Bloco de série de AQUECIMENTO/preparação (achado 2026-08-22, decisão do fundador,
 * item 8), com range de repetições/duração e nº de séries PRÓPRIOS — tipicamente mais
 * leve e/ou com mais repetições que as séries válidas do exercício (`sets`/`reps`/
 * `durationSeconds` em `ProtocolExercise`, que continuam representando só as séries
 * válidas). `reps` XOR `durationSeconds`, mesma regra do exercício.
 */
export const warmupSetBlockSchema = z
  .object({
    sets: z.number().int().min(1).max(6),
    reps: repsRangeSchema.optional(),
    durationSeconds: z.number().int().min(5).max(2400).optional(),
    restSeconds: z.number().int().min(0).max(600).optional(),
  })
  .refine((b) => (b.reps !== undefined) !== (b.durationSeconds !== undefined), {
    message: 'Bloco de aquecimento deve ter "reps" OU "durationSeconds", nunca os dois nem nenhum.',
  });
export type WarmupSetBlock = z.infer<typeof warmupSetBlockSchema>;

/**
 * Um exercício prescrito na sessão. `exerciseId` referencia a base de referência
 * (o validador US-2.3 rejeita id fora do catálogo — aqui é só string tipada).
 *
 * `reps` XOR `durationSeconds` (achado 2026-08-18): nem todo exercício da base é
 * sets×reps. Isométrico (prancha) e cardio contínuo/intervalado (caminhada, bike,
 * tiros) são prescritos por TEMPO — antes deste campo existir, o schema forçava a
 * IA a inventar um "reps" pra prancha e o `ValidationService` rejeitava (com razão)
 * o resultado, empurrando o protocolo pra revisão humana sempre que a IA escolhia
 * um exercício desse tipo. `CatalogExercise.measurement` (exercise-catalog.ts) diz
 * qual dos dois campos o exercício usa.
 */
export const protocolExerciseSchema = z
  .object({
    exerciseId: z.string().trim().min(1).max(80),
    name: z.string().trim().min(1).max(120),
    /**
     * Séries de aquecimento/preparação ANTES das séries válidas abaixo (achado
     * 2026-08-22, item 8) — range e nº de séries próprios, tipicamente mais leve.
     * Aditivo de propósito: protocolo sem este campo é 100% válido (não tinha
     * aquecimento explícito — o RT decide quando faz sentido, não é obrigatório em
     * todo exercício) e não precisa de migração nenhuma.
     */
    warmupBlocks: z.array(warmupSetBlockSchema).max(4).optional(),
    sets: z.number().int().min(1).max(12),
    reps: repsRangeSchema.optional(),
    /** Segundos por série/intervalo. Só para exercício de medida DURATION. */
    durationSeconds: z.number().int().min(5).max(2400).optional(),
    loadStrategy: loadStrategySchema,
    restSeconds: z.number().int().min(0).max(600),
    /** Técnica avançada aplicada nesta prescrição. Ausente = série tradicional. */
    technique: advancedTechniqueSchema.optional(),
    /**
     * Repetições em Reserva (achado 2026-08-19, a pedido do fundador): quantas
     * repetições o aluno ainda teria "no tanque" ao fim da série (0 = falha
     * concêntrica). A IA prescreve; opcional porque protocolos anteriores a este
     * campo e o template de fallback (não gerado por IA) não o têm.
     */
    rir: z.number().int().min(0).max(5).optional(),
    /**
     * Link de vídeo de execução (achado 2026-08-19): não existe catálogo de vídeos
     * curados nem geração automática — sempre ausente até o RT colar um link na
     * edição do protocolo. Nunca preenchido pela IA (evita alucinar URL quebrada).
     */
    videoUrl: z.url().max(500).optional(),
    notes: z.string().trim().max(400).optional(),
  })
  .refine((ex) => (ex.reps !== undefined) !== (ex.durationSeconds !== undefined), {
    message: 'Exercício deve ter "reps" OU "durationSeconds", nunca os dois nem nenhum.',
  });
export type ProtocolExercise = z.infer<typeof protocolExerciseSchema>;

/**
 * Uma sessão de treino (um "dia"). `focus` = grupo/tema (ex.: "Membros inferiores").
 *
 * `weekday` (achado 2026-08-18, decisão do fundador): o dia real da semana em que o
 * aluno treina (`MON`..`SUN`, mesmo enum de `preferredDays` na anamnese) — antes disso a
 * IA gerava sessões genéricas sem vínculo com a rotina declarada, podendo entregar 1
 * sessão só pra um aluno de 4x/semana. `.optional()` porque protocolos persistidos antes
 * deste campo existir não o têm — nunca quebra o parse de conteúdo antigo.
 */
export const protocolSessionSchema = z.object({
  dayLabel: z.string().trim().min(1).max(60),
  weekday: weekdaySchema.optional(),
  focus: z.string().trim().min(1).max(120),
  exercises: z.array(protocolExerciseSchema).min(1).max(15),
});
export type ProtocolSession = z.infer<typeof protocolSessionSchema>;

/**
 * O protocolo completo gerado. `promptVersion`/`generatedByModel` dão rastreabilidade
 * clínica da geração (qual metodologia/modelo produziu este treino).
 */
export const protocolStructureSchema = z.object({
  promptVersion: z.string().trim().min(1).max(80),
  goal: generationGoalSchema,
  phase: trainingPhaseSchema,
  /** Divisão escolhida para este perfil. Ausente em protocolos anteriores à metodologia v2. */
  splitType: workoutSplitSchema.optional(),
  weeklyFrequency: z.number().int().min(1).max(7),
  sessions: z.array(protocolSessionSchema).min(1).max(7),
  generalNotes: z.string().trim().max(1000).optional(),
  /**
   * Duração do mesociclo/fase ATUAL, em semanas — decidida pela IA dentro da faixa
   * baseada em evidência para a fase escolhida (achado 2026-09-02, correção do fundador:
   * `total_weeks`/`end_date` do protocolo vinham de um padrão estático de 12 semanas,
   * sem nenhuma relação com a fase real do bloco — ver `PHASE_DURATION_WEEKS_RANGE` em
   * `protocol-timeline.ts`, apps/api). Faixa larga aqui (1-8) é só FORMA; o teto/piso por
   * fase é semântica de segurança, vetada pelo `ValidationService`, não por este schema.
   */
  phaseDurationWeeks: z.number().int().min(1).max(8),
});
export type ProtocolStructure = z.infer<typeof protocolStructureSchema>;

/**
 * DTO de LEITURA read-only por token (US-2.6). É o que o endpoint público
 * `GET /protocols/by-token/:token` devolve e o que a página `/protocolo/[token]`
 * renderiza. Nunca inclui `userId`/PII: o token (UUID do protocolo) é o único
 * segredo, e a projeção do repositório não seleciona a coluna de titular (IDOR-safe).
 */
export const protocolReadSchema = z.object({
  content: protocolStructureSchema,
  status: z.enum(ProtocolStatus),
  approvalStatus: z.enum(ProtocolApprovalStatus),
  professionalId: uuidSchema.nullable(),
  signatureHash: z.string().trim().min(1).nullable(),
  signedAt: z.iso.datetime().nullable(),
  totalWeeks: z.number().int().min(1).max(52),
  currentWeek: z.number().int().min(1).max(52),
  /** Nome do bloco de periodização vigente (ex.: "Mesociclo 1 — Hipertrofia"). */
  mesocycleName: z.string().trim().min(1).max(120),
  /** Início e fim do mesociclo vigente. `endDate` = `startDate` + `totalWeeks` semanas. */
  startDate: z.iso.datetime(),
  endDate: z.iso.datetime(),
});
export type ProtocolRead = z.infer<typeof protocolReadSchema>;
