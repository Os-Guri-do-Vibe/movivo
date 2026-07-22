# Relatório — Lucas Monteiro (Senior Product Manager / Head de Produto)

**Data:** 2026-07-22
**Ideia analisada:** MOVIVO — AI Coach de treino no WhatsApp
**Pasta do projeto:** docs/fitness-ia-whatsapp/
**Status do pipeline:** Fase 1 concluída (Clóvis/Gabriel/Caio/Kimura/Helena) → Fase 2 pendente (Alexandre/Eduardo) → **Fase 3: Produto — Lucas em análise**

---

## Resumo executivo

A jornada funcional proposta é sólida em sua lógica sequencial, mas apresenta **quatro gaps críticos** que, se não endereçados antes do lançamento, elevarão o churn e destruirão o LTV: (1) ausência de um "aha moment" explícito nos primeiros 3 dias do trial; (2) formulário de anamnese monolítico com risco alto de abandono; (3) falta de mecanismo de reengajamento entre check-ins semanais; e (4) ausência de uma experiência de offboarding que converta cancelamentos em pausas.

A abordagem de **IA sobre motor determinístico** é a escolha técnica de produto mais acertada para o estágio atual — reduz risco de alucinação, garante auditabilidade regulatória (CREF/LGPD) e permite escalar sem depender de modelos cada vez mais caros. A North Star Metric recomendada é **"Treinos Concluídos por Usuário Pago nos Primeiros 30 Dias"** (target: ≥ 8 treinos), pois é o preditor mais forte de retenção a 90 dias em plataformas de fitness.

O MVP deve ser deliberadamente pequeno: landing page + formulário + protocolo gerado + conversa WhatsApp + check-in semanal. Tudo o mais é Fase 2. Com 3 devs co-fundadores e canal orgânico do Cahuã, o risco de over-engineering é maior do que o risco de under-delivery.

---

## Contexto recebido

### Do pipeline anterior

| Agente | Contribuição relevante para produto |
|---|---|
| **Clóvis** | VALIDADO COM RESSALVAS. Modelo de receita R$29-59/mês. ICP: 18-30 anos, digital-native, sensível a preço. CREF obrigatório — IA personaliza, não prescreve independentemente. |
| **Gabriel** | Posicionamento "Ciência que treina com você". Arquétipo Mentor-acessível + Companheiro. Categoria criada: "orientação de treino conversacional". |
| **Caio** | Nome: MOVIVO. Brandable, disponível, memorável. |
| **Kimura** | "O Pulso" — design system. Identidade visual baseada em movimento e energia. |
| **Helena** | GTM em 4 fases gated. Canal WhatsApp 45-60% conversão. Distribuição via Cahuã (orgânico). Churn é o vilão. CAC zero na largada. |

### Input do usuário

Jornada de 10 etapas: aquisição → landing page → formulário/PAR-Q → mensagem de sucesso → pipeline backend → protocolo no WhatsApp → conversa AI Coach → conversão pós-trial → check-in semanal → escalabilidade.

Stack: Next.js 15, NestJS, PostgreSQL, Redis, BullMQ, DeepSeek/OpenAI/Anthropic, AraraHQ, Stripe/Asaas, PostHog, Docker.

IA como camada de decisão sobre motor determinístico próprio.

---

## Validação da jornada funcional

### Etapa 1 — Aquisição (marketing → landing page)

**Status:** Dependência crítica de Helena (GTM) e do Cahuã (canal orgânico). Produto não controla esse fluxo diretamente.

**Gap identificado:** A landing page precisa ter **CTA único e inequívoco**. Múltiplos planos visíveis antes do trial criam paralisia de escolha. Recomendação: esconder detalhes de plano na landing page do trial — o usuário escolhe o plano apenas no momento da conversão pós-trial (etapa 8).

**Oportunidade:** A landing page deve capturar o **objetivo principal** do usuário (perder peso / ganhar massa / condicionamento) antes mesmo do formulário completo — um pré-qualifying de 1 clique que segmenta e personaliza a experiência desde o início.

### Etapa 2 — Landing Page

**Status:** Bem definida em intenção. Precisa de decisões de produto específicas.

**Gaps:**
- Ausência de social proof no momento de decisão (depoimentos, número de usuários ativos, resultados reais).
- "Testar gratuitamente por 14 dias" é um commitment elevado sem âncora de valor — adicionar **garantia de cancelamento a qualquer momento** e um benefício tangível imediato ("Seu protocolo personalizado em menos de 2 horas").
- O formulário de anamnese precisa ter seu link pré-preenchido com o objetivo escolhido na landing page (pré-qualifying).

**Risco:** Fricção entre landing page e formulário pode causar drop de 30-50% se o redirecionamento não for percebido como fluxo contínuo. Recomendar que o formulário seja **embedded** na própria landing page (modal ou seção inline) ou que o redirecionamento seja instantâneo com contexto mantido.

### Etapa 3 — Formulário de Anamnese + PAR-Q

**Status:** Este é o ponto de maior risco de abandono de toda a jornada.

**Dados de referência:** Cada campo adicional reduz a taxa de conclusão em 3-5%. Formulários com mais de 7 campos têm abandono médio de 67%. Conversational forms (pergunta por pergunta) atingem 40% mais completions que formulários estáticos tradicionais.

**Gaps críticos:**
1. **Volume de perguntas:** Uma anamnese completa + PAR-Q pode facilmente ter 20-30 campos. Sem um design de progressive disclosure, o abandono será alto.
2. **Ausência de progresso visível:** O usuário precisa ver "Pergunta 4 de 12" ou uma barra de progresso — aumenta completion em até 28%.
3. **Falta de validação de dados de saúde em tempo real:** PAR-Q tem perguntas binárias com ramificações — se o usuário responde "sim" a contraindicações, o fluxo precisa tratar isso (não pode simplesmente prosseguir).
4. **LGPD:** Dados de saúde são dados sensíveis (Art. 11 da LGPD). O formulário DEVE ter consentimento explícito, granular e registrado antes de qualquer coleta de dados de saúde. Isso não é opcional — a ANPD está intensificando fiscalização de dados sensíveis em 2026.

**Recomendações de produto:**
- Dividir em 3 blocos com salvamento automático entre eles: (a) Dados básicos + objetivo, (b) Histórico de saúde + PAR-Q, (c) Disponibilidade + equipamentos.
- Usar formato conversacional (typeform-like) em vez de formulário estático.
- Implementar lógica condicional: perguntas de equipamentos mudam conforme resposta de local de treino.
- Consentimento LGPD explícito no início do bloco (b) — antes de qualquer dado de saúde.
- Salvar o progresso com token (link de retorno por e-mail/WhatsApp se o usuário abandonar).

### Etapa 4 — Mensagem de Sucesso

**Status:** Existe mas está subaproveitada.

**Gap:** A mensagem atual é passiva ("em instantes você receberá o contato"). O usuário acaba de completar uma ação de alta fricção. Esse é o momento de **reforçar o commitment e o excitement**.

**Oportunidade:** Transformar a mensagem de sucesso em uma experiência de micro-onboarding:
- Confirmação de que a análise está sendo feita (feedback de processamento).
- "Enquanto seu protocolo é gerado, salve este número no WhatsApp: [número MOVIVO]" — ação imediata que aumenta a chance de receber a mensagem.
- Expectativa de tempo: "Você receberá seu protocolo em até 2 horas."
- Opção de e-mail de confirmação com resumo do que foi coletado.

### Etapa 5 — Pipeline de Processamento (backend)

**Status:** Correto em conceito. Detalhado em requisitos técnicos na seção de dependências e recomendações ao Rafael.

**Gap de produto:** SLA de entrega não está definido. Qual é o tempo máximo aceitável? Recomendação: **SLA de 2 horas como promessa pública**, com alerta interno se ultrapassar 30 minutos. Usuários aguardando mais de 4 horas têm taxa de abandono 3x maior.

**Oportunidade:** Enviar mensagem proativa no WhatsApp confirmando recebimento do cadastro imediatamente após submissão do formulário (antes do protocolo estar pronto). Isso ativa o canal WhatsApp e cria expectativa positiva.

### Etapa 6 — Geração e Envio do Protocolo

**Status:** Núcleo do produto. Bem definido em abordagem técnica.

**Gap crítico — "aha moment" ausente:** O protocolo enviado é uma entrega de informação, não uma experiência. O aha moment em apps de fitness é **completar o primeiro treino**. O protocolo precisa ser enviado com:
- Formato conversacional, não como documento.
- Primeiro treino da semana explicitamente destacado ("Vamos começar? Seu primeiro treino de hoje é…").
- Pergunta de engajamento imediato: "Qual o melhor horário para você treinar hoje ou amanhã?"
- Link para o protocolo completo (PDF ou Google Docs) para quem quiser ver tudo.

**Dados de referência:** Usuários que completam menos de 3 treinos nos primeiros 14 dias do trial têm taxa de churn 3-4x maior. O protocolo precisa ser projetado para gerar o primeiro treino nas primeiras 24-48 horas.

### Etapa 7 — Conversa com o AI Coach

**Status:** Diferencial competitivo central da MOVIVO. Precisa de regras claras de produto.

**Gaps:**
1. **Escopo da conversa:** O que o AI Coach responde e o que ele NÃO responde? Sem limites claros, o usuário vai perguntar sobre nutrição, suplementos, patologias — e o AI Coach vai ou aluci­nar ou recusar sem elegância.
2. **Handoff para humano:** Quando uma dúvida excede a capacidade do AI Coach, qual é o fluxo? Precisa haver um caminho para o profissional de Ed. Física responsável.
3. **Tom e persona consistente:** O AI Coach tem nome? Tem personalidade definida? (Pode ser "MOVI" — o coach da MOVIVO, alinhado com a identidade visual de Kimura.)
4. **Limites de mensagens no trial:** Usuário em trial tem acesso ilimitado à conversa? Se sim, isso pode ser custoso. Recomendação: trial com conversa ilimitada para maximizar o aha moment; pós-trial pago, também ilimitado (é o core value).
5. **Memória e contexto:** O AI Coach precisa "lembrar" o histórico da conversa e do protocolo. Arquitetura de memória (Redis + PGVector para RAG) precisa ser definida antes do desenvolvimento.

**Oportunidade:** Definir **respostas-padrão de alta qualidade** para as 20 perguntas mais frequentes de usuários fitness (o que comer antes do treino, quanto descanso, como substituir exercício X) — isso pode ser o RAG inicial antes de ter uma base de conhecimento científica robusta.

### Etapa 8 — Conversão Pós-Trial

**Status:** O momento mais crítico da monetização.

**Gaps:**
1. **Timing do link:** O link de assinatura enviado apenas no dia 14 é tarde demais. A decisão de converter é feita pelos usuários que tiveram aha moment — e eles querem continuar no pico do engajamento, não no dia 14.
2. **Falta de sequência de nurturing:** Os dias 10, 12 e 14 precisam de mensagens diferentes, não apenas um link no dia 14.
3. **Plano pré-selecionado:** O usuário escolheu um plano no início — esse plano precisa estar pré-selecionado e visível no momento da conversão (reduz fricção de decisão).
4. **Oferta de downgrade:** Se o usuário não converter no plano escolhido, oferecer o plano mais barato antes de perder o usuário.

**Sequência recomendada de conversão:**
- **Dia 7:** Check-in de progresso + primeira menção ao plano pago ("Você está mandando bem! Quando quiser garantir sua continuidade…")
- **Dia 10:** Destaque dos resultados obtidos nos 10 dias + urgência suave ("Faltam 4 dias para o final do seu período gratuito")
- **Dia 13:** Link direto com plano pré-selecionado + garantia (7 dias para cancelar se não gostar)
- **Dia 14 (encerramento):** Última chamada + oferta de downgrade se não converteu

**Benchmark:** Sequências de nurturing de trial em SaaS B2C com 3-4 touchpoints aumentam conversão em 25-40% vs. link único no último dia.

### Etapa 9 — Check-in Semanal

**Status:** Mecanismo de retenção correto. Execução precisa de cuidado.

**Gaps:**
1. **Domingo pode ser o dia errado:** Para ICP 18-30 anos, domingo à noite pode ter alta abertura, mas segunda-feira de manhã pode ter mais intenção de agir. Testar A/B no timing.
2. **Formulário de check-in:** Qual é o formato? Mensagem de texto livre? Formulário estruturado? Botões de escolha rápida? Recomendação: começar com **3 perguntas máximo via botões de resposta rápida** do WhatsApp (semáforo de cansaço, treinos completados, pedido de ajuste). Aumentar complexidade só se engajamento for alto.
3. **Ausência de feedback loop visível:** O usuário precisa ver que o check-in resultou em mudança no protocolo. "Com base no seu feedback desta semana, ajustei seu treino de quarta — reduzi a carga do agachamento e adicionei um exercício de mobilidade." Esse fechamento de loop é o que diferencia coaching real de pesquisa.
4. **Reengajamento para inativos:** O que acontece se o usuário não responder o check-in por 2 semanas? Não há mecanismo definido. Precisa de fluxo de win-back proativo.

**Oportunidade:** Transformar o check-in em um **"momento de vitória semanal"** — o AI Coach começa sempre destacando algo positivo antes de perguntar sobre dificuldades. Positivity bias em check-ins aumenta taxa de resposta em fitness apps.

### Etapa 10 — Escalabilidade e Segurança

**Status:** Correto em intenção. Os requisitos técnicos serão detalhados nas recomendações para Rafael.

**Gap de produto:** Isolamento de protocolo por cliente deve ser um requisito funcional explícito, não apenas técnico. O usuário precisa ter a percepção de que "seu coach só fala com você" — mesmo que seja IA. Isso é parte da proposta de valor, não só de segurança.

---

## Épicos e User Stories

### Épico 1 — Aquisição e Landing Page

**Objetivo:** Converter visitantes em leads qualificados com máxima eficiência.

**User Stories:**
- Como visitante, quero entender em menos de 10 segundos o que é a MOVIVO e como ela funciona, para decidir se vale testar.
- Como visitante, quero clicar em "Testar grátis" e iniciar o formulário sem sair da experiência visual da landing page, para não perder o contexto.
- Como visitante, quero escolher meu objetivo principal (perder peso / ganhar massa / condicionamento) antes de preencher o formulário, para sentir que a experiência já está sendo personalizada para mim.
- Como usuário retornante que abandonou o formulário, quero receber um link de retorno por WhatsApp/e-mail com meu progresso salvo, para não precisar recomeçar do zero.

**Critérios de aceite do Épico 1:**
- Taxa de clique no CTA ≥ 8% dos visitantes únicos.
- Taxa de início do formulário ≥ 70% dos cliques no CTA.
- Tempo médio de carregamento da landing page ≤ 1,5s (Core Web Vitals).

### Épico 2 — Anamnese e PAR-Q

**Objetivo:** Coletar todos os dados necessários para gerar um protocolo seguro e personalizado, com mínimo abandono e total conformidade LGPD.

**User Stories:**
- Como novo usuário, quero preencher o formulário em blocos curtos com barra de progresso visível, para não me sentir sobrecarregado.
- Como usuário com histórico de lesão, quero informar minha lesão e ver a MOVIVO confirmar que vai considerar isso no meu protocolo, para confiar que o treino será seguro para mim.
- Como usuário que vai treinar em casa, quero informar apenas os equipamentos que tenho, para receber exercícios que eu realmente consigo fazer.
- Como usuário consciente de privacidade, quero entender claramente quais dados de saúde serão coletados e como serão usados, antes de fornecê-los.
- Como usuário que abandonou o formulário na metade, quero receber um lembrete em 1 hora com link para retomar de onde parei.

**Critérios de aceite do Épico 2:**
- Taxa de conclusão do formulário ≥ 65% dos que iniciaram.
- 100% dos usuários com resposta "sim" no PAR-Q terem fluxo de tratamento definido (mensagem de orientação médica + bloqueio condicional de geração de protocolo até clearance).
- Registro de consentimento LGPD armazenado com timestamp e versão do texto antes de qualquer dado de saúde ser salvo.
- Formulário responsivo e funcional em dispositivos móveis (ICP usa majoritariamente mobile).

### Épico 3 — Geração e Entrega do Protocolo

**Objetivo:** Entregar o primeiro protocolo personalizado de forma rápida, clara e emocionalmente impactante — gerando o aha moment nas primeiras 24h.

**User Stories:**
- Como novo usuário, quero receber uma confirmação imediata no WhatsApp após enviar o formulário, para saber que meu cadastro foi recebido e o processo está acontecendo.
- Como novo usuário, quero receber meu protocolo em menos de 2 horas após o cadastro, para começar a treinar hoje.
- Como novo usuário recebendo meu protocolo, quero que o AI Coach me apresente e destaque qual é meu primeiro treino desta semana, para saber exatamente por onde começar.
- Como novo usuário, quero ser perguntado qual o melhor horário para treinar hoje ou amanhã, para que o AI Coach me ajude a criar o hábito desde o primeiro dia.
- Como novo usuário curioso, quero poder acessar o protocolo completo das próximas semanas em formato legível, para ter uma visão do planejamento.

**Critérios de aceite do Épico 3:**
- SLA de entrega do protocolo: ≤ 2 horas para 95% dos usuários.
- Taxa de resposta ao protocolo inicial ≥ 60% (indicador de engajamento).
- Taxa de "primeiro treino realizado em 48h" ≥ 50% dos novos usuários.

### Épico 4 — Conversa com AI Coach

**Objetivo:** Oferecer uma experiência de coaching conversacional que gere confiança, engajamento e percepção de valor superior ao custo da assinatura.

**User Stories:**
- Como usuário em treino, quero perguntar ao AI Coach como substituir um exercício que não consigo fazer, e receber uma alternativa dentro do meu nível e equipamentos disponíveis.
- Como usuário com dúvida técnica, quero perguntar sobre execução de um exercício e receber uma explicação clara com referência à minha condição específica.
- Como usuário com dor muscular incomum, quero que o AI Coach me oriente a parar o treino e procurar avaliação profissional, em vez de me dar orientações que possam piorar minha situação.
- Como usuário em trial, quero perceber que o AI Coach "lembra" o que conversamos ontem, para sentir que tenho um coach real acompanhando minha evolução.
- Como usuário com pergunta fora do escopo (nutrição, suplementos), quero receber uma resposta honesta sobre os limites do AI Coach e ser direcionado para recursos externos confiáveis.

**Critérios de aceite do Épico 4:**
- Tempo médio de resposta do AI Coach ≤ 30 segundos (p95).
- Taxa de satisfação com as respostas (thumbs up/down) ≥ 80% positivo.
- 0% de respostas com orientações médicas diretas (contraindicado pelo escopo CREF).
- Taxa de "segunda mensagem enviada pelo usuário no mesmo dia" ≥ 40% (indicador de engajamento conversacional).

### Épico 5 — Conversão Trial → Assinatura

**Objetivo:** Converter o máximo de trialists em assinantes pagantes através de sequência estruturada de nurturing.

**User Stories:**
- Como usuário no dia 7 do trial, quero receber um resumo do que já conquistei em uma semana, para ter motivação para continuar.
- Como usuário no dia 13 do trial, quero receber um link direto para assinar o plano que escolhi inicialmente, sem precisar procurar ou preencher dados novamente.
- Como usuário indeciso no último dia, quero ter a opção de escolher um plano mais barato antes de perder o acesso, para não precisar me descadastrar completamente.
- Como usuário que não converteu, quero receber uma mensagem de acompanhamento 3 dias após o encerramento do trial perguntando o motivo, para ter a chance de voltar se minha objeção for resolvível.

**Critérios de aceite do Épico 5:**
- Taxa de conversão trial → pago ≥ 25% (benchmark B2C SaaS: 10-20%; fitness com alta motivação: 20-30%).
- Taxa de abertura das mensagens de nurturing ≥ 70% (WhatsApp tem abertura naturalmente alta).
- Tempo médio entre recebimento do link de assinatura e pagamento ≤ 10 minutos (se o usuário já decidiu).

### Épico 6 — Check-in Semanal e Retenção

**Objetivo:** Manter engajamento semanal, coletar feedback e fazer ajustes no protocolo de forma que o usuário perceba evolução e permaneça assinante.

**User Stories:**
- Como usuário pago, quero receber toda segunda-feira de manhã uma mensagem do AI Coach perguntando como foi minha semana, para me sentir acompanhado.
- Como usuário que fez check-in, quero ver uma mudança concreta no meu protocolo da próxima semana baseada no meu feedback, para saber que minha resposta importou.
- Como usuário que não treinou na semana, quero receber uma mensagem sem julgamento que me ajude a identificar o que aconteceu e como retomar, para não me sentir mal e desistir.
- Como usuário avançado, quero poder pedir ajustes específicos no meu protocolo via conversa (fora do check-in semanal), para ter a flexibilidade de um coach real.
- Como usuário ausente por 2 semanas, quero receber uma mensagem de reengajamento personalizada com um protocolo simplificado de retorno, para voltar a treinar sem me sentir sobrecarregado.

**Critérios de aceite do Épico 6:**
- Taxa de resposta ao check-in semanal ≥ 55%.
- Taxa de retenção em 30 dias ≥ 80% dos pagantes.
- Taxa de retenção em 90 dias ≥ 60% dos pagantes.
- Taxa de reengajamento de inativos (2 semanas sem check-in) ≥ 30%.

### Épico 7 — Operações e Observabilidade (não-funcional, mas crítico para produto)

**User Stories:**
- Como time de produto, quero visualizar em tempo real quantos usuários estão em cada etapa do funil (formulário → protocolo enviado → primeiro treino → conversão), para identificar gargalos rapidamente.
- Como time de produto, quero ser alertado quando o SLA de entrega de protocolo estiver sendo ultrapassado, para investigar e intervir antes que usuários abandonem.
- Como profissional de Ed. Física responsável, quero ter uma dashboard com todos os protocolos gerados e flags de usuários com contraindicações no PAR-Q, para fazer revisão e assinar eletronicamente os protocolos.
- Como time de produto, quero ter acesso a replays de conversas com o AI Coach anonimizados, para identificar padrões de perguntas não respondidas bem e melhorar o sistema.

---

## MVP — Escopo mínimo viável

### O que ENTRA no MVP (Day 1)

| Componente | Descrição | Prioridade |
|---|---|---|
| Landing Page | CTA único, pré-qualifying de objetivo, social proof básico | P0 |
| Formulário de Anamnese + PAR-Q | Conversacional, 3 blocos, barra de progresso, consentimento LGPD, salvamento de progresso | P0 |
| Mensagem de sucesso + confirmação WhatsApp | Imediata após formulário, salvar número | P0 |
| Pipeline de processamento | Webhook → Backend → Fila → Worker IA → Motor determinístico → Protocolo | P0 |
| Entrega do protocolo no WhatsApp | Protocolo inicial + apresentação do AI Coach + pergunta de engajamento | P0 |
| Conversa AI Coach | Resposta a mensagens livres dentro do escopo de treino, memória de sessão, fallback elegante | P0 |
| Check-in semanal | Mensagem estruturada toda segunda-feira, 3 perguntas máximo via botões, ajuste de protocolo | P0 |
| Sequência de conversão (dias 7, 10, 13, 14) | Mensagens automáticas com link de assinatura pré-preenchido | P0 |
| Pagamento (Stripe ou Asaas) | Checkout simples, recorrência mensal, cancelamento self-service | P0 |
| Dashboard de operações mínima | Fila de processamento, SLA de entrega, usuários por etapa | P0 |
| Isolamento de contexto por usuário | Protocolo e histórico de conversa completamente separados por cliente | P0 |

### O que FICA para Fase 2

| Componente | Justificativa do adiamento |
|---|---|
| App mobile próprio (iOS/Android) | WhatsApp elimina a necessidade no MVP. App nativo é cara de scale. |
| Dashboard do usuário (portal web) | O valor está na conversa, não em um portal. Adiar até validar demanda. |
| Planos anuais | Validar retenção mensal antes de oferecer annual. |
| Integração com wearables (Garmin, Apple Watch) | Complexidade técnica alta. Valor incremental só após base de usuários estabelecida. |
| Gamificação (streaks, badges, rankings) | Pode aumentar retenção, mas é uma aposta. Validar retenção orgânica primeiro. |
| Referral program automatizado | Orgânico via Cahuã é suficiente para fase inicial. Automatizar na escala. |
| Nutrition coaching (cardápio, macros) | Fora do escopo CREF atual. Adicionar na Fase 2 com parceiro nutricionista. |
| Pagamento por PIX automático/recorrente | Priorizar no roadmap Q2 (Central do Banco do Brasil regulamentou recorrência PIX em 2026). |
| Multi-idioma | Somente PT-BR no MVP. |
| API para parceiros (academias, nutricionistas) | Fase 3+ (B2B play). |

### Critério de "pronto para Fase 2"

O produto está pronto para escalar para Fase 2 quando atingir simultaneamente:
- ≥ 100 usuários pagantes ativos.
- Retenção em 30 dias ≥ 75%.
- Conversão trial → pago ≥ 20%.
- NPS ≥ 50.
- SLA de entrega de protocolo ≤ 2h cumprido em ≥ 95% dos casos sem intervenção manual.

---

## North Star Metric e KPIs

### North Star Metric

**"Treinos Concluídos por Usuário Pago nos Primeiros 30 Dias"**

**Meta:** ≥ 8 treinos completados nos primeiros 30 dias de assinatura paga.

**Justificativa:** Dados de plataformas de fitness com IA mostram que usuários que completam mais de 3 treinos nas primeiras 2 semanas têm 3-4x menos churn. Para o ICP da MOVIVO (18-30 anos, 3-5 dias/semana de treino planejado), 8 treinos em 30 dias representa aproximadamente 2 treinos por semana — abaixo da meta do protocolo, mas acima do threshold de abandono. Essa métrica captura simultaneamente: (a) o protocolo foi executável, (b) o usuário engajou com o AI Coach, (c) o valor está sendo percebido. É mensurável sem wearable — via auto-reporte no check-in semanal + confirmações na conversa.

### KPIs de Produto (hierarquia)

#### Camada 1 — Aquisição
| KPI | Meta MVP | Fonte |
|---|---|---|
| Visitantes únicos na landing page | — (depende do canal do Cahuã) | PostHog |
| Taxa de clique no CTA | ≥ 8% | PostHog |
| Taxa de conclusão do formulário | ≥ 65% dos que iniciaram | PostHog |
| Leads qualificados por semana | ≥ 20 leads/semana nas primeiras 4 semanas | CRM interno |

#### Camada 2 — Ativação
| KPI | Meta MVP | Fonte |
|---|---|---|
| Tempo médio de entrega do protocolo | ≤ 2h (p95) | OpenTelemetry/Grafana |
| Taxa de confirmação do número no WhatsApp | ≥ 90% dos leads | AraraHQ |
| Taxa de resposta à primeira mensagem do AI Coach | ≥ 60% em 24h | AraraHQ |
| Taxa de "primeiro treino em 48h" (auto-reporte) | ≥ 50% | Check-in semanal |

#### Camada 3 — Retenção
| KPI | Meta MVP | Fonte |
|---|---|---|
| Taxa de resposta ao check-in semanal | ≥ 55% | AraraHQ |
| Mensagens enviadas por usuário por semana | ≥ 3 mensagens/semana | AraraHQ |
| Retenção em 30 dias | ≥ 80% dos pagantes | Stripe/Asaas |
| Retenção em 90 dias | ≥ 60% dos pagantes | Stripe/Asaas |
| Churn mensal | ≤ 8% | Stripe/Asaas |

#### Camada 4 — Monetização
| KPI | Meta MVP | Fonte |
|---|---|---|
| Taxa de conversão trial → pago | ≥ 25% | Stripe/Asaas |
| MRR (Receita Recorrente Mensal) | ≥ R$5.000 no mês 3 | Stripe/Asaas |
| LTV médio (estimado) | ≥ R$400 (plano ~R$40/mês × 10 meses) | Calculado |
| CAC (custo por aquisição) | ≤ R$30 na fase orgânica | Planilha |
| LTV/CAC | ≥ 10:1 na fase orgânica | Calculado |

#### Camada 5 — Satisfação
| KPI | Meta MVP | Fonte |
|---|---|---|
| NPS (Net Promoter Score) | ≥ 50 no mês 2 | Survey no check-in semana 4 |
| CSAT das respostas do AI Coach | ≥ 80% positivo | Feedback inline no WhatsApp |
| Taxa de cancelamento self-reported por insatisfação | ≤ 30% dos churns | Pesquisa de saída |

### Anti-métricas (o que NÃO otimizar)
- Número de mensagens total enviadas pelo AI Coach (pode inflar com spam, não indica valor).
- Número de leads brutos sem segmentação (vanity metric).
- Tempo médio na conversa sem correlação com treinos completados.

---

## Abordagem IA + Motor Determinístico — Validação de Produto

### Validação da escolha

A abordagem de **IA como camada de decisão sobre motor determinístico próprio** é a escolha correta para o MOVIVO neste estágio. Esta conclusão é sustentada por:

**1. Consistência e segurança regulatória**

LLMs puros não são máquinas de estado confiáveis. Eles não conseguem rastrear fatigue acumulada entre sessões, enforçar restrições de equipamento, ou lembrar que o usuário está na semana 3 de um bloco de treino de 6 semanas — sem explícita injeção de contexto. O motor determinístico resolve esse problema: ele mantém o estado da progressão, aplica regras de periodização, e injeta constraints no prompt do LLM antes de cada decisão. Isso reduz drasticamente o risco de alucinações com consequências para saúde do usuário, e cria uma camada de auditoria que o profissional de Ed. Física pode revisar e assinar — requisito CREF.

**2. Custo de tokens controlável**

Com o motor determinístico pré-calculando opções válidas e injetando apenas o contexto relevante no prompt (em vez de enviar o histórico completo de 30 dias de conversa), o custo por interação cai significativamente. Em escala de 1.000 usuários com 5 mensagens/dia, a diferença entre RAG otimizado + motor vs. contexto bruto pode ser de 60-70% no custo de tokens.

**3. Versionamento e melhoria contínua**

O motor determinístico pode ser versionado separadamente dos modelos de IA. Se uma regra de periodização for atualizada pelo profissional responsável, todos os usuários se beneficiam na próxima semana sem re-treinar nenhum modelo. Isso é especialmente crítico para um produto que usa conhecimento científico como diferencial.

**4. Validação por benchmarks externos**

A plataforma Iron Church (AI fitness, referência técnica no segmento) usa exatamente esta arquitetura: dois subsistemas determinísticos calculam hard constraints e os injetam como contexto em cada chamada de LLM. O resultado: respostas consistentes, validáveis e auditáveis.

### Riscos da abordagem e mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Motor determinístico se torna um gargalo de engenharia — toda nova regra requer deploy | Média | Alto | Usar DSL (Domain Specific Language) para regras de treino que o profissional de Ed. Física pode editar sem código. Exemplo: YAML de regras de progressão. |
| LLM ignora constraints do motor e gera resposta fora das regras | Baixa | Alto | Camada de validação pós-geração: output do LLM passa por checklist de constraints antes de ser enviado ao usuário. |
| RAG com literatura científica gera respostas conflitantes com o protocolo do usuário | Média | Médio | RAG deve ser consultado apenas para explicações gerais, não para decisões de protocolo. Decisões de protocolo = motor determinístico. |
| Modelo de LLM preferido (DeepSeek/OpenAI/Anthropic) fica indisponível | Baixa | Alto | Arquitetura com fallback entre provedores. Victor (agente de IA) deve implementar abstraction layer. |
| Custo de tokens escala mais rápido que receita | Média | Alto | Monitorar custo por usuário/mês desde o MVP. Target: custo de IA ≤ 15% do ARPU (R$40 ARPU → custo de IA ≤ R$6/usuário/mês). |

### Fluxo de dados recomendado (refinamento do input do usuário)

```
Usuário envia mensagem
    ↓
Webhook (AraraHQ) → NestJS Controller
    ↓
Redis: lock de sessão por usuário (evita duplicata de mensagens simultâneas)
    ↓
BullMQ: enqueue job de processamento
    ↓
Worker: busca contexto do usuário (PostgreSQL: protocolo atual, semana, histórico de ajustes)
    ↓
Motor Determinístico: calcula estado atual (carga atual, progressão, constraints de lesão, equipamentos)
    ↓
RAG (PGVector): busca literatura científica relevante se a mensagem for dúvida técnica
    ↓
LLM (DeepSeek/OpenAI/Anthropic): gera resposta com contexto estruturado injetado
    ↓
Validação pós-geração: checklist de constraints (sem recomendação médica, dentro do escopo CREF, sem contradição com protocolo)
    ↓
Se validação falhar: fallback para resposta-padrão + flag para revisão humana
    ↓
Worker WhatsApp: envia resposta via AraraHQ
    ↓
PostgreSQL: atualiza histórico da conversa
    ↓
PostHog: registra evento de interação
```

---

## Dependências entre agentes

### Mapa de dependências — produto como hub central

```
Alexandre (LGPD)    Eduardo (Pricing)
      ↓                    ↓
      └─────────────────────┘
                ↓
          Lucas (Produto) ←→ Sofia (UX)
                ↓
         ┌──────┴──────────────────┐
         ↓                         ↓
  Rafael (Arquitetura)        Victor (IA/ML)
         ↓                         ↓
  ┌──────┴──────┐           Leonardo (Backend)
  ↓             ↓                 ↓
Felipe       Leonardo          [Worker IA]
(Frontend)   (Backend)
```

### Dependências críticas por agente

#### Alexandre (LGPD / Compliance)
**O que produto depende de Alexandre:**
- Definição das bases legais para tratamento de dados sensíveis de saúde (Art. 11 LGPD) antes de desenvolver o formulário de anamnese.
- Template de consentimento explícito que passe em auditoria (incluindo finalidade, compartilhamento com profissional de Ed. Física responsável, retenção de dados).
- Política de exclusão de dados para cancelamentos (direito ao esquecimento — LGPD Art. 18).
- RIPD (Relatório de Impacto à Proteção de Dados) — exigido para dados sensíveis em escala. A ANPD está priorizando fiscalização de dados de saúde em 2026.
- Definição de quanto tempo os dados de anamnese e conversas podem ser retidos.

**Bloqueador:** O formulário de anamnese não pode ser desenvolvido sem o template de consentimento validado por Alexandre. Este é um bloqueador P0.

**Prazo recomendado:** Alexandre deve entregar seu relatório antes do início do desenvolvimento do formulário (Sprint 1).

#### Eduardo (Pricing / Monetização)
**O que produto depende de Eduardo:**
- Definição final dos planos e preços (R$29/mês e R$59/mês são hipóteses de Helena — precisam ser validados).
- Decisão sobre trial gratuito de 14 dias: exigir cartão de crédito ou não? (CC-required trials convertem 31,4% vs. 8,9% de opt-in trials — mas o ICP sensível a preço pode ter resistência inicial ao CC).
- Estratégia de upsell: o que diferencia o plano R$29 do R$59? Produto precisa dessa resposta para construir o fluxo de conversão.
- Política de reembolso e garantia (impacta o CTA de conversão).
- Decisão sobre PIX recorrente como alternativa ao cartão (relevante para o ICP brasileiro 18-30 anos com menor penetração de cartão de crédito).

**Bloqueador:** Sem a definição de Eduardo, o fluxo de conversão (Épico 5) e a escolha de gateway (Stripe vs. Asaas) ficam indefinidos.

#### Sofia (UX / Design)
**O que produto entrega para Sofia:**
- User journeys detalhados por épico (este documento é a fonte primária).
- Critérios de aceite de cada fluxo.
- Definição dos moments que importam: aha moment, conversão, check-in.
- Constraints de acessibilidade (ICP mobile-first, conexão variável).

**O que produto depende de Sofia:**
- Wireframes do formulário de anamnese (conversacional vs. estático — decisão que impacta diretamente a taxa de conclusão).
- Fluxo de UX do protocolo recebido no WhatsApp (como estruturar mensagens longas de forma legível em mobile).
- Design do check-in semanal (botões de resposta rápida vs. texto livre).
- Proposta de persona visual do AI Coach ("MOVI") alinhada com o design system de Kimura.

#### Rafael (Arquiteto de Software)
**O que produto entrega para Rafael:**
- Requisitos funcionais e não-funcionais deste documento.
- Fluxo de dados completo do sistema.
- SLAs de produto (2h para protocolo, 30s para resposta do AI Coach).
- Requisitos de isolamento por usuário.
- Requisitos de auditoria para compliance CREF/LGPD.

Seção específica detalhada ao final deste documento.

#### Victor (IA / ML)
**O que produto entrega para Victor:**
- Definição do escopo do AI Coach (o que responde, o que não responde, fallbacks).
- Definição do fluxo de RAG (literatura científica para explicações gerais, não decisões de protocolo).
- Requisitos de latência (p95 ≤ 30 segundos de resposta).
- Requisitos de fallback entre provedores (DeepSeek → OpenAI → Anthropic).
- Exemplos das 20 perguntas mais frequentes (base de teste para avaliação de qualidade).

**O que produto depende de Victor:**
- Avaliação de qual modelo tem melhor custo-benefício para o caso de uso (respostas curtas e diretas de fitness, em português).
- Proposta de arquitetura de memória (como o AI Coach "lembra" o histórico sem explodir o contexto).
- Estimativa de custo por usuário/mês com a arquitetura proposta.
- Estratégia de fine-tuning vs. prompt engineering para o tom do AI Coach.

#### Leonardo (Backend)
**O que produto entrega para Leonardo:**
- Especificações de cada endpoint necessário para os épicos.
- SLAs de performance por operação.
- Requisitos de fila e retry (BullMQ).
- Lógica do motor determinístico de treino (produto deve especificar as regras de negócio; Leonardo implementa).

**O que produto depende de Leonardo:**
- Estimativa de capacidade: quantos usuários simultâneos o sistema suporta com a stack proposta?
- Custo de infraestrutura por faixa de usuários (100, 1k, 10k usuários).

#### Felipe (Frontend)
**O que produto entrega para Felipe:**
- Especificações da landing page (CTA, pré-qualifying, copywriting com input de Gabriel/Helena).
- Especificações do formulário de anamnese (campos, lógica condicional, blocos, progresso).
- Especificações da página de checkout/conversão.
- Critérios de performance (Core Web Vitals, mobile-first).

---

## Riscos de produto e mitigações

### Risco 1 — Abandono no formulário de anamnese (CRÍTICO)
**Probabilidade:** Alta | **Impacto:** Alto

Formulários longos com dados de saúde têm abandono típico de 60-70%. Se o formulário não for bem desenhado, o funil quebra antes do produto ser testado.

**Mitigações:**
- Formato conversacional progressivo (typeform-like) com salvamento automático.
- Máximo de 12 perguntas visíveis por vez, com ramificação condicional.
- Opção de "retomar mais tarde" com link por WhatsApp/e-mail.
- A/B test no MVP entre formulário curto (dados essenciais) e formulário completo — começar com o curto e coletar o restante na primeira conversa com o AI Coach.

### Risco 2 — Baixa ativação no trial (CRÍTICO)
**Probabilidade:** Média-Alta | **Impacto:** Alto

69% dos usuários abandonam apps de fitness em 90 dias. Sem um aha moment explícito nos primeiros 3 dias, o trial será desperdiçado.

**Mitigações:**
- Protocolo entregue em ≤ 2 horas.
- Primeiro treino destacado e pergunta de horário imediata.
- Mensagem proativa no dia 2 se o usuário não tiver respondido nada ("Vi que você recebeu seu protocolo — como foi o primeiro treino?").
- Definir explicitamente o aha moment: "primeiro treino concluído e reportado" — e otimizar toda a jornada para chegar lá.

### Risco 3 — Problemas regulatórios CREF/LGPD (CRÍTICO)
**Probabilidade:** Média | **Impacto:** Muito Alto

A ANPD está priorizando fiscalização de dados de saúde em 2026. O CREF fiscaliza exercício ilegal da profissão inclusive em plataformas digitais (Resolução CREF4/SP nº 163/2023).

**Mitigações:**
- Consentimento LGPD granular e explícito para dados de saúde antes da coleta (bloqueador de desenvolvimento — Alexandre deve entregar primeiro).
- Framing consistente: IA personaliza dentro de protocolos assinados por profissional com CREF. Nunca "prescrever" — sempre "orientar" e "personalizar".
- Profissional de Ed. Física deve ter workflow de revisão e assinatura eletrônica dos protocolos gerados.
- DPO (Data Protection Officer) ou consultoria especializada antes de escalar.
- RIPD documentado antes de qualquer coleta de dados de saúde em escala.

### Risco 4 — Latência e confiabilidade do AI Coach (ALTO)
**Probabilidade:** Média | **Impacto:** Alto

Se o AI Coach demorar mais de 60 segundos para responder ou ficar indisponível, a percepção de valor cai drasticamente. No WhatsApp, usuários esperam respostas em segundos.

**Mitigações:**
- SLA interno: p50 ≤ 10s, p95 ≤ 30s, p99 ≤ 60s.
- Mensagem de "digitando…" imediata ao receber a mensagem do usuário (via AraraHQ — indica ao WhatsApp que a mensagem está sendo processada).
- Fallback entre provedores de LLM (DeepSeek → OpenAI → Anthropic).
- Cache de respostas para perguntas frequentes (Redis).
- Circuit breaker no Worker IA para evitar fila acumulada em caso de timeout do LLM.

### Risco 5 — Churn por falta de progressão percebida (ALTO)
**Probabilidade:** Média | **Impacto:** Alto

Usuários de fitness abandonam quando não percebem resultado. Se o protocolo for mal calibrado na anamnese, os primeiros treinos serão muito fáceis, muito difíceis, ou inadequados ao equipamento disponível.

**Mitigações:**
- Motor determinístico com regras rigorosas de adequação de carga ao nível declarado.
- Validação cruzada: equipamentos declarados → exercícios gerados (nunca gerar exercício para equipamento não declarado).
- Feedback de dificuldade no check-in semanal com ajuste automático na semana seguinte.
- Revisão manual dos primeiros 50 protocolos gerados pelo profissional de Ed. Física para calibrar o motor.

### Risco 6 — Dependência do canal Cahuã (MÉDIO)
**Probabilidade:** Baixa | **Impacto:** Alto

Se o canal orgânico do Cahuã reduzir produção ou tiver problemas, o CAC sobe imediatamente.

**Mitigações:**
- Construir lista própria de e-mails desde o primeiro lead (capturar e-mail no formulário).
- Investir em SEO e conteúdo orgânico da MOVIVO desde o mês 2.
- Definir com Eduardo o budget de paid acquisition a ser ativado quando o LTV estiver validado.

### Risco 7 — Custos de IA escalando mais rápido que receita (MÉDIO)
**Probabilidade:** Média | **Impacto:** Médio

Com 1.000 usuários enviando 5 mensagens/dia, o custo de tokens pode superar a margem do produto.

**Mitigações:**
- Monitorar custo por usuário/mês desde o dia 1 via PostHog + OpenTelemetry.
- Target: custo de IA ≤ 15% do ARPU (≤ R$6/usuário/mês para ARPU de R$40).
- Motor determinístico reduz tokens por chamada (injeta apenas contexto necessário).
- Cache de respostas frequentes reduz chamadas ao LLM.
- Avaliar DeepSeek como modelo principal (menor custo por token vs. GPT-4 para casos de uso de resposta direta).

---

## Recomendações para Rafael (Arquiteto de Software)

Rafael, este documento é o contrato de produto que você precisa para desenhar a arquitetura. Abaixo estão os requisitos de produto que têm impacto direto nas decisões arquiteturais:

### 1. SLAs inegociáveis (dimensionam o sistema)

| Operação | SLA | Observação |
|---|---|---|
| Processamento de protocolo inicial | ≤ 2h (p95) | Pode ser assíncrono; usuário é notificado quando pronto |
| Resposta do AI Coach a mensagem | ≤ 30s (p95) | Usuário vê "digitando…" imediato; resposta pode levar até 30s |
| Confirmação de recebimento do formulário | ≤ 5s | Síncrona — deve ser enviada imediatamente após submit |
| Check-in semanal disparado | Segunda-feira, 08:00-10:00 (horário de Brasília) | Processamento pode iniciar domingo à noite; envio na janela |
| Downtime tolerado | ≤ 0,1% (99,9% uptime) | Meta para produção; no MVP, 99,5% é aceitável |

### 2. Isolamento de contexto por usuário (requisito regulatório + de produto)

Este não é apenas um requisito técnico de segurança — é parte da proposta de valor. O usuário deve ter a percepção de que "seu coach só fala com você". Requisitos:
- Histórico de conversa de usuário A nunca pode vazar para usuário B, mesmo em respostas de cache.
- Protocolo de usuário A nunca pode aparecer no contexto de geração de resposta para usuário B.
- Em caso de bug que exponha dados de outro usuário, o sistema deve detectar, bloquear e alertar antes de enviar a mensagem.
- Logs de conversa devem ser particionados por `user_id` e criptografados em repouso.

### 3. Auditoria e assinatura de protocolos (requisito CREF)

O profissional de Ed. Física responsável precisa de:
- Dashboard com lista de todos os protocolos gerados (pendentes de revisão, revisados, sinalizados).
- Visualização do protocolo completo e das regras do motor determinístico que o geraram.
- Mecanismo de assinatura eletrônica (não precisa ser ICP-Brasil no MVP — assinatura com login autenticado + timestamp já cobre o requisito de auditoria inicial).
- Flag automático quando o motor gerar protocolo para usuário com contraindicação no PAR-Q (não bloquear, mas alertar para revisão prioritária).
- Versionamento de protocolos: toda atualização de protocolo deve ser registrada com timestamp, origem (motor / ajuste do AI Coach / ajuste manual do profissional) e diff do que mudou.

### 4. Arquitetura de memória do AI Coach

O AI Coach precisa de acesso a três camadas de contexto em cada interação:
- **Contexto imediato:** últimas 10-15 mensagens da conversa atual (Redis, TTL de sessão).
- **Contexto de protocolo:** protocolo atual do usuário, semana atual, histórico de ajustes (PostgreSQL, acesso a cada mensagem).
- **Contexto de conhecimento:** literatura científica de treino relevante (PGVector, consultado apenas quando a mensagem for dúvida técnica, não para decisões de protocolo).

A concatenação desses três contextos mais as constraints do motor determinístico forma o prompt de cada chamada ao LLM. O tamanho total do prompt deve ser monitorado e nunca deve incluir o histórico completo de conversas — apenas as últimas N mensagens.

### 5. Fluxo de formulário com salvamento de progresso

O formulário de anamnese não é uma operação atômica. O usuário pode abandonar no meio. Requisitos:
- Criar `anamnesis_session` no banco quando o usuário inicia o formulário (antes de qualquer dado de saúde).
- Cada bloco submetido deve ser salvo imediatamente (não esperar o formulário completo).
- Token de sessão único por usuário, associado ao WhatsApp/e-mail fornecido no início.
- Se o usuário retornar pelo link de retomada, o formulário deve continuar do último bloco concluído.
- Prazo de expiração da sessão: 72 horas. Após isso, dados parciais devem ser descartados (LGPD — não manter dados de saúde incompletos indefinidamente).

### 6. Fluxo de controle de concorrência (usuário enviando múltiplas mensagens rápidas)

Usuários no WhatsApp costumam enviar 3-5 mensagens rápidas em vez de uma mensagem longa. O sistema precisa:
- Implementar debounce por `user_id` no webhook handler: aguardar 3-5 segundos após a última mensagem antes de encaminhar para a fila de processamento, concatenando as mensagens do mesmo usuário no mesmo batch.
- Redis lock por `user_id` garantindo que apenas um job de processamento por usuário rode simultaneamente.
- Se um job está em processamento quando nova mensagem chega: enqueue a nova mensagem para processar após a conclusão do job atual (não em paralelo).

### 7. Requisitos de observabilidade para produto

Produto precisa dos seguintes eventos instrumentados via PostHog + OpenTelemetry desde o dia 1:
- `form_started` (com source do lead)
- `form_block_completed` (com número do bloco)
- `form_abandoned` (com último bloco completado)
- `form_submitted` (completo)
- `protocol_queued`
- `protocol_generated`
- `protocol_sent`
- `whatsapp_first_message_sent_by_user`
- `first_workout_confirmed` (via check-in ou conversa)
- `checkin_sent`
- `checkin_responded`
- `conversion_message_sent` (dias 7, 10, 13, 14)
- `subscription_created`
- `subscription_cancelled`

Esses eventos são a base do funil de produto. Sem eles, product analytics é cego.

### 8. Requisitos de fila e resiliência

Com a stack BullMQ + Redis proposta:
- Filas separadas por tipo de job: `protocol-generation`, `ai-response`, `whatsapp-outbound`, `checkin-weekly`.
- Dead letter queue para jobs que falharam após 3 retries — com alerta automático para o time.
- Rate limiting na fila `whatsapp-outbound` respeitando os limites da AraraHQ e da API do WhatsApp Business.
- Jobs de check-in semanal devem ser scheduled jobs no BullMQ com `repeat` configurado, não cron externo, para garantir que failovers não dupliquem envios.
- Persistência do Redis: AOF (Append Only File) habilitado para não perder jobs em caso de restart.

### 9. Estratégia de banco de dados

Tabelas mínimas para o MVP (esquema lógico, não DDL):
- `users` — dados de cadastro, status, plano, trial_end_date.
- `anamnesis_sessions` — progresso do formulário, dados coletados por bloco, status.
- `consents` — registro de consentimento LGPD por usuário, versão do texto, timestamp.
- `protocols` — protocolo atual por usuário, versão, gerado_em, revisado_por, assinado_em.
- `protocol_versions` — histórico de versões de cada protocolo com diff.
- `conversations` — mensagens trocadas, sender (user/ai), timestamp, job_id de processamento.
- `checkins` — respostas de check-in semanal por usuário por semana.
- `subscriptions` — assinatura atual, status, gateway_id, plano, valor.
- `ai_jobs` — histórico de jobs de processamento de IA com latência, modelo usado, custo de tokens, status.

### 10. Considerações sobre escala futura

O MVP roda em VPS Hostinger containerizado. Para facilitar a migração futura para Cloud quando atingir 1.000+ usuários simultâneos:
- Todos os serviços devem rodar em containers Docker sem estado (stateless) — estado vai para Redis/PostgreSQL.
- Configurações de ambiente via variáveis de ambiente, nunca hard-coded.
- PostgreSQL com Connection Pooling (PgBouncer) desde o início — evita problema de conexões ao escalar.
- Redis em modo cluster (ou pelo menos com sentinel) para evitar single point of failure.
- Logs estruturados em JSON para facilitar migração para serviços cloud de log (Loki já está na stack).

---

## Recomendações para os próximos agentes

### Para Alexandre (LGPD / Compliance)
- **Urgência máxima:** O relatório de Alexandre é um **bloqueador de desenvolvimento**. Sem a definição das bases legais, template de consentimento e RIPD, o formulário de anamnese (o coração do produto) não pode ser desenvolvido.
- Dados de saúde coletados: histórico de lesões, condições médicas (PAR-Q), medicamentos em uso, objetivos corporais, composição corporal inferida. Todos são dados sensíveis sob LGPD Art. 11.
- Bases legais candidatas: consentimento explícito (Art. 11, II, a) + legítimo interesse (Art. 10) para melhoria do serviço. Alexandre deve confirmar.
- Definir período de retenção: dados de anamnese por quanto tempo? Histórico de conversas? Após cancelamento?
- Definir fluxo de exclusão de dados (LGPD Art. 18, IV) que não quebre o histórico de protocolo do profissional responsável.
- RIPD deve cobrir: coleta de dados de saúde, compartilhamento com profissional de Ed. Física, armazenamento em servidores (VPS Hostinger — verificar se é no Brasil ou exterior e implicações da LGPD).

### Para Eduardo (Pricing / Monetização)
- Confirmar ou rever a hipótese de R$29-59/mês de Helena com pesquisa de preço com ICP real.
- Definir o que diferencia os dois planos: número de check-ins? Velocidade de resposta? Acesso a funcionalidades? Produto precisa disso para construir o fluxo de conversão.
- Avaliar: trial com CC obrigatório vs. sem CC. Dados mostram que CC-required converte 31,4% vs. 8,9% de opt-in, mas o ICP da MOVIVO (18-30 anos, sensível a preço) pode ter resistência. Recomendação: testar sem CC primeiro (menor fricção de entrada) e migrar para CC-required se a conversão for abaixo de 15%.
- Definir garantia de reembolso (ex: 7 dias após conversão) — reduz barreira de compra e raramente é acionada em produtos com alto engajamento.
- Avaliar PIX recorrente como opção de pagamento (relevante para o ICP com menor penetração de cartão de crédito).

### Para Sofia (UX)
- O formulário de anamnese é a maior oportunidade e o maior risco de produto. O design conversacional (pergunta por pergunta) vs. formulário tradicional pode ser a diferença entre 40% e 70% de taxa de conclusão. Sofia deve prioritizar este fluxo.
- O protocolo enviado pelo WhatsApp precisa ser projetado para ser lido em mobile, em uma janela de chat. Mensagens longas devem ser quebradas em múltiplas mensagens curtas com pausas (o AI Coach "digita" a resposta em partes).
- O check-in semanal com botões de resposta rápida do WhatsApp precisa de UX de copywriting — as 3 perguntas e as opções de resposta precisam ser testadas para maximizar a taxa de resposta.
- Definir a persona visual e o nome do AI Coach ("MOVI"?) alinhado com o design system de Kimura.

---

## Fontes Consultadas

- [Health & Fitness App Subscription Benchmarks 2026 — Adapty](https://adapty.io/blog/health-fitness-app-subscription-benchmarks/)
- [Free Trial Conversion Benchmarks 2025 — 1Capture](https://www.1capture.io/blog/free-trial-conversion-benchmarks-2025)
- [TOP 20 FREE TRIAL CONVERSION STATISTICS 2026 — Amra & Elma](https://www.amraandelma.com/free-trial-conversion-statistics/)
- [SaaS Average Free Trial Conversion Rate: Benchmarks — Userpilot](https://userpilot.com/blog/saas-average-conversion-rate/)
- [How Coaches Book 52% More Client Calls Using AI WhatsApp Chatbots — TrySetter](https://www.trysetter.com/blog/ai-whatsapp-chatbots-coaches-book-more-clients)
- [WhatsApp Chatbot for Gyms & Fitness Centers 2026 — Tecca](https://www.soytecca.com/en/whatsapp-chatbot/gyms)
- [AI Fitness App Development: Boost User Retention — RipenApps](https://ripenapps.com/blog/ai-fitness-app-development/)
- [AI Churn Prediction for Fitness Studios 2026 — Nutripy](https://nutripy.io/blog/ai-churn-prediction-fitness)
- [App Retention Benchmarks for 2026 — Enable3](https://enable3.io/blog/app-retention-benchmarks-2025)
- [Fitness App Retention & Churn Rate 2026 — RetentionCheck](https://retentioncheck.com/churn-benchmarks/fitness-apps)
- [Why Most 'AI' Fitness Apps Are Just Marketing — Outside Context](https://www.outsidecontext.com/2026/04/09/why-most-ai-fitness-apps-are-just-marketing-and-how-i-built-one-that-actually-works/)
- [Training Intelligence #3 – Architecture Decisions – Rules vs AI vs Hybrid — Liviu Nastasa](https://liviunastasa.com/2025/05/29/training-intelligence-3-architecture-decisions-rules-vs-ai-vs-hybrid/)
- [Deliberate Hybrid Design: Building Systems That Fall Back from AI to Deterministic Logic — DEV Community](https://dev.to/geluvac/deliberate-hybrid-design-building-systems-that-gracefully-fall-back-from-ai-to-deterministic-logic-1mna)
- [Enterprise AI Architecture: Hybrid Systems Guide — Niveus Solutions](https://niveussolutions.com/hybrid-ai-systems-genai-deterministic-precision/)
- [Worker Queues in NestJS: Scaling with BullMQ and Redis — Medium](https://medium.com/@bhagyarana80/worker-queues-in-nestjs-scaling-with-bullmq-and-redis-without-breaking-your-api-903fdcff43df)
- [Handling 2 Million Background Jobs a Day in NestJS with BullMQ — Medium](https://medium.com/@connect.hashblock/handling-2-million-background-jobs-a-day-in-nestjs-with-bullmq-and-rate-limited-queues-d059f8c69681)
- [15 Form Abandonment Statistics 2026 — Gnosari](https://gnosari.com/blog/form-abandonment-rate)
- [100+ User Onboarding Statistics 2026 — UserGuiding](https://userguiding.com/blog/user-onboarding-statistics)
- [How FitnessPlayer doubled its user base and reduced churn — Product Fruits](https://productfruits.com/case-studies/fitnessplayer)
- [North Star Metric: How to Find Yours — Userpilot](https://userpilot.com/blog/north-star-metric/)
- [Five North Star Metrics that drive real subscription growth — RevenueCat](https://www.revenuecat.com/blog/growth/north-star-metrics-subscription-growth)
- [Top 7 User Behavior Metrics for Fitness Apps — Sport & Fitness Apps](https://sportfitnessapps.com/blog/top-7-user-behavior-metrics-for-fitness-apps/)
- [Best AI Fitness Apps in 2026: Fitbod, Freeletics, Future and More — Sensai](https://www.sensai.fit/blog/best-ai-fitness-apps-2026-fitbod-freeletics-future-trainiac-alternatives)
- [LGPD para HealthTechs — Macher Tecnologia](https://www.machertecnologia.com.br/lgpd-healthtech/)
- [Destaques da Agenda Regulatória 2025-2026 da ANPD — Migalhas](https://www.migalhas.com.br/coluna/migalhas-de-protecao-de-dados/423103/destaques-da-agenda-regulatoria-2025-2026-da-anpd)
- [Resolução CREF4/SP Nº 163/2023 — CREF4/SP](https://crefsp.gov.br/portal-da-transparencia/legislacao/resolucoes-cref4-sp/resolucao-cref4-sp-no-163-2023)
- [Tratamento de dados em saúde: Bases legais, limites e boas práticas — Migalhas](https://www.migalhas.com.br/depeso/449916/tratamento-de-dados-em-saude-bases-legais-limites-e-boas-praticas)
- [How to Optimize Your Free Trial Length — Phiture](https://phiture.com/mobilegrowthstack/the-subscription-stack-how-to-optimize-trial-length/)
- [FlexAI: A Multi-modal Solution for Personalized and Adaptive Fitness Interventions — arXiv](https://arxiv.org/pdf/2604.00968)
- [AI Personal Trainer Apps Compared: ALAN vs Future vs Fitbod vs Freeletics — Alan](https://alan.gcltech.dev/blog/ai-personal-trainer-apps-compared.html)
- [Best Future App Alternatives in 2026 — Trainwell](https://www.trainwell.net/blog/best-future-app-alternatives-in-2026-apps-with-real-human-coaches)
- [WhatsApp Business API Onboarding Guide 2025 — WAPilot](https://wapilot.io/whatsapp-api-onboarding-guide)
- [Best WhatsApp API providers for business in 2026 — Infobip](https://www.infobip.com/blog/best-whatsapp-api)
