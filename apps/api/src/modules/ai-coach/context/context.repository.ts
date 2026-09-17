/**
 * ContextRepository (US-3.2) — I/O de banco da episodic memory, sob `SET LOCAL`/RLS.
 *
 * Isolado do `ContextService` (lógica pura) pelo mesmo motivo do `AiJobRepository`: é
 * mapeamento Drizzle sem ramo, escopado por titular via `runAsUser`, provado pelo teste de
 * integração contra Postgres real — por isso fica fora da cobertura unitária (vitest.config).
 */
import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  anamnesisStructuredSchema,
  type ProtocolSession,
  type ProtocolStructure,
} from '@movivo/shared';

import { HealthCipherService } from '../../../core/database/health-cipher.service';
import {
  anamnesisSessions,
  checkins,
  coachingSessions,
  protocols,
  users,
  workoutCompletions,
  workoutSessions,
  workoutSetEntries,
} from '../../../core/database/schema';
import {
  TenantDatabase,
  type TenantTransaction,
} from '../../../core/database/tenant-database.service';
import { healthBlockSchema } from '../../anamnesis/health-block';
import { dayKey, sessionFor, weekdayCode, WORKOUT_TIMEZONE } from '../../workout/workout-schedule';
import type { ScrubUser } from '../llm/llm.types';

export interface EpisodicMemory {
  scrubUser: ScrubUser;
  /** Estado do aluno como JSON estruturado (protocolo/semana/fase/constraints). */
  state: Record<string, unknown>;
  summary: string | null;
}

/** Últimas sessões do diário fino (planejado x realizado) que entram no contexto do Coach. */
const RECENT_DIARY_SESSIONS = 3;

@Injectable()
export class ContextRepository {
  constructor(
    private readonly db: TenantDatabase,
    private readonly cipher: HealthCipherService,
  ) {}

  /** Lê usuário (para scrub) + protocolo ativo + resumo do dia, tudo sob RLS do titular. */
  async loadEpisodic(userId: string, sessionDate: string): Promise<EpisodicMemory> {
    return this.db.runAsUser(userId, 'USER', async (tx) => {
      const [user] = await tx
        .select({ name: users.name, phoneNumber: users.phoneNumber, email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      const [proto] = await tx
        .select({
          currentWeek: protocols.currentWeek,
          totalWeeks: protocols.totalWeeks,
          content: protocols.content,
          constraints: protocols.constraints,
          anamnesisSessionId: protocols.anamnesisSessionId,
        })
        .from(protocols)
        .where(and(eq(protocols.userId, userId), eq(protocols.status, 'ACTIVE')))
        .limit(1);

      const [session] = await tx
        .select({ summary: coachingSessions.summary })
        .from(coachingSessions)
        .where(
          and(eq(coachingSessions.userId, userId), eq(coachingSessions.sessionDate, sessionDate)),
        )
        .limit(1);

      // Memória factual mínima: eventos imutáveis e campos estruturados. O ciphertext das
      // respostas do check-in não é aberto aqui; princípio de minimização de dado sensível.
      const recentWorkouts = await tx
        .select({
          completedAt: workoutCompletions.completedAt,
          sessionKey: workoutCompletions.sessionKey,
          weekNumber: workoutCompletions.weekNumber,
          perceivedEffort: workoutCompletions.perceivedEffort,
        })
        .from(workoutCompletions)
        .where(eq(workoutCompletions.userId, userId))
        .orderBy(desc(workoutCompletions.completedAt))
        .limit(5);

      const recentCheckins = await tx
        .select({
          weekNumber: checkins.weekNumber,
          submittedAt: checkins.submittedAt,
          answers: checkins.answers,
        })
        .from(checkins)
        .where(and(eq(checkins.userId, userId), eq(checkins.status, 'SUBMITTED')))
        .orderBy(desc(checkins.submittedAt))
        .limit(3);

      // Achado 2026-09-12 (decisão do fundador): o Coach passava a orientar o aluno sem
      // NUNCA ver o que de fato aconteceu no treino — carga/repetição/série real, esforço
      // percebido e dor por sessão (o diário fino, `workout_sessions`/`workout_set_entries`).
      // Sem isso ele só tinha o AUTORRELATO agregado de `workout_completions`. Aqui entram os
      // últimos treinos CONCLUÍDOS com planejado (a `prescription` já é o snapshot exato do
      // que foi prescrito NAQUELE dia — não precisa cruzar com `protocoloCompleto`) vs.
      // realizado (agregado por exercício a partir de `workout_set_entries`), para o Coach
      // comparar os dois e falar com base no que realmente aconteceu, não só no que o aluno
      // lembra ter feito.
      const diarioFino = await this.loadWorkoutDiary(tx, userId);

      // `constraints` lido como shape solto de propósito: ai-coach não importa o tipo do
      // domínio de protocolo (fronteira §12.5).
      const c = (proto?.constraints ?? {}) as { injuryTags?: string[]; equipment?: string[] };
      const content = proto?.content as ProtocolStructure | undefined;

      // Achado 2026-09-02 (decisão do fundador): o Coach passa a receber o protocolo
      // COMPLETO (todas as sessões/exercícios, não só objetivo/fase resumidos) e a
      // anamnese estruturada que o originou — ele é o Coach individual deste aluno, então
      // "conhecimento individualizado" inclui o que o aluno respondeu no formulário, não só
      // o que foi derivado dele. Revoga a minimização anterior (que só valia pro ciphertext
      // de check-in, mantida abaixo) para este caso específico.
      const anamnese = proto?.anamnesisSessionId
        ? await this.loadAnamneseSummary(tx, proto.anamnesisSessionId)
        : null;

      // Achado 2026-09-09: o Coach respondia "qual treino hoje" tratando o protocolo como
      // um ciclo rotativo a partir do 1º treino do aluno (Dia1→Dia2→Dia3...), contradizendo
      // o calendário real — cada sessão tem `weekday` fixo (dia da semana), e é essa mesma
      // regra (`sessionFor`, `workout-schedule.ts`) que decide o treino do check-in diário.
      // Sem "hoje" no contexto, o modelo não tinha como cruzar `protocoloCompleto` com o
      // calendário real e preenchia a lacuna com uma heurística genérica. Aqui o cálculo é
      // feito em código — o mesmo algoritmo determinístico do check-in — e entregue pronto,
      // para o Coach nunca precisar (nem tentar) recalcular isso sozinho.
      const now = new Date();
      const hoje = {
        data: dayKey(now),
        diaDaSemana: weekdayCode(now),
        rotulo: new Intl.DateTimeFormat('pt-BR', {
          timeZone: WORKOUT_TIMEZONE,
          weekday: 'long',
        }).format(now),
      };
      const treinoDeHojeSegundoCalendario = content
        ? (sessionFor(now, content) ?? 'Hoje não é dia de treino previsto no protocolo.')
        : null;

      const state: Record<string, unknown> = proto
        ? {
            temProtocoloAtivo: true,
            semanaAtual: proto.currentWeek,
            totalSemanas: proto.totalWeeks,
            restricoes: c.injuryTags ?? [],
            equipamentos: c.equipment ?? [],
            protocoloCompleto: content,
            hoje,
            treinoDeHojeSegundoCalendario,
            anamnese,
            eventosRecentes: {
              treinosConcluidos: recentWorkouts,
              checkins: recentCheckins,
              diarioFino,
            },
          }
        : {
            hoje,
            temProtocoloAtivo: false,
            anamnese,
            eventosRecentes: {
              treinosConcluidos: recentWorkouts,
              checkins: recentCheckins,
              diarioFino,
            },
          };

      return {
        scrubUser: {
          name: user?.name ?? null,
          phoneNumber: user?.phoneNumber ?? null,
          email: user?.email ?? null,
        },
        state,
        summary: session?.summary ?? null,
      };
    });
  }

  /**
   * Diário fino (2026-09-12): últimos treinos CONCLUÍDOS com planejado vs. realizado.
   * `prescription` (coluna de `workout_sessions`) já é o snapshot exato do que foi
   * prescrito naquele dia — não precisa cruzar com `protocoloCompleto`. `realizado` agrega
   * `workout_set_entries` por exercício (carga/reps por série, só séries concluídas) — é o
   * dado que faltava para o Coach comparar planejado x realizado em vez de confiar só no
   * autorrelato agregado de `workout_completions`.
   */
  private async loadWorkoutDiary(
    tx: TenantTransaction,
    userId: string,
  ): Promise<Record<string, unknown>[]> {
    const sessions = await tx
      .select({
        id: workoutSessions.id,
        scheduledDate: workoutSessions.scheduledDate,
        sessionKey: workoutSessions.sessionKey,
        weekNumber: workoutSessions.weekNumber,
        prescription: workoutSessions.prescription,
        perceivedEffort: workoutSessions.perceivedEffort,
        painReported: workoutSessions.painReported,
        painExerciseIds: workoutSessions.painExerciseIds,
      })
      .from(workoutSessions)
      .where(and(eq(workoutSessions.userId, userId), eq(workoutSessions.status, 'COMPLETED')))
      .orderBy(desc(workoutSessions.scheduledDate))
      .limit(RECENT_DIARY_SESSIONS);
    if (sessions.length === 0) return [];

    const entries = await tx
      .select({
        workoutSessionId: workoutSetEntries.workoutSessionId,
        exerciseId: workoutSetEntries.exerciseId,
        setNumber: workoutSetEntries.setNumber,
        reps: workoutSetEntries.reps,
        loadValue: workoutSetEntries.loadValue,
        loadUnit: workoutSetEntries.loadUnit,
        durationSeconds: workoutSetEntries.durationSeconds,
        completed: workoutSetEntries.completed,
        skipped: workoutSetEntries.skipped,
      })
      .from(workoutSetEntries)
      .where(
        inArray(
          workoutSetEntries.workoutSessionId,
          sessions.map((s) => s.id),
        ),
      );

    return sessions.map((session) => {
      const prescription = session.prescription as ProtocolSession;
      const bySessionEntries = entries.filter((e) => e.workoutSessionId === session.id);
      const byExercise = new Map<string, typeof bySessionEntries>();
      for (const entry of bySessionEntries) {
        const list = byExercise.get(entry.exerciseId) ?? [];
        list.push(entry);
        byExercise.set(entry.exerciseId, list);
      }
      const realizadoPorExercicio = [...byExercise.entries()].map(([exerciseId, sets]) => ({
        exercicio: exerciseId,
        series: sets
          .sort((a, b) => a.setNumber - b.setNumber)
          .map((s) => ({
            serie: s.setNumber,
            reps: s.reps,
            carga: s.loadValue !== null ? Number(s.loadValue) : null,
            unidade: s.loadUnit,
            duracaoSegundos: s.durationSeconds,
            concluida: s.completed,
            pulada: s.skipped,
          })),
      }));

      return {
        data: session.scheduledDate,
        semana: session.weekNumber,
        sessionKey: session.sessionKey,
        esforcoPercebido: session.perceivedEffort,
        dorRelatada: session.painReported,
        exerciciosComDor: session.painExerciseIds,
        planejado: { foco: prescription.focus, exercicios: prescription.exercises },
        realizado: realizadoPorExercicio,
      };
    });
  }

  /**
   * Anamnese estruturada (dados_bloco_3, jsonb em claro) + dor/PAR-Q (dados_bloco_2,
   * cifrado) da sessão que originou o protocolo ativo do titular. Melhor esforço, no
   * mesmo padrão de `fallbackParqTags` do worker de geração: se o bloco cifrado não abrir
   * ou não bater no schema, devolve `null` naquele pedaço — a conversa segue sem essa
   * parte do contexto em vez de falhar a resposta inteira por causa dela.
   */
  private async loadAnamneseSummary(
    tx: TenantTransaction,
    anamnesisSessionId: string,
  ): Promise<Record<string, unknown> | null> {
    const [session] = await tx
      .select({
        dataBlock2: anamnesisSessions.dataBlock2,
        dataBlock3: anamnesisSessions.dataBlock3,
      })
      .from(anamnesisSessions)
      .where(eq(anamnesisSessions.id, anamnesisSessionId))
      .limit(1);
    if (!session) return null;

    const structured = anamnesisStructuredSchema.safeParse(session.dataBlock3);

    let health: { pain?: unknown; parq?: unknown } | null = null;
    if (session.dataBlock2) {
      try {
        const parsed = healthBlockSchema.parse(
          JSON.parse(await this.cipher.decryptHealth(session.dataBlock2)),
        );
        health = { pain: parsed.pain, parq: parsed.parq };
      } catch {
        health = null;
      }
    }

    return {
      respostasFormulario: structured.success ? structured.data : null,
      dor: health?.pain ?? null,
      parq: health?.parq ?? null,
    };
  }

  async loadScrubUser(userId: string): Promise<ScrubUser> {
    return this.db.runAsUser(userId, 'USER', async (tx) => {
      const [user] = await tx
        .select({ name: users.name, phoneNumber: users.phoneNumber, email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return {
        name: user?.name ?? null,
        phoneNumber: user?.phoneNumber ?? null,
        email: user?.email ?? null,
      };
    });
  }

  async upsertSummary(userId: string, sessionDate: string, summary: string): Promise<void> {
    await this.db.runAsUser(userId, 'USER', async (tx) => {
      await tx
        .insert(coachingSessions)
        .values({ userId, sessionDate, summary })
        .onConflictDoUpdate({
          target: [coachingSessions.userId, coachingSessions.sessionDate],
          set: { summary, updatedAt: new Date() },
        });
    });
  }
}
