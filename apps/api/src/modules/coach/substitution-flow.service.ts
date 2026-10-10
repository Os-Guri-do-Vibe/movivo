/**
 * Fluxo de substituição de exercício via WhatsApp (achado 2026-09-02; reescrito em 2026-09-30).
 *
 * ## O que mudou em 2026-09-30
 * 1. **Alcance da troca.** "O leg press está cheio, por qual posso trocar?" não é o mesmo
 *    pedido que "quero tirar o leg press do meu treino". Toda troca agora passa por uma
 *    pergunta de alcance (SEMPRE, salvo quando o aluno já disse): só hoje, ou no protocolo.
 *    - **Só hoje** = recomendação no WhatsApp. Nada é gravado: nem o protocolo, nem o diário
 *      `/treino`, nem a fila do profissional. Na próxima sessão volta o exercício do protocolo.
 *    - **No protocolo** = o fluxo de sempre (proposta em staging, revisão do CREF, versão nova).
 * 2. **Troca em lote.** Até `MAX_SUBSTITUTION_ITEMS` exercícios no mesmo pedido, numa proposta
 *    única cujos itens o profissional decide um a um.
 * 3. **Estado explícito.** Antes o fluxo relia a conversa a cada turno para descobrir o que
 *    havia sido oferecido — e a resposta do aluno ("só hoje", "o segundo") passava de novo pelo
 *    classificador de intenção, podendo cair em outra intenção e quebrar o fluxo no meio. Agora
 *    o estado (alvos, opções oferecidas, escolha, alcance) vive em Redis e o fluxo aberto tem
 *    prioridade sobre a classificação.
 *
 * ## O que NÃO mudou (segurança)
 * O filtro de SEGURANÇA continua 100% determinístico (`findSafeCandidates`), recomputado a cada
 * turno e antes de persistir qualquer coisa. A IA só IDENTIFICA alvos, LÊ o que o aluno
 * respondeu escolhendo de listas fechadas de ids que RECEBEU, e VERBALIZA. Toda recomendação
 * "só hoje" sai da mesma curadoria segura da troca no protocolo.
 *
 * O serviço não gera texto livre: devolve um `FlowOutcome` (mensagem fixa, ou instruções para o
 * caminho generativo do worker, que valida a resposta contra `allowedExercises`).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { BiologicalSex, ProtocolExercise, ProtocolStructure } from '@movivo/shared';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import { REDIS_CLIENT, REDIS_KEY_BUILDER, type RedisKeyBuilder } from '../../core/redis';
import { DashboardQueueEventsService } from '../../core/event-bus/dashboard-queue-events.service';
import { ContextService } from '../ai-coach/context/context.service';
import type { ScrubUser } from '../ai-coach/llm/llm.types';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import type { CatalogExercise } from '../protocol/exercise-catalog';
import { ExerciseCatalogProvider } from '../protocol/exercise-catalog-provider.service';
import {
  findSafeCandidates,
  isPlausibleSubstitution,
  SUBSTITUTION_BATCH_SIZE,
} from '../protocol/exercise-substitution';
import {
  applySubstitution,
  applySubstitutions,
  collectProtocolExercises,
} from '../protocol/protocol-substitution-apply';
import {
  buildSubstitutionDiff,
  ProtocolSubstitutionRepository,
  type ActiveProtocolForSubstitution,
} from '../protocol/protocol-substitution.repository';
import {
  MAX_SUBSTITUTION_ITEMS,
  type SubstitutionItem,
} from '../protocol/protocol-substitution-items';
import { AI_SUBSTITUTION_REVIEW_WINDOW_MS } from '../protocol/protocol-substitution-release.worker';
import type { ProtocolSubstitutionReleaseJob } from '../protocol/protocol-substitution-release.worker';
import { ValidationService } from '../protocol/validation/validation.service';
import { BUBBLE_SEPARATOR } from '../whatsapp/message-templates';
import {
  SUBSTITUTION_ALREADY_PENDING_MESSAGE,
  SUBSTITUTION_CATALOG_GAP_MESSAGE,
  SUBSTITUTION_FALLBACK_MESSAGE,
  SUBSTITUTION_FORCED_TODAY_NOTE,
  SUBSTITUTION_GAVE_UP_MESSAGE,
  SUBSTITUTION_NOT_SAFE_TO_APPLY_MESSAGE,
  SUBSTITUTION_PROTOCOL_PART_PENDING_NOTE,
  SUBSTITUTION_SCOPE_QUESTION_MULTI,
  SUBSTITUTION_SCOPE_QUESTION_SINGLE,
  SUBSTITUTION_TODAY_NOTE,
  SUBSTITUTION_TOO_MANY_MESSAGE,
  substitutionScopeQuestionFor,
} from './coach-messages';
import { SubstitutionCatalogLookupService } from './substitution-catalog-lookup.service';
import {
  SubstitutionResolutionService,
  type SubstitutionScope,
} from './substitution-resolution.service';
import { SubstitutionTargetService } from './substitution-target.service';

/**
 * TTL do estado do fluxo. Uma troca "só hoje" nasce de uma situação do momento (aparelho
 * cheio, pressa): depois de algumas horas a conversa não é mais a mesma, e um estado velho
 * poderia sequestrar uma mensagem que já é de outro assunto.
 */
export const SUBSTITUTION_FLOW_TTL_SECONDS = 3 * 3600;

/** Perguntas de esclarecimento tolerados antes de encerrar sem pressionar o aluno. */
export const MAX_SUBSTITUTION_FOLLOW_UPS = 3;

/** Intenção usada para montar contexto/prompt de toda saída generativa deste fluxo. */
export const SUBSTITUTION_FLOW_INTENT = 'SUBSTITUICAO_EXERCICIO' as const;

type FlowChoice =
  { kind: 'SAFE' | 'INELIGIBLE'; exerciseId: string; name: string } | { kind: 'GAP'; name: string };

interface FlowTarget {
  exerciseId: string;
  /** Início do lote atual de opções na curadoria deste alvo. */
  offset: number;
  /** Ids exatos oferecidos ao aluno no último lote (o resolvedor escolhe desta lista). */
  offeredIds: string[];
  chosen: FlowChoice | null;
  scope: SubstitutionScope | null;
}

interface FlowState {
  protocolId: string;
  protocolVersion: number;
  targets: FlowTarget[];
  followUps: number;
  /** O aluno mencionou dor/desconforto em algum ponto desta troca. */
  pain: boolean;
}

export type FlowOutcome =
  /** Fluxo aberto, mas a mensagem é de outro assunto — segue o roteamento normal. */
  | { kind: 'NOT_HANDLED' }
  | { kind: 'FIXED'; text: string; humanReview?: boolean; handoffReason?: string }
  | {
      kind: 'GENERATE';
      extraSystem: string;
      allowedExercises: string[];
      /** Texto fixo acrescentado DEPOIS da resposta gerada (só se ela passar na validação). */
      suffix?: string;
      humanReview?: boolean;
      handoffReason?: string;
    };

export interface FlowInput {
  userId: string;
  message: string;
  scrubUser: ScrubUser;
  agentName: string;
  personaSlot: BiologicalSex | null;
  operationId: string;
  /** `INTENT`: o classificador entendeu troca de exercício. `CONTINUATION`: há fluxo aberto e
   * a mensagem foi classificada como outra coisa — pode ser a resposta à pergunta do Coach. */
  entry: 'INTENT' | 'CONTINUATION';
}

interface TargetWork {
  state: FlowTarget;
  exercise: CatalogExercise;
  /** Substitutos seguros, na ordem de prioridade — sem teto (o lote é só a apresentação). */
  curation: CatalogExercise[];
}

const NOT_HANDLED: FlowOutcome = { kind: 'NOT_HANDLED' };

const fallbackOutcome = (): FlowOutcome => ({
  kind: 'FIXED',
  text: SUBSTITUTION_FALLBACK_MESSAGE,
  humanReview: true,
});

/** "3 séries de 8 a 12 repetições, descanso de 60s" — a prescrição do exercício original. */
function prescriptionOf(content: ProtocolStructure, exerciseId: string): string | null {
  let found: ProtocolExercise | undefined;
  for (const session of content.sessions) {
    found = session.exercises.find((exercise) => exercise.exerciseId === exerciseId);
    if (found) break;
  }
  if (!found) return null;
  const parts = [`${found.sets} séries`];
  if (found.reps) {
    parts.push(
      found.reps.min === found.reps.max
        ? `de ${found.reps.min} repetições`
        : `de ${found.reps.min} a ${found.reps.max} repetições`,
    );
  } else if (found.durationSeconds !== undefined) {
    parts.push(`de ${found.durationSeconds} segundos`);
  }
  return `${parts.join(' ')}, descanso de ${found.restSeconds}s`;
}

@Injectable()
export class SubstitutionFlowService {
  constructor(
    private readonly repo: ProtocolSubstitutionRepository,
    private readonly target: SubstitutionTargetService,
    private readonly resolution: SubstitutionResolutionService,
    private readonly catalogLookup: SubstitutionCatalogLookupService,
    private readonly exerciseCatalog: ExerciseCatalogProvider,
    private readonly validation: ValidationService,
    private readonly context: ContextService,
    private readonly queues: QueueManager,
    private readonly queueEvents: DashboardQueueEventsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SubstitutionFlowService.name);
  }

  /** Há um fluxo de troca aberto para este titular? Barato (uma leitura Redis). */
  async hasOpenFlow(userId: string): Promise<boolean> {
    return (await this.loadState(userId)) !== null;
  }

  /** Descarta o estado do fluxo (ex.: a resposta oferecida foi bloqueada e o aluno nunca a viu). */
  async abandon(userId: string): Promise<void> {
    await this.clearState(userId);
  }

  async handle(input: FlowInput): Promise<FlowOutcome> {
    const { userId, entry } = input;
    const stored = await this.loadState(userId);
    if (entry === 'CONTINUATION' && !stored) return NOT_HANDLED;

    const active = await this.repo.loadActiveProtocol(userId);
    if (!active) {
      await this.clearState(userId);
      return entry === 'INTENT' ? fallbackOutcome() : NOT_HANDLED;
    }
    // Estado de outra versão do protocolo é estado velho: o que foi oferecido pode não valer.
    let state =
      stored && stored.protocolId === active.protocolId && stored.protocolVersion === active.version
        ? stored
        : null;
    if (!state && entry === 'CONTINUATION') {
      await this.clearState(userId);
      return NOT_HANDLED;
    }

    const catalog = this.exerciseCatalog.getAll();
    const protocolExercises = collectProtocolExercises(active.content);
    // Construído ANTES da identificação/leitura: turnos de continuação ("só hoje", "o segundo")
    // não citam o exercício sozinhos — só fazem sentido com a conversa recente junto.
    const ctx = await this.context.build(
      userId,
      SUBSTITUTION_FLOW_INTENT,
      input.message,
      input.agentName,
    );

    if (entry === 'INTENT') {
      const identified = await this.target.identify({
        userId,
        operationId: input.operationId,
        user: input.scrubUser,
        recentConversation: ctx.volatileSuffix,
        protocolExercises,
        personaSlot: input.personaSlot,
      });
      if (identified.identified) {
        const known = new Set(state?.targets.map((t) => t.exerciseId));
        // Um alvo que o fluxo aberto não conhece = pedido novo, que substitui o anterior.
        // Um subconjunto (ou o mesmo conjunto) é continuação do que já está em andamento.
        if (!state || identified.exerciseIds.some((id) => !known.has(id))) {
          state = {
            protocolId: active.protocolId,
            protocolVersion: active.version,
            targets: identified.exerciseIds.map((exerciseId) => ({
              exerciseId,
              offset: 0,
              offeredIds: [],
              chosen: null,
              scope: null,
            })),
            followUps: 0,
            pain: false,
          };
        }
      } else if (!state) {
        if (identified.tooMany) {
          this.logger.info(
            { userId, event: 'substitution_flow_too_many', max: MAX_SUBSTITUTION_ITEMS },
            'pedido de troca com exercícios demais — aluno orientado a priorizar',
          );
          return {
            kind: 'FIXED',
            text: SUBSTITUTION_TOO_MANY_MESSAGE,
            humanReview: true,
            handoffReason: 'SUBSTITUTION_TOO_MANY',
          };
        }
        // Não ficou claro qual exercício. `allowedExercises` trava no que JÁ está no protocolo
        // do aluno — a IA pode fazer referência ao que já existe pra esclarecer, mas NUNCA
        // nomear um substituto novo aqui: sem alvo identificado, não há candidato seguro
        // recomputado (achado 2026-09-02, reproduzido ao vivo).
        return {
          kind: 'GENERATE',
          extraSystem:
            'O aluno expressou insatisfação com um exercício do protocolo dele, mas não ficou ' +
            'claro qual exercício específico do treino ele quer trocar. Pergunte de forma ' +
            'natural qual exercício ele quer trocar, sem sugerir nenhuma alternativa ainda.',
          allowedExercises: protocolExercises.flatMap((ex) => [ex.id, ex.name]),
        };
      }
    }
    if (!state) return NOT_HANDLED;

    // ---- curadoria determinística por alvo ---------------------------------------------
    const siblingIds = new Set(state.targets.map((t) => t.exerciseId));
    const baselineValid = this.validatesAsIs(active);
    const work: TargetWork[] = [];
    for (const targetState of state.targets) {
      const exercise = this.exerciseCatalog.getById(targetState.exerciseId);
      if (!exercise) continue; // saiu do catálogo desde o início do fluxo
      work.push({
        state: targetState,
        exercise,
        curation: this.curate(exercise, active, catalog, siblingIds, baselineValid),
      });
    }
    if (work.length === 0) {
      await this.clearState(userId);
      return fallbackOutcome();
    }
    state.targets = work.map((w) => w.state);

    // ---- leitura do turno: escolha, alcance, recusa, exercício fora da lista, dor ------
    const refs = (list: readonly CatalogExercise[]) =>
      list.map((c) => ({ id: c.id, name: c.name }));
    const turn = await this.resolution.resolveTurn({
      userId,
      operationId: input.operationId,
      user: input.scrubUser,
      recentConversation: ctx.volatileSuffix,
      personaSlot: input.personaSlot,
      targets: work.map((w) => {
        const offered = w.state.offeredIds
          .map((id) => w.curation.find((c) => c.id === id))
          .filter((c): c is CatalogExercise => c !== undefined);
        return {
          targetId: w.exercise.id,
          targetName: w.exercise.name,
          offered: refs(offered),
          others: refs(w.curation.filter((c) => !w.state.offeredIds.includes(c.id))),
          current: { chosenName: w.state.chosen?.name ?? null, scope: w.state.scope },
        };
      }),
    });
    if (entry === 'CONTINUATION') {
      // Sem leitura confiável, ou assunto novo: a mensagem segue o roteamento normal e o
      // estado permanece (a pergunta do Coach continua valendo até o TTL).
      if (!turn.ok || turn.topic === 'NEW_TOPIC') return NOT_HANDLED;
    }

    const implausible: CatalogExercise[] = [];
    if (turn.ok) {
      state.pain = state.pain || turn.pain;
      for (const w of work) {
        const read = turn.targets.find((t) => t.targetId === w.exercise.id);
        if (!read) continue;
        if (read.scope) w.state.scope = read.scope;

        if (read.chosenExerciseId) {
          // Recomputa do zero — defesa em profundidade: a escolha só vale se ainda está no
          // conjunto seguro (a leitura do turno já restringe aos ids recebidos).
          const fresh = findSafeCandidates(w.exercise, active.constraints, catalog);
          const chosen = fresh.find((c) => c.id === read.chosenExerciseId);
          if (chosen && w.curation.some((c) => c.id === chosen.id)) {
            w.state.chosen = { kind: 'SAFE', exerciseId: chosen.id, name: chosen.name };
            continue;
          }
        }
        if (read.requestedOutsideList) {
          const outcome = await this.resolveOutsideRequest(input, ctx.volatileSuffix, w, catalog);
          if (outcome.chosen) {
            w.state.chosen = outcome.chosen;
            continue;
          }
          if (outcome.implausible) implausible.push(outcome.implausible);
        }
        if (read.rejectedOffered && !w.state.chosen) {
          w.state.offset += w.state.offeredIds.length;
          w.state.offeredIds = [];
        }
      }
    }

    // Esgotou a curadoria de algum alvo sem escolha: nada seguro a oferecer.
    const emptied = work.find((w) => !w.state.chosen && w.state.offset >= w.curation.length);
    if (emptied) {
      await this.clearState(userId);
      this.logger.info(
        { userId, event: 'substitution_flow_curation_exhausted', exerciseId: emptied.exercise.id },
        'curadoria de substitutos esgotada — fallback honesto com revisão humana',
      );
      return fallbackOutcome();
    }

    // ---- proposta pendente: uma por vez ------------------------------------------------
    let forcedToday = false;
    let protocolPartDropped = false;
    if (await this.repo.hasPending(userId, active.protocolId)) {
      const blocked = work.filter((w) => w.state.scope === 'PROTOCOL');
      const rest = work.filter((w) => w.state.scope !== 'PROTOCOL');
      if (rest.length === 0) {
        await this.clearState(userId);
        return { kind: 'FIXED', text: SUBSTITUTION_ALREADY_PENDING_MESSAGE };
      }
      if (blocked.length > 0) {
        protocolPartDropped = true;
        work.splice(0, work.length, ...rest);
        state.targets = work.map((w) => w.state);
      }
      for (const w of work) {
        if (w.state.scope === null) {
          w.state.scope = 'TODAY';
          forcedToday = true;
        }
      }
    }

    // "Só hoje" só recomenda do conjunto seguro: um exercício inelegível ou de fora do
    // catálogo (que só o profissional pode decidir, no protocolo) não pode ser recomendado.
    const unavailableForToday: string[] = [];
    for (const w of work) {
      if (w.state.scope === 'TODAY' && w.state.chosen && w.state.chosen.kind !== 'SAFE') {
        unavailableForToday.push(w.state.chosen.name);
        w.state.chosen = null;
      }
    }

    const incomplete = work.filter((w) => !w.state.chosen || !w.state.scope);
    if (incomplete.length === 0) {
      return this.execute(input, active, state, work, { forcedToday, protocolPartDropped });
    }
    return this.offer(input, state, work, {
      forcedToday,
      protocolPartDropped,
      implausible,
      unavailableForToday,
    });
  }

  // ---- curadoria ---------------------------------------------------------------------------

  /** O protocolo atual passa na validação? Se já não passa (por outro motivo), a pré-validação
   * por candidato não discrimina nada e é pulada — a troca em si é revalidada de qualquer forma
   * antes de qualquer escrita. */
  private validatesAsIs(active: ActiveProtocolForSubstitution): boolean {
    return (
      this.validation.validate({
        structure: active.content,
        constraints: active.validationConstraints,
        parqFlags: active.parQFlags,
      }).action === 'PASS'
    );
  }

  /**
   * Substitutos seguros de um alvo: o filtro determinístico de sempre (`findSafeCandidates`),
   * mais o que só faz sentido saber com o protocolo na mão — o candidato não pode já estar na
   * mesma sessão do alvo, nem ser outro alvo do mesmo pedido, e trocar por ele não pode quebrar
   * a validação do protocolo inteiro (antes isso só era descoberto DEPOIS de o aluno escolher).
   */
  private curate(
    target: CatalogExercise,
    active: ActiveProtocolForSubstitution,
    catalog: readonly CatalogExercise[],
    siblingTargetIds: ReadonlySet<string>,
    baselineValid: boolean,
  ): CatalogExercise[] {
    const inTargetSessions = new Set<string>();
    for (const session of active.content.sessions) {
      if (session.exercises.some((ex) => ex.exerciseId === target.id)) {
        for (const ex of session.exercises) inTargetSessions.add(ex.exerciseId);
      }
    }
    return findSafeCandidates(target, active.constraints, catalog).filter((candidate) => {
      if (inTargetSessions.has(candidate.id) || siblingTargetIds.has(candidate.id)) return false;
      if (!baselineValid) return true;
      const applied = applySubstitution(active.content, target.id, candidate);
      return (
        this.validation.validate({
          structure: applied.content,
          constraints: active.validationConstraints,
          parqFlags: active.parQFlags,
        }).action === 'PASS'
      );
    });
  }

  /** O aluno nomeou um exercício fora das listas oferecidas: existe no catálogo? é plausível? */
  private async resolveOutsideRequest(
    input: FlowInput,
    conversation: string,
    work: TargetWork,
    catalog: readonly CatalogExercise[],
  ): Promise<{ chosen?: FlowChoice; implausible?: CatalogExercise }> {
    const lookup = await this.catalogLookup.identify({
      userId: input.userId,
      operationId: input.operationId,
      user: input.scrubUser,
      recentConversation: conversation,
      targetExerciseName: work.exercise.name,
      fullCatalog: catalog.map((ex) => ({ id: ex.id, name: ex.name })),
      personaSlot: input.personaSlot,
    });
    if (!lookup.requestedName) return {};
    if (!lookup.matchedExerciseId) {
      // Não existe em lugar nenhum do catálogo: pedido de catálogo (revisão obrigatória).
      return { chosen: { kind: 'GAP', name: lookup.requestedName } };
    }
    const matched = this.exerciseCatalog.getById(lookup.matchedExerciseId);
    if (!matched) return { chosen: { kind: 'GAP', name: lookup.requestedName } };
    if (work.curation.some((c) => c.id === matched.id)) {
      return { chosen: { kind: 'SAFE', exerciseId: matched.id, name: matched.name } };
    }
    if (!isPlausibleSubstitution(work.exercise, matched)) {
      // Achado 2026-09-09 (bug reportado pelo fundador): existe no catálogo, mas treina outro
      // padrão/grupo muscular — pedido sem nexo fisiológico. Orientado na hora, sem fila.
      this.logger.info(
        {
          userId: input.userId,
          event: 'substitution_request_not_plausible',
          targetExerciseId: work.exercise.id,
          requestedExerciseId: matched.id,
        },
        'pedido de substituição sem nexo fisiológico (grupo muscular/padrão diferente) — orientado na hora, sem registrar na fila',
      );
      return { implausible: matched };
    }
    // Mesmo padrão + grupo muscular, mas inelegível pra este aluno por outro motivo (nível,
    // local, contraindicação): dúvida clínica real, Revisão Obrigatória.
    return { chosen: { kind: 'INELIGIBLE', exerciseId: matched.id, name: matched.name } };
  }

  // ---- oferta -------------------------------------------------------------------------------

  /** Falta escolha e/ou alcance: UMA mensagem com as opções e a pergunta de alcance. */
  private async offer(
    input: FlowInput,
    state: FlowState,
    work: TargetWork[],
    notes: {
      forcedToday: boolean;
      protocolPartDropped: boolean;
      implausible: readonly CatalogExercise[];
      unavailableForToday: readonly string[];
    },
  ): Promise<FlowOutcome> {
    if (state.followUps >= MAX_SUBSTITUTION_FOLLOW_UPS) {
      await this.clearState(input.userId);
      this.logger.info(
        { userId: input.userId, event: 'substitution_flow_abandoned' },
        'aluno não se decidiu após as perguntas — fluxo encerrado sem pressão',
      );
      return { kind: 'FIXED', text: SUBSTITUTION_GAVE_UP_MESSAGE };
    }
    state.followUps += 1;

    const used = new Set<string>();
    const sections: string[] = [];
    const allowed = new Set<string>();
    for (const w of work) {
      allowed.add(w.exercise.id).add(w.exercise.name);
      if (w.state.chosen) {
        sections.push(
          `- "${w.exercise.name}": o aluno já escolheu "${w.state.chosen.name}". Não ofereça outras opções para ele.`,
        );
        allowed.add(w.state.chosen.name);
        if (w.state.chosen.kind !== 'GAP') allowed.add(w.state.chosen.exerciseId);
        continue;
      }
      const batch = w.curation
        .slice(w.state.offset, w.state.offset + SUBSTITUTION_BATCH_SIZE)
        .filter((c) => !used.has(c.id));
      w.state.offeredIds = batch.map((c) => c.id);
      for (const c of batch) {
        used.add(c.id);
        allowed.add(c.id).add(c.name);
      }
      sections.push(
        `- "${w.exercise.name}": OPÇÕES SEGURAS DA BASE: ${batch.map((c) => c.name).join(', ')}.`,
      );
    }
    for (const rejected of notes.implausible) {
      allowed.add(rejected.id).add(rejected.name);
    }

    const rejectionNote = notes.implausible.length
      ? 'O aluno pediu um exercício que trabalha um grupo muscular/padrão de movimento ' +
        `diferente do original (${notes.implausible.map((e) => `"${e.name}"`).join(', ')}), ` +
        'então essa troca específica não é um substituto seguro. Explique isso de forma ' +
        'simples e humanizada, deixando claro que esta troca não vai acontecer, e NÃO diga ' +
        'que vai registrar/confirmar com o profissional sobre ELA. Em seguida, apresente as ' +
        'opções reais. '
      : '';
    const unavailableNote = notes.unavailableForToday.length
      ? 'O aluno pediu para hoje um exercício que só o profissional pode avaliar ' +
        `(${notes.unavailableForToday.map((n) => `"${n}"`).join(', ')}), então NÃO dá pra ` +
        'recomendá-lo agora: diga isso com naturalidade e apresente as opções seguras. '
      : '';
    const extraSystem =
      'O aluno quer trocar ' +
      (work.length > 1 ? 'alguns exercícios do treino' : 'um exercício do treino') +
      '. ' +
      rejectionNote +
      unavailableNote +
      'Apresente, para cada exercício abaixo, as opções de forma humanizada (não uma lista ' +
      'técnica) e pergunte qual ele prefere, quando ele ainda não escolheu:\n' +
      sections.join('\n') +
      '\nEscreva o nome de cada exercício EXATAMENTE como aparece nas listas acima. NÃO ' +
      'sugira nenhum exercício fora dessas listas e NÃO invente carga. NÃO pergunte se ' +
      'a troca é só para hoje ou para o protocolo: essa pergunta é acrescentada ' +
      'automaticamente ao final da sua mensagem. NÃO diga que registrou, confirmou ou vai ' +
      'confirmar nada com o profissional.';

    const suffixParts: string[] = [];
    const unknownScope = work.filter((w) => w.state.scope === null);
    if (unknownScope.length > 0) {
      suffixParts.push(
        unknownScope.length < work.length
          ? substitutionScopeQuestionFor(unknownScope.map((w) => w.exercise.name))
          : work.length === 1
            ? SUBSTITUTION_SCOPE_QUESTION_SINGLE
            : SUBSTITUTION_SCOPE_QUESTION_MULTI,
      );
    }
    if (notes.forcedToday) suffixParts.push(SUBSTITUTION_FORCED_TODAY_NOTE);
    if (notes.protocolPartDropped) suffixParts.push(SUBSTITUTION_PROTOCOL_PART_PENDING_NOTE);

    await this.saveState(input.userId, state);
    this.logger.info(
      {
        userId: input.userId,
        event: 'substitution_flow_offered',
        targets: work.length,
        scopeKnown: work.filter((w) => w.state.scope !== null).length,
        followUp: state.followUps,
      },
      'opções de troca oferecidas ao aluno',
    );
    return {
      kind: 'GENERATE',
      extraSystem,
      allowedExercises: [...allowed],
      suffix: suffixParts.length > 0 ? suffixParts.join(BUBBLE_SEPARATOR) : undefined,
    };
  }

  // ---- execução -----------------------------------------------------------------------------

  /** Tudo definido (escolha + alcance para cada alvo): recomenda o de hoje e/ou registra o do
   * protocolo. */
  private async execute(
    input: FlowInput,
    active: ActiveProtocolForSubstitution,
    state: FlowState,
    work: TargetWork[],
    flags: { forcedToday: boolean; protocolPartDropped: boolean },
  ): Promise<FlowOutcome> {
    const { userId } = input;
    await this.clearState(userId);

    const todayWork = work.filter((w) => w.state.scope === 'TODAY');
    const protocolWork = work.filter((w) => w.state.scope === 'PROTOCOL');

    const instructions: string[] = [];
    const suffixes: string[] = [];
    const allowed = new Set<string>(
      collectProtocolExercises(active.content).flatMap((ex) => [ex.id, ex.name]),
    );
    let humanReview = false;
    let generate = false;

    // ---- só hoje: recomendação no WhatsApp, nada persistido ------------------------------
    if (todayWork.length > 0) {
      generate = true;
      const lines = todayWork.map((w) => {
        const chosen = w.state.chosen;
        if (chosen) allowed.add(chosen.name);
        if (chosen && chosen.kind !== 'GAP') allowed.add(chosen.exerciseId);
        const prescription = prescriptionOf(active.content, w.exercise.id);
        return (
          `- No lugar de "${w.exercise.name}"${prescription ? ` (${prescription})` : ''}, ` +
          `fazer "${chosen?.name ?? ''}".`
        );
      });
      instructions.push(
        'O aluno pediu uma recomendação de troca SÓ PARA HOJE: nada muda no protocolo dele e ' +
          'nada foi registrado. Recomende, de forma humanizada e curta, o que fazer hoje ' +
          '(mantendo a mesma prescrição de séries, repetições e descanso do exercício original):\n' +
          lines.join('\n') +
          '\nNÃO diga que vai registrar, confirmar com o profissional ou alterar o protocolo. ' +
          'NÃO invente carga nem outros números. NÃO ofereça outras opções.' +
          (state.pain
            ? ' O aluno mencionou dor ou desconforto: reforce com carinho que, se sentir dor ' +
              'durante o exercício, deve interromper e avisar o profissional. NÃO faça ' +
              'avaliação clínica.'
            : ''),
      );
      suffixes.push(flags.forcedToday ? SUBSTITUTION_FORCED_TODAY_NOTE : SUBSTITUTION_TODAY_NOTE);
      this.logger.info(
        { userId, event: 'substitution_today_recommended', targets: todayWork.length },
        'troca só de hoje recomendada no WhatsApp (nada persistido)',
      );
    }

    // ---- no protocolo: proposta em staging, revisão do CREF -----------------------------
    if (protocolWork.length > 0) {
      const result = await this.persistProtocolPart(userId, active, protocolWork);
      switch (result.kind) {
        case 'AUTO': {
          generate = true;
          const lines = protocolWork.map(
            (w) => `"${w.exercise.name}" vai virar "${w.state.chosen?.name ?? ''}"`,
          );
          for (const w of protocolWork) {
            if (w.state.chosen) allowed.add(w.state.chosen.name);
            if (w.state.chosen && w.state.chosen.kind !== 'GAP')
              allowed.add(w.state.chosen.exerciseId);
          }
          instructions.push(
            `${protocolWork.length > 1 ? 'As trocas foram CONFIRMADAS e já estão registradas' : 'A troca foi CONFIRMADA e já está registrada'}: ` +
              `${lines.join('; ')}. Confirme isso pro aluno de forma humanizada, avisando que a ` +
              'mudança passa por uma checagem rápida e ele recebe o protocolo atualizado em ' +
              'breve. NÃO ofereça nenhuma outra opção agora nem volte a perguntar qual ' +
              'exercício trocar.',
          );
          break;
        }
        case 'REVIEW_GAP':
          suffixes.push(SUBSTITUTION_CATALOG_GAP_MESSAGE);
          break;
        case 'REVIEW_INELIGIBLE':
          suffixes.push(SUBSTITUTION_NOT_SAFE_TO_APPLY_MESSAGE);
          break;
        case 'NOT_SAFE':
          humanReview = true;
          suffixes.push(SUBSTITUTION_NOT_SAFE_TO_APPLY_MESSAGE);
          break;
        case 'ALREADY_PENDING':
          suffixes.push(
            todayWork.length > 0
              ? SUBSTITUTION_PROTOCOL_PART_PENDING_NOTE
              : SUBSTITUTION_ALREADY_PENDING_MESSAGE,
          );
          break;
      }
    }
    if (flags.protocolPartDropped) suffixes.push(SUBSTITUTION_PROTOCOL_PART_PENDING_NOTE);

    // Dor mencionada: a recomendação sai normalmente, mas o profissional é alertado. Um sinal
    // clínico não pode sumir só porque a troca era momentânea.
    let handoffReason: string | undefined;
    if (state.pain) {
      humanReview = true;
      handoffReason = 'SUBSTITUTION_PAIN';
    }

    if (!generate) {
      return {
        kind: 'FIXED',
        text: suffixes.join(BUBBLE_SEPARATOR),
        humanReview,
        ...(handoffReason ? { handoffReason } : {}),
      };
    }
    return {
      kind: 'GENERATE',
      extraSystem: instructions.join('\n\n'),
      allowedExercises: [...allowed],
      suffix: suffixes.length > 0 ? suffixes.join(BUBBLE_SEPARATOR) : undefined,
      humanReview,
      ...(handoffReason ? { handoffReason } : {}),
    };
  }

  /** Persiste a proposta única com os itens de alcance "protocolo". */
  private async persistProtocolPart(
    userId: string,
    active: ActiveProtocolForSubstitution,
    protocolWork: readonly TargetWork[],
  ): Promise<{
    kind: 'AUTO' | 'REVIEW_GAP' | 'REVIEW_INELIGIBLE' | 'NOT_SAFE' | 'ALREADY_PENDING';
  }> {
    const catalog = this.exerciseCatalog;
    const items: SubstitutionItem[] = protocolWork.map((w) => {
      const chosen = w.state.chosen;
      if (!chosen) throw new Error('persistProtocolPart: alvo sem escolha.');
      return {
        fromExerciseId: w.exercise.id,
        fromExerciseName: w.exercise.name,
        toExerciseId: chosen.kind === 'GAP' ? null : chosen.exerciseId,
        toExerciseName: chosen.name,
        catalogGap: chosen.kind === 'GAP',
        mandatory: chosen.kind !== 'SAFE',
        decision: 'PENDING',
      };
    });

    // Recomputa TUDO do zero e revalida a estrutura inteira antes de persistir: trocar
    // exercícios pode quebrar uma regra de sessão mesmo quando cada substituto é seguro.
    const swaps: Array<{ fromExerciseId: string; to: CatalogExercise }> = [];
    for (const item of items) {
      if (item.toExerciseId === null) continue;
      const to = catalog.getById(item.toExerciseId);
      if (!to) return { kind: 'NOT_SAFE' };
      swaps.push({ fromExerciseId: item.fromExerciseId, to });
    }
    const applied = swaps.length > 0 ? applySubstitutions(active.content, swaps) : null;
    if (applied) {
      const verdict = this.validation.validate({
        structure: applied.content,
        constraints: active.validationConstraints,
        parqFlags: active.parQFlags,
      });
      if (verdict.action !== 'PASS') {
        this.logger.warn(
          {
            userId,
            event: 'substitution_not_safe_to_apply',
            violations: verdict.violations.map((v) => v.rule),
          },
          'troca de exercício confirmada pelo aluno quebrou a validação do protocolo inteiro — não aplicada sozinha',
        );
        return { kind: 'NOT_SAFE' };
      }
    }

    const swapped = items.filter((item) => item.toExerciseId !== null);
    const created = await this.repo.createPending({
      userId,
      protocolId: active.protocolId,
      baseVersion: active.version,
      items,
      proposedContent: applied?.content ?? null,
      diff: applied ? buildSubstitutionDiff(swapped, applied.sessionsAffectedBySwap) : null,
      changeReason:
        'Substituição solicitada pelo aluno via WhatsApp: ' +
        items
          .map((item) =>
            item.catalogGap
              ? `${item.fromExerciseName} → "${item.toExerciseName}" (não existe no catálogo)`
              : `${item.fromExerciseName} → ${item.toExerciseName}`,
          )
          .join('; '),
    });
    // Corrida com uma segunda pendência criada entre a checagem `hasPending` e aqui.
    if (!created.created) return { kind: 'ALREADY_PENDING' };

    // Obrigatória por PAR-Q bloqueante (achado 2026-09-03) OU por item fora da curadoria
    // segura padrão (achado 2026-09-09): sem job de auto-liberação — mesma regra de
    // `protocols.reviewUrgency` ("nenhum sai sozinho").
    const mandatory = active.fromBlockingParq || items.some((item) => item.mandatory);
    if (!mandatory) {
      const releaseJob: ProtocolSubstitutionReleaseJob = { userId, requestId: created.id };
      await this.queues.enqueue(
        QUEUE.protocolSubstitutionRelease,
        'substitution-release',
        releaseJob,
        {
          delay: AI_SUBSTITUTION_REVIEW_WINDOW_MS,
          jobId: `substitution-auto-release-${created.id}`,
        },
      );
    }
    this.queueEvents.emit('protocol');
    this.logger.info(
      {
        userId,
        event: 'substitution_pending_created',
        requestId: created.id,
        mandatory,
        items: items.length,
      },
      mandatory
        ? 'substituição de exercício confirmada — aguardando revisão humana obrigatória'
        : 'substituição de exercício confirmada — proposta em staging, aguardando revisão/liberação automática',
    );

    if (items.some((item) => item.catalogGap)) return { kind: 'REVIEW_GAP' };
    // Achado 2026-09-09: exercício que NÃO é opção segura padrão da base pra este aluno não
    // pode ouvir "confirmada" antes da revisão real acontecer — resposta FIXA, sem LLM.
    if (items.some((item) => item.mandatory)) return { kind: 'REVIEW_INELIGIBLE' };
    return { kind: 'AUTO' };
  }

  // ---- estado -------------------------------------------------------------------------------

  private stateKey(userId: string): string {
    return this.keys.forUser(userId, 'substitution-flow', 'state');
  }

  private async loadState(userId: string): Promise<FlowState | null> {
    try {
      const raw = await this.redis.get(this.stateKey(userId));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as FlowState;
      if (!Array.isArray(parsed.targets) || parsed.targets.length === 0) return null;
      return parsed;
    } catch (error) {
      this.logger.warn(
        { userId, err: String(error) },
        'estado do fluxo de troca ilegível — tratado como sem fluxo aberto',
      );
      return null;
    }
  }

  private async saveState(userId: string, state: FlowState): Promise<void> {
    await this.redis.set(
      this.stateKey(userId),
      JSON.stringify(state),
      'EX',
      SUBSTITUTION_FLOW_TTL_SECONDS,
    );
  }

  private async clearState(userId: string): Promise<void> {
    await this.redis.del(this.stateKey(userId));
  }
}
