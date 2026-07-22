# Relatório — Eduardo Albuquerque (CFO / Head Financeiro)

**Data:** 2026-07-22
**Ideia analisada:** MOVIVO — AI Coach de treino individualizado via WhatsApp, com supervisão de profissional de Educação Física (CREF). B2C, assinatura recorrente, trial curto.
**Pasta do projeto:** `docs/fitness-ia-whatsapp/`
**Status do pipeline:** Fase 2 (Fundação Legal e Financeira) — **executada FORA DE ORDEM.** Lucas (Fase 3) e Rafael (Fase 4) já rodaram assumindo hipóteses financeiras (pricing R$29–59, margem 92–93%, custo variável R$2,30–4,10) que este relatório agora **valida, corrige ou substitui**. Atuo em par com Alexandre (CLO), cujo relatório já existe e cujos 5 bloqueadores impactam diretamente meu modelo. Onde divirjo de Rafael/Lucas, sinalizo com **[DIVERGÊNCIA]** ou **[CORREÇÃO]**.

> **Aviso obrigatório (honestidade financeira):** este relatório é insumo estratégico de um CFO interno. **Não substitui** contador registrado no CRC (obrigatório para constituição, enquadramento e escrituração), auditor independente, nem consultoria tributária formal para decisões de alto impacto. Números de mercado são benchmarks direcionais, não previsões auditadas. Câmbio de referência usado: **USD/BRL = R$ 5,45**.

---

## Resumo executivo

A MOVIVO é **financeiramente viável e bootstrapável sem capital externo** para chegar ao MVP e ao break-even. A margem de contribuição é estruturalmente alta, e — este é o achado mais importante — **a troca de LLM exigida pela LGPD (DeepSeek-China → GPT-4.1/Claude, bloqueador 2 de Alexandre) NÃO quebra o unit economics.** O custo de LLM é um item marginal (<3% do ARPU) nos dois cenários; a decisão financeiramente correta é obedecer ao Alexandre, porque o "argumento de custo" a favor do DeepSeek se dissolve quando se vê que LLM é praticamente um arredondamento.

**Decisões financeiras centrais:**

1. **Pricing:** rejeito a diferenciação por *features* (Básico vs Pro do schema de Rafael) no MVP. Recomendo **plano único diferenciado por período de compromisso** — Mensal R$ 39 / Trimestral R$ 99 (R$ 33/mês) / **Anual R$ 349 (R$ 29/mês)** — dentro da banda validada por Clóvis (R$ 29–59) e alinhado à alavanca de retenção de Helena (compromisso anual retém 33% vs. colapso do mensal). ARPU-alvo misto ≈ **R$ 34/mês**. Feature-tier ("MOVIVO+") só na Fase 2, com dados.

2. **Regime tributário:** **Simples Nacional, Anexo III (início 6%)**, condicionado ao **Fator R ≥ 28%** — este é o principal lever tributário do negócio. A atividade de condicionamento físico (CNAE 9313-1/00) cai por padrão no **Anexo V (início 15,5%)**; estruturar pró-labore/folha para atingir 28% da receita **economiza ~9,5 pontos de alíquota** (em R$ 180K/ano, ~R$ 17 mil). O objeto social híbrido que Alexandre exige (EF atividade-fim + tecnologia meio) é **compatível** com essa estratégia.

3. **[CORREÇÃO a Rafael] A margem de "92–93%" está certa como margem de CAIXA, mas mal rotulada** — ela **ignora o custo de supervisão do profissional CREF**, que Clóvis e Helena marcaram como custo-chave. Margem **totalmente carregada** (RT remunerado no scale + LLM LGPD-safe + tributo) fica em **~70–78%** — ainda excelente, mas os sócios não podem planejar em cima de 92%.

4. **[CORREÇÃO a Rafael] Custo de WhatsApp subestimado** e mal alocado: a sequência de conversão (dias 7/10/13/14) usa *templates* de marketing (~R$ 0,31–0,38 cada em 2026), gastos **em todo trialista, inclusive nos que não convertem** — isso é **CAC, não COGS**.

5. **Capital para o MVP:** **não precisa de aporte externo.** Necessidade total (setup jurídico + 6 meses de runway + buffer) ≈ **R$ 20–30 mil**, aportável pelos 5 sócios (~R$ 4–6 mil cada). Burn recorrente pré-receita ≈ **R$ 1.000/mês**. Break-even de caixa em **~40–60 assinantes pagos**.

6. **Captação futura:** não é prioridade. Quando as métricas de Fase 2/3 fecharem (LTV/CAC ≥ 3, retenção provada), captar **R$ 500 mil–1,5 mi via mútuo conversível** (o "SAFE brasileiro") para acelerar aquisição paga + credenciar RTs + estruturar operação.

---

## Contexto recebido

Do pipeline (Clóvis → Gabriel → Caio → Kimura → Helena → Lucas → Rafael → Alexandre):

- **Clóvis:** pricing hipotético R$ 29–59/mês (**não validado**); unit economics "apertados" (LLM + WhatsApp + hora CREF vs. ticket baixo); meta LTV/CAC ≥ 3; retenção como variável de vida ou morte; cadência gated (smoke test → concierge → escala).
- **Helena:** CAC ~R$ 0–20 na fase orgânica (Cahuã); metas LTV/CAC ≥ 3, **payback ≤ 2 meses**, churn ≤ 8%/mês estabilizando, retenção mês-1 ≥ 55–60%, trial→pago ≥ 40%; empurrar planos trimestral/anual; alerta permanente de **margem de contribuição por assinante**.
- **Lucas:** pediu-me **explicitamente** (bloqueador): (a) validar pricing R$ 29–59; (b) diferenciação Básico vs Pro; (c) trial com cartão obrigatório vs. sem; (d) política de reembolso; (e) PIX recorrente. Meta MRR ≥ R$ 5.000 no mês 3; LTV ≥ R$ 400; CAC ≤ R$ 30 orgânico; LTV/CAC ≥ 10 orgânico.
- **Rafael:** custo variável R$ 2,30–4,10/usuário; margem 92–93%; break-even ~100 usuários (só infra); VPS R$ 75/mês; DeepSeek principal (R$ 0,07/usuário LLM); schema com planos `BASICO`/`PRO`; gateways Stripe + Asaas.
- **Alexandre (par de Fase 2):** 5 bloqueadores. Os que me tocam: **(BL2)** DeepSeek-China vedado para dado de saúde → possível troca de LLM; **(BL1)** LTDA + CREF-PJ + RT antes do go-live; objeto social EF-compatível; custo de registros (INPI, CREF-PJ, cartório), **contrato de RT (sócio + prestador, sem vínculo CLT disfarçado)**, seguro de RC; vesting cliff 12m/48m; direito de arrependimento CDC art. 49 impacta o fluxo de conversão.

Fundadores: Rodrigo, Pedro, Joaquim (devs), Cahuã (marketing/rosto) e o treinador do Cahuã (CREF/RT). **Sem capital externo — bootstrapped.**

---

## 1. Diagnóstico Financeiro

O negócio tem um perfil financeiro **raro para early-stage**: custo marginal por usuário baixíssimo (produto digital + canal WhatsApp com conversa iniciada pelo usuário gratuita) contra um ticket recorrente. Isso gera margem de contribuição alta. As três variáveis que realmente decidem o resultado **não são** o LLM (obsessão de Rafael e Alexandre), e sim:

1. **Retenção / churn** — determina o LTV e, portanto, quanto se pode gastar para adquirir. É o eixo de Helena e o correto.
2. **Custo de meios de pagamento** — 2–3,4% do ticket é, isoladamente, o **maior** custo variável de caixa, maior que o LLM.
3. **Custo de supervisão humana (RT-CREF)** — semi-fixo, ignorado por Rafael, é o que separa "margem de caixa de 92%" de "margem econômica real de ~75%".

O LLM, mesmo no cenário LGPD-safe mais caro (Claude standard), é <5% do ARPU. **Portanto, o risco financeiro do negócio é comercial (reter e adquirir barato), não de custo de infraestrutura.**

---

## 2. Análise Contábil

- **Tipo societário:** LTDA (validado por Alexandre; S.A. é desproporcional aqui). Escrituração contábil completa desde o dia 1 (Balanço, DRE, DFC) — não apenas fiscal — porque due diligence de captação futura exige histórico contábil limpo, e porque o **Fator R** depende de controle mensal preciso de folha/pró-labore.
- **Plano de contas com centros de custo** separando: (a) Infra/Cloud, (b) IA/LLM, (c) WhatsApp/BSP, (d) Meios de pagamento, (e) Supervisão técnica (RT), (f) Marketing/CAC, (g) Jurídico/Compliance. Isso permite FinOps real e alimenta o dashboard de unit economics que Helena pediu.
- **Reconhecimento de receita (competência):** assinatura anual recebida à vista deve ser **diferida** (reconhecida 1/12 ao mês como receita; o restante é passivo de "receita diferida"). Crítico para não superestimar lucro e para calcular churn/LTV corretamente. Impacta caixa (entra tudo) vs. resultado (reconhece proporcional).
- **Contador registrado no CRC é obrigatório** (~R$ 400–700/mês) — não terceirizável a um sócio. É o guardião do Fator R e do enquadramento.

---

## 3. Análise Tributária

### 3.1 Regime recomendado: Simples Nacional — Anexo III via Fator R

| Regime | Alíquota inicial | Aplicabilidade à MOVIVO | Veredito |
|---|---|---|---|
| **MEI** | Fixo | **Vedado** — CNAE 9313-1/00 não permite MEI | Impossível |
| **Simples — Anexo V** | 15,5% | Default para condicionamento físico **sem** Fator R | Evitar |
| **Simples — Anexo III** | **6%** | Se **Fator R ≥ 28%** (folha+pró-labore ÷ RBT12) | **RECOMENDADO** |
| **Lucro Presumido** | ~13,33%+ (ISS+PIS/COFINS+IRPJ+CSLL sobre presunção 32%) | Só vantajoso em alta receita com folha baixa | Reavaliar >R$ 2–3 mi/ano |

**Fundamento:** a atividade-fim (orientação de exercício sob RT) classifica-se como **serviço de condicionamento físico (CNAE 9313-1/00)**, sujeito ao **Fator R**. Por padrão cai no **Anexo V (15,5% inicial)**. Se a soma de **folha de salários + pró-labore dos últimos 12 meses (RBT12)** for **≥ 28% da receita bruta**, migra para o **Anexo III (6% inicial)** — uma economia de **~9,5 pontos percentuais**.

**Recomendação-chave (planejamento tributário lícito — elisão, não evasão):** estruturar a remuneração dos sócios que trabalham (os 3 devs + o RT) via **pró-labore** de forma a **atingir e manter o Fator R ≥ 28%**. Como esses sócios seriam remunerados de qualquer modo, a otimização é quase "de graça". **Caveat obrigatório:** pró-labore gera **INSS 11% (retido) + IRPF na fonte**; o ganho de Simples deve ser modelado **líquido** desse custo — o contador deve rodar o ponto ótimo mês a mês. Em geral compensa fortemente quando os sócios já receberiam pró-labore.

**Ilustração do impacto (faixa 1, receita até R$ 180 mil/ano):**
- Anexo V (15,5%): ~R$ 27.900/ano de DAS
- Anexo III (6%): ~R$ 10.800/ano de DAS
- **Economia: ~R$ 17.100/ano** já na largada — cresce com o faturamento.

### 3.2 Evolução conforme o faturamento cresce

- **Faixa 1 (até R$ 180K/ano):** Anexo III 6% efetivo. MVP e Fase 2.
- **Faixas 2–3 (R$ 180K–720K/ano):** alíquota efetiva sobe (progressiva, com parcela a deduzir). Manter Fator R ≥ 28% continua valendo muito.
- **Teto Simples: R$ 4,8 mi/ano.** Ao se aproximar, planejar transição para Lucro Real/Presumido **com antecedência** (impacta preço e margem) — decisão para quando o problema existir, com o contador.
- **Sublimite de ICMS/ISS (R$ 3,6 mi):** acima disso, ISS passa a ser recolhido fora do DAS. Relevante só na tração.

**Nota de alinhamento com Alexandre:** o objeto social precisa declarar a **prestação de serviço de EF (atividade-fim)** para habilitar o CREF-PJ. Isso **coincide** com o CNAE que dá acesso ao Fator R/Anexo III. Se o contrato social dissesse apenas "desenvolvimento de software", perderíamos **os dois**: o registro CREF-PJ (risco jurídico de Alexandre) **e** a classificação de serviço. O objeto híbrido resolve ambos.

---

## 4. Impacto no Fluxo de Caixa

### 4.1 Custo variável real por usuário pago/mês (modelo corrigido)

| Componente | DeepSeek (atual) | GPT-4.1 (LGPD-safe) | Nota |
|---|---|---|---|
| LLM (AI Coach + protocolo) | R$ 0,10 | **R$ 1,05** (≈R$ 0,55 c/ prompt caching) | Ver §7 |
| Meios de pagamento (blend PIX/cartão) | R$ 1,20 | R$ 1,20 | **Maior custo de caixa** |
| WhatsApp — *utility* recorrente (check-ins) + BSP | R$ 0,65 | R$ 0,65 | Conversa iniciada pelo usuário = R$ 0 |
| Infra (VPS amortizado) | R$ 0,15 | R$ 0,15 | R$ 75–175/mês ÷ base |
| Ferramentas (PostHog/Sentry/Cloudflare) | R$ 0,00 | R$ 0,00 | **Tiers gratuitos** (ver §5.2) |
| **COGS de caixa/usuário/mês** | **~R$ 2,10** | **~R$ 3,05** | MVP bootstrapped |
| Supervisão CREF (sweat equity no MVP) | R$ 0,00 | R$ 0,00 | Vira custo no scale → §4.2 |

Isto **valida numericamente a faixa R$ 2,30–4,10 de Rafael** — mas apenas como **custo de caixa**, e desde que se entenda que o CREF está fora dela.

### 4.2 Custo totalmente carregado (scale, RT remunerado, LLM LGPD-safe)

| Componente | R$/usuário/mês |
|---|---|
| COGS de caixa (GPT-4.1) | 3,05 |
| Supervisão RT-CREF (metodologia codificada + revisão por exceção, modelo Zyla) | 4,00 → 1,50 (cai com automação) |
| Ferramentas em tier pago (no scale) | 0,50 |
| **Subtotal custo/usuário** | **~R$ 7,55** |
| Tributo (Anexo III 6% sobre ARPU R$ 34) | 2,04 |
| **Custo total + tributo** | **~R$ 9,59** |
| **Margem de contribuição sobre ARPU R$ 34** | **~R$ 24,40 = 72%** |

> **[DIVERGÊNCIA formal com Rafael, seção 14.2]:** a margem não é 92–93% "cheia". É **~92% de caixa no MVP** (RT como sweat equity) e **~72% totalmente carregada** no scale (RT pago + tributo + LLM LGPD-safe). Ambas são saudáveis, mas o planejamento de captação e de preço deve usar a **carregada (~72%)**, não a de caixa.

### 4.3 Meios de pagamento — decisão

- **Asaas como gateway primário** (nacional): PIX + boleto + cartão, alíquotas menores, suporta o ICP brasileiro. **Stripe apenas se/quando internacionalizar.**
- **PIX recorrente (Pix Automático, regulamentado pelo BCB em 2026)** como **prioridade Q2** — reduz o custo de meio de pagamento vs. cartão (o maior custo de caixa) **e** serve o ICP 18–30 com baixa penetração de cartão. Responde diretamente à pergunta de Lucas.
- **Trial:** 7 dias, **sem cartão** no MVP (menor fricção para ICP sensível a preço); migrar para *CC-required* **somente se** a conversão trial→pago ficar <15% (dados de Lucas: CC-required converte 31% vs. 9%, mas pode afugentar este ICP). Testar A/B.
- **Reembolso/arrependimento:** o **CDC art. 49 já obriga 7 dias de arrependimento** em compra online (confirmado por Alexandre). Transformar essa obrigação legal em **argumento de marketing** ("7 dias de garantia") — custo real baixíssimo em produto de alto engajamento.

---

## 5. Impacto no Burn Rate e Runway

### 5.1 Custos de setup (one-time, pré-go-live) — os bloqueadores de Alexandre têm preço

| Item | Faixa (R$) |
|---|---|
| Constituição LTDA + CNPJ (contador/despachante) | 800 – 2.000 |
| Registro CREF-PJ + anuidade PJ + Termo de RT | 600 – 1.500 |
| INPI — busca de anterioridade + depósito "MOVIVO" (classes 41/44/9/42) c/ advogado de PI | 2.500 – 6.000 |
| Docs jurídicos (ToS, Política de Privacidade, Termo de Responsabilidade, contrato de RT, contrato de imagem Cahuã, RIPD, DPAs) | 4.000 – 12.000 |
| **Total setup** | **~R$ 8.000 – 21.500** (mediana ~R$ 12–15 mil) |

### 5.2 Burn recorrente pré-receita (mensal) — tiers gratuitos aproveitados

| Item | R$/mês | Nota |
|---|---|---|
| Contador (CRC) | 400 – 700 | Obrigatório |
| VPS Hostinger KVM 2 | 75 | Rafael |
| AraraHQ / BSP (mensalidade base) | 100 – 300 | **Verificar plano AraraHQ** |
| LLM (dev/teste) | 50 – 150 | ~R$ 0 em baixo volume |
| **PostHog** | **0** | Free: 1M eventos/mês, 5K session replays |
| **Sentry** | **0** | Free: 5.000 erros/mês |
| **Cloudflare** | **0** | Free tier + até US$ 5K–250K em créditos p/ startups |
| DPO-as-a-service (ou sócio não-técnico = R$ 0) | 0 – 800 | Alexandre exige Encarregado |
| **Total recorrente** | **~R$ 625 – 2.025/mês** (mediana ~R$ 1.000) | |

**Achado:** as ferramentas de observabilidade/analytics/CDN (PostHog, Sentry, Cloudflare) rodam **100% em tier gratuito** no volume do MVP — **R$ 0** até dezenas de milhares de usuários. O burn recorrente é dominado por **contador + BSP**, não por tecnologia.

### 5.3 Runway e necessidade de capital

- **Break-even de caixa:** com burn recorrente ~R$ 1.000/mês e margem de contribuição de caixa ~R$ 30/usuário → **~35–40 assinantes pagos** cobrem o custo fixo. Somando um RT parcialmente remunerado, **~50–60 assinantes**. Alcançável em poucos meses com a audiência do Cahuã. **[CORREÇÃO a Rafael]:** o break-even de "~100 usuários" de Rafael considerou só a infra de R$ 75; incluindo contador/BSP o fixo é maior, mas a margem alta ainda joga o break-even para **abaixo de 60 usuários**.
- **Necessidade total de capital do MVP:** setup (R$ 12–15K) + 6 meses de runway (R$ 6–12K) + buffer (R$ 3–5K) = **R$ 20.000 – 30.000**.
- **Veredito:** **BOOTSTRAPÁVEL.** Rateado entre 5 sócios = **~R$ 4.000–6.000 cada.** **Nenhum aporte externo é necessário para o MVP.** O maior desembolso é o **setup jurídico front-loaded** (os bloqueadores de Alexandre) — é aí que o dinheiro dos sócios vai, não em tecnologia.

---

## 6. Impacto no Valuation

- **Valuation em pré-receita é irrelevante** (não vender equity agora). O que **cria** valuation futuro é executar os bloqueadores de Alexandre (LTDA + Acordo de Sócios + vesting + IP na PJ + CREF-PJ + marca + LGPD) — o que ele chamou de "due diligence limpa". Reforço 100%: a **ausência** desses itens é o que **destrói** valuation, não a presença.
- **Drivers de valuation para SaaS de assinatura:** múltiplo de ARR ancorado em **retenção (NRR/churn)**, crescimento (MoM) e eficiência (LTV/CAC, Rule of 40, magic number). Com margem ~72% carregada e churn-alvo ≤ 8%, a MOVIVO tem os fundamentos para um múltiplo saudável **se e somente se** provar retenção — o mesmo eixo de Helena.
- **Erros que destroem valuation (evitar agora, barato):** (1) equity 20/20/20/20/20 sem vesting (Alexandre); (2) IP em nome de PF; (3) receita anual reconhecida como lucro à vista (infla resultado e engana o próprio time sobre a saúde real). Todos resolvidos nas §§3–4 e no Acordo de Sócios.

---

## 7. Impacto para Investidores — e a reação ao achado de Alexandre (DeepSeek/LGPD)

**Esta seção responde ao item obrigatório 7 do escopo: se o custo de LLM subir por LGPD, o unit economics ainda fecha?**

### 7.1 Os dois cenários de LLM

| Métrica (por usuário/mês) | Cenário A: DeepSeek (Rafael) | Cenário B: GPT-4.1 (LGPD-safe, Alexandre BL2) | Cenário C: Claude Sonnet std (pior caso) |
|---|---|---|---|
| Custo LLM | R$ 0,10 | R$ 1,05 (R$ 0,55 c/ caching) | R$ 1,88 |
| % do ARPU (R$ 34) | 0,3% | 3,1% | 5,5% |
| COGS caixa total | R$ 2,10 | R$ 3,05 | R$ 3,90 |
| Margem de caixa (MVP) | 94% | 91% | 89% |
| Margem carregada (scale) | 74% | 72% | 71% |

### 7.2 Conclusão inequívoca

**O unit economics fecha nos três cenários.** Trocar o DeepSeek pelo GPT-4.1 (o que Alexandre exige por LGPD) **custa ~R$ 0,95/usuário/mês** — reduz a margem carregada de 74% para 72%. **É imaterial.** No pior caso (Claude standard), ainda 71%.

**Recomendação financeira → obedecer integralmente ao bloqueador 2 de Alexandre.** O único argumento a favor do DeepSeek-China era custo, e esse argumento **colapsa** diante dos números: LLM é um arredondamento. Enviar dado de saúde para servidor na China para "economizar R$ 0,95/usuário" é assumir um **passivo regulatório (ANPD, multas, transferência internacional sem salvaguarda)** desproporcional à economia. **Financeiramente, a escolha LGPD-correta é praticamente de graça.** Recomendo a Victor/Rafael: GPT-4.1 (ou Claude) como principal no *boundary* de saúde, com **prompt caching** (protocolo/system repetidos → até 90% off no input) para derrubar o custo a ~R$ 0,55, e pseudonimização antes do prompt (também exigida por Alexandre) — que, além de compliance, reduz tokens.

### 7.3 Para investidores (quando a hora chegar)

Modelo com margem carregada ~72%, LTV/CAC potencial de 6–22x no orgânico e ≥ 3x no pago, num mercado de fitness digital em crescimento, com moat de compliance (CREF-PJ + LGPD estruturada) — é uma tese **defensável**. O ponto de atenção que investidores vão furar: **retenção real** (ainda não medida) e **dependência do RT único / do Cahuã**. Ambos endereçáveis (credenciar RTs, ativos de marca próprios — Helena).

---

## 8. Unit Economics Formal

**Premissas:** ARPU misto R$ 34/mês; margem de contribuição carregada 72%; contribuição mensal por usuário = R$ 34 × 0,72 = **R$ 24,50**.

### 8.1 LTV (Lifetime Value)

LTV = ARPU × margem × vida média (meses), com vida = 1/churn.

| Cenário | Churn/mês | Vida | Margem | **LTV** |
|---|---|---|---|---|
| Conservador | 10% | 10 meses | 72% | **R$ 245** |
| Base | 8% | 12,5 meses | 72% | **R$ 306** |
| Otimista (retenção provada) | 5% | 20 meses | 75% | **R$ 510** |

> Nota: fica **abaixo** do "LTV ≥ R$ 400" que Lucas assumiu — porque Lucas usou margem implícita ~100% e vida 10 meses sobre ticket R$ 40. Meu número é mais conservador (margem carregada + ARPU R$ 34). O LTV ≥ R$ 400 só se materializa com churn ≤ 6% (retenção que Helena persegue). **Isto reforça: retenção é tudo.**

### 8.2 CAC por canal e LTV/CAC

| Canal | CAC estimado | LTV/CAC (base R$ 306) | Payback* |
|---|---|---|---|
| Cahuã / creator-led (Fase 0–2) | R$ 0–15 | 20–∞ | <1 mês |
| Referral (Fase 2) | R$ 15–25 | 12–20x | <1 mês |
| Micro-creators afiliados (Fase 3) | R$ 20–40 | 8–15x | ~1,6 mês |
| Tráfego pago Meta/TikTok (Fase 3) | R$ 54–100 | 3,1–5,7x | **2,0–4,1 meses** |

\* Payback = CAC ÷ contribuição mensal (R$ 24,50).

**[Alerta de tensão com a meta de Helena]:** a meta de **payback ≤ 2 meses** limita o **CAC pago a ~R$ 54**. Isso é confortável no orgânico/referral, mas **apertado para Meta/TikTok**. Recomendação: (a) manter aquisição paga **gated** até a eficiência estar provada; (b) **relaxar o alvo de payback do canal pago para ≤ 3 meses** (CAC até ~R$ 74) — ainda mantém LTV/CAC ≥ 4x e é padrão de mercado saudável. O payback ≤ 2 meses fica como meta do **blended**, não de cada canal.

**Custo oculto do trial no CAC [CORREÇÃO a Rafael]:** cada trialista consome LLM + WhatsApp (incluindo *templates* de marketing da sequência de conversão, R$ 0,31–0,38 × ~4 = **R$ 1,24–1,52**) + tempo de RT — **inclusive os ~60% que não convertem**. Isso adiciona **~R$ 8–15 de CAC efetivo** por assinante convertido. Deve entrar no cálculo de payback do pago.

### 8.3 MRR / ARR — metas 6–12 meses (cenários)

| Marco | Conservador | Base | Agressivo |
|---|---|---|---|
| Assinantes pagos — Mês 3 | 50 | 120 | 200 |
| Assinantes pagos — Mês 6 | 150 | 400 | 700 |
| Assinantes pagos — Mês 12 | 400 | 1.000 | 2.000 |
| **MRR Mês 3** (ARPU R$ 34) | R$ 1.700 | R$ 4.080 | R$ 6.800 |
| **MRR Mês 6** | R$ 5.100 | R$ 13.600 | R$ 23.800 |
| **MRR Mês 12** | R$ 13.600 | R$ 34.000 | R$ 68.000 |
| **ARR Mês 12** | **R$ 163 mil** | **R$ 408 mil** | **R$ 816 mil** |

> A meta de Lucas (MRR ≥ R$ 5.000 no mês 3) situa-se **entre base e agressivo** — factível, mas exige forte conversão da audiência do Cahuã. No cenário base, R$ 5K de MRR chega no mês ~4.

### 8.4 Rule of 40 e disciplina

Na fase de escala, monitorar **Rule of 40** (crescimento % + margem % ≥ 40). Com margem carregada de 72%, há folga generosa para investir em crescimento sem quebrar a regra — **mas apenas se o CAC pago respeitar o teto de payback.** Magic number e payback de CAC são os KPIs que autorizam (ou travam) a abertura da torneira de mídia paga.

---

## 9. Estrutura de Cap Table Inicial (ótica financeira / de captação)

Alexandre entregou o **arcabouço jurídico** (vesting cliff 12m/48m, tag/drag, IP na PJ, RT sócio + prestador, proibição de 20/20/20/20/20 com deadlock). Respeito integralmente e **não invento percentuais** — a divisão é decisão dos sócios com facilitação de advogado. Acrescento a **camada financeira/de captação:**

1. **Reservar um pool de opções (ESOP) de ~10%** desde já, para contratações-chave futuras (um COO/operações, mais RTs, um nutricionista parceiro). Criar o pool **antes** da primeira rodada evita que a diluição do pool recaia só sobre os fundadores depois.
2. **Modelar a diluição de uma rodada futura agora**, para dimensionar bem os percentuais: uma captação de **R$ 500 mil–1 mi** num *cap* pós de **R$ 4–5 mi** dilui os sócios em **~10–20%**. Os fundadores devem enxergar esse cenário antes de fechar a divisão inicial.
3. **Vesting protege valuation:** sem vesting, um sócio que saia no mês 6 leva equity "morto" — red flag fatal em DD. O cliff de 12m/vesting de 48m de Alexandre é **pré-requisito de captabilidade**, não burocracia.
4. **Separar papel do RT-CREF:** equity (Acordo de Sócios) **≠** remuneração de RT (contrato de prestação). Isso (a) evita vínculo CLT disfarçado — ponto de Alexandre; (b) permite que a remuneração de RT componha o **Fator R** (pró-labore, se sócio) — sinergia tributária; (c) mantém o equity limpo se um dia trocar de RT.
5. **Cahuã:** licença de imagem remunerada/contratual **separada** do equity (Alexandre) — para que a saída eventual dele não confunda o cap table nem o valuation.

**Governança financeira:** um sócio com poder de desempate (evitar deadlock 50/50), quóruns definidos, política de distribuição de lucros só **após** reserva de caixa mínima (runway de segurança). Distribuição de lucros no Simples é **isenta de IR na PF** — vantagem a usar com parcimônia, sem descapitalizar a empresa.

---

## 10. Riscos Financeiros

| # | Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|---|
| 1 | **Churn alto** (fitness colapsa 40–60% em 4 sem.) destrói LTV | Alta | Muito alto | Empurrar anual/trimestral; canal conversacional como retenção; medir coorte por canal |
| 2 | **Payback do pago** estoura o alvo → queima caixa | Média | Alto | Manter pago gated; teto de CAC; relaxar alvo p/ ≤3 meses no pago |
| 3 | **Fator R < 28%** → cai no Anexo V (15,5%) | Média | Alto | Gestão mensal de pró-labore pelo contador |
| 4 | Receita anual reconhecida à vista → falsa lucratividade | Média | Médio | Diferimento contábil (competência) |
| 5 | Custo de RT cresce mais rápido que a base (supervisão real, não fachada) | Média | Alto | Metodologia codificada (modelo Zyla) + revisão por exceção; credenciar RTs no ritmo da base |
| 6 | Meio de pagamento (2,5–3,4%) corrói margem no ticket baixo | Baixa | Médio | Migrar para PIX/Pix Automático (menor custo) |
| 7 | Inadimplência / chargeback recorrente | Média | Médio | PIX reduz chargeback; dunning automatizado; suspensão por não-pagamento |
| 8 | Seguro de RC não provisionado (Alexandre recomenda) | Média | Médio | Provisionar ~R$ 100–300/mês na tração |
| 9 | Câmbio USD (LLM, algumas ferramentas) | Baixa | Baixo | Exposição pequena (<5% do custo); hedge desnecessário no MVP |

---

## 11. Oportunidades de Redução de Custos

1. **Fator R → Anexo III:** a maior economia isolada (~R$ 17K/ano na largada, crescente). Prioridade tributária nº 1.
2. **Prompt caching no LLM:** derruba o custo de IA em ~50% (protocolo/system repetidos). Alinhar com Victor.
3. **Maximizar conversa iniciada pelo usuário (janela 24h = R$ 0)** e minimizar *templates* proativos pagos — regra de ouro de Clóvis/Helena, agora quantificada: cada *template* de marketing evitado economiza R$ 0,31–0,38.
4. **Tiers gratuitos** (PostHog/Sentry/Cloudflare) = R$ 0 até dezenas de milhares de usuários. Não pagar por observabilidade no MVP.
5. **PIX/Pix Automático** vs. cartão: economiza ~0,9–1,4 p.p. do ticket no maior custo de caixa.
6. **Créditos de startup:** Cloudflare (US$ 5K–250K), e verificar créditos de OpenAI/Anthropic/AWS/Google for Startups — reduzem custo de LLM/infra a ~R$ 0 por 12+ meses.
7. **Programas de fomento (sem diluição):** o time é 3 devs + IA + saúde — perfil elegível a **FINEP, EMBRAPII, Sebrae, editais de inovação**. Recomendo mapear na Fase 2 (não urgente, mas capital não-diluitivo é ouro para bootstrapped).

---

## 12. Estratégias de Crescimento (ótica financeira)

- **Empurrar anual/trimestral** não é só retenção (Helena) — é **caixa antecipado** que financia o próprio crescimento sem dívida nem diluição. Um assinante anual paga R$ 349 à vista: financia ~10 meses de burn recorrente por si só.
- **Referral** é o canal de menor CAC e maior LTV — priorizar a automação dele quando houver base retida (Fase 2), com incentivo (mês grátis) que custa margem, não caixa.
- **Sequenciar mídia paga por eficiência**, não por volume: só escala quando LTV/CAC ≥ 3 e payback ≤ 3 meses no pago estiverem provados por coorte.
- **Expansão de receita futura (sem quebrar CREF):** tier "MOVIVO+" (R$ 59–79) com check-in humano mensal do RT / revisão de técnica por vídeo — **agrega valor dentro do escopo CREF** e eleva ARPU sem canibalizar. Nutrição só com nutricionista parceiro (Alexandre veta fora de escopo).

---

## 13. Indicadores (KPIs) Financeiros Relevantes

| KPI | Alvo | Frequência |
|---|---|---|
| **Margem de contribuição/assinante** (carregada) | ≥ 65% | Mensal |
| MRR / ARR e crescimento MoM | Base: R$ 34K MRR no M12 | Mensal |
| Churn mensal / NRR | ≤ 8% / ≥ 100% | Mensal (coorte) |
| LTV / CAC (blended e por canal) | ≥ 3 (blended); pago ≥ 4 | Mensal |
| Payback de CAC | ≤ 2 meses blended; ≤ 3 pago | Mensal |
| CAC efetivo (incl. custo de trial) | Por canal | Mensal |
| Burn rate e runway | Runway ≥ 6 meses sempre | Mensal |
| Fator R (folha+pró-labore ÷ RBT12) | **≥ 28%** | **Mensal (crítico)** |
| Custo de IA como % do ARPU | ≤ 5% | Mensal |
| Rule of 40 (na escala) | ≥ 40 | Trimestral |

---

## 14. Cenários (Conservador, Base, Agressivo) — síntese financeira 12 meses

| Dimensão | Conservador | Base | Agressivo |
|---|---|---|---|
| Assinantes M12 | 400 | 1.000 | 2.000 |
| ARR M12 | R$ 163 mil | R$ 408 mil | R$ 816 mil |
| Churn | 10% | 8% | 5–6% |
| LTV | R$ 245 | R$ 306 | R$ 510 |
| Mix de canal | ~só orgânico | orgânico + referral + pago leve | pago escalado |
| Necessidade de capital | Bootstrapped | Bootstrapped (+ créditos startup) | Considerar rodada R$ 500K–1,5mi para acelerar |
| Regime | Anexo III faixa 1–2 | Anexo III faixa 2–3 | Anexo III faixa 3–4 (Fator R sob gestão) |

Em **todos** os cenários o MVP é bootstrapável; a captação só entra como **acelerador opcional** no agressivo.

---

## 15. Recomendações (consolidado)

1. **Pricing:** plano único por período — Mensal R$ 39 / Trimestral R$ 99 / **Anual R$ 349**. Sem feature-tier no MVP. Trial 7 dias sem cartão. Garantia de 7 dias (CDC 49) como marketing.
2. **Tributário:** Simples **Anexo III via Fator R ≥ 28%** — gerir pró-labore mensalmente; objeto social EF-compatível (alinhado a Alexandre).
3. **Obedecer ao bloqueador 2 de Alexandre:** trocar DeepSeek-China por GPT-4.1/Claude no *boundary* de saúde — custo imaterial (~R$ 0,95/usuário), risco regulatório eliminado. Usar prompt caching + pseudonimização.
4. **Capital:** bootstrapping. Pool dos sócios de **R$ 20–30 mil** (setup + 6 meses runway). Sem aporte externo.
5. **Cap table:** reservar ESOP ~10%; vesting como pré-requisito de captabilidade; RT e Cahuã com remuneração separada do equity.
6. **Contabilidade:** contador CRC desde o dia 1; reconhecimento de receita por competência; centros de custo de FinOps.
7. **Meios de pagamento:** Asaas primário; PIX/Pix Automático como prioridade Q2.
8. **Captação futura:** preparar (não executar) mútuo conversível para pós-Fase 2/3; mapear fomento não-diluitivo (FINEP/Sebrae) e créditos de startup.
9. **Aos agentes de produto/eng:** custo de IA ≤ 5% do ARPU como *guardrail* de FinOps (Rafael/Victor/Henrique); rate limit por usuário; alertas de gasto.

---

## 16. Plano de Ação

**Onda 0 (pré-go-live, junto aos bloqueadores de Alexandre):**
- Constituir LTDA com objeto híbrido; abrir CNPJ; optar por Simples (o contador projeta Fator R desde o mês 1).
- Definir pró-labore dos sócios-trabalho para mirar Fator R ≥ 28%.
- Pool de capital dos sócios (R$ 20–30K); abrir conta PJ; contratar contador CRC.
- Configurar Asaas; validar plano/mensalidade do AraraHQ (custo real de WhatsApp).
- Ativar tiers gratuitos (PostHog/Sentry/Cloudflare) e solicitar créditos de startup.

**Onda 1 (concierge → beta pago, Fases 1–2 de Helena):**
- Instrumentar dashboard de unit economics (margem/assinante, CAC por canal, churn coorte, Fator R).
- Publicar pricing; ativar trial 7 dias; medir trial→pago e retenção mês-1.
- Diferir contabilmente receitas anuais; primeira apuração de DAS.
- Provisionar seguro de RC (Alexandre).

**Onda 2 (escala, Fase 3):**
- Abrir mídia paga apenas com LTV/CAC ≥ 3 e payback ≤ 3 meses provados.
- Priorizar Pix Automático; automatizar referral e dunning.
- Preparar data room / mútuo conversível se decidir acelerar; reavaliar regime ao aproximar de R$ 3,6–4,8 mi.

---

## 17. Próximos Passos

1. **Sócios:** aportar capital de giro (~R$ 4–6K cada); decidir divisão de equity com advogado (arcabouço de Alexandre) e este relatório como insumo financeiro.
2. **Contador CRC:** confirmar CNAE/objeto, opção pelo Simples e projeção de Fator R — validação obrigatória antes do go-live.
3. **Rafael/Victor (retroativo):** absorver a correção de LLM (GPT-4.1/Claude LGPD-safe, custo imaterial) e o *guardrail* de custo de IA ≤ 5% do ARPU.
4. **Lucas (retroativo):** pricing e diferenciação **respondidos** (plano único por período; sem CC no trial; PIX recorrente; garantia 7 dias) — ajustar Épico 5 (conversão) e o schema de planos de Rafael (`BASICO`/`PRO` → períodos).
5. **Henrique (adiante):** verificar residência de dados da VPS (impacta LGPD e não custo) e manter FinOps de infra ≤ targets.

---

## Fontes Consultadas

**Tributação (Simples Nacional / Fator R / CNAE):**
- Contabilizei — Anexo III Simples Nacional 2026: https://www.contabilizei.com.br/contabilidade-online/anexo-3-simples-nacional/
- e-Auditoria — Anexo III ou V: Fator R decide: https://www.e-auditoria.com.br/blog/anexo-iii-ou-anexo-v-simples-nacional/
- Contabilidade.com — Fator R 2026, migração Anexo V→III: https://contabilidade.com/blog/fator-r-no-simples-nacional-2026-como-calcular-exemplos-praticos-e-quando-servicos-migram-do-anexo-v-para-o-iii/
- Contmatic/Simplifique — Fator R 2026: https://simplifique.contmatic.com.br/blogs/fator-r-simples-nacional-o-que-e-como-calcular
- Contabeis — CNAE 9313-1/00 no Simples Nacional: https://www.contabeis.com.br/ferramentas/simples-nacional/9313100/
- Contabilidade.com — CNAE 9313-1/00, Fator R e abertura: https://contabilidade.com/blog/cnae-9313100-atividades-de-condicionamento-fisico-simples-nacional-fator-r-e-abertura-de-empresa/
- blog.esimplesauditoria — Anexo V 2026: https://blog.esimplesauditoria.com.br/anexo-5-do-simples-nacional/

**WhatsApp Business API (pricing 2026 Brasil):**
- Message Central — WhatsApp Business API Pricing Brazil 2026: https://www.messagecentral.com/blog/whatsapp-business-api-pricing-brazil
- Blueticks — WhatsApp Business API Pricing 2026 (categorias): https://blueticks.co/blog/whatsapp-business-api-pricing-2026
- EngageLab — WhatsApp Business API Pricing 2026: https://www.engagelab.com/blog/whatsapp-business-api-pricing

**Precificação de LLM (cenário LGPD-safe):**
- PE Collective — OpenAI API Pricing 2026 (GPT-4.1 $2/$8): https://pecollective.com/tools/openai-api-pricing/
- PricePerToken — GPT-4.1 API Pricing 2026: https://pricepertoken.com/pricing-page/model/openai-gpt-4.1
- Anthropic — Claude Sonnet 5 (intro $2/$10; std $3/$15): https://www.anthropic.com/news/claude-sonnet-5
- Claude Platform Docs — Pricing: https://platform.claude.com/docs/en/about-claude/pricing

**Tiers gratuitos de ferramentas:**
- PostHog Pricing 2026 (free tier): https://userorbit.com/blog/posthog-pricing-guide
- Sentry — free plan (5.000 erros/mês): https://costbench.com/software/developer-tools/sentry/free-plan/
- Cloudflare — free tier + créditos de startup: https://agentdeals.dev/vendor/cloudflare

**Fontes internas do pipeline (base do modelo):** `01-relatorio-clovis.md`, `05-relatorio-helena.md`, `08-relatorio-lucas.md`, `10-relatorio-rafael.md`, `06-relatorio-alexandre.md`.

> **Limitações de pesquisa declaradas:** (1) A busca de mercado (WebSearch) é US-only e retorna agregadores; alíquotas e faixas do Simples devem ser confirmadas na **Resolução CGSN vigente** e pelo **contador CRC** antes de qualquer decisão. (2) O custo real de WhatsApp depende do **plano do BSP AraraHQ** (mensalidade + markup sobre a tarifa Meta), não verificado diretamente — validar contratualmente. (3) LTV/CAC e conversão são **hipóteses a calibrar** no concierge/beta (mesma limitação de Clóvis/Helena/Lucas); não há benchmark público de "coaching de treino via WhatsApp com CREF no Brasil". (4) O câmbio USD/BRL (R$ 5,45) é premissa; oscilações afetam <5% do custo. (5) Nada aqui substitui contador registrado no CRC nem consultoria tributária formal — obrigatórios para constituição, enquadramento e planejamento de alto impacto.
