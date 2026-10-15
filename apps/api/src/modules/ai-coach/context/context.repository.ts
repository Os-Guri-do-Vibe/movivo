/**
 * ContextRepository (US-3.2) — I/O de banco da episodic memory, sob `SET LOCAL`/RLS.
 *
 * Isolado do `ContextService` (lógica pura) pelo mesmo motivo do `AiJobRepository`: é
 * mapeamento Drizzle sem ramo, escopado por titular via `runAsUser`, provado pelo teste de
 * integração contra Postgres real — por isso fica fora da cobertura unitária (vitest.config).
 */
import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, ne } from 'drizzle-orm';
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
  conversations,
  protocolVersions,
  workoutCompletions,
  workoutSessions,
  workoutSetEntries,
} from '../../../core/database/schema';
import {
  TenantDatabase,
  type TenantTransaction,
} from '../../../core/database/tenant-database.service';
import { healthBlockSchema } from '../../anamnesis/health-block';
import { isProfessionalAuthored, MANUAL_AMENDMENT_ORIGIN } from '../../protocol/protocol-origin';
import { dayKey, sessionFor, weekdayCode, WORKOUT_TIMEZONE } from '../../workout/workout-schedule';
import type { ScrubUser } from '../llm/llm.types';
import { buildRetrato, RETRATO_WINDOW_DAYS } from './retrato';
import { TRANSCRIPT_MAX_AGE_DAYS, TRANSCRIPT_MAX_ROWS, type TranscriptRow } from './transcript';

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

  /**
   * Últimas mensagens da conversa, do histórico durável e já decifradas (ver `transcript.ts`).
   * Fica de fora o que não é fala: registro de 👍/👎 (`message_type = 'SYSTEM'`). Cada linha é
   * decifrada em paralelo; falha em UMA linha a descarta em vez de derrubar a resposta.
   */
  async loadTranscript(userId: string, now: Date): Promise<TranscriptRow[]> {
    const since = new Date(now.getTime() - TRANSCRIPT_MAX_AGE_DAYS * 86_400_000);
    const rows = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select({
          origin: conversations.origin,
          direction: conversations.direction,
          modelUsed: conversations.modelUsed,
          sourceType: conversations.sourceType,
          content: conversations.content,
          createdAt: conversations.createdAt,
        })
        .from(conversations)
        .where(
          and(
            eq(conversations.userId, userId),
            ne(conversations.messageType, 'SYSTEM'),
            gte(conversations.createdAt, since),
          ),
        )
        .orderBy(desc(conversations.createdAt))
        .limit(TRANSCRIPT_MAX_ROWS),
    );
    const decrypted = await Promise.all(
      rows.map(async (row) => {
        try {
          return { ...row, content: await this.cipher.decryptText(row.content) };
        } catch {
          return null;
        }
      }),
    );
    return decrypted.filter((row): row is TranscriptRow => row !== null);
  }

  /** Lê usuário (para scrub) + protocolo ativo + resumo do dia, tudo sob RLS do titular. */
  async loadEpisodic(userId: string, sessionDate: string): Promise<EpisodicMemory> {
    return this.db.runAsUser(userId, 'USER', async (tx) => {
      // As leituras abaixo são independentes entre si: disparadas juntas, o driver as
      // enfileira (pipelining) na MESMA conexão da transação — uma ida e volta de rede em vez
      // de seis em série por mensagem do Coach. Só a anamnese depende do protocolo.
      const [
        [user],
        [proto],
        [session],
        recentWorkouts,
        recentCheckins,
        diarioFino,
        [firstProtocol],
        retratoSessions,
      ] = await Promise.all([
        tx
          .select({ name: users.name, phoneNumber: users.phoneNumber, email: users.email })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1),
        tx
          .select({
            id: protocols.id,
            version: protocols.version,
            currentWeek: protocols.currentWeek,
            totalWeeks: protocols.totalWeeks,
            mesocycleNumber: protocols.mesocycleNumber,
            content: protocols.content,
            constraints: protocols.constraints,
            anamnesisSessionId: protocols.anamnesisSessionId,
            generatedBy: protocols.generatedBy,
            approvalStatus: protocols.approvalStatus,
            signedAt: protocols.signedAt,
          })
          .from(protocols)
          .where(and(eq(protocols.userId, userId), eq(protocols.status, 'ACTIVE')))
          .limit(1),
        tx
          .select({ summary: coachingSessions.summary })
          .from(coachingSessions)
          .where(
            and(eq(coachingSessions.userId, userId), eq(coachingSessions.sessionDate, sessionDate)),
          )
          .limit(1),
        // Memória factual mínima: eventos imutáveis e campos estruturados. O ciphertext das
        // respostas do check-in não é aberto aqui; princípio de minimização de dado sensível.
        tx
          .select({
            completedAt: workoutCompletions.completedAt,
            sessionKey: workoutCompletions.sessionKey,
            weekNumber: workoutCompletions.weekNumber,
            perceivedEffort: workoutCompletions.perceivedEffort,
          })
          .from(workoutCompletions)
          .where(eq(workoutCompletions.userId, userId))
          .orderBy(desc(workoutCompletions.completedAt))
          .limit(5),
        tx
          .select({
            weekNumber: checkins.weekNumber,
            submittedAt: checkins.submittedAt,
            answers: checkins.answers,
          })
          .from(checkins)
          .where(and(eq(checkins.userId, userId), eq(checkins.status, 'SUBMITTED')))
          .orderBy(desc(checkins.submittedAt))
          .limit(3),
        // Achado 2026-09-12 (decisão do fundador): o Coach passava a orientar o aluno sem
        // NUNCA ver o que de fato aconteceu no treino — carga/repetição/série real, esforço
        // percebido e dor por sessão (o diário fino, `workout_sessions`/`workout_set_entries`).
        // Sem isso ele só tinha o AUTORRELATO agregado de `workout_completions`. Aqui entram os
        // últimos treinos CONCLUÍDOS com planejado (a `prescription` já é o snapshot exato do
        // que foi prescrito NAQUELE dia — não precisa cruzar com `protocoloCompleto`) vs.
        // realizado (agregado por exercício a partir de `workout_set_entries`), para o Coach
        // comparar os dois e falar com base no que realmente aconteceu, não só no que o aluno
        // lembra ter feito.
        this.loadWorkoutDiary(tx, userId),
        // Retrato (camada 0): início do 1º protocolo do aluno e o que foi treinado na janela.
        tx
          .select({ startDate: protocols.startDate })
          .from(protocols)
          .where(eq(protocols.userId, userId))
          .orderBy(asc(protocols.startDate))
          .limit(1),
        tx
          .select({ date: workoutSessions.scheduledDate, status: workoutSessions.status })
          .from(workoutSessions)
          .where(
            and(
              eq(workoutSessions.userId, userId),
              gte(
                workoutSessions.scheduledDate,
                new Date(Date.now() - (RETRATO_WINDOW_DAYS + 1) * 86_400_000)
                  .toISOString()
                  .slice(0, 10),
              ),
            ),
          ),
      ]);

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

      // Achado 2026-10-15: o Coach lia o conteúdo vigente, mas não sabia DE QUEM era a
      // prescrição — diante de "por que trocaram meu exercício?" ele não tinha dado nenhum e
      // podia inventar justificativa clínica ou sugerir a versão anterior. Aqui vai só o que
      // existe de fato: quem prescreveu a versão vigente e, se o profissional ajustou um
      // protocolo em uso, o motivo que ELE registrou. Sem conflitos de regra nem detalhe
      // clínico da revisão.
      const prescricaoVigente = proto
        ? await this.loadPrescriptionOrigin(tx, {
            id: proto.id,
            version: proto.version,
            generatedBy: proto.generatedBy,
            approvalStatus: proto.approvalStatus,
            signedAt: proto.signedAt,
          })
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

      // As 3 últimas sessões raramente incluem o treino de HOJE (com ABC, a última sessão
      // do mesmo tipo foi há três treinos). Sem ela o Coach não tem a carga de referência de
      // quem pergunta "qual a carga de hoje?" depois de uma pausa. Uma consulta a mais, só
      // quando falta, e marcada para o modelo saber de qual treino se trata.
      const todaySession = content ? sessionFor(now, content) : null;
      if (todaySession && !diarioFino.some((entry) => entry.sessionKey === todaySession.dayLabel)) {
        const sameTraining = await this.loadWorkoutDiary(tx, userId, todaySession.dayLabel);
        diarioFino.push(...sameTraining.map((entry) => ({ ...entry, mesmoTreinoDeHoje: true })));
      }

      // Retrato: poucas dezenas de tokens, a última chave do estado (o que muda todo dia fica
      // depois do que é estável, para não invalidar mais prefixo do que o necessário).
      const retrato =
        proto && content && firstProtocol
          ? buildRetrato({
              now,
              firstProtocolStart: firstProtocol.startDate,
              mesocycleNumber: proto.mesocycleNumber,
              currentWeek: proto.currentWeek,
              totalWeeks: proto.totalWeeks,
              structure: content,
              completedDates: new Set(
                retratoSessions.filter((row) => row.status === 'COMPLETED').map((row) => row.date),
              ),
              inProgressDates: new Set(
                retratoSessions
                  .filter((row) => row.status === 'IN_PROGRESS')
                  .map((row) => row.date),
              ),
            })
          : null;

      const state: Record<string, unknown> = proto
        ? {
            temProtocoloAtivo: true,
            semanaAtual: proto.currentWeek,
            totalSemanas: proto.totalWeeks,
            restricoes: c.injuryTags ?? [],
            equipamentos: c.equipment ?? [],
            protocoloCompleto: content,
            prescricaoVigente,
            hoje,
            treinoDeHojeSegundoCalendario,
            anamnese,
            eventosRecentes: {
              treinosConcluidos: recentWorkouts,
              checkins: recentCheckins,
              diarioFino,
            },
            retrato,
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
        summary: session?.summary ? await this.cipher.decryptText(session.summary) : null,
      };
    });
  }

  /** Origem da versão vigente do protocolo (ver o comentário em `loadEpisodic`). */
  private async loadPrescriptionOrigin(
    tx: TenantTransaction,
    proto: {
      id: string;
      version: number;
      generatedBy: string | null;
      approvalStatus: string;
      signedAt: Date | null;
    },
  ): Promise<Record<string, unknown>> {
    const adjustedByProfessional = isProfessionalAuthored(proto.generatedBy);
    let reason: string | null = null;
    if (proto.generatedBy === MANUAL_AMENDMENT_ORIGIN) {
      const [version] = await tx
        .select({ changeReason: protocolVersions.changeReason })
        .from(protocolVersions)
        .where(
          and(
            eq(protocolVersions.protocolId, proto.id),
            eq(protocolVersions.version, proto.version),
          ),
        )
        .limit(1);
      reason = version?.changeReason?.trim().slice(0, 300) || null;
    }
    return {
      versao: proto.version,
      revisadaPeloProfissionalCref: proto.approvalStatus === 'HUMAN_APPROVED',
      ajustadaManualmentePeloProfissionalCref: adjustedByProfessional,
      vigenteDesde: proto.signedAt ? dayKey(proto.signedAt) : null,
      motivoRegistradoPeloProfissional: reason,
    };
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
    /** Só a sessão MAIS RECENTE deste treino (`session_key`), em vez das últimas N. */
    onlySessionKey?: string,
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
      .where(
        and(
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.status, 'COMPLETED'),
          onlySessionKey ? eq(workoutSessions.sessionKey, onlySessionKey) : undefined,
        ),
      )
      .orderBy(desc(workoutSessions.scheduledDate))
      .limit(onlySessionKey ? 1 : RECENT_DIARY_SESSIONS);
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
    const encrypted = await this.cipher.encryptText(summary);
    await this.db.runAsUser(userId, 'USER', async (tx) => {
      await tx
        .insert(coachingSessions)
        .values({ userId, sessionDate, summary: encrypted })
        .onConflictDoUpdate({
          target: [coachingSessions.userId, coachingSessions.sessionDate],
          set: { summary: encrypted, updatedAt: new Date() },
        });
    });
  }
}
