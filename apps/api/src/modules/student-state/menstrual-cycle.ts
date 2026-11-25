/**
 * Ciclo menstrual (regras puras): leitura das mensagens do WhatsApp, estimativa da fase e
 * previsão dos próximos marcos (menstruação, janela fértil) para os lembretes de autocuidado.
 * Tudo é estimativa por calendário — serve para acolher o que a aluna relata e para lembrá-la de
 * se cuidar, nunca para prescrever sozinha, avaliar saúde ou orientar contracepção.
 */
export const CYCLE_AUTHORIZE_PHRASE = 'AUTORIZO CICLO';
export const CYCLE_REVOKE_PHRASE = 'REVOGAR CICLO';

const DAY_MS = 86_400_000;
/** Mensagem longa é conversa, não registro. */
const MAX_LOG_LENGTH = 160;
/** Quanto para trás um "dia 28" ainda é aceito. */
const MAX_BACKDATE_DAYS = 45;
/** Dois inícios mais próximos que isto são a mesma menstruação. */
export const SAME_PERIOD_DAYS = 15;
const DEFAULT_LENGTH = 28;
const START_PATTERN =
  /\b(menstruei|menstruada|comecei a menstruar|menstruacao (veio|desceu|chegou|comecou))\b/;

/**
 * Pedido, em palavras livres, de ligar ou desligar o acompanhamento ("quero acompanhar meu ciclo",
 * "posso monitorar minha menstruação por aqui?", "parar os lembretes do ciclo"). Os padrões são
 * estreitos de propósito: comentário sobre o ciclo ("meu ciclo começou atrasado", "minha
 * menstruação parou") é conversa e segue para os agentes.
 */
const SUBJECT = /\b(ciclo( menstrual)?|menstruacao|periodo menstrual)\b/;
const TRACKING = /\b(acompanh\w+|monitor\w+|lembrete\w*|registro\w*|aviso\w*|alerta\w*)\b/;
const START_VERB =
  /\b(acompanhar|acompanhe|monitorar|monitore|registrar|registre|ativar|ative|iniciar|inicie|comecar|habilitar|ligar)\b/;
const WANTS =
  /\b(quero|queria|gostaria|posso|pode|podemos|como|bora|vamos|preciso|da para|tem como)\b/;
const STOP_VERB =
  /\b(parar|pare|desativar|desative|cancelar|cancele|desligar|desligue|encerrar|encerre|interromper|interrompa|nao quero mais)\b/;
/** Pedido de ligar/desligar é curto; frase longa é conversa e vai para os agentes. */
const MAX_REQUEST_LENGTH = 90;

function cycleSwitch(normalized: string): 'START' | 'STOP_HINT' | null {
  if (normalized.length > MAX_REQUEST_LENGTH || !SUBJECT.test(normalized)) return null;
  const words = normalized.split(' ').length;
  // "Parar" vem antes: "não quero mais acompanhar o ciclo" tem as duas ideias.
  if (STOP_VERB.test(normalized) && (TRACKING.test(normalized) || words <= 4)) return 'STOP_HINT';
  if (START_VERB.test(normalized) && (WANTS.test(normalized) || words <= 5)) return 'START';
  return null;
}

export type CycleCommand =
  | { kind: 'AUTHORIZE' }
  | { kind: 'REVOKE' }
  | { kind: 'LOG'; onDate: string; question: boolean }
  /** Pediu para começar o acompanhamento (ainda falta a autorização). */
  | { kind: 'START' }
  /** Pediu para parar em palavras livres: a resposta ensina a frase que apaga os registros. */
  | { kind: 'STOP_HINT' };

export type CyclePhase = 'MENSTRUAL' | 'FOLLICULAR' | 'OVULATORY' | 'LUTEAL';

export interface CycleView {
  lastStart: string;
  cycleDay: number;
  typicalLength: number;
  /** `null` = atraso/irregular: não especular. */
  phase: CyclePhase | null;
  /** Inícios registrados: com um só, a duração do ciclo é o padrão de 28 dias (menos confiável). */
  cyclesLogged: number;
}

function plain(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function addDaysIso(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** "hoje" (padrão), "ontem", "anteontem" ou "dia 28" (o dia 28 mais recente até hoje). */
function startDateOf(text: string, today: string): string | null {
  if (/\banteontem\b/.test(text)) return addDaysIso(today, -2);
  if (/\bontem\b/.test(text)) return addDaysIso(today, -1);
  const day = /\bdia (\d{1,2})\b/.exec(text)?.[1];
  if (!day) return today;
  const [y, m] = today.split('-').map(Number) as [number, number];
  for (const back of [0, 1]) {
    const date = new Date(Date.UTC(y, m - 1 - back, Number(day)));
    if (date.getUTCDate() !== Number(day)) continue;
    const iso = date.toISOString().slice(0, 10);
    const ago = daysBetween(iso, today);
    if (ago >= 0) return ago <= MAX_BACKDATE_DAYS ? iso : null;
  }
  return null;
}

export function parseCycleMessage(text: string, today: string): CycleCommand | null {
  const normalized = plain(text).replace(/[.!]+$/g, '');
  if (normalized.toUpperCase() === CYCLE_AUTHORIZE_PHRASE) return { kind: 'AUTHORIZE' };
  if (normalized.toUpperCase() === CYCLE_REVOKE_PHRASE) return { kind: 'REVOKE' };
  if (!START_PATTERN.test(normalized)) {
    const request = cycleSwitch(normalized.replace(/[?]+$/g, '').trim());
    if (request) return { kind: request };
  }
  if (normalized.length > MAX_LOG_LENGTH || !START_PATTERN.test(normalized)) return null;
  const onDate = startDateOf(normalized, today);
  return onDate ? { kind: 'LOG', onDate, question: normalized.includes('?') } : null;
}

export function cycleView(starts: readonly string[], today: string): CycleView | null {
  const sorted = starts.filter((d) => d <= today).sort();
  const lastStart = sorted.at(-1);
  if (!lastStart) return null;
  const intervals = sorted
    .slice(1)
    .map((d, i) => daysBetween(sorted[i] as string, d))
    .filter((n) => n >= 21 && n <= 45);
  const typicalLength =
    intervals.length > 0
      ? Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length)
      : DEFAULT_LENGTH;
  const cycleDay = daysBetween(lastStart, today) + 1;
  const ovulation = typicalLength - 14;
  const phase: CyclePhase | null =
    cycleDay > typicalLength + 7
      ? null
      : cycleDay <= 5
        ? 'MENSTRUAL'
        : cycleDay < ovulation - 1
          ? 'FOLLICULAR'
          : cycleDay <= ovulation + 1
            ? 'OVULATORY'
            : 'LUTEAL';
  return { lastStart, cycleDay, typicalLength, phase, cyclesLogged: sorted.length };
}

// --- Previsão e lembretes de autocuidado ---------------------------------------------------

/** Marcos estimados do ciclo corrente, todos por calendário. */
export interface CycleForecast {
  /** Início estimado da próxima menstruação. */
  nextStart: string;
  /** Negativo = a data estimada já passou (atraso). */
  daysUntilNext: number;
  /** Janela fértil estimada: dos 5 dias antes ao dia seguinte da ovulação estimada. */
  fertileFrom: string;
  fertileTo: string;
}

export function cycleForecast(view: CycleView, today: string): CycleForecast {
  const nextStart = addDaysIso(view.lastStart, view.typicalLength);
  const ovulation = addDaysIso(view.lastStart, view.typicalLength - 14 - 1);
  return {
    nextStart,
    daysUntilNext: daysBetween(today, nextStart),
    fertileFrom: addDaysIso(ovulation, -5),
    fertileTo: addDaysIso(ovulation, 1),
  };
}

/**
 * Lembretes de autocuidado, um por marco e por ciclo:
 *  · FERTILE_WINDOW: começo da janela fértil estimada;
 *  · PMS_PHASE: cerca de uma semana antes da menstruação (fase em que TPM é mais comum);
 *  · PERIOD_SOON: um ou dois dias antes da data estimada;
 *  · PERIOD_LATE: a data estimada passou há alguns dias e nenhum início foi registrado.
 */
export const CYCLE_CARE_EVENTS = [
  'FERTILE_WINDOW',
  'PMS_PHASE',
  'PERIOD_SOON',
  'PERIOD_LATE',
] as const;
export type CycleCareEvent = (typeof CYCLE_CARE_EVENTS)[number];

/**
 * Marcos cuja janela de envio inclui hoje, do mais urgente ao menos. As janelas têm alguns dias
 * de folga: se hoje o contato do dia já foi usado por outro fluxo, o lembrete sai amanhã. Depois
 * de muito atraso (ciclo irregular ou registro esquecido) nada mais é enviado: não se especula.
 */
export function dueCycleCareEvents(view: CycleView, today: string): CycleCareEvent[] {
  const forecast = cycleForecast(view, today);
  const until = forecast.daysUntilNext;
  const due: CycleCareEvent[] = [];
  if (until <= -4 && until >= -8) due.push('PERIOD_LATE');
  if (until >= 1 && until <= 2) due.push('PERIOD_SOON');
  if (until >= 5 && until <= 7) due.push('PMS_PHASE');
  const intoWindow = daysBetween(forecast.fertileFrom, today);
  if (intoWindow >= 0 && intoWindow <= 2 && until > 7) due.push('FERTILE_WINDOW');
  return due;
}
