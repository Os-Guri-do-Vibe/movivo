/**
 * Copy do outbound (US-2.5 / TASK-2.5.2-2.5.3) — persona MOVI (Sofia §11): calorosa,
 * direta, sem hype. Respaldo CREF sempre visível; transparência de IA na 1ª mensagem da
 * entrega. Guardrails inegociáveis: nunca "diagnóstico/tratamento/cura/garantido"; a IA
 * nunca decide sozinha (sempre "profissional CREF, usando IA como ferramenta").
 *
 * `\n---\n` separa bolhas — o outbound envia cada trecho como uma mensagem (Sofia §11).
 */
import { PRIMARY_GOAL_LABELS, type AgentPersona, type ProtocolStructure } from '@movivo/shared';

/** Separador de bolhas — o worker envia cada trecho como uma mensagem distinta. */
export const BUBBLE_SEPARATOR = '\n---\n';

/**
 * Emoji só quando a persona permite — `emojiPolicy: 'NENHUM'` é uma escolha do painel
 * (US-7.6), não um detalhe de copy. Devolve o glifo já prefixado por espaço, para ser
 * concatenado logo depois de uma frase encerrada por pontuação (`...pronto.${emoji(...)} `).
 */
function emoji(persona: AgentPersona, glyph: string): string {
  return persona.emojiPolicy === 'NENHUM' ? '' : ` ${glyph}`;
}

function capitalizeFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * "Sou {nome}. {Apresentação}" — achado de QA 2026-08-25: `agentSelfIntro` é texto livre
 * do painel (10-200 caracteres, sem contrato gramatical), e a persona publicada em
 * produção já provou isso na prática ("Olá, sou o Leonardo, seu treinador..." — uma frase
 * completa em primeira pessoa, bem diferente do fragmento em terceira pessoa do default,
 * "a coach digital da MOVIVO, supervisionada por..."). A construção antiga (`Aqui é a
 * ${nome}, ${intro}`) travava o artigo em feminino e virava emenda por vírgula quando o
 * texto publicado já era uma frase própria — ex.: "Aqui é a Leonardo, Olá, sou o
 * Leonardo...". "Sou {nome}" não exige artigo (nem concordância de gênero) em português,
 * e o ponto final (em vez de vírgula) deixa a apresentação valer como frase própria nos
 * dois casos — fragmento (aí ganha sujeito ao virar frase solta) ou frase completa (aí
 * fica redundante, mas nunca quebrada).
 */
function presentPersona(persona: AgentPersona): string {
  return `Sou ${persona.agentName}. ${capitalizeFirst(persona.agentSelfIntro)}`;
}

/**
 * Atraso da mensagem "estou analisando" — contado do SUBMIT do formulário, não da geração.
 *
 * Mora aqui (e não no worker de geração, onde nasceu) porque quem agenda passou a ser o
 * `AnamnesisService.submit()`: a mensagem existe SEMPRE, 30min depois do formulário, tanto
 * no caminho de sucesso quanto no de falha da geração. Uma só fonte do número.
 */
export const PROTOCOL_WAITING_DELAY_MS = 30 * 60 * 1000;

/**
 * Confirmação imediata no submit (PAR-Q liberado), sem prometer prazo operacional.
 *
 * -- EXCEÇÃO DELIBERADA ao guardrail "presença/respaldo do CREF sempre visível"
 * (CLAUDE.md, "Guardrails de linguagem — inegociáveis"): a pedido explícito do
 * fundador em 2026-08-18, este texto específico não menciona IA nem CREF. O
 * guardrail geral continua valendo pras demais mensagens (`confirmationCareMessage`,
 * entrega do protocolo, etc.) — essa é uma exceção pontual desta mensagem, não uma
 * revogação da política. Ver conversa da sessão pra contexto.
 */
export function confirmationMessage(): string {
  return (
    'Recebemos seus dados! 🙌 Seu plano de treino está sendo preparado com base nas informações ' +
    'que você enviou no formulário. Assim que estiver pronto, avisaremos você por aqui.'
  );
}

/**
 * Variante de cuidado (PAR-Q de risco): sem prometer plano automático, sem alarme.
 *
 * "Agradecemos a confiança" no lugar de "obrigada pela confiança" (Sprint 11): a copy é
 * determinística e sai assinada pela persona do titular, que pode ser masculina ou feminina.
 * Particípio flexionável ("obrigada"/"obrigado") travaria o gênero da agente no texto; a
 * forma verbal na primeira pessoa do plural não flexiona. Nada além dessa palavra mudou.
 */
export function confirmationCareMessage(): string {
  return (
    'Recebemos suas respostas, agradecemos a confiança! 🙏 Por segurança, um profissional ' +
    'de Educação Física registrado no CREF vai revisar algumas informações antes de liberar ' +
    'seu plano. Assim que estiver tudo certo, a gente te avisa por aqui.'
  );
}

/**
 * Nome do Template aprovado pela Meta (categoria UTILITY) que carrega o corpo de
 * `phoneVerificationMessage` com `{{1}}` no lugar do código. É a PRIMEIRA mensagem que o
 * número recebe — fora da janela de 24h, `send()` (texto livre) é rejeitado pela AraraHQ
 * (`422 CONVERSATION_WINDOW_CLOSED`); só um Template pré-aprovado passa. Ver nota em
 * `arara-transport.ts`. Renomear aqui exige recriar o Template do mesmo nome na AraraHQ.
 */
export const PHONE_VERIFICATION_TEMPLATE = 'verificacao_numero';

/**
 * Código de verificação de posse do número (US-6.5). Copy nos guardrails: enquadra a
 * fricção como proteção do que o usuário quer (o treino), e avisa para não repassar o
 * código. **Precisa bater com o corpo aprovado do Template `PHONE_VERIFICATION_TEMPLATE`
 * na AraraHQ** — mudou aqui (2026-08-18, a pedido do fundador), precisa mudar lá também
 * quando a criação de Template for desbloqueada (hoje o envio real passa pela
 * EvolutionAPI, que manda este texto literal, sem depender do Template).
 */
export function phoneVerificationMessage(code: string): string {
  return (
    `Seu código da MOVIVO é ${code}. Ele confirma que este WhatsApp é seu e vale por 10 minutos. ` +
    'Nunca compartilhe este código com ninguém.'
  );
}

/**
 * "Estou analisando" — 30 min após o submit, sempre (sucesso ou falha da geração). É a
 * primeira vez que a agente se apresenta ao titular: substitui a antiga `waitingMessage()`,
 * que era genérica e só existia no caminho de falha (fallback de DLQ).
 *
 * Por ser o PRIMEIRO contato da agente (achado de QA 2026-08-25: a transparência de IA
 * do cabeçalho deste arquivo dizia "1ª mensagem da entrega", mas essa deixou de ser a
 * primeira desde que esta função passou a existir) — a frase "sou uma inteligência
 * artificial" precisa estar AQUI, explícita, não só implícita em "montado com IA" como
 * na entrega. Sem isso, uma persona com nome humano ("Leonardo, seu treinador") deixa o
 * titular achar que uma pessoa está analisando as respostas dele.
 *
 * `mandatory: true` = PAR-Q bloqueado, protocolo só sai por assinatura humana: NÃO
 * promete prazo. `mandatory: false` = auto-liberação, prazo curto é honesto.
 */
export function analyzingMessage(persona: AgentPersona, opts: { mandatory: boolean }): string {
  const hello =
    `Oi! ${presentPersona(persona)} Sou uma inteligência artificial que trabalha dentro da ` +
    'metodologia de um profissional de Educação Física registrado no CREF.';

  if (opts.mandatory) {
    return (
      `${hello}${emoji(persona, '🙏')} Já estou analisando as informações que você enviou no ` +
      'formulário para montar seu plano de treino. Antes de liberar, esse profissional vai ' +
      'olhar suas respostas com atenção — é assim que a gente trabalha quando quer ter ' +
      'certeza de que o treino combina com você. Assim que ele der o retorno, te aviso por aqui.'
    );
  }

  return (
    `${hello}${emoji(persona, '💪')} Já estou analisando as informações que você enviou no ` +
    'formulário para montar seu plano de treino personalizado. Logo te mando o plano completo ' +
    'por aqui.'
  );
}

/**
 * Uma linha por exercício: "• Nome — 3x8-12 (descanso 90s)" para exercício de reps, ou
 * "• Nome — 3x40s (descanso 20s)" para exercício de duração (prancha/caminhada/bike/tiros —
 * achado 2026-08-18, `reps`/`durationSeconds` são mutuamente exclusivos no schema).
 */
function exerciseLine(ex: ProtocolStructure['sessions'][number]['exercises'][number]): string {
  const amount =
    ex.durationSeconds !== undefined
      ? `${ex.durationSeconds}s`
      : ex.reps && ex.reps.min === ex.reps.max
        ? `${ex.reps.min}`
        : `${ex.reps?.min}-${ex.reps?.max}`;
  return `• ${ex.name} — ${ex.sets}x${amount} (descanso ${ex.restSeconds}s)`;
}

/**
 * Contexto do plano — entra ANTES do primeiro treino e do CTA. Curto de propósito: dá o
 * porquê, não repete o que o PDF/link já detalham.
 */
/**
 * Achado de QA 2026-08-25: `mesocycleName` ("Mesociclo N — Hipertrofia") nomeia a ÊNFASE
 * TÉCNICA do bloco de periodização — um eixo diferente do objetivo pessoal declarado no
 * formulário (`goal`, ex. "Emagrecimento"). Juxtapor os dois na mesma frase lia como
 * contradição ("o objetivo é X, mas o plano é Y"). Aqui o objetivo vem PRIMEIRO, como o
 * que orienta o desenho do plano; o mesociclo vem depois, enquadrado como uma etapa/bloco
 * de tempo, não como uma segunda resposta a "pra que serve isso".
 */
function explanationBlock(
  goal: ProtocolStructure['goal'],
  totalWeeks: number,
  mesocycleName: string,
): string {
  return (
    `Seu objetivo no formulário foi ${PRIMARY_GOAL_LABELS[goal]}, e é em torno disso que todo ` +
    'o plano foi desenhado — a escolha dos exercícios, o número de séries e as faixas de ' +
    `repetição. Ele começa pelo ${mesocycleName}, um bloco de ${totalWeeks} semanas: esse é o ` +
    'tempo que o corpo precisa treinando no mesmo estímulo antes de fazer sentido evoluir pra ' +
    'próxima etapa. Ao longo das semanas, repare em como você se sentiu em cada treino e se ' +
    'conseguiu completar as séries com a técnica que queria: é sobre isso que vou te perguntar ' +
    'no check-in semanal, e é a partir daí que o profissional CREF responsável ajusta o que for ' +
    'preciso.'
  );
}

function deliveryIntro(persona: AgentPersona): string {
  return (
    `Oi!${emoji(persona, '💪')} ${presentPersona(persona)} Sou uma inteligência artificial e ` +
    'seu plano de treino está pronto — montado dentro da metodologia de um profissional de ' +
    'Educação Física registrado no CREF.'
  );
}

/**
 * Entrega **com PDF** (o caso comum hoje: todo protocolo ativo tem PDF gerado, assinado ou
 * auto-liberado): (1) transparência de IA + respaldo CREF; (2) contexto do plano (mesociclo,
 * duração, objetivo, o que observar). Sem prévia de treino nem link — o PDF que vem logo
 * depois, no mesmo envio, já É o plano completo; repetir o primeiro treino em texto e
 * oferecer um segundo lugar pra "ver o plano completo" ao lado do anexo real seria
 * redundante, não didático (achado 2026-08-25, a pedido do fundador: "pequeno texto
 * explicativo", não o texto inteiro do caminho sem PDF).
 */
export function protocolDeliveryText(
  content: ProtocolStructure,
  persona: AgentPersona,
  totalWeeks: number,
  mesocycleName: string,
): string {
  return [deliveryIntro(persona), explanationBlock(content.goal, totalWeeks, mesocycleName)].join(
    BUBBLE_SEPARATOR,
  );
}

/**
 * Entrega **sem PDF** (fallback raro — protocolo ativo cujo PDF falhou ao gerar): o texto É
 * a entrega inteira, por isso carrega tudo que o PDF traria em outro caminho — (1)
 * transparência de IA + respaldo CREF; (2) contexto do plano; (3) primeiro treino da semana
 * em destaque (aha moment); (4) link para o plano completo (US-2.6).
 */
export function formatProtocolDelivery(
  content: ProtocolStructure,
  link: string,
  persona: AgentPersona,
  totalWeeks: number,
  mesocycleName: string,
): string {
  const first = content.sessions[0];
  const firstWorkout = first
    ? [
        `Seu primeiro treino desta semana — ${first.focus}:`,
        ...first.exercises.map(exerciseLine),
      ].join('\n')
    : 'Seu primeiro treino desta semana já está no seu plano.';

  const cta = `Quer ver o plano completo das próximas semanas? É só abrir: ${link}`;

  return [
    deliveryIntro(persona),
    explanationBlock(content.goal, totalWeeks, mesocycleName),
    firstWorkout,
    cta,
  ].join(BUBBLE_SEPARATOR);
}
