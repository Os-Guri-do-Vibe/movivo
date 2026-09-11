/**
 * ValidationService — veto determinístico sobre o TREINO INTEIRO (US-2.3, pedra angular).
 *
 * Com a rejeição do motor determinístico, a segurança do produto mora aqui. Duas camadas,
 * <100ms, sem I/O:
 *  1. **Estrutural** (gabarito = base de referência + constraints): todo exercício existe,
 *     é do nível certo e não é contraindicado pela lesão/PAR-Q. Quanto treinar (séries,
 *     repetições, duração, descanso) NÃO tem faixa fixa aqui — decisão do fundador
 *     (2026-09-04): é julgamento do Coach Agente que gera o protocolo, não tabela de
 *     código. Exceção: piso de RIR sob PAR-Q (`checkParq`), que é modo conservador de
 *     segurança para quem tem alerta clínico aberto, não uma faixa de treino padrão.
 *  2. **Linguagem/compliance**: sem prescrição/diagnóstico/promessa/violação-PAR-Q/leak.
 *
 * Falha dura → `BLOCK_FALLBACK` (o Worker regenera com fallback de modelo e, persistindo,
 * cai no template pré-aprovado). Falha leve → `FLAG_HUMAN_REVIEW` (roteia sem bloquear).
 * O `code` alimenta `ai_jobs.validation_action` (PASS|FLAG|BLOCK).
 */
import { Injectable } from '@nestjs/common';
import type { ProtocolStructure, Weekday } from '@movivo/shared';

import { canonicalizeSecurityText } from '../../../core/agent-config/text-normalize';
import { type ContraindicationTag, type ExerciseLevel, LEVEL_ORDER } from '../exercise-catalog';
import { ExerciseCatalogProvider } from '../exercise-catalog-provider.service';
import { isPhaseDurationWithinRange, PHASE_DURATION_WEEKS_RANGE } from '../protocol-timeline';
import type { UserConstraints } from '../user-constraints';
import { containsPromptLeak } from './prompt-injection';
import {
  ISOLATION_MAJORITY_THRESHOLD,
  LANGUAGE_RULES,
  MAX_TECHNIQUES_PER_SESSION,
  MIN_FREQUENCY_BY_SPLIT,
  SPLITS_BY_LEVEL,
  type ValidationActionCode,
} from './validation-rules';

export type ValidationAction = 'PASS' | 'FLAG_HUMAN_REVIEW' | 'BLOCK_FALLBACK';

/** Piso de Repetições em Reserva sob teto de PAR-Q — nunca treinar perto da falha. */
const PARQ_MIN_RIR = 2;

/**
 * Piso mais alto para quem tem alerta CARDÍACO aberto no PAR-Q (Q1/Q2/Q3/Q5) — RIR é proxy
 * de esforço percebido e de resposta cardiovascular aguda, não só de risco ortopédico.
 */
const PARQ_CARDIAC_MIN_RIR = 3;

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

/* v8 ignore start -- ramo sintético do `emitDecoratorMetadata` (design:paramtypes), não
 * lógica de aplicação: os hits do lcov mostram que independe do argumento passado ao
 * construtor, dispara uma vez por carregamento do módulo. */
@Injectable()
/* v8 ignore stop */
export class ValidationService {
  /**
   * `catalog` tem valor padrão de propósito: os ~10 call sites que hoje fazem
   * `new ValidationService()` (testes unitários) continuam funcionando sem harness do Nest
   * nem banco — servem o bootstrap estático, o mesmo catálogo de antes desta mudança.
   */
  constructor(private readonly catalog: ExerciseCatalogProvider = new ExerciseCatalogProvider()) {}

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
    this.checkStructure(input.structure, level, excluded, violations);
    this.checkMethodology(input.structure, level, input.constraints.preferredDays, violations);
    this.checkParq(input.structure, input.parqFlags ?? [], input.constraints.maxPhase, violations);
    this.checkPhaseDuration(input.structure, violations);
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

  /**
   * Substituição: a resposta não pode empurrar um exercício da base fora do autorizado.
   *
   * Achado 2026-09-08 (bug reproduzido ao vivo pelo fundador): nome de exercício composto
   * pode conter, como SUBSTRING, o nome de outro exercício distinto do catálogo — ex.:
   * "Caminhada de Mala (Halter)" contém "Caminhada". Um scan ingênuo de substring sinalizava
   * "Caminhada" como não autorizado mesmo quando "Caminhada de Mala (Halter)" (o texto que
   * REALMENTE apareceu) estava no `allowedExercises` daquele turno — bloqueando respostas
   * legítimas mesmo com o vocabulário 100% dentro do autorizado. Correção: mascara toda
   * ocorrência de um nome AUTORIZADO no texto (do mais longo pro mais curto, pra um nome
   * autorizado não mascarar parcialmente outro nome autorizado maior que o contém) antes de
   * procurar por nomes NÃO autorizados no que sobrar — assim "caminhada" só é sinalizado se
   * aparecer sozinho, fora de qualquer trecho já coberto por um nome autorizado.
   */
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
    const allowedNamesByLengthDesc = [...allowedSet].sort((a, b) => b.length - a.length);
    let masked = lower;
    for (const name of allowedNamesByLengthDesc) {
      if (name.length === 0) continue;
      masked = masked.split(name).join(' '.repeat(name.length));
    }
    for (const ex of this.catalog.getAll()) {
      const exerciseName = canonicalizeSecurityText(ex.name).toLocaleLowerCase('pt-BR');
      if (allowedSet.has(exerciseName) || allowedSet.has(ex.id)) continue;
      if (masked.includes(exerciseName)) {
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
    level: ExerciseLevel,
    excluded: Set<ContraindicationTag>,
    out: ValidationViolation[],
  ): void {
    for (const session of structure.sessions) {
      for (const ex of session.exercises) {
        const catalog = this.catalog.getById(ex.exerciseId);
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
        // Decisão do fundador (2026-09-04): séries, repetições, duração e descanso deixaram
        // de ter faixa fixa aqui (e no catálogo). O catálogo só diz QUAL exercício é seguro
        // prescrever (nível, contraindicação) — quanto/quanto tempo é julgamento do próprio
        // Coach Agente que gera o protocolo, com autonomia real, não uma tabela de código.
        // O piso de RIR sob PAR-Q (`checkParq` abaixo) continua existindo: é modo
        // conservador de segurança para quem tem alerta clínico aberto, categoria diferente
        // de "faixa de treino padrão para todo mundo".
      }
    }
  }

  /**
   * Achado 2026-09-02 (correção do fundador): `phaseDurationWeeks` é quem decide
   * `total_weeks`/`end_date` do protocolo — a IA declara a duração do mesociclo dentro da
   * faixa baseada em evidência da fase escolhida (`PHASE_DURATION_WEEKS_RANGE`,
   * `protocol-timeline.ts`). Nunca confiar só no prompt: um valor fora da faixa da fase é
   * BLOCK, não um ajuste silencioso. Diferente das faixas de série/repetição/duração por
   * exercício (removidas — ver docstring da classe), isto é duração de MESOCICLO
   * (periodização baseada em evidência), não prescrição por exercício.
   */
  private checkPhaseDuration(structure: ProtocolStructure, out: ValidationViolation[]): void {
    if (!isPhaseDurationWithinRange(structure.phase, structure.phaseDurationWeeks)) {
      const range = PHASE_DURATION_WEEKS_RANGE[structure.phase];
      out.push({
        rule: 'PHASE_DURATION_OUT_OF_RANGE',
        detail:
          `fase ${structure.phase}: ${structure.phaseDurationWeeks} semana(s), fora da faixa ` +
          `${range.minWeeks}-${range.maxWeeks}`,
        action: 'BLOCK',
      });
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
      // Achado 2026-09-03: o corte é por MAIORIA CLARA (ISOLATION_MAJORITY_THRESHOLD), não
      // qualquer maioria — ver o comentário da constante em validation-rules.ts.
      const isolation = session.exercises.filter(
        (ex) => this.catalog.getById(ex.exerciseId)?.pattern === 'ISOLATION',
      ).length;
      if (isolation > session.exercises.length * ISOLATION_MAJORITY_THRESHOLD) {
        out.push({
          rule: 'ISOLATION_AS_BASE',
          detail: `${session.dayLabel}: ${isolation} isolados de ${session.exercises.length} exercícios — isolado é complemento, não base`,
          action: 'BLOCK',
        });
      }

      // Achado 2026-09-03 (reproduzido ao vivo): as duas regras de técnica abaixo partem
      // do modelo mental de treino tradicional em academia — técnica avançada (drop-set,
      // superset etc.) como "recurso pontual" sobre uma base de séries retas. CIRCUITO é
      // outra coisa: por definição, a sessão INTEIRA é uma sequência de exercícios
      // encadeados sem descanso — a IA legitimamente marca `technique` (ex.: SUPERSET/
      // DESCANSO_ATIVO) na maioria ou em todos os exercícios pra representar exatamente
      // isso, e bloquear por "técnica em excesso"/"em todas as sessões" rejeitava um
      // circuito válido só por não ser o formato que a regra tinha em mente. `split` já é
      // metodologia aprovada pro nível (`SPLIT_LEVEL_NOT_ALLOWED` acima cobre isso), então
      // não há necessidade de duplicar a barreira aqui.
      const techniques = session.exercises.filter((ex) => ex.technique);
      if (techniques.length === 0 || split === 'CIRCUITO') continue;
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
    // CIRCUITO não conta pro `sessionsWithTechnique` acima (loop pulado), então não dispara aqui.
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
      // prescreve proximidade de falha); declarado abaixo do piso é.
      //
      // Achado 2026-09-02: piso único (2) tratava restrição cardiovascular igual a
      // restrição ortopédica. RIR mede proximidade da falha — proxy direto de esforço
      // percebido e resposta cardiovascular aguda (FC/PA sobem com a proximidade da
      // falha), não só de técnica sob fadiga. Para quem tem alerta CARDÍACO aberto
      // (PAR-Q Q1/Q2/Q3/Q5 — problema no coração, dor no peito, medicação de pressão),
      // o piso sobe: a mesma folga que basta pra proteger uma articulação não basta pra
      // conter a resposta cardiovascular de alguém nessa condição.
      const rirFloor = parqFlags.includes('CARDIAC') ? PARQ_CARDIAC_MIN_RIR : PARQ_MIN_RIR;
      for (const session of structure.sessions) {
        for (const ex of session.exercises) {
          if (ex.rir !== undefined && ex.rir < rirFloor) {
            out.push({
              rule: 'PARQ_RIR_TOO_LOW',
              detail: `${ex.exerciseId}: rir ${ex.rir} abaixo do piso ${rirFloor} exigido pelo PAR-Q`,
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
