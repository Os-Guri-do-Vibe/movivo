# ADR-010 — Card de Story do treino concluído renderizado no servidor

**Status:** Aceita

**Data:** 2026-10-01

## Contexto

O card de Story (PNG 1080×1920, fundo transparente) era montado **no aparelho do aluno**: um
DOM oculto com o corpo anatômico (SVG com `<image>` WebP externo + máscaras em `mix-blend-mode`)
era serializado por `html-to-image` e rasterizado pelo navegador, com timeout de 20 s.

Em produção isso gerou três falhas, todas consequência do mesmo desenho:

1. **Card incompleto** — só os músculos destacados, sem o corpo/logo/textos: o WebP externo (ou
   a fonte) não estava carregado quando o SVG foi serializado. Comportamento conhecido do
   `html-to-image` (sobretudo no Safari/iOS), não reproduzível em desktop.
2. **Lentidão e "Gerar novamente" que não resolve** — o custo (fetch dos assets, decode, layout
   de 1080×1920, serialização, raster) é pago por cada aluno, num celular qualquer, e o botão
   repetia exatamente o mesmo caminho frágil.
3. **Sem controle de escala** — nada podia ser pré-computado nem compartilhado entre alunos.

## Decisão

O PNG passa a ser **desenhado na API** e o aparelho só baixa bytes.

- **Renderização:** SVG com coordenadas absolutas (`share-card.svg.ts`) rasterizado por
  `@resvg/resvg-js` (Rust, binário pré-compilado — sem navegador headless, sem Chromium na
  imagem). Fontes (Hanken Grotesk, já empacotada para o PDF), ilustrações e logo vêm de
  `apps/api/assets/`, então o resultado é **idêntico em qualquer dispositivo**. `mix-blend-mode`
  e `isolation` são suportados pelo resvg; o resvg não lê WebP, por isso as ilustrações foram
  convertidas para PNG (`apps/api/scripts/build-share-card-assets.mjs`).
- **Cache por conteúdo:** o card depende só de (gênero, grupos musculares, duração) — nenhum dado
  do aluno entra na imagem. A chave é o hash desses três valores: alunos com o mesmo treino e a
  mesma duração compartilham o PNG. LRU em memória (32 MB), *single-flight* (N pedidos da mesma
  chave = 1 desenho) e no máximo 2 desenhos simultâneos (`renderAsync` roda no threadpool do
  libuv; o event loop não bloqueia).
- **Pré-aquecimento:** `POST /workouts/sessions/:id/finish` dispara o desenho em segundo plano
  (best-effort). Quando a tela de conclusão abre, o `GET /workouts/sessions/:id/share-card` é um
  cache hit (< 1 ms) ou, no pior caso, um desenho de ~30–60 ms.
- **Entrega:** `GET` autenticado pelo mesmo `sessionToken` do diário; `ETag` + `Cache-Control:
  private` (a URL é por sessão; nada vai para cache compartilhado). O BFF do Next repassa o
  stream.
- **Cliente:** `fetchWorkoutShareCard` baixa o PNG com timeout por tentativa (10 s) e até 3
  tentativas com *backoff* em 5xx/429/rede — a recuperação de falha transitória é automática;
  "Gerar novamente" só aparece depois de esgotar as tentativas. `html-to-image` foi removido.

## Consequências

- (+) Resultado determinístico; sem dependência de GPU/fontes/engine do celular.
- (+) Pico de fim de treino vira cache hit; custo de CPU independe do número de alunos.
- (+) A cópia do card é testável no servidor (guardrails de linguagem em `share-card-renderer.service.spec.ts`).
- (−) A API ganha um binário nativo (`@resvg/resvg-js`) e ~1 MB de assets; o container define
  `MALLOC_ARENA_MAX=2` para manter o RSS sob o limite de 1 GB em rajadas.
- (−) O layout é SVG manual: alterar o card exige mexer em coordenadas (`share-card.svg.ts`) e,
  se trocar a fonte, remedir os textos fixos (há um teste que acusa a divergência).
- (−) A fonte do card passa a ser Hanken Grotesk em todos os aparelhos (antes: a sans do sistema).
