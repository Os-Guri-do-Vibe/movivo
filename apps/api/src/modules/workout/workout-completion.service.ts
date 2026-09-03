/**
 * `WorkoutCompletionService` — gravação do treino que o aluno **realmente fez** (US-8.1).
 *
 * # Canais de captura (decisão de produto TASK-8.1.1, fechada)
 *  1. **Quick reply diário no WhatsApp** (`WHATSAPP_QUICK_REPLY`) — canal primário.
 *  2. **Check-in semanal** (`CHECKIN`) — fallback, ver `recordFromCheckin`.
 *  3. ~~Menção espontânea na conversa~~ (`CONVERSATION`) — **fora desta entrega**. O valor
 *     do enum fica declarado porque ele define a precedência do dedupe, mas nada grava
 *     com essa fonte hoje: capturar "acabei de treinar" custaria inflar o classificador
 *     de intenção (token em toda mensagem do produto) para ganhar poucos registros, e a
 *     própria US diz explicitamente que o canal cai sem bloquear a entrega. Se a decisão
 *     for revista, o ponto de entrada é `WorkoutCompletionService.record(..., 'CONVERSATION')`
 *     a partir do worker de resposta do Coach — nada aqui muda.
 *
 * # Dedupe (TASK-8.1.2, regra 1)
 * A UNIQUE `(user_id, completed_at, session_key)` garante 1 linha por treino. A colisão
 * é resolvida pela **ordem de declaração** de `workout_completion_source`: enum nativo
 * compara pelo ordinal, então `source > excluded.source` no `setWhere` é literalmente
 * "a linha existente é de fonte menos específica que a chegando" — sem coluna de rank,
 * sem CASE. Fonte de maior precedência sobrescreve; a de menor não faz nada.
 */
import { Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { protocolStructureSchema, type ProtocolStructure } from '@movivo/shared';

import { protocols, subscriptions, workoutCompletions } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { plannedDaysBefore } from './workout-schedule';

/** Protocolo vigente do aluno, já com a estrutura validada. */
export interface ActiveProtocol {
  readonly id: string;
  readonly version: number;
  readonly weekNumber: number;
  readonly structure: ProtocolStructure;
}

/**
 * Fallback do check-in (TASK-8.1.4): a resposta fechada `workouts` vira contagem.
 *
 * ponytail: **reusa a pergunta que o check-in já faz** em vez de acrescentar uma quarta.
 * O check-in já pergunta "quantos treinos você concluiu desde o último check-in?" com
 * três faixas — acrescentar outra pergunta pediria mais um toque do aluno para produzir
 * o mesmo dado que já está no banco. `TRES_MAIS` é gravado como 3 (piso da faixa):
 * contagem inflada é pior que contagem baixa, e a US é explícita nisso. Se um dia o
 * check-in coletar o número exato, trocar este mapa pelo valor informado.
 */
const CHECKIN_WORKOUT_COUNT: Readonly<Record<string, number>> = {
  NENHUM: 0,
  UM_DOIS: 1,
  TRES_MAIS: 3,
};

/** Janela do check-in semanal: os 7 dias que antecedem a resposta. */
const CHECKIN_WINDOW_DAYS = 7;

@Injectable()
export class WorkoutCompletionService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WorkoutCompletionService.name);
  }

  /**
   * Grava uma conclusão, resolvendo colisão por precedência de fonte.
   * `completedAt` é o **dia civil** `YYYY-MM-DD` no fuso do produto, nunca um instante.
   * Retorna `true` quando a linha foi criada ou promovida a uma fonte mais específica.
   */
  async record(
    userId: string,
    protocolId: string,
    protocolVersion: number,
    weekNumber: number,
    sessionKey: string,
    completedAt: string,
    source: 'WEB_JOURNAL' | 'WHATSAPP_QUICK_REPLY' | 'CHECKIN' | 'CONVERSATION',
    extra?: { exercisesDone?: unknown; perceivedEffort?: number },
  ): Promise<boolean> {
    const values = {
      userId,
      protocolId,
      protocolVersion,
      weekNumber,
      sessionKey,
      completedAt,
      source,
      exercisesDone: extra?.exercisesDone ?? null,
      perceivedEffort: extra?.perceivedEffort ?? null,
    };
    const [row] = await this.db.runAsSystem((tx) =>
      tx
        .insert(workoutCompletions)
        .values(values)
        .onConflictDoUpdate({
          target: [
            workoutCompletions.userId,
            workoutCompletions.completedAt,
            workoutCompletions.sessionKey,
          ],
          set: {
            source: sql`excluded.source`,
            protocolId: sql`excluded.protocol_id`,
            protocolVersion: sql`excluded.protocol_version`,
            weekNumber: sql`excluded.week_number`,
            exercisesDone: sql`coalesce(excluded.exercises_done, ${workoutCompletions.exercisesDone})`,
            perceivedEffort: sql`coalesce(excluded.perceived_effort, ${workoutCompletions.perceivedEffort})`,
            updatedAt: new Date(),
          },
          // Fonte já gravada é MAIS específica (ordinal menor) => nada muda.
          setWhere: sql`${workoutCompletions.source} > excluded.source`,
        })
        .returning({ id: workoutCompletions.id }),
    );
    return row !== undefined;
  }

  /** Toque em "Treinei ✅": resolve o protocolo vigente e grava a conclusão do dia. */
  async recordFromQuickReply(
    userId: string,
    completedAt: string,
    sessionKey: string,
  ): Promise<boolean> {
    const active = await this.activeProtocol(userId);
    if (!active) return false;
    const recorded = await this.record(
      userId,
      active.id,
      active.version,
      active.weekNumber,
      sessionKey,
      completedAt,
      'WHATSAPP_QUICK_REPLY',
    );
    this.logger.info(
      { event: 'workout_completion_recorded', userId, completedAt, source: 'WHATSAPP_QUICK_REPLY' },
      'treino registrado pelo quick reply',
    );
    return recorded;
  }

  /**
   * Fallback do check-in (TASK-8.1.4). As conclusões são atribuídas aos **dias previstos
   * pelo protocolo** dentro da janela, nunca à data em que o aluno respondeu — e o
   * quick reply, de fonte mais específica, permanece intocado pela precedência do enum.
   */
  async recordFromCheckin(userId: string, workouts: string | undefined): Promise<number> {
    const count = workouts ? CHECKIN_WORKOUT_COUNT[workouts] : undefined;
    if (!count) return 0;
    const active = await this.activeProtocol(userId);
    if (!active) return 0;

    // Os dias mais recentes primeiro: se o aluno fez 1 de 3 treinos previstos, o mais
    // provável é o mais próximo da resposta.
    const planned = plannedDaysBefore(new Date(), CHECKIN_WINDOW_DAYS, active.structure)
      .slice(-count)
      .reverse();
    let written = 0;
    for (const day of planned) {
      if (
        await this.record(
          userId,
          active.id,
          active.version,
          active.weekNumber,
          day.sessionKey,
          day.completedAt,
          'CHECKIN',
        )
      ) {
        written += 1;
      }
    }
    this.logger.info(
      { event: 'workout_completion_recorded', userId, declared: count, written, source: 'CHECKIN' },
      'treinos registrados pelo fallback de check-in',
    );
    return written;
  }

  /**
   * Protocolo `ACTIVE` do aluno com assinatura `ACTIVE`. Roda como sistema: o titular
   * nunca lê `workout_completions` pelo caminho HTTP (não há UI de aluno — TASK-8.1.2).
   */
  async activeProtocol(userId: string): Promise<ActiveProtocol | null> {
    const [row] = await this.db.runAsSystem((tx) =>
      tx
        .select({
          id: protocols.id,
          version: protocols.version,
          currentWeek: protocols.currentWeek,
          content: protocols.content,
        })
        .from(protocols)
        .innerJoin(subscriptions, eq(subscriptions.userId, protocols.userId))
        .where(
          and(
            eq(protocols.userId, userId),
            eq(protocols.status, 'ACTIVE'),
            eq(subscriptions.status, 'ACTIVE'),
          ),
        )
        .orderBy(desc(protocols.createdAt))
        .limit(1),
    );
    if (!row) return null;
    const structure = protocolStructureSchema.safeParse(row.content);
    if (!structure.success) return null;
    return {
      id: row.id,
      version: row.version,
      weekNumber: row.currentWeek,
      structure: structure.data,
    };
  }
}
