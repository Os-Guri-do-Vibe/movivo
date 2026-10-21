/**
 * Copy do fluxo de agenda flexível (aluno pede ao Coach para treinar em outro dia, descansar,
 * reorganizar a semana, desfazer, ou pede o link do check-in diário).
 *
 * Texto FIXO, montado a partir de fatos que o servidor já calculou (`schedule-planner.ts`):
 * a IA não escreve nada aqui, então a copy não precisa passar pelo validador de saída e o
 * Coach nunca promete uma mudança que o sistema não fez. As variações existem só para a
 * conversa não soar repetida; são escolhidas por uma semente estável, para o retry do job
 * reenviar o mesmo texto.
 *
 * # Linguagem (inegociável, `CLAUDE.md`)
 * Descansar e remarcar são parte do plano, nunca falha: sem "perdeu", "faltou", "compensar" ou
 * qualquer tom de culpa. Treino que fica de fora é "ficar de fora desta semana". Sem travessão
 * (regra de produto) e sem os termos clínicos proibidos. `schedule-messages.spec.ts` varre tudo.
 */
import { whatsappBold as bold } from '../../core/text/whatsapp-format';
import type { WeekSlot } from '../workout/schedule-planner';
import { shortWeekdayName } from '../workout/workout-eligibility';

export interface SessionNames {
  /** "Treino A" / "Dia A": o rótulo que o aluno usa para pedir. */
  dayLabel: string;
  /** "Costas e Bíceps": o que ele reconhece. */
  focus: string;
}

/** Resolve a chave de uma sessão (`dayLabel`) para o nome que o aluno vê. */
export type NameOf = (sessionKey: string) => SessionNames;

export function sessionName(names: SessionNames): string {
  return names.dayLabel === names.focus ? names.focus : `${names.dayLabel} (${names.focus})`;
}

function variant<T>(options: readonly [T, ...T[]], seed: string): T {
  const index = [...seed].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return options[index % options.length] ?? options[0];
}

function dayName(date: string, today: string): string {
  return date === today ? 'hoje' : shortWeekdayName(date);
}

function capitalized(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/** Os dias de hoje em diante, um por linha, com o treino ou "descanso". */
export function weekLayout(slots: readonly WeekSlot[], today: string, nameOf: NameOf): string {
  return slots
    .filter((slot) => slot.date >= today)
    .map((slot) => {
      const day = capitalized(shortWeekdayName(slot.date));
      const tag = slot.date === today ? ' (hoje)' : '';
      const what = slot.locked
        ? 'treino feito ✅'
        : slot.sessionKey === null
          ? 'descanso'
          : sessionName(nameOf(slot.sessionKey));
      return `• ${bold(day)}${tag}: ${what}`;
    })
    .join('\n');
}

export type AppliedRequest =
  | { kind: 'TRAIN_ON'; date: string; sessionKey: string }
  | { kind: 'REST_ON'; date: string }
  | { kind: 'REORGANIZE' };

const UNDO_HINT = 'Se preferir voltar como estava, é só me dizer "desfazer".';

export function scheduleAppliedMessage(input: {
  request: AppliedRequest;
  today: string;
  slots: readonly WeekSlot[];
  dropped: readonly string[];
  nameOf: NameOf;
  seed: string;
}): string {
  const { request, today, slots, dropped, nameOf, seed } = input;
  let headline: string;
  if (request.kind === 'TRAIN_ON') {
    const name = bold(sessionName(nameOf(request.sessionKey)));
    headline =
      request.date === today
        ? variant(
            [
              `Pode sim! 💪🏼 Hoje é dia de ${name}.`,
              `Bora! 💪🏼 Hoje fica o ${name}.`,
              `Combinado! Hoje você treina ${name}. 👊🏼`,
            ],
            seed,
          )
        : `Combinado! O ${name} fica para ${dayName(request.date, today)}. 💪🏼`;
  } else if (request.kind === 'REST_ON') {
    headline =
      request.date === today
        ? 'Tudo bem, hoje é dia de descansar. 💚 Descansar também faz parte do plano.'
        : `Combinado, ${dayName(request.date, today)} vira dia de descanso. 💚 Descansar também faz parte do plano.`;
  } else {
    headline = 'Feito! Reorganizei a semana do jeito que você pediu. 💚';
  }

  const parts = [headline, `Sua semana ficou assim:\n${weekLayout(slots, today, nameOf)}`];
  if (dropped.length > 0) {
    const names = dropped.map((key) => bold(sessionName(nameOf(key)))).join(' e ');
    parts.push(
      `${dropped.length === 1 ? 'O treino' : 'Os treinos'} ${names} ${dropped.length === 1 ? 'fica' : 'ficam'} de fora desta semana. Sem problema: seguimos com o resto, e na segunda a semana volta ao plano de sempre. 💚`,
    );
  }
  parts.push(UNDO_HINT);
  return parts.join('\n\n');
}

/** O aluno já estava onde pediu: nada mudou. */
export function scheduleAlreadyThereMessage(input: {
  request:
    { kind: 'TRAIN_ON'; date: string; sessionKey: string } | { kind: 'REST_ON'; date: string };
  today: string;
  nameOf: NameOf;
}): string {
  const { request, today, nameOf } = input;
  if (request.kind === 'TRAIN_ON') {
    const name = bold(sessionName(nameOf(request.sessionKey)));
    return request.date === today
      ? `Hoje já é dia de ${name}, então é só seguir. 💪🏼`
      : `O ${name} já está marcado para ${dayName(request.date, today)}, está tudo certo. 💪🏼`;
  }
  return `${capitalized(dayName(request.date, today))} já é dia de descanso no seu plano. 💚`;
}

/** A semana está cheia: o aluno escolhe qual treino fica de fora. */
export function scheduleChoiceQuestion(input: {
  request: { kind: 'TRAIN_ON'; date: string } | { kind: 'REST_ON'; date: string };
  today: string;
  candidates: ReadonlyArray<{ date: string; sessionKey: string }>;
  nameOf: NameOf;
}): string {
  const { request, today, candidates, nameOf } = input;
  const what =
    request.kind === 'REST_ON'
      ? `${dayName(request.date, today)} ser descanso`
      : `treinar ${dayName(request.date, today)}`;
  const list = candidates
    .map(
      (candidate, index) =>
        `${index + 1}. ${bold(capitalized(shortWeekdayName(candidate.date)))}: ${sessionName(nameOf(candidate.sessionKey))}`,
    )
    .join('\n');
  return [
    `Essa semana está cheia: para ${what}, um dos treinos precisa ficar de fora, porque não sobra dia livre para encaixar todos. 💚`,
    `Qual você prefere deixar de fora?\n${list}`,
    'Se preferir, me diga também em que dia fica cada um dos outros.',
  ].join('\n\n');
}

/**
 * O dia pedido já tem outro treino: o aluno escolhe entre pular o que estava lá (o resto da semana
 * não muda) e empurrar os treinos seguintes até o próximo descanso. A opção 2 mostra o arranjo
 * que ficaria, calculado pelo planejador, para a escolha ser informada.
 */
export function scheduleConflictQuestion(input: {
  today: string;
  date: string;
  /** Treino que já estava no dia pedido. */
  displacedKey: string;
  /** Como a semana ficaria se os treinos fossem empurrados (só os dias que mudam). */
  pushed: ReadonlyArray<{ date: string; sessionKey: string }>;
  nameOf: NameOf;
}): string {
  const { today, date, displacedKey, pushed, nameOf } = input;
  const day = dayName(date, today);
  const pushList = pushed
    .map((slot) => `${sessionName(nameOf(slot.sessionKey))} em ${dayName(slot.date, today)}`)
    .join(', ');
  return [
    `${capitalized(day)} você já tem o ${bold(sessionName(nameOf(displacedKey)))}. Como prefere organizar? 💚`,
    [
      `1. ${bold('Pular')} o treino de ${day} e manter o resto da semana como está.`,
      `2. ${bold('Empurrar')} os treinos, até o próximo descanso: ${pushList}.`,
    ].join('\n'),
    'É só responder 1 ou 2.',
  ].join('\n\n');
}

export type RefusalReason =
  | 'PAST_DATE'
  | 'OUT_OF_WEEK'
  | 'DAY_LOCKED'
  | 'UNKNOWN_SESSION'
  | 'ALREADY_DONE'
  | 'QUOTA_REACHED'
  | 'NOTHING_PENDING'
  | 'DATE_TAKEN'
  | 'DUPLICATE_DATE'
  | 'DUPLICATE_SESSION'
  | 'DATE_CONFLICT';

export function scheduleRefusalMessage(input: {
  reason: RefusalReason;
  today: string;
  date?: string;
  sessionKey?: string;
  quota: number;
  /** Treinos da semana ainda por fazer: sem nenhum, a semana está de fato concluída. */
  pending?: number;
  sessionNames: readonly SessionNames[];
  nameOf: NameOf;
}): string {
  const { reason, today, date, sessionKey, quota, pending = 0, sessionNames, nameOf } = input;
  switch (reason) {
    case 'PAST_DATE':
      return 'Esse dia já passou, então não consigo mexer nele. Se você treinou e não conseguiu registrar, me avise que eu te mando o link para registrar. 💚';
    case 'OUT_OF_WEEK':
      return 'Consigo organizar a semana até domingo. A próxima semana começa na segunda, com o seu plano de sempre. 💚';
    case 'DAY_LOCKED':
      return date === today
        ? 'Hoje você já treinou, então o dia está fechado. 💪🏼 Quer mexer em algum outro dia?'
        : `${capitalized(dayName(date ?? today, today))} já tem um treino registrado, então não consigo mexer nele. Quer mexer em outro dia?`;
    case 'UNKNOWN_SESSION': {
      const list = sessionNames.map((names) => `• ${sessionName(names)}`).join('\n');
      return `Não achei esse treino no seu plano. Os seus treinos são:\n${list}\n\nQual deles você quer?`;
    }
    case 'ALREADY_DONE': {
      const name = sessionKey ? bold(sessionName(nameOf(sessionKey))) : 'Esse treino';
      return `O ${name} você já fez nesta semana. 💪🏼 Se quiser, posso trazer outro treino que ainda falta: é só me dizer qual.`;
    }
    case 'QUOTA_REACHED':
      // A semana está cheia de treinos MARCADOS, não concluída: não dá para parabenizar. Para
      // encaixar outro, um dos marcados precisa ficar de fora.
      if (pending > 0) {
        const what = sessionKey ? `o ${bold(sessionName(nameOf(sessionKey)))}` : 'esse treino';
        return `Sua semana já está com os ${quota} treinos marcados, então para encaixar ${what} um dos outros precisa ficar de fora. 💚 Me diga qual você prefere deixar de fora e em que dia entra esse.`;
      }
      return `Você já fechou os ${quota} treinos desta semana, parabéns! 👏🏼 Descansar também faz parte do plano, e na segunda começa uma semana nova.`;
    case 'NOTHING_PENDING':
      return `Você já fechou os ${quota} treinos desta semana, parabéns! 👏🏼 Descansar também faz parte do plano, e na segunda começa uma semana nova.`;
    case 'DUPLICATE_SESSION': {
      const name = sessionKey ? bold(sessionName(nameOf(sessionKey))) : 'Um treino';
      return `${name} apareceu mais de uma vez nesse arranjo, e cada treino entra uma vez só na semana. 💚 Me conta de novo como prefere organizar?`;
    }
    case 'DATE_CONFLICT':
      return `${capitalized(dayName(date ?? today, today))} já tem outro treino. 💚 Prefere pular o que já estava nesse dia ou empurrar os treinos da semana?`;
    case 'DATE_TAKEN':
    case 'DUPLICATE_DATE':
      return 'Do jeito que ficou, dois treinos cairiam no mesmo dia, e eu só consigo colocar um por dia. 💚 Me conta de novo como prefere organizar?';
  }
}

export function scheduleNotUnderstoodMessage(): string {
  return 'Me conta com qual dia você quer mexer? Por exemplo: "hoje eu treino o A" ou "amanhã eu descanso". 💚';
}

export function scheduleUndoneMessage(input: {
  slots: readonly WeekSlot[];
  today: string;
  nameOf: NameOf;
}): string {
  return `Pronto, voltei como estava. 💚\n\nSua semana ficou assim:\n${weekLayout(input.slots, input.today, input.nameOf)}`;
}

export function scheduleUndoUnavailableMessage(reason: 'NOTHING_TO_UNDO' | 'ALREADY_USED'): string {
  return reason === 'ALREADY_USED'
    ? 'Esse ajuste já foi usado (o treino daquele dia já aconteceu), então não consigo desfazer. Se quiser, posso reorganizar o que ainda falta da semana. 💚'
    : 'Não tenho nenhum ajuste recente para desfazer. Quer mexer em algum dia da semana? 💚';
}

// Registro tardio (treino feito num dia que já passou) ------------------------------------------

export function lateLogWhichDayMessage(): string {
  return 'Claro, vamos registrar. 💪🏼 Qual dia você treinou? Pode ser ontem ou anteontem.';
}

export function lateLogWhichSessionQuestion(input: {
  options: ReadonlyArray<{ key: string; focus: string }>;
}): string {
  const list = input.options
    .map((option) => `• ${sessionName({ dayLabel: option.key, focus: option.focus })}`)
    .join('\n');
  return `Qual treino você fez nesse dia?\n${list}`;
}

export function lateLogOutOfWindowMessage(windowDays: number): string {
  return `Consigo abrir o registro de treinos de até ${windowDays} dias atrás, e esse já passou do prazo. 💚 Mas me conta como foi, que eu fico por dentro do seu momento.`;
}

export function lateLogAlreadyLoggedMessage(focus: string): string {
  return `O treino de ${bold(focus)} desse dia já está registrado. 💪🏼 Bom trabalho!`;
}

// Pedido do link do check-in diário -----------------------------------------------------------

export function noWorkoutTodayMessage(): string {
  return 'Hoje é dia de descanso no seu plano. 💚 Se quiser treinar mesmo assim, me diga qual treino e eu coloco hoje.';
}

export function workoutAlreadyDoneMessage(focus: string): string {
  return `O seu treino de hoje (${bold(focus)}) já está registrado. 💪🏼 Bom trabalho!`;
}

export function linkJustSentMessage(): string {
  return 'O link acabou de ir para você, é só dar uma olhada logo acima na conversa. 😉';
}

/** O link não pôde ser gerado agora; o que o aluno pediu já está feito e ele sabe como pedir de novo. */
export function linkUnavailableMessage(kind: 'DAILY' | 'LATE_LOG'): string {
  return kind === 'LATE_LOG'
    ? 'O registro do seu treino já está aberto, mas não consegui gerar o link agora. 💚 Me peça de novo daqui a pouco, por exemplo "quero registrar o treino de ontem", que eu envio.'
    : 'Não consegui gerar o link agora, mas o seu treino já está certo na agenda. 💚 Me peça "me manda o link" daqui a pouco que eu envio.';
}

export function noActiveProtocolMessage(): string {
  return 'Ainda não encontrei um treino ativo para você por aqui. Se algo parecer errado, me conta que eu aviso o profissional responsável.';
}
