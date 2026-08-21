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
});

describe('truncateAtBoundary', () => {
  it('não corta no meio de palavra', () => {
    const result = truncateAtBoundary('uma resposta longa demais para o limite', 20);
    expect(result).toBe('uma resposta longa…');
  });
});
