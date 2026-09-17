import { describe, expect, it, vi } from 'vitest';
import type { ProtocolStructure } from '@movivo/shared';

import { handoffAlerts, protocolVersions } from '../../core/database/schema';
import type { TenantDatabase } from '../../core/database/tenant-database.service';
import type { LlmRouter } from '../ai-coach/llm/llm-router.service';
import type { LLMRequest, LLMResult } from '../ai-coach/llm/llm.types';
import type { ProtocolSubstitutionRepository } from '../protocol/protocol-substitution.repository';
import type {
  ValidationService,
  ValidationVerdict,
} from '../protocol/validation/validation.service';
import { ProtocolVolumeAdjustmentService } from './protocol-volume-adjustment.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const PROTOCOL_ID = '22222222-2222-4222-8222-222222222222';
const CHECKIN_ID = '33333333-3333-4333-8333-333333333333';

const STRUCTURE: ProtocolStructure = {
  promptVersion: 'v2',
  goal: 'HIPERTROFIA',
  phase: 'ADAPTACAO',
  sessions: [
    {
      dayLabel: 'Dia 1',
      focus: 'Corpo inteiro',
      exercises: [
        {
          exerciseId: 'goblet_squat',
          name: 'Agachamento Goblet',
          sets: 4,
          reps: { min: 10, max: 12 },
          loadStrategy: 'PROGRESSAO_LINEAR',
          restSeconds: 90,
        },
        {
          exerciseId: 'plank',
          name: 'Prancha',
          sets: 3,
          durationSeconds: 60,
          loadStrategy: 'PROGRESSAO_LINEAR',
          restSeconds: 60,
        },
      ],
    },
  ],
} as unknown as ProtocolStructure;

function llmResult(text: string): LLMResult {
  return {
    text,
    provider: 'OPENAI_GPT41',
    model: 'gpt-4.1',
    tokensInput: 100,
    tokensOutput: 40,
    tokensCached: 0,
    latencyMs: 20,
    attempt: 1,
    dataClass: 'HEALTH',
    costBrl: 0.001,
  };
}

function passVerdict(): ValidationVerdict {
  return { action: 'PASS', code: 'PASS', humanReviewRequired: false, violations: [] };
}

function makeTx() {
  const updateWhere = vi.fn(async () => []);
  const updateSet = vi.fn((_values: Record<string, unknown>) => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));
  const versionsInsertValues = vi.fn(async () => []);
  const alertOnConflict = vi.fn(async () => []);
  const alertInsertValues = vi.fn(() => ({ onConflictDoNothing: alertOnConflict }));
  const insert = vi.fn((table: unknown) => {
    if (table === protocolVersions) return { values: versionsInsertValues };
    if (table === handoffAlerts) return { values: alertInsertValues };
    return { values: vi.fn(async () => []) };
  });
  return { update, updateSet, updateWhere, insert, versionsInsertValues, alertInsertValues };
}

function makeService(opts: {
  complete: (req: LLMRequest) => Promise<LLMResult>;
  activeProtocol?: unknown;
  verdict?: ValidationVerdict;
}) {
  const complete = vi.fn(opts.complete);
  const llm = { complete } as unknown as LlmRouter;
  const validate = vi.fn(() => opts.verdict ?? passVerdict());
  const validation = { validate } as unknown as ValidationService;
  const active =
    opts.activeProtocol === undefined
      ? {
          protocolId: PROTOCOL_ID,
          version: 3,
          content: STRUCTURE,
          validationConstraints: { level: 'INICIANTE' },
          parQFlags: [],
        }
      : opts.activeProtocol;
  const loadActiveProtocol = vi.fn(async () => active);
  const substitutionRepo = { loadActiveProtocol } as unknown as ProtocolSubstitutionRepository;
  const tx = makeTx();
  const runAsUser = vi.fn((_userId: string, _role: string, cb: (tx: unknown) => Promise<unknown>) =>
    cb(tx),
  );
  const db = { runAsUser } as unknown as TenantDatabase;
  const logger = { warn: vi.fn(), info: vi.fn(), setContext: vi.fn() } as never;
  const service = new ProtocolVolumeAdjustmentService(
    llm,
    validation,
    substitutionRepo,
    db,
    logger,
  );
  return { service, complete, validate, loadActiveProtocol, tx, runAsUser };
}

const PARAMS = {
  userId: USER_ID,
  user: { name: 'Ana', phoneNumber: '+5541999999999', email: null },
  biologicalSex: 'FEMALE' as const,
  checkinId: CHECKIN_ID,
};

describe('ProtocolVolumeAdjustmentService.adjust', () => {
  it('aplica a redução, versiona o protocolo e cria o alerta informativo', async () => {
    const { service, tx } = makeService({
      complete: async () =>
        llmResult(
          JSON.stringify({
            adjustments: [{ dayLabel: 'Dia 1', exerciseId: 'goblet_squat', sets: 3 }],
            summary: 'reduziu 1 série do Agachamento Goblet',
          }),
        ),
    });

    const result = await service.adjust(PARAMS);

    expect(result).toEqual({
      applied: true,
      summary: 'reduziu 1 série do Agachamento Goblet',
      protocolId: PROTOCOL_ID,
      version: 4,
    });
    expect(tx.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 4,
        content: expect.objectContaining({
          sessions: [
            expect.objectContaining({
              exercises: expect.arrayContaining([expect.objectContaining({ sets: 3 })]),
            }),
          ],
        }),
      }),
    );
    expect(tx.versionsInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ generatedBy: 'AI_CHECKIN_ADJUSTMENT', version: 4 }),
    );
    expect(tx.alertInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'ALERT', reason: 'CHECKIN_AJUSTE_VOLUME_APLICADO' }),
    );
  });

  it('devolve NO_ACTIVE_PROTOCOL sem chamar a IA quando o aluno não tem protocolo ativo', async () => {
    const { service, complete } = makeService({
      complete: async () => llmResult('{}'),
      activeProtocol: null,
    });
    await expect(service.adjust(PARAMS)).resolves.toEqual({
      applied: false,
      reason: 'NO_ACTIVE_PROTOCOL',
    });
    expect(complete).not.toHaveBeenCalled();
  });

  it('nunca lança — falha da IA devolve ERROR', async () => {
    const { service } = makeService({
      complete: async () => {
        throw new Error('todos os provedores falharam');
      },
    });
    await expect(service.adjust(PARAMS)).resolves.toEqual({ applied: false, reason: 'ERROR' });
  });

  it('rejeita ajuste que referencia exercício inexistente, sem tocar o banco', async () => {
    const { service, tx } = makeService({
      complete: async () =>
        llmResult(
          JSON.stringify({
            adjustments: [{ dayLabel: 'Dia 1', exerciseId: 'exercicio_fantasma', sets: 1 }],
            summary: 'x',
          }),
        ),
    });
    await expect(service.adjust(PARAMS)).resolves.toEqual({
      applied: false,
      reason: 'UNKNOWN_EXERCISE',
    });
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('rejeita ajuste que tenta AUMENTAR volume em vez de reduzir', async () => {
    const { service, tx } = makeService({
      complete: async () =>
        llmResult(
          JSON.stringify({
            adjustments: [{ dayLabel: 'Dia 1', exerciseId: 'goblet_squat', sets: 6 }],
            summary: 'x',
          }),
        ),
    });
    await expect(service.adjust(PARAMS)).resolves.toEqual({
      applied: false,
      reason: 'VOLUME_INCREASED',
    });
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('rejeita ajuste que aumenta o teto de reps mesmo reduzindo séries', async () => {
    const { service } = makeService({
      complete: async () =>
        llmResult(
          JSON.stringify({
            adjustments: [
              {
                dayLabel: 'Dia 1',
                exerciseId: 'goblet_squat',
                sets: 3,
                reps: { min: 10, max: 15 },
              },
            ],
            summary: 'x',
          }),
        ),
    });
    await expect(service.adjust(PARAMS)).resolves.toEqual({
      applied: false,
      reason: 'VOLUME_INCREASED',
    });
  });

  it('descarta o ajuste quando a validação reprova a estrutura final', async () => {
    const { service, tx } = makeService({
      complete: async () =>
        llmResult(
          JSON.stringify({
            adjustments: [{ dayLabel: 'Dia 1', exerciseId: 'goblet_squat', sets: 3 }],
            summary: 'x',
          }),
        ),
      verdict: {
        action: 'BLOCK_FALLBACK',
        code: 'BLOCK',
        humanReviewRequired: true,
        violations: [],
      },
    });
    await expect(service.adjust(PARAMS)).resolves.toEqual({
      applied: false,
      reason: 'VALIDATION_BLOCKED',
    });
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('nunca troca exerciseId — só escreve sets/reps/duração de um exercício já existente', async () => {
    const { service, tx } = makeService({
      complete: async () =>
        llmResult(
          JSON.stringify({
            adjustments: [{ dayLabel: 'Dia 1', exerciseId: 'plank', durationSeconds: 40 }],
            summary: 'reduziu a prancha',
          }),
        ),
    });
    await service.adjust(PARAMS);
    const written = tx.updateSet.mock.calls[0]?.[0] as { content: ProtocolStructure };
    const exerciseIds = written.content.sessions[0]?.exercises.map((e) => e.exerciseId);
    expect(exerciseIds).toEqual(['goblet_squat', 'plank']);
    const plank = written.content.sessions[0]?.exercises.find((e) => e.exerciseId === 'plank');
    expect(plank?.durationSeconds).toBe(40);
  });
});
