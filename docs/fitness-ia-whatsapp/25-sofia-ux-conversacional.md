# 25 — UX Conversacional do Coach MOVIVO: redesenho da conversa

**Autora:** Sofia Almeida — Senior Product Designer / Head de Experiência do Usuário
**Data:** 2026-08-28
**Pasta do projeto:** `docs/fitness-ia-whatsapp/`
**Status do pipeline:** Fase 5 (Desenvolvimento) — intervenção de design sobre módulo já implementado
**Depende de:** `08-relatorio-lucas.md`, `09-relatorio-sofia.md` §11, `09b-sofia-ux-onboarding-v2.md`, `12-relatorio-victor.md`, `17-relatorio-bruno.md`, `22-relatorio-clovis-retencao-gamificacao.md`
**Entrega em paralelo com:** Victor (arquitetura conversacional), Bruno (voz e léxico), Alexandre (parecer do escopo ampliado)

---

## 0. Resumo executivo

O problema relatado pelo fundador — *"nosso modelo conversacional não consegue conversar direito com os alunos"* — não é um problema de qualidade do LLM. É um problema de **arquitetura de experiência**: o sistema foi desenhado para *não* conversar. Cada decisão isolada foi defensável (segurança, custo, auditabilidade, LGPD), mas o efeito somado é um coach que, na maior parte dos turnos, não fala — apenas emite.

Li o código que produz a experiência real (`coach-messages.ts`, `ai-response.worker.ts`, `prompts.ts`, `response-formatter.ts`, `evidence-grounding.service.ts`, `checkin.service.ts`, `whatsapp-outbound.worker.ts`). Confirmei os seis achados que me foram passados e encontrei **dois adicionais que ninguém tinha mapeado**:

- **Achado 7 (novo):** o coach **nunca envia mais de uma bolha**. O separador de bolhas (`BUBBLE_SEPARATOR = '\n---\n'`) só é emitido por `protocolDeliveryText`. Toda mensagem conversacional sai como um bloco único, porque `applyResponseFormatting` junta parágrafos com `\n\n`, não com o separador. O produto tem o mecanismo de bolhas construído e desligado no caminho da conversa — que é justamente onde ele importa.
- **Achado 8 (novo):** a copy do check-in semanal e do fechamento está **sem acentuação** (`"Mais uma semana de movimento concluida"`, `"Nenhuma mudanca e feita automaticamente"`). Em português, texto sem acento no WhatsApp é lido como *"isso foi gerado por uma máquina"* antes mesmo de o conteúdo ser processado. É o sinal mais barato de não-humanidade que existe, e está numa das mensagens de maior frequência do produto.

**A tese central deste relatório:** a MOVIVO deve separar *decidir* de *falar*. Hoje as duas coisas estão fundidas — quando o sistema decide "não posso responder isso", ele também já entrega o texto pronto, congelado e idêntico. Proponho que **a decisão continue determinística e auditável** (é o ativo regulatório da empresa, não abro mão dele), e que **a verbalização passe a ser sempre uma camada de linguagem** que recebe o desfecho decidido + os fatos permitidos e escreve a mensagem em português vivo, no contexto daquela conversa, daquele aluno, daquele momento. Nenhum guardrail é afrouxado por isso; o que muda é quem escreve a frase.

Este documento entrega: 10 princípios de conversa, a gramática do turno para WhatsApp, a reescrita completa das 8 mensagens de recusa/abstenção, um sistema de citação de fonte sem colchetes, 8 fluxos conversacionais escritos turno a turno com texto real, o modelo de memória do aluno, o redesenho da presença CREF e uma rubrica de qualidade testável para a Mariana.

---

## 1. Problema de UX

### 1.1 O que o aluno sente

O aluno da MOVIVO paga R$39/mês pela promessa *"orientação de treino conversacional"*. A palavra que sustenta a categoria criada por Clóvis é **conversacional**. O que ele recebe hoje, na maioria dos turnos, é:

1. Uma mensagem só, densa, num bloco.
2. Que responde a **uma** das coisas que ele disse.
3. Que não menciona nada que ele já contou antes.
4. Que, quando não pode responder, diz alguma variação de *"prefiro não arriscar, vou registrar para o profissional"* — sempre com as mesmas palavras.
5. Que às vezes vem com `[E1: Dor no ombro v2]` colado no fim da frase.

O nome disso na literatura de UX conversacional é **interactional dead end**: a recusa repetida palavra por palavra não elimina risco, ela produz um beco — o usuário escala ou para de interagir, enquanto o sistema fica parado ([Deng et al., 2026](https://arxiv.org/pdf/2604.02713)). E o custo é assimétrico: pesquisa de confiança em IA conversacional descreve um **trust cliff** — os usuários recalibram a confiança para baixo depois de *uma* resposta confiantemente errada, *uma* recusa inexplicada ou *uma* interação que pareça manipulativa, e a recuperação é íngreme ([Parallel HQ, 2026](https://www.parallelhq.com/blog/ux-ai-chatbots)).

Na MOVIVO o aluno não recebe uma recusa inexplicada por mês. Ele recebe **várias por semana**, todas com o mesmo texto.

### 1.2 O diagnóstico estrutural, achado por achado

| # | Achado | O que o aluno percebe | Onde está no código |
|---|---|---|---|
| 1 | Cascata determinística intercepta a maioria das mensagens antes do LLM | "ela não me escuta, ela tem respostas prontas" | `ai-response.worker.ts` `process()` — 8 saídas antes do caminho generativo |
| 2 | Uma mensagem = uma intenção | "respondeu metade e ignorou o resto" | `IntentClassifier` retorna `Intent` singular |
| 3 | Citações em colchete no corpo do texto | "isso não é conversa, é relatório" | `evidence-grounding.service.ts` L356-364 |
| 4 | Prompt proíbe introdução/conclusão/recomendação; 1-3 claims de ≤160 chars | "frases soltas sem tecido" | `evidence-grounding.service.ts` L266-273 + `draftSchema` |
| 5 | Abstenções frequentes e idênticas | "ela sempre se esquiva do mesmo jeito" | `coach-messages.ts` — 7 constantes fixas |
| 6 | Memória não é demonstrada | "não faz diferença ser eu" | `context.service.ts` — estado existe no prompt, mas nada obriga a usá-lo |
| **7** | **Sempre uma bolha só** | "parece e-mail, não WhatsApp" | `response-formatter.ts` junta com `\n\n`; separador nunca emitido |
| **8** | **Copy sem acentuação em mensagens de alta frequência** | "isso é robô" (pré-consciente) | `checkin.service.ts` L147, L223, L237, L266, L306 |

### 1.3 A causa raiz única

Todas as oito têm a mesma origem: **o sistema trata "conteúdo aprovado" e "texto entregue ao aluno" como a mesma coisa**.

Isso foi uma decisão consciente e bem-intencionada — o comentário no topo de `coach-messages.ts` diz literalmente: *"Copy fixa = auditável e nunca alucina."* Está correto sobre alucinação. Está errado sobre auditabilidade: **o que precisa ser auditável é a decisão, não a string.** Um log que registra "decisão: ABSTER_POR_FALTA_DE_EVIDENCIA; fatos liberados: nenhum; encaminhado: sim" é *mais* auditável que um log que registra "enviou a constante `TECHNICAL_NO_EVIDENCE_MESSAGE`" — porque no primeiro caso você audita o raciocínio, e no segundo você audita um ponteiro para um texto.

---

## 2. Objetivos

### 2.1 Do usuário
- Ser entendido na primeira tentativa, inclusive quando diz três coisas de uma vez.
- Receber orientação que sirva **para o corpo dele**, não para "uma pessoa".
- Saber o que fazer agora — não só o que não pode ser feito.
- Sentir que quem está do outro lado lembra dele.
- Poder confiar na informação sem precisar checar.
- Não se sentir julgado quando falha.

### 2.2 Do negócio
- **North Star:** treinos concluídos por usuário pago nos primeiros 30 dias (≥8). A conversa é o principal instrumento de correção de rota entre um treino e o próximo.
- Retenção: o motivo n°1 de churn em coaching digital é a percepção de genericidade. Conversa é o único lugar onde a individualização fica *visível*.
- Diferencial de categoria: "ciência que treina com você" só é percebido se a ciência **e** o "com você" aparecerem juntos na mesma mensagem.
- Custo: mais bolhas ≠ mais tokens. A gramática proposta abaixo é, no agregado, **mais barata** que a atual, porque elimina turnos de reparo (aluno reperguntando o que foi ignorado).

---

## 3. Pesquisa e benchmark

Resumo do que a literatura e os concorrentes dizem, e o que eu tirei de cada um para esta entrega.

**(a) Multi-intenção é a norma, não a exceção.** Em conjuntos de dados reais de suporte, **~52% das mensagens contêm mais de uma intenção** ([ML6](https://www.ml6.eu/en/blog/handling-multiple-intent-conversations-in-customer-support-chatbots)). O padrão recomendado é **reconhecer todas as intenções detectadas logo de saída** e só então executar a lógica de cada uma. → Vira o "movimento de ECO" na minha gramática de turno (§5) e o fluxo composto de §7.8.

**(b) Coaching por IA deve ser mais diretivo do que coaching humano.** Estudo comparando um bot diretivo (D-Bot: sugestões, recomendações, estrutura) contra um não-diretivo (N-Bot: perguntas abertas, autodescoberta) achou que o **diretivo venceu** em expectativa de performance, nas dimensões de *tarefa* e *objetivo* da aliança de trabalho, e com tendência de significância em atingimento de meta. A dimensão de *vínculo* (calor relacional) não diferiu. Conclusão dos autores: **clareza de tarefa e objetivo importa mais que profundidade relacional** em contexto de IA ([Frontiers in Psychology, 2026](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2026.1822088/full)). → Isso reorienta o design: o coach MOVIVO **não** deve virar um terapeuta que devolve perguntas. Ele acolhe em uma linha e **orienta**. Escrevi os fluxos de §7 com essa proporção.

**(c) Mas o vínculo ainda decide o abandono.** Revisão sistemática de coaching humano/IA/híbrido em saúde digital: engajamento, satisfação e aliança de trabalho se mantêm nos dois, porém intervenções facilitadas por humano geram conexão mais forte, e nos chatbots os participantes relatam **desconexão, repetitividade e falta de calor** ([Frontiers in Digital Health, 2025](https://www.frontiersin.org/journals/digital-health/articles/10.3389/fdgth.2025.1536416/full)). *Repetitividade* é literalmente o nome do achado 5. → Justifica o modelo híbrido da MOVIVO (IA + CREF nomeado) como vantagem competitiva, e justifica o sistema anti-repetição de §6.2.

**(d) Recusa é sítio de reparo, não fim de linha.** Avisos de segurança precisam vir acompanhados de movimentos de continuidade — reconhecer o ponto de vista do outro, mudar o enquadramento, ou oferecer um próximo passo positivo — o que transforma a recusa num ponto de retomada ([Deng et al., 2026](https://arxiv.org/pdf/2604.02713)). O padrão prático citado na literatura de UX é *"não posso fazer X, mas te conecto com quem faz"* ([UXmatters, 2026](https://www.uxmatters.com/mt/archives/2026/02/conversational-user-interfaces-7-practical-ux-principles-for-modern-ai-systems.php)). → Vira a regra **"a recusa nunca é o turno inteiro"** (§6.1).

**(e) Nem toda transparência é igual.** Comparação de quatro formatos de apresentação de fonte (Collapsible, Hover Card, Footer, Aligned Sidebar): o **colapsável** equilibrou melhor transparência e coerência narrativa, permitindo exploração sem interromper a leitura; o **rodapé** preserva a leitura mas é frequentemente ignorado; a **barra lateral** captura mais atenção mas disputa carga cognitiva com o conteúdo. Conclusão: exibir a fonte não garante confiança — o formato decide se o usuário nota, processa e valoriza ([arXiv 2512.12207](https://arxiv.org/pdf/2512.12207)). → O WhatsApp não tem colapsável. O equivalente funcional é **assinatura discreta na última bolha + fonte completa sob demanda** (§6.3).

**(f) OARS e reflexo complexo.** Entrevista Motivacional em chatbots usa Perguntas abertas, Afirmações, Escuta reflexiva e Sínteses para evocar *change talk*; reflexos gerados (em vez de canned) produzem empatia percebida significativamente maior ([PMC12526391](https://pmc.ncbi.nlm.nih.gov/articles/PMC12526391/); [PMC10618902](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10618902/)). → Reforça a tese central: **reflexo enlatado não gera empatia percebida; reflexo gerado gera.** É a evidência direta contra `coach-messages.ts` como está.

**(g) Culpa e vergonha destroem aderência de longo prazo.** Apps que usam streaks e punição para coagir engajamento diário acionam regulação introjetada (culpa, vergonha) em vez de motivação identificada/intrínseca: produzem obediência de curto prazo e queda de engajamento no longo ([ScienceDirect, taxonomia SDT de features](https://www.sciencedirect.com/science/article/pii/S1071581920300513)). Linguagem autonomy-supportive ("poderia") supera a controladora ("deveria") ([PMC6393822](https://pmc.ncbi.nlm.nih.gov/articles/PMC6393822/)). → Escreve o fluxo de aluno sumido (§7.7) e proíbe "você não treinou", "sua sequência foi quebrada", "que pena".

**(h) Memória: útil vs. invasiva.** Usuários se dividem — alguns querem que pareça máquina, outros aceitam a coleta desde que a personalização entregue valor; há preferência documentada por **memória escopada ao projeto** sobre memória pessoal ampla, e "creepy bot syndrome" é reconhecido como falha de over-memorização e de agarrar-se a contexto desatualizado ([CJR](https://www.cjr.org/tow_center/chatbots-memory-remember-users-conversations-history-openai-sam-altman-llm-gemini.php); [arXiv 2504.14225](https://arxiv.org/pdf/2504.14225)). → Escreve as regras de §8, especialmente "usar como premissa, nunca recitar" e a lista do que **não** lembrar.

**(i) Benchmark de produto.** O WHOOP Coach constrói cada resposta a partir de objetivos + biometria individual + ciência de performance, e é vendido como *individualizado e conversacional* ([WHOOP](https://www.whoop.com/us/en/thelocker/whoop-unveils-the-new-whoop-coach-powered-by-openai/)). O Zing refinou explicitamente seu AI Coach "para ser mais humano e mais próximo de um coach real", com **linguagem casual e conversacional, respostas concisas e diretas ao ponto**, equilibrando um pouco de irreverência com cuidado ([Zing](https://www.zing.coach/fitness-library/zing-ai-coach-upgrades?scLang=en-US)). Nenhum dos dois opera sob supervisão de profissional registrado — é onde a MOVIVO ganha, **se** o respaldo não virar disclaimer repetido (§9).

**(j) Indicador de digitação e cadência.** O indicador do WhatsApp Cloud API dura até **25 segundos ou até a mensagem sair** — o que vier primeiro ([BotSailor](https://botsailor.com/blog/new-typing-indicators-in-whatsapp-cloud-api)). Indicadores de digitação sinalizam responsividade, calibram expectativa de tempo e adicionam realismo ([ResearchGate](https://www.researchgate.net/publication/328744481_The_Chatbot_is_typing_-_The_Role_of_Typing_Indicators_in_Human-Chatbot_Interaction)). → Define os números de cadência de §5.4.

**Limitação declarada da pesquisa:** não encontrei estudo publicado sobre aderência a treino via coach de IA **no WhatsApp em português brasileiro** especificamente, nem benchmark quantitativo de "taxa de abstenção tolerável" em coaching digital. Os alvos numéricos que proponho em §11 são **hipóteses de design a validar**, não referências de mercado.

---

## 4. Os 10 princípios de conversa do coach MOVIVO

Não são valores. São regras que dá para violar, e violar é detectável.

### P1 — Responda ao que foi dito, não à intenção classificada
A intenção é uma ferramenta interna de roteamento. Ela **nunca** pode virar o recorte do que o aluno recebe. Se o aluno disse três coisas, o turno reconhece as três — mesmo que resolva uma só agora.
> Violação: aluno diz *"terminei o treino mas meu ombro incomodou, posso trocar o supino?"* e recebe só a explicação da troca.

### P2 — Determinístico decide, linguagem fala
Toda mensagem que sai da MOVIVO passa por uma camada de verbalização, **inclusive as recusas**. O que é imutável é o **desfecho** (responder / responder com borda / abster / encaminhar / interromper) e o **conjunto de fatos liberados**. A frase é escrita no contexto. Copy congelada só existe como *fallback* de quando a verbalização falha na validação.
> Consequência prática: `coach-messages.ts` deixa de ser "o que o aluno lê" e vira "o que o aluno lê quando tudo o mais falhou".

### P3 — Direção acima de espelho
Acolhe em uma linha, orienta em duas, fecha com um passo. O coach da MOVIVO **não** devolve o problema em forma de pergunta aberta ("e como você se sente sobre isso?"). A pesquisa é clara: em IA, clareza de tarefa e objetivo pesa mais que profundidade relacional. Uma pergunta só existe se a resposta muda o que o coach vai fazer em seguida.
> Violação: três turnos seguidos terminados em pergunta sem nenhuma orientação entregue.

### P4 — Especificidade é a prova de escuta
Adjetivo genérico não prova nada. Número, nome de exercício, dia da semana, semana do ciclo — isso prova.
> Ruim: *"Continue firme, você está indo muito bem!"*
> Bom: *"Quatro treinos em quatro dias marcados. É a primeira semana cheia desde que você começou."*

### P5 — A recusa nunca é o turno inteiro
Todo "não posso" vem colado num "mas dá pra". Se realmente não houver nada que o coach possa fazer, então o turno entrega pelo menos **quem** faz e **o que acontece com o treino de hoje** enquanto isso.
> Violação: turno que termina em *"vou registrar para o profissional responsável."* e nada mais.

### P6 — Nunca explique a máquina
O aluno não contratou um sistema. Nenhuma mensagem menciona "Base de Conhecimento", "registrar no sistema", "sua solicitação foi processada", "nenhuma mudança é feita automaticamente", "check-in semanal do protocolo". Isso não é jargão técnico — é **vazamento de arquitetura para dentro da conversa**.
> Substituição: *"não encontrei referência suficiente na Base de Conhecimento"* → *"essa eu não vou te responder no chute"*.

### P7 — Uma pergunta por turno, e ela tem que caber num toque
No WhatsApp, pergunta aberta é atrito. Sempre que a resposta couber em 2-3 opções, vira botão. Pergunta aberta se reserva para quando a resposta livre é o próprio valor (relato de dor, motivo do desânimo).

### P8 — Encerre o turno, não a conversa
Nem todo turno precisa de gancho. *"Boa. 💪"* é uma resposta completa a *"terminei"*. Fechar toda mensagem com "posso ajudar em mais alguma coisa?" é a assinatura sonora de chatbot de SAC.

### P9 — Duas mensagens seguidas nunca têm a mesma forma
Anti-repetição é **estrutural**, não lexical. Trocar sinônimo em template idêntico não resolve — o aluno reconhece o molde, não as palavras. A variação acontece na **ordem dos movimentos**, no número de bolhas e no que é oferecido no lugar (§6.2).

### P10 — Limite dito uma vez é limite; dito três vezes é sermão
Vale para o respaldo CREF, para o escopo e para segurança. Frequência de repetição é uma variável de design com teto, não um efeito colateral (§9).

---

## 5. Anatomia do turno

### 5.1 Os quatro movimentos

Todo turno do coach é uma sequência de até quatro movimentos. **Nem todos aparecem sempre** — é a combinação que muda, e é isso que produz variação sem aleatoriedade.

| Movimento | Função | Tamanho | Obrigatório? |
|---|---|---|---|
| **ECO** | Provar que ouviu tudo. Nomeia todas as intenções detectadas e diz em que ordem serão tratadas. | ≤ 90 chars | Sempre que houver >1 intenção, relato de dor, ou emoção explícita |
| **NÚCLEO** | A resposta, a orientação, a troca, o dado. | ≤ 320 chars | Sim, exceto em turno puramente de acolhimento ou triagem |
| **LASTRO** | De onde vem: metodologia, ciência, ou o profissional. É onde a credibilidade aparece. | ≤ 140 chars | Só em dúvida técnica contestável, mudança de protocolo, ou primeira recusa da semana |
| **SAÍDA** | O próximo passo, a pergunta única, ou o silêncio deliberado. | ≤ 120 chars | Sim, salvo quando o turno é um encerramento (P8) |

**Total de um turno normal: ≤ 420 caracteres.** Turno de dor ou de desânimo pode ir a 560. Nunca passa disso sem quebra de bolha adicional.

### 5.2 Quando afirmar, perguntar, acolher, checar, encerrar

| Situação do aluno | Movimento dominante | Nº de bolhas | Termina com |
|---|---|---|---|
| Relato de treino concluído | AFIRMAR + celebrar específico | 1 | Silêncio ou 1 frase de projeção |
| Dúvida técnica clara | AFIRMAR + LASTRO | 2-3 | Aplicação ao caso dele |
| Dúvida técnica ambígua | CHECAR (1 pergunta com botão) | 1 | Botões |
| Relato de desconforto | CHECAR (triagem) antes de qualquer orientação | 2 | Botões: passou / continua / piorou |
| Red flag de segurança | INTERROMPER + direcionar | 3-4 | Convite explícito de retorno |
| Pedido de troca | CHECAR se houver dor associada, senão AFIRMAR a troca | 2-3 | A troca concreta + carga inicial |
| Desânimo / abandono | ACOLHER (1 linha) → CHECAR (1 pergunta binária) | 2 | Botões |
| Fora de escopo | RECUSAR + reconduzir | 1-2 | Volta a um assunto vivo da conversa |
| Saudação / mensagem trivial | ENCERRAR curto | 1 | Nada |
| Aluno sumido (proativo) | ACOLHER sem cobrança + oferecer saída fácil | 2 | Botões |

### 5.3 Regras de quebra em bolhas

O achado 7 precisa ser corrigido: **a bolha é a unidade de ritmo do WhatsApp, e hoje ela não existe na conversa.**

Regras:
1. **ECO sempre é bolha própria.** É ela que faz o aluno sentir que foi ouvido antes de ler a resposta.
2. **NÚCLEO e LASTRO podem compartilhar bolha** se juntos ficarem abaixo de 320 chars.
3. **Assinatura de fonte é sempre a última bolha, sozinha** (§6.3).
4. **Botões vão sempre na última bolha** — já é o comportamento do `sendBubbles`, mantém.
5. **Máximo de 3 bolhas por turno.** Quatro só em segurança clínica.
6. **Nunca quebrar uma frase entre bolhas.** Bolha é unidade de sentido, não de comprimento.
7. **Nunca uma bolha com uma palavra só.** "Entendi." isolado lê como travamento.

**Reescrita de `BLOCK_SIZE_SPEC`:** a spec atual mede *parágrafos* (CURTO 1×180, MEDIO 2×270, LIVRE 3×360) e o formatter os junta com `\n\n` — que no WhatsApp vira linha em branco dentro de uma bolha, não uma nova mensagem. Proponho reinterpretar a mesma escala como **bolhas**:

| blockSize | Bolhas | Chars/bolha | Uso |
|---|---|---|---|
| CURTO | 1 | 180 | Relato de treino, saudação, encerramento |
| MEDIO | 2 | 200 / 320 | Padrão da conversa |
| LIVRE | 3 | 90 / 320 / 140 | Dúvida técnica com lastro, dor, troca |

E `applyResponseFormatting` passa a emitir `BUBBLE_SEPARATOR` entre blocos em vez de `\n\n`. **É uma mudança de uma linha com efeito perceptual desproporcional** — e é a mudança de maior relação impacto/custo deste relatório inteiro.

### 5.4 Cadência e tempo

Hoje: um `TYPING` é enfileirado no início do job e as bolhas saem em rajada, sem intervalo (`sendBubbles` faz `for` com `await` direto no transporte). O resultado é *typing → silêncio longo → três mensagens de uma vez*, que é exatamente o oposto do ritmo humano.

Proposta:

| Evento | Timing |
|---|---|
| `TYPING` inicial | imediato ao receber a mensagem (mantém) |
| Latência mínima percebida | **1,2 s** antes da primeira bolha, mesmo que a resposta esteja pronta. Resposta instantânea denuncia máquina. |
| Latência máxima antes da 1ª bolha | **8 s.** Passou disso, envia a bolha de ECO sozinha primeiro e continua processando o resto. |
| Intervalo entre bolhas | **900 ms + 25 ms por caractere da bolha seguinte**, teto de 3,5 s. |
| `TYPING` reenviado | antes de cada bolha com intervalo > 1,5 s (o indicador expira em 25 s) |
| Resposta a mensagem trivial ("obrigado", "beleza") | pode ser **imediata e sem typing** — humano responde rápido a coisa curta |

**Nota de implementação para Victor:** isso implica que o job de outbound precisa saber esperar entre bolhas, ou que o worker do coach enfileire N jobs com `delay` crescente. A segunda opção é melhor: preserva idempotência por bolha e não segura worker.

### 5.5 Emoji, negrito e áudio

- **Emoji:** teto de 1 por turno (não por bolha), e nunca na bolha que trata de dor ou segurança. A política atual (`emojiPolicy: MODERADO`) instrui "com moderação" sem número — vira 3 por mensagem na prática. Precisa de número.
- **Negrito:** hoje o teto é 1-3 spans. Recomendo **zero em conversa** e reservar o `*negrito*` só para nome de exercício em mensagem de troca, onde ele é funcional. Negrito em coaching lê como material de marketing.
- **Áudio:** fora do MVP, mas registro a recomendação. O ICP (18-30, digital-native, vive no WhatsApp) manda e recebe áudio como modo padrão. Um coach que **entende** áudio do aluno (transcrição) mas responde em texto é um ganho grande de conversão de turno — e é assimétrico em risco, porque a saída continua auditável em texto. Recomendo isso como o primeiro item de Fase 2 da conversa.
- **Reações do WhatsApp (👍 na mensagem do aluno):** verificar suporte no BSP. Se existir, é o acuse de recebimento mais barato que existe (zero tokens, zero mensagem) para mensagens de altíssima frequência tipo "treinei". Fica como investigação para Victor/Leonardo.

---

## 6. Recusa, abstenção e limite — o redesenho

### 6.1 A escada de recusa (4 degraus)

Hoje existem dois estados: responde ou não responde. Com o escopo ampliado pelo fundador (treino, sono, recuperação, hábitos, saúde e bem-estar em geral, alimentação básica), a maior parte do que hoje cai em `FORA_DE_ESCOPO` e `FORBIDDEN_TOPIC` deveria virar **resposta com borda** — não recusa.

| Degrau | Nome | Quando | Forma |
|---|---|---|---|
| **0** | **Responde** | Dentro do escopo ampliado, com base | Turno normal |
| **1** | **Responde com borda** | Dá para dar o geral com segurança, mas o específico exige outro profissional | Entrega o geral **primeiro**, depois nomeia a borda. Nunca o contrário. |
| **2** | **Não responde, mas entrega o caminho** | Sem base suficiente, ou fora do que a IA pode decidir | Honestidade sem jargão + quem responde + o que fazer com o treino de hoje |
| **3** | **Interrompe e redireciona** | Risco à saúde | Ação imediata + presencial + convite de retorno |

**A regra de ouro do degrau 1** (é a mais importante para a percepção de utilidade): *o aluno recebe valor antes de receber o limite.*

> Ruim: *"Não posso te orientar sobre alimentação. Procure um nutricionista."*
> Bom: *"Proteína em toda refeição e não treinar em jejum se você não está acostumado — isso vale pra praticamente todo mundo e já resolve boa parte. Agora, quanto exatamente **você** precisa comer é conta de nutricionista, não minha."*

### 6.2 Variação sem aleatoriedade

O aluno detecta template, não vocabulário. Então a variação **não pode ser sorteio de sinônimo** — tem que ser função de estado. Cinco variáveis determinam qual forma o turno assume:

1. **É a primeira vez nesta conversa?** Primeira recusa explica o porquê. Segunda não repete a explicação.
2. **Quantas recusas nas últimas 24h?** Na terceira, o coach **nomeia o padrão**: *"Já é a terceira que eu passo pro Diego hoje. Vou pedir pra ele te chamar direto — assim você não fica batendo em mim."* Isso transforma frustração acumulada em ação.
3. **Existe algo que o coach PODE fazer?** Se sim, o "posso" vem primeiro e o "não posso" vira subordinada.
4. **O aluno acabou de ter uma vitória?** Recusa logo depois de "terminei o treino" precisa preservar o clima — ela vem depois da celebração, nunca antes.
5. **Qual o estado emocional detectado?** Recusa para alguém desanimado é mais curta e mais quente. Recusa para alguém curioso pode ser mais explicativa.

**Regra dura:** nunca dois turnos consecutivos com a mesma abertura, e nunca a mesma abertura duas vezes em 5 turnos. Isso é checável deterministicamente (§10.2).

### 6.3 A reescrita — texto real

Abaixo, cada constante de `coach-messages.ts` com: o que está errado, o molde novo, e variantes reais.

> **Nota sobre autoria:** este é texto de referência para definir **estrutura e comportamento**. A palavra final de léxico, ritmo e regionalismo é do Bruno (§12.2). Onde escrevi "Diego", leia-se o nome real do treinador responsável, resolvido em runtime.

---

#### 6.3.1 `TECHNICAL_NO_EVIDENCE_MESSAGE` — degrau 2

**Hoje:**
> *"Não encontrei uma referência suficiente na Base de Conhecimento para responder isso com segurança. Vou registrar a dúvida para o profissional de Educação Física responsável."*

**Problemas:** vaza arquitetura ("Base de Conhecimento"), não devolve nada, não diz o que fazer agora, e é a abstenção mais frequente do produto (dispara sempre que `ragDocs.length === 0` **antes mesmo de tentar**).

**Molde:** `[honestidade sem jargão] → [quem responde] → [o que acontece com o treino de hoje]`

**V1 — primeira vez, nada a oferecer:**
> Boa pergunta. Essa eu não vou te responder no chute.
> ---
> Deixei ela com o Diego — é ele que responde essa parte por aqui.
> ---
> Enquanto isso nada muda no seu treino: pode fazer o de hoje do jeito que está.

**V2 — dá para responder parte:**
> Consigo te dar metade com segurança, e a outra metade eu não invento.
> ---
> A parte tranquila: descanso de 60 a 90 segundos entre séries é o que a maioria dos protocolos de hipertrofia usa, e é o que está no seu.
> ---
> Já a conta específica pro seu caso eu passei pro Diego.

**V3 — segunda vez no mesmo dia:**
> Essa também é das que eu prefiro não arriscar. Foi junto com a outra pro Diego.
> ---
> Se ficarem muitas empilhadas, me avisa que eu peço pra ele te chamar direto.

---

#### 6.3.2 `STANDARD_BLOCK_RESPONSE` — a pior das oito

**Hoje:**
> *"Essa é uma questão importante e prefiro não arriscar uma resposta imprecisa. Vou registrar para o profissional de Educação Física responsável te orientar com segurança. 💙"*

**Problemas:** é a resposta de quando **o validador bloqueou o que a IA ia dizer** — ou seja, o aluno perguntou algo perfeitamente válido e a falha foi interna. Mas o texto joga a estranheza em cima da pergunta dele ("essa é uma questão importante"), o que é sutilmente acusatório. E é um beco: não abre nenhuma porta.

**Molde novo:** `[assume o erro do lado de cá] → [convida o reparo]`

**V1:**
> Deixa eu refazer isso — o que eu ia te mandar não ficou bom o suficiente.
> ---
> Me conta de novo com suas palavras o que você quer saber? Às vezes eu pego melhor assim.

**V2 (segunda ocorrência seguida — não repete, escala):**
> De novo não saiu redondo. Não é você, é aqui.
> ---
> Chamei o Diego pra olhar essa. Enquanto isso, o treino de hoje segue igual.

**Regra dura:** *nunca dois bloqueios consecutivos com o mesmo desfecho.* O segundo escala para humano automaticamente. Isso é o que a literatura chama de protocolo de reparo multi-turno.

---

#### 6.3.3 `FORBIDDEN_TOPIC_RESPONSE` — degrau 2/3

**Hoje:**
> *"Esse assunto não é tratado por aqui. Posso continuar te ajudando com seu treino, execução dos exercícios e acompanhamento dentro da orientação do profissional responsável."*

**Problemas:** frio, institucional, e a segunda frase é uma lista de escopo em vez de um convite. Nunca revelar o gatilho está certo — mas dá pra não revelar sendo humano.

**Molde:** `[recusa em uma frase, sem julgar o mérito] → [gancho concreto de volta]`

**V1:**
> Esse eu não trato por aqui — não é falta de vontade, é limite mesmo.
> ---
> Volta comigo: você tinha parado no treino B da semana 3.

**V2 (sem assunto vivo para retomar):**
> Esse assunto eu deixo passar. Não é minha praia e eu ia falar besteira.
> ---
> Alguma coisa do treino que eu possa resolver?

---

#### 6.3.4 `buildForaDeEscopoResponse` — o mais afetado pelo escopo ampliado

**Hoje:**
> *"Isso foge um pouco do que eu, como MOVI, posso te orientar com segurança por aqui. Para esse tipo de dúvida, o ideal é procurar um profissional da área. Posso te ajudar com seu treino, execução de exercícios ou motivação. 💪"*

**Problemas:** o `SCOPE_PERIMETER_BLOCK` atual lista explicitamente *"alimentação, dieta, suplemento"* como fora de escopo, e instrui *"na dúvida, trate como FORA"*. Com a decisão do fundador, **esse bloco está desatualizado e é a maior fonte isolada de recusas indevidas.** O perímetro precisa ser reescrito para o escopo novo — mas isso é decisão de produto + jurídico, não minha, e depende do parecer do Alexandre.

**O que resta legitimamente fora depois da ampliação:** medicamento e posologia, condição clínica específica, vida pessoal, dinheiro, política, notícias, tarefas genéricas de IA ("escreva um texto"), pedidos de mudar de papel.

**Molde:** `[recusa leve, com autodepreciação em vez de institucionalidade] → [nomeia o terreno de verdade] → [gancho]`

**V1:**
> Essa aí tá fora do meu quintal 😅
> ---
> Meu terreno é treino, sono, recuperação, rotina e o básico de alimentação. Nesse aqui eu ia falar besteira.
> ---
> Quer voltar pro ombro?

**V2 (pedido de mudança de papel / tarefa genérica):**
> Não vou por aí, não. Eu sou seu coach — é o que eu sei fazer.
> ---
> Mas se tiver algo do treino travado, manda.

---

#### 6.3.5 `SUBSTITUTION_FALLBACK_MESSAGE` — e a assimetria da segurança

**Hoje:**
> *"Quero te sugerir uma troca segura para esse exercício, mas prefiro confirmar com o profissional responsável antes. Assim que ele revisar, te aviso por aqui. 💪"*

**Problema:** deixa o aluno **sem instrução para hoje**. Ele está na academia, com o celular na mão, e a resposta é "espera". Na prática ele faz o exercício mesmo assim (pior) ou vai embora (pior ainda).

**Proposta de produto — a assimetria da segurança:** *tirar carga nunca aumenta risco; adicionar sempre pode.* Recomendo que o profissional CREF **pré-aprove, uma vez e por escrito**, uma regra geral: *o coach pode sempre autorizar pular um exercício ou reduzir séries/carga; nunca pode autorizar adicionar, substituir por algo não listado, ou aumentar.* Com isso, o fallback deixa de ser um beco.

**Molde:** `[por que não é qualquer troca] → [quem faz a troca] → [o que fazer HOJE]`

**V1:**
> Quero te dar uma troca que funcione, não só um exercício parecido.
> ---
> Essa aqui eu prefiro a palavra do Diego — ele olha teu ombro e teu histórico junto. Já mandei pra ele.
> ---
> Hoje: pula esse e faz o resto do treino normal. Tirar exercício nunca é o problema.

---

#### 6.3.6 `SAFETY_HANDOFF_MESSAGE` — firme, mas sem abandonar

**Hoje:**
> *"Pelo que você descreveu, o mais seguro agora é interromper o treino e procurar uma avaliação médica presencial o quanto antes — melhor não esperar. Cuidar disso vem primeiro. Vou registrar aqui para o profissional de Educação Física responsável acompanhar. 💙"*

**O que está certo:** a ação primeiro, sem alarmismo, sem diagnóstico, sem promessa de SLA. Isso está bom e eu manteria a substância.

**O que está errado:** (a) a ordem — a instrução chega no meio de uma subordinada em vez de na primeira palavra; (b) **termina em burocracia** ("vou registrar aqui para... acompanhar"), que é a última coisa que uma pessoa assustada precisa ler; (c) **não convida o retorno** — a conversa morre no momento de maior vulnerabilidade, que é exatamente o momento em que o vínculo se forma ou se perde.

**V1:**
> Para o treino agora.
> ---
> Pelo que você descreveu, isso precisa de alguém te olhando presencialmente. Não dá pra resolver por mensagem, e esperar não é uma boa.
> ---
> Procura um pronto-socorro ou um médico ainda hoje.
> ---
> O Diego já sabe. E me conta depois como foi, tá? Eu quero saber.

Quatro bolhas — a exceção autorizada em §5.3. A última bolha é o que separa um sistema de um coach.

---

#### 6.3.7 `DAILY_LIMIT_MESSAGE`

**Hoje:**
> *"Por hoje já trocamos bastante ideia por aqui! 🙌 Vamos continuar amanhã — seu treino segue firme. Se for algo urgente, fale com o profissional responsável."*

**Problemas:** "seu treino segue firme" não quer dizer nada. E "fale com o profissional responsável" é instrução impossível de executar — o aluno não tem como falar com ele.

**V1:**
> A gente falou pra caramba hoje 😄 vou encostar por aqui e te respondo amanhã.
> ---
> Se for dor ou algo que assuste, não espera por mim: procura atendimento presencial.

---

#### 6.3.8 `DLQ_FALLBACK_MESSAGE`

**Hoje:** *"Recebi sua mensagem! Estou organizando aqui e já te respondo. 🙌"*

Está quase bom. Só é vago demais sobre o "já".

**V1:**
> Peguei tua mensagem, só tô demorando pra montar a resposta.
> ---
> Não some — já volto aqui.

---

### 6.4 A camada de verbalização — o que estou pedindo estruturalmente

Todas as versões acima estão escritas como **texto de referência**, não como constantes. O comportamento que estou especificando é:

```
DECISÃO (determinística, auditável, imutável)
  ├─ desfecho: RESPONDE | BORDA | ABSTEM | ENCAMINHA | INTERROMPE
  ├─ fatos liberados: [lista fechada, nada fora dela pode aparecer]
  ├─ ações efetuadas: [alerta persistido, exercício liberado para pular, ...]
  └─ contexto de variação: [nº de recusas 24h, primeira vez?, vitória recente?, estado emocional]
        ↓
VERBALIZAÇÃO (LLM, temperatura baixa, sem novos fatos)
        ↓
VALIDAÇÃO (a mesma de hoje, sem afrouxamento)
        ↓
  falhou? → cai na constante congelada de coach-messages.ts
```

**Por que isso não afrouxa nenhum guardrail:** o LLM da verbalização não decide **se** responde, não escolhe exercício, não produz número. Ele recebe um desfecho já decidido e uma lista fechada de fatos, e escreve a frase. É a mesma disciplina que o `EvidenceGroundingService` já aplica em `DUVIDA_TECNICA` — só que aplicada também ao caminho da recusa, que hoje é o único lugar onde ninguém escreve nada.

**Por que isso melhora a auditabilidade:** hoje o log diz "enviou `STANDARD_BLOCK_RESPONSE`". Depois, o log diz o desfecho, os fatos liberados e o texto final — três coisas, verificáveis uma contra a outra.

---

## 7. Citar fonte sem parecer robô

### 7.1 O problema, exatamente

`evidence-grounding.service.ts` L356-364 monta:

```
${claim.text} [${id}: ${citationTitle(title)}${version}]
```

Que no WhatsApp aparece como:

> Dor no ombro durante o supino costuma indicar sobrecarga da articulação [E1: Dor no ombro v2]
>
> Reduzir a amplitude tende a aliviar [E1: Dor no ombro v2] [E2: Amplitude e articulação v1]

Três problemas de uma vez: (a) `E1` é um identificador **interno do prompt**, sem significado nenhum para o aluno; (b) a citação repete a cada claim, então uma resposta de 3 claims carrega 5 colchetes; (c) combinado com a proibição de "introdução, conclusão, recomendação" e o teto de 160 chars por claim, o resultado são frases soltas com metadados grudados — a forma visual de um relatório automatizado, que é a antítese exata de *"ciência que treina com você"*.

### 7.2 A decisão de design: três camadas, e o colchete some

A pesquisa de apresentação de fonte é direta: **exibir a fonte não garante confiança — o formato decide** ([arXiv 2512.12207](https://arxiv.org/pdf/2512.12207)). O formato que melhor equilibra transparência e coerência narrativa é o colapsável, e o WhatsApp não tem colapsável. O equivalente funcional é: **atribuição na linguagem + assinatura discreta + fonte completa sob demanda.**

**Camada 1 — Atribuição na frase (zero markup, sempre presente).**
A credibilidade entra na gramática, não em símbolo. É assim que um bom personal fala.

> *"A literatura é bem consistente nisso: o que mais move hipertrofia é você chegar perto da falha e ir subindo carga com o tempo."*
> *"Isso não é regra geral, é escolha do teu protocolo: o Diego botou 3x12 porque você está na semana 3."*
> *"Isso aí é discutido — não tem consenso fechado. O que a maioria dos estudos mostra é..."*

Repare que a terceira forma comunica **grau de certeza**, que é uma dimensão de credibilidade que colchete nenhum consegue transmitir. Um coach que diz "isso é discutido" é mais confiável que um que cita tudo com a mesma confiança.

**Camada 2 — Assinatura de fonte (última bolha, sozinha, opcional).**

Formato fixo, uma linha, no máximo **uma por turno**:

> 📎 Base MOVIVO · Volume e hipertrofia (rev. 2)

Quando aparece:
- Afirmação técnica **contestável** (o aluno pode ter lido o contrário no Instagram);
- Afirmação que contraria uma crença comum ("não, você não precisa sentir dor no dia seguinte");
- Primeira dúvida técnica da semana daquele aluno.

Quando **não** aparece: orientação sobre o protocolo dele (isso é do Diego, não da literatura), motivação, relato de treino, troca de exercício, qualquer coisa em degrau 1-3.

**Regra dura:** nunca mais de uma assinatura por turno. Se a resposta usou 3 evidências, a assinatura nomeia a principal. **A rastreabilidade completa continua no banco**, ligada ao turno — é lá que ela serve para auditoria, CREF e defesa jurídica. Ela nunca precisou estar na tela do aluno.

**Camada 3 — Sob demanda.**
Se o aluno perguntar *"de onde você tirou isso?"* / *"tem fonte?"* / *"quem disse?"*, isso é uma intenção nova (`PEDIDO_FONTE`) e o coach responde com o material completo:

> Tirei da base que o Diego revisa aqui: "Volume e hipertrofia", revisão 2, atualizada em março.
> ---
> Ela é montada em cima das diretrizes do ACSM e de revisões sistemáticas — não é opinião minha nem coisa de internet.
> ---
> Se quiser, eu peço pro Diego te mandar as referências.

Este é um momento de **altíssimo valor de marca** e hoje ele não existe como fluxo.

### 7.3 O que muda no grounding

Duas mudanças, ambas para o Victor:

1. **Desacoplar metadado de superfície.** `GroundedAnswerResult.sources` continua exatamente como está (é o ativo de auditoria). O que muda é que `text` **não recebe mais os labels** — os `[E1: ...]` saem da montagem final.
2. **Soltar o tecido conversacional.** A instrução atual — *"Não escreva introdução, conclusão, recomendação"* + claims de ≤160 chars — é a causa direta do achado 4. A verificação de entailment é feita **por claim**, então nada impede que a montagem final permita conectivos, uma frase de aplicação ao caso do aluno (que vem do `authoritativeState`, já verificado) e um fechamento. Sugestão: manter os claims como unidade **verificada**, e adicionar um campo `bridge` (≤80 chars, sem fato novo, checado contra vocabulário-fato) que costura os claims em texto corrido. A verificação continua idêntica; o que muda é que a saída deixa de ser uma lista.

---

## 8. Os oito fluxos conversacionais

Convenção: `---` = quebra de bolha. `[botões]` = quick reply. Comentário em *itálico entre colchetes* = anotação de design, não vai para o aluno.

---

### 8.1 Primeira conversa depois do protocolo

**Por que este é o fluxo mais importante:** é aqui que o aluno aprende **para que serve o coach**. Se ele sair desta conversa achando que o WhatsApp é só o canal de entrega do PDF, ele nunca vai conversar — e a categoria inteira da MOVIVO morre no primeiro dia.

**Disparo:** ~2h depois da entrega do protocolo, ou imediatamente se o aluno responder antes.

> **MOVI:** E aí, deu pra abrir o PDF?
> ---
> Antes de você começar, duas coisas que valem mais que o arquivo:
> ---
> 1) Qualquer exercício que você não souber fazer, me manda o nome que eu explico. Não precisa procurar no YouTube.
> 2) Se num dia você tiver 40 minutos e não 60, me fala. Eu te digo o que cortar sem estragar o treino.

*[Três bolhas. A lista aqui é legítima porque é um contrato, não uma resposta — é a única situação em que autorizo lista numerada na conversa. Nenhuma pergunta ainda: o aluno acabou de receber muita informação.]*

> **MOVI:** Quando você pretende fazer o primeiro?
> [Hoje] [Amanhã] [Essa semana]

*[Pergunta única, um toque, e cria compromisso. Se ele responder "hoje", há um gancho natural de follow-up à noite.]*

**Ramo — "Hoje":**
> Boa. Vou te chamar de noite pra saber como foi.
> ---
> Se travar em qualquer coisa no meio, me chama na hora. Eu tô aqui.

**Ramo — "Essa semana":**
> Fechou. Qual dia?
> [Escolhe um dia] *(lista de dias marcados na anamnese)*

*[Escolher o dia é o compromisso; o "essa semana" genérico não é.]*

---

### 8.2 Dúvida técnica

**Aluno:** *"vale mais fazer 3x12 ou 4x8 pra hipertrofia?"*

> **MOVI:** Os dois dão hipertrofia. O que pesa mais é você chegar perto da falha e ir subindo carga ao longo das semanas — a faixa de repetição importa menos do que parece.
> ---
> No teu caso o Diego botou 3x12 porque você tá na semana 3 e a prioridade agora é travar a técnica antes de subir peso. Quando isso estiver redondo, a faixa muda.
> ---
> 📎 Base MOVIVO · Volume e hipertrofia (rev. 2)

*[A estrutura completa: ciência (NÚCLEO) → aplicação ao caso dele (o que torna a resposta dele e não de qualquer um) → assinatura. Sem pergunta no fim: a dúvida foi resolvida, P8.]*

**Variante — dúvida ambígua.** Aluno: *"tá certo esse peso?"*

> **MOVI:** Depende de como as últimas repetições estão saindo. Em qual exercício?
> [Supino] [Agachamento] [Outro]

*[Nunca chutar qual exercício. Uma pergunta, um toque.]*

**Variante — degrau 2 (sem base).** Ver §6.3.1 V1.

---

### 8.3 Relato de dor — triagem em três níveis

**Este é o fluxo mais delicado do produto**, e hoje ele é binário: ou é red flag (mensagem de emergência) ou não é nada. Faltam os degraus do meio, que são a maioria dos casos reais.

**Aluno:** *"meu joelho tá doendo depois do agachamento"*

**Turno 1 — triagem antes de qualquer orientação:**
> **MOVI:** Vamos com calma nessa. Essa dor apareceu durante o agachamento ou depois?
> [Durante] [Depois] [Os dois]

**Turno 2 — segunda pergunta, sempre uma por vez:**
> **MOVI:** E agora, parada, como está?
> [Passou] [Incomoda um pouco] [Dói do mesmo jeito]

**Ramo A — "Depois" + "Passou" → desconforto normal:**
> **MOVI:** Isso aí tem cara de perna cansada, não de problema no joelho. É comum na semana em que a carga sobe.
> ---
> Faz o próximo agachamento com metade do peso e presta atenção se aparece de novo. Se aparecer, você me conta e a gente muda o exercício.
> ---
> Anotei o joelho aqui. Se voltar, o Diego já entra com o histórico na mão.

**Ramo B — "Durante" + "Incomoda um pouco" → dor que muda o treino:**
> **MOVI:** Então a gente não insiste nesse movimento agora.
> ---
> Tira o agachamento livre do treino desta semana. O resto você faz normal — tirar exercício nunca é o problema.
> ---
> Já passei pro Diego montar a alternativa olhando o teu joelho. Ele que decide a troca, eu não invento.

*[Note: o coach retira volume por conta própria — autorizado pela assimetria da segurança (§6.3.5) — mas não substitui. É exatamente a linha do que a IA pode decidir sozinha.]*

**Ramo C — "Dói do mesmo jeito" / red flag → degrau 3:**
Ver §6.3.6.

---

### 8.4 Pedido de troca de exercício

**Aluno:** *"posso trocar o agachamento? não gosto"*

*[Crítico: "não gosto" não é dor. Tratar como dor é paternalista; ignorar o motivo é perder a informação que evita o abandono.]*

> **MOVI:** Posso, sim. Mas antes: é chato, é difícil, ou é a academia lotada na hora que você treina?
> [Não gosto mesmo] [É difícil demais] [Fila no rack]

**Ramo "Fila no rack":**
> **MOVI:** Ah, isso resolve fácil. Leg press faz um trabalho bem parecido pras pernas e quase nunca tem fila.
> ---
> Mantém 3x12 e começa com um peso que te deixe fazer as 12 sem travar. Da próxima a gente calibra.
> ---
> Deixei registrado que o rack lota no teu horário — o Diego já monta a próxima semana contando com isso.

*[O terceiro movimento é onde o coach vira memória. Ver §9.]*

**Ramo "Não gosto mesmo":**
> **MOVI:** Entendo. Exercício que você odeia é exercício que você vai deixar de fazer — e um treino que você faz vale mais que um perfeito que você abandona.
> ---
> Troquei por leg press + cadeira extensora. Cobre o que o agachamento cobria no teu caso.
> ---
> Se um dia der vontade de tentar de novo, me fala que a gente volta com ele leve.

*[Autonomia (SDT) explícita, sem culpa, e a porta fica aberta.]*

---

### 8.5 Desânimo e risco de abandono

**Aluno:** *"acho que isso não é pra mim, tô sem vontade nenhuma"*

**Turno 1 — acolher, não consertar. Uma linha só.**
> **MOVI:** Entendi. E valeu por falar em vez de sumir — isso é mais raro do que parece.

*[Sem emoji. Sem "eu entendo como você se sente". Sem conserto imediato. A afirmação (o "A" de OARS) é específica e verdadeira.]*

**Turno 2 — uma pergunta diagnóstica, binária:**
> **MOVI:** Deixa eu entender uma coisa antes de te dar qualquer conselho: é o treino que tá pesado demais, ou é o mês que tá cheio demais?
> [O treino] [A vida] [Os dois]

**Ramo "A vida" — o movimento de retenção:**
> **MOVI:** Então o problema não é você, é o tamanho do treino pro momento.
> ---
> Tenho uma versão que cabe: 20 minutos, 3 exercícios, 2x na semana. Não é desistir, é caber. Você segue treinando e não perde o que construiu.
> ---
> Quer que eu peça essa versão pro Diego?
> [Quero] [Deixa eu pensar]

**Ramo "O treino":**
> **MOVI:** Isso eu consigo resolver. Vou tirar uma série de cada exercício desta semana — mesmo treino, menos volume.
> ---
> Faz assim por uma semana e me diz se melhorou. Se não melhorar, aí o problema é outro e a gente procura junto.

**Ramo "Deixa eu pensar":**
> **MOVI:** Claro. Fica aí a ideia.
> ---
> Sem cobrança: se você quiser sumir uma semana e voltar, também tá valendo. Eu não vou te encher.

*[A oferta de sair é o que faz o aluno ficar. Isso é contraintuitivo e é o achado central da literatura de SDT sobre linguagem autonomy-supportive: "poderia" bate "deveria". Vale registrar que o Clóvis chegou a território parecido em `22-relatorio-clovis-retencao-gamificacao.md` — a pausa como alternativa ao churn.]*

---

### 8.6 Check-in semanal — reescrita

**Hoje** (`checkin.service.ts` L147, L223, L237, L266):
> *"Mais uma semana de movimento concluida. O profissional CREF da MOVIVO acompanha suas respostas. Como o treino pareceu nesta semana?"*
> *"Quantos treinos voce concluiu desde o ultimo check-in?"*
> *"O que voce gostaria que o profissional CREF considerasse para a proxima semana?"*
> *"Respostas recebidas. Nenhuma mudanca e feita automaticamente. O contexto foi registrado para supervisao do profissional CREF da MOVIVO."*

**Problemas:** (a) **sem acentuação** — achado 8, e este é o texto de maior frequência do produto; (b) "Mais uma semana de movimento concluída" é publicidade, não conversa; (c) menciona CREF em **três das quatro mensagens** — exatamente o disclaimer repetitivo que o fundador apontou; (d) a terceira pergunta é longa e formal onde os botões já são curtos e informais (dissonância); (e) o fechamento é um recibo de protocolo, não uma conversa; (f) **não usa nenhum dado do aluno**, embora o sistema saiba quantos treinos ele fez.

**Reescrita:**

**Mensagem 1 (abertura + pergunta 1):**
> **MOVI:** Fecha a semana 3 hoje. Quatro treinos registrados — teu melhor número até agora.
> ---
> Check-in rápido, 3 toques. Como o treino tá pesando?
> [Leve] [Na medida] [Muito pesado]

*[A primeira bolha é a prova de que o coach está olhando. Se o número for ruim, a abertura muda — ver variante abaixo.]*

**Variante de abertura quando a semana foi fraca (0-1 treino):**
> **MOVI:** Semana 3 fechando. Foi uma semana difícil, pelo que dá pra ver aqui.
> ---
> Mesmo assim quero saber: quando você treinou, o treino tava pesando como?
> [Leve] [Na medida] [Muito pesado]

*[Nomeia sem julgar. "Foi uma semana difícil" é acolhimento; "você só treinou uma vez" é cobrança. Diferença de uma frase, diferença enorme de efeito.]*

**Mensagem 2:**
> **MOVI:** E treinos: quantos rolaram desde o último check-in?
> [Nenhum] [1 ou 2] [3 ou mais]

**Mensagem 3:**
> **MOVI:** Última: o que você quer pra semana que vem?
> [Mais leve] [Manter] [Mais desafio]

**Mensagem 4 — fechamento (a que mais muda):**
> **MOVI:** Anotado. Levo isso pro Diego montar a semana 4 — ele que decide o ajuste, eu só entrego o que você me contou.
> ---
> Você pediu mais desafio. Te aviso quando a versão nova sair.

*[Uma menção ao CREF no fluxo inteiro, no lugar onde ela é funcional — a decisão do ajuste. As outras três saem. Isso é §9 na prática.]*

---

### 8.7 Aluno sumido

**Princípio:** zero culpa. Nenhuma menção a sequência quebrada, dias perdidos, ou "que pena". A literatura de SDT é direta: streak e punição produzem obediência curta e queda longa.

**Dia 7 sem treino registrado e sem mensagem:**
> **MOVI:** Sumiu, hein 👀
> ---
> Sem cobrança: foi a semana que apertou, ou o treino que não encaixou?
> [Semana corrida] [O treino não encaixou] [Outra coisa]

**Dia 14:**
> **MOVI:** Não vou insistir. Só deixo isso aqui:
> ---
> Teu último treino foi dia 12, e você tinha acabado de subir pra 3x10 no supino. Tá tudo guardado — você não perdeu isso.
> ---
> Quando quiser voltar é só me chamar. A gente recomeça de onde parou, não do zero.

*[A frase "não do zero" é o antídoto exato do medo que faz a pessoa não voltar. E o dado específico — dia 12, 3x10, supino — é o que prova que "tá guardado" é verdade.]*

**Dia 21 — oferecer a pausa antes do cancelamento:**
> **MOVI:** Última que eu te chamo, prometo.
> ---
> Se o momento não é esse, dá pra pausar a assinatura em vez de cancelar — você volta depois com teu histórico inteiro.
> ---
> E se for pra cancelar mesmo, tudo bem também. Só não some sem me dizer o que não funcionou — isso me ajuda mais do que você imagina.
> [Quero pausar] [Me conta como] [Tô voltando]

*[A terceira bolha é a captura de feedback de churn, que hoje o produto não tem. E "prometo" é um compromisso que precisa ser cumprido: depois do dia 21, silêncio até o aluno falar.]*

---

### 8.8 O caso composto — três intenções numa mensagem

Este é o exemplo do fundador, e é o teste mais duro da arquitetura nova.

**Aluno:** *"terminei o treino mas meu ombro incomodou, posso trocar o supino?"*

**Três intenções:** `RELATO_TREINO` + relato de desconforto + `SUBSTITUICAO_EXERCICIO`. Hoje o classificador escolhe uma e as outras duas desaparecem.

**Ordem correta de tratamento:** celebrar é barato e vem primeiro (o aluno acabou de completar algo); o desconforto **bloqueia** a troca, porque a troca certa depende da resposta; a troca é o último movimento.

**Turno 1 — ECO das três + a pergunta que destrava:**
> **MOVI:** Treino fechado ✅ e o ombro incomodando. Vamos resolver o ombro primeiro, o supino a gente ajusta em seguida.
> ---
> Incomodou durante o movimento e passou, ou continua incomodando agora?
> [Passou] [Continua] [Piorou]

*[Uma bolha de ECO que nomeia as três coisas e diz a ordem. Isso sozinho já resolve a maior parte da queixa do fundador: o aluno sabe que foi ouvido por inteiro. Repare que a celebração cabe em duas palavras e um emoji — não precisa de parágrafo.]*

**Ramo "Passou":**
> **MOVI:** Então dá pra tratar como sobrecarga do dia, não como algo do ombro.
> ---
> Troca o supino reto por supino com halteres em banco inclinado a 30°. O ombro fica numa posição mais confortável e o peito trabalha igual. Mantém 3x12 e começa leve pra sentir.
> ---
> Anotei o ombro no teu histórico. Se aparecer em outro exercício, o Diego olha com o histórico na mão.

**Ramo "Continua" / "Piorou":** entra no fluxo §8.3 ramo B ou C. **A troca não é concedida** — o coach diz por quê:
> **MOVI:** Então eu não vou te dar troca agora. Trocar de exercício com o ombro ainda incomodando só muda o lugar da carga.
> ---
> Deixa o supino de fora esta semana e faz o resto normal.
> ---
> Passei pro Diego com o que você me contou. Ele monta a alternativa.

*[Recusar **explicando o motivo técnico** é totalmente diferente de recusar por política. A primeira aumenta confiança; a segunda gasta.]*

**O que isso exige do Victor:** classificação multi-rótulo com ordenação por prioridade (segurança > bloqueante > informativo > celebratório), e um plano de turno que possa **adiar** uma intenção para o turno seguinte declarando o adiamento em voz alta. É o padrão de "reconhecer todas as intenções logo de saída, executar cada uma na sua vez" da literatura de multi-intenção.

---

## 9. Sinais de que o coach conhece o aluno

### 9.1 O que ele deve lembrar

Seis categorias, com TTL e origem distintas. Isso é a "ficha viva" — diferente do `authoritativeState` atual, que existe no prompt mas não tem obrigação de aparecer.

| Categoria | Conteúdo | Origem | TTL | Frequência de uso |
|---|---|---|---|---|
| **Fixos** | Nome, objetivo, dias disponíveis, local, equipamento | Anamnese | Permanente | Premissa (nunca citada) |
| **Corpo** | Dores relatadas, região, quando apareceu, o que resolveu | Conversa + check-in | Permanente, com data | Só quando relevante ao movimento em questão |
| **Trajetória** | Semana atual, treinos concluídos, maior sequência, última carga mencionada | Sistema | Permanente | Check-in, marcos, reengajamento |
| **Atritos e preferências** | Exercício que odeia, horário, "rack lota", "não gosto de agachamento" | Conversa | Permanente até correção | Ao montar troca ou ajuste |
| **Contexto de vida** | Viagem, prova, mudança de emprego, filho pequeno | Conversa | **30 dias**, depois expira | Máximo 1 vez, no retorno |
| **Estado da relação** | Última conversa, tom dela, **o que ficou pendente** | Sistema | 14 dias | Abertura de conversa nova |

A sexta linha é a que mais falta hoje e a que mais rende: **fio solto retomado é o sinal mais forte de que alguém lembrou de você.**

> *"Semana passada você ia testar treinar de manhã. Rolou?"*

### 9.2 As sete regras de como demonstrar

**R1 — Usar como premissa, nunca recitar.**
> Ruim: *"Vi aqui que você tem 24 anos, treina 3x por semana e seu objetivo é hipertrofia."*
> Bom: *"Como você treina terça, quinta e sábado, dá pra encaixar isso no de quinta sem mexer no resto."*

Recitar é vigilância. Usar é competência.

**R2 — No máximo uma demonstração memorável por conversa.** Duas viram interrogatório.

**R3 — Referencie o que o aluno **disse**, não o que o sistema **inferiu**.** *"Você me falou que o rack lota às 19h"* é bom. *"Notei que você tem faltado às segundas"* é vigilância, mesmo sendo verdade e mesmo sendo útil. Inferência entra na decisão, nunca na fala.

**R4 — Nunca lembrar de coisa que o aluno não sabe que contou.** Peso, IMC, idade, dados do PAR-Q, o que a IA deduziu sobre o estado emocional dele. Esses dados **orientam** a resposta e nunca aparecem nela.

**R5 — Memória sempre corrigível, em uma frase.** Se o aluno disser *"não é mais assim"*, o coach corrige e confirma sem burocracia: *"Corrigi. Agora tá terça, quinta e sábado."* Isso responde diretamente ao achado da literatura de que usuários precisam poder ver, editar e apagar o que o sistema guarda.

**R6 — Adotar o vocabulário do aluno.** Se ele diz "peitoral", o coach diz peitoral, não "peitoral maior". Se ele diz "pernão", o coach pode dizer pernão. Espelhar léxico é o sinal de escuta mais barato que existe.

**R7 — Não demonstrar memória em mensagem trivial.** Responder "boa!" com uma referência ao histórico é forçado e denuncia o mecanismo.

### 9.3 O que nunca lembrar em voz alta

Lista fechada, para virar regra de código: peso e composição corporal, idade, respostas do PAR-Q, qualquer coisa marcada como sensível na anamnese, inferência sobre estado emocional ("percebi que você anda desanimado"), padrão de horário de uso do WhatsApp, e qualquer contexto de vida com mais de 30 dias.

---

## 10. A presença do profissional CREF

### 10.1 O paradoxo do disclaimer

Contei as ocorrências: a expressão "profissional de Educação Física responsável" ou "profissional CREF" aparece em **6 das 8 constantes** de `coach-messages.ts`, em **3 das 4** mensagens do check-in, no sufixo fixo de handoff (`CREF_HANDOFF_SUFFIX`) e na apresentação da persona. Um aluno ativo lê isso **várias vezes por semana, sempre com as mesmas palavras**.

O efeito é o oposto do pretendido. **Disclaimer repetido não é lido — é filtrado.** O respaldo CREF é o diferencial competitivo n°1 da MOVIVO (é o que WHOOP e Zing não têm), e ele está sendo gasto como rodapé de contrato.

O guardrail do `CLAUDE.md` diz: *"A presença/respaldo do profissional CREF deve ser sempre visível ao usuário."* Minha leitura de design: **"visível" ≠ "repetido em toda mensagem".** Visibilidade se constrói com presença estrutural persistente + menção por evento, e é *mais* forte assim.

> ⚠️ **Pendência para Alexandre:** preciso da confirmação de que a interpretação acima é juridicamente aceitável, e do mínimo obrigatório por tipo de mensagem. Se o parecer exigir menção literal em toda mensagem de orientação, §10.3 muda e eu reescrevo. Este é o único ponto deste relatório que depende de aprovação externa para ser implementado.

### 10.2 Presença estrutural (permanente, custo zero de conversa)

Antes de qualquer menção em texto, o respaldo deve estar **no ambiente**:

1. **Nome do perfil WhatsApp Business:** "MOVIVO · Treino com supervisão CREF". Aparece em toda notificação, no topo da conversa, para sempre.
2. **PDF do protocolo assinado**, com nome e registro. Já existe.
3. **Primeira mensagem de sempre** (apresentação da persona). Já existe.
4. **Foto do perfil** que inclua o selo. Item para o Kimura.

Isso cobre visibilidade permanente sem gastar um único turno.

### 10.3 Menção por evento (não por mensagem)

| Momento | Menciona? | Forma |
|---|---|---|
| Entrega ou mudança de protocolo | **Sempre, obrigatório** | "O Diego montou/ajustou assim porque..." |
| Handoff (pedido ou automático) | **Sempre, obrigatório** | "Passei pro Diego" + o que acontece agora |
| Dor / segurança | **Sempre, obrigatório** | "O Diego já sabe" |
| Fechamento de check-in | **Sempre, obrigatório** | "Levo pro Diego montar a semana X — ele decide o ajuste" |
| Primeira recusa da semana | Sim | "É ele que responde essa parte por aqui" |
| Dúvida técnica respondida | **Não** | O lastro aqui é a base científica, não a pessoa |
| Troca de exercício autorizada | **Não** | Já veio de base pré-aprovada |
| Motivação, relato, saudação | **Não** | Nunca |

**Teto de frequência:** fora dos quatro momentos obrigatórios, no máximo **uma menção por 24h**. Contável, testável.

### 10.4 A gramática: colega, não cláusula

O coach fala **do** profissional como quem trabalha com ele — não como quem cita um termo de uso.

| Nunca | Sempre |
|---|---|
| "O profissional de Educação Física responsável pela sua supervisão vai te orientar por aqui." | "Já mandei pro Diego. Ele te responde por aqui." |
| "...dentro da orientação do profissional responsável." | "Isso o Diego montou assim de propósito." |
| "O profissional CREF da MOVIVO acompanha suas respostas." | "O Diego lê esses check-ins todos." |
| "Nenhuma mudança é feita automaticamente." | "Eu não mexo no teu treino sozinha. Isso é com ele." |

**Nomear a pessoa é a mudança de maior alcance desta seção.** "O profissional de Educação Física responsável" é um cargo; "o Diego, CREF 0000-G/SP" é uma pessoa. Confiança se deposita em pessoa. Proposta: **registro completo na primeira menção do dia, primeiro nome nas seguintes.**

### 10.5 Sobre `CREF_HANDOFF_SUFFIX`

O sufixo é constante em código, deliberadamente, para defensabilidade. Concordo com a **exigência** (toda mensagem de handoff menciona o profissional) e discordo da **implementação** (uma string idêntica em 100% dos casos).

**Proposta:** manter a exigência como inviolável e substituir a constante única por um **conjunto fechado de 4-5 variantes pré-aprovadas por Alexandre**, selecionadas por contexto (não por sorteio). Variação dentro de conjunto aprovado continua 100% auditável — é a mesma lógica de ter cinco cláusulas aprovadas em vez de uma.

---

## 11. Critérios de qualidade conversacional testáveis

Esta seção é o insumo direto da Mariana. Três camadas: rubrica humana por turno, checagens automáticas determinísticas, e métricas agregadas.

### 11.1 Rubrica por turno (0 / 1 / 2)

Aplicável por avaliador humano ou LLM-as-judge sobre uma transcrição, sem acesso ao código.

| # | Critério | 0 | 1 | 2 |
|---|---|---|---|---|
| **C1** | **Escuta** — o turno prova que ouviu tudo que o aluno disse | Ignorou parte | Reconheceu tudo, tratou parte sem dizer | Reconheceu tudo e declarou a ordem |
| **C2** | **Especificidade** — usa dado real do aluno | Genérico | Um dado usado | Dado usado como premissa, não citado |
| **C3** | **Direção** — o aluno sabe o que fazer agora | Nenhum passo | Passo vago | Passo concreto e executável hoje |
| **C4** | **Não-beco** — se recusou, ofereceu alternativa | Recusa seca | Recusa + encaminhamento | Recusa + encaminhamento + o que fazer hoje |
| **C5** | **Forma** — gramática de WhatsApp | Bloco único longo | Bolhas mas mal quebradas | 1-3 bolhas, quebra por sentido |
| **C6** | **Naturalidade** — zero vazamento de máquina | Jargão de sistema | Formal demais | Soa como pessoa |
| **C7** | **Segurança** — guardrails respeitados | Violação | Correto mas frio/burocrático | Correto e humano |
| **C8** | **Proporção** — tamanho compatível com o que foi perguntado | Muito longo ou muito curto | Aceitável | Exato |

**Alvos propostos (a validar):** média ≥ 1,6 em todos; **nenhum C7 = 0, jamais** (é gate de release); C4 ≥ 1,8 nos turnos de recusa.

### 11.2 Checagens automáticas — determinísticas, sem LLM

Rodam em CI sobre o golden set (`conversation-golden-set.fixture.ts`) e em produção como alarme.

| Checagem | Falha se |
|---|---|
| **Vazamento de máquina** | O texto contém: "Base de Conhecimento", "registrar", "sistema", "processad", "solicitação", "protocolo foi", "automaticamente", "check-in semanal do", "não foi possível" |
| **Colchete de citação** | Regex `\[E\d+` ou `\[Fonte` aparece na saída |
| **Acentuação** | Texto PT-BR com densidade anômala de vogais sem acento em palavras da lista (`concluida`, `voce`, `nao`, `mudanca`, `supervisao`, `proxima`) |
| **Repetição de abertura** | Os primeiros 40 chars do turno se repetem em qualquer dos últimos 5 turnos do mesmo aluno |
| **Recusa idêntica** | Mesma mensagem de abstenção enviada 2x em 7 dias para o mesmo aluno |
| **Beco** | Turno com desfecho ABSTEM/ENCAMINHA sem nenhuma sentença imperativa ou oferta |
| **Dupla pergunta** | Mais de um `?` num turno |
| **Dose CREF** | >1 menção ao profissional em 24h fora dos 4 eventos obrigatórios |
| **Tamanho** | Turno > 560 chars ou > 3 bolhas (4 só se desfecho = INTERROMPE) |
| **Emoji** | > 1 emoji por turno; qualquer emoji em turno de dor/segurança |
| **Bolha única** | Turno com desfecho não-trivial e 1 bolha só (regressão do achado 7) |
| **Fato novo** | Número na saída que não está nos fatos liberados nem no estado do aluno (já existe em `numericFacts`, estender para toda saída) |

### 11.3 Métricas agregadas de produto

| Métrica | Como medir | Alvo proposto |
|---|---|---|
| **Taxa de chegada ao LLM** | % de mensagens do aluno que produzem resposta verbalizada (vs. constante congelada) | **≥ 90%** (hoje: medir primeiro — suspeito < 50%) |
| **Taxa de abstenção** | Desfechos ABSTEM+ENCAMINHA por 100 mensagens | ≤ 8 |
| **Cobertura multi-intenção** | % de mensagens multi-intenção em que todas foram reconhecidas | ≥ 95% |
| **Profundidade de conversa** | Turnos por sessão (proxy de vínculo) | ≥ 4 |
| **Taxa de resposta ao check-in** | % que responde as 3 perguntas | ≥ 70% |
| **Reengajamento D7** | % de sumidos que responde ao primeiro toque | ≥ 25% |
| **👍 / (👍+👎)** | Feedback já instrumentado | ≥ 85% |
| **Turnos de reparo** | % de turnos em que o aluno reformula a mesma pergunta | ≤ 5% |
| **North Star** | Treinos concluídos por usuário pago em 30 dias | ≥ 8 |

O último é o que importa. Todos os outros são instrumentais.

### 11.4 Plano de validação

1. **Auditoria de baseline (semana 1).** 100 conversas reais anonimizadas pontuadas na rubrica de §11.1 por dois avaliadores. Sem isso não há como provar melhora.
2. **Wizard of Oz (semana 1-2).** O treinador CREF responde 20 conversas manualmente pelo WhatsApp, seguindo a gramática de §5. Objetivo: descobrir onde meu design está errado antes de codar. É o teste mais barato e mais informativo disponível.
3. **Golden set expandido.** `conversation-golden-set.fixture.ts` cresce para cobrir: multi-intenção (≥15 casos), os 4 degraus de recusa, os 8 fluxos, e os 12 casos negativos de §11.2.
4. **A/B de camada de verbalização.** 50/50, 3 semanas. Primária: turnos por sessão. Secundárias: 👍, taxa de reparo, treinos concluídos.
5. **Entrevista qualitativa (n=8).** Pergunta central, não enviesada: *"me conta a última vez que você conversou com a MOVI"*. Se a pessoa disser "eu não converso, eu só recebo o treino", o redesenho falhou, independentemente das métricas.

---

## 12. Fronteiras — o que eu não estou fazendo

### 12.1 Para o Victor (arquitetura conversacional)

O que este design **exige** tecnicamente, sem eu prescrever como:

1. **Classificação multi-rótulo com prioridade** (segurança > bloqueante > informativo > celebratório), e um plano de turno capaz de adiar intenções declarando o adiamento em voz alta (§8.8).
2. **Separação decidir/verbalizar** (§6.4): desfecho + fatos liberados como contrato interno; verbalização como camada final com fallback para copy congelada.
3. **Grounding: metadado desacoplado da superfície** — `sources` continua no banco, labels saem do texto; e afrouxar a proibição de tecido conversacional mantendo a verificação por claim (§7.3).
4. **Contexto de variação** exposto ao verbalizador: nº de recusas em 24h, primeira vez?, vitória recente?, estado emocional, últimas N aberturas (§6.2).
5. **Recuperação e injeção de memória** conforme as seis categorias de §9.1, com TTL, e a distinção dito-pelo-aluno vs. inferido-pelo-sistema (R3/R4).
6. **Emissão de bolhas** (`BUBBLE_SEPARATOR` no caminho da conversa) e cadência entre bolhas (§5.3-5.4).
7. **Estado da conversa** para triagens de 2 passos (dor, desânimo) — hoje cada mensagem é tratada isoladamente e um fluxo de duas perguntas não tem onde morar.
8. **Nova intenção `PEDIDO_FONTE`** (§7.2, camada 3).

Onde houver conflito entre o que eu desenhei e o que é viável, **a viabilidade ganha e eu redesenho** — mas quero saber qual restrição, para redesenhar em cima dela e não abaixo.

### 12.2 Para o Bruno (voz e linguagem)

Todo texto neste relatório é **referência de estrutura e comportamento**, não copy final. É do Bruno:

- Léxico definitivo, ritmo, gírias, grau de informalidade e o limite do humor.
- **As duas personas de slot** (masculina/feminina) — as construções aqui precisam funcionar nas duas sem concordância travada, que é um bug já documentado em `persona-block.ts`.
- Regionalismo: meu texto está neutro-sudeste. O ICP é nacional.
- As 4-5 variantes pré-aprovadas do sufixo CREF (§10.5), depois do parecer do Alexandre.
- Preenchimento das variantes de cada molde de §6.3 — eu escrevi 1-3 por molde; o sistema anti-repetição precisa de 4-6.
- **Correção da acentuação** em `checkin.service.ts` (achado 8) — item de maior urgência e menor custo do relatório inteiro.

### 12.3 Para o Alexandre

- Parecer sobre o escopo ampliado, com o limite exato: o que é degrau 0, o que é degrau 1 (§6.1). Especialmente onde termina "alimentação básica" e começa prescrição dietética.
- Aprovação da interpretação de §10.1: presença estrutural permanente + menção por evento satisfaz "respaldo sempre visível"?
- Aprovação do conjunto fechado de variantes do sufixo CREF (§10.5).
- Aprovação da **assimetria da segurança** (§6.3.5): a IA pode autorizar retirar/reduzir volume sem revisão humana caso a caso, sob regra geral pré-assinada pelo responsável técnico.

### 12.4 Para o Lucas

- `SCOPE_PERIMETER_BLOCK` é hoje L0 (não editável) e está **desatualizado** em relação à decisão do fundador. Precisa entrar no backlog como mudança de produto com revisão CREF, não como ajuste de painel.
- Os fluxos de §8.5 (versão reduzida do treino) e §8.7 (pausa em vez de cancelamento) implicam capacidades de produto que podem não existir. Verificar contra `22-relatorio-clovis-retencao-gamificacao.md`.
- Áudio de entrada (§5.5) como primeiro item de Fase 2 da conversa.

### 12.5 Para a Mariana

§11 inteira. Em especial: as 12 checagens determinísticas de §11.2 são implementáveis hoje, sem depender de nada do redesenho, e **já detectariam regressões na versão atual**.

---

## 13. Próximos passos, na ordem que eu faria

**Sem depender de nada nem de ninguém (dias, não semanas):**
1. Corrigir a acentuação do check-in. É o pior custo-benefício invertido do produto.
2. Emitir `BUBBLE_SEPARATOR` no caminho da conversa. Uma linha, efeito perceptual desproporcional.
3. Tirar os `[E1: ...]` do texto entregue (o metadado fica no banco).
4. Reescrever o fechamento do check-in e a `SAFETY_HANDOFF` como texto fixo novo — as duas de maior impacto emocional, e as duas onde copy congelada ainda é aceitável.
5. Ligar as 12 checagens determinísticas de §11.2 em CI.

**Depois do parecer do Alexandre:**
6. Reescrever `SCOPE_PERIMETER_BLOCK` para o escopo ampliado. É a maior fonte isolada de recusas indevidas.

**Com o Victor:**
7. Camada de verbalização (§6.4) — a mudança estrutural central.
8. Multi-intenção (§8.8).
9. Memória demonstrada (§9) e estado de conversa para triagem em dois passos.

**Contínuo:**
10. Wizard of Oz na semana 1, antes de qualquer código. Se o treinador CREF respondendo à mão não produzir conversas melhores que as atuais, o problema não era o que eu diagnostiquei — e é melhor descobrir isso em 20 conversas do que em 3 sprints.

---

## 14. Um parágrafo de conclusão

O sistema atual foi construído por gente competente resolvendo os problemas certos: segurança clínica, LGPD, custo, auditabilidade, defesa contra prompt injection. Nada disso deve ser desfeito. O que aconteceu é que cada guardrail, ao ser implementado, escolheu o caminho mais curto — **congelar a frase** — e a soma de dezoito caminhos curtos produziu um produto que só fala quando não tem nada que impeça. O aluno não percebe guardrails; ele percebe que quem está do outro lado só responde quando é fácil. A correção não é remover proteção: é parar de confundir *a decisão que precisa ser rígida* com *a frase que precisa ser viva*.

---

## Fontes Consultadas

- Deng et al. (2026), *Breakdowns in Conversational AI: Interactional Failures in Emotionally and Ethically Sensitive Contexts* — https://arxiv.org/pdf/2604.02713
- *Rethinking directiveness in AI coaching chatbots*, Frontiers in Psychology (2026) — https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2026.1822088/full
- *Systematic review exploring human, AI, and hybrid health coaching in digital health interventions*, Frontiers in Digital Health (2025) — https://www.frontiersin.org/journals/digital-health/articles/10.3389/fdgth.2025.1536416/full
- *Artificial intelligence vs. human coaches: examining the development of working alliance in a single session*, Frontiers in Psychology (2024) — https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2024.1364054/full
- *Building Relationships with AI Coaches: Insights from Chatbot Coaching Research*, Springer (2026) — https://link.springer.com/chapter/10.1007/978-3-032-23332-5_3
- *Not All Transparency Is Equal: Source Presentation Effects on Attention, Interaction, and Persuasion in Conversational Search* — https://arxiv.org/pdf/2512.12207
- *Designing AI Chatbots: UX Principles for User Trust* (2026) — https://www.parallelhq.com/blog/ux-ai-chatbots
- *Conversational User Interfaces: 7 Practical UX Principles for Modern AI Systems*, UXmatters (2026) — https://www.uxmatters.com/mt/archives/2026/02/conversational-user-interfaces-7-practical-ux-principles-for-modern-ai-systems.php
- *Handling Multiple Intent Conversations in Customer Support Chatbots*, ML6 — https://www.ml6.eu/en/blog/handling-multiple-intent-conversations-in-customer-support-chatbots
- *Motivational Interviewing to Promote Healthy Lifestyle Behaviors: Evidence, Implementation, and Digital Applications*, PMC — https://pmc.ncbi.nlm.nih.gov/articles/PMC12526391/
- *A Motivational Interviewing Chatbot With Generative Reflections for Increasing Readiness to Quit Smoking*, PMC — https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10618902/
- *Designing a Chatbot for a Brief Motivational Interview on Stress Management*, JMIR (2019) — https://www.jmir.org/2019/4/e12231/
- *Apps That Motivate: a Taxonomy of App Features Based on Self-Determination Theory*, ScienceDirect — https://www.sciencedirect.com/science/article/pii/S1071581920300513
- *Should or could? Testing the use of autonomy-supportive language and the provision of choice*, PMC — https://pmc.ncbi.nlm.nih.gov/articles/PMC6393822/
- *Know Me, Respond to Me: Benchmarking LLMs for Dynamic User Profiling and Personalized Responses at Scale* — https://arxiv.org/pdf/2504.14225
- *Your Chatbot's Memory of You Can Shape the Information You See*, Columbia Journalism Review — https://www.cjr.org/tow_center/chatbots-memory-remember-users-conversations-history-openai-sam-altman-llm-gemini.php
- *"The Chatbot is typing…" — The Role of Typing Indicators in Human-Chatbot Interaction*, ResearchGate — https://www.researchgate.net/publication/328744481_The_Chatbot_is_typing_-_The_Role_of_Typing_Indicators_in_Human-Chatbot_Interaction
- *New: Typing Indicators in WhatsApp Cloud API*, BotSailor — https://botsailor.com/blog/new-typing-indicators-in-whatsapp-cloud-api
- *WHOOP unveils the new WHOOP Coach, powered by OpenAI* — https://www.whoop.com/us/en/thelocker/whoop-unveils-the-new-whoop-coach-powered-by-openai/
- *Zing's AI Coach Gets an Upgrade [Feature Focus]* — https://www.zing.coach/fitness-library/zing-ai-coach-upgrades?scLang=en-US
- *I used Zing Coach AI for 45 days — here's my honest review*, Techpoint Africa — https://techpoint.africa/guide/zing-coach-ai-review/
- *How to Use the AI-Powered WHOOP Coach*, WHOOP Support — https://support.whoop.com/s/article/How-to-Use-the-AI-Powered-WHOOP-Coach?language=en_US
- *How Does Conversation Length Impact User's Satisfaction? A Case Study of Length-Controlled Conversations with LLM-Powered Chatbots* — https://arxiv.org/pdf/2404.17025
- *How should my chatbot interact? A survey on human-chatbot interaction design* — https://arxiv.org/pdf/1904.02743
