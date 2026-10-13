import { describe, expect, it } from 'vitest';

import { buildTranscript, gapLabel, stripLinks, type TranscriptRow } from './transcript';

const NOW = new Date('2026-10-13T12:00:00.000Z');
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);

const row = (overrides: Partial<TranscriptRow>): TranscriptRow => ({
  origin: 'STUDENT',
  direction: 'INBOUND',
  modelUsed: null,
  sourceType: null,
  content: 'oi',
  createdAt: ago(1),
  ...overrides,
});

const options = { now: NOW, agentName: 'MOVI', timezone: 'America/Sao_Paulo' };

describe('buildTranscript', () => {
  it('rotula cada autor: Aluno, a agente e o Profissional CREF', () => {
    const { lines } = buildTranscript(
      [
        row({ origin: 'STUDENT', content: 'oi', createdAt: ago(3) }),
        row({ origin: 'COACH', direction: 'OUTBOUND', content: 'Oi!', createdAt: ago(2.5) }),
        row({
          origin: 'PROFESSIONAL',
          direction: 'OUTBOUND',
          content: 'Posso ajustar sim.',
          createdAt: ago(2),
        }),
      ],
      'mensagem atual',
      options,
    );
    expect(lines).toEqual(['Aluno: oi', 'MOVI: Oi!', 'Profissional CREF: Posso ajustar sim.']);
  });

  it('mantém inteira a pergunta automática do Coach, que o aluno pode estar respondendo', () => {
    const { lines } = buildTranscript(
      [
        row({
          origin: 'SYSTEM',
          direction: 'OUTBOUND',
          sourceType: 'CHECKIN_MESSAGE',
          content: 'Hoje era dia de Costas. O que aconteceu?',
        }),
      ],
      'x',
      options,
    );
    expect(lines).toEqual(['MOVI: Hoje era dia de Costas. O que aconteceu?']);
  });

  it('o link do dia mais recente entra falado, datado e sem a URL; os anteriores viram rótulo datado', () => {
    const link = (hoursAgo: number, text: string) =>
      row({
        origin: 'SYSTEM',
        direction: 'OUTBOUND',
        sourceType: 'WORKOUT_DAILY_LINK',
        content: text,
        createdAt: ago(hoursAgo),
      });
    const { lines } = buildTranscript(
      [
        link(
          29,
          'Bom dia, Ana! Seu treino de hoje é Costas: https://movivo.com.br/check-in/aB3xK9pQ',
        ),
        link(
          5,
          'Bom dia, Ana! Seu treino de hoje é Pernas: https://movivo.com.br/check-in/zZ9yX8wV\n\nE ontem, tudo bem? O treino de Costas ficou sem registro.',
        ),
      ],
      'x',
      options,
    );
    expect(lines[0]).toMatch(
      /^\[Aviso automático de segunda-feira \(12\/10\), 04:00: link do treino do dia enviado\]$/,
    );
    expect(lines[1]).toBe('— 24 h depois —');
    expect(lines[2]).toMatch(
      /^\[Mensagem automática de terça-feira \(13\/10\), 04:00\] Bom dia, Ana!/,
    );
    expect(lines[2]).toContain('E ontem, tudo bem? O treino de Costas ficou sem registro.');
    expect(lines.join(' ')).not.toMatch(/https?:|www\.|check-in\//);
  });

  it('link e pergunta chegam em balões separados: a pergunta (o último) é falada, o link vira rótulo', () => {
    const bubble = (minutesAfter: number, text: string) =>
      row({
        origin: 'SYSTEM',
        direction: 'OUTBOUND',
        sourceType: 'WORKOUT_DAILY_LINK',
        content: text,
        createdAt: new Date(ago(5).getTime() + minutesAfter * 1_000),
      });
    const { lines } = buildTranscript(
      [
        bubble(0, 'Bom dia, Ana! Seu treino de hoje é Pernas: https://movivo.com.br/check-in/aB3'),
        bubble(1, 'E ontem, tudo bem? O treino de Costas ficou sem registro.'),
      ],
      'x',
      options,
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(
      /^\[Aviso automático de terça-feira \(13\/10\), 04:00: link do treino/,
    );
    expect(lines[1]).toMatch(/^\[Mensagem automática de terça-feira \(13\/10\), 04:00\] E ontem/);
  });

  it('nunca deixa uma URL passar, nem a forma curta do link de acesso', () => {
    const { lines } = buildTranscript(
      [
        row({
          origin: 'COACH',
          direction: 'OUTBOUND',
          modelUsed: 'm',
          content: 'Veja em https://exemplo.com/x e www.site.com e /check-in/aB3xK9pQ ok',
          createdAt: ago(4),
        }),
      ],
      'x',
      options,
    );
    expect(lines).toEqual(['MOVI: Veja em [link] e [link] e [link] ok']);
  });

  it('outros avisos automáticos viram rótulo de uma linha', () => {
    const { lines } = buildTranscript(
      [
        row({
          origin: 'SYSTEM',
          direction: 'OUTBOUND',
          sourceType: 'PROTOCOL_DELIVERY',
          content: '[Documento: protocolo.pdf]\nSeu treino está pronto',
          createdAt: ago(5),
        }),
        row({
          origin: 'SYSTEM',
          direction: 'OUTBOUND',
          sourceType: 'CONSENT_STATUS',
          content: 'qualquer coisa',
          createdAt: ago(4),
        }),
      ],
      'x',
      options,
    );
    expect(lines).toEqual([
      '[Protocolo de treino enviado em PDF]',
      '[Mensagem automática do sistema]',
    ]);
  });

  it('deriva o autor de linhas antigas, sem coluna origin', () => {
    const { lines } = buildTranscript(
      [
        row({ origin: null, direction: 'INBOUND', content: 'quero trocar', createdAt: ago(3) }),
        row({
          origin: null,
          direction: 'OUTBOUND',
          modelUsed: 'deepseek',
          content: 'claro',
          createdAt: ago(2.9),
        }),
        row({
          origin: null,
          direction: 'OUTBOUND',
          modelUsed: null,
          sourceType: null,
          content: 'aviso qualquer',
          createdAt: ago(2.8),
        }),
      ],
      'x',
      options,
    );
    // Sem `origin` nem `sourceType` não dá para saber se foi aviso ou mensagem do CREF:
    // o texto é mantido (sem links) em vez de arriscar esconder uma fala do profissional.
    expect(lines).toEqual(['Aluno: quero trocar', 'MOVI: claro', 'MOVI: aviso qualquer']);
  });

  it('marca pausas longas entre mensagens e a demora até a mensagem atual', () => {
    const { lines, trailingGap } = buildTranscript(
      [
        row({ origin: 'COACH', direction: 'OUTBOUND', content: 'Como foi?', createdAt: ago(60) }),
        row({ content: 'ótimo', createdAt: ago(40) }),
      ],
      'agora',
      options,
    );
    expect(lines).toEqual(['MOVI: Como foi?', '— 20 h depois —', 'Aluno: ótimo']);
    expect(trailingGap).toBe('40 h');
  });

  it('sem pausa longa, não há marcador', () => {
    const { trailingGap, lines } = buildTranscript(
      [row({ content: 'oi', createdAt: ago(0.5) })],
      'x',
      options,
    );
    expect(trailingGap).toBeNull();
    expect(lines.join('')).not.toContain('depois');
  });

  it('descarta a última linha quando ela é a própria mensagem atual', () => {
    const { lines } = buildTranscript(
      [
        row({ origin: 'COACH', direction: 'OUTBOUND', content: 'Oi', createdAt: ago(1) }),
        row({ content: 'quanto descanso?', createdAt: ago(0) }),
      ],
      'quanto descanso?',
      options,
    );
    expect(lines).toEqual(['MOVI: Oi']);
  });

  it('ordena por data mesmo com as linhas fora de ordem', () => {
    const { lines } = buildTranscript(
      [
        row({ content: 'segunda', createdAt: ago(1) }),
        row({ content: 'primeira', createdAt: ago(2) }),
      ],
      'x',
      options,
    );
    expect(lines).toEqual(['Aluno: primeira', 'Aluno: segunda']);
  });

  it('limita o tamanho: corta cada fala e descarta as mais antigas', () => {
    const big = 'a'.repeat(5_000);
    const rows = Array.from({ length: 12 }, (_, i) =>
      row({ content: big, createdAt: ago(12 - i) }),
    );
    const { lines } = buildTranscript(rows, 'x', options);
    expect(lines.every((line) => line.length <= 710)).toBe(true);
    expect(lines.join('\n').length).toBeLessThanOrEqual(6_000);
    expect(lines.length).toBeLessThan(12);
  });
});

describe('stripLinks e gapLabel', () => {
  it('remove URLs com e sem protocolo e o caminho curto do link de acesso', () => {
    expect(stripLinks('veja https://a.com/x?y=1 e www.b.com ok')).toBe('veja [link] e [link] ok');
    expect(stripLinks('abra /check-in/aB3xK9pQ agora')).toBe('abra [link] agora');
  });

  it('descreve intervalos em horas até 48 h e em dias depois', () => {
    expect(gapLabel(5 * 3_600_000)).toBe('5 h');
    expect(gapLabel(47 * 3_600_000)).toBe('47 h');
    expect(gapLabel(50 * 3_600_000)).toBe('2 dias');
    expect(gapLabel(120 * 3_600_000)).toBe('5 dias');
  });
});
