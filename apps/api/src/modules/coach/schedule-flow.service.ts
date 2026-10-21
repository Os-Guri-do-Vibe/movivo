/**
 * Fluxo de agenda flexível pelo WhatsApp (2026-10-20): o aluno pede ao Coach para treinar em
 * outro dia, descansar num dia, reorganizar a semana, desfazer, ou pede o link do check-in.
 *
 * ## Quem decide o quê
 * A IA só LÊ o pedido (`ScheduleRequestParserService`). O novo arranjo sai do planejador
 * determinístico (`schedule-planner.ts`), a resposta é copy fixa (`schedule-messages.ts`) e o
 * link do dia vem do `WorkoutLinkDispatcherService`. O fluxo não tem nenhuma etapa de
 * confirmação: o aluno pediu, a regra permite, o Coach atende e oferece desfazer. Só pergunta
 * quando precisa: a semana está cheia e um treino tem de ficar de fora (uma pergunta, com a
 * lista das opções).
 *
 * ## O que NÃO bloqueia
 * Dor aberta, atendimento pausado, quantidade de ajustes na semana, ordem dos treinos e
 * recuperação não impedem um ajuste (orientação do RT: a distribuição dos treinos não pesa
 * para este público). Os únicos limites são físicos (ver `schedule-planner.ts`).
 *
 * ## Estado
 * Só existe estado quando o Coach fez a pergunta "qual treino fica de fora": o pedido original
 * fica em Redis por algumas horas, e a resposta do aluno ("o de sábado", "o 2") o completa. O
 * fluxo aberto tem prioridade sobre a classificação de intenção, como no de troca de exercício.
 */
import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import { REDIS_CLIENT, REDIS_KEY_BUILDER, type RedisKeyBuilder } from '../../core/redis';
import type { Intent } from '../ai-coach/intent/intent.types';
import type { ScrubUser } from '../ai-coach/llm/llm.types';
import {
  type AdjustmentRequest,
  type PlanFailure,
  planScheduleChange,
} from '../workout/schedule-planner';
import {
  type PreparedLink,
  WorkoutLinkDispatcherService,
} from '../workout/workout-link-dispatcher.service';
import { refreshOfferKey } from '../workout/workout-refresh-offer.service';
import { refreshAlreadyStartedMessage, refreshDeclinedMessage } from '../workout/workout-messages';
import { type ScheduleContext, WorkoutScheduleService } from '../workout/workout-schedule.service';
import { addDays, LATE_LOG_WINDOW_DAYS } from '../workout/schedule-planner';
import { shortWeekdayName } from '../workout/workout-eligibility';
import { type LateLogOption, WorkoutLateLogService } from '../workout/workout-late-log.service';
import { BUBBLE_SEPARATOR } from '../whatsapp/message-templates';
import {
  lateLogAlreadyLoggedMessage,
  lateLogOutOfWindowMessage,
  lateLogWhichDayMessage,
  lateLogWhichSessionQuestion,
  linkJustSentMessage,
  linkUnavailableMessage,
  type NameOf,
  noActiveProtocolMessage,
  noWorkoutTodayMessage,
  scheduleAlreadyThereMessage,
  scheduleAppliedMessage,
  scheduleChoiceQuestion,
  scheduleNotUnderstoodMessage,
  scheduleRefusalMessage,
  scheduleUndoUnavailableMessage,
  scheduleUndoneMessage,
  sessionName,
  workoutAlreadyDoneMessage,
} from './schedule-messages';
import {
  type ParsedScheduleRequest,
  ScheduleRequestParserService,
  type WeekDayForParser,
} from './schedule-request-parser.service';

/** Quanto tempo a pergunta "qual treino fica de fora" espera pela resposta. */
export const SCHEDULE_FLOW_TTL_SECONDS = 3 * 3600;
/** Esclarecimentos tolerados antes de encerrar a pergunta sem pressionar o aluno. */
export const MAX_SCHEDULE_FOLLOW_UPS = 3;

/** Intenções que abrem o fluxo. */
export const SCHEDULE_FLOW_INTENTS: readonly Intent[] = ['AJUSTE_AGENDA', 'PEDIDO_LINK_TREINO'];

const YES =
  /^(sim|s|pode(\s+(sim|mandar|enviar))?|quero|claro|manda(r)?|envia(r)?|ok|okay|beleza|blz|bora|isso|com\s+certeza|por\s+favor|uhum|aham|positivo)\b/;
const NO = /^(n[aã]o|nao|n|nem\s+precisa|dispenso|deixa(\s+(assim|quieto|pra\s+l[aá]))?)\b/;

/** Resposta curta à oferta de link novo. Qualquer outra coisa é outro assunto. */
export function answerToOffer(message: string): 'YES' | 'NO' | null {
  const text = message
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (YES.test(text)) return 'YES';
  if (NO.test(text)) return 'NO';
  return null;
}

/** Ações cujo dia importa: com uma data recusada, nenhuma delas pode seguir como "hoje". */
const DATED_ACTIONS: ReadonlyArray<ParsedScheduleRequest['action']> = [
  'TREINAR',
  'DESCANSAR',
  'REORGANIZAR',
  'REGISTRAR',
];

type PendingRequest = Extract<AdjustmentRequest, { kind: 'TRAIN_ON' | 'REST_ON' }>;

/**
 * Só existe estado quando o Coach fez uma pergunta e espera a resposta: qual treino fica de fora
 * (`leaveOut`) ou qual treino o aluno fez num dia que passou (`lateLog`).
 */
interface FlowState {
  followUps: number;
  leaveOut?: { request: PendingRequest; candidates: Array<{ date: string; sessionKey: string }> };
  lateLog?: { date: string; options: LateLogOption[] };
}

export type ScheduleFlowOutcome =
  /** O fluxo não tem nada a ver com a mensagem: segue o roteamento normal. */
  | { kind: 'NOT_HANDLED' }
  | {
      kind: 'FIXED';
      /** Balões separados por `BUBBLE_SEPARATOR`. */
      text: string;
      /** A agenda mudou: a pergunta pendente do Coach (treino sem registro) está respondida. */
      adjusted: boolean;
    };

export interface ScheduleFlowInput {
  userId: string;
  message: string;
  intent: Intent;
  scrubUser: ScrubUser;
  operationId: string;
  personaSlot: Parameters<ScheduleRequestParserService['parse']>[0]['personaSlot'];
  now?: Date;
}

@Injectable()
export class ScheduleFlowService {
  constructor(
    private readonly schedule: WorkoutScheduleService,
    private readonly links: WorkoutLinkDispatcherService,
    private readonly lateLogs: WorkoutLateLogService,
    private readonly parser: ScheduleRequestParserService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ScheduleFlowService.name);
  }

  private stateKey(userId: string): string {
    return this.keys.forUser(userId, 'schedule-flow', 'state');
  }

  /** Pergunta de "qual treino fica de fora" aberta OU oferta de link novo esperando resposta. */
  async hasOpenFlow(userId: string): Promise<boolean> {
    return (
      (await this.redis.exists(this.stateKey(userId))) === 1 ||
      (await this.redis.exists(refreshOfferKey(this.keys, userId))) === 1
    );
  }

  async abandon(userId: string): Promise<void> {
    await this.redis.del(this.stateKey(userId));
  }

  private async readState(userId: string): Promise<FlowState | null> {
    const raw = await this.redis.get(this.stateKey(userId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as FlowState;
    } catch {
      await this.abandon(userId);
      return null;
    }
  }

  async handle(input: ScheduleFlowInput): Promise<ScheduleFlowOutcome> {
    const now = input.now ?? new Date();
    const state = await this.readState(input.userId);
    const opens = SCHEDULE_FLOW_INTENTS.includes(input.intent);

    // Oferta de link novo (o treino de hoje mudou depois do link das 04:00): resposta curta, tratada
    // por regra, sem IA. Qualquer outra mensagem é outro assunto e a oferta segue esperando.
    if (!state && !opens && (await this.redis.exists(refreshOfferKey(this.keys, input.userId)))) {
      const answer = answerToOffer(input.message);
      if (answer === null) return { kind: 'NOT_HANDLED' };
      return this.answerRefreshOffer(input.userId, answer, now);
    }
    if (!state && !opens) return { kind: 'NOT_HANDLED' };

    const ctx = await this.schedule.weekContext(input.userId, now);
    if (!ctx) {
      await this.abandon(input.userId);
      return opens
        ? { kind: 'FIXED', text: noActiveProtocolMessage(), adjusted: false }
        : { kind: 'NOT_HANDLED' };
    }
    const nameOf = this.nameOf(ctx);

    // Pedido só do link: não precisa da IA.
    if (!state && input.intent === 'PEDIDO_LINK_TREINO') {
      return { kind: 'FIXED', text: await this.linkReply(input.userId, now), adjusted: false };
    }

    const parsed = await this.parser.parse({
      userId: input.userId,
      operationId: input.operationId,
      user: input.scrubUser,
      message: input.message,
      today: ctx.today,
      week: this.weekForParser(ctx),
      recentDays: [1, 2].map((back) => {
        const date = addDays(ctx.today, -back);
        return { date, weekday: shortWeekdayName(date) };
      }),
      sessions: ctx.structure.sessions.map((session) => ({
        key: session.dayLabel,
        label: sessionName({ dayLabel: session.dayLabel, focus: session.focus }),
      })),
      openQuestion: state ? this.questionText(state, nameOf) : undefined,
      personaSlot: input.personaSlot,
    });

    // Resposta à pergunta "qual treino você fez?": o treino citado completa o registro tardio.
    const answeredSession =
      parsed.sessionKey ?? parsed.leaveOut.find((item) => item.sessionKey)?.sessionKey;
    if (state?.lateLog && answeredSession && !['DESFAZER', 'LINK'].includes(parsed.action)) {
      return this.lateLog(input, state, state.lateLog.date, answeredSession, now);
    }

    // Fluxo aberto e a mensagem é de outro assunto: solta o estado e segue o roteamento normal.
    if (state && parsed.action === 'OUTRO' && !opens) {
      await this.abandon(input.userId);
      return { kind: 'NOT_HANDLED' };
    }

    // O aluno pediu um dia que a regra não aceita (semana que vem, dia antigo): recusa explicando.
    // Sem isto a data descartada virava "não disse" e o pedido era aplicado em HOJE.
    if (parsed.invalidDate && DATED_ACTIONS.includes(parsed.action)) {
      return this.refuseInvalidDate(input.userId, ctx, nameOf, parsed.action, parsed.invalidDate);
    }

    switch (parsed.action) {
      case 'REGISTRAR':
        return this.lateLog(
          input,
          state,
          parsed.date ?? state?.lateLog?.date ?? null,
          parsed.sessionKey,
          now,
        );
      case 'LINK':
        return { kind: 'FIXED', text: await this.linkReply(input.userId, now), adjusted: false };
      case 'DESFAZER':
        return this.undo(input.userId, ctx, nameOf, now);
      case 'TREINAR':
        return this.adjust(
          input,
          ctx,
          nameOf,
          {
            kind: 'TRAIN_ON',
            date: parsed.date ?? ctx.today,
            ...(parsed.sessionKey ? { sessionKey: parsed.sessionKey } : {}),
            ...(parsed.leaveOut.length > 0 ? { leaveOut: parsed.leaveOut } : {}),
          },
          state,
          now,
        );
      case 'DESCANSAR':
        return this.adjust(
          input,
          ctx,
          nameOf,
          {
            kind: 'REST_ON',
            date: parsed.date ?? ctx.today,
            ...(parsed.leaveOut.length > 0 ? { leaveOut: parsed.leaveOut } : {}),
          },
          state,
          now,
        );
      case 'REORGANIZAR':
        if (parsed.placements.length === 0) return this.notUnderstood(input.userId, state);
        return this.adjust(
          input,
          ctx,
          nameOf,
          { kind: 'REORGANIZE', placements: parsed.placements },
          state,
          now,
        );
      case 'ESCOLHA':
        if (!state?.leaveOut || parsed.leaveOut.length === 0) {
          return this.notUnderstood(input.userId, state);
        }
        return this.adjust(
          input,
          ctx,
          nameOf,
          { ...state.leaveOut.request, leaveOut: parsed.leaveOut },
          state,
          now,
        );
      default:
        return this.notUnderstood(input.userId, state);
    }
  }

  // --- ajuste ---------------------------------------------------------------------------------

  private async adjust(
    input: ScheduleFlowInput,
    ctx: ScheduleContext,
    nameOf: NameOf,
    request: AdjustmentRequest,
    state: FlowState | null,
    now: Date,
  ): Promise<ScheduleFlowOutcome> {
    const sessionKeys = ctx.structure.sessions.map((session) => session.dayLabel);
    const plan = planScheduleChange({
      today: ctx.today,
      slots: ctx.slots,
      quota: ctx.quota,
      sessionKeys,
      request,
    });

    if (!plan.ok) {
      if (plan.reason === 'FULL_WEEK') {
        // `REORGANIZE` já diz onde fica cada treino: nunca devolve semana cheia.
        if (request.kind === 'REORGANIZE') return this.notUnderstood(input.userId, state);
        return this.askWhichToLeaveOut(input.userId, ctx, nameOf, request, plan, state);
      }
      await this.abandon(input.userId);
      return {
        kind: 'FIXED',
        text: scheduleRefusalMessage({
          reason: plan.reason,
          today: ctx.today,
          date: plan.date,
          sessionKey: plan.sessionKey,
          quota: ctx.quota,
          pending: ctx.slots.filter((slot) => slot.sessionKey !== null && !slot.locked).length,
          sessionNames: ctx.structure.sessions.map((session) => ({
            dayLabel: session.dayLabel,
            focus: session.focus,
          })),
          nameOf,
        }),
        adjusted: false,
      };
    }

    await this.abandon(input.userId);

    if (plan.noop) {
      if (request.kind === 'REORGANIZE') {
        return { kind: 'FIXED', text: scheduleNotUnderstoodMessage(), adjusted: false };
      }
      const slot = plan.slots.find((candidate) => candidate.date === request.date);
      const text =
        request.kind === 'TRAIN_ON' && slot?.sessionKey
          ? scheduleAlreadyThereMessage({
              request: { kind: 'TRAIN_ON', date: request.date, sessionKey: slot.sessionKey },
              today: ctx.today,
              nameOf,
            })
          : scheduleAlreadyThereMessage({
              request: { kind: 'REST_ON', date: request.date },
              today: ctx.today,
              nameOf,
            });
      // Treinar hoje num dia que já é de treino: manda o link do dia.
      if (request.kind === 'TRAIN_ON' && request.date === ctx.today && slot?.sessionKey) {
        const link = await this.safely(input.userId, () =>
          this.links.prepare(input.userId, 'RESEND', now),
        );
        if (link === undefined) {
          return {
            kind: 'FIXED',
            text: [text, linkUnavailableMessage('DAILY')].join(BUBBLE_SEPARATOR),
            adjusted: false,
          };
        }
        if (link.status === 'READY') {
          return { kind: 'FIXED', text: [text, link.text].join(BUBBLE_SEPARATOR), adjusted: false };
        }
      }
      return { kind: 'FIXED', text, adjusted: false };
    }

    await this.schedule.apply(input.userId, ctx, plan, {
      kind: request.kind,
      idempotencyKey: `chat:${input.operationId}`.slice(0, 80),
    });

    const applied =
      request.kind === 'TRAIN_ON'
        ? {
            kind: 'TRAIN_ON' as const,
            date: request.date,
            sessionKey:
              plan.slots.find((slot) => slot.date === request.date)?.sessionKey ??
              request.sessionKey ??
              '',
          }
        : request.kind === 'REST_ON'
          ? { kind: 'REST_ON' as const, date: request.date }
          : { kind: 'REORGANIZE' as const };
    const message = scheduleAppliedMessage({
      request: applied,
      today: ctx.today,
      slots: plan.slots,
      dropped: plan.dropped,
      nameOf,
      seed: input.operationId,
    });

    // O link do dia sai logo depois do ajuste quando o treino de HOJE passou a ser outro (ou
    // passou a existir): o aluno pediu para treinar agora, então o registro precisa estar à mão.
    const todayBefore = ctx.slots.find((slot) => slot.date === ctx.today)?.sessionKey ?? null;
    const todayAfter = plan.slots.find((slot) => slot.date === ctx.today)?.sessionKey ?? null;
    const bubbles = [message];
    if (todayAfter !== null && todayAfter !== todayBefore) {
      // O ajuste JÁ está gravado: se o link falhar, o aluno ainda recebe a confirmação e a saída
      // ("me manda o link"), em vez de o job cair no fallback genérico do DLQ sem nenhuma resposta.
      const link = await this.safely(input.userId, () =>
        this.links.prepare(input.userId, 'ON_DEMAND', now),
      );
      if (link === undefined) bubbles.push(linkUnavailableMessage('DAILY'));
      else if (link.status === 'READY') bubbles.push(link.text);
    }
    this.logger.info(
      {
        event: 'schedule_flow_applied',
        userId: input.userId,
        kind: request.kind,
        changes: plan.changes.length,
        dropped: plan.dropped.length,
      },
      'ajuste de agenda atendido pelo Coach',
    );
    return { kind: 'FIXED', text: bubbles.join(BUBBLE_SEPARATOR), adjusted: true };
  }

  private async askWhichToLeaveOut(
    userId: string,
    ctx: ScheduleContext,
    nameOf: NameOf,
    request: PendingRequest,
    plan: Extract<PlanFailure, { reason: 'FULL_WEEK' }>,
    state: FlowState | null,
  ): Promise<ScheduleFlowOutcome> {
    const followUps = (state?.followUps ?? 0) + 1;
    if (followUps > MAX_SCHEDULE_FOLLOW_UPS || plan.candidates.length === 0) {
      await this.abandon(userId);
      return { kind: 'FIXED', text: scheduleNotUnderstoodMessage(), adjusted: false };
    }
    // O pedido volta ao estado SEM o `leaveOut` anterior: a próxima resposta traz o novo.
    const base: PendingRequest =
      request.kind === 'TRAIN_ON'
        ? { kind: 'TRAIN_ON', date: request.date, sessionKey: request.sessionKey }
        : { kind: 'REST_ON', date: request.date };
    const next: FlowState = {
      followUps,
      leaveOut: { request: base, candidates: plan.candidates },
    };
    await this.redis.set(
      this.stateKey(userId),
      JSON.stringify(next),
      'EX',
      SCHEDULE_FLOW_TTL_SECONDS,
    );
    return {
      kind: 'FIXED',
      text: scheduleChoiceQuestion({
        request: { kind: request.kind, date: request.date },
        today: ctx.today,
        candidates: plan.candidates,
        nameOf,
      }),
      adjusted: false,
    };
  }

  private async refuseInvalidDate(
    userId: string,
    ctx: ScheduleContext,
    nameOf: NameOf,
    action: ParsedScheduleRequest['action'],
    invalidDate: string,
  ): Promise<ScheduleFlowOutcome> {
    await this.abandon(userId);
    const text =
      action === 'REGISTRAR'
        ? lateLogOutOfWindowMessage(LATE_LOG_WINDOW_DAYS)
        : scheduleRefusalMessage({
            reason: invalidDate < ctx.today ? 'PAST_DATE' : 'OUT_OF_WEEK',
            today: ctx.today,
            date: invalidDate,
            quota: ctx.quota,
            sessionNames: ctx.structure.sessions.map((session) => ({
              dayLabel: session.dayLabel,
              focus: session.focus,
            })),
            nameOf,
          });
    return { kind: 'FIXED', text, adjusted: false };
  }

  // --- desfazer e link ------------------------------------------------------------------------

  private async undo(
    userId: string,
    ctx: ScheduleContext,
    nameOf: NameOf,
    now: Date,
  ): Promise<ScheduleFlowOutcome> {
    await this.abandon(userId);
    const result = await this.schedule.undoLast(userId, now);
    if (result.status !== 'UNDONE') {
      return {
        kind: 'FIXED',
        text: scheduleUndoUnavailableMessage(result.status),
        adjusted: false,
      };
    }
    const fresh = (await this.schedule.weekContext(userId, now)) ?? ctx;
    const bubbles = [scheduleUndoneMessage({ slots: fresh.slots, today: fresh.today, nameOf })];
    // O calendário de hoje voltou a ser outro: o link que o aluno tem pode estar apontando para
    // um treino que não vale mais. Um link novo evita registrar o treino errado.
    const todayRestored = result.restored.find((item) => item.date === ctx.today);
    if (todayRestored && todayRestored.sessionKey !== null) {
      const link = await this.safely(userId, () => this.links.prepare(userId, 'ON_DEMAND', now));
      if (link === undefined) bubbles.push(linkUnavailableMessage('DAILY'));
      else if (link.status === 'READY') bubbles.push(link.text);
    }
    return { kind: 'FIXED', text: bubbles.join(BUBBLE_SEPARATOR), adjusted: true };
  }

  /** "Sim" ou "não" à oferta de link novo. */
  private async answerRefreshOffer(
    userId: string,
    answer: 'YES' | 'NO',
    now: Date,
  ): Promise<ScheduleFlowOutcome> {
    if (answer === 'NO') {
      await this.redis.del(refreshOfferKey(this.keys, userId));
      return { kind: 'FIXED', text: refreshDeclinedMessage(), adjusted: false };
    }
    const link = await this.safely(userId, () => this.links.prepare(userId, 'REFRESH', now));
    // Falhou ao gerar: a oferta continua aberta, e um novo "sim" tenta de novo.
    if (link === undefined) {
      return { kind: 'FIXED', text: linkUnavailableMessage('DAILY'), adjusted: false };
    }
    await this.redis.del(refreshOfferKey(this.keys, userId));
    return {
      kind: 'FIXED',
      text: link.status === 'READY' ? link.text : this.linkProblemText(link),
      adjusted: false,
    };
  }

  private linkProblemText(link: Exclude<PreparedLink, { status: 'READY' }>): string {
    switch (link.status) {
      case 'NO_WORKOUT_TODAY':
        return noWorkoutTodayMessage();
      case 'ALREADY_DONE':
        return workoutAlreadyDoneMessage(link.focus);
      case 'ALREADY_STARTED':
        return refreshAlreadyStartedMessage();
      case 'THROTTLED':
        return linkJustSentMessage();
      case 'NO_PROTOCOL':
        return noActiveProtocolMessage();
    }
  }

  private async linkReply(userId: string, now: Date): Promise<string> {
    const link = await this.safely(userId, () => this.links.prepare(userId, 'RESEND', now));
    if (link === undefined) return linkUnavailableMessage('DAILY');
    // Um link novo já resolve a oferta pendente de link atualizado.
    if (link.status === 'READY') await this.redis.del(refreshOfferKey(this.keys, userId));
    switch (link.status) {
      case 'READY':
        return link.text;
      case 'ALREADY_STARTED':
        return refreshAlreadyStartedMessage();
      case 'NO_WORKOUT_TODAY':
        return noWorkoutTodayMessage();
      case 'ALREADY_DONE':
        return workoutAlreadyDoneMessage(link.focus);
      case 'THROTTLED':
        return linkJustSentMessage();
      case 'NO_PROTOCOL':
        return noActiveProtocolMessage();
    }
  }

  private async notUnderstood(
    userId: string,
    state: FlowState | null,
  ): Promise<ScheduleFlowOutcome> {
    if (state) {
      const followUps = state.followUps + 1;
      if (followUps > MAX_SCHEDULE_FOLLOW_UPS) {
        await this.abandon(userId);
      } else {
        await this.redis.set(
          this.stateKey(userId),
          JSON.stringify({ ...state, followUps }),
          'EX',
          SCHEDULE_FLOW_TTL_SECONDS,
        );
      }
    }
    return { kind: 'FIXED', text: scheduleNotUnderstoodMessage(), adjusted: false };
  }

  /**
   * Gera o link sem deixar a falha escapar: devolve `undefined` e registra (`null` continua sendo
   * uma resposta válida do serviço, como "aluno não encontrado"). Quando o ajuste já está
   * gravado, o aluno precisa da confirmação mesmo sem o link (o retry do job NÃO refaria a
   * resposta: encontra o lote vazio e cai no fallback genérico).
   */
  private async safely<T>(userId: string, action: () => Promise<T>): Promise<T | undefined> {
    try {
      return await action();
    } catch (err: unknown) {
      this.logger.warn(
        { event: 'schedule_flow_link_failed', userId, err },
        'não foi possível gerar o link; o aluno recebe a confirmação e a orientação para pedir',
      );
      return undefined;
    }
  }

  // --- apoio ----------------------------------------------------------------------------------

  private nameOf(ctx: ScheduleContext): NameOf {
    return (key) => {
      const session = ctx.structure.sessions.find((candidate) => candidate.dayLabel === key);
      return { dayLabel: key, focus: session?.focus ?? key };
    };
  }

  private weekForParser(ctx: ScheduleContext): WeekDayForParser[] {
    return ctx.slots.map((slot) => ({
      date: slot.date,
      weekday: shortWeekdayName(slot.date),
      sessionKey: slot.sessionKey,
      situation: slot.locked
        ? 'feito'
        : slot.sessionKey === null
          ? 'descanso'
          : slot.date < ctx.today
            ? 'sem registro'
            : 'previsto',
    }));
  }

  private questionText(state: FlowState, nameOf: NameOf): string {
    if (state.lateLog) {
      const options = state.lateLog.options
        .map((option) => `${option.key} (${option.focus})`)
        .join('; ');
      return `Qual treino você fez em ${state.lateLog.date} (${shortWeekdayName(state.lateLog.date)})? Opções: ${options}.`;
    }
    const options = (state.leaveOut?.candidates ?? [])
      .map(
        (candidate, index) =>
          `${index + 1}) ${candidate.date} (${shortWeekdayName(candidate.date)}), treino ${candidate.sessionKey} ${sessionName(nameOf(candidate.sessionKey))}`,
      )
      .join('; ');
    return `Qual treino fica de fora da semana? Opções: ${options}.`;
  }

  // --- registro tardio ------------------------------------------------------------------------

  /**
   * "Treinei ontem e não consegui registrar": abre o treino daquele dia (até
   * `LATE_LOG_WINDOW_DAYS` dias atrás) e manda o link do registro, sem cronômetro. Se o dia não
   * tinha treino previsto e o aluno não disse qual fez, pergunta (uma vez, com as opções).
   */
  private async lateLog(
    input: ScheduleFlowInput,
    state: FlowState | null,
    date: string | null,
    sessionKey: string | null | undefined,
    now: Date,
  ): Promise<ScheduleFlowOutcome> {
    if (!date) {
      return { kind: 'FIXED', text: lateLogWhichDayMessage(), adjusted: false };
    }
    const result = await this.lateLogs.begin(
      input.userId,
      { date, ...(sessionKey ? { sessionKey } : {}) },
      now,
    );
    switch (result.status) {
      case 'READY': {
        await this.abandon(input.userId);
        const link = await this.safely(input.userId, () =>
          this.links.prepareLateLog(input.userId, result, now),
        );
        // O registro já foi aberto (idempotente): pedir de novo gera só o link.
        if (link === undefined) {
          return { kind: 'FIXED', text: linkUnavailableMessage('LATE_LOG'), adjusted: true };
        }
        if (!link) return { kind: 'FIXED', text: noActiveProtocolMessage(), adjusted: false };
        return { kind: 'FIXED', text: link.text, adjusted: true };
      }
      case 'NEEDS_SESSION':
      case 'UNKNOWN_SESSION': {
        const followUps = (state?.followUps ?? 0) + 1;
        if (followUps > MAX_SCHEDULE_FOLLOW_UPS) {
          await this.abandon(input.userId);
          return { kind: 'FIXED', text: scheduleNotUnderstoodMessage(), adjusted: false };
        }
        const next: FlowState = { followUps, lateLog: { date, options: result.options } };
        await this.redis.set(
          this.stateKey(input.userId),
          JSON.stringify(next),
          'EX',
          SCHEDULE_FLOW_TTL_SECONDS,
        );
        return {
          kind: 'FIXED',
          text: lateLogWhichSessionQuestion({ options: result.options }),
          adjusted: false,
        };
      }
      case 'OUT_OF_WINDOW':
        await this.abandon(input.userId);
        return {
          kind: 'FIXED',
          text: lateLogOutOfWindowMessage(LATE_LOG_WINDOW_DAYS),
          adjusted: false,
        };
      case 'ALREADY_LOGGED':
        await this.abandon(input.userId);
        return { kind: 'FIXED', text: lateLogAlreadyLoggedMessage(result.focus), adjusted: false };
      case 'NO_PROTOCOL':
        await this.abandon(input.userId);
        return { kind: 'FIXED', text: noActiveProtocolMessage(), adjusted: false };
    }
  }
}

export type { ParsedScheduleRequest };
