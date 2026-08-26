/**
 * Unit — `normalizeWhatsappJid` (US-3.1-EVO / Sato).
 *
 * Esta é a peça de ISOLAMENTO ENTRE TITULARES do lado da EvolutionAPI: o telefone que
 * sai daqui vira, sem nenhum outro filtro, a chave de `resolveUser()` (`eq(users
 * .phoneNumber, phone)`). Um bug aqui não é "parse errado" — é mensagem de um aluno
 * atribuída a outro, ou conversa de terceiro (grupo) entrando no contexto de um titular.
 * Por isso os casos abaixo são cenários de VAZAMENTO, não de formatação.
 */
import { describe, expect, it } from 'vitest';

import { normalizeWhatsappJid, resolveSenderPhone } from './phone-identity';

describe('normalizeWhatsappJid', () => {
  it('aceita um JID individual e devolve E.164', () => {
    expect(normalizeWhatsappJid('5511999998888@s.whatsapp.net')).toBe('+5511999998888');
  });

  it('remove o sufixo de dispositivo (`:12`) antes de validar', () => {
    expect(normalizeWhatsappJid('5511999998888:12@s.whatsapp.net')).toBe('+5511999998888');
  });

  it('VAZAMENTO — rejeita JID de grupo (@g.us): a mensagem é de um TERCEIRO', () => {
    expect(normalizeWhatsappJid('120363000000000000@g.us')).toBeNull();
  });

  it('VAZAMENTO — rejeita `participant` presente mesmo com remoteJid individual', () => {
    // `participant` só existe em contexto de grupo: o remetente real não é o dono do
    // `remoteJid`. Confiar no `remoteJid` aqui atribuiria a fala de A à conta de B.
    expect(
      normalizeWhatsappJid('5511999998888@s.whatsapp.net', '5511777776666@s.whatsapp.net'),
    ).toBeNull();
  });

  it('VAZAMENTO — rejeita @lid (JID de privacidade): não é telefone', () => {
    // O número dentro de um @lid é um identificador opaco do WhatsApp. Tratá-lo como
    // telefone pode casar por acaso com o `phone_number` de OUTRO titular.
    expect(normalizeWhatsappJid('123456789012345@lid')).toBeNull();
  });

  it('VAZAMENTO — rejeita status@broadcast e @newsletter', () => {
    expect(normalizeWhatsappJid('status@broadcast')).toBeNull();
    expect(normalizeWhatsappJid('120363000000000000@newsletter')).toBeNull();
  });

  it('rejeita parte local que não é um telefone plausível', () => {
    expect(normalizeWhatsappJid('@s.whatsapp.net')).toBeNull();
    expect(normalizeWhatsappJid('0551199999@s.whatsapp.net')).toBeNull(); // começa com 0
    expect(normalizeWhatsappJid('55119@s.whatsapp.net')).toBeNull(); // curto demais
    expect(normalizeWhatsappJid('5511999998888888888@s.whatsapp.net')).toBeNull(); // longo demais
    expect(normalizeWhatsappJid('55abc99998888@s.whatsapp.net')).toBeNull();
    expect(normalizeWhatsappJid('5511999998888')).toBeNull(); // sem sufixo nenhum
  });

  it('não tenta nenhuma variante do 9º dígito: casa exato ou é null', () => {
    // Um "conserto" tentador — buscar com e sem o 9 — permitiria que um número
    // escrevesse em nome de outro titular. Proibido por construção.
    expect(normalizeWhatsappJid('551199998888@s.whatsapp.net')).toBe('+551199998888');
    expect(normalizeWhatsappJid('5511999998888@s.whatsapp.net')).toBe('+5511999998888');
  });
});

/**
 * `resolveSenderPhone` — endereçamento LID (achado de QA 2026-08-24).
 *
 * Os payloads reais desta instância chegam quase sempre com `remoteJid` em `@lid` e o
 * telefone em `remoteJidAlt`. Estes casos existem para travar as DUAS regressões possíveis:
 * voltar a ignorar `remoteJidAlt` (a IA para de responder para todo aluno real) e alargar
 * o fallback além do caso individual-LID (fala de terceiro atribuída a um titular).
 */
describe('resolveSenderPhone — endereçamento LID', () => {
  /** Payload REAL entregue a esta instância (telefone de um titular cadastrado). */
  it('REAL — resolve o telefone de `remoteJidAlt` quando o remoteJid é @lid', () => {
    expect(
      resolveSenderPhone({
        remoteJid: '158170878095381@lid',
        remoteJidAlt: '5511975454838@s.whatsapp.net',
        participant: '',
      }),
    ).toBe('+5511975454838');
  });

  it('usa o remoteJid quando ele já é individual, ignorando remoteJidAlt', () => {
    expect(
      resolveSenderPhone({
        remoteJid: '5511999998888@s.whatsapp.net',
        remoteJidAlt: '5511777776666@s.whatsapp.net',
      }),
    ).toBe('+5511999998888');
  });

  it('VAZAMENTO — @lid SEM remoteJidAlt é descartado (nunca usa os dígitos do LID)', () => {
    // Os dígitos do LID são opacos: virariam "+158170878095381" e poderiam casar com o
    // telefone de outro titular. Fail-closed é a única resposta correta.
    expect(resolveSenderPhone({ remoteJid: '158170878095381@lid' })).toBeNull();
  });

  it('VAZAMENTO — grupo com remoteJidAlt preenchido NÃO cai no fallback', () => {
    // O ponto mais perigoso do fallback: em grupo o remoteJid é o GRUPO. Aceitar o
    // remoteJidAlt aqui atribuiria a fala do grupo a um titular individual.
    expect(
      resolveSenderPhone({
        remoteJid: '120363000000000000@g.us',
        remoteJidAlt: '5511999998888@s.whatsapp.net',
      }),
    ).toBeNull();
  });

  it('VAZAMENTO — participant preenchido descarta antes de qualquer fallback', () => {
    expect(
      resolveSenderPhone({
        remoteJid: '158170878095381@lid',
        remoteJidAlt: '5511999998888@s.whatsapp.net',
        participant: '5511777776666@s.whatsapp.net',
      }),
    ).toBeNull();
  });

  it('VAZAMENTO — remoteJidAlt que também é @lid ou grupo não vira telefone', () => {
    expect(
      resolveSenderPhone({ remoteJid: '158170878095381@lid', remoteJidAlt: '999999999999@lid' }),
    ).toBeNull();
    expect(
      resolveSenderPhone({
        remoteJid: '158170878095381@lid',
        remoteJidAlt: '120363000000000000@g.us',
      }),
    ).toBeNull();
  });

  it('REAL — rejeita o remoteJid degenerado `0@s.whatsapp.net` visto em produção local', () => {
    expect(resolveSenderPhone({ remoteJid: '0@s.whatsapp.net' })).toBeNull();
  });

  it('participant vazio ("") é 1:1 legítimo — é o que o Baileys manda de verdade', () => {
    expect(resolveSenderPhone({ remoteJid: '5511999998888@s.whatsapp.net', participant: '' })).toBe(
      '+5511999998888',
    );
  });
});
