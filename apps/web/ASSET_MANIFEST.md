# MOVIVO — Manifesto de assets da landing

Fonte da verdade dos caminhos: `src/lib/landing/assets.ts` (`movivoAssets`). Um asset
**pendente** é `null` no registro: a landing renderiza um fallback premium (composição
CSS/SVG da marca) e o layout não muda quando o arquivo chega — só troque o `null` pelo
caminho público.

Legenda de status: **PENDENTE** (ainda não produzido) · **ATIVO** (em uso) · **LEGADO**
(existe em `public/`, mas não é usado pela landing nova).

## Mídia

| Asset                           | Status       | Caminho esperado (em `public/`)                  | Formato recomendado                                                       | Dimensões / proporção                      | Uso                                                                                                   |
| ------------------------------- | ------------ | ------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Filme do Hero (`cena-hero.mp4`) | **ATIVO**    | `/assets/movivo/video/cena-hero.mp4`             | MP4 H.264, sem áudio, 24 fps, remux faststart (sem recompressão)          | 16:9, 1280×720, 13 s, ~12,4 MB (~7,5 Mbps) | Fundo do Hero em todas as larguras (o mobile usa o mesmo filme)                                       |
| Filme do Hero — WebM            | **PENDENTE** | `/assets/movivo/video/hero-desktop.webm`         | WebM VP9/AV1, sem áudio                                                   | 16:9, mesma duração/corte                  | Fonte preferencial quando existir (entra antes do MP4 no `<video>`)                                   |
| Filme do Hero — corte mobile    | **PENDENTE** | `/assets/movivo/video/hero-mobile.{webm,mp4}`    | WebM + MP4 H.264 faststart, sem áudio                                     | 9:16 ou 4:5, ≤ ~2–2,5 MB                   | Opcional: substitui o 16:9 abaixo de 768px sem mudar o componente                                     |
| Pôster do Hero                  | **ATIVO**    | `/assets/movivo/posters/hero-poster.webp`        | WebP q88 (fonte do `next/image`, que entrega WebP q75 por largura)        | 1280×720, 88 KB — quadro 0 do filme        | Primeira pintura/LCP, antes do vídeo tocar, autoplay bloqueado, movimento reduzido, economia de dados |
| Pôster do Hero — mobile         | **PENDENTE** | `/assets/movivo/posters/hero-mobile.webp`        | WebP                                                                      | Mesma proporção do corte mobile            | Opcional: art direction automática no `HeroPoster`                                                    |
| Retrato do Leonardo             | **ATIVO**    | `/professional/leonardo-rodrigues.png`           | PNG 1087×1447 (1,8 MB; o next/image entrega WebP/AVIF no tamanho do card) | 3:4 (card recorta em 4:5)                  | Card do Responsável Técnico (seção IA + humano). A mesma foto do dashboard.                           |
| Workout Share Card              | **PENDENTE** | `/assets/movivo/product/workout-share-card.webp` | WebP                                                                      | 9:16 (Story, 1080×1920)                    | Reservado no registro para uma vitrine futura do card                                                 |
| Um dia — manhã                  | **PENDENTE** | `/assets/movivo/day/morning.webp`                | WebP                                                                      | 4:3, mínimo 1600×1200                      | A Day with MOVIVO · 07:08                                                                             |
| Um dia — meio do dia            | **PENDENTE** | `/assets/movivo/day/midday.webp`                 | WebP                                                                      | 4:3                                        | A Day with MOVIVO · 12:42                                                                             |
| Um dia — pré-treino             | **PENDENTE** | `/assets/movivo/day/pre-workout.webp`            | WebP                                                                      | 4:3                                        | A Day with MOVIVO · 18:24                                                                             |
| Um dia — treino                 | **PENDENTE** | `/assets/movivo/day/workout.webp`                | WebP                                                                      | 4:3                                        | A Day with MOVIVO · 19:31                                                                             |
| Um dia — recuperação            | **PENDENTE** | `/assets/movivo/day/recovery.webp`               | WebP                                                                      | 4:3                                        | A Day with MOVIVO · 22:14                                                                             |
| Imagem Open Graph               | **PENDENTE** | `/assets/movivo/og/movivo-og.jpg`                | JPG (ou PNG)                                                              | 1200×630                                   | Compartilhamento (WhatsApp, redes). Hoje o OG não tem imagem.                                         |
| Logo horizontal                 | **ATIVO**    | `/brand/movivo-logo-horizontal.svg`              | SVG                                                                       | 1000×260                                   | Vetores reusados inline em `ui/movivo-logo.tsx` (lettering em `currentColor`) e no JSON-LD            |
| Símbolo MOVIVO                  | **ATIVO**    | `/brand/movivo-symbol.svg`                       | SVG                                                                       | 340×260                                    | Mesmo vetor amostrado pela constelação do MOVIVO CLUB                                                 |
| Silhueta do hero antigo         | **LEGADO**   | `/hero/hero-atleta.png`                          | PNG 1733×2600 (1,7 MB)                                                    | —                                          | Não usado (estética fora da direção nova). Pode ser removido.                                         |

### Direção dos assets pendentes (resumo do briefing)

Cinematográfico, editorial, movimento real, arquitetura contemporânea brasileira
(modernismo/brutalismo, concreto, pedra, vidro, vegetação tropical controlada, luz
natural). Nada de clichês turísticos, cidades genéricas ou estética bodybuilder. Mulher
adulta jovem, athleticwear quiet luxury em tons escuros/petróleo com detalhes Verde
Pulso discretos, sem logos de terceiros. O rosto nunca é a única leitura da composição.

As 4 máscaras do Hero garantem a legibilidade da copy em qualquer quadro. Não aplique
filtro verde pesado no vídeo: a identidade vem das máscaras, do Pulse e do CTA.

### Filme do Hero — como foi preparado e como otimizar

- Origem: `cena-hero.mp4` (raiz do repositório) — movido para `public/assets/movivo/video/`.
- O arquivo original tinha o átomo `moov` no fim (o navegador precisava buscar o final
  antes de tocar). Foi feito um **remux sem perdas** (AVFoundation, passthrough, "optimize
  for network use"): mesmas amostras de vídeo, `moov` no início. Seis quadros comparados
  byte a byte entre original e remux: idênticos.
- Não houve recompressão: não havia `ffmpeg` no ambiente. Com `ffmpeg` instalado, as
  versões recomendadas (sem perda visível perceptível) seriam:

  ```bash
  # WebM VP9 (fonte preferencial; Chrome/Firefox/Android/Safari 17.4+)
  ffmpeg -i cena-hero.mp4 -an -c:v libvpx-vp9 -b:v 0 -crf 32 -row-mt 1 -deadline good \
    -cpu-used 2 public/assets/movivo/video/hero-desktop.webm
  # MP4 H.264 mais leve, faststart
  ffmpeg -i cena-hero.mp4 -an -c:v libx264 -preset slow -crf 22 -profile:v high \
    -pix_fmt yuv420p -movflags +faststart cena-hero-optimized.mp4
  ```

  Compare quadro a quadro antes de trocar no registro (`desktopVideoWebm` /
  `desktopVideoMp4`).

## Fontes

| Família         | Status    | Arquivos                                                      | Licença / origem                                                                                     |
| --------------- | --------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Cabinet Grotesk | **ATIVO** | `src/components/landing/fonts/CabinetGrotesk-{700,800}.woff2` | Indian Type Foundry via Fontshare — ITF Free Font License (uso comercial permitido). Auto-hospedada. |
| Satoshi         | **ATIVO** | `src/components/landing/fonts/Satoshi-{400,500,700}.woff2`    | Indian Type Foundry via Fontshare — ITF Free Font License. Auto-hospedada.                           |
| Quicksand 700   | **ATIVO** | via `next/font/google` (auto-hospedada no build)              | SIL Open Font License                                                                                |

- Cabinet Grotesk 500 foi baixada, mas nenhuma regra da landing usa esse peso; ficou de
  fora para não pré-carregar ~20 KB sem uso. Para usar, baixe o WOFF2 do Fontshare e
  inclua em `src/components/landing/fonts.ts`.
- A licença ITF FFL permite uso comercial, mas não permite redistribuir as fontes como
  produto. Se o repositório algum dia ficar público, confirme com o jurídico se manter
  os WOFF2 versionados é aceitável ou se eles devem sair do Git.
