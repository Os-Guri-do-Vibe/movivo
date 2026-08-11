# Consentimento LGPD e Gate PAR-Q — Fonte Jurídica Autoritativa (MOVIVO)

**Autor:** Dr. Alexandre — CLO / Head Jurídico (agente #06)
**Data:** 2026-07-23
**Destino:** engenharia (Leonardo — `ConsentModule`/`AnamnesisModule`) e frontend (Felipe — telas de consentimento, PAR-Q e cuidado)
**Sprint:** Sprint 1 — Core do Usuário / Anamnese
**Habilita:** US-1.2 (TASK-1.2.1), US-1.3 (TASK-1.3.3), US-1.6 (TASK-1.6.2/1.6.3) — resolve o **BLOQUEADOR 3** do relatório `06-relatorio-alexandre.md`.

> **Este documento é a fonte autoritativa.** Os textos das seções 1 e 2 devem ser copiados **verbatim** pela engenharia. A regra do `ARQUITETURA.md` §3.1 é inegociável: **o texto exibido ao usuário e o texto registrado no banco (referenciado pela coluna `consents.version`) têm de ser byte-a-byte idênticos.** Qualquer alteração de texto exige **novo identificador de versão** (imutabilidade) e nova aprovação jurídica — nunca editar um texto de versão já publicada.

> **Correção de base legal (honestidade jurídica):** a base legal correta para o tratamento de dado de saúde na MOVIVO é o **art. 11, I da LGPD** — *consentimento do titular, de forma específica e destacada, para finalidades específicas* — e **não** o art. 11, II, "a" (que trata de cumprimento de obrigação legal/regulatória e das hipóteses de tutela da saúde por serviços de saúde stricto sensu, que a MOVIVO **não** deve invocar, conforme §3.1 do meu relatório). Onde a task da sprint citou "art. 11, II, 'a'", leia-se **art. 11, I**. Este documento adota o art. 11, I.

> **Validação humana pendente antes do go-live:** os textos aqui são juridicamente estruturados por mim (CLO interno) mas **precisam do preenchimento do CREF real do RT** (placeholder `CREF nº ____`) e de **revisão final de advogado com OAB + do próprio RT CREF** (o RT precisa confirmar, do ponto de vista técnico-profissional, o conjunto de perguntas do PAR-Q e o mapa de bloqueio da seção 2). Ver seção 4.

---

## 1. Textos de consentimento — versionados e imutáveis (LGPD art. 11, I)

### Princípios que a engenharia DEVE respeitar (todos os três consentimentos)

1. **Independência total.** `HEALTH_DATA`, `MARKETING` e `TERMS_OF_SERVICE` são consentimentos **separados e independentes**. É **vedado** amarrá-los num único checkbox ou inferir um do outro (vedação de consentimento genérico — art. 8º, §4º e art. 11, I LGPD). **O consentimento de saúde NUNCA é inferido do aceite dos Termos de Uso.**
2. **Opt-in ativo.** Todo checkbox nasce **desmarcado**. Nada de pré-marcação, nada de "ao continuar você concorda".
3. **Registro como prova.** Cada aceite (e cada recusa) grava: `type`, `version` (imutável), `accepted` (bool), `accepted_at` (timestamp), `ip`, `user_agent`. `ip`/`user_agent` **nunca** vão para log (LoggerModule redige PII).
4. **Revogabilidade.** Consentimento é revogável a qualquer tempo (art. 8º, §5º). Revogar carimba `revoked_at` — **nunca `DELETE`** (append-only por convenção; a trilha é a prova).
5. **Paridade texto exibido ↔ texto registrado.** A `version` referencia um artefato imutável no repositório. Trocou uma vírgula → nova `version`.

---

### 1.1 HEALTH_DATA — Consentimento específico e destacado para dado de saúde

- **Identificador de versão (imutável):** `consent-health-2026-07-v1`
- **Base legal:** LGPD art. 11, I (consentimento específico e destacado para finalidades específicas)
- **Onde aparece:** tela-ponte dedicada, imediatamente antes do Bloco 2 da anamnese (Sofia §9.4). Checkbox **não pré-marcado**; sem ele marcado, o "Continuar" fica desabilitado e o `PATCH .../block/2` é rejeitado no backend (TASK-1.2.3).
- **Regra dura de backend:** `PATCH /anamnesis/session/{token}/block/2` **falha com 4xx e não persiste nada** se não existir `consents(HEALTH_DATA, accepted=true)` para aquela sessão.

**Texto exibido na tela-ponte (corpo da tela — copiar verbatim):**

> **Agora vamos falar da sua saúde**
>
> Para montar um treino seguro e adaptado a você, precisamos de algumas informações de saúde: histórico de lesões, respostas a um questionário de prontidão para atividade física (PAR-Q) e medicações de uso contínuo, se houver.
>
> - **Para que usamos:** exclusivamente para elaborar e adaptar o seu protocolo de treino individualizado.
> - **Quem acessa:** você e o profissional de Educação Física responsável, registrado no CREF nº ____, que usa inteligência artificial apenas como ferramenta de apoio — **a decisão e a supervisão são sempre do profissional**.
> - **Como protegemos:** seus dados de saúde são criptografados e isolados; ninguém fora da equipe responsável tem acesso.
> - **Por quanto tempo:** mantemos seus dados de saúde enquanto você for cliente e, após o encerramento, pelo prazo necessário para cumprir obrigações legais e para defesa em eventual reclamação (até 5 anos). Depois disso, eles são anonimizados ou eliminados.
> - **Você no controle:** pode revogar esta autorização quando quiser, sem custo, pelo WhatsApp da MOVIVO ou pelo e-mail do nosso Encarregado de Dados (informado na Política de Privacidade). A revogação interrompe novos tratamentos daqui pra frente.

**Texto do checkbox de aceite (label — copiar verbatim):**

> ☐ Autorizo a MOVIVO a tratar os meus dados de saúde para a finalidade de elaborar e adaptar o meu treino, conforme descrito acima e na Política de Privacidade.

**Notas para a engenharia:**
- O texto acima é a **versão `consent-health-2026-07-v1` completa**. O que se registra em `consents.version` é este identificador; o artefato de texto (as duas partes: corpo + label) fica versionado no repo (`packages/shared` como constante, sugestão) e é a fonte da renderização — garantindo paridade.
- O placeholder `CREF nº ____` **deve ser substituído pelo número real do RT antes do go-live** (não pode ir a produção com o traço). Sugestão: injetar via config (`RT_CREF_NUMBER`) mas **congelar no texto da versão** no momento da publicação — se o número mudar, é nova versão.
- Linguagem clara, sem juridiquês, sem termo proibido (nada de "diagnóstico"/"tratamento"/"cura"/"resultado garantido"); presença do CREF visível; IA como ferramenta do profissional. Guardrails OK.

#### 1.1.1 Versão vigente — `consent-health-2026-08-v2`

A v1 acima permanece imutável como artefato histórico. A v2 altera somente a instrução de revogação para tornar o canal do WhatsApp executável e inequívoco:

> - **Você no controle:** pode revogar esta autorização quando quiser, sem custo. No WhatsApp da MOVIVO, envie exatamente “REVOGAR CONSENTIMENTO DE SAÚDE”; ou contate o e-mail do nosso Encarregado de Dados (informado na Política de Privacidade). A revogação interrompe novos tratamentos daqui pra frente.

O backend normaliza acentos e caixa, mas exige correspondência integral com a frase. A revogação carimba `revoked_at`, interrompe novos processamentos e preserva o histórico necessário para obrigações legais e exercício regular de direitos.

---

### 1.2 MARKETING — Consentimento separado e opcional para comunicações

- **Identificador de versão (imutável):** `consent-marketing-2026-07-v1`
- **Base legal:** LGPD art. 7º, I (consentimento) para comunicação de marketing; independente do de saúde.
- **Default:** **NÃO marcado**. É opcional — o usuário avança e usa o produto normalmente sem marcá-lo.
- **Onde aparece:** pode conviver na mesma tela-ponte (Sofia §9.4), mas é **checkbox próprio e separado**, nunca condicionante do avanço.

**Texto do checkbox (label — copiar verbatim):**

> ☐ Quero receber dicas de treino, novidades e ofertas da MOVIVO pelo WhatsApp. (opcional — você pode cancelar quando quiser)

**Nota:** revogável de forma independente (`revoke(userId, 'MARKETING')`) sem afetar `HEALTH_DATA` nem `TERMS_OF_SERVICE`.

---

### 1.3 TERMS_OF_SERVICE — Aceite dos Termos de Uso e Política de Privacidade

- **Identificador de versão (imutável):** `terms-2026-07-v1` (rótulo que o registro referencia)
- **Base legal:** execução de contrato (art. 7º, V) + o aceite documenta ciência da Política de Privacidade.
- **Onde aparece:** Bloco 0 (identificação), junto ao gate de idade 18+ (Sofia §9.2). Checkbox próprio, **não pré-marcado**.
- **Escopo deste documento:** aqui defino **apenas o rótulo/versão** que o registro `consents(TERMS_OF_SERVICE, version='terms-2026-07-v1')` referencia e o texto do checkbox. O **texto integral** dos Termos de Uso e da Política de Privacidade é artefato separado (BLOQUEADOR 4 do meu relatório) — não é entregável desta sprint, mas o **rótulo de versão precisa existir agora** para o registro ser válido.

**Texto do checkbox (label — copiar verbatim):**

> ☐ Li e aceito os [Termos de Uso](/termos) e a [Política de Privacidade](/privacidade) da MOVIVO.

**Gate de idade (mesma tela, checkbox independente e obrigatório — copiar verbatim):**

> ☐ Confirmo que tenho 18 anos ou mais.

**Nota:** o gate de idade **não** é um "consentimento" no sentido do art. 11 — é uma declaração de elegibilidade (a MOVIVO não trata dado de menor no MVP — art. 14 LGPD). Persistir como flag do usuário/sessão, mas **não** confundir com os três consentimentos acima.

---

### 1.4 Tabela-resumo para a engenharia

| `type` | `version` (imutável) | Default | Bloqueia avanço? | Onde |
|---|---|---|---|---|
| `HEALTH_DATA` | `consent-health-2026-08-v2` | desmarcado | **Sim** — trava o Bloco 2 | tela-ponte antes do Bloco 2 |
| `MARKETING` | `consent-marketing-2026-07-v1` | desmarcado | Não | tela-ponte (checkbox separado) |
| `TERMS_OF_SERVICE` | `terms-2026-07-v1` | desmarcado | **Sim** — trava saída do Bloco 0 | Bloco 0 (identificação) |

**Regra de ouro:** os três são registros independentes na tabela `consents`. Um aceite jamais implica o outro. O de saúde jamais é inferido do aceite dos Termos.

---

## 2. PAR-Q — conjunto autoritativo + mapa determinístico de bloqueio (gate bloqueante)

- **Identificador de versão do conjunto (imutável):** `parq-2026-07-v1`
- **Fundamento:** PAR-Q clássico (7 perguntas) + adaptações do PAR-Q+ 2024 e do produto de musculação (gestação, cirurgia recente, pergunta aberta). Adaptado ao português, linguagem acolhedora.
- **Natureza jurídica do gate (BLOQUEADOR 3 / §5 do meu relatório):** o gate é uma **TRAVA, não uma flag**. Qualquer resposta de risco **impede a geração automática do protocolo** e marca `users.requires_professional_review = true`. **Nenhum protocolo nasce de uma sessão bloqueada.** A avaliação é **100% determinística** (sem IA — regra §12.4/§12.5 do ARQUITETURA).
- **Estados resultantes (Sofia §8.5, alinhado ao meu §5):** `LIBERADO` / `BLOQUEADO_AGUARDANDO_CLEARANCE` / `LIBERADO_COM_RESSALVA_RT`. No submit, sessão sem risco → `LIBERADO` (fluxo normal); sessão com qualquer risco → `BLOQUEADO_AGUARDANDO_CLEARANCE` + `requires_professional_review=true`. A transição para `LIBERADO_COM_RESSALVA_RT` só ocorre por ação humana do RT (fora do escopo de código da Sprint 1 — basta o estado persistido e consultável).

### 2.1 Perguntas oficiais (`parq-2026-07-v1`, Q1..Q9)

Cada pergunta é **binária (Não/Sim)**, salvo Q9 (aberta). O texto abaixo é o **exibido ao usuário** (verbatim) e o **rótulo canônico** que a engenharia persiste.

| ID | Texto exibido ao usuário (verbatim) | Tipo | Follow-up |
|---|---|---|---|
| **Q1** | O seu médico já disse que você tem algum problema no coração ou pressão alta? | Não/Sim | se Sim: campo aberto opcional "Conta um pouco mais?" |
| **Q2** | Você sente dor no peito quando faz atividade física? | Não/Sim | idem |
| **Q3** | No último mês, você sentiu dor no peito mesmo sem estar se exercitando? | Não/Sim | idem |
| **Q4** | Você já perdeu o equilíbrio por tontura ou já desmaiou? | Não/Sim | idem |
| **Q5** | Você toma algum medicamento contínuo para pressão ou para o coração? | Não/Sim | se Sim: campo aberto opcional (qual) |
| **Q6** | Você tem algum problema em osso, articulação ou coluna que pode piorar com atividade física? | Não/Sim | se Sim: chips de região (ombro/joelho/coluna/outro) |
| **Q7** | Você está grávida ou teve bebê nas últimas semanas? | Não/Sim | idem |
| **Q8** | Você passou por alguma cirurgia nos últimos 6 meses? | Não/Sim | se Sim: campo aberto opcional |
| **Q9** | Você sabe de algum outro motivo pelo qual não deveria praticar atividade física? | Não/Sim + texto | se Sim: campo aberto **obrigatório** (qual motivo) |

> Observação de UX (Sofia §9.5): ao marcar "Sim" num item de risco, exibir follow-up **sem alarme** — *"Obrigada por contar. Isso é importante pra sua segurança."* Nunca vermelho-alarme; usar Coral suave.

### 2.2 Mapa determinístico de respostas de risco (a trava)

Regra única e simples de implementar: **"Sim" em QUALQUER uma de Q1 a Q9 dispara o bloqueio.** É o comportamento clássico do PAR-Q (uma resposta afirmativa já exige avaliação/liberação). Não há pergunta "neutra" — todas as nove são de risco quando afirmativas.

| ID | Resposta que dispara bloqueio | Efeito |
|---|---|---|
| Q1 | `Sim` | `requires_professional_review=true` + `BLOQUEADO_AGUARDANDO_CLEARANCE` |
| Q2 | `Sim` | idem |
| Q3 | `Sim` | idem |
| Q4 | `Sim` | idem |
| Q5 | `Sim` | idem |
| Q6 | `Sim` | idem |
| Q7 | `Sim` | idem |
| Q8 | `Sim` | idem |
| Q9 | `Sim` | idem |

**Pseudocódigo de referência (determinístico, sem IA):**

```
respostasDeRisco = [Q1..Q9].filter(q => q.resposta === 'Sim')
if (respostasDeRisco.length > 0) {
    user.requires_professional_review = true
    session.parq_state = 'BLOQUEADO_AGUARDANDO_CLEARANCE'
    // NÃO enfileira geração de protocolo. Trava, não flag.
} else {
    session.parq_state = 'LIBERADO'   // fluxo normal segue para Sprint 2
}
```

**Notas obrigatórias:**
- É **trava**: a sessão em `BLOQUEADO_AGUARDANDO_CLEARANCE` **não pode** disparar geração automática de protocolo em hipótese alguma (nem na Sprint 2). O desbloqueio é ato humano do RT (`LIBERADO_COM_RESSALVA_RT`) ou envio de liberação médica.
- Persistir **quais** perguntas dispararam (para o RT ver no dashboard da Sprint 5), mas o dado do PAR-Q é **saúde** → gravado cifrado em `data_block_2` (pgcrypto, US-1.1).
- O retorno da API ao frontend em caso de bloqueio **não** contém linguagem de diagnóstico — apenas o estado (`BLOQUEADO_AGUARDANDO_CLEARANCE`) que a tela de cuidado (2.3) reflete.

### 2.3 Microcopy da tela de cuidado (estado bloqueado) — guardrails

Exibida quando o submit retorna `BLOQUEADO_AGUARDANDO_CLEARANCE` (Sofia §9.6). Tom **sério-acolhedor**, sem diagnóstico, sem "você não pode treinar", sem "você está doente".

**Texto exibido (copiar verbatim):**

> **Antes de montar seu treino, um cuidado a mais**
>
> Obrigada por responder com sinceridade — isso é importante para a sua segurança.
>
> Pelo que você contou, o profissional de Educação Física responsável vai revisar as suas respostas com atenção antes de montar o seu treino. Pode ser que ele peça uma liberação médica — é o jeito mais seguro de começar.
>
> Isso **não** é um "não". É cuidado de verdade, para o seu treino começar do jeito certo.
>
> [ Enviar liberação médica ]
> [ Fazer isso depois no WhatsApp ]
>
> *Sem diagnóstico. Sem pressa. A gente cuida disso com você.*

**Proibições explícitas nesta e em qualquer tela do gate:** "diagnóstico", "tratamento", "cura", "doente", "você não pode treinar", "resultado garantido". Erros e avisos em Coral (nunca vermelho-alarme). Presença do profissional CREF sempre visível.

---

## 3. Trilha de auditoria — decisão (CONFIRMADA)

**Confirmo:** para a Sprint 1, a **trilha de consentimento na própria tabela `consents` é juridicamente suficiente** como prova de consentimento, desde que atenda cumulativamente a **todos** os requisitos abaixo:

1. **`version` imutável** referenciando o artefato de texto versionado no repo (paridade exibido↔registrado — §3.1). Trocar texto = nova versão.
2. **`accepted_at` (timestamp), `ip` e `user_agent`** registrados no momento do aceite (prova de circunstância — art. 8º e capacidade de demonstrar o consentimento, art. 8º, §2º).
3. **Append-only por convenção:** revogação via `revoked_at`, **nunca `DELETE`/`UPDATE` destrutivo** do registro de aceite. Recusa (`accepted=false`) também é registrada.
4. **Idempotência** pela unique `uq_consents_user_type_version` (reaceitar a mesma versão não duplica nem sobrescreve).
5. **Sob RLS** (US-1.1) e com `ip`/`user_agent` **nunca em log**.

**Concordo que o `audit_logs` append-only garantido por banco (GRANT + RULE + hash chain, Sato §11) pode ficar para a Sprint 5** — desde que os 5 pontos acima estejam implementados nesta sprint. O `audit_logs` com garantia de banco **eleva** o padrão probatório (imutabilidade forçada por permissão, não por convenção), o que é desejável e será exigido na escala; mas para o **volume e o risco do MVP/piloto**, a tabela `consents` com os controles acima é **defensável** como prova de consentimento válido.

**Mínimo inegociável já nesta sprint (não pode escorregar para a Sprint 5):**
- Os 5 pontos acima na tabela `consents`.
- A **paridade texto↔versão** (§3.1) — é o que dá valor probatório ao registro; sem ela, o `ip`/timestamp provam pouco.
- A **regra dura** de o Bloco 2 ser intransponível sem `HEALTH_DATA accepted=true` (senão a "prova de consentimento" não corresponde ao dado coletado).

**Ressalva:** a convenção append-only depende de disciplina de código + code review. Recomendo que Sato adicione, já nesta sprint (baixo custo), um **`REVOKE UPDATE, DELETE`** para `movivo_app` na tabela `consents` (mantendo `INSERT` e o `UPDATE` restrito só à coluna `revoked_at`, se viável) — transforma a convenção em garantia parcial de banco sem o custo da hash chain completa. Se inviável no tempo da sprint, aceito a convenção + review, com a hash chain migrando para a Sprint 5.

---

## 4. Pontos que exigem validação humana antes do go-live

Estes itens **não** bloqueiam a implementação/testes da Sprint 1 (a engenharia pode codar com os textos acima), mas **bloqueiam o go-live com usuário real**:

1. **Preenchimento do `CREF nº ____`** com o número real do RT em `consent-health-2026-07-v1` (e a consequente publicação da versão definitiva). Enquanto for placeholder, é ambiente de dev/teste apenas.
2. **Revisão técnico-profissional do RT CREF** sobre o conjunto `parq-2026-07-v1` (as 9 perguntas) e o mapa de bloqueio da seção 2.2 — o RT é quem assume a responsabilidade técnica; ele precisa confirmar por escrito que o conjunto e a trava refletem a triagem que ele endossa.
3. **Revisão de advogado com OAB** dos Termos de Uso e da Política de Privacidade integrais (`terms-2026-07-v1`) — artefato separado, BLOQUEADOR 4.
4. **Nomeação do Encarregado/DPO** e publicação do canal de contato citado no texto de HEALTH_DATA (a Política de Privacidade precisa existir para o link `/privacidade` não ser vazio).

Enquanto (1)–(4) não estiverem resolvidos, os textos aqui são válidos para **desenvolvimento e teste**, não para produção com titulares reais.

---

## 5. Onboarding v2 (Sprint 6) — Etapa 1: conjunto final de consentimentos e avisos

**Data:** 2026-08-10 · **Autor:** Dr. Alexandre (CLO) · **Entrega:** US-6.2 (TASK-6.2.1/6.2.2/6.2.3) — pré-requisito bloqueante de US-6.4/6.7.

> As seções 1 a 5 deste documento **permanecem válidas e imutáveis** como artefato histórico. Esta seção 6 **publica novas versões** e é a que a engenharia deve implementar no onboarding v2. Nada acima foi editado.

### 5.0 Princípio que resolve as três dúvidas da spec do fundador

**Consentimento não é a base legal "mais segura" — é a mais frágil.** O art. 8º, §5º torna todo consentimento revogável a qualquer tempo. Pedir consentimento para um tratamento que é **indispensável à execução do contrato** (art. 7º, V) cria um direito de revogação que, se exercido, obriga a MOVIVO a parar de tratar o dado **sem poder parar de prestar o serviço** — ou a fazer o teatro de "revogar" e continuar tratando, o que é pior do ponto de vista probatório do que nunca ter pedido. A ANPD e a doutrina consolidada são convergentes: **cada finalidade recebe a base legal que efetivamente a sustenta, e não se "reforça" base contratual com consentimento**.

Daí decorre, para as 4+1 caixas da spec:

- **Dado pessoal comum** necessário para criar/personalizar/acompanhar o treino (nome, telefone, e-mail, data de nascimento, sexo biológico, objetivos, rotina, preferências) → **art. 7º, V (execução de contrato)**. **Não é checkbox.** É informação obrigatória nos Termos e na Política de Privacidade.
- **Dado de saúde** (seção 4 da anamnese + PAR-Q) → **art. 11, I (consentimento específico e destacado)**. **É checkbox, bloqueante.**
- **Mensagens operacionais no WhatsApp** → **art. 7º, V.** O WhatsApp é o canal de entrega do próprio serviço contratado. **Não é checkbox** — vira **aviso** e cláusula de Termos.
- **Ciência do uso de IA com supervisão CREF** → **dever de informação/transparência** (art. 6º, VI e art. 9º), não autorização. **É checkbox de "estou ciente", bloqueante**, porque a MOVIVO precisa **provar** que informou antes do uso (guardrail inegociável de Clóvis/Gabriel).
- **Marketing** → **art. 7º, I (consentimento)**. **Checkbox, opcional, nunca bloqueante.**

**Divergência registrada da contagem do fundador (4 obrigatórias + 1 opcional):** a Etapa 1 passa a ter **3 checkboxes obrigatórias + 1 opcional + 1 aviso sem checkbox**. A caixa #3 (mensagens operacionais) deixa de ser caixa. **Motivo:** apresentá-la como caixa comunica ao usuário que ela é recusável/revogável; ela não é — recusar equivale a não contratar o serviço. Uma caixa que o produto não honra quando revogada é prova contra a MOVIVO, não a favor. Nenhuma informação da spec foi eliminada: o conteúdo da caixa #3 passa a ser exibido como aviso destacado na mesma tela e como cláusula expressa dos Termos.

**Sobre a caixa #2 ("dados pessoais **e** dados de saúde"):** **não é fundida.** Fundir manteria uma única caixa cobrindo duas finalidades com bases legais distintas — exatamente o "consentimento genérico" vedado pelo art. 8º, §4º, e a destruição da granularidade estabelecida na seção 1.4. A metade "dados pessoais" migra para a base contratual (Termos/Política); a metade "dados de saúde" permanece como consentimento específico e destacado, agora em **v3** com escopo ampliado para os campos novos da anamnese v2. Resultado: a caixa #2 continua sendo **uma** caixa na tela — mas cobrindo **só saúde**, e com o restante informado, não consentido.

---

### 5.1 TERMS_OF_SERVICE — `terms-2026-08-v2`

- **Base legal:** art. 7º, V (execução de contrato) + documenta ciência da Política de Privacidade.
- **Bloqueante:** **SIM** — trava o `CONTINUAR` da Etapa 1.
- **Por que versão nova:** os Termos passam a conter, obrigatoriamente, (a) a cláusula de entrega do serviço via WhatsApp e (b) as finalidades do tratamento de dado pessoal comum sob base contratual. Texto do rótulo também muda.

**Rótulo da checkbox (verbatim):**

> ☐ Li e aceito os [Termos de Uso](/termos) e a [Política de Privacidade](/privacidade) da MOVIVO.

**Cláusulas que o corpo dos Termos `terms-2026-08-v2` obrigatoriamente passa a conter** (o corpo integral é artefato separado, com revisão de advogado com OAB — seção 4, item 3):

> **Canal de prestação do serviço.** A MOVIVO é prestada por meio do WhatsApp. Ao contratar, você concorda em receber neste canal as mensagens necessárias à execução do serviço — entrega e atualização do seu protocolo de treino, respostas do assistente, check-ins, avisos de segurança, comunicações do profissional de Educação Física responsável e informações sobre a sua assinatura e pagamentos. Essas mensagens não são publicidade e não podem ser desativadas isoladamente: sem elas, não há como prestar o serviço. Você pode encerrar o recebimento a qualquer momento cancelando a assinatura.
>
> **Dados que usamos para prestar o serviço.** Para criar, personalizar e acompanhar o seu treino, tratamos os dados que você informa no cadastro e na anamnese: nome, telefone, e-mail (quando informado), data de nascimento, sexo biológico, objetivos, experiência, rotina, disponibilidade, local de treino e preferências. Esse tratamento é necessário para executar o contrato entre você e a MOVIVO (art. 7º, V da LGPD). Seus **dados de saúde** têm tratamento separado e dependem da sua autorização específica, pedida no momento próprio.
>
> **Data de nascimento e sexo biológico.** A data de nascimento é usada para confirmar que você tem 18 anos ou mais (a MOVIVO não atende menores de 18) e para adequar a prescrição do treino à sua faixa etária. O sexo biológico é usado como parâmetro técnico de prescrição de treino. Nenhum dos dois é usado para decisões automatizadas sobre a sua contratação ou preço.

---

### 5.2 Aviso WhatsApp operacional — `aviso-whatsapp-operacional-2026-08-v1`

- **Base legal:** art. 7º, V (execução de contrato). **Não é consentimento.**
- **Checkbox:** **NÃO EXISTE.** É texto exibido na Etapa 1, com destaque visual, imediatamente acima ou abaixo do bloco de checkboxes.
- **Bloqueante:** não aplicável (não há aceite a dar). O aceite contratual correspondente é o de `TERMS_OF_SERVICE`.
- **Registro:** não gera linha em `consents`. A prova de exibição é a paridade versão↔tela: o identificador `aviso-whatsapp-operacional-2026-08-v1` fica no artefato versionado do repositório junto dos demais textos da Etapa 1, e o registro de `TERMS_OF_SERVICE` na mesma tela carimba o momento.

**Texto exibido (verbatim):**

> **Como a MOVIVO fala com você**
>
> Seu treino, os check-ins e a conversa com o Coach acontecem no WhatsApp — é assim que a MOVIVO funciona. Ao continuar, você passa a receber neste número as mensagens necessárias para o serviço funcionar: seu protocolo de treino, respostas do Coach, check-ins, avisos de segurança, recados do profissional de Educação Física responsável e informações da sua assinatura.
>
> Isso não é propaganda e não tem como ser desligado separadamente — sem essas mensagens não existe treino. Novidades e ofertas são outra coisa, e ficam por sua conta na última opção abaixo.

---

### 5.3 HEALTH_DATA — `consent-health-2026-08-v3`

- **Base legal:** art. 11, I (consentimento específico e destacado para finalidades específicas).
- **Bloqueante:** **SIM**, em dois pontos, e ambos são validados no servidor:
  1. trava o `CONTINUAR` da **Etapa 1**;
  2. continua travando a **coleta da seção 4 da Etapa 2 e de toda a Etapa 3 (PAR-Q)** — a checagem de servidor da regra da Sprint 1 permanece, sem depender de o front ter travado a Etapa 1. Se o consentimento for revogado entre a Etapa 1 e a Etapa 2, a coleta de saúde é recusada mesmo com a Etapa 1 já concluída.
- **Por que v3 (e não edição da v2):** o escopo do tratamento aumentou. A anamnese v2 coleta dor localizada com intensidade e tendência, diagnóstico informado pelo usuário, acompanhamento médico/fisioterapêutico e recomendações profissionais de evitação — nada disso existia na v2. Um consentimento não cobre finalidade que não descreve. **A v2 permanece imutável como artefato histórico.**
- **Onde aparece:** Etapa 1, como bloco próprio destacado (corpo + checkbox), separado visualmente das demais opções.

**Corpo exibido na Etapa 1 (verbatim):**

> **Sobre a sua saúde**
>
> Para montar um treino seguro e adaptado a você, precisamos de informações de saúde: dores atuais (região, intensidade e se estão melhorando ou piorando), lesões e cirurgias, diagnósticos que você já tenha recebido, se você faz acompanhamento com médico ou fisioterapeuta, orientações profissionais de evitar algum movimento, medicações de uso contínuo e as respostas ao questionário de prontidão para atividade física (PAR-Q).
>
> - **Para que usamos:** exclusivamente para elaborar, adaptar e acompanhar o seu protocolo de treino individualizado, e para identificar quando o seu caso precisa ser analisado por uma pessoa antes de qualquer treino ser gerado.
> - **Quem acessa:** você e o profissional de Educação Física responsável, registrado no CREF nº ____, que usa inteligência artificial apenas como ferramenta de apoio — **a decisão e a supervisão são sempre do profissional**.
> - **Como protegemos:** seus dados de saúde são criptografados e isolados; ninguém fora da equipe responsável tem acesso.
> - **Por quanto tempo:** mantemos seus dados de saúde enquanto você for cliente e, após o encerramento, pelo prazo necessário para cumprir obrigações legais e para defesa em eventual reclamação (até 5 anos). Depois disso, eles são anonimizados ou eliminados.
> - **Você no controle:** pode revogar esta autorização quando quiser, sem custo. No WhatsApp da MOVIVO, envie exatamente “REVOGAR CONSENTIMENTO DE SAÚDE”; ou contate o e-mail do nosso Encarregado de Dados (informado na Política de Privacidade). A revogação interrompe novos tratamentos daqui pra frente — e, como o treino individualizado depende desses dados, ela também interrompe a geração de novos treinos.

**Rótulo da checkbox (verbatim):**

> ☐ Autorizo a MOVIVO a tratar os meus dados de saúde para elaborar, adaptar e acompanhar o meu treino, conforme descrito acima e na Política de Privacidade.

**Notas para a engenharia:**
- O placeholder `CREF nº ____` continua sendo bloqueador de go-live (seção 4, item 1). Preencher = **nova versão** (`consent-health-2026-08-v4` ou o mês vigente na publicação), nunca edição da v3.
- A frase final da revogação foi ampliada de propósito: a v2 dizia apenas "interrompe novos tratamentos". Como a revogação agora inviabiliza a geração de treino, informar isso **antes** do aceite é requisito de transparência (art. 6º, VI) e evita a alegação de que a consequência foi ocultada.

---

### 5.4 AI_DISCLOSURE — `ai-disclosure-2026-08-v1`

- **Natureza jurídica:** **dever de informação e transparência** (art. 6º, VI, e art. 9º da LGPD; e o dever de informação adequada e clara do art. 6º, III do CDC). **Não é consentimento** — o usuário não "autoriza" a MOVIVO a usar IA, ele é informado de que ela é usada e de que há um profissional CREF responsável.
- **Bloqueante:** **SIM** — trava o `CONTINUAR` da Etapa 1.
- **Por que ainda assim é checkbox, e por que ainda assim é registrada em `consents`:** o valor aqui é **probatório**, não autorizativo. A MOVIVO precisa demonstrar, com data, hora, IP e versão de texto, que o usuário foi informado **antes** de usar o produto — é a defesa direta contra a alegação de que ele acreditou estar sendo atendido por um humano, e é a materialização do guardrail inegociável da marca. O mecanismo de prova já existe (`consents` versionada, append-only) — reusá-lo é mais barato e mais forte do que inventar um segundo mecanismo.
- **Consequência de a base legal não ser consentimento:** este registro **não é revogável** e não expõe botão de revogação. Uma "ciência" não se desfaz; o que o usuário pode fazer é encerrar a assinatura. A engenharia **não** deve aceitar `revoke(userId, 'AI_DISCLOSURE')`.
- **Redação obrigatoriamente na 1ª pessoa de ciência ("Estou ciente"), nunca "Autorizo"** — a escolha do verbo é o que mantém a natureza jurídica correta.

**Corpo exibido na Etapa 1 (verbatim):**

> **Como o seu treino é feito**
>
> Seu treino é montado a partir da metodologia de um profissional de Educação Física registrado no CREF nº ____, que é o responsável técnico pela MOVIVO. A inteligência artificial é a ferramenta que aplica essa metodologia ao seu caso e conversa com você no dia a dia — ela nunca decide sozinha e nunca substitui o profissional.
>
> Sempre que as suas respostas indicarem que o seu caso precisa de um olhar humano, nenhum treino é gerado automaticamente: o profissional analisa antes. A MOVIVO não faz diagnóstico e não substitui avaliação médica.

**Rótulo da checkbox (verbatim):**

> ☐ Estou ciente de que a MOVIVO usa inteligência artificial como ferramenta, com metodologia e supervisão de um profissional de Educação Física registrado no CREF.

---

### 5.5 MARKETING — `consent-marketing-2026-08-v2`

- **Base legal:** art. 7º, I (consentimento).
- **Bloqueante:** **NÃO.** Nunca condiciona o avanço, o cadastro, o preço ou qualquer funcionalidade (art. 9º, §3º — vedação de condicionar o fornecimento a consentimento para finalidade não necessária).
- **Por que v2:** o onboarding v2 coleta e-mail, e a comunicação passa a poder ocorrer por WhatsApp **e** e-mail; a v1 mencionava apenas o WhatsApp. Escopo novo ⇒ versão nova.
- **Revogável de forma independente**, sem afetar nenhum outro registro.

**Rótulo da checkbox (verbatim):**

> ☐ Quero receber novidades, conteúdos e condições especiais da MOVIVO pelo WhatsApp e por e-mail. (opcional — você pode cancelar quando quiser)

---

### 5.6 Gate de idade 18+ (permanece — não é consentimento)

Mantido como na seção 1.3: declaração de elegibilidade, não consentimento; validado **no servidor** a partir da data de nascimento, e não apenas por checkbox de autodeclaração (regra inegociável 5 da Sprint 6). Não gera linha em `consents`.

---

### 5.7 Minimização — campos da anamnese v2 sem finalidade ativa (TASK-6.2.2 / item 10 das pendências)

Avaliação campo a campo dos coletados sem uso na geração de treino no MVP:

| Campo | Decisão | Base legal / justificativa |
|---|---|---|
| Data de nascimento | **Manter** | Necessário ao gate 18+ (art. 14) e à adequação etária da prescrição. Finalidade declarada em `terms-2026-08-v2`. Art. 7º, V. |
| Sexo biológico | **Manter** | Parâmetro técnico legítimo de prescrição de treino. **Não é dado sensível** (art. 5º, II não o abrange — não confundir com dado sobre vida sexual ou identidade de gênero). Finalidade declarada em `terms-2026-08-v2`. Art. 7º, V. **Restrição:** coletar apenas o estritamente necessário à prescrição; **não** coletar identidade de gênero, orientação sexual ou qualquer campo adjacente — isso seria dado sensível sem finalidade. |
| Período preferido de treino, dias preferidos | **Manter** | Personalização e lembretes — finalidade contratual direta. Art. 7º, V. |
| Data/evento importante (e descrição) | **Manter, com limite** | Personalização de meta e periodização. Art. 7º, V. **Campo livre limitado em tamanho** e com aviso de UX para não inserir dado de saúde; se o usuário inserir, o campo herda tratamento de saúde na prática — por isso **recomendo que este campo vá para o bloco cifrado** (`dataBlock2`), não para o jsonb em claro. Classificação a confirmar com Sato na US-6.3. |
| O que dificultou consistência antes (barreiras) | **Manter** | Copy do Coach e retenção. Art. 7º, V. Opções fechadas + "outro"; o "outro" é campo livre e vale a mesma ressalva acima. |
| Atividades já praticadas / outro esporte | **Manter** | Gestão de volume total. Art. 7º, V. |
| "Parado há quanto tempo" | **Manter** | Insumo direto de nível/progressão. Art. 7º, V. |
| Diagnóstico informado, acompanhamento médico/fisio, recomendação profissional de evitar | **Manter — dado de saúde** | **Coberto expressamente pelo `consent-health-2026-08-v3`** (resolve a TASK-6.7.3). Art. 11, I. Cifrado em `dataBlock2`, retenção de até 5 anos após o encerramento, conforme o texto da v3. |
| Dor: região, intensidade 0-10, tendência, o que provoca | **Manter — dado de saúde** | Idem acima. Art. 11, I. |
| E-mail | **Manter, opcional** | Recuperação de acesso e comunicação transacional (art. 7º, V); uso para marketing **só** com `MARKETING` aceito. |

**Nenhum campo da spec do fundador é descartado por minimização.** Todos têm finalidade declarável e agora declarada. A ressalva real não é *quais* campos, e sim os **campos de texto livre**: são o vetor pelo qual dado sensível entra em coluna não classificada como sensível. Recomendação vinculante para a engenharia: **todo campo de texto livre da anamnese v2 vai para o bloco cifrado (`dataBlock2`)**, independentemente da seção em que a UI o exiba. É mais barato cifrar tudo que é livre do que auditar o que o usuário digitou.

---

### 5.8 Tabela final — para o Leonardo transcrever (US-6.4)

| # na tela | `type` | `version` | Base legal | Checkbox? | Default | Bloqueante | Revogável | Onde/o que trava |
|---|---|---|---|---|---|---|---|---|
| 1 | `TERMS_OF_SERVICE` | `terms-2026-08-v2` | Art. 7º, V (execução de contrato) | Sim | desmarcado | **Sim** | Não (equivale a cancelar) | `CONTINUAR` da Etapa 1 |
| — | *(aviso)* `WHATSAPP_OPERATIONAL_NOTICE` | `aviso-whatsapp-operacional-2026-08-v1` | Art. 7º, V (execução de contrato) | **Não** | — | n/a | n/a | Só exibição; **não grava em `consents`** |
| 2 | `HEALTH_DATA` | `consent-health-2026-08-v3` | **Art. 11, I** (consentimento específico e destacado) | Sim | desmarcado | **Sim** | **Sim** | `CONTINUAR` da Etapa 1 **e** coleta da seção 4 + Etapa 3 (PAR-Q), ambos no servidor |
| 3 | `AI_DISCLOSURE` | `ai-disclosure-2026-08-v1` | Dever de informação/transparência (art. 6º, VI e art. 9º LGPD; art. 6º, III CDC) — **não é consentimento** | Sim ("Estou ciente") | desmarcado | **Sim** | **Não** | `CONTINUAR` da Etapa 1 |
| 4 | `MARKETING` | `consent-marketing-2026-08-v2` | Art. 7º, I (consentimento) | Sim | desmarcado | **Não** | **Sim** | Nada |

**Regras que continuam valendo integralmente (seção 1):** opt-in ativo (nada pré-marcado), independência total entre os registros, paridade byte-a-byte texto exibido ↔ texto versionado, append-only com `revoked_at`, `ip`/`user_agent` derivados no servidor e nunca em log, versões antigas jamais editadas.

**Regras novas específicas do v2:**
1. `AI_DISCLOSURE` **não aceita revogação** — o serviço deve recusar a operação, não apenas omitir o botão.
2. O `enum` de `type` ganha `AI_DISCLOSURE`; `WHATSAPP_OPERATIONAL_NOTICE` **não** entra no enum de `consents` (não é aceite), e sim no artefato de textos versionados da Etapa 1.
3. O lote enviado pela Etapa 1 passa a aceitar até **4** itens (`recordConsentsSchema`), não 3.
4. A checagem de servidor "sem `HEALTH_DATA accepted=true` não coleta saúde" é **independente** da conclusão da Etapa 1 e deve ser reavaliada no momento da coleta, para cobrir revogação no meio do funil.

---

## 6. Fontes Consultadas

- PAR-Q+ 2024 — The Physical Activity Readiness Questionnaire for Everyone (documento oficial, City of Surrey): https://www.surrey.ca/sites/default/files/media/documents/ParQ-Plus-2024-pdf.pdf
- APTA — Physical Activity Readiness Questionnaire (PAR-Q, PAR-Q+): https://www.apta.org/patient-care/evidence-based-practice-resources/test-measures/physical-activity-readiness-questionnaire-par-q-par-q
- NASM Blog — Everything You Need to Know About the PAR-Q (7 perguntas clássicas): https://blog.nasm.org/everything-you-need-to-know-about-the-par-q
- PMC — Public Perceptions on the Use of the Physical Activity Readiness Questionnaire: https://pmc.ncbi.nlm.nih.gov/articles/PMC11395539/
- LGPD Brasil — Art. 11 (tratamento de dados pessoais sensíveis): https://lgpd-brasil.info/capitulo_02/artigo_11
- Assis e Mendes Advogados — Art. 11 LGPD na íntegra: https://assisemendes.com.br/lei_na_integra/artigo-11-tratamento-de-dados-pessoais-sensiveis/
- LEC — LGPD e o mito do consentimento para dados de saúde (especificidade e destaque do art. 11, I): https://lec.com.br/lgpd-e-o-mito-do-consentimento-para-tratamento-dos-dados-de-saude/

> **Limitações declaradas:** (1) O PDF oficial do PAR-Q+ 2024 retornou 403 na coleta automática; as 7 perguntas clássicas foram confirmadas por fonte secundária (NASM/APTA) e adaptadas ao produto — o RT CREF deve validar a formulação final (seção 4, item 2). (2) Este documento é insumo de CLO interno e **não substitui parecer formal de advogado com OAB** nem a validação técnica do RT CREF para o go-live.
