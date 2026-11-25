import { describe, expect, it } from 'vitest';

import { controlCenterStudentDetailResponseSchema } from '../control-center.schema';
import {
  photoAssessmentAuditSchema,
  studentPhotoAssessmentsSchema,
} from './photo-assessment-audit.schema';

const assessment = {
  id: '44444444-4444-4444-8444-444444444444',
  assessedOn: '2026-10-01',
  photoCount: 4,
  confidence: 'MEDIUM',
  bodyFatRange: { min: 18, max: 22 },
  comparisonSummary: null,
  observationsForProfessional: [],
  limitations: ['Luz lateral forte.'],
  physique: {
    muscleGroups: [{ region: 'ARMS', status: 'TO_DEVELOP', note: 'Pouco volume.' }],
    posture: [
      { region: 'KNEES', finding: 'Joelhos para dentro', degree: 'MILD', seenIn: ['FRONT'] },
    ],
    symmetry: null,
    strengths: [],
    attentionPoints: [],
  },
};

describe('photoAssessmentAuditSchema', () => {
  it('aceita a avaliação completa e a antiga, sem a parte completa', () => {
    expect(photoAssessmentAuditSchema.safeParse(assessment).success).toBe(true);
    expect(photoAssessmentAuditSchema.safeParse({ ...assessment, physique: null }).success).toBe(
      true,
    );
  });

  it('recusa grau, status ou posição fora do vocabulário', () => {
    const badPosture = {
      ...assessment,
      physique: {
        ...assessment.physique,
        posture: [{ ...assessment.physique.posture[0], degree: 'SEVERE' }],
      },
    };
    const badAngle = {
      ...assessment,
      physique: {
        ...assessment.physique,
        posture: [{ ...assessment.physique.posture[0], seenIn: ['TOP'] }],
      },
    };
    const badStatus = {
      ...assessment,
      physique: {
        ...assessment.physique,
        muscleGroups: [{ region: 'ARMS', status: 'WEAK', note: 'x' }],
      },
    };
    for (const value of [badPosture, badAngle, badStatus]) {
      expect(photoAssessmentAuditSchema.safeParse(value).success).toBe(false);
    }
  });

  it('não tem campo de imagem: o que não está no contrato não passa adiante', () => {
    const parsed = photoAssessmentAuditSchema.parse({
      ...assessment,
      photoUrl: 'https://exemplo/foto.jpg',
      storagePath: 'body/1.jpg',
    });
    expect(parsed).not.toHaveProperty('photoUrl');
    expect(parsed).not.toHaveProperty('storagePath');
  });

  it('o par mais recente + anterior aceita os dois vazios', () => {
    expect(studentPhotoAssessmentsSchema.safeParse({ latest: null, previous: null }).success).toBe(
      true,
    );
  });
});

describe('ficha do aluno: `health.photoAssessment` é extensão compatível', () => {
  const detail = (health: unknown) => ({
    data: {
      student: {
        id: '11111111-1111-4111-8111-111111111111',
        name: null,
        email: null,
        phoneNumber: '+5511999990001',
        status: 'ACTIVE',
        subscriptionStatus: null,
        subscriptionPlan: null,
        planStatus: null,
        enrolledAt: null,
        churnRisk: { score: 0, signals: [] },
        anamnesisStatus: null,
        acquisition: null,
        plan: { training: null, nutrition: null, strategy: null, goal: null },
        adherence: {
          windowDays: 28,
          planned: 0,
          done: 0,
          rate: { value: null, unit: 'PERCENT', status: 'UNAVAILABLE', definition: 'x' },
        },
        checkins: {
          sent: 0,
          answered: 0,
          responseRate: { value: null, unit: 'PERCENT', status: 'UNAVAILABLE', definition: 'x' },
        },
        executions: [],
        exceptions: [],
        decisions: [],
        timeline: [],
        aiQuality: {
          blockedRate: { value: null, unit: 'PERCENT', status: 'UNAVAILABLE', definition: 'x' },
          blocked: 0,
          validated: 0,
        },
        health,
        followUp: null,
      },
    },
    meta: {
      generatedAt: '2026-11-05T12:00:00.000Z',
      timezone: 'America/Sao_Paulo',
      dataQuality: [],
    },
  });

  it('payload sem o campo novo (servidor antigo) continua válido', () => {
    const result = controlCenterStudentDetailResponseSchema.safeParse(
      detail({ parqState: null, painReports: [] }),
    );
    expect(result.error?.issues ?? []).toEqual([]);
  });

  it('payload com a avaliação mais recente e a anterior é válido; sem saúde segue null', () => {
    expect(
      controlCenterStudentDetailResponseSchema.safeParse(
        detail({
          parqState: null,
          painReports: [],
          photoAssessment: { latest: assessment, previous: { ...assessment, physique: null } },
        }),
      ).success,
    ).toBe(true);
    expect(controlCenterStudentDetailResponseSchema.safeParse(detail(null)).success).toBe(true);
  });
});
