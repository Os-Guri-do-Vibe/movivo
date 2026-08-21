/**
 * Renderização dos blocos L2 (identidade/persona e formatação) do system prompt.
 *
 * Mora em `@movivo/shared` porque as duas pontas precisam da MESMA função: a API monta o
 * prompt real com ela, e o painel (US-7.7) mostra o **preview** do prompt enquanto o
 * fundador edita o formulário. Duplicar o template no `apps/web` faria o preview divergir
 * silenciosamente do que a IA realmente recebe — que é justamente o que o preview existe
 * para evitar.
 */
import type { AgentFormatting, AgentPersona } from '../schemas/agent-config.schema';

export const TONE_LABEL: Record<AgentPersona['toneDescriptors'][number], string> = {
  caloroso: 'calorosa',
  direto: 'direta',
  'bem-humorado': 'bem-humorada',
  tecnico: 'técnica',
  motivacional: 'motivacional',
  sem_hype: 'sem hype',
  informal: 'informal',
  formal: 'formal',
};

export const EMOJI_INSTRUCTION: Record<AgentPersona['emojiPolicy'], string> = {
  NENHUM: 'Não use emojis.',
  RARO: 'Use emoji raramente, no máximo um por mensagem.',
  MODERADO: 'Use emojis com moderação.',
};

const PERSONA_TRAIT_INSTRUCTION: Record<AgentPersona['personaTraits'][number], string> = {
  ACOLHE_ANTES_DE_ORIENTAR: 'acolha o contexto antes de orientar',
  EXPLICA_O_PORQUE: 'explique brevemente o porquê da orientação',
  UMA_PERGUNTA_POR_VEZ: 'faça no máximo uma pergunta por vez',
  FOCA_NO_PROXIMO_PASSO: 'termine com um próximo passo claro',
  CELEBRA_PROGRESSO: 'reconheça progresso real sem exagero',
};

/**
 * Tradução de `blockSize` para números concretos.
 *
 * Deliberadamente **não exposta ao painel**: a Sofia expõe três escolhas em linguagem de
 * produto ("curto/médio/livre"), e a calibragem de custo fica aqui, onde muda sem mexer no
 * contrato de UI. `maxChars` é o teto que o pós-processamento determinístico do worker
 * aplica de fato — a frase no prompt é só a primeira das duas barreiras.
 */
export interface BlockSizeSpec {
  paragraphs: number;
  linesPerParagraph: number;
  /** Teto real de caracteres por parágrafo (~90 caracteres por linha no WhatsApp). */
  maxCharsPerParagraph: number;
}

export const BLOCK_SIZE_SPEC: Record<AgentFormatting['blockSize'], BlockSizeSpec> = {
  CURTO: { paragraphs: 1, linesPerParagraph: 2, maxCharsPerParagraph: 180 },
  MEDIO: { paragraphs: 2, linesPerParagraph: 3, maxCharsPerParagraph: 270 },
  LIVRE: { paragraphs: 3, linesPerParagraph: 4, maxCharsPerParagraph: 360 },
};

/** Teto de itens quando a lista é permitida. */
export const MAX_LIST_ITEMS = 5;

const BOLD_INSTRUCTION: Record<AgentFormatting['boldPolicy'], string> = {
  NENHUM: 'Não use nenhum destaque nem markdown.',
  // `*assim*` (asterisco SIMPLES) é o negrito real do WhatsApp. Sem fixar a sintaxe, o
  // modelo emite `**assim**`, que aparece literal na tela do aluno.
  UMA_PALAVRA:
    'Destaque no máximo UMA palavra-chave por mensagem entre asteriscos simples (*assim*); ' +
    'nenhum outro markdown.',
  MODERADO:
    'Destaque no máximo três palavras-chave por mensagem entre asteriscos simples (*assim*); ' +
    'nenhum outro markdown.',
};

/** Quantos trechos em `*negrito*` a política tolera — usado pelo teto determinístico. */
export const MAX_BOLD_SPANS: Record<AgentFormatting['boldPolicy'], number> = {
  NENHUM: 0,
  UMA_PALAVRA: 1,
  MODERADO: 3,
};

/**
 * **L2 — identidade/persona.** Único bloco que vem da configuração publicada no painel.
 * Renderizado a partir de campos de espaço fechado: nome (regex), auto-apresentação curta
 * (checada contra padrões de injeção antes de gravar), descritores de tom (ENUM, máx. 4) e
 * política de emoji (ENUM).
 */
export function buildPersonaBlock(persona: AgentPersona): string {
  const tone = persona.toneDescriptors.map((descriptor) => TONE_LABEL[descriptor]).join(', ');
  const behavior = persona.personaTraits
    .map((trait) => PERSONA_TRAIT_INSTRUCTION[trait])
    .join(', ');
  return [
    `Você é a ${persona.agentName}, ${persona.agentSelfIntro}. Fale de forma ${tone}.`,
    `Durante a conversa, seja ${behavior}.`,
    EMOJI_INSTRUCTION[persona.emojiPolicy],
  ].join(' ');
}

/**
 * **L2 — formato da mensagem.** Substitui funcionalmente o antigo `maxResponseChars`, com
 * uma diferença que é o ponto da mudança: além de instruir o modelo, o valor é aplicado
 * como teto determinístico na saída (`applyResponseFormatting`, no worker), antes da
 * entrega. Instrução de prompt sozinha nunca foi um teto.
 */
export function buildFormattingBlock(formatting: AgentFormatting): string {
  const spec = BLOCK_SIZE_SPEC[formatting.blockSize];
  const list = formatting.allowLists
    ? `Quando precisar listar, use no máximo ${MAX_LIST_ITEMS} itens, um por linha, cada um ` +
      'começando com "- ".'
    : 'Não use listas: escreva em frases corridas.';
  return [
    `FORMATO DA MENSAGEM (WhatsApp): responda em no máximo ${spec.paragraphs} ` +
      `parágrafo${spec.paragraphs > 1 ? 's' : ''} de até ${spec.linesPerParagraph} linhas cada, ` +
      'separados por uma linha em branco.',
    list,
    'Não use tabelas, títulos, numeração aninhada, blocos de código nem links.',
    BOLD_INSTRUCTION[formatting.boldPolicy],
    'Prefira sempre a resposta mais curta que resolve a dúvida.',
  ].join(' ');
}

/**
 * **L2 — temas proibidos (só rótulos).** Reforço em linguagem natural do bloqueio que já é
 * determinístico no servidor. Recebe **exclusivamente `label`**: os termos-gatilho nunca
 * entram em prompt nenhum. Lista vazia ⇒ string vazia ⇒ bloco omitido (custo zero em desuso).
 */
export function buildForbiddenTopicsBlock(labels: readonly string[]): string {
  if (labels.length === 0) return '';
  return (
    `TEMAS PROIBIDOS (somam-se ao perímetro acima): ${labels.join('; ')}. Você não discute, ` +
    'não opina, não compara e não responde nada sobre esses temas — nem parcialmente, nem ' +
    '"em geral", nem como curiosidade. Se o aluno tocar em algum deles, diga em uma frase que ' +
    'esse assunto não é tratado por aqui, sem detalhar o motivo, e volte para o treino.'
  );
}

/**
 * Sufixo estrutural da mensagem de handoff — **constante em código, nunca editável**.
 *
 * O elemento CREF é guardrail de marca (CLAUDE.md) e de defensabilidade jurídica: ele não
 * pode depender do que alguém publicou no painel. Por isso o campo configurável é só a
 * primeira metade da frase; esta metade sempre acompanha.
 */
export const CREF_HANDOFF_SUFFIX =
  'O profissional de Educação Física responsável pela sua supervisão vai te orientar por aqui.';

/** Texto final entregue ao aluno em `PEDIDO_HANDOFF`. Determinístico: copy, nunca prompt. */
export function buildHumanHandoffMessage(persona: AgentPersona): string {
  return `${persona.humanHandoffMessage} ${CREF_HANDOFF_SUFFIX}`;
}
