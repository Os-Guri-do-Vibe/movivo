/**
 * JID do Baileys/EvolutionAPI → telefone E.164 (US-3.1-EVO).
 *
 * # Por que este arquivo é crítico
 * O telefone devolvido aqui é usado, sem nenhum filtro adicional, como chave de
 * `WhatsappInboundService.resolveUser()` (`eq(users.phoneNumber, phone)`, UNIQUE). Ou
 * seja: **quem manda no telefone manda em qual titular recebe a mensagem**. Um JID de
 * grupo aceito por engano faria a fala de um terceiro entrar no contexto de saúde de um
 * aluno; uma heurística de "variante" faria a mensagem de um número escrever no
 * histórico de outro. Por isso o contrato é binário: **bate exato ou devolve `null`**.
 *
 * # Regras (todas obrigatórias — Sato)
 *  1. Só `@s.whatsapp.net` (conversa individual). `@g.us` (grupo), `status@broadcast`,
 *     `@newsletter` e `@lid` são rejeitados.
 *  2. `@lid` é o JID de privacidade do WhatsApp: o número dentro dele é um identificador
 *     opaco, NÃO um telefone — poderia colidir com o telefone real de outro titular.
 *  3. `participant` preenchido indica contexto de grupo mesmo quando o `remoteJid` parece
 *     individual: o remetente real não é o dono do `remoteJid` → rejeita.
 *  4. Sufixo de dispositivo (`5511999998888:12@…`) é removido antes da validação.
 *  5. **Proibida qualquer heurística de variante** (com/sem o 9º dígito do celular BR,
 *     DDI implícito, etc.). Casar "quase" é exatamente o bug de vazamento entre titulares.
 */
import { phoneE164Schema } from '@movivo/shared';

/** Único sufixo de JID que representa uma conversa individual. */
const INDIVIDUAL_SUFFIX = '@s.whatsapp.net';

/** JID de privacidade do WhatsApp. Os dígitos dentro dele NUNCA são um telefone. */
const LID_SUFFIX = '@lid';

/** Parte local aceitável: dígitos E.164 sem o `+`, sem zero à esquerda (8–15 dígitos). */
const LOCAL_PART_PATTERN = /^[1-9]\d{7,14}$/;

/**
 * `remoteJid` → `+E.164`, ou `null` quando o JID não representa, sem ambiguidade, uma
 * conversa individual com um telefone real. Nunca lança.
 */
export function normalizeWhatsappJid(remoteJid: string, participant?: string): string | null {
  if (typeof remoteJid !== 'string') return null;
  // Regra 3: contexto de grupo — o remetente real é o `participant`, não o `remoteJid`.
  if (typeof participant === 'string' && participant.trim().length > 0) return null;

  const jid = remoteJid.trim().toLowerCase();
  // Regra 1/2: qualquer sufixo que não seja o individual é descartado (inclui `@g.us`,
  // `@lid`, `@newsletter` e `status@broadcast`).
  if (!jid.endsWith(INDIVIDUAL_SUFFIX)) return null;

  const local = jid.slice(0, -INDIVIDUAL_SUFFIX.length);
  // Regra 4: `numero:dispositivo` — o dispositivo não faz parte da identidade do titular.
  const digits = local.split(':')[0] ?? '';
  if (!LOCAL_PART_PATTERN.test(digits)) return null;

  const e164 = `+${digits}`;
  // Validação final contra o MESMO schema usado no cadastro do telefone (`@movivo/shared`),
  // para que "o que entra pelo webhook" e "o que está em `users.phone_number`" nunca
  // divirjam de contrato.
  return phoneE164Schema.safeParse(e164).success ? e164 : null;
}

/**
 * Subconjunto do `key` do Baileys que identifica o REMETENTE. Só o que decide identidade
 * entra aqui — `id`/`fromMe` são tratados fora.
 */
export interface WhatsappSenderKey {
  readonly remoteJid: string;
  /**
   * Contrapartida em telefone (`@s.whatsapp.net`) quando o `remoteJid` veio em LID.
   * Emitido pelo Baileys sob `addressingMode: 'lid'`.
   */
  readonly remoteJidAlt?: string;
  readonly participant?: string;
}

/**
 * `key` → telefone E.164 do remetente, ou `null`.
 *
 * # Por que este passo existe (achado de QA, 2026-08-24 — Mariana)
 * O contrato real do Baileys foi conferido contra as mensagens efetivamente entregues a
 * esta instância (tabela `Message` do container `evoapicloud/evolution-api:v2.3.7`): a
 * ESMAGADORA MAIORIA das mensagens recebidas hoje chega em **endereçamento LID**, com
 * `remoteJid: '<opaco>@lid'` e o telefone real em `remoteJidAlt`. Tratar só o `remoteJid`
 * fazia `normalizeWhatsappJid()` devolver `null` para praticamente todo aluno real — o
 * webhook chegava, era autenticado, e a mensagem morria como `unresolvable_sender`. Ou
 * seja: o sintoma original ("o agente não responde no WhatsApp") sobrevivia à feature.
 *
 * # A regra, sem afrouxar o isolamento entre titulares
 *  - `remoteJid` individual (`@s.whatsapp.net`) → é ele a identidade. `remoteJidAlt` é
 *    ignorado (não há razão para um segundo candidato quando o primeiro já é um telefone).
 *  - `remoteJid` em `@lid` → a identidade é **exclusivamente** `remoteJidAlt`, validado
 *    pelo MESMO caminho estrito. Os dígitos do LID continuam proibidos como telefone.
 *  - Qualquer outro `remoteJid` (`@g.us`, `status@broadcast`, `@newsletter`) → `null`
 *    **sem nunca olhar `remoteJidAlt`**. Este é o ponto delicado: em grupo o `remoteJid`
 *    é o GRUPO e o remetente real é o `participant`; cair no `remoteJidAlt` ali atribuiria
 *    a fala de um terceiro a um titular. O fallback é restrito ao caso individual-LID.
 *  - `participant` preenchido → contexto de grupo → `null` antes de qualquer outra coisa.
 *
 * Sem `remoteJidAlt` num `@lid` a mensagem é **descartada** (fail-closed). Não há como
 * derivar o telefone: o mapa LID→telefone não vem no payload, e a tabela `Contact` da
 * EvolutionAPI só relaciona os dois por `pushName` (nome de exibição escolhido pelo
 * próprio remetente) — casar por ali seria deixar um terceiro escolher em nome de quem
 * fala. Ver a ressalva registrada no relatório de QA.
 */
export function resolveSenderPhone(key: WhatsappSenderKey): string | null {
  if (typeof key.remoteJid !== 'string') return null;
  // Contexto de grupo — vale para os dois caminhos abaixo.
  if (typeof key.participant === 'string' && key.participant.trim().length > 0) return null;

  const jid = key.remoteJid.trim().toLowerCase();
  if (jid.endsWith(INDIVIDUAL_SUFFIX)) return normalizeWhatsappJid(key.remoteJid);
  if (jid.endsWith(LID_SUFFIX)) {
    return typeof key.remoteJidAlt === 'string' ? normalizeWhatsappJid(key.remoteJidAlt) : null;
  }
  return null;
}
