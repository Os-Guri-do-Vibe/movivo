/**
 * Copy do outbound (US-2.5 / TASK-2.5.2-2.5.3) — persona MOVI (Sofia §11): calorosa,
 * direta, sem hype. Respaldo CREF sempre visível; transparência de IA na 1ª mensagem da
 * entrega. Guardrails inegociáveis: nunca "diagnóstico/tratamento/cura/garantido"; a IA
 * nunca decide sozinha (sempre "profissional CREF, usando IA como ferramenta").
 *
 * `\n---\n` separa bolhas — o outbound envia cada trecho como uma mensagem (Sofia §11).
 */
import type { AgentPersona } from '@movivo/shared';

/** Separador de bolhas — o worker envia cada trecho como uma mensagem distinta. */
export const BUBBLE_SEPARATOR = '\n---\n';

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
export function confirmationMessage(firstName: string | null): string {
  const greeting = firstName ? `Olá, ${firstName}!` : 'Olá!';
  return (
    `${greeting}\n\n` +
    'Recebemos suas informações e já começamos a preparar seu treino, levando em conta seus ' +
    'objetivos, sua rotina e o que você respondeu no formulário.\n\n' +
    'Assim que estiver tudo pronto, enviaremos seu treino por aqui. 💚\n\n' +
    'Agora é só aguardar, a MOVIVO cuida do resto. 💪🏼'
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
 * Convite ao formulário de troca de protocolo por fim de mesociclo. Texto livre (não é
 * Template Meta aprovado): diferente do código de verificação da Etapa 1 — que é a
 * PRIMEIRA mensagem de um número novo —, este vai para um titular que já troca mensagem
 * com a MOVIVO ao longo de toda a assinatura (protocolo, check-in semanal, coach), então
 * a janela de 24h da AraraHQ normalmente está aberta; mesmo racional de
 * `REENGAGEMENT`/`CHECKIN_MESSAGE` (`WhatsappOutboundJob.type`).
 */
export function mesocycleRenewalMessage(firstName: string | null, link: string): string {
  const greeting = firstName ? `Olá, ${firstName}!` : 'Olá!';
  return (
    `${greeting}\n\n` +
    'Seu mesociclo atual chegou ao fim! Para preparar seu novo protocolo, precisamos ' +
    'saber como foram estas últimas semanas. Leva poucos minutos.\n\n' +
    `Responda por aqui: ${link}\n\n` +
    'O seu treinador irá revisar ' +
    'suas respostas antes de liberar o próximo mesociclo.'
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
 * "Estou analisando" — 30 min após o submit, sempre (sucesso ou falha da geração, mandatory
 * ou optional). Sempre a apresentação do agente configurada no painel ("Como ele(a) se
 * apresenta" / `agentSelfIntro`), verbatim — mesmo texto independente de `reviewUrgency`.
 *
 * Decisão do fundador (2026-09-04): antes havia uma 2ª variante só para `MANDATORY` que
 * declarava explicitamente "sou uma inteligência artificial... um profissional vai revisar"
 * (achado de QA 2026-08-25) — reproduzido ao vivo mandando essa variante pro fundador em
 * teste, quando o esperado era a apresentação normal. Unificado a pedido dele.
 *
 * Isso NÃO tira a transparência de IA/CREF do caminho `MANDATORY` por PAR-Q: quem dispara
 * `confirmationCareMessage()` no submit já avisa, na hora, que "um profissional de Educação
 * Física registrado no CREF vai revisar... antes de liberar". O único caso que perde aviso
 * explícito aqui é `MANDATORY` por falha de geração (`usedFallbackTemplate`) sem PAR-Q — ali
 * a única confirmação anterior foi a normal (`confirmationMessage`), sem menção a CREF/IA.
 */
export function analyzingMessage(persona: AgentPersona): string {
  return persona.agentSelfIntro.trim();
}

/** De/para de exercício de uma substituição liberada — usado só na saudação de reentrega. */
export interface SubstitutionDeliveryInfo {
  from: string;
  to: string;
}

/**
 * Entrega **com PDF** — 1ª bolha: saudação estática pelo primeiro nome. 2ª bolha
 * (`aiSummary`, opcional): apresentação do treino escrita pelo agente de IA na hora do envio
 * (`WorkoutPresentationService`, no módulo de protocolo — o `whatsapp` nunca fala com LLM
 * diretamente, §12.5 de `ARQUITETURA.md`). `undefined`/vazio quando a IA falhou ou foi
 * reprovada na validação de linguagem: a entrega segue só com a 1ª bolha — o PDF, que vem
 * logo depois no mesmo envio, continua sendo o plano completo de qualquer forma.
 *
 * Achado 2026-09-08 (bug reproduzido ao vivo pelo fundador): esta saudação era usada SEM
 * distinção pra qualquer entrega de protocolo com PDF — inclusive a reentrega automática após
 * uma substituição de exercício aprovada. O aluno pedia pra trocar um exercício, a troca era
 * aplicada e o protocolo reenviado com "seu treino está pronto! Montamos tudo com base nos
 * seus objetivos...", como se fosse a primeira entrega — nunca mencionando que era uma
 * ATUALIZAÇÃO por causa da troca que ele mesmo pediu. `substitution`, quando informado, troca
 * a saudação inteira por uma que nomeia a troca aplicada.
 *
 * `volumeAdjusted` (achado 2026-09-13): mesma lógica, pro ajuste de volume (séries/reps)
 * aplicado a partir da resposta "poderia ser mais curto" do check-in semanal.
 */
export function protocolDeliveryPdfText(
  firstName: string | null,
  aiSummary?: string,
  substitution?: SubstitutionDeliveryInfo,
  volumeAdjusted?: boolean,
): string {
  const intro = substitution
    ? `${firstName ? `${firstName}, a` : 'A'} troca do seu exercício já foi feita! 💚🔄\n\n` +
      `"${substitution.from}" virou "${substitution.to}" no seu protocolo, segue o treino ` +
      'atualizado em PDF.'
    : volumeAdjusted
      ? `${firstName ? `${firstName}, ajustei` : 'Ajustei'} seu treino pra ficar mais rápido, ` +
        'como você pediu no check-in semanal! 💚⏱️\n\n' +
        'Reduzi volume respeitando a metodologia do profissional CREF, sem trocar nenhum ' +
        'exercício — segue o protocolo atualizado em PDF.'
      : `${firstName ? `${firstName}, seu` : 'Seu'} treino está pronto! 💚🔥\n\n` +
        'Montamos tudo com base nos seus objetivos, na sua rotina e nas informações que você ' +
        'compartilhou com a gente.';
  return aiSummary ? [intro, aiSummary].join(BUBBLE_SEPARATOR) : intro;
}
