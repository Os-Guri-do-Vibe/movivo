# Sprint 8 — Os dados que nunca foram gravados: North Star real, atribuição, custo, lucro e distribuição (MOVIVO)

**Autor:** Lucas Monteiro (Senior Product Manager / Product Owner — agente #08)
**Data:** 2026-08-13
**Ideia:** MOVIVO — AI Coach de treino no WhatsApp (`docs/fitness-ia-whatsapp/`)
**Fase do pipeline:** Fase 5 — Desenvolvimento (Sprint 8)
**Duração alvo:** 2 semanas (10 dias úteis) · 3 devs co-fundadores (Leonardo, Felipe, Henrique) + QA (Mariana), com revisão de segurança de Sato, especificação de IA de Victor, validação de definições financeiras de Eduardo e validação jurídica de Alexandre
**Documento-fonte principal:** `sprint/sprint-7-plataforma-fundadores.md` (seção *Backlog priorizado subsequente — Sprint 8*) e `sprint/sprint-7-revisao-seguranca-sato.md` (ressalvas não bloqueantes herdadas)
**Documentos-fonte secundários:** `docs/arquitetura/ARQUITETURA.md` (§6 filas, §8 RLS, §12 regras inegociáveis) · `docs/fitness-ia-whatsapp/07-relatorio-eduardo.md` (pricing, unit economics, LTV/CAC, Simples Anexo III) · `05-relatorio-helena.md` (funil, CAC por canal, payback) · `08-relatorio-lucas.md` (North Star) · `06-relatorio-alexandre.md` (LGPD, dado de saúde, retenção) · `11-relatorio-sato.md` (RBAC/RLS, integridade de webhook) · `CLAUDE.md` (guardrails de linguagem, split societário 20% cada)

---

## Como ler este documento

Hierarquia: **Épicos → User Stories (US-8.x) → Tasks (TASK-8.x.y)** — mesmo padrão da Sprint 7.

- Cada **User Story** declara: agentes participantes, dependências (depende de / habilita), jornada (o que se constrói e por quê), objetivo, resultado esperado, tasks e **Definição de Pronto (DoD)**.
- Cada **Task** declara: agente executor, instruções acionáveis e critério de conclusão objetivo.
- Uma User Story só é **ENTREGUE** quando **todas** as suas tasks estiverem finalizadas **E validadas** conforme o DoD.

---

## Decisão de escopo — o que entra, o que sai, e por quê

O pedido do fundador para esta rodada foi: *"planejar a Sprint 8 como continuidade direta do painel, para implementarmos tudo"*. **Interpretação correta e aceita:** avançar pelo roadmap que eu mesmo desenhei na Sprint 7, sem abrir escopo novo. **É exatamente o que este documento faz — com uma correção de carga que preciso declarar de frente.**

O backlog original que escrevi para a Sprint 8 tinha **7 itens (US-8.1 a US-8.7)**. Ao detalhá-los em tasks, a conta ficou assim:

- **7 tabelas novas** (`workout_completions`, `user_status_transitions`, `ad_spend`, `expenses`, `payments`, `model_pricing`, `partners`) + **1 alteração de schema** (5 colunas de UTM em `anamnesisSessions`);
- **1 integração externa nova de escrita** (webhook de liquidação do gateway — Stripe/Asaas), que é a primeira superfície em que **dinheiro entra no sistema por um caminho que não é o nosso**;
- **1 mudança no caminho de runtime do AI Coach** (FAQ determinístico entre o guardrail clínico e o classificador de intenção — o item US-8.6 original);
- **1 mecanismo de configuração L1** (guardrails aditivos `FLAG` — o item US-8.7 original).

**Decisão: os dois últimos itens (FAQ determinístico e guardrails L1 aditivos) saem da Sprint 8 e vão para a Sprint 9.** Justificativa factual, não conservadorismo:

1. **Coerência de tese.** A Sprint 8 tem uma tese única e limpa — *gravar o que nunca foi gravado*. Nenhum item dela toca o que a IA responde para o aluno. FAQ e guardrails `FLAG` são as duas únicas peças do lote original que **alteram o caminho de execução do AI Coach em produção**. Misturá-las numa sprint de 7 tabelas significa que a mesma revisão de Sato e a mesma suíte de Mariana precisam cobrir, no mesmo ciclo, integridade financeira **e** comportamento de modelo. São dois tipos de risco que não se revisam bem juntos.
2. **O FAQ pertence ao lado do simulador, não ao lado das migrations.** `faq_entries` guarda **texto que vai literalmente para o WhatsApp do aluno**, publicado por painel, sem passar por LLM — ou seja, sem passar por nenhum dos guardrails de saída que hoje protegem a resposta. Validar por `LANGUAGE_RULES` na gravação (como eu mesmo escrevi no backlog) é necessário e **não é suficiente**: uma resposta de FAQ correta em linguagem pode ainda assim ser errada em conteúdo, e não existe golden set cobrindo respostas estáticas. A Sprint 9 é a sprint que **estende o aparato de segurança ao painel**. O FAQ é um caso de publicação por painel. Ele pertence lá.
3. **Guardrails `FLAG` são L1 por definição minha na Sprint 7** ("nada de L1 é liberado para edição nesta sprint — o simulador é Sprint 9"). Eu argumentei no backlog que `FLAG` é seguro por não alterar a resposta. Continua verdade, e continua sendo o item mais fraco em valor de negócio do lote: ele não destrava **nenhuma** métrica hoje rotulada como indisponível. Numa sprint com 7 migrations e um webhook de dinheiro, é o primeiro item a sair.
4. **O que não sai:** `partners`/distribuição por sócio (US-8.7 aqui) fica, apesar de depender de `expenses`+`payments`. É uma tabela de 4 colunas e uma divisão aritmética sobre o lucro da US-8.4/8.5 — o custo é baixo e é **o payoff visível** do pedido "ganhos por sócio". Cortá-la economizaria pouco e entregaria a sprint sem a resposta que o fundador mais espera ver.

**Fato vs. opinião, explícito:** é *fato* que as 7 tabelas e o webhook são o que falta para os indicadores hoje rotulados "indisponível" existirem — as dependências foram nomeadas uma a uma nas telas da Sprint 7. É *opinião minha como PM*, com o histórico de 7 sprints deste time, que **7 tabelas + 1 webhook + a reconciliação de todas as telas da Sprint 7 cabe em 10 dias úteis**, e que somar a isso duas mudanças no runtime da IA **não cabe**.

> **Nota ao fundador — o que a Sprint 8 NÃO vai resolver, e você vai notar no dia 10:** o **FAQ continuará com estado "em breve"** no pilar IA (agora apontando para a Sprint 9, não mais para a 8 — o documento da Sprint 7 dizia 8, e este documento corrige esse rótulo dentro do produto, TASK-8.8.3). **Projeção de lucro com cenários continua não existindo** — a Sprint 8 entrega lucro *realizado*, não *projetado*; projetar exige a série histórica que esta sprint começa a acumular, e por isso a projeção permanece na Sprint 11. E o **CAC por canal só valerá para quem se cadastrar depois do dia em que a US-8.2 subir** — atribuição não é retroativa; todo aluno anterior fica com origem `desconhecida`, para sempre.

---

### Base já entregue pelas Sprints 0-7 (não reconstruir — consumir)

- **5 pilares + Visão Geral + RBAC por capability + rota padrão por papel (Sprint 7, US-7.1).** Toda tela desta sprint **mora dentro de um pilar existente**. Nenhum item de menu novo é criado, exceto os que já foram criados na Sprint 7 em estado "em breve" (Custos, Resultado & Projeção, Sócios & Distribuição, Aquisição & Canais, Campanhas & Experimentos) — esta sprint **preenche** essas telas.
- **Mecanismo de capabilities + `ADMIN_INHERITANCE_DENYLIST` (Sprint 7, TASK-7.1.2).** Capabilities novas entram nesse mecanismo; nenhuma alteração no núcleo de RBAC é necessária.
- **`FINANCE_WRITE` e `MARKETING_WRITE` já existem desde a Sprint 7**, criadas justamente para governar o lançamento manual desta sprint. Elas param de ser "reservadas" e passam a ser usadas.
- **`AuditService.append` append-only com hash chain (Sprint 1).** Todo lançamento financeiro manual e toda edição de cap table reusam este serviço. **Não se cria trilha nova.**
- **Padrão append-only + trigger 55000 + REVOKE, provado contra Postgres real (`agent-config-immutability.int-spec.ts`, Sprint 7).** `user_status_transitions` e `payments` reusam **exatamente esse padrão**, incluindo o teste de integração como molde.
- **RLS por `app.current_role` + `SET LOCAL` (Sprint 5).** Toda tabela nova nasce com política declarada em `security-policies.ts`; nenhuma nasce "aberta para depois fechar".
- **k-anonimato (n ≥ 10) já implementado**, com `kAnonymousCount` validando no contrato compartilhado (Sprint 7). Coortes de aquisição por canal reusam o mesmo mecanismo.
- **Rotulagem honesta de indicador indisponível (Sprint 7, TASK-7.2.4).** O mecanismo de "indisponível — depende de X, previsto para a Sprint N" já existe e é o que esta sprint **desliga um a um**.
- **Custo de IA por constante versionada em código (Sprint 7, TASK-7.2.3),** com o ponto de substituição **já marcado no código** para receber `model_pricing`. A US-8.4 só troca a fonte.
- **`subscriptions` com `currentPeriodEnd`, `plan`, `canceledAt`, `cancelReason` (Sprint 4)** — a receita **contratada** já é conhecida. Esta sprint acrescenta a receita **recebida**, que é outra coisa.
- **`checkins` com `respondedAt`/`completedAt` e `responses` cifrado (Sprint 5).** O check-in semanal é o **canal de fallback** de registro de treino concluído (US-8.1), não um sistema novo.
- **PII Scrubber + `health-cipher`/pgcrypto.** Qualquer campo de texto livre introduzido nesta sprint (descrição de despesa, nota de lançamento) passa pelo scrubber antes de ir para log.

---

### Regras inegociáveis que valem nesta sprint

1. **Dinheiro é `integer` em centavos, nunca `float`.** Todas as tabelas novas com valor monetário (`expenses`, `payments`, `ad_spend`) usam inteiro em centavos + campo de moeda (`BRL`). Ponto flutuante em valor financeiro é bug que aparece depois de 300 linhas, quando ninguém mais lembra.
2. **Nenhum número financeiro exibido sem origem declarada.** Toda métrica nova diz de onde veio (contratado vs. recebido vs. lançado manualmente) e em que data foi apurada. "Lucro" sem dizer se é caixa ou competência é número inútil para decidir.
3. **Receita contratada ≠ receita recebida.** As duas coexistem na tela, nomeadas, **nunca somadas** e nunca substituindo uma à outra. A Sprint 7 entregou a primeira; esta entrega a segunda.
4. **Webhook de liquidação é idempotente e autenticado por assinatura.** Evento repetido não duplica `payments`; evento sem assinatura válida é rejeitado e registrado. Gateway reenvia — é comportamento normal do protocolo, não exceção.
5. **Append-only onde o histórico é a informação.** `user_status_transitions` e `payments` nunca sofrem `UPDATE` — garantido por trigger + REVOKE no banco, no mesmo padrão de `agent_config`, **não por convenção de código**. Correção de lançamento é linha nova de estorno, nunca edição da linha original.
6. **Lançamento manual é auditado.** Toda escrita de `expenses`, `ad_spend` e `partners` passa por `AuditService.append` (quem, quando, valor anterior → novo, motivo). Sem exceção.
7. **Cap table é dado sensível de negócio, não dado operacional.** `partners` fica sob capability própria (`PARTNERS_READ`/`PARTNERS_WRITE`), **jamais** sob `FINANCE_READ` genérica: quem apura despesa não precisa ver quanto cada sócio recebe.
8. **UTM é dado de origem, não identificador.** Nenhum parâmetro de URL vira chave de negócio, nada vindo de query string é confiado sem validação (allowlist de charset + limite de tamanho), e `referrer` é truncado ao host — URL completa de referência pode carregar PII de terceiro.
9. **Nenhuma tabela nova relaxa RLS.** Toda leitura continua sob `SET LOCAL app.current_role`; nenhum endpoint aceita `user_id` vindo do cliente; agregados por canal respeitam k-anonimato.
10. **Guardrails de linguagem valem na UI do painel** (CLAUDE.md, Sofia §13): nenhum rótulo, tooltip ou texto de ajuda desta sprint usa "diagnóstico", "tratamento", "cura" ou "resultado garantido"; a IA é sempre descrita como **ferramenta do profissional CREF**, nunca como quem decide. Vale inclusive na copy da mensagem de WhatsApp da US-8.1 — treino registrado **não** é "evolução do quadro", é "treino registrado".
11. **Todo merge para `main`** passa por PR + os 6 checks verdes do CI; cobertura ≥80%; testes de append-only, idempotência de webhook, RBAC das capabilities novas, conferência numérica de lucro e k-anonimato de coorte **bloqueantes**. Nenhum push direto.

---

# ÉPICO 11 — Registro de atividade real do aluno (North Star e coortes)
# ÉPICO 12 — Atribuição de aquisição (de onde vem o aluno e a que custo)
# ÉPICO 13 — Resultado financeiro real (custo, liquidação, lucro e distribuição)

### Descrição

A Sprint 7 montou a casa e ligou tudo o que já existia no schema. O resultado honesto — e previsto — foi um painel em que **três das perguntas mais importantes do fundador aparecem rotuladas como "indisponível"**: *quantos treinos meus alunos realmente fazem?*, *de onde vem cada aluno e a que custo?* e *quanto sobra no fim do mês, e quanto é de cada sócio?*. Nenhuma das três é problema de tela. As três são a mesma coisa: **o sistema nunca gravou o dado.**

O Épico 11 grava a atividade: `workout_completions` (o treino que o aluno de fato fez, reportado por ele) e `user_status_transitions` (append-only, cada mudança de estado do aluno com timestamp). O primeiro destrava a **North Star do produto** — *Treinos Concluídos por Usuário Pago nos Primeiros 30 Dias, meta ≥8* (Lucas, `08-relatorio-lucas.md`) — que desde o dia 1 do projeto é a métrica que define se o produto funciona, e que até hoje nunca teve como ser medida. O segundo destrava conversão trial→ativo e **coortes corretas**: hoje o sistema sabe o estado *atual* do aluno e esquece como ele chegou lá, o que torna qualquer análise de coorte uma reconstrução por inferência.

O Épico 12 grava a origem: 5 colunas de UTM em `anamnesisSessions` e a tabela `ad_spend` de investimento por canal. **É a entrega mais urgente da sprint e não é a mais valiosa** — a distinção importa: seu valor só aparece daqui a semanas, mas cada dia sem ela é histórico de aquisição perdido de forma **irrecuperável**. Não existe migration que recupere a origem de um aluno que já se cadastrou. Por isso a US-8.2 é a única desta sprint com prazo interno de **dia 2**, e é deliberadamente pequena o suficiente para caber nele.

O Épico 13 grava o dinheiro que sai e o dinheiro que efetivamente entra: `expenses` (despesa lançada), `model_pricing` (preço por modelo, substituindo a constante em código da Sprint 7), `payments` + webhook de liquidação (receita **recebida**, distinta da contratada) e `partners` (cap table com o split 20% já definido). Com os quatro, **"lucro" e "ganhos por sócio" deixam de ser telas explicativas e passam a ser números** — e, crucialmente, números que Eduardo consegue reconciliar com a planilha do CFO, que é o único teste que importa: painel que diverge da planilha na primeira conferência perde a confiança do fundador e não recupera.

### Objetivo

Ao final da Sprint 8: nenhum indicador do Financeiro, do Marketing ou de Alunos exibe "indisponível" por falta de tabela; a North Star mostra número real; todo aluno cadastrado a partir do dia 2 tem origem conhecida; o fundador vê lucro do período e quanto cabe a cada sócio, com a apuração conferida contra cálculo manual.

### Resultado esperado dos épicos

- **`workout_completions`** gravando treino reportado pelo aluno via WhatsApp (canal primário) e via check-in semanal (fallback), com a **North Star exibindo número real** e a taxa de reporte declarada na própria tela.
- **`user_status_transitions`** append-only, com conversão trial→ativo e coortes mensais corretas.
- **UTM capturado** no primeiro toque e persistido em `anamnesisSessions`; origem visível na ficha do aluno e agregável por canal.
- **`ad_spend`** com lançamento manual sob `MARKETING_WRITE`, produzindo **CAC por canal, ROAS e LTV/CAC por origem**, com a meta LTV/CAC ≥ 3 e payback ≤3 meses de Eduardo visíveis como referência na tela.
- **`expenses` + `model_pricing`** com custo total do período por categoria, custo de IA vindo de tabela editável (não mais de constante), e **custo por usuário ativo/mês**.
- **`payments` + webhook idempotente** com receita **recebida** vs. **contratada**, inadimplência e ciclo de liquidação.
- **`partners` + distribuição**, sobre lucro real, sob capability própria.
- **Todas as telas da Sprint 7 reconciliadas:** cada rótulo "indisponível — previsto para a Sprint 8" ou vira número, ou tem sua dependência reapontada para a sprint correta.
- **Quality gate bloqueante:** append-only, idempotência de webhook, RBAC das capabilities novas, k-anonimato de coorte, conferência numérica de lucro/CAC/North Star, ausência de PII em log financeiro. CI verde, cobertura ≥80%.

### Não-escopo desta sprint (explícito — nada foi descartado)

| Item | Por que não agora | Onde entra |
|---|---|---|
| **FAQ determinístico (`faq_entries`)** | publica texto que vai direto ao WhatsApp do aluno sem passar por LLM nem pelos guardrails de saída; pertence ao ciclo do simulador, que é o que estende o aparato de segurança ao painel | **Sprint 9** (era Sprint 8 no backlog original — **adiado nesta revisão, com justificativa acima**) |
| **Guardrails L1 aditivos (`FLAG`)** | é L1; não destrava nenhuma métrica indisponível; primeiro item a sair de uma sprint com 7 migrations e um webhook de dinheiro | **Sprint 9** (era Sprint 8 no backlog original — **adiado nesta revisão**) |
| **Projeção de lucro com cenários** | esta sprint entrega lucro *realizado*; projetar exige a série histórica que ela começa a acumular hoje | **Sprint 11** (inalterado) |
| **Anexo de comprovante em `expenses` (upload de arquivo)** | upload de arquivo é superfície de segurança própria (tipo, tamanho, varredura, storage, retenção); a Sprint 8 grava **referência textual/URL externa**, não recebe binário | **Sprint 10**, junto com o pipeline de upload do RAG (mesma superfície, mesmo revisor) |
| **Integração Meta Ads API / construtor de UTM na UI** | lançamento manual de `ad_spend` cobre o volume atual; integração só quando o volume justificar | **Sprint 11+** (inalterado) |
| **Regime de competência completo / conciliação contábil** | Simples Anexo III (Eduardo) não exige razão contábil dentro do produto; o painel apura gerencial, o contador apura fiscal | fora do horizonte do produto |
| **Simulador, RAG com curadoria, metodologia editável, handoff, LGPD do titular** | inalterados | Sprints 9, 10 e 11 |
| **OpenTelemetry / tracing distribuído** | inalterado | Fase 6 (Henrique) |

### Mapa de dependências entre User Stories

```
DIA 1-2 — O QUE NÃO PODE ESPERAR
US-8.2 (Captura de UTM · Leonardo+Felipe)
        └── PRAZO INTERNO DIA 2. Cada dia de atraso = histórico de aquisição perdido para sempre.
            Pequena de propósito. Não depende de nada.

ÉPICO 11 — ATIVIDADE DO ALUNO
US-8.1 (workout_completions + North Star · Leonardo+Victor+Felipe)   dias 1-6
        └── começa dia 1 (é a maior decisão de produto da sprint)
US-8.3 (user_status_transitions + coortes · Leonardo+Felipe)         dias 3-7
        └── independente de 8.1; ambas alimentam 8.6

ÉPICO 13 — DINHEIRO
US-8.4 (expenses + model_pricing → custo e lucro · Leonardo+Felipe+Eduardo)  dias 2-7
        └── FUNDAÇÃO do épico financeiro
              │
              ├── US-8.5 (payments + webhook de liquidação · Leonardo+Henrique+Sato)  dias 4-8
              │       └── receita recebida; independente de 8.4 em código,
              │           mas as duas telas se compõem
              │
              └── US-8.7 (partners + distribuição · Leonardo+Felipe)  dias 7-9
                      └── depende de 8.4 E 8.5 (não há distribuição sem lucro)

ÉPICO 12 — ATRIBUIÇÃO
US-8.6 (ad_spend + CAC/ROAS/LTV:CAC por canal · Leonardo+Felipe+Helena)  dias 5-9
        └── depende de US-8.2 (origem) + US-8.4 (custo) + US-8.3 (coorte)

FECHAMENTO
US-8.8 (Reconciliação das telas da Sprint 7 · Felipe)   dias 8-10
        └── depende de 8.1, 8.3, 8.4, 8.5, 8.6, 8.7
US-8.9 (QA + segurança · Mariana+Sato)   dias 3-10
        └── valida US-8.1 a US-8.8
```

**Sequência prática recomendada (10 dias úteis):** **US-8.2 é a primeira coisa que entra em `main`, com prazo interno de dia 2** — é a única com custo de atraso irrecuperável, e foi dimensionada para caber nesse prazo. **US-8.1 começa no dia 1** porque carrega a maior decisão de produto da sprint (como o aluno reporta o treino) e precisa de tempo de ida e volta com o fundador. **US-8.4 começa no dia 2** e é a fundação do épico financeiro. As demais encaixam por dependência. **US-8.7 (distribuição) é a última entrega funcional**, no dia 9, deliberadamente: se a sprint apertar, é a única cujo adiamento não deixa nenhuma outra tela incoerente.

---

## Novas capabilities RBAC introduzidas nesta sprint

| Capability | O que libera | Quem recebe no MVP |
|---|---|---|
| `FINANCE_WRITE` *(criada na Sprint 7, agora **ativada**)* | lançar e estornar despesa (`expenses`), editar `model_pricing` | `ADMIN`, `FINANCE` |
| `MARKETING_WRITE` *(criada na Sprint 7, agora **ativada**)* | lançar investimento por canal/campanha (`ad_spend`) | `ADMIN`, `MARKETING` |
| **`PARTNERS_READ`** | ver cap table e distribuição por sócio | **somente `ADMIN`** — **não** concedida a `FINANCE` |
| **`PARTNERS_WRITE`** | editar participação societária e vigência | **somente `ADMIN`** |

> **Ponto de atenção (Alexandre + Eduardo):** cap table é dado societário, não dado operacional. Quem apura despesa (`FINANCE`) não precisa — e num time que vai contratar, **não deve** — ver quanto cada sócio recebe. `PARTNERS_READ` fica fora de `FINANCE_READ` de propósito. `ADMIN` **herda** ambas normalmente (não entram na `ADMIN_INHERITANCE_DENYLIST`): a denylist existe para separar *administrar o sistema* de *aprovar conteúdo clínico*, e cap table não é conteúdo clínico — os fundadores administradores são justamente quem deve ver.

---

## US-8.1 — `workout_completions`: o treino que o aluno realmente fez, e a North Star saindo de "indisponível"

**Agentes:** Leonardo (lead — schema, ingestão, agregação) · Victor (colabora — captura do reporte na conversa, sem inflar o classificador) · Felipe (colabora — telas de adesão e North Star) · Sofia (referência — copy da confirmação no WhatsApp) · Mariana (valida — dedupe e contagem).
**Depende de:** nada em código. **Depende de uma decisão do fundador que já foi antecipada na Sprint 7** (pré-requisitos, item *a*). **Começa dia 1.**
**Habilita:** a North Star do produto, a adesão verificada (hoje só declarada), o comparativo agregado de metodologia da Sprint 11 e o LTV honesto por coorte.

### Jornada

A North Star da MOVIVO é, desde o `08-relatorio-lucas.md`, **Treinos Concluídos por Usuário Pago nos Primeiros 30 Dias (meta ≥8)**. É a métrica que define se o produto funciona: alguém que faz 8 treinos em 30 dias está sendo treinado; alguém que faz 1 comprou uma assinatura e não usou. **Sete sprints depois, essa métrica nunca foi medida uma única vez** — o sistema sabe que enviou o protocolo, sabe que o aluno respondeu o check-in, e **não sabe se ele treinou**. Tudo o que a Sprint 7 pôde exibir foi *adesão declarada via check-in*, rotulada honestamente como proxy.

O que falta não é tela: é a tabela `workout_completions` e, antes dela, uma decisão de produto que é a mais importante desta sprint. **Minha recomendação, para o fundador confirmar no dia 1:**

**Canal primário — quick reply no WhatsApp.** No dia em que o protocolo prevê treino, a agente manda uma mensagem curta ao fim do período (horário derivado do padrão de conversa do aluno, com default às 20h) com dois botões: **"Treinei ✅"** e **"Hoje não"**. Um toque. É o único formato com chance real de adesão diária num público que já está no WhatsApp e que não vai abrir app nenhum — e "abrir app nenhum" é literalmente a tese do produto.

**Canal de fallback — o check-in semanal já existente.** Uma pergunta a mais no check-in ("quantos treinos você conseguiu fazer esta semana?"), que grava as conclusões faltantes do período com `source = 'CHECKIN'` e granularidade semanal. Recupera quem não responde diariamente sem criar canal novo.

**Canal terciário — menção espontânea na conversa.** Quando o aluno escreve "acabei de treinar", o worker registra. **Victor precisa desenhar isso como extração barata sobre a mensagem já classificada, não como intenção nova no classificador** — inflar o classificador para capturar isso custa token em toda mensagem para ganhar poucos registros. Se a análise dele apontar custo desproporcional, **este terceiro canal cai e não bloqueia a US**; os dois primeiros bastam.

**As três regras que impedem que o dado nasça sujo:**
1. **Dedupe por (aluno, data, sessão).** Aluno que confirma pelo botão e repete no check-in gera **uma** linha, com precedência para a fonte mais específica (`WHATSAPP_QUICK_REPLY` > `CHECKIN`). Contagem inflada é pior que contagem ausente: ausente todo mundo sabe que não sabe.
2. **`source` sempre gravado.** Toda linha diz por qual canal chegou. Sem isso, em três meses ninguém saberá se a North Star subiu porque o aluno treinou mais ou porque o canal de captura melhorou — e essa é exatamente a confusão que mata uma métrica de produto.
3. **Taxa de reporte visível ao lado da North Star.** Se 40% dos alunos nunca respondem o quick reply, a North Star é um piso, não uma medida — e a tela precisa dizer isso, do mesmo jeito que a Sprint 7 disse "adesão declarada".

**Guardrail de linguagem (inegociável):** a copy da confirmação e das telas trata de **treino registrado**, nunca de "evolução do quadro", "progresso clínico" ou qualquer promessa de resultado. E a mensagem de acompanhamento não parte da IA como autoridade: o enquadramento é sempre o de acompanhamento feito com metodologia de profissional CREF, com a IA como ferramenta.

### Objetivo

Ter `workout_completions` gravando treino concluído por dois canais (quick reply no WhatsApp e check-in semanal), com dedupe, `source` e a **North Star exibindo número real** com taxa de reporte declarada.

### Resultado esperado

O aluno recebe um botão no fim do dia de treino e responde com um toque; o painel de Alunos mostra treinos concluídos por semana por aluno; a Visão Geral e o pilar Alunos mostram a **North Star em número real** (média de treinos concluídos nos primeiros 30 dias de usuário pago, contra a meta de 8), com a taxa de reporte ao lado; o rótulo "indisponível — depende de `workout_completions`" desaparece de todas as telas onde a Sprint 7 o colocou.

### Tasks

**TASK-8.1.1 — Decisão de produto do canal de reporte, fechada (Lucas + fundador + Victor + Sofia).**
Confirmar no **dia 1** o desenho acima: quick reply diário como canal primário (com horário e política de não-insistência — no máximo 1 mensagem por dia de treino previsto, sem reenvio), check-in como fallback, menção espontânea condicionada à análise de custo de Victor. Definir a copy exata da mensagem e dos botões com Sofia, dentro dos guardrails de linguagem.
**Conclusão:** decisão registrada no documento; copy aprovada por Sofia e revisada contra os termos proibidos; Victor emite parecer de custo do terceiro canal (segue ou cai).

**TASK-8.1.2 — Schema `workout_completions` + dedupe (Leonardo).**
Tabela: `id`, `user_id`, `protocol_id`, `protocol_version`, `week_number`, `session_key` (a sessão do protocolo, ex.: `A`/`B`/`C`), `completed_at` (data do treino, distinta de `created_at`), `source` (ENUM `WHATSAPP_QUICK_REPLY` / `CHECKIN` / `CONVERSATION`), `exercises_done jsonb` (opcional), `perceived_effort` (opcional, faixa validada), `created_at`. **Constraint de unicidade por (`user_id`, `completed_at::date`, `session_key`)** resolvendo conflito por precedência de `source`. RLS declarada em `security-policies.ts`; o aluno nunca lê a tabela pelo caminho HTTP (não há UI de aluno).
**Conclusão:** migration aplicada; inserção duplicada pelos dois canais produz **1** linha (teste); RLS declarada; índice para a janela de 30 dias.

**TASK-8.1.3 — Quick reply diário no WhatsApp (Leonardo + Victor + Henrique).**
Job agendado que, nos dias de treino previstos pelo protocolo vigente do aluno, envia a mensagem com os dois botões no horário definido. Ingestão da resposta pelo worker de inbound, gravando a conclusão. **Não reenvia**, não insiste, e respeita o mesmo mecanismo de opt-out/silêncio já existente para mensagens automáticas. Falha de envio não bloqueia o fluxo de conversa.
**Conclusão:** aluno com protocolo vigente recebe o botão no dia previsto; resposta grava 1 linha com `source = WHATSAPP_QUICK_REPLY`; nenhuma mensagem duplicada no mesmo dia (teste); opt-out respeitado.

**TASK-8.1.4 — Fallback via check-in semanal (Leonardo + Felipe).**
Acrescentar ao check-in a pergunta de treinos realizados na semana, gravando as conclusões faltantes com `source = CHECKIN` e granularidade semanal (data atribuída ao dia previsto do protocolo, não à data da resposta). A resposta continua cifrada onde já era; a contagem derivada não é dado de saúde e vive em `workout_completions`.
**Conclusão:** check-in respondido gera as conclusões faltantes sem sobrescrever as já registradas pelo quick reply (teste de precedência).

**TASK-8.1.5 — North Star real + taxa de reporte (Leonardo + Felipe).**
Query: média de `workout_completions` nos **primeiros 30 dias após início de assinatura paga**, por coorte, contra a meta ≥8. Exibir no pilar Alunos e na linha-resumo da Visão Geral. **Ao lado, obrigatoriamente, a taxa de reporte** (% de alunos com ao menos 1 registro no período) e a composição por `source`. Substituir a adesão declarada da Sprint 7 pela adesão verificada **sem apagar a declarada** — as duas coexistem nomeadas, porque a divergência entre elas é informação.
**Conclusão:** North Star renderiza número real, confere com cálculo manual sobre a base de dev (tolerância 0); taxa de reporte e composição por `source` visíveis; adesão declarada e verificada coexistem rotuladas.

### Definição de Pronto (US-8.1 "validada")

- [ ] Tasks 8.1.1–8.1.5 concluídas.
- [ ] `workout_completions` no ar com dois canais de captura, dedupe e `source`; North Star em número real.
- [ ] **Mensurável:** duplo reporte do mesmo treino produz **1** linha; North Star confere com cálculo manual (tolerância 0); **0** telas exibindo "indisponível — depende de `workout_completions`"; taxa de reporte exibida junto da métrica; **0** ocorrências de termo clínico proibido na copy da mensagem (teste de guardrail de linguagem).
- [ ] **Validada por:** code review + **parecer de Victor** (custo do canal de conversa) + revisão de Sofia (copy) + conferência numérica de Mariana + decisão do fundador registrada.

---

## US-8.2 — Captura de UTM: a origem de cada aluno (prazo interno: dia 2)

**Agentes:** Felipe (lead — captura no primeiro toque, persistência através do funil) · Leonardo (colabora — colunas, validação, exposição) · Helena (referência — taxonomia de canal e campanha) · Sato (valida — entrada não confiável vinda de query string).
**Depende de:** nada. **É a primeira US da sprint a entrar em `main`.**
**Habilita:** US-8.6 (CAC/ROAS por canal) e toda a análise de aquisição do produto, para sempre.

### Jornada

**Esta é a US mais barata e a mais urgente do documento, e as duas coisas são verdade ao mesmo tempo por um motivo específico: o custo do atraso é irrecuperável.** Não existe migration, integração ou análise que recupere a origem de um aluno que já se cadastrou. Todo dia que passa sem essa captura é um dia de aquisição que ficará permanentemente marcado como `desconhecida` — e quando o fundador ligar o primeiro anúncio pago, a pergunta *"esse anúncio funcionou?"* só terá resposta para quem chegou depois desta US.

O trabalho é pequeno e tem uma única sutileza real: **o UTM chega na landing page e precisa sobreviver até o fim de um funil de 3 blocos que pode levar dias.** A Sprint 6 entregou o onboarding em etapas com salvamento de progresso — ou seja, o aluno pode começar num dispositivo, na segunda-feira, vindo de um anúncio, e concluir na quinta. A captura tem que ser **no primeiro toque**, persistida junto com a sessão de anamnese (não em memória de cliente), e **imutável depois de gravada**: se o aluno reabrir o funil por um link orgânico, a origem original **não** é sobrescrita. Atribuição de primeiro toque é a mais simples e a mais honesta para o volume atual; multi-touch é complexidade sem retorno com o número de canais de hoje.

Sato valida o óbvio que costuma ser esquecido: **query string é entrada não confiável.** Allowlist de charset, limite de comprimento, e `referrer` **truncado ao host** — a URL completa de referência pode carregar termo de busca ou identificador de terceiro, ou seja, PII que ninguém pediu para armazenar.

Helena define a **taxonomia** — quais valores de `utm_source`/`utm_medium` são canônicos — porque UTM sem convenção vira 14 grafias do mesmo canal e um relatório inútil. A normalização acontece **na leitura/agregação**, não na gravação: grava-se o que veio (dado bruto preservado) e normaliza-se para exibir.

### Objetivo

Capturar origem de tráfego no primeiro toque e persistir em `anamnesisSessions`, de forma imutável, validada e sobrevivente ao funil de 3 blocos — com taxonomia de canal definida por Helena.

### Resultado esperado

Todo aluno cadastrado a partir da subida desta US tem origem conhecida, visível na ficha do aluno (pilar Alunos) e agregável por canal (pilar Marketing); aluno que reabre o funil por outro link mantém a origem do primeiro toque; parâmetro malformado ou excessivo é rejeitado sem quebrar o cadastro.

### Tasks

**TASK-8.2.1 — Colunas de atribuição em `anamnesisSessions` + validação (Leonardo + Sato).**
Migration: `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `referrer_host`, `first_touch_at`. Validação na gravação: allowlist de charset, limite de comprimento por campo, `referrer` reduzido ao host. **Escrita única** — uma vez gravado, o conjunto não é sobrescrito (garantido no serviço e coberto por teste).
**Conclusão:** migration aplicada; parâmetro fora da allowlist é descartado sem erro para o usuário; segunda gravação não sobrescreve a primeira (teste).

**TASK-8.2.2 — Captura no primeiro toque e sobrevivência ao funil (Felipe).**
Ler os parâmetros na entrada da landing page, persistir na criação da sessão de anamnese (**servidor**, não apenas cliente), e garantir continuidade quando o aluno retoma o funil em outro momento/dispositivo pelo mecanismo de retomada da Sprint 6.
**Conclusão:** cadastro iniciado por link com UTM chega ao fim do bloco 3 com a origem intacta, inclusive em retomada (teste E2E cobrindo os 3 blocos); ausência de UTM grava origem `desconhecida` explicitamente, nunca `null` silencioso.

**TASK-8.2.3 — Taxonomia de canal e normalização na leitura (Leonardo + Helena ref.).**
Mapa canônico de `source`/`medium` definido por Helena (ex.: `instagram`/`meta_ads`/`organico`/`indicacao`), aplicado **na agregação**. Valor fora do mapa aparece como "não mapeado" com o valor bruto ao lado — nunca é jogado num balde "outros" que esconde erro de marcação de campanha.
**Conclusão:** mapa em ponto único do código, validado por Helena; valores não mapeados visíveis com o bruto; agregação por canal renderiza no pilar Marketing.

**TASK-8.2.4 — Origem na ficha do aluno (Felipe).**
Exibir a origem no cabeçalho da ficha (US-7.4) e como item na timeline única, no marco de cadastro. Alunos anteriores à US aparecem como **"origem não capturada (cadastro anterior à Sprint 8)"** — nunca "orgânico", que seria uma conclusão falsa.
**Conclusão:** origem visível na ficha e na timeline; alunos antigos rotulados corretamente, sem inferência.

### Definição de Pronto (US-8.2 "validada")

- [ ] Tasks 8.2.1–8.2.4 concluídas **até o dia 2 da sprint**.
- [ ] UTM capturado, validado, imutável e sobrevivente ao funil de 3 blocos; taxonomia definida.
- [ ] **Mensurável:** 100% dos cadastros iniciados após o merge têm registro de origem (inclusive `desconhecida` explícita); reabertura do funil **não** altera a origem (teste); **0** `referrer` armazenado além do host; parâmetro com 5.000 caracteres não derruba o cadastro (teste).
- [ ] **Validada por:** code review + **revisão de Sato** (entrada não confiável, PII em referrer) + validação de taxonomia por Helena + teste E2E de 3 blocos verde.

---

## US-8.3 — `user_status_transitions`: como o aluno chegou onde está (conversão e coortes corretas)

**Agentes:** Leonardo (lead — tabela append-only, emissão nos pontos de mudança) · Felipe (colabora — funil e coortes) · Eduardo (referência — definição de "ativo", "convertido", "churn") · Mariana (valida — nenhuma transição perdida).
**Depende de:** US-7.1 (pilares). Dias 3-7.
**Habilita:** US-8.6 (coorte de aquisição), LTV por coorte, e o comparativo agregado de metodologia da Sprint 11.

### Jornada

Hoje o sistema guarda o **estado atual** do aluno e a data em que a assinatura começou e terminou. Isso é suficiente para dizer *quantos alunos ativos existem hoje* e insuficiente para tudo que importa: *quantos dos que entraram em maio converteram?*, *quanto tempo em média leva do trial à conversão?*, *a coorte de junho retém melhor que a de maio?*. Essas perguntas se respondem com **a sequência de mudanças de estado**, e a sequência não está gravada — está sendo reconstruída por inferência a partir de datas soltas, o que dá certo até o dia em que um aluno faz um caminho fora do padrão (pausou, voltou, trocou de plano) e a inferência produz um número errado sem avisar ninguém.

`user_status_transitions` é uma tabela append-only pequena e chata: `user_id`, `from_status`, `to_status`, `occurred_at`, `reason`, `actor` (sistema / aluno / RT). Emitida em cada ponto onde o estado muda — início de trial, conversão, renovação, cancelamento, pausa, retomada. **Reusa integralmente o padrão de imutabilidade provado na Sprint 7** (trigger 55000 + REVOKE + teste de integração contra Postgres real): copiar o molde de `agent-config-immutability.int-spec.ts` é literalmente o trabalho.

Os estados e o que conta como "convertido" são **definição de Eduardo**, não minha nem de engenharia — pela mesma razão da Sprint 7: o número do painel precisa ser o mesmo número da planilha do CFO, e "conversão" tem pelo menos três definições defensáveis (primeiro pagamento autorizado / primeiro pagamento liquidado / fim do período de reembolso). Escolher errado não quebra nada tecnicamente e desalinha o painel do CFO permanentemente.

**Backfill:** as transições passadas são reconstruídas **uma única vez**, a partir das datas conhecidas em `subscriptions`, e gravadas com `actor = 'BACKFILL'` — visivelmente marcadas como reconstrução, nunca misturadas com evento observado. Uma coorte montada sobre dado reconstruído tem que se declarar como tal.

### Objetivo

Ter cada mudança de estado do aluno gravada append-only, com backfill marcado, produzindo conversão trial→ativo, tempo até conversão e coortes mensais corretas.

### Resultado esperado

O fundador abre o funil e vê quantos entraram em trial no mês, quantos converteram, em quantos dias em média, e como cada coorte mensal se comporta ao longo do tempo — com o dado reconstruído por backfill visualmente distinto do dado observado.

### Tasks

**TASK-8.3.1 — Tabela append-only + emissão nos pontos de mudança (Leonardo).**
Migration de `user_status_transitions` com o padrão de imutabilidade da Sprint 7 (trigger + REVOKE + teste de integração contra Postgres real, copiando o molde existente). Emitir a transição em **todos** os pontos onde o estado muda hoje — varredura do código para garantir que nenhum caminho de mudança de estado escapa. RLS declarada.
**Conclusão:** `UPDATE`/`DELETE` falham no banco (teste de integração); varredura prova que todo ponto de mudança emite transição; RLS declarada.

**TASK-8.3.2 — Definições de estado e conversão (Eduardo + Lucas).**
Fechar a lista de estados e o critério de "convertido" (recomendação: **primeiro pagamento liquidado**, alinhando com `payments` da US-8.5 — mas a palavra final é de Eduardo). Documentar cada definição na UI via tooltip, como na Sprint 7.
**Conclusão:** definições fechadas por Eduardo, documentadas no código e na UI; o número do painel reconcilia com a planilha do CFO.

**TASK-8.3.3 — Backfill marcado (Leonardo + Mariana).**
Script de reconstrução única a partir de `subscriptions`, gravando com `actor = 'BACKFILL'`. Idempotente (rodar duas vezes não duplica). Toda tela que agrega transições distingue observado de reconstruído.
**Conclusão:** backfill idempotente (teste); dado reconstruído distinguível na UI e na query.

**TASK-8.3.4 — Funil trial→ativo e coortes mensais (Leonardo + Felipe).**
Taxa de conversão trial→ativo, tempo mediano até conversão, e retenção por coorte mensal de entrada. Exibir no pilar Marketing (funil) e Financeiro (coorte de receita), sob k-anonimato onde a célula for pequena.
**Conclusão:** funil e coortes renderizam; células com n < 10 suprimidas; números conferem com cálculo manual na base de dev.

### Definição de Pronto (US-8.3 "validada")

- [ ] Tasks 8.3.1–8.3.4 concluídas.
- [ ] Transições gravadas append-only em todos os pontos de mudança; backfill marcado; funil e coortes no ar.
- [ ] **Mensurável:** `UPDATE` em `user_status_transitions` falha no banco; **0** caminhos de mudança de estado sem emissão (varredura); backfill rodado 2× não duplica linha; taxa de conversão confere com cálculo manual (tolerância 0).
- [ ] **Validada por:** code review + **definições validadas por Eduardo** + revisão de Sato (imutabilidade) + testes verdes (US-8.9).

---

## US-8.4 — `expenses` + `model_pricing`: o custo existe, e portanto o lucro passa a existir

**Agentes:** Leonardo (lead — tabelas, agregação, substituição da constante) · Felipe (colabora — tela de lançamento e de custos) · Eduardo (referência/valida — plano de categorias, regime de apuração, definição de lucro) · Henrique (colabora — categorias de infra e IA).
**Depende de:** US-7.1 (`FINANCE_WRITE` já criada). Dias 2-7. **É a fundação do épico financeiro.**
**Habilita:** US-8.7 (distribuição por sócio), US-8.6 (LTV/CAC precisa de margem), o motor de projeção da Sprint 11.

### Jornada

Escrevi na Sprint 7 a frase que essa US existe para tornar falsa: *"o sistema hoje conhece receita contratada e não conhece nenhuma despesa — não existe lucro para exibir, e qualquer tela que exibisse um número chamado 'lucro' estaria inventando"*. `expenses` é a tabela que torna o lucro exibível sem inventar.

Ela é simples de propósito: `id`, `occurred_on` (competência), `amount_cents`, `currency`, `category` (ENUM fechado), `supplier`, `description`, `is_recurring`, `recurrence_period`, `receipt_ref` (**referência textual/URL externa — a Sprint 8 não recebe upload de arquivo**, ver não-escopo), `created_by`, `created_at`. Duas propriedades não negociáveis: **valor em centavos inteiro** (regra 1 da sprint) e **correção por estorno, nunca por edição** — lançou errado, lança a linha de estorno e a linha certa. Livro-caixa que se edita é livro-caixa em que ninguém confia.

O **plano de categorias é decisão de Eduardo**, não de engenharia, e precisa fechar no dia 2 porque é ENUM. Sugestão inicial a validar: `INFRA`, `IA_LLM`, `WHATSAPP`, `GATEWAY_PAGAMENTO`, `MARKETING`, `JURIDICO_CONTABIL`, `FERRAMENTAS`, `PESSOAS`, `IMPOSTOS`, `OUTROS`. Cada categoria mal desenhada agora é uma migration de ENUM depois.

`model_pricing` é a peça pequena que fecha um ciclo aberto na Sprint 7: a TASK-7.2.3 gravou o preço por modelo como **constante versionada em código, com o ponto de substituição já marcado**. Agora vira tabela (`model`, `input_price_per_1k`, `output_price_per_1k`, `valid_from`, `valid_to`) — versionada por vigência, porque preço de LLM muda e o custo histórico não pode mudar retroativamente junto. A troca é de uma linha na origem do dado, e o teste que garante que o número não mudou já existe.

Com as duas, o pilar Financeiro passa a mostrar **custo total por categoria e por mês**, **custo por usuário ativo/mês** (o número que Eduardo usa no unit economics) e finalmente **lucro do período = receita − despesa**, com o regime de apuração declarado na tela. **Lucro precisa dizer se é sobre receita contratada ou recebida** — recomendo **recebida** (caixa), que é o número que responde "quanto sobrou de verdade", e que se torna disponível com a US-8.5 na mesma sprint. Palavra final de Eduardo.

### Objetivo

Ter despesa registrável e auditada, preço de modelo em tabela versionada por vigência, e lucro do período calculado com regime de apuração declarado.

### Resultado esperado

Um fundador com `FINANCE_WRITE` lança uma despesa em 20 segundos, com categoria e recorrência; o pilar Financeiro mostra custo por categoria, custo por usuário ativo/mês e o lucro do período; correção de lançamento aparece como estorno + relançamento no histórico, e tudo está em `audit_logs`.

### Tasks

**TASK-8.4.1 — Plano de categorias e regime de apuração (Eduardo + Lucas).**
Fechar o ENUM de categorias e o regime (caixa vs. competência) para o cálculo de lucro exibido. Documentar a definição na UI via tooltip.
**Conclusão:** ENUM fechado e validado por Eduardo antes da migration; regime declarado na tela.

**TASK-8.4.2 — Tabela `expenses` + lançamento e estorno auditados (Leonardo + Felipe).**
Migration conforme acima (valor em **centavos inteiro**). Endpoints de lançamento e estorno sob `FINANCE_WRITE`, ambos chamando `AuditService.append`. **Sem endpoint de `UPDATE` de valor** — correção é estorno + novo lançamento. Despesa recorrente é **um lançamento por período** (materializado por job), não uma linha "mágica" que se multiplica na leitura: recorrência que só existe na query é impossível de conferir contra extrato.
**Conclusão:** lançar/estornar funciona sob capability e aparece em `audit_logs`; não existe caminho de edição de valor; recorrência materializa uma linha por período (teste).

**TASK-8.4.3 — `model_pricing` substituindo a constante da Sprint 7 (Leonardo + Henrique).**
Migration com vigência (`valid_from`/`valid_to`). Trocar a origem do preço no ponto **já marcado** pela TASK-7.2.3. Custo histórico usa o preço vigente **na data do job**, não o preço atual. Edição sob `FINANCE_WRITE`, auditada.
**Conclusão:** custo de IA em R$ continua batendo com o valor da Sprint 7 após a troca de fonte (teste de não-regressão); mudar o preço hoje **não** altera o custo apurado de mês passado (teste de vigência).

**TASK-8.4.4 — Telas de Custos e Resultado (Felipe + Eduardo ref.).**
Preencher os itens "Custos" e "Resultado & Projeção" (criados vazios na Sprint 7): custo por categoria e por mês, custo por usuário ativo/mês, lucro do período com regime declarado. **A parte "Projeção" continua rotulada como Sprint 11** — esta US entrega resultado realizado, não projetado, e a tela precisa ser explícita sobre isso.
**Conclusão:** telas renderizam com números reais; lucro confere com cálculo manual (tolerância 0); "Projeção" permanece com dependência e sprint nomeadas, nunca como zero.

### Definição de Pronto (US-8.4 "validada")

- [ ] Tasks 8.4.1–8.4.4 concluídas.
- [ ] `expenses` e `model_pricing` no ar; lucro do período exibido com regime declarado; custo de IA vindo de tabela.
- [ ] **Mensurável:** **0** endpoints de edição de valor de despesa; lucro confere com cálculo manual (tolerância 0); custo de IA idêntico ao da Sprint 7 após a troca de fonte; mudança de preço não altera custo histórico; 100% dos lançamentos em `audit_logs`.
- [ ] **Validada por:** code review + **validação de Eduardo** (categorias, regime, definição de lucro) + revisão de Sato (auditoria de escrita financeira) + conferência numérica de Mariana.

---

## US-8.5 — `payments` + webhook de liquidação: receita recebida, e não apenas contratada

**Agentes:** Leonardo (lead — tabela, ingestão, conciliação) · Henrique (colabora — endpoint público, retries, observabilidade) · Sato (**valida — é a superfície externa de escrita mais sensível da sprint**) · Eduardo (referência — inadimplência e ciclo de liquidação).
**Depende de:** integração de pagamento da Sprint 4. Dias 4-8.
**Habilita:** US-8.7 (lucro de caixa como base de distribuição), definição de "convertido" da US-8.3, e a projeção da Sprint 11.

### Jornada

A Sprint 4 integrou o gateway e a Sprint 7 entregou o **calendário de renovação** — quanto está **contratado** a vencer. O que falta é o outro lado: **quanto efetivamente caiu na conta.** A diferença entre os dois é inadimplência, falha de cartão e prazo de liquidação, e ela não é pequena num produto B2C de ticket baixo pago majoritariamente em cartão. Um painel que só conhece receita contratada superestima o caixa de forma sistemática — e distribuir lucro sobre receita contratada é distribuir dinheiro que talvez não tenha entrado.

`payments` é append-only: `id`, `subscription_id`, `user_id`, `gateway`, `gateway_event_id` (**único** — é a chave de idempotência), `status`, `amount_cents`, `net_amount_cents` (líquido de taxa — a taxa do gateway é custo real e precisa ser visível), `occurred_at`, `raw_payload jsonb`, `received_at`. Estorno/chargeback é **linha nova** de sinal contrário, nunca alteração da original.

**Esta é a superfície externa de escrita mais sensível da sprint,** e as regras são as clássicas, sem invenção:
- **Assinatura verificada antes de qualquer processamento.** Evento sem assinatura válida é rejeitado com o status correto e **registrado** — tentativa de forjar liquidação é sinal de segurança, não ruído de log.
- **Idempotência por `gateway_event_id` único no banco**, não por checagem em código. Gateway reenvia por design; o banco é quem garante uma linha.
- **Processamento assíncrono.** O endpoint valida, persiste o evento bruto e responde rápido; a conciliação roda em worker (BullMQ, padrão da arquitetura). Webhook que faz trabalho pesado inline vira timeout e depois vira reenvio, que vira duplicata se a idempotência não estiver no banco.
- **`raw_payload` passa pelo PII Scrubber antes de qualquer log.** O payload do gateway carrega dados de cobrança; ele fica na tabela sob RLS, **não** no log de aplicação.

Sobre isso, a tela: receita **recebida** vs. **contratada** lado a lado no pilar Financeiro (nomeadas, **nunca somadas** — regra 3 da sprint), taxa de inadimplência do período, prazo médio de liquidação e taxa efetiva do gateway em R$ e em %.

### Objetivo

Ter a receita efetivamente liquidada gravada de forma idempotente e auditada a partir do webhook do gateway, exibida distintamente da receita contratada.

### Resultado esperado

O fundador vê, no mesmo pilar, quanto foi contratado e quanto foi recebido no período, a diferença explicada por inadimplência e prazo de liquidação, e a taxa do gateway como custo visível; reenvio do mesmo evento pelo gateway não cria linha nem número duplicado.

### Tasks

**TASK-8.5.1 — Tabela `payments` append-only + idempotência no banco (Leonardo).**
Migration conforme acima, com **constraint UNIQUE em (`gateway`, `gateway_event_id`)** e o padrão de imutabilidade da Sprint 7 (trigger + REVOKE + teste de integração). RLS declarada.
**Conclusão:** segundo insert do mesmo evento falha no banco (teste de integração); `UPDATE` falha; RLS declarada.

**TASK-8.5.2 — Endpoint de webhook com verificação de assinatura (Leonardo + Henrique + Sato).**
Endpoint público que **verifica a assinatura antes de processar**, persiste o evento bruto e enfileira a conciliação. Evento inválido: rejeitado, registrado como evento de segurança, nunca processado. Rate limit e limite de tamanho de corpo. `raw_payload` **nunca** vai para log de aplicação sem passar pelo PII Scrubber.
**Conclusão:** evento sem assinatura válida é rejeitado e registrado (teste); evento válido responde rápido e enfileira; **0** ocorrências de payload de gateway em log de aplicação (teste de log).

**TASK-8.5.3 — Conciliação e estorno (Leonardo + Eduardo ref.).**
Worker que vincula o pagamento à assinatura, calcula líquido e taxa, e trata estorno/chargeback como **linha nova de sinal contrário**. Pagamento sem assinatura correspondente vai para uma fila de exceção visível no painel — **nunca é descartado silenciosamente**.
**Conclusão:** conciliação vincula corretamente; estorno gera linha nova (nunca altera a original); pagamento órfão aparece na fila de exceção.

**TASK-8.5.4 — Receita recebida × contratada na UI (Felipe + Eduardo ref.).**
Exibir as duas séries nomeadas e separadas, inadimplência do período, prazo médio de liquidação e taxa efetiva do gateway (R$ e %). Alimentar a US-8.4 com a taxa do gateway como custo real.
**Conclusão:** as duas séries renderizam separadas e rotuladas; a soma indevida é impossível pela estrutura da tela; taxa do gateway aparece também como custo em Custos.

### Definição de Pronto (US-8.5 "validada")

- [ ] Tasks 8.5.1–8.5.4 concluídas.
- [ ] `payments` append-only, webhook idempotente e autenticado, conciliação com estorno, receita recebida × contratada na UI.
- [ ] **Mensurável:** reenvio do mesmo evento 5× produz **1** linha e **0** alteração de número; evento com assinatura inválida: **0** processados, 100% registrados; **0** payloads de gateway em log de aplicação; receita recebida confere com a soma manual dos eventos na base de dev.
- [ ] **Validada por:** code review + **revisão de segurança de Sato (obrigatória — superfície externa de escrita)** + validação de Eduardo (inadimplência/liquidação) + testes verdes (US-8.9).

---

## US-8.6 — `ad_spend` + CAC por canal, ROAS e LTV/CAC por origem

**Agentes:** Leonardo (lead — tabela, junção com coorte) · Felipe (colabora — telas de aquisição e campanhas) · Helena (referência/valida — definição de CAC, canais, leitura do funil) · Eduardo (referência — LTV, meta LTV/CAC ≥ 3, payback ≤3 meses).
**Depende de:** **US-8.2** (origem), **US-8.4** (custo/margem), **US-8.3** (coorte). Dias 5-9.
**Habilita:** a decisão de anúncio que o fundador pediu; o motor de projeção da Sprint 11.

### Jornada

Com origem gravada (8.2), estados gravados (8.3) e custo gravado (8.4), falta uma tabela de quatro colunas para fechar a pergunta *"esse anúncio funcionou?"*: `ad_spend` (`channel`, `campaign`, `spent_on`, `amount_cents`, `created_by`), lançada manualmente sob `MARKETING_WRITE`. **Lançamento manual é a escolha correta agora e não é preguiça**: com o volume de campanha atual, integrar a Meta Ads API custa mais em manutenção de token e de esquema do que uma entrada semanal de 30 segundos. A integração está no roadmap (Sprint 11+) atrelada a um gatilho de volume, não a uma data.

Sobre isso, três métricas e um cuidado.

**CAC por canal** = investimento no período ÷ alunos **convertidos** originados naquele canal, usando a definição de "convertido" fechada por Eduardo na US-8.3. Duas armadilhas que a implementação precisa evitar explicitamente: (a) **defasagem** — quem viu o anúncio em maio pode converter em junho, então CAC por mês-calendário de gasto sobre conversões do mesmo mês está errado; a atribuição é **por coorte de origem**, e a tela mostra a janela usada; (b) **canais orgânicos não têm gasto**, e dividir por zero produz infinito ou, pior, um número bonito e falso — canal sem gasto exibe "sem investimento direto", não "CAC R$ 0,00".

**ROAS** = receita **recebida** (US-8.5) atribuída ao canal ÷ investimento. Usar receita recebida, não contratada — a regra 3 da sprint vale aqui com força: ROAS sobre receita que não entrou é o tipo de número que faz escalar um anúncio ruim.

**LTV/CAC por origem**, contra a meta **≥ 3** de Eduardo, com o **payback de CAC em meses** contra a meta **≤ 3 meses**. Com poucos meses de histórico, LTV é uma estimativa frágil — a tela declara a base de cálculo e o número de coortes maduras que sustentam o número. **Um LTV calculado sobre 6 semanas de operação é uma hipótese, e a tela precisa dizer isso.**

**k-anonimato:** agregado por canal/campanha com poucos alunos permite reidentificação por cruzamento. A supressão n < 10 já implementada vale aqui, e não há drill-down até o aluno a partir do pilar Marketing (regra herdada da US-7.3).

### Objetivo

Ter investimento por canal registrado e cruzado com origem e coorte, produzindo CAC por canal, ROAS sobre receita recebida e LTV/CAC por origem contra as metas de Eduardo.

### Resultado esperado

O fundador lança o investimento da semana em cada canal e vê, por canal: quanto custou trazer um aluno convertido, quanto voltou em receita recebida, e se a relação LTV/CAC está acima de 3 — com a janela de atribuição e a maturidade da estimativa declaradas na tela.

### Tasks

**TASK-8.6.1 — Tabela `ad_spend` + lançamento auditado (Leonardo + Felipe).**
Migration (valor em **centavos inteiro**) e tela de lançamento sob `MARKETING_WRITE`, auditada. Correção por estorno + relançamento, mesmo princípio de `expenses`. Categoria `MARKETING` de `expenses` e `ad_spend` **não se somam em duplicidade** no custo total — a regra de qual é a fonte de verdade para gasto de mídia é fechada com Eduardo e documentada na UI.
**Conclusão:** lançamento funciona sob capability e é auditado; **0** dupla contagem de gasto de mídia no custo total (teste de conferência).

**TASK-8.6.2 — CAC por canal com janela de atribuição explícita (Leonardo + Helena ref.).**
CAC por coorte de origem, com a janela declarada na tela. Canal sem investimento exibe "sem investimento direto", **nunca** `R$ 0,00`. Helena valida a definição contra o plano de GTM.
**Conclusão:** CAC renderiza por canal com janela visível; canal orgânico não exibe zero; definição validada por Helena.

**TASK-8.6.3 — ROAS e LTV/CAC por origem com metas de Eduardo (Leonardo + Felipe + Eduardo ref.).**
ROAS sobre **receita recebida**; LTV/CAC por origem contra a meta ≥ 3 e payback de CAC contra ≤ 3 meses, com semáforo. Declarar na tela a base do LTV e **quantas coortes maduras** sustentam a estimativa.
**Conclusão:** ROAS e LTV/CAC renderizam com semáforo contra as metas; base e maturidade do LTV declaradas; conferem com cálculo manual.

**TASK-8.6.4 — Telas de Aquisição & Canais e Campanhas & Experimentos (Felipe).**
Preencher os dois itens criados vazios na Sprint 7 (TASK-7.3.4), removendo o cartão de dependência de UTM. Agregados sob k-anonimato, sem drill-down para indivíduo.
**Conclusão:** ambas as telas com números reais; cartão de dependência removido; **0** células com n < 10.

### Definição de Pronto (US-8.6 "validada")

- [ ] Tasks 8.6.1–8.6.4 concluídas.
- [ ] `ad_spend` no ar; CAC por canal, ROAS e LTV/CAC por origem exibidos com metas e janelas declaradas.
- [ ] **Mensurável:** **0** canais exibindo `CAC R$ 0,00` por ausência de investimento; **0** dupla contagem de gasto de mídia; **0** células com n < 10; CAC e ROAS conferem com cálculo manual (tolerância 0); janela de atribuição visível em cada métrica.
- [ ] **Validada por:** code review + **validação de Helena** (definição de CAC/canais) + **validação de Eduardo** (LTV, metas) + teste de k-anonimato verde (US-8.9).

---

## US-8.7 — `partners` + distribuição por sócio sobre lucro real

**Agentes:** Leonardo (lead — tabela, cálculo) · Felipe (colabora — tela) · Eduardo (referência/valida — base de distribuição) · Alexandre (valida — coerência com o Acordo de Sócios e o gap de vesting já flagueado).
**Depende de:** **US-8.4** (lucro) e **US-8.5** (base de caixa). Dias 7-9. **É a última entrega funcional da sprint, de propósito.**
**Habilita:** o encerramento do pedido "ganhos por sócio"; a projeção por sócio da Sprint 11.

### Jornada

O pedido original do fundador incluía "ganhos por sócio", e na Sprint 7 essa tela existe como um cartão explicando que depende de lucro. Agora ela pode existir de verdade — e é a US mais simples do documento em código e a mais sensível em governança.

`partners`: `id`, `name`, `share_basis_points` (**pontos-base, inteiro** — 2000 = 20%; percentual em ponto flutuante que precisa somar exatamente 100% é armadilha conhecida), `valid_from`, `valid_to`, `notes`. **Versionada por vigência**, como `model_pricing`: se a participação mudar, a distribuição histórica não muda junto. **Constraint de que a soma das participações vigentes é exatamente 10.000 bps** — cap table que não fecha 100% é erro que precisa falhar na gravação, não aparecer como um número estranho na tela três meses depois.

O split de **20% para cada um dos 5 sócios já está definido** (CLAUDE.md / memória do projeto) — é seed, não decisão pendente. **O que continua pendente e não é resolvido por esta US**, e precisa aparecer na tela como aviso: o **Acordo de Sócios com vesting (cliff 12 / total 48 meses) e a cláusula de desempate** apontados por Alexandre em `06-relatorio-alexandre.md` ainda não existem. A tela mostra distribuição **sobre a participação atual, sem considerar vesting** — e diz isso com todas as letras. Exibir um número de distribuição sem essa ressalva seria dar aparência de acordo formalizado a algo que não está formalizado, e isso é exatamente o tipo de mal-entendido societário que Alexandre alertou para evitar.

A distribuição em si é aritmética: **lucro do período (US-8.4, base de caixa da US-8.5) × participação vigente**. Duas ressalvas que ficam na tela, validadas por Eduardo: é **distribuição bruta de referência gerencial**, não pró-labore nem dividendo declarado (tem implicação tributária no Simples Anexo III que é do domínio do contador), e **não considera reserva de caixa** — distribuir 100% do lucro de um mês bom é como se quebra uma startup bootstrapada.

**Capability:** `PARTNERS_READ`/`PARTNERS_WRITE`, **somente `ADMIN`**, fora de `FINANCE_READ` (regra 7 da sprint).

### Objetivo

Ter cap table versionado por vigência com soma validada, e distribuição por sócio calculada sobre lucro real, sob capability restrita e com as ressalvas de governança visíveis.

### Resultado esperado

Um fundador `ADMIN` abre "Sócios & Distribuição" e vê a participação vigente de cada um dos 5 sócios, o lucro do período e quanto caberia a cada um — com aviso explícito de que o cálculo não considera vesting (não formalizado) nem reserva de caixa, e que é referência gerencial, não dividendo declarado. Um usuário `FINANCE` **não vê o item no menu**.

### Tasks

**TASK-8.7.1 — Tabela `partners` + constraint de fechamento (Leonardo).**
Migration com `share_basis_points` inteiro e vigência. **Validação de que a soma das participações vigentes é exatamente 10.000 bps**, aplicada na gravação (falha, não avisa). Seed com os 5 sócios a 2.000 bps cada. Escrita sob `PARTNERS_WRITE`, auditada.
**Conclusão:** gravação que não fecha 10.000 bps é rejeitada (teste); seed correto; escrita auditada.

**TASK-8.7.2 — Capabilities `PARTNERS_READ`/`PARTNERS_WRITE` (Leonardo + Sato).**
Registrar no mecanismo existente; conceder **apenas a `ADMIN`**; garantir que `FINANCE` não alcança nem a rota nem o endpoint.
**Conclusão:** `FINANCE` recebe `403` no endpoint e **não vê** o item no menu (teste por papel).

**TASK-8.7.3 — Cálculo e tela de distribuição com ressalvas (Felipe + Leonardo + Eduardo ref. + Alexandre valida).**
Distribuição = lucro do período × participação vigente, por sócio. Ressalvas obrigatórias e visíveis: **(a)** não considera vesting — Acordo de Sócios ainda não formalizado (Alexandre); **(b)** não considera reserva de caixa; **(c)** é referência gerencial, não pró-labore nem dividendo declarado. Texto das ressalvas validado por Alexandre.
**Conclusão:** distribuição renderiza e confere com cálculo manual (tolerância 0); as 3 ressalvas visíveis na tela; texto validado por Alexandre.

### Definição de Pronto (US-8.7 "validada")

- [ ] Tasks 8.7.1–8.7.3 concluídas.
- [ ] Cap table versionado com soma validada; distribuição sobre lucro real; capability restrita a `ADMIN`; ressalvas de governança visíveis.
- [ ] **Mensurável:** cap table que não soma 10.000 bps é rejeitado na gravação; `FINANCE` recebe `403`; distribuição confere com cálculo manual (tolerância 0); **3** ressalvas presentes na tela.
- [ ] **Validada por:** code review + **validação de Alexandre** (texto das ressalvas, coerência societária) + validação de Eduardo (base de distribuição) + revisão de Sato (capability restrita).

---

## US-8.8 — Reconciliação: desligar os rótulos "indisponível" que deixaram de ser verdade

**Agentes:** Felipe (lead) · Leonardo (colabora — endpoints das linhas-resumo) · Lucas (referência — o que passou a existir e o que mudou de sprint).
**Depende de:** US-8.1, 8.3, 8.4, 8.5, 8.6, 8.7. Dias 8-10.
**Habilita:** a coerência da plataforma — que é o que faz o fundador voltar a ela todo dia.

### Jornada

A Sprint 7 fez uma escolha que agora cobra manutenção: em vez de exibir zero ou traço para dado inexistente, cada indicador ausente **nomeia sua dependência e a sprint prevista**. Essa escolha só continua valendo se os rótulos forem mantidos honestos. Um painel que diz "previsto para a Sprint 8" depois da Sprint 8 entregue é pior que um painel que nunca prometeu nada — ele ensina o fundador a não confiar no que a tela diz.

Esta US é a varredura de fechamento, e ela tem **três resultados possíveis por rótulo**, todos legítimos:
1. **Virou número** — o rótulo sai (North Star, lucro, CAC, receita recebida, distribuição, custo de infra via `expenses`).
2. **Mudou de sprint** — o rótulo é **reapontado**, com o motivo. É o caso do **FAQ**, que a Sprint 7 anunciou para a Sprint 8 e que esta revisão moveu para a Sprint 9: a tela precisa dizer "Sprint 9", e o item de menu do pilar IA precisa refletir isso. Idem para os guardrails L1 aditivos.
3. **Continua igual** — RAG (Sprint 10), projeção com cenários (Sprint 11), tracing distribuído (Fase 6), histórico de incidentes/uptime (**movido para a Sprint 9 junto com o restante do lote de Sistema**).

Junto vem a atualização das **linhas-resumo da Visão Geral** (US-7.8): a linha de Alunos passa a ancorar na **North Star real** em vez da adesão declarada; a de Financeiro ganha lucro do período; a de Marketing ganha CAC do canal principal. Os limiares de "atenção"/"crítico" dessas linhas novas são **decisão do fundador**, como foram na Sprint 7 — a tela é dele.

### Objetivo

Nenhum rótulo de indisponibilidade desatualizado na plataforma, e as linhas-resumo da Visão Geral ancoradas nas métricas que passaram a existir.

### Resultado esperado

O fundador percorre os 5 pilares e não encontra nenhuma promessa vencida: o que ficou pronto é número, o que mudou de sprint diz a sprint nova e o motivo, o que continua pendente continua nomeado. A Visão Geral abre com a North Star real na linha de Alunos.

### Tasks

**TASK-8.8.1 — Varredura de rótulos de indisponibilidade (Felipe + Lucas ref.).**
Inventariar **todos** os rótulos "indisponível — depende de X, previsto para a Sprint N" criados nas TASK-7.2.4, 7.3.4, 7.4.3, 7.5.4 e 7.7.4, e resolver cada um em uma das três saídas acima. **Nenhum rótulo pode sobreviver à sprint sem revisão explícita.**
**Conclusão:** inventário completo com a decisão por rótulo; **0** rótulos apontando para a Sprint 8 ao fim da sprint.

**TASK-8.8.2 — Linhas-resumo da Visão Geral atualizadas (Felipe + fundador).**
Alunos → North Star real + N em risco; Financeiro → MRR + a renovar 30d + **lucro do período**; Marketing → cadastros + conclusão da anamnese + **CAC do canal principal**. Limiares confirmados pelo fundador. RBAC preservada (linha sem capability não é renderizada **nem computada** — regra da TASK-7.8.2).
**Conclusão:** 5 linhas atualizadas com os números novos; limiares confirmados pelo fundador; RBAC do payload preservada (teste).

**TASK-8.8.3 — Reapontar FAQ e guardrails L1 para a Sprint 9 (Felipe + Lucas).**
Os itens "FAQ" (pilar IA) e a menção a guardrails adicionais passam a indicar **Sprint 9**, com o motivo em uma frase ("publicação por painel de texto que vai ao aluno passa a valer junto com o simulador, que é o que valida configuração antes de publicar"). Mesma honestidade que a Sprint 7 aplicou a si mesma.
**Conclusão:** ambos os itens reapontados com motivo; **0** referências remanescentes a "FAQ — Sprint 8" na UI.

### Definição de Pronto (US-8.8 "validada")

- [ ] Tasks 8.8.1–8.8.3 concluídas.
- [ ] Nenhum rótulo desatualizado; Visão Geral ancorada nas métricas novas; FAQ e L1 reapontados.
- [ ] **Mensurável:** **0** rótulos "previsto para a Sprint 8" na UI ao fim da sprint; **0** indicadores novos exibidos como zero/traço; 100% dos rótulos remanescentes com sprint e dependência corretas (verificado por teste de UI sobre o inventário).
- [ ] **Validada por:** code review + revisão de Lucas (coerência de roadmap na UI) + confirmação de limiares pelo fundador + teste verde (US-8.9).

---

## US-8.9 — QA e segurança da sprint dos dados financeiros

**Agentes:** Mariana (lead — testes, cobertura, quality gates) · Sato (revisão de segurança: webhook, imutabilidade, capabilities novas, PII em log financeiro, **ressalvas herdadas da Sprint 7**) · Eduardo (referência — conferência numérica de lucro/CAC/receita recebida).
**Depende de:** US-8.1 a US-8.8. **Alimenta** o CI. Dias 3-10.
**Habilita:** a entrada segura da Sprint 8 em `main` e a Sprint 9.

### Jornada

Esta sprint introduz **três superfícies de risco novas**, e nenhuma delas é do tipo que a suíte da Sprint 7 já cobre.

**A primeira é uma entrada externa de escrita:** o webhook do gateway é o primeiro endpoint público em que **um sistema de fora escreve fato financeiro** no nosso banco. Os modos de falha são conhecidos e todos silenciosos: evento forjado aceito, evento duplicado contado duas vezes, payload com dado de cobrança indo parar em log. Os três precisam de teste bloqueante — nenhum deles produz erro visível quando acontece.

**A segunda é aritmética financeira.** Lucro, CAC, ROAS, LTV/CAC e distribuição por sócio são números que o fundador vai usar para **tomar decisão de dinheiro**. Um erro de arredondamento, uma dupla contagem de gasto de mídia ou uma divisão por zero mascarada não quebram nada visivelmente — produzem um número plausível e errado, que é a pior classe de bug possível neste contexto. A conferência contra cálculo manual, com **tolerância 0**, é gate.

**A terceira é imutabilidade de histórico.** Três tabelas novas são append-only (`user_status_transitions`, `payments`, e por regra de negócio `expenses`, cuja correção é estorno). O padrão já foi provado contra Postgres real na Sprint 7 e o molde de teste existe — o risco não é técnico, é de esquecimento: uma das três subir sem o trigger e sem o REVOKE.

**Ressalvas herdadas da Sprint 7 (`sprint-7-revisao-seguranca-sato.md`), tratadas aqui:**
- **Ressalva 1 — título de rota no shell sem capability.** Sato recomendou redirecionar para a rota padrão do papel em vez de renderizar a moldura, e não corrigiu na revisão para não mexer em código fora do achado de segurança. **Vira TASK-8.9.5 desta sprint** — é pequena, é UX, e evita que um futuro componente de header passe a exibir contexto real da rota. Com 4 telas novas atrás de capabilities novas (incluindo `PARTNERS_READ`, a mais restrita do sistema), o custo de deixar para depois cresce.
- **Ressalva 2 — `nextVersion` sem lock.** Aceita como está (`ponytail:` já documentado no código); colisão falha a segunda publicação e nada grava errado. **Sem ação.** Registrada aqui para não ser redescoberta.
- **Ressalva 3 — `detectInjection` é denylist.** Sato pediu revisão dos padrões quando houver dados reais de tentativa em produção. Ainda não há produção. **Sem ação nesta sprint;** permanece no radar.
- **Pedido explícito de Sato no fecho da Sprint 7:** revalidar CVEs de `pgvector`, `drizzle-orm` e do SDK da OpenAI **no fecho da Sprint 8**, quando houver mudança de dependência. **Vira TASK-8.9.6.**

### Objetivo

Cobertura ≥80% do código novo e suíte bloqueante no CI cobrindo idempotência e autenticação de webhook, imutabilidade das tabelas novas, RBAC das capabilities novas, k-anonimato de coorte, dedupe de treino, conferência numérica financeira e ausência de PII em log — com as ressalvas herdadas da Sprint 7 endereçadas.

### Resultado esperado

O CI reprova qualquer PR que: aceite evento de webhook sem assinatura válida; conte um evento duplicado duas vezes; permita `UPDATE` em `payments` ou `user_status_transitions`; deixe `FINANCE` alcançar `PARTNERS_READ`; produza divergência entre lucro/CAC exibido e cálculo manual; grave dois registros para o mesmo treino; exiba célula de coorte com n < 10; deixe payload de gateway em log; ou derrube a cobertura abaixo de 80%.

### Tasks

**TASK-8.9.1 — Webhook: autenticação, idempotência e log limpo (bloqueante) (Mariana + Sato).**
Evento sem assinatura válida é rejeitado e registrado; o mesmo evento entregue 5× produz **1** linha e **0** alteração de número agregado; **0** ocorrências de `raw_payload` de gateway em log de aplicação; corpo excessivo e rate limit cobertos.
**Conclusão:** cada cenário plantado falha o pipeline.

**TASK-8.9.2 — Imutabilidade das tabelas novas (bloqueante) (Mariana + Leonardo).**
Teste de integração contra Postgres real (molde de `agent-config-immutability.int-spec.ts`) para `user_status_transitions` e `payments`: `UPDATE`/`DELETE` retornam erro; grants de `movivo_app` conferidos em `information_schema.role_table_grants`. Para `expenses`: **0** endpoints de edição de valor.
**Conclusão:** remover o trigger ou o REVOKE falha o teste; endpoint de edição de despesa plantado falha o pipeline.

**TASK-8.9.3 — RBAC das capabilities novas + cap table (bloqueante) (Mariana + Sato).**
`FINANCE_WRITE` e `MARKETING_WRITE` liberam exatamente o previsto e nada além; **`PARTNERS_READ`/`PARTNERS_WRITE` alcançáveis somente por `ADMIN`** — `FINANCE` recebe `403` no endpoint e o item **ausente** do menu; nenhuma capability nova vaza dado de saúde (as telas financeiras não devem tocar nada de `STUDENTS_HEALTH_READ`).
**Conclusão:** concessão indevida plantada falha o pipeline.

**TASK-8.9.4 — Conferência numérica financeira e de produto (bloqueante) (Mariana + Eduardo ref.).**
Tolerância **0** contra cálculo manual na base de dev para: lucro do período, custo por categoria, custo de IA (**idêntico ao valor da Sprint 7 após a troca para `model_pricing`**), receita recebida, CAC por canal, ROAS, distribuição por sócio e **North Star**. Mais: dedupe de treino (duplo reporte → 1 linha), dupla contagem de gasto de mídia (**0**), célula de coorte com n < 10 (**0**), canal sem investimento não exibindo `R$ 0,00`, e cap table que não fecha 10.000 bps rejeitado.
**Conclusão:** qualquer divergência falha o teste; Eduardo assina a conferência de lucro, CAC e receita recebida.

**TASK-8.9.5 — Ressalva 1 da Sprint 7: redirect de rota sem capability (Felipe + Sato).**
Rota acessada sem a capability correspondente **redireciona para a rota padrão do papel** (mecanismo da TASK-7.1.5) em vez de renderizar a moldura do shell. Cobrir por teste para cada papel, incluindo as rotas novas desta sprint.
**Conclusão:** acesso direto a rota não autorizada redireciona (não renderiza moldura); teste por papel verde; Sato confirma o fechamento da ressalva.

**TASK-8.9.6 — Revalidação de CVEs de dependências (Sato + Henrique).**
Atender ao pedido registrado por Sato no fecho da Sprint 7: revalidar advisories de `pgvector`, `drizzle-orm` e do SDK da OpenAI, mais qualquer dependência nova introduzida por esta sprint (SDK do gateway de pagamento, se houver). **Esta task usa pesquisa web** — é a única do documento que a exige, e a limitação declarada na seção de Fontes se aplica a ela.
**Conclusão:** relatório curto de Sato com o resultado por dependência e ação recomendada; vulnerabilidade alta ou crítica bloqueia o fecho da sprint.

**TASK-8.9.7 — Revisão de segurança consolidada de Sato + fecho da sprint (Mariana + Sato).**
Sato registra a revisão consolidada em `sprint/sprint-8-revisao-seguranca-sato.md`, no mesmo formato da Sprint 7: webhook como superfície externa, imutabilidade, capabilities novas, PII em dado financeiro, entrada não confiável de UTM, e **status de cada ressalva herdada** (1 fechada, 2 aceita, 3 no radar).
**Conclusão:** revisão registrada; status das 3 ressalvas herdadas declarado explicitamente.

### Definição de Pronto (US-8.9 "validada")

- [ ] Tasks 8.9.1–8.9.7 concluídas.
- [ ] Gates bloqueantes no CI: webhook (auth/idempotência/log), imutabilidade, RBAC das capabilities novas, k-anonimato de coorte, dedupe de treino, conferência numérica com tolerância 0.
- [ ] Cobertura ≥80% do código novo.
- [ ] **Validada por:** review de Mariana + **revisão de segurança de Sato registrada** + **conferência numérica assinada por Eduardo** + CI verde.

---

## Matriz de responsabilidade por User Story (RACI simplificado)

| US | Título | Responsável (R) | Colabora (C) | Valida (V) |
|---|---|---|---|---|
| US-8.1 | `workout_completions` + North Star real | **Leonardo** | Victor (captura na conversa), Felipe (telas), Henrique (job de envio), Sofia (copy) | **Victor (custo do canal)** + Sofia (guardrails de copy) + Mariana |
| US-8.2 | Captura de UTM (**dia 2**) | **Felipe** | Leonardo (colunas/validação), Helena (taxonomia) | **Sato (entrada não confiável, PII)** + Helena + Mariana |
| US-8.3 | `user_status_transitions` + coortes | **Leonardo** | Felipe (funil/coortes) | **Eduardo (definições)** + Sato (imutabilidade) + Mariana |
| US-8.4 | `expenses` + `model_pricing` → lucro | **Leonardo** | Felipe (telas), Henrique (categorias de infra/IA) | **Eduardo (categorias, regime, lucro)** + Sato (auditoria) + Mariana |
| US-8.5 | `payments` + webhook de liquidação | **Leonardo** | Henrique (endpoint/retries/observabilidade), Felipe (telas) | **Sato (obrigatória — superfície externa)** + Eduardo + Mariana |
| US-8.6 | `ad_spend` + CAC/ROAS/LTV:CAC | **Leonardo** | Felipe (telas), Helena (canais) | **Helena (CAC)** + **Eduardo (LTV/metas)** + Mariana |
| US-8.7 | `partners` + distribuição por sócio | **Leonardo** | Felipe (tela), Eduardo (base) | **Alexandre (ressalvas societárias)** + Sato (capability restrita) + Mariana |
| US-8.8 | Reconciliação dos rótulos + Visão Geral | **Felipe** | Leonardo (endpoints), Lucas (roadmap na UI) | Lucas + fundador (limiares) + Mariana |
| US-8.9 | QA + segurança | **Mariana** | Leonardo, Felipe, Henrique | Mariana + **Sato** + **Eduardo (números)** + gate no CI |

> **Distribuição de carga:** **Leonardo lidera 6 US** (8.1, 8.3, 8.4, 8.5, 8.6, 8.7) — é a sprint mais pesada de backend do projeto, espelho invertido da Sprint 7, que foi a mais pesada de frontend. Coerente: aquela era uma sprint de interface, esta é uma sprint de **schema e ingestão**. **Felipe lidera 2** (8.2 e 8.8) e colabora em todas — a carga de frontend cai porque as telas já existem desde a Sprint 7; o trabalho agora é preenchê-las. **Henrique apoia** o webhook (8.5) e o job de quick reply (8.1). **Victor não escreve código nesta sprint** — emite um parecer de custo (canal de conversa da US-8.1) e nada mais; **nenhum item desta sprint altera o que a IA responde**, o que é a propriedade que justificou adiar FAQ e guardrails L1. **Sato tem uma superfície crítica** (webhook de pagamento) e uma ressalva herdada a fechar. **Eduardo é o validador de maior carga desta sprint** — quatro definições dele bloqueiam entrega: categorias de despesa, regime de apuração, critério de "convertido" e base de LTV.

## Critério de conclusão da Sprint 8

A Sprint 8 é **entregue** quando as 9 User Stories estiverem "validadas" conforme seus DoDs, o que na prática significa:

1. A **North Star do produto exibe número real** pela primeira vez em 8 sprints, com a taxa de reporte declarada ao lado — e o aluno tem um jeito de um toque de dizer que treinou.
2. **Todo aluno cadastrado a partir do dia 2 tem origem conhecida**, imutável e sobrevivente ao funil de 3 blocos.
3. **Conversão trial→ativo e coortes** saem de inferência e passam a vir de histórico gravado, com o dado reconstruído por backfill visivelmente distinto do observado.
4. **"Lucro" existe**, com regime de apuração declarado, sobre despesa lançada e auditada — e o custo de IA vem de tabela versionada por vigência, não mais de constante.
5. **Receita recebida existe e não se confunde com a contratada**; o webhook do gateway é autenticado, idempotente e não vaza payload para log.
6. **CAC por canal, ROAS e LTV/CAC por origem** respondem à pergunta de anúncio, com janela de atribuição e maturidade da estimativa declaradas — e canal sem investimento nunca aparece como `R$ 0,00`.
7. **"Ganhos por sócio" existe**, sobre lucro real, sob capability restrita a `ADMIN`, com as três ressalvas de governança visíveis (vesting não formalizado, sem reserva de caixa, referência gerencial).
8. **Nenhum rótulo de indisponibilidade vencido** sobrou na plataforma; FAQ e guardrails L1 estão reapontados para a Sprint 9 com o motivo escrito na própria tela.
9. **Quality gate** bloqueante: webhook, imutabilidade, RBAC das capabilities novas, k-anonimato de coorte, dedupe de treino e conferência numérica com tolerância 0. CI verde; cobertura ≥80%; entrega via PR + 6 checks. **Ressalva 1 de Sato fechada; CVEs revalidados.**

### Pré-requisitos / decisões a resolver no início da sprint

- **[Decisão do fundador — dia 1, bloqueia US-8.1] Canal de reporte de treino concluído.** Minha recomendação está escrita: quick reply diário no WhatsApp como primário, check-in semanal como fallback, menção espontânea condicionada ao parecer de custo de Victor. Confirmar horário de envio e a política de não-insistência. **É a decisão de produto mais importante da sprint** — ela define a métrica que diz se o produto funciona.
- **[Decisão de Eduardo — dia 2, bloqueia US-8.4] Plano de categorias de despesa (é ENUM) e regime de apuração** (recomendo caixa) para o lucro exibido.
- **[Decisão de Eduardo — dia 3, bloqueia US-8.3 e US-8.5] Critério de "convertido"** (recomendo primeiro pagamento liquidado) e definição de inadimplência.
- **[Decisão de Eduardo — bloqueia US-8.6] Base de cálculo do LTV** com poucos meses de histórico, e quantas coortes maduras são exigidas para exibir o número sem ressalva.
- **[Decisão de Helena — dia 2, bloqueia US-8.2] Taxonomia canônica de canal/campanha** para UTM. Necessária **antes** de qualquer anúncio ser publicado, não depois.
- **[Decisão do fundador — dia 8, bloqueia US-8.8] Limiares de "atenção"/"crítico"** das linhas-resumo novas (North Star, lucro, CAC).
- **[Validação de Alexandre — bloqueia US-8.7] Texto das ressalvas societárias** da tela de distribuição, coerente com o gap de Acordo de Sócios/vesting que ele mesmo flagueou.
- **[Realidade de dev]** chaves reais/ZDR, conta AraraHQ e ratificação clínica do RT CREF continuam sendo bloqueadores de **lançamento**, não de dev. **Ressalva específica desta sprint:** o webhook de liquidação roda com **eventos de teste do gateway** — a validação com liquidação real só acontece no go-live, e isso precisa constar do checklist de lançamento, porque é a única peça desta sprint cujo comportamento em produção não pode ser inteiramente provado em dev.
- **[Marca]** go-live com usuário real permanece condicionado à liberação INPI (MOVIVO × VIVO) — trava herdada.

---

# Backlog subsequente atualizado — Sprints 9 a 11

Alterações em relação ao backlog publicado na Sprint 7, todas justificadas na seção *Decisão de escopo* deste documento:

## Sprint 9 — Simulador de configuração de IA + as publicações por painel que dependem dele

**Inalterado no núcleo** (simulador em 4 etapas reusando as fixtures do golden set; parâmetros numéricos do motor dentro de envelope fixo), **acrescido de dois itens vindos da Sprint 8**:

- **FAQ determinístico (`faq_entries`)** — *movido da Sprint 8*. Roda depois do guardrail clínico e antes do classificador de intenção, texto validado por `LANGUAGE_RULES` na gravação **e submetido ao simulador antes de publicar**, porque é texto que chega ao aluno sem passar por LLM.
- **Guardrails L1 aditivos (`FLAG`, nunca `BLOCK`)** — *movido da Sprint 8*. Primeira configuração L1, agora com o simulador de pé, que é a ordem correta.
- **Histórico de incidentes manual + uptime real** (pilar Sistema) — *movido da Sprint 8*, item pequeno que sobrava naquele lote e cabe aqui.

**Critério de sucesso:** inalterado, mais — nenhuma resposta de FAQ chega ao aluno sem ter passado pelo simulador e pela validação de linguagem.

## Sprint 10 — Conhecimento da IA (RAG com curadoria)

**Inalterado**, acrescido de um item: **upload de comprovante em `expenses`** — *movido da Sprint 8*. Compartilha exatamente a superfície de segurança do upload de documento de RAG (tipo, tamanho, varredura, storage, retenção, revisor), e construir dois pipelines de upload separados seria trabalho duplicado com dois conjuntos de erro.

## Sprint 11 — Metodologia editável, handoff, projeção financeira e LGPD

**Inalterado.** A projeção com cenários agora tem sua pré-condição satisfeita: a série histórica de despesa e liquidação começa a se acumular **a partir desta Sprint 8**, e por isso a projeção precisa de pelo menos um ciclo completo rodando antes de ser construída — o que continua colocando-a na Sprint 11 e não antes.

---

## Fontes Consultadas

**Declaração de limitação metodológica, explícita conforme meus princípios:** **nenhuma pesquisa web (`WebSearch`/`WebFetch`) foi executada para produzir este documento.** Isto é planejamento de execução derivado do backlog que eu mesmo produzi na Sprint 7, sobre o schema e o código reais do repositório — não é pesquisa de mercado nem benchmark. Onde haveria valor real em benchmark externo, e **isso não foi feito e deve ser considerado lacuna deste documento**: (a) **taxa de resposta esperada para quick reply diário em WhatsApp** (US-8.1) — o desenho do canal primário está apoiado em raciocínio de produto, não em dado de mercado, e uma taxa de reporte baixa comprometeria a North Star; (b) **janelas de atribuição usadas por SaaS B2C de ticket baixo** (US-8.6); (c) **padrões de idempotência e verificação de assinatura documentados pelo gateway escolhido** (US-8.5) — esta última **precisa ser suprida antes da implementação**, lendo a documentação oficial do provedor, e está coberta pela TASK-8.9.6 na parte de advisories. A TASK-8.9.6 é a única task deste documento que exige pesquisa web e a executa.

**Fontes primárias (internas):**

1. **`sprint/sprint-7-plataforma-fundadores.md`** — seção *Backlog priorizado subsequente*, escrita por mim: escopo original US-8.1 a US-8.7, tese da sprint, critério de sucesso, e a seção *Pré-requisitos* que antecipou as três decisões do fundador que esta sprint consome.
2. **`sprint/sprint-7-revisao-seguranca-sato.md`** — Sato: veredito "aprovado com ressalvas", as 3 ressalvas não bloqueantes tratadas na US-8.9 e o pedido explícito de revalidação de CVEs no fecho da Sprint 8.

**Fontes secundárias (documentos do repositório, consultados como restrição):** `docs/arquitetura/ARQUITETURA.md` · `docs/fitness-ia-whatsapp/07-relatorio-eduardo.md` (pricing R$39/R$99/R$349, LTV/CAC ≥ 3, payback ≤3 meses, Simples Anexo III) · `05-relatorio-helena.md` (funil, CAC por canal) · `08-relatorio-lucas.md` (North Star ≥8 treinos/30 dias) · `06-relatorio-alexandre.md` (LGPD, k-anonimato, Acordo de Sócios/vesting não formalizado) · `11-relatorio-sato.md` (RBAC/RLS) · `09-relatorio-sofia.md` (§13 guardrails de linguagem) · `CLAUDE.md` (guardrails inegociáveis, split societário 20% cada, North Star, regras de commit).

---

*Documento de planejamento operacional da Sprint 8 — Lucas Monteiro (PM/PO). **Divergência declarada do meu próprio backlog:** o backlog da Sprint 7 previa 7 itens para esta sprint (US-8.1 a US-8.7); este documento entrega 7 US funcionais + reconciliação + QA, mas **move dois itens originais — FAQ determinístico e guardrails L1 aditivos — para a Sprint 9**, e traz em troca a reconciliação dos rótulos de roadmap (US-8.8) e o fechamento de uma ressalva de segurança herdada (TASK-8.9.5). A razão é de coerência de risco, não de volume: FAQ e guardrails L1 são as duas únicas peças daquele lote que **alteram o caminho de execução do AI Coach**, e o FAQ publica por painel um texto que chega ao aluno sem passar por LLM nem pelos guardrails de saída — ele pertence ao ciclo do simulador, que é justamente a sprint que estende o aparato de segurança ao painel. **Nada foi cortado; os dois itens estão na Sprint 9 com escopo e critério de sucesso.** O que a Sprint 8 entrega é uma sprint com tese única — gravar o que nunca foi gravado — em que nenhum item toca o que a IA responde para o aluno, e cujo resultado é o desaparecimento das três respostas "indisponível" que mais incomodam o fundador: North Star, lucro e CAC por canal. A decisão final sobre o adiamento é do fundador — se ele determinar FAQ e L1 dentro da Sprint 8, eu executo; mas o registro da minha recomendação fica aqui.*
