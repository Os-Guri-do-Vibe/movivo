# Relatório de Revisão Pontual — Clóvis (Director Venture Research & Product Strategy)

**Tipo de documento:** **REVISÃO PONTUAL** — não é um novo agente da sequência numerada 01–21 do pipeline, nem uma revisão do veredito de validação da MOVIVO.
**Tema:** Retenção, adesão, gamificação e ciência comportamental aplicada a um produto 100% conversacional (WhatsApp).
**Data:** 2026-08-27
**Pasta do projeto:** `docs/fitness-ia-whatsapp/`
**Status do pipeline:** MOVIVO `VALIDADO COM RESSALVAS` (ver `01-relatorio-clovis.md`). Fases 1–4 concluídas. Fase 5 (Desenvolvimento) em início. **Esta revisão não altera o veredito nem bloqueia o pipeline.**
**Consumidores diretos deste relatório:** **Lucas** (08 — Gerente de Produto, para spec de produto) e **Victor** (12 — Engenheiro de IA, para prompt/context design). Secundariamente: Renata (20 — CS), Igor (21 — Growth), Eduardo (07 — Financeiro, pelo impacto em unit economics).

---

## VEREDITO DESTA REVISÃO

> **CONFIRMO a decisão de Lucas de manter gamificação clássica (streaks diários, badges, rankings) FORA do MVP — mas por razões mais fortes e mais específicas do que "é uma aposta".**
>
> **E DISCORDO do enquadramento binário da pergunta.** A pergunta do fundador ("vale investir em gamificação e/ou neurociência de hábito?") mistura duas coisas com perfis de evidência, custo e risco radicalmente diferentes:
>
> 1. **Gamificação estruturada** (pontos, streaks, badges, níveis, ranking): evidência real porém **de magnitude trivial a pequena**, **decai quando a intervenção para**, é **cara no canal WhatsApp** (a partir de 01/10/2026 cada nudge proativo é cobrado), **colide com a periodização de treino** e **cria risco clínico e de LGPD** específicos do produto MOVIVO. → **NÃO investir agora.**
>
> 2. **Técnicas comportamentais nativas de conversa** (implementation intentions, goal setting, self-monitoring, feedback de progresso, suporte de autonomia/SDT, accountability humano visível): evidência **igual ou superior à da gamificação**, **custo marginal próximo de zero** (são decisões de *prompt design* e de fluxo, não features novas), **zero risco regulatório adicional** e **totalmente compatíveis com os guardrails CREF**. → **Investir AGORA, dentro do MVP, sem esperar validação de retenção orgânica.**
>
> **A recomendação de negócio é: não construa um sistema de gamificação. Construa uma conversa comportamentalmente competente.** O ROI está quase inteiro no item 2, e o item 2 não é uma feature — é como Victor escreve os prompts e como Lucas desenha os Épicos 1, 4 e 6 que já estão no MVP.
>
> **Achado adicional não previsto no pipeline:** o ativo de retenção com a melhor evidência disponível na literatura já está pago e subutilizado na MOVIVO — **o profissional CREF humano**. Ele hoje existe por razão regulatória. Torná-lo *perceptível* ao usuário é, segundo a evidência, a alavanca de retenção de maior ROI do produto (ver §5).

---

## Resumo executivo

1. **O benchmark de churn de apps de fitness é catastrófico, mas é o benchmark errado para a MOVIVO.** Apps de fitness retêm em média 3–4% dos usuários no dia 30 e sofrem ~9,2% de churn mensal. Porém essa base é dominada por apps gratuitos com download por impulso. A MOVIVO é assinatura paga, sem download, em canal de uso diário. As metas de Lucas (80% D30 / 60% D90 de pagantes) são **realistas, não conservadoras** — equivalem a ficar aproximadamente na média do setor de assinatura fitness, não acima dela.
2. **A evidência científica de gamificação em saúde é sólida em existência e fraca em magnitude.** A meta-análise mais robusta disponível (eClinicalMedicine, 2024 — 36 RCTs, 10.079 participantes) encontrou **+489 passos/dia**, classificado pelos próprios autores como efeito **trivial**, e **nenhum efeito significativo** sobre atividade física moderada-a-vigorosa. Os RCTs de referência da UPenn (STEP UP, BE ACTIVE) confirmam efeitos de +538 a +920 passos/dia — reais, replicados, e **modestos**.
3. **O efeito da gamificação decai quando o estímulo para.** Em STEP UP e BE ACTIVE, a atividade caiu em todos os braços de intervenção após o fim do programa. Gamificação, na prática, é um **custo recorrente**, não um investimento com efeito residual.
4. **Restrição econômica decisiva que nenhum agente do pipeline tratou:** a partir de **01/10/2026** (cinco semanas após a data deste relatório), mensagens de serviço dentro da janela de 24h **deixam de ser gratuitas** na WhatsApp Business Platform. Isso significa que, na MOVIVO — diferentemente de um app — **engajamento proativo tem custo marginal positivo por mensagem**. Um streak diário custaria estimados R$1,20–1,50/usuário/mês só em nudges, contra um ticket de R$39/mês. **Gamificação de alta frequência é economicamente hostil ao canal da MOVIVO.**
5. **Streak diário é clinicamente incompatível com o produto.** Musculação exige dias de descanso e deload — são parte do protocolo, não falha de adesão. Um streak que penaliza o descanso pressiona o usuário a treinar lesionado ou em fadiga, exatamente o vetor de risco que a Revisão 2 identificou como **maior na MOVIVO do que no benchmark Zyla**.
6. **Gamificar auto-report corrompe o motor determinístico.** Na MOVIVO a conclusão de treino é **auto-reportada por conversa** (sem wearable no MVP). Dar recompensa por auto-report cria incentivo direto a mentir, e o check-in semanal é justamente o input que ajusta carga e periodização. Isso não é só perda de métrica — é **degradação de segurança do protocolo**.
7. **O que funciona e é barato:** implementation intentions (d ≈ 0,31), goal setting e self-monitoring (os BCTs mais consistentemente associados a mudança de comportamento em atividade física), suporte de autonomia (SDT), e — a maior de todas — **accountability humano perceptível**: programas digitais com coach humano atingem 70–74% de conclusão contra 15–18% de retenção D30 de apps puros.
8. **Recomendação:** aplicar o Tier 0 (§7.1) dentro do MVP agora, com custo próximo de zero; instrumentar retenção por coorte; **diagnosticar a causa do churn antes de tratá-la**. Gamificação trata churn por falta de motivação; se o churn real for por valor percebido (protocolo ruim, IA que não entende), gamificação é analgésico caro sobre um problema de produto.

---

## Contexto recebido

**Da pergunta do fundador:** existem evidências de mercado e de ciência comportamental/neurociência que justifiquem investir em mecanismos de retenção e adesão (gamificação e/ou técnicas neurocientíficas de formação de hábito) na MOVIVO?

**Do `CLAUDE.md`:**
- Produto: AI Coach de treino individualizado, entregue **exclusivamente via WhatsApp** (texto/áudio conversacional), sem app nativo e **sem tela própria**.
- Modelo: B2C assinatura, plano único por período (R$39 mensal / R$99 trimestral / R$349 anual), trial de 7 dias sem cartão. **Tiering de features foi explicitamente rejeitado por Eduardo.**
- ICP: 18–30 anos, digital-native, sensível a preço, vive no WhatsApp.
- **North Star Metric: Treinos Concluídos por Usuário Pago nos Primeiros 30 Dias (meta ≥ 8/30 dias)** — ou seja, ~2 treinos/semana.
- **Guardrails inegociáveis:** nunca "diagnóstico"/"tratamento"/"cura"; nunca "resultado garantido"; a IA nunca decide sozinha — sempre "profissional CREF usando IA como ferramenta"; o respaldo CREF deve ser sempre visível ao usuário.

**Do `01-relatorio-clovis.md` (meu próprio, Revisão 2):**
- Veredito `VALIDADO COM RESSALVAS`. Retenção foi explicitamente listada como **ressalva mantida e não resolvida**.
- **O vetor de risco da MOVIVO é maior que o do benchmark Zyla**: musculação adiciona risco de lesão por execução, que triagem inicial e self-report mitigam mal.
- Regra de ouro de unit economics já estabelecida: **maximizar conversas iniciadas pelo usuário, minimizar templates proativos.**

**Do `08-relatorio-lucas.md`:**
- Linha 300, tabela "Fora do MVP": *"Gamificação (streaks, badges, rankings) — Pode aumentar retenção, mas é uma aposta. Validar retenção orgânica primeiro."*
- Linha 14: a NSM foi escolhida porque treinos concluídos nos primeiros 30 dias é "o preditor mais forte de retenção a 90 dias em plataformas de fitness".
- Épico 6 já existe no MVP: "Check-in Semanal e Retenção". Metas: retenção D30 ≥ 80% e D90 ≥ 60% dos pagantes.

**Do `07-relatorio-eduardo.md` (via CLAUDE.md):** custo incremental de LLM da ordem de ~R$1/usuário/mês; payback de CAC ≤ 3 meses; LTV/CAC ≥ 3.

**Do `06-relatorio-alexandre.md` (via CLAUDE.md):** dados de saúde são dados sensíveis (LGPD art. 11), exigindo consentimento específico e destacado.

---

## Análise e desenvolvimento

### 1. Benchmarks de churn e retenção — e por que o benchmark óbvio é o errado

#### 1.1 Os números do setor

| Métrica | Valor | Fonte |
|---|---|---|
| Retenção D30 média — apps de fitness | **3–4%** (faixa 3–12%) | Business of Apps / RetentionCheck |
| Retenção D30 — melhores apps de fitness | 25% (topo absoluto reportado: 47,5%) | idem |
| Churn mensal médio — apps de fitness | **9,2%** | RetentionCheck |
| Churn mensal — top quartil de apps (qualquer categoria) | 2,0% | idem |
| Apps em geral: perda de DAU | 77% em 3 dias, 90% em 30 dias, >95% em 90 dias | Sahha / GetStream |
| Retenção D90 — apps de fitness (medição alternativa) | 31% | Business of Apps |
| Retenção D1 — apps de fitness | 30–35% (melhores até 45%) | Orangesoft / Business of Apps |
| Dropout médio de intervenções digitais de saúde (RCTs) | **43%** | Frontiers in Digital Health, 2025 |

> **Ressalva metodológica obrigatória:** os números acima divergem entre si por ordem de grandeza (3–4% vs. 31% de retenção) porque medem coisas diferentes — "retenção D30" de instalação vs. "usuários ativos em algum momento da janela de 90 dias" vs. "retenção de assinantes pagantes". **Não se deve comparar diretamente a meta de Lucas com o número de 3–4%.** Vários desses dados vêm de blogs de vendors de retenção, que têm incentivo comercial em apresentar o churn como catastrófico. Tratar como ordem de grandeza, não como medição auditada.

#### 1.2 Por que esse benchmark não se aplica diretamente à MOVIVO

Três diferenças estruturais tornam a comparação enganosa:

1. **Não há download.** A maior parte do churn de apps de fitness acontece na fricção de instalar, cadastrar e voltar a abrir. A MOVIVO opera dentro de um app que o ICP já abre ~30 horas por mês. **A MOVIVO herda o hábito de abrir o WhatsApp** — não precisa criar o hábito de abrir a MOVIVO. Isso é uma vantagem estrutural de retenção real e provavelmente subestimada no pipeline.
2. **Assinatura paga desde o dia 8, não freemium.** Um usuário que passa por trial e coloca cartão já se autosselecionou. Apps de assinatura têm engajamento reportado ~30% superior ao de apps gratuitos.
3. **O concorrente relevante não é "app de fitness", é "personal trainer".** A alternativa real do ICP é abandonar o personal de R$150–600/mês, não desinstalar um app gratuito. O custo psicológico de sair é diferente.

**Implicação para Lucas e Igor:** as metas de retenção do Épico 6 (D30 ≥ 80%, D90 ≥ 60% de pagantes) implicam ~7% de churn mensal composto no primeiro trimestre — ou seja, **aproximadamente a média de assinatura de fitness (9,2%), ligeiramente melhor.** São metas defensáveis, mas **não são metas de produto excepcional**. Se a MOVIVO quiser LTV/CAC ≥ 3 com payback ≤ 3 meses (Eduardo), churn mensal precisa cair para a faixa de 4–6%. **O gap entre "meta atual" e "meta necessária para o unit economics" é o real argumento para investir em retenção** — e esse argumento é mais forte do que qualquer benchmark de gamificação.

#### 1.3 O que diferencia produtos de alta retenção

| Produto | Mecanismo dominante | Dado reportado |
|---|---|---|
| Duolingo | Streak + loss aversion + XP + ligas + identidade ("Streak Society") | Retenção teria subido de 12% → 55%; 50M DAU no Q3/2025, +36% YoY |
| Strava | Desafios + kudos (reforço social entre pares) | Introdução de "Challenges" teria elevado retenção D90 de 18% → 32%, +28% DAU, +15% de assinaturas premium |
| Noom | Coach humano + curso comportamental diário | Receita > US$500M; dados de retenção não publicados de forma auditável |
| Headspace/Calm | Sessão curta diária + streak leve + conteúdo | — |

> **Ressalva crítica de confiabilidade:** os números de Duolingo (12%→55%) e Strava (18%→32%) circulam em blogs de plataformas de gamificação — **fornecedores que vendem exatamente essa solução**. Não localizei fonte primária (relatório a investidores, paper, post de engenharia da própria empresa) que confirme esses deltas. **Tratar como marketing, não como evidência.** A evidência confiável de gamificação está nos RCTs da §2, e ela é bem mais modesta.

**Padrão real por trás dos casos de sucesso, que sobrevive ao ceticismo:** todos os quatro têm (a) uma unidade de valor **curta e diária** (uma lição de 3min, um registro de corrida, uma meditação de 10min) e (b) **um app visual próprio**. **A MOVIVO não tem nenhum dos dois.** Um treino de musculação é uma unidade de 45–70 minutos, 2–4× por semana, e o canal não tem tela. **Copiar Duolingo é uma transposição inválida** — o objeto do hábito é estruturalmente diferente.

---

### 2. Evidência científica: o que a literatura de verdade mostra

#### 2.1 A meta-análise mais robusta disponível — e ela é decepcionante

**Effect of digital health applications with or without gamification on physical activity and cardiometabolic risk factors** — eClinicalMedicine (The Lancet), 2024. 36 RCTs, 49 comparações, **10.079 participantes**, busca em MEDLINE/EMBASE/Cochrane até maio/2024, intervenções ≥8 semanas.

| Desfecho | Efeito | Certeza (GRADE) | Interpretação dos autores |
|---|---|---|---|
| **Passos/dia** | **+489** (IC95% 64–914) | **Alta** | **Melhora trivial** |
| Atividade física moderada-a-vigorosa (MVPA) | **Sem efeito significativo** | Baixa | — |
| Gordura corporal | −1,92% (IC95% −2,71 a −1,14) | **Alta** | Efeito pequeno, porém importante |
| Peso corporal | −0,70 kg (IC95% −1,18 a −0,22) | Moderada | — |
| IMC | −0,28 kg/m² | Moderada | — |
| Circunferência de cintura | −1,16 cm | Moderada | — |
| PA, lipídios, glicemia, dieta | Sem efeito significativo | — | — |

**Leitura estratégica, sem viés:**
- A gamificação **funciona** — o efeito é real, replicado e com alta certeza de evidência. Não é pseudociência.
- A gamificação **funciona pouco.** +489 passos/dia é ~5 minutos de caminhada. Os próprios autores classificam como **trivial**.
- **Não há efeito sobre atividade moderada-a-vigorosa** — que é exatamente a categoria em que treino de musculação se enquadra. **A literatura não demonstra que gamificação aumenta treinos de força concluídos.** Ela mede passos porque passos são fáceis de medir com pedômetro.
- Achado favorável e honesto: **o efeito não decaiu com o tempo de follow-up** (estudos ≥6 meses tiveram efeito similar a estudos <6 meses), sugerindo que, enquanto a intervenção está ligada, ela sustenta.
- As intervenções mais eficazes usaram **múltiplas formas de gamificação combinadas** (62–85%): badges + goal setting + features sociais + feedback. **Meia gamificação não funciona** — o que eleva o custo mínimo de entrada.

#### 2.2 Os RCTs de referência (UPenn / Mitesh Patel) — o padrão-ouro da área

| Estudo | N | Duração | Braço | Efeito vs. controle |
|---|---|---|---|---|
| **STEP UP** (JAMA Intern Med, 2019) | 602 adultos com sobrepeso/obesidade, 40 estados dos EUA | 24 sem. + 12 sem. follow-up | Gamificação + incentivo social **competitivo** | **+920 passos/dia** |
| STEP UP | — | — | Braços colaborativo e de apoio | Significativos, menores que competição |
| **BE ACTIVE** (Circulation, 2024) | 1.062 pacientes de alto risco cardiovascular | 12 meses + 6 meses follow-up | Gamificação isolada | **+538 passos/dia** (IC 186–890) |
| BE ACTIVE | — | — | Incentivo **financeiro** isolado | +492 passos/dia (IC 140–844) |
| BE ACTIVE | — | — | **Gamificação + financeiro** | **+868 passos/dia** (IC 516–1220) |

**Três conclusões que importam para a MOVIVO:**

1. **Competição > colaboração > apoio.** Em STEP UP, o braço competitivo foi o mais eficaz. **Mas competição é justamente o mecanismo que a MOVIVO menos pode usar** (ver §4.3 — LGPD e público de saúde).
2. **O efeito decai quando a intervenção acaba.** Em ambos os trials a atividade caiu no follow-up, mais bruscamente nas primeiras semanas pós-intervenção. Em STEP UP, apenas o braço competitivo permaneceu significativamente acima do controle. **Gamificação não "instala" um hábito autossustentável — ela é um subsídio comportamental contínuo.** Traduzindo para negócio: é OPEX permanente, não CAPEX com retorno residual.
3. **Incentivo financeiro tem efeito equivalente à gamificação, e somados são aditivos.** Isso é estrategicamente relevante: se a MOVIVO quiser um dia investir em incentivo, um **desconto/cashback na mensalidade por adesão** tem evidência tão boa quanto badges, custa em margem (mensurável, controlável) em vez de custar em mensagens WhatsApp, e não gera nenhum dos riscos clínicos de §4. Fica registrado como alternativa de Tier 2.

#### 2.3 Loss aversion — e a condição de contorno que quase todo produto ignora

Rewley et al. (2021), análise secundária de STEP UP publicada em *Games for Health Journal*, testou o mecanismo causal. Achado central:

> Os participantes exibem aversão à perda **desde que a perda se refira a algo que foi conquistado, e não a algo que foi doado/dotado**.

**Implicação de design não-óbvia e diretamente acionável por Victor:** o desenho comum ("você começa com 70 pontos e perde 10 por dia que falhar") funciona **menos** do que o desenho em que o usuário **conquista** o status antes de poder perdê-lo. Se a MOVIVO um dia implementar qualquer mecânica de progressão, ela precisa ser **ganha, nunca presenteada no onboarding**. Isso é gratuito de implementar e é o tipo de detalhe que separa gamificação que funciona de gamificação que é ruído.

#### 2.4 O que tem evidência comparável e custa quase nada

| Técnica | Evidência | Custo de implementação na MOVIVO |
|---|---|---|
| **Implementation intentions** ("quando, onde e como" — Gollwitzer) | Meta-análise (26 estudos): **d = 0,31** pós-intervenção, **d = 0,24** no follow-up. Meta-análises mais recentes: d = 0,14–0,31 | **Uma pergunta no fluxo de anamnese.** Zero mensagem extra. |
| **Self-monitoring** | Meta-revisão: é o BCT que **melhor** melhora mudança de comportamento em atividade física e dieta | Já existe — é o check-in semanal (Épico 6). Falta o *feedback explícito*. |
| **Goal setting** | Meta-revisão: o BCT **mais consistentemente** associado a mudança de comportamento em atividade física | Já existe na anamnese. Falta *revisar a meta na conversa*. |
| **Prompts/cues e "reward contingent on effort or progress"** | Em adultos com obesidade, foram os BCTs com **maiores efeitos** sobre atividade física | Custo: 1 mensagem semanal (já prevista no check-in). |
| **Self-Determination Theory** (autonomia, competência, relacionamento) | Meta-análise de 38 intervenções SDT em saúde: g = 0,29 (motivação intrínseca), g = 0,23 (regulação identificada). Regulação identificada prediz **adoção inicial**; motivação intrínseca prediz **adesão de longo prazo** | **Zero.** É tom de voz e estrutura de escolha no prompt. |
| **Accountability humano** | Programas digitais com coach humano: **70–74% de conclusão** vs. 15–18% de retenção D30 de apps. Prompts percebidos como **automatizados** recebem menos atenção que prompts percebidos como **humanos** | **Zero em custo novo** — o CREF já está no time por obrigação regulatória (ver §5). |

**Este é o achado central da revisão.** As técnicas da tabela acima têm efeito **igual ou superior** ao da gamificação (d ≈ 0,24–0,31 vs. um efeito "trivial" em passos), custam **frações do custo**, e — decisivamente — **são todas nativas de um canal de texto conversacional.** Elas não precisam de tela, badge, contador ou ranking. Elas precisam de **boas perguntas e boas respostas**, que é exatamente o que a MOVIVO já vai construir.

---

### 3. Gamificação em canais 100% conversacionais: o que existe e o que **não** existe

Esta era a pergunta mais específica e mais difícil do fundador. A resposta honesta:

#### 3.1 O que a evidência suporta no canal conversacional

- **Intervenções comportamentais por SMS/chatbot funcionam.** Múltiplos RCTs (Text to Move para diabetes tipo 2; On The Move comparando consultor humano por telefone vs. SMS automatizado; NUDGE para adolescentes) demonstram que **nudges baseados em texto sustentam mudança de comportamento**, usando self-monitoring, feedback, goal setting e revisão de meta — sem qualquer interface visual.
- **Chatbots funcionam no Brasil, no ICP da MOVIVO.** RCT publicado no JMIR mHealth (2023) com **1.715 adolescentes brasileiros de 13–18 anos**: dos que entraram no chatbot, **78,9% completaram ao menos uma microintervenção**. Essa é uma taxa de engajamento com conteúdo estruturado por conversa muito acima do que apps de saúde obtêm — em população brasileira e demograficamente próxima do ICP.
- **Agentes conversacionais com LLM já foram testados em RCT para behavior change support** (Int. J. Human-Computer Studies, 2025), com achado importante: a eficácia **varia fortemente por tipo de usuário** (cooperativo, reflexivo, pré-informado). Isso valida a arquitetura de duas personas de IA que a MOVIVO já adotou, e sugere que **adaptar a estratégia comportamental ao perfil do usuário importa mais do que adicionar mecânicas**.
- **O canal em si é excepcional no Brasil.** ~147M de usuários ativos, ~98% de penetração entre usuários de mensageria, ~30h/mês de uso médio.

> **Ressalva:** as taxas de abertura de WhatsApp amplamente citadas (73%, 98%) vêm de blogs de BSPs e plataformas de marketing — **fornecedores com incentivo comercial direto**. Não há fonte independente auditada. Usar como indicativo de que o canal é forte, **nunca como premissa de modelagem**.

#### 3.2 A lacuna de evidência — declarada explicitamente

**Não localizei nenhum RCT ou estudo controlado que isole o efeito de gamificação (streaks, badges, pontos, ranking) entregue em canal 100% textual sem interface visual própria.**

Toda a evidência quantificada de gamificação em saúde (§2) vem de estudos com **app + wearable/pedômetro**, onde: (a) existe uma tela para renderizar o estado do jogo, e (b) a métrica gamificada é **medida automaticamente pelo dispositivo**, não auto-reportada.

**A MOVIVO não tem nenhuma das duas condições.** Isso significa que qualquer investimento em gamificação na MOVIVO é uma **extrapolação não-testada** de uma literatura cujo efeito, no contexto original mais favorável, já é trivial. Lucas classificou isso como "uma aposta" — **a evidência confirma esse julgamento e o endurece**.

#### 3.3 O único mecanismo que o canal conversacional executa *melhor* que um app

Existe um mecanismo em que WhatsApp bate qualquer app, e é o de maior evidência de toda esta revisão: **a percepção de que há um humano do outro lado.**

A literatura é explícita: prompts percebidos como automatizados recebem menos atenção; prompts percebidos como humanos são mais eficazes, **especialmente quando acompanhados de interação bidirecional** — que é a definição de WhatsApp. Intervenções automatizadas são descritas pelos participantes como "rasas, impessoais e transacionais".

Um app de fitness **não consegue** parecer humano. Uma conversa de WhatsApp assinada por um profissional CREF real **consegue**. Esse é o *unfair advantage* comportamental da MOVIVO, e ele não custa nada além de design de produto (ver §5).

---

### 4. Riscos específicos da MOVIVO — por que gamificação clássica é pior aqui do que na média

Estes cinco riscos são específicos deste produto e, juntos, são mais decisivos do que qualquer benchmark.

#### 4.1 Risco econômico: no WhatsApp, engajamento proativo custa dinheiro (e vai custar mais em 5 semanas)

Esta é a restrição que muda a conta e que **não aparece em nenhum relatório anterior do pipeline**.

- A partir de **01/10/2026**, mensagens de serviço (respostas livres dentro da janela de 24h) **passam a ser cobradas por mensagem** na WhatsApp Business Platform; templates de utilidade perdem o status gratuito dentro da janela. Meta publica as tarifas exatas até 01/09/2026.
- Tarifa de referência de utility no Brasil: **~R$0,04–0,05/mensagem**, mais margem do BSP (tipicamente 10–30%).

**Modelagem grosseira do custo de um streak diário:**

| Mecânica | Msgs proativas/mês | Custo estimado/usuário/mês (R$0,05 + 20% BSP) | % do ticket mensal (R$39) | % do ticket anual equivalente (R$29,08) |
|---|---|---|---|---|
| Streak diário (1 lembrete/dia) | ~30 | **~R$1,80** | 4,6% | 6,2% |
| Streak diário + resposta da IA ao usuário | ~60 | **~R$3,60** | 9,2% | 12,4% |
| Streak/resumo **semanal** | ~4 | ~R$0,24 | 0,6% | 0,8% |
| Check-in semanal (já no MVP) | ~4 | ~R$0,24 | 0,6% | 0,8% |

> Estimativa própria, com tarifa de referência pública; **substituir pela tabela oficial da Meta quando publicada (01/09/2026) e pela tarifa real do BSP (AraraHQ)**. Serve para ordem de grandeza, não para orçamento.

**Conclusão:** Eduardo dimensionou o custo de LLM em ~R$1/usuário/mês. **Um streak diário custaria mais que todo o custo de IA do produto**, para comprar um efeito que a melhor meta-análise disponível classifica como trivial e que sequer foi demonstrado em atividade física de alta intensidade. Isso é uma decisão de alocação de capital claramente ruim no estágio atual.

Isso também **reafirma e endurece a regra de ouro** que estabeleci na Revisão 2 do relatório 01: *maximizar conversas iniciadas pelo usuário, minimizar templates proativos.* Gamificação é, por construção, uma máquina de gerar templates proativos. **Ela empurra o produto na direção oposta ao seu próprio unit economics.**

#### 4.2 Risco clínico: streak diário é contraindicado em musculação

Um streak diário recompensa treinar todos os dias. **Isso é fisiologicamente errado e clinicamente perigoso para o produto da MOVIVO:**

- Descanso e deload **fazem parte do protocolo** de musculação, não são falha de adesão.
- Um streak que quebra no dia de descanso ensina o usuário que descansar é fracasso.
- A Revisão 2 do relatório 01 estabeleceu que **o vetor de risco da MOVIVO (lesão por execução e por sobrecarga) é maior que o do benchmark Zyla**, e que o produto precisa de **camadas de proteção adicionais**. Um streak diário é uma camada de **pressão adicional**, exatamente na direção contrária.
- Além disso, quando o streak quebra, a literatura de gamificação documenta o **abstinence violation effect**: o usuário perde o streak **e o hábito junto**, e o abandono tende a ser abrupto em vez de gradual. Ou seja, o streak concentra o risco de churn num evento único e previsível.

**Um streak que penaliza descanso é incompatível com um produto assinado por um profissional CREF.** Se a MOVIVO adotar qualquer mecânica de sequência, ela precisa ser **semanal e contar o descanso prescrito como cumprimento**, não como quebra.

#### 4.3 Risco regulatório e LGPD: ranking é compartilhamento de dado de saúde

- **Ranking/leaderboard** entre usuários expõe, a terceiros, informação sobre a prática de exercício de um indivíduo. Sob a leitura de Alexandre (LGPD art. 11 — dados sensíveis, consentimento **específico e destacado**), um ranking público seria **compartilhamento de dado sensível de saúde entre titulares**, exigindo base legal e consentimento próprios. É juridicamente caro e desproporcional ao ganho.
- **Leaderboards desmotivam a maioria.** A literatura de gamificação em saúde é consistente: rankings motivam os poucos competitivos e geram estresse, constrangimento e desengajamento na maioria — **especialmente em públicos que gerenciam condição de saúde**. Ironicamente, competição foi o braço mais eficaz em STEP UP; mas STEP UP era um ensaio com participantes voluntários e consentidos, não um produto de consumo com público heterogêneo.
- **Badge/streak não pode implicar promessa de resultado.** Um badge do tipo "Meta batida — resultado a caminho" ou "30 dias, seu corpo já mudou" viola frontalmente o guardrail de "nunca prometer resultado garantido". Qualquer copy de gamificação passaria a exigir revisão de Bruno **e** de Alexandre, adicionando custo de compliance a cada mecânica.
- **Streak freeze pago está duplamente vetado:** colide com a decisão de Eduardo de plano único sem gate de features, e **monetizar ansiedade** é reputacionalmente tóxico para uma marca cuja essência declarada é "Ciência que treina com você" e cujo selo é CREF.

#### 4.4 Risco de integridade de dados: gamificar auto-report corrompe o motor determinístico

Este é o risco mais subestimado e o mais específico da arquitetura da MOVIVO.

Nos RCTs de gamificação, a métrica premiada é **medida por pedômetro/wearable** — o participante não consegue falsificá-la facilmente. Na MOVIVO, wearables estão **explicitamente fora do MVP**, e a conclusão de treino é **auto-reportada em conversa**.

Se a MOVIVO recompensa auto-report, cria incentivo direto para o usuário dizer que treinou quando não treinou. E o auto-report do check-in semanal **não é só uma métrica** — é o **input que alimenta o ajuste de carga e a periodização do protocolo**. Um usuário que infla o report para manter um streak faz o sistema **progredir carga sobre um treino que não aconteceu**.

**Isso transforma um problema de vanity metric em um problema de segurança do protocolo.** É motivo suficiente, isolado, para não gamificar conclusão de treino auto-reportada no MVP. Vale registrar formalmente para Victor e para Sato.

#### 4.5 Risco de motivação: overjustification

A literatura de gamificação documenta o **efeito de sobrejustificação**: aplicar recompensa extrínseca a uma atividade que a pessoa já valoriza intrinsecamente pode **deslocar** a motivação intrínseca. Quando a recompensa externa perde a graça, a motivação colapsa junto.

Isso é diretamente relevante porque o ICP da MOVIVO **já quer treinar** — ele está pagando R$39/mês por orientação, não por entretenimento. Segundo a SDT, o que sustenta adesão de longo prazo é **motivação intrínseca**, e o que sustenta a adoção inicial é **regulação identificada** ("faço porque é importante pra mim"). Ambas são construídas por **autonomia, competência e relacionamento** — e não por pontos. Para este ICP específico, gamificação pesada tem um risco não trivial de ser **contraproducente**, não apenas ineficaz.

---

### 5. O achado não previsto: o CREF é o motor de retenção mais barato que a MOVIVO tem

A evidência mais forte de toda esta revisão não é sobre gamificação.

| Modalidade | Adesão/conclusão |
|---|---|
| Programas digitais **com coach humano** | **70–74% de conclusão** |
| Apps de saúde puros | 15–18% de retenção D30 |
| Intervenções digitais automatizadas (pooled, RCTs) | 43% de dropout |

Mecanismos documentados: quem recebe coaching **passa mais tempo na intervenção, completa mais módulos, adere mais e retém mais**; prompts percebidos como **humanos** superam prompts percebidos como automatizados, sobretudo com interação bidirecional; e a **aliança de trabalho** (working alliance) com um coach humano gera conexão, suporte social e accountability que a automação não reproduz. Nudges de IA retêm bem por 30–60 dias; **accountability humano supera claramente no horizonte de 3–12 meses** — que é exatamente o horizonte do LTV da MOVIVO.

**A leitura estratégica:**

A MOVIVO **já paga** por um profissional CREF. Ele existe hoje por **obrigação regulatória** (Resolução CONFEF 477/2023, RT nomeado). O `CLAUDE.md` inclusive já determina, como guardrail de marca, que *"a presença/respaldo do profissional CREF deve ser sempre visível ao usuário"* — hoje isso está enquadrado como **exigência de compliance e de confiança de marca**.

**A evidência mostra que isso é também a alavanca de retenção de maior ROI do produto.** Um custo fixo que já existe pode gerar o efeito comportamental mais forte da literatura, se — e somente se — o usuário **perceber** o toque humano. A diferença entre "há um CREF supervisionando em algum lugar" e "o Fulano, CREF XXXXX-G/SP, revisou seu protocolo na terça e ajustou seu agachamento" é, do ponto de vista comportamental, a diferença entre 15% e 70% de adesão.

**Isto é uma conversão de custo regulatório em ativo de retenção, sem gasto incremental.** É a recomendação de maior impacto deste relatório e deveria ser priorizada acima de qualquer discussão sobre gamificação.

**Restrição operacional (e é séria):** isso não pode virar promessa de disponibilidade humana ilimitada. O modelo de escala validado na Revisão 2 é *"profissional define a metodologia uma vez → IA opera dentro dos limites → humano entra só em exceção"*. O toque humano precisa ser **real, verificável e de baixa frequência** — nunca simulado pela IA fingindo ser o profissional, o que seria simultaneamente uma violação dos guardrails e um risco jurídico grave. **A IA jamais deve assinar como humano.** A formulação segura é atribuir a **autoria da decisão** ao profissional (que é a verdade contratual e regulatória já estabelecida) e tornar a **revisão humana um evento visível e datado**.

---

## Decisões e entregáveis

### 6. Resposta direta às perguntas do fundador

**"Existem evidências de mercado e de ciência comportamental que justifiquem investir em mecanismos de retenção e adesão?"**
**Sim, e são fortes — mas apontam para técnicas comportamentais nativas de conversa e para accountability humano, não para gamificação.**

**"Vale a pena investir em gamificação agora, early no MVP?"**
**Não.** Cinco razões, em ordem de peso:
1. É **cara no canal** e fica mais cara em 01/10/2026 (custaria mais que todo o custo de IA do produto).
2. Tem evidência de magnitude **trivial** em passos e **nula** em atividade moderada-a-vigorosa — a categoria da musculação.
3. **Não há evidência alguma** de gamificação em canal 100% textual sem tela; seria extrapolação não-testada.
4. Streak diário é **clinicamente contraindicado** em musculação e agrava o vetor de risco já identificado como o maior do produto.
5. Gamificar **auto-report** corrompe o input do motor determinístico — vira risco de segurança, não só de métrica.

**"Ou é melhor validar retenção orgânica primeiro, como o Lucas recomendou?"**
**Sim — a decisão de Lucas está correta e esta revisão a confirma com evidência.** Com uma emenda importante: "validar retenção orgânica primeiro" **não significa lançar uma conversa comportamentalmente ingênua**. O Tier 0 abaixo não é gamificação, custa ~zero, e deve entrar no MVP **agora**. Lançar sem ele seria medir a retenção de um produto pior do que o produto poderia ser sem custo algum — e produziria um baseline enganosamente baixo.

---

### 7. Plano de validação priorizado por custo e velocidade

#### 7.1 TIER 0 — Fazer agora, dentro do MVP. Custo marginal ≈ zero. Não são features; são decisões de prompt e de fluxo.

Todas cabem inteiramente nos Épicos 1 (anamnese), 4 (AI Coach) e 6 (check-in semanal) **já aprovados** por Lucas. Nenhuma adiciona mensagem proativa ao fluxo.

| # | Hipótese | Mecanismo / evidência | Onde implementar | Experimento | Critério de sucesso |
|---|---|---|---|---|---|
| **H1** | Pedir **implementation intention** no onboarding ("em que dias, que horário e onde você vai treinar?") aumenta a NSM | Implementation intentions, d ≈ 0,24–0,31 | Épico 1 — última pergunta da anamnese | A/B no fluxo de anamnese | +15% em Treinos Concluídos/30d no braço tratado |
| **H2** | **Feedback explícito de auto-monitoramento** no check-in ("você fez 3 dos 4 treinos desta semana; na semana passada foram 2") aumenta a NSM | Self-monitoring é o BCT com melhor evidência em atividade física | Épico 6 — corpo da mensagem de check-in (sem msg extra) | A/B na copy do check-in | +10% em treinos concluídos na semana seguinte |
| **H3** | **Toque humano visível e datado** ("[Nome], CREF XXXXX-G/SP, revisou seu protocolo hoje e ajustou X") aumenta retenção D30 | Coach humano 70–74% conclusão vs. 15–18%; prompts humanos > automatizados | Épico 4 + Épico 6 | A/B: check-in genérico vs. check-in com revisão humana atribuída | +10pp de retenção D30 no braço tratado |
| **H4** | **Suporte de autonomia (SDT)** — oferecer escolha real ("prefere agachamento livre ou leg press? os dois cabem no seu protocolo") aumenta adesão | SDT: autonomia → motivação autônoma → adesão de longo prazo (g ≈ 0,23–0,29) | Épico 4 — substituição de exercício | A/B: IA decide vs. IA oferece 2 opções válidas | +8% em treinos concluídos; menor taxa de abandono D30 |
| **H5** | **Revisão de meta** no check-in ("sua meta era X; ainda faz sentido?") aumenta adesão | Goal setting é o BCT mais consistentemente associado a mudança de comportamento | Épico 6 | A/B na copy | Aumento em treinos concluídos + qualitativo |
| **H6** | **Diagnóstico de churn** — entrevista/pergunta única no cancelamento e no lapso | Pré-requisito para qualquer decisão de Tier 1/2 | Fluxo de cancelamento + inatividade | Instrumentação, não A/B | ≥60% dos churns classificados em: motivação / valor percebido / preço / vida pessoal |

> **H6 é o item mais importante da tabela e o mais barato.** Gamificação trata **churn por falta de motivação**. Se o churn real da MOVIVO for por **valor percebido** ("o protocolo não me serviu", "a IA não entendeu meu joelho"), gamificação é analgésico caro sobre um problema de produto — e o dinheiro deveria ir para o motor determinístico e para os prompts de Victor. **Não autorizar nenhum investimento em Tier 1 ou 2 antes de H6 responder.**

#### 7.2 TIER 1 — Só após 60 dias de baseline com n ≥ 100 pagantes. Custo baixo, exige instrumentação.

| # | Hipótese | Desenho seguro (respeitando §4) | Custo estimado |
|---|---|---|---|
| **H7** | **Sequência semanal** (não diária), em que **o descanso prescrito conta como cumprimento** e a quebra **não é punida** | 4 mensagens/mês (piggyback no check-in já existente, sem msg nova) | ~R$0 incremental |
| **H8** | **Reengajamento por lapso** — mensagem única após N dias sem treino, com reframing **sem culpa** ("semana puxada acontece; quer que eu reduza o volume desta semana?") | 1 template proativo, disparo condicional, com cap de frequência | ~R$0,06/disparo |
| **H9** | **Marcos de competência** (não de vaidade) — reconhecer **progressão de carga real** ("seu agachamento saiu de 40kg para 55kg em 8 semanas") | Dentro do check-in. **Competência (SDT), não badge.** Nunca implica resultado estético garantido | ~R$0 incremental |

**Guardrails obrigatórios do Tier 1:**
- Sequência **semanal**, jamais diária.
- Descanso prescrito **conta como cumprimento**.
- **Nenhuma punição, nenhuma perda visível, nenhum contador de fracasso.**
- **Nenhuma recompensa condicionada a auto-report** de conclusão de treino (§4.4) — recompensar apenas o que o sistema observa por si (ex.: o usuário respondeu ao check-in), nunca o que o usuário afirma ter feito.
- Toda copy revisada contra os guardrails: sem "diagnóstico"/"tratamento"/"cura", sem "resultado garantido", IA nunca como quem decide.

#### 7.3 TIER 2 — Não antes de PMF demonstrado e de H6 respondido. Alto custo, alto risco.

| Mecânica | Veredito | Justificativa |
|---|---|---|
| Badges / pontos / níveis | **Adiar.** Só se H6 mostrar churn por motivação **e** Tier 0/1 tiverem se esgotado | Efeito trivial; overjustification; custo de copy e compliance recorrente |
| Ranking / leaderboard / competição | **Vetado no formato público.** Reavaliar apenas em formato opt-in, anônimo e por coorte | LGPD art. 11 (dado sensível entre titulares); desmotiva a maioria; risco reputacional com selo CREF |
| Streak diário | **Vetado.** | Clinicamente contraindicado em musculação; custo de nudge; abstinence violation effect |
| Streak freeze pago | **Vetado.** | Colide com plano único (Eduardo); monetiza ansiedade sob selo CREF |
| **Incentivo econômico** (desconto/cashback na renovação por adesão) | **Alternativa preferível ao Tier 2 de gamificação** | Evidência equivalente à gamificação em RCT (BE ACTIVE: +492 vs. +538 passos/dia); custo em **margem** (controlável, mensurável) em vez de custo em **mensagens**; zero risco clínico; **precisa de aprovação de Eduardo** (impacto direto em LTV) |
| Gamificação social **fora** do produto (comunidade, desafios via Cahuã nas redes) | **Explorar — é o caminho mais barato de reforço social** | Move o custo de engajamento para canais orgânicos (Camila/Cahuã), fora do WhatsApp tarifado, sem expor dado de saúde individual |

#### 7.4 Gates de decisão

Não avançar de tier sem cumprir o gate anterior:

- **Gate 1 → Tier 1:** baseline de NSM (Treinos Concluídos/30d) com **n ≥ 100 pagantes** e **≥60 dias**, curva de retenção por coorte instrumentada, e **H6 respondido** (causa dominante de churn classificada).
- **Gate 2 → Tier 2:** Tier 0 e Tier 1 completos e medidos; churn por **motivação** confirmado como causa dominante (≥40% dos casos); NSM ainda abaixo de 8/30d **apesar** do Tier 0/1; tabela oficial de tarifas da Meta (pós-01/10/2026) modelada por Eduardo com o custo real de nudge por usuário.

---

## Recomendações para os próximos agentes

### Para **Lucas** (08 — Gerente de Produto) — spec de produto

1. **Manter gamificação clássica fora do MVP.** Sua decisão original está confirmada. **Atualizar a justificativa** na tabela "Fora do MVP" (linha ~300 de `08-relatorio-lucas.md`) de *"é uma aposta"* para algo como: *"evidência de magnitude trivial em RCT, sem evidência em canal 100% textual, custo de nudge proativo relevante pós-01/10/2026, e streak diário clinicamente contraindicado em musculação (ver `22-relatorio-clovis-retencao-gamificacao.md`)"*.
2. **Incorporar o Tier 0 (§7.1) como critérios de aceite dos Épicos 1, 4 e 6 já existentes** — não como novos épicos. São 5 hipóteses, todas de custo ≈ zero, todas testáveis por A/B de copy/fluxo. Isso **não atrasa o MVP**.
3. **H1 (implementation intention) é o item de maior relação evidência/custo do relatório inteiro:** uma pergunta a mais no fim da anamnese, d ≈ 0,31 na literatura. Priorizar.
4. **H3 (toque humano visível) precisa de spec própria:** definir a cadência mínima de revisão real do CREF, como ela é registrada, e como é comunicada ao usuário de forma verdadeira. **A IA nunca assina como o profissional.** Coordenar com Alexandre.
5. **H6 (diagnóstico de churn) é pré-requisito de qualquer investimento futuro em retenção.** Instrumentar no MVP: pergunta única no cancelamento + classificação. Sem isso, a decisão de Tier 1/2 será feita no escuro.
6. **Revisar as metas do Épico 6.** D30 ≥ 80% / D90 ≥ 60% equivalem a ~7% de churn mensal — média de mercado. Para o LTV/CAC ≥ 3 com payback ≤ 3 meses exigido por Eduardo, a faixa necessária é provavelmente **4–6% de churn mensal**. Vale explicitar esse gap com Eduardo e Igor.
7. **Adicionar ao backlog uma regra de produto:** nenhuma mecânica de recompensa pode ser condicionada a **conclusão de treino auto-reportada** enquanto não houver verificação independente (wearable, Fase 2). Registrar como restrição de arquitetura de produto, não como preferência.

### Para **Victor** (12 — Engenheiro de IA) — prompt e context design

1. **Este relatório é majoritariamente sobre prompt design, não sobre features.** O Tier 0 inteiro se implementa dentro dos system prompts e do fluxo conversacional que você já vai escrever.
2. **Codificar as BCTs no system prompt do AI Coach:** goal setting, self-monitoring com feedback explícito de progresso, revisão de meta, e prompts/cues. São os BCTs com melhor evidência em atividade física e são **conteúdo de conversa**, não features.
3. **Codificar suporte de autonomia (SDT) como diretriz de tom permanente:** sempre que houver duas alternativas tecnicamente válidas, **oferecer a escolha em vez de decidir pelo usuário**. Autonomia e competência são os drivers de motivação autônoma; motivação autônoma é o que prediz adesão de longo prazo. Isso é compatível com o guardrail CREF — a escolha é sempre **dentro dos limites do protocolo pré-aprovado**.
4. **Construir "competência percebida" no check-in:** o feedback deve enfatizar **progressão objetiva de carga/volume** ("40kg → 55kg em 8 semanas"), não estética e nunca resultado prometido. Isso ataca "competência" (SDT) sem tocar no guardrail de "resultado garantido".
5. **Se algum dia houver progressão/status, ela deve ser CONQUISTADA, nunca dotada.** Achado de Rewley et al.: aversão à perda só opera sobre o que foi ganho. Registrar para não errar isso quando o Tier 1/2 chegar.
6. **Memória de contexto a serviço do accountability:** a evidência sobre intervenções automatizadas serem percebidas como "rasas e transacionais" implica que a memória de longo prazo do usuário (histórico, lesões, preferências, o que ele disse na semana passada) é uma **feature de retenção**, não só de qualidade. Lembrar do usuário é o que faz a conversa parecer humana.
7. **Nunca simular o humano.** A IA jamais deve assinar como o profissional CREF nem sugerir que é ele quem está digitando. A formulação correta e verdadeira é atribuir a **autoria da metodologia e da decisão** ao profissional, e marcar a **revisão humana como evento real e datado**. Isso é simultaneamente guardrail de marca, requisito jurídico e — pela evidência — o que gera o efeito de retenção.
8. **Guardrail de segurança conversacional:** o AI Coach nunca deve pressionar por continuidade. Se o usuário reporta dor, fadiga ou falta de tempo, a resposta correta é **ajustar o protocolo ou acolher o descanso**, jamais invocar sequência, meta ou perda. Registrar como regra explícita no prompt — é onde uma mentalidade de gamificação mal calibrada causaria dano real.

### Para **Eduardo** (07 — Financeiro)

- **Ação com prazo:** a Meta publica as tarifas definitivas de mensagem de serviço até **01/09/2026**, com vigência em **01/10/2026**. Remodelar o custo variável por usuário/mês com as tarifas reais e a margem do BSP (AraraHQ) antes de qualquer decisão sobre engajamento proativo. **A premissa de "conversa grátis dentro da janela de 24h" que atravessa vários relatórios do pipeline deixa de valer.**
- Avaliar o **incentivo econômico de adesão** (desconto/cashback na renovação) como alternativa de Tier 2 preferível à gamificação: mesma evidência em RCT, custo em margem em vez de custo em mensagens.

### Para **Renata** (20 — Customer Success) e **Igor** (21 — Growth)

- **Renata:** o achado de §5 é seu — accountability humano perceptível é o maior driver de retenção documentado, e ele se materializa na jornada pós-conversão. Desenhar a cadência de toque humano real (baixa frequência, alta percepção) e o fluxo de reengajamento por lapso **sem culpa** (H8), evitando o abstinence violation effect.
- **Igor:** H6 (diagnóstico de churn) e a instrumentação de coorte são pré-requisito de todos os experimentos deste plano. Os experimentos do Tier 0 são A/B de copy e fluxo, baratos e paralelizáveis. Priorizar H1 e H3 como os primeiros testes do produto.

---

## Limitações desta pesquisa (declaração explícita)

1. **Não localizei nenhum estudo controlado que isole gamificação em canal 100% textual sem interface visual.** Toda a evidência quantificada de gamificação em saúde vem de contextos com app + wearable. Qualquer projeção para a MOVIVO é extrapolação, e está sinalizada como tal ao longo do relatório.
2. **A literatura de gamificação em atividade física mede quase exclusivamente passos/dia**, porque é o que o pedômetro captura. **Não encontrei evidência de RCT sobre o efeito de gamificação em sessões de treino de força concluídas** — que é exatamente a North Star Metric da MOVIVO. Esta é a lacuna de evidência mais relevante do relatório.
3. **Os números de Duolingo (12%→55%) e Strava (18%→32%) vêm de blogs de fornecedores de plataformas de gamificação**, com incentivo comercial direto. Não localizei fonte primária. Tratados como marketing, não como evidência, e não usados para sustentar nenhuma recomendação.
4. **As taxas de abertura de WhatsApp (73%–98%) vêm de blogs de BSPs**, igualmente com incentivo comercial. Usadas apenas como indicativo qualitativo da força do canal.
5. **A modelagem de custo de nudge (§4.1) é estimativa própria** com tarifa pública de referência (~R$0,04–0,05/mensagem utility no Brasil + margem de BSP). A Meta publica as tarifas oficiais até 01/09/2026 — **substituir antes de qualquer decisão orçamentária**.
6. **Não localizei dados de retenção auditáveis da Noom**, nem dados de retenção de nenhum concorrente brasileiro direto (incluindo Zyla). O benchmark competitivo de retenção no mercado brasileiro **não existe publicamente** — a MOVIVO terá que gerar o próprio.
7. Nada aqui constitui parecer clínico ou jurídico. As considerações de contraindicação clínica (§4.2) devem ser confirmadas pelo Responsável Técnico CREF; as de LGPD (§4.3), por Alexandre.

---

## Fontes Consultadas

**Meta-análises e RCTs — gamificação e mudança de comportamento**
- Effect of digital health applications with or without gamification on physical activity and cardiometabolic risk factors: systematic review and meta-analysis of RCTs — *eClinicalMedicine* (The Lancet), 2024: https://www.thelancet.com/journals/eclinm/article/PIIS2589-5370(24)00377-8/fulltext e https://pmc.ncbi.nlm.nih.gov/articles/PMC11701442/
- STEP UP — Effectiveness of Behaviorally Designed Gamification Interventions With Social Incentives for Increasing Physical Activity (RCT, n=602): https://pubmed.ncbi.nlm.nih.gov/31498375/ e https://chti.upenn.edu/step-up
- STEP UP — análise secundária por fenótipo comportamental, *PLOS One*: https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0239288
- BE ACTIVE — Effect of Gamification, Financial Incentives, or Both to Increase Physical Activity (RCT, n=1062, 12 meses), *Circulation*, 2024: https://www.ahajournals.org/doi/10.1161/CIRCULATIONAHA.124.069531 e https://pmc.ncbi.nlm.nih.gov/articles/PMC11795842/
- Rewley et al. — Loss Aversion Explains Physical Activity Changes in a Behavioral Gamification Trial, *Games for Health Journal*, 2021: https://journals.sagepub.com/doi/abs/10.1089/g4h.2021.0130
- Effectiveness of mHealth Gamification Interventions for Physical Activity in Cardiovascular Disease: systematic review and meta-analysis: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11806271/
- Gamification interventions for physical activity in children and adolescents: systematic review and meta-analysis: https://pmc.ncbi.nlm.nih.gov/articles/PMC12445784/
- GAMEPAD — Gamification Plus Automated Coaching in Peripheral Artery Disease (RCT): https://pmc.ncbi.nlm.nih.gov/articles/PMC12826907/

**Ciência comportamental — hábito, intenção e motivação**
- A meta-analytic review of the effect of implementation intentions on physical activity — *Health Psychology Review*: https://www.tandfonline.com/doi/abs/10.1080/17437199.2011.560095
- Impact of implementation intentions on physical activity practice in adults: systematic review and meta-analysis of RCTs — *PLOS One*: https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0206294
- HabitWalk: micro-randomized trial on habit formation in physical activity — *Applied Psychology: Health and Well-Being*, 2025: https://iaap-journals.onlinelibrary.wiley.com/doi/10.1111/aphw.12605
- Reinforcing implementation intentions with imagery increases physical activity habit strength — *British Journal of Health Psychology*, 2025: https://bpspsychub.onlinelibrary.wiley.com/doi/full/10.1111/bjhp.12795
- A meta-analysis of self-determination theory-informed intervention studies in the health domain — *Health Psychology Review*: https://www.tandfonline.com/doi/full/10.1080/17437199.2020.1718529
- Exercise, physical activity, and self-determination theory: a systematic review — *IJBNPA*: https://link.springer.com/article/10.1186/1479-5868-9-78
- Self-regulatory behaviour change techniques in interventions to promote healthy eating, physical activity, or weight loss: a meta-review: https://pubmed.ncbi.nlm.nih.gov/31973666/
- What are the most effective techniques in changing obese individuals' physical activity self-efficacy and behaviour: systematic review and meta-analysis: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3639155/
- Abraham & Michie — Development of a taxonomy of behaviour change techniques: https://www.dhi.ac.uk/san/waysofbeing/data/health-jones-michie-2011b.pdf

**Canais conversacionais, SMS e chatbots em saúde**
- Using Chatbot Technology to Improve Brazilian Adolescents' Body Image and Mental Health at Scale: RCT — *JMIR mHealth and uHealth*, 2023 (n=1.715): https://mhealth.jmir.org/2023/1/e39934 e https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10337468/
- LLM-based conversational agents for behaviour change support: RCT examining efficacy, safety and the role of user behaviour — *Int. J. Human-Computer Studies*, 2025: https://www.sciencedirect.com/science/article/pii/S1071581925000710
- Text to Move: RCT of a Text-Messaging Program to Improve Physical Activity in Type 2 Diabetes: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5135731/
- Human Telephone vs Text Message Counseling and Physical Activity Among Midlife and Older Adults: RCT: https://pmc.ncbi.nlm.nih.gov/articles/PMC12411977/
- Design of a Temporally Augmented Text Messaging Bot to Improve Adolescents' Physical Activity (NUDGE): https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11502983/
- AI-Based Chatbots for Promoting Health Behavioral Changes: Systematic Review: https://pubmed.ncbi.nlm.nih.gov/36826990/

**Coaching humano vs. automação**
- Systematic review exploring human, AI, and hybrid health coaching in digital health interventions: trends, engagement, and lifestyle outcomes — *Frontiers in Digital Health*, 2025: https://www.frontiersin.org/journals/digital-health/articles/10.3389/fdgth.2025.1536416/full e https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12058678/
- The Impact of Personalized Human Support on Engagement With Behavioral Intervention Technologies: https://pmc.ncbi.nlm.nih.gov/articles/PMC9091343/
- Achieving clinically meaningful outcomes in digital health: the ENGAGE precision engagement framework — *Frontiers in Digital Health*, 2025: https://www.frontiersin.org/journals/digital-health/articles/10.3389/fdgth.2025.1713334/full

**Benchmarks de retenção e churn (fontes secundárias — ver limitações)**
- Business of Apps — Health & Fitness App Benchmarks: https://www.businessofapps.com/data/health-fitness-app-benchmarks/
- Sahha — Why Most Health App Users Churn Within 90 Days: https://sahha.ai/blog/health-app-churn-retention/
- RetentionCheck — Fitness App Retention & Churn Rate: https://retentioncheck.com/churn-benchmarks/fitness-apps
- GetStream — Guide to App Retention: Benchmarks and Stats: https://getstream.io/blog/app-retention-guide/
- Orangesoft — Strategies to Increase Fitness App Engagement and Retention: https://orangesoft.co/blog/strategies-to-increase-fitness-app-engagement-and-retention

**Casos de gamificação (fontes de vendors — baixa confiabilidade, ver limitações)**
- StriveCloud — Duolingo gamification explained: https://www.strivecloud.io/duolingo-gamification-explained
- StriveCloud — How Strava Drives App Engagement: https://www.strivecloud.io/blog/app-engagement-strava
- Digia — Duolingo's Habit-Forming Reminders: A UX Breakdown: https://www.digia.tech/post/duolingo-habit-forming-reminders-retention-architecture/

**Riscos e falhas de gamificação**
- The Decision Lab — Streak Creep: When Gamified Engagement Mechanics Backfire: https://thedecisionlab.com/insights/consumer-insights/streak-creep-the-perils-of-too-much-gamification
- Growth Engineering — The Dark Side of Gamification: When Points, Badges & Leaderboards Go Wrong: https://www.growthengineering.co.uk/dark-side-of-gamification/
- Visit App — Common Gamification Mistakes in Wellness: https://getvisitapp.com/blog/wellness-rewards/common-gamification-mistakes-employee-wellness/
- UX Magazine — Gamification 2.0: Beyond Points and Badges: https://uxmag.com/articles/gamification-2-0-beyond-points-and-badges-designing-for-players-not-metrics-chapter-1-the-problem
- The Decision Lab — Loss aversion: https://thedecisionlab.com/biases/loss-aversion

**Economia do canal WhatsApp**
- Meta / Developers — Pricing on the WhatsApp Business Platform: https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
- WhatsApp Service Message Pricing Changes in October 2026 — SendPulse: https://sendpulse.com/blog/whatsapp-service-message-pricing
- WhatsApp Service Message Pricing Changes Explained (2026) — Wati: https://www.wati.io/en/blog/whatsapp-service-message-pricing/
- WhatsApp Business Pricing Changes from 1 October 2026 — AiChat: https://www.aichat.com/blog/whatsapp-business-pricing-changes-2026
- WhatsApp Business API Pricing in Brazil 2026 — Message Central: https://www.messagecentral.com/blog/whatsapp-business-api-pricing-brazil
- WhatsApp Business API Pricing Brazil 2026 (BRL) — Whautomate: https://whautomate.com/whatsapp-business-api-pricing-brazil
- Relatório WhatsApp 2026: dados, tendências e insights para empresas — DisparoPro: https://disparopro.com.br/relatorio-whatsapp-marketing/
- 50 Estatísticas WhatsApp Business 2026 — SocialHub: https://www.socialhub.pro/blog/50-estatisticas-whatsapp-business-2026/
