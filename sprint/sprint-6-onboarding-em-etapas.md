# Sprint 6 — Onboarding em 3 Etapas (Cadastro · Anamnese Expandida · PAR-Q) (MOVIVO)

**Autor:** Lucas Monteiro (Senior Product Manager / Product Owner — agente #08)
**Data:** 2026-08-10
**Ideia:** MOVIVO — AI Coach de treino no WhatsApp (`docs/fitness-ia-whatsapp/`)
**Fase do pipeline:** Fase 5 — Desenvolvimento (Sprint 6, pós-MVP funcional)
**Origem do escopo:** **especificação escrita pelo fundador (2026-08-10)** — substituição integral da jornada de entrada do produto. Não é um item do roadmap original de Lucas (`08-relatorio-lucas.md`); é uma **revisão de produto sobre o Épico 1 (Aquisição e Anamnese)** já entregue na Sprint 1.
**Duração alvo:** 2 semanas (10 dias úteis) · Leonardo (backend) + Felipe (frontend) + Mariana (QA), com Sofia (UX, **pré-requisito**), Alexandre (consentimentos, **pré-requisito bloqueante**), Sato (revisão de segurança do OTP/dado de saúde), Victor (referência no mapeamento anamnese→geração).
**Documentos-fonte obrigatórios:** `docs/arquitetura/ARQUITETURA.md` (§8 RLS/cifra, §12 regras inegociáveis) · `docs/juridico/consentimento-e-parq.md` (Alexandre — textos verbatim e PAR-Q oficial) · `docs/fitness-ia-whatsapp/06-relatorio-alexandre.md` (LGPD Art. 11, gate PAR-Q, consentimento granular) · `docs/fitness-ia-whatsapp/09-relatorio-sofia.md` (design system "O Pulso", §§8-9 fluxo do formulário, §13 termos proibidos) · `docs/fitness-ia-whatsapp/12-relatorio-victor.md` (lacuna "a anamnese não captura nível") · `sprint/sprint-1-core-usuario-anamnese.md` (o que está sendo substituído).

---

## Como ler este documento

Hierarquia: **Épicos → User Stories (US-6.x) → Tasks (TASK-6.x.y)**.

- Cada **User Story** declara: agentes participantes e ordem, dependências (depende de / habilita), jornada, objetivo, resultado esperado, tasks e **Definição de Pronto (DoD)**.
- Cada **Task** declara: agente executor, instruções acionáveis e critério de conclusão objetivo.
- Uma User Story só é **ENTREGUE** quando todas as tasks estiverem finalizadas **E validadas** conforme o DoD.
- Esta sprint **não adiciona um novo mecanismo de valor** — ela **reconstrói a porta de entrada** do produto e, no caminho, **fecha a maior lacuna de qualidade da geração de treino** (a anamnese v1 não captura nível de experiência, ênfase, preferências nem dor localizada — metade da metodologia do RT nunca roda em produção, achado de Victor).

---

> **Decisões do fundador (2026-08-10) — valem sobre qualquer "a confirmar" registrado abaixo:**
>
> 1. **D1 confirmado: substituição destrutiva.** A anamnese v1 sai de vez, sem flag. Não há sessão real em produção; nenhum backfill é necessário.
> 2. **D3: "faça o que for legalmente correto."** Alexandre decide o mapeamento final dos 4+1 consentimentos (fusão/separação, base legal de cada um, se "mensagens operacionais" é consentimento ou execução de contrato) — a US-6.2 segue como bloqueadora de US-6.4, sem atalho.
> 3. **Objetivo: os 9 valores reais, sem redução para 3.** Rejeitada a recomendação de mapear 9→3 — o fundador foi explícito: **"não adianta MVP, sem informações realmente validadas pelo profissional CREF"** — o RT sugeriu esses 9 objetivos e eles entram como estão. Isso implica ampliar `primaryGoalSchema` para os 9 valores (+ "Outro" com texto livre), e Leonardo precisa avaliar o impacto real em `EXERCISE_CATALOG`, `methodology.ts` e `ValidationService` (que hoje só conhecem 3 objetivos) — não é só trocar o enum, é garantir que a geração/validação continuem coerentes para os 9. Se algum dos 9 precisar de exercícios/regras que o catálogo ainda não cobre, isso é trabalho desta sprint, não da Fase 2.
> 4. **Local de treino: ampliar para os 4 valores da spec** (academia completa / academia de condomínio / casa / ar livre), substituindo `HOME`/`GYM`/`BOTH`. Leonardo avalia o impacto no catálogo (`ExerciseLocation`, filtros de exercício por local) com o mesmo padrão de rigor do item 3 — os exercícios "ar livre" e "academia de condomínio" precisam ter cobertura real no catálogo, não um mapeamento forçado para o valor mais próximo.

---

## Decisões de escopo (registradas, não implícitas)

### D1 — **SUBSTITUI** a anamnese da Sprint 1. Não convive atrás de flag.

O fundador pediu para "mudar toda a jornada". A anamnese v1 (`anamnesisBlock1/2/3Schema`, `PATCH /anamnesis/{id}/block/{n}` com `n ∈ {1,2,3}`, tela `apps/web/src/app/anamnese/page.tsx`) **sai do produto**. Motivo de produto: manter as duas jornadas vivas dobraria a superfície de teste, dobraria o mapeamento para `UserConstraints` e criaria dois formatos de dado de saúde cifrado — custo alto para um produto que ainda não tem usuário real.

**Implicações registradas:**

- **Dados já coletados:** o produto **não está em produção** (memória do projeto: "dev local, não produção"; go-live ainda travado por ZDR/DPA, conta AraraHQ, ratificação do RT e parecer INPI). Portanto a migração pode ser **destrutiva para sessões de anamnese v1** (que hoje são só seeds e dados de teste). **DECISÃO A CONFIRMAR COM O FUNDADOR** antes do merge: se existir **qualquer** sessão real coletada, a migração vira `drop + recoleta` (usuário refaz o onboarding) — não haverá backfill automático, porque a v2 pergunta coisas que a v1 nunca perguntou e inventar valores para dado de saúde é inaceitável.
- **O que NÃO sai:** o PAR-Q (`PARQ_VERSION`, `evaluateParq`, `parqSchema`), o gate `BLOCKED_PENDING_CLEARANCE`, a cifra `HealthCipherService`/pgcrypto, a RLS, o token opaco de retomada (72h), a tabela `anamnesis_sessions`, o registro versionado de consentimento e a fila de supervisão CREF da Sprint 5 (que lê exatamente esse status). **Tudo isso é reusado e estendido, não redesenhado.**

### D2 — O PAR-Q pedido pelo fundador **já existe**. É reuso, não trabalho jurídico novo.

A especificação pede "questionário PAR-Q versão oficial e validada segundo lei brasileira". Isso é literalmente o conjunto `parq-2026-07-v1` (9 perguntas, binário Sim/Não, Q9=Sim exige motivo), com fonte jurídica em `docs/juridico/consentimento-e-parq.md` e avaliação **100% determinística no backend** (`evaluateParq`, nunca por IA). A regra de branch pedida ("todas Não → segue automático; alguma Sim → análise profissional") **também já é o comportamento atual** (`requiresProfessionalReview` → `BLOCKED_PENDING_CLEARANCE`). **Não se abre discussão jurídica sobre o PAR-Q nesta sprint.** O que é novo é apenas: (a) o PAR-Q vira a **etapa 3 visível** de um wizard com barra de progresso, (b) as **3 confirmações finais** da spec do fundador, (c) os **nomes de status exibidos ao usuário** (`APTO PARA PREPARAÇÃO DO TREINO` / `AGUARDANDO ANÁLISE PROFISSIONAL`) precisam ser mapeados para os enums existentes — rótulo de UI, não enum novo.

### D3 — Consentimentos: **BLOQUEADOR de Alexandre antes de qualquer código.**

A spec do fundador tem **4 checkboxes obrigatórias + 1 opcional**. O sistema hoje tem **3 tipos versionados** (`TERMS_OF_SERVICE`, `HEALTH_DATA`, `MARKETING`). O mapeamento **não é 1:1**:

| # | Checkbox da spec do fundador | Tipo atual | Situação |
|---|---|---|---|
| 1 | Termos de Uso + Política de Privacidade | `TERMS_OF_SERVICE` v1 | ✅ mapeia direto |
| 2 | Tratamento de dados **pessoais e de saúde** para criar/personalizar/acompanhar o treino | `HEALTH_DATA` v2 | ⚠️ **funde duas finalidades hoje separadas** — o texto atual cobre só saúde, e o comentário do arquivo é explícito: "as três finalidades são INDEPENDENTES; um aceite jamais implica o outro". Fundir pode **enfraquecer a granularidade** que Alexandre desenhou. |
| 3 | Envio de mensagens **operacionais** pelo WhatsApp | ❌ **não existe** | ⚠️ tipo novo. Juridicamente pode ser **execução de contrato** (Art. 7º V), não consentimento — coletar consentimento para algo que é base legal contratual cria um direito de revogação que quebra o produto (sem WhatsApp não há produto). |
| 4 | Ciência de que a MOVIVO usa **IA com metodologia e supervisão de profissional CREF** | ❌ **não existe** | ⚠️ é **ciência/transparência**, provavelmente não "consentimento". Mas é justamente o guardrail inegociável de Clóvis/Gabriel — precisa ficar registrado e provável. |
| 5 | Newsletter/novidades (opcional) | `MARKETING` v1 | ✅ mapeia direto |

> **REGRA:** `packages/shared/src/schemas/consent.schema.ts` diz "texto novo ⇒ versão nova. Nunca edite o corpo de uma versão já publicada". Alterar o texto de `HEALTH_DATA` ou criar tipos novos é **território de Alexandre, não do Leonardo**. **Leonardo NÃO codifica a US-6.4 antes de receber de Alexandre:** (a) os textos verbatim finais, (b) os identificadores de versão, (c) a base legal de cada um (consentimento vs. execução de contrato vs. mera ciência), (d) quais são realmente bloqueantes do avanço do formulário. Ver US-6.1.

### D4 — Verificação de WhatsApp: **código via WhatsApp (AraraHQ), nunca SMS.** Decisão já tomada com o fundador.

Capacidade nova. Reusa a fila `whatsapp-outbound` e o AraraHQ que já existem — **nenhum provedor novo é contratado**. O código é uma credencial de acesso a um fluxo que vai coletar dado de saúde: precisa de CSPRNG, expiração curta, rate limit de envio **e** de tentativa, e não pode virar vetor de spam/enumeração de números. Sato revisa.

### D5 — Validação de e-mail descartável é **P1, não bloqueante.**

O e-mail é **opcional** na própria spec do fundador — o identificador funcional do produto é o telefone. Uma lista estática de domínios descartáveis resolve 90% do caso em ~20 linhas. Entra na sprint, mas **não trava** nenhuma outra US e pode cair para a Sprint 7 sem prejuízo.

### D6 — O que esta sprint **fecha** na geração de treino (a razão técnica de ela valer a pena)

Victor apontou que "metade da metodologia do RT nunca roda em produção porque a anamnese não captura nível". Hoje `UserConstraints.level` é hardcoded `INICIANTE` com um `ponytail:` no código pedindo exatamente isto. A anamnese v2 captura, de verdade:

| Campo novo da anamnese v2 | Destino | Uso |
|---|---|---|
| Experiência com musculação (iniciante/intermediário/avançado) | `UserConstraints.level` | **Fecha o default hardcoded.** Muda seleção de exercício, volume e progressão. |
| Objetivo principal (9 opções + Outro) | `UserConstraints.goal` | ⚠️ `primaryGoalSchema` hoje tem **3** valores (`LOSE_WEIGHT`/`GAIN_MUSCLE`/`CONDITIONING`). 9 opções exigem **ampliar o enum ou mapear 9→3**. **Decisão a confirmar (US-6.8)** — mapear 9→3 preserva o gerador atual; ampliar exige revisar o catálogo e o `ValidationService`. Recomendação de produto: **mapear 9→3 no MVP + guardar o valor original bruto** para a Fase 2. |
| Até 2 regiões de ênfase (11 opções) | `UserConstraints.emphasis[]` (novo) | Direciona volume por grupo muscular. |
| Exercício que não gosta / não quer fazer | `UserConstraints.avoid[]` (novo) | Exclusão no gerador. **Nunca** sobrepõe uma contraindicação de segurança. |
| Dor atual: região(ões) + intensidade 0-10 + tendência | `UserConstraints.injuryTags` (via `mapInjuriesToTags`) + sinal de supervisão | **Dado de saúde.** Alimenta o validador e pode disparar revisão humana (US-6.6). |
| Tempo por treino (5 faixas) | `UserConstraints.sessionMinutes` | Já existe; passa a vir de faixa em vez de número livre. |
| Onde treina (academia completa / condomínio / casa / ar livre) | `UserConstraints.location` | ⚠️ enum atual é `HOME`/`GYM`/`BOTH` — **4 opções não cabem em 3**. Exige ampliar `ExerciseLocation` **e** o catálogo de exercícios. Ver US-6.8. |
| Dias/semana + quais dias | `daysPerWeek` (+ `preferredDays[]`, novo) | `daysPerWeek` já usado; os dias específicos são para agendamento/lembretes (Fase 2). |
| Outro esporte praticado | contexto do prompt | Gestão de volume total. |
| **Perfil/CRM, sem uso na geração ainda:** data de nascimento, sexo biológico, período preferido, data/evento importante, atividades já praticadas, o que dificultou consistência antes, "parado há quanto tempo", diagnóstico/acompanhamento médico (texto livre) | — | Segmentação, copy do Coach, e insumo do profissional CREF no painel. **Coletar não é usar:** cada campo aqui precisa justificar retenção sob LGPD (minimização). Marcado para revisão de Alexandre na US-6.6. |

> ⚠️ **Sexo biológico** e **data de nascimento** merecem nota: são coletados na spec, mas se **não** forem usados na geração no MVP, são dado pessoal retido sem finalidade ativa além de "18+" e segmentação. Manter é defensável (idade é insumo legítimo de prescrição), mas **a finalidade precisa estar escrita no consentimento** — mais um item da lista de Alexandre.

---

## Base já entregue (não reconstruir — consumir)

- **`anamnesis_sessions`** com `token` opaco (72h), `status`, `lastBlock`, `dataBlock1` (jsonb), `dataBlock2` (**bytea cifrado**), `dataBlock3` (jsonb), `parqState`, RLS com `user_id` como coluna líder. A v2 **remodela o conteúdo dos blocos**, não a tabela nem o mecanismo de retomada.
- **`HealthCipherService`** (pgcrypto `pgp_sym_encrypt`) — todo dado de saúde novo (seção 4 + PAR-Q) usa **o mesmo helper**, sem inventar um segundo padrão de cifra.
- **PAR-Q determinístico** (`parq.ts`, `parq.spec.ts`, `evaluateParq`) + gate `BLOCKED_PENDING_CLEARANCE` + fila de supervisão CREF (Sprint 5, US-5.5) — o branch "análise profissional" **já tem destino humano construído**.
- **Consentimento versionado** (`consent.service.ts`, `consents.version`, IP/UA derivados no servidor) — o mecanismo de prova está pronto; só o **conteúdo** muda (D3).
- **Outbound WhatsApp / AraraHQ + fila `whatsapp-outbound`** (Sprint 2/3) — o OTP e a confirmação síncrona usam o que já existe.
- **Design system "O Pulso"** (Sofia, `09-relatorio-sofia.md`) — o wizard usa os componentes existentes; não se cria um segundo sistema visual.
- **Salvamento de progresso por bloco** — preservado, adaptado às novas etapas.

## Regras inegociáveis nesta sprint

1. **Avaliação do PAR-Q é determinística no backend. Nunca IA.** Nenhuma etapa do onboarding chama LLM.
2. **`BLOCKED_PENDING_CLEARANCE` nunca auto-libera** — a liberação é ação humana no painel (Sprint 5). A tela de sucesso V2 é a face de usuário desse estado.
3. **Todo dado de saúde novo (seção 4 + PAR-Q) é cifrado em repouso** com o `HealthCipherService`, decifrado só sob `SET LOCAL`/RLS. A seção 4 **não** pode cair em `dataBlock1`/`dataBlock3` (jsonb em claro).
4. **Consentimento de saúde continua travando o bloco de saúde** — sem aceite, o formulário não coleta a seção 4 nem o PAR-Q. Checkbox **nunca** pré-marcada.
5. **18+ é regra de negócio bloqueante** (menor de 18 não avança, mensagem exata do fundador). Validada **no servidor**, não só no cliente — validação de cliente é UX, não controle.
6. **Guardrails de linguagem** em toda copy nova (Sofia §13 / Clóvis / Gabriel): nunca "diagnóstico", "tratamento", "cura", "resultado garantido"; a IA nunca decide sozinha; respaldo CREF visível — **especialmente na tela de sucesso V2**, que é justamente onde o usuário fica sabendo que um humano vai olhar.
7. **Nenhum endpoint aceita `user_id`/escopo vindo do cliente** — escopo pelo token da sessão de anamnese (ADR-006).
8. **Toda entrega via PR + 6 checks verdes; cobertura ≥80%.** Testes de cifra, RLS, gate 18+, gate PAR-Q e rate limit do OTP são **bloqueantes**.

---

# ÉPICO 8 — Onboarding em 3 Etapas (substituição integral da anamnese v1)

### Descrição

Substituir a porta de entrada da MOVIVO por um **wizard de 3 etapas com barra de progresso**: **(1) cadastro pessoal** com 18+, sexo biológico, WhatsApp **verificado por código enviado no próprio WhatsApp** e 4+1 consentimentos; **(2) anamnese expandida** em 5 seções (objetivos, histórico, rotina, dores e limitações, preferências) — a mudança que finalmente dá ao gerador o **nível de experiência, a ênfase, as preferências e a dor localizada** que ele nunca teve; **(3) PAR-Q** — o mesmo conjunto oficial já implementado e juridicamente validado, agora com as 3 confirmações finais da spec do fundador; e uma **tela de sucesso em 2 variantes** — "perfil liberado" (todas as respostas "Não" → geração automática segue) e "perfil em análise" (alguma "Sim" → o profissional CREF analisa antes, alimentando a fila de supervisão da Sprint 5).

### Objetivo

Ao final da Sprint 6: um novo usuário entra pela landing, prova que é dono do número de WhatsApp, dá consentimentos granulares e juridicamente sólidos, responde uma anamnese rica o suficiente para o protocolo ser de fato individualizado, passa pelo PAR-Q oficial e cai na tela de sucesso correta para o seu estado clínico — e o gerador de protocolo recebe, pela primeira vez, **nível, ênfase, preferências e dor localizada reais**, em vez de defaults.

### Resultado esperado

- Wizard de 3 etapas com barra de progresso e retomada por token (72h), preservando progresso por etapa.
- Verificação de posse do número via **código enviado no WhatsApp** (AraraHQ), com expiração, rate limit e reenvio idempotente.
- Consentimentos reconciliados **com texto e base legal aprovados por Alexandre**, versionados, com prova (versão + IP/UA no servidor).
- Anamnese v2 completa (5 seções, com todos os branches condicionais da spec), com a **seção 4 (dores) cifrada** junto com o PAR-Q.
- PAR-Q reusado sem alteração jurídica + 3 confirmações finais + os 2 status de saída mapeados aos enums existentes.
- 2 telas de sucesso, com copy nos guardrails e botão "Abrir WhatsApp".
- `UserConstraints` alimentado de verdade; `level` deixa de ser default.
- Anamnese v1 **removida** do código (schemas, endpoints, tela).
- Quality gate bloqueante e revisão de segurança de Sato registrada.

### Não-escopo desta sprint

- **Agendamento/lembrete por dia da semana preferido** — os dias são coletados, mas o uso é Fase 2.
- **Ampliação do catálogo de exercícios** para os novos locais/ênfases além do mínimo necessário ao mapeamento (US-6.8) — expansão de catálogo é trabalho próprio.
- **Uso na geração** dos campos marcados como "perfil/CRM" (data de nascimento além do 18+, sexo biológico, evento importante, histórico de atividades, barreiras de consistência).
- **Verificação de e-mail** (link de confirmação). Só validação de formato + bloqueio de descartável (P1).
- **Login/conta do usuário final** — o onboarding segue não-autenticado por token (ADR-006). Não é esta sprint que cria conta com senha para usuário.
- **Reescrita do gerador ou do `ValidationService`** — eles recebem constraints mais ricas, não uma arquitetura nova.

### Mapa de dependências entre User Stories

```
PRÉ-REQUISITOS (dia 1-2, BLOQUEANTES)
US-6.1 (UX do wizard + 2 telas de sucesso · Sofia) ──────────┐  bloqueia Felipe
US-6.2 (Consentimentos: texto, versão, base legal · Alexandre)┤  bloqueia Leonardo (US-6.4)

BACKEND
US-6.3 (Schema onboarding v2 + migração de substituição · Leonardo) ── começa dia 1
US-6.4 (Cadastro: 18+, consentimentos, e-mail · Leonardo) ── dep 6.2 + 6.3
US-6.5 (Verificação de WhatsApp por código · Leonardo + Sato) ── dep 6.3 · independente de 6.2
US-6.6 (Anamnese seções 1,2,3,5 · Leonardo) ── dep 6.3
US-6.7 (Seção 4: dores e limitações — dado de saúde · Leonardo + Alexandre) ── dep 6.3/6.6
US-6.8 (PAR-Q como etapa 3 + confirmações + status · Leonardo) ── dep 6.3 · REUSA parq.ts
US-6.9 (Mapeamento anamnese v2 → UserConstraints · Leonardo + Victor ref.) ── dep 6.6/6.7

FRONTEND
US-6.10 (Wizard 3 etapas: progresso, branches, máscara, OTP · Felipe) ── dep 6.1 + 6.3..6.8
US-6.11 (Telas de sucesso V1/V2 · Felipe) ── dep 6.1 + 6.8

FECHAMENTO
US-6.12 (QA + segurança + remoção da v1 · Mariana + Sato) ── valida 6.3 a 6.11
```

**Sequência prática recomendada (10 dias úteis):** **dia 1** Sofia (US-6.1) e Alexandre (US-6.2) começam em paralelo com Leonardo no schema (US-6.3) — é o único trabalho de backend que não depende de decisão pendente. **Dias 2-4:** US-6.5 (OTP) e US-6.8 (PAR-Q, reuso puro) — nenhuma das duas espera Alexandre. **Dias 3-6:** US-6.6 e US-6.7 (anamnese). **US-6.4 só começa quando Alexandre entregar** (alvo: dia 3). **Dias 4-8:** Felipe no wizard (US-6.10), assim que Sofia entregar. **Dias 7-9:** US-6.9 (mapeamento) e US-6.11 (telas de sucesso). **Dias 4-10:** Mariana (US-6.12), com a remoção da v1 no fim.

---

## US-6.1 — Especificação de UX do wizard e das 2 telas de sucesso (PRÉ-REQUISITO)

**Agentes:** Sofia (lead) · Lucas (referência — a spec do fundador é a fonte de conteúdo) · Felipe (consumidor).
**Depende de:** nada. **Começa no dia 1.**
**Habilita:** US-6.10 e US-6.11. **Felipe não começa o wizard sem isto.**

### Jornada

A spec do fundador define **o quê** (campos, copy, tipos de input, branches), não **como se navega**. São ~40 campos em 3 etapas — o risco real é abandono no meio. Sofia precisa decidir, dentro de "O Pulso": como a **barra de progresso** se comporta (3 etapas com sub-progresso das 5 seções, ou 3 passos secos?), como os **branches condicionais** aparecem/desaparecem sem fazer a página "pular", o padrão dos **botões com ícone das 11 regiões corporais** (a spec pede ícone — não existe esse conjunto hoje), o input de **intensidade de dor 0-10** (slider vs. escala discreta — dado clínico, precisa ser legível), o padrão do **campo "Outro" com texto livre**, o **estado de espera do código de WhatsApp** (com reenvio e contador), a mensagem de bloqueio para menores de 18, e os **2 layouts da tela de sucesso** — sendo que a **V2 ("em análise") é a tela mais delicada do produto**: precisa comunicar cuidado, não rejeição, e deixar o respaldo CREF visível sem soar como diagnóstico.

### Objetivo

Entregar o fluxo visual, os estados e a especificação de componentes das 3 etapas + 2 telas de sucesso, sobre "O Pulso", com WCAG 2.2 AA, pronto para Felipe implementar sem decidir UX no meio do código.

### Resultado esperado

Felipe recebe: comportamento da barra de progresso, tratamento dos campos condicionais, conjunto de ícones das regiões corporais, padrões de input (seleção única, múltipla, escala 0-10, data, texto livre, máscara de telefone), estados de erro/espera/reenvio do OTP, e os 2 layouts de sucesso — todos com copy final revisada nos guardrails.

### Tasks

**TASK-6.1.1 — Fluxo, progresso e estados condicionais (Sofia).**
Especificar as 3 etapas com barra de progresso, o comportamento de retomada ("continuar de onde parei"), a revelação/ocultação dos campos condicionais (parado→há quanto tempo; evento→data+descrição; outro esporte→qual+dias; dor→bloco inteiro da seção 4; diagnóstico→qual; recomendação→o quê; exercício indesejado→qual), e a tela de bloqueio 18-. **Conclusão:** fluxo aprovado, sem ambiguidade de navegação; a11y considerada.

**TASK-6.1.2 — Padrões de input + ícones das regiões corporais (Sofia).**
Especificar seleção única, múltipla com limite (**máx. 2 regiões de ênfase**), escala de intensidade 0-10, data de nascimento, máscara `(xx) xxxxx-xxxx`, campo "Outro". Definir/selecionar o conjunto de **11 ícones de região corporal** (spec do fundador pede botões com ícone) e as **10 regiões de dor** da seção 4 — reusar um icon set já disponível antes de desenhar do zero. **Conclusão:** componentes especificados; ícones definidos e disponíveis para Felipe.

**TASK-6.1.3 — Estado de verificação do WhatsApp (Sofia + Felipe ref.).**
Especificar a tela/estado de "enviamos um código no seu WhatsApp": input do código, contador de reenvio, erro de código inválido/expirado, e o limite de tentativas. Copy nos guardrails. **Conclusão:** todos os estados do OTP cobertos, incluindo os de falha.

**TASK-6.1.4 — Os 2 layouts de tela de sucesso (Sofia + Lucas).**
V1 "Tudo pronto, [NOME]!" (4 próximos passos, prazo de entrega, botão "Abrir WhatsApp") e V2 "Recebemos suas informações, [NOME]!" (análise do profissional, prazo, botão). **V2 é crítica:** acolhimento, respaldo CREF visível, zero linguagem de diagnóstico/rejeição, e **prazo de análise que precisa ser um número que a operação consiga cumprir** — ⚠️ **decisão a confirmar com o fundador/RT:** qual é o SLA prometido para a análise humana (o SLA de entrega automática é ≤2h; o de análise humana **não existe definido**). **Conclusão:** 2 layouts com copy final; SLA da V2 confirmado por escrito ou marcado como pendência de lançamento.

### Definição de Pronto (US-6.1)

- [ ] Tasks 6.1.1–6.1.4 concluídas.
- [ ] Fluxo, estados, componentes, ícones e copy das 3 etapas + 2 telas de sucesso especificados sobre "O Pulso", WCAG 2.2 AA.
- [ ] **Validada por:** revisão de Lucas (fidelidade à spec do fundador — nada cortado silenciosamente) + revisão de guardrails de linguagem.

---

## US-6.2 — Reconciliação jurídica dos consentimentos (PRÉ-REQUISITO BLOQUEANTE)

**Agentes:** Alexandre (lead) · Lucas (traz a spec) · Leonardo (consumidor).
**Depende de:** nada. **Começa no dia 1.**
**Habilita:** US-6.4. **Leonardo NÃO codifica os consentimentos sem esta entrega.**

### Jornada

A spec do fundador pede 4 checkboxes obrigatórias + 1 opcional; o sistema tem 3 tipos versionados cujo próprio arquivo declara que **as finalidades são independentes e um aceite jamais implica o outro**. Três problemas concretos (detalhados em **D3** acima): a checkbox 2 **funde** "dados pessoais" e "dados de saúde"; a checkbox 3 (mensagens operacionais no WhatsApp) provavelmente **não é consentimento e sim execução de contrato** — e coletá-la como consentimento cria um direito de revogação que inviabiliza o produto; a checkbox 4 (ciência do uso de IA supervisionada) é **transparência**, não autorização, mas é justamente o guardrail inegociável da marca e precisa de registro probatório. Além disso, a anamnese v2 coleta campos que a v1 não coletava (sexo biológico, data de nascimento, diagnóstico médico em texto livre, acompanhamento médico) — **as finalidades desses campos precisam estar no texto do consentimento de saúde**, sob pena de o registro deixar de cobrir o que é tratado.

### Objetivo

Entregar, por escrito, o conjunto final de consentimentos/avisos do onboarding v2: texto verbatim, identificador de versão, base legal, obrigatoriedade e o que cada um destrava no formulário.

### Resultado esperado

Leonardo recebe uma tabela fechada (tipo → versão → texto → base legal → bloqueante sim/não) que ele transcreve para `consent.schema.ts` sem tomar nenhuma decisão jurídica.

### Tasks

**TASK-6.2.1 — Decidir o mapeamento 4+1 ↔ tipos versionados (Alexandre).**
Decidir: (a) se "dados pessoais e de saúde" vira uma `HEALTH_DATA` v3 com escopo ampliado ou permanece separado; (b) se "mensagens operacionais no WhatsApp" é consentimento (tipo novo `WHATSAPP_OPERATIONAL`) ou base legal contratual apenas informada; (c) se "ciência do uso de IA supervisionada" é consentimento, aviso registrado ou parte dos Termos; (d) o que acontece com `HEALTH_DATA v2` já existente (nova versão, nunca edição). **Conclusão:** mapeamento fechado por escrito, com base legal por item.

**TASK-6.2.2 — Textos verbatim + finalidades dos campos novos (Alexandre).**
Redigir/atualizar os textos em `docs/juridico/consentimento-e-parq.md` cobrindo explicitamente as finalidades dos **campos novos** da anamnese v2 (sexo biológico, data de nascimento, dor/intensidade/tendência, diagnóstico médico, acompanhamento profissional, recomendações de evitação) e a **retenção** de cada categoria. Confirmar se algum campo deve ser **descartado por minimização** (coletar sem finalidade ativa é risco, não ativo). **Conclusão:** textos finais + novos identificadores de versão publicados no doc jurídico.

**TASK-6.2.3 — Regra de bloqueio no formulário (Alexandre + Lucas).**
Definir quais aceites travam o quê: hoje `HEALTH_DATA` trava o bloco de saúde e `TERMS_OF_SERVICE` trava a saída do bloco 0. Na v2 há 4 obrigatórias na **etapa 1** — confirmar se todas travam o `CONTINUAR` da etapa 1 ou se o de saúde trava só a entrada nas seções sensíveis (seção 4 + PAR-Q). **Conclusão:** regra de bloqueio definida, implementável sem interpretação.

### Definição de Pronto (US-6.2)

- [ ] Tasks 6.2.1–6.2.3 concluídas.
- [ ] Tabela final (tipo → versão → texto verbatim → base legal → bloqueante) entregue e publicada em `docs/juridico/consentimento-e-parq.md`.
- [ ] **Validada por:** Alexandre (assinatura do parecer) + ciência de Lucas de que nenhuma checkbox da spec do fundador foi eliminada sem justificativa registrada.

---

## US-6.3 — Schema do onboarding v2 + migração de substituição

**Agentes:** Leonardo (lead) · Sato (revisa a classificação de sensibilidade dos campos).
**Depende de:** nada de bloqueante. **Começa no dia 1.**
**Habilita:** US-6.4 a US-6.9.

### Jornada

A tabela `anamnesis_sessions` continua — o que muda é o **conteúdo dos blocos**. A v2 tem 3 etapas, e a divisão de sensibilidade muda de lugar: hoje o bloco 2 (jsonb→`bytea` cifrado) concentra saúde; na v2 a saúde está em **dois pontos** — a **seção 4 da etapa 2** (dores, intensidade, diagnóstico, acompanhamento médico) e a **etapa 3 inteira** (PAR-Q). Leonardo remodela: `dataBlock1` = etapa 1 (cadastro, jsonb — dado pessoal comum), `dataBlock2` = **bytea cifrado** com seção 4 + PAR-Q, `dataBlock3` = jsonb com seções 1, 2, 3 e 5 (objetivos/histórico/rotina/preferências — comum). ⚠️ **Atenção:** "o que mais dificultou consistência" e "atividades já praticadas" são comuns; mas se Alexandre classificar algum campo da seção 2 como sensível, ele migra para o bloco cifrado — a decisão de classificação é da US-6.2/Sato, não do Leonardo sozinho. `lastBlock` passa a representar a etapa (1..3); o token de retomada de 72h e a RLS ficam como estão. A migração **derruba** as sessões v1 (D1) — nenhum backfill de dado de saúde é inventado.

### Objetivo

Ter os schemas Zod da v2 em `packages/shared` (fonte única, consumida por back e front), a migração aplicada e a classificação de sensibilidade correta por bloco.

### Resultado esperado

Backend e frontend compartilham o mesmo contrato; a seção 4 e o PAR-Q ficam no bloco cifrado; a v1 sai do `packages/shared`; a migração roda limpa em dev.

### Tasks

**TASK-6.3.1 — Schemas Zod v2 no pacote compartilhado (Leonardo).**
Escrever `onboardingStep1Schema` (nome, nascimento com regra 18+, sexo biológico, telefone E.164, e-mail opcional, consentimentos), `anamnesisV2Schema` (seções 1,2,3,5 com todos os enums e branches da spec), `painAssessmentSchema` (seção 4) e manter `parqSchema` intacto. Todos os enums exatamente com as opções que o fundador listou (9 objetivos, 11 regiões de ênfase, 10 atividades, 9 barreiras, 5 faixas de tempo, 4 locais, 10 regiões de dor). Campo "Outro" com texto livre limitado. **Conclusão:** schemas cobrem 100% dos campos da spec; teste de contrato verde; nenhuma opção da spec ausente.

**TASK-6.3.2 — Migração + classificação de sensibilidade por bloco (Leonardo + Sato).**
Migração remapeando os blocos (etapa 1→`dataBlock1` jsonb; seção 4 + PAR-Q→`dataBlock2` **cifrado**; seções 1/2/3/5→`dataBlock3` jsonb), com **drop das sessões v1** (D1 — confirmar antes de aplicar). `lastBlock` = etapa 1..3. Sato revisa se algum campo classificado como "comum" é na verdade Art. 11. **Conclusão:** migração aplica em dev; nenhum campo de saúde fora do bloco cifrado; Sato registra a revisão.

**TASK-6.3.3 — Endpoints de progresso por etapa (Leonardo).**
`PATCH /anamnesis/{token}/step/{n}` com `n ∈ {1,2,3}` substituindo `/block/{n}`, preservando a retomada por token de 72h e o escopo pelo token (**nunca** `user_id` do cliente). **Conclusão:** progresso salvo por etapa; retomada funciona; sem IDOR; RLS ativa.

### Definição de Pronto (US-6.3)

- [ ] Tasks 6.3.1–6.3.3 concluídas.
- [ ] Schemas v2 completos e compartilhados; migração aplicada; saúde no bloco cifrado; progresso por etapa com retomada.
- [ ] **Validada por:** code review + **revisão de classificação de Sato** + teste de cifra e de contrato verde (US-6.12).

---

## US-6.4 — Etapa 1: cadastro pessoal, gate 18+ e consentimentos

**Agentes:** Leonardo (lead) · Alexandre (fornece os textos/base legal — **bloqueante**) · Felipe (consumidor).
**Depende de:** **US-6.2 (bloqueante)** e US-6.3. Dias 3-6.
**Habilita:** US-6.10.

### Jornada

Etapa 1 coleta nome, data de nascimento, sexo biológico, WhatsApp e e-mail opcional, e registra os consentimentos. O **gate 18+** é regra de negócio: menor de 18 recebe exatamente a mensagem do fundador — *"No momento, a Movivo está disponível apenas para maiores de 18 anos."* — e **não avança**. Validar no servidor (cliente é UX). Os consentimentos são gravados pelo mecanismo que já existe (`consent.service.ts`, versão + IP/UA derivados no servidor), com os textos/versões que Alexandre entregar — **nunca pré-marcados**, e a UI renderiza exatamente o texto que o backend registra. O e-mail é opcional, com formato validado e **bloqueio de domínios descartáveis (P1)**.

### Objetivo

Ter a etapa 1 persistindo cadastro + consentimentos versionados, com gate 18+ no servidor e e-mail opcional validado.

### Resultado esperado

Um usuário 18+ com consentimentos obrigatórios aceitos avança; um menor de 18 é barrado com a mensagem exata; consentimentos ficam registrados com versão + IP/UA; um e-mail descartável é recusado (quando a P1 entrar).

### Tasks

**TASK-6.4.1 — Persistência do cadastro + gate 18+ no servidor (Leonardo).**
Validar idade a partir da data de nascimento no backend; recusar <18 com a mensagem exata do fundador. Persistir etapa 1 em `dataBlock1`. **Conclusão:** menor de 18 barrado no servidor mesmo com bypass do cliente; teste de borda (aniversário hoje) verde.

**TASK-6.4.2 — Consentimentos v2 conforme parecer de Alexandre (Leonardo).**
Transcrever para `consent.schema.ts` os tipos/versões/textos entregues na US-6.2 (**nova versão, nunca edição de versão publicada**) e aplicar a regra de bloqueio definida. Registrar via `consent.service.ts` existente. **Conclusão:** todos os consentimentos da spec registrados com versão nova; regra de bloqueio aplicada; nenhuma checkbox pré-marcada; texto exibido == texto registrado.

**TASK-6.4.3 — Validação de e-mail descartável (P1, não bloqueante) (Leonardo).**
Bloquear domínios descartáveis por **lista estática** de domínios conhecidos — sem serviço externo, sem dependência nova. **Conclusão:** e-mail descartável recusado com mensagem clara; e-mail vazio continua aceito (campo é opcional). *Pode cair para a Sprint 7 sem travar a sprint.*

### Definição de Pronto (US-6.4)

- [ ] Tasks 6.4.1–6.4.2 concluídas (6.4.3 é P1).
- [ ] Cadastro persistido; gate 18+ no servidor; consentimentos versionados conforme parecer de Alexandre, com prova (versão + IP/UA).
- [ ] **Validada por:** code review + **conferência de Alexandre de que o texto implementado == texto aprovado** + testes verdes (US-6.12).

---

## US-6.5 — Verificação de posse do WhatsApp por código (capacidade nova)

**Agentes:** Leonardo (lead) · Sato (revisão de segurança — **obrigatória**) · Sofia (estados, US-6.1) · Henrique (colabora — observabilidade/limites do AraraHQ).
**Depende de:** US-6.3 e o outbound WhatsApp/AraraHQ existente. **Independente de Alexandre — pode começar no dia 2.**
**Habilita:** o avanço da etapa 1 para a etapa 2 e a confiabilidade de todo o produto (o telefone é o identificador funcional).

### Jornada

Hoje o produto **não prova** que o número informado pertence a quem preencheu o formulário — um número errado (ou de terceiro) recebe protocolo de treino gerado a partir de dados de saúde de outra pessoa. **Decisão já tomada com o fundador: o código vai pelo WhatsApp**, reusando o AraraHQ e a fila `whatsapp-outbound` que já existem — **não é SMS e não se contrata provedor novo**. Leonardo implementa `POST /onboarding/{token}/phone/send-code` e `POST /onboarding/{token}/phone/verify`: código numérico curto gerado com **CSPRNG**, armazenado **apenas como hash** (nunca em claro), com **expiração curta** (sugestão: 10 min — confirmar com Sofia/fundador), **rate limit de envio** por número e por sessão (evita spam e uso do AraraHQ como canal de abuso), **limite de tentativas** de verificação (evita brute force de 6 dígitos), e **reenvio idempotente** (clicar duas vezes não dispara dois envios nem invalida o código anterior de forma confusa). Falha de verificação **não revela** se o número existe no sistema (evita enumeração). Sato revisa o desenho inteiro antes do merge.

### Objetivo

Ter a posse do número de WhatsApp verificada por código enviado no próprio WhatsApp, com expiração, rate limit, limite de tentativas e reenvio idempotente — antes de a sessão avançar para a coleta de dado de saúde.

### Resultado esperado

O usuário recebe o código no WhatsApp e avança; um código expirado/errado é recusado; um atacante não consegue disparar envios em massa nem forçar o código por tentativa e erro; o código nunca fica em claro no banco nem em log.

### Tasks

**TASK-6.5.1 — Geração, envio e verificação do código (Leonardo).**
Código com CSPRNG, persistido **em hash** com TTL, enviado pela fila `whatsapp-outbound` (persona MOVI, copy nos guardrails). Endpoints de envio e verificação escopados pelo token da sessão. Sucesso marca o telefone como verificado e libera a etapa 2. **Conclusão:** fluxo completo funciona com AraraHQ mockado em dev; código nunca em claro em banco ou log.

**TASK-6.5.2 — Rate limit, expiração, tentativas e idempotência (Leonardo + Sato).**
Rate limit de **envio** (por número e por sessão) e de **tentativa** de verificação; expiração curta; reenvio idempotente dentro da janela; mensagem de erro que não permite enumeração de números. Instrumentar métricas (envios, falhas, taxa de verificação) — Henrique. **Conclusão:** abuso de envio bloqueado; brute force bloqueado; reenvio duplo não duplica mensagem; métricas visíveis.

**TASK-6.5.3 — Revisão de segurança do OTP (Sato).**
Sato revisa: entropia, armazenamento, TTL, limites, logs, superfície de enumeração e o impacto de o canal ser o mesmo do produto. **Conclusão:** revisão registrada; achados endereçados antes do merge.

### Definição de Pronto (US-6.5)

- [ ] Tasks 6.5.1–6.5.3 concluídas.
- [ ] Verificação por código via WhatsApp funcionando, com hash, TTL, rate limit de envio e de tentativa, reenvio idempotente e sem enumeração.
- [ ] **Validada por:** code review + **revisão de segurança de Sato registrada** + testes de rate limit/expiração/idempotência verdes (US-6.12, **bloqueantes**).

---

## US-6.6 — Etapa 2, seções 1, 2, 3 e 5: objetivos, histórico, rotina e preferências

**Agentes:** Leonardo (lead) · Sofia (referência — copy/estados) · Lucas (fidelidade à spec).
**Depende de:** US-6.3. Dias 3-6.
**Habilita:** US-6.9 (mapeamento) e US-6.10.

### Jornada

O grosso da anamnese v2, e o que a v1 nunca perguntou. **Seção 1 (Objetivos):** objetivo principal em seleção única entre as 9 opções + "Outro" com texto livre; **até 2** regiões corporais de ênfase entre as 11 (incluindo "Corpo todo, sem preferência" — que é mutuamente exclusiva com as outras, ⚠️ **regra a confirmar**: selecionar "corpo todo" deve limpar as demais); data/evento importante (sim/não → data + descrição). **Seção 2 (Histórico):** treina atualmente (nunca/parado/ocasional/regular; "parado" → há quanto tempo, 5 faixas); **experiência com musculação** (iniciante/intermediário/avançado, com as descrições que o fundador escreveu para cada nível — a copy das descrições é parte da spec e não pode ser reescrita) — **este é o campo que fecha o `level` hardcoded**; atividades já praticadas (múltipla, 10 + outra); barreiras de consistência (múltipla, 9 + outro). **Seção 3 (Rotina):** dias/semana 1-7; quais dias (múltipla seg-dom — ⚠️ **regra a confirmar**: a quantidade de dias marcados deve bater com "dias/semana", ou são independentes?); tempo por treino (5 faixas); onde treina (4 opções); período preferido; outro esporte (sim/não → qual + dias). **Seção 5 (Preferências):** exercício que não quer fazer (sim/não → qual, texto livre). Tudo isso é **dado pessoal comum** → `dataBlock3` jsonb, sob RLS.

### Objetivo

Ter as seções 1, 2, 3 e 5 persistidas com todos os campos e branches condicionais da spec, sem perda de nenhuma opção.

### Resultado esperado

Um usuário responde as 4 seções, os condicionais aparecem/somem corretamente, o limite de 2 ênfases é respeitado, e nada da spec do fundador ficou de fora.

### Tasks

**TASK-6.6.1 — Persistência das seções e branches condicionais (Leonardo).**
Validar e persistir em `dataBlock3` com os schemas da US-6.3, incluindo os condicionais (parado→tempo; evento→data+descrição; outro esporte→qual+dias) e os campos "Outro" de texto livre. Limite de **máx. 2** ênfases validado no servidor. **Conclusão:** todos os campos e condicionais persistem; limites validados no servidor; teste de contrato cobre as 9/11/10/9/5/4 opções.

**TASK-6.6.2 — Regras de coerência a confirmar (Leonardo + Lucas).**
Resolver e implementar, **após confirmação**: (a) "Corpo todo, sem preferência" é exclusiva? (b) dias marcados × dias/semana precisam bater? (c) "Outro" com texto livre entra no prompt do gerador ou é só perfil? **Conclusão:** as 3 regras decididas por escrito e implementadas — **nenhuma decidida sozinha pelo dev**.

### Definição de Pronto (US-6.6)

- [ ] Tasks 6.6.1–6.6.2 concluídas.
- [ ] Seções 1, 2, 3 e 5 completas conforme a spec, com condicionais e limites validados no servidor, em `dataBlock3` sob RLS.
- [ ] **Validada por:** code review + **conferência de fidelidade de Lucas** (nenhuma opção da spec ausente) + testes verdes (US-6.12).

---

## US-6.7 — Etapa 2, seção 4: dores e limitações (dado de saúde)

**Agentes:** Leonardo (lead) · Alexandre (finalidade/retenção dos campos) · Sato (cifra/classificação).
**Depende de:** US-6.3 e US-6.6. Dias 4-7.
**Habilita:** US-6.9 (a dor alimenta contraindicações) e a sinalização ao painel CREF.

### Jornada

Esta seção tem US própria porque é **a única parte da etapa 2 que é dado sensível do Art. 11**: região(ões) de dor (múltipla, 10 opções), **intensidade 0-10**, tendência (melhorando/estável/piorando/não sei), o que provoca (texto livre), diagnóstico (sim/não → qual, texto livre), acompanhamento médico/fisio (sim/não), e recomendação profissional de evitar algo (sim/não → o quê, texto livre). Precisa: (1) ir para o bloco **cifrado** (`dataBlock2`, `HealthCipherService` — o mesmo padrão da v1, não um segundo); (2) estar **atrás do consentimento de saúde** (se não aceito, não coleta); (3) alimentar `mapInjuriesToTags` para virar contraindicação no gerador **e** no `ValidationService` (US-6.9). ⚠️ **Decisão de produto a confirmar com o RT CREF:** a spec do fundador **não** diz que dor alta gera revisão humana — só o PAR-Q gera. Mas "dor 9/10, piorando, sem acompanhamento" com PAR-Q todo "Não" hoje passaria direto para geração automática. **Recomendação de Lucas: definir um limiar de dor/tendência que sinalize o painel CREF** (reusando `handoff_alerts`/fila da Sprint 5) — **decisão de Alexandre/RT, não de engenharia**. Se o RT decidir que não, fica registrado como decisão consciente.

### Objetivo

Ter a seção 4 coletada, cifrada em repouso, gated por consentimento de saúde, e alimentando as contraindicações do gerador — com a política de sinalização ao painel decidida por escrito.

### Resultado esperado

Um usuário com dor informa região/intensidade/tendência/contexto; o dado fica cifrado; sem consentimento de saúde a seção não é coletada; a dor vira tag de contraindicação; e, se o RT definir um limiar, o caso sinaliza o painel.

### Tasks

**TASK-6.7.1 — Coleta cifrada e gated da seção 4 (Leonardo + Sato).**
Persistir a seção 4 em `dataBlock2` via `HealthCipherService` (mesmo padrão da anamnese v1), gated pelo consentimento de saúde, decifrando só sob `SET LOCAL`/RLS. Texto livre com limite de tamanho. **Conclusão:** coluna nunca guarda texto em claro; sem consentimento a coleta é recusada; teste de cifra verde.

**TASK-6.7.2 — Política de sinalização por dor (Alexandre / RT CREF + Leonardo).**
Definir por escrito se (e qual) combinação de intensidade/tendência/ausência de acompanhamento sinaliza o painel CREF, reusando `handoff_alerts` e a fila da Sprint 5. Implementar a política decidida — **inclusive se a decisão for "nenhuma sinalização"**, que fica registrada. **Conclusão:** política escrita e implementada; nenhum comportamento clínico inventado por engenharia.

**TASK-6.7.3 — Finalidade e retenção dos campos livres (Alexandre).**
Confirmar que "diagnóstico", "acompanhamento" e "recomendação de evitar" estão cobertos pelo consentimento de saúde da US-6.2 e definir retenção. **Conclusão:** cobertura confirmada ou texto ajustado (nova versão) antes do merge.

### Definição de Pronto (US-6.7)

- [ ] Tasks 6.7.1–6.7.3 concluídas.
- [ ] Seção 4 cifrada, gated por consentimento, alimentando contraindicações; política de sinalização decidida por escrito.
- [ ] **Validada por:** code review + **revisão de Sato (cifra/classificação)** + **decisão registrada de Alexandre/RT CREF** + testes verdes (US-6.12, cifra **bloqueante**).

---

## US-6.8 — Etapa 3: PAR-Q reconciliado, confirmações finais e status de saída

**Agentes:** Leonardo (lead) · Alexandre (confirma as 3 confirmações finais) · Sofia (copy de abertura).
**Depende de:** US-6.3. **Reuso quase puro — pode começar no dia 2.**
**Habilita:** US-6.11 (é o PAR-Q que decide qual tela de sucesso aparece).

### Jornada

**Aqui quase nada é novo — e isso é a boa notícia.** O PAR-Q pedido pelo fundador ("versão oficial e validada segundo lei brasileira") é exatamente o `parq-2026-07-v1` já implementado, com fonte jurídica em `docs/juridico/consentimento-e-parq.md` e avaliação determinística (`evaluateParq`) — **não se toca no conjunto de perguntas nem se abre discussão jurídica**. O que muda: (1) o PAR-Q passa a ser a **etapa 3** do wizard, com o texto de abertura sobre segurança; (2) entram as **3 confirmações finais obrigatórias** da spec (informações verdadeiras/atualizadas; ciência de comunicar mudança de saúde; ciência de que resposta positiva pode exigir análise profissional) — ⚠️ **a confirmar com Alexandre:** são consentimentos versionados (registro probatório em `consents`) ou declarações gravadas junto ao PAR-Q? Recomendação de Lucas: **versionadas como declaração**, porque a terceira é precisamente o que sustenta a legitimidade do bloqueio da V2; (3) o botão "FINALIZAR AVALIAÇÃO" fecha a sessão e dispara a decisão. **A regra de decisão do fundador já é o comportamento atual:** todas "Não" → segue para geração automática; alguma "Sim" → `requiresProfessionalReview` → `BLOCKED_PENDING_CLEARANCE`, treino **não** enviado, respostas na fila de supervisão CREF (Sprint 5). Os rótulos do fundador (`APTO PARA PREPARAÇÃO DO TREINO` / `AGUARDANDO ANÁLISE PROFISSIONAL`) são **texto de UI mapeado aos enums existentes** — **não se criam enums novos**.

### Objetivo

Ter o PAR-Q existente servido como etapa 3, com as 3 confirmações finais registradas e os dois status de saída mapeados aos enums e às 2 telas de sucesso.

### Resultado esperado

Todas "Não" → sessão segue para geração automática e o usuário vê a tela V1; alguma "Sim" → sessão bloqueada, nada é gerado, o item entra na fila do profissional e o usuário vê a V2; as confirmações finais ficam registradas; a versão do PAR-Q exibida == avaliada.

### Tasks

**TASK-6.8.1 — PAR-Q como etapa 3 + abertura de segurança (Leonardo + Sofia ref.).**
Servir `parqSchema`/`PARQ_VERSION` como etapa 3, com texto de abertura, respostas Sim/Não e o motivo obrigatório em Q9=Sim (regra existente). Persistir no bloco cifrado. **Conclusão:** PAR-Q renderiza e avalia sem alteração do conjunto oficial; versão exibida == registrada.

**TASK-6.8.2 — 3 confirmações finais (Leonardo + Alexandre).**
Implementar as 3 confirmações obrigatórias no formato que Alexandre definir (consentimento versionado vs. declaração anexa), bloqueando o "FINALIZAR AVALIAÇÃO" sem elas. **Conclusão:** 3 confirmações obrigatórias registradas com prova; formato aprovado por Alexandre.

**TASK-6.8.3 — Mapeamento dos status de saída (Leonardo).**
Mapear `APTO PARA PREPARAÇÃO DO TREINO` → fluxo de geração automática, e `AGUARDANDO ANÁLISE PROFISSIONAL` → `BLOCKED_PENDING_CLEARANCE` + entrada na fila de supervisão (Sprint 5), como **rótulos de UI** sobre os enums existentes. **Conclusão:** nenhum enum novo criado; um PAR-Q com "Sim" não gera protocolo em hipótese alguma; o item aparece na fila do profissional.

### Definição de Pronto (US-6.8)

- [ ] Tasks 6.8.1–6.8.3 concluídas.
- [ ] PAR-Q oficial reusado sem alteração; 3 confirmações registradas; status mapeados; branch de bloqueio íntegro e ligado à fila da Sprint 5.
- [ ] **Validada por:** code review + **confirmação de Alexandre** (formato das 3 declarações) + teste de gate PAR-Q verde (US-6.12, **bloqueante**).

---

## US-6.9 — Mapeamento da anamnese v2 → `UserConstraints` e geração de protocolo

**Agentes:** Leonardo (lead) · Victor (referência — é a lacuna que ele apontou) · Lucas (decide os mapeamentos de enum).
**Depende de:** US-6.6 e US-6.7. Dias 7-9.
**Habilita:** protocolos de fato individualizados — o valor real desta sprint para o produto.

### Jornada

Esta US é **a razão de a sprint valer mais do que "um formulário mais bonito"**. Hoje `UserConstraints.level` é `INICIANTE` fixo, com um `ponytail:` no código pedindo exatamente a captura da v2; ênfase e preferências não existem; a dor só chega como texto livre de lesão. Leonardo liga os campos novos (tabela em **D6**), o que exige três decisões de enum que **não são de engenharia**:

- ⚠️ **9 objetivos × 3 valores de `primaryGoalSchema`.** Recomendação de Lucas: **mapear 9→3 no MVP e guardar o valor original** — preserva gerador, catálogo e `ValidationService` intactos. Ampliar o enum é trabalho de catálogo, não de formulário. **Confirmar.**
- ⚠️ **4 locais × `ExerciseLocation` (`HOME`/`GYM`/`BOTH`).** "Academia completa"→`GYM`, "casa"→`HOME`; **"academia de condomínio" e "ar livre" não têm destino**. Ampliar o enum exige revisar o catálogo de exercícios (equipamento disponível muda de verdade). **Decisão a confirmar:** ampliar agora, ou mapear condomínio→`HOME` e ar livre→`HOME` no MVP e ampliar na Fase 2? Recomendação de Lucas: **ampliar o enum** — "ar livre" mapeado para "casa" produz treino errado, e isso é qualidade de produto, não cosmética.
- **Ênfase (máx. 2) e exercícios a evitar** entram como campos novos em `UserConstraints`. Regra inegociável: **preferência nunca sobrepõe contraindicação de segurança** — se o usuário "não gosta" de um exercício, ele sai; se a segurança exige que um exercício saia, ele sai independente de gosto. O `ValidationService` continua sendo a garantia.

### Objetivo

Ter `UserConstraints` alimentado pela anamnese v2 — com `level` real, ênfase, exercícios a evitar, local correto e dor como contraindicação — e o gerador consumindo isso.

### Resultado esperado

Dois usuários com o mesmo objetivo mas níveis/ênfases/locais diferentes recebem protocolos diferentes; um exercício que o usuário pediu para evitar não aparece; uma contraindicação de segurança prevalece sobre qualquer preferência; o default `INICIANTE` some do código.

### Tasks

**TASK-6.9.1 — Decisões de enum (Lucas + fundador).**
Fechar os três pontos acima (9→3 objetivos; 4 locais; onde vive o valor original). **Conclusão:** decisões registradas antes de o mapeamento ser implementado.

**TASK-6.9.2 — Mapeamento anamnese v2 → `UserConstraints` (Leonardo + Victor ref.).**
Implementar `level` a partir da experiência com musculação (**remover o default e o `ponytail:`**), `emphasis[]` (máx. 2), `avoid[]`, `location` conforme 6.9.1, `sessionMinutes` a partir da faixa, e dor → `injuryTags` via `mapInjuriesToTags`, mantendo o texto livre para o prompt (pseudonimizado pelo scrubber). **Conclusão:** todos os campos mapeados; nenhum default hardcoded restante; teste prova que nível diferente gera protocolo diferente.

**TASK-6.9.3 — Precedência segurança > preferência (Leonardo).**
Garantir que `avoid[]` nunca desative uma restrição de contraindicação e que o `ValidationService` continue sendo o veto final. **Conclusão:** teste plantando conflito preferência×segurança prova que a segurança vence.

### Definição de Pronto (US-6.9)

- [ ] Tasks 6.9.1–6.9.3 concluídas.
- [ ] `UserConstraints` alimentado pela v2; `level` real; precedência segurança > preferência garantida; decisões de enum registradas.
- [ ] **Validada por:** code review + revisão de Victor (fidelidade à metodologia) + testes de geração diferenciada verdes (US-6.12).

---

## US-6.10 — Frontend: wizard de 3 etapas com barra de progresso

**Agentes:** Felipe (lead) · Sofia (spec de UX — **bloqueante**) · Leonardo (contratos).
**Depende de:** **US-6.1 (bloqueante)** + US-6.3 a US-6.8. Dias 4-9.
**Habilita:** US-6.11.

### Jornada

Felipe substitui `apps/web/src/app/anamnese/page.tsx` por um **wizard de 3 etapas com barra de progresso**, consumindo os schemas Zod compartilhados (fonte única — o front valida com o mesmo contrato que o back). Precisa entregar: barra de progresso conforme Sofia, **máscara `(xx) xxxxx-xxxx`** no telefone (convertida para E.164 no envio), **estado de verificação do código** com contador de reenvio e limite de tentativas, **branches condicionais** que revelam/ocultam campos sem quebrar o layout, seleção múltipla com **limite de 2** nas ênfases (com feedback claro ao atingir o limite), escala 0-10 de dor, checkboxes de consentimento **nunca pré-marcadas** exibindo exatamente o texto do backend, tela de bloqueio 18-, e **salvamento de progresso por etapa** com retomada pelo token (72h). WCAG 2.2 AA, incluindo navegação por teclado num formulário longo — que é onde formulários assim costumam falhar.

### Objetivo

Ter o wizard de 3 etapas completo, com progresso, verificação de WhatsApp, branches e retomada, sobre "O Pulso".

### Resultado esperado

O usuário percorre as 3 etapas vendo onde está, verifica o número, responde só o que é pertinente ao seu caso, pode sair e voltar sem perder o preenchido, e um menor de 18 é barrado com a mensagem exata.

### Tasks

**TASK-6.10.1 — Shell do wizard, progresso e retomada (Felipe).**
3 etapas, barra de progresso conforme US-6.1, navegação ida/volta, salvamento por etapa via `PATCH .../step/{n}`, retomada por token. **Conclusão:** progresso visível e correto; sair e voltar preserva o preenchido; sem perda de dado entre etapas.

**TASK-6.10.2 — Etapa 1: campos, máscara, 18- e consentimentos (Felipe).**
Máscara de telefone → E.164; data de nascimento com bloqueio 18- (mensagem exata; o servidor é a autoridade); checkboxes com o texto exato do backend, nunca pré-marcadas. **Conclusão:** etapa 1 completa; textos de consentimento vindos do backend; 18- bloqueado com a mensagem do fundador.

**TASK-6.10.3 — Fluxo de verificação do código no WhatsApp (Felipe).**
Estados de envio/espera/erro/expiração/reenvio conforme US-6.1/US-6.5, com contador e limite de tentativas visível. **Conclusão:** todos os estados implementados, inclusive falha e rate limit; usuário nunca fica preso sem saída.

**TASK-6.10.4 — Etapa 2 (5 seções) e etapa 3 (PAR-Q) com branches (Felipe).**
Todos os campos e condicionais da spec; limite de 2 ênfases; escala 0-10; PAR-Q Sim/Não com motivo obrigatório em Q9; 3 confirmações finais; botões "CONTINUAR"/"FINALIZAR AVALIAÇÃO". **Conclusão:** nenhum campo da spec ausente; condicionais corretos; validação client espelha os schemas compartilhados.

### Definição de Pronto (US-6.10)

- [ ] Tasks 6.10.1–6.10.4 concluídas.
- [ ] Wizard completo com progresso, OTP, branches, limites, retomada e bloqueio 18-, sobre "O Pulso", WCAG 2.2 AA.
- [ ] **Validada por:** code review + **revisão de Sofia** (fidelidade ao UX) + **conferência de Lucas** (fidelidade à spec do fundador) + testes E2E verdes (US-6.12).

---

## US-6.11 — Telas de sucesso: "perfil liberado" e "perfil em análise"

**Agentes:** Felipe (lead) · Sofia (layouts) · Lucas/Alexandre (copy da V2 nos guardrails).
**Depende de:** US-6.1 e US-6.8. Dias 8-9.
**Habilita:** o fecho da jornada e a transição para o WhatsApp.

### Jornada

A tela de sucesso é onde o usuário descobre **em qual dos dois mundos ele caiu** — e a V2 é a tela mais delicada do produto. **V1 "Perfil liberado":** "Tudo pronto, [NOME]!", os 4 próximos passos, o prazo de entrega (≤2h, o SLA já existente), botão "Abrir WhatsApp". **V2 "Perfil em análise":** "Recebemos suas informações, [NOME]!", explicação de que **um profissional de Educação Física registrado no CREF** vai analisar antes de o treino ser preparado, o prazo de análise, botão "Abrir WhatsApp". A V2 **não pode** soar como rejeição, diagnóstico ou alarme — e **não pode** dizer nada que pareça avaliação clínica ("identificamos um problema"): ela comunica cuidado e supervisão humana, que é literalmente o diferencial da marca. ⚠️ **Pendência da US-6.1:** o **prazo prometido na V2** depende de um SLA de análise humana que **ainda não existe** — sem ele a tela promete algo que a operação não garante. A variante é escolhida pelo status da sessão (US-6.8), **nunca** por parâmetro de URL manipulável pelo cliente.

### Objetivo

Ter as 2 variantes de tela de sucesso, escolhidas pelo status real da sessão, com copy nos guardrails e transição para o WhatsApp.

### Resultado esperado

PAR-Q limpo → V1 com prazo de entrega; PAR-Q com "Sim" → V2 acolhedora com respaldo CREF visível e prazo de análise; ambas levam ao WhatsApp; nenhum usuário consegue forçar a V1 pela URL.

### Tasks

**TASK-6.11.1 — Implementar V1 e V2 (Felipe + Sofia).**
Os 2 layouts com nome do usuário, os 4 próximos passos (V1), a explicação da análise (V2), prazo e botão "Abrir WhatsApp" (deep link). **Conclusão:** as duas telas conforme US-6.1; deep link funciona; a11y ok.

**TASK-6.11.2 — Seleção da variante pelo status da sessão (Felipe + Leonardo).**
A variante vem do status persistido (US-6.8), lido pelo token da sessão — **nunca** de query string. **Conclusão:** teste prova que não se força a V1 com PAR-Q positivo.

**TASK-6.11.3 — Copy da V2 nos guardrails (Lucas + Alexandre + Sofia).**
Revisar a V2 contra os termos proibidos e contra qualquer redação que pareça avaliação clínica; garantir respaldo CREF visível; confirmar o prazo prometido. **Conclusão:** copy aprovada; prazo confirmado ou registrado como pendência de lançamento.

### Definição de Pronto (US-6.11)

- [ ] Tasks 6.11.1–6.11.3 concluídas.
- [ ] 2 variantes implementadas, escolhidas pelo status real, com copy aprovada nos guardrails e prazo definido (ou pendência registrada).
- [ ] **Validada por:** code review + **revisão de guardrails (Lucas/Alexandre)** + revisão de Sofia + teste de seleção de variante verde (US-6.12).

---

## US-6.12 — QA, segurança e remoção da anamnese v1

**Agentes:** Mariana (lead) · Sato (segurança: OTP, cifra, RLS, LGPD dos campos novos) · Leonardo/Felipe (correções).
**Depende de:** US-6.3 a US-6.11. **Fecha a sprint.**

### Jornada

Esta sprint mexe nos dois pontos mais perigosos do produto ao mesmo tempo: **a coleta de dado de saúde** (agora maior — a seção 4 é nova e rica) e **o gate PAR-Q** (que decide se um humano precisa olhar antes de alguém treinar). Além disso, adiciona um **canal de envio automatizado** (OTP no WhatsApp) que, mal feito, vira vetor de spam e de brute force. Mariana monta a suíte como **quality gate bloqueante** e fecha com a **remoção da anamnese v1** — schemas, endpoints e tela — porque deixar o caminho antigo vivo depois de substituído é a forma mais barata de o gate PAR-Q ser contornado por acidente.

### Objetivo

Cobertura ≥80% do código novo, gates bloqueantes (cifra, gate 18+, gate PAR-Q, OTP, RLS/isolamento, consentimento), E2E das 3 etapas nas 2 variantes de saída, revisão de Sato registrada, e v1 removida.

### Resultado esperado

O CI reprova qualquer PR que: deixe dado de saúde em claro, permita um menor de 18 avançar, gere protocolo com PAR-Q positivo, permita abuso de envio ou brute force do código, aceite escopo do cliente, registre consentimento com versão divergente do texto exibido, ou derrube a cobertura.

### Tasks

**TASK-6.12.1 — Gates bloqueantes de saúde e elegibilidade (Mariana).**
Testes: seção 4 + PAR-Q **nunca** em claro em repouso; sem consentimento de saúde a coleta é recusada; **18- barrado no servidor**; **PAR-Q com qualquer "Sim" nunca gera protocolo** e entra na fila de supervisão; a variante de tela de sucesso segue o status real. **Conclusão:** cada violação plantada reprova o pipeline.

**TASK-6.12.2 — Segurança do OTP e isolamento (Mariana + Sato).**
Testes: rate limit de envio e de tentativa; expiração; reenvio idempotente; código nunca em claro em banco/log; ausência de enumeração; escopo pelo token (nenhum endpoint aceita `user_id` do cliente); RLS ativa em todas as leituras. **Conclusão:** brute force e spam plantados falham; vazamento cross-sessão reprova o pipeline.

**TASK-6.12.3 — Fidelidade à spec + E2E das 2 jornadas (Mariana + Lucas).**
Teste de contrato provando que **todas** as opções da spec do fundador existem (9 objetivos, 11 ênfases, 10 atividades, 9 barreiras, 5 faixas de tempo, 4 locais, 10 regiões de dor, 5 faixas de "parado há quanto tempo") e que os condicionais aparecem; E2E completo das 3 etapas nas duas saídas (V1 e V2), incluindo retomada por token. **Conclusão:** nenhuma opção da spec ausente; E2E verde local e no CI.

**TASK-6.12.4 — Remoção da anamnese v1 (Leonardo + Felipe + Mariana).**
Remover `anamnesisBlock1/2/3Schema`, os endpoints `/block/{n}`, a tela antiga e os testes órfãos. Confirmar que nenhum caminho alternativo chega ao gerador sem passar pelo gate PAR-Q v2. **Conclusão:** v1 fora do código; nenhuma rota residual; build e testes verdes.

**TASK-6.12.5 — Revisão de segurança consolidada (Sato).**
Sato registra a revisão do onboarding v2: OTP, cifra e classificação dos campos novos, RLS, minimização LGPD dos campos de perfil sem uso ativo. **Conclusão:** revisão registrada; achados endereçados antes do merge.

### Definição de Pronto (US-6.12)

- [ ] Tasks 6.12.1–6.12.5 concluídas.
- [ ] Gates de cifra, 18+, PAR-Q, OTP, isolamento e consentimento bloqueantes; E2E das 2 jornadas verde; v1 removida.
- [ ] Cobertura ≥80%; gates no CI.
- [ ] **Validada por:** review de Mariana + **revisão de segurança de Sato registrada** + CI verde.

---

## Matriz de responsabilidade por User Story (RACI simplificado)

| US | Título | Responsável (R) | Colabora (C) | Valida (V) |
|---|---|---|---|---|
| US-6.1 | UX do wizard + 2 telas de sucesso (**pré-requisito**) | **Sofia** | Lucas, Felipe | Lucas (fidelidade) + guardrails |
| US-6.2 | Reconciliação jurídica dos consentimentos (**bloqueante**) | **Alexandre** | Lucas | Alexandre (parecer) |
| US-6.3 | Schema v2 + migração de substituição | **Leonardo** | Sato (classificação) | Sato + Mariana |
| US-6.4 | Etapa 1: cadastro, 18+, consentimentos | **Leonardo** | Alexandre (textos) | **Alexandre** + Mariana |
| US-6.5 | Verificação de WhatsApp por código | **Leonardo** | Sato, Henrique, Sofia | **Sato** + Mariana |
| US-6.6 | Anamnese seções 1, 2, 3 e 5 | **Leonardo** | Sofia, Lucas | Lucas (fidelidade) + Mariana |
| US-6.7 | Seção 4: dores e limitações (saúde) | **Leonardo** | Sato (cifra) | **Alexandre / RT CREF** + Sato + Mariana |
| US-6.8 | PAR-Q como etapa 3 + confirmações + status | **Leonardo** | Sofia, Alexandre | **Alexandre** + Mariana |
| US-6.9 | Mapeamento v2 → `UserConstraints` | **Leonardo** | Victor (ref.), Lucas (enums) | Victor + Mariana |
| US-6.10 | Wizard de 3 etapas (frontend) | **Felipe** | Sofia, Leonardo | **Sofia** + Lucas + Mariana |
| US-6.11 | Telas de sucesso V1/V2 | **Felipe** | Sofia, Leonardo | **Lucas/Alexandre** (guardrails) + Mariana |
| US-6.12 | QA, segurança e remoção da v1 | **Mariana** | Sato, Leonardo, Felipe | Mariana + **Sato** + gate no CI |

> **A sprint é predominantemente de Leonardo** (schema, OTP, 5 seções, PAR-Q, mapeamento) e **Felipe** (wizard + telas de sucesso). **Sofia e Alexandre são pré-requisitos reais, não formalidade** — sem a US-6.1 o Felipe inventa UX no código, e sem a US-6.2 o Leonardo toma decisão jurídica que não é dele. **Victor entra só como referência** no mapeamento (é a lacuna que ele apontou), sem trabalho de IA nesta sprint — o onboarding **não chama LLM em nenhum ponto**.

---

## Ordem recomendada de acionamento dos agentes

1. **Alexandre (#06)** — US-6.2. Consentimentos: mapeamento 4+1, base legal, textos verbatim, novas versões, finalidades dos campos novos. **Bloqueia o Leonardo na US-6.4/6.7/6.8.**
2. **Sofia (#09)** — US-6.1. Fluxo do wizard, barra de progresso, ícones das regiões, padrões de input, estados do OTP, 2 layouts de sucesso. **Bloqueia o Felipe.** *(Pode rodar em paralelo com Alexandre.)*
3. **Leonardo (#13)** — US-6.3, 6.5, 6.8 (não dependem de Alexandre; podem começar junto) → US-6.4, 6.6, 6.7 → US-6.9.
4. **Felipe (#14)** — US-6.10 e US-6.11, assim que Sofia entregar e os contratos da US-6.3 existirem.
5. **Sato (#11)** — revisão do OTP (US-6.5), da classificação de sensibilidade (US-6.3/6.7) e consolidada (US-6.12). Entra ao longo, não só no fim.
6. **Mariana (#15)** — US-6.12, do dia 4 ao 10, fechando com a remoção da v1.

---

## Critério de conclusão da Sprint 6

1. Wizard de **3 etapas com barra de progresso**, retomada por token, substituindo integralmente a anamnese v1 (que sai do código).
2. **WhatsApp verificado por código enviado no próprio WhatsApp** (AraraHQ), com hash, TTL, rate limit, limite de tentativas e reenvio idempotente — revisado por Sato.
3. **Gate 18+ no servidor** com a mensagem exata do fundador.
4. **Consentimentos reconciliados** conforme parecer de Alexandre, versionados, com prova, nunca pré-marcados, texto exibido == texto registrado.
5. **Anamnese v2 completa** (5 seções, todos os campos e branches da spec), com a **seção 4 cifrada** e gated por consentimento de saúde.
6. **PAR-Q oficial reusado sem alteração**, como etapa 3, com as 3 confirmações finais e os 2 status mapeados aos enums existentes — o branch de bloqueio ligado à fila de supervisão CREF da Sprint 5.
7. **2 telas de sucesso** escolhidas pelo status real da sessão, com copy nos guardrails e respaldo CREF visível na V2.
8. **`UserConstraints` alimentado pela v2** — `level` real (fim do default hardcoded), ênfase, exercícios a evitar, local correto, dor como contraindicação; segurança sempre acima de preferência.
9. **Quality gate bloqueante** (cifra, 18+, PAR-Q, OTP, isolamento, consentimento, fidelidade à spec) + E2E das 2 jornadas; cobertura ≥80%; CI verde; PR + 6 checks.

### Decisões pendentes a resolver no início da sprint (nenhuma decidida por engenharia)

| # | Pendência | Quem decide | Trava o quê |
|---|---|---|---|
| 1 | Mapeamento dos 4+1 consentimentos, base legal e novas versões | **Alexandre** | US-6.4 (**bloqueante**) |
| 2 | Existe alguma sessão de anamnese v1 real coletada? Migração pode ser destrutiva? | **Fundador** | US-6.3 (migração) |
| 3 | Formato das 3 confirmações finais do PAR-Q (consentimento versionado vs. declaração) | **Alexandre** | US-6.8 |
| 4 | Limiar de dor que sinaliza o painel CREF (ou decisão consciente de não sinalizar) | **Alexandre / RT CREF** | US-6.7 |
| 5 | 9 objetivos → mapear para os 3 atuais ou ampliar o enum? | **Fundador + Lucas** | US-6.9 |
| 6 | 4 locais de treino → ampliar `ExerciseLocation` (recomendado) ou mapear com perda? | **Fundador + Lucas** | US-6.9 (e catálogo) |
| 7 | "Corpo todo, sem preferência" é exclusiva? Dias marcados × dias/semana precisam bater? | **Fundador** | US-6.6 |
| 8 | **SLA de análise humana** prometido na tela V2 (o de entrega automática é ≤2h; o humano não existe) | **Fundador / RT CREF** | US-6.11 (e a operação) |
| 9 | TTL do código de verificação e política de reenvio (sugestão: 10 min) | **Sofia + Sato** | US-6.5 |
| 10 | Campos de perfil sem uso ativo (sexo biológico, nascimento além do 18+, evento, barreiras): manter ou minimizar? | **Alexandre** | US-6.2/6.7 |

### Bloqueadores de lançamento (não de dev) herdados

Inalterados: chaves reais/ZDR + DPAs OpenAI/Anthropic, conta AraraHQ de produção (**esta sprint aumenta a dependência dela — o OTP passa a ser caminho crítico do onboarding**), gateway de pagamento real, ratificação clínica do RT CREF, parecer INPI (MOVIVO × VIVO). Dev roda com mocks e seeds.

---

*Documento de planejamento operacional da Sprint 6 — Lucas Monteiro (PM/PO). Escopo derivado integralmente da **especificação escrita pelo fundador (2026-08-10)**: nenhum campo, opção ou copy foi cortado; onde a spec colide com o que já existe (consentimentos, enums de objetivo e local, prazo da tela V2, limiar de dor), a colisão está marcada como **decisão pendente com dono nomeado**, não resolvida por engenharia. Reusa sem alteração o PAR-Q `parq-2026-07-v1` e sua avaliação determinística, a cifra `pgcrypto`/`HealthCipherService`, a RLS, o registro versionado de consentimento e a fila de supervisão CREF da Sprint 5. Substitui a anamnese v1 da Sprint 1. Fecha a lacuna apontada por Victor: o gerador de protocolo passa a receber nível de experiência, ênfase, preferências e dor localizada reais, em vez de defaults.*
