# Relatório — Sofia Almeida (Senior Product Designer / UX-UI Designer)

**Data:** 2026-07-22
**Ideia analisada:** MOVIVO — AI Coach de treino individualizado via WhatsApp, com supervisão de profissional de Educação Física (CREF)
**Pasta do projeto:** docs/fitness-ia-whatsapp/
**Status do pipeline:** Fase 1 concluída (Clóvis/Gabriel/Caio/Kimura/Helena) → Fase 2 concluída (Alexandre/Eduardo) → **Fase 3 concluída (Lucas + Sofia)** → Próxima: Fase 4 (Rafael/Sato/Victor)

> **Nota de sequência:** Rafael (Fase 4) e Alexandre/Eduardo (Fase 2) rodaram antes ou em paralelo a este relatório na prática. Onde as decisões de Alexandre (gate PAR-Q bloqueante, consentimento granular, guardrails de linguagem) e Eduardo (trial 7 dias, plano único por período, sem cartão no trial) **corrigem** premissas de Lucas, eu desenho para as versões corrigidas e sinalizo com **[AJUSTE]**. Onde Rafael já definiu restrições técnicas (formulário em 3 blocos com PATCH + token, dashboard Next.js 15 + Socket.io), desenho dentro delas.

---

## 1. Resumo Executivo

Este relatório entrega a **camada de experiência completa da MOVIVO**: o fluxo de anamnese conversacional em 3 blocos, os wireframes das telas web (landing, formulário, confirmação, Dashboard CREF), o desenho da experiência conversacional no WhatsApp (persona **MOVI**, aha moment, check-in semanal) e a resolução dos 4 gaps de UX que Lucas marcou como destruidores de LTV.

As cinco decisões de design mais importantes:

1. **Formulário conversacional, não estático.** Benchmark 2026: forms conversacionais completam a 47,3% vs. 21,5% dos tradicionais; barra de progresso rotulada gera até +86% de conversão. Dividimos em 3 blocos (o sweet spot de 3-5 passos), com salvamento por bloco e retomada por token — atacando diretamente o Risco 1 de Lucas (abandono).

2. **O aha moment é orquestrado, não esperado.** Em vez de "entregar um documento de protocolo", MOVI apresenta **um único primeiro treino executável hoje** e negocia um horário — transformando informação em ação nas primeiras 24-48h (a janela que define o churn a 90 dias).

3. **Consentimento e segurança são parte da UX, não um pop-up.** O consentimento de saúde granular (opt-in ativo, checkbox não pré-marcado) aparece como uma tela-ponte **antes** do Bloco 2, e o gate PAR-Q é **bloqueante** (não apenas "flag") para respostas de risco — cumprindo os Bloqueadores 3 e 5 de Alexandre dentro da interface.

4. **Microcopy é compliance.** Todo texto de produto foi escrito sob os guardrails jurídicos: MOVI nunca "prescreve", "diagnostica" ou "garante resultado" — sempre reforça que o método é de um profissional CREF. A linguagem de marca (Gabriel: "manda áudio pro amigo") convive com a sobriedade regulatória.

5. **Reengajamento e pausa são fluxos de primeira classe.** Win-back de inativos e um offboarding que converte cancelamento em pausa (não em perda) são desenhados como jornadas, resolvendo os gaps 3 e 4 de Lucas.

Tudo é **mobile-first** (o ICP vive no celular) e aplica o design system "O Pulso" de Kimura (Petróleo Vivo + Verde Pulso + Coral, Hanken Grotesk + mono para dado), com acessibilidade WCAG 2.2 AA no dashboard web.

---

## 2. Contexto Recebido

**Do pipeline anterior (o que herdo e respeito):**

| Agente | O que uso diretamente no design |
|---|---|
| **Gabriel** | Voz de marca (Mentor-acessível + Companheiro; "manda áudio pro amigo"; anti-hype). Personas Bruno/Letícia/Diego. Guardrails de linguagem. |
| **Kimura** | Design system "O Pulso": Petróleo Vivo `#06302A`, Verde Pulso `#25E27E`, Coral Vivo `#FF6A3D`, neutros Névoa/Grafite/Musgo. Hanken Grotesk + Space/JetBrains Mono. Símbolo Pulso, caixa-baixa, regras WCAG de cor. |
| **Lucas** | PRD, épicos, jornada de 10 etapas, North Star (8 treinos/30 dias), e os **4 gaps** que este relatório resolve. Sugeriu a persona "MOVI". |
| **Alexandre** | Consentimento de saúde destacado antes do Bloco 2; gate de idade 18+; **gate PAR-Q bloqueante** (correção ao RF-09); guardrails de linguagem; transparência de IA supervisionada; cancelamento self-service + arrependimento 7 dias. |
| **Eduardo** | **[AJUSTE]** Trial **7 dias sem cartão**; **plano único por período** (Mensal R$39 / Trimestral R$99 / Anual R$349), não Básico/Pro; garantia de 7 dias como argumento; Asaas/PIX primário. |
| **Rafael** | Formulário em 3 blocos com salvamento por PATCH + token de retomada (72h de expiração); Dashboard CREF em Next.js 15 + Socket.io (notificações real-time); interação principal do usuário via WhatsApp; assinatura eletrônica login+timestamp+hash. |

**Conflito reconciliado (trial 7 vs. 14 dias):** Lucas desenhou a sequência de conversão para trial de 14 dias (touchpoints dias 7/10/13/14). Eduardo, como CFO e decisão mais recente, fixou **trial de 7 dias sem cartão**. Adoto o trial de 7 dias e **comprimo a sequência de conversão** para dias 2 / 4 / 6 / 7 (detalhado na seção 9.4). Sinalizo isto a Lucas para atualização do Épico 5.

---

## 3. Problema de UX

A MOVIVO tem um paradoxo de canal: **a proposta de valor vive no WhatsApp (zero fricção), mas a porta de entrada é uma web (landing + anamnese) que coleta dados sensíveis de saúde (alta fricção).** O funil quebra em dois pontos previsíveis:

- **Antes de provar valor:** o formulário de anamnese + PAR-Q pode ter 20-30 campos. Sem design conversacional, o abandono chega a 60-70% (Lucas, Risco 1). E, por lei, ele precisa carregar consentimento de saúde e um gate de contraindicação — camadas que, mal desenhadas, viram muros.
- **Depois de entrar:** 69% dos usuários abandonam apps de fitness em 90 dias. Sem um aha moment nos 3 primeiros dias, sem reengajamento entre check-ins e sem uma saída digna, o LTV evapora (Lucas, gaps 1, 3 e 4).

O trabalho de UX é, portanto, **minimizar a fricção onde ela é obrigatória (anamnese/LGPD) e maximizar o momento de valor onde ele importa (primeiro treino no WhatsApp)** — sem nunca cruzar as linhas vermelhas regulatórias.

---

## 4. Objetivos do Usuário

Traduzidos das personas de Gabriel para jobs concretos:

- **"Quero saber se vale a pena em 10 segundos"** (Diego, o sem-tempo) → landing clara, CTA único.
- **"Quero começar sem me sentir interrogado"** (Bruno, o recomeço) → anamnese curta, sem julgamento, com progresso visível.
- **"Quero confiar que o treino é seguro pra mim"** (todos) → ver a MOVIVO reconhecer minha lesão/limitação e o selo CREF presente.
- **"Quero entender o que fazem com meus dados antes de dá-los"** (consciente de privacidade) → consentimento legível, não juridiquês.
- **"Quero começar a treinar hoje, não receber um PDF"** (Letícia, a otimizadora) → primeiro treino executável imediato.
- **"Quero me sentir acompanhado, não spammado"** → check-in que abre com vitória, não com cobrança.

---

## 5. Objetivos do Negócio

- **Ativação:** taxa de conclusão do formulário ≥ 65% (Lucas); primeiro treino em 48h ≥ 50%.
- **Retenção:** North Star de 8 treinos/30 dias; retenção 30d ≥ 80%; resposta ao check-in ≥ 55%.
- **Monetização:** conversão trial → pago ≥ 25% (meta Lucas) / ≥ 40% (meta Helena) sobre a audiência quente do Cahuã.
- **Compliance como ativo:** a UI precisa produzir a trilha de auditoria (consentimento versionado, gate PAR-Q, transparência de IA) que sustenta a "due diligence limpa" de Eduardo/Alexandre.
- **Custo:** maximizar conversa iniciada pelo usuário (janela 24h = R$0) e minimizar templates proativos pagos — o design de reengajamento respeita isso.

---

## 6. Pesquisa e Benchmark

Pesquisa web (fontes na seção 17) confirmou e calibrou as decisões:

- **Forms conversacionais vs. tradicionais (2026):** 47,3% vs. 21,5% de conclusão. Multi-step com barra de progresso: até +86% de conversão. Sweet spot de **3-5 passos**; acima de 6 passos até usuários comprometidos abandonam. **Indicadores rotulados** (nome da etapa) batem barra de % pura em forms de 5+ passos. Sempre permitir voltar sem perder dados. → Valida a arquitetura de 3 blocos de Lucas/Rafael e define o padrão de progresso.
- **WhatsApp interactive buttons (2026):** **máximo 3 quick reply buttons** — acima disso gera fadiga de decisão. Quick reply quando a próxima ação é dentro do WhatsApp; CTA (link) quando é fora. Fluxos com botões reduzem no-show em até 35%. → Restringe o check-in a 3 botões por pergunta e define quando usar botão vs. link de assinatura.
- **UX de wellness (2026):** personalização visível, micro-interações sutis, feedback preditivo. Peak-End Rule: o fim da experiência (inclusive o cancelamento) define a memória. → Fundamenta o "momento de vitória semanal" e o offboarding-pausa.

Referências de produto observadas: Future/Trainwell (human+AI, accountability relacional), Duolingo (streak sem culpa, celebração), Typeform (form conversacional), Linear/Notion (densidade e clareza de dashboard B2B).

---

## 7. Solução Proposta — Visão Geral

Três superfícies, um sistema:

```
┌──────────────────────────────────────────────────────────────────┐
│  SUPERFÍCIE 1 — WEB DE ENTRADA (Next.js, mobile-first)           │
│  Landing → Consentimento → Anamnese 3 blocos → Confirmação      │
│  Objetivo: coletar com mínima fricção + compliance embutido      │
├──────────────────────────────────────────────────────────────────┤
│  SUPERFÍCIE 2 — WHATSAPP (MOVI, o AI Coach)                      │
│  Boas-vindas → Protocolo/aha moment → Conversa → Check-in →      │
│  Conversão → Reengajamento → Offboarding/Pausa                  │
│  Objetivo: entregar valor e reter na conversa que já existe      │
├──────────────────────────────────────────────────────────────────┤
│  SUPERFÍCIE 3 — DASHBOARD CREF (Next.js 15 + Socket.io)         │
│  Fila de assinatura · Flags PAR-Q · Timeline do usuário         │
│  Objetivo: supervisão real e auditável do profissional (RT)      │
└──────────────────────────────────────────────────────────────────┘
```

---

## 8. Fluxo do Usuário — Anamnese + PAR-Q (detalhado)

### 8.1 Mapa do fluxo completo

```
[Landing page]
   │ CTA "Começar agora" + pré-qualifying de objetivo (1 clique)
   ▼
[Tela de identificação — inicia sessão]  ← cria anamnesis_session + token (Rafael)
   │ nome, WhatsApp, e-mail, gate de idade 18+  (Bloco 0, leve)
   │ evento: form_started
   ▼
[BLOCO 1 — Sobre você]  (dados básicos + objetivo confirmado)
   │ salva via PATCH ao concluir → last_block=1
   │ evento: form_block_completed(1)
   ▼
[TELA-PONTE DE CONSENTIMENTO DE SAÚDE]  ← opt-in ativo, granular (Alexandre)
   │ sem consentimento = não avança. Registra consents(HEALTH_DATA, versão, ts)
   ▼
[BLOCO 2 — Sua saúde + PAR-Q]  (dados sensíveis + triagem)
   │ lógica condicional: "sim" em item de risco → ramo de clearance
   │ salva via PATCH → last_block=2
   │ evento: form_block_completed(2)
   ├─── se PAR-Q de risco ──► [ESTADO: BLOQUEADO_AGUARDANDO_CLEARANCE]
   │                          (não gera protocolo; ver 8.5)
   ▼
[BLOCO 3 — Sua rotina]  (disponibilidade, local, equipamentos)
   │ condicional: local de treino → filtra equipamentos
   │ salva via PATCH → last_block=3 → status=SUBMITTED
   │ evento: form_submitted
   ▼
[TELA DE CONFIRMAÇÃO / MICRO-ONBOARDING]
   │ CTA: "Salvar o número da MOVIVO" + expectativa de SLA
   ▼
(handoff para WhatsApp — Superfície 2)
```

### 8.2 Princípios de design do formulário

- **Uma pergunta (ou micro-grupo) por vez**, formato conversacional (typeform-like), fundo Névoa, card central, foco automático no campo. Isto é o que sustenta a taxa de conclusão.
- **Progresso rotulado, não numérico frio:** header fixo com "Sobre você · Sua saúde · Sua rotina" e a etapa atual em Verde Pulso, mais uma barra fina de progresso. (Benchmark: rotulado > % em 3+ etapas.)
- **Voltar sempre disponível** sem perder dados já digitados (os dados vivem na sessão; navegação livre entre blocos concluídos).
- **Validação inline e gentil:** erros em Coral, com microcopy de ajuda, nunca em vermelho-alarme.
- **Estimativa de tempo honesta** na primeira tela: "Leva uns 4 minutos. Dá pra pausar e voltar depois."
- **Mobile-first real:** inputs grandes (min-height 48px, alvo Fitts), teclado numérico para números, chips de seleção em vez de dropdowns quando possível.

### 8.3 Salvamento e retomada (anti-abandono)

- Cada bloco concluído dispara **PATCH** que persiste `data_block_n` e avança `last_block` (arquitetura de Rafael). O usuário nunca perde o que já fez.
- **Token de retomada** associado ao WhatsApp/e-mail. Se o usuário abandonar:
  - **+1h de inatividade:** mensagem de retomada no WhatsApp (se número já capturado no Bloco 0) OU e-mail: *"Vi que você começou seu cadastro na MOVIVO e parou na parte da sua rotina. Falta pouquíssimo — dá pra terminar de onde parou: [link]."* (template alinhado ao gap 2 de Lucas).
  - **Link de retomada** abre exatamente no `last_block`, com os dados preservados.
- **Expiração em 72h** (Rafael + LGPD/minimização): após isso, dados parciais são descartados e uma nova sessão é necessária. A tela de retomada expirada explica isso com transparência ("Por segurança dos seus dados de saúde, cadastros incompletos são apagados após 3 dias").

### 8.4 Onde e como aparece o consentimento LGPD (granular)

Seguindo Alexandre à risca:

- **Bloco 0 (identificação):** gate de idade — *"Confirmo que tenho 18 anos ou mais"* (checkbox obrigatório, não pré-marcado). Aceite de **Termos de Uso + Política de Privacidade** (link) com checkbox próprio.
- **Tela-ponte antes do Bloco 2 (dados de saúde):** consentimento **específico, destacado e opt-in ativo**. Tela dedicada, não um rodapé:
  - Título: *"Agora vamos falar da sua saúde"*
  - Corpo em linguagem clara (não juridiquês): o que coletamos (histórico de lesões, condições do PAR-Q, medicações), para quê (montar um treino seguro), quem acessa (você e o profissional de Educação Física responsável — CREF nº ___), e que você pode revogar quando quiser.
  - Checkbox **não pré-marcado**: *"Autorizo a MOVIVO a tratar meus dados de saúde para a finalidade acima."*
  - Consentimento de **marketing separado e independente** (não amarrado): *"Quero receber dicas e novidades no WhatsApp (opcional)."*
  - Registra `consents(HEALTH_DATA, versão_do_texto, timestamp, ip)` — a versão referencia o artefato imutável do texto.
- **Regra de UI:** sem o checkbox de saúde marcado, o botão "Continuar" permanece desabilitado (estado Musgo). Nunca avançar sem registro.

### 8.5 Tratamento do PAR-Q — gate bloqueante (não flag)

**[AJUSTE — correção de Alexandre ao RF-09]:** para respostas de risco no PAR-Q (dor torácica, problema cardíaco, tontura/desmaio, medicação para pressão/coração, gestação, lesão ativa, cirurgia recente), o comportamento é **BLOQUEAR** a geração automática do protocolo, não apenas sinalizar.

Fluxo de UX do gate:

- Perguntas do PAR-Q são **binárias com ramificação**. Ao marcar "sim" em item de risco, aparece um follow-up contextual sem alarme (evitar pânico): *"Obrigada por contar. Isso é importante pra sua segurança."*
- Ao final do Bloco 2, se houver qualquer flag de risco, o usuário **não vê** a tela de confirmação normal. Vê uma **tela de cuidado**:
  - Título: *"Antes de montar seu treino, precisamos de um cuidado a mais"*
  - Explicação: por segurança, o profissional de Educação Física responsável vai revisar suas respostas, e pode ser necessário um **atestado/liberação médica** antes de começar. Isso não é "não" — é responsabilidade.
  - Estados possíveis (refletindo o modelo de Alexandre):
    - `BLOQUEADO_AGUARDANDO_CLEARANCE` — usuário orientado a enviar liberação médica; protocolo não é gerado.
    - `LIBERADO_COM_RESSALVA_RT` — profissional revisou e liberou com adaptações.
    - `LIBERADO` — sem flags, fluxo normal.
  - Upload de atestado (foto/PDF) direto na tela ou via WhatsApp com MOVI.
- **Microcopy nunca diz** "você está doente" ou qualquer diagnóstico. Diz que a atividade física tem riscos inerentes e que a avaliação médica é uma boa prática (linguagem de Alexandre, seção 5).
- No Dashboard CREF, o caso entra como **flag PAR-Q prioritária** (seção 10.3).

---

## 9. Estrutura da Interface — Wireframes

Notação: `[ ]` botão · `( )` campo · `▸` seleção/chip · `▓` barra de progresso · cores referenciam tokens de Kimura.

### 9.1 Landing page (mobile-first)

```
┌───────────────────────────────┐
│ ● movivo        [ Entrar ]    │  ← header; símbolo Pulso (Verde/Petróleo)
├───────────────────────────────┤
│                               │
│  Treino de verdade,           │  H1 Hanken Bold, Grafite
│  no seu WhatsApp.             │
│                               │
│  Feito com ciência, adaptado  │  subtítulo, Musgo
│  a você, com um profissional  │
│  de Educação Física por trás. │
│                               │
│  Qual é o seu foco agora?     │  ← pré-qualifying (Lucas)
│  ▸ Perder peso                │  chips grandes; seleção
│  ▸ Ganhar massa               │     pinta em Verde Pulso
│  ▸ Condicionamento            │
│                               │
│  [  Começar agora  ]          │  ← CTA único, Verde Pulso s/ Petróleo
│   grátis por 7 dias · sem     │  microcopy de segurança
│   cartão · cancele quando     │
│   quiser                      │
│                               │
│  ── como funciona ──          │
│  1. Você conta sobre você     │
│  2. Um treino é montado e     │
│     revisado por um profis-   │
│     sional (CREF)             │
│  3. Ele chega no seu WhatsApp │
│                               │
│  "..." depoimento real        │  ← social proof (Lucas gap)
│  🛡  Responsabilidade técnica  │  ← selo CREF (Kimura), sóbrio
│     de Profissional de Ed.    │
│     Física registrado         │
└───────────────────────────────┘
```

Decisões: **CTA único** (elimina paralisia de plano — Lucas); **pré-qualifying de 1 clique** que segue no `primary_goal` da sessão; selo CREF visível como conversão (não decorativo); nenhuma promessa de resultado (guardrail). Verde Pulso só em CTA e realces (nunca texto pequeno sobre claro — regra WCAG de Kimura).

### 9.2 Bloco 0 — Identificação (inicia sessão)

```
┌───────────────────────────────┐
│ ← Sobre você · Sua saúde ·    │  progresso rotulado (etapa 1 em Verde)
│   Sua rotina                  │
│ ▓▓▓▓▓░░░░░░░░░░░░░  parte 1/3  │
├───────────────────────────────┤
│  Prazer! Como te chamamos?    │  tom de gente (Gabriel)
│  ( Seu primeiro nome        ) │
│                               │
│  Seu WhatsApp (é por onde     │
│  seu treino chega)            │
│  ( +55 (  ) _____-____      ) │  teclado numérico
│                               │
│  Seu e-mail                   │
│  ( voce@email.com           ) │
│                               │
│  ☐ Tenho 18 anos ou mais      │  ← gate idade (Alexandre)
│  ☐ Li e aceito os Termos e a  │  ← ToS + PP (Alexandre)
│     Política de Privacidade   │
│                               │
│  [  Continuar  ]              │  desabilitado até checkboxes
└───────────────────────────────┘
```

### 9.3 Bloco 1 — Sobre você

```
┌───────────────────────────────┐
│  Sua rotina · SUA SAÚDE ·     │
│  Sobre você                   │
│ ▓▓▓▓▓▓▓▓▓░░░░░░░░  parte 1/3   │
├───────────────────────────────┤
│  Seu foco é ganhar massa 💪   │  ← confirma pré-qualifying,
│  (dá pra mudar)               │     personalização visível
│                               │
│  Idade      ( 24 )            │
│  Peso (kg)  ( 72 )   mono     │
│  Altura(cm) ( 178 )  mono     │
│                               │
│  Como você se descreveria     │
│  hoje?                        │
│  ▸ Tô começando               │  chips (nível → motor determinístico)
│  ▸ Já treino há um tempo      │
│  ▸ Treino sério/avançado      │
│                               │
│  [ Voltar ]   [ Continuar ]   │
└───────────────────────────────┘
```

### 9.4 Tela-ponte de consentimento de saúde

```
┌───────────────────────────────┐
│  🩺 Agora vamos falar da       │  fundo Névoa, ícone linha (Kimura)
│     sua saúde                 │
├───────────────────────────────┤
│  Pra montar um treino seguro, │  linguagem clara
│  precisamos de algumas infos  │
│  de saúde (lesões, condições, │
│  medicações).                 │
│                               │
│  • Só usamos pra montar e     │
│    adaptar seu treino.        │
│  • Quem acessa: você e o      │
│    profissional de Ed. Física │
│    responsável (CREF ___).    │
│  • Você pode revogar quando   │
│    quiser.                    │
│  Ver detalhes na Política ▸   │
│                               │
│  ☐ Autorizo o uso dos meus    │  ← opt-in ATIVO, não pré-marcado
│    dados de saúde para a      │
│    finalidade acima           │
│                               │
│  ☐ Quero dicas no WhatsApp    │  ← marketing SEPARADO (opcional)
│    (opcional)                 │
│                               │
│  [ Continuar ]                │  desabilitado sem o 1º checkbox
│  🔒 seus dados são            │  reforço de confiança (Musgo)
│     criptografados            │
└───────────────────────────────┘
```

### 9.5 Bloco 2 — Sua saúde + PAR-Q (com ramificação)

```
┌───────────────────────────────┐
│  Sua rotina · Sua saúde ·     │
│  Sobre você                   │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓░░░  parte 2/3    │
├───────────────────────────────┤
│  Algumas perguntas rápidas de │
│  segurança. Responda com      │
│  sinceridade — é pra te       │
│  proteger.                    │
│                               │
│  Você já sentiu dor no peito  │
│  ao fazer esforço físico?     │
│         [ Não ]   [ Sim ]     │  binário grande
│                               │
│  ⤷ se SIM:                    │  ramificação condicional
│  ┌─────────────────────────┐  │
│  │ Obrigada por contar.    │  │  sem alarme (Coral suave)
│  │ Isso é importante pra   │  │
│  │ sua segurança. Conta um │  │
│  │ pouco mais?             │  │
│  │ ( ...                 ) │  │
│  └─────────────────────────┘  │
│                               │
│  Tem alguma lesão hoje?       │
│  ▸ Ombro ▸ Joelho ▸ Coluna   │  chips multi-seleção
│  ▸ Nenhuma                    │
│                               │
│  Usa alguma medicação         │
│  contínua? ( opcional      )  │
│                               │
│  [ Voltar ]   [ Continuar ]   │
└───────────────────────────────┘
```

### 9.6 Tela de cuidado — gate PAR-Q bloqueante

```
┌───────────────────────────────┐
│  🛡  Antes de montar seu       │  fundo Petróleo Vivo, texto Névoa
│     treino, um cuidado a mais │  (tom sério, acolhedor)
├───────────────────────────────┤
│  Pelo que você contou, o      │
│  profissional de Educação     │
│  Física responsável vai       │
│  revisar suas respostas com   │
│  atenção antes de começar.    │
│                               │
│  Pode ser que ele peça uma    │
│  liberação médica — é o jeito │
│  mais seguro de treinar.      │
│  Isso NÃO é um "não". É       │
│  cuidado de verdade.          │
│                               │
│  [ Enviar liberação médica ]  │  upload foto/PDF (Verde Pulso)
│  [ Fazer isso depois no       │  → segue pro WhatsApp com MOVI
│    WhatsApp ]                 │
│                               │
│  Sem diagnóstico. Sem pressa. │  guardrail explícito
└───────────────────────────────┘
```

### 9.7 Bloco 3 — Sua rotina

```
┌───────────────────────────────┐
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  parte 3/3    │
├───────────────────────────────┤
│  Quase lá! Onde você treina?  │
│  ▸ Academia ▸ Em casa ▸ Ar    │  ← condicional: filtra equip.
│    livre                      │
│                               │
│  (se "Em casa") O que você    │
│  tem aí?                      │
│  ▸ Halteres ▸ Elástico ▸      │  só mostra equip. coerentes
│  ▸ Barra ▸ Só o peso do corpo │
│                               │
│  Quantos dias por semana dá   │
│  pra treinar?                 │
│  ▸ 2 ▸ 3 ▸ 4 ▸ 5+             │
│                               │
│  Melhor horário pra você?     │
│  ▸ Manhã ▸ Tarde ▸ Noite      │  ← alimenta negociação de hábito
│                               │
│  [ Voltar ]  [ Finalizar ]    │  → status=SUBMITTED
└───────────────────────────────┘
```

### 9.8 Tela de confirmação / micro-onboarding

```
┌───────────────────────────────┐
│         ●  (pulso animado)    │  ← Lottie do Pulso "respirando"
│                               │     (motion de Kimura)
│  Prontinho, Bruno! 🎉         │
│                               │
│  O profissional responsável   │  reforço CREF + expectativa
│  está preparando seu treino.  │
│  Ele chega no seu WhatsApp em │
│  até 2 horas.                 │  ← SLA público (Lucas)
│                               │
│  ┌─────────────────────────┐  │
│  │ 📲 Salve o número da    │  │  ← ação imediata (Lucas gap 4)
│  │    MOVIVO agora         │  │     aumenta entrega da 1ª msg
│  │  [ Salvar contato ]     │  │
│  └─────────────────────────┘  │
│                               │
│  [ Abrir conversa no         │  → deep link wa.me
│    WhatsApp ]                │
│                               │
│  Enviamos um resumo pro seu   │  transparência
│  e-mail também.               │
└───────────────────────────────┘
```

Decisão: transformar a "mensagem passiva" (Lucas) em **micro-onboarding ativo** — salvar contato + expectativa de SLA + abrir conversa. O Pulso animado dá percepção de "algo está acontecendo por você".

---

## 10. Dashboard de Operações do Profissional CREF

Superfície web (Next.js 15 + Socket.io, Rafael). Aqui a densidade e a clareza importam mais que o calor — referência Linear/Notion. Mesmo design system, com Petróleo Vivo como chrome e Verde/Coral como sinal.

### 10.1 Layout geral

```
┌──────────────────────────────────────────────────────────────┐
│ ● movivo · Operações        [🔔 3]   Prof. resp.: ___ CREF nº│
├────────────┬─────────────────────────────────────────────────┤
│ NAVEGAÇÃO  │  FILA DE ASSINATURA (3)          ● tempo real   │
│            │  ┌───────────────────────────────────────────┐  │
│ ▸ Fila (3) │  │ 🟠 Letícia S. · gerado há 8min           │  │
│ ▸ Flags    │  │    Hipertrofia · 4x/sem · academia        │  │
│   PAR-Q(1) │  │    [ Revisar e assinar ]                  │  │
│ ▸ Alunos   │  ├───────────────────────────────────────────┤  │
│ ▸ Respostas│  │ ⚪ Bruno M. · gerado há 22min             │  │
│   bloqueadas│ │    Emagrecimento · 3x/sem · casa          │  │
│ ▸ Métricas │  │    [ Revisar e assinar ]                  │  │
│            │  └───────────────────────────────────────────┘  │
│            │                                                  │
│            │  ⚠ FLAGS PAR-Q — PRIORIDADE (1)                 │
│            │  ┌───────────────────────────────────────────┐  │
│            │  │ 🔴 Diego A. · dor torácica em esforço     │  │
│            │  │    Status: BLOQUEADO — aguardando         │  │
│            │  │    liberação médica                       │  │
│            │  │    [ Ver caso ]  [ Liberar c/ ressalva ]  │  │
│            │  └───────────────────────────────────────────┘  │
└────────────┴─────────────────────────────────────────────────┘
```

### 10.2 Tela de revisão e assinatura de protocolo

```
┌──────────────────────────────────────────────────────────────┐
│ ← Voltar à fila        Letícia S. · v1 · gerado há 8min      │
├──────────────────────────────┬───────────────────────────────┤
│  PROTOCOLO (gerado)          │  CONTEXTO DO ALUNO            │
│                              │                               │
│  Fase: Hipertrofia (sem 1-8) │  Objetivo: hipertrofia        │
│  Frequência: 4x/semana       │  Nível: intermediário         │
│                              │  Local: academia              │
│  ▸ Treino A — Peito/Tríceps │  Lesões: nenhuma              │
│    Supino reto  3×8-10       │  PAR-Q: sem flags ✓          │
│    ...          mono         │  Idade 23 · 61kg · 165cm     │
│  ▸ Treino B — Costas/Bíceps │                               │
│  ▸ Treino C — Perna         │  REGRAS DO MOTOR QUE          │
│  ▸ Treino D — Ombro/Core    │  GERARAM ISTO ▸               │  ← auditabilidade
│                              │  (periodização, constraints)  │     (Rafael/AI Act)
│  [ Editar antes de assinar ] │                               │
│                              │  ┌─────────────────────────┐  │
│                              │  │ ✍ Assinar como RT       │  │
│                              │  │ Prof. ___ · CREF nº ___ │  │
│                              │  │ [ Assinar protocolo ]   │  │  login+ts+hash (Rafael)
│                              │  └─────────────────────────┘  │
└──────────────────────────────┴───────────────────────────────┘
```

Decisão: o profissional vê **o protocolo E as regras do motor determinístico que o geraram** (explicabilidade — requisito AI Act antecipado por Alexandre) e pode **editar antes de assinar** (supervisão real, não carimbo — a pré-condição de Gabriel). A assinatura registra `signed_at`, `professional_id`, `signature_hash`.

### 10.3 Timeline do aluno

```
┌──────────────────────────────────────────────────────────────┐
│ ← Alunos      Bruno M. · ATIVO · trial dia 4/7              │
├──────────────────────────────────────────────────────────────┤
│  ● Protocolo v1 assinado · 20/jul 14:32                       │
│  │  por Prof. ___ (CREF ___)                                 │
│  ● 1º treino reportado · 20/jul 19:10  ✓ aha moment          │  ← evento-chave
│  │  "achei o agacha difícil"                                 │
│  ● Check-in não aplicável (trial)                            │
│  ● Ajuste MOVI · 21/jul · reduziu carga agachamento          │
│  │  (dentro do protocolo assinado)                           │
│  ⚠ Resposta bloqueada · 22/jul · mencionou dor no joelho     │  ← flag compliance
│  │  [ Ver conversa ]  resposta-padrão enviada; requer você   │
│  ─────────────────────────────────────────────────────────  │
│  Consentimentos: saúde ✓ (v1.2) · marketing ✓ · idade ✓     │  ← trilha LGPD
│  [ Exportar dados do titular ]  [ Anonimizar / excluir ]     │  ← direitos LGPD Art.18
└──────────────────────────────────────────────────────────────┘
```

Decisão: a timeline serve **três funções** — clínica (o RT acompanha), de compliance (trilha de consentimento + respostas bloqueadas visíveis) e de direitos do titular (exportar/anonimizar, Art. 18, Alexandre). Respostas bloqueadas pela validação de IA aparecem aqui **em tempo real via Socket.io** para o profissional intervir.

---

## 11. Experiência Conversacional no WhatsApp (MOVI)

### 11.1 A persona MOVI

Formalizo a sugestão de Lucas: o AI Coach chama-se **MOVI**. Personalidade herdada de Gabriel — **Mentor-acessível + Companheiro**: fala "como quem manda áudio pro amigo", caloroso, direto, científico sem ser acadêmico, **nunca hypado**. MOVI se apresenta sempre como **ferramenta do profissional**, nunca como quem decide sozinho (guardrail de Alexandre).

**Transparência de IA (obrigatória — AI Act/Alexandre):** na primeira mensagem, MOVI declara que é uma assistente de IA supervisionada por um profissional CREF.

**Regras de formatação (Lucas/Rafael):** mensagens longas são quebradas em **múltiplas mensagens curtas** com "digitando…" entre elas (o micro-loop do Pulso "respirando" de Kimura vira o indicador de processamento). Nunca despejar um "documento".

### 11.2 Primeira mensagem — boas-vindas

```
MOVI:
Oi, Bruno! 👋 Eu sou a MOVI, sua assistente
de treino aqui no WhatsApp.

Antes de tudo, transparência: eu sou uma IA.
Mas o seu treino não é "coisa de robô" — ele foi
montado com base no método do(a) Prof. ___
(CREF ___), que é quem responde tecnicamente
por ele. Eu ajudo a adaptar pra você, no dia a dia.

[ pausa · digitando ]

Seu treino tá quase pronto. Enquanto isso,
me conta: você prefere treinar de manhã, tarde
ou à noite?

   [ Manhã ]  [ Tarde ]  [ Noite ]     ← max 3 quick replies
```

Decisão: transparência + reforço CREF logo de cara; termina com **pergunta de baixo atrito** (3 botões) que ativa o canal e coleta dado de hábito.

### 11.3 O aha moment — entrega do primeiro treino (gap 1 de Lucas)

O erro a evitar: enviar "o protocolo" como documento. A solução: MOVI apresenta **UM treino executável hoje** e negocia o compromisso.

```
MOVI:
Prontinho, Bruno! Seu treino tá montado e já
foi revisado pelo(a) Prof. ___ ✅

Não vou te mandar um monte de coisa de uma vez.
Bora começar pelo mais importante: o de HOJE.

[ digitando ]

🔥 TREINO A — Peito e Tríceps  (uns 45 min, em casa)
1. Flexão de braço — 3x até dar
2. Supino com halteres — 3x10
3. Tríceps no banco — 3x12
(explico cada um quando você chegar lá, relaxa)

Bora fazer hoje? Qual horário fecha pra você?

   [ Hoje à noite ]  [ Amanhã cedo ]  [ Ver treino completo ]
```

Se o usuário escolhe um horário → MOVI confirma e agenda um lembrete gentil ("Marquei aqui! Te chamo mais tarde 💪"). O "Ver treino completo" abre um **link** (PDF/web legível — CTA fora do WhatsApp) para os curiosos, sem poluir o chat.

**Fechamento do loop do aha moment** — quando o usuário reporta o primeiro treino:

```
Usuário: fiz! o agacha tava difícil
MOVI:
Isso, Bruno! Primeiro treino feito ✅ é assim
que começa 🎉

Anotei que o agachamento pegou pesado — na
próxima eu já ajusto a carga pra ficar no ponto
certo pra você. Seu retorno muda o treino de
verdade.

Como você tá se sentindo agora?
   [ 😊 De boa ]  [ 😮‍💨 Cansado ]  [ 😣 Dolorido ]
```

Isto é o **feedback loop visível** que Lucas exigiu: o usuário vê que o report dele mudou o treino — a diferença entre "coaching real" e "pesquisa". (Se a resposta for "😣 Dolorido" com menção a dor articular, a validação de compliance de Rafael dispara handoff/resposta-padrão + flag no dashboard.)

### 11.4 Escopo do AI Coach e handoff humano

MOVI responde: substituição de exercício (motor determinístico), execução/técnica, motivação, dúvidas gerais de treino (RAG). MOVI **não** responde e redireciona com elegância: nutrição clínica, suplementação, dor persistente/patologia — sempre com *"isso foge do que eu posso orientar com segurança; melhor falar com [médico / o profissional responsável]"*. Handoff humano acessível ("quero falar com o profissional") — direito de contestação (Alexandre/AI Act).

### 11.5 Check-in semanal (pós-conversão)

Estruturado em **máximo 3 perguntas via quick reply** (benchmark WhatsApp: 3 botões é o teto). Abre sempre com **vitória** (positivity bias — Lucas):

```
Segunda, 08:30 —
MOVI:
Bom dia, Bruno! 🌤 Semana nova.

Primeiro: você treinou 3x essa semana. Semana
passada foram 2. Tá subindo 📈 orgulho de você.

Como foi o peso dos treinos, no geral?
   [ 🟢 Tranquilo ]  [ 🟡 No ponto ]  [ 🔴 Puxado ]

(2 perguntas rápidas e te deixo em paz 😄)
```

Depois: pergunta 2 (treinos completados — confirma/ajusta a contagem da North Star) e pergunta 3 (algo pra ajustar?). **Fechamento com loop visível:**

```
MOVI:
Fechou! Com base no que você falou, ajustei seu
treino de quarta: reduzi a carga do agachamento
e coloquei um exercício de mobilidade pro joelho.
Tudo dentro do que o(a) Prof. ___ aprovou.

Bora pra mais uma semana 💪
```

**Timing:** segunda 08:00-10:00 (Rafael/Lucas), mas A/B contra domingo à noite. Sempre **conversa iniciada no template mínimo**, maximizando a janela de 24h gratuita (FinOps de Eduardo).

---

## 12. Resolução dos 4 Gaps de UX de Lucas

### Gap 1 — Ausência de "aha moment" (resolvido em 11.3)
- **Antes:** protocolo entregue como documento passivo.
- **Design:** MOVI apresenta um único primeiro treino executável hoje + negocia horário + fecha o loop quando reportado. Meta: primeiro treino em 48h ≥ 50%. Reforço proativo no dia 2 se não houver report ("Vi que seu treino chegou — como foi?").

### Gap 2 — Abandono do formulário (resolvido em 8.2-8.4)
- **Antes:** anamnese monolítica, 60-70% de abandono.
- **Design:** conversacional, 3 blocos, progresso rotulado, salvamento por PATCH, retomada por token (+1h de lembrete), consentimento como tela-ponte (não muro). Meta: conclusão ≥ 65%.

### Gap 3 — Falta de reengajamento entre check-ins (novo fluxo)
- **Antes:** silêncio entre check-ins; inativos sem win-back.
- **Design — escada de reengajamento (respeitando custo de template):**
  - **Micro-nudge dentro da semana** (dia 3-4 sem atividade): MOVI puxa conversa leve *"E aí, Bruno, o treino de hoje tá de pé? Se tiver corrido, dá pra fazer a versão de 20 min 💪"* — sempre com uma saída fácil (versão reduzida), nunca cobrança culpada.
  - **Win-back de inativo (2 semanas sem responder):** mensagem sem julgamento (Duolingo-like, "consistência acima de perfeição" — valor de Gabriel) + oferta de **protocolo simplificado de retorno**: *"Sumiu e tá tudo bem — acontece com todo mundo. Quer voltar com um treino levinho de reinício, só pra destravar?"* → `[ Bora voltar ]  [ Semana que vem ]`.
  - Meta: reengajamento de inativos ≥ 30% (Lucas).

### Gap 4 — Ausência de offboarding que converta cancelamento em pausa (novo fluxo)
- **Antes:** cancelamento = perda total.
- **Design — offboarding com dignidade (Peak-End Rule):** o cancelamento é **self-service** (obrigação legal, Alexandre/Decreto 11.034) — nunca dark pattern (proibido por Alexandre). Mas antes do "confirmar", MOVI oferece alternativas reais:

```
Usuário: quero cancelar
MOVI:
Entendido, Bruno — sem burocracia, você cancela
quando quiser. Só antes, me deixa entender pra
te ajudar melhor:
   [ Tá caro agora ]  [ Sem tempo ]  [ Outro motivo ]

(se "Sem tempo")
Que tal PAUSAR em vez de cancelar? Seu treino e
seu histórico ficam guardados, você não paga
nada, e quando voltar é só me chamar — a gente
continua de onde parou.
   [ Pausar 30 dias ]  [ Ainda quero cancelar ]
```

- "Tá caro" → oferta do plano mais barato/downgrade de período (Eduardo: anual R$29/mês) antes de perder. "Ainda quero cancelar" → cancelamento imediato + pesquisa de saída de 1 pergunta + porta aberta ("quando quiser voltar, tô aqui"). O estado `PAUSED` já existe no schema de Rafael. Isto converte churn em **hibernação reversível**.

---

## 13. UX Writing / Microcopy — Guardrails Regulatórios

Princípios de voz (Gabriel) filtrados pelos guardrails (Alexandre). Tabela de referência para o time:

| Contexto | ❌ Nunca escrever | ✅ Escrever |
|---|---|---|
| Geração do treino | "A IA prescreveu seu treino" | "Seu treino, montado com o método do Prof. ___ (CREF ___) e adaptado por mim" |
| Resultado | "Emagreça 5kg garantido", "resultado garantido" | "Bora construir consistência — é o que traz resultado de verdade" |
| Saúde/dor | "Você está com tendinite", "isso trata sua dor" | "Isso foge do que posso orientar com segurança — vale procurar um médico" |
| PAR-Q de risco | "Você não pode treinar" / "você está doente" | "Um cuidado a mais pra você começar seguro" |
| IA | (esconder que é IA) | "Sou uma IA, supervisionada por um profissional CREF" |
| Cancelamento | (esconder o botão / fricção) | "Você cancela quando quiser, sem burocracia" |
| Erro de form | "Campo inválido!" (vermelho-alarme) | "Ops, faltou o DDD aqui 🙂" (Coral, gentil) |

**Termos proibidos hard-coded** (alinhar com a validação pós-geração de Rafael): prescrever, prescrição, diagnóstico, diagnosticar, tratamento, tratar, cura, curar, garantido, garantia de resultado. Toda saída de MOVI passa por esse filtro antes de ir ao usuário.

---

## 14. Acessibilidade (WCAG 2.2 AA) — Dashboard e Web

Foco no dashboard web (o WhatsApp é acessível pelo próprio app, mas cuidamos de texto claro e alt em mídia). Requisitos para Felipe implementar:

- **Contraste (1.4.3):** seguir as regras de Kimura — Grafite/Petróleo sobre Névoa/Branco (13:1 e 15:1, AAA); Verde Pulso e Coral **nunca** como texto pequeno sobre claro (reprovam AA) — só em fundo, ícones grandes, realces. Sinais de status (🔴🟠🟢) sempre acompanhados de **rótulo textual** (não depender só de cor — 1.4.1 Uso de cor).
- **Navegação por teclado (2.1.1):** toda a fila, revisão e assinatura operáveis por Tab/Enter; foco visível (anel Verde Pulso 2px, 2.4.7). Ordem de foco lógica (2.4.3).
- **Semântica e leitores de tela (1.3.1, 4.1.2):** HTML semântico, ARIA em componentes custom, live region para as **notificações Socket.io** (`aria-live="polite"`) — o profissional cego percebe um novo caso na fila.
- **Alvos de toque (2.5.8):** mínimo 24×24px (AA); adotamos 44×44px real no mobile (Fitts).
- **Formulário de anamnese (3.3):** labels associados, mensagens de erro programáticas e descritivas, `autocomplete` em campos de identificação, nunca só placeholder como label.
- **Movimento (2.3.3):** o Pulso animado respeita `prefers-reduced-motion` (Kimura previu Lottie leve; degradar para estático).
- **Timeout (2.2.1):** a expiração de 72h da sessão de anamnese é longa e comunicada; não há timeout de curto prazo que penalize.

---

## 15. Aplicação do Design System "O Pulso" (Kimura) — Tokens

Tokens de design entregues para Felipe (base para Tailwind/shadcn):

```
Cores
  --petroleo-vivo: #06302A;   /* chrome escuro, avatar, headers sérios */
  --verde-pulso:   #25E27E;   /* CTA, realce, progresso, sucesso */
  --coral-vivo:    #FF6A3D;   /* calor, alerta gentil, "puxado" */
  --nevoa:         #F4F7F3;   /* fundo claro */
  --grafite:       #14201C;   /* texto corpo sobre claro */
  --musgo:         #5B6B63;   /* texto secundário, desabilitado, bordas */
  --branco:        #FFFFFF;

Tipografia
  --font-ui:   'Hanken Grotesk', sans-serif;   /* títulos, corpo, UI */
  --font-mono: 'JetBrains Mono', monospace;     /* números: peso, séries, CREF nº, semana */
  escala: Display 40-56 / H1 32 / H2 24 / H3 20 / corpo 16 (mín 14) / label 13-14
  entrelinha corpo 1.4-1.6

Regras de cor (WCAG, herdadas de Kimura)
  - Verde Pulso/Coral: só fundo, ícone grande, realce — NUNCA texto pequeno sobre claro
  - Texto sobre claro: Grafite ou Petróleo
  - Par proprietário: Verde Pulso SOBRE Petróleo (nunca verde isolado adjacente ao verde do WhatsApp)

Componentes-chave (mapeados aos wireframes)
  - Chip de seleção (objetivo, nível, equipamento) — estados: default Névoa/Musgo, selecionado Verde/Petróleo
  - Barra de progresso rotulada (form)
  - Card de fila (dashboard) com badge de status
  - Botão primário (Verde Pulso s/ Petróleo) / secundário (outline Musgo)
  - Indicador "MOVI digitando" = Pulso respirando (escala 100↔108%, Kimura motion)
  - Selo CREF (mono + ícone-selo linha, sóbrio)

Ícones: linha, stroke 2px, cantos arredondados (grid 24px) — vocabulário de Kimura
  (anamnese, treino do dia, séries, feedback fácil/médio/difícil, casa vs academia,
   descanso, CREF, cadeado/LGPD). Nunca haltere/chama como símbolo de marca.
```

---

## 16. Impacto Esperado, Métricas e Plano de Validação

### 16.1 Impacto esperado

| Alavanca de design | Métrica-alvo | Gap/risco endereçado |
|---|---|---|
| Form conversacional 3 blocos + progresso + save | Conclusão ≥ 65% | Gap 2 / Risco 1 |
| Aha moment orquestrado | 1º treino em 48h ≥ 50% | Gap 1 / Risco 2 |
| Check-in com loop visível | Resposta ao check-in ≥ 55% | Gap 3 |
| Reengajamento/win-back | Reativação inativos ≥ 30% | Gap 3 |
| Offboarding-pausa | ≥ 20% dos cancelamentos viram pausa/downgrade | Gap 4 |
| Confirmação micro-onboarding | Confirmação do nº WhatsApp ≥ 90% | Ativação |

### 16.2 Métricas de UX a instrumentar (com Felipe/PostHog)

- **Task success / completion rate** por bloco (`form_block_completed` 1/2/3) e **drop-off por bloco** (identifica o campo-vilão).
- **Time-on-task** do formulário (meta: mediana ≤ 4 min).
- **Error rate** por campo (validações disparadas).
- **CES (Customer Effort Score)** pós-confirmação: "Quão fácil foi se cadastrar?" (1 pergunta).
- **SUS (System Usability Scale)** no dashboard CREF com o profissional (meta ≥ 75).
- **CSAT inline** das respostas de MOVI (thumbs up/down — meta ≥ 80% positivo).
- **Funil de ativação:** form_submitted → protocol_sent → 1º treino reportado → conversão.

### 16.3 Plano de validação

- **Onda 0 (protótipo, pré-código):** teste de usabilidade moderado do fluxo de anamnese com **5-8 pessoas do perfil** (base do Cahuã) em protótipo Figma clicável — foco no Bloco 2 (saúde) e na tela-ponte de consentimento (o ponto de maior fricção). Card sorting rápido dos campos para confirmar a ordem dos 3 blocos.
- **Onda 1 (concierge/beta — alinhado a Helena/Eduardo):** teste não-moderado com Maze no formulário real; **A/B** de (a) timing do check-in (domingo à noite vs. segunda de manhã) e (b) copy do aha moment. Session replay (PostHog/Clarity) para caçar fricção no mobile.
- **Onda 2 (escala):** teste de usabilidade do dashboard com o profissional CREF (SUS); revisão de acessibilidade com leitor de tela; iteração do offboarding com dados reais de motivo de churn.

---

## 17. Próximos Passos e Recomendações para os Próximos Agentes

**Para Lucas (retroativo):** atualizar o Épico 5 (conversão) para **trial de 7 dias** com sequência comprimida (dias 2/4/6/7), conforme decisão de Eduardo; incorporar o offboarding-pausa e a escada de reengajamento como user stories do Épico 6.

**Para Rafael/Leonardo (backend):** o fluxo de consentimento exige `consents` com **versão do texto** referenciando artefato imutável (validado por Alexandre). O gate PAR-Q precisa dos estados `LIBERADO / BLOQUEADO_AGUARDANDO_CLEARANCE / LIBERADO_COM_RESSALVA_RT` — nenhum protocolo é gerado em estado bloqueado. O estado `PAUSED` (já no schema) suporta o offboarding-pausa. Upload de atestado precisa de endpoint.

**Para Victor (IA):** MOVI precisa (a) do filtro de termos proibidos na saída (seção 13), (b) do padrão de "quebrar mensagens longas em curtas com digitando", (c) da lógica de fechamento de loop no check-in ("ajustei X por causa do seu feedback Y"), (d) da pseudonimização antes do LLM (Alexandre BL2) — nenhum identificador direto no prompt.

**Para Felipe (frontend):** tokens da seção 15 → Tailwind config; formulário conversacional com PATCH por bloco; dashboard com Socket.io + `aria-live`; WCAG 2.2 AA; `prefers-reduced-motion`. Entrego os wireframes como especificação; protótipo Figma de alta fidelidade é a próxima etapa.

**Para Sato (segurança):** a tela-ponte de consentimento e a timeline do titular (exportar/anonimizar) são superfícies que tocam dados sensíveis — revisar com RLS e mascaramento no dashboard.

**Para Helena (marketing):** o pré-qualifying de objetivo na landing e o selo CREF como elemento de conversão estão desenhados; os assets do Pulso animado e stickers (munição que Kimura preparou) encaixam no reengajamento.

**Entregáveis desta etapa (nesta pasta / a produzir no Figma):** fluxo de anamnese, wireframes das 3 superfícies, especificação de microcopy com guardrails, tokens de design, plano de testes. Protótipo de alta fidelidade e handoff visual detalhado no Figma são a continuação natural, condicionados à liberação da marca no INPI (trava herdada de Kimura/Alexandre — MOVIVO × VIVO).

---

## Fontes Consultadas

- Conversational form design in 2026 — Jotform: https://www.jotform.com/blog/conversational-form-design/
- Conversational Forms vs Traditional Forms [2026 Data] — TinyCommand: https://tinycommand.com/blogs/conversational-forms-vs-traditional-forms-which-is-better-for-your-business
- Form Conversion Rate Benchmarks 2026 — Digital Applied: https://www.digitalapplied.com/blog/form-conversion-rate-benchmarks-2026-data-points
- Multi-Step Form Best Practices 2026 — Anve: https://voiceforms.anvevoice.app/blog/multi-step-form-best-practices/
- The Science Behind Conversational Form Completion Rates — Gnosari: https://gnosari.com/blog/conversational-completion-rates
- Multi-Step Form Drop-Off Rates — Reform: https://www.reform.app/blog/multi-step-form-drop-off-rates-how-to-reduce-them
- Ultimate WhatsApp Business buttons guide 2025 — Cue: https://www.cuedesk.com/blog/a-guide-to-whatsapp-buttons-everything-you-need-to-know
- WhatsApp Interactive Buttons: Reply Buttons vs List Messages (2026) — WABA NXCMSG: https://waba.nxccontrols.in/blog/whatsapp-interactive-buttons-guide
- WhatsApp Business Buttons — Infobip: https://www.infobip.com/blog/how-to-use-whatsapp-interactive-buttons
- How UX/UI Design Drives Engagement in Health & Wellness Apps (2026) — Diversido: https://www.diversido.io/blog/how-does-ux-ui-impact-your-wellness-app
- Chat UI Design 2026 — UXPin: https://www.uxpin.com/studio/blog/chat-user-interface-design/
- WCAG 2.2 (referência de conformidade AA) — W3C: https://www.w3.org/TR/WCAG22/

**Fontes internas do pipeline:** 02-relatorio-gabriel.md, 04-relatorio-kimura.md, 08-relatorio-lucas.md, 06-relatorio-alexandre.md, 07-relatorio-eduardo.md, 10-relatorio-rafael.md.

> **Limitações de pesquisa declaradas:** (1) WebSearch é US-only e retorna majoritariamente agregadores em inglês; os benchmarks de completion rate/WhatsApp buttons são direcionais, a validar com testes na base real do Cahuã. (2) Não há benchmark público de UX de "coaching de treino via WhatsApp com CREF no Brasil" — as decisões apoiam-se em princípios consolidados (Fitts, Hick, Peak-End, WCAG) + análise de produtos análogos. (3) Os wireframes em texto são especificação de baixa/média fidelidade; a validação visual e de interação exige protótipo Figma de alta fidelidade (próxima etapa). (4) Métricas-alvo herdam as metas de Lucas/Helena/Eduardo e são hipóteses a calibrar no beta.
