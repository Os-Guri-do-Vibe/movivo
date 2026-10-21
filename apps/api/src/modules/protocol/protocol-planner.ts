/**
 * Planner do pipeline "gera-e-valida" (US-2.4 / TASK-2.4.3) — a decisão pura, sem I/O de
 * banco/fila, para ser testável com fakes do gerador/validador (mocks-first).
 *
 * Fluxo (revisão 2026-09-29 — redução de fallback, medição do Victor):
 *   1. gera → valida (erro de geração aqui continua lançando: o job re-tenta, como antes);
 *   2. BLOCK → até `MAX_CORRECTION_ROUNDS` rodadas de CORREÇÃO: o modelo recebe o próprio
 *      JSON reprovado + a lista estruturada do que violou (`buildCorrectionMessage`) e
 *      devolve o protocolo reparado → revalida. A 2ª tentativa antiga regenerava com o
 *      prompt idêntico, sem dizer o que estava errado, e o modelo repetia o erro. Erro de
 *      geração (`ProtocolGenerationError`) numa rodada de correção NÃO relança o job: conta
 *      como bloqueio e segue para o passo 3 com a última saída válida;
 *   3. ainda BLOCK → reparo determinístico (`deterministicRepair`) sobre a ÚLTIMA saída, só
 *      se TODAS as violações BLOCK forem mecânicas — e sempre revalidado no validador inteiro;
 *   4. nada disso limpou → template pré-aprovado do RT.
 *
 * Qualidade contextual compartilha o orçamento de correções. Pendências não resolvidas
 * preservam o rascunho válido para revisão obrigatória, sem provocar template por si só.
 *
 * Decisão do fundador (2026-08-18): **todo** protocolo gerado — PASS limpo, FLAG do
 * validador, reparado ou BLOCK persistente caindo no template — entra na Fila do
 * Profissional como `PENDING_REVIEW`, nunca entrega sozinho na hora.
 *
 * Quem decide `OPTIONAL` vs `MANDATORY` é o `ProtocolGenerationWorker`
 * (`reviewUrgencyForPlan`), não este arquivo — aqui só devolvemos `usedFallbackTemplate` e
 * `repairs`.
 */
import type { ProtocolStructure } from '@movivo/shared';
import type { ContextualQualityAssessment, ContextualQualitySummary } from './contextual-quality';

import {
  type GenerateProtocolCommand,
  type GenerateProtocolResult,
  ProtocolGenerationError,
} from './protocol-generator.service';
import {
  deterministicRepair,
  type DeterministicRepairCode,
} from './validation/deterministic-repair';
import { countCautionExercises } from './protocol-caution';
import { buildFallbackProtocol, FALLBACK_TEMPLATE_VERSION } from './validation/fallback-template';
import { VALIDATION_RULES_VERSION } from './validation/validation-rules';
import type {
  ValidateProtocolInput,
  ValidationService,
  ValidationVerdict,
  ValidationViolation,
} from './validation/validation.service';

/** Rodadas de correção com feedback depois da 1ª geração (máx. 1 + 2 = 3 gerações). */
export const MAX_CORRECTION_ROUNDS = 2;

/**
 * Versão do pipeline gera-e-valida (prompt de regras verificadas + correção com feedback +
 * reparo determinístico). Vai no log e no rastro persistido — `promptVersion` só carrega
 * metodologia+catálogo e não muda quando o código do prompt/planner muda.
 */
export const PROTOCOL_PIPELINE_VERSION = 'protocol-pipeline-2026-10-v6';

export interface ProtocolGenerator {
  generate(command: GenerateProtocolCommand): Promise<GenerateProtocolResult>;
  assessQuality(
    command: GenerateProtocolCommand,
    generated: GenerateProtocolResult,
  ): Promise<ContextualQualityAssessment>;
}

/** Logger mínimo (pino) — opcional para os scripts ad-hoc que chamam o planner sem Nest. */
export type PlanLogger = { info(obj: object, msg?: string): void };

export type PlanAttemptOutcome = 'PASS' | 'FLAG' | 'BLOCK' | 'GENERATION_ERROR';

/** Uma geração (1ª/correção). `outcome` é determinístico; qualidade tem código separado. */
export interface PlanAttempt {
  attempt: number;
  kind: 'GENERATION' | 'CORRECTION';
  outcome: PlanAttemptOutcome;
  /** Códigos de regra únicos (BLOCK e FLAG), na ordem em que o validador os emitiu. */
  rules: string[];
  malformedRetries: number;
  contextualQuality?: ContextualQualitySummary['status'];
}

export type RepairOutcome = 'NOT_NEEDED' | 'NOT_ELIGIBLE' | 'APPLIED' | 'REJECTED_BY_REVALIDATION';

/**
 * Rastro da geração — persistido junto do protocolo (`protocol_versions.diff` da versão 1)
 * e logado em `protocol.plan.summary`. Sem PII: só códigos, contagens e versões.
 */
export interface ProtocolGenerationTrace {
  type: 'GENERATION_TRACE';
  pipelineVersion: string;
  validationRulesVersion: string;
  promptVersion: string;
  attempts: PlanAttempt[];
  corrections: number;
  malformedRetries: number;
  repairOutcome: RepairOutcome;
  /** Ajustes automáticos aplicados ao conteúdo final — base do selo "ajustado automaticamente". */
  repairs: DeterministicRepairCode[];
  finalAction: string;
  finalRules: string[];
  usedFallbackTemplate: boolean;
  durationMs: number;
  contextualQuality?: ContextualQualitySummary;
}

export interface PlanResult {
  content: ProtocolStructure;
  /** Origem para rastreabilidade (`generated_by`/`model_version`/`prompt_version`). */
  generatedBy: string;
  modelVersion: string | null;
  promptVersion: string;
  knowledgeSources: NonNullable<GenerateProtocolResult['knowledgeSources']>;
  methodologyVersionId: string | null;
  methodologySha256: string | null;
  validationAction: string;
  usedFallbackTemplate: boolean;
  /**
   * Motivo real da última verificação (achado 2026-08-18: sem isso, um protocolo que
   * caiu no template de fallback não deixava rastro nenhum de POR QUE — nem em log).
   * Vazio em `PASS` limpo. No template: 1ª tentativa + última, para ver se repetiu.
   */
  violations: readonly ValidationViolation[];
  /** Reparos determinísticos aplicados ao `content` (vazio quando não houve). */
  repairs: DeterministicRepairCode[];
  /**
   * Exercícios do conteúdo que carregam uma região de dor sem veto (`cautionTags`). Ausente/0 =
   * nenhum. Entra na urgência de revisão (`reviewUrgencyForPlan`).
   */
  cautionExercises?: number;
  attempts: PlanAttempt[];
  trace: ProtocolGenerationTrace;
  contextualQuality?: ContextualQualitySummary;
}

const uniqueRules = (violations: readonly ValidationViolation[]): string[] => [
  ...new Set(violations.map((v) => v.rule)),
];

export async function planProtocol(
  generator: ProtocolGenerator,
  validation: ValidationService,
  command: GenerateProtocolCommand,
  logger?: PlanLogger,
): Promise<PlanResult> {
  const startedAt = Date.now();
  const constraints: ValidateProtocolInput['constraints'] = {
    goal: command.constraints.goal,
    injuryTags: command.constraints.injuryTags,
    ...(command.constraints.cautionTags ? { cautionTags: command.constraints.cautionTags } : {}),
    // v2: o validador precisa do nível para vetar divisão/técnica acima dele (US-2.3).
    level: command.constraints.level,
    // Achado 2026-08-18: sem isso, o validador NUNCA recebia `preferredDays` (só o
    // gerador recebia, via `command.constraints` inteiro) — a regra de sessão-por-dia
    // nunca disparava de verdade, só nos testes que chamam `validate()` direto.
    preferredDays: command.constraints.preferredDays,
    // Achado 2026-10-15: meta e TETO de sessões semanais — sem isto a contagem era cobrada
    // contra os dias preferidos, e 4 disponíveis + 7 preferidos virava 7 sessões.
    daysPerWeek: command.constraints.daysPerWeek,
    // Revisão controla esforço e aprovação, não fase nem nível.
    requiresProfessionalReview: command.constraints.requiresProfessionalReview,
  };
  // Achado 2026-08-24: `parqFlags` nunca chegava ao validador por aqui (só o painel
  // passava, ao reeditar/assinar). Sem isto `checkParq` seria letra morta no caminho
  // que mais precisa dele.
  const parqFlags = command.constraints.parqTags;
  const validate = (structure: ProtocolStructure): ValidationVerdict =>
    validation.validate({ structure, constraints, parqFlags });

  const attempts: PlanAttempt[] = [];
  const record = (
    kind: PlanAttempt['kind'],
    outcome: PlanAttemptOutcome,
    violations: readonly ValidationViolation[],
    malformedRetries: number,
  ): void => {
    const attempt: PlanAttempt = {
      attempt: attempts.length + 1,
      kind,
      outcome,
      rules: uniqueRules(violations),
      malformedRetries,
      ...(quality && quality.summary.status !== 'PASS'
        ? { contextualQuality: quality.summary.status }
        : {}),
    };
    attempts.push(attempt);
    logger?.info(
      { event: 'protocol.plan.attempt', userId: command.userId, ...attempt },
      'protocol.plan.attempt',
    );
  };

  // 1ª geração: erro aqui continua subindo (retry do job/DLQ, contrato inalterado).
  let quality: ContextualQualityAssessment | undefined;
  // Segurança clínica (PAR-Q) decide se o CREF precisa assinar; qualidade contextual é uma
  // etapa diferente e vale para todo titular. Quando encontra lacunas, a própria metodologia
  // orienta as rodadas de correção abaixo. Sem PAR-Q, uma lacuna que persista continua sendo
  // sinalizada, mas não muda a política de auto-liberação do worker.
  const assessContextualQuality = true;
  let gen = await generator.generate(command);
  let verdict = validate(gen.structure);
  if (assessContextualQuality && verdict.action !== 'BLOCK_FALLBACK')
    quality = await generator.assessQuality(command, gen);
  let lastValid = verdict.action !== 'BLOCK_FALLBACK' ? { gen, verdict, quality } : undefined;
  const firstVerdict = verdict;
  record('GENERATION', verdict.code, verdict.violations, gen.malformedRetries ?? 0);

  let corrections = 0;
  while (
    (verdict.action === 'BLOCK_FALLBACK' || quality?.summary.status === 'GAPS') &&
    corrections < MAX_CORRECTION_ROUNDS
  ) {
    corrections++;
    let next: GenerateProtocolResult;
    try {
      next = await generator.generate({
        ...command,
        correction: {
          previous: gen.structure,
          ...(gen.planning ? { planning: gen.planning } : {}),
          violations: verdict.violations,
          round: corrections,
          ...(quality ? { quality } : {}),
        },
      });
    } catch (error) {
      if (!(error instanceof ProtocolGenerationError)) throw error;
      // Saída irreparavelmente malformada numa correção: conta como bloqueio e segue para
      // o reparo/fallback com a última saída válida — sem relançar o job.
      record('CORRECTION', 'GENERATION_ERROR', [], 1);
      break;
    }
    gen = next;
    verdict = validate(gen.structure);
    quality =
      assessContextualQuality && verdict.action !== 'BLOCK_FALLBACK'
        ? await generator.assessQuality(command, gen)
        : undefined;
    if (verdict.action !== 'BLOCK_FALLBACK') lastValid = { gen, verdict, quality };
    record('CORRECTION', verdict.code, verdict.violations, gen.malformedRetries ?? 0);
  }

  // Uma correção de qualidade pode piorar a segurança. Não descarte o rascunho
  // individualizado que já passou nas regras para substituí-lo por um template.
  if (verdict.action === 'BLOCK_FALLBACK' && lastValid) {
    ({ gen, verdict, quality } = lastValid);
  }

  let content = gen.structure;
  let repairs: DeterministicRepairCode[] = [];
  let repairOutcome: RepairOutcome = 'NOT_NEEDED';
  let finalVerdict = verdict;

  if (verdict.action === 'BLOCK_FALLBACK') {
    const repaired = deterministicRepair(gen.structure, verdict.violations, {
      preferredDays: command.constraints.preferredDays,
      daysPerWeek: command.constraints.daysPerWeek,
      parqFlags,
      // Lookup preguiçoso no MESMO catálogo-gabarito do validador (só o reparo de nome usa).
      catalog: { getById: (id) => validation.exerciseById(id) },
    });
    if (!repaired) {
      repairOutcome = 'NOT_ELIGIBLE';
    } else {
      const revalidated = validate(repaired.structure);
      finalVerdict = revalidated;
      if (revalidated.action === 'BLOCK_FALLBACK') {
        repairOutcome = 'REJECTED_BY_REVALIDATION';
      } else {
        repairOutcome = 'APPLIED';
        content = repaired.structure;
        repairs = repaired.repairs;
        if (assessContextualQuality)
          quality = await generator.assessQuality(command, { ...gen, structure: content });
      }
    }
  }

  const usedFallbackTemplate = finalVerdict.action === 'BLOCK_FALLBACK';
  if (usedFallbackTemplate) quality = undefined;
  const promptVersion = usedFallbackTemplate ? FALLBACK_TEMPLATE_VERSION : gen.promptVersion;
  const qualityPending = quality !== undefined && quality.summary.status !== 'PASS';
  const validationAction = usedFallbackTemplate
    ? 'BLOCK'
    : qualityPending
      ? 'FLAG'
      : finalVerdict.code;
  const trace: ProtocolGenerationTrace = {
    type: 'GENERATION_TRACE',
    pipelineVersion: PROTOCOL_PIPELINE_VERSION,
    validationRulesVersion: VALIDATION_RULES_VERSION,
    promptVersion,
    attempts,
    corrections,
    malformedRetries: attempts.reduce((sum, a) => sum + a.malformedRetries, 0),
    repairOutcome,
    repairs,
    finalAction: validationAction,
    finalRules: uniqueRules(finalVerdict.violations),
    usedFallbackTemplate,
    durationMs: Date.now() - startedAt,
    ...(quality ? { contextualQuality: quality.summary } : {}),
  };
  logger?.info(
    {
      event: 'protocol.plan.summary',
      userId: command.userId,
      attempts: attempts.length,
      corrections,
      malformedRetries: trace.malformedRetries,
      deterministicRepairs: repairs,
      repairOutcome,
      firstAttemptRules: uniqueRules(firstVerdict.violations),
      finalRules: trace.finalRules,
      finalAction: validationAction,
      usedFallbackTemplate,
      durationMs: trace.durationMs,
      promptVersion,
      pipelineVersion: PROTOCOL_PIPELINE_VERSION,
      validationRulesVersion: VALIDATION_RULES_VERSION,
      ...(quality ? { contextualQuality: quality.summary } : {}),
    },
    'protocol.plan.summary',
  );

  if (usedFallbackTemplate) {
    // Persistiu o bloqueio em todas as tentativas (e o reparo não resolveu) → template
    // pré-aprovado pelo RT.
    return {
      content: buildFallbackProtocol(
        command.constraints.goal,
        command.constraints.preferredDays,
        command.constraints.daysPerWeek,
      ),
      generatedBy: 'FALLBACK_TEMPLATE',
      modelVersion: null,
      promptVersion: FALLBACK_TEMPLATE_VERSION,
      knowledgeSources: [],
      methodologyVersionId: null,
      methodologySha256: null,
      validationAction: 'BLOCK',
      usedFallbackTemplate: true,
      // A última (`verdict`) decidiu o fallback; a 1ª ajuda a ver se o problema repetiu.
      violations:
        verdict === firstVerdict
          ? [...verdict.violations]
          : [...firstVerdict.violations, ...verdict.violations],
      repairs: [],
      attempts,
      trace,
      ...(quality ? { contextualQuality: quality.summary } : {}),
    };
  }

  const cautionExercises = countCautionExercises(content, command.constraints.cautionTags, {
    getById: (id) => validation.exerciseById(id),
  });
  return {
    content,
    ...(cautionExercises > 0 ? { cautionExercises } : {}),
    generatedBy: gen.provider,
    modelVersion: gen.model,
    promptVersion: gen.promptVersion,
    knowledgeSources: gen.knowledgeSources ?? [],
    methodologyVersionId: gen.methodologyVersionId ?? null,
    methodologySha256: gen.methodologySha256 ?? null,
    // PASS ou FLAG_HUMAN_REVIEW — os dois entram na fila igual (só o `validationAction`
    // e as `violations` distinguem um do outro pro painel).
    validationAction,
    usedFallbackTemplate: false,
    violations: finalVerdict.violations,
    repairs,
    attempts,
    trace,
    ...(quality ? { contextualQuality: quality.summary } : {}),
  };
}
