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
| `HEALTH_DATA` | `consent-health-2026-07-v1` | desmarcado | **Sim** — trava o Bloco 2 | tela-ponte antes do Bloco 2 |
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

## 5. Fontes Consultadas

- PAR-Q+ 2024 — The Physical Activity Readiness Questionnaire for Everyone (documento oficial, City of Surrey): https://www.surrey.ca/sites/default/files/media/documents/ParQ-Plus-2024-pdf.pdf
- APTA — Physical Activity Readiness Questionnaire (PAR-Q, PAR-Q+): https://www.apta.org/patient-care/evidence-based-practice-resources/test-measures/physical-activity-readiness-questionnaire-par-q-par-q
- NASM Blog — Everything You Need to Know About the PAR-Q (7 perguntas clássicas): https://blog.nasm.org/everything-you-need-to-know-about-the-par-q
- PMC — Public Perceptions on the Use of the Physical Activity Readiness Questionnaire: https://pmc.ncbi.nlm.nih.gov/articles/PMC11395539/
- LGPD Brasil — Art. 11 (tratamento de dados pessoais sensíveis): https://lgpd-brasil.info/capitulo_02/artigo_11
- Assis e Mendes Advogados — Art. 11 LGPD na íntegra: https://assisemendes.com.br/lei_na_integra/artigo-11-tratamento-de-dados-pessoais-sensiveis/
- LEC — LGPD e o mito do consentimento para dados de saúde (especificidade e destaque do art. 11, I): https://lec.com.br/lgpd-e-o-mito-do-consentimento-para-tratamento-dos-dados-de-saude/

> **Limitações declaradas:** (1) O PDF oficial do PAR-Q+ 2024 retornou 403 na coleta automática; as 7 perguntas clássicas foram confirmadas por fonte secundária (NASM/APTA) e adaptadas ao produto — o RT CREF deve validar a formulação final (seção 4, item 2). (2) Este documento é insumo de CLO interno e **não substitui parecer formal de advogado com OAB** nem a validação técnica do RT CREF para o go-live.
