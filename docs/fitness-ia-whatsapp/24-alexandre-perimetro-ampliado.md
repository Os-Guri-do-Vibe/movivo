# Parecer — Dr. Alexandre (CLO) · Ampliação do Perímetro Conversacional do AI Coach

**Data:** 2026-08-28
**Pasta do projeto:** `docs/fitness-ia-whatsapp/`
**Objeto:** pedido do fundador de ampliar o perímetro L0 do AI Coach (`SCOPE_PERIMETER_BLOCK`, em `apps/api/src/modules/ai-coach/intent/prompts.ts`) para cobrir hábitos, sono, recuperação, saúde/bem-estar geral e **nutrição básica**, com fundamento na bagagem acadêmica do Responsável Técnico.
**Documento anterior aplicável:** `06-relatorio-alexandre.md` (permanece integralmente vigente; este parecer o complementa e, no ponto do perímetro, o especializa).
**Destinatário técnico:** Victor (Engenheiro de IA), que converterá os critérios abaixo em regra de sistema.

> **Aviso obrigatório:** parecer de CLO interno. Não substitui parecer formal de advogado externo com OAB. Os pontos de conflito inter-conselhos (CONFEF × CFN sobre suplementos) e o enquadramento de plataforma digital nacional sob a Res. CONFEF 542/2024 são **áreas de incerteza regulatória real** — indico cenários e probabilidades, não certezas.

---

## 1. Resumo executivo

**Aprovo a ampliação em cinco dos seis domínios pedidos. Reprovo a nutrição na forma como foi pedida, e aprovo uma versão reduzida dela.**

A tese do fundador — "a IA deve poder falar o que um profissional humano falaria" — está **correta como princípio e errada como premissa fática no ponto da nutrição**. Um Profissional de Educação Física humano, presencialmente, com CREF ativo, **também não pode** dar orientação nutricional individualizada. O CREF4/SP diz isso literalmente: *"a prescrição de dietas e planos alimentares é atividade privativa do Nutricionista"*. Ou seja: a IA não pode herdar uma autoridade que o próprio humano supervisor não tem.

Sobre o RT Léo — e aqui preciso ser direto, porque a decisão inteira gira nisto:

- **Léo tem CREF e COREN. Não tem CRN nem CRM.** Cursar Nutrição e faltar o estágio obrigatório significa, juridicamente, **zero**. A Lei 8.234/1991 reserva as atividades ao *nutricionista registrado*. Estudante não é nutricionista. Conhecimento não é habilitação.
- Pior: o art. 47 da Lei das Contravenções Penais pune "exercer profissão **ou anunciar que a exerce**, sem preencher as condições a que por lei está subordinado o seu exercício". O verbo **anunciar** é autônomo. Usar "nosso RT está cursando Medicina e Nutrição" como argumento de credibilidade na comunicação é, por si só, conduta de risco — e é o item mais perigoso de toda esta análise.
- **O COREN é um ativo defensivo real, não uma licença de expansão.** Ele fortalece o domínio de *educação em saúde* populacional (expressamente previsto na Res. COFEN 696/2022). Não desbloqueia nutrição (que é do CRN, não do COREN) e vem com uma armadilha: a Res. COFEN 721/2023 exige **registro da PJ no COREN com Enfermeiro Responsável Técnico** para empresa que presta serviço de enfermagem. E a própria Res. COFEN 696/2022 diz que mensageria assíncrona de texto/áudio **não constitui consulta de enfermagem** — que é exatamente o canal da MOVIVO. Ou seja: invocar enfermagem publicamente traz todo o aparato regulatório de enfermagem para cima de um produto hoje registrado só no CREF, e o ato mais valioso já vem vedado pela própria norma.

**O achado que mais muda a análise, e que corta contra o fundador:** a MOVIVO detém anamnese + PAR-Q. Por construção, **toda resposta da IA dentro da sessão é presumidamente individualizada** — o contexto do aluno está no prompt. A defesa "isso foi só orientação geral" é estruturalmente **mais fraca** na MOVIVO do que seria num blog ou num reel público. Um CRN ou um juiz não pergunta se o modelo *quis* individualizar; pergunta se a orientação foi entregue a pessoa identificada cujo dado de saúde o fornecedor detinha e usava.

**A solução arquitetural que sustenta a ampliação** (detalhada na §4): criar um **canal populacional de contexto isolado** — um caminho de geração que, por construção técnica, **não enxerga** anamnese, PAR-Q nem protocolo, e cuja substância vem de texto curado e aprovado pelo RT, não de redação livre do LLM. Isso transforma "não individualizamos" de alegação em **propriedade de sistema auditável**. É a diferença entre uma defesa e uma promessa.

**Caminho para o fundador ter o que ele realmente quer em nutrição:** contratar/associar um **nutricionista com CRN ativo** como segundo responsável técnico da trilha nutricional. Custo baixo (profissional PJ meio-período), risco despenca de Alto para Baixo, e a faixa nutricional migra de "reprovada" para "aprovada". É a recomendação central deste parecer.

---

## 2. Fundamentação legal

### 2.1 O que a MOVIVO **tem** habilitação para fazer — Educação Física

| Norma | Conteúdo relevante |
|---|---|
| **Lei 9.696/1998** | Regulamenta a profissão; orientação/prescrição de exercício é privativa do PEF registrado. |
| **Res. CONFEF 046/2002** | Define o campo de intervenção. Autoriza expressamente orientar para **bem-estar e qualidade de vida, prevenção de doenças, promoção da saúde, estilo de vida ativo, autonomia e autoestima**. Este é o fundamento normativo direto dos domínios sono/hábitos/promoção da saúde. |
| **Res. CONFEF 542/2024** ⭐ | **A norma mais importante para este parecer.** Regulamenta o atendimento remoto: `teleconsulta` (avaliação inicial com anamnese e prescrição de exercícios), `teleaula` (**"prescrição e acompanhamento do exercício físico, tanto de forma síncrona como assíncrona"**), `teleconsultoria` e `análise de metadados`. Exige: registro ativo, plataforma em conformidade com a LGPD, **TCLE do beneficiário**, **identificação visível do número de registro profissional** e manutenção de **plano de treinamento assinado e carimbado** por beneficiário. |
| **Res. CONFEF 477/2023, alterada pela 607/2025** | Registro da PJ e figura do RT. A 607/2025 não altera o núcleo aplicável ao MVP. |
| **Res. CREF4/SP 151/2022** | PEF **bacharel** pode dar "aconselhamento, informação e esclarecimento sobre suplementos alimentares exclusivamente relacionados ao exercício físico". **Veda**: orientar produtos com fármacos; propor dietas e planos alimentares. Norma **regional** (SP) — vinculante lá, persuasiva fora. |

**Leitura jurídica:** a Res. 542/2024 é excelente notícia. Ela reconhece expressamente a **prescrição assíncrona de exercício** — que é exatamente o modelo MOVIVO. Ela também impõe três requisitos que o produto precisa endereçar formalmente: TCLE específico de telesserviço, número de registro visível, e plano assinado por beneficiário. Os três já têm equivalente na arquitetura (`protocols.signed_at`, `signature_hash`, selo CREF), mas o TCLE de telesserviço precisa ser **um instrumento próprio**, distinto do PAR-Q e do consentimento LGPD.

> ⚠️ **Ponto a confirmar com o CREF regional:** a leitura da 542/2024 indica prazo máximo (≈30 dias) de validade da avaliação inicial antes de renovação. Se confirmado, isso vira **requisito de produto**: revalidação periódica da anamnese. Não afirmo como certeza — mandem o RT confirmar por escrito no CREF do estado.

### 2.2 O que a MOVIVO **não tem** habilitação para fazer — Nutrição

Este é o núcleo duro. **Lei 8.234/1991, art. 3º** — são **privativas** dos nutricionistas, entre outras:

- **VI** — *"auditoria, **consultoria e assessoria em nutrição e dietética**"*;
- **VII** — *"**assistência e educação nutricional a coletividades ou indivíduos, sadios ou enfermos**, em **instituições públicas e privadas** e em consultório de nutrição e dietética"*;
- **VIII** — *"assistência dietoterápica (...) **prescrevendo, planejando, analisando, supervisionando e avaliando dietas**"*.

Três observações que a maioria das análises deixa passar e que decidem o caso:

1. **O inciso VII alcança pessoas saudáveis.** O texto diz "sadios ou enfermos". Não adianta argumentar "nosso usuário não é paciente".
2. **O inciso VII alcança instituições privadas.** Não é reserva restrita a hospital ou consultório. A MOVIVO é instituição privada prestando a indivíduos.
3. **O inciso VI reserva "consultoria e assessoria em nutrição".** Isso mata, no nascedouro, a expressão "consultoria nutricional básica". Não existe "consultoria nutricional básica" lícita fora do CRN — o adjetivo "básica" não é uma categoria jurídica.

**Res. CFN 600/2018** reitera "assistência e educação alimentar e nutricional a coletividades ou indivíduos" como atividade privativa. **Res. CFN 656/2020** (alterada pela 731/2022) posiciona a prescrição de **suplementos alimentares** como prescrição dietética do nutricionista — o que cria **conflito inter-conselhos direto** com a Res. CREF4/SP 151/2022. Esse conflito não está pacificado. Tratem-no como incerteza, não como brecha.

**Sanção:** exercício ilegal é **contravenção penal — art. 47 do Decreto-Lei 3.688/1941**, pena de prisão simples de 15 dias a 3 meses ou multa, e — repito, porque é o ponto cego — **o verbo "anunciar" é conduta típica autônoma**. Some-se a isso ação fiscalizatória do CRN (que monitora ativamente redes sociais e perfis digitais — o CRN-9 publica nominalmente perfis de Instagram autuados) e responsabilidade civil objetiva pelo CDC.

**Sinal de enforcement, agosto/2026:** o CFN vem se manifestando publicamente **contra planos alimentares gerados por IA** ("orientações genéricas que não levam em conta a individualidade... em indivíduos com condições específicas podem ser totalmente inadequadas") e **já debate internamente regulamentação do uso de IA na área**. Uma startup de IA que faça orientação nutricional em massa em 2026 não é um alvo improvável — é um alvo conveniente.

### 2.3 As outras fronteiras profissionais

| Fronteira | Norma | O que fica de fora da MOVIVO |
|---|---|---|
| **Médica** | Lei 12.842/2013, art. 4º | *"Formulação do diagnóstico nosológico e respectiva prescrição terapêutica"* é privativa. Nota relevante: a lei diz expressamente que o **diagnóstico nutricional não é privativo do médico** — mas isso o devolve ao nutricionista, não ao PEF. |
| **Psicológica** | Lei 4.119/1962, art. 13, §1º | Privativo do psicólogo: diagnóstico psicológico, orientação psicopedagógica e **"solução de problemas de ajustamento"**. É esta última alínea que delimita o quanto o coach pode ir em "hábitos" e sofrimento psíquico. |
| **Enfermagem** | Lei 7.498/1986, art. 11; Res. COFEN 696/2022; Res. COFEN 721/2023; Res. COFEN 736/2024 | *Educação em saúde* é modalidade de telenfermagem admitida. Mas: consulta de enfermagem é privativa do enfermeiro, **mensageria assíncrona de texto/áudio não constitui consulta de enfermagem**, e empresa que presta serviço de enfermagem precisa de **registro da PJ no COREN com ERT e CRT**. |

---

## 3. Parecer sobre a bagagem do RT (a questão central)

Enfrento de frente, como pedido.

### 3.1 Competência técnica ≠ habilitação registrada

São institutos distintos e não intercambiáveis. A habilitação registrada é o que:

- **autoriza o ato** perante o conselho e afasta o art. 47 da LCP;
- **define de quem é a responsabilidade técnica** em caso de dano;
- **sustenta a defesa** em ação civil — o perito nomeado vai perguntar "o ato foi praticado por quem tinha habilitação?", não "quem praticou sabia do assunto?";
- **é seguravél** — apólice de RC profissional cobre ato dentro do escopo da habilitação; fora dele, a seguradora nega.

Em caso de dano nutricional, a competência acadêmica de Léo **piora** a posição da MOVIVO, não melhora: demonstra que a empresa sabia que aquilo era terreno de nutricionista e ainda assim atuou sem CRN. Isso desloca a discussão de negligência para **culpa consciente / assunção de risco**, e é péssimo em juízo.

### 3.2 O COREN amplia legitimamente o escopo? Sim — mas não onde o fundador quer

**Onde amplia (real e aproveitável):**

- *Educação em saúde* é modalidade expressamente prevista na Res. COFEN 696/2022, definida como "práticas individuais ou coletivas que aumentam a autonomia do paciente no autocuidado". Isso dá **lastro profissional real** ao conteúdo populacional de sono, hidratação, sedentarismo, estresse e adesão — reforçando o que a Res. CONFEF 046/2002 já autoriza por "promoção da saúde".
- Eleva a **qualidade e a defensibilidade da curadoria do corpus**: um RT com CREF + COREN é um curador tecnicamente mais forte, e isso é argumentável perante o CREF e perante um juiz.
- Melhora a **triagem de sinais clínicos** (red flags, PAR-Q, encaminhamento) — competência nuclear de enfermagem.

**Onde não amplia (e por quê):**

1. **A habilitação é da pessoa, não da PJ.** Para a MOVIVO *prestar* serviço de enfermagem, precisaria de registro no COREN com ERT e CRT (Res. 721/2023). Hoje não tem, e não deve buscar no MVP.
2. **O canal é o errado.** A Res. 696/2022 exclui expressamente mensageria assíncrona de texto/áudio da consulta de enfermagem. O ato de maior valor está vedado pelo próprio meio da MOVIVO.
3. **Enfermagem não alcança nutrição.** Nada em enfermagem desloca a reserva da Lei 8.234/1991. O COREN **não resolve nada** do problema que motivou o pedido.
4. **Custo de conformidade desproporcional.** Invocar enfermagem traz Processo de Enfermagem (Res. 736/2024), prontuário, assinatura ICP-Brasil para prescrições, TCLE próprio.

**Recomendação:** manter o COREN como **competência interna do RT** — usada para curar o corpus e desenhar a triagem — e **não** como argumento público de escopo no MVP. Dizer "nosso responsável técnico é Profissional de Educação Física (CREF nº ___) e também enfermeiro (COREN nº ___)" é **verdadeiro e lícito**. Dizer ou insinuar que "a MOVIVO tem enfermagem/nutrição/medicina" **não é**.

### 3.3 A IA orientar sob supervisão do RT × o RT orientar pessoalmente

Diferença jurídica real, e ela não vai na direção que se supõe:

| | IA sob supervisão do RT | RT orientando pessoalmente |
|---|---|---|
| **Amplia o escopo profissional?** | Não. Supervisão transfere *responsabilidade dentro* da habilitação do supervisor; **não transfere habilitação entre profissões**. | Não. Léo pessoalmente também não pode prescrever dieta. |
| **Cobertura da Res. CONFEF 542/2024** | Sim, **desde que** haja plano documentado atribuível ao profissional. Quanto mais a IA improvisa fora do corpus aprovado, mais ela sai do abrigo da norma. | Sim, integralmente. |
| **Risco de "supervisão de fachada"** | Alto se a revisão for amostral simbólica. É o vetor que derruba toda a defesa. | Baixo. |
| **Escala** | Alta. | Nula. |

**Conclusão operacional:** a supervisão do RT **não é** o que autoriza a ampliação nutricional. O que ela autoriza é a **profundidade e a individualização dentro do domínio do exercício** — e é aí que a ampliação pedida pelo fundador tem o maior ganho real e o menor custo jurídico.

---

## 4. O critério operacional (o coração deste parecer)

Victor precisa de regra, não de prudência. Aqui está.

### 4.1 A pergunta que define tudo

> **Para cada afirmação que a IA emite: qual habilitação registrada *da MOVIVO* cobre este ato?**

Se a resposta não for "CREF, via RT registrado em PJ registrada", a afirmação **não pode ser simultaneamente individualizada e prescritiva**. Esta pergunta é a versão jurídica do critério; abaixo está a versão computável.

### 4.2 Os quatro eixos de classificação (implementáveis)

Cada afirmação gerada (`claim`, no vocabulário já existente do `evidence-grounding.service.ts`) recebe quatro rótulos:

**Eixo D — domínio**
| Código | Domínio |
|---|---|
| `D1` | Treino (execução, técnica, carga, volume, progressão, substituição, periodização) |
| `D2` | Recuperação **do treino** (descanso entre séries, deload, DOMS, frequência, gestão de fadiga, mobilidade, aquecimento) |
| `D3` | Sono / higiene do sono (fora do contexto estrito de recuperação de sessão) |
| `D4` | Hábitos, adesão, rotina, motivação, consistência |
| `D5` | Saúde e bem-estar geral / promoção da saúde |
| `D6` | Nutrição |
| `D7` | Suplementos |
| `D8` | Clínico (condição, sintoma, exame, medicamento, gestação, lesão ativa) |
| `D9` | Sofrimento psíquico clínico |
| `D10` | Sinais de transtorno alimentar |

**Eixo I — individualização**
- `I0 · POPULACIONAL` — a afirmação foi produzida **sem que nenhum campo de anamnese, PAR-Q ou protocolo estivesse no contexto**. É uma propriedade *do pipeline*, não uma intenção do modelo.
- `I1 · INDIVIDUALIZADO` — qualquer dado pessoal de saúde do aluno esteve disponível na geração.

**Eixo F — força ilocucionária**
- `F0 · INFORMATIVO` — descreve mecanismo ou estado da evidência. Sem ação dirigida ao interlocutor. *"A literatura associa X a Y."*
- `F1 · RECOMENDATIVO QUALITATIVO` — sugestão comportamental geral. **Pode conter número, desde que o número seja citação de faixa de referência populacional explicitamente enquadrada como tal** — nunca uma meta atribuída ao aluno.
- `F2 · PRESCRITIVO QUANTIFICADO` — a quantidade, dose, meta, cronograma ou plano **é função dos dados daquele aluno**, ou é apresentada como *a meta dele*.

> **A linha F1/F2 é a fronteira jurídica operacionalizada.** "O intervalo de 7 a 9 horas é o mais associado a boa recuperação na população adulta" = F1. "Você precisa dormir 8h" = F2. "Estudos usam 1,6 a 2,2 g de proteína por kg" = F1 se enquadrado como literatura; "sua meta é 140 g de proteína" = F2 e, em D6, proibido. **É essa distinção que um engenheiro implementa e que um juiz reconhece**, porque ela é o reflexo exato do conceito legal de *prescrição individualizada*.

**Eixo G — grounding** (já existe no código)
- `G1 · SUPPORTED` pelo corpus curado pelo RT; `G0` caso contrário → **abstenção sempre**, independentemente dos outros eixos.

### 4.3 A matriz de decisão

`PERMITIDO` / `SALVAGUARDA` (permitido apenas no canal populacional com o pacote S1–S6) / `BLOQUEADO`.

| Domínio | `I0·F0` | `I0·F1` | `I0·F2` | `I1·F0` | `I1·F1` | `I1·F2` |
|---|---|---|---|---|---|---|
| **D1 Treino** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ *(exige PAR-Q `LIBERADO` ou `LIBERADO_COM_RESSALVA_RT`)* |
| **D2 Recuperação do treino** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ *(idem)* |
| **D3 Sono** | ✅ | ✅ | ⛔ | ✅ | 🟡 *(só individualização por dado de treino, nunca clínico)* | ⛔ |
| **D4 Hábitos/adesão** | ✅ | ✅ | ⛔ | ✅ | ✅ *(rotina de treino)* | ⛔ |
| **D5 Saúde geral** | ✅ | 🟡 | ⛔ | 🟡 | ⛔ | ⛔ |
| **D6 Nutrição** | 🟡 | 🟡 | ⛔ | ⛔ | ⛔ | ⛔ |
| **D7 Suplementos** | 🟡 | ⛔ *(MVP)* | ⛔ | ⛔ | ⛔ | ⛔ |
| **D8 Clínico** | ⛔ + handoff | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| **D9 Sofrimento psíquico** | ⛔ + handoff | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| **D10 Transtorno alimentar** | ⛔ + **handoff de segurança** e encerramento do tema alimentar na sessão | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |

Regras transversais, em ordem de precedência:

1. `G0` → abstenção, sempre.
2. `D10` detectado → handoff de segurança + **nenhuma resposta sobre alimentação, peso ou calorias naquela sessão**, mesmo que classificada como permitida.
3. `D8`/`D9` → bloqueio + encaminhamento; `D8` com sintoma agudo → `EMERGENCIA_CLINICA` (fluxo já existente).
4. PAR-Q ≠ liberado → `F2` bloqueado em todos os domínios.
5. Empate de classificação ou baixa confiança → **desce um nível** (`PERMITIDO`→`SALVAGUARDA`; `SALVAGUARDA`→`BLOQUEADO`). O default conservador do perímetro atual **sobrevive**, apenas deixa de ser binário.

### 4.4 O pacote de salvaguardas S1–S6 (o que "🟡" exige)

Sem os seis, "🟡" vira "⛔".

| | Salvaguarda | Por quê |
|---|---|---|
| **S1** | **Canal populacional de contexto isolado.** O prompt do caminho 🟡 **não recebe** anamnese, PAR-Q, protocolo nem histórico clínico. Sem retrieval sobre dados do usuário. | Torna a não-individualização uma **propriedade técnica provável em auditoria**, não uma alegação. É a peça que sustenta juridicamente todo o resto. |
| **S2** | **Substância determinística.** O conteúdo vem de **template aprovado e versionado pelo RT**; o LLM apenas seleciona e verbaliza, sem redigir a substância — mesmo padrão já usado em `FORA_DE_ESCOPO` e `PEDIDO_HANDOFF`. | Converte exposição regulatória ilimitada num conjunto finito, revisável e assinável. |
| **S3** | **Rodapé obrigatório** de não-individualização + encaminhamento ao profissional habilitado (§5.3). | Cumpre o dever de informação (CDC art. 6º, III) e descaracteriza o ato profissional privativo. |
| **S4** | **Pré-bloqueio por flag clínica.** Qualquer condição relevante no PAR-Q (gestação, diabetes, hipertensão, doença renal, TCA, uso de medicação de controle) → o domínio 🟡 inteiro cai para ⛔ para aquele usuário. | É onde o dano real acontece. |
| **S5** | **Log de auditoria** com `template_id`, `rt_approval_id`, `approved_at`, `corpus_version`, `prompt_version`, `D/I/F/G`, `parq_state`, `decision`, `blocked_reason`. Append-only, retenção 5 anos (CDC art. 27). | É a prova de que o perímetro foi imposto por máquina. Sem isso a defesa é testemunhal. |
| **S6** | **Limite de profundidade:** uma resposta + oferta de encaminhamento. A IA não entra em thread de aprofundamento em D5/D6/D7. | Aprofundamento sucessivo é o que transforma informação em assessoria — e "assessoria em nutrição" é privativa (Lei 8.234, art. 3º, VI). |

---

## 5. As três faixas, domínio por domínio

### 5.1 TREINO e RECUPERAÇÃO DO TREINO — **aprovado, e ampliar mais do que o fundador pediu**

**(a) Pode dizer hoje, com segurança, individualizado e em profundidade:** biomecânica e execução, erros comuns, seleção e substituição de exercício, séries/repetições/carga/RIR/RPE, progressão e periodização, deload, frequência e volume semanal, descanso entre séries, DOMS × dor anormal, aquecimento e mobilidade, gestão de fadiga, adaptação por equipamento disponível, expectativa realista de resultado, por que o protocolo dele é como é.

Base: Lei 9.696/1998 + Res. CONFEF 046/2002 + **Res. CONFEF 542/2024** (que autoriza *prescrição e acompanhamento assíncronos*). Este é o domínio onde a MOVIVO tem habilitação plena — e onde o perímetro atual é **conservador demais e custa produto sem comprar segurança**.

**(b) Com salvaguarda:** adaptação de treino para condição clínica declarada (só com `LIBERADO_COM_RESSALVA_RT` e protocolo assinado); treino na gestação (só com liberação médica documentada); retorno pós-lesão já alta (só com alta documentada).

**(c) Nunca:** exercício apresentado como tratamento de doença ("esse exercício trata sua hérnia"); reabilitação de lesão ativa (é Fisioterapia — Lei 6.316/1975); prescrição com PAR-Q bloqueado; interpretação de dor como sinal clínico.

**Requisitos formais decorrentes da Res. 542/2024:** TCLE de telesserviço próprio; nº de registro do RT visível na interface; plano de treinamento por beneficiário assinado pelo RT (já implementado); confirmar prazo de revalidação da avaliação com o CREF regional.

### 5.2 SONO — **aprovado com condições**

**(a) Segurança hoje:** relação sono × desempenho, recuperação, síntese proteica e risco de lesão; papel do sono na adaptação ao treino; higiene do sono como conteúdo populacional (regularidade de horário, luz, cafeína no fim do dia, ambiente); faixas de referência populacionais citadas **como referência**, não como meta do aluno.

**(b) Com salvaguarda:** ajuste de horário de treino em função da rotina de sono relatada (individualização por dado de *treino*, não clínico); leitura de dado de sono de wearable **como contexto de treino**, jamais como avaliação de saúde.

**(c) Nunca:** insônia, apneia, ronco, sonolência diurna excessiva, uso de melatonina ou qualquer substância indutora, interpretação de sono ruim como sintoma, "você precisa dormir N horas" como meta pessoal.

### 5.3 HÁBITOS, ADESÃO, ROTINA E MOTIVAÇÃO — **aprovado com condições**

**(a) Segurança hoje:** formação de hábito, gatilhos e ambiente, planejamento de agenda de treino, o que fazer após faltar, expectativa e consistência, comemoração de progresso, reenquadramento de frustração com resultado, estratégias de adesão. Base direta: Res. CONFEF 046/2002 ("estilo de vida ativo, autonomia, autoestima, qualidade de vida").

**(b) Com salvaguarda:** estresse e cansaço relatados **enquanto fatores de treino** (ajuste de volume, deload), nunca como objeto de manejo psicológico.

**(c) Nunca:** ansiedade, depressão, burnout, autoimagem corporal patológica, uso de álcool/substâncias, conflito familiar ou de relacionamento. Fronteira: Lei 4.119/1962, art. 13, §1º, "d" — **"solução de problemas de ajustamento" é privativa do psicólogo**. A IA acolhe e encaminha; não conduz.

### 5.4 SAÚDE E BEM-ESTAR GERAL — **aprovado com condições, escopo estreito**

O domínio mais perigoso, porque parece o mais inócuo.

**(a) Segurança hoje:** benefícios do exercício para saúde geral em nível populacional; explicação de mecanismos fisiológicos do treino; recomendação ativa de avaliação médica periódica; hidratação em contexto de treino; sedentarismo como fator de risco populacional.

**(b) Com salvaguarda (S1–S6):** postura e ergonomia no dia a dia; estresse percebido; conceitos gerais de saúde metabólica **sem qualquer referência ao quadro do aluno**.

**(c) Nunca — e este bloco precisa ser literal no prompt:** nomear, confirmar, negar ou interpretar condição de saúde do aluno; interpretar exame laboratorial ou de imagem; opinar sobre medicamento, inclusive "pode treinar tomando X"; gestação e ciclo menstrual como objeto clínico; interpretar sintoma; metas de peso corporal apresentadas como desfecho de saúde; imunidade, hormônios, tireoide, testosterona, GLP-1/emagrecedores.

### 5.5 NUTRIÇÃO — **reprovado como pedido; aprovado numa versão reduzida**

O pedido do fundador foi por *"autonomia para recomendações básicas"*. **Reprovo essa formulação.** "Recomendação" é ato dirigido; "básica" não é categoria jurídica; e a Lei 8.234/1991, art. 3º, VI e VII, reserva **consultoria, assessoria, assistência e educação nutricional a indivíduos, sadios inclusive, em instituição privada**. Não há espaço para uma faixa de "recomendação nutricional lícita sem CRN" num produto que detém a anamnese do usuário.

**(a) Pode dizer hoje com segurança:**
- Que alimentação influencia resultado de treino, em nível de mecanismo e população, sem quantidade dirigida ao aluno.
- Que a orientação alimentar é atribuição do nutricionista, e **encaminhar**.
- Apontar fontes públicas oficiais (ex.: Guia Alimentar para a População Brasileira, Ministério da Saúde) sem interpretá-las para o caso do aluno.

**(b) Com salvaguarda S1–S6 (canal populacional, texto determinístico aprovado pelo RT):**
- Conteúdo **qualitativo e populacional** sobre a relação nutrição × treino: por que proteína importa para adaptação; por que carboidrato afeta desempenho em sessões longas; por que déficit calórico agressivo prejudica manutenção de massa magra — **tudo sem número dirigido ao aluno, sem cardápio, sem cálculo, sem "você deve"**.
- Enquadramento obrigatório: *não é orientação nutricional* + *a MOVIVO não conta com nutricionista* + *procure um profissional com CRN*.
- **Nunca** como resposta a "o que eu devo comer", "monte minha dieta", "quantas calorias", "quantos gramas" — esses são gatilho de bloqueio, não de resposta.

**(c) Nunca, em nenhuma hipótese:** cardápio ou plano alimentar; cálculo de calorias, macros, VET ou gramas por kg **para o aluno**; meta de déficit ou superávit; janelas alimentares e jejum intermitente como recomendação; dieta para condição clínica; substituição de alimento com finalidade dietética; interpretação de composição corporal ou bioimpedância; qualquer coisa a um usuário com sinal de TCA.

**A ressalva mais importante:** mesmo a faixa (b) só é defensável **dentro do canal isolado S1**. Se a resposta nutricional for gerada no mesmo pipeline que enxerga anamnese e PAR-Q, ela é individualizada de fato, e a faixa (b) desaparece — só sobra a faixa (c). **Sem S1, minha recomendação em nutrição é: nada além da faixa (a).**

### 5.6 SUPLEMENTOS — **reprovado no MVP**

Terreno de **conflito inter-conselhos ativo**: a Res. CREF4/SP 151/2022 autoriza "aconselhamento, informação e esclarecimento sobre suplementos exclusivamente relacionados ao exercício físico" (para bacharéis); a Res. CFN 656/2020 trata prescrição de suplementos como prescrição dietética privativa do nutricionista. Não está pacificado.

- **(a)** Nada além de: "suplementação é assunto de nutricionista" + encaminhamento.
- **(b)** Apenas `D7·I0·F0` sob S1–S6: existência e mecanismo geral de um suplemento, **sem dose, sem marca, sem recomendação de uso**. Alto risco mesmo assim; e ainda que se invoque a 151/2022, ela é norma **regional de SP** e a MOVIVO opera nacionalmente.
- **(c)** Dose (inclusive "a literatura usa 3–5 g"), timing, marca, produto com fármaco, termogênico, emagrecedor, pré-treino, hormonal.

**Recomendação prática:** manter suplemento inteiramente em ⛔ até existir CRN na estrutura. É a pergunta mais frequente do público-alvo e a de pior relação risco/benefício.

---

## 6. Linguagem obrigatória e proibida

### 6.1 Os guardrails atuais continuam valendo — e precisam ser ampliados

Os três atuais (nunca "diagnóstico/tratamento/cura"; nunca "resultado garantido"; respaldo CREF sempre visível) são **necessários e insuficientes** para o perímetro ampliado. Acrescentar ao `INVIOLABLE_RULES_BLOCK` (L0, não editável):

```
- NUNCA calcule, estime ou indique quantidade de alimento, caloria, macronutriente,
  grama por quilo, dose de suplemento, cardápio ou plano alimentar para o aluno.
- NUNCA afirme, confirme, negue ou interprete condição de saúde, sintoma, exame ou
  medicamento do aluno.
- NUNCA apresente a MOVIVO, você mesma ou o profissional responsável como nutricionista,
  médico, psicólogo, enfermeiro ou fisioterapeuta, nem como serviço dessas áreas.
- NUNCA apresente formação em curso, não concluída ou não registrada em conselho como
  habilitação profissional.
- Números de referência populacional só podem ser citados COMO referência populacional,
  nunca como meta ou indicação para este aluno.
- Diante de sinal de relação disfuncional com comida, peso ou corpo, NÃO oriente sobre
  alimentação, peso ou calorias: acolha e encaminhe.
```

E ao `SCOPE_PERIMETER_BLOCK` (L0): substituir o binário "só treino / na dúvida FORA" pela matriz da §4.3, **preservando** a cláusula de dúvida em nova forma: *"na dúvida, desça um nível de permissão"*.

### 6.2 Frases-modelo por faixa

**✅ Treino (individualizado, prescritivo — permitido)**
> "No seu protocolo o supino vem com 3×8 e RIR 2. Isso quer dizer parar com umas 2 repetições de reserva — se você chegou a 8 fácil, na próxima sessão sobe a carga. Como você relatou desconforto no ombro na anamnese, o Léo (CREF ___) manteve a pegada mais fechada nessa fase."

**✅ Sono (populacional, F1 — permitido)**
> "Sono é onde a adaptação ao treino acontece de fato. Na população adulta, a faixa mais associada a boa recuperação fica entre 7 e 9 horas — não é uma meta que eu esteja definindo pra você, é a referência geral. O que costuma render mais é regularidade de horário: dormir e acordar sempre por volta do mesmo horário."

**✅ Hábito (permitido)**
> "Faltou terça? Isso não quebra nada. O que derruba resultado é sequência longa de falta, não uma sessão. Vamos combinar assim: qual é o dia da semana em que é mais difícil aparecer? A gente ajusta o treino desse dia pra ser o mais curto."

**🟡 Nutrição (canal populacional, F1, com rodapé — o teto do que é permitido)**
> "Falando em termos gerais, sem olhar o seu caso: proteína é o nutriente que dá suporte à adaptação depois do treino, e distribuir ao longo do dia tende a funcionar melhor do que concentrar tudo numa refeição.
> ⚠️ Isso é informação geral, não é orientação alimentar e não considera você especificamente. A MOVIVO não conta com nutricionista — pra montar sua alimentação, procure um profissional com CRN. Quer que eu registre pra o Léo te indicar um?"

**⛔ Nutrição (bloqueio — resposta determinística)**
> "Montar cardápio e calcular calorias é atribuição de nutricionista, e a MOVIVO não tem esse profissional na equipe — então eu não vou te dar número aqui, porque seria orientação sem o respaldo certo. O que eu faço bem é o seu treino. Quer que eu registre pra o Léo te indicar um nutricionista?"

**⛔ Suplemento (bloqueio)**
> "Suplemento entra no campo do nutricionista, não no meu. Não vou indicar dose nem produto. Se quiser, eu registro pra o Léo te encaminhar — e enquanto isso a gente segue no que muda seu resultado agora, que é o treino."

**⛔ Clínico (bloqueio + encaminhamento)**
> "Isso é sinal que precisa de avaliação presencial, e não é algo que eu consiga ou deva avaliar por aqui. Procure atendimento médico. Já avisei o Léo (CREF ___), que é o profissional responsável pelo seu acompanhamento."

**⛔ Transtorno alimentar (bloqueio de segurança)**
> "Obrigada por me contar isso — não é pouca coisa. Eu não sou a pessoa certa pra te ajudar com essa parte, e não vou falar de peso ou de comida com você aqui. Procure um profissional de saúde; se precisar de apoio agora, o CVV atende 24h no 188. Já avisei o Léo."

### 6.3 Comunicação e marketing — o item mais perigoso

**Proibido em qualquer peça, post, landing, script do Cahuã ou copy:**
- "temos nutricionista", "acompanhamento nutricional", "orientação alimentar", "time multidisciplinar de saúde";
- "nosso RT está cursando Medicina / falta só o estágio em Nutrição" — **art. 47 da LCP pune "anunciar que exerce"**;
- "MOVIVO cuida da sua saúde" sem qualificação; "método aprovado por médicos";
- qualquer promessa de resultado ou de perda de peso.

**Permitido e verdadeiro:** "Responsável Técnico: [nome], Profissional de Educação Física, CREF nº ___" — e, se quiserem citar a enfermagem, apenas como qualificação pessoal nominal do RT, jamais como serviço oferecido.

---

## 7. Estrutura de responsabilidade técnica

Supervisão que não deixa rastro não existe juridicamente. O perímetro ampliado só se sustenta se a assunção de responsabilidade do RT for **documentada, versionada e por domínio**.

### 7.1 Contrato de Responsabilidade Técnica — cláusulas a acrescentar

1. **Escopo por domínio**, com a matriz da §4.3 como **anexo contratual versionado**. Alteração da matriz = aditivo assinado.
2. **Declaração expressa** de que o RT assume responsabilidade técnica **exclusivamente** no âmbito da habilitação CREF, e que **não exerce nem autoriza** o exercício de Nutrição, Medicina, Psicologia ou Enfermagem no produto.
3. **Obrigação de curadoria por domínio**: nenhum conteúdo de D3–D7 entra no corpus sem aprovação nominal e datada do RT.
4. **Revisão obrigatória**: 100% dos templates determinísticos das faixas 🟡; amostragem mínima definida (sugiro 5% ou 30 conversas/semana, o que for maior) das faixas ✅; **100% das respostas geradas em D5/D6/D7 no primeiro trimestre** de operação da ampliação.
5. **Vedação de invocação de habilitação não registrada** pelo RT em qualquer material.
6. **Obrigação de manter CREF ativo** e comunicar em 24h qualquer alteração de situação cadastral em qualquer conselho.
7. **Gatilho de suspensão**: perda do registro, ou representação em conselho, suspende automaticamente as faixas 🟡.
8. **Seguro de RC profissional** a partir da tração; **RC de produto/serviço** para a PJ.

### 7.2 Termos de Uso — cláusulas a acrescentar

1. Cláusula de **escopo negativo expressa e destacada**: *"A MOVIVO presta serviço de orientação de exercício físico sob responsabilidade técnica de Profissional de Educação Física registrado no CREF. A MOVIVO **não** presta serviço de nutrição, nutrição clínica, medicina, psicologia, fisioterapia ou enfermagem, e não conta com profissionais registrados nesses conselhos."*
2. Cláusula de **natureza do conteúdo geral**: conteúdo de saúde, sono, hábitos e nutrição é **informativo e populacional**, não individualizado, não constitui orientação profissional nas áreas reservadas.
3. **TCLE de telesserviço** (Res. CONFEF 542/2024) como instrumento próprio, distinto do PAR-Q e do consentimento LGPD.
4. Identificação da PJ, do registro **CREF-PJ** e do **nome + CREF do RT**, visíveis também na interface do produto.
5. **Não usar** cláusula de "responsabilidade exclusiva do consumidor" — nula (CDC art. 51, I) e sinaliza má-fé. Repito o alerta do parecer anterior.

### 7.3 Registro de auditoria — o que precisa existir por mensagem

```
message_id, user_id, session_id, timestamp
intent, domain(D), individualization(I), illocution(F), grounding(G)
decision ∈ {ALLOW, SAFEGUARD, BLOCK}, blocked_reason
context_channel ∈ {CLINICAL_AWARE, POPULATIONAL_ISOLATED}   ← prova o S1
health_context_fields_used[]                                 ← vazio obrigatório no canal populacional
template_id, template_version
corpus_version, evidence_ids[], entailment_verdicts[]
prompt_version, model_id
rt_approval_id, rt_approved_at, rt_signature_hash
parq_state, clinical_flags[]
```

Append-only, retenção 5 anos (prazo prescricional do CDC art. 27), com trilha de alteração da matriz e do corpus. **`health_context_fields_used[]` vazio no canal populacional é a prova técnica da não-individualização** — é a evidência que sustenta a faixa (b) de nutrição perante um CRN. Sem ela, a defesa é testemunhal e perde.

Complementar: **relatório trimestral de supervisão assinado pelo RT**, com amostra revisada, achados e correções. É barato e é o que diferencia supervisão real de supervisão de fachada.

### 7.4 LGPD — o que a ampliação obriga a refazer

A ampliação **muda as finalidades de tratamento**. Portanto:
- **Reapresentar consentimento** (Art. 11, I) com as novas finalidades — sono, hábitos, bem-estar. Consentimento anterior não cobre finalidade nova (Art. 9º, §1º).
- **Atualizar o RIPD**, que hoje presume perímetro estrito.
- **Atualizar o ROPA** com o canal populacional como operação distinta.
- Contexto de fiscalização: a **Agenda Regulatória ANPD 2025–2026** prioriza dados sensíveis com ênfase em **saúde**, com meta de dez ações fiscalizatórias até o fim de 2026, e a Autoridade sinalizou que vai avaliar **efetividade das práticas, não a existência formal de documentos**. O canal isolado S1 é, além de defesa regulatória-profissional, uma boa medida de minimização (Art. 6º, III).

---

## 8. Riscos residuais

| # | Risco | Prob. | Sev. | Nível | Mitigação |
|---|---|---|---|---|---|
| R1 | **Representação/autuação do CRN** por orientação nutricional (art. 47 LCP + ação fiscal) | Média-alta **sem S1**; Baixa-média **com S1+S2** | Média-alta | 🔴 Alto → 🟡 Médio | Canal isolado, texto determinístico, encaminhamento obrigatório, zero quantidade. **Elimina-se com CRN na estrutura.** |
| R2 | **Comunicação enganosa** sugerindo nutricionista/médico na equipe (CDC art. 37, §1º + art. 47 LCP, verbo "anunciar") | **Alta** se o argumento da formação do RT entrar em marketing | Alta | 🔴 **Crítico** | Proibição literal em contrato de imagem do Cahuã, no brand book e no `INVIOLABLE_RULES_BLOCK`. Revisão jurídica prévia de toda peça. |
| R3 | **Dano à saúde** por orientação em domínio ampliado (responsabilidade objetiva, CDC arts. 12–14) | Baixa-média | **Crítica** | 🔴 Alto | PAR-Q bloqueante, S4, grounding obrigatório, handoff clínico, seguro de RC. |
| R4 | **Usuário com transtorno alimentar** exposto a conteúdo de peso/caloria | Baixa | **Crítica** | 🔴 Alto | Detecção D10 + bloqueio duro + handoff. **Requisito de engenharia, não recomendação.** |
| R5 | **Sanção ANPD** por finalidade nova sem consentimento adequado | Média (ciclo fiscalizatório 2026 foca saúde) | Alta | 🟠 Médio-alto | Reconsentimento, RIPD e ROPA atualizados antes do go-live da ampliação. |
| R6 | **Autuação CREF** por descaracterização do serviço ou supervisão de fachada | Baixa (com 542/2024 atendida) | Alta | 🟡 Médio | TCLE de telesserviço, registro visível, plano assinado, relatório trimestral de supervisão. |
| R7 | **Conflito CONFEF × CFN sobre suplementos** decidido contra o CREF | Média | Média | 🟡 Médio | Manter D7 em ⛔ no MVP. Não construir feature sobre norma em disputa. |
| R8 | **Regulação de IA (PL 2338/2023)** classificar saúde/bem-estar como alto risco | Média-alta no horizonte 12–24 meses | Média | 🟡 Médio | A matriz D/I/F/G + logs S5 já produzem quase tudo que um regime de alto risco exige (documentação, explicabilidade, supervisão humana). Ampliar agora **com** essa estrutura é mais barato que retrofitar depois. |
| R9 | **Deriva do modelo** — LLM ultrapassa a matriz na prática | Média | Alta | 🟠 Médio-alto | Classificação D/I/F na **saída**, não só no prompt; suíte de avaliação adversarial com Mariana; canary de conversas revisadas pelo RT. |

---

## 9. Recomendação final, faixa por faixa

| Domínio pedido | Veredito | Condições |
|---|---|---|
| **Treino — orientação completa, didática e detalhada** | ✅ **APROVADO** — e recomendo ampliar **mais** do que o pedido | TCLE de telesserviço; registro do RT visível; plano assinado; grounding obrigatório no corpus do RT |
| **Recuperação ligada ao treino** | ✅ **APROVADO** | Idem |
| **Sono** | ✅ **APROVADO COM CONDIÇÕES** | Populacional e qualitativo (`F0/F1`); `F2` bloqueado; distúrbios do sono em ⛔; sem substâncias |
| **Hábitos, rotina, adesão, motivação** | ✅ **APROVADO COM CONDIÇÕES** | Bloqueio em sofrimento psíquico clínico (Lei 4.119/62, art. 13, §1º, "d") |
| **Saúde/bem-estar geral** | 🟡 **APROVADO COM CONDIÇÕES, escopo estreito** | Só promoção da saúde populacional + encaminhamento. **REPROVADO** para qualquer interpretação de condição, sintoma, exame ou medicamento |
| **Nutrição básica — "autonomia para recomendações"** | ⛔ **REPROVADO na forma pedida** | A palavra "recomendação" é justamente o que a Lei 8.234/1991 reserva |
| **Nutrição — versão reduzida** | 🟡 **APROVADO COM CONDIÇÕES** | Só `I0·F0/F1`, **exclusivamente** no canal isolado S1 com texto determinístico S2, rodapé S3, pré-bloqueio S4, log S5 e limite de profundidade S6. **Sem S1, cai para ⛔** |
| **Suplementos** | ⛔ **REPROVADO no MVP** | Reavaliar quando houver CRN na estrutura ou pacificação CONFEF × CFN |

### O caminho que dá ao fundador o que ele quer, de verdade

**Contratar um nutricionista com CRN ativo como responsável técnico da trilha nutricional.** Não precisa ser sócio nem full-time: PJ meio-período, com contrato de RT nutricional espelhando o do Léo (curadoria de corpus nutricional, aprovação de templates, revisão amostral, assunção de responsabilidade técnica).

O que isso destrava, imediatamente:
- D6 sai de "🟡 estreito" e vai para **✅ amplo**, incluindo individualização com base na anamnese;
- D7 (suplementos) sai de ⛔ para ✅ dentro da Res. CFN 656/2020;
- R1 cai de Alto para Baixo, R2 deixa de existir (passa a ser **verdade** dizer que há nutricionista na equipe);
- vira **diferencial competitivo real e defensável**, em vez de zona cinzenta.

Custo estimado: R$ 1.500–4.000/mês + registro adicional da PJ no CRN (a confirmar com o CRN regional). Comparado ao custo de uma representação do CRN, de uma ação de consumidor por dano nutricional, ou de refazer a feature depois — é barato. **Recomendo formalmente incluir isso no plano antes de qualquer feature nutricional individualizada.**

---

## 10. Próximos passos

**Bloqueantes antes do go-live do perímetro ampliado**
1. Implementar o **canal populacional isolado (S1)** e o log `context_channel` + `health_context_fields_used[]` — Victor/Leonardo. *Sem isto, só faixa (a) de nutrição.*
2. Implementar a **classificação D/I/F na saída** e a matriz §4.3 como tabela de decisão versionada — Victor.
3. Implementar **detecção D10 (transtorno alimentar)** no `clinical-guardrail.ts` com bloqueio duro e handoff. *Prioridade máxima de segurança.*
4. **Reescrever** `SCOPE_PERIMETER_BLOCK` e ampliar `INVIOLABLE_RULES_BLOCK` conforme §6.1 — e atualizar o texto de `rationale` do bloco `SCOPE_PERIMETER` em `PROMPT_BLOCKS`, que hoje descreve o perímetro estrito.
5. **Reclassificar os `SCOPE_PATTERNS`** de `clinical-guardrail.ts`: `dieta|cardápio|caloria|macronutriente|jejum intermitente|"o que devo comer"` e dose de suplemento permanecem em **bloqueio**; menções genéricas a nutrição/proteína/suplemento passam a **rotear para o canal populacional** em vez de recusa seca.
6. RT **curar e aprovar** o corpus de D3–D6, com `rt_approval_id` por documento.
7. **TCLE de telesserviço** (Res. CONFEF 542/2024) + **reconsentimento LGPD** com as novas finalidades + **RIPD/ROPA atualizados**.
8. Cláusulas novas no Contrato de RT e nos Termos de Uso (§7.1 e §7.2).
9. **Briefing de compliance para o Cahuã e para Helena/Camila** sobre o §6.3 — o risco R2 é crítico e mora integralmente na comunicação.

**Não bloqueantes, mas recomendados no trimestre**
10. Consultar formalmente o **CREF regional** sobre: prazo de revalidação da avaliação inicial na 542/2024, e enquadramento de plataforma digital nacional com RT único.
11. Iniciar prospecção de **nutricionista CRN** para a trilha nutricional.
12. Suíte de avaliação adversarial da matriz com Mariana (tentativas de extrair dieta, dose, diagnóstico e meta de peso).
13. Cotar **seguro de RC profissional e de serviço**.

---

## Fontes Consultadas

**Legislação**
- Lei nº 8.234/1991, art. 3º (atividades privativas do nutricionista) — https://www.planalto.gov.br/ccivil_03/leis/1989_1994/l8234.htm · texto integral do art. 3º via https://modeloinicial.com.br/lei/L-8234-1991/lei-8234/art-3
- Lei nº 12.842/2013 (Ato Médico), art. 4º — http://www.planalto.gov.br/ccivil_03/_ato2011-2014/2013/lei/l12842.htm · https://www.legjur.com/legislacao/art/lei_00128422013-4
- Lei nº 7.498/1986 (exercício da Enfermagem), art. 11 — https://www.cofen.gov.br/lei-n-749886-de-25-de-junho-de-1986/
- Lei nº 4.119/1962 (profissão de Psicólogo), art. 13, §1º — https://www.legjur.com/legislacao/art/lei_00041191962-13 · https://crp24.org.br/funcoes-privativas-da-psicologao/
- Decreto-Lei nº 3.688/1941 (Lei das Contravenções Penais), art. 47 — https://jurishand.com/decreto-lei-3688-de-03-outubro-1941/artigo-47 · https://www2.camara.leg.br/legin/fed/declei/1940-1949/decreto-lei-3688-3-outubro-1941-413573-publicacaooriginal-1-pe.html
- PL 2338/2023 (Marco Legal da IA) — status de tramitação — https://www25.senado.leg.br/web/atividade/materias/-/materia/157233 · https://www2.camara.leg.br/atividade-legislativa/comissoes/comissoes-temporarias/especiais/57a-legislatura/comissao-especial-sobre-inteligencia-artificial-pl-2338-23

**Sistema CONFEF/CREF**
- Resolução CONFEF nº 542/2024 (atendimento remoto: teleconsulta, teleaula, teleconsultoria, análise de metadados) — https://www.legisweb.com.br/legislacao/?id=463073
- Resolução CONFEF nº 046/2002 (intervenção e competências do PEF) — https://www.legisweb.com.br/legislacao/?id=98644
- Resolução CONFEF nº 477/2023 (registro de PJ e RT) — https://www.confef.org.br/includes/api/resolucoes/imprimir.php?id=561
- Resolução CONFEF nº 607/2025 (altera a 477/2023) — https://www.legisweb.com.br/legislacao/?id=487268
- Resolução CREF4/SP nº 151/2022 (suplementos alimentares; vedação de dietas e planos alimentares) — https://www.crefsp.gov.br/comunicacao/noticias/o-cref4-sp,-por-meio-da-resolucao-n.-151-2022,-define-a-atuacao-do-profissional-de-educacao-fisica-na-area-de-suplementos-alimentares

**Sistema CFN/CRN**
- CFN — Posicionamento: Prescrição Dietética como atividade privativa — https://cfn.org.br/posicionamento-prescricao-dietetica/
- Resolução CFN nº 600/2018 (áreas de atuação e atribuições) — https://cfn.org.br/wp-content/uploads/resolucoes/Res_600_2018.htm
- Resolução CFN nº 656/2020 (prescrição dietética de suplementos), alterada pela 731/2022 — https://cfn.org.br/wp-content/uploads/resolucoes/Res_656_2020.html
- Resolução CFN nº 760/2023 (Telenutrição) — https://cfn.org.br/cfn-publica-resolucao-que-regulamenta-a-telenutricao/
- CFN — Exercício ilegal da profissão — https://cfn.org.br/exercicio-ilegal-da-profissao/
- CRN-9 — Exercício ilegal praticado por leigos (fiscalização de perfis digitais) — https://crn9.org.br/exercicio-ilegal-da-profissao-de-nutricionista-praticado-por-leigos/
- Posicionamento de diretor do CFN sobre planos alimentares gerados por IA — https://www.metropoles.com/saude/ia-pode-montar-dieta-riscos

**Sistema COFEN/COREN**
- Resolução COFEN nº 696/2022 (Telenfermagem), alterada pelas 707/2022 e 717/2023 — https://www.cofen.gov.br/resolucao-cofen-no-696-2022/
- Resolução COFEN nº 721/2023 (registro de empresas nos Conselhos de Enfermagem) — https://cofen.gov.br/resolucao-cofen-no-721-2023/
- Resolução COFEN nº 736/2024 (Processo de Enfermagem) — https://www.cofen.gov.br/resolucao-cofen-no-736-de-17-de-janeiro-de-2024/

**Proteção de dados e responsabilidade civil**
- ANPD — Agenda Regulatória 2025–2026 e priorização de dados de saúde (Res. CD/ANPD nº 31/2025) — https://ctsconsultoria.com.br/agenda-regulatoria-anpd-2025-2026-lgpd/
- ANPD — intensificação de fiscalização em dados de saúde em 2026 — https://hdpo.com.br/fiscalizacao-de-dados-de-saude-anpd-2026/
- Responsabilidade objetiva de plataformas digitais no CDC — https://legale.com.br/blog/plataformas-digitais-a-responsabilidade-objetiva-no-cdc/ · https://www.tjdft.jus.br/consultas/jurisprudencia/jurisprudencia-em-temas/cdc-na-visao-do-tjdft-1/responsabilidade-civil-no-cdc/fato-do-produto-e-do-servico

**Limitação declarada de pesquisa:** não localizei jurisprudência de tribunal superior **específica** sobre (i) responsabilidade civil de plataforma de treino mediada por IA, nem (ii) exercício ilegal da profissão de nutricionista praticado por plataforma digital com IA. Ambos são temas ainda sem precedente consolidado no Brasil em ago/2026 — o que significa **incerteza, não segurança**: sem precedente, o primeiro caso julgado define o padrão, e a MOVIVO não deve querer ser esse caso. As análises de responsabilidade civil acima se apoiam no regime geral do CDC (arts. 12–14 e 51, I) e em doutrina/jurisprudência sobre plataformas em geral. Os portais do CFN e do CREF4/SP bloquearam acesso automatizado (HTTP 403) em algumas URLs; onde isso ocorreu, usei fontes espelho ou secundárias, indicadas acima.
