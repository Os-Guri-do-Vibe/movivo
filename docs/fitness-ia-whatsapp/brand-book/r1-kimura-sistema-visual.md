# RODADA 1 — Kimura (Director Brand Designer)
# SISTEMA VISUAL DO MOVIVO BRAND BOOK

**Data:** 2026-09-10
**Rodada:** 1 — Fundações
**Pasta do projeto:** `docs/fitness-ia-whatsapp/`
**Status do pipeline:** identidade "O Pulso" implementada em produção (`apps/web`); documento mestre do fundador pede elevação de território + camada de marca-cultura.
**Escopo deste documento:** auditoria do existente, sistema tipográfico definitivo, paleta definitiva e expansão CLUB, sistema de badges, sistema de cards compartilháveis, identidade de Season, direção de arte/fotografia, produto físico, motion, proibições e índice do capítulo visual.

---

## Resumo executivo

O sistema "O Pulso" **aguenta o território aspiracional pedido — mas não do jeito que está aplicado hoje.** Ele não precisa ser substituído; precisa ser **desdobrado em duas camadas com dois solos cromáticos distintos**, e precisa de uma correção tipográfica que hoje é barata e daqui a dois anos será cara.

A decisão estruturante deste documento é a **arquitetura de dois solos**:

| | **Camada SERVIÇO** | **Camada CLUB** |
|---|---|---|
| O que é | O produto: WhatsApp, onboarding, protocolo, UI, landing, selo CREF | A cultura: status, badges, Seasons, cards, drops, eventos, produto físico |
| Solo | **Petróleo Vivo `#06302A`** (verde-quase-preto, caloroso) | **Ônix Movivo `#0B0D0C`** (quase-preto neutro, palco) |
| Registro tipográfico | **caixa-baixa**, Hanken Grotesk | **CAIXA-ALTA**, Archivo |
| Voz | acolhe, orienta, cuida | reconhece, registra, distingue |
| Marca fala | "a gente vai ajustar seu treino" | `MOVIVO SEASON 08` |

Isso resolve materialmente a tensão do fundador. **"Democratizamos o acesso. Não reduzimos o padrão."** deixa de ser uma frase e vira uma regra de sistema: a marca **fala em caixa-baixa quando serve** (acessível, próxima, sem intimidação, dentro do WhatsApp) e **fala em caixa-alta quando reconhece** (o status é raro, o ganho é seu, a peça é premium). Ninguém é excluído da primeira. Todo mundo pode chegar na segunda. É a mesma marca, em dois registros — não duas marcas.

As três decisões mais duras que este documento fecha:

1. **Quicksand é dívida de marca. Corrigir agora.** O wordmark implementado usa Quicksand Bold com `letter-spacing: -3.75`; a UI usa Hanken Grotesk. A marca hoje escreve o próprio nome numa fonte que o produto nunca usa, e que é uma geométrica arredondada de terminais em pílula — o registro "app fofo de wellness", incompatível com Nike/Lululemon/Apple. Custo de corrigir: **1 dia de desenho + ~2h de engenharia** (os SVGs já estão vetorizados; ninguém depende de arquivo de fonte). Custo de não corrigir: toda camiseta, medalha, badge, card e backdrop de evento dos próximos anos herda o registro errado.
2. **Status não é codificado por matiz. É codificado por material e luz.** Nada de ouro/prata/bronze. O nível sobe por *geometria de anel*, *estado de preenchimento do Pulso* e — no topo — por **inversão de solo**. ICON é o único badge claro do sistema inteiro. Custa zero cor nova e é o sinal mais raro possível numa marca dark-first.
3. **Coral Vivo é promovido, não demovido.** Ele deixa de ser "acento decorativo de calor" e ganha um trabalho semântico exclusivo na camada CLUB: **Verde = mérito de execução (o que você fez). Coral = mérito humano (voltar, marcar, contribuir).** COMEBACK, MILESTONE e COMMUNITY são coral. Isso dá cor ao valor "celebramos quem voltou, não só quem foi impecável".

---

## 1. Auditoria honesta do que existe hoje

### 1.1 Método

Inspecionei os arquivos reais, não a especificação:

- `apps/web/public/brand/movivo-logo-horizontal.svg` — 1000×260, símbolo vetorizado + lettering `movıvo` em `font-family:Quicksand; font-weight:700; font-size:183px; letter-spacing:-3.75`, i sem ponto, `<circle cx=743 cy=68 r=12.5 fill=#25E27E>` como ponto do i.
- `apps/web/public/brand/movivo-symbol.svg` — 340×260, apenas o traço do Pulso em `#25E27E`.
- `apps/web/public/brand/whatsapp-icon.svg` — ícone de terceiro (marca WhatsApp), fora do sistema MOVIVO, correto assim.
- `apps/web/src/app/globals.css` — tokens de marca e semânticos completos, Tailwind v4, três camadas, com notas de contraste WCAG corretas.
- `apps/web/src/app/layout.tsx` — `Hanken_Grotesk` + `JetBrains_Mono` via `next/font`, auto-hospedadas.

### 1.2 Veredito sobre o símbolo (O Pulso)

**Aguenta. Mantém-se sem redesenho conceitual.** Três razões objetivas:

1. **É abstrato e proprietário.** Não ilustra academia. Isso é exatamente o que permite a marca crescer para corrida, wellness, nutrição e eventos sem virar "a marca do halter" — que é a condição da visão do fundador (§50 do documento mestre).
2. **Tem gesto atlético.** O traço tem massa modulada e direção ascendente; lido rápido, é um gesto de movimento, não um ícone de UI. É o que sustenta camiseta, medalha e backdrop de evento. Um símbolo geométrico plano não sustentaria.
3. **Sobrevive à inversão e ao monocromático**, que é o teste que a camada CLUB exige (gravação a laser, bordado, debossing).

**Três problemas reais, com correção especificada:**

| Problema | Evidência no arquivo | Correção |
|---|---|---|
| **Cauda hairline** | O traço afina até ~2 unidades de espessura na terminação inferior-esquerda (x≈29–45, y≈176–189). Abaixo de ~28px isso desaparece por antialiasing; em bordado (< 1,2mm) some; em gravação, quebra. | Criar a variante **Pulso Sólido**: mesma silhueta, com **piso de espessura de 1,2% do lado da caixa** aplicado à cauda. Obrigatória em: badge B-XS/B-S, favicon 16/32px, bordado, gravação, debossing, medalha. Proibida em: web ≥64px, vídeo, impressão offset (ali usa o Pulso completo). |
| **Adjacência ao gesto Nike** | O traço é um swoosh ascendente com terminação em bola. Lido a 3 metros num backdrop de evento, a associação é imediata. | **Não redesenhar** — a diferenciação vem do sistema, não da silhueta. Regras que criam distância: (a) o Pulso **nunca** aparece sozinho sobre solo branco em grande escala (a leitura Nike é branco/preto); a leitura MOVIVO é sempre **Verde Pulso sobre solo escuro**; (b) o Pulso **nunca** é usado como "tick de aprovação" ao lado de texto; (c) o Pulso **nunca** é inclinado, espelhado ou repetido em série decorativa. O par cromático é o que é proprietário, não o traço. |
| **Ausência de contra-referência de construção** | O SVG é um path bezier vetorizado de uma referência, não uma reconstrução sobre malha. Não existe grid documentado, então não existe reconstrução precisa, nem área de proteção derivada, nem versão responsiva. | Redesenhar o path **sobre malha de 48 unidades** (mantendo a silhueta atual em ≥98% de sobreposição), publicando: coordenadas de nó, raios de junção, ângulo da terminação e caixa óptica. Sem isso não há brand book — há um arquivo. |

**Área de proteção (fecho agora):** `X = raio do ponto terminal do símbolo`. No lockup horizontal atual (1000×260), o raio é 17u → área de proteção = 17u em todos os lados do bounding box do lockup. Em qualquer escala, a fórmula é a mesma.

**Tamanhos mínimos (fecho agora):**

| Registro | Mínimo digital | Mínimo impresso |
|---|---|---|
| Símbolo (Pulso completo) | 32 px de altura | 10 mm |
| Símbolo (Pulso Sólido) | 16 px | 5 mm |
| Lockup horizontal | 132 px de largura | 32 mm |
| Wordmark isolado | 96 px de largura | 24 mm |

### 1.3 Veredito sobre a paleta

**O núcleo aguenta. A aplicação não.**

- **Petróleo Vivo `#06302A` — aguenta e é a melhor decisão do sistema.** A justificativa original (destacar no avatar do WhatsApp, afastar da VIVO/Telefônica) continua válida e é a única decisão do sistema que resolve um problema de canal real. Mantém.
- **Verde Pulso `#25E27E` — aguenta.** Contraste 8,37:1 sobre Petróleo e **11,38:1 sobre Ônix**. Ele fica *melhor* sobre o solo novo do que sobre o solo atual — o que valida a camada CLUB por medição, não por gosto.
- **Coral Vivo `#FF6A3D` — aguenta, mas estava desempregado.** Como "acento de calor humano em dose de 10%" ele é o elo fraco do território premium: laranja-coral em grande área lê "startup amigável 2019". Como **cor semântica de mérito humano** (§3.4) ele fica forte e ganha um motivo para existir. Contraste 6,85:1 sobre Ônix — passa AA para texto normal, o que permite usá-lo como palavra e não só como mancha.
- **Névoa / Grafite / Musgo / Branco — aguentam sem alteração.** São neutros de produto, não de cultura.

**O que a paleta atual *não* tem e a camada CLUB exige, e por quê:**

1. **Um palco.** Petróleo é um verde-preto caloroso — excelente como *ambiente de cuidado*, mas quando você imprime nele uma camiseta ou faz uma medalha, ele lê "institucional/corporativo verde". Falta um quase-preto neutro que funcione como palco: onde o Verde Pulso ganha 3 pontos de contraste, onde a fotografia noturna assenta, onde o produto físico não parece uniforme de empresa. → **Ônix Movivo `#0B0D0C`**.
2. **Uma luz.** ELITE precisa de um sinal que não seja matiz nova e não seja metal. → **Aurora `#9FF5C6`**, usada exclusivamente como o topo do gradiente de varredura. Nunca preenchimento, nunca texto.
3. **Um material claro que não seja "modo claro".** ICON é a inversão do sistema. Se ele usar Névoa (`#F4F7F3`, viés verde-frio), lê como "o app no tema claro". Precisa ler como *objeto*: papel, cerâmica, osso. → **Óssea `#E4E2DB`** (greige quente). Contraste Ônix sobre Óssea = 15,04:1.

**Diagnóstico de saturação de mercado (por que essa direção diferencia):** o setor fitness-tech convergiu em três clichês cromáticos — (a) preto + neon-lima/ciano ("performance masculina"); (b) pastel terroso + serifada ("wellness feminino"); (c) verde-app + branco (o próprio WhatsApp e toda categoria de saúde). O par **verde-quase-preto + verde vivo elétrico**, com um **coral com trabalho semântico** e **um único quase-preto neutro como palco de cultura**, não está ocupado por ninguém no Brasil nessa categoria. O risco não é a paleta ser genérica; é ela ser aplicada com folga demais.

### 1.4 A divergência tipográfica: Quicksand × Hanken Grotesk — resolução

**Primeiro, o fato exato, porque o briefing descreve a divergência maior do que ela é:**

- A **UI está correta**: `apps/web/src/app/layout.tsx` carrega Hanken Grotesk + JetBrains Mono, exatamente como especifiquei em `04-relatorio-kimura.md §4`. Zero dívida no produto.
- A divergência é **exclusivamente no wordmark do SVG**, que foi desenhado em **Quicksand Bold** e vetorizado em paths. Nenhum código depende de Quicksand; nenhum `@font-face`, nenhum import. É um arquivo, não uma arquitetura.

**Veredito: Quicksand é dívida de marca. Corrigir.** Os argumentos, específicos e não estéticos:

1. **A classe está errada para o território.** Quicksand é uma **geométrica arredondada** iniciada por Andrew Paglinawan em 2008, de terminais em pílula e traço praticamente monolinear, com inspiração declarada nas geométricas de 1920–30 e leitura "acessível, aberta, calorosa". É uma fonte excelente para o que ela é. O território pedido pelo documento mestre — Nike, Lululemon, Strava, Apple, performance premium — é construído sobre **grotescas de traço com contraste modulado e caps atléticas**. Terminal em pílula é o sinal gráfico oposto: ele *arredonda a intenção*. Um wordmark em geométrica arredondada não sustenta um backdrop de evento de 1.000 pessoas nem uma medalha; sustenta um app de meditação.
2. **É uma das fontes mais saturadas da categoria wellness/fitness leve no Brasil.** Escolher Quicksand é escolher parecer com o mercado que o fundador declarou explicitamente que não quer parecer.
3. **Há um erro técnico embutido, não só uma escolha discutível.** `letter-spacing: -3.75` sobre um corpo de 183px é ~2% de tracking negativo aplicado a uma geométrica de bojos circulares — que é justamente a classe que menos tolera aperto, porque os contra-formas de `o` e `v` fecham. E o ponto do `i` é um `<circle r=12.5>` posicionado à mão em `cy=68`, desligado das métricas da fonte. Isso não é um wordmark customizado; é um remendo. Se vamos customizar de qualquer forma, customizamos sobre a base certa.
4. **Fratura de sistema.** Hoje a marca escreve o próprio nome numa fonte que o produto inteiro nunca usa. Um brand book não consegue documentar isso sem parecer improviso.

**Custo de corrigir (números, não adjetivos):**

| Item | Esforço |
|---|---|
| Redesenho do wordmark sobre a base nova, com os ajustes proprietários (v's, ponto do i, tracking óptico) | ~6h de desenho |
| Reexportação dos 4 registros (horizontal, vertical, wordmark, símbolo) + monocromáticos + Pulso Sólido | ~2h |
| Troca dos arquivos no repositório: `movivo-logo-horizontal.svg`, `movivo-symbol.svg` (inalterado), favicon, app icon, OG image, avatar do WhatsApp | **~2h de engenharia**, nenhuma refatoração — os SVGs são referenciados por caminho |
| Reemissão de peças já impressas | **zero** — a marca ainda não tem produto físico em circulação |
| **Total** | **~1 dia de desenho + meio dia de engenharia** |

**Custo de não corrigir:** cada Season, cada drop, cada badge, cada medalha, cada card compartilhável e cada backdrop dos próximos anos herda o registro errado — e a correção passa a exigir recall de estoque físico e retrabalho de centenas de artefatos gerados. **Esta é a janela mais barata que vai existir. Corrigir agora.**

**Onde eu reviso a mim mesmo:** em `04-relatorio-kimura.md §4` recomendei Hanken Grotesk para *tudo*, inclusive o wordmark. Estava certo para o produto e **insuficiente para a marca**. Hanken Grotesk é uma grotesca humanista ótima em corpo pequeno e texto longo, e por isso mesmo é **discreta demais em caixa-alta grande** — não tem a presença de caps que a camada CLUB exige, e não tem eixo de largura para artwork de Season e peça de evento. A correção não é trocar Hanken; é **acrescentar uma família de marca acima dela** (§2).

---

## 2. Sistema tipográfico definitivo

Três famílias, três trabalhos, fronteiras rígidas. Todas com licença aberta (OFL) — custo zero, auto-hospedáveis, sem dependência de fundição.

### 2.1 As três famílias

| Papel | Família | Por que esta | Onde vive |
|---|---|---|---|
| **MARCA / CULTURA / DISPLAY** | **Archivo** (variável, OFL — Omnibus-Type). Eixos: `wght 100–900`, `wdth 62–125` | Grotesca de origem gótica-americana, desenhada para alto desempenho tanto em display quanto em texto. Caps altas, terminais retos, contra-formas abertas — aguenta tracking positivo em caixa-alta sem virar mancha, que é exatamente o registro de reconhecimento. O **eixo de largura** entrega uma voz condensada para artwork de Season, dorso de camiseta e backdrop **sem comprar uma segunda família**. | Wordmark, todo texto em CAIXA-ALTA, badges, cards, Seasons, eventos, produto físico, números grandes |
| **PRODUTO / UI / TEXTO** | **Hanken Grotesk** (variável, OFL) — *já implementada, mantém* | Grotesca humanista, calorosa, altíssima legibilidade em corpo pequeno e texto longo. É a voz do cuidado. Nenhuma razão para trocar. | WhatsApp, onboarding, protocolo, landing (corpo), UI, selo CREF, textos legais, toda copy do AI Coach |
| **DADO DE LABORATÓRIO** | **JetBrains Mono** (OFL) — *já implementada, mantém, com escopo reduzido* | Tabular, sinal de medição e método. | **Somente ≤ 14px**: carga, séries, `3×12`, RPE, nº do CREF, timestamps, IDs |

**A regra que impede as duas grotescas de brigarem** (Archivo e Hanken são "irmãs" e poderiam colidir): **elas nunca ocupam o mesmo papel tipográfico.**

- **Archivo nunca é usada em caixa-baixa corrida.** Nada de parágrafo em Archivo.
- **Hanken nunca é usada em CAIXA-ALTA de reconhecimento.** Nada de `SEASON 08` em Hanken.
- Consequência: a diferença entre as duas deixa de ser um risco e vira **o próprio sinal de qual registro o leitor está lendo**.

**Wordmark redesenhado — especificação:**

- Base: **Archivo Expanded (`wdth 112`) Bold (`wght 700`)**, caixa-baixa: `movivo`.
- Tracking: **−1,5%** (não −2% e jamais os −3,75px absolutos de hoje). Archivo tolera aperto porque tem contra-formas retangulares; ainda assim o aperto é óptico, aplicado par a par, não global.
- Ajustes proprietários (o que o torna logo e não fonte):
  1. Os **dois `v`** recebem o vértice inferior com raio de 6% da altura-x, rimando com as junções do símbolo.
  2. O `i` é **sem ponto**, e o ponto é um **círculo em Verde Pulso `#25E27E`** com diâmetro = 0,58 × altura-x, centro alinhado à haste do `i` e à **altura do ombro do `o`** (não flutuando 35px acima, como no arquivo atual).
  3. Terminal do `o` final: sem alteração — a marca não precisa de assinatura em cada letra.
- **O wordmark permanece em CAIXA-BAIXA.** Ele é a assinatura de **serviço**. `MOVIVO` em caixa-alta é o registro de **cultura** e é composto em Archivo, não é o wordmark. São dois objetos diferentes e o brand book precisa nomeá-los assim.

### 2.2 A regra de caixa — o registro tipográfico oficial

Esta é a regra que traduz "democratizamos o acesso, não reduzimos o padrão" em tipografia.

#### REGISTRO A — Caixa-baixa (VOZ DE SERVIÇO). Hanken Grotesk.

**Quando:** sempre que a marca **ajuda, orienta, explica, acolhe ou pede algo**.
Mensagens do AI Coach, onboarding, PAR-Q, protocolo, UI, e-mails, erros, textos de suporte, selo CREF, avisos de segurança, toda comunicação com quem está começando, com dificuldade ou voltando.

**Regras:**
- Tracking `0`. Entrelinha 1,45–1,6 no corpo.
- Corpo mínimo 16px em tela, 14px absoluto para labels.
- Sem caixa-alta em frase inteira, jamais.
- **Nunca** ênfase por caixa-alta ("VOCÊ CONSEGUE!"). Ênfase é peso (Semibold), nunca caixa.

#### REGISTRO B — CAIXA-ALTA (VOZ DE RECONHECIMENTO). Archivo.

**Quando:** sempre que a marca **nomeia um sistema, registra um fato ou distingue alguém**.

Lista fechada — caixa-alta só é permitida nestes sete casos:
1. **Nomes de sistema:** `MOVIVO CLUB`, `MOVIVO SEASON 08`, `MOVIVO EXPERIENCE`, `MOVIVO DROP 01`, `MOVIVO LAB`, `MOVIVO STORE`.
2. **Status:** `MEMBER`, `ACTIVE`, `CORE`, `ELITE`, `ICON`.
3. **Reconhecimentos:** `CONSISTENCY`, `PERFORMANCE`, `COMEBACK`, `DISCIPLINE`, `MILESTONE`, `EXPLORER`, `COMMUNITY`.
4. **Unidades e rótulos de dado em card/badge:** `KM`, `KG`, `WEEK`, `DAYS`, `POINTS`, `SEASON`, `ADERÊNCIA`.
5. **Marcos:** `MOVIVO 90`, `YEAR ONE`, `100 POINTS`.
6. **Cultura em peça física ou de evento:** `NÓS FAZEMOS ACONTECER`, `SOMOS MELHORES DO QUE ÉRAMOS ONTEM`.
7. **Título de campanha institucional** (manchete de vídeo/outdoor), máximo 5 palavras.

**Regras técnicas do registro B (obrigatórias — caixa-alta mal espaçada é o erro mais comum de marca esportiva):**

| Corpo | Tracking | Entrelinha |
|---|---|---|
| ≥ 64px | +1% | 0,92 |
| 32–63px | +4% | 0,98 |
| 16–31px | +6% | 1,10 |
| < 16px | +8% | 1,25 |

- **Máximo 4 palavras ou 24 caracteres por linha.** Acima disso, não é reconhecimento, é parágrafo — e parágrafo é Registro A.
- **Nunca** frase completa com sujeito e predicado em caixa-alta fora dos casos 6 e 7.
- **Nunca** caixa-alta em texto com valor jurídico ou de segurança (selo CREF, LGPD, PAR-Q, avisos de saúde). Caixa-alta reduz legibilidade e esses textos precisam ser lidos, não admirados.
- **Nunca** caixa-alta numa mensagem dirigida a quem está em dificuldade, quebrou sequência ou está voltando. A marca **não grita com quem voltou.** Um `COMEBACK` como nome de badge, sim; "VOCÊ VOLTOU!" no WhatsApp, não — ali é "que bom te ver de volta".

**Teste de uma linha para qualquer peça:** *estou ajudando ou estou registrando?* Ajudando → caixa-baixa, Hanken. Registrando → CAIXA-ALTA, Archivo.

### 2.3 Escala tipográfica

**Escala de PRODUTO (mantém a implementada em `globals.css`, sem alteração):**

`display 3.5rem/1.05/−0.02em` · `h1 2rem/1.15/−0.015em` · `h2 1.5rem/1.25` · `h3 1.25rem/1.3` · `body 1rem/1.55` · `label 0.875rem/1.4`

**Escala de CULTURA (nova — Archivo, caixa-alta, camada CLUB). Tokens a acrescentar:**

| Token | Corpo | Peso | Tracking | Entrelinha | Uso |
|---|---|---|---|---|---|
| `--culture-hero` | 160px (clamp 96→160) | 800 | +1% | 0,90 | Backdrop de evento, capa de Season, hero de campanha |
| `--culture-display` | 64px | 700 | +2% | 0,95 | Título de card, nome de Season |
| `--culture-title` | 40px | 700 | +2% | 1,00 | Categoria no card (`MOVIVO RUN`) |
| `--culture-label` | 13px | 600 | +8% | 1,25 | Faixa de sistema, rótulos de dado |
| `--metric-xl` | 240px | 800 `tnum` | −1% | 0,86 | O número herói do card |
| `--metric-l` | 72px | 800 `tnum` | 0% | 0,90 | Métrica secundária |
| `--metric-m` | 48px | 700 `tnum` | 0% | 0,95 | Linha de métricas do card |
| `--metric-unit` | 0,17 × corpo da métrica | 600 | +8% | — | `KM`, `KG`, `%`, alinhado à **linha de base** do numeral |

**Regra do número — fecha a ambiguidade mono × Archivo:**

> **Número ≤ 14px é JetBrains Mono. Número > 14px é Archivo com `font-variant-numeric: tabular-nums`.**

Racional: mono grande lê "terminal de desenvolvedor", não "performance premium" — é o erro que faria o card do MOVIVO RUN parecer um dashboard. Mono pequeno lê "medido, aferido, com método", que é exatamente o sinal que o protocolo e o selo CREF precisam. Tabular é obrigatório em ambos: números que mudam **nunca** podem deslocar o layout.

---

## 3. Paleta definitiva e expansão CLUB

### 3.1 Núcleo (inalterado — já em produção)

| Cor | HEX | Papel |
|---|---|---|
| **Petróleo Vivo** | `#06302A` | Solo da camada SERVIÇO. Avatar do WhatsApp, superfícies escuras do produto, texto de marca sobre claro. |
| **Verde Pulso** | `#25E27E` | Assinatura única, atravessa as duas camadas. O símbolo, CTA, progresso, mérito de execução. |
| **Coral Vivo** | `#FF6A3D` | **Mérito humano** (novo papel — §3.4). No produto, segue como alerta gentil. |
| **Névoa** | `#F4F7F3` | Fundo claro de produto. |
| **Grafite** | `#14201C` | Texto corrido sobre claro. |
| **Musgo** | `#5B6B63` | Texto secundário, estados inertes, dado não cumprido. |
| **Branco** | `#FFFFFF` | Superfícies, texto sobre escuro. |

### 3.2 Expansão CLUB (nova — três cores, cada uma com um trabalho que a paleta atual não faz)

| Cor | HEX | Papel estratégico | Regra de uso |
|---|---|---|---|
| **Ônix Movivo** | `#0B0D0C` | **O palco.** Quase-preto neutro (viés verde imperceptível, ΔE < 1 do preto). Solo de tudo que é cultura: badge CORE+, cards compartilháveis, Season artwork, produto físico, backdrop de evento, drops. | **Exclusivo da camada CLUB.** Nunca substitui Petróleo no produto, no WhatsApp ou na UI. Nunca é o fundo da landing. |
| **Aurora** | `#9FF5C6` | **A luz do status.** Menta luminosa. Existe para diferenciar ELITE sem recorrer a metal. Lê como brilho sobre superfície, não como material precioso. | **Somente** como topo do gradiente de varredura (ELITE) e como flash de 140ms no motion de conquista. **Nunca** preenchimento sólido, **nunca** cor de texto, **nunca** em produto físico. |
| **Óssea** | `#E4E2DB` | **O material do topo.** Greige quente. É o solo invertido do ICON e do reconhecimento MOVIVO. Lê como papel/cerâmica/osso — um *objeto*, não um "modo claro". | **Somente** ICON, reconhecimento MOVIVO, card físico ICON, e uma única colorway de produto. Nunca no produto digital. |

**Por que não ouro/prata/bronze — a posição:** metal é o vocabulário universal de videogame e programa de milhagem. Ele comunica hierarquia instantaneamente e por isso mesmo comunica *que existe uma hierarquia comprável*. É o oposto exato da tese do fundador: "a exclusividade deve vir de comportamento, não de poder aquisitivo". Duolingo, que é o caso mais estudado de ligas visuais, começa em bronze/prata/ouro e depois precisa fugir para dez pedras preciosas — a evidência de que a escada de metal esgota. A MOVIVO codifica status em **geometria, preenchimento e inversão de solo**: sinais que só existem dentro do próprio sistema, que não podem ser confundidos com "plano pago", e que não custam nenhuma cor nova.

### 3.3 Tabela de contraste (calculada, WCAG 2.2)

Sobre **Ônix `#0B0D0C`** (solo da camada CLUB):

| Cor | Contraste | Veredito |
|---|---|---|
| Verde Pulso | **11,38:1** | AAA para qualquer corpo. *Melhor do que sobre Petróleo (8,37:1)* — o palco valida-se por medição. |
| Névoa | 18,05:1 | AAA |
| Aurora | 15,18:1 | AAA (mas uso restrito a gradiente/flash) |
| Óssea | 15,04:1 | AAA — sustenta a inversão do ICON |
| Coral Vivo | **6,85:1** | AA para texto normal, AAA para grande. *Sobre Petróleo é 5,04:1* — o Coral também melhora no palco. |
| Musgo | 3,46:1 | **Só elementos não-textuais e texto ≥24px bold.** É a cor do "não cumprido" — deve ser fraca de propósito. |

Sobre **Óssea `#E4E2DB`** (inversão ICON): Ônix **15,04:1** · Petróleo 11,07:1 · Grafite 12,93:1 · Musgo 4,35:1.
**Verde Pulso sobre Óssea = 1,32:1** → proibido como texto ali; no ICON o Verde entra apenas como fio de 0,75u (elemento não-textual decorativo).

**Regras de acessibilidade que não se negociam:**
1. Verde Pulso e Aurora **nunca** são texto sobre fundo claro (1,59:1 e 1,19:1 sobre Névoa — reprovam em qualquer critério).
2. Coral sobre claro só em ≥24px bold (2,63:1 sobre Névoa — reprova para corpo).
3. Toda cor de Season é **≥24px ou preenchimento**, nunca texto corrido (§6).
4. Todo card compartilhável tem contraste medido na zona do dado; foto nunca fica sob o número herói sem o scrim especificado (§5.4).
5. Todo motion celebratório respeita `prefers-reduced-motion` — já implementado em `globals.css`, vale para as animações novas.

### 3.4 A cor da conquista — a decisão semântica

> **Verde Pulso = mérito de execução.** Você fez o que combinou. Consistência, performance, disciplina, exploração, status.
> **Coral Vivo = mérito humano.** Você voltou, você marcou uma data, você ajudou alguém. Comeback, milestone, community.

Isso não é decoração: é o valor 6 do fundador — *"celebramos quem voltou, não só quem foi impecável"* — virando código de cor. Um membro que vê um badge coral no perfil de outro sabe, sem legenda, que aquilo não foi sobre volume de treino. E dá ao Coral o trabalho estratégico que faltava para ele merecer estar na paleta.

**Orçamento de Coral na camada CLUB:** máximo **8% da área** de qualquer peça. Nunca fundo. Nunca gradiente. Em produto físico, nunca área impressa maior que 4 cm².

### 3.5 Roda de Seasons (8 cores fechadas)

Cada Season recebe **uma** cor, sorteada em rotação fixa desta roda. A roda é fechada para que nenhuma temporada possa inventar uma cor e quebrar o sistema.

| Season | Nome | HEX | Contraste sobre Ônix |
|---|---|---|---|
| 01, 09, 17… | Verde Pulso *(temporada de fundação)* | `#25E27E` | 11,38:1 |
| 02, 10, 18… | Coral Vivo | `#FF6A3D` | 6,85:1 |
| 03, 11, 19… | Índigo Cinético | `#5B6BFF` | 4,63:1 |
| 04, 12, 20… | Areia Quente | `#E8C57A` | 11,79:1 |
| 05, 13, 21… | Magenta Vivo | `#FF4D8D` | 6,22:1 |
| 06, 14, 22… | Ciano Gelo | `#5BE3E8` | 12,62:1 |
| 07, 15, 23… | Violeta Fundo | `#9B6BFF` | 5,52:1 |
| 08, 16, 24… | Lima Ácida | `#C7F53A` | 15,37:1 |

**Regra:** cor de Season vive **exclusivamente sobre Ônix ou Petróleo**. Todas reprovam sobre fundo claro. Nenhuma delas jamais substitui o Verde Pulso no símbolo.

---

## 4. Sistema de badges e status visual

### 4.1 Duas classes de objeto, distinguidas por FORMA (não por cor)

| | **STATUS** (nível, permanente, único) | **RECONHECIMENTO** (conquista, acumulável, múltiplo) |
|---|---|---|
| Forma | **Superelipse** (squircle) | **Círculo** |
| Conteúdo | O símbolo Pulso | Um glifo derivado do Pulso |
| Quantidade | Você tem exatamente 1 | Você tem N |
| Codificação | Anéis + preenchimento + inversão de solo | Cor semântica (verde/coral) + glifo |

A distinção por **forma** é o que permite ler a diferença em 16px, em bordado e em monocromático — situações em que cor não sobrevive. É a decisão que faz o sistema escalar.

**Por que superelipse e não círculo no status:** círculo é a forma-padrão de todo app gamificado (Duolingo, Nike Run Club, Apple Fitness). A superelipse (`n = 4`, curvatura contínua) é a geometria do ícone de app iOS e do design industrial — lê como *objeto fabricado*, não como *medalha de jogo*. E faz o badge de status e o app icon pertencerem à mesma família geométrica.

### 4.2 Grid e construção (vale para as duas classes)

- **Malha mestra: 48 × 48 unidades.** Divisível por 24, 16, 12, 8, 6, 4, 3, 2 — permite todos os degraus responsivos sem valor quebrado.
- **Área viva: 40 × 40u.** Margem de 4u em todos os lados. Nada estrutural na margem.
- **Superelipse:** `|x/a|⁴ + |y/a|⁴ = 1`, `a = 24u`. Fallback para ferramentas sem superelipse: retângulo com raio `13,4u` (= 28% do lado).
- **Círculo:** diâmetro 48u, área viva 40u.
- **O Pulso dentro do badge:** escalado a **62% da área viva** (24,8u de largura óptica), **opticamente centrado — não geometricamente**. A massa do Pulso é bottom-left → top-right, então o centro óptico exige deslocamento de **−2u em X e +1u em Y** em relação ao centro geométrico. Sem esse ajuste o badge parece torto e ninguém sabe dizer por quê.
- **O Pulso nunca é rotacionado, espelhado ou recortado pela borda do badge.**
- **Anel:** traço inset a partir da borda. Espessura padrão **1,5u** (= 3,125% do lado). Fio (hairline) **0,75u**.
- **Glifos de reconhecimento:** desenhados sobre sub-malha de 24u, traço **2u**, caps e junções arredondados (mesma suavidade do símbolo), sem preenchimento.

### 4.3 Os cinco níveis de status

Fecho a nomenclatura com uma correção: **o nível de entrada NÃO pode se chamar "MOVIVO".** O documento mestre propõe MOVIVO / ACTIVE / CORE / ELITE / ICON, mas isso faz o nome da empresa, o nível mais baixo do sistema e o reconhecimento mais raro (§26) serem a mesma palavra — três significados colidindo. Uso o termo que o próprio documento mestre já usa em §29: **MOVIVO MEMBER**.

**Escada oficial: `MEMBER → ACTIVE → CORE → ELITE → ICON`.**
`MOVIVO` fica reservado ao reconhecimento único da marca (§4.5) — que é o que o fundador quis quando escreveu "reconhecimento especial da própria marca".

| Nível | Solo | Pulso | Anéis | Leitura |
|---|---|---|---|---|
| **MEMBER** | Petróleo `#06302A` | **Contorno** (traço 2u), Musgo `#5B6B63` | nenhum | "Você entrou. Nada foi conquistado ainda — e tudo bem." |
| **ACTIVE** | Petróleo `#06302A` | **Sólido**, Verde Pulso | nenhum | "O pulso ligou." A mudança de contorno para sólido é o degrau mais emocionante da escada e é de graça. |
| **CORE** | **Ônix `#0B0D0C`** | Sólido, Verde Pulso | **1 anel** contínuo, Verde Pulso, inset 3u | Troca de solo. Você saiu do produto e entrou no CLUB. |
| **ELITE** | Ônix | Sólido, **com varredura Aurora** | **2 anéis**, inset 3u e 6u; o externo em **gradiente linear 22°: `#25E27E` → `#9FF5C6` → `#25E27E`** | A luz bate na superfície. Nenhum material novo — só luz. |
| **ICON** | **Óssea `#E4E2DB` — INVERTIDO** | Sólido, **Ônix `#0B0D0C`** | 2 **fios** de 0,75u, Verde Pulso, inset 3u e 6u | O único badge claro do sistema inteiro. Não é "mais brilhante" que ELITE — é **de outro material**. |

**Por que ICON é a inversão e não "o mais dourado":** num sistema dark-first onde 100% dos artefatos de cultura são escuros, a coisa mais rara que pode acontecer é **um artefato claro**. Ninguém consegue imitar isso com filtro; ninguém confunde com "nível pago"; e num feed de stories escuros, um único card Óssea para o scroll. Custo: zero cor nova além da Óssea.

**Elemento exclusivo do ICON:** micro-wordmark `movivo` na base do badge, altura de caixa 4u, apenas em **B-L (≥128px)** — abaixo disso é omitido. É o único badge que assina.

### 4.4 Comportamento responsivo (24px → impressão)

| Degrau | Faixa | O que sobrevive |
|---|---|---|
| **B-XS** | 16–23px | Só **solo + silhueta do Pulso** (variante **Pulso Sólido**). Anéis **eliminados** — em 16px um anel de 1,5u tem 0,5px e vira sujeira. O nível é lido só pelo par solo/marca: Petróleo+Musgo (MEMBER), Petróleo+Verde (ACTIVE), Ônix+Verde (CORE), Ônix+Aurora (ELITE), Óssea+Ônix (ICON). |
| **B-S** | 24–47px | Anéis aparecem, com **piso físico de 1px**. Os 2 anéis do ELITE **colapsam em 1**, e o gradiente é **substituído por Aurora chapada** (gradiente não resolve nessa escala). Sem texto. |
| **B-M** | 48–127px | Geometria completa, gradiente de varredura, sem texto. Este é o degrau canônico — desenhe aqui primeiro. |
| **B-L** | ≥128px | Geometria completa + wordmark do ICON + lockup de legenda opcional abaixo (nome do status em `--culture-label`). |
| **B-PRINT** | impressão, bordado, gravação | **Monocromático obrigatório.** Piso de traço 0,8pt. Pulso Sólido com piso de cauda de 1,2% do lado. Anéis mantidos como traço; gradiente do ELITE convertido em **anel duplo sólido**. |

**Regra de ouro do responsivo:** *nada aparece num degrau menor que não exista no maior; e nada some no maior que exista no menor.* O badge é o mesmo objeto perdendo detalhe, nunca um desenho diferente.

### 4.5 Os reconhecimentos independentes

Círculos de 48u. Cada glifo é uma **derivação do gesto do Pulso** — o sistema inteiro sai de uma forma só, o que é o que o torna reconhecível sem legenda.

| Reconhecimento | Glifo (construção) | Cor | Mérito |
|---|---|---|---|
| **CONSISTENCY** | O Pulso repetido **4×**, amplitude idêntica, espaçamento idêntico. Ritmo. | Verde Pulso | Execução |
| **PERFORMANCE** | O Pulso repetido **3×**, cada repetição **+22% de amplitude**. Ascensão. | Verde Pulso | Execução |
| **DISCIPLINE** | O Pulso como **linha única contínua de 6 segmentos**, sem interrupção, fechada nas duas pontas. | Verde Pulso | Execução |
| **EXPLORER** | **3 fragmentos** do Pulso a 0°, 45° e 90°, partindo de um nó comum. Divergência. | Verde Pulso | Execução |
| **COMEBACK** | O Pulso **interrompido por um vão de 6u**, retomando **em amplitude cheia**. A retomada é maior que a interrupção. | **Coral Vivo** | Humano |
| **MILESTONE** | O Pulso terminando em **ponto sólido de diâmetro 2×** o padrão, com o número em Archivo tabular ao lado (`90`, `365`). | **Coral Vivo** | Humano |
| **COMMUNITY** | **3 traços de Pulso entrelaçados** em roseta de simetria rotacional de 120°. | **Coral Vivo** | Humano |
| **MOVIVO** | O **símbolo íntegro**, sólido, **Ônix sobre Óssea** — inversão, como o ICON. Sem anel. | Ônix/Óssea | O reconhecimento da própria marca. O mais raro. |

**Regras de exibição:**
- Máximo **6 reconhecimentos** visíveis simultaneamente numa peça; acima disso, `+N` em `--culture-label`. Uma parede de badges parece jogo de celular e destrói a raridade.
- Reconhecimentos **nunca** se misturam com o badge de status na mesma fileira. Status vem sozinho, acima, maior (1,4×).
- **Nenhum badge tem "nível 2/3/4".** Nada de `CONSISTENCY III`. Repetição vira contador discreto (`×3`) em `--culture-label`, ao lado, nunca dentro do círculo.
- **Guardrail obrigatório:** nenhum badge pode ser conquistado por volume absoluto de treino, dias seguidos sem descanso, ou treinar em dia de dor/lesão. `DISCIPLINE` mede **aderência ao protocolo próprio**, e o protocolo inclui deload e descanso. Um badge que premie treinar machucado é uma violação de marca, não só de produto.

---

## 5. Sistema de cards compartilháveis

O ativo de crescimento mais importante da tese do fundador (§36–37 do documento mestre). Uma pessoa posta uma imagem porque ela **a faz parecer bem**, não porque a marca pediu. Toda a especificação abaixo serve a isso.

### 5.1 Formatos

| Formato | Dimensão | Onde |
|---|---|---|
| **Primário — Story** | **1080 × 1920 (9:16)** | Instagram Stories, WhatsApp Status, TikTok. É onde a peça de fato circula. |
| Secundário — Feed | 1080 × 1350 (4:5) | Instagram feed |
| Terciário — Quadrado | 1080 × 1080 (1:1) | Comunidade WhatsApp, foto de perfil, LinkedIn |

**Desenhe primeiro no 9:16.** Os outros dois são reduções documentadas dele, não layouts independentes.

### 5.2 Grid (9:16)

- **8 colunas.** Margem lateral **96px** (8,9% da largura). Gutter **24px**. Coluna = 87px.
- **Baseline de 24px.** Todo elemento assenta em múltiplo de 24.
- **Zonas mortas obrigatórias:** **top 240px** e **bottom 240px**. É onde o Instagram desenha a barra de perfil e a barra de resposta. Nada estrutural, nenhum número, nenhuma assinatura ali. Este é o erro nº 1 de card de marca e é 100% evitável.
- **Área útil real: 1080 × 1440px**, entre y=240 e y=1680.

### 5.3 Anatomia (9:16) — de cima para baixo

| # | Elemento | Y | Especificação |
|---|---|---|---|
| 1 | **Faixa de sistema** | 240–288 | `MOVIVO CLUB · SEASON 08` — Archivo 600, 26px, tracking +8%, Névoa a 60%. Alinhado à coluna 1. |
| 2 | **Categoria** | 400–460 | `MOVIVO RUN` — Archivo 700, 56px, tracking +2%, **Verde Pulso** (ou cor da Season). Coluna 1. |
| 3 | **ZONA DO DADO** | 560–1180 | **32% da altura do card.** O número herói: Archivo 800 tabular, **240px**, entrelinha 0,86, Névoa. A unidade (`KM`) em Archivo 600, **40px**, tracking +8%, Musgo-claro `#A8BDB2`, **alinhada à linha de base do numeral** (não centralizada, não sobrescrita). Alinhamento à esquerda, coluna 1. |
| 4 | **Linha de dado secundário** | 1240–1400 | Até **3** métricas em linha, cada uma um par empilhado: valor Archivo 700 tabular 48px / rótulo Archivo 600 caps 12px tracking +8% Musgo-claro. Ex.: `100% ADERÊNCIA` · `52:14 TEMPO` · `S08 SEASON`. |
| 5 | **A TIRA DO PULSO** | 1440–1536 | 888 × 96px. **7 barras verticais** (uma por dia da semana): largura 24px, gap 12px, raio 12px, altura proporcional à aderência do dia. Cumprido = **Verde Pulso**; não cumprido = **Musgo a 24%**. |
| 6 | **Assinatura** | 1600–1656 | Símbolo Pulso (56px de altura) + wordmark `movivo` (altura de caixa 32px) ao lado, gap 20px. Coluna 1. **Só isso.** |

**A Tira do Pulso é o elemento mais importante da peça depois do número.** É ela que faz o card ser inconfundivelmente MOVIVO **e** carregar informação verdadeira ao mesmo tempo. Não é ornamento: é o dado da semana desenhado com a forma da marca. Um card com logo grande é publicidade; um card com um gráfico proprietário é um troféu.

### 5.4 Solos permitidos

1. **Ônix chapado `#0B0D0C`** — padrão. Sempre funciona, sempre passa contraste.
2. **Foto do membro** — foto a 100%, com **scrim Ônix em gradiente vertical: 0% de opacidade em y=40% da altura → 88% de opacidade em y=100%**. Zero blur (blur lê barato). Regra: a **zona do dado nunca** fica sobre foto não gerenciada — o número herói só existe dentro da região do scrim ≥ 70%.
3. **Artwork da Season** (§6.3) — a textura generativa da temporada, sempre a ≤ 24% de opacidade sobre o Ônix.

### 5.5 O que NUNCA entra num card

Preço · CTA ("baixe agora", "assine") · URL · QR code · logo de app store · texto do selo CREF · qualquer chamada comercial · logo maior que 6% da área · mais de um número herói · emoji · moldura · sombra projetada.

**Racional:** o próprio fundador escreveu (§38) que a marca não deve dizer o que o membro é. Um card com CTA transforma a conquista da pessoa em anúncio da empresa — e a pessoa deixa de postar. O crescimento vem de a peça ser bonita o bastante para ser exibida, não de ela vender. **A marca aparece; ela não fala.**

### 5.6 Teste de aprovação — 4 critérios objetivos

Um card só é liberado se passar nos quatro:

1. **Legibilidade em miniatura:** o número herói é lido a **15% de zoom** (thumbnail da bandeja de stories).
2. **Um herói só:** existe exatamente **um** número acima de 100px. Se há dois, não há nenhum.
3. **Marca ≤ 6% da área.** Some a área do símbolo + wordmark + faixa de sistema. Passou de 6%, é anúncio.
4. **Sobrevive ao recorte:** cortado para 1:1 a partir do centro, o número e a assinatura continuam inteiros.

### 5.7 As cinco variantes obrigatórias no MVP

| Variante | Número herói | Dado secundário |
|---|---|---|
| **Treino concluído** | Volume ou duração (`52:14`) | Exercícios · Séries · RPE médio |
| **Semana fechada** | `100` + unidade `POINTS` | Treinos · Aderência · Season |
| **Season encerrada** | Posição (`#12`) ou `100%` | Semanas · Treinos · Melhor sequência |
| **Conquista desbloqueada** | *Nenhum* — o **badge em 480px** ocupa a zona do dado | Nome do reconhecimento + data |
| **Marco** (`MOVIVO 90`, `YEAR ONE`) | `90` / `365` + `DAYS` | Data de entrada · Treinos totais · Status |

**Nota de sistema para o `100 POINTS`:** o enquadramento do fundador — **`100 POINTS = 100% COMMITTED`** — é a melhor ideia de dado do documento mestre e resolve sozinha a acusação de que ranking premia quem treina mais. Visualmente ele deve aparecer sempre como **par**: `100` em `--metric-xl` e `100% COMMITTED` logo abaixo em `--culture-label`. O número sozinho é vaidade; o par é a filosofia.

