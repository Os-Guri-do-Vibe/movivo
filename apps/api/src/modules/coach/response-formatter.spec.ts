import { describe, expect, it } from 'vitest';

import { applyResponseFormatting, truncateAtBoundary } from './response-formatter';

describe('applyResponseFormatting', () => {
  it('aplica o teto total de cinco itens em toda a mensagem', () => {
    const text = ['- um', '- dois', '- três', '', '- quatro', '- cinco', '- seis'].join('\n');
    const formatted = applyResponseFormatting(text, {
      blockSize: 'LIVRE',
      allowLists: true,
      boldPolicy: 'NENHUM',
    });
    expect(formatted.match(/^- /gmu)).toHaveLength(5);
    expect(formatted).not.toContain('seis');
  });

  it('remove estrutura proibida e respeita a política de destaque do WhatsApp', () => {
    const formatted = applyResponseFormatting(
      '# Título\n**primeiro** e **segundo**\n```\ncódigo\n```',
      { blockSize: 'LIVRE', allowLists: false, boldPolicy: 'UMA_PALAVRA' },
    );
    expect(formatted).not.toContain('#');
    expect(formatted).not.toContain('```');
    expect(formatted).toContain('*primeiro*');
    expect(formatted).toContain('segundo');
    expect(formatted).not.toContain('*segundo*');
  });

  it('limita parágrafos de forma determinística', () => {
    expect(
      applyResponseFormatting('primeiro\n\nsegundo\n\nterceiro', {
        blockSize: 'MEDIO',
        allowLists: false,
        boldPolicy: 'NENHUM',
      }),
    ).toBe('primeiro\n\nsegundo');
  });

  // Achado 2026-09-02 (correção do fundador — "NUNCA DEVE SER USADO"): a instrução no
  // prompt (`buildFormattingBlock`) pede pro modelo nunca usar travessão, mas prompt sozinho
  // nunca é teto neste sistema — isto é a rede de segurança determinística.
  describe('travessão (—) — rede de segurança determinística', () => {
    const fmt = { blockSize: 'LIVRE', allowLists: false, boldPolicy: 'NENHUM' } as const;

    it('travessão no meio da frase vira vírgula', () => {
      expect(
        applyResponseFormatting('A barra dá mais carga — o halter dá mais amplitude.', fmt),
      ).toBe('A barra dá mais carga, o halter dá mais amplitude.');
    });

    it('travessão colado (sem espaço) também é normalizado', () => {
      expect(applyResponseFormatting('carga—amplitude', fmt)).toBe('carga, amplitude');
    });

    it('travessão logo antes de pontuação não vira ", ."', () => {
      expect(applyResponseFormatting('Isso é o que importa —.', fmt)).toBe('Isso é o que importa.');
    });

    it('travessão no início da frase não vira ", Texto"', () => {
      expect(applyResponseFormatting('— assim que você treina, evolui.', fmt)).toBe(
        'assim que você treina, evolui.',
      );
    });

    it('múltiplos travessões na mesma mensagem são todos normalizados', () => {
      expect(applyResponseFormatting('Um — dois — três.', fmt)).toBe('Um, dois, três.');
    });
  });
});

describe('truncateAtBoundary', () => {
  it('não corta no meio de palavra', () => {
    const result = truncateAtBoundary('uma resposta longa demais para o limite', 20);
    expect(result).toBe('uma resposta longa…');
  });
});
