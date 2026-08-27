# Relatório — Dr. Alexandre (CLO / Head Jurídico Corporativo)

> **Nota de vigência (2026-08-27):** conclusões categóricas deste relatório sobre um provedor
> específico foram substituídas pela **ADR-005-R2**. A diligência LGPD permanece obrigatória e
> simétrica para DeepSeek, OpenAI e Anthropic; a aprovação é por conta/endpoint e não por marca.

**Data:** 2026-08-07 (versão consolidada — substitui a versão de 2026-07-22)
**Ideia analisada:** MOVIVO — AI Coach de treino individualizado via WhatsApp, com supervisão de profissional de Educação Física (CREF). Modelo B2C, assinatura por período (Mensal R$39 / Trimestral R$99 / Anual R$349), trial de 7 dias sem cartão.
**Pasta do projeto:** `docs/fitness-ia-whatsapp/`
**Status do pipeline:** Fase 2 (Fundação Legal e Financeira) — concluída. Pipeline já avançou até Fase 5 (Desenvolvimento). Este documento é a **versão definitiva e operacional** do trabalho jurídico: consolida a análise de risco original (Parte II) com o **guia executivo passo a passo de abertura e regularização da empresa** (Parte I), pedido pelos fundadores.

> **Aviso obrigatório (honestidade jurídica):** este relatório é insumo estratégico de um CLO interno, **não substitui parecer formal** de advogado externo com OAB nem de contador registrado no CRC para os atos que exigem responsabilidade técnica (constituição societária, acordo de sócios, registro CREF-PJ, registro de marca no INPI, RIPD assinado). Valores de taxas e honorários são **estimativas de mercado em ago/2026** e variam por estado, município e prestador — sempre pedir orçamento. Nenhuma estrutura elimina 100% do risco, especialmente em relação de consumo envolvendo saúde física. A meta é **máxima diligência e defensibilidade**, não imunidade.

---

## Resumo executivo

A MOVIVO é **juridicamente viável**, mas nasce sobre terreno de risco elevado (dados sensíveis de saúde + fronteira do exercício ilegal da profissão + relação de consumo sobre o corpo humano). A arquitetura jurídica precisa ser construída **antes** do go-live comercial, não depois.

Em números, o caminho completo do zero até "podemos cobrar e divulgar sem problema burocrático" custa entre **R$ 6.500 e R$ 14.000 de setup único** e **R$ 700 a R$ 1.600/mês de custo recorrente** (contador, DPO, certificado, taxas). Prazo realista: **60 a 90 dias corridos**, sendo que o CNPJ em si sai em 5–15 dias úteis; o que alonga o cronograma são o Acordo de Sócios, o registro CREF-PJ e o INPI (este último leva 12–24 meses até a decisão final, mas **a proteção retroage à data do depósito** — por isso ele deve ser depositado cedo, não concluído cedo).

**A boa notícia estratégica:** vocês **podem validar o produto antes do CNPJ existir**, desde que em beta fechado, gratuito, com no máximo ~30 usuários por convite, sem cobrar um centavo, com Termo de Participação em Teste assinado e PAR-Q bloqueante. Isso permite rodar a abertura da empresa em paralelo com o desenvolvimento, sem parar o time. Os gatilhos que obrigam a migrar para operação formal estão na Fase 0.5 (Parte I).

**5 BLOQUEADORES DE GO-LIVE COMERCIAL (nenhum usuário pagante antes de resolvê-los):**

1. **Constituição da LTDA + registro CREF-PJ com RT nomeado.** Cobrar antes disso é exercício irregular da profissão e expõe os sócios pessoalmente (o patrimônio pessoal de vocês responde).
2. **Boundary de LLM sem dado de saúde identificável em destino sem salvaguarda.** ✅ **JÁ RESOLVIDO** — o DeepSeek foi removido do projeto (ADR-005-R) e substituído por GPT-4.1 + Claude Sonnet 4.5 com Zero Data Retention + DPA/SCC. Este bloqueador, que era Crítico na versão anterior, está endereçado; falta apenas assinar formalmente os DPAs antes do go-live.
3. **Consentimento específico e destacado para dado de saúde (Art. 11, I, LGPD) + gate PAR-Q com bloqueio real** (não apenas "flag para revisão").
4. **Termos de Uso + Política de Privacidade + Termo de Responsabilidade** publicados e aceitos com trilha de auditoria, com o enquadramento "criado por profissional de Educação Física com uso de IA" — nunca "a IA prescreve".
5. **Depósito da marca no INPI** com decisão consciente sobre o risco MOVIVO × VIVO (alto renome). Ver Fase 4.

**Ponto novo e importante desta versão:** um dos fundadores (Rodrigo) é atualmente CLT em outra empresa. Isso **não impede** que ele seja sócio da MOVIVO, mas cria três riscos concretos (exclusividade, cessão de invenção ao empregador atual, concorrência desleal) que precisam ser checados no contrato de trabalho dele **antes** de ele assinar o contrato social. Ver Fase 0.2 — tratado em detalhe.

---

## Contexto recebido

Do pipeline (Clóvis → Gabriel → Caio → Kimura → Helena, e retroativamente Lucas, Rafael, Sato, Victor, Eduardo):

- **Clóvis (gatekeeper):** VALIDADO COM RESSALVAS. Definiu os cinco pilares do modelo jurídico (PJ registrada no CREF + RT nomeado; autoria contratual atribuída ao humano; PAR-Q + termo; gate de liberação médica; LGPD reforçada). Alertou que o CDC art. 51, I torna nula a cláusula de "responsabilidade exclusiva do consumidor".
- **Caio (naming):** recomendou MOVIVO com alerta explícito sobre proximidade com VIVO (alto renome). TRENOVA como hedge. Domínio `movivo.com.br` livre.
- **Eduardo (CFO):** Simples Nacional Anexo III via Fator R ≥ 28%; necessidade de capital de R$20–30 mil incluindo setup jurídico; plano único por período.
- **Lucas / Rafael / Sato / Victor:** absorveram as correções da versão anterior deste relatório (gate PAR-Q bloqueante, retenção fundamentada no CDC art. 27, troca do LLM).
- **Decisão dos fundadores registrada em memória:** split societário de 20% para cada um dos 5 sócios. **Mantenho a ressalva**: sem cláusula de desempate e sem vesting, esse é o arranjo que mais mata startup. Ver Fase 0.3.

Fundadores: Rodrigo, Pedro, Joaquim (devs), Cahuã (marca/marketing, rosto público) e o treinador do Cahuã (CREF, será o Responsável Técnico). **Todos leigos em direito societário** — daí o formato didático desta versão.

---

# PARTE I — GUIA EXECUTIVO: DO ZERO ATÉ PODER OPERAR

> Leia esta parte em ordem. Cada fase depende da anterior. Não pule.

## Glossário mínimo (leia antes de tudo)

| Termo | Em português simples |
|---|---|
| **PJ / Pessoa Jurídica** | A empresa como "pessoa" separada de vocês. Ela tem CNPJ, contrata, é dona de coisas e responde por dívidas. Sem PJ, quem responde são vocês, com o patrimônio pessoal. |
| **LTDA (Sociedade Limitada)** | O tipo de empresa mais comum e barato para startups. "Limitada" = a responsabilidade dos sócios é limitada ao capital social (com exceções). |
| **Contrato Social** | A "certidão de nascimento" da empresa. Diz o nome, o endereço, o que ela faz, quem são os sócios, quanto cada um tem e quem administra. É público. **O contador faz.** |
| **Acordo de Sócios** | Documento **privado** (não vai à Junta) que regula a convivência entre vocês: vesting, o que acontece se alguém sair, quem desempata briga, quem é dono do código. **Precisa de advogado.** É diferente do Contrato Social e muito mais importante para o dia a dia. |
| **Junta Comercial** | O "cartório das empresas" de cada estado. É onde o Contrato Social é registrado e onde a empresa passa a existir. Registrar em um estado **não limita** vocês a atender só naquele estado — o atendimento é nacional. |
| **CNAE** | Código que diz "que tipo de atividade a empresa exerce". Define impostos e se o CREF aceita registrar a empresa. Escolher errado quebra tudo lá na frente. |
| **Simples Nacional** | Regime tributário simplificado: um boleto só (DAS) por mês juntando vários impostos. A **adesão é gratuita**, mas a alíquota mensal sobre o faturamento continua existindo. |
| **Fator R** | Conta que compara folha de pagamento ÷ faturamento. Se der ≥ 28%, a empresa cai no **Anexo III (começa em 6%)** em vez do **Anexo V (começa em 15,5%)**. Ou seja: pagar pró-labore aos sócios pode reduzir o imposto total. Estratégia de Eduardo — seguir. |
| **Certificado Digital e-CNPJ** | Uma "identidade digital" da empresa (arquivo A1 ou cartão/token A3). Sem ele vocês não emitem nota fiscal, não assinam documentos oficiais, não acessam a Receita. Vence e precisa ser renovado. |
| **PI / Propriedade Intelectual** | Tudo que é criado e tem valor mas não se pega: o **código-fonte**, a **marca MOVIVO**, o **logotipo**, os **textos**, a **metodologia de treino**, os **prompts de IA**. Se não estiver formalmente da empresa, está da pessoa que criou — e isso destrói valuation e trava investidor. |
| **RT (Responsável Técnico)** | O profissional CREF que responde tecnicamente pelos serviços de Educação Física da empresa perante o conselho. Sem ele a empresa não pode prestar esse serviço. |
| **LGPD** | Lei de Proteção de Dados. Dado de saúde é "dado sensível" e tem regra mais dura. |
| **DPA** | Contrato com fornecedor que trata dados por vocês (WhatsApp/AraraHQ, Stripe, OpenAI...). Obrigatório pela LGPD. |
| **Encarregado / DPO** | A pessoa (ou empresa terceirizada) que é o canal oficial entre vocês, os usuários e a ANPD para assuntos de dados. Obrigatório nomear. |

---

## FASE 0 — DECISÕES ENTRE VOCÊS (antes de qualquer papel)

**Custo: R$ 0 · Prazo: 1 a 2 semanas · Quem faz: os 5 sócios, sozinhos**

Nada aqui envolve órgão público. São decisões que, se não forem tomadas agora, viram briga em 18 meses. **Escrevam tudo num documento compartilhado** — ele vira insumo direto para o contador e para o advogado.

### 0.1 — Nome empresarial e nome fantasia

- **Razão social:** o nome formal na Receita (ex.: "MOVIVO TECNOLOGIA E SERVIÇOS DE EDUCAÇÃO FÍSICA LTDA").
- **Nome fantasia:** o nome comercial ("MOVIVO").
- Atenção: aprovar o nome na Junta Comercial **não é** registrar a marca. São coisas diferentes e independentes. O INPI é a Fase 4.

**Passo a passo:**
1. Definam 3 opções de razão social em ordem de preferência.
2. Façam uma consulta prévia gratuita de viabilidade de nome no portal da Junta Comercial do estado (o contador faz isso na Fase 1, mas vocês podem pré-checar).
3. Guardem TRENOVA como reserva, conforme Fase 4.

### 0.2 — ⚠️ Situação do Rodrigo: sócio de LTDA sendo CLT em outra empresa

**Este é um ponto que precisa ser resolvido antes de o contrato social ser assinado.** Tratamento genérico, porque não sabemos qual é o empregador atual.

**A regra geral é boa notícia:** ser **sócio quotista** de uma LTDA **não** cria vínculo empregatício com a MOVIVO, **não** é "segunda carteira assinada" e **não** é proibido pela CLT. A CLT não veda que um empregado tenha empresa própria. Sócio recebe **distribuição de lucros** ou **pró-labore**, não salário. São duas relações jurídicas distintas e podem coexistir.

**Mas existem três riscos concretos, e todos moram no contrato de trabalho atual do Rodrigo:**

**Risco 1 — Cláusula de exclusividade / dedicação exclusiva.**
Alguns contratos (especialmente de tecnologia, de empresas maiores, ou cargos de confiança) trazem cláusula de dedicação exclusiva ou obrigação de comunicar atividades paralelas. Se existir e for descumprida, o empregador pode alegar quebra contratual — no limite, **justa causa**.
→ *O que fazer:* Rodrigo deve procurar no contrato e nos anexos as palavras "exclusividade", "dedicação exclusiva", "atividade paralela", "outra atividade", "conflito de interesses".

**Risco 2 — Cláusula de cessão de invenção / titularidade de PI ao empregador (o risco mais grave).**
É comum contratos de trabalho em tecnologia preverem que **tudo o que o empregado criar durante a vigência do contrato pertence ao empregador** — às vezes com redação ampla que não se limita ao horário nem ao equipamento da empresa. A Lei 9.279/96 (LPI, arts. 88 a 93) e a Lei 9.609/98 (Lei do Software, art. 4º) tratam disso: em regra, invenção/programa desenvolvido **em decorrência do contrato de trabalho** pertence ao empregador; o que é feito **fora**, sem uso de recursos, meios, dados ou instalações do empregador, é do empregado. O problema é que essa fronteira é fática e discutível — e um contrato mal redigido pode ampliar a favor do empregador.

Consequência prática se isso não for tratado: um terceiro (o empregador atual do Rodrigo) pode, no futuro, alegar titularidade sobre parte do código da MOVIVO. Isso é **matador em due diligence de investidor** — trava rodada.

→ *O que fazer:*
1. Rodrigo lê o contrato procurando "propriedade intelectual", "invenção", "criação", "obra", "software", "cessão de direitos", "titularidade".
2. **Regra de higiene operacional, obrigatória desde já, independentemente do que o contrato diga:** Rodrigo **nunca** usa equipamento, e-mail, conta de nuvem, rede, ferramentas licenciadas ou horário do empregador para trabalhar na MOVIVO. Máquina própria, conta pessoal, fora do expediente. Commits do Git com timestamp fora do horário de trabalho são, inclusive, prova útil.
3. Se a cláusula for ampla e ambígua: buscar, com advogado trabalhista, ou (a) uma **carta de anuência/no-conflict letter** do empregador reconhecendo que o projeto pessoal não é dele, ou (b) parecer específico avaliando o risco residual.

**Risco 3 — Concorrência desleal / não-concorrência.**
Se o empregador atual atuar no mesmo setor (fitness, saúde digital, wellness, IA para saúde), o risco sobe muito: pode configurar concorrência desleal (LPI art. 195) ou violar cláusula de não-concorrência. Se atuar em setor totalmente distinto, o risco cai bastante.
→ *O que fazer:* Rodrigo avalia a sobreposição de mercado e procura "não concorrência", "não competição", "non-compete", "quarentena".

**Diferença entre "ser sócio" e "ter uma segunda CLT" (resumo direto):**

| | Sócio de LTDA (MOVIVO) | Segunda CLT |
|---|---|---|
| Cria vínculo empregatício? | Não | Sim |
| Aparece na carteira? | Não | Sim |
| Aparece em consulta pública? | Sim — quadro societário do CNPJ é público | Sim |
| Conflita com o emprego atual? | Só se o contrato tiver cláusula de exclusividade/PI/não-concorrência | Muito mais frequentemente |
| Remuneração | Pró-labore e/ou distribuição de lucros | Salário |

**Nota importante:** o quadro societário do CNPJ é **informação pública** e consultável. O empregador atual pode descobrir. Isso não é ilegal, mas reforça: melhor mapear o contrato antes do que ser surpreendido depois.

**Alternativa se o contrato do Rodrigo for realmente restritivo:** ele pode entrar na sociedade em momento posterior (após a saída do emprego), com o equity dele reservado contratualmente no Acordo de Sócios via opção de compra de quotas. É uma solução limpa e usual — mas exige advogado para desenhar.

→ **Ação concreta imediata:** Rodrigo lê o próprio contrato de trabalho esta semana e traz as cláusulas encontradas. Se houver qualquer uma das três, consultar advogado trabalhista antes de assinar o contrato social. **Custo: R$ 400–1.200 por uma consulta pontual de revisão contratual.**

### 0.3 — Divisão de quotas, administrador e regra de desempate

Vocês decidiram **20% para cada um dos 5**. Registro a decisão e mantenho a ressalva profissional:

- **O problema não é o 20% igual em si** — é 20% igual **sem mecanismo de desempate e sem vesting**. Com 5 sócios iguais, uma votação 3×2 ou um impasse 2×2×1 pode paralisar a empresa (deadlock), e não existe quem decida.
- **Mitigação obrigatória (não muda o split, resolve o problema):** definam no Acordo de Sócios (a) quais decisões são do **administrador sozinho** (dia a dia), (b) quais exigem **maioria simples** (60% = 3 sócios), (c) quais exigem **unanimidade** (venda da empresa, entrada de sócio novo, mudança de objeto social), e (d) uma **cláusula de desempate**: voto de qualidade do administrador, ou mediação, ou buy-or-sell ("shotgun"). Sem isso, o 20/20/20/20/20 é uma bomba-relógio.

**Decidam também:**
- **Quem é o administrador** (assina pela empresa, abre conta, responde na Receita). Pode ser um ou dois em conjunto. Recomendo **um administrador titular + um substituto**.
- **Capital social:** o valor declarado da empresa. Para uma LTDA de serviços, **R$ 1.000 a R$ 10.000 é suficiente e usual**. Não precisa depositar o dinheiro em conta antes; é integralizado conforme o contrato social prevê (à vista ou em prazo). Capital muito alto aumenta taxa de Junta e não traz benefício. Considerando os R$20–30 mil de necessidade de capital estimados por Eduardo, sugiro **capital social de R$ 5.000, integralizado em 12 meses**, e o restante entrando como aporte/mútuo dos sócios (Eduardo modela).
- **Endereço da sede:** pode ser o endereço residencial de um sócio (verifique se o município permite para a atividade — algumas prefeituras restringem) ou um **endereço fiscal/coworking** (R$ 80–250/mês). Recomendo endereço fiscal: separa a vida pessoal da empresa e evita problema de alvará residencial.

### 0.4 — Vesting: decidam os parâmetros agora

**Vesting** = o sócio só "ganha de verdade" as quotas dele com o tempo de dedicação. Protege os 5 contra o cenário "um sócio sai em 4 meses e leva 20% da empresa para sempre".

Parâmetros que recomendo (padrão de mercado, aplicáveis aos 5):
- **Cliff de 12 meses:** se sair antes de 1 ano, não leva nada.
- **Vesting total de 48 meses**, linear/mensal após o cliff (≈ 1,67% do total por mês).
- **Bad leaver / Good leaver:** quem sai por justa causa ou concorrendo perde mais do que quem sai por motivo legítimo.
- **Cláusula específica para o RT-CREF:** se ele sair, a operação fica ilegal em 24h. O Acordo precisa obrigá-lo a permanecer até haver substituto habilitado, com penalidade se não cumprir.
- **Cláusula específica para o Cahuã:** o equity dele está atrelado à entrega de imagem/audiência; se ele parar de divulgar, o vesting dele deve parar também.

No Brasil não existe "vesting" como instituto legal próprio — implementa-se **contratualmente** via (a) opção de compra de quotas condicionada ao tempo, ou (b) quotas já emitidas com **cláusula de recompra a valor nominal** se o sócio sair antes ("reverse vesting"). A opção (b) é mais simples de operar na LTDA brasileira. O advogado escolhe.

### 0.5 — Validar ANTES do CNPJ: o beta fechado (opcional, mas recomendado)

Vocês podem — e devem — testar o produto com usuários reais **enquanto** a empresa está sendo aberta. Regras inegociáveis para que isso seja juridicamente defensável:

| Regra | Por quê |
|---|---|
| **Gratuito. Zero cobrança, zero PIX, zero "contribuição voluntária".** | Sem cobrança não há relação de consumo formada nem receita sem CNPJ. É o pilar de tudo. |
| **Máximo ~30 usuários, por convite nominal.** | Caracteriza teste privado, não oferta ao público. |
| **Zero divulgação pública/paga.** Nada de anúncio, nada de post aberto convidando. | Divulgação pública = oferta ao mercado. |
| **Termo de Participação em Teste de 1 página**, assinado (pode ser aceite digital com log). | Deixa claro: é teste, é gratuito, não há garantia, o participante pode sair quando quiser, os dados de saúde dele são tratados com consentimento específico. |
| **PAR-Q com bloqueio conservador — mais rígido que o de produção.** | No beta, na dúvida, **bloqueia**. Qualquer resposta de risco = sem protocolo. |
| **O RT-CREF precisa estar nominalmente ativo e supervisionando de fato**, ainda que a PJ não exista. | Ele é profissional registrado; a orientação sai sob a responsabilidade profissional dele. Isso é o que segura o beta. |
| **Sem nota fiscal, sem contrato de prestação de serviço, sem promessa de resultado.** | Óbvio, mas registrando. |

**Gatilhos que obrigam a parar o beta e migrar para operação formal (qualquer um deles):**
1. O primeiro real cobrado de qualquer usuário.
2. Mais de ~50 usuários ativos.
3. Qualquer campanha paga ou divulgação pública ampla.
4. Contato do CREF, de um órgão, ou qualquer questionamento formal.
5. Qualquer incidente de saúde envolvendo um participante.

**Risco residual do beta: BAIXO-MÉDIO.** Não é risco zero — o CREF pode entender que há prestação de serviço mesmo sem cobrança. Por isso a supervisão real do RT e a limitação de escala são essenciais, e por isso o beta deve durar **semanas, não meses**.

---

## FASE 1 — ABRIR A EMPRESA (a LTDA e o CNPJ)

**Custo: R$ 1.400 a R$ 3.500 (setup) · Prazo: 15 a 30 dias · Quem faz: CONTADOR (vocês só assinam)**

Esta é a fase que parece assustadora e é a mais simples: **o contador faz praticamente tudo**. Vocês fornecem documentos e assinam.

### Passo 1.1 — Contratar um contador (faça isso primeiro)

Procurem um contador com experiência em **startups/tecnologia E em serviços regulamentados por conselho de classe**. A segunda parte importa: um contador que só atende software house vai colocar CNAE errado e travar o CREF.

**Pergunta de triagem para o contador (façam literalmente):** *"Precisamos de uma LTDA que preste serviço de Educação Física como atividade-fim, com Responsável Técnico registrado no CREF, e também desenvolva a plataforma tecnológica. Você já abriu empresa com registro em conselho de classe? Que CNAEs você usaria e isso permite Simples Nacional Anexo III via Fator R?"* — Se ele hesitar nessa pergunta, procurem outro.

- **Custo:** honorário de abertura R$ 500–2.000 (muitas contabilidades online abrem de graça se você fechar a mensalidade) + mensalidade **R$ 300–800/mês**.
- **Documentos que vocês precisam entregar:** RG/CNH, CPF, comprovante de residência e certidão de estado civil de cada um dos 5 sócios; comprovante do endereço da sede (IPTU ou contrato de locação/coworking).

### Passo 1.2 — Definir os CNAEs (⚠️ etapa crítica, não delegue cegamente)

O CNAE define se o CREF vai aceitar registrar a empresa e qual anexo do Simples se aplica. **Se o contrato social disser apenas "desenvolvimento de software", o CREF pode recusar o registro-PJ e a defesa de "quem presta é o profissional CREF" desmorona.**

**Estrutura recomendada — objeto social híbrido:**
- **CNAE principal (atividade-fim, sob RT):** atividade de condicionamento físico / ensino de esportes / atividades de Educação Física — grupo 8591-1 (ensino de esportes) ou 9313-1 (atividades de condicionamento físico). *O contador confirma qual se encaixa melhor no modelo remoto.*
- **CNAEs secundários (o meio):** 6201-5 (desenvolvimento de programas sob encomenda), 6202-3 (desenvolvimento e licenciamento de programas customizáveis), 6209-1 (suporte técnico/TI).

**Redação do objeto social no contrato social — peça ao contador algo nesta linha:**
> "Prestação de serviços de orientação, planejamento e acompanhamento de exercício físico e condicionamento físico, sob responsabilidade técnica de Profissional de Educação Física registrado no CREF; desenvolvimento, licenciamento e manutenção de plataforma tecnológica própria empregada como meio para a prestação desses serviços."

A ordem importa: **Educação Física é a atividade-fim; tecnologia é o meio.**

### Passo 1.3 — Consulta de viabilidade e registro na Junta Comercial

O contador faz, pelo portal integrado (Redesim / Junta Comercial do estado):
1. **Consulta de viabilidade:** verifica se o nome está livre e se o endereço permite a atividade. (1–3 dias)
2. **Elaboração e assinatura do Contrato Social** — os 5 assinam digitalmente (com certificado digital pessoal, gov.br nível prata/ouro, ou presencialmente). (1–2 dias)
3. **Registro na Junta Comercial** do estado da sede → sai o **NIRE**. (2–7 dias)
4. **CNPJ** é gerado automaticamente na sequência. (imediato a 2 dias)

> **Dúvida frequente respondida:** registrar em um estado **não limita** o atendimento. A MOVIVO pode atender clientes de todo o Brasil com CNPJ registrado em qualquer estado. O que muda por estado é a taxa da Junta e, por município, o ISS.

- **Custo da taxa de Junta Comercial:** **R$ 140 a R$ 610**, variando por estado (LTDA fica na faixa alta).

### Passo 1.4 — Inscrição Municipal e Alvará

Serviço = imposto municipal (ISS). Vocês precisam se inscrever na prefeitura da sede para emitir nota fiscal de serviço.
- Contador faz. Prazo 5–20 dias (varia muito por prefeitura).
- **Custo:** taxa de fiscalização/alvará **R$ 0 a R$ 500/ano**, dependendo do município. Muitos municípios isentam empresa de serviço sem atendimento presencial.
- Se a atividade for 100% remota, informe isso — costuma simplificar o alvará.

### Passo 1.5 — Optar pelo Simples Nacional (Anexo III via Fator R)

- **A adesão é gratuita e feita pelo contador** no portal do Simples Nacional, em até 30 dias do CNPJ.
- **O que NÃO é gratuito:** o imposto mensal. Simples é o *regime*, não isenção. Vocês pagam um boleto único (DAS) sobre o faturamento.
- **Estratégia do Eduardo (seguir):** manter o **Fator R ≥ 28%** (folha de pagamento, incluindo pró-labore dos sócios, dividida pela receita bruta dos últimos 12 meses). Se ≥ 28% → **Anexo III, alíquota inicial 6%**. Se < 28% → **Anexo V, alíquota inicial 15,5%**. A diferença é enorme: em R$ 30 mil/mês de faturamento, são ~R$ 2.850/mês de imposto a mais no Anexo V.
- **Ação prática:** peça ao contador para **simular o pró-labore mínimo** necessário para manter o Fator R ≥ 28% desde o primeiro faturamento. Nos primeiros meses, com faturamento baixo, isso é fácil e barato.

### Passo 1.6 — Certificado Digital e-CNPJ

Necessário para emitir nota fiscal, assinar documentos oficiais e acessar a Receita.
- **Tipo A1** (arquivo no computador, validade 1 ano): **R$ 150–300**. Recomendo este — é mais prático para automação e para o backend emitir NF.
- **Tipo A3** (token/cartão físico, validade 3 anos): R$ 250–450.
- Emitido por Autoridades Certificadoras (Serpro, Certisign, Serasa, Valid, Soluti). Videoconferência ou presencial. Prazo: 1–3 dias.

### Passo 1.7 — Conta bancária PJ

- Abram conta PJ digital (Nubank PJ, Inter, C6, BTG, Cora, Asaas conta). **Custo: R$ 0** na maioria.
- Prazo: 2–10 dias (bancos digitais são mais rápidos; alguns exigem o certificado digital).
- **Regra de higiene inegociável:** a partir daqui, **nada de despesa da empresa no cartão pessoal e nada de despesa pessoal na conta da empresa**. Misturar contas é o erro nº 1 de startup iniciante — cria problema fiscal, problema societário e reprova em due diligence.

**✅ Ao fim da Fase 1 vocês têm:** CNPJ ativo, contrato social registrado, inscrição municipal, Simples Nacional, certificado digital e conta PJ. **A empresa existe.** Mas ainda não pode operar legalmente o serviço de Educação Física — falta a Fase 4.

---

## FASE 2 — BLINDAR A SOCIEDADE (Acordo de Sócios e contratos internos)

**Custo: R$ 3.000 a R$ 8.000 · Prazo: 15 a 30 dias · Quem faz: ADVOGADO (societário)**

Pode rodar em paralelo à Fase 1, mas deve ser **assinado logo após o CNPJ existir** e obrigatoriamente **antes do primeiro faturamento**.

### Passo 2.1 — Acordo de Sócios (o documento mais importante desta fase)

Não é o contrato social. É privado, não vai à Junta, e é onde mora tudo o que realmente importa. **Exige advogado — não use modelo da internet para uma sociedade de 5 pessoas com equity igual.**

**Cláusulas obrigatórias (leve esta lista ao advogado):**

| Cláusula | O que resolve |
|---|---|
| **Vesting** (cliff 12m / total 48m, com bad/good leaver) | Sócio que sai cedo não leva 20% para sempre |
| **Regra de desempate / deadlock** | O problema do 20/20/20/20/20 |
| **Quóruns por tipo de decisão** | O que o administrador decide sozinho vs. o que exige maioria vs. unanimidade |
| **⚠️ Cessão de PI à empresa** | **Todo código, prompt, design, texto, metodologia e conteúdo criado por qualquer sócio pertence à MOVIVO PJ, desde o dia 1, inclusive o que já foi criado antes da abertura.** Sem isso, o código é dos devs, não da empresa — e nenhum investidor aceita |
| **Tag along / drag along** | Proteção em venda da empresa |
| **Direito de preferência** | Ninguém vende quota para estranho sem oferecer aos outros |
| **Não-concorrência e non-solicit** | Sócio que sai não abre concorrente nem leva os outros |
| **Confidencialidade** | Óbvia, mas necessária |
| **Continuidade do RT** | O que acontece se o RT-CREF sair (a operação fica ilegal em 24h) |
| **Saída, morte, invalidez** | Como se apura o valor da quota e quem compra |
| **Resolução de disputas** | Foro ou arbitragem |

**Custo:** R$ 3.000–8.000 com advogado societário. Startups em estágio inicial conseguem na faixa de R$ 3.000–5.000. **Não economizem aqui** — refazer depois custa 10× ou é impossível.

### Passo 2.2 — Contrato de Responsabilidade Técnica com o Treinador CREF

Separe os **dois papéis** dele:
- **Como sócio:** regido pelo Acordo de Sócios (equity, vesting).
- **Como RT:** contrato específico definindo escopo da responsabilidade técnica, obrigação de definir e revisar a metodologia, obrigação de assinar/revisar protocolos e amostras, remuneração pela função, cláusula de substituto qualificado em 24h, titularidade da metodologia (pertence à PJ), e regra de que a saída sem substituto suspende a operação.
- **Atenção trabalhista:** desenhar sem subordinação típica de CLT (ele tem autonomia técnica), para não configurar vínculo empregatício disfarçado.
- **Custo:** R$ 800–2.000 (pode ser incluído no pacote do advogado societário).

### Passo 2.3 — Contrato de Imagem e Endosso com o Cahuã

Separado do equity. Deve conter:
- Licença de uso de **imagem, nome e voz** (escopo, prazo, territórios, mídias).
- **Titularidade do conteúdo** produzido para a marca e dos perfis criados para a marca → pertencem à PJ.
- **Compliance publicitário:** identificação de publicidade (#publi), vedação a promessa de resultado, vedação a alegação de saúde/cura, uso obrigatório da linguagem-guardrail.
- **Moral clause** (conduta e reputação): o rosto da marca afeta a PJ; prever suspensão/rescisão e efeitos no vesting.
- Não-concorrência limitada (não endossar concorrente direto durante o vínculo).
- **Custo:** R$ 800–2.000 (idem, pacote).

### Passo 2.4 — Cessão retroativa de IP

Se qualquer código, design ou conteúdo já foi criado **antes** da existência do CNPJ (e foi — vocês já estão na Sprint 5), assinem um **Instrumento de Cessão de Direitos** transferindo tudo o que foi criado antes da constituição para a PJ. É um documento de 2 páginas e evita um problema enorme lá na frente. **Custo: incluído no pacote do advogado ou R$ 300–800 avulso.**

---

## FASE 3 — LGPD E DOCUMENTOS DO PRODUTO

**Custo: R$ 2.000 a R$ 6.000 (setup) + R$ 200–800/mês (DPO, se terceirizado) · Prazo: 15 a 30 dias · Quem faz: ADVOGADO (digital/LGPD) + vocês**

Pode rodar em paralelo às Fases 1 e 2. **Precisa estar pronto antes do primeiro usuário pagante** — e a versão simplificada precisa existir já no beta.

### Passo 3.1 — Nomear o Encarregado (DPO)

- **Obrigatório pela LGPD (Art. 41).** Pode ser um sócio ou serviço terceirizado ("DPO as a service").
- **Não deve ser** o RT-CREF (já sobrecarregado com papel crítico) nem um dev que acumula operação. Sugiro **Cahuã ou um dos devs não-operacionais**, com apoio externo.
- O nome e o **canal de contato (e-mail)** vão na Política de Privacidade.
- **Custo:** R$ 0 se interno; R$ 200–800/mês se DPO as a service (recomendado a partir do go-live comercial).

### Passo 3.2 — Documentos jurídicos do produto (os 6 essenciais)

| Documento | O que é | Onde vive |
|---|---|---|
| **Termos de Uso** | Contrato entre a MOVIVO e o usuário | Site + aceite no onboarding |
| **Política de Privacidade** | Como vocês tratam dados (Art. 9º LGPD) | Site + link no WhatsApp |
| **Termo de Consentimento para Dados de Saúde** | Opt-in separado, destacado, versionado, para o Art. 11, I | Antes do bloco 2 da anamnese |
| **Termo de Responsabilidade + PAR-Q** | Ciência de risco inerente, veracidade das respostas, recomendação de avaliação médica | Junto da anamnese |
| **RIPD** (Relatório de Impacto) | Documento interno que mapeia riscos aos titulares — exigível pela ANPD | Interno, assinado |
| **ROPA** (Registro de Operações) | Planilha viva com cada operação de tratamento | Interno |

**Guardrails de linguagem — inegociáveis em TODOS eles (e em todo prompt, copy e UI):**
- **NUNCA:** "a IA prescreve seu treino", "diagnóstico", "tratamento", "cura", "resultado garantido".
- **SEMPRE:** "treino elaborado por Profissional de Educação Física registrado (CREF nº ___), com uso de inteligência artificial como ferramenta e sob sua supervisão".

**Cláusulas que os Termos de Uso precisam ter:**
1. Identificação da PJ (razão social, CNPJ, **registro CREF-PJ**, nome e **CREF do RT**).
2. Escopo e limites explícitos: orienta condicionamento físico; **não** substitui avaliação médica, **não** faz diagnóstico, **não** prescreve medicamento/suplemento.
3. Requisito de maioridade (18+) e veracidade do PAR-Q.
4. Assinatura, trial, renovação automática, preço e **cancelamento self-service pelo mesmo canal da contratação** (CDC + Decreto 11.034/2022).
5. **Direito de arrependimento: 7 dias** (CDC art. 49) — compatibilizar com o trial de 7 dias.
6. Propriedade intelectual da MOVIVO e licença de uso ao usuário.
7. Foro do domicílio do consumidor (irrenunciável em relação de consumo).

> **⚠️ Cuidado importante:** cláusula de "responsabilidade **exclusiva** do consumidor por dano à saúde" é **nula de pleno direito** (CDC art. 51, I). Não usem essa redação como escudo — ela não protege e sinaliza má-fé. A defesa real é **diligência documentada** (PAR-Q bloqueante + termo de ciência + advertências contextuais + supervisão do RT + logs) e, na tração, **seguro de responsabilidade civil**.

- **Custo dos documentos:** R$ 2.000–6.000 com advogado de direito digital. Modelos genéricos de internet **não servem** aqui por causa do dado de saúde + CREF + IA — é exatamente a combinação que os modelos não cobrem.

### Passo 3.3 — DPAs com fornecedores

Contrato obrigatório (Art. 39 LGPD) com todo fornecedor que trata dados por vocês:

| Fornecedor | Papel | Status |
|---|---|---|
| **AraraHQ** (WhatsApp BSP) | Processa telefone e conteúdo das conversas | ⚠️ Exigir/avaliar DPA — é o mais crítico |
| **OpenAI** (GPT-4.1) | LLM principal | DPA padrão existe; exigir **Zero Data Retention** ✅ já decidido |
| **Anthropic** (Claude Sonnet 4.5) | LLM fallback | DPA padrão existe; ZDR ✅ já decidido |
| **Stripe / Asaas** | Pagamento | DPA padrão robusto — aceitar |
| **PostHog** | Analytics | DPA padrão |
| **Hostinger** (VPS) | Hospedagem | Verificar **residência dos dados** — preferir região Brasil |

Para operadores no exterior, incorporar as **Cláusulas-Padrão Contratuais da ANPD (Resolução CD/ANPD nº 19/2024)** — o período de adequação já se encerrou em ago/2025, então isso hoje é **exigência, não recomendação**.

- **Custo:** R$ 0 (aceitar DPAs padrão) a R$ 1.500 (revisão advocatícia dos contratos).

### Passo 3.4 — Gate PAR-Q bloqueante (requisito de produto, não só de papel)

**Vinculante.** Para respostas de risco no PAR-Q (dor torácica, problema cardíaco, tontura/desmaio, medicação para pressão/coração, gestação, lesão ativa, cirurgia recente), o sistema deve **BLOQUEAR** a geração automática do protocolo — não apenas sinalizar.

Estados obrigatórios: `LIBERADO` / `BLOQUEADO_AGUARDANDO_CLEARANCE` / `LIBERADO_COM_RESSALVA_RT`. Nenhum protocolo sai enquanto `BLOQUEADO`. A diferença entre "flag" e "bloqueio" é a diferença entre diligência real e diligência de fachada — e é exatamente o vetor de dano da musculação.

Também obrigatório: **gate de idade 18+** com bloqueio. Dado de saúde de menor (Art. 14 LGPD) tem regime reforçado que a MOVIVO não deve assumir no MVP.

---

## FASE 4 — MARCA (INPI) — comece cedo, mesmo que demore

**Custo: R$ 440 a R$ 2.500 por marca/classe · Prazo: depósito em 1 dia; decisão em 12–24 meses · Quem faz: ADVOGADO DE PI (recomendado) ou vocês**

**Por que fazer cedo:** a proteção **retroage à data do depósito**. Quem deposita primeiro tem prioridade. Não esperem a marca "ficar grande" — nesse momento já é tarde e caro.

### Passo 4.1 — A situação MOVIVO × VIVO (leiam com atenção)

**Fato apurado:** a busca exata por "MOVIVO" na base do INPI retornou **zero resultados** — ninguém depositou esse nome. Ótima notícia.

**Fato que preocupa:** **VIVO (Telefônica Brasil) é marca de ALTO RENOME** reconhecida pelo INPI. Alto renome (LPI art. 125) confere proteção **em todos os ramos de atividade** — é a exceção ao princípio da especialidade. Ou seja: o argumento *"somos fitness, VIVO é telecom, classes diferentes"* **não neutraliza o risco**, porque alto renome protege através das classes.

**Avaliação equilibrada:**
- *A favor da MOVIVO:* "MOVIVO" é palavra distinta (movimento + vivo), 3 sílabas, com significado próprio; não reproduz o sinal "VIVO" isoladamente nem o trade dress da Telefônica; setores e públicos totalmente distintos.
- *Contra:* contém a sequência "-VIVO" ao final, foneticamente destacada. O alto renome dá à Telefônica base para **oposição** ou **pedido de nulidade** alegando diluição/aproveitamento parasitário, mesmo em ramo distinto. O risco não é de indeferimento automático — é de **oposição/litígio**, que mesmo vencido custa tempo e dinheiro.

**Nível de risco (marca): MÉDIO-ALTO.** Real, não proibitivo.

### Passo 4.2 — Estratégia recomendada (três ações)

1. **Contratar parecer de advogado de PI** especificamente sobre MOVIVO × VIVO, com recomendação go/no-go por escrito. **Custo: R$ 500–1.500.** Não pulem — é a diferença entre uma decisão informada e um chute em cima da marca que vocês vão gastar dinheiro construindo.
2. **Depositar MOVIVO E TRENOVA em paralelo**, nas classes **41** (educação/treinamento físico), **44** (saúde/bem-estar) e, se o orçamento permitir, **42** (software/TI). Depositar TRENOVA é um seguro barato: se MOVIVO cair, vocês já têm a alternativa protegida e datada.
3. **Definir por escrito um gatilho objetivo de troca de marca**, decidido ANTES de acontecer, para não ser decisão emocional no calor do momento. Sugestão: *"Se a Telefônica apresentar oposição formal ao pedido de MOVIVO, a MOVIVO migra para TRENOVA em até 90 dias, sem rediscussão, salvo se o parecer de PI atualizado indicar chance de êxito ≥ 70% e o custo estimado de defesa for inferior a R$ X."*

### Passo 4.3 — Custos do INPI (atualizado, ago/2026)

- **Pedido de registro de marca com especificação pré-aprovada, com desconto (ME/EPP/Simples): R$ 440 por classe.**
- Com especificação de livre preenchimento e desconto: R$ 860 por classe. Sem desconto, aproximadamente o dobro.
- **Mudança importante:** desde set/2025 o pagamento é **único, no protocolo**, e já cobre a concessão e os **primeiros 10 anos** de proteção. Não há mais a segunda taxa de concessão.
- **Vocês têm direito ao desconto** por serem ME/EPP no Simples Nacional — mais um motivo para o CNPJ vir antes do depósito.
- **Honorário de advogado/agente de PI para depositar:** R$ 600–1.500 por marca (opcional — dá para depositar sozinho pelo portal e-INPI, mas com 5 depósitos e um risco de alto renome envolvido, recomendo profissional).

**Cálculo prático:** MOVIVO em 3 classes (R$ 1.320) + TRENOVA em 2 classes defensivas (R$ 880) + parecer (R$ 1.000) ≈ **R$ 3.200**. Se apertarem para o essencial (MOVIVO em 41 e 44 + TRENOVA em 41) ≈ **R$ 1.760** + parecer.

### Passo 4.4 — Detalhe operacional

- Registrar a marca **em nome da PJ (CNPJ)**, nunca de sócio pessoa física. Marca em nome de PF é red flag em due diligence.
- Distanciamento visual de trade dress: paleta que **não** remeta ao roxo-VIVO (Kimura já orientou — reforço como mitigação jurídica).

---

## FASE 5 — REGISTRO NO CREF-PJ (o que legaliza a operação)

**Custo: R$ 500 a R$ 1.500/ano · Prazo: 15 a 45 dias · Quem faz: vocês + o RT**

**Esta é a fase que transforma a empresa de "software house" em "prestadora legal de serviço de Educação Física". Sem ela, cobrar pelo serviço é exercício irregular da profissão.**

**Fundamento:** Lei 9.696/1998 (regulamenta a profissão; prescrição/orientação de exercício é atividade privativa do profissional registrado) + Resolução CONFEF nº 477/2023 (registro da PJ e figura do Responsável Técnico) + Resolução CONFEF nº 607/2025 (posterior — **confirmar alterações com o CREF regional**).

### Passo a passo

1. **Pré-requisito:** o RT (treinador do Cahuã) precisa estar com **registro individual ativo e regular** no CREF do estado, com anuidades quitadas. Confirmar isso ANTES de tudo — se ele estiver inadimplente, tudo trava.
2. Ter o **CNPJ pronto com objeto social compatível** (Fase 1, Passo 1.2). Se o objeto social só falar em software, o CREF pode recusar.
3. Preencher o **requerimento de registro de Pessoa Jurídica** no portal do CREF regional, informando o número de registro do RT.
4. Firmar o **Termo de Compromisso de Responsabilidade Técnica** (formulário próprio do CREF), assinado pelo representante legal da PJ **e** pelo RT.
5. Anexar: contrato social registrado, CNPJ, documentos dos sócios, comprovante de endereço, documentos do RT.
6. Recolher a **taxa de registro + anuidade da PJ**. Valor varia por CREF regional e por porte — **estimar R$ 500–1.500/ano**. Ligue para o CREF do estado e pergunte o valor exato para PJ de pequeno porte.
7. Aguardar deferimento e a emissão do **número de registro CREF-PJ**.
8. **Exibir o registro CREF-PJ e o nome/CREF do RT nos canais oficiais** — site, Termos de Uso, e visível na tela do produto.

### Ponto de atenção honesto (limitação regulatória conhecida)

A Res. 477/2023 (art. 21) limita o número de **estabelecimentos** por RT (a apuração indica até 4, sujeito a alteração pela Res. 607/2025). Essa regra foi pensada para **unidades físicas** — não há jurisprudência clara sobre como se aplica a uma plataforma 100% digital de alcance nacional.

**Para o MVP com um único RT, isso é gerenciável.** Para escala nacional, é **questão que exige parecer de advogado especializado em direito desportivo** — não decidam sozinhos. Já contem, no plano, com **credenciar RTs adicionais** conforme a base cresce.

**Também obrigatório:** a supervisão do RT precisa ser **real, não decorativa**. Ele deve efetivamente definir a metodologia, revisar amostras e assinar protocolos, com **evidência registrada** no sistema (`protocols.signed_at`, `signature_hash`, `professional_id` — já previstos na arquitetura). Se ficar provado que a supervisão é de fachada, toda a defesa cai.

---

## FASE 6 — ANTES DO PRIMEIRO POST E DA PRIMEIRA COBRANÇA

**Custo: R$ 0 · Prazo: 1 semana · Quem faz: vocês (com Helena e Cahuã)**

Checklist de compliance de comunicação e cobrança:

**Publicidade e redes sociais:**
- [ ] **Selo/menção CREF visível** no site, nos Termos e **na tela do produto** — não escondido no rodapé.
- [ ] Todo post do Cahuã que promove a MOVIVO leva **identificação de publicidade** (#publi / "parceria paga") conforme o Guia de Publicidade por Influenciadores do **CONAR**. Ele é sócio E rosto — a relação comercial precisa ser transparente.
- [ ] **Zero promessa de resultado** ("perca 10kg", "resultado garantido", "corpo dos sonhos em 30 dias"). Isso é publicidade enganosa (CDC art. 37) além de risco CREF.
- [ ] **Zero alegação de saúde/cura/tratamento** em qualquer peça.
- [ ] Antes/depois de transformação corporal: usar com **extremo cuidado** — se usar, com disclaimer de que resultados variam e sem sugerir garantia.
- [ ] Treinar o Cahuã nos guardrails de linguagem. Ele é o maior canal e o maior vetor de risco de compliance publicitário simultaneamente.

**Cobrança e consumidor:**
- [ ] Preço, periodicidade e renovação automática **claros antes do pagamento**.
- [ ] **Cancelamento self-service**, pelo mesmo canal da contratação (Decreto 11.034/2022).
- [ ] **Direito de arrependimento de 7 dias** (CDC art. 49) implementado e informado.
- [ ] Sem dark patterns no fluxo de cancelamento — a ANPD e o Procon estão atentos a isso.
- [ ] Nota fiscal de serviço emitida (o certificado digital da Fase 1 habilita).

**LGPD operacional:**
- [ ] Canal do Encarregado publicado e funcionando (e-mail respondido em **até 15 dias**).
- [ ] Fluxo de exclusão de dados funcionando (política: eliminar identificadores diretos, reter registro anonimizado pelo prazo prescricional de 5 anos — CDC art. 27).
- [ ] Plano de resposta a incidentes escrito (Art. 48 LGPD — comunicação à ANPD e aos titulares).

---

# PARTE II — ANÁLISE JURÍDICA DE FUNDO

*(Análise técnica preservada da versão anterior, atualizada. Leitura obrigatória para o time de engenharia; opcional para os fundadores que quiserem só executar a Parte I.)*

## 1. LGPD — bases legais e validação da arquitetura

**1.1 Base legal para dados de saúde (Art. 11).** Os dados coletados (histórico de lesões, PAR-Q, medicações, gestação, objetivos corporais) são **dados pessoais sensíveis**. A base legal correta é o **consentimento específico e destacado (Art. 11, I)**.

> **Alerta:** a base do Art. 11, II, "f" ("tutela da saúde, por profissionais de saúde") **não deve ser usada como muleta**. É restrita a profissionais/serviços de saúde stricto sensu; o profissional de Educação Física em plataforma de consumo dificilmente se enquadra com segurança. **Consentimento é a base correta e suficiente.**

Consequência: o consentimento é **revogável a qualquer tempo** (Art. 8º, §5º) e a revogação dispara dever de eliminação (Art. 18, IX c/c Art. 16), ressalvadas hipóteses de conservação.

**1.2 Consentimento granular — requisitos:**
- Consentimento para dado de saúde: **separado, destacado, opt-in ativo** (checkbox não pré-marcado), coletado imediatamente antes do bloco 2 da anamnese.
- Registrar a **versão exata do texto de finalidade** apresentada, em artefato versionado e imutável.
- Consentimento de marketing **revogável independentemente** do de saúde (vedação de consentimento genérico, Arts. 8º e 9º).
- **Gate de idade 18+ obrigatório.**

**1.3 Data mapping (validado):**

| Etapa / Dado | Categoria LGPD | Base legal | Destino | Risco |
|---|---|---|---|---|
| Landing → objetivo | Pessoal comum | Consentimento / contrato | PostgreSQL (VPS) | Baixo |
| Anamnese bloco 1 (nome, telefone, e-mail) | Pessoal comum | Execução de contrato (Art. 7, V) | PostgreSQL | Médio |
| Anamnese bloco 2 (PAR-Q, lesões, medicação) | **Sensível — saúde (Art. 11)** | **Consentimento específico (Art. 11, I)** | PostgreSQL `pgcrypto` | **Alto** |
| Conversa WhatsApp | Pessoal + eventual sensível | Consentimento + execução | AraraHQ (operador) → LLM | **Alto (transf. internacional)** |
| Geração de protocolo | Estruturado, pode inferir saúde | Consentimento | **GPT-4.1 / Claude (ZDR + DPA/SCC)** | Médio — ✅ resolvido |
| Pagamento | Pessoal + financeiro | Execução de contrato | Stripe / Asaas | Médio |
| Analytics | Comportamental | Legítimo interesse (Art. 10) + consentimento p/ cookies | PostHog | Médio |
| Auditoria/logs | Pessoal + metadados | Obrigação legal / legítimo interesse | `audit_logs` | Médio |

**Papéis:** MOVIVO = **controladora**. AraraHQ, Stripe, Asaas, PostHog, OpenAI, Anthropic, Hostinger = **operadores** → exigem DPA (Art. 39).

**1.4 Boundary de LLM — status ✅ RESOLVIDO.** A versão anterior deste relatório apontava o DeepSeek (servidores na China, sem decisão de adequação com o Brasil, sem mecanismo de exclusão) como **não-conformidade grave**. A decisão foi revertida (ADR-005-R): **GPT-4.1 principal + Claude Sonnet 4.5 fallback, ambos com Zero Data Retention + DPA/SCC**. Requisitos remanescentes:
1. **Pseudonimizar no boundary:** nome, telefone e identificadores diretos **nunca** transitam no prompt. Substituir por rótulos ("usuário", "lesão: ombro D"). O Motor Determinístico já injeta JSON estruturado — estender.
2. **Assinar formalmente os DPAs** com SCCs da ANPD (Res. 19/2024) incorporadas — o período de graça encerrou em ago/2025.
3. Registrar a decisão no RIPD e no ROPA.

**1.5 Validação da arquitetura técnica (item a item):**

| Medida | Veredito jurídico |
|---|---|
| `pgcrypto` — criptografia em repouso do bloco de saúde | **VALIDADO** (Art. 46/48). Chaves fora do banco (KMS/secret manager). |
| **RLS** em `conversations` | **VALIDADO e elogiado.** Estender a `protocols`, `anamnesis_sessions`, `checkins`. |
| `audit_logs` **append-only** | **VALIDADO.** Essencial para prova de diligência (CREF + LGPD). |
| Retenção 5 anos | **[CORREÇÃO de fundamentação]** Não existe "requisito LGPD de 5 anos para saúde". O ancoradouro correto é o **CDC art. 27** (prescrição de 5 anos da pretensão de reparação por fato do serviço) — conservação para exercício regular de direito (Art. 16, II LGPD). Prontuário de 20 anos é regra do CFM/medicina, **não se aplica** à Educação Física. |
| **Direito ao esquecimento** = DELETE + DROP partition | **[REFINO]** Eliminação total imediata conflita com a conservação defensiva. Correto: **anonimizar** identificadores diretos, **reter** registro despersonalizado pelo prazo prescricional, **eliminar** o que não tiver base de conservação. Responder ao titular em até 15 dias. |
| Expiração de anamnese incompleta em 72h | **VALIDADO e elogiado** (minimização, Art. 6º, III). |
| Assinatura eletrônica: login + timestamp + `signature_hash` (SHA-256), sem ICP-Brasil | **VALIDADO para o MVP.** MP 2.200-2/2001 admite assinatura eletrônica não-ICP quando aceita pelas partes. Reavaliar ICP-Brasil na escala. |
| VPS Hostinger | **Verificar residência dos dados.** Se fora do Brasil, é transferência internacional. Preferir região Brasil; senão, SCC + registro no RIPD. |

## 2. Conformidade com legislação de IA

**Status:** o **PL 2338/2023** (Marco Legal da IA) foi aprovado no Senado em 12/2024 e tramita na Câmara. Adota o modelo europeu (AI Act): classificação por risco, direitos de transparência/explicação/contestação, sanções de até R$ 50 milhões. **Ainda não é lei vigente** — mas a MOVIVO deve nascer compliance-ready.

**Enquadramento provável:** IA que interage com dados de saúde e influencia decisões sobre o corpo tende a **ALTO RISCO**.

**Boa notícia arquitetural:** a arquitetura híbrida (Motor Determinístico + LLM + validação pós-geração + supervisão do RT) **já materializa** os principais requisitos: human-in-the-loop, auditabilidade, explicabilidade e guardrails. Elogio a escolha — ela antecipa o AI Act brasileiro.

**Ações:** (a) transparência ao usuário de que interage com IA supervisionada por profissional CREF, no ToS e no onboarding; (b) direito de contestação/human review acessível (handoff humano); (c) acompanhar a tramitação.

**Nível de risco (IA): MÉDIO.**

## 3. Riscos consolidados

| # | Risco | Prob. | Impacto | Nível | Mitigação-chave |
|---|---|---|---|---|---|
| 1 | Operar/cobrar sem PJ + CREF-PJ (exercício irregular) | Média | Muito alto | **Crítico** | Fases 1 e 5 antes de cobrar |
| 2 | Dado de saúde → LLM sem salvaguarda | Baixa (resolvido) | Muito alto | **Médio** ✅ | GPT-4.1/Claude + ZDR + SCC + pseudonimização |
| 3 | Consentimento inválido / gate PAR-Q fraco | Média | Alto | **Alto** | Fase 3 |
| 4 | Colisão de marca com VIVO (alto renome) | Média | Alto | **Médio-Alto** | Fase 4 — parecer + TRENOVA + gatilho de troca |
| 5 | Responsabilização civil por dano físico (CDC art. 14) | Média | Alto | **Alto** | Diligência documentada + gate médico + seguro |
| 6 | Litígio societário / perda de IP (sem Acordo) | Média | Alto | **Alto** | Fase 2 |
| 7 | Deadlock no 20/20/20/20/20 | **Alta** | Alto | **Alto** | Cláusula de desempate + quóruns |
| 8 | Conflito com contrato CLT do Rodrigo (PI/exclusividade) | Baixa-Média | Alto | **Médio** | Fase 0.2 — revisão do contrato + higiene de recursos |
| 9 | Dependência do RT (ponto único) | Média | Alto | **Médio** | Substituto 24h + RTs adicionais |
| 10 | Ausência de Encarregado/RIPD em fiscalização ANPD | Média | Médio-Alto | **Médio** | Fase 3 |
| 11 | Publicidade do Cahuã com promessa de resultado | Média | Médio | **Médio** | Fase 6 + contrato de imagem |

**Nível de risco global: ALTO — reduzível a MÉDIO com a execução integral das Fases 0 a 6.**

---

# PARTE III — CUSTOS, PRAZOS E CHECKLISTS

## Tabela consolidada de custos — SETUP ÚNICO

| # | Item | Quem faz | Custo mínimo | Custo realista | Obrigatório? |
|---|---|---|---|---|---|
| 1 | Consulta trabalhista sobre contrato CLT do Rodrigo | Advogado | R$ 400 | R$ 800 | Altamente recomendado |
| 2 | Honorário de abertura da empresa | Contador | R$ 0¹ | R$ 800 | Sim |
| 3 | Taxa da Junta Comercial | Órgão | R$ 140 | R$ 400 | Sim |
| 4 | Taxa municipal / alvará (1º ano) | Prefeitura | R$ 0 | R$ 250 | Sim |
| 5 | Certificado digital e-CNPJ A1 | Cert. Digital | R$ 150 | R$ 250 | Sim |
| 6 | Conta bancária PJ | Banco | R$ 0 | R$ 0 | Sim |
| 7 | **Acordo de Sócios** (vesting, desempate, IP) | Advogado | R$ 3.000 | R$ 5.000 | **Sim — não economize** |
| 8 | Contrato de RT + Contrato de imagem (Cahuã) | Advogado | R$ 800 | R$ 2.000² | Sim |
| 9 | Cessão retroativa de IP | Advogado | R$ 0² | R$ 500 | Sim |
| 10 | ToS + Política de Privacidade + Consentimento + Termo PAR-Q | Advogado digital | R$ 2.000 | R$ 4.000 | **Sim** |
| 11 | RIPD + ROPA (elaboração inicial) | Advogado/DPO | R$ 0³ | R$ 1.500 | Sim |
| 12 | Revisão de DPAs de fornecedores | Advogado | R$ 0⁴ | R$ 1.000 | Recomendado |
| 13 | Parecer de PI MOVIVO × VIVO | Advogado PI | R$ 500 | R$ 1.200 | **Sim** |
| 14 | INPI — MOVIVO em 2 classes (41, 44) | INPI | R$ 880 | R$ 1.320 (3 classes) | **Sim** |
| 15 | INPI — TRENOVA defensivo (1–2 classes) | INPI | R$ 440 | R$ 880 | Recomendado |
| 16 | Honorário de agente de PI para depósitos | Advogado PI | R$ 0⁵ | R$ 1.200 | Recomendado |
| 17 | Registro CREF-PJ (taxa + 1ª anuidade) | CREF regional | R$ 500 | R$ 1.000 | **Sim** |
| | **TOTAL SETUP** | | **≈ R$ 8.810** | **≈ R$ 22.100** | |
| | **Cenário enxuto realista** (o que eu recomendo priorizar) | | | **≈ R$ 12.000–14.000** | |

¹ Muitas contabilidades online abrem gratuitamente se você fechar a mensalidade.
² Frequentemente incluído no pacote do advogado societário — negocie pacote fechado.
³ Se o DPO as a service estiver contratado, geralmente inclui.
⁴ Se aceitarem os DPAs padrão de Stripe/OpenAI/Anthropic sem revisão advocatícia.
⁵ Possível depositar sozinhos pelo portal e-INPI, mas não recomendado dado o risco de alto renome.

> **Comparação com o orçamento do Eduardo:** ele estimou R$20–30 mil incluindo setup jurídico + 6 meses de runway. O setup jurídico realista de **R$ 12–14 mil** cabe nesse envelope, mas consome quase metade. **Sugestão de sequenciamento financeiro:** priorizar Fases 1, 2 e 3 (≈ R$ 9.000), e escalonar a Fase 4 (INPI, ≈ R$ 3.000) para o mês seguinte — não porque seja menos importante, mas porque o INPI leva 12–24 meses de qualquer forma e o depósito 30 dias depois não muda materialmente o risco.

## Tabela consolidada de custos — RECORRENTE MENSAL

| Item | Custo mensal | Obrigatório? |
|---|---|---|
| Contador (mensalidade) | R$ 300–800 | **Sim** |
| Endereço fiscal / coworking (se usado) | R$ 80–250 | Não (se usarem endereço de sócio) |
| DPO as a service | R$ 200–800 | Recomendado a partir do go-live comercial |
| Impostos (Simples Nacional, Anexo III) | **6%+ do faturamento** | **Sim** — Eduardo modela |
| Certificado digital (rateio anual do A1) | ≈ R$ 20 | Sim |
| Anuidade CREF-PJ (rateio mensal) | ≈ R$ 60 | Sim |
| **TOTAL FIXO (sem impostos)** | **R$ 660 – R$ 1.930** | |
| **Cenário enxuto** | **≈ R$ 700/mês** | |

## Cronograma consolidado

```
Semana 1-2    FASE 0  — Decisões societárias + Rodrigo revisa contrato CLT
                        [em paralelo: FASE 0.5 — beta fechado pode rodar]
Semana 2-5    FASE 1  — Contador → CNAE → Junta → CNPJ → Simples → cert. digital → conta PJ
Semana 3-7    FASE 2  — Advogado societário → Acordo de Sócios + contratos RT/imagem
Semana 3-7    FASE 3  — Advogado digital → ToS/PP/Consentimento/RIPD + DPAs (paralelo à Fase 2)
Semana 5-7    FASE 4  — Parecer de PI + depósito INPI (MOVIVO + TRENOVA)
Semana 6-11   FASE 5  — Registro CREF-PJ (só depois do CNPJ existir)
Semana 11-12  FASE 6  — Compliance de comunicação e cobrança
──────────────────────────────────────────────────────────────────────────
Semana 12+    GO-LIVE COMERCIAL LIBERADO (primeira cobrança permitida)
```

**Total realista: 60 a 90 dias.** O caminho crítico é **CNPJ → CREF-PJ** (Fase 5 não pode começar sem a Fase 1 concluída). Tudo o mais roda em paralelo.

## ✅ CHECKLIST FINAL — "sem isso NÃO PODE OPERAR"

Nenhum real pode ser cobrado enquanto qualquer item abaixo estiver aberto:

- [ ] **CNPJ ativo** com contrato social registrado na Junta Comercial
- [ ] **Objeto social e CNAE compatíveis com CREF** (Educação Física como atividade-fim)
- [ ] **Registro CREF-PJ deferido** + Termo de Compromisso do RT assinado
- [ ] **RT com registro individual ativo e regular** no CREF
- [ ] **Inscrição municipal** e capacidade de emitir nota fiscal
- [ ] **Certificado digital e-CNPJ** ativo
- [ ] **Simples Nacional** com opção formalizada
- [ ] **Conta bancária PJ** separada das contas pessoais
- [ ] **Acordo de Sócios assinado** com vesting, desempate e **cessão de IP à PJ**
- [ ] **Cessão retroativa de IP** de tudo criado antes do CNPJ
- [ ] **Termos de Uso + Política de Privacidade + Termo de Responsabilidade** publicados e com aceite auditável
- [ ] **Consentimento de dados de saúde** destacado, opt-in ativo, versionado
- [ ] **Gate PAR-Q BLOQUEANTE** implementado (não é flag)
- [ ] **Gate de idade 18+** implementado
- [ ] **Encarregado (DPO) nomeado** e canal de contato publicado
- [ ] **DPAs assinados** com AraraHQ, OpenAI, Anthropic, Stripe/Asaas, PostHog, Hostinger — com SCCs da ANPD para os do exterior
- [ ] **Zero dado de saúde identificável** enviado a LLM (pseudonimização no boundary)
- [ ] **CREF-PJ e CREF do RT visíveis** no site e na tela do produto
- [ ] **Cancelamento self-service** + direito de arrependimento de 7 dias implementados
- [ ] **Rodrigo checou o contrato CLT** e não há impedimento (ou o impedimento foi resolvido)

## 🟡 CHECKLIST — "PODE ADIAR (mas não esqueça)"

| Item | Adiar até quando | Por quê pode adiar |
|---|---|---|
| **Depósito no INPI** | Até ~90 dias | Importante, mas o processo leva 12–24 meses de qualquer forma. Não adie mais que isso — a proteção retroage ao depósito, e alguém pode depositar antes. |
| **Depósito defensivo de TRENOVA** | Junto com o INPI | Seguro barato, não urgente isoladamente |
| **RIPD formalmente assinado** | Antes de escalar além de ~200 usuários | Elabore agora, formalize/assine depois |
| **DPO as a service** | Até o go-live comercial | No beta, DPO interno basta |
| **Seguro de responsabilidade civil** | Ao atingir tração (≈500+ assinantes) | Custo relevante, risco baixo em volume pequeno |
| **Parecer de direito desportivo sobre "estabelecimento digital"** | Antes de nacionalizar/escalar | Com 1 RT e base pequena, não é o gargalo |
| **Assinatura ICP-Brasil dos protocolos** | Na escala | Login + timestamp + hash é suficiente no MVP |
| **RTs adicionais credenciados** | Conforme a base crescer | Um RT cobre o MVP |
| **Auditoria LGPD externa** | Antes de rodada de investimento | Não é exigência legal |
| **Endereço fiscal dedicado** | Pode começar no endereço de um sócio | Se o município permitir a atividade |
| **Revisão advocatícia dos DPAs padrão** | Pode aceitar os padrão primeiro | Stripe, OpenAI e Anthropic têm DPAs robustos e não negociáveis |

---

## Decisões e entregáveis desta consolidação

1. **Guia executivo de abertura em 7 fases** (Fase 0 a 6), com passo a passo, responsável, custo e prazo por etapa — Parte I.
2. **Análise aprofundada do risco Rodrigo/CLT** — exclusividade, cessão de PI ao empregador, concorrência desleal, e a distinção sócio-de-LTDA vs. segunda CLT (Fase 0.2).
3. **Protocolo de beta fechado pré-CNPJ** com regras e gatilhos objetivos de migração (Fase 0.5).
4. **Estratégia de marca definida:** parecer de PI + depósito paralelo MOVIVO/TRENOVA + gatilho objetivo de troca por escrito (Fase 4).
5. **Ressalva formal sobre o split 20/20/20/20/20** — mantida, com mitigação prescrita (cláusula de desempate + quóruns escalonados) que resolve o problema sem alterar o split.
6. **Tabela de custos setup + recorrente** e **cronograma de 60–90 dias**.
7. **Dois checklists operacionais:** bloqueadores absolutos vs. o que pode ser adiado.
8. **Confirmação de que o Bloqueador 2 (LLM/DeepSeek) da versão anterior está resolvido** pela ADR-005-R.

## Recomendações para o próximo agente

- **Eduardo (CFO):** incorporar ao modelo financeiro o setup jurídico de **R$ 12–14 mil** (não R$ 5–8 mil) e o recorrente de **≈R$ 700–1.900/mês**. Simular o pró-labore mínimo para manter Fator R ≥ 28% desde o primeiro faturamento. Provisionar anuidade CREF-PJ e renovação anual do certificado digital.
- **Lucas (Produto) / Leonardo (Backend):** o gate PAR-Q **bloqueante** com os três estados (`LIBERADO` / `BLOQUEADO_AGUARDANDO_CLEARANCE` / `LIBERADO_COM_RESSALVA_RT`) e o **gate de idade 18+** são requisitos jurídicos vinculantes, não sugestões de UX. Idem para a pseudonimização antes do LLM.
- **Felipe (Frontend) / Sofia (UX):** o consentimento de dados de saúde precisa ser **checkbox não pré-marcado, com texto próprio, imediatamente antes do bloco 2**. O selo CREF-PJ e o CREF do RT precisam estar visíveis na tela — não só no rodapé. Cancelamento self-service sem dark patterns.
- **Henrique (DevOps):** verificar **residência dos dados** da VPS Hostinger. Se estiver fora do Brasil, é transferência internacional e exige SCC + registro no RIPD.
- **Camila (Social Media) / Helena (Marketing) / Bruno (Redator):** a Fase 6 é pré-requisito do primeiro post. Guardrails de linguagem e #publi do Cahuã são inegociáveis.
- **Aos fundadores, a ação de esta semana:** (1) Rodrigo lê o próprio contrato de trabalho; (2) os 5 fecham o documento da Fase 0 (nome, administrador, capital, endereço, regra de desempate, parâmetros de vesting); (3) alguém pede três orçamentos de contador com a pergunta de triagem do Passo 1.1. Nada mais precisa acontecer antes disso.

---

## Fontes Consultadas

**Custos e abertura de empresa (2026):**
- Contaja — Quanto custa abrir empresa e ter um CNPJ em 2026: https://contaja.com.br/blog/quanto-custa-abrir-empresa/
- Assevam — Quanto custa abrir CNPJ: taxas e pegadinhas comuns 2026: https://assevam.com.br/quanto-custa-abrir-cnpj-em-2026-taxas-contador-e-pegadinhas-comuns/
- Contabilizei — Quanto custa abrir um CNPJ e ter empresa em 2026: https://www.contabilizei.com.br/contabilidade-online/quanto-custa-abrir-empresa-no-brasil-descubra-tudo/
- Unclik — Quanto custa abrir um CNPJ em 2026: valores, taxas e o que influencia no preço: https://unclik.com.br/conteudos/quanto-custa-abrir-um-cnpj-em-2026/
- Contabilidade Zen — Quanto custa abrir empresa em 2026: https://www.contabilidadezen.com.br/blog/quanto-custa-abrir-empresa-2026/

**INPI e marcas:**
- INPI — Tabela de Retribuições (Portaria MDIC nº 110/2025 e Portaria INPI nº 10/2025): https://www.gov.br/inpi/pt-br/inpi-data/precificacao-dos-servicos/tabela-de-retribuicoes-inpi_portaria-mdic-no110_2025-e-portaria-inpi-no-10_2025.pdf
- INPI — Descontos para a nova Tabela de Retribuições: https://www.gov.br/inpi/pt-br/central-de-conteudo/noticias/inpi-fixa-descontos-para-a-nova-tabela-de-retribuicoes-pelos-seus-servicos
- Oficial Marca — Custo do registro de marca no INPI em 2026: https://oficialmarca.com.br/blog/quanto-custa-registrar-marca-2026/
- Consolide — Tabela do INPI simplificada e atualizada: https://www.consolidesuamarca.com.br/blog/tabela-inpi
- Jusbrasil — Nova Resolução do INPI altera Tabela de Retribuições: https://www.jusbrasil.com.br/artigos/nova-resolucao-do-inpi-altera-tabela-de-retribuicoes-e-introduz-servicos-estrategicos/4214773736
- INPI — Manual de Marcas, item 9.06 Alto Renome: https://manualdemarcas.inpi.gov.br/projects/manual/wiki/9%C2%B706_Alto_renome
- INPI — Lista de marcas de alto renome em vigência: https://www.gov.br/inpi/pt-br/servicos/marcas/arquivos/guia-basico/inpi_marcas_marcasdealtorenomeemvigncia_2024_07_09.pdf
- Migalhas — Resolução INPI 107/13 (alto renome, art. 125 LPI): https://www.migalhas.com.br/depeso/185217/a-resolucao-107-13-do-inpi---novas-regras-para-o-reconhecimento-e-registro-de-marcas-de-alto-renome
- IWMelcheds — INPI divulga nova lista de marcas de alto renome (inclui VIVO), dez/2024: https://iwmelcheds.com.br/publicacoes/marcas-de-alto-renome-inpi-divulga-nova-lista/

**CREF / CONFEF:**
- Resolução CONFEF nº 477/2023 (registro de PJ e RT) — LegisWeb: https://www.legisweb.com.br/legislacao/?id=487286
- CONFEF — Resolução 477/2023 (PDF oficial): https://www.confef.org.br/confef/resolucoes/res-pdf/561.pdf
- Resolução CONFEF nº 607/2025 (posterior — verificar alterações): https://www.legisweb.com.br/legislacao/?id=487268
- CREF4/SP — Registro de Pessoa Jurídica: https://www.crefsp.gov.br/registro/pessoa-juridica
- CREF2/RS — Responsável Técnico: https://www.crefrs.org.br/registro/responsavel-tecnico/

**LGPD / ANPD:**
- ANPD — Regulamento de Transferência Internacional de Dados: https://www.gov.br/anpd/pt-br/assuntos/noticias/resolucao-normatiza-transferencia-internacional-de-dados
- Mayer Brown — Fim do período de graça da Res. CD/ANPD 19/2024 (SCCs), ago/2025: https://www.mayerbrown.com/pt/insights/publications/2025/08/end-of-grace-period-implementation-of-brazils-standard-contractual-clauses-in-international-transfers-of-personal-data
- IRIB — Resolução CD/ANPD nº 19/2024: https://www.irib.org.br/resolucao-cd-anpd-n-19-de-23-de-agosto-de-2024/
- ANPD — FAQ 5.5 "Por quanto tempo os dados podem ser tratados": https://www.gov.br/anpd/pt-br/acesso-a-informacao/perguntas-frequentes/perguntas-frequentes/5-adequacao-a-lgpd/5-5-por-quanto-tempo
- Migalhas — Tratamento de dados em saúde: bases legais, limites e boas práticas: https://www.migalhas.com.br/depeso/449916/tratamento-de-dados-em-saude-bases-legais-limites-e-boas-praticas
- Garnier Advocacia — Prazo de guarda de dados pessoais e sensíveis: https://garnierlaw.com.br/prazo-de-guarda-dos-dados-pessoais-e-sensiveis/
- Machado Meyer — "O DeepSeek está em conformidade com a LGPD?" (histórico, decisão já revertida): https://www.machadomeyer.com.br/pt/inteligencia-juridica/publicacoes-ij/direito-digital/o-deepseek-esta-em-conformidade-com-a-lgpd

**Regulação de IA:**
- Senado — PL 2338/2023 (Marco Legal da IA), tramitação: https://www25.senado.leg.br/web/atividade/materias/-/materia/157233
- Exame — Marco Legal da IA (PL 2338): o que muda para empresas: https://exame.com/inteligencia-artificial/marco-legal-da-inteligencia-artificial-pl-2338-o-que-muda-para-empresas-com-a-nova-lei/
- Juridico.ai — PL 2338/2023 regulamentação da IA no Brasil: https://juridico.ai/direito-digital/pl-2338-2023-regulamentacao-ia-brasil/

> **Limitações de pesquisa declaradas:**
> 1. **Valores de taxas variam por estado e município.** Taxa de Junta Comercial, alvará municipal e anuidade CREF-PJ precisam ser confirmados no estado/município escolhido para a sede. As faixas apresentadas são medianas nacionais.
> 2. **A base de marcas do INPI não foi consultada em busca oficial de anterioridade** (exige sessão autenticada). A ausência de "MOVIVO" na busca exata é indicativa, não conclusiva — a busca formal de anterioridade, incluindo marcas semelhantes e a análise do alto renome de VIVO, é **ato de advogado de PI** e permanece pendente.
> 3. **A Resolução CONFEF nº 607/2025** pode ter alterado parâmetros da Res. 477/2023 (limite de estabelecimentos por RT, requisitos de registro-PJ). **Confirmar diretamente com o CREF regional** antes de protocolar.
> 4. **O contrato de trabalho do Rodrigo não foi analisado** — nenhuma informação foi fornecida sobre o empregador atual ou o teor das cláusulas. A análise da Fase 0.2 é genérica e **não substitui** a leitura do contrato específico por advogado trabalhista.
> 5. **O PL 2338/2023 ainda não é lei vigente** — as obrigações de IA de alto risco são prospectivas.
> 6. **Honorários advocatícios e contábeis são estimativas de mercado** e variam amplamente por região e prestador. Peçam ao menos três orçamentos para cada serviço.
> 7. Textos legais citados (LGPD, CDC, LPI, Lei 9.696/98, Lei 9.279/96, Lei 9.609/98, MP 2.200-2/2001, Decreto 11.034/2022) refletem a legislação vigente conforme conhecida. A redação final de cláusulas contratuais, o RIPD e o registro CREF-PJ **exigem revisão de profissional habilitado**. Nada aqui constitui parecer jurídico formal.
