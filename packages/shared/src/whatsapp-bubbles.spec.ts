import { describe, expect, it } from 'vitest';

import { splitWhatsappBubbles, WHATSAPP_BUBBLE_SEPARATOR } from './whatsapp-bubbles';

describe('splitWhatsappBubbles', () => {
  it('um trecho por balão, na ordem', () => {
    expect(
      splitWhatsappBubbles(
        `oi${WHATSAPP_BUBBLE_SEPARATOR}tudo bem?${WHATSAPP_BUBBLE_SEPARATOR}bora`,
      ),
    ).toEqual(['oi', 'tudo bem?', 'bora']);
  });

  it('texto sem separador é um balão só; trechos vazios não viram balão', () => {
    expect(splitWhatsappBubbles('linha 1\nlinha 2')).toEqual(['linha 1\nlinha 2']);
    expect(
      splitWhatsappBubbles(`a${WHATSAPP_BUBBLE_SEPARATOR}  ${WHATSAPP_BUBBLE_SEPARATOR}b`),
    ).toEqual(['a', 'b']);
    expect(splitWhatsappBubbles('')).toEqual([]);
  });
});
