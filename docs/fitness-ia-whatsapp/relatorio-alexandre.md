# Relatório — Dr. Alexandre (CLO / Head Jurídico Corporativo)

**Data:** 2026-07-22
**Ideia analisada:** MOVIVO — AI Coach de treino individualizado via WhatsApp, com supervisão de profissional de Educação Física (CREF). Modelo B2C, assinatura recorrente (R$29–59/mês), trial de 14 dias.
**Pasta do projeto:** `docs/fitness-ia-whatsapp/`
**Status do pipeline:** Fase 2 (Fundação Legal e Financeira) — **executada FORA DE ORDEM**. Lucas (Fase 3) e Rafael (Fase 4) já rodaram assumindo hipóteses jurídicas que este relatório agora valida, corrige ou substitui. Onde diverjo de Lucas/Rafael, sinalizo com **[DIVERGÊNCIA]** ou **[CORREÇÃO]**.

> **Aviso obrigatório (honestidade jurídica):** este relatório é insumo estratégico de um CLO interno, **não substitui parecer formal** de advogado externo com OAB para os atos que exigem responsabilidade técnica registrada (constituição societária, registro CREF-PJ, registro de marca no INPI, RIPD assinado). Nenhuma estrutura elimina 100% do risco — especialmente em relação de consumo envolvendo saúde física. A meta é **máxima diligência e defensibilidade**, não imunidade. Cinco pontos deste relatório são **BLOQUEADORES** que impedem o go-live legal e estão destacados no Resumo Executivo.

---

## Resumo executivo

A MOVIVO é **juridicamente viável**, mas nasce sobre um terreno de risco elevado (dados sensíveis de saúde + fronteira do exercício ilegal da profissão + relação de consumo sobre corpo humano) que exige que a arquitetura jurídica seja construída **antes** do go-live, não depois. O caminho está comprovado no mercado (benchmark Zyla, citado por Clóvis), mas o produto de musculação carrega vetor de risco maior que o de corrida.

**Nível de risco global do projeto: ALTO — reduzível a MÉDIO com a execução integral do Plano de Mitigação.**

**5 BLOQUEADORES DE GO-LIVE (nenhum usuário real antes de resolvê-los):**

1. **[BLOQUEADOR 1] Constituição da PJ + registro CREF-PJ com RT nomeado.** Operar antes disso é exercício irregular e expõe os sócios pessoalmente. Sociedade Limitada com Acordo de Sócios e vesting.
2. **[BLOQUEADOR 2] DeepSeek como LLM principal processando conversas com dados de saúde é uma NÃO-CONFORMIDADE LGPD grave.** [DIVERGÊNCIA com Rafael/ADR-005]. Servidores na China, sem adequação com o Brasil, sem mecanismo de exclusão. Precisa ser substituído no boundary de dados sensíveis OU os dados precisam ser pseudonimizados antes de sair, OU usar DeepSeek via host ocidental com SCC. Ver seção 3.6.
3. **[BLOQUEADOR 3] Consentimento específico e destacado para dado de saúde (Art. 11, I, LGPD) + gate PAR-Q com bloqueio real** (não apenas "flag para revisão"). [CORREÇÃO ao RF-09]. Sem isso o formulário de anamnese não pode coletar nada.
4. **[BLOQUEADOR 4] Termos de Uso + Política de Privacidade + Termo de Responsabilidade** publicados e aceitos com trilha de auditoria, com o enquadramento "criado por profissional de Ed. Física com uso de IA" — nunca "a IA prescreve".
5. **[BLOQUEADOR 5] Busca de anterioridade no INPI para "MOVIVO"** e parecer de PI sobre a colisão com **VIVO (marca de alto renome confirmada, Telefônica)**. Risco real e concreto — ver seção 6. Ter TRENOVA pronto como plano B antes de investir pesado na marca.

**Correções materiais à arquitetura de Rafael:** (a) retenção de "5 anos como requisito LGPD para dados de saúde" está **juridicamente mal fundamentada** — o prazo correto deriva do CDC art. 27 (prescrição de 5 anos) como base de conservação para defesa, não de "requisito LGPD"; (b) direito ao esquecimento via `DELETE` + `DROP partition` precisa conviver com a conservação defensiva do art. 16 LGPD — proponho modelo de **anonimização + retenção mínima probatória**; (c) assinatura eletrônica do protocolo com login+timestamp é aceitável no MVP, mas precisa de hash de integridade e carimbo — Rafael já previu `signature_hash`, o que valido.

---

## Contexto recebido

Do pipeline (Clóvis→Gabriel→Caio→Kimura→Helena→Lucas→Rafael):

- **Clóvis (gatekeeper):** VALIDADO COM RESSALVAS. Definiu os cinco pilares do modelo jurídico (PJ no CREF + RT nomeado via Res. CONFEF 477/2023; autoria contratual atribuída ao humano; PAR-Q + termo; gate de liberação médica; LGPD reforçada). Alertou que o CDC art. 51, I torna nula a cláusula de "responsabilidade exclusiva do consumidor". Marcou como pendências: estrutura societária, ambiguidade "estabelecimento" para plataforma digital, e verificação INPI do "vivo".
- **Caio (naming):** recomendou MOVIVO, com **alerta explícito** sobre proximidade com VIVO (alto renome) — item nº 1 a validar no INPI antes de registrar. TRENOVA como hedge jurídico. Domínio `movivo.com.br` livre.
- **Lucas (produto):** tratou meu relatório como **bloqueador P0 de desenvolvimento**. Pediu: bases legais Art. 11, template de consentimento, política de exclusão (Art. 18), RIPD, prazo de retenção. Propôs gate PAR-Q com "bloqueio condicional de geração até clearance". Assinatura eletrônica: login + timestamp no MVP.
- **Rafael (arquitetura):** implementou hipóteses jurídicas na arquitetura — tabela `consents` (tipo, versão, IP, user-agent, timestamp), criptografia `pgcrypto` do bloco de saúde, RLS em `conversations`, `audit_logs` append-only, retenção 5 anos, direito ao esquecimento por DELETE+DROP, expiração de anamnese incompleta em 72h, DeepSeek V3.2 como LLM principal com fallback OpenAI/Anthropic, VPS Hostinger.

Fundadores: Rodrigo, Pedro, Joaquim (devs/sócios), Cahuã (marketing/rosto/sócio) e o treinador do Cahuã (CREF, RT, sócio). **Sem estrutura societária definida.**

---

## Análise e desenvolvimento

### 1. Estruturação societária dos 5 fundadores

**1.1 Tipo societário recomendado: Sociedade Limitada (LTDA).**
Não S.A. neste estágio (custo de governança, publicações, conselho — desproporcional). A LTDA regida por regência supletiva das normas de S.A. (cláusula no contrato social) preserva flexibilidade e prepara terreno para captação futura (mútuo conversível). Enquadramento tributário provável Simples Nacional Anexo III/V ou Lucro Presumido — **decisão de Eduardo (CFO)**, não minha; sinalizo apenas que a atividade CNAE deve ser compatível com o registro CREF-PJ (serviços de Educação Física / condicionamento físico) e que atividade de "desenvolvimento de software" isolada **não** habilita o registro no CREF.

**1.2 Ponto sensível — a PJ precisa ser prestadora de serviço de Educação Física, não só uma software house.**
Para que o registro CREF-PJ e o RT façam sentido jurídico, o objeto social deve declarar a prestação de serviços de orientação/prescrição de exercício físico (com a EF como atividade-fim), com uso de tecnologia como meio. Se o contrato social disser apenas "desenvolvimento de software", o CREF pode recusar o registro-PJ e, pior, a defesa de "quem presta é o profissional" desmorona. **Recomendação:** objeto social híbrido — prestação de serviços de condicionamento físico e orientação de exercício (atividade-fim, sob RT) + desenvolvimento e licenciamento de plataforma tecnológica (meio).

**1.3 Divisão de quotas — framework, não números.**
Não invento percentuais. Proponho o método e as perguntas em aberto que os sócios devem responder (idealmente com facilitação de advogado/consultor):

Eixos de ponderação sugeridos (modelo, não veredito):
- **Contribuição de trabalho contínuo (sweat equity):** os 3 devs constroem e operam o produto — peso alto e contínuo.
- **Ativo insubstituível de distribuição:** Cahuã (audiência/rosto) — é o CAC-zero da largada; peso alto **mas com risco de dependência** (Lucas Risco 6).
- **Ativo regulatório insubstituível:** o RT-CREF — sem ele o negócio é ilegal. Peso estratégico altíssimo, ainda que a dedicação horária possa ser menor que a dos devs.
- **Ideia/capital inicial:** peso menor isoladamente.

Perguntas em aberto que decidem os percentuais:
1. Quem trabalha full-time vs. part-time? (dedicação define muito do equity justo)
2. Haverá aporte de capital? Quem e quanto?
3. O RT-CREF será remunerado como sócio (pró-labore/distribuição) e/ou como prestador (contrato de RT)? **Recomendo os dois papéis separados** — ver seção 8.1.
4. Cahuã cede imagem/audiência: isso é equity, contrato de licença de imagem, ou ambos?

> **Regra de ouro anti-conflito:** nenhum sócio deve ter 50% exato (empate/deadlock). Evitar divisão "igualitária" 20/20/20/20/20 sem mecanismo de desempate — é a divisão que mais mata startup. Definir quotas + **poder de decisão** (quóruns) separadamente.

**1.4 Vesting — obrigatório, dado que são 5 sócios sem histórico societário.**
No Brasil não existe "vesting" estatutário como nos EUA; implementa-se **contratualmente** via Acordo de Sócios com uma das duas estruturas:
- (a) **Opção de compra de quotas** condicionada ao tempo/metas (as quotas só são efetivamente adquiridas conforme o cronograma); ou
- (b) **Quotas já emitidas com cláusula de recompra (buyback)** a valor simbólico/nominal caso o sócio saia antes do vesting completar ("reverse vesting").

Parâmetros de mercado a adotar:
- **Cliff de 12 meses** (nada de equity antes de 1 ano de dedicação efetiva).
- **Vesting total de 48 meses** (4 anos), linear/mensal após o cliff.
- **Aceleração** (single/double trigger) em caso de aquisição — cláusula para investidores futuros.
- **Cláusulas de Bad Leaver / Good Leaver** definindo o que acontece com as quotas em saída voluntária, justa causa, morte ou invalidez.
- **Vesting específico para o RT-CREF e para o Cahuã** amarrado à permanência do papel crítico (se o RT sai, precisa haver substituto qualificado em 24h — Res. 477/2023; o Acordo deve prever isso).

**1.5 Acordo de Sócios (Shareholders' Agreement) — documento mais importante desta fase.** Cláusulas essenciais: vesting/cliff; tag along e drag along; direito de preferência; não-concorrência e non-solicit; confidencialidade; propriedade intelectual (todo código/IP criado pertence à PJ, não ao dev — **crítico**, ver seção 8); regras de deadlock; vedação de cessão de quotas sem anuência; política de distribuição de lucros; e cláusula de resolução de disputas (arbitragem ou foro).

**Nível de risco (societário): ALTO se não formalizado antes do faturamento (risco de litígio entre sócios, perda de IP, dependência de pessoa física). MÉDIO-BAIXO com Acordo + vesting.**

---

### 2. Registro da PJ no CREF/CONFEF com Responsável Técnico (Resolução CONFEF 477/2023)

**2.1 Fundamento.** Lei 9.696/1998 (regulamenta a profissão de Educação Física; a prescrição/orientação de exercício é atividade privativa do profissional registrado). Resolução CONFEF nº 477/2023 disciplina o **registro da Pessoa Jurídica** no Sistema CONFEF/CREFs e a figura do **Responsável Técnico (RT)**. O art. 21 define o RT como o profissional de Ed. Física qualificado que assume planejamento, organização, direção, coordenação, execução e avaliação dos serviços de EF prestados pela PJ.

**2.2 [CORREÇÃO a Clóvis] Limite de estabelecimentos por RT.** Clóvis registrou "até 2 estabelecimentos". A pesquisa na Res. 477/2023 (art. 21) indica **até 4 estabelecimentos** por RT, e que o RT só pode responder por estabelecimento cuja área de atividade corresponda à sua habilitação. **Atenção:** já existe **Resolução CONFEF nº 607/2025** (posterior) que pode ter alterado esses parâmetros — este é um ponto a confirmar formalmente com o CREF regional e advogado de direito desportivo antes de escalar. A ambiguidade central levantada por Clóvis **permanece**: a regra de "estabelecimento" foi pensada para unidades físicas, e não há jurisprudência clara sobre como se aplica a uma plataforma 100% digital nacional. Para o MVP com um único RT isso é gerenciável; para escala nacional é **questão a resolver com parecer especializado** — não pela startup sozinha.

**2.3 Passo a passo do registro CREF-PJ:**
1. Constituir a LTDA (contrato social com objeto compatível — seção 1.2) e obter CNPJ.
2. O RT (treinador do Cahuã) deve estar com **registro individual ativo e regular** no CREF regional (quitação de anuidades).
3. Preencher o requerimento de registro-PJ no portal eletrônico do CONFEF/CREF, informando o número de registro do RT.
4. Firmar o **Termo de Compromisso de Responsabilidade Técnica** (formulário próprio), assinado pelo representante legal da PJ **e** pelo RT.
5. Recolher a taxa/anuidade da PJ e protocolar; aguardar deferimento e emissão do número de registro-PJ.
6. Exibir o registro CREF-PJ e o nome/CREF do RT nos canais oficiais (site, ToS) — supera o gap de transparência do benchmark.

**2.4 Riscos e mitigação:**
- **Exercício irregular da profissão** (se operar antes do registro, ou se a IA for comunicada como quem "prescreve"): mitiga-se com o registro-PJ + RT + enquadramento contratual "criado por profissional com uso de IA" + supervisão real do RT (não decorativa — o RT deve efetivamente definir a metodologia, revisar amostras e assinar protocolos).
- **RT como ponto único de falha:** o Acordo de Sócios e o processo devem prever substituto qualificado (Res. 477/2023 prevê designação de substituto) e plano de credenciar RTs adicionais na escala.
- **Supervisão "de fachada":** risco reputacional/regulatório se ficar provado que o RT não supervisiona de fato. Mitiga-se com evidência: logs de revisão/assinatura no dashboard (Rafael já previu — `protocols.signed_at`, `signature_hash`, `professional_id`), amostragem documentada e versionamento.

**Nível de risco (CREF): ALTO sem registro-PJ; MÉDIO com registro + supervisão real documentada; residual irredutível na fronteira "digital nacional".**

---

### 3. LGPD — análise aprofundada e validação da arquitetura de Rafael

**3.1 Bases legais para dados de saúde (Art. 11).**
Os dados coletados (histórico de lesões, condições do PAR-Q, medicações, gestação, objetivos corporais, composição corporal) são **dados pessoais sensíveis** (Art. 5º, II e Art. 11). A base legal principal e adequada para a MOVIVO é o **consentimento específico e destacado, para finalidades específicas** (Art. 11, I).

> **Alerta importante:** a base do Art. 11, II, "f" ("tutela da saúde, em procedimento realizado por profissionais de saúde, serviços de saúde ou autoridade sanitária") **NÃO deve ser usada como muleta** pela MOVIVO. Ela é restrita a profissionais/serviços de saúde stricto sensu; o profissional de Educação Física, no contexto de condicionamento físico via plataforma de consumo, dificilmente se enquadra com segurança. Apoiar-se nela seria frágil. **Consentimento é a base correta e suficiente** — desde que colhido corretamente.

Consequência prática do consentimento como base: ele é **revogável a qualquer tempo** (Art. 8º, §5º) e, quando revogado, dispara o dever de eliminação (Art. 18, IX c/c Art. 16), ressalvadas as hipóteses de conservação. A arquitetura precisa suportar revogação — ver 3.4.

**3.2 Consentimento granular — requisitos e [CORREÇÃO à tabela `consents` de Rafael].**
A tabela `consents` de Rafael (tipos DATA_PROCESSING, HEALTH_DATA, MARKETING, TERMS_OF_SERVICE; versão; IP; user-agent; timestamp; accepted; revoked_at) está **bem desenhada e a valido**. Refinamentos jurídicos obrigatórios:
- O consentimento para **dado de saúde** deve ser **separado, destacado e opt-in ativo** (checkbox não pré-marcado, texto específico), coletado **imediatamente antes** do bloco 2 da anamnese — como Lucas já especificou. Correto.
- Registrar também a **versão exata do texto de finalidade** apresentada (não só a versão dos termos) — pequeno ajuste: garantir que `version` referencie um artefato versionado e imutável do texto de consentimento de saúde, para prova futura.
- Consentimento de **marketing** deve ser destacável e revogável independentemente do consentimento de saúde (não podem ser "amarrados" — vedação de consentimento genérico, Art. 8º e Art. 9º).
- **Menores de idade:** o ICP é 18–30, mas o fluxo **deve exigir declaração/verificação de maioridade (18+)** e bloquear menores. Dado de saúde de criança/adolescente (Art. 14) tem regime reforçado que a MOVIVO não deve assumir no MVP. Gate de idade obrigatório.

**3.3 RIPD — Relatório de Impacto à Proteção de Dados (Art. 38).**
Tratamento de dados sensíveis de saúde, em escala, com uso de IA e transferência internacional = cenário que **demanda RIPD** (a ANPD pode exigi-lo e sinalizou priorização de fiscalização de saúde em 2025–2026). O RIPD deve cobrir: categorias de dados; finalidades; bases legais; fluxos (data mapping da seção 3.5); riscos aos titulares; medidas de segurança (criptografia, RLS, minimização); transferência internacional (LLMs) e salvaguardas; e medidas de mitigação. **Entregável desta fase**: template de RIPD (esqueleto na seção "Decisões e entregáveis"), a ser preenchido e assinado com apoio do Encarregado.

**3.4 Encarregado/DPO (Art. 41) e ROPA (Art. 37).**
- **Nomeação de Encarregado é obrigatória** e sua identidade/canal de contato deve constar na Política de Privacidade (Resolução CD/ANPD nº 18/2024 detalha o papel; o Encarregado pode ser sócio ou terceiro, PF ou PJ). No MVP, pode ser um dos sócios não-técnicos ou serviço terceirizado "DPO as a service" — **mas não pode ser omitido**. Recomendo que **não** seja o RT-CREF (para não sobrecarregar o papel crítico) nem um dev que já acumula operação.
- **ROPA (Registro das Operações de Tratamento, Art. 37):** manter documento vivo mapeando cada operação. A tabela `ai_jobs` e `audit_logs` de Rafael fornecem a base técnica; o ROPA é a camada documental de governança.

**3.5 Data Mapping do fluxo desenhado por Rafael (validação):**

| Etapa / Dado | Categoria LGPD | Base legal | Destino / Processador | Risco |
|---|---|---|---|---|
| Landing → objetivo | Pessoal comum | Consentimento / execução de contrato | PostgreSQL (VPS) | Baixo |
| Anamnese bloco 1 (nome, telefone, e-mail) | Pessoal comum | Execução de contrato (Art. 7, V) | PostgreSQL, criptografia parcial | Médio (telefone = identificador) |
| Anamnese bloco 2 (PAR-Q, lesões, medicação) | **Sensível — saúde (Art. 11)** | **Consentimento específico (Art. 11, I)** | PostgreSQL `pgcrypto` | **Alto** |
| Conversa WhatsApp (pode conter saúde) | Pessoal + eventual sensível | Consentimento + execução | AraraHQ (operador) → **LLM** | **Alto (transferência internacional)** |
| Geração de protocolo (contexto → LLM) | Estruturado, pode inferir saúde | Consentimento | **DeepSeek (China) / OpenAI / Anthropic (EUA)** | **Crítico — ver 3.6** |
| Pagamento | Pessoal + financeiro | Execução de contrato | Stripe / Asaas (operadores) | Médio |
| Analytics | Pessoal / comportamental | Legítimo interesse (Art. 10) + consentimento p/ cookies | PostHog | Médio |
| Auditoria/logs | Pessoal + metadados | Cumprimento de obrigação / legítimo interesse | `audit_logs` | Médio |

**Papéis:** MOVIVO = **controladora**. AraraHQ, Stripe, Asaas, PostHog, provedores de LLM, Hostinger = **operadores** → exigem **DPA (contrato de operador, Art. 39)** com cada um. Ver seção 8.3.

**3.6 [BLOQUEADOR 2 / DIVERGÊNCIA com ADR-005 de Rafael] — LLM e transferência internacional.**
Rafael escolheu **DeepSeek V3.2 como LLM principal**. Do ponto de vista de custo, é racional. Do ponto de vista de LGPD com dados de saúde, na configuração "API oficial DeepSeek", é **não-conforme e de alto risco**, pelos seguintes fatos verificados:
- Os dados enviados à API oficial da DeepSeek são **armazenados em servidores na China**; a China **não tem decisão de adequação** com o Brasil e **não oferece mecanismo simples de exclusão/revogação**, o que colide com Art. 18 e com os princípios da LGPD.
- Enviar conversa e contexto que contenham dados de saúde para essa infraestrutura = **transferência internacional de dado sensível** sem salvaguarda adequada.

**Regime aplicável:** transferência internacional (Arts. 33–36) + **Resolução CD/ANPD nº 19/2024**, que aprovou as **Cláusulas-Padrão Contratuais (SCCs)** e cujo período de adequação (12 meses) **já se encerrou (ago/2025)** — ou seja, hoje a transferência por cláusulas contratuais **exige** a incorporação das SCCs da ANPD ao contrato com o importador.

**Recomendações (ordem de preferência):**
1. **Não enviar dados sensíveis identificáveis a nenhum LLM.** Pseudonimizar/tokenizar no boundary: o Motor Determinístico já injeta JSON estruturado (Rafael 5.1); estender isso para que nome, telefone e identificadores diretos **nunca** transitem no prompt. Substituir por rótulos ("usuário", "lesão: ombro D"). Reduz o dado a "pseudonimizado", diminuindo (não eliminando) o risco.
2. Para o boundary que ainda toque saúde, **preferir provedores com hospedagem contratável e SCC assinada** (OpenAI/Anthropic via endpoints comerciais com DPA e, idealmente, região de dados; ou DeepSeek **self-hosted / via host ocidental**, já que os pesos são abertos — decisão técnica de Victor/Rafael, mas o requisito jurídico é: **destino com salvaguarda adequada**).
3. **DeepSeek via API oficial chinesa: vedado para qualquer payload com dado pessoal de saúde** até que exista SCC e avaliação de risco documentada. Pode, no máximo, processar conteúdo 100% anonimizado/não-identificável.
4. Registrar a decisão no RIPD e no ROPA, com as SCCs anexadas aos DPAs.

**Isto é uma correção que Victor e Rafael precisam absorver na Fase 4/5.** Sinalizo como bloqueador porque go-live enviando saúde para a China é passivo regulatório concreto.

**3.7 Validação da arquitetura técnica de proteção de Rafael (item a item):**

| Medida de Rafael | Veredito jurídico |
|---|---|
| `pgcrypto` — criptografia em repouso do bloco de saúde | **VALIDADO.** Atende Art. 46/48. Recomendo gestão de chaves fora do banco (KMS/secret manager), não hard-coded — alinhar com Sato. |
| **RLS** (Row-Level Security) em `conversations` para isolamento por usuário | **VALIDADO e elogiado.** Boa "segunda linha de defesa" para o RNF-06 (zero vazamento). Estender RLS a `protocols`, `anamnesis_sessions`, `checkins`. |
| `audit_logs` **append-only** (sem UPDATE/DELETE) | **VALIDADO.** Essencial para prova de diligência (CREF + LGPD). Garantir imutabilidade por permissão de banco + trigger (Rafael já previu). |
| **Retenção 5 anos** dos audit logs "requisito LGPD para dados de saúde" | **[CORREÇÃO] Fundamentação errada.** Não há "requisito LGPD de 5 anos para saúde". O ancoradouro correto do prazo é o **CDC art. 27 (prescrição de 5 anos** da pretensão de reparação por fato do serviço) — logo, conservar por **5 anos após o término da relação** é defensável como base de conservação para **exercício regular de direito em processo** (Art. 16, II/§ e Art. 7º, VI/Art. 11, II, "d/g" LGPD). Corrigir a justificativa no código/comentário e no ROPA. (Prontuário médico de 20 anos é regra do CFM/medicina — **não** se aplica à Educação Física; não usar 20 anos.) |
| **Direito ao esquecimento** = `DELETE FROM conversations` + `DROP partition` | **[CORREÇÃO/refino].** Eliminação total imediata conflita com a conservação defensiva acima. Modelo correto: ao pedido de eliminação (Art. 18, VI/IX), **anonimizar** os dados sensíveis e pessoais identificáveis (remover PII, manter o registro estatístico/probatório despersonalizado) e **eliminar** o que não tiver base de conservação. Rafael já acena com isso ("audit_logs mantidos sem PII após anonimização") — formalizar como política: *eliminar identificadores diretos; reter registro anonimizado + o mínimo necessário à defesa pelo prazo prescricional; documentar a resposta ao titular em até 15 dias*. |
| Expiração de anamnese incompleta em **72h** (descarte de dados parciais) | **VALIDADO e elogiado** (minimização, Art. 6º, III). Bom para saúde incompleta. |
| Assinatura eletrônica do protocolo: login + timestamp + `signature_hash` (SHA-256), sem ICP-Brasil no MVP | **VALIDADO para o MVP.** MP 2.200-2/2001 admite assinatura eletrônica não-ICP quando aceita pelas partes; o hash de integridade + trilha de auditoria dá força probatória suficiente para o requisito CREF inicial. Reavaliar ICP-Brasil/assinatura qualificada na escala. |
| VPS Hostinger | **Verificar residência dos dados.** Se a instância estiver **fora do Brasil**, já é transferência internacional (mesmo sem nuvem "comum"). Preferir região Brasil; se não, aplicar salvaguarda/SCC e registrar no RIPD. Ponto para Henrique (DevOps). |
| Telefone não logado em texto claro | **VALIDADO** (minimização/segurança). |

**Nível de risco (LGPD): CRÍTICO no ponto LLM/DeepSeek; ALTO no conjunto; reduzível a MÉDIO com as correções 3.6/3.7 + consentimento + RIPD + Encarregado.**

---

### 4. Termos de Uso e Política de Privacidade — estrutura e cláusulas

**4.1 Guardrails de linguagem (inegociáveis, herdados de Clóvis/Gabriel):**
- **NUNCA:** "a IA prescreve seu treino", "diagnóstico", "tratamento", "cura", "resultado garantido", "emagrecimento garantido".
- **SEMPRE:** "treino **elaborado/criado por Profissional de Educação Física registrado (CREF nº ___)**, com uso de inteligência artificial como ferramenta e sob sua supervisão". A IA é instrumento do profissional; a autoria é humana.

**4.2 Termos de Uso — cláusulas essenciais:**
1. Identificação da PJ (razão social, CNPJ, **registro CREF-PJ**, nome e **CREF do RT** — superando o gap do benchmark).
2. Descrição do serviço com o enquadramento da autoria (4.1).
3. **Escopo e limites explícitos:** o serviço orienta condicionamento físico; **não** substitui avaliação médica presencial, **não** faz diagnóstico, **não** prescreve medicamento/suplemento, **não** trata patologias; o AI Coach recusa e redireciona perguntas fora de escopo (nutrição clínica, dor persistente → orientação de procurar profissional/médico).
4. Requisito de maioridade (18+) e veracidade das informações do PAR-Q.
5. Condições de assinatura, trial, renovação automática, preço, e **cancelamento facilitado** (CDC + Decreto 11.034/2022 sobre SAC/cancelamento; cancelamento self-service pelo mesmo canal de contratação).
6. **Direito de arrependimento (CDC art. 49):** 7 dias para contratação fora do estabelecimento (aplicável a contratação online). Compatibilizar com o trial.
7. Propriedade intelectual da MOVIVO (marca, software, conteúdo, protocolos) e licença de uso ao usuário.
8. Limitação de responsabilidade **realista** — ver 4.4.
9. Lei aplicável e foro (foro do domicílio do consumidor é irrenunciável em relação de consumo).

**4.3 Política de Privacidade — cláusulas essenciais (Art. 9º LGPD):**
Controladora e contato do **Encarregado**; categorias de dados (com destaque para **dados sensíveis de saúde**); finalidades específicas; **bases legais por finalidade**; compartilhamento com operadores (AraraHQ, Stripe/Asaas, PostHog, provedores de LLM, hospedagem) e **transferência internacional** com as salvaguardas; **prazo de retenção** e critérios; **direitos do titular (Art. 18)** e como exercê-los; segurança adotada; política de cookies; e histórico de versões.

**4.4 [REFORÇO a Clóvis] Cláusula de responsabilidade — o que pode e o que não pode.**
Cláusula de "responsabilidade **exclusiva** do consumidor por qualquer dano à saúde" é **nula de pleno direito** (CDC art. 51, I — exoneração/atenuação de responsabilidade do fornecedor em relação de consumo). **Não usar essa redação como escudo.** O que é lícito e recomendável:
- **Termo de ciência de risco inerente** à atividade física + **triagem PAR-Q** + **recomendação de avaliação médica** = evidência de **diligência e informação adequada** (CDC art. 6º, III), que mitiga (não elimina) responsabilidade.
- Advertências de segurança contextuais ("pare se sentir dor", "não exceda a carga", "procure um médico se ___").
- A responsabilidade da MOVIVO permanece possível (responsabilidade objetiva do fornecedor, CDC art. 14) — por isso a defesa real é **diligência documentada + seguro** (ver Plano de Mitigação), não cláusula de isenção.

---

### 5. Termo de Responsabilidade / PAR-Q — validação do gate de contraindicações

**5.1 Validação jurídica do gate.** O PAR-Q (instrumento internacional de triagem) + Termo de Responsabilidade é o mecanismo correto e alinhado ao benchmark. Para o produto de **musculação** (risco maior que corrida), valido a exigência de Clóvis de uma **camada extra de gate de liberação médica**.

**5.2 [CORREÇÃO ao RF-09 de Rafael/Lucas] "Flag + revisão humana" NÃO é suficiente para respostas de risco.**
Rafael descreveu o RF-09 como "flag + revisão humana" e, no fluxo de IA, o motor "não bloqueia, apenas alerta". Lucas foi mais correto ao falar em "bloqueio condicional de geração até clearance". **Juridicamente, para respostas de risco no PAR-Q (dor torácica, problema cardíaco, tontura/desmaio, uso de medicação para pressão/coração, gestação, lesão ativa, cirurgia recente), o comportamento correto é BLOQUEAR a liberação automática do protocolo** e condicionar à **liberação médica (atestado)** ou revisão explícita do RT — não apenas sinalizar e prosseguir. A diferença entre "flag" e "bloqueio" é a diferença entre diligência real e diligência de fachada, e é exatamente o vetor de dano da musculação. **Recomendação vinculante:** o gate PAR-Q deve ter estados `LIBERADO` / `BLOQUEADO_AGUARDANDO_CLEARANCE` / `LIBERADO_COM_RESSALVA_RT`, e nenhum protocolo é enviado enquanto `BLOQUEADO`.

**5.3 Conteúdo do Termo de Responsabilidade:** declaração de veracidade das respostas do PAR-Q; ciência de que a atividade física tem riscos inerentes; ciência de que deve interromper e procurar atendimento em caso de sintomas; ciência de que o serviço não substitui avaliação médica; consentimento para o RT acessar seus dados de saúde para supervisão. **Não** incluir renúncia de direitos do consumidor (nula).

---

### 6. Registro de marca "MOVIVO" no INPI e risco VIVO (alto renome)

**6.1 Fato confirmado na pesquisa:** **VIVO (Telefônica Brasil) é marca reconhecida como de ALTO RENOME** pelo INPI (consta das listas de marcas de alto renome em vigência; o próprio INPI publicou nova lista em dez/2024). O alto renome (LPI art. 125; Resolução INPI 107/2013; atualmente também Portaria INPI nº 8/2022) confere **proteção em TODOS os ramos de atividade** — exceção ao princípio da especialidade. Ou seja, o argumento "somos fitness, VIVO é telecom, classes diferentes" **não neutraliza o risco**, porque alto renome protege **através das classes**.

**6.2 Avaliação de risco de colisão MOVIVO × VIVO:**
- A favor da MOVIVO: "MOVIVO" é palavra distinta (portmanteau movimento+vivo), 3 sílabas, com significado próprio; não reproduz o sinal "VIVO" isoladamente nem o trade dress da Telefônica; setores e público distintos.
- Contra: contém a sequência "-VIVO" ao final, foneticamente destacada; alto renome dá à Telefônica base para **oposição** ou **nulidade** alegando aproveitamento parasitário/diluição, mesmo em ramo distinto. O risco não é de indeferimento automático, mas de **oposição/litígio** — que, mesmo se vencido pela MOVIVO, custa tempo e dinheiro.

**Nível de risco (marca): MÉDIO-ALTO.** Não é proibitivo, mas é real e **precisa de busca de anterioridade formal no INPI + parecer de advogado de PI ANTES** de: (a) registrar a marca, (b) investir pesado em identidade visual (Kimura já condicionou seu trabalho a isso) e material do Cahuã.

**6.3 Recomendações:**
1. **Busca de anterioridade oficial no INPI** (nas classes NCL relevantes — 41 educação/treinamento físico, 44 saúde/bem-estar, 42/9 software/apps) + análise da lista de alto renome. Não pude acessar a base do INPI por scraping (mesma limitação de Caio) — **é ato de advogado de PI**.
2. **Parecer de PI específico sobre MOVIVO × VIVO** com recomendação go/no-go.
3. **Manter TRENOVA pronto como plano B** (Caio já preparou; sem colisão com alto renome brasileiro) e pedir a Kimura estrutura visual que sirva a ambos — o que Caio já orientou.
4. Registrar a marca em **nome da PJ** (não de sócio PF), nas classes 41/44 e, se orçamento permitir, 9/42.
5. Distanciamento estratégico de trade dress: paleta/estilo que **não** remeta ao roxo-VIVO (Kimura já sinalizou evitar azul/roxo de telecom — reforço isso como mitigação jurídica).

---

### 7. Conformidade com legislação de IA (AI Act / PL 2338/2023)

**7.1 Status.** O **PL 2338/2023** (Marco Legal da IA) foi **aprovado no Senado em 10/12/2024** e tramita na **Câmara dos Deputados** para votação final (2026). Adota o modelo europeu (AI Act): classifica sistemas por risco (excessivo/alto/baixo), cria direitos (transparência, explicação, contestação), governança (SIA) e sanções de até **R$ 50 milhões** por infração. **Ainda não é lei vigente** — mas é iminente e a MOVIVO deve nascer "compliance-ready".

**7.2 Enquadramento provável da MOVIVO.** Um sistema de IA que interage com **dados de saúde** e influencia decisões sobre o corpo tende a ser classificado como **ALTO RISCO** (o PL prevê salvaguardas específicas para IA em saúde). Isso implicaria, quando em vigor: avaliação de impacto algorítmico, transparência, supervisão humana significativa (**human-in-the-loop**), documentação e explicabilidade.

**7.3 Boa notícia arquitetural.** A arquitetura **híbrida (Motor Determinístico + LLM + validação pós-geração + supervisão do RT)** de Rafael/Victor **já materializa** os principais requisitos de IA de alto risco: human-in-the-loop (RT assina), auditabilidade (`ai_jobs`, `audit_logs`), determinismo/explicabilidade (o motor, não o LLM, decide), e guardrails (validação de compliance). **Elogio esta escolha** — ela reduz não só o risco CREF/LGPD como já antecipa o AI Act brasileiro.

**7.4 Recomendações:** (a) manter registro das decisões de IA (já previsto); (b) transparência ao usuário de que interage com IA supervisionada por profissional (constar no ToS e no onboarding do WhatsApp); (c) direito de contestação/human review acessível (usuário pode pedir para falar com o profissional — Lucas já pediu handoff humano); (d) acompanhar a tramitação e revisitar este ponto quando a lei for sancionada.

**Nível de risco (IA): MÉDIO (lei ainda não vigente; arquitetura já favorável).**

---

### 8. Contratos essenciais para o MVP

**8.1 Contrato com o profissional CREF (Responsável Técnico).**
Estrutura de **dois papéis separados** (recomendado):
- **Como sócio:** regido pelo Acordo de Sócios (equity, vesting).
- **Como RT / prestador de responsabilidade técnica:** contrato específico definindo: escopo da responsabilidade técnica (Res. 477/2023); obrigação de definir e revisar a metodologia; obrigação de assinar/revisar protocolos e amostras; remuneração pela função de RT; exclusividade da função de RT para a MOVIVO (um RT, um vínculo principal); cláusula de **substituto qualificado em 24h**; propriedade intelectual da metodologia (pertence à PJ); confidencialidade; e regras de saída que **não deixem a PJ sem RT** (a saída do RT sem substituto suspende a operação — deve estar previsto).
- **Atenção trabalhista:** desenhar para **não** configurar vínculo empregatício disfarçado se ele for sócio+prestador (sem subordinação típica de CLT; autonomia técnica). Ponto para alinhar com Eduardo (folha/tributação).

**8.2 Contrato de influenciador/endosso com Cahuã.**
- **Licença de uso de imagem, nome e voz** para a marca (escopo, prazo, territórios, mídias) — separada do equity.
- Obrigações de conteúdo/divulgação e **compliance publicitário**: identificação de publicidade (**#publi/#ADS** — Guia de Publicidade do CONAR/regras de influenciadores), **vedação a promessas de resultado**, vedação a alegações de saúde/cura, uso da linguagem-guardrail (4.1). Helena deve receber isso.
- Cláusula de **conduta e reputação** (moral clause): comportamento do rosto da marca afeta a PJ — prever suspensão/rescisão e efeitos sobre imagem/vesting.
- **Titularidade do conteúdo** produzido para a marca (pertence à PJ) e do handle/perfil se criado para a marca.
- Não-concorrência limitada (não endossar concorrente direto durante o vínculo).

**8.3 DPA (Data Processing Agreement / Contrato de Operador — Art. 39 LGPD) com cada fornecedor.**
Necessário com: **AraraHQ** (WhatsApp BSP — processa telefone e conteúdo), **Stripe** e **Asaas** (pagamento), **PostHog** (analytics), **provedores de LLM** (DeepSeek/OpenAI/Anthropic), **Hostinger** (hospedagem). Cada DPA deve conter: objeto e finalidade do tratamento; deveres do operador (tratar só sob instrução, segurança Art. 46, sigilo, sub-operadores, auxílio nos direitos dos titulares e em incidentes Art. 48); e, para operadores no exterior, as **Cláusulas-Padrão Contratuais da ANPD (Res. 19/2024)** incorporadas. Priorizar: rever/aceitar os DPAs padrão de Stripe, OpenAI, Anthropic (existem e são robustos); exigir/avaliar o de AraraHQ; e resolver o DeepSeek conforme 3.6.

**8.4 Outros contratos/documentos:** Termos de Uso e Política de Privacidade (seção 4); Termo de Responsabilidade/PAR-Q (seção 5); NDA para prestadores externos; e, na contratação de terceiros (designers, etc.), cláusula de **cessão de direitos autorais/IP** para a PJ.

---

## Decisões e entregáveis

**Documentos jurídicos a produzir nesta fundação (checklist mestre):**

1. **[BLOQUEADOR] Contrato Social da LTDA** — objeto híbrido (EF atividade-fim + tecnologia meio).
2. **[BLOQUEADOR] Acordo de Sócios** — vesting (cliff 12m / 48m), tag/drag, IP para a PJ, deadlock, saída, cláusula de continuidade do RT.
3. **[BLOQUEADOR] Registro CREF-PJ** + Termo de Compromisso de RT (Res. 477/2023).
4. **[BLOQUEADOR] Consentimento de saúde** (texto destacado, versionado) + gate de idade 18+.
5. **[BLOQUEADOR] Gate PAR-Q com BLOQUEIO real** (não só flag) para respostas de risco.
6. **[BLOQUEADOR] Termos de Uso + Política de Privacidade + Termo de Responsabilidade** com guardrails de linguagem.
7. **[BLOQUEADOR] Solução do boundary LLM** (pseudonimização + destino com salvaguarda; DeepSeek-China vedado para saúde).
8. **[BLOQUEADOR] Busca INPI + parecer de PI MOVIVO × VIVO**; TRENOVA como plano B.
9. **RIPD** (template preenchido com apoio do Encarregado).
10. **Nomeação de Encarregado/DPO** + publicação do canal de contato + **ROPA** iniciado.
11. **DPAs** com todos os operadores, com SCCs da ANPD para os do exterior.
12. **Contrato de RT** (profissional) + **Contrato de imagem/endosso** (Cahuã).
13. **Fluxo operacional de direitos do titular** (Art. 18) — atendimento em 15 dias, com política de eliminação/anonimização (seção 3.7).
14. **Plano de resposta a incidentes** (Art. 48) — comunicação à ANPD e titulares.
15. **Apólice de seguro** de responsabilidade civil (recomendado — ver mitigação).

**Correções que Rafael/Victor/Sato/Henrique devem absorver:** DeepSeek-China fora do boundary de saúde (Victor/Rafael); gate PAR-Q como bloqueio (Leonardo); fundamentação de retenção = CDC art. 27, não "LGPD 5 anos" (Rafael/Leonardo); direito ao esquecimento = anonimização + retenção defensiva mínima (Leonardo/Sato); RLS estendido a todas as tabelas com PII (Leonardo/Sato); residência de dados da VPS (Henrique); gestão de chaves de criptografia fora do banco (Sato); DPA/SCC nos fornecedores (todos).

---

## Riscos identificados (consolidado) e Nível de Risco

| # | Risco | Prob. | Impacto | Nível | Mitigação-chave |
|---|---|---|---|---|---|
| 1 | Operar sem PJ/CREF-PJ (exercício irregular) | Média | Muito alto | **Crítico** | Bloqueador 1 — registrar antes do go-live |
| 2 | Dado de saúde → DeepSeek/China sem salvaguarda | Alta se mantido | Muito alto | **Crítico** | Bloqueador 2 — pseudonimizar + destino adequado |
| 3 | Consentimento de saúde inválido / gate PAR-Q fraco | Média | Alto | **Alto** | Bloqueadores 3 e 5 |
| 4 | Colisão de marca com VIVO (alto renome) | Média | Alto | **Médio-Alto** | Bloqueador 8 — busca INPI + plano B TRENOVA |
| 5 | Responsabilização civil por dano físico (CDC art. 14) | Média | Alto | **Alto** | Diligência documentada + seguro + gate médico |
| 6 | Litígio societário / perda de IP (sem Acordo) | Média | Alto | **Alto** | Acordo de Sócios + vesting + IP para a PJ |
| 7 | Dependência do RT (ponto único) | Média | Alto | **Médio** | Substituto 24h + plano de RTs adicionais |
| 8 | Ausência de Encarregado/RIPD em fiscalização ANPD | Média | Médio-Alto | **Médio** | Nomear DPO + RIPD + ROPA |
| 9 | AI Act (alto risco) quando vigente | Baixa (hoje) | Médio | **Médio** | Arquitetura híbrida já favorável |
| 10 | Publicidade do Cahuã com promessa de resultado | Média | Médio | **Médio** | Contrato + guardrails + treino de compliance |

---

## Plano de mitigação (sequenciado)

**Onda 0 — antes de qualquer usuário real (bloqueadores):** constituir LTDA + Acordo/vesting → registrar CREF-PJ → contratar advogado de PI (busca INPI) → publicar ToS/PP/Termo + consentimento → implementar gate PAR-Q com bloqueio → resolver boundary LLM. Em paralelo: nomear Encarregado.
**Onda 1 — antes de escalar além do piloto:** RIPD assinado; DPAs+SCCs fechados; parecer de direito desportivo sobre "estabelecimento digital"; plano de resposta a incidentes; fluxo de direitos do titular operante; contrato de RT e de imagem assinados.
**Onda 2 — na tração:** seguro de RC; RTs adicionais; revisão à luz do AI Act sancionado; eventual migração a assinatura ICP-Brasil; auditoria LGPD externa.

---

## Impacto para o produto

- **Formulário de anamnese:** consentimento de saúde destacado antes do bloco 2 (Lucas já previu — validado); gate 18+; gate PAR-Q **bloqueante** para respostas de risco (correção ao RF-09).
- **AI Coach:** guardrails de linguagem no prompt e na validação pós-geração (Rafael já tem — reforçar termos proibidos: "prescrevo", "diagnóstico", "cura", "garantido"); handoff humano para dúvidas de saúde; **pseudonimização antes do LLM**.
- **Onboarding WhatsApp:** aviso de que é IA supervisionada por profissional CREF (transparência AI Act).
- **Assinatura:** cancelamento self-service + arrependimento 7 dias (CDC art. 49) — impacta o fluxo de conversão de Lucas.

## Impacto para investidores

- **Positivo:** LTDA + Acordo de Sócios + vesting + IP consolidado na PJ + marca registrada + LGPD estruturada + CREF-PJ = **due diligence limpa**, condição para qualquer rodada (mútuo conversível/SAFE-BR). A ausência desses itens é o principal "red flag" que trava term sheets.
- **Atenção:** divisão de equity mal feita (ex.: 20% iguais sem vesting) e IP em nome de PF são os dois erros que mais destroem valuation. Resolver agora, barato; depois, caro ou impossível.

## Impacto para escalabilidade

- **Facilita escala:** arquitetura híbrida auditável + RLS + audit log = base para crescer sem multiplicar risco por usuário.
- **Limita escala até resolver:** a questão "RT por estabelecimento digital" e o boundary LLM são os dois tetos jurídicos — ambos endereçáveis, mas exigem decisão antes de nacionalizar. Plano de RTs adicionais e destino de dados adequado destravam.

## Checklist de Compliance (rápido)

- [ ] LTDA constituída, objeto compatível com CREF-PJ
- [ ] Acordo de Sócios + vesting (cliff 12m/48m) + IP → PJ
- [ ] CREF-PJ registrado + RT nomeado + Termo de Compromisso
- [ ] Consentimento de saúde destacado e versionado; gate 18+
- [ ] Gate PAR-Q **bloqueante** para respostas de risco
- [ ] ToS + Política de Privacidade + Termo de Responsabilidade publicados
- [ ] Encarregado/DPO nomeado e divulgado; ROPA iniciado; RIPD elaborado
- [ ] Boundary LLM sem dado de saúde identificável na China; SCCs nos DPAs
- [ ] DPAs com AraraHQ, Stripe, Asaas, PostHog, LLMs, Hostinger
- [ ] Residência de dados da VPS verificada
- [ ] Busca INPI + parecer PI (MOVIVO × VIVO); TRENOVA em standby
- [ ] Contrato de RT + Contrato de imagem/endosso (Cahuã) assinados
- [ ] Fluxo de direitos do titular (15 dias) + plano de incidentes (Art. 48)

## Próximos passos

1. **Usuário/fundadores:** contratar advogado societário + advogado de PI (dois atos que exigem OAB) e um "DPO as a service" ou nomear Encarregado interno.
2. **Eduardo (CFO, Fase 2 paralela):** alinhar enquadramento tributário ao objeto social CREF-compatível; custo do RT (sócio+prestador) na folha; provisionar custo de registros (INPI, CREF-PJ, cartório) e seguro.
3. **Fase 3+ (já rodada — reprocessar pontos):** Lucas ajustar RF-09 (gate bloqueante) e fluxo de arrependimento; Rafael/Victor absorver correção do boundary LLM e da retenção; Sato herdar RLS estendido, gestão de chaves e plano de incidentes; Henrique verificar residência da VPS.
4. **Kimura/Helena:** aguardar go/no-go da marca antes de finalizar identidade; Helena internalizar guardrails de publicidade do Cahuã.

---

## Recomendações para o próximo agente

Como entrei fora de ordem, minhas recomendações vão **retroativamente** a Lucas/Rafael/Victor/Sato e **adiante** a Eduardo:
- **Eduardo (par de Fase 2):** o objeto social precisa habilitar CREF-PJ; considerar custo de RT, registros e seguro de RC no modelo financeiro; o boundary LLM adequado (não a API DeepSeek-China) pode alterar levemente o custo de IA que você e Rafael modelaram — reavaliar.
- **Lucas/Rafael/Victor/Sato/Henrique:** absorver as 8 correções listadas em "Decisões e entregáveis". As duas mais urgentes e inegociáveis: **gate PAR-Q bloqueante** e **nenhum dado de saúde identificável para LLM em servidor sem salvaguarda (DeepSeek-China vedado)**.

---

## Fontes Consultadas

- INPI — Manual de Marcas, item 9.06 Alto Renome: https://manualdemarcas.inpi.gov.br/projects/manual/wiki/9%C2%B706_Alto_renome
- INPI — Lista de marcas de alto renome em vigência (guia básico): https://www.gov.br/inpi/pt-br/servicos/marcas/arquivos/guia-basico/inpi_marcas_marcasdealtorenomeemvigncia_2024_07_09.pdf
- Migalhas — Resolução INPI 107/13 (alto renome, art. 125 LPI): https://www.migalhas.com.br/depeso/185217/a-resolucao-107-13-do-inpi---novas-regras-para-o-reconhecimento-e-registro-de-marcas-de-alto-renome
- IWMelcheds — INPI divulga nova lista de marcas de alto renome (inclui VIVO), dez/2024: https://iwmelcheds.com.br/publicacoes/marcas-de-alto-renome-inpi-divulga-nova-lista/
- Consolide — Marcas de alto renome INPI: https://www.consolidesuamarca.com.br/blog/marcas-alto-renome-INPI
- Resolução CONFEF nº 477/2023 (registro de PJ e RT) — LegisWeb: https://www.legisweb.com.br/legislacao/?id=487286
- CONFEF — Resolução 477/2023 (PDF oficial): https://www.confef.org.br/confef/resolucoes/res-pdf/561.pdf
- Resolução CONFEF nº 607/2025 (posterior — verificar alterações): https://www.legisweb.com.br/legislacao/?id=487268
- CREF4/SP — Registro de Pessoa Jurídica: https://www.crefsp.gov.br/registro/pessoa-juridica
- CREF2/RS — Responsável Técnico: https://www.crefrs.org.br/registro/responsavel-tecnico/
- Senado — PL 2338/2023 (Marco Legal da IA), tramitação: https://www25.senado.leg.br/web/atividade/materias/-/materia/157233
- Exame — Marco Legal da IA (PL 2338): o que muda para empresas: https://exame.com/inteligencia-artificial/marco-legal-da-inteligencia-artificial-pl-2338-o-que-muda-para-empresas-com-a-nova-lei/
- Juridico.ai — PL 2338/2023 regulamentação da IA no Brasil: https://juridico.ai/direito-digital/pl-2338-2023-regulamentacao-ia-brasil/
- ANPD — Regulamento de Transferência Internacional de Dados (notícia oficial): https://www.gov.br/anpd/pt-br/assuntos/noticias/resolucao-normatiza-transferencia-internacional-de-dados
- Mayer Brown — Fim do período de graça da Res. CD/ANPD 19/2024 (SCCs), ago/2025: https://www.mayerbrown.com/pt/insights/publications/2025/08/end-of-grace-period-implementation-of-brazils-standard-contractual-clauses-in-international-transfers-of-personal-data
- IRIB — Resolução CD/ANPD nº 19/2024: https://www.irib.org.br/resolucao-cd-anpd-n-19-de-23-de-agosto-de-2024/
- Machado Meyer — "O DeepSeek está em conformidade com a LGPD?": https://www.machadomeyer.com.br/pt/inteligencia-juridica/publicacoes-ij/direito-digital/o-deepseek-esta-em-conformidade-com-a-lgpd
- Migalhas — Especialistas avaliam impacto da DeepSeek na segurança de dados: https://www.migalhas.com.br/quentes/424203/especialistas-avaliam-impacto-da-deepseek-na-seguranca-de-dados
- Garnier Advocacia — Prazo de guarda de dados pessoais e sensíveis: https://garnierlaw.com.br/prazo-de-guarda-dos-dados-pessoais-e-sensiveis/
- ANPD — FAQ 5.5 "Por quanto tempo os dados podem ser tratados": https://www.gov.br/anpd/pt-br/acesso-a-informacao/perguntas-frequentes/perguntas-frequentes/5-adequacao-a-lgpd/5-5-por-quanto-tempo
- Migalhas — Tratamento de dados em saúde: bases legais, limites e boas práticas: https://www.migalhas.com.br/depeso/449916/tratamento-de-dados-em-saude-bases-legais-limites-e-boas-praticas

> **Limitações de pesquisa declaradas:** (1) A base de marcas do **INPI** não foi consultada diretamente (exige sessão/captcha) — a análise MOVIVO × VIVO é preliminar e **não substitui a busca oficial de anterioridade** por advogado de PI. (2) O status do registro **CREF-PJ** da Zyla (benchmark) e o limite exato de estabelecimentos por RT sob a Res. 477/2023 vs. a nova Res. 607/2025 devem ser **confirmados formalmente** com o CREF regional. (3) O **PL 2338/2023 ainda não é lei vigente** — as obrigações de IA de alto risco são prospectivas. (4) Textos legais citados (LGPD, CDC, LPI, Lei 9.696/98, MP 2.200-2/2001) refletem a legislação vigente conforme conhecida; a redação final de cláusulas contratuais e o RIPD exigem **revisão de advogado com OAB**. Nada aqui constitui parecer jurídico formal.
