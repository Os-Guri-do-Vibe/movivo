/**
 * Planner do pipeline "gera-e-valida" (US-2.4 / TASK-2.4.3) — a decisão pura, sem I/O de
 * banco/fila, para ser testável com fakes do gerador/validador (mocks-first).
 *
 * Fluxo:
 *   1. gera → valida;
 *   2. BLOCK → 1 regeração de modelo (US-2.3.3) → revalida;
 *   3. ainda BLOCK após a 2ª tentativa → cai no template pré-aprovado do RT.
 *
 * Decisão do fundador (2026-08-18): **todo** protocolo gerado — PASS limpo, FLAG do
 * validador ou BLOCK persistente caindo no template — entra na Fila do Profissional como
 * `PENDING_REVIEW`/`OPTIONAL`, nunca entrega sozinho na hora. O único motivo de negócio pra
 * travar sem prazo (`MANDATORY`) é PAR-Q, e quem chega até aqui já passou por esse gate no
 * `ProtocolGenerationWorker.process()` (sessão de risco nem gera). `OPTIONAL` dá ao RT uma
 * janela de cortesia de 1h pra revisar qualquer protocolo — mesmo o limpo — antes da
 * auto-liberação (`ProtocolAutoReleaseWorker`). Isso substitui o antigo atalho onde PASS
 * pulava a fila e entregava imediato: um único fluxo, sem caminho paralelo.
 */
import type { ProtocolStructure } from '@movivo/shared';

import type { GenerateProtocolCommand, GenerateProtocolResult } from './protocol-generator.service';
import type { UserConstraints } from './user-constraints';
import { buildFallbackProtocol, FALLBACK_TEMPLATE_VERSION } from './validation/fallback-template';
import type { ValidationService, ValidationViolation } from './validation/validation.service';

export interface ProtocolGenerator {
  generate(command: GenerateProtocolCommand): Promise<GenerateProtocolResult>;
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
   * Vazio em `PASS` limpo.
   */
  violations: readonly ValidationViolation[];
}

function fromGeneration(
  gen: GenerateProtocolResult,
  validationAction: string,
  violations: readonly ValidationViolation[],
): PlanResult {
  return {
    content: gen.structure,
    generatedBy: gen.provider,
    modelVersion: gen.model,
    promptVersion: gen.promptVersion,
    knowledgeSources: gen.knowledgeSources ?? [],
    methodologyVersionId: gen.methodologyVersionId ?? null,
    methodologySha256: gen.methodologySha256 ?? null,
    validationAction,
    usedFallbackTemplate: false,
    violations,
  };
}

export async function planProtocol(
  generator: ProtocolGenerator,
  validation: ValidationService,
  command: GenerateProtocolCommand,
): Promise<PlanResult> {
  const constraints: Pick<UserConstraints, 'goal' | 'injuryTags' | 'level' | 'preferredDays'> = {
    goal: command.constraints.goal,
    injuryTags: command.constraints.injuryTags,
    // v2: o validador precisa do nível para vetar divisão/técnica acima dele (US-2.3).
    level: command.constraints.level,
    // Achado 2026-08-18: sem isso, o validador NUNCA recebia `preferredDays` (só o
    // gerador recebia, via `command.constraints` inteiro) — a regra de sessão-por-dia
    // nunca disparava de verdade, só nos testes que chamam `validate()` direto.
    preferredDays: command.constraints.preferredDays,
  };

  const gen1 = await generator.generate(command);
  const v1 = validation.validate({ structure: gen1.structure, constraints });

  if (v1.action !== 'BLOCK_FALLBACK') {
    // PASS ou FLAG_HUMAN_REVIEW — os dois entram na fila igual (só o `validationAction`
    // e as `violations` distinguem um do outro pro painel).
    return fromGeneration(gen1, v1.code, v1.violations);
  }

  // Fallback de modelo (US-2.3.3): regenera e revalida antes de cair no template.
  const gen2 = await generator.generate(command);
  const v2 = validation.validate({ structure: gen2.structure, constraints });
  if (v2.action !== 'BLOCK_FALLBACK') {
    return fromGeneration(gen2, v2.code, v2.violations);
  }

  // Persistiu o bloqueio nas duas tentativas → template pré-aprovado pelo RT.
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
    // As duas tentativas violaram — a 2ª (`v2`) é a que efetivamente decidiu o
    // fallback, mas a 1ª (`v1`) ajuda a ver se foi o mesmo problema repetindo.
    violations: [...v1.violations, ...v2.violations],
  };
}
