/**
 * Projeção da anamnese no Estado do Aluno.
 *
 * Roda na MESMA transação que conclui a anamnese: perfil, objetivo (nova versão), restrições
 * de agenda e alimentação, preferências declaradas, medidas e — só cifrado — saúde, alergias e
 * textos livres. Na anamnese complementar, o que já existia é substituído (`superseded_at`),
 * nunca apagado: o histórico do aluno fica.
 */
import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import type {
  HealthRecordKind,
  HealthRecordPayload,
  OnboardingBodyStep,
  OnboardingGoalsStep,
  OnboardingModalitiesStep,
  OnboardingNutritionStep,
  OnboardingParqStep,
  OnboardingPreferencesStep,
  OnboardingRoutineStep,
  OnboardingStep1,
  PainRegion,
  StudentConstraint,
} from '@movivo/shared';

import { HealthCipherService } from '../../core/database/health-cipher.service';
import {
  bodyMeasurements,
  studentConstraints,
  studentGoals,
  studentHealthRecords,
  studentPreferences,
  studentProfiles,
} from '../../core/database/schema';
import type { TenantTransaction } from '../../core/database/tenant-database.service';

export interface OnboardingAnswers {
  registration: OnboardingStep1;
  goals: OnboardingGoalsStep;
  modalities: OnboardingModalitiesStep;
  routine: OnboardingRoutineStep;
  preferences: OnboardingPreferencesStep;
  parq: OnboardingParqStep;
  nutrition: OnboardingNutritionStep;
  body: OnboardingBodyStep | null;
}

/** Região de dor → tag de contraindicação do catálogo de exercícios. */
const PAIN_TO_TAG: Partial<Record<PainRegion, string>> = {
  NECK: 'NECK',
  SHOULDER: 'SHOULDER',
  ELBOW: 'ELBOW',
  WRIST: 'WRIST',
  LOWER_BACK: 'LOWER_BACK',
  HIP: 'HIP',
  KNEE: 'KNEE',
  ANKLE_FOOT: 'ANKLE',
};

const PREFERENCE_CONFIDENCE = 80;

@Injectable()
export class OnboardingProjection {
  constructor(private readonly cipher: HealthCipherService) {}

  async project(tx: TenantTransaction, userId: string, answers: OnboardingAnswers, today: string) {
    await this.profile(tx, userId, answers);
    await this.goal(tx, userId, answers.goals, today);
    await this.constraints(tx, userId, answers, today);
    await this.preferences(tx, userId, answers);
    await this.health(tx, userId, answers);
    await this.measurements(tx, userId, answers, today);
  }

  private async profile(tx: TenantTransaction, userId: string, answers: OnboardingAnswers) {
    const profile = {
      birthDate: answers.registration.birthDate,
      heightCm: answers.registration.heightCm,
      modalities: answers.modalities.modalities,
      externalSports: answers.modalities.externalSports,
      venues: answers.modalities.venues,
      lifeContext: answers.routine.lifeContext,
    };
    await tx
      .insert(studentProfiles)
      .values({ userId, profile })
      .onConflictDoUpdate({
        target: studentProfiles.userId,
        set: { profile, version: sql`${studentProfiles.version} + 1` },
      });
  }

  private async goal(
    tx: TenantTransaction,
    userId: string,
    goals: OnboardingGoalsStep,
    today: string,
  ) {
    const [latest] = await tx
      .select({ version: studentGoals.version })
      .from(studentGoals)
      .where(eq(studentGoals.userId, userId))
      .orderBy(desc(studentGoals.version))
      .limit(1);
    await tx
      .update(studentGoals)
      .set({ status: 'SUPERSEDED' })
      .where(and(eq(studentGoals.userId, userId), eq(studentGoals.status, 'ACTIVE')));
    await tx.insert(studentGoals).values({
      userId,
      version: (latest?.version ?? 0) + 1,
      declared: goals.goal,
      startedOn: today,
    });
  }

  private async constraints(
    tx: TenantTransaction,
    userId: string,
    answers: OnboardingAnswers,
    today: string,
  ) {
    const rows: StudentConstraint[] = [
      {
        kind: 'AVAILABILITY',
        windows: answers.routine.windows,
        variesWeekly: answers.routine.variesWeekly,
        maxSessionsPerWeek: answers.routine.maxSessionsPerWeek,
      },
      ...answers.nutrition.dietaryRestrictions.map((restriction): StudentConstraint => ({
        kind: 'DIETARY_RESTRICTION',
        restriction,
      })),
    ];
    await tx
      .update(studentConstraints)
      .set({ supersededAt: new Date() })
      .where(
        and(
          eq(studentConstraints.userId, userId),
          inArray(studentConstraints.kind, ['AVAILABILITY', 'DIETARY_RESTRICTION']),
          isNull(studentConstraints.supersededAt),
        ),
      );
    await tx.insert(studentConstraints).values(
      rows.map((constraint) => ({
        userId,
        kind: constraint.kind,
        constraint,
        origin: 'DECLARED' as const,
        validFrom: today,
      })),
    );
  }

  private async preferences(tx: TenantTransaction, userId: string, answers: OnboardingAnswers) {
    const { preferences } = answers.preferences;
    const declared: { domain: string; key: string; value: string | number }[] = [
      { domain: 'TRAINING_STRUCTURE', key: 'split', value: preferences.split },
      { domain: 'TRAINING_STRUCTURE', key: 'priority', value: preferences.priority },
      { domain: 'EFFORT', key: 'proximity_to_failure', value: preferences.effort },
      {
        domain: 'SESSION_LENGTH',
        key: 'session_minutes',
        value: preferences.preferredSessionMinutes,
      },
      { domain: 'FOOD', key: 'meals_per_day', value: answers.nutrition.mealsPerDay },
      { domain: 'FOOD', key: 'usual_meals', value: answers.nutrition.usualMeals.join(',') },
      { domain: 'FOOD', key: 'hunger', value: answers.nutrition.hunger },
    ];
    if (answers.nutrition.supplements.length > 0) {
      declared.push({
        domain: 'FOOD',
        key: 'supplements',
        value: answers.nutrition.supplements.join(','),
      });
    }
    await tx
      .update(studentPreferences)
      .set({ supersededAt: new Date() })
      .where(
        and(
          eq(studentPreferences.userId, userId),
          eq(studentPreferences.origin, 'DECLARED'),
          isNull(studentPreferences.supersededAt),
        ),
      );
    await tx.insert(studentPreferences).values(
      declared.map((p) => ({
        userId,
        domain: p.domain,
        key: p.key,
        value: p.value,
        strength: 'STRONG',
        origin: 'DECLARED',
        confidence: PREFERENCE_CONFIDENCE,
      })),
    );
  }

  /** Tudo que é saúde ou texto livre — só cifrado. */
  private async health(tx: TenantTransaction, userId: string, answers: OnboardingAnswers) {
    const { preferences: health, parq, nutrition, goals } = answers;
    const records: { kind: HealthRecordKind; payload: HealthRecordPayload }[] = [];

    const positive = parq.parq.answers.filter((a) => a.answer).map((a) => a.questionId);
    records.push({
      kind: 'PARQ',
      payload: {
        summary:
          positive.length > 0
            ? `PAR-Q com resposta de risco: ${positive.join(', ')}`
            : 'PAR-Q sem respostas de risco',
      },
    });
    if (health.pain.hasPain) {
      for (const point of health.pain.points) {
        const tag = PAIN_TO_TAG[point.region];
        records.push({
          kind: 'PAIN',
          payload: {
            summary: `Dor ${point.intensity}/10${point.regionOther ? ` (${point.regionOther})` : ''}; tendência ${health.pain.trend ?? 'não informada'}${health.pain.trigger ? `; piora com: ${health.pain.trigger}` : ''}`,
            region: point.region,
            movementTags: tag ? [tag] : [],
            guidance: health.pain.avoidanceRecommendation,
          },
        });
      }
    }
    if (health.conditions)
      records.push({ kind: 'CONDITION', payload: { summary: health.conditions } });
    if (health.medications)
      records.push({ kind: 'MEDICATION', payload: { summary: health.medications } });
    if (health.professionalGuidance) {
      records.push({
        kind: 'PROFESSIONAL_GUIDANCE',
        payload: { summary: health.professionalGuidance, guidance: health.professionalGuidance },
      });
    }
    for (const allergy of nutrition.allergies) {
      records.push({
        kind: 'FOOD_ALLERGY',
        payload: { summary: `${allergy.allergen} (${allergy.severity})` },
      });
    }
    const notes = [
      goals.motivation && `Motivação: ${goals.motivation}`,
      health.likedTraining && `Gosta de treinar: ${health.likedTraining}`,
      health.dislikedExercises && `Prefere evitar: ${health.dislikedExercises}`,
      nutrition.likedFoods && `Alimentos que gosta: ${nutrition.likedFoods}`,
      nutrition.dislikedFoods && `Alimentos que evita: ${nutrition.dislikedFoods}`,
    ].filter((note): note is string => Boolean(note));
    if (notes.length > 0)
      records.push({ kind: 'NOTES', payload: { summary: notes.join(' | ').slice(0, 500) } });

    await tx
      .update(studentHealthRecords)
      .set({ status: 'RESOLVED', resolvedAt: new Date() })
      .where(
        and(
          eq(studentHealthRecords.userId, userId),
          eq(studentHealthRecords.status, 'ACTIVE'),
          eq(studentHealthRecords.origin, 'DECLARED'),
        ),
      );
    for (const record of records) {
      await tx.insert(studentHealthRecords).values({
        userId,
        kind: record.kind,
        payload: await this.cipher.encryptHealth(JSON.stringify(record.payload)),
        origin: 'DECLARED',
      });
    }
  }

  private async measurements(
    tx: TenantTransaction,
    userId: string,
    answers: OnboardingAnswers,
    today: string,
  ) {
    const rows = [
      { kind: 'WEIGHT', value: answers.registration.weightKg, method: 'SCALE', measuredOn: today },
      ...(answers.body?.measurements ?? []),
    ];
    await tx.insert(bodyMeasurements).values(rows.map((row) => ({ userId, ...row })));
  }
}
