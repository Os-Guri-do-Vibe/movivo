/**
 * Ritmo de referência dos trechos de corrida (corrida e HYROX): um indicador visual ao lado do
 * alvo do trecho. O critério continua sendo o alvo (em geral a zona cardíaca); a referência
 * mostra em que ritmo aquela zona costuma cair para ESTE aluno, na rua, e em que velocidade pôr
 * a esteira: os dois formatos saem do mesmo número, e o aluno usa o do lugar em que for correr.
 *
 * Tudo aqui é cálculo: o ritmo de 5 km que o aluno informou × o percentual de cada zona
 * publicado na metodologia de corrida. Sem 5 km recente não há referência (nada é inventado), e
 * o agente nunca preenche este campo: o que ele mandar é descartado.
 */
import type {
  EnduranceTarget,
  IntensityZone,
  PaceReference,
  PlanSession,
  TrainingPlanStructure,
  TrainingVenue,
} from '@movivo/shared';

import type { Range } from './params';

export interface PaceReferenceContext {
  /** Melhor 5 km recente do aluno, em segundos; `null` = não informou. */
  recent5kSeconds: number | null;
  /** % do ritmo de 5 km por zona (metodologia de corrida). */
  zonePacePctOf5k: Readonly<Record<string, Range>>;
  /** Onde o aluno corre e onde faz HYROX. */
  venues: { RUNNING?: TrainingVenue; HYROX?: TrainingVenue };
}

const ZONES: readonly IntensityZone[] = ['Z1', 'Z2', 'Z3', 'Z4', 'Z5'];
/** Faixa aceita pelo plano (`paceReferenceSchema`). */
const PACE_MIN = 150;
const PACE_MAX = 900;
/** A referência é um indicador, não um cronômetro: arredonda para 5 s/km. */
const PACE_STEP = 5;
/** Locais em que a corrida é na esteira (em academia, correr é esteira). */
const TREADMILL_VENUES: ReadonlySet<TrainingVenue> = new Set([
  'FULL_GYM',
  'CONDO_GYM',
  'HYROX_GYM',
]);
/** Terrenos em que o ritmo não representa o esforço (subida, trilha, areia). */
const PACE_MEANINGLESS_TERRAIN: ReadonlySet<string> = new Set(['HILLS', 'TRAIL', 'SAND']);

/**
 * Zona correspondente a um esforço percebido (0 a 10), pela escala usual: até 3 é Z1, até 4,5 é
 * Z2, até 6,5 é Z3, até 8 é Z4 e acima disso é Z5.
 */
export function zoneOfRpe(rpe: number): IntensityZone {
  if (rpe <= 3) return 'Z1';
  if (rpe <= 4.5) return 'Z2';
  if (rpe <= 6.5) return 'Z3';
  if (rpe <= 8) return 'Z4';
  return 'Z5';
}

const roundToStep = (seconds: number) => Math.round(seconds / PACE_STEP) * PACE_STEP;

/** Zonas que o alvo cobre; `null` quando o alvo não se traduz em zona (FC em bpm). */
function zonesOf(target: EnduranceTarget): IntensityZone[] | null {
  if (target.by === 'ZONE') return [target.zone];
  if (target.by === 'RPE') {
    const from = ZONES.indexOf(zoneOfRpe(target.rpe.min));
    const to = ZONES.indexOf(zoneOfRpe(target.rpe.max));
    return ZONES.slice(Math.min(from, to), Math.max(from, to) + 1);
  }
  return null;
}

/**
 * Faixa de ritmo (s/km) de um alvo para este aluno. Alvo que já é ritmo devolve o próprio ritmo
 * (serve para mostrar a velocidade na esteira); alvo por frequência cardíaca não tem referência.
 */
export function paceRangeOf(
  target: EnduranceTarget,
  context: Pick<PaceReferenceContext, 'recent5kSeconds' | 'zonePacePctOf5k'>,
): Range | null {
  if (target.by === 'PACE') return target.secondsPerKm;
  const zones = zonesOf(target);
  if (!zones || !context.recent5kSeconds) return null;
  const pace5k = context.recent5kSeconds / 5;
  const bounds = zones.flatMap((zone) => {
    const pct = context.zonePacePctOf5k[zone];
    return pct ? [pct] : [];
  });
  if (bounds.length !== zones.length) return null;
  const min = roundToStep((pace5k * Math.min(...bounds.map((b) => b.min))) / 100);
  const max = roundToStep((pace5k * Math.max(...bounds.map((b) => b.max))) / 100);
  if (min < PACE_MIN || max > PACE_MAX || min > max) return null;
  return { min, max };
}

function referenceOf(
  target: EnduranceTarget,
  treadmill: boolean,
  context: PaceReferenceContext,
): PaceReference | undefined {
  // Alvo que já é ritmo também leva a referência: é dela que sai a velocidade para a esteira.
  const secondsPerKm = paceRangeOf(target, context);
  return secondsPerKm ? { secondsPerKm, treadmill } : undefined;
}

/** A sessão é na esteira? Pelo terreno pedido ou, sem terreno específico, pelo local do aluno. */
function onTreadmill(terrain: string | undefined, venue: TrainingVenue | undefined): boolean {
  if (terrain === 'TREADMILL') return true;
  if (terrain === 'TRACK') return false;
  return venue !== undefined && TREADMILL_VENUES.has(venue);
}

function sessionWithReferences(session: PlanSession, context: PaceReferenceContext): PlanSession {
  const { content } = session;
  if (content.modality === 'RUNNING') {
    const meaningless = content.kind === 'HILLS' || PACE_MEANINGLESS_TERRAIN.has(content.terrain);
    const treadmill = onTreadmill(content.terrain, context.venues.RUNNING);
    return {
      ...session,
      content: {
        ...content,
        segments: content.segments.map((segment) => {
          const { paceReference: _fromAgent, ...rest } = segment;
          // Tiros curtos de aceleração não têm ritmo que valha como referência.
          const reference =
            meaningless || segment.type === 'STRIDES'
              ? undefined
              : referenceOf(segment.target, treadmill, context);
          return reference ? { ...rest, paceReference: reference } : rest;
        }),
      },
    };
  }
  if (content.modality === 'HYROX') {
    const treadmill = onTreadmill(undefined, context.venues.HYROX);
    return {
      ...session,
      content: {
        ...content,
        blocks: content.blocks.map((block) => {
          if (block.type !== 'RUN') return block;
          const { paceReference: _fromAgent, ...rest } = block;
          const reference = referenceOf(block.target, treadmill, context);
          return reference ? { ...rest, paceReference: reference } : rest;
        }),
      },
    };
  }
  return session;
}

/** O plano com o ritmo de referência em cada trecho de corrida que admite um. */
export function withPaceReferences(
  structure: TrainingPlanStructure,
  context: PaceReferenceContext,
): TrainingPlanStructure {
  return {
    ...structure,
    sessions: structure.sessions.map((session) => sessionWithReferences(session, context)),
  };
}
