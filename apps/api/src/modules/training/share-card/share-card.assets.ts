import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ShareCardMuscle } from '@movivo/shared';

/** `dist/modules/training/share-card` e `src/...` ficam à mesma distância de `apps/api`. */
const ASSETS_DIR = join(__dirname, '../../../../assets');
const CARD_ASSETS_DIR = join(ASSETS_DIR, 'share-card');

export const SHARE_CARD_FONT_FILES = [
  join(ASSETS_DIR, 'fonts', 'HankenGrotesk-Regular.ttf'),
  join(ASSETS_DIR, 'fonts', 'HankenGrotesk-Bold.ttf'),
];
export const SHARE_CARD_FONT_FAMILY = 'Hanken Grotesk';

export type MuscleMask = { group: ShareCardMuscle; d: string; transform?: string };
export type CardBody = 'male' | 'female';
export type CardView = 'front' | 'back';

export interface ShareCardAssets {
  muscles: Readonly<Record<`${CardBody}-${CardView}`, readonly MuscleMask[]>>;
  /** Ilustração do corpo (PNG, tema escuro) já como data URI: o resvg não toca em disco. */
  bodies: Readonly<Record<`${CardBody}-${CardView}`, string>>;
  /** Logo com o lettering claro (o cartão é sempre sobre foto, com fundo transparente). */
  logo: string;
}

let cached: ShareCardAssets | undefined;

const dataUri = (content: Buffer, mime: string) =>
  `data:${mime};base64,${content.toString('base64')}`;

/** Leitura única: os arquivos são imutáveis na imagem Docker. */
export function loadShareCardAssets(): ShareCardAssets {
  if (cached) return cached;
  const keys = ['male-front', 'male-back', 'female-front', 'female-back'] as const;
  const logo = readFileSync(join(CARD_ASSETS_DIR, 'movivo-logo-horizontal.svg'), 'utf8');
  cached = {
    muscles: JSON.parse(readFileSync(join(CARD_ASSETS_DIR, 'muscles.json'), 'utf8')),
    bodies: Object.fromEntries(
      keys.map((key) => [
        key,
        dataUri(readFileSync(join(CARD_ASSETS_DIR, 'bodies', `${key}-dark.png`)), 'image/png'),
      ]),
    ) as ShareCardAssets['bodies'],
    logo: dataUri(Buffer.from(logo), 'image/svg+xml'),
  };
  return cached;
}
