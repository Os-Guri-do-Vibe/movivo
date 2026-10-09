import { Resvg } from '@resvg/resvg-js';
import { describe, expect, it } from 'vitest';

import { SHARE_CARD_FONT_FAMILY, SHARE_CARD_FONT_FILES } from './share-card.assets';
import { ShareCardRenderer } from './share-card-renderer.service';
import { loadShareCardAssets } from './share-card.assets';
import { SHARE_CARD_TEXT_WIDTH, buildShareCardSvg } from './share-card.svg';

const PEITO = {
  gender: 'male',
  groups: ['chest', 'triceps', 'shoulders'],
  durationSeconds: 5_423,
} as const;

function decode(png: Buffer) {
  const image = new Resvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><image href="data:image/png;base64,${png.toString('base64')}" width="1080" height="1920"/></svg>`,
  ).render();
  return image;
}

describe('ShareCardRenderer', () => {
  it('gera PNG 1080×1920 com fundo transparente e conteúdo desenhado', async () => {
    const { png } = await new ShareCardRenderer().render(PEITO);
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, 1920]);
    expect(png.length).toBeGreaterThan(50_000);
    const { pixels, width } = decode(png);
    const alpha = (x: number, y: number) => pixels[(y * width + x) * 4 + 3];
    // Mesmos pontos do E2E: o topo e o miolo do card ficam transparentes.
    expect([alpha(540, 100), alpha(1000, 100), alpha(540, 500)]).toEqual([0, 0, 0]);
    // Logo MOVIVO (572..1024 × 1184..1301): milhares de pixels opacos se foi desenhado.
    let opaque = 0;
    for (let y = 1184; y < 1301; y += 1) {
      for (let x = 572; x < 1024; x += 1) if ((alpha(x, y) ?? 0) > 0) opaque += 1;
    }
    expect(opaque).toBeGreaterThan(3000);
  });

  it('desenha o corpo em ambos os gêneros e destaca só os músculos treinados', async () => {
    const renderer = new ShareCardRenderer();
    const chest = await renderer.render(PEITO);
    const legs = await renderer.render({ ...PEITO, groups: ['quads', 'calves'] });
    const woman = await renderer.render({ ...PEITO, gender: 'female' });
    expect(chest.png.equals(legs.png)).toBe(false);
    expect(chest.png.equals(woman.png)).toBe(false);
    // Sem músculo algum (grupo desconhecido ao mapa) o corpo continua sendo desenhado.
    const none = await renderer.render({ ...PEITO, groups: [] });
    expect(none.png.length).toBeGreaterThan(50_000);
  });

  it('é determinístico e endereçado pelo conteúdo, não pela ordem dos grupos', async () => {
    const renderer = new ShareCardRenderer();
    const a = await renderer.render(PEITO);
    const b = await renderer.render({
      ...PEITO,
      groups: ['shoulders', 'chest', 'triceps', 'chest'],
    });
    expect(b).toBe(a);
    const fresh = await new ShareCardRenderer().render(PEITO);
    expect(fresh.etag).toBe(a.etag);
    expect(fresh.png.equals(a.png)).toBe(true);
  });

  it('pedidos simultâneos da mesma chave disparam um único desenho', async () => {
    const renderer = new ShareCardRenderer();
    const results = await Promise.all(Array.from({ length: 25 }, () => renderer.render(PEITO)));
    expect(new Set(results).size).toBe(1);
  });

  it('rajada de combinações distintas termina sem erro', async () => {
    const renderer = new ShareCardRenderer();
    const groups = ['chest', 'abs', 'lats', 'quads', 'glutes', 'biceps'] as const;
    const out = await Promise.all(
      groups.flatMap((group) =>
        [1_800, 2_700, 3_600].map((durationSeconds) =>
          renderer.render({ gender: 'female', groups: [group], durationSeconds }),
        ),
      ),
    );
    expect(out).toHaveLength(18);
    expect(new Set(out.map((image) => image.etag)).size).toBe(18);
  });
});

describe('medidas de texto do card', () => {
  const measure = (text: string, size: number, weight: number, spacing: number) =>
    new Resvg(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="200"><text x="0" y="100" font-size="${size}" font-weight="${weight}" letter-spacing="${spacing}">${text}</text></svg>`,
      {
        font: {
          fontFiles: SHARE_CARD_FONT_FILES,
          loadSystemFonts: false,
          defaultFontFamily: SHARE_CARD_FONT_FAMILY,
        },
      },
    ).getBBox()?.width ?? 0;

  it('as larguras fixas usadas para centralizar ícone+texto batem com a fonte empacotada', () => {
    // +2 px: o CSS original também contava o espaçamento final da última letra.
    expect(measure('TREINO CONCLUÍDO', 23, 700, 2) + 2).toBeCloseTo(
      SHARE_CARD_TEXT_WIDTH.badge,
      -1,
    );
    expect(measure('MÚSCULOS TRABALHADOS', 17, 400, 2) + 2).toBeCloseTo(
      SHARE_CARD_TEXT_WIDTH.legend,
      -1,
    );
  });
});

describe('texto do card (guardrails de linguagem)', () => {
  it('só usa a copy aprovada, sem promessa de resultado nem termos proibidos', () => {
    const svg = buildShareCardSvg(loadShareCardAssets(), {
      gender: 'female',
      groups: new Set(['chest']),
      durationLabel: '01:05:09',
    });
    const texts = [...svg.matchAll(/<text[^>]*>(.*?)<\/text>/g)].map((m) =>
      (m[1] ?? '').replace(/<[^>]+>/g, ''),
    );
    expect(texts).toEqual([
      'FRENTE',
      'COSTAS',
      'MÚSCULOS TRABALHADOS',
      'TREINO CONCLUÍDO',
      'Tempo de Treino',
      '01:05:09',
      'MOVE YOUR POTENTIAL.',
      'Siga @movivo.club',
    ]);
    expect(texts.join(' ')).not.toMatch(/diagn[óo]stico|tratamento|cura|garantid/i);
  });

  it('escapa o rótulo de duração (nada de markup vindo de dados)', () => {
    const svg = buildShareCardSvg(loadShareCardAssets(), {
      gender: 'male',
      groups: new Set(),
      durationLabel: '<script>"&',
    });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&#60;script&#62;&#34;&#38;');
  });
});
