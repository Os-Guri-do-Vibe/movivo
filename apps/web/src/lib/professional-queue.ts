/**
 * Read-model da Fila do Profissional: um item por aluno, com uma linha por caso (protocolo de
 * treino, protocolo alimentar, troca de exercício, ajuste, geração que falhou). Os casos de
 * `exception_cases` continuam um por proposta; aqui só se agrupa e se traduz para leitura rápida.
 * Nada aqui decide: as regras de obrigatória/opcional vêm prontas do servidor.
 */
import type { ExceptionDomain, ExceptionListItem } from '@movivo/shared';

export type QueueLineKind =
  | 'TRAINING_PLAN'
  | 'NUTRITION_PLAN'
  | 'SUBSTITUTION'
  | 'ADJUSTMENT'
  | 'SWAP_GAP'
  | 'FAILURE'
  | 'OTHER';

export interface QueueLine {
  item: ExceptionListItem;
  kind: QueueLineKind;
  /** O que está pendente, em poucas palavras ("Protocolo de treino"). */
  title: string;
  /** Obrigatória: o aluno só recebe depois de um profissional liberar (sem envio automático). */
  mandatory: boolean;
  /**
   * 🔄 Regerar o protocolo INTEIRO, do zero: publicação de treino/alimentar ou geração que
   * falhou. Nunca para troca de exercício nem ajuste (esses têm a tela do caso).
   */
  canRegenerate: boolean;
  /** Rótulo do lápis: o que a tela do caso permite fazer. `null` quando não há o que editar. */
  editLabel: string | null;
}

export interface QueueStudentGroup {
  studentId: string;
  studentName: string;
  lines: QueueLine[];
  /** Alguma linha obrigatória: o item vai para "Revisão obrigatória". */
  mandatory: boolean;
  /** Prazo mais próximo entre as linhas opcionais (o do cabeçalho do item). */
  nextReleaseAt: string | null;
  /** Caso mais antigo do aluno (idade do item). */
  oldestAt: string;
  /** Caso usado para abrir a anamnese do aluno (a leitura fica na auditoria desse caso). */
  anamnesisCaseId: string;
  /** Somente leitura para o papel em todas as linhas. */
  readOnly: boolean;
}

const DOMAIN_ORDER: Record<ExceptionDomain, number> = {
  TRAINING: 0,
  NUTRITION: 1,
  MEDICAL: 2,
  GENERAL: 3,
};

const ACTION_KIND: Partial<Record<string, QueueLineKind>> = {
  PUBLISH_TRAINING_PLAN: 'TRAINING_PLAN',
  PUBLISH_NUTRITION_PLAN: 'NUTRITION_PLAN',
  SUBSTITUTE_EXERCISE: 'SUBSTITUTION',
  ADJUST_WEEKLY_VOLUME: 'ADJUSTMENT',
  ADJUST_ENERGY_TARGET: 'ADJUSTMENT',
  ADJUST_MEAL_GUIDANCE: 'ADJUSTMENT',
};

const ADJUSTMENT_TITLE: Record<string, string> = {
  ADJUST_WEEKLY_VOLUME: 'Ajuste de volume semanal',
  ADJUST_ENERGY_TARGET: 'Ajuste da meta de energia',
  ADJUST_MEAL_GUIDANCE: 'Ajuste de refeição',
};

function lineKind(item: ExceptionListItem): QueueLineKind {
  if (item.kind === 'DECISION_FAILURE') return 'FAILURE';
  if (item.source === 'SWAP_GAP') return 'SWAP_GAP';
  const byAction = item.actionType ? ACTION_KIND[item.actionType] : undefined;
  if (byAction) return byAction;
  return 'OTHER';
}

function failureTitle(item: ExceptionListItem): string {
  if (item.source === 'CYCLE_REASSESSMENT') return 'Falha ao gerar o novo ciclo';
  if (item.domain === 'TRAINING') return 'Falha ao gerar o protocolo de treino';
  if (item.domain === 'NUTRITION') return 'Falha ao gerar o protocolo alimentar';
  return 'Falha ao gerar o protocolo';
}

function lineTitle(item: ExceptionListItem, kind: QueueLineKind): string {
  switch (kind) {
    case 'TRAINING_PLAN':
      return 'Protocolo de treino';
    case 'NUTRITION_PLAN':
      return 'Protocolo alimentar';
    case 'SUBSTITUTION':
      return 'Troca de exercício';
    case 'ADJUSTMENT':
      return ADJUSTMENT_TITLE[item.actionType ?? ''] ?? 'Ajuste no protocolo';
    case 'SWAP_GAP':
      return 'Troca sem equivalente no catálogo';
    case 'FAILURE':
      return failureTitle(item);
    case 'OTHER':
      return item.domain === 'NUTRITION'
        ? 'Revisão do protocolo alimentar'
        : item.domain === 'TRAINING'
          ? 'Revisão do protocolo de treino'
          : 'Revisão do protocolo';
  }
}

const EDIT_LABEL: Record<QueueLineKind, string | null> = {
  TRAINING_PLAN: 'Revisar e editar o protocolo',
  NUTRITION_PLAN: 'Revisar e editar o protocolo',
  SUBSTITUTION: 'Revisar a troca',
  ADJUSTMENT: 'Revisar o ajuste',
  SWAP_GAP: 'Escolher o exercício',
  FAILURE: null,
  OTHER: 'Abrir a revisão',
};

export function toQueueLine(item: ExceptionListItem): QueueLine {
  const kind = lineKind(item);
  return {
    item,
    kind,
    title: lineTitle(item, kind),
    // Sem urgência (caso antigo) conta como obrigatória: nada sai sem um profissional.
    mandatory: item.reviewUrgency !== 'OPTIONAL',
    canRegenerate:
      item.canResolve &&
      (kind === 'FAILURE' || kind === 'TRAINING_PLAN' || kind === 'NUTRITION_PLAN'),
    editLabel: EDIT_LABEL[kind],
  };
}

const time = (iso: string) => new Date(iso).getTime();

/** Um item por aluno. Dentro do item: treino, alimentar, depois o resto; o mais antigo antes. */
export function groupQueueByStudent(items: readonly ExceptionListItem[]): QueueStudentGroup[] {
  const byStudent = new Map<string, ExceptionListItem[]>();
  for (const item of items) {
    const list = byStudent.get(item.studentId) ?? [];
    list.push(item);
    byStudent.set(item.studentId, list);
  }
  return [...byStudent.entries()].flatMap(([studentId, cases]) => {
    const lines = cases
      .map(toQueueLine)
      .sort(
        (a, b) =>
          DOMAIN_ORDER[a.item.domain] - DOMAIN_ORDER[b.item.domain] ||
          time(a.item.createdAt) - time(b.item.createdAt),
      );
    const releases = lines
      .filter((line) => !line.mandatory && line.item.autoReleaseAt)
      .map((line) => line.item.autoReleaseAt as string)
      .sort((a, b) => time(a) - time(b));
    const [oldest] = [...cases].sort((a, b) => time(a.createdAt) - time(b.createdAt));
    const [first] = lines;
    if (!oldest || !first) return [];
    return [
      {
        studentId,
        studentName: cases.find((c) => c.studentName)?.studentName ?? 'Aluno sem nome',
        lines,
        mandatory: lines.some((line) => line.mandatory),
        nextReleaseAt: releases[0] ?? null,
        oldestAt: oldest.createdAt,
        anamnesisCaseId: first.item.id,
        readOnly: cases.every((c) => !c.canResolve),
      },
    ];
  });
}

/**
 * As duas seções da Fila: obrigatória (qualquer linha que espera o profissional; o mais antigo
 * primeiro) e opcional (tudo será liberado sozinho; o prazo mais próximo primeiro).
 */
export function splitQueue(groups: readonly QueueStudentGroup[]): {
  mandatory: QueueStudentGroup[];
  optional: QueueStudentGroup[];
} {
  const mandatory = groups
    .filter((group) => group.mandatory)
    .sort((a, b) => time(a.oldestAt) - time(b.oldestAt));
  const optional = groups
    .filter((group) => !group.mandatory)
    .sort(
      (a, b) =>
        time(a.nextReleaseAt ?? a.oldestAt) - time(b.nextReleaseAt ?? b.oldestAt) ||
        time(a.oldestAt) - time(b.oldestAt),
    );
  return { mandatory, optional };
}

/** Iniciais para o avatar ("Ana Souza" → "AS"). */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts.at(0)?.charAt(0) ?? '';
  const last = parts.length > 1 ? (parts.at(-1)?.charAt(0) ?? '') : '';
  return `${first}${last}`.toLocaleUpperCase('pt-BR') || '?';
}

/** Tempo até a liberação, curto ("1 h 42 min", "8 min"); `null` quando o prazo já passou. */
export function timeLeft(autoReleaseAt: string, now: Date = new Date()): string | null {
  const minutes = Math.ceil((time(autoReleaseAt) - now.getTime()) / 60_000);
  if (minutes <= 0) return null;
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)} h${rest > 0 ? ` ${rest} min` : ''}`;
}

const clock = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
});

/** Frase do prazo para o relógio e para o leitor de tela. */
export function releaseSentence(autoReleaseAt: string, now: Date = new Date()): string {
  const left = timeLeft(autoReleaseAt, now);
  return left
    ? `Liberação automática em ${left} (às ${clock.format(new Date(autoReleaseAt))}) se ninguém agir antes · revisão opcional`
    : 'Prazo encerrado: liberando ao aluno agora (com o caso aberto, espera você terminar)';
}

/* -------------------------------------------------------------------------- */
/* Detalhes e auditoria: o texto longo da IA, organizado em seções.            */
/* -------------------------------------------------------------------------- */

const ACTION_NAME: Record<string, string> = {
  PUBLISH_TRAINING_PLAN: 'publicar o protocolo de treino',
  PUBLISH_NUTRITION_PLAN: 'publicar o protocolo alimentar',
  SUBSTITUTE_EXERCISE: 'trocar exercício',
  ADJUST_WEEKLY_VOLUME: 'ajustar o volume semanal',
  ADJUST_ENERGY_TARGET: 'ajustar a meta de energia',
  ADJUST_MEAL_GUIDANCE: 'ajustar a orientação de refeição',
  RESCHEDULE_WEEK: 'reorganizar a semana',
  SHORTEN_SESSION: 'encurtar a sessão',
  DEFINE_STRATEGY: 'definir a estratégia',
};

/** Nome da ação em português ("publicar o protocolo de treino"); código desconhecido vira frase. */
export function actionName(type: string): string {
  return (
    ACTION_NAME[type] ?? (type.toLocaleLowerCase('pt-BR').replace(/_+/g, ' ').trim() || 'esta ação')
  );
}

const LEVEL_NAME: Record<string, string> = {
  AUTO: 'automático',
  AUTO_WITH_LIMITS: 'automático dentro dos limites',
  ASK: 'pede revisão',
  ESCALATE: 'exige profissional',
};

export interface ReasonLine {
  /** Frase em português claro. */
  text: string;
  /** Código técnico original, só para auditoria (ex.: `PUBLISH_TRAINING_PLAN = AUTO`). */
  code?: string;
}

const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase('pt-BR') + text.slice(1);

/** "política de autonomia v1: PUBLISH_TRAINING_PLAN = AUTO" → frase humana + código à parte. */
export function humanizeReason(reason: string): ReasonLine {
  const policy = /^política de autonomia v(\d+): ([A-Z_]+) = ([A-Z_]+)/.exec(reason);
  if (policy) {
    const [, version, action, level] = policy as unknown as [string, string, string, string];
    return {
      text: `Política de autonomia (versão ${version}): ${ACTION_NAME[action] ?? 'esta ação'} é ${LEVEL_NAME[level] ?? level.toLowerCase()}.`,
      code: `${action} = ${level}`,
    };
  }
  const fallback = /^sem política de autonomia publicada: ([A-Z_]+) = ([A-Z_]+)/.exec(reason);
  if (fallback) {
    const [, action, level] = fallback as unknown as [string, string, string];
    return {
      text: `Sem política publicada: ${ACTION_NAME[action] ?? 'esta ação'} segue o padrão conservador (${LEVEL_NAME[level] ?? level.toLowerCase()}).`,
      code: `${action} = ${level}`,
    };
  }
  return { text: capitalize(reason.trim()) };
}

export interface LabeledLine {
  label: string;
  text: string;
}

export interface ProposalSections {
  /** Justificativa da IA, uma ideia por item. */
  rationale: string[];
  /** Leitura postural por foto, região a região. */
  posture: LabeledLine[];
  /** Parecer do agente coordenador. */
  coordinator: string[];
}

const POSTURE_PREFIX = /^Avaliação postural por foto[^:]*:\s*/;
const COORDINATOR_PREFIX = /^Coordenador:\s*/;

const trimEnd = (text: string) => text.trim().replace(/[.;]\s*$/, '');

/** Separa a justificativa da IA em seções com rótulo (nunca um parágrafo corrido). */
export function splitRationale(lines: readonly string[]): ProposalSections {
  const sections: ProposalSections = { rationale: [], posture: [], coordinator: [] };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (POSTURE_PREFIX.test(line)) {
      for (const part of line.replace(POSTURE_PREFIX, '').split(/;\s+/)) {
        const cut = part.indexOf(':');
        const label = cut > 0 ? part.slice(0, cut).trim() : 'Observação';
        const text = trimEnd(cut > 0 ? part.slice(cut + 1) : part);
        if (text) sections.posture.push({ label, text });
      }
    } else if (COORDINATOR_PREFIX.test(line)) {
      sections.coordinator.push(line.replace(COORDINATOR_PREFIX, '').trim());
    } else {
      sections.rationale.push(line);
    }
  }
  return sections;
}

/**
 * Resumo de uma geração que falhou ("Não foi possível gerar o plano automaticamente: o agente X
 * não produziu uma saída válida: a: b; c: d") → frase principal + cada problema numa linha.
 */
export function splitFailure(summary: string): { headline: string; problems: string[] } {
  const marker = 'não produziu uma saída válida:';
  const at = summary.indexOf(marker);
  if (at >= 0) {
    const problems = summary
      .slice(at + marker.length)
      .split(/;\s+/)
      .map(trimEnd)
      .filter(Boolean);
    return { headline: `${trimEnd(summary.slice(0, at + marker.length - 1))}.`, problems };
  }
  return { headline: summary.trim(), problems: [] };
}
