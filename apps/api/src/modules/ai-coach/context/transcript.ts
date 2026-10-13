/**
 * Transcrição recente da conversa, montada a partir do histórico durável (`conversations`).
 *
 * Achado 2026-10-13: a janela anterior morava no Redis, por dia civil e com TTL de 24h, e só
 * recebia os turnos que o próprio Coach gerava. Aluno que responde horas ou dias depois (a
 * regra no WhatsApp, não a exceção) encontrava um Coach sem memória da pergunta que ele
 * mesmo fez, do aviso automático e do que o profissional CREF escreveu à mão.
 *
 * Funções puras, sem I/O: o repositório lê e decifra, aqui só se decide o que o modelo vê.
 *  - cada fala leva o autor certo (Aluno, a agente, Profissional CREF);
 *  - todo link some (o link diário carrega um token de acesso que NUNCA vai ao provedor de LLM);
 *  - aviso automático sem valor para a conversa vira um rótulo de uma linha;
 *  - intervalos longos viram marcadores ("14 h depois"), para o Coach saber que a resposta
 *    veio tarde sem precisar adivinhar.
 */
import type { ConversationOrigin } from '../../../core/database/schema';

export interface TranscriptRow {
  origin: ConversationOrigin | null;
  direction: 'INBOUND' | 'OUTBOUND';
  modelUsed: string | null;
  sourceType: string | null;
  content: string;
  createdAt: Date;
}

/** Quantas mensagens e que idade máxima entram na leitura (usado pelo repositório). */
export const TRANSCRIPT_MAX_ROWS = 12;
export const TRANSCRIPT_MAX_AGE_DAYS = 7;

const MAX_LINE_CHARS = 700;
const MAX_TOTAL_CHARS = 6_000;
/** Pausa a partir da qual a conversa ganha um marcador de intervalo. */
const GAP_MARKER_MS = 3 * 3_600_000;
/** URLs com ou sem protocolo e o caminho curto do link de acesso (`/check-in/<código>`). */
const URL_PATTERN = /https?:\/\/\S+|www\.\S+|\/check-in\/\S+/gi;

/** Avisos automáticos que valem como fala do Coach: o aluno pode estar respondendo a eles. */
const SPOKEN_SYSTEM_TYPES = new Set([
  'WORKOUT_INSIGHT',
  'CHECKIN_MESSAGE',
  'REENGAGEMENT',
  'MESOCYCLE_RENEWAL_INVITE',
]);

const SYSTEM_LABELS: Readonly<Record<string, string>> = {
  PROTOCOL_DELIVERY: '[Protocolo de treino enviado em PDF]',
};

/**
 * O link do dia carrega a pergunta sobre o treino sem registro. Só o MAIS RECENTE da janela
 * entra falado (o modelo precisa ver a pergunta que o aluno pode estar respondendo); os
 * anteriores viram um rótulo de uma linha, sempre com a data, porque "Seu treino de hoje é X"
 * de dias atrás confundiria o "hoje" do modelo.
 */
const DAILY_LINK_TYPE = 'WORKOUT_DAILY_LINK';

export function stripLinks(text: string): string {
  return text.replace(URL_PATTERN, '[link]');
}

type Speaker = 'STUDENT' | 'COACH' | 'PROFESSIONAL' | 'SYSTEM';

function speakerOf(row: TranscriptRow): Speaker {
  if (row.origin) return row.origin;
  // Linhas anteriores à coluna `origin`: a mensagem do Coach tem o modelo registrado.
  if (row.direction === 'INBOUND') return 'STUDENT';
  return row.modelUsed ? 'COACH' : 'SYSTEM';
}

/** "segunda-feira (13/10), 04:00": quando uma mensagem automática foi enviada, no fuso do aluno. */
function describeMoment(at: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `de ${value.weekday} (${value.day}/${value.month}), ${value.hour}:${value.minute}`;
}

/** "3 h" ou "2 dias": só para marcador de intervalo, onde precisão de minuto não importa. */
export function gapLabel(ms: number): string {
  const hours = Math.round(ms / 3_600_000);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} dias`;
}

export interface TranscriptOptions {
  now: Date;
  agentName: string;
  /** Fuso para datar as mensagens automáticas ("segunda-feira (13/10), 04:00"). */
  timezone: string;
}

export interface Transcript {
  /** Linhas prontas ("Aluno: …", "<agente>: …", marcadores de intervalo), em ordem. */
  lines: string[];
  /** Marcador antes da mensagem atual quando o aluno demorou a responder; `null` se não. */
  trailingGap: string | null;
}

export function buildTranscript(
  rows: readonly TranscriptRow[],
  currentMessage: string,
  { now, agentName, timezone }: TranscriptOptions,
): Transcript {
  const ordered = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  // A mensagem atual já foi gravada antes do contexto ser montado: não duplica.
  const last = ordered.at(-1);
  if (last && speakerOf(last) === 'STUDENT' && last.content === currentMessage) ordered.pop();

  const lastDailyLink = [...ordered].reverse().find((row) => row.sourceType === DAILY_LINK_TYPE);
  const lines: string[] = [];
  let previous: Date | null = null;
  for (const row of ordered) {
    if (previous && row.createdAt.getTime() - previous.getTime() > GAP_MARKER_MS) {
      lines.push(`— ${gapLabel(row.createdAt.getTime() - previous.getTime())} depois —`);
    }
    previous = row.createdAt;
    const speaker = speakerOf(row);
    if (row.sourceType === DAILY_LINK_TYPE) {
      lines.push(
        row === lastDailyLink
          ? `[Mensagem automática ${describeMoment(row.createdAt, timezone)}] ${stripLinks(row.content).trim().slice(0, MAX_LINE_CHARS)}`
          : `[Aviso automático ${describeMoment(row.createdAt, timezone)}: link do treino do dia enviado]`,
      );
      continue;
    }
    if (speaker === 'SYSTEM' && row.sourceType && !SPOKEN_SYSTEM_TYPES.has(row.sourceType)) {
      lines.push(SYSTEM_LABELS[row.sourceType] ?? '[Mensagem automática do sistema]');
      continue;
    }
    const text = stripLinks(row.content).trim().slice(0, MAX_LINE_CHARS);
    if (!text) continue;
    const label =
      speaker === 'STUDENT'
        ? 'Aluno'
        : speaker === 'PROFESSIONAL'
          ? 'Profissional CREF'
          : agentName;
    lines.push(`${label}: ${text}`);
  }

  let total = lines.reduce((sum, line) => sum + line.length, 0);
  while (total > MAX_TOTAL_CHARS && lines.length > 1) {
    total -= (lines.shift() ?? '').length;
  }

  const lastAt = ordered.at(-1)?.createdAt;
  const delay = lastAt ? now.getTime() - lastAt.getTime() : 0;
  return { lines, trailingGap: delay > GAP_MARKER_MS ? gapLabel(delay) : null };
}
