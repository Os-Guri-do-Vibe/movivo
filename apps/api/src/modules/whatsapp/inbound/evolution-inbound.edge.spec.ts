/**
 * Unit — `EvolutionInboundEdge` (US-3.1-EVO).
 *
 * Cobre autenticação (token) e todos os motivos de descarte que separam "mensagem de aluno"
 * de "qualquer outra coisa que o Baileys emite" — inclusive os três de isolamento entre
 * titulares: eco `fromMe`, contexto de grupo e instância divergente.
 */
import { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';

import type { AppConfigService } from '../../../core/config';
import { EVOLUTION_WEBHOOK_TOKEN_HEADER, EvolutionInboundEdge } from './evolution-inbound.edge';
import type { RawDelivery } from './inbound-message';

const TOKEN = 'a'.repeat(43);
const INSTANCE = 'movivo-teste';
const JID = '5541999998888@s.whatsapp.net';

function makeEdge(
  opts: { token?: string | undefined; instanceName?: string | null } = {},
): EvolutionInboundEdge {
  const config = {
    get evolution() {
      return { webhookToken: 'token' in opts ? opts.token : TOKEN };
    },
  } as unknown as AppConfigService;
  const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() } as unknown as PinoLogger;
  const instanceName = opts.instanceName === undefined ? INSTANCE : opts.instanceName;
  return new EvolutionInboundEdge(config, () => instanceName, logger);
}

function delivery(token: string | undefined): RawDelivery {
  return {
    rawBody: undefined,
    headers: token === undefined ? {} : { [EVOLUTION_WEBHOOK_TOKEN_HEADER]: token },
    body: {},
    correlationId: 'c1',
  };
}

/** Envelope real da EvolutionAPI (inclui o `apikey` que ela vaza no corpo). */
function upsert(over: { key?: object; message?: object; timestamp?: number } = {}) {
  return {
    event: 'messages.upsert',
    instance: INSTANCE,
    apikey: 'chave-da-instancia-que-a-evolution-vaza-no-corpo',
    sender: '5511999999999@s.whatsapp.net',
    server_url: 'http://localhost:8081',
    date_time: '2026-08-24T12:00:00.000Z',
    data: {
      key: { remoteJid: JID, fromMe: false, id: 'WA-MSG-1', ...over.key },
      pushName: 'Aluno',
      message: over.message ?? { conversation: 'oi movi' },
      messageType: 'conversation',
      messageTimestamp: over.timestamp ?? Math.floor(Date.now() / 1000),
    },
  };
}

describe('EvolutionInboundEdge.verify', () => {
  it('token correto → ok', () => {
    expect(makeEdge().verify(delivery(TOKEN))).toEqual({ ok: true });
  });

  it('token errado → bad_token', () => {
    expect(makeEdge().verify(delivery('b'.repeat(43)))).toEqual({ ok: false, reason: 'bad_token' });
  });

  it('token ausente → bad_token', () => {
    expect(makeEdge().verify(delivery(undefined))).toEqual({ ok: false, reason: 'bad_token' });
  });

  it('fail-closed: sem EVOLUTION_WEBHOOK_TOKEN configurado → no_secret', () => {
    expect(makeEdge({ token: undefined }).verify(delivery(TOKEN))).toEqual({
      ok: false,
      reason: 'no_secret',
    });
  });
});

describe('EvolutionInboundEdge.normalize', () => {
  it('messages.upsert de texto → uma mensagem normalizada', () => {
    expect(makeEdge().normalize(upsert())).toEqual([
      { messageId: 'WA-MSG-1', from: '+5541999998888', text: 'oi movi' },
    ]);
  });

  it('aceita extendedTextMessage (resposta citando outra mensagem)', () => {
    const out = makeEdge().normalize(
      upsert({ message: { extendedTextMessage: { text: 'e o agachamento?' } } }),
    );
    expect(out).toEqual([
      { messageId: 'WA-MSG-1', from: '+5541999998888', text: 'e o agachamento?' },
    ]);
  });

  it('toque em botão vira buttonId + texto do rótulo', () => {
    const out = makeEdge().normalize(
      upsert({
        message: {
          buttonsResponseMessage: { selectedButtonId: 'fb_up', selectedDisplayText: '👍 Ajudou' },
        },
      }),
    );
    expect(out).toEqual([
      { messageId: 'WA-MSG-1', from: '+5541999998888', text: '👍 Ajudou', buttonId: 'fb_up' },
    ]);
  });

  it('lista (listResponseMessage) também vira buttonId', () => {
    const out = makeEdge().normalize(
      upsert({
        message: {
          listResponseMessage: { title: 'Treino A', singleSelectReply: { selectedRowId: 'w_a' } },
        },
      }),
    );
    expect(out?.[0]?.buttonId).toBe('w_a');
  });

  it('evento diferente de messages.upsert → descarte legítimo ([])', () => {
    expect(makeEdge().normalize({ ...upsert(), event: 'connection.update' })).toEqual([]);
    expect(makeEdge().normalize({ ...upsert(), event: 'presence.update' })).toEqual([]);
  });

  it('ISOLAMENTO — instância divergente → descarte, nunca processa', () => {
    expect(makeEdge().normalize({ ...upsert(), instance: 'outra-conta' })).toEqual([]);
  });

  it('ISOLAMENTO — instância ainda desconhecida no processo → descarte fail-closed', () => {
    expect(makeEdge({ instanceName: null }).normalize(upsert())).toEqual([]);
  });

  it('ISOLAMENTO — eco da própria MOVIVO (fromMe) → descarte', () => {
    expect(makeEdge().normalize(upsert({ key: { fromMe: true } }))).toEqual([]);
  });

  it('ISOLAMENTO — mensagem de grupo (participant presente) → descarte', () => {
    expect(
      makeEdge().normalize(upsert({ key: { participant: '5511777776666@s.whatsapp.net' } })),
    ).toEqual([]);
  });

  it('ISOLAMENTO — remoteJid de grupo → descarte', () => {
    expect(makeEdge().normalize(upsert({ key: { remoteJid: '12036300000@g.us' } }))).toEqual([]);
  });

  it('backlog antigo (>12h) → descarte stale_backlog', () => {
    const thirteenHoursAgo = Math.floor(Date.now() / 1000) - 13 * 3600;
    expect(makeEdge().normalize(upsert({ timestamp: thirteenHoursAgo }))).toEqual([]);
  });

  it('mensagem de 11h atrás ainda é processada', () => {
    const elevenHoursAgo = Math.floor(Date.now() / 1000) - 11 * 3600;
    expect(makeEdge().normalize(upsert({ timestamp: elevenHoursAgo }))).toHaveLength(1);
  });

  it('tipo não suportado (imagem/áudio/sticker/reaction) → descarte, nunca alimenta o LLM', () => {
    for (const message of [
      { imageMessage: { caption: 'olha meu treino' } },
      { audioMessage: { seconds: 12 } },
      { stickerMessage: {} },
      { reactionMessage: { text: '👍' } },
      { protocolMessage: { type: 'REVOKE' } },
    ]) {
      expect(makeEdge().normalize(upsert({ message }))).toEqual([]);
    }
  });

  it('envelope fora do contrato → null (rejeição, categoria diferente de descarte)', () => {
    expect(makeEdge().normalize({ instance: INSTANCE })).toBeNull();
    expect(makeEdge().normalize('não é json de objeto')).toBeNull();
    expect(makeEdge().normalize({ ...upsert(), data: { key: { remoteJid: JID } } })).toBeNull();
  });

  it('normaliza NFC, remove caractere de controle e corta em 4096', () => {
    // 'a' + U+0303 (combining tilde) deve virar o 'ã' composto (NFC); o U+0007 (BEL) some.
    const raw = `  sensa\u0061\u0303o\u0007 boa  ${'x'.repeat(5000)}`;
    const out = makeEdge().normalize(upsert({ message: { conversation: raw } }));
    const text = out?.[0]?.text ?? '';
    expect(text.startsWith('sensa\u00e7\u00e3o boa')).toBe(false); // não inventa cedilha
    expect(text.startsWith('sensa\u00e3o boa')).toBe(true);
    expect(text).not.toContain('\u0007');
    expect(text).not.toContain('\u0061\u0303');
    expect(text.length).toBe(4096);
  });
});
