/**
 * Mensagens de validação amigáveis (PT-BR) para o profissional e para a equipe.
 *
 * O Zod devolve textos técnicos em inglês ("Too small: expected number to be >=1") e sem
 * dizer ONDE está o problema. Este módulo traduz cada `issue` para uma frase que aponta o
 * treino, o exercício e o campo ("Segunda › Supino reto › Séries: o valor mínimo é 1.").
 *
 * Fonte única: o front (validação antes de enviar), o BFF e a API usam esta função, então o
 * mesmo erro lê igual em qualquer camada. Não depende do Zod em runtime — só da forma da
 * `issue` — para ser seguro importar de qualquer app.
 */

/** Forma mínima de uma `issue` do Zod 4 que o formatador lê. */
export interface FriendlyIssueInput {
  readonly code?: string;
  readonly path?: readonly PropertyKey[];
  readonly message?: string;
}

interface FieldMeta {
  readonly label: string;
  /** Unidade exibida depois do número ("segundos"). */
  readonly unit?: string;
  /** Substantivo de um item quando o campo é uma lista. */
  readonly item?: { readonly singular: string; readonly plural: string };
}

const FIELDS: Readonly<Record<string, FieldMeta>> = {
  promptVersion: { label: 'Versão da metodologia' },
  goal: { label: 'Objetivo' },
  phase: { label: 'Fase do treino' },
  splitType: { label: 'Divisão do treino' },
  weeklyFrequency: { label: 'Frequência semanal', unit: ' treino(s) por semana' },
  phaseDurationWeeks: { label: 'Duração da fase', unit: ' semana(s)' },
  generalNotes: { label: 'Observações gerais' },
  sessions: { label: 'Treinos', item: { singular: 'treino', plural: 'treinos' } },
  dayLabel: { label: 'Nome do dia' },
  weekday: { label: 'Dia da semana' },
  focus: { label: 'Foco do treino' },
  exercises: { label: 'Exercícios', item: { singular: 'exercício', plural: 'exercícios' } },
  exerciseId: { label: 'Exercício do catálogo' },
  name: { label: 'Nome do exercício' },
  sets: { label: 'Séries' },
  reps: { label: 'Repetições' },
  durationSeconds: { label: 'Duração', unit: ' segundos' },
  restSeconds: { label: 'Descanso', unit: ' segundos' },
  loadStrategy: { label: 'Estratégia de carga' },
  technique: { label: 'Técnica' },
  rir: { label: 'Repetições em reserva (RIR)' },
  videoUrl: { label: 'Link do vídeo' },
  notes: { label: 'Observações' },
  warmupBlocks: {
    label: 'Aquecimento',
    item: { singular: 'bloco de aquecimento', plural: 'blocos de aquecimento' },
  },
  // Corpo das ações do profissional (emenda, assinatura, resolução).
  reason: { label: 'Motivo da atualização' },
  expectedVersion: { label: 'Versão do protocolo' },
  confirmation: { label: 'Confirmação' },
  acknowledgedConflicts: { label: 'Divergências reconhecidas' },
  content: { label: 'Protocolo' },
  resolution: { label: 'Resolução' },
  q: { label: 'Busca' },
};

const GENERIC_FIELD: FieldMeta = { label: 'Campo' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Corpos de emenda/edição embrulham o protocolo em `{ content }`; o formatador aceita os dois. */
function protocolRoot(value: unknown): unknown {
  if (isRecord(value) && !('sessions' in value) && isRecord(value.content)) return value.content;
  return value;
}

/** Rótulo "Treino de Segunda"/"Treino 2" da sessão no índice dado. */
function sessionLabel(content: unknown, index: number): string {
  const sessions = isRecord(content) && Array.isArray(content.sessions) ? content.sessions : [];
  const session = sessions[index];
  const dayLabel = isRecord(session) ? text(session.dayLabel) : '';
  return dayLabel ? `Treino "${dayLabel}"` : `Treino ${index + 1}`;
}

function exerciseLabel(content: unknown, sessionIndex: number, index: number): string {
  const sessions = isRecord(content) && Array.isArray(content.sessions) ? content.sessions : [];
  const session = sessions[sessionIndex];
  const exercises = isRecord(session) && Array.isArray(session.exercises) ? session.exercises : [];
  const exercise = exercises[index];
  const name = isRecord(exercise) ? text(exercise.name) : '';
  return name ? `Exercício "${name}"` : `Exercício ${index + 1}`;
}

interface Located {
  readonly trail: string[];
  readonly field: FieldMeta;
  /** `false` quando o campo não está no dicionário — aí a frase não o nomeia. */
  readonly known: boolean;
}

/** Converte o `path` do Zod na trilha legível (treino › exercício › aquecimento) + campo final. */
function locate(path: readonly PropertyKey[], content: unknown): Located {
  const trail: string[] = [];
  let sessionIndex: number | undefined;
  let fieldKey = '';
  for (let i = 0; i < path.length; i += 1) {
    const segment = path[i];
    const next = path[i + 1];
    if (segment === 'sessions' && typeof next === 'number') {
      sessionIndex = next;
      trail.push(sessionLabel(content, next));
      i += 1;
    } else if (segment === 'exercises' && typeof next === 'number') {
      trail.push(exerciseLabel(content, sessionIndex ?? -1, next));
      // Os índices seguintes (aquecimento etc.) continuam relativos ao exercício.
      i += 1;
    } else if (segment === 'warmupBlocks' && typeof next === 'number') {
      trail.push(`Aquecimento (bloco ${next + 1})`);
      i += 1;
    } else if (typeof segment === 'string') {
      fieldKey = segment;
    }
  }
  const field = FIELDS[fieldKey];
  return { trail, field: field ?? GENERIC_FIELD, known: field !== undefined };
}

/** Repetições são `reps: { min, max }`: o rótulo do campo final precisa dizer qual ponta. */
function repsEndLabel(path: readonly PropertyKey[]): string | undefined {
  const last = path[path.length - 1];
  const parent = path[path.length - 2];
  if (parent !== 'reps') return undefined;
  if (last === 'min') return 'Repetições mínimas';
  if (last === 'max') return 'Repetições máximas';
  return undefined;
}

function numberOf(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  return undefined;
}

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

/** Mensagens custom do schema já escritas em PT-BR passam direto; texto técnico não. */
function looksTechnical(message: string): boolean {
  return /^(invalid|too small|too big|expected|required|unrecognized)/i.test(message);
}

function describe(input: FriendlyIssueInput, field: FieldMeta): string {
  const unit = field.unit ?? '';
  // Campos específicos de cada `code` (minimum, origin, format...) variam por tipo de issue.
  const issue = input as FriendlyIssueInput & Record<string, unknown>;
  switch (issue.code) {
    case 'too_small': {
      const min = numberOf(issue.minimum) ?? 0;
      if (issue.origin === 'string') {
        return min <= 1 ? 'preencha este campo.' : `use pelo menos ${min} caracteres.`;
      }
      if (issue.origin === 'array' || issue.origin === 'set') {
        const noun = field.item ?? { singular: 'item', plural: 'itens' };
        return `adicione pelo menos ${min} ${plural(min, noun.singular, noun.plural)}.`;
      }
      if (min === 0 && issue.inclusive === false) return 'o valor precisa ser maior que zero.';
      return `o valor mínimo é ${min}${unit}.`;
    }
    case 'too_big': {
      const max = numberOf(issue.maximum) ?? 0;
      if (issue.origin === 'string') return `use no máximo ${max} caracteres.`;
      if (issue.origin === 'array' || issue.origin === 'set') {
        const noun = field.item ?? { singular: 'item', plural: 'itens' };
        return `use no máximo ${max} ${plural(max, noun.singular, noun.plural)}.`;
      }
      return `o valor máximo é ${max}${unit}.`;
    }
    case 'invalid_type': {
      if (issue.expected === 'int') return 'informe um número inteiro, sem casas decimais.';
      if (issue.expected === 'number') return 'informe um número válido.';
      return 'preencha este campo.';
    }
    case 'invalid_value':
      return 'escolha uma das opções disponíveis.';
    case 'invalid_format': {
      if (issue.format === 'url') return 'informe um link válido, começando com https://.';
      return 'o formato informado não é válido.';
    }
    case 'unrecognized_keys':
      return 'há informações que o sistema não reconhece. Recarregue a tela e tente de novo.';
    case 'not_multiple_of':
      return 'o valor informado não é permitido.';
    case 'custom': {
      const message = text(issue.message);
      return message && !looksTechnical(message) ? message : 'o valor informado não é válido.';
    }
    default:
      return 'o valor informado não é válido.';
  }
}

/**
 * Traduz uma `issue` do Zod para uma frase amigável em PT-BR.
 *
 * @param content Conteúdo validado (ex.: o protocolo em edição) — usado só para trocar índices
 *   por nomes reais ("Treino \"Segunda\" › Exercício \"Supino reto\""). Opcional.
 */
export function friendlyIssueMessage(issue: FriendlyIssueInput, content?: unknown): string {
  const path = issue.path ?? [];
  const { trail, field, known } = locate(path, protocolRoot(content));
  const endLabel = repsEndLabel(path);
  const where = [...trail];
  if (endLabel) where.push(endLabel);
  else if (known) where.push(field.label);
  const body = describe(issue, field);
  if (where.length === 0) return body.charAt(0).toUpperCase() + body.slice(1);
  return `${where.join(' › ')}: ${body}`;
}

/** Várias `issues` → lista sem repetição, no máximo `limit` itens. */
export function friendlyIssueMessages(
  issues: readonly FriendlyIssueInput[],
  content?: unknown,
  limit = 6,
): string[] {
  const seen = new Set<string>();
  for (const issue of issues) {
    seen.add(friendlyIssueMessage(issue, content));
    if (seen.size >= limit) break;
  }
  return [...seen];
}
