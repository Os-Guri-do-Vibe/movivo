/**
 * Contexto de geração do protocolo inicial: carrega titular + anamnese sob RLS e converte
 * em `UserConstraints`. Fonte ÚNICA para a geração inicial (`ProtocolGenerationWorker`) e
 * para a regeração pedida pelo profissional (`ProtocolRegenerationWorker`) — as duas têm
 * que produzir exatamente as mesmas restrições a partir da mesma anamnese.
 */
import { eq } from 'drizzle-orm';
import {
  anamnesisStructuredSchema,
  ParqState,
  SESSION_DURATION_MINUTES,
  toGenerationGoal,
  type AnamnesisStructured,
} from '@movivo/shared';

import { HealthCipherService } from '../../core/database/health-cipher.service';
import { anamnesisSessions, users } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { healthBlockSchema, type HealthBlock } from '../anamnesis/health-block';
import { evaluateParq, type ParqEvaluation } from '../anamnesis/parq';
import {
  emphasisToMuscleGroups,
  importantEventForPrompt,
  levelFromExperience,
  mapInjuriesToTags,
  painToConstraints,
  routineContextForPrompt,
  parqToConstraints,
  type UserConstraints,
} from './user-constraints';

export interface LoadedContext {
  requiresProfessionalReview: boolean;
  name: string | null;
  phoneNumber: string;
  email: string | null;
  submittedAt: Date | null;
  /** Etapa 2, seções 1/2/3/5 (jsonb em claro). */
  structured: AnamnesisStructured;
  /** Bloco cifrado: seção 4, textos livres, PAR-Q e declarações. */
  health: HealthBlock;
}

/** `null` se o titular ou a anamnese (blocos 2 e 3) não existem. */
export async function loadGenerationContext(
  db: TenantDatabase,
  cipher: HealthCipherService,
  userId: string,
  sessionId: string,
): Promise<LoadedContext | null> {
  return db.runAsUser(userId, 'USER', async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) return null;
    const [session] = await tx
      .select()
      .from(anamnesisSessions)
      .where(eq(anamnesisSessions.id, sessionId))
      .limit(1);
    if (!session || !session.dataBlock2 || !session.dataBlock3) return null;

    const health = healthBlockSchema.parse(
      JSON.parse(await cipher.decryptHealth(session.dataBlock2)),
    );
    const structured = anamnesisStructuredSchema.parse(session.dataBlock3);

    return {
      requiresProfessionalReview: user.requiresProfessionalReview,
      name: user.name,
      phoneNumber: user.phoneNumber,
      email: user.email,
      submittedAt: session.submittedAt,
      structured,
      health,
    };
  });
}

/**
 * Anamnese v2 → constraints do gerador (US-6.9).
 *
 * É aqui que a Sprint 6 paga o que prometeu: `level` deixa de ser `INICIANTE`
 * hardcoded e passa a vir da experiência declarada; ênfase e preferências passam a
 * existir; a dor localizada vira contraindicação estruturada, não texto solto.
 *
 * **Precedência inegociável:** `avoid` é PREFERÊNCIA e só remove exercício; nada nele
 * reabilita algo que `injuryTags` (segurança) tirou. O veto final continua sendo do
 * `ValidationService`, que não lê `avoid`.
 *
 * 2026-08-24: o PAR-Q entra aqui como restrição de verdade (`parqToConstraints`) — tag
 * de PAR-Q é mesclada em `injuryTags` para que gerador E validador a tratem com a mesma
 * força de uma lesão, e continua visível separada em `parqTags` (o que vai pra coluna
 * `par_q_flags`). A revisão obrigatória não altera o nível nem determina a fase.
 */
export function constraintsFromAnamnesis(ctx: LoadedContext): UserConstraints {
  const { structured, health } = ctx;
  const pain = painToConstraints(health.pain);
  // Texto livre que é restrição de fato: orientação profissional de evitar movimento.
  // O "exercício que não gosto" NÃO entra aqui — vai para `avoid`, que é preferência.
  const injuriesRaw = pain.raw;

  const parqAnswers = health.parq?.answers ?? [];
  const evaluation: ParqEvaluation = health.parq
    ? evaluateParq({ parq: health.parq })
    : {
        parqState: ParqState.LIBERADO,
        requiresProfessionalReview: false,
        triggeredQuestions: [],
      };
  const parq = parqToConstraints(evaluation, parqAnswers);
  // O booleano autoritativo é o do titular (`users.requires_professional_review`, escrito
  // no submit e zerado na liberação humana); a avaliação local só deriva as TAGS.
  const requiresProfessionalReview = ctx.requiresProfessionalReview;
  const level = levelFromExperience(structured.experience);

  return {
    requiresProfessionalReview,
    parqTags: parq.tags,
    parqTriggered: evaluation.triggeredQuestions,
    // "Outro" nunca chega ao gerador: `toGenerationGoal` o traduz para o objetivo
    // genérico seguro; o texto bruto do usuário fica na anamnese, para o painel CREF.
    goal: toGenerationGoal(structured.primaryGoal),
    level,
    trainingStatus: structured.trainingStatus,
    ...(structured.stoppedFor ? { stoppedFor: structured.stoppedFor } : {}),
    daysPerWeek: structured.daysPerWeek,
    preferredDays: structured.preferredDays,
    sessionMinutes: SESSION_DURATION_MINUTES[structured.sessionDuration],
    location: structured.location,
    // A anamnese v2 não pergunta equipamento item a item — o LOCAL já determina o que
    // existe, e o catálogo filtra por local. Perguntar de novo seria pedir ao usuário
    // uma informação que ele frequentemente não sabe responder.
    equipment: [],
    emphasis: emphasisToMuscleGroups(structured.emphasis),
    avoid: health.freeText?.avoidedExercise ? [health.freeText.avoidedExercise] : [],
    // Tag de PAR-Q entra em `injuryTags` de propósito: é assim que o gerador (prompt) e
    // o validador (`checkStructure`) já excluem exercício contraindicado. Sem a mescla,
    // "CARDIAC vindo do PAR-Q" só existiria como etiqueta, sem vetar exercício nenhum.
    injuryTags: [...new Set([...pain.tags, ...mapInjuriesToTags(injuriesRaw), ...parq.tags])],
    // Dor sem veto (ver `UserConstraints.cautionTags`): continua em `injuryTags` para o resto
    // do sistema, mas o gerador/validador da geração a tratam como cautela. PAR-Q é sempre veto.
    cautionTags: pain.cautionTags.filter((tag) => !parq.tags.includes(tag)),
    injuriesRaw,
    routineContext: routineContextForPrompt(structured, health.freeText),
    importantEvent: importantEventForPrompt(structured, health.freeText?.importantEventDescription),
  };
}
