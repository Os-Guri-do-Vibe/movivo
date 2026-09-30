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
 * Nenhuma regra do validador mudou nesta revisão: todas as violações da linha de base eram
 * verdadeiros positivos ou erro de prompt (Victor, 83 execuções reais).
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

import {
  type GenerateProtocolCommand,
  type GenerateProtocolResult,
  ProtocolGenerationError,
} from './protocol-generator.service';
import {
  deterministicRepair,
  type DeterministicRepairCode,
} from './validation/deterministic-repair';
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
export const PROTOCOL_PIPELINE_VERSION = 'protocol-pipeline-2026-09-v2';

export interface ProtocolGenerator {
  generate(command: GenerateProtocolCommand): Promise<GenerateProtocolResult>;
}

/** Logger mínimo (pino) — opcional para os scripts ad-hoc que chamam o planner sem Nest. */
export type PlanLogger = { info(obj: object, msg?: string): void };

export type PlanAttemptOutcome = 'PASS' | 'FLAG' | 'BLOCK' | 'GENERATION_ERROR';

/** Uma geração do modelo (1ª ou rodada de correção). Só códigos — nunca `detail`/texto. */
export interface PlanAttempt {
  attempt: number;
  kind: 'GENERATION' | 'CORRECTION';
  outcome: PlanAttemptOutcome;
  /** Códigos de regra únicos (BLOCK e FLAG), na ordem em que o validador os emitiu. */
  rules: string[];
  malformedRetries: number;
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
  attempts: PlanAttempt[];
  trace: ProtocolGenerationTrace;
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
    // v2: o validador precisa do nível para vetar divisão/técnica acima dele (US-2.3).
    level: command.constraints.level,
    // Achado 2026-08-18: sem isso, o validador NUNCA recebia `preferredDays` (só o
    // gerador recebia, via `command.constraints` inteiro) — a regra de sessão-por-dia
    // nunca disparava de verdade, só nos testes que chamam `validate()` direto.
    preferredDays: command.constraints.preferredDays,
    // 2026-08-24: teto de fase do PAR-Q. Presente = nada além de `ADAPTACAO` passa, e o
    // piso de RIR (2) entra junto — os dois vetos vivem no `ValidationService`.
    ...(command.constraints.maxPhase ? { maxPhase: command.constraints.maxPhase } : {}),
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
    };
    attempts.push(attempt);
    logger?.info(
      { event: 'protocol.plan.attempt', userId: command.userId, ...attempt },
      'protocol.plan.attempt',
    );
  };

  // 1ª geração: erro aqui continua subindo (retry do job/DLQ, contrato inalterado).
  let gen = await generator.generate(command);
  let verdict = validate(gen.structure);
  const firstVerdict = verdict;
  record('GENERATION', verdict.code, verdict.violations, gen.malformedRetries ?? 0);

  let corrections = 0;
  while (verdict.action === 'BLOCK_FALLBACK' && corrections < MAX_CORRECTION_ROUNDS) {
    corrections++;
    let next: GenerateProtocolResult;
    try {
      next = await generator.generate({
        ...command,
        correction: { previous: gen.structure, violations: verdict.violations, round: corrections },
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
    record('CORRECTION', verdict.code, verdict.violations, gen.malformedRetries ?? 0);
  }

  let content = gen.structure;
  let repairs: DeterministicRepairCode[] = [];
  let repairOutcome: RepairOutcome = 'NOT_NEEDED';
  let finalVerdict = verdict;

  if (verdict.action === 'BLOCK_FALLBACK') {
    const repaired = deterministicRepair(gen.structure, verdict.violations, {
      preferredDays: command.constraints.preferredDays,
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
      }
    }
  }

  const usedFallbackTemplate = finalVerdict.action === 'BLOCK_FALLBACK';
  const promptVersion = usedFallbackTemplate ? FALLBACK_TEMPLATE_VERSION : gen.promptVersion;
  const validationAction = usedFallbackTemplate ? 'BLOCK' : finalVerdict.code;
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
    },
    'protocol.plan.summary',
  );

  if (usedFallbackTemplate) {
    // Persistiu o bloqueio em todas as tentativas (e o reparo não resolveu) → template
    // pré-aprovado pelo RT.
    return {
      content: buildFallbackProtocol(command.constraints.goal, command.constraints.preferredDays),
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
    };
  }

  return {
    content,
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
  };
}
