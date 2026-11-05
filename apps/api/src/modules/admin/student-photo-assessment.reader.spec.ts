/**
 * Avaliação física por foto na ficha do aluno: corte por capability, autorização das fotos,
 * compatibilidade com avaliação antiga (sem `physique`) e nenhuma imagem no payload.
 *
 * O dublê do banco responde pela PROJEÇÃO pedida (e não pela ordem das consultas), para o
 * teste não quebrar quando a ficha ganhar outras consultas.
 */
import {
  controlCenterStudentDetailResponseSchema,
  type BodyAssessmentResult,
} from '@movivo/shared';
import { describe, expect, it, vi } from 'vitest';

import type { DatabaseHealthService } from '../../core/database';
import type { TenantDatabase } from '../../core/database/tenant-database.service';
import type { RedisHealthService } from '../../core/redis';
import type { EvolutionTransport } from '../whatsapp/evolution-transport';
import type { AuditService } from './audit.service';
import { ControlCenterService } from './control-center.service';
import {
  toPhotoAssessmentAudit,
  toStudentPhotoAssessments,
} from './student-photo-assessment.reader';

const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR = { userId: '22222222-2222-4222-8222-222222222222', jti: 'j1' } as const;
const LATEST_ID = '44444444-4444-4444-8444-444444444444';
const PREVIOUS_ID = '66666666-6666-4666-8666-666666666666';
const PHOTO_IDS = [
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
];

const fullResult: BodyAssessmentResult = {
  bodyFatRange: { min: 18, max: 22 },
  confidence: 'MEDIUM',
  comparison: { previousAssessmentId: PREVIOUS_ID, summary: 'Cintura um pouco mais definida.' },
  observationsForProfessional: ['Ombros levemente à frente nas fotos laterais.'],
  limitations: ['Luz lateral forte na foto de costas.'],
  physique: {
    muscleGroups: [
      { region: 'SHOULDERS', status: 'STRENGTH', note: 'Deltoides bem marcados.' },
      { region: 'CALVES', status: 'NOT_ASSESSABLE', note: 'Fora do enquadramento.' },
    ],
    posture: [
      {
        region: 'SHOULDERS',
        finding: 'Ombros projetados à frente',
        degree: 'NOTABLE',
        seenIn: ['RIGHT', 'LEFT'],
      },
    ],
    symmetry: 'Lado direito um pouco mais alto na foto frontal.',
    strengths: ['Boa base de membros inferiores.'],
    attentionPoints: ['Alinhamento dos ombros.'],
  },
};

/** Avaliação anterior à avaliação completa: sem `physique`. */
const legacyResult = {
  bodyFatRange: { min: 20, max: 25 },
  confidence: 'LOW',
  comparison: null,
  observationsForProfessional: [],
  limitations: ['Fotos com roupa larga.'],
};

const bodyRows = [
  { id: LATEST_ID, assessedOn: '2026-10-01', photoIds: PHOTO_IDS, result: fullResult },
  { id: PREVIOUS_ID, assessedOn: '2026-07-01', photoIds: PHOTO_IDS, result: legacyResult },
];

function query(rows: unknown[]) {
  const chain = {
    from: () => chain,
    leftJoin: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    groupBy: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve(rows),
    then: <T1 = unknown[], T2 = never>(
      onfulfilled?: ((value: unknown[]) => T1 | PromiseLike<T1>) | null,
      onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
    ) => Promise.resolve(rows).then(onfulfilled, onrejected),
  };
  return chain;
}

const studentRow = {
  id: STUDENT_ID,
  name: 'Ana Souza',
  email: 'ana@teste.com',
  phoneNumber: '+5511999990001',
  status: 'ACTIVE',
  subscriptionStatus: 'ACTIVE',
  subscriptionPlan: 'MONTHLY',
  planStatus: 'ACTIVE',
  anamnesisStatus: 'COMPLETED',
  parqState: 'CLEARED',
  lastInboundAt: null,
  unansweredCheckinSentAt: null,
  renewalAt: null,
};

function build({ photoConsent }: { photoConsent: boolean }) {
  const projectionKeys = (projection: unknown) =>
    projection && typeof projection === 'object' ? Object.keys(projection) : [];
  const userSelect = vi.fn((projection?: unknown) => {
    const keys = projectionKeys(projection);
    if (keys.includes('photoIds')) return query(bodyRows);
    if (keys.includes('phoneNumber') && keys.includes('email')) return query([studentRow]);
    return query([]);
  });
  const systemSelect = vi.fn(() => query(photoConsent ? [{ id: 'consent' }] : []));
  const db = {
    runAsSystem: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb({ select: systemSelect })),
    runAsUser: vi.fn((_id: string, _role: string, cb: (tx: unknown) => Promise<unknown>) =>
      cb({ select: userSelect, execute: vi.fn(async () => []) }),
    ),
  } as unknown as TenantDatabase;
  const audit = { append: vi.fn().mockResolvedValue(undefined) };
  const service = new ControlCenterService(
    db,
    { ping: vi.fn() } as unknown as DatabaseHealthService,
    { ping: vi.fn() } as unknown as RedisHealthService,
    audit as unknown as AuditService,
    { hasCredentials: () => false } as unknown as EvolutionTransport,
  );
  const askedForAssessments = () =>
    userSelect.mock.calls.some(([projection]) => projectionKeys(projection).includes('photoIds'));
  return { service, db, systemSelect, askedForAssessments };
}

describe('ficha do aluno: avaliação física por foto', () => {
  it('quem lê saúde recebe a mais recente e a anterior, prontas para a tela e válidas no contrato', async () => {
    const { service } = build({ photoConsent: true });

    const response = await service.student({ ...ACTOR, role: 'PROFESSIONAL' }, STUDENT_ID);
    const photo = response.data.student.health?.photoAssessment;

    expect(photo?.latest).toMatchObject({
      id: LATEST_ID,
      assessedOn: '2026-10-01',
      photoCount: 4,
      confidence: 'MEDIUM',
      bodyFatRange: { min: 18, max: 22 },
      comparisonSummary: 'Cintura um pouco mais definida.',
    });
    expect(photo?.latest?.physique?.posture[0]).toMatchObject({
      region: 'SHOULDERS',
      degree: 'NOTABLE',
      seenIn: ['RIGHT', 'LEFT'],
    });
    // Avaliação antiga continua abrindo: só o que existe, sem a parte completa.
    expect(photo?.previous).toMatchObject({
      id: PREVIOUS_ID,
      confidence: 'LOW',
      physique: null,
      limitations: ['Fotos com roupa larga.'],
    });
    expect(() => controlCenterStudentDetailResponseSchema.parse(response)).not.toThrow();
  });

  it('nunca devolve imagem, id de foto nem caminho de armazenamento', async () => {
    const { service } = build({ photoConsent: true });

    const response = await service.student({ ...ACTOR, role: 'PROFESSIONAL' }, STUDENT_ID);
    const json = JSON.stringify(response);

    for (const photoId of PHOTO_IDS) expect(json).not.toContain(photoId);
    expect(json).not.toMatch(/storagePath|photoIds|base64|data:image/);
  });

  it('sem STUDENTS_HEALTH_READ, `health` é null e a avaliação nem é consultada', async () => {
    const { service, systemSelect, askedForAssessments } = build({ photoConsent: true });

    const response = await service.student({ ...ACTOR, role: 'SUPPORT' }, STUDENT_ID);

    expect(response.data.student.health).toBeNull();
    expect(systemSelect).not.toHaveBeenCalled();
    expect(askedForAssessments()).toBe(false);
    const json = JSON.stringify(response);
    expect(json).not.toContain('Ombros projetados');
    expect(json).not.toContain('photoAssessment');
  });

  it('sem a autorização das fotos, nenhuma avaliação é lida e a seção vem vazia', async () => {
    const { service, askedForAssessments } = build({ photoConsent: false });

    const response = await service.student({ ...ACTOR, role: 'PROFESSIONAL' }, STUDENT_ID);

    expect(response.data.student.health?.photoAssessment).toEqual({ latest: null, previous: null });
    expect(askedForAssessments()).toBe(false);
  });
});

describe('toPhotoAssessmentAudit', () => {
  it('lê avaliação antiga sem `physique` e sem quebrar com campos ausentes', () => {
    const audit = toPhotoAssessmentAudit({
      id: PREVIOUS_ID,
      assessedOn: '2026-01-10',
      photoIds: null,
      result: { confidence: 'LOW' },
    });
    expect(audit).toEqual({
      id: PREVIOUS_ID,
      assessedOn: '2026-01-10',
      photoCount: 0,
      confidence: 'LOW',
      bodyFatRange: null,
      comparisonSummary: null,
      observationsForProfessional: [],
      limitations: [],
      physique: null,
    });
  });

  it('descarta a parte completa quando ela não é íntegra, mantendo o resto', () => {
    const audit = toPhotoAssessmentAudit({
      id: LATEST_ID,
      assessedOn: '2026-10-01',
      photoIds: PHOTO_IDS,
      result: { ...fullResult, physique: { muscleGroups: 'quebrado' } },
    });
    expect(audit.physique).toBeNull();
    expect(audit.bodyFatRange).toEqual({ min: 18, max: 22 });
  });

  it('faixa invertida ou não numérica não vira número na tela', () => {
    const audit = toPhotoAssessmentAudit({
      id: LATEST_ID,
      assessedOn: '2026-10-01',
      photoIds: [],
      result: { ...legacyResult, bodyFatRange: { min: 30, max: 20 } },
    });
    expect(audit.bodyFatRange).toBeNull();
  });

  it('sem linhas, as duas leituras ficam null; com uma, não há anterior', () => {
    expect(toStudentPhotoAssessments([])).toEqual({ latest: null, previous: null });
    const [first] = bodyRows;
    expect(toStudentPhotoAssessments(first ? [first] : []).previous).toBeNull();
  });
});
