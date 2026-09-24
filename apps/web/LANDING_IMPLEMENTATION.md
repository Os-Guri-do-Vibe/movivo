# Landing pública MOVIVO — implementação

Rota: `/` (`src/app/page.tsx` → `src/components/landing/landing.tsx`).
Stack: Next.js 16 (App Router, webpack), React 19, CSS Modules, GSAP 3.15 + ScrollTrigger,
Three.js 0.186 (sem R3F), `js-rich-body-highlighter` (o mesmo do Workout Share Card).

Assets e fontes: ver [`ASSET_MANIFEST.md`](./ASSET_MANIFEST.md).

## 1. Arquitetura

```
src/app/page.tsx                  metadata/SEO + <Landing />
src/lib/landing/                  fontes únicas de verdade (sem JSX)
  assets.ts                       registro de mídia (null = pendente)
  pricing.ts                      modelo de exibição dos planos (deriva de @movivo/shared)
  analytics.ts                    IDs de evento + trackLandingEvent (PostHog sob demanda)
  plan-selection.ts               plano escolhido na visita (store sem provider)
  site.ts                         navegação, IDs de seção, Instagram, links legais, Responsável Técnico
src/components/landing/
  landing.tsx                     composição das 12 seções + JSON-LD
  landing.module.css              tokens (cor, tipo, grid, espaço, raio, z-index, curvas)
  fonts.ts                        Cabinet Grotesk + Satoshi (locais) + Quicksand
  layout/                         Preloader, Navbar (+ menu), MobileStickyCta, Footer
  ui/                             PulseLink/TrialCta, MediaSlot, RevealLines, MovivoLogo,
                                  CinematicBackdrop, hooks (magnético, near-viewport, portal)
  motion/                         loadGsap, useGsap, SectionMotion, effects.ts, LandingRuntime
  scenes/                         webgl.ts, SceneCanvas, pulse-scene.ts, club-scene.ts, layouts
  sections/                       um arquivo por seção (+ .module.css)
```

Princípios:

- **Seções são Server Components.** O conteúdo sai no HTML (SEO, leitores de tela, sem
  JS). Só o que precisa de estado vira client component (CTAs, pricing, muscle map,
  palcos WebGL, menu, drawer).
- **Motion anexado por nome.** `<SectionMotion effect="manifesto">` é um client component
  fino que roda o efeito correspondente de `motion/effects.ts` sobre o HTML do servidor.
- **Tokens escopados em `.root`**, nunca em `:root`: painel, onboarding e protocolo
  continuam com o design system "O Pulso" de `globals.css`.
- **Nada no caminho crítico além de HTML + CSS.** GSAP e Three.js são importados
  dinamicamente depois da hidratação / perto da seção.

Ordem narrativa: Hero (MOVE) → Manifesto (BELIEVE) → The MOVIVO System (UNDERSTAND) →
WhatsApp (EXPERIENCE) → How it works (LEARN) → Intelligence + Human (TRUST) → Muscle map
(PERSONALIZE) → Adaptive (ADAPT) → A day with MOVIVO (LIVE) → MOVIVO Club (BELONG) →
Planos (BEGIN) → CTA final (MOVE IT) → rodapé. Esses nomes são internos: as seções não
exibem eyebrow (os rótulos em inglês foram retirados; os títulos abrem direto). A exceção
é IA + humano, com "Inteligência" e "Expertise Humana" identificando as duas metades.

Fora da landing pública por decisão do briefing: prova social, depoimentos, métricas,
"The First 100" e o FAQ da versão anterior.

## 2. Componentes principais

| Componente                      | Papel                                                                                                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TrialCta`                      | CTA de trial. Sem plano → `#planos`; com plano (fixo ou escolhido na visita) → `/anamnese?plano=ID`.                                                              |
| `PulseLink` / `buttonClassName` | Pulse Button (primário/secundário), magnético só com ponteiro fino, foco visível por tema.                                                                        |
| `MediaSlot`                     | Moldura com proporção reservada; asset do registro ou fallback (`ambient`, `portrait`, `custom`).                                                                 |
| `CinematicBackdrop`             | Fallback do Hero: arquitetura modernista abstrata em SVG + rastro Pulse (variante `final` sem uso).                                                               |
| `HeroPoster` / `HeroMedia`      | Pôster SSR (quadro 0, LCP) + camada de vídeo montada após a hidratação; Film Drift e playbackRate.                                                                |
| `RevealLines`                   | Título com máscara por linha, semântico (o leitor lê a frase inteira).                                                                                            |
| `SceneCanvas`                   | Ciclo de vida das cenas WebGL (lazy, pausa, descarte no mobile, fallback).                                                                                        |
| `PricingPlans`                  | Cartões (desktop) e seletor com rádio nativo + cartão de detalhe (mobile/tablet).                                                                                 |
| `MuscleMapExplorer`             | Chips (`aria-pressed`) + painel; corpo carregado perto da viewport.                                                                                               |
| `Navbar`                        | Transparente no hero, vidro escuro após 80px; menu em tela cheia (Radix Dialog: ESC, foco preso).                                                                 |
| `MobileStickyCta`               | Aparece após ~120% da altura da tela; some sobre Planos, CTA final e rodapé.                                                                                      |
| `Preloader`                     | Só enquanto as fontes críticas carregam; teto de 2,4s; não repete na sessão.                                                                                      |
| `Footer`                        | Cartões sobrepostos (corpo Névoa + cartão branco) com marca, respaldo CREF, colunas e barra legal; assinatura "movivo" em vidro (lettering oficial + filtro SVG). |

## 3. Fluxo de negócio preservado

- Plano → anamnese: exatamente o contrato anterior (`/anamnese?plano=MONTHLY|QUARTERLY|SEMIANNUAL|ANNUAL`),
  lido por `src/app/anamnese/page.tsx` e persistido na sessão pela API. IDs inalterados.
- Primeiro toque (US-8.2): `captureFirstTouch()` roda na montagem da landing (`LandingRuntime`).
- `form_started` continua existindo, mas agora só dispara quando o clique **realmente leva
  à anamnese** (antes disparava também no CTA que só rolava até os planos).
- Checkout não foi tocado: `/assinar` e a API continuam lendo `SUBSCRIPTION_PLANS`.

## 4. Preços

Fonte única: `SUBSCRIPTION_PRICING` em `packages/shared/src/schemas/subscription.schema.ts`.

```ts
baseMonthlyCents: 7990          // mensalidade do plano mensal (base de desconto/economia)
MONTHLY    1 mês    R$ 79,90/mês → R$ 79,90
QUARTERLY  3 meses  R$ 75,90/mês → R$ 227,70 (5% OFF, economia R$ 12,00)
SEMIANNUAL 6 meses  R$ 71,90/mês → R$ 431,40 (10% OFF, economia R$ 48,00)
ANNUAL     12 meses R$ 67,90/mês → R$ 814,80 (15% OFF, economia R$ 144,00)
```

Cada plano tem a mensalidade fechada (`monthlyCents`); `priceCents = meses × mensalidade`
(aritmética inteira) e o desconto exibido é o real sobre a base, arredondado ao inteiro
(`planDiscountPercent`: 75,90/79,90 = 5,006% → 5%). `SUBSCRIPTION_PLANS`, o
`PLAN_CATALOG` da API, o `/assinar` e a landing derivam daí.

> **Atenção — Asaas:** o checkout nunca aceita preço do navegador. Plano, mensalidade,
> total e limite de parcelas vêm do snapshot persistido pela API. A integração real está
> travada no Sandbox até a conclusão do gate PCI descrito em
> `docs/pagamentos/MIGRACAO-ASAAS-SANDBOX.md`.

**Editar preço:** mude o `monthlyCents` do plano (ou a base) em `SUBSCRIPTION_PRICING`,
rode `pnpm --filter @movivo/shared build` e os testes (`subscription.schema.spec.ts` e
`subscription-model.spec.ts` travam os valores de propósito). Contratos já iniciados
mantêm o snapshot anterior; a mudança vale apenas para novos trials.

**Adicionar um plano:** inclua o ID em `SUBSCRIPTION_PLAN_IDS` e o item em
`SUBSCRIPTION_PRICING.plans` (meses, `monthlyCents`, `periodDays`); o `PLAN_CATALOG`, a
landing (cartões + seletor), o evento `pricing_select_<id>` e o `/assinar` se ajustam
sozinhos. Revise também os limites de parcelas e débitos do adaptador Asaas, além do grid
de 4 colunas em `sections/pricing.module.css`, se passar de 4 planos.

O destaque vai para o plano recomendado do catálogo (`recommended` → `isDefault`, hoje o
Semestral): borda Coral Vivo neon com um ponto de luz percorrendo o contorno sem parar
(gradiente cônico girando via `@property --orbit`, parado com movimento reduzido), selo
Coral "Recomendado" sobre a borda (fora
do fluxo, então o conteúdo dos quatro cartões fica alinhado) e o CTA primário. Não existe
"mais vendido/mais popular": a MOVIVO ainda não tem base de alunos que sustente isso.
Benefícios dos cartões: `PLAN_BENEFITS` em `src/lib/landing/pricing.ts`.

## 5. Sistema de motion

- **GSAP + ScrollTrigger** (`motion/gsap.ts`): carregados sob demanda, um registro só.
- **`useGsap(ref, setup)`**: roda dentro de `gsap.matchMedia()` com as condições
  `motion | reduced | desktop | mobile | finePointer`; muda de condição → reverte e roda de
  novo; desmontar → reverte tudo.
- **Reveals globais** (`LandingRuntime`): `[data-reveal]` (y 32/20px, blur 8/4px,
  0,85/0,7s, `power3.out`) e `[data-reveal-lines]` (linhas de 105% → 0, stagger 0,1s). Só
  animam o que está abaixo da dobra no momento do setup (nada visível pisca). Usa
  `opacity`, não `visibility`: nada sai da ordem de tabulação.
- **Hero** (ver §5.1): entrada em CSS puro (primeira pintura, sem esperar o chunk do
  GSAP) e pausada enquanto o preloader estiver ativo; Film Drift e playbackRate em GSAP.
- **Efeitos por seção** (`motion/effects.ts`): manifesto (Why we move — frases em Fold Text,
  uma por vez, em loop automático; ver §5.2),
  WhatsApp (a conversa toca sozinha, em loop, com o aparelho na tela — "digitando…"
  antes de cada resposta, proporcional ao tamanho; nada depende de rolar), how it works
  (ato ativo → visual ativo), intelligence (metades convergem, "Better together" aproxima as
  letras), adaptive (linha Pulse + semanas alcançadas), day (hora avança com o scroll).
  O CTA final não tem efeito próprio: o movimento é o fundo Web Threads (ver §6).
- **Sem scroll hijacking e sem Lenis.** Os "palcos" do desktop (esfera, how it works)
  usam `position: sticky` sobre o scroll nativo. Lenis foi avaliado e descartado: não
  melhora o desktop o bastante para justificar custo em teclado, âncoras e toque.
- Curvas espelhadas em CSS: `--ease-ui` (power2.out), `--ease-editorial` (power3.out),
  `--ease-cinematic` (power4.inOut), `--ease-organic`.

### 5.1 Hero cinematográfico

Pilha dentro da seção (nada `fixed`): filme (`[data-hero-film]`: pôster SSR + vídeo) →
4 máscaras independentes → conteúdo → scroll cue. Camadas pelos tokens `--z-media`,
`--z-overlay` e `--z-section-ui`; todas as máscaras com `pointer-events: none`.

| Máscara                     | Desktop (≥ 1024px)                                        | Mobile/tablet (< 1024px)                                   |
| --------------------------- | --------------------------------------------------------- | ---------------------------------------------------------- |
| 01 Base wash                | Petróleo 18%                                              | igual                                                      |
| 02 Legibilidade             | horizontal: Grafite 84% → Petróleo 3% (esq. → dir.)       | vertical: 16% no topo → Petróleo 46% → Grafite 86% na base |
| 03 Vertical cinematográfica | topo 34% (navbar) → quase 0 no meio → Grafite 66% na base | só o topo (42% → 0 em 30%)                                 |
| 04 Vinheta                  | radial, 0 → 24% nas bordas                                | igual                                                      |

- Enquadramento: `--hero-focus` = `36% 50%` abaixo de 1024px (a personagem passa entre
  ~30–50% da largura do filme) e `50% 50%` no desktop; pôster e vídeo usam o mesmo.
- Altura: `min-height: 100svh`; `height: 100svh` só com `min-height: 600px` de viewport
  (em paisagem/zoom 200% o Hero cresce em vez de cortar a copy). Safe areas no topo/base.
- Copy: H1 "MOVE YOUR / POTENTIAL." (POTENTIAL. em Névoa, como o resto do título), corpo, CTA primário com a
  microcopy "Teste sem cadastrar nenhum cartão" centralizada logo abaixo dele, CTA
  secundário. Sem eyebrow.
- Entrada (CSS, `power3.out`): "MOVE YOUR" sobe pela máscara de linha → corpo → CTAs →
  microcopy, y 24px + blur 4px. O GSAP só carrega depois da hidratação; animar a copy
  acima da dobra com ele atrasaria o LCP e exigiria esconder o texto até o JS.
- "POTENTIAL." em loop contínuo, só CSS (ciclo de 4,3s): digita uma tecla a cada 70ms,
  segura com o cursor piscando, apaga da última para a primeira (45ms por tecla), fica
  vazia com o cursor piscando e recomeça. Cada tecla tem duas animações de mesmo ciclo
  (opacidade para surgir, visibilidade para sumir); os tempos e percentuais estão
  documentados em `hero.module.css`. O leitor de tela recebe a palavra uma vez
  (`sr-only`); as teclas são `aria-hidden` e ocupam o lugar sempre (zero CLS). Movimento
  reduzido: a palavra fica escrita, sem cursor.
- Film Drift (desktop): `[data-hero-film]` de 1 → 1,025 enquanto o Hero sai da tela (scrub).
- playbackRate (desktop): 1,00 → 1,08 em degraus de 0,02 na saída do Hero; volta a 1.
  Nunca scrub de `currentTime`. Mobile: sem drift e sem playbackRate.
- Scroll cue: linha vertical + ponto Pulse, respiração de 5px (2,8s); some com movimento reduzido.

### 5.2 Why we move (manifesto)

Caixa em Névoa, vazia, com uma frase por vez, grande e centralizada. Todas ocupam a
mesma célula do grid, então a caixa tem a altura da frase mais alta e não pula na troca.
Sem piso de tela cheia: a seção mede a frase mais alta mais o `--section-pad`.

- **Fold Text** (`ui/fold-text.tsx` + efeito `manifesto`): cada caractere é uma peça que
  desdobra da dobradiça superior (`rotateX -92° → 0`, perspectiva 700px, cascata de
  0,6s distribuída pela frase inteira, 0,55s por peça, `power3.out`). A sombra da dobra
  escurece só a letra (`color-mix` com `--fold-crease`), sem caixa atrás, que no fundo
  claro viraria um cartão cinza. Palavras nunca quebram no meio; destaques curtos usam
  espaço não separável ("não muda", "não precisa").
- **Loop automático** com ritmo igual para todas: dobra (1,15s) → parada (2,6s) → sai
  subindo (0,45s) → caixa vazia (0,25s) → próxima; 4,45s por frase, ~27s o ciclo. Só toca
  com a seção na tela (pausa fora dela).
- Cores: Pulso em "não muda" e em "NÓS FAZEMOS ACONTECER!"; Coral em "não precisa" e
  "você decidiu ser"; "continuar." sublinhado em Pulso (o sublinhado corre depois da
  dobra). **Contraste:** Pulso sobre Névoa fica em ~1,6:1 e Coral em ~2,6:1, abaixo do
  mínimo WCAG para texto grande (3:1). Decisão de marca registrada, não descuido.
- Sem JS ou com movimento reduzido: as seis frases empilhadas, todas visíveis.
- Leitor de tela: cada frase inteira num `sr-only`; o título "Why we move" é `sr-only`.

### Movimento reduzido (`prefers-reduced-motion: reduce`)

Sem preloader, sem scrub, sem sticky longo (as seções voltam a ter altura natural), sem
WebGL (fica o fallback estático em SVG/CSS), reveals desativados (o HTML já está no estado
final), conversa do WhatsApp inteira visível, Hero só com o pôster (sem vídeo, sem drift,
"POTENTIAL." já escrito), Why we move com as seis frases empilhadas. Nenhuma função some:
o How it works ainda troca o visual ativo, só que sem transição.

## 6. Sistema 3D

Três usos, todos em Three.js puro (sem R3F/drei, para ficar mais leve e com controle
direto de shader e ciclo de vida):

- **Pulse** (`scenes/pulse-scene.ts`): icosaedro subdividido com shader próprio (Fresnel
  Verde Pulso, displacement por simplex noise mínimo, curvas de nível, respiração
  0,98–1,02) + halo aditivo + partículas (520 desktop / 180 mobile) com 5 estados
  dirigidos pelo scroll: compacta → respira → desprende → estrutura orbital → 4 núcleos.
  A esfera é 30% maior que o desenho original (`SPHERE_SIZE`, também no fallback CSS);
  núcleos e halo mantêm o tamanho. A seção fica sobre Petróleo Vivo (tema escuro), sem
  eyebrow: números da lista em Coral (esmaecidos nos itens ainda não alcançados). Névoa
  foi testada e descartada: a esfera perdia leitura no fundo claro.
  Os núcleos são projetados a partir de posições de tela (`scenes/pulse-layout.ts`),
  compartilhadas com os rótulos HTML e o fallback: os três sempre coincidem.
- **Club** (`scenes/club-scene.ts`): constelação determinística (`club-layout.ts`, 440 / 150
  pontos) — nascem com o scroll, ligam-se a até 2 vizinhos, derivam devagar, inclinam com o
  ponteiro. No meio da seção, parte deles converge para o contorno do símbolo MOVIVO
  (amostrado do vetor oficial) e uma linha neon contínua desenha o contorno sobre eles,
  seguindo o scroll; os pontos alcançados se fundem à linha. A linha é uma fita própria
  (núcleo quase branco, halo Verde Pulso, ponta mais brilhante enquanto desenha) com
  mistura por máximo, para as quinas não acenderem. Fica completa com o símbolo no meio
  da tela, segura, apaga e os pontos voltam a se dispersar. Se a amostragem falhar, o
  momento é pulado.
- **Aurora** (`scenes/aurora-scene.ts`): fundo da seção do WhatsApp. Porte do componente
  Aurora (ogl) para Three.js, com o mesmo shader e os parâmetros definidos (paradas
  `#25E27E` ×3, `blend` 0,59, `amplitude` 1, `speed` 0,4): uma faixa de luz Verde Pulso que
  ondula no alto da seção. DPR 1 (luz difusa). No mobile ocupa só a primeira tela, a 60%
  de intensidade, porque o título fica logo no topo; sem WebGL ou com movimento reduzido,
  um gradiente estático no mesmo lugar.
- **Web Threads** (`scenes/web-threads-scene.ts`): fundo do CTA final ("Move it."). Porte do
  componente WebThreads (ogl) para Three.js, com o mesmo shader e os parâmetros definidos
  (cores `#25E27E` ×3, 6 fios, `speed` 0,5, `frequency` 5, `spread` 0,18, `fanMode`
  center, `mirror`, `shimmer`, `grain` 0,05, `mouseStrength` 1): fios de luz Verde Pulso
  que se abrem a partir do centro; com ponteiro fino, o ponto de encontro segue o mouse.
  Modo claro do original fora (a seção é sempre escura). Sem WebGL ou com movimento
  reduzido, os mesmos fios congelados em SVG (`final-threads.tsx`).

`SceneCanvas` garante: import dinâmico só perto da seção, DPR ≤ 1,5 no mobile e ≤ 2 no
desktop, render pausado fora da viewport, **descarte do contexto no mobile quando a seção
fica longe** (nunca dois canvases pesados ao mesmo tempo), fallback em perda de contexto
ou erro, e `dispose()` completo ao desmontar. Conteúdo essencial nunca fica no canvas.

## 7. Responsivo

Mobile é composição própria, não desktop reduzido:

- Hero: copy na metade de baixo, CTAs em largura total; arquitetura na metade de cima.
- Esfera e How it works: sem sticky no mobile; progresso pela passagem na tela. WhatsApp:
  conversa automática em todos os tamanhos; o aparelho tem 340px (88vw no mobile) para a
  conversa inteira, com o PDF no topo, caber na tela dele a partir de 375px.
- Planos: seletor com rádio + um cartão de detalhe (em vez de 4 cartões empilhados).
- Muscle map: chips como controle principal (nunca depende de hover).
- Adaptive: timeline vertical nativa.
- Navbar mobile sem CTA duplicado (o CTA vive no menu e na barra fixa).

Breakpoints principais: 640, 768, 1024. Validado sem overflow horizontal de 320 a 3440px
(E2E) e visualmente em 320, 390, 768, 1024, 1440, 1920.

## 8. Assets

Todos os caminhos ficam em `src/lib/landing/assets.ts`. Tabela completa em `ASSET_MANIFEST.md`.

- **Filme do Hero:** registrado em `hero.desktopVideoMp4` (`/assets/movivo/video/cena-hero.mp4`).
  Para acrescentar WebM ou um corte mobile, coloque o arquivo em `public/assets/movivo/video/`
  e preencha `desktopVideoWebm`, `mobileVideoWebm` ou `mobileVideoMp4` — mobile e desktop
  caem um para o outro, WebM entra antes do MP4. O vídeo toca mudo/inline/em loop, só
  aparece quando está tocando (fade sobre o pôster), pausa fora da viewport e não é
  montado com movimento reduzido nem com economia de dados (`Save-Data`/2G).
- **Pôster do Hero:** `hero.desktopPoster` (`/assets/movivo/posters/hero-poster.webp`, quadro 0).
  Um `hero.mobilePoster` ativa art direction (`<picture>`) no `HeroPoster` sem outra mudança.
- **Foto do Leonardo:** `public/assets/movivo/people/leonardo.webp` (4:5) →
  `people.leonardo`. O card troca o monograma pela foto sem mudar o layout.
- **A Day with MOVIVO:** `public/assets/movivo/day/{morning,midday,pre-workout,workout,recovery}.webp`
  (4:3) → `dayWithMovivo.*`. Cada slot troca a composição editorial pela foto.
- **Open Graph:** `og.image` está reservado; quando existir, adicione em `metadata.openGraph.images`
  de `src/app/page.tsx`.
- **Número do CREF:** `RESPONSIBLE_PROFESSIONAL.crefNumber` em `src/lib/landing/site.ts`.
  Com `null`, a página mostra "Regulamentado pelo CREF" (nunca um número inventado).
- **Links legais:** `LEGAL_LINKS.terms`/`privacy` em `site.ts`. Com `null` o rodapé omite o
  link (as páginas ainda não existem; nada aponta para 404). Contato: Direct do Instagram.

## 9. Analytics

`src/lib/landing/analytics.ts`. Mesmas garantias do app: sem key, nada é importado nem
enviado; nenhuma propriedade com dado pessoal (só o `plan`, quando há).

CTAs: `hero_start_trial`, `hero_learn_more`, `nav_start_trial`, `how_it_works_start`,
`pricing_start_trial`, `sticky_mobile_start_trial`, `final_start_trial`,
`footer_start_trial` (novo, para não misturar com o CTA final).
Seleção: `pricing_select_{monthly,quarterly,semiannual,annual}`.
Seções (uma vez por visita, com 35% visível): `section_view_{hero,pulse,whatsapp,how_it_works,human,muscle_map,adaptive,day,club,pricing}`.
Funil existente: `form_started` (ver §3).

## 10. SEO e acessibilidade

- `title`: "Movivo - Assessoria de Treino"; description do briefing;
  canonical `/`; `themeColor` #03110E; JSON-LD `Organization` só com fatos (nome, URL,
  logo, Instagram).
- Um único H1; H2 por seção (sr-only onde o título visual é outro elemento); `lang="en"`
  nos trechos em inglês; skip link; foco visível com cor por tema (Verde Pulso no escuro,
  Petróleo no claro); alvos de toque ≥ 44px; menu e drawer com ESC e foco preso; "Start
  moving" tem nome acessível "Start moving: começar 7 dias grátis" (inclui o rótulo visível).
- Guardrails de linguagem (CLAUDE.md): a conversa ilustrativa do WhatsApp não mostra a IA
  ajustando o protocolo sozinha — o desconforto é "levado ao profissional responsável" e o
  status diz "revisão profissional CREF". Leonardo tem Medicina/Nutrição "em andamento",
  nunca "médico"/"nutricionista". Um teste de componente trava esses termos, e
  `leonardo-details.test.tsx` faz o mesmo no drawer "Formação e trajetória" (conteúdo em
  `RESPONSIBLE_PROFESSIONAL`, `src/lib/landing/site.ts`).

## 11. Performance

- Primeira pintura: HTML + CSS + fontes (Cabinet 700/800, Satoshi 400/500/700 pré-carregadas;
  Quicksand sem preload). O layout raiz deixou de pré-carregar Hanken Grotesk e JetBrains
  Mono (não usadas na landing); nas outras rotas elas seguem carregando pelo CSS.
- GSAP só depois da hidratação; Three.js e o mapa muscular (~100 KB de imagem) só perto
  das respectivas seções.
- Proporções reservadas em toda mídia (sem CLS); vídeo com `preload="metadata"`.

## 12. QA

```bash
pnpm --filter @movivo/web run typecheck
pnpm run lint
pnpm run format:check
pnpm --filter @movivo/web run test:cov        # inclui testes da landing e efeitos de motion
pnpm --filter @movivo/web run test:e2e        # build de produção + Playwright (home.e2e.ts)
```

- **Movimento reduzido:** macOS → Ajustes → Acessibilidade → Tela → Reduzir movimento
  (ou DevTools → Rendering → "Emulate CSS prefers-reduced-motion: reduce"). Esperado: sem
  canvas, sem preloader, tudo visível, conversa completa. Coberto também no E2E.
- **Preloader:** DevTools → Network → "Slow 4G" + desabilitar cache em aba anônima. Ele
  não aparece de novo na mesma sessão (`sessionStorage["mv-intro"]`).
- **WebGL indisponível:** `chrome://flags` → desabilitar WebGL. Esperado: fallback estático.
- **Larguras:** 320, 360, 390, 430, 768, 834, 1024, 1280, 1440, 1920 e paisagem mobile. O
  E2E já valida ausência de overflow horizontal em 12 larguras.
- **Safari iOS / Chrome Android:** autoplay do vídeo (quando existir), `backdrop-filter`,
  `svh/dvh`, sticky e o menu. Não automatizado: o Playwright do projeto roda só Chromium.
