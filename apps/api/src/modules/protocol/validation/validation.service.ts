/**
 * ValidationService — veto determinístico sobre o TREINO INTEIRO (US-2.3, pedra angular).
 *
 * Com a rejeição do motor determinístico, a segurança do produto mora aqui. Duas camadas,
 * <100ms, sem I/O:
 *  1. **Estrutural** (gabarito = base de referência + constraints): todo exercício existe;
 *     nenhum contraindicado pela lesão/PAR-Q; carga/volume/descanso em faixa plausível.
 *  2. **Linguagem/compliance**: sem prescrição/diagnóstico/promessa/violação-PAR-Q/leak.
 *
 * Falha dura → `BLOCK_FALLBACK` (o Worker regenera com fallback de modelo e, persistindo,
 * cai no template pré-aprovado). Falha leve → `FLAG_HUMAN_REVIEW` (roteia sem bloquear).
 * O `code` alimenta `ai_jobs.validation_action` (PASS|FLAG|BLOCK).
 */
import { Injectable } from '@nestjs/common';
import type { ProtocolStructure, Weekday } from '@movivo/shared';

import { canonicalizeSecurityText } from '../../../core/agent-config/text-normalize';
import {
  type ContraindicationTag,
  EXERCISE_BY_ID,
  EXERCISE_CATALOG,
  type ExerciseLevel,
  LEVEL_ORDER,
} from '../exercise-catalog';
import type { UserConstraints } from '../user-constraints';
import { containsPromptLeak } from './prompt-injection';
import {
  DURATION_SECONDS_RANGE,
  inRange,
  LANGUAGE_RULES,
  MAX_TECHNIQUES_PER_SESSION,
  MIN_FREQUENCY_BY_SPLIT,
  REPS_RANGE_BY_GOAL,
  REST_SECONDS_RANGE,
  SETS_RANGE,
  SPLITS_BY_LEVEL,
  type ValidationActionCode,
} from './validation-rules';

export type ValidationAction = 'PASS' | 'FLAG_HUMAN_REVIEW' | 'BLOCK_FALLBACK';

/** Piso de Repetições em Reserva sob teto de PAR-Q — nunca treinar perto da falha. */
const PARQ_MIN_RIR = 2;

export interface ValidationViolation {
  rule: string;
  detail: string;
  action: Extract<ValidationActionCode, 'BLOCK' | 'FLAG'>;
}

export interface ValidationVerdict {
  action: ValidationAction;
  /** Valor para `ai_jobs.validation_action`. */
  code: ValidationActionCode;
  /** O Worker (US-2.4) marca o protocolo e roteia ao painel CREF quando `true`. */
  humanReviewRequired: boolean;
  violations: ValidationViolation[];
}

export interface ValidateProtocolInput {
  structure: ProtocolStructure;
  /**
   * `level` é opcional porque protocolos persistidos antes da metodologia v2 não o têm.
   * Ausente → assume `INICIANTE` (o mais restritivo), nunca o mais permissivo: fail-safe.
   */
  constraints: Pick<UserConstraints, 'goal' | 'injuryTags'> & {
    level?: ExerciseLevel;
    /** Achado 2026-08-18: ausente → não valida sessão-por-dia (protocolo antigo/edição
     *  sem essa constraint persistida). Presente → BLOCK se não bater 1:1 com as sessões. */
    preferredDays?: Weekday[];
    /**
     * Teto de periodização vindo do PAR-Q (2026-08-24, `parqToConstraints`). Presente =
     * qualquer fase diferente de `ADAPTACAO` é BLOCK, e todo RIR declarado tem piso 2.
     * Ausente = sem teto (protocolo antigo/edição sem a constraint persistida).
     */
    maxPhase?: 'ADAPTACAO';
  };
  /**
   * Flags de PAR-Q. Desde 2026-08-24 elas são o caminho normal, não mais uma "defesa
   * extra": o PAR-Q deixou de travar a geração, então protocolo COM flag é rotina e este
   * é o veto que garante que o modo conservador foi de fato respeitado.
   */
  parqFlags?: ContraindicationTag[];
}

export interface ValidateResponseOptions {
  /**
   * SUBSTITUICAO_EXERCICIO (US-3.5): nomes/ids de exercícios que a RESPOSTA pode citar (o
   * original + o substituto aprovado da base). Qualquer OUTRO exercício do catálogo citado
   * → BLOCK (a IA saiu do trilho). `undefined` = intenção sem restrição de exercício.
   */
  allowedExercises?: readonly string[];
}

@Injectable()
export class ValidationService {
  /** Veredito determinístico sobre o protocolo inteiro. Nunca lança — sempre devolve. */
  validate(input: ValidateProtocolInput): ValidationVerdict {
    const violations: ValidationViolation[] = [];
    const excluded = new Set<ContraindicationTag>([
      // `?? []`: protocolos do caminho de fallback (`ProtocolGenerationWorker.
      // handleTerminalFailure`) persistem `constraints` sem `injuryTags` — só têm
      // goal/preferredDays/parqTags. `input.parqFlags` já cobre a parte de segurança
      // do PAR-Q nesse caso; sem este fallback, assinar um protocolo de fallback
      // quebrava com "injuryTags is not iterable" (achado 2026-08-26).
      ...(input.constraints.injuryTags ?? []),
      ...(input.parqFlags ?? []),
    ]);

    const level = input.constraints.level ?? 'INICIANTE';
    this.checkStructure(input.structure, input.constraints.goal, level, excluded, violations);
    this.checkMethodology(input.structure, level, input.constraints.preferredDays, violations);
    this.checkParq(input.structure, input.parqFlags ?? [], input.constraints.maxPhase, violations);
    this.checkLanguage(collectText(input.structure), violations);

    return aggregate(violations);
  }

  /**
   * Veta uma RESPOSTA conversacional em TEXTO livre (US-3.5). REUSA as regras de
   * linguagem/compliance/leak da validação de protocolo (não reimplementa) e, para
   * substituição de exercício, confirma que a resposta só cita exercícios autorizados da base.
   * Nunca lança — sempre devolve um veredito.
   */
  validateResponse(text: string, opts: ValidateResponseOptions = {}): ValidationVerdict {
    const violations: ValidationViolation[] = [];
    this.checkLanguage(text, violations);
    this.checkAllowedExercises(text, opts.allowedExercises, violations);
    return aggregate(violations);
  }

  /** Substituição: a resposta não pode empurrar um exercício da base fora do autorizado. */
  private checkAllowedExercises(
    text: string,
    allowed: readonly string[] | undefined,
    out: ValidationViolation[],
  ): void {
    if (!allowed) return; // só a substituição restringe o vocabulário de exercícios
    const lower = canonicalizeSecurityText(text).toLocaleLowerCase('pt-BR');
    const allowedSet = new Set(
      allowed.map((a) => canonicalizeSecurityText(a).toLocaleLowerCase('pt-BR')),
    );
    for (const ex of EXERCISE_CATALOG) {
      const exerciseName = canonicalizeSecurityText(ex.name).toLocaleLowerCase('pt-BR');
      if (allowedSet.has(exerciseName) || allowedSet.has(ex.id)) continue;
      if (lower.includes(exerciseName)) {
        out.push({
          rule: 'EXERCISE_NOT_ALLOWED',
          detail: `resposta cita exercício não autorizado: ${ex.id}`,
          action: 'BLOCK',
        });
      }
    }
  }

  private checkStructure(
    structure: ProtocolStructure,
    goal: ValidateProtocolInput['constraints']['goal'],
    level: ExerciseLevel,
    excluded: Set<ContraindicationTag>,
    out: ValidationViolation[],
  ): void {
    const repsRange = REPS_RANGE_BY_GOAL[goal];
    for (const session of structure.sessions) {
      for (const ex of session.exercises) {
        const catalog = EXERCISE_BY_ID.get(ex.exerciseId);
        if (!catalog) {
          out.push({
            rule: 'EXERCISE_UNKNOWN',
            detail: `exercício fora da base: ${ex.exerciseId}`,
            action: 'BLOCK',
          });
          continue; // sem entrada na base, não há como checar contraindicação
        }
        // O filtro por nível do `catalogContext()` (gerador) só existe no PROMPT — id de nível
        // acima (alucinação/cache de geração anterior) precisa morrer aqui também.
        if (LEVEL_ORDER[catalog.minLevel] > LEVEL_ORDER[level]) {
          out.push({
            rule: 'EXERCISE_LEVEL_TOO_HIGH',
            detail: `${ex.exerciseId} exige nível ${catalog.minLevel}, usuário é ${level}`,
            action: 'BLOCK',
          });
        }
        const clash = catalog.contraindicatedFor.filter((t) => excluded.has(t));
        if (clash.length > 0) {
          out.push({
            rule: 'EXERCISE_CONTRAINDICATED',
            detail: `${ex.exerciseId} contraindicado por ${clash.join(',')}`,
            action: 'BLOCK',
          });
        }
        if (!inRange(ex.sets, SETS_RANGE)) {
          out.push({
            rule: 'SETS_OUT_OF_RANGE',
            detail: `${ex.exerciseId}: ${ex.sets} séries`,
            action: 'BLOCK',
          });
        }
        // `measurement` (achado 2026-08-18): isométrico (prancha) e cardio contínuo/intervalado
        // (caminhada, bike, tiros) são prescritos por TEMPO, não por reps — cada um checa a
        // faixa do campo que de fato faz sentido pra ele, em vez de forçar reps em tudo.
        if (catalog.measurement === 'DURATION') {
          const durationRange = catalog.durationSecondsRange ?? DURATION_SECONDS_RANGE;
          if (ex.durationSeconds === undefined || !inRange(ex.durationSeconds, durationRange)) {
            out.push({
              rule: 'DURATION_OUT_OF_RANGE',
              detail: `${ex.exerciseId}: ${ex.durationSeconds ?? 'ausente'}s`,
              action: 'BLOCK',
            });
          }
        } else if (
          ex.reps === undefined ||
          !inRange(ex.reps.min, repsRange) ||
          !inRange(ex.reps.max, repsRange)
        ) {
          out.push({
            rule: 'REPS_OUT_OF_RANGE',
            detail: `${ex.exerciseId}: ${ex.reps ? `${ex.reps.min}-${ex.reps.max}` : 'ausente'} reps`,
            action: 'BLOCK',
          });
        }
        const restFloor = catalog.minRestSeconds ?? REST_SECONDS_RANGE.min;
        if (!inRange(ex.restSeconds, { min: restFloor, max: REST_SECONDS_RANGE.max })) {
          out.push({
            rule: 'REST_OUT_OF_RANGE',
            detail: `${ex.exerciseId}: ${ex.restSeconds}s`,
            action: 'BLOCK',
          });
        }
      }
    }
  }

  /**
   * Metodologia v2 do RT: divisão coerente com nível e frequência real, isolado como
   * complemento (nunca base da sessão) e técnica avançada como recurso pontual restrito a
   * intermediário/avançado. Tudo BLOCK — divisão/intensidade acima
   * do nível é exatamente o erro que machuca aluno novo.
   */
  private checkMethodology(
    structure: ProtocolStructure,
    level: ExerciseLevel,
    preferredDays: Weekday[] | undefined,
    out: ValidationViolation[],
  ): void {
    // Achado 2026-08-18: uma sessão por dia real declarado, nem mais nem menos — sem
    // isso a IA podia entregar 1 sessão genérica pra um aluno de 4x/semana. Só valida
    // quando a constraint existe (protocolo antigo/edição sem ela: fail-open).
    if (preferredDays && preferredDays.length > 0) {
      if (structure.sessions.length !== preferredDays.length) {
        out.push({
          rule: 'SESSION_COUNT_MISMATCH',
          detail: `${structure.sessions.length} sessões geradas, ${preferredDays.length} dias declarados (${preferredDays.join(',')})`,
          action: 'BLOCK',
        });
      }
      const declared = new Set(preferredDays);
      const generated = new Set(
        structure.sessions.map((s) => s.weekday).filter((w): w is Weekday => w !== undefined),
      );
      const sameSet =
        generated.size === declared.size && [...declared].every((d) => generated.has(d));
      if (!sameSet) {
        out.push({
          rule: 'WEEKDAY_MISMATCH',
          detail: `dias gerados (${[...generated].join(',') || 'nenhum'}) não batem com os declarados (${preferredDays.join(',')})`,
          action: 'BLOCK',
        });
      }
    }

    const split = structure.splitType;
    if (split) {
      if (!SPLITS_BY_LEVEL[level].includes(split)) {
        out.push({
          rule: 'SPLIT_LEVEL_NOT_ALLOWED',
          detail: `divisão ${split} não permitida para nível ${level}`,
          action: 'BLOCK',
        });
      }
      // `weeklyFrequency` é preenchido pelo próprio LLM: um ABCDE "5x/semana" com 2 sessões no
      // array driblaria a regra. Vale a MENOR entre o declarado e o que existe de fato.
      const effectiveFrequency = Math.min(structure.weeklyFrequency, structure.sessions.length);
      if (effectiveFrequency < MIN_FREQUENCY_BY_SPLIT[split]) {
        out.push({
          rule: 'SPLIT_FREQUENCY_MISMATCH',
          detail: `divisão ${split} exige ao menos ${MIN_FREQUENCY_BY_SPLIT[split]}x/semana`,
          action: 'BLOCK',
        });
      }
    }

    let sessionsWithTechnique = 0;
    for (const session of structure.sessions) {
      // RT item 2: isolado é COMPLEMENTO, nunca a base da sessão. Sessão só de isolados passava.
      const isolation = session.exercises.filter(
        (ex) => EXERCISE_BY_ID.get(ex.exerciseId)?.pattern === 'ISOLATION',
      ).length;
      if (isolation > session.exercises.length - isolation) {
        out.push({
          rule: 'ISOLATION_AS_BASE',
          detail: `${session.dayLabel}: ${isolation} isolados de ${session.exercises.length} exercícios — isolado é complemento, não base`,
          action: 'BLOCK',
        });
      }

      const techniques = session.exercises.filter((ex) => ex.technique);
      if (techniques.length === 0) continue;
      sessionsWithTechnique++;
      if (level === 'INICIANTE') {
        out.push({
          rule: 'TECHNIQUE_LEVEL_NOT_ALLOWED',
          detail: `técnica avançada (${techniques[0]?.technique}) em protocolo de nível INICIANTE`,
          action: 'BLOCK',
        });
      }
      if (techniques.length > MAX_TECHNIQUES_PER_SESSION) {
        out.push({
          rule: 'TECHNIQUE_OVERUSE',
          detail: `${session.dayLabel}: ${techniques.length} exercícios com técnica avançada (máx. ${MAX_TECHNIQUES_PER_SESSION})`,
          action: 'BLOCK',
        });
      }
    }
    // "Não precisam aparecer em todos os treinos": com 2+ sessões, uma tem que ficar limpa.
    if (structure.sessions.length > 1 && sessionsWithTechnique === structure.sessions.length) {
      out.push({
        rule: 'TECHNIQUE_OVERUSE',
        detail: 'técnica avançada em todas as sessões da semana',
        action: 'BLOCK',
      });
    }
  }

  /**
   * Veto por PAR-Q. Duas entradas independentes:
   *  - `parqFlags` (há gatilho de PAR-Q): sem pico de intensidade e sem técnica avançada;
   *  - `maxPhase` (2026-08-24): teto duro de periodização + piso de RIR. Nasce de Q4
   *    (tontura/desmaio) e é o que dá dente ao "modo conservador" pedido no prompt — um
   *    prompt pode ser ignorado pelo modelo, este veto não pode.
   *
   * `maxPhase` é checado **fora** do early-return de `parqFlags`: Q4 mapeia para
   * `BALANCE_FALL_RISK`, então na prática vêm juntos, mas um teto de fase que só valesse
   * quando a lista de tags é não-vazia seria um acoplamento silencioso e frágil.
   */
  private checkParq(
    structure: ProtocolStructure,
    parqFlags: readonly ContraindicationTag[],
    maxPhase: 'ADAPTACAO' | undefined,
    out: ValidationViolation[],
  ): void {
    if (maxPhase === 'ADAPTACAO') {
      if (structure.phase !== 'ADAPTACAO') {
        out.push({
          rule: 'PARQ_PHASE_CAP_EXCEEDED',
          detail: `fase ${structure.phase} acima do teto ADAPTACAO exigido pelo PAR-Q`,
          action: 'BLOCK',
        });
      }
      // Piso de RIR: quem tem alerta clínico aberto não treina perto da falha. `rir`
      // é opcional no schema — ausente não é violação (o exercício simplesmente não
      // prescreve proximidade de falha); declarado abaixo de 2 é.
      for (const session of structure.sessions) {
        for (const ex of session.exercises) {
          if (ex.rir !== undefined && ex.rir < PARQ_MIN_RIR) {
            out.push({
              rule: 'PARQ_RIR_TOO_LOW',
              detail: `${ex.exerciseId}: rir ${ex.rir} abaixo do piso ${PARQ_MIN_RIR} exigido pelo PAR-Q`,
              action: 'BLOCK',
            });
          }
        }
      }
    }

    if (parqFlags.length === 0) return;
    // PAR-Q sinalizado não pode receber pico de intensidade (fase FORCA).
    if (structure.phase === 'FORCA') {
      out.push({
        rule: 'PARQ_VIOLATION',
        detail: 'fase FORCA com flag de PAR-Q presente',
        action: 'BLOCK',
      });
    }
    // Nem técnica avançada: RT item 12 — alerta clínico tem prioridade sobre o objetivo.
    if (structure.sessions.some((s) => s.exercises.some((ex) => ex.technique))) {
      out.push({
        rule: 'PARQ_VIOLATION',
        detail: 'técnica avançada com flag de PAR-Q presente',
        action: 'BLOCK',
      });
    }
  }

  private checkLanguage(text: string, out: ValidationViolation[]): void {
    const canonical = canonicalizeSecurityText(text);
    for (const rule of LANGUAGE_RULES) {
      if (rule.pattern.test(canonical)) {
        out.push({
          rule: rule.id,
          detail: 'termo/expressão proibida na saída',
          action: rule.action,
        });
      }
    }
    if (containsPromptLeak(canonical)) {
      out.push({
        rule: 'PROMPT_LEAK',
        detail: 'saída contém trecho do system prompt',
        action: 'BLOCK',
      });
    }
  }
}

/** Concatena todo o texto livre do protocolo (o que pode carregar linguagem proibida/leak). */
function collectText(structure: ProtocolStructure): string {
  const parts: string[] = [structure.generalNotes ?? ''];
  for (const session of structure.sessions) {
    parts.push(session.dayLabel, session.focus);
    for (const ex of session.exercises) parts.push(ex.name, ex.notes ?? '');
  }
  return parts.join('\n');
}

/**
 * Deriva a ação final: qualquer BLOCK → fallback; senão qualquer FLAG → revisão; senão PASS.
 * Exportada para teste direto: nenhuma regra atual do catálogo produz FLAG isolado (a última,
 * `DIAGNOSIS`, virou BLOCK — ver changelog do serviço), mas o ramo FLAG_HUMAN_REVIEW continua
 * um veredito real consumido por `protocol-planner.ts`/`protocol-auto-release.worker.ts`.
 */
export function aggregate(violations: ValidationViolation[]): ValidationVerdict {
  if (violations.some((v) => v.action === 'BLOCK')) {
    return { action: 'BLOCK_FALLBACK', code: 'BLOCK', humanReviewRequired: true, violations };
  }
  if (violations.some((v) => v.action === 'FLAG')) {
    return { action: 'FLAG_HUMAN_REVIEW', code: 'FLAG', humanReviewRequired: true, violations };
  }
  return { action: 'PASS', code: 'PASS', humanReviewRequired: false, violations };
}
