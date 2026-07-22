# Relatório — Helena (Director Marketing Strategist)

**Pasta do projeto:** `docs/fitness-ia-whatsapp/`
**Slug da ideia:** `fitness-ia-whatsapp`
**Data:** 2026-07-20
**Ideia analisada:** MOVIVO — serviço de orientação de treino personalizado, científico e adaptativo por conversa no WhatsApp, com IA como camada de escala/personalização e um profissional de Educação Física registrado (CREF) como responsável técnico pela prescrição.
**Status do pipeline:** Validado com ressalvas por Clóvis → Estratégia de marca por Gabriel → Naming por Caio (MOVIVO / TRENOVA como hedge) → Identidade visual por Kimura ("O Pulso") → **Estratégia de marketing/GTM definida por Helena (última etapa do pipeline).**

---

## Resumo executivo

Proponho um go-to-market em **quatro fases sequenciais e "gated"** (cada uma só libera investimento na seguinte depois de bater uma meta pré-definida), exatamente na cadência que Clóvis exigiu: **concierge MVP e teste de disposição a pagar antes de escalar**. A lógica é subordinar todo o crescimento à variável que decide a vida ou morte deste negócio — **retenção** — porque os unit economics são apertados (custo de LLM + WhatsApp Business API + hora de profissional CREF contra ticket de R$ 29–59/mês) e porque o fitness digital tem o pior churn de qualquer categoria de assinatura (efeito "janeiro": 40–60% de cancelamento em 4 semanas em apps tradicionais).

A boa notícia, comprovada na pesquisa: **o canal é o maior ativo estratégico da marca.** Comércio conversacional no WhatsApp na América Latina converte 45–60% (até 12× mais que canais tradicionais), 66% de quem inicia uma conversa com uma empresa no WhatsApp segue para a compra, e o Brasil tem 93–99% de penetração. Somado à distribuição orgânica do Cahuã (audiência de nicho fisiculturismo natural, com confiança pré-existente), a MOVIVO pode atingir CAC próximo de zero na largada — o que compensa a margem apertada **se, e somente se, a retenção sustentar o LTV**.

O motor de aquisição principal é **creator-led + comunidade** (Cahuã como voz/endossante, nunca como a marca — respeitando o risco marca-pessoa que Gabriel apontou), com tráfego pago entrando **só depois** que o funil orgânico provar retenção e CAC. O funil real do produto (anamnese na landing → primeira conversa no WhatsApp → feedback contínuo) é redesenhado aqui como um funil de marketing com pontos de medição claros em cada transição. Fecho com KPIs realistas (LTV/CAC ≥ 3, meta de retenção mês-1 ≥ 55–60%, payback de CAC ≤ 2 meses) e uma síntese final de todo o pipeline.

---

## Contexto recebido (o que herdo e respeito de toda a cadeia)

**De Clóvis (gatekeeper — VALIDADO COM RESSALVAS):**
- **Cadência obrigatória:** smoke test de disposição a pagar + concierge MVP (20–50 usuários atendidos manualmente por 4–8 semanas) **antes** de automatizar/escalar. Só investir pesado em aquisição depois que retenção e unit economics fecharem. Minha estratégia parte disso como espinha dorsal.
- **Unit economics apertados:** ticket R$ 29–59/mês precisa cobrir LLM + WhatsApp API + fração de hora do profissional CREF. Regra de ouro do canal: **maximizar conversas iniciadas pelo usuário** (gratuitas na janela de 24h), **minimizar templates proativos pagos**. Isso é uma restrição de marketing, não só de produto — molda o desenho do funil e da automação de retenção.
- **Retenção é o vilão a vencer** (churn histórico do fitness). Meta de LTV/CAC ≥ 3.
- **CAC baixo no início via audiência do Cahuã** é o maior ativo de GTM; dependência de 1 único profissional CREF é gargalo de escala (limita a velocidade com que posso "abrir a torneira" de aquisição).
- **Guardrails jurídicos que a comunicação obedece:** nunca "IA que prescreve/diagnostica/trata/cura", nunca "resultado garantido", sempre o profissional CREF visível como responsável técnico.

**De Gabriel (Brand Strategist):** essência **"Ciência que treina com você"**; categoria reivindicada **"orientação de treino conversacional"**; 4 pilares (Proximidade radical / Adaptação viva / Respaldo profissional / Acesso justo); arquétipo Mentor-acessível + Companheiro; 3 personas (O Recomeço, O Otimizador, O Sem-Tempo); **arquitetura Branded House com o Cahuã como endossante/voz da comunidade — não a marca** (proteção contra o risco marca-pessoa); selo CREF como assinatura de credibilidade; anti-hype como território. Falar primeiro com Personas 2 e 1 (mais próximas da audiência-motor).

**De Caio (Naming):** MOVIVO (primário), TRENOVA (hedge jurídico pendente de INPI). Domínio `movivo.com.br` livre + `usemovivo.com`/`movivoapp.com` para captação. Assinatura verbal "movivo — seu treino, vivo no seu WhatsApp". Contingência: se INPI reprovar, migro toda a comunicação para Trenova (impacto mínimo, ver seção de cronograma).

**De Kimura (Brand Designer) — munição de marketing já embutida:**
- **Sticker pack** da marca (Pulso + expressões de incentivo) = vetor de boca-a-boca orgânico e gratuito, prioridade no plano de conteúdo.
- **Pulso animado** (Lottie/MP4) para abertura de reels/vídeos do Cahuã e splash.
- **Avatar WhatsApp = conversão, não estética:** brandmark Petróleo+Pulso no número oficial, A/B testável.
- **Regra de cor em ads:** Verde Pulso para CTA/destaque; Coral só para calor/comunidade; o par Petróleo+Verde diferencia o criativo no feed saturado (todo concorrente é vermelho/preto).
- **Selo CREF como argumento central de aquisição** (o quadrante vazio "com respaldo profissional").
- **Direção de fotografia = direção de casting de criativos:** pessoas reais, contextos reais (casa/academia de bairro), diversidade.
- **Trava operacional:** arte-final/registro só após liberação do nome no INPI — o cronograma de marketing já é planejado com essa contingência.

Nenhuma decisão minha contradiz os agentes anteriores. Onde aprofundo, sinalizo.

---

## Análise e desenvolvimento

### 1. Diagnóstico de marketing — o que os dados reais dizem sobre este mercado

Três verdades de mercado, extraídas da pesquisa, definem toda a estratégia:

**a) O canal é um multiplicador, não um detalhe.**
Comércio conversacional no WhatsApp na LATAM converte **45–60%** (até 12× canais tradicionais); **66%** de quem inicia conversa com uma empresa no WhatsApp conclui a compra; personalização baseada em histórico converte **3,5×** mais que mensagem genérica; o Brasil tem a maior receita vitalícia por negócio no WhatsApp do mundo (US$ 46.800) e 61 min/dia de uso médio. Tradução estratégica: **a decisão de viver no WhatsApp já é, por si, uma vantagem de conversão estrutural.** O trabalho de marketing é levar a pessoa até a primeira conversa — dali para frente, o canal converte melhor que qualquer landing page. Isso inverte a lógica clássica de funil: **a "venda" acontece dentro da conversa, não na landing.**

**b) A retenção é o campo de batalha, e o fitness perde por padrão.**
Churn médio de assinatura fitness ~7–9%/mês (top-quartil ~2%); apps de fitness têm a curva de churn mais íngreme de todas as categorias de consumo — efeito "resolutioner"/janeiro com 40–60% de cancelamento em ~4 semanas; retenção D30 de apps de saúde/fitness historicamente baixíssima (~3% em apps gratuitos). **Assinaturas anuais retêm estruturalmente melhor** (33% de retenção anual vs. o colapso do mensal); a estabilização real de churn vem por volta do 24º mês. Tradução: **a MOVIVO não pode tratar retenção como fase posterior — ela é o produto de marketing.** Duas alavancas decorrem disso: (1) empurrar planos trimestral/anual desde cedo (compromisso = retenção), e (2) usar o próprio canal conversacional (que os apps tradicionais não têm) como máquina de re-engajamento — a vantagem competitiva de reter.

**c) Preço baixo converte trial melhor, e o modelo de paywall define o negócio.**
Trial-to-paid mediano em saúde/fitness = **39,9%** (top 10%: 68,3%); **preço baixo converte muito melhor** (47,8% a preços baixos vs. 28,4% a preços altos) — favorável ao nosso ticket popular; **hard paywall** converte mais no curto prazo (12,1% vs. 2,2% do freemium puro), mas **freemium gera 15–25% mais receita em 12 meses** porque captura quem converte depois; usuários convertem **no Dia 0 ou entre os Dias 4–7**, quase nada no meio — o paywall/oferta deve ser desenhado para essas janelas. LTV de payer em saúde/fitness lidera todas as categorias (mediana ~US$ 16, quartil superior ~US$ 31). Tradução: dado o ticket popular e o custo marginal real (LLM+WhatsApp+CREF), **não podemos rodar freemium ilimitado** (a margem some com usuário que nunca paga consumindo LLM e hora humana). O modelo certo é **trial com fricção baixa + experiência de alto valor concentrada nos Dias 0–7** para capturar a decisão de compra na janela que os dados mostram.

### 2. Estratégia de posicionamento de comunicação (traduzindo a marca em mensagem de mercado)

Não redefino posicionamento (é de Gabriel) — **operacionalizo** a essência "Ciência que treina com você" em mensagens de mercado por audiência e por etapa de funil. A mensagem-mãe herdada é:

> **"Treino de verdade, no seu WhatsApp. Feito com ciência, adaptado a você, com gente que responde por isso."**

**Hierarquia de mensagens-chave (o que dizer, em ordem de prioridade):**

| # | Mensagem | Pilar Gabriel | Função no funil | Prova (RTB) |
|---|---|---|---|---|
| 1 | "Seu treino chega no WhatsApp — sem baixar app, sem planilha que você abandona." | Proximidade radical | Topo (hook) | O produto É a conversa |
| 2 | "Não é robô te mandando treinar. É método aprovado por profissional de Ed. Física registrado." | Respaldo profissional | Meio (confiança) | Selo CREF visível |
| 3 | "Ele se adapta a você: marcou 'difícil'? Semana que vem ajusta." | Adaptação viva | Meio (diferenciação) | Demonstração real no trial |
| 4 | "Orientação de verdade por uma fração do preço de um personal." | Acesso justo | Fundo (conversão) | Preço R$ 29–59 vs. R$ 150+ |
| 5 | "Consistência acima de perfeição — a gente comemora quem voltou." | Valor de marca | Retenção (pertencimento) | Comunidade + tom |

**Guardrails de copy (não-negociáveis, herdados de toda a cadeia):** nunca "IA que prescreve", "emagreça X kg", "resultado garantido", "destrave seu shape em 7 dias", linguagem de diagnóstico/tratamento. Energia vem do Verde Pulso e do tom "manda áudio pro amigo", **não** de gritaria de supplement. Toda peça de aquisição carrega o selo CREF como âncora de confiança.

### 3. Estratégia de canais de aquisição

Princípio-guia: **começar 100% orgânico/creator-led (CAC quase zero, sob o gargalo do CREF), provar retenção, e só então adicionar pago.** Nunca depender 100% do Cahuã (risco marca-pessoa de Gabriel) — por isso, desde cedo, construir ativos de marca próprios (perfis da MOVIVO, comunidade com nome próprio, conteúdo de método assinado pela marca) que sobrevivam sem ele.

**Camada 1 — Creator-led / Audiência do Cahuã (motor primário, Fases 0–2).**
- Cahuã como **voz e endossante** ("uso, confio, ajudei a construir o método"), com CTA para a lista de espera e depois para o trial. A pesquisa confirma que criadores envolvidos no produto desde cedo (65% preferem isso) geram conteúdo mais crível — o Cahuã é sócio, o que maximiza autenticidade.
- Formatos: reels de bastidor do método, "treino do dia" com o Pulso animado na abertura, depoimentos reais de alunos do concierge, lives de dúvidas.
- **Mitigação do risco marca-pessoa:** o conteúdo sempre credita **a MOVIVO e o profissional CREF** como fonte do método; o Cahuã é o "amigo que apresenta", não o dono da autoridade técnica. Meta explícita: até o fim da Fase 2, ≥ 40% da aquisição vir de canais que **não** são o feed pessoal do Cahuã (perfis da marca, indicação, busca).

**Camada 2 — Comunidade e boca-a-boca (motor de retenção + aquisição barata, todas as fases).**
- **Sticker pack da MOVIVO** (Kimura) distribuído desde o dia 1 — cada sticker usado numa conversa de terceiros é mídia orgânica gratuita e pertencimento.
- **Programa de indicação** ("traga um parceiro de treino"): desconto/mês grátis para quem indica e para o indicado. Referral é o canal de menor CAC e maior retenção (indicado chega com confiança pré-formada). Ativar a partir da Fase 2, quando há base retida para indicar.
- **Grupo/comunidade de alunos** (nome próprio futuro, reservado por Gabriel): desafios mensais, ranking de consistência (não de performance — coerente com "consistência acima de perfeição"), celebração de quem voltou. Comunidade é vantagem de fidelização comprovada na Gen Z.

**Camada 3 — Micro-influenciadores de nicho (expansão de alcance sem depender do Cahuã, Fase 3).**
- Nano/micro-creators de fitness convertem melhor por engajamento (nano ~10,3% vs. mega ~7,1%) e custam frações do valor. Recrutar 5–15 micro-creators de nichos adjacentes (treino em casa, mulheres iniciantes, corrida, fisiculturismo natural regional) como afiliados com link/cupom rastreável — **diversifica a dependência do Cahuã** e testa novos ICPs.

**Camada 4 — Tráfego pago (escala, só na Fase 3, após retenção provada).**
- Meta/Instagram + TikTok, com criativos no par Petróleo+Verde (diferenciação no feed saturado de vermelho/preto), casting de pessoas reais, selo CREF em destaque.
- **Regra de disciplina financeira:** só escalar pago quando `LTV/CAC ≥ 3` estiver comprovado organicamente e o payback de CAC ≤ 2 meses. Começar com budget de teste pequeno, otimizar por **custo por trial iniciado** e depois por **CPA de assinante retido no mês 1** (não por lead — lead é vaidade aqui).
- Remarketing conversacional: quem começou a anamnese e não terminou recebe reengajamento (respeitando a regra de minimizar templates pagos — priorizar reengajar quem ainda está na janela de 24h gratuita).

**Camada 5 — Orgânico próprio / SEO e conteúdo (composto de longo prazo, a partir da Fase 2).**
- Perfis próprios da MOVIVO (Instagram, TikTok) com conteúdo de método assinado pela marca+CREF — constrói autoridade independente do Cahuã.
- SEO de cauda longa ("treino em casa com halteres", "como progredir carga", "personal online barato") — tráfego barato e perene que alimenta a landing. Diferencial de conteúdo: **ciência traduzida** (o anti-hype de Gabriel) vs. o mar de conteúdo raso de fitness.

**Canais deliberadamente evitados na largada:** anúncios de massa (TV, out-of-home), parcerias B2B com academias (dispersa foco do bootstrap), e qualquer canal que exija templates proativos pagos em volume no WhatsApp (custo mata a margem).

### 4. Funil de aquisição → conversão → retenção (adaptado ao fluxo real do produto)

O produto tem um fluxo real específico (anamnese na landing → primeira conversa no WhatsApp → feedback contínuo). Traduzo isso num funil com **pontos de medição em cada transição** e metas de referência ancoradas nos benchmarks:

```
[1] ALCANCE            Conteúdo do Cahuã / micro-creators / ads / SEO
       │  (CTR / clique para landing)
       ▼
[2] LANDING + ANAMNESE Landing (usemovivo.com) com formulário de anamnese
       │  (taxa de conclusão da anamnese — meta ≥ 35–45%)
       ▼
[3] 1ª CONVERSA WhatsApp Onboarding no número oficial; entrega do 1º treino
       │  (ativação: recebeu e "usou" o 1º treino — meta ≥ 60%)
       ▼
[4] TRIAL / EXPERIÊNCIA  Dias 0–7: valor concentrado (adaptação demonstrada)
       │  (trial→pago — meta ≥ 40%, benchmark mediano 39,9%)
       ▼
[5] ASSINATURA           Cobrança recorrente (mensal/trimestral/anual)
       │  (retenção mês-1 — meta ≥ 55–60%; mês-3 ≥ 40%)
       ▼
[6] RETENÇÃO + INDICAÇÃO  Feedback contínuo + comunidade + referral
          (churn mensal alvo ≤ 8% estabilizando; NPS ≥ 40)
```

**Detalhamento por etapa:**

- **[2] Landing + anamnese:** a anamnese não é burocracia — é o primeiro momento de valor percebido ("eles querem me conhecer de verdade") e a base da personalização. Mantê-la curta (PAR-Q de triagem de risco obrigatório, herdado de Clóvis, mas sem fadiga de formulário). Selo CREF e "seu treino é aprovado por profissional registrado" visíveis aqui reduzem a ansiedade de dados sensíveis (LGPD) e aumentam conclusão. **Micro-conversão-chave a otimizar (CRO):** taxa de conclusão da anamnese.

- **[3] Primeira conversa (o momento mágico):** dado que 66% de quem inicia conversa no WhatsApp converte, **levar a pessoa a mandar a primeira mensagem é o objetivo nº 1 do topo de funil.** A ativação real = receber o primeiro treino e responder o primeiro feedback (o loop começou). Aqui a regra de Clóvis manda: a conversa é iniciada pelo usuário (janela de 24h gratuita), a MOVIVO responde dentro dela — economia de custo E melhor experiência.

- **[4] Trial Dias 0–7 (a janela de decisão):** os dados mostram que a conversão acontece no Dia 0 ou nos Dias 4–7. Então a experiência do trial deve ser desenhada para **demonstrar a "adaptação viva" dentro dessa janela** — ex.: já no 3º–4º treino, o sistema visivelmente ajusta com base no feedback ("essa semana está mais leve porque você marcou 'difícil'"). Esse é o "aha moment" que justifica pagar. Trial curto (7–14 dias, não 30) alinha com a janela de decisão e protege a margem (menos LLM/CREF gasto em quem não vai converter).

- **[5]→[6] Retenção como sistema de marketing:** o canal conversacional é a arma que os apps tradicionais não têm. Loops de retenção: check-in proativo mínimo (respeitando custo de template), celebração de streaks de consistência, ajuste visível de treino (o produto "lembra de você"), reengajamento de inativos ("faz 5 dias, bora?"). **Empurrar planos trimestral/anual** no momento de maior satisfação (após primeira evolução percebida) — compromisso reduz churn estruturalmente.

### 5. Estratégia de conteúdo

**Pilares de conteúdo (coerentes com anti-hype/ciência traduzida de Gabriel):**

1. **"Ciência traduzida"** (autoridade): mitos de treino desmascarados, "por que progredir carga assim", explicações do CREF em linguagem simples. Diferencia do mar de conteúdo raso.
2. **"Treino real, vida real"** (identificação): treino em casa/academia de bairro, adaptação ao dia difícil, sem estética "shape impossível" — casting da direção de Kimura.
3. **"Prova viva"** (confiança): jornadas reais de alunos do concierge/base, com foco em consistência e sensação, não em "antes e depois" milagroso.
4. **"Bastidor do método"** (Cahuã + CREF): como o método é construído, o rigor por trás — humaniza a marca e credita a autoridade à MOVIVO+CREF (mitiga marca-pessoa).
5. **"Comunidade/pertencimento"** (retenção): desafios, celebração de quem voltou, stickers, cultura do "consistência > perfeição".

**Distribuição por plataforma:** Instagram Reels + Stories (feed do Cahuã e da marca), TikTok (alcance/nano-creators), WhatsApp (comunidade + status/broadcast opt-in), YouTube Shorts (SEO/perenidade), blog/SEO (cauda longa). **Sticker pack e Pulso animado** como ativos recorrentes.

**Cadência mínima sustentável para bootstrap:** 3–5 peças/semana de Reels/TikTok, stories diários (baixo custo), 1 conteúdo "âncora" semanal (ciência traduzida), comunidade ativa diária. Não prometer volume que a equipe enxuta não sustenta — consistência > quantidade (o mesmo valor da marca).

### 6. Calendário / fases de lançamento (gated pela validação de Clóvis)

**Trava-mestra:** a arte-final e o registro definitivos dependem da liberação do nome no INPI (Movivo vs. Trenova). As Fases 0–1 podem rodar com identidade "em beta"/número de teste sem risco; o registro pesado de marca acompanha a Fase 2. Se o INPI reprovar "vivo", migração para Trenova custa ~1 dia de wordmark (Kimura) — a comunicação já é planejada name-agnóstica onde possível.

| Fase | Período | Objetivo | Táticas de marketing | Gate para avançar |
|---|---|---|---|---|
| **Fase 0 — Smoke test + Waitlist** | Semanas 1–3 | Provar disposição a pagar (H3 de Clóvis) | Landing com anamnese + oferta real de pré-venda/lista de espera divulgada só na audiência do Cahuã; captura de intenção paga/pré-paga | ≥ 3–5% visitante→intenção de pagamento (critério de Clóvis) |
| **Fase 1 — Concierge MVP** | Semanas 3–11 | Aprender comportamento e provar retenção com 20–50 usuários atendidos manualmente | Onboarding manual no WhatsApp (Cahuã + CREF), conteúdo de bastidor, coleta de depoimentos e NPS, teste de mensagens | Retenção sem-4 ≥ 40%; NPS positivo; margem de contribuição positiva no ticket-alvo (H4/H5 de Clóvis) |
| **Fase 2 — Beta pago semi-automatizado** | Meses 3–6 | Validar funil ponta-a-ponta com automação parcial (protocolos pré-aprovados) e cobrança recorrente | Ativar referral, comunidade com nome próprio, perfis da marca, sticker pack, SEO inicial; abrir waitlist para além do círculo do Cahuã | LTV/CAC ≥ 3 comprovado organicamente; retenção mês-1 ≥ 55%; ≥ 40% da aquisição fora do feed pessoal do Cahuã |
| **Fase 3 — Escala** | Mês 6+ | Crescer aquisição com pago + micro-creators, mantendo margem | Tráfego pago (Meta/TikTok), programa de afiliados de micro-creators, expansão de conteúdo, teste de novos ICPs | Payback de CAC ≤ 2 meses; churn estabilizando ≤ 8%/mês; capacidade CREF credenciada para suportar volume |

**Restrição de ritmo herdada de Clóvis:** a velocidade de "abrir a torneira" de aquisição é limitada pela **capacidade do(s) profissional(is) CREF** (gargalo de escala e ponto único de falha legal). Não faz sentido escalar aquisição além da capacidade de o responsável técnico honrar a prescrição — isso quebraria a promessa de marca E o compliance. O plano de aquisição deve andar em par com o **credenciamento de mais profissionais CREF** (custo estrutural que entra no unit economics, como Clóvis alertou).

### 7. KPIs e métricas de acompanhamento

**North Star Metric proposta:** **treinos concluídos com feedback por aluno ativo por semana** — mede simultaneamente engajamento, valor entregue e o loop de retenção (o oposto de métrica de vaidade). Se esse número sobe, retenção e LTV sobem atrás.

**KPIs por camada (framework Pirate Metrics / AARRR adaptado ao WhatsApp):**

| Etapa | KPI | Meta de referência (bootstrap) | Base do benchmark |
|---|---|---|---|
| Aquisição | CTR conteúdo→landing | Orgânico creator: alto (audiência quente) | Nano-creator engaj. ~10% |
| Aquisição | CAC blended | Fase 0–2: ~R$ 0–20 (orgânico); Fase 3: manter payback ≤ 2 meses | LTV/CAC ≥ 3 |
| Ativação | Conclusão da anamnese | ≥ 35–45% | CRO landing |
| Ativação | 1ª conversa iniciada + 1º treino usado | ≥ 60% dos que concluíram anamnese | 66% WhatsApp conv.→ação |
| Receita | Trial→pago | ≥ 40% (top 10% chega a 68%) | Mediana fitness 39,9% |
| Receita | Ticket médio / mix de planos | Puxar anual/trimestral; ticket R$ 29–59 | Preço baixo converte +47,8% |
| Retenção | Retenção mês-1 / mês-3 | ≥ 55–60% / ≥ 40% | Fitness colapsa 40–60% em 4 sem — meta é bater o benchmark |
| Retenção | Churn mensal | ≤ 8% estabilizando (top-quartil ~2%) | Fitness médio 7–9% |
| Retenção | LTV (payer) | Crescente; LTV/CAC ≥ 3 sustentado | Fitness lidera LTV entre categorias |
| Indicação | % receita via referral | ≥ 15–20% na Fase 3 | Referral = menor CAC |
| Marca | NPS | ≥ 40 | Proxy de retenção |
| Marca | Share of voice no nicho / crescimento de perfis próprios | Crescente e independente do Cahuã | Mitiga marca-pessoa |

**Alerta de unit economics (herdado de Clóvis, operacionalizado):** monitorar **margem de contribuição por assinante** = ticket − (custo LLM/mês + custo WhatsApp templates/mês + custo hora CREF/aluno/mês). Se negativa, **não escalar** — otimizar antes: reduzir verbosidade do LLM, maximizar conversas iniciadas pelo usuário (24h grátis), automatizar via protocolos pré-aprovados, aumentar densidade de alunos por hora-CREF. ROI/ROAS de mídia paga só medido a partir da Fase 3, sempre contra **assinante retido no mês 1** (não contra lead ou trial).

### 8. Plano de otimização contínua (o marketing nunca termina)

- **Ciclo de testes A/B priorizados:** (1) avatar do WhatsApp (Kimura sinalizou impacto na taxa de início de conversa); (2) copy da landing e da mensagem de boas-vindas; (3) duração/estrutura do trial (7 vs. 14 dias); (4) momento e oferta do upsell trimestral/anual; (5) criativos de ads no par cromático da marca.
- **Análise de coorte de retenção** mensal por canal de origem (quem vem do Cahuã retém diferente de quem vem de ads?) e por persona — realoca budget para a fonte de maior LTV, não de maior volume.
- **Loop de voz do cliente:** o próprio WhatsApp é um canal de pesquisa qualitativa contínua — minerar objeções e motivos de churn direto das conversas alimenta produto, copy e retenção.
- **Revisão de posicionamento de comunicação** a cada trimestre — sem contradizer Gabriel, ajustar quais mensagens/pilares performam melhor por audiência.

---

## Decisões e entregáveis (resumo do que Helena define)

1. **GTM em 4 fases gated** (Smoke test → Concierge → Beta pago → Escala), subordinado à validação de retenção e unit economics de Clóvis.
2. **Mix de canais em 5 camadas** com sequência clara: creator-led/Cahuã e comunidade primeiro (CAC~0), micro-creators e pago só após retenção provada; construção deliberada de ativos de marca próprios para mitigar dependência do Cahuã.
3. **Funil de 6 etapas** mapeado ao fluxo real (anamnese→WhatsApp→feedback), com micro-conversões e metas por transição.
4. **Estratégia de conteúdo** em 5 pilares (ciência traduzida, vida real, prova viva, bastidor do método, comunidade), anti-hype, sticker pack e Pulso animado como ativos recorrentes.
5. **Modelo de trial** curto (7–14 dias) desenhado para o "aha" de adaptação viva na janela de decisão Dias 0–7; empurrar planos trimestral/anual para retenção.
6. **Quadro de KPIs realistas** com North Star (treinos concluídos c/ feedback/aluno/semana), metas de retenção mês-1 ≥ 55–60%, LTV/CAC ≥ 3, payback ≤ 2 meses, e alerta de margem de contribuição por assinante.
7. **Plano de otimização contínua** (A/B, coortes de retenção por canal, voz do cliente via WhatsApp).
8. **Contingência de naming** embutida no cronograma (Movivo/Trenova) sem retrabalho de marketing.

---

## Fontes Consultadas

- Adapty — In-app subscription benchmarks for Health & Fitness apps: https://adapty.io/blog/health-fitness-app-subscription-benchmarks/
- Adapty — Trial conversion rates for in-app subscriptions: https://adapty.io/blog/trial-conversion-rates-for-in-app-subscriptions/
- RevenueCat — State of Subscription Apps 2025: https://www.revenuecat.com/state-of-subscription-apps-2025
- RocketShip HQ — Adapty benchmark: fitness apps and hard paywalls: https://www.rocketshiphq.com/paywall-optimization-fitness-apps/
- Business of Apps — Health & Fitness App Benchmarks (2026): https://www.businessofapps.com/data/health-fitness-app-benchmarks/
- Digital Yield Group — Health & Fitness Apps: The "Resolutioner" Churn Problem: https://digitalyieldgroup.com/blog/health-fitness-apps-the-resolutioner-churn-problem/
- Athletech News — Fitness Apps Are Highly Monetizable, Winner-Take-Most: https://athletechnews.com/fitness-apps-monetizable-winner-take-all-or-most/
- Message Central — WhatsApp Marketing Brazil 2026: Strategy, Templates, ROI: https://www.messagecentral.com/blog/whatsapp-marketing-brazil
- Egrow — WhatsApp Commerce Statistics 2026: https://www.egrow.com/en/blog/whatsapp-commerce-statistics-2026-the-numbers-every-e-commerce-owner-should-know
- Mazkara Studio — WhatsApp Penetration in Latin America 2026 (API costs & benchmarks): https://mazkara.studio/en/newsletter/whatsapp-penetration-latin-america-2026/
- getKanal — WhatsApp Marketing ROI: 12 KPIs and Industry Benchmarks (2026): https://getkanal.com/blog/whatsapp-marketing-roi-kpis-benchmarks
- Influencer Marketing Hub — Creator Waitlist Strategies That Outperform Paid Social: https://influencermarketinghub.com/influencer-waitlist-strategy/
- Reach Influencers — Brazilian Fitness Influencers 2026: https://reach-influencers.com/brazilian-fitness-influencers/
- Stack Influence — The Creator's Product Launch Strategy That Sells: https://stackinfluence.com/blog/the-creators-product-launch-strategy-that-sells/
- iQfluence — Gymshark Influencer Marketing Strategy: https://iqfluence.io/public/blog/gymshark-influencer-marketing

> **Limitações de pesquisa declaradas:** (1) Os benchmarks de trial-to-paid, churn e LTV vêm de dados agregados de apps de assinatura (Adapty, RevenueCat) — a MOVIVO é serviço conversacional no WhatsApp, não app de loja, então os números são **referências direcionais**, não previsões; o comportamento real deve ser medido no concierge/beta. (2) As taxas de conversão de WhatsApp (45–60%, 66%) vêm majoritariamente de casos de e-commerce/varejo — assinatura de serviço de saúde recorrente pode divergir; validar com dados primários. (3) Não há benchmark público específico de "coaching de treino via WhatsApp com CREF no Brasil" (a mesma limitação que Clóvis declarou) — CAC/LTV-alvo são hipóteses a calibrar nas Fases 0–2. (4) O CAC "quase zero" da fase orgânica depende da performance real da audiência do Cahuã, ainda não medida.

---

## Síntese final do pipeline completo (fechamento — Helena, última etapa)

Como última Director do pipeline, consolido o que os cinco Directors entregaram para a ideia `fitness-ia-whatsapp` — um sistema coerente que vai da validação de negócio à máquina de crescimento:

- **Clóvis (Business Discovery & Product Strategy) — o gate.** Validou COM RESSALVAS: mercado real e crescente, canal (WhatsApp) provado, time raro (devs + creator + CREF), mas com dois riscos dominantes que reconfiguraram todo o resto — **regulatório** (prescrição de exercício é privativa de CREF; a marca não pode ser "IA que prescreve") e **unit economics apertados** (LLM+WhatsApp+hora CREF vs. ticket baixo). Impôs a cadência de validação: **smoke test + concierge MVP antes de escalar.** Tudo que veio depois obedece a essas duas ressalvas.

- **Gabriel (Brand Strategist) — o eixo.** Transformou a restrição jurídica em virtude de marca: essência **"Ciência que treina com você"**, categoria própria **"orientação de treino conversacional"**, 4 pilares (Proximidade radical / Adaptação viva / Respaldo profissional / Acesso justo), arquétipo Mentor-acessível + Companheiro, 3 personas, e a decisão arquitetural crítica — **Branded House com o Cahuã como endossante/voz, nunca a marca** (protege contra o risco marca-pessoa), com o selo CREF como assinatura de credibilidade. Território anti-hype.

- **Caio (Naming) — o nome.** **MOVIVO** ("movimento vivo", quente, elástico para wellness, `movivo.com.br` livre), com **TRENOVA** como hedge jurídico, dado o ponto de atenção real de proximidade fonética com a VIVO/Telefônica (pendente de busca no INPI). Transparente sobre a limitação de não ter acedido ao INPI.

- **Kimura (Brand Designer) — a forma.** Sistema visual **"O Pulso"** — símbolo abstrato (batimento/progresso/movimento, sem clichê de academia nem de robô), paleta **Petróleo Vivo + Verde Pulso + Coral** desenhada para (a) destacar o avatar no verde-e-branco do WhatsApp e (b) distanciar visualmente da VIVO (mitigando o risco jurídico pelo design), tipografia Hanken + mono para dado, motion "que respira", selo CREF sóbrio, e **munição de marketing embutida** (sticker pack, Pulso animado, avatar como conversão). Sistema name-agnóstico (serve a Trenova em ~1 dia).

- **Helena (Marketing Strategist) — o crescimento.** GTM em **4 fases gated** subordinado à retenção e aos economics de Clóvis; **5 camadas de canais** (creator-led/Cahuã + comunidade primeiro, pago só após retenção provada, com ativos de marca próprios para não depender do Cahuã); **funil de 6 etapas** mapeado ao fluxo real (anamnese→WhatsApp→feedback); **conteúdo anti-hype em 5 pilares**; **trial curto** desenhado para a janela de decisão Dias 0–7; e **KPIs realistas** (North Star = treinos concluídos c/ feedback/aluno/semana; retenção mês-1 ≥ 55–60%; LTV/CAC ≥ 3; payback ≤ 2 meses) com alerta permanente de margem de contribuição por assinante.

**O fio que costura tudo:** um negócio cuja maior vantagem (o WhatsApp + a audiência do Cahuã + o respaldo CREF) é também sua maior fragilidade se mal gerida (margem apertada, risco regulatório, dependência de pessoa física e de um único profissional). A estratégia integrada responde a isso com **disciplina de sequência** — provar retenção e economics em pequena escala antes de gastar em aquisição — e com **confiança/ciência como diferencial central**, o único quadrante que nenhum concorrente brasileiro ocupa. Se a operação honrar a promessa (protocolos aprovados, credenciamento de mais CREFs conforme escala, INPI resolvido), a MOVIVO tem um caminho realista de crescimento previsível. O pipeline está completo; a decisão de executar — e a velocidade — cabe aos sócios, respeitando os gates de validação aqui definidos.

**Fim do pipeline `fitness-ia-whatsapp`.**
