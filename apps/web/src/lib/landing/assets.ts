/**
 * Registro central de mídia da landing — a ÚNICA fonte de caminhos de asset.
 *
 * `null` = asset ainda não produzido. Cada componente consulta este registro e, na
 * ausência, renderiza o fallback visual premium do `MediaSlot` (nunca caixa vazia,
 * nunca "placeholder"). Para ativar um asset: coloque o arquivo em `public/` no caminho
 * listado em `ASSET_MANIFEST.md` e troque o `null` pelo caminho público (ex.:
 * `'/assets/movivo/video/hero-desktop.webm'`). Nenhum componente precisa mudar.
 */
export type AssetPath = string | null;

export interface HeroMediaAssets {
  desktopVideoWebm: AssetPath;
  desktopVideoMp4: AssetPath;
  mobileVideoWebm: AssetPath;
  mobileVideoMp4: AssetPath;
  desktopPoster: AssetPath;
  mobilePoster: AssetPath;
}

export interface MovivoAssets {
  hero: HeroMediaAssets;
  people: { leonardo: AssetPath };
  product: { workoutShareCard: AssetPath };
  dayWithMovivo: {
    morning: AssetPath;
    midday: AssetPath;
    preWorkout: AssetPath;
    workout: AssetPath;
    recovery: AssetPath;
  };
  og: { image: AssetPath };
}

export const movivoAssets: MovivoAssets = {
  hero: {
    // Filme final do Hero (13s, 1280×720, 24fps, H.264, sem áudio), remux faststart.
    desktopVideoWebm: null, // /assets/movivo/video/hero-desktop.webm
    desktopVideoMp4: '/assets/movivo/video/cena-hero.mp4',
    // Sem corte mobile próprio ainda: o mobile usa o mesmo filme (fallback do registro).
    mobileVideoWebm: null, // /assets/movivo/video/hero-mobile.webm
    mobileVideoMp4: null, // /assets/movivo/video/hero-mobile.mp4
    // Quadro 0 do filme: a troca pôster → vídeo é imperceptível.
    desktopPoster: '/assets/movivo/posters/hero-poster.webp',
    mobilePoster: null, // /assets/movivo/posters/hero-mobile.webp
  },
  people: {
    // Mesma foto usada no dashboard (next/image entrega em WebP/AVIF no tamanho certo).
    leonardo: '/professional/leonardo-rodrigues.png',
  },
  product: {
    workoutShareCard: null, // /assets/movivo/product/workout-share-card.webp
  },
  dayWithMovivo: {
    morning: null, // /assets/movivo/day/morning.webp
    midday: null, // /assets/movivo/day/midday.webp
    preWorkout: null, // /assets/movivo/day/pre-workout.webp
    workout: null, // /assets/movivo/day/workout.webp
    recovery: null, // /assets/movivo/day/recovery.webp
  },
  og: {
    image: null, // /assets/movivo/og/movivo-og.jpg (1200×630)
  },
};

/** Algum vídeo do hero existe? Sem vídeo, o hero usa só pôster/fallback. */
export function hasHeroVideo(hero: HeroMediaAssets): boolean {
  return Boolean(
    hero.desktopVideoWebm || hero.desktopVideoMp4 || hero.mobileVideoWebm || hero.mobileVideoMp4,
  );
}

export interface VideoSource {
  src: string;
  type: 'video/webm' | 'video/mp4';
}

/**
 * Fontes de vídeo por formato de tela, WebM primeiro. Mobile cai para o desktop (e
 * vice-versa) quando só uma das versões existir — o layout nunca depende das duas.
 */
export function heroVideoSources(hero: HeroMediaAssets, mobile: boolean): VideoSource[] {
  const [webm, mp4] = mobile
    ? [hero.mobileVideoWebm ?? hero.desktopVideoWebm, hero.mobileVideoMp4 ?? hero.desktopVideoMp4]
    : [hero.desktopVideoWebm ?? hero.mobileVideoWebm, hero.desktopVideoMp4 ?? hero.mobileVideoMp4];
  const sources: VideoSource[] = [];
  if (webm) sources.push({ src: webm, type: 'video/webm' });
  if (mp4) sources.push({ src: mp4, type: 'video/mp4' });
  return sources;
}

/** Pôster por formato de tela, com o mesmo fallback cruzado dos vídeos. */
export function heroPoster(hero: HeroMediaAssets, mobile: boolean): AssetPath {
  return mobile
    ? (hero.mobilePoster ?? hero.desktopPoster)
    : (hero.desktopPoster ?? hero.mobilePoster);
}
