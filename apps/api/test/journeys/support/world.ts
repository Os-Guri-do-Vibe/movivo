/**
 * O "mundo" das jornadas: todos os serviços REAIS da agenda flexível ligados entre si sobre o
 * banco do harness, mais fixtures (aluno, protocolo, assinatura, consentimento) e os gestos do
 * aluno (mandar mensagem ao Coach, abrir o link, treinar, finalizar).
 *
 * Fakes só nas bordas (`fakes.ts`). O relógio é controlado por `vi.setSystemTime` (só `Date` é
 * falsificado; timers de rede seguem reais) e, onde o serviço aceita, por `now` explícito.
 */
import { randomUUID } from 'node:crypto';

import {
  CONSENT_TEXTS,
  DEFAULT_AGENT_PERSONA,
  type FinishWorkoutInput,
  type ProtocolSession,
  type ProtocolStructure,
  type Weekday,
  type WorkoutSetInput,
} from '@movivo/shared';
import { and, asc, eq } from 'drizzle-orm';
import { vi } from 'vitest';

import { CoachAttendanceService } from '../../../src/core/database/coach-attendance.service';
import {
  consents,
  handoffAlerts,
  protocols,
  protocolVersions,
  subscriptions,
  users,
  workoutAccessTokens,
  workoutCompletions,
  workoutScheduleAdjustments,
  workoutSessions,
  workoutSetEntries,
} from '../../../src/core/database/schema';
import { ContextRepository } from '../../../src/modules/ai-coach/context/context.repository';
import type { Intent } from '../../../src/modules/ai-coach/intent/intent.types';
import { ScheduleFlowService } from '../../../src/modules/coach/schedule-flow.service';
import { ScheduleRequestParserService } from '../../../src/modules/coach/schedule-request-parser.service';
import { WorkoutFeedbackService } from '../../../src/modules/coach/workout-feedback.service';
import { WorkoutFeedbackWorker } from '../../../src/modules/coach/workout-feedback.worker';
import { FollowupService } from '../../../src/modules/followup/followup.service';
import { ValidationService } from '../../../src/modules/protocol/validation/validation.service';
import { ShortLinkService } from '../../../src/modules/short-link/short-link.service';
import { AttendanceAlertService } from '../../../src/modules/workout/attendance-alert.service';
import { MissedWorkoutAskPolicy } from '../../../src/modules/workout/missed-workout-ask.policy';
import { TrainingAccessService } from '../../../src/modules/training/training-access.service';
import { WorkoutCompletionService } from '../../../src/modules/workout/workout-completion.service';
import { localParts } from '../../../src/modules/workout/workout-eligibility';
import { WorkoutJournalService } from '../../../src/modules/workout/workout-journal.service';
import { WorkoutLateLogService } from '../../../src/modules/workout/workout-late-log.service';
import { WorkoutLinkDispatcherService } from '../../../src/modules/workout/workout-link-dispatcher.service';
import { WorkoutProtocolChangedWorker } from '../../../src/modules/workout/workout-protocol-changed.worker';
import { WorkoutRefreshOfferService } from '../../../src/modules/workout/workout-refresh-offer.service';
import { WorkoutScheduleService } from '../../../src/modules/workout/workout-schedule.service';
import { WorkoutScheduler } from '../../../src/modules/workout/workout.scheduler';
import { FakeLlm, FakeQueues, FakeRedis, fakeCipher, fakeLogger, KEYS } from './fakes';
import { type JourneyDatabase, startJourneyDatabase } from './pglite';

export const SITE = 'https://movivo.test';

/** Instante UTC da hora de parede `YYYY-MM-DD HH:mm` no fuso do aluno. */
export function instant(local: string, timezone = 'America/Sao_Paulo'): Date {
  const wall = Date.parse(`${local.replace(' ', 'T')}:00.000Z`);
  let guess = wall;
  for (let pass = 0; pass < 3; pass += 1) {
    const parts = localParts(new Date(guess), timezone);
    if (!parts) break;
    const seen = Date.parse(`${parts.date}T${parts.time}:00.000Z`);
    guess -= seen - wall;
  }
  return new Date(guess);
}

/** Avança o relógio do processo (só `Date`) e devolve o instante, para passar como `now`. */
export function clock(local: string, timezone = 'America/Sao_Paulo'): Date {
  const at = instant(local, timezone);
  vi.setSystemTime(at);
  return at;
}

/** Duas séries de trabalho por exercício; ids reais do catálogo. */
const EXERCISES: Record<string, Array<{ exerciseId: string; name: string }>> = {
  A: [
    { exerciseId: 'supino_reto_barra', name: 'Supino reto com barra' },
    { exerciseId: 'rosca_direta_barra', name: 'Rosca direta com barra' },
  ],
  B: [
    { exerciseId: 'leg_press_45_maquina', name: 'Leg press 45' },
    { exerciseId: 'cadeira_extensora_maquina', name: 'Cadeira extensora' },
  ],
  C: [
    { exerciseId: 'remada_curvada_barra', name: 'Remada curvada com barra' },
    { exerciseId: 'rosca_martelo_halter', name: 'Rosca martelo com halter' },
  ],
  D: [{ exerciseId: 'desenvolvimento_de_ombros_halter', name: 'Desenvolvimento com halter' }],
  E: [{ exerciseId: 'elevacao_frontal_barra', name: 'Elevação frontal com barra' }],
};

const FOCUS: Record<string, string> = {
  A: 'Peito e Bíceps',
  B: 'Pernas',
  C: 'Costas',
  D: 'Ombros',
  E: 'Ombros e Core',
};

export function session(key: string, weekday: Weekday, override?: Partial<ProtocolSession>) {
  return {
    dayLabel: key,
    weekday,
    focus: FOCUS[key] ?? key,
    exercises: (EXERCISES[key] ?? EXERCISES.A ?? []).map((exercise) => ({
      ...exercise,
      sets: 2,
      reps: { min: 8, max: 12 },
      loadStrategy: 'DOUBLE_PROGRESSION' as const,
      restSeconds: 90,
    })),
    ...override,
  } satisfies ProtocolSession;
}

export function structureOf(sessions: ProtocolSession[]): ProtocolStructure {
  return {
    promptVersion: 'journey-test',
    goal: 'GAIN_MUSCLE',
    phase: 'HIPERTROFIA',
    weeklyFrequency: sessions.length,
    sessions,
    phaseDurationWeeks: 6,
  };
}

export interface Student {
  userId: string;
  protocolId: string;
  name: string;
  phone: string;
  email: string;
  timezone: string;
  structure: ProtocolStructure;
}

export interface World {
  db: JourneyDatabase;
  redis: FakeRedis;
  queues: FakeQueues;
  llm: FakeLlm;
  schedule: WorkoutScheduleService;
  journal: WorkoutJournalService;
  completion: WorkoutCompletionService;
  access: TrainingAccessService;
  shortLinks: ShortLinkService;
  dispatcher: WorkoutLinkDispatcherService;
  refreshOffer: WorkoutRefreshOfferService;
  protocolChanged: WorkoutProtocolChangedWorker;
  lateLog: WorkoutLateLogService;
  flow: ScheduleFlowService;
  scheduler: WorkoutScheduler;
  context: ContextRepository;
  feedbackWorker: WorkoutFeedbackWorker;
  attendance: CoachAttendanceService;
  close(): Promise<void>;
}

export async function startWorld(): Promise<World> {
  const db = await startJourneyDatabase();
  const tenant = db.tenant;
  const redis = new FakeRedis();
  const queues = new FakeQueues();
  const llm = new FakeLlm();
  const config = { whatsapp: { publicSiteUrl: SITE } };
  const workers = { create: vi.fn() };
  const events = { emit: vi.fn() };
  const shareCards = { render: vi.fn() };
  const asAny = <T>(value: unknown) => value as T;

  const schedule = new WorkoutScheduleService(tenant, asAny(fakeLogger()));
  const completion = new WorkoutCompletionService(tenant, asAny(fakeLogger()));
  const followups = new FollowupService(tenant);
  const journal = new WorkoutJournalService(
    tenant,
    asAny(fakeCipher),
    completion,
    asAny(queues),
    asAny(events),
    asAny(shareCards),
    followups,
    schedule,
    asAny(fakeLogger()),
  );
  const access = new TrainingAccessService(tenant, asAny(config));
  const shortLinks = new ShortLinkService(tenant, asAny(fakeCipher));
  const dispatcher = new WorkoutLinkDispatcherService(
    tenant,
    journal,
    access,
    shortLinks,
    asAny(queues),
    asAny(config),
    asAny(redis),
    KEYS,
    asAny(fakeLogger()),
  );
  const refreshOffer = new WorkoutRefreshOfferService(
    tenant,
    journal,
    asAny(queues),
    asAny(redis),
    KEYS,
    asAny(fakeLogger()),
  );
  const protocolChanged = new WorkoutProtocolChangedWorker(asAny(workers), refreshOffer);
  const lateLog = new WorkoutLateLogService(tenant, schedule, journal, asAny(fakeLogger()));
  const parser = new ScheduleRequestParserService(asAny(llm), asAny(fakeLogger()));
  const flow = new ScheduleFlowService(
    schedule,
    dispatcher,
    lateLog,
    parser,
    asAny(redis),
    KEYS,
    asAny(fakeLogger()),
  );
  const attendance = new CoachAttendanceService(tenant);
  const askPolicy = new MissedWorkoutAskPolicy(tenant, journal, followups, attendance);
  const attendanceAlerts = new AttendanceAlertService(tenant, journal, asAny(events));
  const scheduler = new WorkoutScheduler(
    asAny(workers),
    asAny(queues),
    tenant,
    access,
    journal,
    shortLinks,
    asAny(config),
    followups,
    askPolicy,
    attendanceAlerts,
    asAny(redis),
    KEYS,
    asAny(fakeLogger()),
  );
  const context = new ContextRepository(tenant, asAny(fakeCipher));
  const feedback = new WorkoutFeedbackService(
    asAny(llm),
    new ValidationService(),
    asAny({ persona: async () => DEFAULT_AGENT_PERSONA }),
    asAny(fakeLogger()),
  );
  const feedbackWorker = new WorkoutFeedbackWorker(
    asAny(workers),
    asAny(queues),
    tenant,
    asAny(fakeCipher),
    feedback,
    journal,
    asAny(fakeLogger()),
  );

  return {
    db,
    redis,
    queues,
    llm,
    schedule,
    journal,
    completion,
    access,
    shortLinks,
    dispatcher,
    refreshOffer,
    protocolChanged,
    lateLog,
    flow,
    scheduler,
    context,
    feedbackWorker,
    attendance,
    close: () => db.close(),
  };
}

/**
 * Aluno pronto para receber o link das 04:00: usuário, consentimento de saúde vigente,
 * assinatura ativa, protocolo ATIVO com a v1 em `protocol_versions` desde `firstProtocolDate`.
 */
export async function createStudent(
  world: World,
  input: {
    name: string;
    sessions: ProtocolSession[];
    timezone?: string;
    firstProtocolDate?: string;
    biologicalSex?: 'MALE' | 'FEMALE';
  },
): Promise<Student> {
  const timezone = input.timezone ?? 'America/Sao_Paulo';
  const structure = structureOf(input.sessions);
  const phone = `+55119${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const email = `${phone.replace(/\D/g, '')}@example.invalid`;
  const start = instant(`${input.firstProtocolDate ?? '2026-10-05'} 09:00`, timezone);
  const admin = world.db.admin;

  const [user] = await admin
    .insert(users)
    .values({
      phoneNumber: phone,
      email,
      name: input.name,
      timezone,
      status: 'ACTIVE',
      biologicalSex: input.biologicalSex ?? 'MALE',
    })
    .returning({ id: users.id });
  if (!user) throw new Error('fixture: usuário não criado');
  await admin.insert(consents).values({
    userId: user.id,
    consentType: 'HEALTH_DATA',
    version: CONSENT_TEXTS.HEALTH_DATA.version,
    accepted: true,
  });
  await admin.insert(subscriptions).values({
    userId: user.id,
    plan: 'MONTHLY',
    priceCents: 7990,
    monthlyPriceCents: 7990,
    totalPriceCents: 7990,
    commitmentMonths: 1,
    status: 'ACTIVE',
  });
  const [protocol] = await admin
    .insert(protocols)
    .values({
      userId: user.id,
      status: 'ACTIVE',
      content: structure,
      constraints: {},
      mesocycleName: 'Mesociclo 1',
      startDate: start,
      endDate: new Date(start.getTime() + 6 * 7 * 86_400_000),
      totalWeeks: 6,
    })
    .returning({ id: protocols.id });
  if (!protocol) throw new Error('fixture: protocolo não criado');
  await admin.insert(protocolVersions).values({
    protocolId: protocol.id,
    userId: user.id,
    version: 1,
    status: 'ACTIVE',
    content: structure,
    createdAt: start,
  });
  return {
    userId: user.id,
    protocolId: protocol.id,
    name: input.name,
    phone,
    email,
    timezone,
    structure,
  };
}

/**
 * Publica uma versão nova do protocolo (troca de exercício aprovada ou emenda do CREF), do
 * jeito que o repositório de protocolo faz: linha nova em `protocol_versions` + conteúdo vigente.
 */
export async function publishVersion(
  world: World,
  student: Student,
  structure: ProtocolStructure,
  at: Date,
): Promise<number> {
  const versions = await world.db.admin
    .select({ version: protocolVersions.version })
    .from(protocolVersions)
    .where(eq(protocolVersions.protocolId, student.protocolId));
  const version = Math.max(...versions.map((row) => row.version)) + 1;
  await world.db.admin.insert(protocolVersions).values({
    protocolId: student.protocolId,
    userId: student.userId,
    version,
    status: 'ACTIVE',
    content: structure,
    createdAt: at,
  });
  await world.db.admin
    .update(protocols)
    .set({ content: structure, version })
    .where(eq(protocols.id, student.protocolId));
  student.structure = structure;
  return version;
}

/** O aluno escreve ao Coach. `parsed` é o que o LLM (fake) devolve ao ler o pedido. */
export async function say(
  world: World,
  student: Student,
  message: string,
  options: { intent: Intent; parsed?: object | string | Error; now: Date; operationId?: string },
) {
  if (options.parsed !== undefined) world.llm.script('schedule_request_parse', options.parsed);
  return world.flow.handle({
    userId: student.userId,
    message,
    intent: options.intent,
    scrubUser: { name: student.name, phoneNumber: student.phone, email: student.email },
    operationId: options.operationId ?? randomUUID(),
    personaSlot: null,
    now: options.now,
  });
}

/** Códigos `/check-in/<code>` presentes num texto (balões do WhatsApp). */
export function checkInCodes(text: string): string[] {
  return [...text.matchAll(/\/check-in\/([A-Za-z0-9]+)/g)].map((match) => match[1] as string);
}

/**
 * O aluno toca no link do WhatsApp: o alias resolve para o magic link, a página troca o token
 * por uma sessão do navegador e a API identifica o titular por ela. Mesmo caminho do BFF.
 */
export async function openLink(world: World, code: string) {
  const target = await world.shortLinks.resolve(code);
  if (!target) throw new Error('link de check-in não resolve (expirado ou inexistente)');
  const fragment = new URLSearchParams(new URL(target).hash.slice(1));
  const token = fragment.get('token') ?? '';
  const sessionToken = await world.access.exchange(token);
  const userId = await world.access.requireUser(`Bearer ${sessionToken}`);
  return { userId, date: fragment.get('date'), token, target };
}

export function sets(session: ProtocolSession, load: number, reps = 10): WorkoutSetInput[] {
  return session.exercises.flatMap((exercise) =>
    Array.from({ length: exercise.sets }, (_, index) => ({
      exerciseId: exercise.exerciseId,
      setNumber: index + 1,
      reps,
      loadValue: load,
      loadUnit: 'KG' as const,
      durationSeconds: null,
      completed: true,
      skipped: false,
    })),
  );
}

/** Treina o dia de hoje do começo ao fim pelo diário: abrir, iniciar, registrar, finalizar. */
export async function trainToday(
  world: World,
  student: Student,
  options: { start: string; load: number; effort?: number },
) {
  const startedAt = clock(options.start, student.timezone);
  const view = await world.journal.journal(student.userId, undefined, startedAt);
  if (!view.workout) throw new Error(`sem treino no diário em ${view.selectedDate}`);
  await world.journal.start(student.userId, view.workout.id, startedAt);
  const session = view.workout.prescription;
  await world.journal.saveSets(student.userId, view.workout.id, sets(session, options.load));
  vi.setSystemTime(new Date(startedAt.getTime() + 50 * 60_000));
  await world.journal.finish(student.userId, view.workout.id, finishInput(options.effort));
  return view.workout;
}

export function finishInput(effort = 7): FinishWorkoutInput {
  return {
    perceivedEffort: effort,
    painReported: false,
    painExerciseIds: [],
    feelingNotes: '',
    painNotes: '',
  };
}

/** Roda o comentário do Coach sobre um treino finalizado; devolve o que foi mandado ao modelo. */
export async function runFeedback(world: World, student: Student, workoutSessionId: string) {
  world.llm.script(
    'workout_feedback',
    'Boa sessão, você manteve as cargas planejadas e completou todas as séries.',
  );
  const before = world.llm.callsFor('workout_feedback').length;
  const result = await world.feedbackWorker.process({
    data: { userId: student.userId, workoutSessionId },
    timestamp: Date.now(),
  } as never);
  const call = world.llm.callsFor('workout_feedback')[before];
  return { result, call };
}

// --- leitura do estado (como superusuário, fora do caminho do app) ---------------------------

export function adjustmentsOf(world: World, userId: string) {
  return world.db.admin
    .select()
    .from(workoutScheduleAdjustments)
    .where(eq(workoutScheduleAdjustments.userId, userId))
    .orderBy(asc(workoutScheduleAdjustments.createdAt));
}

export function sessionsOf(world: World, userId: string) {
  return world.db.admin
    .select({
      id: workoutSessions.id,
      date: workoutSessions.scheduledDate,
      sessionKey: workoutSessions.sessionKey,
      status: workoutSessions.status,
      loggedLate: workoutSessions.loggedLate,
      startedAt: workoutSessions.startedAt,
      durationSeconds: workoutSessions.durationSeconds,
      prescription: workoutSessions.prescription,
    })
    .from(workoutSessions)
    .where(eq(workoutSessions.userId, userId))
    .orderBy(asc(workoutSessions.scheduledDate));
}

export function completionsOf(world: World, userId: string) {
  return world.db.admin
    .select({
      date: workoutCompletions.completedAt,
      sessionKey: workoutCompletions.sessionKey,
      source: workoutCompletions.source,
    })
    .from(workoutCompletions)
    .where(eq(workoutCompletions.userId, userId))
    .orderBy(asc(workoutCompletions.completedAt));
}

export function attendanceAlertsOf(world: World, userId: string) {
  return world.db.admin
    .select({ reason: handoffAlerts.reason })
    .from(handoffAlerts)
    .where(and(eq(handoffAlerts.userId, userId)));
}

export function magicTokensOf(world: World, userId: string) {
  return world.db.admin
    .select({
      id: workoutAccessTokens.id,
      kind: workoutAccessTokens.kind,
      workoutSessionId: workoutAccessTokens.workoutSessionId,
      revokedAt: workoutAccessTokens.revokedAt,
      consumedAt: workoutAccessTokens.consumedAt,
    })
    .from(workoutAccessTokens)
    .where(and(eq(workoutAccessTokens.userId, userId), eq(workoutAccessTokens.kind, 'MAGIC')))
    .orderBy(asc(workoutAccessTokens.createdAt));
}

export function setEntriesOf(world: World, workoutSessionId: string) {
  return world.db.admin
    .select()
    .from(workoutSetEntries)
    .where(eq(workoutSetEntries.workoutSessionId, workoutSessionId));
}

/** Mapa data → sessão da semana efetiva, como o fluxo do Coach a enxerga. */
export async function weekLayout(world: World, student: Student, now: Date) {
  const ctx = await world.schedule.weekContext(student.userId, now);
  if (!ctx) throw new Error('sem contexto de semana');
  return Object.fromEntries(ctx.slots.map((slot) => [slot.date, slot.sessionKey]));
}
