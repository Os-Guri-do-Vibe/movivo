import { alertCopyFor, alertSourceLabel, ALERT_LEVEL_LABEL } from '@/lib/alert-copy';
import type {
  NotificationHistoryItem,
  NotificationItem,
  NotificationOutcome,
} from '@/lib/dashboard-types';

const ORIGIN_LABEL = {
  PARQ: 'Origem: PAR-Q bloqueante',
  FALLBACK: 'Origem: template conservador',
  EDIT: 'Origem: edição do profissional',
  QUALITY: 'Origem: qualidade contextual pendente',
  AI_SUBSTITUTION: 'Origem: substituição confirmada pelo aluno',
  CATALOG_GAP: 'Origem: exercício fora do catálogo',
} as const;

/** Cada tipo abre a sua tela de detalhe: alerta e item da Fila nunca dividem a mesma. */
export function notificationHref(item: Pick<NotificationItem, 'type' | 'id'>): string {
  const id = encodeURIComponent(item.id);
  return item.type === 'alert' ? `/dashboard/alertas/${id}` : `/dashboard/fila/${item.type}/${id}`;
}

/** Alertas de treino chegam da fila só com o título "Acompanhamento de treino: Nome". */
function studentOf(item: NotificationItem): string {
  return (
    item.studentName ?? item.title?.split(': ').slice(1).join(': ') ?? 'Aluno não identificado'
  );
}

export function describeNotification(item: NotificationItem) {
  if (item.type === 'alert') {
    const copy = alertCopyFor({ level: item.level ?? 'ALERT', reason: item.reason ?? '' });
    const source = alertSourceLabel(item.sourceType) ?? 'Conversa';
    return {
      eyebrow: `Alerta · ${ALERT_LEVEL_LABEL[item.level ?? 'ALERT']}`,
      title: copy.title,
      detail: `${studentOf(item)} · ${source}`,
    };
  }
  const urgency = item.section === 'MANDATORY' ? 'Revisão obrigatória' : 'Revisão opcional';
  const tail = item.origin
    ? ORIGIN_LABEL[item.origin]
    : item.autoReleaseAt
      ? `Envio automático às ${new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short' }).format(new Date(item.autoReleaseAt))}`
      : null;
  return {
    eyebrow:
      item.type === 'protocol'
        ? 'Fila · Protocolo para revisão'
        : 'Fila · Substituição de exercício',
    title: item.title ?? 'Item da fila',
    detail: [urgency, tail].filter(Boolean).join(' · '),
  };
}

const OUTCOME_CHIP: Record<NotificationOutcome, string> = {
  RESOLVED: 'Resolvido',
  SIGNED: 'Assinado',
  AUTO_RELEASED: 'Liberado no prazo',
  RELEASED: 'Liberada',
  DISCARDED: 'Recusada',
};

/** Rótulo do chip de estado: "Pendente" ou o resultado da decisão. */
export function statusChip(item: NotificationHistoryItem): string {
  if (item.status === 'PENDING' || !item.outcome) return 'Pendente';
  return OUTCOME_CHIP[item.outcome];
}

function shortDateTime(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const day = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(date);
  const time = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short' }).format(date);
  return `${day}, ${time}`;
}

/** Linha de detalhe de um item já decidido, no lugar de "urgência · origem". */
export function outcomeDetail(item: NotificationHistoryItem): string | null {
  if (item.status !== 'SETTLED' || !item.outcome) return null;
  const when = shortDateTime(item.settledAt);
  switch (item.outcome) {
    case 'RESOLVED':
      return `Resolvido em ${when}`;
    case 'SIGNED':
      return `Assinado pelo profissional em ${when}`;
    case 'AUTO_RELEASED':
      return 'Liberado após o prazo de revisão opcional';
    case 'RELEASED':
      return `Troca liberada em ${when}`;
    case 'DISCARDED':
      return `Troca recusada em ${when}`;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Cabeçalho do grupo do dia: "Hoje", "Ontem" ou "Segunda-feira, 12 de outubro". */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const diff = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Ontem';
  const text = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Chave estável do dia (no fuso do navegador) para agrupar a lista. */
export function dayKey(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/** Hora absoluta ("14:32"), usada nas linhas do registro. */
export function clockTime(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short' }).format(new Date(iso));
}
