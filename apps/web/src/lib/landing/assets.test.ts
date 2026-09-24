/** Registro de mídia: ausência de asset nunca quebra; versões cruzam fallback. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  hasHeroVideo,
  heroPoster,
  heroVideoSources,
  movivoAssets,
  type HeroMediaAssets,
} from './assets';

const EMPTY: HeroMediaAssets = {
  desktopVideoWebm: null,
  desktopVideoMp4: null,
  mobileVideoWebm: null,
  mobileVideoMp4: null,
  desktopPoster: null,
  mobilePoster: null,
};

function registeredPaths(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') return Object.values(value).flatMap(registeredPaths);
  return [];
}

describe('registro de assets', () => {
  it('todo caminho registrado existe em public/ (nada aponta para 404)', () => {
    const paths = registeredPaths(movivoAssets);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(existsSync(join(process.cwd(), 'public', path)), path).toBe(true);
    }
  });

  it('o filme do Hero é o mesmo no mobile até existir um corte próprio', () => {
    expect(hasHeroVideo(movivoAssets.hero)).toBe(true);
    expect(heroVideoSources(movivoAssets.hero, true)).toEqual(
      heroVideoSources(movivoAssets.hero, false),
    );
    expect(heroPoster(movivoAssets.hero, true)).toBe(movivoAssets.hero.desktopPoster);
  });

  it('sem vídeo não há fontes nem pôster', () => {
    expect(hasHeroVideo(EMPTY)).toBe(false);
    expect(heroVideoSources(EMPTY, true)).toEqual([]);
    expect(heroPoster(EMPTY, false)).toBeNull();
  });

  it('ordena WebM antes de MP4 e usa a versão da tela', () => {
    const hero = {
      ...EMPTY,
      desktopVideoWebm: '/d.webm',
      desktopVideoMp4: '/d.mp4',
      mobileVideoMp4: '/m.mp4',
    };
    expect(hasHeroVideo(hero)).toBe(true);
    expect(heroVideoSources(hero, false)).toEqual([
      { src: '/d.webm', type: 'video/webm' },
      { src: '/d.mp4', type: 'video/mp4' },
    ]);
    // Mobile sem WebM próprio cai para o WebM do desktop, mas usa o MP4 mobile.
    expect(heroVideoSources(hero, true)).toEqual([
      { src: '/d.webm', type: 'video/webm' },
      { src: '/m.mp4', type: 'video/mp4' },
    ]);
  });

  it('pôster cruza entre desktop e mobile quando só um existe', () => {
    expect(heroPoster({ ...EMPTY, desktopPoster: '/d.avif' }, true)).toBe('/d.avif');
    expect(heroPoster({ ...EMPTY, mobilePoster: '/m.avif' }, false)).toBe('/m.avif');
  });
});
