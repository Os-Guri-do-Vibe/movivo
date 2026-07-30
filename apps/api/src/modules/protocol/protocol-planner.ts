/**
 * Planner do pipeline "gera-e-valida" (US-2.4 / TASK-2.4.3) — a decisão pura, sem I/O de
 * banco/fila, para ser testável com fakes do gerador/validador (mocks-first).
 *
 * Fluxo:
 *   1. gera → valida;
 *   2. PASS → `AUTO_APPROVED` (o Worker assina a metodologia do RT e entrega);
 *   3. BLOCK → 1 regeração de modelo (US-2.3.3) → revalida; PASS → `AUTO_APPROVED`;
 *      persistindo a falha → template pré-aprovado do RT (`PENDING_REVIEW`, human review);
 *   4. FLAG → `PENDING_REVIEW` mantendo o conteúdo gerado para o profissional revisar.
 *
 * Só PASS "limpo" auto-aprova/entrega — FLAG e o template nunca são entregues sozinhos.
 */
import type { ProtocolApprovalStatus, ProtocolStructure } from '@movivo/shared';

import type { GenerateProtocolCommand, GenerateProtocolResult } from './protocol-generator.service';
import type { UserConstraints } from './user-constraints';
import { buildFallbackProtocol, FALLBACK_TEMPLATE_VERSION } from './validation/fallback-template';
import type { ValidationService } from './validation/validation.service';

export interface ProtocolGenerator {
  generate(command: GenerateProtocolCommand): Promise<GenerateProtocolResult>;
}

export interface PlanResult {
  content: ProtocolStructure;
  approvalStatus: ProtocolApprovalStatus;
  /** `true` só quando o validador passou limpo — o único caminho de entrega. */
  autoApproved: boolean;
  humanReviewRequired: boolean;
  /** Origem para rastreabilidade (`generated_by`/`model_version`/`prompt_version`). */
  generatedBy: string;
  modelVersion: string | null;
  promptVersion: string;
  validationAction: string;
  usedFallbackTemplate: boolean;
}

function fromGeneration(
  gen: GenerateProtocolResult,
  approvalStatus: ProtocolApprovalStatus,
  autoApproved: boolean,
  validationAction: string,
): PlanResult {
  return {
    content: gen.structure,
    approvalStatus,
    autoApproved,
    humanReviewRequired: !autoApproved,
    generatedBy: gen.provider,
    modelVersion: gen.model,
    promptVersion: gen.promptVersion,
    validationAction,
    usedFallbackTemplate: false,
  };
}

export async function planProtocol(
  generator: ProtocolGenerator,
  validation: ValidationService,
  command: GenerateProtocolCommand,
): Promise<PlanResult> {
  const constraints: Pick<UserConstraints, 'goal' | 'injuryTags'> = {
    goal: command.constraints.goal,
    injuryTags: command.constraints.injuryTags,
  };

  const gen1 = await generator.generate(command);
  const v1 = validation.validate({ structure: gen1.structure, constraints });

  if (v1.action === 'PASS') {
    return fromGeneration(gen1, 'AUTO_APPROVED', true, v1.code);
  }

  if (v1.action === 'BLOCK_FALLBACK') {
    // Fallback de modelo (US-2.3.3): regenera e revalida antes de cair no template.
    const gen2 = await generator.generate(command);
    const v2 = validation.validate({ structure: gen2.structure, constraints });
    if (v2.action === 'PASS') {
      return fromGeneration(gen2, 'AUTO_APPROVED', true, v2.code);
    }
    // Persistiu a falha → template pré-aprovado pelo RT + revisão humana obrigatória.
    return {
      content: buildFallbackProtocol(command.constraints.goal),
      approvalStatus: 'PENDING_REVIEW',
      autoApproved: false,
      humanReviewRequired: true,
      generatedBy: 'FALLBACK_TEMPLATE',
      modelVersion: null,
      promptVersion: FALLBACK_TEMPLATE_VERSION,
      validationAction: 'BLOCK',
      usedFallbackTemplate: true,
    };
  }

  // FLAG_HUMAN_REVIEW: não é entrega automática, mas mantém o conteúdo para o painel.
  return fromGeneration(gen1, 'PENDING_REVIEW', false, v1.code);
}
