import { describe, expect, it } from 'vitest';

import { BUBBLE_SEPARATOR } from '../whatsapp/message-templates';
import { applyResponseFormatting } from './response-formatter';

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

  // Achado 2026-09-08 (bug reproduzido ao vivo pelo fundador): antes, parágrafo além do
  // teto de `blockSize` era DESCARTADO — a IA parava no meio da explicação sem aviso nenhum.
  // Agora vira a bolha seguinte: nada é perdido, só reparticionado entre mensagens.
  it('parágrafo além do teto vira bolha seguinte, nunca é descartado', () => {
    expect(
      applyResponseFormatting('primeiro\n\nsegundo\n\nterceiro', {
        blockSize: 'MEDIO',
        allowLists: false,
        boldPolicy: 'NENHUM',
      }),
    ).toBe(`primeiro\n\nsegundo${BUBBLE_SEPARATOR}terceiro`);
  });

  it('frase maior que o teto de caracteres vira bolha seguinte, sem reticências nem perda', () => {
    const long =
      'Como seu foco é hipertrofia e você treina costas e bíceps juntos, a martelo compensa ' +
      'o desgaste que a puxada e a remada já causam no bíceps, trabalhando o braço de um ' +
      'ângulo diferente e ajudando a evitar platô de força no treino de puxar.';
    const formatted = applyResponseFormatting(long, {
      blockSize: 'CURTO',
      allowLists: false,
      boldPolicy: 'NENHUM',
    });
    // Nada some, nem reticências: junta as bolhas de volta e o texto é IDÊNTICO ao original.
    expect(formatted.split(BUBBLE_SEPARATOR).join(' ')).toBe(long);
    expect(formatted).not.toContain('…');
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
