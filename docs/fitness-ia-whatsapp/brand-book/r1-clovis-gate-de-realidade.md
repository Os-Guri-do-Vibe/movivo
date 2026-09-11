# RODADA 1 — Clóvis (Director Venture Research & Product Strategy)
## Gate de Realidade do MOVIVO BRAND BOOK

**Data:** 2026-09-10
**Pasta do projeto:** `docs/fitness-ia-whatsapp/`
**Rodada:** 1 (Fundações) — documento de abertura da discussão do Brand Book
**Papel nesta rodada:** eu **não escrevo o brand book**. Eu defino o que dele é defensável, o que é fantasia de fundador, e em que ordem e sob quais condições cada camada pode existir. Os demais especialistas constroem em cima deste veredito.
**Documentos-base lidos:** `00-briefing-compartilhado.md`, `MOVIVO_Documento_Mestre.md` (1.688 linhas, íntegra), `01-relatorio-clovis.md` (Rev. 2), `22-relatorio-clovis-retencao-gamificacao.md`, `02-relatorio-gabriel.md`, `07-relatorio-eduardo.md`, `CLAUDE.md`.

---

# 1. VEREDITO

## 1.1 Tese central submetida

> "A MOVIVO pode democratizar o acesso (R$79,90) e ainda assim construir uma marca de percepção premium, com status conquistável e comunidade aspiracional."

## 1.2 VEREDITO: **VALIDADO COM RESSALVAS**

A tese central é **estruturalmente correta e sustentada por evidência de mercado**. Não é wishful thinking do fundador. Existe um mecanismo replicado e documentado — status conquistado por **comportamento**, não comprado por **dinheiro** — e ele é justamente o mecanismo que **não** depende de preço alto. Strava, Duolingo, Gymshark e Nike Run Club operam exatamente assim. A formulação do fundador ("qualquer pessoa pode entrar; determinados status precisam ser conquistados") é, sem exagero, a descrição literal do mecanismo que funciona.

**Mais do que validada, a camada de marca passou a ser obrigatória.** O preço subiu de R$39 para R$79,90 (+105%) sem qualquer teste de disposição a pagar. A R$79,90, a MOVIVO deixou de ser "quase de graça" e passou a ser **um add-on de 50–67% do valor de uma Smart Fit** (R$119,90–R$159,90/mês), que o usuário paga **por cima** da academia. Um preço que dobrou sem uma camada de valor percebido correspondente é um aumento nu. **A camada de marca/comunidade não é luxo: é o que torna R$79,90 defensável.** O fundador está certo — por uma razão que ele não enunciou.

## 1.3 As sete ressalvas nomeadas

| # | Ressalva | Natureza |
|---|---|---|
| **R1** | **O preço R$79,90 não foi validado por ninguém.** Nem por mim (validei a faixa R$29–59), nem por Eduardo (modelou R$39/99/349). É uma mudança de +105% baseada em decisão, não em teste. Toda a matemática de LTV/CAC do pipeline foi refeita neste documento (§6), mas a **disposição a pagar** continua sem evidência. | Bloqueadora de precificação, não de marca |
| **R2** | **Eventos de 500–2.000 pessoas e o MOVIVO FESTIVAL são fantasia no horizonte de 24 meses.** Custo real: R$150–1.500 por participante no Brasil. Um evento de 1.000 pessoas a R$300/cabeça = R$300.000 = a contribuição anual de **385 assinantes**. Nenhuma startup bootstrapada com 4 devs e 1 CREF produz isso. Ver §5.7. | **NÃO VALIDADO** no horizonte atual |
| **R3** | **Ranking e Season abaixo de massa crítica destroem prestígio em vez de criar.** Há matemática dura aqui (Drèze & Nunes; regra 90-9-1). Um ranking de 20 pessoas em que os mesmos 3 vencem sempre desmotiva 17. Gate numérico explícito em §5.3. | Ressalva de sequenciamento |
| **R4** | **A camada de marca cria expectativa que o produto ainda não entrega.** O documento mestre promete clube, seasons, drops, eventos, festival e loja. O produto hoje é um protocolo por WhatsApp + um grupo + 100 pontos. **A marca não pode anunciar a camada N+2.** | Ressalva de comunicação |
| **R5** | **Gamificação em produto de saúde tem risco clínico e de responsabilização, agravado pelo selo CREF.** Revisão de 38 estudos (Flinders, 2025) associa uso de apps de fitness a comportamento alimentar desordenado e exercício excessivo, citando nominalmente **leaderboards, streaks e troféus** como mecanismos implicados. Numa marca com Responsável Técnico nomeado, isso deixa de ser risco reputacional e vira risco jurídico. Guardrails duros em §7.4. | Ressalva de segurança |
| **R6** | **A arquitetura de comunidade descrita é tecnicamente impossível no canal atual.** A Groups API do WhatsApp Business Platform limita grupos a **8 participantes** e cobra por mensagem. O grupo atual roda fora da plataforma oficial. Isso força uma arquitetura de comunidade específica (§5.1) — e nenhum relatório do pipeline tratou disso. | Ressalva operacional (nova) |
| **R7** | **"Não priorizar pessoas sem disciplina" é auto-sabotagem de funil**, não segmentação. Não é um segmento identificável, contradiz a proposta de valor e contradiz o valor #6 declarado pelo próprio fundador. Posição completa e reformulação em §8.3. | **NÃO VALIDADO** — recomendo reverter |

## 1.4 Vereditos por camada (resumo executivo)

| Camada ambicionada | Veredito | Quando |
|---|---|---|
| Identidade de membro ("Eu sou MOVIVO") | **VALIDADO** | Agora |
| Badges digitais / marcos / cards compartilháveis | **VALIDADO** — melhor relação evidência/custo do documento inteiro | Agora |
| Escada de status conquistável (ACTIVE→CORE→ELITE→ICON) | **VALIDADO COM RESSALVA** — publicar cedo e **vazia**; critérios ancorados em tempo | Agora (vazia), popular ao longo de 12 meses |
| Comunidade curada / MOVIVO CLUB | **VALIDADO COM RESSALVA** — exige arquitetura nova (§5.1) e moderação com risco CREF | 150+ pagantes |
| MOVIVO SEASON / ranking | **VALIDADO COM RESSALVA DURA** — gate de ≥300 elegíveis, opt-in, por categoria | 300+ ativos |
| Recompensas físicas (kit de marco) | **VALIDADO COM RESSALVA** — só com tenure ≥6 meses e cap de volume | 300+ pagantes |
| Drops de produto / MOVIVO STORE | **VALIDADO COMO ARTEFATO, NÃO VALIDADO COMO NEGÓCIO** — um drop inteiro de 100 peças gera menos margem do que reter 5 assinantes (§5.6) | 1.000+ pagantes, sob demanda |
| MOVIVO EXPERIENCE (20–150 pessoas) | **VALIDADO** | 200+ pagantes numa mesma região metropolitana |
| MOVIVO EXPERIENCE (500–2.000 pessoas) | **NÃO VALIDADO** hoje | ≥5.000 pagantes **e** patrocínio ≥50% |
| MOVIVO FESTIVAL | **NÃO VALIDADO** hoje | ≥20.000 pagantes **ou** patrocínio ≥70% — realisticamente ano 4–5 |

---

# 2. Contexto recebido e como ele muda meu trabalho anterior

Do documento mestre, três coisas mudaram materialmente em relação ao que eu validei em `01-relatorio-clovis.md`:

1. **Preço:** R$39 → R$79,90 (+105%). Muda LTV, muda posicionamento competitivo, muda expectativa.
2. **Ambição de escopo:** de "SaaS de treino com IA" para "marca de lifestyle com clube, seasons, drops, eventos e festival".
3. **Comunidade e pontos deixaram de ser hipótese e viraram ativos existentes** — o grupo de WhatsApp existe, o sistema de 100 pontos existe. Isso barateia enormemente a fase de teste.

O que **não** mudou e continua valendo integralmente:
- Veredito de negócio `VALIDADO COM RESSALVAS` do relatório 01.
- O vetor de risco da MOVIVO (lesão por execução em musculação) é **maior** que o do benchmark Zyla.
- A regra de ouro de unit economics: maximizar conversas iniciadas pelo usuário, minimizar templates proativos — e ela **endurece** a partir de 01/10/2026, quando mensagens de serviço deixam de ser gratuitas.
- Todo o veredito do relatório 22: **não construa um sistema de gamificação; construa uma conversa comportamentalmente competente.** Nada neste documento revoga aquilo. O que este documento faz é mostrar **onde a camada de cultura escapa daquela restrição** — e a resposta é: ela escapa exatamente onde não usa o canal tarifado e não recompensa auto-report.

---

# 3. Evidência de mercado: quem construiu cultura sobre produto acessível

Esta seção responde à pergunta "isso já foi feito?" com casos e números, não com opinião.

## 3.1 O dado brasileiro que sustenta a tese do fundador (e é o mais forte de todos)

O comportamento que o fundador quer construir **já está acontecendo no Brasil, no ICP dele, agora**:

| Dado | Valor | Fonte |
|---|---|---|
| Crescimento de **clubes de corrida no Brasil** (Strava Year in Sport 2025) | **8,6×** — contra média global de **3,5×** | Strava via Go Outside / MKT Esportivo |
| Criação de clubes de corrida no Brasil no Strava, em um ano | **+800%** | MKT Esportivo |
| Crescimento de clubes de ciclismo no Brasil | 3,6× | Strava |
| **Geração Z** — inscrições em maratona no Strava Brasil, 2025 | **+123%** | Strava Year in Sport 2025 |
| Posição do Brasil no Strava | "o país mais social do Strava" | Go Outside |
| Crescimento esperado do mercado de eventos esportivos BR | +17% em um ano | Ticket Sports |

**Leitura estratégica:** a hipótese de que "brasileiro da Gen Z quer pertencer a um clube de treino" não precisa ser validada — ela **já foi validada pelo mercado**, com magnitude 2,5× superior à média mundial. Isso é o achado mais favorável ao fundador em todo este documento e deve ser dito com todas as letras: **a janela existe e está aberta agora.**

Contra-leitura obrigatória, igualmente importante: esse boom é de **corrida**, que é gratuita, coletiva por natureza, acontece na rua e cujo artefato social (o ritmo, a distância, a medalha) é público e verificável. **Musculação não tem nenhuma dessas propriedades.** Treinar é individual, indoor, em horários dessincronizados, e o resultado não é publicamente verificável. A MOVIVO não herda esse boom automaticamente — ela precisa **importar o mecanismo** (encontro, ritual, marco compartilhável) para uma prática que não o tem nativamente. Esse é exatamente o trabalho de marca desta rodada.

## 3.2 Os casos que conseguiram — e o mecanismo estrutural de cada um

### Gymshark — o caso mais próximo do que o fundador quer

| Fato | Dado |
|---|---|
| Receita (ano até 31/07/2025) | **£646 milhões**, 13º ano consecutivo de crescimento |
| Receita em 2015 | £6,7M · em 2017 (após HQ e equipe): **£12,8M** |
| Primeiro grande evento | **Stand no BodyPower Expo 2013** — evento de terceiro, não próprio. Ben Francis esvaziou a conta da empresa para pagar o espaço. Estande esgotou no primeiro dia; **~£30.000 em pedidos em 30 minutos** |
| Primeiro evento próprio | **Gymshark Lifting Club pop-up tour, 2017** — quatro anos e ~£12,8M de receita depois |
| Primeira academia própria | 2025, a £646M de receita |
| Desafio de comunidade (#Gymshark66) | **45,5 milhões de views, 1,9 milhão de likes** (maio/2024). Custo de produção: essencialmente zero — os participantes produzem o conteúdo |

**Mecanismo:** produto → creators → **estande no evento de outra pessoa** → evento próprio pequeno → tour → academia. A Gymshark **nunca começou pelo festival**. Ela começou pagando por um metro quadrado no evento alheio. E o ativo cultural mais eficiente que ela tem (#Gymshark66) é um desafio de 66 dias com **três hábitos escolhidos pelo próprio usuário** — custo marginal zero, escala infinita, e o participante é quem produz a prova social.

> **Aplicação direta à MOVIVO:** o análogo do BodyPower é presença em eventos de corrida/fitness já existentes no Brasil (que estão crescendo 17% ao ano) — não produzir o próprio. E o análogo do #Gymshark66 já existe dentro da MOVIVO: o sistema de 100 pontos.

### Strava — o mecanismo de status mais eficiente já construído

| Fato | Dado |
|---|---|
| Receita | ~US$338M (2024) → **~US$500M (2025)**, +48% |
| Usuários | ~150M (meados 2025) → ~180M (fim 2025) |
| Retenção de assinantes | **80–90%** |
| Origem da receita | ~90% de assinaturas (US$11,99/mês) |
| Local Legends | status para quem tem mais *efforts* num segmento em **90 dias** — visível a todos, histograma completo só para assinantes |

**Mecanismo — e é o mais importante deste documento:** o Local Legend custa **zero** para a Strava e é **estruturalmente escasso** porque só existe **um por segmento por janela de 90 dias**. A escassez não vem do preço nem de estoque; vem da **regra**. Além disso é **hiperlocal** — você não compete com o Brasil, compete com quem corre no seu quarteirão. Isso significa que o status funciona **desde o primeiro dia, com pouquíssimas pessoas**, porque a unidade de competição é minúscula.

> **Aplicação direta à MOVIVO:** este é o antídoto exato para a ressalva R3. Um ranking geral precisa de 300+ pessoas para ser prestigioso. Um **status por unidade pequena** (por cidade, por objetivo, por coorte de entrada, por faixa de protocolo) funciona com 20. A MOVIVO deve copiar a **arquitetura de escopo** do Local Legend, não a mecânica de leaderboard global.

### Duolingo — status sobre produto gratuito

| Fato | Dado |
|---|---|
| DAU (Q3/2025) | **>50 milhões**, +36% YoY · MAU >116M · assinantes pagos 11,5M (+34%) |
| Usuários com streak ≥7 dias | **>60% dos DAU** |
| Efeito de ligas | quem entra numa liga passa **~20% mais tempo** no app |
| Streak wager | **+14% de retenção D14** |

**Mecanismo:** o produto é grátis; o **status é o produto pago emocionalmente**. Ligas são coortes de ~30 pessoas — de novo, **unidade pequena**. E aqui vem a ressalva que já registrei no relatório 22 e mantenho: o número famoso "retenção de 12% → 55%" circula em blogs de fornecedores de gamificação, sem fonte primária. Os números de DAU e assinantes acima são de relatórios da empresa e são confiáveis; a atribuição causal à gamificação é narrativa, não evidência controlada.

### Whoop — percepção premium com hardware gratuito

| Fato | Dado |
|---|---|
| Bookings anualizados 2025 | **US$1,1 bilhão**, +103% YoY, fluxo de caixa positivo |
| Membros | 2,5M+ (mar/2026) |
| Modelo | hardware **grátis**, assinatura US$199–359/ano; ~85% da receita em assinatura |
| LTV:CAC | ~4,5× · retenção >80% no core |
| **Incidente de confiança** | maio/2025: mudança na política de upgrade gratuito de hardware gerou reação negativa forte — "a confiança da assinatura é frágil e a percepção de promessa quebrada erode anos de equity de marca rapidamente" |

**Mecanismo:** dar de graça o que a concorrência vende, e cobrar pelo acompanhamento contínuo. É, estruturalmente, a mesma jogada da MOVIVO (não cobrar por "app", cobrar por acompanhamento). **A lição que importa é o incidente:** numa marca de assinatura com camada de pertencimento, **a promessa retroativa é o ativo mais frágil que existe**. Isso é diretamente aplicável à ressalva R4 e ao desenho de status: **status prometido e depois alterado é o pior erro possível.**

### Tracksmith — premium de nicho sem escala

Receita triplicou desde 2019; opera "Trackhouses" em Boston, Londres e Brooklyn; recusa deliberadamente diversificar para além da corrida amadora. Dado relevante do setor: marcas de corrida com modelo comunitário reportam **~68% de retenção após o primeiro ano contra ~41% de marcas convencionais** — número de relatório setorial comercial, tratado como ordem de grandeza.

**Mecanismo:** foco obsessivo, editorial próprio, clubhouse como palco. **Não replicável pela MOVIVO agora** — Tracksmith cobra preço premium; a MOVIVO cobra preço de acesso. O que é replicável é a **recusa a diversificar**: a MOVIVO é treino. Nutrição, corrida, yoga e mobilidade (§50 do documento mestre) são expansões de ano 3+, não territórios de marca de ano 1.

### Ladder — o concorrente estrutural mais próximo, e o alerta

App de musculação por assinatura organizado em **"teams" com treinadores nomeados**. Captou **US$105M** (US$15M Série B + **US$90M de go-to-market** da General Catalyst, num acordo em que a investidora paga 80% do gasto mensal de marketing). Meta: 150 mil membros pagantes, US$100M de ARR.

**Alerta que isso representa:** o modelo "treino de força + coach com nome + time" está sendo capitalizado com US$90M **só de aquisição**. A MOVIVO não vai ganhar essa disputa no CAC. **Ela só ganha no que o dinheiro não compra: cultura local, língua, canal (WhatsApp) e o selo CREF.** Isso reforça, e não enfraquece, a decisão de investir em marca/comunidade.

### Nike Run Club / After Dark Tour — o padrão-ouro do evento de marca

O After Dark Tour reuniu **mais de 50.000 mulheres em sete corridas em cinco continentes** na primeira edição (2025), com plano de treino, coach e run clubs locais integrados. É exatamente a visão do fundador para o MOVIVO FESTIVAL.

**É também a prova de por que ela é fantasia hoje:** isso é operado por uma empresa de ~US$50 bilhões de receita, com estrutura de eventos global, e Nike já havia rodado uma série de corridas femininas entre **2005 e 2015** antes de relançá-la. A capacidade é acumulada em década, não comprada.

## 3.3 Os casos que tentaram e sangraram — e por quê

### Rapha Cycling Club — o caso de fracasso mais instrutivo para a MOVIVO

| Fato | Dado |
|---|---|
| Resultado operacional 2024 | **prejuízo de £17,2 milhões** — oitavo ano consecutivo de prejuízo (2023: £21,2M) |
| Clubhouses | **fechamento de cinco unidades** (Boulder, Chicago, Manchester, Miami, Seattle), a partir de janeiro |
| Mensalidade do clube | reduzida de **£135 para £70**, com corte do café grátis |

A Rapha é literalmente o experimento "clube premium com identidade, clubhouses, rides organizadas, drops e cultura" executado por profissionais, com capital, em um esporte com comunidade nativa. **Deu prejuízo por oito anos seguidos e está encolhendo a infraestrutura física.**

**Mecanismo do fracasso:** a Rapha pagou pelo **palco** (imóvel, staff, café) com custo fixo por unidade, e tentou recuperar via produto e mensalidade. Custo fixo de comunidade não escala com a comunidade — ele **precede** a comunidade e precisa ser pago mesmo quando ninguém aparece.

### Peloton — o colapso da tese "comunidade retém"

| Fato | Dado |
|---|---|
| Assinaturas Connected Fitness (Q2 FY2026) | 2,661M, **−214 mil / −7% YoY** |
| Medição posterior | 2,553M, **−8,8% YoY** |
| Churn mensal | subiu de **1,8% para 2,2%** |
| Receita FY2026 | US$2,446 bi · primeiro lucro líquido anual da história (US$63M) — obtido por **corte de custos**, não por crescimento |

A Peloton tem instrutores-celebridade, leaderboard ao vivo, high-fives, milestones, hashtags e grupos de Facebook com centenas de milhares de membros — **a comunidade mais elaborada já construída em fitness.** A base encolhe há anos.

**Conclusão que precisa ser dita sem anestesia:** **comunidade não impede churn quando o valor do produto principal cai ou quando o preço perde justificativa.** A Peloton prova que a camada de pertencimento é **multiplicadora** de um produto que já retém — nunca **substituta** de um produto que não retém. Isto é o argumento central contra tratar o brand book como estratégia de retenção.

### SoulCycle / boutique fitness — o fim da tese de status pago

Nova onda de fechamentos de estúdios em junho/julho de 2026 (San Diego, Santa Monica, Denver, Nova York), após 19 fechamentos em 2022 por "mercados supersaturados". Aulas operando com **10 a 16 pessoas** em salas de capacidade muito maior. A aula de US$36+ virou alvo fácil de corte no orçamento.

**Mecanismo:** status ancorado em **preço** colapsa na primeira contração de renda. Status ancorado em **comportamento** não colapsa — porque não custa nada manter. **Esta é a evidência definitiva a favor da formulação do fundador** ("a exclusividade deve vir de comportamento, não de poder aquisitivo"). Ele está certo, e SoulCycle é a prova por contraste.

## 3.4 As cinco leis que destilo desses casos

Estas cinco leis são meu principal insumo analítico para o brand book. Todo o sequenciamento de §5 deriva delas.

> **Lei 1 — A empresa paga pelo palco; os membros produzem o espetáculo.**
> Gymshark66: 45,5M de views, custo ~zero. Local Legend: status escasso, custo ~zero. Rapha: clubhouses com custo fixo, £17,2M de prejuízo. **Qualquer camada de comunidade com custo fixo por membro é passivo. Qualquer camada com custo fixo único e conteúdo produzido por membro é ativo.**

> **Lei 2 — Escassez vem da regra, não do preço nem do estoque.**
> A escassez precisa ser **real e verificável** — Local Legend só existe um; MOVIVO YEAR ONE só existe depois de 365 dias. Escassez fabricada ("vagas limitadas!") é detectada e destrói confiança. O documento mestre já diz isso (§31) e está correto.

> **Lei 3 — A unidade de competição precisa ser pequena.**
> Strava: um segmento. Duolingo: liga de ~30. Isso é o que permite status com base pequena. **Ranking global exige massa; ranking local não.**

> **Lei 4 — A ordem é sempre Produto → Ritual → Símbolo → Encontro → Objeto. Ninguém começa pelo objeto ou pelo encontro grande.**
> Gymshark: 4 anos até o primeiro evento próprio; 13 anos até a academia. Nike: 10 anos de corridas femininas antes do After Dark. **O documento mestre inverte essa ordem em vários pontos e é aí que ele vira fantasia.**

> **Lei 5 — Comunidade é multiplicador de retenção, nunca substituto dela.**
> Peloton tem a melhor comunidade do setor e perde 8,8% da base ao ano. **Se o protocolo for ruim ou a IA não entender o usuário, nenhum badge salva.** O brand book não pode ser usado como plano de retenção — esse plano é o Tier 0 do relatório 22 e é responsabilidade de Lucas e Victor.

---

# 4. A matemática do status (por que existe um piso de escala)

Esta seção é curta e é a base do gate numérico. É onde o "ranking com 20 pessoas" morre.

**Drèze & Nunes (2009), *Journal of Consumer Research* — "Feeling Superior":**
- Aumentar o número de pessoas no tier de elite **dilui** a percepção de status.
- Adicionar um tier **subordinado** (abaixo) **aumenta** a percepção de status de quem está acima.
- Tiers abaixo do segundo não afetam quem está no topo, mas fazem o tier imediatamente acima se sentir mais elite.
- Quando **25–30% dos membros ativos** detêm status de elite, o efeito motivacional colapsa.

**Regra 90-9-1 (Nielsen / Nielsen Norman Group; origem em Will Hill, Bellcore):** em comunidades online, ~90% consomem, ~9% contribuem, ~1% cria. As proporções variam com design e barreira de entrada, mas a assimetria é universal.

**Tradução direta para a MOVIVO:**

| Base ativa | Criadores esperados (~1%) | Contribuidores (~9%) | Top 10 = % da base | Veredito para ranking |
|---|---|---|---|---|
| 50 | 0–1 | ~5 | **20%** | Status diluído. **Veto.** |
| 100 | ~1 | ~9 | **10%** | Limítrofe. Conversa depende da equipe postar → é broadcast, não comunidade. **Veto.** |
| 200 | ~2 | ~18 | **5%** | Piso mínimo defensável |
| **300** | **~3** | **~27** | **3,3%** | **Gate recomendado.** ~27 contribuidores é o mínimo para conversa diária autossustentada |
| 1.000 | ~10 | ~90 | 1% | Comunidade madura |

**Três decisões que caem direto dessa tabela:**

1. **Ranking geral só a partir de 300 elegíveis ativos.** Abaixo disso, ele destrói prestígio.
2. **A escada de status pode e deve ser lançada AGORA — vazia.** Se os critérios forem ancorados em **tempo** (90 dias, 180 dias, 365 dias), a escassez se autoimpõe: ninguém pode ser MOVIVO YEAR ONE antes de 365 dias existirem. Isso resolve simultaneamente (a) o problema de massa crítica, (b) o achado de Rewley et al. de que aversão à perda só opera sobre o que foi **conquistado**, nunca sobre o que foi **dotado**, e (c) o risco Whoop de alterar promessa retroativamente. **Publicar a escada vazia é a decisão mais elegante disponível.**
3. **Tiers de elite têm teto matemático:** ELITE ≤ **10%** da base ativa; ICON ≤ **1%**. Se em algum momento mais de 25% estiver em ELITE, o tier morreu e precisa ser recalibrado. Isso é regra operacional, não estética.

---

# 5. Custo real, complexidade e pré-requisito de escala de cada camada

Premissa financeira usada em todos os cálculos (derivada em §6): **margem de contribuição ≈ R$65/assinante/mês**; contribuição anual por assinante ≈ **R$780**.

## 5.1 Comunidade (o grupo que já existe) — e a restrição técnica que ninguém viu

**Custo:** R$0 de infraestrutura. **Mas:** moderação real custa 5–10h/semana a partir de ~300 membros. Isso é tempo de fundador ou de um moderador (R$1.200–2.500/mês em part-time).

**Restrição técnica não tratada em nenhum relatório do pipeline:**
- A **Groups API** do WhatsApp Business Platform está disponível para contas com Official Business Account, mas limita **8 participantes por grupo** e cobra **por mensagem**. Ela não serve como comunidade.
- Grupos de consumidor (fora da API) têm teto duro de participantes e degradam socialmente muito antes do teto — 500 pessoas num grupo único é ruído, não comunidade.
- O **WhatsApp Business App** limita listas de transmissão a **50 contatos**, e o destinatário precisa ter o número salvo.
- **Canais (Channels)** são gratuitos, com seguidores ilimitados, mas **unidirecionais, sem API e sem resposta em chat**.

**Conclusão operacional (decisão que eu fecho):** a arquitetura de comunidade da MOVIVO tem que ser de **três camadas separadas**:

| Camada | Função | Custo | Direção |
|---|---|---|---|
| **Canal MOVIVO** (WhatsApp Channel) | Broadcast de cultura: Season, marcos, chamadas, conteúdo | **R$0**, ilimitado | 1→N |
| **Grupos curados** (por cidade / objetivo / coorte de entrada) | Conversa real entre membros, teto de ~150–200 por grupo | R$0 + moderação | N↔N |
| **Canal 1:1 do Coach** (Business Platform API) | Produto: protocolo, dúvidas, check-in | **Tarifado**, e mais caro após 01/10/2026 | 1↔1 |

**Achado econômico relevante:** o Canal e os grupos são os **únicos canais proativos gratuitos** que a MOVIVO tem. Toda a mecânica de cultura (anúncio de Season, reconhecimento público, chamada para evento) deve viver **lá**, nunca no canal tarifado. Isso reconcilia integralmente a camada de cultura com a regra de ouro de unit economics do relatório 22 — e é o argumento que faz a Season ser **barata** onde a gamificação 1:1 seria cara.

**Risco específico e sério (novo, nenhum agente tratou):** um grupo de alunos em que membros trocam orientação de treino entre si é, ao mesmo tempo, (a) superfície de **risco clínico** (leigo orientando execução de exercício), (b) exposição de **exercício ilegal da profissão** dentro de um espaço operado por PJ registrada no CREF com RT nomeado, e (c) tratamento de **dado sensível de saúde** compartilhado entre titulares (LGPD art. 11). **Exige regras de convivência explícitas e moderação ativa desde o dia 1.** Passo isto formalmente a Alexandre.

**Pré-requisito de escala:** 0 (já existe). **Grupos segmentados:** ≥150 pagantes.

## 5.2 Sistema de pontos / "100 POINTS = 100% COMMITTED"

**Custo:** R$0 incremental — já existe. O reenquadramento conceitual é copy, não engenharia.

**Veredito:** o enquadramento "você não compete contra a rotina dos outros; compete contra a sua própria promessa" é **excelente e eu o endosso sem ressalva**. Ele resolve, de uma vez: (a) a desmotivação de leaderboard documentada na literatura de gamificação em saúde, (b) a incompatibilidade clínica de premiar volume em musculação (§4.2 do relatório 22), e (c) o valor #6 do fundador.

**Ressalva que mantenho do relatório 22 e que é inegociável:** os 100 pontos derivam de **auto-report** de treino concluído. Recompensar auto-report cria incentivo direto a mentir, e o auto-report é o **input que ajusta carga e periodização**. Portanto:

> **Regra dura:** nenhuma recompensa material (kit, drop, prêmio, desconto) pode ser condicionada a **conclusão de treino auto-reportada** enquanto não houver verificação independente. Reconhecimento simbólico, sim. Prêmio de valor econômico, não.

## 5.3 MOVIVO SEASON e ranking

**Custo direto:** copy + operação (~4–8h/mês) + premiação. Se a premiação for **reconhecimento e acesso** (prioridade 1 e 2 da lista do fundador em §28 do documento mestre — e ele está certo na ordem), o custo é ~R$0.

**Complexidade operacional:** média. Precisa de apuração confiável, comunicação de início/fim, tratamento de empate, e política de contestação. Uma Season mal apurada gera conflito público na comunidade.

**Riscos:** dilução de status (§4); LGPD art. 11 se o ranking for público e nominal; indução a treinar além do protocolo.

**Desenho que eu recomendo (e que resolve o gate de escala):** copiar a **arquitetura de escopo do Strava Local Legend**, não a de leaderboard global.
- Ranking **por categoria**, nunca geral: CONSISTENCY, COMEBACK, PROGRESSION.
- Ranking **por coorte de entrada** (quem começou no mesmo mês) — cria unidade pequena automaticamente e é justo.
- **Opt-in explícito** com consentimento específico e destacado para exibição nominal (LGPD art. 11).
- Quem não faz opt-in participa com **métricas individuais privadas** (Personal Best, Personal Streak), que é onde está a maior parte do valor comportamental de qualquer forma.

**Pré-requisito de escala:** **≥300 membros ativos elegíveis** para ranking com exibição pública. Métricas individuais e Season "contra si mesmo": **agora, sem gate**.

## 5.4 Badges, marcos e artefatos digitais

**Custo:** R$0–baixo. Geração de card de imagem personalizado é trabalho de Felipe/Sofia, uma vez, e roda automático depois.

**Veredito: esta é a camada de melhor relação evidência/custo do documento inteiro, e deve ser a primeira a existir.** Razões:
1. Funciona com **n=1**. Não precisa de massa crítica — é a relação do membro com a própria história.
2. É o único artefato de status que **atravessa a fronteira do WhatsApp** (o membro posta no story). Sem ele, o ciclo de §34 do documento mestre (STATUS → SOCIAL → ASPIRATION → NEW MEMBER) simplesmente não fecha.
3. É a única forma de **testar a tese de identidade barato** (ver experimento E2 em §7).
4. É "competência percebida" (SDT) e não promessa de resultado — passa nos guardrails.

**Guardrail obrigatório:** nenhum badge pode implicar resultado ("30 dias, seu corpo já mudou"). Reconhece **comportamento e progressão objetiva de carga**, nunca estética.

**Pré-requisito de escala:** nenhum. **Fazer agora.**

## 5.5 Recompensas físicas (kit de marco)

**Custo real por kit entregue no Brasil:**

| Item | Custo |
|---|---|
| Camiseta streetwear (algodão 220–240 g/m², DTF/silk, lote 50–100) | R$35–60 |
| Embalagem + card impresso | R$5–10 |
| Frete (Brasil, unitário) | **R$25–35** |
| **Total por kit entregue** | **R$65–105** |

**O frete é o assassino silencioso.** Ele é ~35% do custo e não tem ganho de escala relevante no envio unitário.

**Enquadramento correto:** R$65–105 = **1,0 a 1,6 mês** de contribuição por assinante. Se dado a alguém no marco de **6 meses** (que já gerou R$390 de contribuição), o kit consome ~20% de um mês — perfeitamente aceitável, e provavelmente barato se prolongar a vida do assinante em ≥2 meses.

**Regras que eu fecho:**
- Kit físico **somente** com tenure ≥6 meses.
- **Cap de volume mensal** definido em orçamento (não em elegibilidade), para o custo nunca explodir com o crescimento.
- Nunca condicionado a auto-report de treino (§5.2).

**Pré-requisito de escala:** ≥300 pagantes (para o cap de volume caber no orçamento de §6.4).

## 5.6 Drops de produto / MOVIVO STORE — o cálculo que mata a tese como negócio

Simulação de um drop de **100 camisetas**:

| Linha | Valor |
|---|---|
| Custo unitário de produção | R$35–60 → **R$3.500–6.000** |
| Design, fotos, mockups, página | R$500–2.000 (ou tempo de fundador) |
| Preço de venda (faixa streetwear BR) | R$90–250 → uso **R$129** |
| Receita bruta (100% vendido) | **R$12.900** |
| Margem bruta | ~R$6.900–9.400 |
| Menos frete, embalagem, troca/devolução, taxas de pagamento, tempo | ~R$3.000–5.000 |
| **Lucro líquido realista por drop** | **~R$2.500–4.000** |

**Comparação decisiva:** R$2.500–4.000 é a contribuição anual de **3 a 5 assinantes**.

> **Um drop inteiro — com risco de estoque, capital de giro, logística, logística reversa e semanas de atenção de fundador — gera menos margem do que reter cinco assinantes.**

**Veredito: drop é VALIDADO como artefato de pertencimento e NÃO VALIDADO como linha de receita.** No estágio atual, MOVIVO STORE é uma distração com ROIC negativo quando se contabiliza o custo de oportunidade da atenção do time.

**Duas consequências que preciso registrar formalmente:**
1. **Se e quando houver drop, fazer sob demanda (pré-venda com meta mínima), nunca com estoque.** Isso zera o risco de capital de giro e transforma o drop em teste de demanda.
2. **Alerta tributário e societário para Eduardo e Alexandre:** vender **mercadoria** é atividade diferente de prestar **serviço**. Muda CNAE, pode mudar o anexo do Simples Nacional (comércio vs. serviço), gera obrigações de NF-e, substituição tributária e ICMS. A recomendação vigente de Eduardo (Simples Anexo III via Fator R) foi construída para uma empresa de serviço. **Vender camiseta pode quebrar aquela otimização.** Isto precisa ser respondido antes do primeiro drop, não depois.

**Pré-requisito de escala:** ≥1.000 pagantes **e** uma coorte identificada de ≥100 membros elegíveis (por status/tenure) que justifique a tiragem.

## 5.7 Eventos presenciais — onde a fantasia está concentrada

**Custo real no Brasil (referências de mercado de produção de eventos, 2026):**

| Porte | Custo/participante | Custo total | Equivale a (contribuição anual de N assinantes) |
|---|---|---|---|
| **Micro-encontro 20–40 pessoas** (treino em academia parceira + café) | R$100–250 | **R$2.000–10.000** | 3–13 assinantes |
| **Encontro 100–150 pessoas** | R$150–350 | **R$15.000–52.500** | 19–67 assinantes |
| **MOVIVO EXPERIENCE 500 pessoas** | R$150–600 | **R$75.000–300.000** | 96–385 assinantes |
| **MOVIVO EXPERIENCE 1.000 pessoas** | R$150–800 | **R$150.000–800.000** | 192–1.026 assinantes |
| **MOVIVO FESTIVAL (2.000+, multi-atração)** | R$250–1.500 | **R$500.000–3.000.000** | 641–3.846 assinantes |

Distribuição típica do orçamento no Brasil: espaço 30–40%, gastronomia 35–45%, AV e cenografia 15–25%, produção 10–15%. Em eventos de milhares de pessoas, **só o staff** (produção, recepção, credenciamento, segurança, brigadistas, limpeza, apoio técnico) custa de R$20 mil a mais de R$200 mil.

**E há custos que não aparecem em tabela de agência e que uma startup de 5 pessoas descobre tarde:** alvará, corpo de bombeiros, seguro de responsabilidade civil, ambulância e equipe de saúde em evento de atividade física, ECAD se houver música, e — o mais caro de todos — **o custo de responsabilização se alguém se lesionar num treino coletivo com a marca de uma empresa registrada no CREF com RT nomeado**.

**Vereditos:**
- **Micro-encontro (20–40): VALIDADO, faça já.** É barato, é o análogo do estande da Gymshark no BodyPower, e é o único teste real de se o pertencimento existe fora da tela.
- **500–2.000 pessoas: NÃO VALIDADO** com a estrutura atual. Gate: **≥5.000 pagantes E patrocínio/parceria cobrindo ≥50% do custo.**
- **FESTIVAL: NÃO VALIDADO.** Gate: **≥20.000 pagantes** (≈R$1,52M de MRR, R$18M de ARR — nesse patamar um festival de R$1–2M é 6–11% do ARR e é defensável) **ou** patrocínio cobrindo ≥70%. Realisticamente **ano 4–5**.

**A regra estrutural (Lei 1):** a MOVIVO deve, por muito tempo, **aparecer em eventos dos outros** — corridas de rua, expos de fitness, academias parceiras — em vez de produzir os próprios. O mercado de eventos esportivos brasileiro cresce 17% ao ano; há palco de sobra pago por outra pessoa.

---

# 6. Impacto no unit economics

## 6.1 Refazendo a conta com o preço novo

Eduardo modelou com ARPU de R$34. Com a tabela vigente (R$79,90 mensal, −5%/−10%/−15%), a conta muda substancialmente.

**ARPU misto** (mix hipotético 45% mensal / 25% trimestral / 15% semestral / 15% anual):
`0,45×79,90 + 0,25×75,91 + 0,15×71,91 + 0,15×67,92 =` **≈ R$76/mês**

**COGS por assinante/mês** (atualizado por mim para o cenário pós-01/10/2026):

| Item | Estimativa |
|---|---|
| LLM (com prompt caching) | R$0,55–1,05 |
| WhatsApp 1:1 (serviço tarifado + templates) | R$2,00–4,00 |
| Infra/cloud | R$0,50–1,00 |
| Meio de pagamento (~4,5% + fixa) | ~R$3,80 |
| Supervisão RT (alocada) | R$1,50–3,00 |
| **Total** | **R$8,35–12,85 → uso R$11** |

**Margem de contribuição: R$76 − R$11 = R$65/mês (≈85%).**

| Churn mensal | Vida média | **LTV** |
|---|---|---|
| 10% | 10,0 meses | R$650 |
| **8%** (meta atual) | 12,5 meses | **R$813** |
| 6% | 16,7 meses | R$1.085 |
| 5% | 20,0 meses | R$1.300 |

> **Observação para Eduardo:** o aumento de preço melhorou o unit economics de forma dramática — LTV base sai de R$306 para R$813 (+166%). Isso **cria o orçamento** para a camada de marca. Mas é orçamento condicionado: se o preço mais alto elevar o churn (e ele tende a elevar em ICP sensível a preço), o ganho evapora. **R1 continua sendo a ressalva número um.**

## 6.2 A pergunta central: a camada de comunidade ajuda ou destrói o LTV/CAC?

**Onde ela paga (quantificado):**

Seja **C** o custo da camada de marca/comunidade por assinante/mês. Com C = R$5/mês, a contribuição cai de R$65 para R$60. Para que o LTV não piore:

`60 × vida ≥ 813` → `vida ≥ 13,55 meses` → **churn ≤ 7,38%**

> **A camada de comunidade precisa reduzir o churn mensal em apenas 0,6 ponto percentual (de 8,0% para 7,4%) para se pagar integralmente.**

Esse é um obstáculo **baixo**. E o cenário de sucesso é assimétrico:

| Cenário | Churn | LTV com C=R$5 | Δ vs. base (R$813) |
|---|---|---|---|
| Camada não funciona | 8,0% | R$750 | **−R$63** (perda máxima) |
| Camada se paga | 7,4% | R$813 | R$0 |
| Camada funciona | 6,0% | **R$1.002** | **+R$189** |
| Camada funciona bem | 5,0% | **R$1.200** | **+R$387** |

**Perda máxima R$63/assinante; ganho plausível R$189–387/assinante. Assimetria de 3–6:1 a favor.** Com 300 pagantes, o cenário "funciona" vale **+R$56.700 de LTV agregado** contra um custo anual de R$18.000 (300 × R$5 × 12) — ROI ~3,1×.

**Esta é a justificativa financeira da camada de marca, e ela é sólida.** Note que ela **não** depende de a comunidade gerar receita própria (drops, ingressos) — depende só de reter.

**Onde ela sangra:**

1. **Eventos com custo por cabeça e sem patrocínio.** Um evento de 1.000 pessoas a R$300/cabeça consome a contribuição anual de 385 assinantes. É o único item da lista capaz de quebrar a empresa sozinho.
2. **Merch como loja.** Capital de giro, estoque, logística reversa, risco tributário — para um lucro equivalente a 3–5 assinantes/ano (§5.6).
3. **A ilusão de CAC.** Evento de comunidade atrai **membros existentes**, não novos. A Rapha construiu clubhouses e teve prejuízo por oito anos. **Não creditar aquisição a evento sem medição de coorte.** Se um evento gerar aquisição, será via **conteúdo do evento nas redes** (que é o mecanismo Gymshark), não via presença.
4. **Kit físico sem cap.** R$65–105 por kit é aceitável com tenure ≥6 meses e volume limitado; sem cap, cresce linearmente com a base e vira custo variável de 8–13% do ARPU.

## 6.3 Onde ela pode gerar receita (com honestidade sobre a magnitude)

- **Referral / CAC orgânico:** é aqui que o retorno real está, e Eduardo já identificou referral como o canal de menor CAC e maior LTV. Um card compartilhável que 15% dos membros postam é uma máquina de topo de funil de custo zero. **Isto é o Gymshark66 aplicado à MOVIVO.**
- **Patrocínio de evento:** viável a partir de ~500 pagantes concentrados numa região, com marcas de suplemento, bebida, academia. **Mas patrocínio de marca de suplemento numa marca com selo CREF exige análise de Alexandre** (associação de imagem com produto de saúde).
- **Drops:** irrelevante como receita (§5.6). Tratar como custo de marketing com recuperação parcial, não como linha de receita.

## 6.4 Orçamento de marca que eu recomendo (regra dura)

| Fase | Teto de gasto discricionário de marca/comunidade/recompensa | Regra adicional |
|---|---|---|
| Ano 1 (até ~1.000 pagantes) | **≤8% do MRR** | Evento acima de 150 pessoas exige patrocínio ≥50% |
| Ano 2 | ≤12% do MRR | Idem |
| Ano 3+ | ≤15% do MRR | Festival exige patrocínio ≥70% |

Com 300 pagantes (MRR ≈ R$22.800), 8% = **R$1.824/mês**. Isso paga: badges (R$0), moderação part-time, um micro-encontro por trimestre (R$8k/4 = R$2k/mês amortizado — já estoura, então alternar), e ~15 kits de marco/mês. **É apertado, e é essa a realidade que o brand book precisa respeitar.**

---

# 7. Riscos estratégicos da guinada de posicionamento

## 7.1 Canibalização do argumento de preço

**O risco é real e maior do que o fundador imagina, mas não é o que ele pensa.**

Não é que a marca premium torne R$79,90 caro. É que **R$79,90 é um add-on**:

| Item | Custo/mês |
|---|---|
| Smart Fit (plano Smart) | R$119,90 |
| Smart Fit (Black) | R$139,90–159,90 |
| **+ MOVIVO** | **R$79,90** |
| **Total para o usuário de academia** | **R$200–240** |
| Personal trainer (faixa de mercado, do meu relatório 01) | R$150–600 |

**A combinação MOVIVO + academia já entra no piso da faixa de personal trainer.** Isso significa que a frase "por uma fração do preço de um personal" só é tecnicamente verdadeira quando a MOVIVO é medida isolada.

**Decisões que eu fecho para proteger o argumento:**
1. A comparação de preço da marca é **sempre contra o personal trainer** (R$150–600), **nunca** contra "nada" e nunca contra "app de fitness". Comparar-se a app é rebaixar a categoria e o preço.
2. Expressar o preço em unidade diária é legítimo e não-enganoso: **R$2,66/dia**. É a única forma honesta de fazer R$79,90 parecer o que ele é.
3. **"Acesso é causa" precisa de uma prova operacional, não de uma frase.** A R$39 a frase se sustentava sozinha. A R$79,90, ela precisa de um mecanismo real e verificável — bolsas, plano social, gratuidade para um número declarado de pessoas por mês, ou algo equivalente. **Recomendo formalmente que o brand book contenha um compromisso de acesso mensurável, publicado.** Sem isso, "acesso é causa" vira greenwashing de propósito, que é exatamente o tipo de coisa que a Gen Z brasileira detecta e pune.
4. **Nunca justificar o preço pela camada de comunidade.** A comunidade é gratuita e vem junto. No segundo em que status virar argumento de preço, a MOVIVO vira SoulCycle.

## 7.2 Expectativa criada > produto entregue

O documento mestre descreve clube, seasons, drops, eventos de 2.000 pessoas, festival, loja e MOVIVO LAB. Se o brand book publicar isso como promessa de marca, a MOVIVO assina um cheque que o produto não cobre — e o caso Whoop mostra o preço disso: mudança de promessa erode anos de equity rapidamente.

**Regra que eu fecho: a marca só comunica publicamente a camada que entra em produção em ≤90 dias.** Tudo além disso é roadmap interno, não brand promise. A arquitetura de marca de §43 do documento mestre é um **mapa de destino**, e deve ser marcada como tal dentro do brand book, para que Camila e Bruno não a transformem em copy.

## 7.3 Comunidade sem massa crítica

Coberto em §4. O grupo único de hoje, com a base atual, produz ~1–2 criadores. Uma comunidade em que só a equipe posta é um **canal de broadcast fantasiado de comunidade**, e os membros percebem isso mais rápido do que a empresa.

**Diagnóstico obrigatório antes de qualquer investimento (experimento E0, §8):** medir a proporção de mensagens **membro→membro** no grupo. Se for <20% do total, não existe comunidade — existe uma lista. Nenhuma quantidade de branding conserta isso; o que conserta é segmentação (grupos menores, por cidade/objetivo) e ritual.

## 7.4 Gamificação em produto de saúde — risco clínico e de responsabilização

Este é o risco em que a marca pode causar dano real.

**Evidência nova desde o relatório 22:** revisão de 38 estudos (Flinders University, 2025) encontrou que usuários regulares de apps de dieta e fitness são mais propensos a comportamentos problemáticos com comida e exercício, e nomeia explicitamente **leaderboards, streaks e troféus** entre os mecanismos implicados; 59% de uma amostra com transtorno alimentar que usava MyFitnessPal se sentia "obcecada" e "compelida" a registrar. Nuance importante e honesta: o efeito documentado é mais forte em quem **já tem** sintomas — não é evidência de que a gamificação causa transtorno na população geral.

**Por que isso é mais grave na MOVIVO do que na média:** a marca tem um **Responsável Técnico CREF nomeado**. Uma mecânica de marca que demonstravelmente pressiona alguém a treinar lesionado transfere risco para uma pessoa física identificável e para a PJ registrada no conselho. Isso não é hipótese de compliance — é o desenho de responsabilidade que eu mesmo recomendei no relatório 01.

**Guardrails duros que eu fecho para toda a camada de status/Season/badge (inegociáveis, valem para Gabriel, Kimura, Bruno, Camila, Lucas, Victor):**

1. **Nenhuma sequência diária.** Qualquer streak é **semanal**, e **descanso prescrito conta como cumprimento**.
2. **Nenhuma métrica de status pode ser volume absoluto de treino.** Só aderência ao próprio protocolo (o fundador já acertou isso em §22 do documento mestre).
3. **Nenhuma punição, nenhum contador de fracasso, nenhuma perda visível.**
4. **Nenhum badge implica resultado** ("seu corpo mudou", "meta batida, resultado a caminho").
5. **Nenhuma recompensa de valor econômico condicionada a auto-report** (§5.2).
6. **Ranking público é opt-in, com consentimento específico e destacado** (LGPD art. 11).
7. **O AI Coach nunca invoca status, ranking, sequência ou perda quando o usuário relata dor, fadiga ou falta de tempo.** Regra explícita no system prompt.
8. **Toda copy de status/Season passa por revisão de Bruno E de Alexandre** antes de publicar.

## 7.5 Dependência do endossante (Cahuã)

Se a cultura for "a comunidade do Cahuã", a comunidade morre quando ele sai, muda de foco ou tem uma crise de imagem. A arquitetura Branded House já estabelecida ("Cahuã endossa, nunca é a marca") protege o **naming** e a **identidade visual**, mas não protege o **ritual**.

**Regra que eu fecho:** nenhum ritual central da MOVIVO CLUB pode exigir a presença de Cahuã. Ele **lança** rituais; membros os **sustentam**. Gate operacional: a partir de 500 membros, deve existir ao menos uma liderança local (crew de cidade) que não seja fundador nem endossante. Se, com 500 membros, nenhum evento acontece sem Cahuã presente, a comunidade não existe — o fã-clube existe.

## 7.6 O risco de prometer lifestyle enquanto o produto é um protocolo por WhatsApp

Este é o risco que o fundador me pediu para nomear, e a resposta honesta tem duas partes.

**Parte 1 — a marca não pode ser feita de uma estética que o produto não produz.** O documento mestre §35 lista a associação desejada nesta ordem: *foda, bem-sucedida, saudável, bonita, disciplinada, resiliente*. Duas das três primeiras palavras são **estéticas e de posição social** (`foda`, `bonita`). Isso é problemático por três razões de negócio:
- **Colide frontalmente com o valor #1 declarado** ("Ciência acima de hype — nada de estética vazia").
- **É um motor de churn.** Quem entra por estética espera resultado estético em 8 semanas; ele não vem; a pessoa sai e culpa a marca. Isso é o cenário exato de "responsabilização indevida da marca" que o próprio fundador teme em §49 — e ele o está criando pela porta da frente da estética enquanto tenta fechá-lo pela porta dos fundos da "disciplina".
- **Aproxima perigosamente do guardrail de "resultado garantido"** quando traduzido em imagem.

**Parte 2 — a marca PODE ser feita da estética que o produto realmente produz.** E ela é boa: **consistência, promessa cumprida, retorno depois da queda, progressão objetiva de carga.** Isso é verificável, é ético, é o que o produto de fato entrega, e é o que os valores #6 e a filosofia "somos melhores do que éramos ontem" já dizem. O fundador já tem o material certo — ele só listou o errado em §35.

**Recomendação:** reordenar e cortar. Sugestão de ordem para Gabriel trabalhar: **disciplinada → resiliente → saudável → capaz → admirada**. Cortar `bonita`. `Foda` pode sobreviver como energia de tom de voz, jamais como atributo prometido.

---

# 8. Análise do ICP à luz do documento mestre

## 8.1 Geração Z como público prioritário — **VALIDADO**, com um alerta financeiro

**A favor (dados):**
- Gen Z lidera o comportamento exato que a marca quer: **+123% em inscrições de maratona no Strava Brasil (2025)**; clubes de corrida no Brasil **+8,6×**.
- O perfil dominante de consumidor de assinatura no Brasil é **homem de classe C, até 27 anos, autônomo, em grande centro urbano** — praticamente o ICP declarado.
- 51% dos brasileiros pretendem **aumentar** gastos com assinatura nos próximos cinco anos; a faixa que gasta R$201–500/mês em assinaturas subiu de 14% (2025) para 17% (2026).

**Alerta financeiro que o brand book precisa absorver:**
- **47% dos jovens de 18–24 anos não fazem controle das próprias finanças** (CNDL/SPC Brasil).
- **65% das assinaturas no Brasil são pagas no crédito**, 16% no Pix.

**Tradução:** a Gen Z brasileira gera **churn involuntário** em taxa desproporcional — cartão estourado, cartão cancelado, fatura não paga. Isso não é falta de vontade e **não se resolve com marca**; resolve-se com dunning inteligente, retry de cobrança, aviso pré-vencimento e alternativa em Pix. Passo isto a Eduardo e a Renata como item de retenção que **antecede** qualquer discussão de comunidade. Não adianta construir cultura para um membro que sai porque o cartão recusou.

## 8.2 Não priorizar menores de idade — **VALIDADO, e é obrigação, não preferência**

O fundador enquadra isso como escolha de público. **Não é.** É gate de compliance:
- LGPD art. 14 impõe regime específico e mais rigoroso ao tratamento de dados de crianças e adolescentes, com o melhor interesse do titular como critério e consentimento parental específico e destacado para crianças. Combinado com **dados de saúde (art. 11)**, o custo de conformidade é desproporcional ao ticket.
- PAR-Q, termo de responsabilidade e capacidade civil para contratar exigem maioridade ou representação legal.
- Prescrição de treino de força para adolescente em desenvolvimento tem considerações técnicas próprias que o RT precisaria endereçar explicitamente.

**Reenquadramento que eu fecho:** isso não vai no brand book como "público que não priorizamos". Vai nos Termos de Uso como **requisito de elegibilidade (18+)**, com verificação no funil. Marca não escolhe isso; a lei escolhe. Confirmar com Alexandre.

## 8.3 "Pessoas sem disciplina" — **NÃO VALIDADO. É auto-sabotagem de funil.**

O fundador declara em §49 que não quer priorizar "pessoas sem disciplina com os próprios objetivos", pelos motivos: baixa probabilidade de resultado, risco de frustração, risco de responsabilização da marca.

**Os motivos são legítimos. A solução proposta está errada, por cinco razões.**

**1. Não é um segmento. É um desejo.**
Não existe campo de formulário, público de anúncio, característica demográfica ou proxy comportamental **pré-compra** para "disciplina". Você não pode excluir o que não consegue identificar. Isso não é segmentação — é uma preferência que não tem instrumento de execução. Em termos práticos, essa linha do documento mestre **não faz nada** exceto tornar a comunicação mais fria e afastar quem tem dúvida sobre si mesmo (que é quase todo mundo).

**2. Inverte a proposta de valor.**
Alguém com alta autodisciplina precisa de um **programa**, não de um **acompanhamento**. Essa pessoa é bem servida por uma planilha gratuita, um Fitbod ou o próprio conhecimento. **A pessoa que não sustenta consistência sozinha é exatamente a pessoa para quem o acompanhamento tem a maior disposição a pagar.** Excluir o público "sem disciplina" é excluir a demanda pelo produto. Se a MOVIVO só serve gente que já é consistente, ela vendeu um problema que o cliente não tem.

**3. Contradiz o valor #6 e o próprio badge COMEBACK que o fundador desenhou.**
O valor declarado é *"consistência acima de perfeição — celebramos quem voltou, não só quem foi impecável"*. E §26 do documento mestre cria um reconhecimento chamado **COMEBACK**, "para alguém que voltou depois de uma interrupção". **A marca não pode simultaneamente honrar o retorno e excluir a pessoa que precisa retornar.** Isso é uma contradição interna do documento mestre e ela precisa ser resolvida — e resolvida a favor do COMEBACK, que é infinitamente mais forte como território de marca.

**4. Os riscos citados são reais, mas são problemas de retenção e expectativa — não de aquisição.**
As ferramentas corretas para eles já foram especificadas no relatório 22 e não custam nada: implementation intentions no onboarding (d ≈ 0,31), feedback explícito de auto-monitoramento, revisão de meta, suporte de autonomia, toque humano visível do CREF, e diagnóstico de churn. **Filtrar na entrada é a resposta cara e errada para um problema que se resolve no meio do funil.**

**5. O produto já tem um filtro, e ele é suficiente.**
R$79,90/mês, cartão, e uma anamnese conversacional de três blocos com PAR-Q **já são** uma barreira de autosseleção substancial. **A fricção já é o filtro.** Adicionar um filtro moral em cima disso não aumenta a qualidade da base; só reduz o topo do funil.

### A reformulação que eu recomendo (e que preserva a intenção legítima do fundador)

O fundador está tentando excluir algo real. Ele só nomeou a coisa errada. O que ele quer excluir não é **falta de disciplina** — é **expectativa de resultado sem esforço**. Essa, sim, é identificável, executável e legítima:

| Fundador escreveu (não validado) | Eu recomendo (validado) |
|---|---|
| "Pessoas sem disciplina com os próprios objetivos" | **"Quem espera que o produto faça o trabalho"** |
| Traço de caráter, não observável, não filtrável | Expectativa, observável na copy, no onboarding e na anamnese, filtrável por comunicação |
| Exclui a demanda | Exclui o cliente que vai churnar frustrado e culpar a marca |
| Contradiz o COMEBACK | Compatível com o COMEBACK |

**Como isso se executa (e passo a Bruno, Helena e Camila):** a exclusão acontece por **honestidade radical na promessa**, não por filtro de entrada. Copy que diz explicitamente "isto exige que você treine" e "não prometemos resultado" **autosseleciona melhor do que qualquer segmentação**, e ainda por cima é o guardrail regulatório da empresa. É o único caso em que o compliance e o marketing querem exatamente a mesma coisa.

**Uma decisão adicional que decorre disso:** o efeito social desejado em §35 e a filosofia de §15 ("somos melhores do que éramos ontem") apontam para uma **cultura de retorno**, não de perfeição. Se a MOVIVO for a marca que **celebra quem voltou**, ela ocupa um território que Gymshark, Nike, Strava e todo o fitness genérico **deixaram vago**, porque todos eles celebram o desempenho. Isso é, na minha leitura, a maior oportunidade de diferenciação de marca deste documento inteiro, e eu a entrego a Gabriel como território prioritário.

---

# 9. Sequenciamento recomendado — o entregável central

Este é o roteiro. Ele deriva das cinco leis (§3.4), da matemática de status (§4) e do orçamento de §6.4.

## 9.1 Escada de camadas com gatilhos de escala explícitos

### CAMADA 0 — AGORA (0–150 pagantes) · orçamento ~R$0
**Tema: identidade individual. Nada aqui depende de massa crítica.**

| O que | Por quê | Custo |
|---|---|---|
| Identidade de membro ("Eu sou MOVIVO") e vocabulário | Funciona com n=1 | R$0 |
| **Badges e cards de marco compartilháveis** (MOVIVO MEMBER, MOVIVO 30, MOVIVO 90) | Único artefato que atravessa a fronteira do WhatsApp; fecha o ciclo §34 | R$0 após build |
| **Escada de status publicada e VAZIA**, com critérios ancorados em tempo | Escassez autoimposta; status conquistado, nunca dotado (Rewley); imune ao problema de massa | R$0 |
| Métricas individuais (Personal Best, Personal Streak, melhor mês) | Competição contra si mesmo, sem LGPD, sem dilução | R$0 |
| **Canal MOVIVO** (WhatsApp Channel) + regras de convivência do grupo | Único canal proativo gratuito; mitiga risco CREF do grupo | R$0 |
| Toque humano CREF visível e datado | Maior alavanca de retenção documentada (relatório 22 §5) | R$0 |

**Gatilho para avançar:** ≥150 pagantes ativos **e** E0 (§8) mostrando ≥20% de mensagens membro→membro.

---

### CAMADA 1 — 150–300 pagantes · orçamento ≤8% do MRR
**Tema: primeiro ritual coletivo e primeiro encontro.**

| O que | Gate específico | Custo |
|---|---|---|
| **SEASON 00** — piloto opt-in, 4 semanas, sem prêmio material, rankings **por categoria e por coorte de entrada** | Nomear "00" para que o fracasso não queime "Season 01" | R$0 |
| Segmentação da comunidade em grupos por cidade/objetivo | Teto de ~150–200 por grupo | Moderação |
| **Primeiro micro-encontro presencial: 20–40 pessoas**, uma cidade, academia parceira + café | Análogo do estande da Gymshark no BodyPower | R$2.000–10.000 |
| Presença em **eventos de terceiros** (corridas, expos) | Palco pago por outro; mercado cresce 17%/ano | Variável, baixo |

**Gatilho para avançar:** ≥300 ativos elegíveis **e** Season 00 com ≥40% de opt-in.

---

### CAMADA 2 — 300–1.000 pagantes · orçamento ≤8% do MRR
**Tema: status público e primeiros artefatos físicos.**

| O que | Gate específico | Custo |
|---|---|---|
| **MOVIVO SEASON oficial** com ranking público | **≥300 elegíveis**; opt-in; por categoria; ELITE ≤10% da base, ICON ≤1% | R$0 + operação |
| **Kit físico de marco** | **Tenure ≥6 meses** + cap mensal de volume | R$65–105/kit |
| Embaixadores voluntários / crews locais | Reduz dependência de Cahuã | R$0 |
| Encontro de 100–150 pessoas | Só com patrocínio ≥50% acima de 150 | R$15k–52k |

**Gatilho para avançar:** ≥1.000 pagantes **e** coorte de ≥100 membros elegíveis por status/tenure.

---

### CAMADA 3 — 1.000–5.000 pagantes · orçamento ≤12% do MRR
| O que | Gate específico |
|---|---|
| **MOVIVO DROP 01** — pré-venda sob demanda, meta mínima, **sem estoque** | Parecer prévio de Eduardo (tributação de mercadoria) e Alexandre (CNAE/obrigações fiscais) |
| MOVIVO EXPERIENCE 100–300 pessoas | Patrocínio ≥50% |
| Crews locais lideradas por membros em ≥3 cidades | Teste de sobrevivência da cultura sem fundador presente |

---

### CAMADA 4 — 5.000–20.000 pagantes
| O que | Gate específico |
|---|---|
| MOVIVO EXPERIENCE 500–1.000 pessoas | **Patrocínio ≥50% do custo total**, seguro de RC, equipe de saúde, alvarás |
| Loja permanente sob demanda | Nunca com estoque especulativo |

---

### CAMADA 5 — ≥20.000 pagantes (≈R$18M de ARR) · ano 4–5
| O que | Gate específico |
|---|---|
| **MOVIVO FESTIVAL** | ≥20.000 pagantes **ou** patrocínio ≥70%. A R$18M de ARR, um festival de R$1–2M é 6–11% do ARR — defensável. Hoje seria 100%+ do faturamento anual. |

## 9.2 A frase que resume o sequenciamento

> **A MOVIVO constrói cultura de dentro para fora e de um para muitos: primeiro o membro tem uma história (badge), depois um lugar (grupo curado), depois um ritual (Season), depois um encontro (micro-evento), depois um objeto (kit), depois um palco (Experience). O festival é a última coisa, não a primeira — e por muito tempo o palco correto é o dos outros.**

---

# 10. Hipóteses testáveis — o que dá para provar em 90 dias com o que já existe

Todos estes experimentos usam ativos que a MOVIVO **já tem**: o grupo de WhatsApp, o sistema de 100 pontos, a base atual e o Canal (gratuito). Custo agregado estimado: **< R$8.000**, quase todo concentrado em E5.

| # | Hipótese | Experimento | Métrica / critério de sucesso | Custo | Prazo |
|---|---|---|---|---|---|
| **E0** | **Existe comunidade ou existe uma lista?** | Contar mensagens membro→membro vs. equipe→membros no grupo, 30 dias retroativos | **≥20% membro→membro** = comunidade embrionária. **<20% = broadcast.** Se <20%, nada acima da Camada 0 é autorizado | R$0 | 3 dias |
| **E1** | **O artefato de identidade é compartilhado?** (o teste mais importante da tese inteira) | Enviar card personalizado "MOVIVO 30" a todos que atingirem 30 dias | **≥15% compartilham** (story/feed/status). Se <5%, o ciclo §34 é fantasia e o brand book precisa saber disso antes de ser escrito | ~R$0 | 60 dias |
| **E2** | **Season funciona nesta base?** | **SEASON 00** — 4 semanas, opt-in, sem prêmio material, ranking por categoria e coorte | ≥40% de opt-in; **+10pp na taxa de resposta ao check-in semanal** durante a Season | R$0 | 45 dias |
| **E3** | **Existe demanda por encontro presencial?** (fake door) | Anunciar lista de espera para encontro em SP, sem produzir nada | **≥20% da base de SP** se inscreve. Se <10%, adiar toda a Camada 1 de eventos | R$0 | 14 dias |
| **E4** | **Qual nome de membro pega?** | Usar "Movers" / "Membros" / "Você é MOVIVO" em contextos reais no Canal e no grupo | **≥5 usos orgânicos** do termo por membros, não induzidos, em 30 dias. Dá dado real a Caio e Gabriel em vez de gosto | R$0 | 30 dias |
| **E5** | **Evento retém?** | Micro-encontro real: 1 cidade, 20–40 pessoas, academia parceira + café | Comparecimento ≥60% dos inscritos; **churn em 60 dias dos presentes vs. coorte pareada de ausentes** | R$1.500–4.000 | 75 dias |
| **E6** | **Status conquistável motiva esta base?** | Publicar a escada vazia com critérios; medir reação | ≥10 perguntas/menções espontâneas sobre critérios em 14 dias | R$0 | 14 dias |
| **E7** | **Existe disposição a pagar por artefato?** | Pré-venda de camiseta a preço real (R$129–149), produção sob demanda, meta de 30 unidades | Meta atingida em 14 dias. **Se falhar, "drop" morre como tese e nenhum estoque foi comprado** | R$0 até bater meta | 21 dias |
| **E8** | **(herdado, obrigatório) Por que as pessoas saem?** | H6 do relatório 22 — pergunta única no cancelamento + classificação | ≥60% dos churns classificados: motivação / valor percebido / preço / vida / involuntário | R$0 | contínuo |
| **E9** | **Quanto do churn é involuntário?** | Separar churn por cartão recusado do churn voluntário | Se involuntário >20% do total, **prioridade é dunning, não cultura** | R$0 | 30 dias |

**Ordem de execução recomendada:** E0 e E9 primeiro (diagnóstico, 3–30 dias, custo zero) → E1, E4, E6 (identidade, paralelos) → E2 e E3 → E5 e E7.

> **Regra de gate:** **E0 é bloqueador.** Se menos de 20% das mensagens do grupo forem membro→membro, o brand book deve ser escrito para a Camada 0 apenas, e as camadas de Season/evento/drop ficam como roadmap não-comunicado. Não faz sentido escrever a cultura de um clube que ainda é uma lista de transmissão.

---

# 11. Limitações desta pesquisa (declaração explícita)

1. **A tabela de preços R$79,90 não foi testada com nenhum usuário.** Nada neste documento valida a disposição a pagar nesse patamar. O unit economics de §6 mostra o que acontece **se** o preço se sustentar, não **que** ele se sustenta.
2. **Não localizei nenhum dado auditável de retenção de nenhum concorrente brasileiro direto**, incluindo Zyla. O benchmark de retenção para "acompanhamento de treino por WhatsApp no Brasil" **não existe publicamente** — a MOVIVO terá que gerar o próprio.
3. **Números de Duolingo (12%→55%) e Strava (18%→32%) continuam vindo de blogs de fornecedores de plataformas de gamificação**, com incentivo comercial direto. Usei apenas os números de relatório de empresa (DAU, assinantes, receita), que são confiáveis; a **atribuição causal** à gamificação é narrativa, não evidência controlada.
4. **O dado de "68% de retenção de marcas de corrida comunitárias vs. 41%"** vem de relatório setorial comercial, não de estudo revisado. Ordem de grandeza apenas.
5. **Custos de evento (R$150–1.500/participante)** vêm de blogs de agências e produtoras brasileiras. São referências de mercado, não orçamentos. **Qualquer decisão de evento exige três orçamentos reais.**
6. **A modelagem de COGS de WhatsApp pós-01/10/2026 é estimativa minha**, não a tabela oficial da Meta. Eduardo precisa refazer com a tarifa real do BSP.
7. **A restrição de 8 participantes da Groups API** e as limitações de Canais foram obtidas de documentação de fornecedores e da documentação Meta indexada; **devem ser confirmadas diretamente com AraraHQ** antes de qualquer decisão de arquitetura de comunidade.
8. **A associação entre apps de fitness e comportamento alimentar desordenado** é correlacional e mais forte em populações já sintomáticas. Não é evidência de que a MOVIVO causaria dano — é evidência de que a mecânica exige guardrails. Confirmação clínica cabe ao RT CREF.
9. Nada aqui constitui parecer jurídico, contábil ou clínico.

---

# 12. Decisões que eu fecho

1. **A tese central está VALIDADA COM RESSALVAS.** Status conquistável sobre produto acessível é mecanismo documentado (Strava, Duolingo, Gymshark) e é justamente o mecanismo que **não** depende de preço alto. SoulCycle prova o contrário por contraste: status ancorado em preço colapsa.
2. **A camada de marca deixou de ser opcional.** A R$79,90 (+105% sobre o preço validado), sem camada de valor percebido, o aumento é nu. A marca é o que torna o preço defensável.
3. **Ordem obrigatória de construção:** Produto → Ritual → Símbolo → Encontro → Objeto. **Nunca começar pelo objeto ou pelo evento grande.**
4. **Badges e cards de marco compartilháveis são a primeira coisa a construir.** Melhor relação evidência/custo do documento; funcionam com n=1; são o único artefato que atravessa a fronteira do WhatsApp e fecham o ciclo do §34.
5. **A escada de status é publicada AGORA e VAZIA**, com critérios ancorados em tempo. Escassez autoimposta, status conquistado e nunca dotado, imune ao problema de massa crítica.
6. **Ranking público com exibição nominal só a partir de 300 membros ativos elegíveis**, sempre opt-in, sempre por categoria e/ou coorte, com ELITE ≤10% e ICON ≤1% da base. Abaixo de 300, apenas métricas individuais privadas.
7. **A arquitetura de comunidade é de três camadas:** Canal (broadcast gratuito, ilimitado) + grupos curados de ~150–200 (conversa) + canal 1:1 tarifado (produto). Toda mecânica de cultura vive nos dois primeiros, que são gratuitos.
8. **Regras de convivência e moderação ativa do grupo desde o dia 1** — o grupo é superfície de risco clínico, de exercício ilegal da profissão e de dado sensível compartilhado entre titulares.
9. **Kit físico somente com tenure ≥6 meses e com cap mensal de volume.** Nunca condicionado a auto-report de treino.
10. **Drop é artefato, não negócio.** Sempre sob demanda com pré-venda, nunca com estoque. Exige parecer prévio de Eduardo (tributação de mercadoria vs. serviço) e Alexandre (CNAE/obrigações fiscais).
11. **Eventos: micro-encontro (20–40) agora; 500–2.000 só com ≥5.000 pagantes e patrocínio ≥50%; FESTIVAL só com ≥20.000 pagantes ou patrocínio ≥70% — ano 4–5.** Até lá, a MOVIVO aparece nos eventos dos outros.
12. **Teto de gasto discricionário de marca/comunidade/recompensa: ≤8% do MRR no ano 1, ≤12% no ano 2, ≤15% no ano 3+.**
13. **A camada de comunidade precisa reduzir o churn mensal em ≥0,6pp para se pagar.** Perda máxima R$63/assinante; ganho plausível R$189–387. Assimetria 3–6:1 a favor. **Este é o business case da camada de marca.**
14. **A marca só comunica publicamente a camada que entra em produção em ≤90 dias.** A arquitetura de §43 do documento mestre é mapa de destino, não brand promise.
15. **Comparação de preço sempre contra o personal trainer (R$150–600), nunca contra app, nunca contra "nada".** R$2,66/dia é a expressão honesta do ticket.
16. **"Acesso é causa" exige uma prova operacional publicada e mensurável** (bolsas / plano social / gratuidade declarada). A R$79,90 a frase não se sustenta sozinha.
17. **Nunca justificar o preço pela comunidade.** No segundo em que status virar argumento de preço, a MOVIVO vira SoulCycle.
18. **Oito guardrails duros de gamificação em saúde (§7.4) são inegociáveis** para Gabriel, Kimura, Bruno, Camila, Lucas e Victor.
19. **Nenhum ritual da MOVIVO CLUB pode exigir a presença de Cahuã.** A partir de 500 membros, deve existir liderança local que não seja fundador nem endossante.
20. **Menores de idade não são escolha de marca — são gate de compliance.** Vai para os Termos de Uso como elegibilidade 18+, não para o brand book como posicionamento.
21. **"Pessoas sem disciplina" sai do documento.** Substituído por **"quem espera que o produto faça o trabalho"**, executado por honestidade radical de promessa, não por filtro de entrada.
22. **E0 é bloqueador do brand book.** Se <20% das mensagens do grupo forem membro→membro, o brand book se limita à Camada 0.

---

# 13. Onde eu discordo

### Do fundador

**1. Do MOVIVO FESTIVAL e dos eventos de 500–2.000 pessoas no horizonte atual.**
Não é ambição, é aritmética. Um evento de 1.000 pessoas custa a contribuição anual de **192 a 1.026 assinantes**. A Rapha executou a versão profissional dessa tese, com capital, num esporte com comunidade nativa, e teve **prejuízo por oito anos consecutivos (£17,2M em 2024)**, fechando cinco clubhouses. A Nike levou dez anos de corridas femininas antes do After Dark. A Gymshark levou quatro anos e ~£12,8M até o primeiro evento próprio — e o primeiro evento dela foi **um estande no evento de outra pessoa**. Não conheço nenhum caso de marca que começou pelo festival.

**2. Da lista do §35 — "foda, bem-sucedida, saudável, bonita, disciplinada, resiliente".**
Duas das três primeiras palavras são estéticas e de posição social. Isso colide frontalmente com o valor #1 declarado pelo próprio fundador ("Ciência acima de hype — nada de estética vazia"), é um motor de churn (quem entra por estética sai quando a estética não chega em 8 semanas), e é adjacente ao guardrail de "resultado garantido". **Recomendo cortar `bonita` e reordenar para disciplinada → resiliente → saudável → capaz → admirada.** `Foda` sobrevive como energia de tom de voz, jamais como atributo prometido.

**3. Do §49 — "pessoas sem disciplina com os próprios objetivos".**
Discordo integralmente e com argumento em §8.3. Resumo: não é um segmento identificável (logo, não é executável); inverte a proposta de valor (quem tem disciplina precisa de programa, não de acompanhamento); contradiz o valor #6 e o badge COMEBACK que o próprio fundador criou; e trata como problema de aquisição algo que é problema de retenção e de expectativa. **O produto já tem filtro suficiente — R$79,90 + cartão + anamnese em três blocos.** A fricção já é o filtro; não adicionar um filtro moral em cima.

**4. Da MOVIVO STORE como linha de receita.**
Um drop de 100 peças gera lucro líquido realista de R$2.500–4.000 — a contribuição anual de 3 a 5 assinantes — em troca de risco de estoque, capital de giro, logística reversa, risco tributário e semanas de atenção de fundador. Drop é artefato. Negócio, não.

**5. Do enquadramento de "não priorizar menores de idade" como escolha de marca.** É requisito legal (LGPD art. 14 + art. 11, capacidade civil, PAR-Q). Chamá-lo de posicionamento enfraquece a obrigação.

### De relatórios anteriores

**6. Do meu próprio relatório 01 e do de Eduardo, quanto a preço.**
Validei R$29–59; Eduardo modelou R$39/99/349. O preço vigente é R$79,90 — **+105% sobre o mensal validado**. Não estou revogando aquela análise; estou registrando que **ela foi superada por decisão, não por evidência**, e que a validação de disposição a pagar nesse patamar **não existe**. Isso é ressalva formal (R1), não aprovação retroativa.

**7. Do meu próprio relatório 22, num ponto específico e limitado.**
Naquele relatório eu tratei toda gamificação como economicamente hostil ao canal, porque toda mecânica de engajamento vira template proativo tarifado. **Isso continua valendo para o canal 1:1 — e não vale para a camada de comunidade.** O Canal do WhatsApp e os grupos de consumidor são gratuitos e ilimitados. Portanto, uma Season anunciada e apurada **no Canal** tem custo marginal zero, enquanto um streak diário no chat do Coach continua sendo caro e vetado. A restrição econômica do relatório 22 se aplica ao **canal**, não ao **conceito** — e essa distinção destrava boa parte do que o fundador quer.

### De onde a evidência contraria o consenso confortável da mesa

**8. Comunidade não é plano de retenção.**
A Peloton tem a comunidade mais elaborada já construída em fitness — instrutores-celebridade, leaderboard ao vivo, milestones, high-fives — e perde **8,8% da base ao ano**, com churn mensal subindo de 1,8% para 2,2%. Se o protocolo for ruim ou a IA não entender o joelho do usuário, **nenhum badge salva**. O brand book não pode ser usado, por ninguém nesta mesa, como substituto do trabalho de retenção de produto — que é o Tier 0 do relatório 22 e pertence a Lucas e Victor.

---

# 14. O que passo para as próximas rodadas

### Para **Gabriel** (Brand Strategist) — o mais importante
- **Território prioritário que eu entrego a você:** a **cultura do retorno**. Gymshark, Nike, Strava e todo o fitness genérico celebram desempenho. **Ninguém ocupou "celebramos quem voltou".** O valor #6 do fundador e o badge COMEBACK já apontam para lá, e isso é simultaneamente diferenciado, honesto, seguro sob os guardrails e alinhado ao que o produto de fato entrega.
- Resolva a contradição interna do documento mestre entre §26 (COMEBACK) e §49 ("sem disciplina"). Eu decidi a favor do COMEBACK; a formulação é sua.
- Reordene o §35 e corte `bonita` (§7.6).
- Trate a arquitetura de §43 como **mapa de destino**, com marcação explícita de que não é promessa comunicável.
- "Democratizamos o acesso. Não reduzimos o padrão." **se sustenta** e é o eixo correto — desde que acompanhada de uma prova operacional de acesso (decisão 16).

### Para **Caio** (Naming)
- E4 (§10) te dá **dado real** sobre "Movers" em 30 dias, por R$0. Recomendo esperar por ele antes de fechar a nomenclatura de membro.
- "MOVIVO CLUB" como estrutura de pertencimento está validado por mim. "Club" comunica lifestyle e identidade; "Time" comunica esporte competitivo, que colide com o guardrail de não premiar volume.
- Nomes de tier (ACTIVE/CORE/ELITE/ICON): a **estrutura** está validada (Drèze & Nunes exige tiers subordinados). Os **nomes** são seus. Restrição minha: ELITE ≤10% e ICON ≤1% da base — o nome precisa suportar ser raríssimo sem soar inatingível.

### Para **Kimura** (Brand Designer)
- **Seu entregável de maior impacto nesta rodada não é o logo — é o card de marco compartilhável.** É o único artefato que atravessa a fronteira do WhatsApp e faz o ciclo do §34 fechar. E1 mede se ele funciona. Se <5% compartilharem, a tese de identidade social precisa ser reescrita.
- Badges precisam ser legíveis em **story de celular, em miniatura, em 2 segundos** — não em brand book impresso.
- Nenhum elemento visual pode implicar resultado corporal ou transformação estética (guardrail 4 de §7.4).

### Para **Helena** (Marketing) e **Camila** (Social)
- Comparação de preço **sempre contra o personal (R$150–600)**, nunca contra app, nunca contra "nada". R$2,66/dia.
- **Não creditem aquisição a evento presencial.** Evento atrai membro existente; a aquisição vem do **conteúdo do evento**, que é o mecanismo Gymshark66 (45,5M de views com custo ~zero). Planejem o conteúdo antes de planejar o evento.
- A janela brasileira está aberta agora: clubes de corrida +8,6×, Gen Z +123% em maratonas. **Aparecer nos eventos dos outros** é a jogada de custo/benefício correta pelos próximos dois anos.
- Camila: E0 é seu diagnóstico e é bloqueador. Meça mensagens membro→membro antes de escrever qualquer plano de comunidade.

### Para **Bruno** (Copy)
- Toda copy de status/Season passa por você **e** por Alexandre (guardrail 8).
- A exclusão que o fundador quer ("quem espera que o produto faça o trabalho") se executa **na sua copy**, por honestidade radical de promessa — não por filtro de funil. É o raro caso em que compliance e marketing querem exatamente a mesma coisa.

### Para **Eduardo** (Financeiro)
- **Refaça o unit economics com ARPU R$76 e COGS pós-01/10/2026** (§6.1). LTV base sai de R$306 para ~R$813 — isso muda todas as suas metas de CAC e payback.
- **Teto de marca ≤8% do MRR no ano 1** (§6.4) — preciso que você formalize isso como linha orçamentária com centro de custo próprio.
- **Alerta tributário urgente antes de qualquer drop:** venda de mercadoria pode quebrar a otimização Simples Anexo III via Fator R que você recomendou para atividade de serviço. Precisa de resposta antes, não depois.
- **Churn involuntário** (cartão recusado) em Gen Z brasileira: 47% dos 18–24 não controlam finanças; 65% das assinaturas são no crédito. E9 mede. Se >20% do churn for involuntário, **dunning tem prioridade sobre cultura**.

### Para **Alexandre** (Jurídico)
- **Novo item, não tratado no pipeline:** o grupo de comunidade é superfície de (a) risco clínico por orientação leiga, (b) exposição de exercício ilegal da profissão dentro de espaço operado por PJ registrada no CREF com RT nomeado, e (c) compartilhamento de dado sensível de saúde entre titulares (art. 11). Preciso de regras de convivência juridicamente revisadas.
- Ranking público nominal: base legal e consentimento específico e destacado.
- Elegibilidade 18+ nos Termos de Uso (§8.2).
- Patrocínio de evento por marca de suplemento sob selo CREF: associação de imagem aceitável?
- Tributação/CNAE de venda de mercadoria (com Eduardo).

### Para **Lucas** (Produto) e **Victor** (IA)
- Nada aqui revoga o relatório 22. **Tier 0 continua sendo a prioridade de retenção**, e o brand book **não é** o plano de retenção (Peloton, §3.3).
- Guardrail 7 de §7.4 é regra de system prompt: **o AI Coach nunca invoca status, ranking, sequência ou perda quando o usuário relata dor, fadiga ou falta de tempo.**
- Regra de arquitetura de produto: **nenhuma recompensa de valor econômico condicionada a auto-report de treino** enquanto não houver verificação independente.
- Card de marco automático (E1) é o item de produto de maior impacto/custo desta rodada.

### Para **Renata** (CS) e **Igor** (Growth)
- Igor: E0, E8 e E9 são diagnóstico e bloqueadores. Instrumentar antes de qualquer experimento de cultura.
- Renata: o toque humano CREF visível e datado continua sendo a maior alavanca de retenção documentada (relatório 22 §5), e é anterior a toda a camada de comunidade.

---

# 15. Fontes Consultadas

**Marcas que construíram cultura sobre produto acessível**
- Gymshark — receita £646M (ano até 31/07/2025) e estratégia de comunidade: https://www.appbrew.com/blogs/gymshark-marketing-strategy · https://businessmodelanalyst.com/gymshark-marketing-strategy/ · https://www.tacticone.co/blog/gymshark-marketing-strategy
- Gymshark — BodyPower Expo 2013, primeiro evento e ~£30.000 em 30 minutos: https://www.1stformations.co.uk/blog/humble-beginnings-gymshark-story/ · https://uk.gymshark.com/blog/article/the-official-gymshark-story
- Gymshark66 — 45,5M views, 1,9M likes; desenho comportamental do desafio: https://becauseofmarketing.com/not-a-resolution-a-routine-inside-the-gymshark66-challenge/ · https://www.marketingweek.com/why-it-works-gymshark-behavioural-science-habit/ · https://www.gymshark.com/pages/gymshark-66
- Strava — receita ~US$500M (2025), retenção 80–90%, base de usuários: https://sqmagazine.co.uk/strava-statistics/ · https://builtin.com/company/strava/faq/stability-growth
- Strava Local Legends — mecânica de status de 90 dias: https://support.strava.com/en-us/articles/15401751-local-legends · https://communityhub.strava.com/insider-journal-9/your-guide-to-local-legends-1506
- Duolingo — 50M DAU (Q3/2025, +36% YoY), 11,5M assinantes, streaks e ligas: https://gitnux.org/duolingo-user-statistics/ · https://vmobify.com/blog/how-duolingo-grew · https://www.strivecloud.io/blog/gamification-examples-boost-user-retention-duolingo *(fornecedor — ver limitação 3)*
- Whoop — US$1,1bi de bookings (2025, +103%), 2,5M membros, LTV:CAC ~4,5×, incidente de confiança de maio/2025: https://sacra.com/c/whoop/ · https://sacra.com/research/whoop-at-1b-year-growing-103-yoy/ · https://www.opensend.com/post/whoop-marketing-strategy
- Tracksmith — crescimento, Trackhouses, modelo de nicho; retenção comunitária 68% vs 41%: https://www.fastcompany.com/91140119/tracksmiths-strategy-for-success-slow-and-steady-wins-the-race · https://digiday.com/marketing/running-brand-tracksmith-taken-anti-nike-approach-building-brand/ · https://marketintelo.com/report/performance-running-apparel-with-community-driven-brand-models-market *(relatório comercial — ver limitação 4)*
- Nike After Dark Tour — 50.000+ mulheres em 7 corridas, histórico 2005–2015: https://about.nike.com/en/newsroom/releases/nike-2025-after-dark-tour-womens-race-series · https://about.nike.com/en/newsroom/releases/nike-after-dark-tour-2026-global-race-series-built-for-women-powered-by-nike · https://athletechnews.com/nike-launches-2025-after-dark-tour-for-women-runners/
- Ladder — US$105M captados (US$90M de go-to-market da General Catalyst), meta 150 mil membros: https://www.businesswire.com/news/home/20241120017577/en/Ladder-Secures-Over-$100-Million-in-New-Funding-to-Scale-1-Strength-Training-App · https://insider.fitt.co/ladder-raises-105m-for-strength-training-app/ · https://finance.yahoo.com/news/strength-training-startup-ladder-plans-124258596.html

**Marcas que tentaram e sangraram**
- Rapha — prejuízo operacional £17,2M (2024), oitavo ano consecutivo, fechamento de cinco clubhouses: https://www.cyclingnews.com/cycling-culture/the-following-clubhouses-will-be-closing-before-april-2026-rapha-to-shut-a-number-of-rcc-venues-as-early-as-january-18th/ · https://www.cyclingweekly.com/news/it-is-a-painful-decision-but-it-is-the-right-call-rapha-to-close-five-clubhouses-across-usa-and-uk
- Rapha — redução da mensalidade RCC de £135 para £70: https://bikerumor.com/rapha-halves-rcc-club-membership-cost-reshaped-accessible-to-more-cyclists/ · https://www.cyclingweekly.com/news/latest-news/rapha-drops-price-of-rcc-membership-447828
- Peloton — Q2 FY2026 (−214 mil assinantes, −7% YoY): https://investor.onepeloton.com/news-releases/news-release-details/peloton-announces-q2-fy2026-financial-results
- Peloton — FY2026, churn 1,8%→2,2%, base −8,8% YoY, primeiro lucro anual: https://www.indexbox.io/blog/pelotons-2026-challenge-operational-gains-vs-subscriber-decline/ · https://finance.yahoo.com/markets/stocks/articles/peloton-pton-turns-corner-subscribers-105159091.html
- SoulCycle — nova onda de fechamentos (2026), aulas com 10–16 pessoas, histórico de 19 fechamentos em 2022: https://the17thman.com/2026/06/05/a-wave-of-soulcycle-studio-closures-in-june-and-july-of-2026/ · https://www.cnn.com/2022/08/15/business/soulcycle-closures
- Boutique fitness — pressão sobre a aula de US$36+: https://amp.cbc.ca/news/business/luxury-fitness-bubble-pop-1.6554153

**Mercado brasileiro — comunidade, corrida e Geração Z**
- Strava Year in Sport 2025 — clubes de corrida no Brasil +8,6× (global 3,5×), ciclismo 3,6×, Gen Z +123% em maratonas: https://www.mktesportivo.com/2026/06/com-o-crescimento-da-corrida-no-brasil-strava-renova-parceria-com-a-maratona-do-rio-em-2026/ · https://gooutside.com.br/clubes-de-corrida-brasileiros-no-strava/ · https://www.perunning.com.br/strava-year-in-sport-2025-tendencias/
- Criação de clubes de corrida no Brasil +800% em um ano no Strava: https://www.mktesportivo.com/2025/08/criacao-de-clubes-de-corrida-no-brasil-cresce-800-em-um-ano-no-strava/
- Run clubs brasileiros e a explosão da corrida: https://www.itatiaia.com.br/porlucasmachado/os-run-clubs-brasileiros-que-ajudam-a-explicar-a-explosao-da-corrida/
- Mercado de eventos esportivos BR +17%: https://hub.ticketsports.com.br/o-que-podemos-esperar-na-corrida-em-2026/ · https://maquinadoesporte.com.br/analise/10-tendencias-para-a-corrida-no-mundo-em-2026/
- Assinaturas no Brasil 2026 — 51% pretendem aumentar gastos; faixa R$201–500 sobe de 14% para 17%; 65% pagam no crédito, 16% no Pix: https://monitordomercado.com.br/noticias/421610-brasileiros-pretendem-gastar-mais-com-assinaturas-nos-proximos-cinco-anos-diz-estudo/ · https://mistobrasil.com/2026/09/02/servicos-digitais-impulsionam-mercado-de-assinaturas-no-brasil/
- Perfil dominante do assinante brasileiro (homem, classe C, até 27 anos, autônomo): https://jornaldobras.com.br/noticia/112515/geracao-z-lidera-consumo-de-conteudo-por-assinatura-aponta-levantamento-da-privacy
- CNDL/SPC Brasil — 47% dos jovens da Geração Z não controlam as finanças: https://cndl.org.br/politicaspublicas/47-dos-jovens-da-geracao-z-nao-realizam-o-controle-das-financas-aponta-pesquisa-cndl-spc-brasil/
- Smart Fit — planos R$119,90 (Smart) a R$159,90–199,90 (Black): https://www.smartfit.com.br/planos · https://www.fitwhere.com/br/redes/smart-fit · https://www.correiobraziliense.com.br/aqui/2026/05/09/smart-fit-ou-bluefit-comparamos-os-planos-das-academias-no-df/

**Ciência de status, comunidade e gamificação**
- Drèze & Nunes (2009), "Feeling Superior: The Impact of Loyalty Program Structure on Consumers' Perceptions of Status", *Journal of Consumer Research* 35(6): https://academic.oup.com/jcr/article-abstract/35/6/890/1800003 · https://faculty.wharton.upenn.edu/wp-content/uploads/2012/04/Feeling-Superior-final-8-20-08.pdf
- Limiar de diluição de status (25–30% em tier de elite) e redesenho de tiers: https://loyaltyrewardco.com/status-tiers/ · https://loyaltyrewardco.com/loyalty-program-tier-redesign/
- Nielsen Norman Group — Participation Inequality (regra 90-9-1): https://www.nngroup.com/articles/participation-inequality/ · https://en.wikipedia.org/wiki/1%25_rule
- Fournier & Lee (2009), "Getting Brand Communities Right", *Harvard Business Review*: https://hbr.org/2009/04/getting-brand-communities-right
- Flinders University (2025) — revisão de 38 estudos associando apps de dieta/fitness a comportamento alimentar desordenado e exercício excessivo, com menção explícita a leaderboards, streaks e troféus: https://www.abc.net.au/news/2025-02-25/flinders-university-links-fitness-apps-to-disordered-eating/104974468 · https://www.news-medical.net/news/20250220/Research-reveals-concerning-links-between-fitness-apps-and-disordered-eating.aspx
- Associations Between Fitness/Diet Tracking Technology and Disordered Eating Behaviour: Systematic Review: https://pmc.ncbi.nlm.nih.gov/articles/PMC12547374/
- Effects of diet and fitness apps on eating disorder behaviours (*BJPsych Open*): https://www.cambridge.org/core/journals/bjpsych-open/article/effects-of-diet-and-fitness-apps-on-eating-disorder-behaviours/2D1EE739D97AB3EFC6573835E4C527BD

**Custos de evento e produção física no Brasil**
- Custo por participante (R$150–1.500) e composição orçamentária de eventos: https://revistaoeste.com/oestegeral/2026/02/21/quanto-custa-organizar-um-evento-grande-e-o-que-realmente-pesa-no-orcamento/ · https://blog.even3.com.br/quanto-custa-organizar-um-evento/ · https://blog.bisutticorporate.com.br/quanto-custa-evento-corporativo-sp/ · https://venueful.com/brazil/budgeting-for-a-business-event-in-sao-paulo
- Camiseta streetwear — lotes mínimos, faixas de preço, DTF vs. silk, venda R$90–250: https://www.ararasilk.com.br/blog/camiseta-oversized-personalizada-streetwear-2026 · https://camisetasem12h.com.br/camisetas-personalizadas-atacado-preco-quantidade/ · https://www.lionbrazil.com/diario/camiseta-personalizada-atacado

**Arquitetura do canal WhatsApp**
- Groups API (Meta for Developers) — limite de 8 participantes, precificação por mensagem: https://developers.facebook.com/documentation/business-messaging/whatsapp/groups · https://www.unipile.com/whatsapp-group-api/ · https://www.imbee.io/resource/whatsapp-groups-api-business-guide-2026
- WhatsApp Channels — broadcast gratuito, seguidores ilimitados, unidirecional, sem API: https://blog.omnichat.ai/whatsapp-channels/ · https://www.kommunicate.io/blog/whatsapp-channels-for-businesses/
- WhatsApp Business App — limite de 50 contatos em lista de transmissão: https://www.flowcart.ai/blog/whatsapp-business-pricing · https://www.infobip.com/blog/whatsapp-business-app-vs-whatsapp-business-platform
- Mudança de precificação de mensagens de serviço em 01/10/2026 (mantida do relatório 22): https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing

**Documentos internos**
- `MOVIVO_Documento_Mestre.md` (fundador, set/2026)
- `docs/fitness-ia-whatsapp/01-relatorio-clovis.md` (Rev. 2)
- `docs/fitness-ia-whatsapp/22-relatorio-clovis-retencao-gamificacao.md`
- `docs/fitness-ia-whatsapp/02-relatorio-gabriel.md`
- `docs/fitness-ia-whatsapp/07-relatorio-eduardo.md`
- `CLAUDE.md`
