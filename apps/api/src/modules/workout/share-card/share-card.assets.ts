import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ShareCardMuscle } from '@movivo/shared';

/** `dist/modules/workout/share-card` e `src/...` ficam à mesma distância de `apps/api`. */
const ASSETS_DIR = join(__dirname, '../../../../assets');
const CARD_ASSETS_DIR = join(ASSETS_DIR, 'share-card');

export const SHARE_CARD_FONT_FILES = [
  join(ASSETS_DIR, 'fonts', 'HankenGrotesk-Regular.ttf'),
  join(ASSETS_DIR, 'fonts', 'HankenGrotesk-Bold.ttf'),
];
export const SHARE_CARD_FONT_FAMILY = 'Hanken Grotesk';

export type MuscleMask = { group: ShareCardMuscle; d: string; transform?: string };
export type CardGender = 'male' | 'female';
export type CardView = 'front' | 'back';

export interface ShareCardAssets {
  muscles: Readonly<Record<`${CardGender}-${CardView}`, readonly MuscleMask[]>>;
  /** Ilustração do corpo (PNG, tema dark) já como data URI — o resvg não toca em disco. */
  bodies: Readonly<Record<`${CardGender}-${CardView}`, string>>;
  logo: string;
}

let cached: ShareCardAssets | undefined;

function dataUri(file: string, mime: string): string {
  return `data:${mime};base64,${readFileSync(file).toString('base64')}`;
}

/** Leitura única: os arquivos são imutáveis na imagem Docker. */
export function loadShareCardAssets(): ShareCardAssets {
  if (cached) return cached;
  const keys = ['male-front', 'male-back', 'female-front', 'female-back'] as const;
  cached = {
    muscles: JSON.parse(readFileSync(join(CARD_ASSETS_DIR, 'muscles.json'), 'utf8')),
    bodies: Object.fromEntries(
      keys.map((key) => [
        key,
        dataUri(join(CARD_ASSETS_DIR, 'bodies', `${key}-dark.png`), 'image/png'),
      ]),
    ) as ShareCardAssets['bodies'],
    logo: dataUri(join(CARD_ASSETS_DIR, 'movivo-logo-horizontal.svg'), 'image/svg+xml'),
  };
  return cached;
}
