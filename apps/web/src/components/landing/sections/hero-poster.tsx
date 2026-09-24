import Image, { getImageProps } from 'next/image';

import styles from './hero-media.module.css';

const MOBILE_MEDIA = '(max-width: 767.98px)';

type HeroPosterProps = {
  desktop: string;
  /** Pôster próprio do corte mobile, quando existir; sem ele, o mobile usa o desktop. */
  mobile?: string | null;
};

/**
 * Pôster do Hero: primeira pintura e candidato a LCP (`fetchPriority="high"`). Fica
 * sob o vídeo e é o que o visitante vê antes do filme tocar, se o autoplay falhar, com
 * movimento reduzido ou em economia de dados. Decorativo (`alt=""`).
 */
export function HeroPoster({ desktop, mobile }: HeroPosterProps) {
  const common = {
    alt: '',
    fill: true,
    sizes: '100vw',
    // Primeira imagem da página: nunca lazy (o padrão do next/image) — é o LCP provável.
    loading: 'eager' as const,
    fetchPriority: 'high' as const,
    className: styles.poster,
  };

  if (!mobile || mobile === desktop) {
    return <Image {...common} src={desktop} />;
  }

  const {
    props: { srcSet: mobileSrcSet },
  } = getImageProps({ ...common, src: mobile });
  const { props } = getImageProps({ ...common, src: desktop });
  return (
    <picture>
      <source media={MOBILE_MEDIA} srcSet={mobileSrcSet} />
      <img {...props} />
    </picture>
  );
}
