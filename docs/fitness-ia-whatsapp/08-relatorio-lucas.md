# Relatório — Lucas Monteiro (Senior Product Manager / Head de Produto)

**Data:** 2026-07-22
**Revisão 2:** 2026-08-31 — **Sistema de Acompanhamento** (check-in diário, proatividade da IA, reconhecimento/consistência, métricas de adesão, custo de mensagem pós-01/10/2026)
**Ideia analisada:** MOVIVO — AI Coach de treino no WhatsApp
**Pasta do projeto:** docs/fitness-ia-whatsapp/
**Status do pipeline:** Fases 1–4 concluídas. **Fase 5 (Desenvolvimento) em curso** — Sprints 0–9 entregues. Esta revisão especifica produto sobre código que já existe.

---

## Nota de Revisão 2 (2026-08-31)

Esta revisão responde a uma pergunta do fundador que redefine o eixo do produto:

> **A MOVIVO vende acompanhamento, não protocolo.** O protocolo é o artefato; o produto é acompanhar, motivar, ensinar, adaptar e sustentar adesão.

A versão original deste relatório tratava acompanhamento como **um evento semanal**. Isso estava incompleto: um único ponto de contato por semana não é acompanhamento, é uma pesquisa recorrente. A Revisão 2 especifica o **Sistema de Acompanhamento** completo — diário, semanal e proativo — e revisa três posições anteriores.

**O que mudou nesta revisão:**

| # | Tema | Posição anterior | Posição revisada |
|---|---|---|---|
| 1 | Check-in diário | Inexistente na spec (só semanal) | **Especificado como P0.** Já existe código (US-8.1); a spec fecha 4 lacunas reais (§A.2) |
| 2 | Proatividade da IA | Ad hoc, mencionada em 3 lugares sem regra | **Motor de gatilhos com orçamento fechado** — 1 slot discricionário/semana (§B) |
| 3 | Gamificação | "Fora do MVP — é uma aposta" | **Revisada com justificativa forte** (Clóvis 22). Tier 0 entra como P0; `🔥 Sequência` de treinos cumpridos e 6 marcos entram como P1; streak por dia corrido, badges e ranking seguem **vetados** (§C) |
| 3b | Streak como gate de progressão | Não existia | **Conflito arbitrado** entre Sofia §11.9(d) e Clóvis §4.4, pelo **princípio da assimetria de segurança** (§C.3-bis) |
| 4 | Comunidade | Não avaliada | **Fora do perímetro do WhatsApp**, por LGPD e custo. Norma social **agregada e anônima** é o substituto viável (§C.4) |
| 5 | Métricas de adesão | 1 KPI ("mensagens/semana") | **Camada 3.A completa** — 11 KPIs de adesão, consistência, calibração e custo (§D) |
| 6 | Custo de mensagem | Premissa de janela de 24h gratuita | **Premissa morta em 01/10/2026.** Cadência redesenhada sob orçamento; escalada formal para Eduardo (§E) |
| 7 | Metas do Épico 6 | D30 ≥ 80% / D90 ≥ 60% | Mantidas como *piso*, com o gap para o unit economics explicitado (§D.4) |

**Insumos que esta revisão consome e não contradiz:** `22-relatorio-clovis-retencao-gamificacao.md` (evidência sobre gamificação e as 6 recomendações dirigidas a mim), `09-relatorio-sofia.md` §11.5 (check-in semanal), `25-sofia-ux-conversacional.md` §8.6–8.7 (reescrita do check-in e do fluxo de aluno sumido), `12-relatorio-victor.md` (memória e validação), e o código vigente de `apps/api/src/modules/workout/` e `.../checkin/`.

---

## Resumo executivo

A jornada funcional proposta é sólida em sua lógica sequencial, mas apresenta **quatro gaps críticos** que, se não endereçados antes do lançamento, elevarão o churn e destruirão o LTV: (1) ausência de um "aha moment" explícito nos primeiros 3 dias do trial; (2) formulário de anamnese monolítico com risco alto de abandono; (3) falta de mecanismo de reengajamento entre check-ins semanais; e (4) ausência de uma experiência de offboarding que converta cancelamentos em pausas.

A abordagem de **IA sobre motor determinístico** é a escolha técnica de produto mais acertada para o estágio atual — reduz risco de alucinação, garante auditabilidade regulatória (CREF/LGPD) e permite escalar sem depender de modelos cada vez mais caros. A North Star Metric recomendada é **"Treinos Concluídos por Usuário Pago nos Primeiros 30 Dias"** (target: ≥ 8 treinos), pois é o preditor mais forte de retenção a 90 dias em plataformas de fitness.

O MVP deve ser deliberadamente pequeno: landing page + formulário + protocolo gerado + conversa WhatsApp + check-in semanal. Tudo o mais é Fase 2. Com 3 devs co-fundadores e canal orgânico do Cahuã, o risco de over-engineering é maior do que o risco de under-delivery.

**Adendo da Revisão 2.** O que faz a MOVIVO valer R$39/mês não é o protocolo — protocolo é commodity que qualquer LLM gera de graça. É o **loop de acompanhamento**: o sistema pergunta, o aluno responde, o protocolo muda, e o aluno *vê* que mudou. O check-in diário é o que fecha esse loop com resolução suficiente para que o motor determinístico ajuste com base em fato, não em memória retrospectiva de sete dias. Três decisões estruturam essa revisão: **(1)** a adesão passa a ser medida no dia, num toque, e o check-in semanal deixa de *perguntar* quantos treinos houve e passa a *reportar* — porque o sistema já sabe, e perguntar o que já se sabe é a prova de que ninguém está olhando; **(2)** a proatividade da IA ganha um **orçamento fechado** — um único contato discricionário por semana, disputado por gatilhos priorizados — o que torna "virar chata" estruturalmente impossível em vez de depender de bom senso do prompt; **(3)** a regra invertida que separa acompanhamento de assédio: **silêncio do aluno reduz a frequência de contato, nunca a aumenta.** A maioria dos produtos faz exatamente o contrário, e é por isso que são bloqueados.

O contexto econômico mudou e força a mão: **a partir de 01/10/2026 a Meta cobra por mensagem de serviço dentro da janela de 24h.** A premissa de "conversa iniciada pelo usuário é grátis", que atravessa os relatórios de Eduardo, Clóvis, Helena e Rafael, morre nessa data. Só a cadência de acompanhamento aqui especificada consome ~50 mensagens/usuário/mês — entre **5% e 37% do ticket de R$39**, dependendo inteiramente de a MOVIVO estar na tarifa direta da Meta ou no markup do BSP. Isso não é um detalhe de FinOps: é uma restrição de desenho de produto, e foi ela que definiu cada limite de cadência desta revisão (§E).

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

### Etapa 9 — Ciclo de Acompanhamento (diário + semanal + proativo)

> **Revisão 2:** esta etapa era "Check-in Semanal". Foi promovida a **ciclo**, porque um ponto de contato semanal não é acompanhamento. A análise abaixo (semanal) permanece válida e integralmente aplicável; o desenho completo do ciclo — diário, rollup e proatividade — está em **§A, §B e §C**, logo após a Etapa 10.

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

# §A — Check-in Diário (Revisão 2)

> **Nota de convergência (2026-08-31).** Sofia revisou `09-relatorio-sofia.md` §11.5–11.9 **em paralelo a esta revisão**, cobrindo o mesmo território a partir do mesmo pedido do fundador. Comparei os dois desenhos linha a linha. Onde ela chegou mais longe — botões do diário, amostragem de RPE, regras de supressão, escada de reengajamento de 4 degraus, norma social — **adoto o desenho dela e revisei o meu**, com as diferenças marcadas abaixo. Onde eu adiciono algo que ela não cobre — lacunas do código (§A.2), orçamento com gatilhos priorizados (§B.3), o teste de cobrança vs. assédio (§B.4), a camada de métricas (§D) e a modelagem de custo (§E) — o texto é meu. **Há um conflito real de segurança entre o §11.9(d) dela e a restrição de Clóvis, e eu o decido em §C.5.** Este documento é a fonte de verdade de *escopo e prioridade*; o dela é a fonte de verdade de *forma e copy*.

## A.1 Propósito — por que o semanal não basta

O check-in semanal, sozinho, tem três falhas que nenhuma melhoria de copy resolve:

1. **Viés de recall.** Perguntar na segunda-feira "quantos treinos você fez?" é pedir um relatório de memória sobre sete dias. A literatura de auto-relato retrospectivo é consistente: o erro é grande e **enviesado para cima**. Esse número alimenta o ajuste de carga do Motor Determinístico — ou seja, o erro não fica na métrica, ele **entra na periodização**.
2. **Resolução temporal errada.** Uma queda de adesão que começa na terça só se torna visível seis dias depois, quando já virou hábito de não treinar. O acompanhamento chega depois do fato que deveria prevenir.
3. **Ausência de presença.** Do ponto de vista do aluno, um contato por semana é um boletim. É a diferença exata entre "eu tenho um serviço" e "eu tenho um treinador".

O check-in diário resolve os três **ao custo de um toque**. E há um efeito colateral valioso: ele é, isoladamente, o que torna a North Star Metric (Treinos Concluídos em 30 dias) uma **medição** em vez de uma estimativa. A justificativa original da NSM neste relatório dizia "mensurável sem wearable — via auto-reporte no check-in semanal". Isso era o melhor disponível na época; não é mais.

**Ressalva honesta, herdada de Clóvis (`22-…`, §4.4):** o dado continua sendo auto-reportado e, portanto, falsificável. A mitigação não é técnica, é de incentivo — **nada no produto pode recompensar o aluno por reportar que treinou** (§C.3). Enquanto o report não custar nem render nada, mentir não tem função, e o dado se mantém honesto.

## A.2 Estado atual do código e as quatro lacunas

O check-in diário **já existe** (`apps/api/src/modules/workout/`, US-8.1). O que segue não é um pedido de construção do zero — é a spec de produto que faltou e as quatro lacunas a fechar.

| | O que existe hoje | Lacuna | Prioridade |
|---|---|---|---|
| **L1** | `workout-schedule.ts` deriva os dias de treino de um **mapa fixo por frequência** (`3 → seg/qua/sex`) | O aluno que declarou ter/qui/sáb é cobrado seg/qua/sex. O schema **já tem** `ProtocolSession.weekday` e a anamnese **já coleta** `preferredDays` — o scheduler simplesmente não os lê. É o pior tipo de bug para um produto de acompanhamento: **prova que ninguém está olhando** | **P0 — bug de credibilidade** |
| **L2** | Dois botões: `[Treinei ✅] [Hoje não]` | Captura adesão binária e joga fora o sinal de carga. A coluna `workout_completions.perceived_effort` (Borg CR10) existe e **nunca é preenchida** por este fluxo | **P0** |
| **L3** | Disparo às **20h fixas** para todo aluno (`SCAN_CRON = '0 20 * * *'`) | Ignora o horário de treino declarado. O próprio código registra isso como pendência consciente | **P1** |
| **L4** | Envia em **todo** dia de treino, indefinidamente, sem considerar resposta | Sem suspensão por não-resposta: paga mensagem e queima *quality rating* em quem já parou de responder | **P0 — custo + risco de bloqueio** |

## A.3 Cadência

- **Dispara apenas em dias de treino previstos pelo protocolo.** Nunca em dia de descanso. Isso não é economia de mensagem: descanso e deload **são parte do protocolo**, e um produto assinado por profissional CREF não pode tratar o dia de descanso como dia de cobrança (Clóvis §4.2).
- **Teto de 5 disparos diários por semana**, mesmo para alunos de 6–7×/semana. Acima disso, o acompanhamento vira ruído e o custo escala linearmente sem ganho de sinal.
- **Horário: horário de treino declarado + 2h**, limitado à janela 12:00–21:30 (America/Sao_Paulo). Fallback 20h quando não houver horário declarado. Isso exige capturar o horário na anamnese — o que é exatamente a **implementation intention** de Clóvis (H1, d ≈ 0,31): a mesma pergunta serve à evidência comportamental e ao agendamento. **Um item, dois retornos.**
- **Nunca duas mensagens proativas no mesmo dia**, contando o diário, o semanal e qualquer gatilho de §B. Invariante do sistema, não regra de prompt.

## A.4 O que pergunta — uma pergunta, três respostas, um toque

O WhatsApp permite no máximo 3 botões. **Adoto o desenho de Sofia (`09-…` §11.6)**, que resolve melhor o eixo de adesão do que a minha proposta inicial:

```
21:30 · terça (dia de Treino B no protocolo)
MOVI: E aí, Bruno — hoje era Treino B (costas e bíceps). Rolou?
      [ ✅ Fechei ]   [ 🕗 Ainda vou ]   [ 🚫 Hoje não ]
```

| Toque | Grava | Efeito |
|---|---|---|
| `✅ Fechei` | `DONE` | Ack curto. Encerra em um toque na maioria dos dias |
| `🕗 Ainda vou` | nada ainda | Ack e **silêncio deliberado**. O toque do dia foi gasto — nenhuma cobrança posterior no mesmo dia. Se não voltar, o dia entra como `SEM_REGISTRO`, **nunca como falha** |
| `🚫 Hoje não` | `SKIP` | Uma pergunta de causa, e **cada causa tem uma ação concreta** (versão de 20 min, treino mínimo, `RECOVERY` com redistribuição de volume) |

**Onde eu revisei minha própria proposta, e por quê:**

**1. Abandono a conflação "Treinei, foi puxado" num único botão.** Eu havia proposto usar o terceiro slot para capturar carga junto com adesão, economizando uma mensagem. Sofia resolveu melhor: o RPE não é diário, é **amostrado por regra** — no primeiro treino de um bloco novo, uma vez por semana no treino mais pesado, e sempre que o aluno retoma após uma quebra. Isso (a) preserva `🕗 Ainda vou`, que é um estado real que minha versão perdia, (b) custa ~1 mensagem/semana em vez das ~4 que eu supus, e (c) coleta o RPE **quando ele tem consequência no motor**, que é a única hora em que ele vale a mensagem. Minha versão era mais barata em teoria e pior em dado.

**2. Reverto minha regra de "nenhuma pergunta no `Não rolou`".** Eu argumentei que perguntar a causa a cada falta é cobrança. Estava errado sobre este caso específico: o que torna a pergunta cobrança não é existir, é **não levar a nada**. No desenho de Sofia cada resposta de causa dispara uma ação real do motor — versão curta, treino mínimo, redistribuição de volume. Isso não é interrogatório, é atendimento, e é o momento de maior alavancagem de retenção do produto (a segunda falta consecutiva é o evento que prediz o abandono). **A pergunta fica.** Minha objeção original permanece válida apenas na forma degradada: se a causa não gerar ação, ela vira cobrança e deve ser removida.

**3. Mantenho: o diário nunca pergunta sobre dor.** Perguntar "sentiu dor?" todo dia de treino é (a) nocebo — induz o relato que procura; (b) coleta diária de dado sensível sob LGPD Art. 11, com retenção e cifra correspondentes, para rendimento baixíssimo; (c) mais uma mensagem paga. Dor entra por **iniciativa do aluno**, pela triagem de três níveis de Sofia (`25-…` §8.3), que é instrumento melhor que um botão. A escalada existe pela via do RPE `🔴 puxado` repetido e pela causa `corpo pedindo pausa`, que Sofia já roteia para handoff CREF quando há menção articular.

**4. `perceived_effort` continua sendo a lacuna L2**, agora preenchida pela amostragem de Sofia em vez de pela conflação de botão. A coluna existe, a validação 1–10 existe, e nada escreve nela.

## A.5 Rollup semanal — o diário paga o semanal

Esta é a mudança de maior impacto percebido da revisão, e ela **não custa nada**: se o sistema tem o dado diário, o check-in semanal **não pode continuar perguntando quantos treinos houve**. Sofia já havia diagnosticado exatamente isso (`25-…` §8.6, problema *f*: *"não usa nenhum dado do aluno, embora o sistema saiba quantos treinos ele fez"*).

**O check-in semanal deixa de coletar adesão e passa a devolvê-la.** A pergunta liberada é reinvestida no que o diário não consegue saber.

| | Antes (Sofia §8.6 / código atual) | Depois (Revisão 2) |
|---|---|---|
| Abertura | Fato genérico ou nenhum | **Rollup factual do diário** — auto-monitoramento explícito (Clóvis H2) |
| Q1 | "Como o treino tá pesando?" | **Corpo e recuperação** — `[Bem] [Cansado] [Algo incomodando]` |
| Q2 | "Quantos treinos rolaram?" | **Ajuste desejado** — `[Mais leve] [Manter] [Mais desafio]` (autonomia/SDT, Clóvis H4/H5) |
| Q3 | "O que quer pra semana?" | **Condicional — só quando a adesão caiu:** `[Semana corrida] [O treino não encaixou] [Outra coisa]` |
| Fechamento | Recibo de protocolo | Loop visível, com autoria do ajuste atribuída ao profissional CREF |

**Por que Q1 muda de "carga" para "corpo":** a carga já foi respondida três vezes na semana, no dia em que aconteceu. Perguntar de novo é redundância; perguntar sobre sono, cansaço e incômodo é o dado que **nenhum toque diário captura** e que o Motor Determinístico precisa para decidir entre progredir e segurar.

**Por que Q3 é condicional:** numa boa semana o check-in tem 2 perguntas — mais curto, mais respondido, mais barato. Numa semana ruim, a terceira pergunta é o instrumento de **diagnóstico de causa de churn** que Clóvis classificou como o item mais importante e mais barato do relatório dele (H6). A diferença crítica em relação à proposta original: H6 capturava a causa **no cancelamento**; aqui ela é capturada **semanas antes**, enquanto ainda dá para agir. Pesquisa de saída informa o próximo trimestre; isto salva o aluno atual.

**Exemplo — semana boa:**
```
Segunda, 08:40 —
MOVI: Semana 3 fechada: 3 de 3 treinos. Terceira semana
      seguida completa.
      ---
      Duas perguntas rápidas. Como o corpo tá respondendo?
      [ Bem ]  [ Cansado ]  [ Algo incomodando ]
```

**Exemplo — semana em queda (Q3 entra):**
```
Segunda, 08:40 —
MOVI: Semana 3: 1 de 3 treinos. As duas anteriores tinham
      fechado completas.
      ---
      Sem cobrança — só quero acertar a semana 4. O que
      pegou?
      [ Semana corrida ]  [ O treino não encaixou ]  [ Outra coisa ]
```

Repare que na semana ruim **Q3 vem primeiro**: quando a adesão caiu, a causa é a informação mais valiosa do check-in, e é ela que decide o ajuste. Numa semana boa, a causa não existe e a pergunta não é feita.

**Regra de precedência do dado (já implementada corretamente):** `workout_completions.source` resolve colisão por ordinal — `WHATSAPP_QUICK_REPLY < CHECKIN < CONVERSATION`. Se o aluno diz na conversa "fiz o treino de ontem", isso **sobrescreve** o toque no botão. Correto: a conversa é a fonte mais rica e mais recente.

## A.6 Anti-fadiga — as regras que impedem o diário de virar spam

Sem estas regras, um check-in diário é um gerador de bloqueios. Duas âncoras externas justificam os números:

- **Decaimento de resposta.** Estudos de *ecological momentary assessment* mostram queda de **86,9% (semanas 1–2) para 76,3% (semanas 3–4)**. Em contrapartida, protocolos de longa duração com baixo custo por resposta mostram adesão **estabilizando em ~71% ao longo de 17 semanas** — ou seja, o decaimento não é inevitável, ele é **função do esforço pedido**. Um toque é o menor esforço possível; é por isso que o desenho de §A.4 é um toque e não um formulário.
- **Bloqueio e *quality rating*.** Taxa de bloqueio de **~0,5% já derruba** o *quality rating* do número; **acima de 2% aciona rebaixamento de tier**. Com a conta já limitada a `TIER_250` por verificação de CNPJ, um rebaixamento é um incidente de operação, não um detalhe.

**Regras (invariantes de sistema, testáveis).** As quatro regras de supressão são de Sofia (`09-…` §11.5) e são melhores que as minhas — em especial AF1 e AF2, que eu não tinha: elas suprimem a mensagem **antes de sair**, o que é simultaneamente UX e economia. AF5–AF7 são minhas.

| # | Regra | Origem | Racional |
|---|---|---|---|
| **AF1** | **Já reportou espontaneamente → o diário do dia não sai.** Se o aluno mandou "fiz o treino" às 19h, o check-in das 21h30 é cancelado | Sofia | **A regra mais importante do sistema: o aluno engajado é o que menos deve ser interrompido** |
| **AF2** | **Conversa ativa nas últimas 4h → proativo do dia suprimido**; a pergunta é enxertada na conversa que já existe | Sofia | Evita o absurdo de mandar template para quem está falando com você |
| **AF3** | **2 diários seguidos sem resposta → o diário se desliga por 7 dias, e MOVI avisa que se desligou** (*"vou parar de te cutucar todo dia — te chamo na segunda"*) | Sofia | Transforma silêncio em sinal respeitado, não em escalada. **Adoto o limite dela (2) sobre o meu (3)** — mais conservador e mais barato |
| **AF4** | Nenhuma proativa entre **22:00 e 07:00** | Sofia | Higiene de canal |
| **AF5** | **Silêncio reduz a frequência; nunca a aumenta.** Escada de 4 degraus (§B.3/T4) terminando em **silêncio definitivo** | Lucas | É a regra que separa acompanhamento de assédio (§B.4). Sofia escreveu *"última que eu te chamo, prometo"* — **o produto cumpre isso por invariante, não por boa intenção** |
| **AF6** | Controle conversacional, sem painel: *"me chama todo dia"* / *"só na segunda"* / *"me deixa quieto"*, ofertado no dia 1 junto da negociação de horário | Sofia | **Opt-out é reversível; bloqueio não é.** Dar a saída honesta é o que evita a saída definitiva |
| **AF7** | Nenhuma mensagem do ciclo referencia falta acumulada, sequência quebrada ou decepção | Lucas | Guardrail de marca e clínico. Custo zero, e é onde produtos parecidos falham |

**Reativação:** qualquer mensagem do aluno ou qualquer treino registrado zera os contadores. O aluno nunca precisa pedir para voltar — mas, tendo pedido silêncio explicitamente (AF6), o silêncio é permanente até que ele mesmo o desfaça.

---

# §B — Proatividade da IA além do agendado (Revisão 2)

## B.1 O problema de desenho

"A IA deve puxar conversa quando fizer sentido" é uma frase que, sem estrutura, produz um de dois resultados: ninguém implementa, ou implementa-se um gatilho por vez até o produto virar uma central de notificações. Ambos já foram observados em produtos do segmento.

A solução não é uma lista de gatilhos. É um **orçamento**, com gatilhos competindo por ele.

## B.2 Orçamento proativo — o mecanismo central

**Cada aluno tem, por semana** (teto alinhado ao orçamento de atenção de Sofia, `09-…` §11.5 — adoto o número dela, **6**, mais apertado que os 7 que eu havia proposto):

| Faixa | Volume | Natureza |
|---|---|---|
| Check-in diário | ≤ 4 (só em dias de treino, sujeito a AF1–AF3) | Agendado, previsível |
| Check-in semanal | 1 (abertura) | Agendado, previsível |
| **Slot discricionário** | **1** | **Todos os gatilhos abaixo competem por este único slot** |

**Teto absoluto: 6 mensagens proativas/aluno/semana, e nunca mais de uma por dia** (somando todas as camadas). Em dia sem treino agendado: **silêncio total**, exceto o semanal.

> **Parâmetro de runtime, não constante de código.** Sofia levantou o ponto e ele é correto: com a tarifa da Meta ainda não publicada (§E.1), o número de proativos/semana precisa ser ajustável sem deploy. Registro como requisito para Leonardo.

O slot discricionário único é o coração do desenho. Ele torna "a IA virar chata" **estruturalmente impossível**, em vez de uma questão de calibragem de prompt: não existe cadência de assédio que caiba em uma mensagem por semana. E dá um custo marginal previsível e modelável — o que Eduardo precisa (§E).

## B.3 Gatilhos, em ordem de prioridade

Quando mais de um gatilho arma na mesma semana, **vence o de menor número** e os demais são descartados (não enfileirados — enfileirar é como se acumula spam).

| # | Gatilho | Condição de disparo | Conteúdo | Guardrail |
|---|---|---|---|---|
| **T1** | **Sinal de carga/segurança** | `"foi puxado"` 2× na mesma semana, **ou** relato de desconforto encerrado sem desfecho | Pergunta de triagem; rota para o profissional CREF se persistir | Único gatilho que pode **exceder** o orçamento — segurança não disputa slot |
| **T2** | **Ativação em risco (trial)** | Dia 5 do trial sem primeiro treino registrado | Oferta do treino mais curto do protocolo, hoje | Só durante o trial; máx. 1× por aluno |
| **T3** | **Queda de adesão** | Adesão da semana < 50% do prescrito, tendo sido ≥ 75% na anterior | Sem culpa; oferta de **versão reduzida** da semana | Nunca cita o número de faltas |
| **T4** | **Silêncio prolongado** | Escada de 4 degraus de Sofia (`09-…` Gap 3): **①** treino perdido (dia seguinte, 1×/semana, "nunca duas seguidas") · **②** 4–5 dias sem interação · **③** 10–14 dias (win-back + pausa honesta) · **④** 21 dias — **última, e para** | Cada degrau oferece um degrau **menor**, nunca o plano antigo | Sujeito a AF5. **Adoto os limiares de Sofia sobre os meus (7/14/21)** — o degrau ① dela cobre o evento que realmente prediz churn: a segunda falta consecutiva |
| **T5** | **Retomada** | Volta após pausa ou após reativação | Protocolo de reinício, volume reduzido | Reinício, nunca "recuperar o atraso" |
| **T6** | **Marco de competência** | Progressão objetiva de carga/volume observada no histórico | Reconhecimento factual (§C.2) | Nunca implica resultado estético ou garantido |

**Sobre T1 exceder o orçamento:** é a única exceção, e é deliberada. Um produto supervisionado por profissional CREF não pode deixar um sinal de sobrecarga esperar a vez atrás de uma mensagem de reconhecimento. Segurança não tem orçamento.

**Sobre T6 ser o de menor prioridade:** reconhecimento é a mensagem mais agradável de escrever e a menos urgente de enviar. Ela só sai numa semana em que nada mais precisou do slot — o que, não por acaso, é exatamente a semana em que o aluno está indo bem e a mensagem faz sentido.

## B.4 Cobrança vs. assédio — o critério operacional

O fundador pediu essa distinção. Ela não pode ser uma questão de tom, porque tom não é testável. É um teste de quatro condições — **uma mensagem proativa só pode sair se satisfizer todas**:

1. **Carrega informação nova que o sistema tem e o aluno não** — um dado dele, uma mudança no protocolo, uma observação factual. *Uma mensagem que só pede algo, sem dar nada, é cobrança por definição.*
2. **Oferece uma saída de menor esforço**, não apenas a ideal — a versão de 20 minutos, pular a semana, pausar a assinatura.
3. **Não referencia falha acumulada** — nada de "3 dias sem treinar", "você quebrou a sequência", "que pena".
4. **É respondível em um toque, e não responder não gera consequência visível.**

**É assédio quando:** repete um pedido já não-respondido, ou **aumenta a frequência em resposta ao silêncio**.

> **A regra invertida (o núcleo de tudo isto):** na MOVIVO, **silêncio do aluno reduz a frequência de contato.** Praticamente todo produto de engajamento faz o contrário — o usuário para de responder e o sistema insiste mais. É assim que se ganha um bloqueio, que é irreversível, em vez de um opt-out, que não é.

Essas quatro condições são **verificáveis automaticamente** e devem entrar nas checagens determinísticas de Mariana, junto das 12 de Sofia (`25-…` §11.2): condição 3 é uma lista de termos proibidos; condição 4 é presença de botões; condição 1 é presença de pelo menos um fato do estado do aluno na mensagem — que o sistema já sabe distinguir via `numericFacts`.

---

# §C — Reconhecimento, consistência e comunidade (revisão de posição)

## C.1 Revisão explícita da posição anterior

A versão original deste relatório colocou *"Gamificação (streaks, badges, rankings)"* fora do MVP com a justificativa: *"Pode aumentar retenção, mas é uma aposta. Validar retenção orgânica primeiro."*

**Mantenho a decisão e substituo a justificativa**, conforme Clóvis pediu explicitamente (`22-…`, recomendação 1). "É uma aposta" era um julgamento sem lastro; hoje há lastro, e ele é mais forte do que o palpite original:

1. A meta-análise mais robusta disponível (eClinicalMedicine/Lancet, 2024 — 36 RCTs, 10.079 participantes) mede efeito de **+489 passos/dia**, classificado **pelos próprios autores** como trivial, e **nenhum efeito significativo** sobre atividade física moderada-a-vigorosa — que é a categoria em que musculação se enquadra.
2. **Não existe evidência controlada** de gamificação em canal 100% textual sem tela. Toda a literatura pressupõe app + wearable, com a métrica premiada **medida por dispositivo**, não auto-reportada.
3. **Streak diário é clinicamente contraindicado** em musculação: descanso e deload são parte do protocolo, e um contador que quebra no dia de descanso ensina que descansar é fracasso.
4. **Custo de canal:** um streak diário custaria ~R$1,80/aluno/mês só em nudges — mais do que todo o custo de LLM do produto (~R$1), e piora em 01/10/2026.
5. **Gamificar auto-report corrompe o Motor Determinístico**: recompensar a afirmação "treinei" cria incentivo para inflá-la, e essa afirmação é o input que progride a carga. Vira risco de segurança, não de vaidade.

**Onde eu mudo de posição de fato:** eu tratava o assunto como um bloco binário a ser adiado. Estava errado nisso. Dentro do rótulo "gamificação" há mecanismos com perfis de custo, evidência e risco radicalmente diferentes, e **parte deles entra agora, no MVP, com custo marginal zero** — porque não são features, são decisões de copy e de fluxo dentro de mensagens que já vão ser enviadas de qualquer forma.

## C.2 Escopo mínimo viável de reconhecimento — a recomendação

O objetivo do fundador é entregar **"a sensação de acompanhamento sério"** sem over-engineering. Esse é o critério certo, e ele é atendido por três coisas — nenhuma delas é um sistema de pontos.

### P0 — Tier 0 de Clóvis: custo zero, dentro de mensagens já existentes

Nenhum destes itens adiciona uma única mensagem ao produto. Todos entram como **critérios de aceite dos Épicos 2, 4 e 6 já aprovados**, não como épicos novos — e portanto **não atrasam o MVP**.

| # | Item | Onde | Evidência |
|---|---|---|---|
| **H1** | **Implementation intention** na anamnese: dias, **horário** e local de treino | Épico 2, último bloco | d ≈ 0,24–0,31. **Também é o insumo do horário de disparo do diário (§A.3)** |
| **H2** | **Rollup factual de auto-monitoramento** na abertura do check-in semanal | Épico 6 | Self-monitoring é o BCT com melhor evidência em atividade física |
| **H3** | **Toque humano visível e datado** do profissional CREF | Épicos 4 e 6 | Coaching humano: 70–74% de conclusão vs. 15–18% de retenção D30 de apps |
| **H4** | **Escolha real** na substituição de exercício (duas opções válidas, não uma decisão imposta) | Épico 4 | SDT/autonomia, g ≈ 0,23–0,29 |
| **H5** | **Revisão de meta** no check-in | Épico 6 | Goal setting é o BCT mais consistentemente associado a mudança de comportamento |
| **H6** | **Diagnóstico de causa de churn** — Q3 condicional (§A.5) + pergunta única no cancelamento | Épico 6 + offboarding | Pré-requisito de qualquer investimento futuro em retenção |

**H3 merece destaque como decisão de produto, não só de copy.** Clóvis identificou que o ativo de retenção com melhor evidência da MOVIVO **já está pago e subutilizado**: o profissional CREF existe hoje por obrigação regulatória. Torná-lo perceptível converte custo de compliance em ativo de retenção sem gasto incremental. A spec mínima:

- **Cadência real:** o profissional revisa e assina o ajuste de protocolo semanal (o dashboard de operações já suporta isso). A revisão é um **evento datado no banco**, não uma afirmação de copy.
- **Comunicação:** o fechamento do check-in atribui a autoria do ajuste ao profissional, nomeado, com data. *"Anotado. Levo isso pro Diego montar a semana 4 — ele que decide o ajuste."*
- **Limite inegociável:** a IA **nunca assina como o profissional** nem sugere que é ele quem está digitando. Atribui-se a **autoria da decisão** — que é a verdade contratual e regulatória — e marca-se a revisão como evento real. Simular presença humana seria violação de guardrail de marca e risco jurídico direto.

### P1 leve — entra no MVP, dentro do orçamento de mensagens já definido

| Item | Desenho | Guardrails |
|---|---|---|
| **Sequência** (`🔥` de Sofia) | Conta **treinos agendados cumpridos**, não dias corridos. Duas métricas: `🔥 Sequência` (no diário, quando é notícia) e `✅ Semana cheia` (no recap) | **Descanso prescrito não quebra. `SEM_REGISTRO` não quebra.** Escudo automático 1×/mês, gratuito, comunicado depois do fato. Na quebra, a âncora é o recorde, nunca o zero. **Nunca usada como ameaça** ("sua sequência acaba em 3h") — é dark pattern, proibido por Alexandre. **E nunca destrava progressão de carga sozinha** (§C.3-bis) |
| **Marcos de competência** | Seis marcos no MVP (Sofia §11.8b), entregues como **uma linha** dentro de mensagem existente. Incluem `💪 Progrediu` (carga/reps) e `🫱 Voltei` (retomada após 7+ dias) | Competência (SDT), não badge. **`🫱 Voltei` é o mais importante** — é o antídoto da gamificação convencional, que só premia perfeição e por isso abandona quem mais precisa. Nunca implica resultado estético ou garantido |
| **Regra estrutural** | **A gamificação nunca gera mensagem própria** (Sofia §11.8) | Todo marco, streak ou recap pega carona em mensagem que já ia sair. Uma mensagem cujo único conteúdo é "parabéns" é ruído pago — e é exatamente o que produz opt-out. **Esta regra é o que torna o P1 compatível com o orçamento de §B.2** |

**Por que a sequência semanal é segura onde a diária é vetada:** ela conta semanas em que o **protocolo foi cumprido** — e o protocolo inclui os dias de descanso. Descansar quando está prescrito *mantém* a sequência. É o oposto exato do incentivo perverso do streak diário.

**Por que "a quebra não é comunicada" é a regra mais importante da tabela:** o dano documentado do streak não está em ganhá-lo, está em perdê-lo — o *abstinence violation effect* faz o usuário abandonar o hábito junto com o contador, num evento único e abrupto. Um reconhecimento que só aparece quando é positivo captura o lado bom e não constrói a bomba.

### Continua fora — vetado ou Fase 2

| Mecânica | Veredito |
|---|---|
| Streak **por dia corrido** | **Vetado.** Puniria o dia de descanso, que é parte prescrita do protocolo, empurrando o aluno a treinar em recuperação — contradiz o método CREF e cria risco de saúde. **Não confundir com a `🔥 Sequência` aprovada** (§C.2 P1), que conta *treinos agendados cumpridos* e cujo descanso não quebra |
| Streak como **gatilho de progressão de carga** | **Vetado** (§C.3-bis). Sequência auto-reportada não pode, sozinha, aumentar carga, volume ou frequência — só reduzir |
| Badges, pontos, níveis | **Fase 2.** Efeito trivial; risco de sobrejustificação num ICP que já quer treinar; custo recorrente de copy e compliance |
| Ranking / leaderboard público | **Vetado no formato público.** Expõe dado sensível de saúde entre titulares (LGPD Art. 11); desmotiva a maioria; incompatível com selo CREF |
| Streak freeze pago | **Vetado.** Colide com o plano único de Eduardo e monetiza ansiedade sob selo CREF |
| Recompensa condicionada a treino auto-reportado | **Vetado enquanto não houver verificação independente** (wearable, Fase 2). **Restrição de arquitetura de produto, não preferência** — ver C.3 |

## C.3 A restrição que precisa virar regra de código

> **Nenhuma mecânica de reconhecimento, recompensa ou progressão pode ser condicionada à conclusão de treino auto-reportada, enquanto não houver verificação independente.**

Reconhecer apenas o que o sistema **observa por si** — que o aluno respondeu, que a carga registrada subiu, que uma semana fechou — e nunca o que ele **afirma ter feito**. É a diferença entre um sistema de reconhecimento e um incentivo a mentir para o motor que decide sua carga.

## C.3-bis Adjudicação: o streak de Sofia vs. a restrição de Clóvis

Sofia (`09-…` §11.8–11.9) e Clóvis (`22-…` §4.2/§4.4) chegaram a conclusões incompatíveis sobre o mesmo mecanismo. Como PM, decido — e a decisão não é "meio-termo", é identificar **qual dos dois eixos é o perigoso**.

**Onde não há conflito (e eu confirmava conflito onde não havia):**

O que Clóvis vetou foi o **streak diário que pune o descanso**. A "🔥 Sequência" de Sofia conta **treinos agendados cumpridos** — descanso prescrito não quebra, e `SEM_REGISTRO` também não. Ela desenhou exatamente contra o vetor que Clóvis identificou, e explicitou a razão (contradiria o método CREF e criaria risco de saúde). **Aprovado.** Idem o "escudo" 1×/mês: Clóvis vetou **streak freeze pago**; o de Sofia é gratuito e automático. **Aprovado.**

**Onde há conflito real, e é de segurança, não de gosto:**

Sofia §11.9(d) propõe que **3 semanas cheias consecutivas liberem a progressão de carga/volume da próxima fase**, com a copy *"sua sequência de 3 semanas cheias destravou a próxima fase"*. Ela chama isso de "a decisão mais importante desta seção", e o raciocínio é forte: sem consequência mecânica, o streak é decoração.

Mas isso colide frontalmente com Clóvis §4.4, e a colisão é material: **a sequência é construída sobre auto-report**, e a recompensa é **aumento de carga**. Isso cria um incentivo direto e explícito para o aluno afirmar treinos que não fez, e o prêmio por mentir é o sistema progredir carga sobre treinos que não aconteceram. Deixa de ser problema de métrica e vira problema de segurança do protocolo — exatamente a transição que Clóvis chamou de "o risco mais subestimado da arquitetura da MOVIVO". E a copy ensina a lição errada de forma explícita: *"acumular 'Fechei' destrava fase"*.

**Decisão — o princípio da assimetria de segurança:**

> **Sinal auto-reportado pode SEMPRE reduzir carga, volume ou frequência. Nunca pode, sozinho, aumentá-los.**

Aplicando à tabela de Sofia §11.9(d):

| Regra de Sofia | Direção | Veredito |
|---|---|---|
| 2 relatos 🔴 puxado → reduz carga, insere deload | ↓ conservadora | **Aprovada** |
| 2 ausências no mesmo dia → versão curta naquele dia | ↓ conservadora | **Aprovada** |
| "corpo pedindo pausa" → `RECOVERY` + redistribuição | ↓ conservadora | **Aprovada** |
| Retomada após 7+ dias → reinício com carga reduzida | ↓ conservadora | **Aprovada** |
| **3 semanas cheias → libera progressão de fase** | **↑ agressiva, sobre auto-report** | **Revisada — ver abaixo** |

**Como fica a progressão:** a sequência pode ser **condição necessária, nunca suficiente nem gatilho**. A progressão continua sendo decisão do Motor Determinístico sob a metodologia assinada, corroborada pelo RPE amostrado (`🟢/🟡/🔴`, que é julgamento sobre um treino que aconteceu, não contagem de treinos alegados) e pelo julgamento do check-in semanal — e materializada numa **nova versão de protocolo com assinatura CREF**, que é o gate que já existe no schema (`protocols.signed_at`, `signature_hash`).

**E a copy muda, porque a copy é a parte perigosa.** Não *"sua sequência destravou a próxima fase"*, e sim atribuição ao revisor humano: *"o Diego olhou sua semana e liberou a próxima fase — a carga sobe na segunda."* Isso preserva integralmente o efeito que Sofia buscava (o streak tem consequência visível e a assinatura se justifica), remove o incentivo a inflar o report, e ainda **reforça H3** — o toque humano visível, que é a alavanca de retenção mais bem evidenciada do produto. Sofia consegue o que queria; Clóvis consegue o que exigia.

**Regra que precisa virar código:** nenhum caminho no motor pode ter `count(workout_completions)` como entrada de uma decisão que **aumente** carga, volume ou frequência. Registrado para Leonardo e Victor como restrição de arquitetura, não como preferência.

## C.4 Comunidade — recomendação de escopo

O fundador levantou elementos comunitários/competitivos. **Recomendação: comunidade fica fora do perímetro do WhatsApp do produto.** Três razões, em ordem de peso:

1. **LGPD.** Qualquer grupo, ranking ou desafio compartilhado expõe, entre titulares, informação sobre a prática de exercício de um indivíduo — dado sensível de saúde sob o Art. 11, exigindo base legal e consentimento próprios. Caro e desproporcional ao ganho.
2. **Custo e moderação.** Mensagem de grupo não é gratuita, e moderação de comunidade em canal de saúde é trabalho humano recorrente que a operação atual não comporta.
3. **Dano ao ativo principal.** O canal 1:1 é a proposta de valor — *"seu coach só fala com você"* é requisito de produto explícito desde a Etapa 10. Um grupo dilui exatamente isso.

**Onde a comunidade deve viver:** nos canais orgânicos do Cahuã (Camila, `18-…`) — fora do perímetro tarifado e fora do perímetro de dado sensível. Desafios, depoimentos e senso de pertencimento acontecem no Instagram/TikTok, onde já há audiência, moderação e custo marginal zero de mensagem.

**O que é viável dentro do WhatsApp — e é minha única adição própria a este bloco:** **norma social descritiva agregada e anônima.**

```
MOVI: Semana 3 fechada: 3 de 3 treinos.
      ---
      Pra você ter referência: 64% dos alunos MOVIVO
      fecharam 3 ou mais nesta semana.
```

- Não é ranking: não há posição, não há comparação nomeada, não há perdedor.
- Não é dado pessoal de terceiro: é estatística agregada. **Exigência: n ≥ 50 por coorte**, para impedir reidentificação.
- Não expõe nada sobre o aluno a ninguém.
- Cabe no check-in semanal, **sem mensagem adicional**.
- Guardrail: é um **fato**, nunca uma promessa. *"64% fecharam 3 ou mais"* é factual; *"quem treina 3× vê resultado"* seria violação direta.

**Regra de exibição — adoto a de Sofia, que é melhor que a minha.** Eu havia proposto exibir apenas quando o percentual da coorte fosse ≥ 50%. Sofia (`09-…` §11.8c) propõe o critério certo: **só exibir quando o próprio aluno está dentro ou acima da norma**. O meu critério é sobre a base; o dela é sobre a pessoa que vai ler — e é a pessoa que importa. *"7 em cada 10 treinaram 3× ou mais"* lido por quem treinou uma vez não é motivação, é vergonha. **Vale o critério de Sofia.**

**Convergência independente, que aumenta a confiança:** Sofia e eu chegamos separadamente à norma social descritiva anônima como o **único** elemento social compatível com o MVP, e ambos rejeitamos ranking pelas mesmas quatro razões (evidência de UX, contradição com o posicionamento, conflito com o isolamento de contexto, risco jurídico). Registro também os dois substitutos dela que eu não havia considerado e que aprovo: **comparação contra o próprio histórico** ("você vs. você", sempre com pelo menos um número que subiu) e **recap encaminhável** — que captura o valor social real do fitness (contar a alguém) sem criar hierarquia, e abre uma alça de referral orgânico de graça.

**Ressalva de honestidade que permanece:** norma social descritiva tem boa evidência em outros domínios, mas **não localizei evidência específica em canal conversacional de treino**. Continua sendo a única recomendação desta revisão classificada como **hipótese a testar** (§F, H10), não como decisão sustentada.

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

### Épico 6 — Ciclo de Acompanhamento e Retenção

> **Revisão 2:** épico renomeado e ampliado. Era "Check-in Semanal e Retenção"; agora cobre o ciclo diário + semanal + rollup. As user stories originais permanecem válidas; as de §A entram abaixo delas. A proatividade não-agendada saiu daqui e virou o **Épico 8**, porque tem um mecanismo próprio (orçamento) e não é um caso particular de check-in.

**Objetivo:** Manter engajamento semanal, coletar feedback e fazer ajustes no protocolo de forma que o usuário perceba evolução e permaneça assinante.

**User Stories:**
- Como usuário pago, quero receber toda segunda-feira de manhã uma mensagem do AI Coach perguntando como foi minha semana, para me sentir acompanhado.
- Como usuário que fez check-in, quero ver uma mudança concreta no meu protocolo da próxima semana baseada no meu feedback, para saber que minha resposta importou.
- Como usuário que não treinou na semana, quero receber uma mensagem sem julgamento que me ajude a identificar o que aconteceu e como retomar, para não me sentir mal e desistir.
- Como usuário avançado, quero poder pedir ajustes específicos no meu protocolo via conversa (fora do check-in semanal), para ter a flexibilidade de um coach real.
- Como usuário ausente por 2 semanas, quero receber uma mensagem de reengajamento personalizada com um protocolo simplificado de retorno, para voltar a treinar sem me sentir sobrecarregado.

**User Stories adicionais — check-in diário (Revisão 2):**
- Como aluno em dia de treino, quero receber uma pergunta única que eu respondo em **um toque**, para registrar meu treino sem que isso vire mais uma tarefa.
- Como aluno que treina às terças, quintas e sábados, quero ser perguntado **nesses dias**, e não em segunda/quarta/sexta, para não sentir que o sistema não sabe quem eu sou. *(fecha L1)*
- Como aluno que achou o treino pesado, quero conseguir dizer isso **no mesmo toque** em que registro o treino, para que o ajuste da semana considere isso sem eu ter que escrever nada. *(fecha L2)*
- Como aluno que não treinou hoje, quero registrar isso **sem ser interrogado sobre o motivo**, para não associar o produto a cobrança.
- Como aluno que parou de responder ao diário, quero que ele **pare de chegar sozinho** e volte quando eu voltar a interagir, sem eu precisar pedir. *(fecha L4)*
- Como aluno no check-in semanal, quero que a MOVIVO **me diga** quantos treinos eu fiz em vez de me perguntar, para ter a prova de que alguém está olhando. *(rollup, §A.5)*
- Como aluno cuja semana caiu, quero ser perguntado o que atrapalhou **enquanto ainda dá tempo de ajustar**, e não só quando eu for cancelar. *(H6 antecipado)*

**Critérios de aceite do Épico 6:**
- Taxa de resposta ao check-in semanal ≥ 55%.
- Taxa de retenção em 30 dias ≥ 80% dos pagantes.
- Taxa de retenção em 90 dias ≥ 60% dos pagantes.
- Taxa de reengajamento de inativos (2 semanas sem check-in) ≥ 30%.
- **(R2)** O disparo diário usa `ProtocolSession.weekday` / `preferredDays`; **zero** disparo em dia sem sessão prevista.
- **(R2)** Taxa de resposta ao check-in diário ≥ 50% nos primeiros 14 dias e ≥ 40% sustentado.
- **(R2)** Cobertura de adesão (treinos prescritos com desfecho conhecido) ≥ 75%.
- **(R2)** 100% dos check-ins semanais abrem com rollup factual derivado do diário; **nenhum** pergunta a contagem de treinos quando o dado existe.
- **(R2)** Suspensão automática do diário após 3 não-respostas consecutivas, com reativação automática por qualquer interação.
- **(R2)** Nenhuma mensagem do ciclo referencia falta acumulada ou sequência quebrada (checagem determinística, sem LLM).

### Épico 7 — Operações e Observabilidade (não-funcional, mas crítico para produto)

**User Stories:**
- Como time de produto, quero visualizar em tempo real quantos usuários estão em cada etapa do funil (formulário → protocolo enviado → primeiro treino → conversão), para identificar gargalos rapidamente.
- Como time de produto, quero ser alertado quando o SLA de entrega de protocolo estiver sendo ultrapassado, para investigar e intervir antes que usuários abandonem.
- Como profissional de Ed. Física responsável, quero ter uma dashboard com todos os protocolos gerados e flags de usuários com contraindicações no PAR-Q, para fazer revisão e assinar eletronicamente os protocolos.
- Como time de produto, quero ter acesso a replays de conversas com o AI Coach anonimizados, para identificar padrões de perguntas não respondidas bem e melhorar o sistema.

### Épico 8 — Proatividade e Orçamento de Contato (Revisão 2)

**Objetivo:** Permitir que a MOVIVO inicie contato quando há razão real, sob um orçamento fechado que torna o excesso estruturalmente impossível — e não uma questão de calibragem de prompt.

**User Stories:**
- Como aluno que marcou "foi puxado" duas vezes na semana, quero que a MOVIVO **puxe o assunto sozinha**, para eu não ter que saber que aquilo era um sinal.
- Como aluno em trial que ainda não treinou no dia 5, quero receber a versão mais curta do meu treino para hoje, para conseguir começar antes do trial acabar.
- Como aluno cuja semana desandou, quero uma mensagem que me ofereça **uma saída menor** (versão de 20 min, semana reduzida), não uma que me lembre do que eu não fiz.
- Como aluno que sumiu, quero que a MOVIVO me chame **cada vez menos**, não cada vez mais, e que pare de vez se eu não responder.
- Como aluno que evoluiu a carga, quero que isso seja notado e dito com o número real, para saber que meu progresso está sendo acompanhado de verdade.
- Como aluno que só quer ser deixado em paz, quero conseguir dizer isso em uma frase e ser atendido, sem sair do produto.

**Critérios de aceite do Épico 8:**
- **Invariante de orçamento:** ≤ 7 mensagens proativas/aluno/semana e **nunca mais de 1/dia**, contando diário, semanal e gatilhos. Violação = falha de teste, não alerta.
- **Invariante de slot:** ≤ 1 mensagem discricionária (T2–T6) por aluno por semana. Gatilhos perdedores são **descartados**, nunca enfileirados.
- **Exceção única:** T1 (segurança) pode exceder o orçamento. Nenhum outro gatilho pode.
- **Regra invertida verificável:** para todo aluno, a frequência de contato na janela N+1 é ≤ à da janela N enquanto não houver interação do aluno.
- Escada de silêncio: no máximo 3 toques (dia 7, 14, 21) por janela de inatividade, seguidos de **silêncio até iniciativa do aluno**.
- Nenhuma proativa entre 21:30 e 08:00 (America/Sao_Paulo).
- 100% das mensagens proativas passam nas **4 condições de §B.4** (carrega fato, oferece saída menor, não cita falha acumulada, respondível em um toque).
- Taxa de bloqueio/report < 0,5% da base (guardrail duro — acima de 2% há rebaixamento de tier na plataforma).
- Custo de mensagem por aluno/mês ≤ R$3,00 (teto de produto — ver §E).

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
| **Check-in diário (R2)** | Dispara só em dia de treino previsto pelo protocolo real do aluno; 1 pergunta, 3 botões (adesão + carga num toque); sem pergunta de dor; sem interrogatório na falta | **P0** |
| **Rollup diário → semanal (R2)** | Check-in semanal abre reportando a adesão em vez de perguntá-la; pergunta liberada é reinvestida em corpo/recuperação; Q3 de causa é condicional à queda | **P0** |
| **Anti-fadiga do diário (R2)** | Suspensão após 3 não-respostas, reativação automática, janela 08:00–21:30, opt-out em uma frase | **P0** |
| **Orçamento proativo + gatilhos (R2)** | ≤7 proativas/semana, 1 slot discricionário, 6 gatilhos priorizados, escada de silêncio decrescente | **P0** |
| **Tier 0 comportamental (R2)** | H1–H6 de Clóvis como critérios de aceite dos Épicos 2/4/6 — **zero mensagem nova, zero atraso de MVP** | **P0** |
| **Sequência semanal + marcos de competência (R2)** | Semanas completas (descanso conta como cumprimento, quebra não é comunicada) e progressão de carga real, dentro do check-in | **P1** |
| **Norma social agregada (R2)** | Percentual anônimo da coorte no check-in (n ≥ 50, só quando ≥ 50%) — **hipótese a validar**, não decisão firmada | **P1** |
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
| ~~Gamificação (streaks, badges, rankings)~~ **→ decomposta na Revisão 2, ver §C** | **Justificativa substituída** (Clóvis `22-…`, recomendação 1). Não é mais "uma aposta": (a) evidência de magnitude **trivial** em RCT (+489 passos/dia, Lancet 2024) e **nula** em atividade moderada-a-vigorosa, que é a categoria da musculação; (b) **nenhuma evidência** de gamificação em canal 100% textual sem tela; (c) **streak diário é clinicamente contraindicado** em musculação — descanso é protocolo, não falha; (d) custo de nudge proativo relevante e crescente pós-01/10/2026 (~R$1,80/aluno/mês, mais que todo o custo de LLM); (e) recompensar treino **auto-reportado** corrompe o input do Motor Determinístico. **Streak diário, ranking público e streak freeze pago seguem vetados; badges/pontos/níveis seguem Fase 2. Sequência semanal e marcos de competência foram promovidos a P1 (§C.2).** |
| Comunidade / grupos / desafios entre alunos | **Fora do perímetro do WhatsApp** (§C.4): expõe dado sensível de saúde entre titulares (LGPD Art. 11), mensagem de grupo é tarifada, moderação é trabalho humano recorrente, e dilui o ativo *"seu coach só fala com você"*. A comunidade vive nos canais orgânicos do Cahuã (Camila). |
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

## §D — North Star Metric e KPIs

### North Star Metric

**"Treinos Concluídos por Usuário Pago nos Primeiros 30 Dias"**

**Meta:** ≥ 8 treinos completados nos primeiros 30 dias de assinatura paga.

**Justificativa:** Dados de plataformas de fitness com IA mostram que usuários que completam mais de 3 treinos nas primeiras 2 semanas têm 3-4x menos churn. Para o ICP da MOVIVO (18-30 anos, 3-5 dias/semana de treino planejado), 8 treinos em 30 dias representa aproximadamente 2 treinos por semana — abaixo da meta do protocolo, mas acima do threshold de abandono. Essa métrica captura simultaneamente: (a) o protocolo foi executável, (b) o usuário engajou com o AI Coach, (c) o valor está sendo percebido. É mensurável sem wearable — via auto-reporte no check-in semanal + confirmações na conversa.

> **Revisão 2 — a NSM deixa de ser estimativa e vira medição.** A frase acima descrevia o melhor instrumento disponível quando este relatório foi escrito: recall de sete dias no check-in semanal. Isso mede a *lembrança* de treinos, não os treinos, com erro grande e enviesado para cima. **O check-in diário é o que torna a North Star real** — atribuição no dia, no nível da sessão, persistida em `workout_completions` com dedupe por (titular, dia, sessão) e precedência de fonte. A meta (≥ 8/30 dias) permanece; o que muda é que agora ela é auditável. Duas consequências práticas: **(1)** a série histórica anterior ao check-in diário não é comparável com a posterior — provavelmente cairá, e essa queda é **correção de medição, não regressão de produto**; marcar a data de corte nas coortes é obrigatório para não interpretar mal. **(2)** A NSM ganha uma métrica de suporte que a valida: *cobertura de adesão* (§D, C3) — uma NSM calculada sobre 40% de cobertura não significa nada.

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

#### Camada 3.A — Adesão, Consistência e Custo de Acompanhamento (Revisão 2)

Esta camada é nova. Ela existe para dar suporte simultâneo aos quatro objetivos que o fundador levantou: **incentivar**, **medir consistência**, **coletar parâmetro para readequação de protocolo** e **alimentar o reconhecimento** — e para manter o custo do canal sob controle.

**Grupo A — Adesão (a base de tudo)**

| # | KPI | Definição | Meta MVP | Serve a |
|---|---|---|---|---|
| A1 | **Taxa de adesão semanal** | treinos registrados ÷ treinos prescritos na semana | ≥ 70% | Consistência, gatilho T3 |
| A2 | **Taxa de resposta ao check-in diário** | respondidos ÷ enviados | ≥ 50% (D1–14), ≥ 40% sustentado | Saúde do instrumento |
| A3 | **Cobertura de adesão** | % de treinos prescritos com desfecho **conhecido** (DONE ou SKIP) | ≥ 75% | **Valida a NSM.** Sem isso a NSM é opinião |
| A4 | **Latência de registro** | horas entre o dia do treino e o registro | p50 ≤ 4h | Qualidade do dado (recall) |

> **Sobre a meta de A2:** ancorada em estudos de *ecological momentary assessment*, que mostram queda de 86,9% (sem. 1–2) para 76,3% (sem. 3–4) em contexto de pesquisa com participantes consentidos e incentivados. Um produto de consumo pago opera abaixo disso; 50%→40% é a leitura conservadora e deve ser **recalibrada com dado próprio após 60 dias**, não defendida como verdade.

**Grupo B — Consistência (o que o fundador chama de "garantir adesão ao estilo de vida")**

| # | KPI | Definição | Meta MVP | Serve a |
|---|---|---|---|---|
| B1 | **Semanas consecutivas na meta** | sequência semanal vigente (descanso conta como cumprimento) | mediana ≥ 3 | Reconhecimento (§C.2 P1) |
| B2 | **Índice de regularidade** | coeficiente de variação dos treinos/semana ao longo de 4 semanas | diagnóstico, sem meta | Distingue "3 treinos toda semana" de "12 numa semana e 0 em três" — comportamentos opostos com a mesma média |
| B3 | **Tempo até a primeira falha de semana** | semanas até a primeira semana abaixo da meta | ≥ 4 | Preditor precoce de churn |
| B4 | **Taxa de recuperação pós-queda** | % que volta à meta na semana seguinte a uma queda | ≥ 50% | Eficácia do gatilho T3 |

> **B2 é o KPI mais subestimado da tabela.** A NSM (8 treinos/30 dias) é uma soma, e somas escondem forma. Doze treinos concentrados numa semana e três semanas zeradas produzem uma NSM aparentemente saudável e um aluno que já foi embora. B2 é o que separa consistência de volume.

**Grupo C — Calibração do protocolo (readequação)**

| # | KPI | Definição | Faixa saudável | Serve a |
|---|---|---|---|---|
| C1 | **Taxa de sinal "foi puxado"** | % de treinos registrados marcados como pesados | **15–30%** | Fora da faixa = protocolo mal calibrado. **Abaixo de 15%: leve demais** (sem estímulo, sem resultado percebido, churn por tédio). **Acima de 30%: pesado demais** (risco de lesão e de abandono) |
| C2 | **Latência de ajuste** | dias entre um sinal (carga, corpo, causa) e mudança visível no protocolo | ≤ 7 | O loop fechado. É o que diferencia coaching de pesquisa |
| C3 | **Taxa de ajuste comunicado** | % de ajustes de protocolo que o aluno **viu** explicitamente | 100% | Um ajuste que o aluno não percebeu não gerou valor |
| C4 | **Classificação de causa de churn** | % de quedas/cancelamentos com causa classificada (motivação / valor percebido / preço / vida pessoal) | ≥ 60% | **H6 de Clóvis — gate obrigatório** para qualquer investimento em Tier 1/2 |

> **C1 é o achado de instrumentação mais útil desta revisão.** Ele transforma um botão de UX num **termômetro de calibração do Motor Determinístico**, agregável por coorte, por objetivo e por nível declarado. É a única métrica do produto que detecta "o protocolo está errado" **antes** do aluno cancelar — e ela sai de graça do desenho de §A.4.

**Grupo D — Saúde do canal e custo (guardrails duros)**

| # | KPI | Definição | Limite | Consequência de violar |
|---|---|---|---|---|
| D1 | **Mensagens proativas/aluno/semana** | contagem, todas as origens | ≤ 7 | Invariante — falha de teste |
| D2 | **Taxa de bloqueio/report** | bloqueios ÷ base | < 0,5% | > 2% = rebaixamento de tier na plataforma |
| D3 | **Taxa de silêncio induzido** | % da base com diário auto-suspenso (AF1) | ≤ 15% | Acima disso, o instrumento está errado, não o aluno |
| D4 | **Taxa de opt-out do diário** | % que pede para não receber (AF5) | ≤ 10% | Sinal de cadência mal calibrada |
| D5 | **Custo de mensagem/aluno/mês** | R$ | **≤ R$3,00** | Teto de produto. Ver §E |
| D6 | **Bolhas por turno (médio)** | mensagens emitidas ÷ turnos | ≤ 1,6 | Cada bolha é uma mensagem tarifada pós-01/10/2026 (§E.3) |

**Anti-métricas adicionais (Revisão 2) — o que NÃO otimizar:**
- **Taxa de resposta ao diário isolada.** Sobe trivialmente aumentando a frequência de disparo; o que importa é A3 (cobertura), que é resposta ponderada por prescrição.
- **Tamanho da sequência semanal.** No instante em que virar meta de time, alguém proporá recompensá-la — e recompensa sobre auto-report é exatamente o vetor vetado em §C.3.
- **Número de mensagens proativas enviadas.** É custo, não entrega.

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

### D.4 — Revisão das metas de retenção do Épico 6

Clóvis (`22-…`, recomendação 6) apontou um gap que eu não havia explicitado e que aceito integralmente:

- As metas do Épico 6 (D30 ≥ 80%, D90 ≥ 60% de pagantes) implicam **~7% de churn mensal composto**. Isso é aproximadamente a **média** do setor de assinatura fitness (~9,2%), ligeiramente melhor. São metas defensáveis, mas **não são metas de produto excepcional**.
- Para sustentar **LTV/CAC ≥ 3 com payback ≤ 3 meses** (parâmetros de Eduardo, `07-…`), o churn mensal precisa provavelmente cair para a faixa de **4–6%**.

**Decisão:** mantenho D30 ≥ 80% / D90 ≥ 60% como **piso do MVP** (é o que valida que o produto funciona), e registro **churn mensal ≤ 6% como a meta que o unit economics exige** — a ser confirmada por Eduardo e Igor com dado real. O gap entre as duas é o argumento de negócio para o Sistema de Acompanhamento desta revisão, e é um argumento melhor do que qualquer benchmark de gamificação.

---

# §E — Restrição de custo: o fim da janela de 24h gratuita (Revisão 2)

## E.1 O fato

A partir de **01/10/2026**, a Meta passa a cobrar por **mensagens de serviço** — as respostas em formato livre enviadas dentro da janela de 24h aberta pelo usuário. Gratuitas desde 01/11/2024, elas passarão a ser **cobradas por mensagem, à mesma tarifa de templates de utilidade/autenticação do país**, e **sem faixas de desconto por volume**. A cobrança da Meta é **por mensagem** (não por janela de conversa) desde 01/07/2025 — portanto **não existe o truque de agrupar várias respostas em uma cobrança**.

**Isto invalida uma premissa que atravessa o pipeline inteiro.** A "regra de ouro" de Eduardo (`07-…`) — *conversa iniciada pelo usuário = R$0* — e o raciocínio de unit economics de Clóvis, Helena e Rafael assumem essa gratuidade. **Ela morre em 01/10/2026.**

**Status na data deste relatório (2026-08-31):** a Meta se comprometeu a publicar as tarifas por mercado **até 01/09/2026 — amanhã**. As tarifas oficiais **ainda não estão publicadas**. Tudo abaixo é estimativa de ordem de grandeza e **deve ser substituído pela tabela oficial**, mais a margem real do BSP, antes de qualquer decisão orçamentária.

## E.2 Modelagem da cadência aqui especificada

Aluno-referência: **3 dias de treino/semana**, plano mensal de **R$39**.

| Componente | Msgs/mês | Observação |
|---|---|---|
| Check-in diário (template) | ~10 | 13 dias de treino, menos ~25% suprimidos por AF1–AF3 |
| Ack / ramificação de causa (serviço) | ~12 | Confirmação, ou pergunta de causa quando `🚫 Hoje não` |
| RPE amostrado | ~4 | 1×/semana (amostragem de Sofia, não diário) |
| Check-in semanal (abertura + follow-up) | ~14 | Reduzido para 2 perguntas em semanas com ≥3 diários respondidos |
| Slot discricionário + respostas | ~8 | ≤ 1 gatilho/semana + interação |
| **Subtotal — cadência de acompanhamento** | **~48** | **Antes de qualquer conversa livre com o AI Coach** |

> As regras de supressão de Sofia (AF1–AF3) têm **valor financeiro direto**: cada supressão é uma mensagem não cobrada. Elas derrubam o custo do aluno engajado (que reporta espontaneamente) e zeram o do aluno inativo (auto-desligamento após 2 não-respostas) — ou seja, cortam custo exatamente nas duas caudas onde a mensagem valia menos. O número acima **já as considera**; sem elas, a cadência seria ~60.

| Cenário de tarifa | Custo/aluno/mês | % do ticket R$39 |
|---|---|---|
| **Tarifa direta Meta** (~R$0,04–0,05/msg) | **R$2,00–2,50** | **5,1–6,4%** |
| **Tarifa AraraHQ** (~R$0,29/msg — markup de ~6× em utility) | **~R$14,50** | **~37%** |

**A conclusão que precisa chegar a Eduardo sem diluição:** somando o custo de LLM (~R$1/aluno/mês, estimativa de Eduardo), na tarifa do BSP atual **a cadência de acompanhamento sozinha consome ~40% da receita bruta — antes de uma única mensagem de conversa livre do AI Coach**, que é o núcleo da proposta de valor e o maior volume do produto (teto modelado de 200–250 msgs/aluno/mês).

**Isso reposiciona a migração para a Cloud API direta da Meta.** A decisão registrada em 17/08/2026 foi permanecer na AraraHQ durante desenvolvimento e migrar "quando o volume justificar o esforço de engenharia". Com ~50 mensagens/aluno/mês de cadência estrutural mais a conversa, o markup de ~6× deixa de ser pequeno em termos absolutos **antes** de o volume ficar grande. **Não estou revertendo a decisão** — ela é de Eduardo e Henrique — mas o gatilho de reavaliação deve ser antecipado de "volume" para **01/10/2026**. O backend já está preparado: só `arara-transport.ts` fala HTTP com o provedor, com teste estrutural que garante esse confinamento, exatamente para tornar a troca barata.

## E.3 O conflito não resolvido: bolhas vs. tarifa

Sofia desenhou a conversa com **quebra em múltiplas bolhas** por turno (`25-…` §5.3), e ela está certa em UX — bolha única com desfecho não-trivial é uma regressão documentada.

**Mas cada bolha é uma mensagem tarifada a partir de 01/10/2026.** Um turno de 3 bolhas custa **3×** um turno de 1 bolha, em todas as interações do produto. Esse é, disparado, o maior fator de custo do canal, e **ninguém no pipeline o modelou** — porque quando §5.3 foi escrita, bolhas dentro da janela eram gratuitas.

**Encaminhamento proposto (decisão conjunta Sofia + Victor + Eduardo, não minha isolada):** introduzir um **`bubbleBudget` no contrato de turno**, alocado por valor do momento:

| Momento | Bolhas | Racional |
|---|---|---|
| Aha moment (entrega do 1º treino), relato de dor, fechamento do check-in com ajuste | até 3 | Momentos que decidem retenção e segurança — pagar é certo |
| Turnos de rotina (dúvida simples, ack, confirmação) | 1 | O ganho de naturalidade não paga 3× o custo |

Meta agregada: **D6 ≤ 1,6 bolhas/turno**. Isso preserva o desenho de Sofia onde ele importa e corta o custo onde ele não se paga.

## E.4 Mitigações do lado do produto já embutidas nesta revisão

Estas não são propostas — são a razão pela qual cada limite de §A e §B tem o número que tem:

| # | Mitigação | Economia estimada |
|---|---|---|
| 1 | **Adesão + carga num único toque** (§A.4), em vez de pergunta de esforço em segunda mensagem | ~13 msgs/aluno/mês |
| 2 | **Rollup em vez de pergunta** no check-in semanal (§A.5) | ~4 msgs/aluno/mês |
| 3 | **Suspensão após 3 não-respostas** (AF1) | Elimina 100% do gasto na cauda inativa |
| 4 | **Slot discricionário único** (§B.2) | Teto rígido sobre a proatividade |
| 5 | **Escada de silêncio decrescente** (AF3) | Máx. 3 toques por janela de inatividade, depois zero |
| 6 | **Teto de 5 disparos diários/semana** | Limita o custo do aluno de alta frequência |
| 7 | **`bubbleBudget`** (§E.3) | Potencialmente o maior de todos — a definir com Sofia/Victor |

## E.5 Uma oportunidade que compensa parte do custo

A pesquisa desta revisão localizou uma exceção relevante que ninguém no pipeline registrou: **mensagens de serviço permanecem gratuitas dentro da janela de entrada gratuita de 72 horas**, aberta por conversas iniciadas via **anúncios Click-to-WhatsApp** e CTAs de redes sociais.

**Implicação direta:** 72 horas cobrem **integralmente** a janela mais intensa e mais crítica do produto — anamnese → geração → entrega do protocolo → primeiro treino → primeiro registro. É exatamente o trecho em que a conversa é mais densa e em que o aha moment acontece.

**Recomendação para Helena e Eduardo:** priorizar **Click-to-WhatsApp como porta de entrada padrão** da MOVIVO, não apenas como formato de campanha. É uma decisão de GTM com efeito direto em margem, e ela alinha aquisição paga e custo de canal na mesma direção — algo raro. Precisa ser validado contra a documentação oficial da Meta antes de virar premissa de modelagem.

---

# §F — Plano de validação do Sistema de Acompanhamento (Revisão 2)

Respeitando os **gates de Clóvis** (`22-…` §7.4): não avançar de tier sem cumprir o gate anterior.

| # | Hipótese | Experimento | Métrica primária | Critério |
|---|---|---|---|---|
| **H1** | Implementation intention (dias + **horário** + local) na anamnese aumenta a NSM | A/B no fluxo de anamnese | Treinos concluídos/30d | +15% no braço tratado |
| **H2** | Rollup factual na abertura do check-in aumenta adesão | A/B de copy (sem msg extra) | Adesão da semana seguinte | +10% |
| **H3** | Toque humano CREF visível e datado aumenta retenção | A/B: check-in genérico vs. com revisão atribuída | Retenção D30 | +10pp |
| **H4** | Escolha real na substituição aumenta adesão | A/B: IA decide vs. IA oferece 2 opções válidas | Treinos concluídos | +8% |
| **H5** | Revisão de meta no check-in aumenta adesão | A/B de copy | Treinos concluídos | qualitativo + quantitativo |
| **H6** | Causa de churn é classificável em tempo hábil | Instrumentação (Q3 condicional + cancelamento) | % classificado | ≥ 60% |
| **H7 (R2)** | Check-in **diário** aumenta a NSM vs. só semanal | A/B 50/50, 6 semanas | Treinos concluídos/30d | +20%, **sem** aumento de bloqueio/opt-out |
| **H8 (R2)** | Horário derivado do treino declarado bate 20h fixas | A/B de horário de disparo | Taxa de resposta ao diário | +10pp |
| **H9 (R2)** | Sequência **semanal** (descanso conta, quebra não é comunicada) aumenta consistência | A/B de copy no check-in | Semanas consecutivas na meta | mediana +1 |
| **H10 (R2)** | Norma social agregada aumenta adesão sem efeito adverso | A/B, só em coortes com n ≥ 50 **e** adesão ≥ 50% | Adesão da semana seguinte | +5%, sem queda de CSAT |

**Ordem de execução recomendada:** H6 e H7 primeiro. **H6 porque é o gate de tudo** — gamificação trata churn por *motivação*; se o churn real for por *valor percebido* ("o protocolo não me serviu", "a IA não entendeu meu joelho"), qualquer reconhecimento é analgésico caro sobre um problema de produto, e o investimento correto é no Motor Determinístico e nos prompts. **H7 porque é a aposta central desta revisão** e precisa ser falsificável: se o diário não mover a NSM e ainda subir bloqueio/opt-out, ele deve ser revertido para semanal, e eu terei errado.

**Pré-requisito não negociável:** nada disso é interpretável sem **instrumentação de coorte com data de corte marcada** na entrada do check-in diário (ver ressalva da NSM em §D). Igor (`21-…`) é o dono desse pré-requisito.

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

### Risco 8 — Custo de mensagem WhatsApp pós-01/10/2026 (CRÍTICO) — Revisão 2
**Probabilidade:** Alta (é um fato datado, não uma hipótese) | **Impacto:** Muito Alto

O fim da gratuidade das mensagens de serviço pode levar a cadência de acompanhamento a consumir ~37% do ticket na tarifa do BSP atual, contra ~6% na tarifa direta da Meta. Combinado ao custo de LLM, isso comprime a margem a ponto de inviabilizar o LTV/CAC ≥ 3.

**Mitigações:** todas as sete de §E.4 (já embutidas no desenho), mais: antecipar o gatilho de reavaliação da migração para Cloud API direta de "volume" para **01/10/2026**; resolver o `bubbleBudget` (§E.3); explorar a janela gratuita de 72h via Click-to-WhatsApp (§E.5); e **instrumentar D5 (custo/aluno/mês) desde o primeiro dia do diário**, com alerta em R$3,00.

### Risco 9 — Fadiga de mensagem e bloqueio do número (ALTO) — Revisão 2
**Probabilidade:** Média | **Impacto:** Muito Alto

Um check-in diário mal calibrado é um gerador de bloqueios. Taxa de bloqueio de ~0,5% já derruba o *quality rating*; acima de 2% aciona rebaixamento de tier. Com a conta já limitada a `TIER_250` por verificação de CNPJ, um rebaixamento é um incidente de operação que **afeta todos os alunos ao mesmo tempo** — inclusive os que estão engajados.

O que torna este risco pior do que parece: o bloqueio é **irreversível e invisível**. O aluno não cancela, não reclama e não responde — ele some, e o produto continua pagando para falar com o vazio até a suspensão automática agir.

**Mitigações:** as seis regras anti-fadiga (AF1–AF6); a regra invertida de §B.4 (silêncio reduz frequência); opt-out em uma frase preservando o semanal (AF5) — **opt-out é reversível, bloqueio não é**; monitoramento de D2/D3/D4 com alerta; e as 4 condições de §B.4 como checagem determinística pré-envio, não como orientação de prompt.

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

## Recomendações da Revisão 2 — por agente

### Para Eduardo (07 — Financeiro) — **ESCALADA FORMAL, COM PRAZO**

Esta é a entrega mais urgente desta revisão e é dirigida a você.

1. **A premissa de "conversa dentro da janela de 24h é gratuita" morre em 01/10/2026.** Ela sustenta a regra de ouro do seu relatório (`07-…`) e, por herança, o raciocínio de unit economics de Clóvis, Helena e Rafael. **Nenhum número de margem desses relatórios pode ser reutilizado sem remodelagem.**
2. **Novo custo unitário a modelar:** ~50 mensagens/aluno/mês **só de cadência de acompanhamento** (§E.2), antes da conversa livre do AI Coach. Isso é **R$2,00–2,50** na tarifa direta da Meta e **~R$14,50** na tarifa da AraraHQ — **6,4% vs. 37% do ticket de R$39**. Some o custo de LLM (~R$1) e, na tarifa do BSP, ~40% da receita bruta vai embora antes da conversa que é o produto.
3. **Ação com prazo:** a Meta publica as tarifas oficiais por mercado **até 01/09/2026** — amanhã. Substituir minhas estimativas pela tabela oficial e pela margem real da AraraHQ, e **recalcular payback de CAC e LTV/CAC** antes de qualquer decisão de aquisição paga.
4. **Antecipar o gatilho de migração para a Cloud API direta** de "quando o volume justificar" para **01/10/2026**. O markup de ~6× em utility deixa de ser pequeno em absoluto antes de o volume ficar grande. O backend já está confinado para tornar a troca barata (`arara-transport.ts` + teste estrutural).
5. **Avaliar a janela gratuita de 72h via Click-to-WhatsApp** (§E.5) — cobre integralmente onboarding + primeiro treino. É alinhamento raro entre decisão de GTM e margem. Coordenar com Helena.
6. **Teto de produto que estou fixando e que preciso que você valide:** custo de mensagem ≤ **R$3,00/aluno/mês** (D5). Se a tarifa oficial tornar esse teto inatingível com a cadência de §A/§B, **a cadência muda** — não o teto.
7. Registrado de Clóvis: **incentivo econômico de adesão** (desconto/cashback na renovação) tem evidência equivalente à da gamificação em RCT, com custo em **margem** (controlável) em vez de custo em **mensagens**. É a alternativa preferível caso H6 aponte churn por motivação.

### Para Victor (12 — Engenheiro de IA)

1. **§B inteiro é um motor de gatilhos com orçamento, não prompt.** A decisão de enviar precisa ser determinística e auditável **antes** de qualquer chamada de LLM. O LLM redige a mensagem que o orçamento já autorizou; ele nunca decide se a mensagem sai.
2. **As 4 condições de §B.4 são checagem pré-envio determinística**, no mesmo lugar do `ValidationService`. Condição 3 é lista de termos proibidos (falha acumulada, sequência quebrada); condição 4 é presença de botões; condição 1 é presença de ao menos um fato do estado do aluno — reaproveitando `numericFacts`.
3. **Contexto novo a expor ao verbalizador:** adesão da semana, adesão da semana anterior, sequência semanal vigente, contagem de "foi puxado" na semana, dias desde o último treino. É o insumo do rollup (§A.5) e dos marcos de competência.
4. **Regra dura (§C.3):** nenhuma mecânica de reconhecimento pode ser condicionada a treino auto-reportado. Reconhecer apenas o que o sistema observa por si — resposta ao check-in, carga registrada, semana fechada.
5. **Nunca simular o humano.** A IA jamais assina como o profissional CREF. Atribui-se a autoria da decisão (verdade contratual) e marca-se a revisão como evento real e datado.
6. **Guardrail de segurança conversacional:** o coach nunca pressiona por continuidade. Diante de dor, fadiga ou falta de tempo, a resposta correta é **ajustar ou acolher o descanso** — jamais invocar sequência, meta ou perda. É onde uma mentalidade de gamificação mal calibrada causaria dano real.
7. **`bubbleBudget` no contrato de turno** (§E.3), alocado por valor do momento. Decisão conjunta com Sofia e Eduardo.

### Para Sofia (09 — UX/UI)

Nós dois revisamos no mesmo dia, a partir do mesmo pedido, sem coordenação. Comparei os desenhos e **adotei o seu na maior parte da superfície conversacional** — os três botões do diário, a amostragem de RPE, as regras de supressão, a escada de 4 degraus, a regra "gamificação nunca gera mensagem própria" e o critério de exibição da norma social. Onde revisei minha própria proposta em favor da sua, deixei registrado por quê (§A.4, §A.6, §B.2, §C.4).

1. **Uma decisão sua eu revisei, e é de segurança: §11.9(d), "3 semanas cheias liberam a progressão de fase".** A sequência é construída sobre auto-report e a recompensa é aumento de carga — isso cria incentivo material para inflar o report, e o prêmio por inflá-lo é o motor progredir carga sobre treinos que não aconteceram (Clóvis §4.4). **Vale o princípio da assimetria (§C.3-bis): sinal auto-reportado sempre pode reduzir carga, nunca aumentá-la sozinho.** As outras quatro linhas da sua tabela são todas conservadoras e estão aprovadas. **O que muda é pequeno e preserva o que você queria:** a sequência continua tendo consequência visível, mas a copy atribui a liberação ao revisor humano — *"o Diego olhou sua semana e liberou a próxima fase"* — em vez de à sequência. Você mantém o gate de periodização visível, e ele ainda reforça H3.
2. **`SEM_REGISTRO` não quebra a sequência** é uma sutileza sua que merece virar teste explícito, não só copy. É ela que impede o desenho de pressionar o aluno a reportar.
3. **A copy do diário no código ainda é a antiga** (`workout-messages.ts`) — o registro formal que você criticou em `25-…` §8.6, **inclusive sem acentuação**, que você marcou como o item de maior urgência e menor custo do seu relatório. Nada disso foi para o código ainda.
4. **O check-in semanal** (§A.5): sua "fricção decrescente como recompensa" (quem respondeu ≥3 diários recebe 2 perguntas em vez de 3, e MOVI diz isso) é melhor que a minha Q3 condicional pura — **adotada**. Mantenho de mim apenas que, na semana em que a adesão caiu, a pergunta de causa vem **primeiro**: quando a semana desandou, a causa é a informação mais valiosa do check-in.
5. `SCOPE_PERIMETER_BLOCK` desatualizado (seu §12.4) está no backlog como mudança de produto com revisão CREF, não como ajuste de painel. Confirmado.

### Para Leonardo (13 — Backend)

1. **L1 é um bug de produto, não um refinamento** (§A.2): `workout-schedule.ts` deriva os dias de treino de um mapa fixo por frequência e ignora `ProtocolSession.weekday` e `preferredDays` da anamnese — que **já existem no schema e já são coletados**. Um aluno de ter/qui/sáb é cobrado seg/qua/sex. Para um produto cuja proposta é acompanhamento, isso é a prova visível de que ninguém está olhando. **P0.**
2. **L2:** preencher `workout_completions.perceived_effort` a partir do terceiro botão (5 = neutro, 8 = puxado). A coluna existe, a validação 1–10 existe, nada escreve nela.
3. **L4:** suspensão automática do diário após 3 não-respostas consecutivas, com reativação por qualquer mensagem do aluno ou qualquer treino registrado. Precisa de estado persistido por titular, não de heurística no scan.
4. **Orçamento proativo (§B.2)** precisa ser um serviço com estado, consultado por **todo** produtor de mensagem proativa (diário, semanal, gatilhos, reengajamento) — não uma regra replicada em cada scheduler. É o único jeito de o invariante "≤7/semana, ≤1/dia" ser verdade.
5. **L3 (P1):** disparo ~2h após o fim da janela de horário declarada pelo aluno (Sofia: "Noite" → 21h30). Depende de a anamnese capturar o horário (H1).
6. **Restrição de arquitetura (§C.3-bis):** nenhum caminho do Motor Determinístico pode ter `count(workout_completions)` como entrada de uma decisão que **aumente** carga, volume ou frequência. Reduções a partir de sinal auto-reportado são permitidas e desejáveis; aumentos exigem corroboração (RPE amostrado + julgamento do check-in) e materialização em nova versão de protocolo com assinatura CREF.
7. **Orçamento como parâmetro de runtime**, não constante em código — a tarifa da Meta ainda não foi publicada e o número de proativos/semana vai precisar de ajuste sem deploy.
8. **Regras de supressão (AF1–AF3)** são as de maior retorno financeiro do conjunto: cada supressão é uma mensagem não cobrada. AF1 (já reportou espontaneamente) exige checar `workout_completions` e `conversations` **no momento do envio**, não no scan.

### Para Mariana (15 — QA)

Os invariantes de §A.6 e §B são **testáveis sem LLM** e devem ser quality gates, não alertas: teto de 7 proativas/semana, máx. 1/dia, exceção única de T1, escada monotonicamente decrescente sob silêncio, janela 08:00–21:30, e as 4 condições de §B.4. Um teste que prove que **a frequência de contato nunca aumenta em resposta ao silêncio** é o mais valioso do conjunto — é a regra que separa o produto de um sistema de cobrança.

### Para Igor (21 — Growth)

Instrumentação de coorte **com data de corte marcada** na entrada do check-in diário é pré-requisito de tudo em §F. A NSM anterior ao diário e a posterior **não são comparáveis** (§D, ressalva da NSM): a série provavelmente cai, e isso é correção de medição, não regressão. H6 e H7 são os dois primeiros experimentos.

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

### Fontes adicionais — Revisão 2 (2026-08-31)

**Economia do canal WhatsApp (fim da janela gratuita)**
- [Pricing on the WhatsApp Business Platform — Meta for Developers](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing) — fonte primária; tarifas por mercado ainda **não publicadas** na data deste relatório
- [WhatsApp Service Message Pricing Update (Oct 2026) — ChakraHQ](https://chakrahq.com/article/whatsapp-api-pricing-update-service-messages-october-2026/) — confirma cobrança à tarifa de utility/autenticação, ausência de faixas de volume e a **isenção da janela de entrada gratuita de 72h** (Click-to-WhatsApp)
- [WhatsApp Service Message Pricing Changes in October 2026 — SendPulse](https://sendpulse.com/blog/whatsapp-service-message-pricing)
- [WhatsApp Business API Pricing in Brazil 2026 — Message Central](https://www.messagecentral.com/blog/whatsapp-business-api-pricing-brazil) — referência de R$0,04–0,05/utility e margem de BSP de 10–30%
- [WhatsApp Business API Pricing 2026: Conversation Categories — Blueticks](https://blueticks.co/blog/whatsapp-business-api-pricing-2026)

**Qualidade de número, bloqueio e limites de mensagem**
- [About Your WhatsApp Business Phone Number's Quality Rating — Meta Business Help Center](https://www.facebook.com/business/help/896873687365001)
- [WhatsApp Spam Policy 2026: What Gets You Reported, Throttled, Banned — PostEngage](https://postengage.ai/blog/whatsapp-spam-policy-2026)
- [WhatsApp Messaging Limits in 2026 — AiSensy](https://m.aisensy.com/blog/whatsapp-message-limits-guide/)
- [WhatsApp Business Quality Rating explained — Kanal](https://getkanal.com/blog/whatsapp-business-quality-rating-explained)

**Fadiga de prompt diário e decaimento de resposta (EMA)**
- [Feasibility and adherence to ecological momentary assessment among community-dwelling adults — PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC12211223/) — queda de 86,96% (sem. 1–2) para 76,31% (sem. 3–4)
- [Daily symptom monitoring is sustainable over months: retention, not compliance, is the primary barrier — ResearchGate](https://www.researchgate.net/publication/406889468_Daily_symptom_monitoring_is_sustainable_over_months_retention_not_compliance_is_the_primary_barrier_to_long-duration_digital_tracking) — adesão estável em ~71% ao longo de 17 semanas quando o custo por resposta é baixo
- [Momentary Factors and Study Characteristics Associated With Participant Burden and Protocol Adherence — PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11079761/)
- [Participant Compliance With EMA in Movement Behavior Research: Systematic Review — ScienceDirect](https://www.sciencedirect.com/org/science/article/pii/S2291522225000166)

**Evidência de gamificação e ciência comportamental**
> A base de evidência de §C (meta-análise do Lancet/eClinicalMedicine 2024, RCTs STEP UP e BE ACTIVE, Rewley et al. sobre aversão à perda, implementation intentions, SDT e coaching humano) foi levantada e criticada por Clóvis em `22-relatorio-clovis-retencao-gamificacao.md`. **Não a reproduzo aqui** — as fontes primárias, com as ressalvas de confiabilidade, estão naquele relatório. Esta revisão consome aquelas conclusões e as converte em spec.

### Limitações desta revisão (declaração explícita)

1. **As tarifas oficiais da Meta não estavam publicadas em 2026-08-31.** Toda a modelagem de §E é **ordem de grandeza** com tarifa de referência pública, não orçamento. A publicação é esperada para 01/09/2026 e **deve substituir estes números antes de qualquer decisão**.
2. **A tarifa da AraraHQ (~R$0,29/msg, markup de ~6×) vem de observação interna de 17/08/2026**, não de contrato conferido nesta revisão. Confirmar com o provedor.
3. **A isenção da janela de 72h (Click-to-WhatsApp) veio de fonte secundária** e não pôde ser confirmada na documentação primária da Meta, que não expôs as tarifas na página consultada. **Validar antes de virar premissa de GTM** (§E.5).
4. **As metas de taxa de resposta ao check-in diário (A2) são extrapolação** de literatura de EMA — contexto de pesquisa, participantes consentidos e incentivados, não produto de consumo pago. São um ponto de partida a recalibrar com dado próprio após 60 dias, não uma previsão.
5. **Norma social descritiva agregada (§C.4) não tem evidência específica em canal conversacional de treino.** É a única recomendação desta revisão classificada como **hipótese a testar** (H10), não decisão sustentada.
6. **Não localizei benchmark público de taxa de resposta a check-in diário via WhatsApp em produtos de fitness no Brasil.** Esse número a MOVIVO terá que gerar sozinha — é a mesma lacuna que Clóvis registrou para retenção.
7. **As estimativas de contagem de mensagens (§E.2) assumem um aluno de 3 dias/semana** e a cadência aqui especificada. Alunos de 5–6 dias/semana e conversadores intensos têm perfil de custo materialmente diferente, e o custo real será uma distribuição, não uma média.
