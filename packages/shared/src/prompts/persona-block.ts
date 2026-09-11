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

/**
 * Rótulo de cada descritor de tom **em forma SUBSTANTIVA**, nunca adjetiva.
 *
 * ## Por que substantivo (achado de Victor, 2026-08-25 — mesma classe do bug "Você é a {nome}")
 * O mapa anterior traduzia os descritores para adjetivos flexionados no feminino
 * (`calorosa`, `direta`, `bem-humorada`, `técnica`) porque havia uma única persona, feminina.
 * Com duas personas publicadas ao mesmo tempo (uma por sexo do titular), um agente de nome
 * masculino recebia "Fale de forma calorosa, direta" e passava a se referir a si mesmo no
 * feminino por concordância gramatical — o modelo copia o gênero do adjetivo que descreve
 * o falante.
 *
 * Substantivo não flexiona pelo falante: "Seu tom é: acolhimento, objetividade" vale
 * igualmente para persona masculina e feminina. Nenhum descritor foi criado, removido ou
 * ressignificado — só mudou a FORMA gramatical do rótulo de cada um.
 */
export const TONE_LABEL: Record<AgentPersona['toneDescriptors'][number], string> = {
  caloroso: 'acolhimento',
  direto: 'objetividade',
  'bem-humorado': 'humor leve',
  tecnico: 'precisão técnica',
  motivacional: 'motivação',
  sem_hype: 'ausência de hype',
  informal: 'informalidade',
  formal: 'formalidade',
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
 * Renderizado a partir de campos de espaço fechado: nome (regex), descritores de tom
 * (ENUM, máx. 4), traços de comportamento (ENUM, máx. 3) e política de emoji (ENUM).
 *
 * Decisão do fundador (2026-09-04): `agentSelfIntro` deixou de entrar aqui.
 * "Como ela se apresenta" virou copy ESTÁTICA para a mensagem de 30min pós-formulário
 * (`apps/api/.../message-templates.ts`, `analyzingMessage`), não mais um fragmento de
 * identidade injetado em toda conversa — a identidade da agente na conversa em si é só
 * nome + tom + comportamento + política de emoji, as outras abas do painel.
 */
export function buildPersonaBlock(persona: AgentPersona): string {
  const tone = persona.toneDescriptors.map((descriptor) => TONE_LABEL[descriptor]).join(', ');
  const behavior = persona.personaTraits
    .map((trait) => PERSONA_TRAIT_INSTRUCTION[trait])
    .join(', ');
  return [
    // "Seu tom é: <substantivos>" no lugar de "Fale de forma <adjetivos>": nenhuma das duas
    // metades da frase pode carregar gênero, porque a mesma função renderiza a persona
    // masculina e a feminina (ver o cabeçalho de `TONE_LABEL`).
    `Você é ${persona.agentName}. Seu tom é: ${tone}.`,
    // `PERSONA_TRAIT_INSTRUCTION` já são imperativos neutros de gênero ("acolha o contexto
    // antes de orientar"); o antigo "seja" antes deles era, além de agramatical, o único
    // ponto da frase que pediria concordância. Sem ele a lista fica correta e neutra.
    `Durante a conversa, ${behavior}.`,
    EMOJI_INSTRUCTION[persona.emojiPolicy],
    // Achado 2026-09-10 (pedido do fundador): os rótulos ENUM acima, sozinhos, calibram mal
    // vocabulário/energia concretos — a saída soava "IA tentando parecer descontraída" mesmo
    // com `caloroso`+`informal` publicados. Um exemplo real (opcional, por persona) calibra
    // muito melhor que mais adjetivo — mesmo raciocínio do exemplo ERRADO/CERTO em
    // `buildFormattingBlock`.
    //
    // Achado 2026-09-10 (2ª rodada, reproduzido ao vivo): "nunca repita literalmente" não foi
    // suficiente — a IA passou a usar "brother" (a ÚNICA palavra de vocativo do exemplo) em
    // praticamente toda mensagem, virando cacoete tão robótico quanto o problema original.
    // Pessoa de verdade não repete o mesmo vocativo sempre; a maioria das frases não tem
    // vocativo nenhum. Instrução reforçada pra travar exatamente esse padrão.
    persona.voiceExample
      ? 'Exemplo real do seu tom, pra calibrar vocabulário e energia (NUNCA repita ' +
        'literalmente, é só referência de registro; e NUNCA deixe uma palavra específica do ' +
        'exemplo, como um vocativo, virar cacoete repetido em toda mensagem — a maioria das ' +
        `respostas não deveria ter vocativo nenhum, só ocasionalmente): "${persona.voiceExample}"`
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * **L2 — formato da mensagem.** Substitui funcionalmente o antigo `maxResponseChars`, com
 * uma diferença que é o ponto da mudança: além de instruir o modelo, o valor é aplicado
 * como teto determinístico na saída (`applyResponseFormatting`, no worker), antes da
 * entrega. Instrução de prompt sozinha nunca foi um teto.
 *
 * Achado 2026-09-10: as regras de VOZ (não comentar a pergunta, não fechar com frase de
 * efeito, o exemplo ERRADO/CERTO, "resposta mais curta que resolve") viviam aqui, mas são
 * conteúdo de conversa, não layout — viraram diretriz de produto e se mudaram pra
 * `NATURAL_CONVERSATION_BLOCK` (`apps/api/.../prompts.ts`). Este bloco ficou só com regra de
 * LAYOUT de verdade (parágrafo/linha/lista/negrito) + a proibição de travessão, que é
 * caractere, não voz, e tem rede de segurança determinística própria (`applyResponseFormatting`).
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
    // Achado 2026-09-02 (correção do fundador): a saída soava "AI slop". Travessão (—) é o
    // sintoma mais citado (o fundador foi explícito: NUNCA usar). `applyResponseFormatting`
    // (worker) troca qualquer travessão que escapar por vírgula como rede de segurança
    // determinística — instrução de prompt sozinha nunca é teto neste sistema.
    'NUNCA use travessão (o símbolo "—") em nenhuma frase, nem para separar uma explicação, ' +
      'nem para unir duas ideias. Prefira vírgula, ponto, ou duas frases curtas separadas.',
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
