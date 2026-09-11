/**
 * Metodologia de treino da MOVIVO — trilho da geração por IA (US-2.1 / TASK-2.1.2).
 *
 * v3 (2026-09): substitui a v2 (lista numerada de diretivas de engenharia) pelo texto do
 * fundador/RT em prosa — "Metodologia de Treino Resistido Movivo". Mesmo papel de sempre
 * (bootstrap idempotente da versão 1 em `methodology_versions`, via
 * `MethodologyProvider.ensureBootstrap()`; só participa de deploy novo/banco vazio — depois
 * disso quem manda é a versão PUBLISHED mais recente no banco, editável pelo painel
 * `/dashboard/ia/base-conhecimento`), mas agora é o texto de referência oficial, não uma
 * tradução de engenharia por cima dele.
 *
 * Achado 2026-09-03 (reproduzido ao vivo, mesmo dia): a metodologia entra no `system` do
 * prompt como conteúdo AUTORITATIVO (não no envelope de dado não confiável do RAG — ver
 * achado em `protocol-generator.service.ts::buildSystemPrompt`) — suas diretivas de decisão
 * devem ser seguidas como instrução de sistema, não tratadas como mera evidência de apoio.
 *
 * A IA tem autonomia para individualizar DENTRO destes trilhos; a garantia de segurança é do
 * `ValidationService` (US-2.3), não deste texto.
 */

export const METHODOLOGY_VERSION = 'methodology-2026-09-v2';

/** Diretrizes de metodologia injetadas no `system` do prompt (prefixo estável/cacheável). */
export const METHODOLOGY_GUIDELINES = `
# Metodologia de Treino Resistido Movivo

Este documento reúne o conhecimento científico e a metodologia prática que sustentam a criação de protocolos de treino resistido na Movivo. Não é uma sequência de regras fixas do tipo "se X, então Y". É o repertório que um treinador experiente consultaria mentalmente antes de montar, adaptar e progredir um programa. As faixas numéricas aqui são referências da literatura e da prática consolidada, não valores obrigatórios a aplicar mecanicamente: cada combinação de respostas de anamnese é única e merece um raciocínio próprio.

## Restrição inegociável: PAR-Q

Diferente do restante do conteúdo, esta é uma trava operacional rígida. Quando o status do aluno é READY, o protocolo segue seu fluxo normal. Quando é PENDING_REVIEW, ainda se gera um rascunho completo (incorporando inclusive as respostas do PAR-Q que acionaram o gatilho), mas esse rascunho fica com status "aguardando revisão humana" e nunca chega ao aluno sem aprovação de um profissional CREF — quanto mais o gatilho sugerir risco cardiovascular agudo (dor no peito) ou contextos que exigem diretrizes especializadas (gestação/pós-parto recente, cirurgia recente), mais minimalista deve ser esse rascunho, deixando a prescrição fina para o profissional. Nunca há diagnóstico, nunca interpretação de exames além do que o aluno relatou, e nunca orientação para suspender acompanhamento médico ou fisioterapêutico em curso. Acompanhamento profissional ativo e movimentos vetados por um profissional são restrições rígidas, não pontos a ponderar.

## Princípios científicos fundamentais

Volume é contado em séries efetivas por grupo muscular por semana; a relação com hipertrofia é dose-resposta e aproximadamente linear até certo ponto, com piso de referência perto de 10 séries/semana/músculo e faixa geralmente eficiente entre 10 e 20 séries — acima disso os retornos diminuem e a fadiga acumulada cresce. Intensidade tem duas faces: intensidade de carga (%1RM), decisiva para força máxima (cargas ≥80% 1RM tendem a ser superiores para ganho de 1RM), e intensidade de esforço (proximidade da falha, RIR), decisiva para hipertrofia — cargas entre ~30% e ~85% 1RM produzem hipertrofia semelhante desde que as séries cheguem perto da falha. Frequência mínima bem sustentada é 2x/semana por grupo muscular sempre que a disponibilidade de dias permitir; frequências maiores (3-4x) tendem a favorecer mais força, principalmente por viabilizarem mais volume total — a frequência funciona mais como veículo do que como variável isoladamente decisiva. A maioria das séries pode ser feita com 1-3 repetições de reserva sem prejuízo de resultado; a falha pode ser usada pontualmente (últimas séries, isolados, avançados).

Volume é somado por semana mas distribuído entre sessões: para hipertrofia o retorno por sessão tende a estagnar em torno de 6-11 séries efetivas por grupo; para força, bem antes, perto de 2 séries diretas nos exercícios principais — concentrar todo o volume semanal numa única sessão costuma ser menos eficiente. O tipo de divisão de treino (full-body, upper/lower, push/pull/legs ou qualquer outra) produz resultados de força e hipertrofia estatisticamente equivalentes quando o volume semanal por músculo é igualado — a escolha é logística e de adesão, não superioridade científica. Periodização linear e ondulada também são equivalentes; mesociclos costumam durar 4-8 semanas terminando em deload (redução de volume e/ou intensidade de esforço, mantendo frequência e exercícios); avançados tendem a precisar de deloads mais frequentes (a cada 3-5 semanas) do que iniciantes/intermediários (ciclos mais longos).

Na transição entre um mesociclo de Hipertrofia e um de Força (ou o inverso), os exercícios multiarticulares-chave tendem a permanecer os mesmos — trocar o exercício testado dissipa parte do aprendizado técnico específico que sustenta o ganho de força máxima (especificidade); acessórios podem variar com mais liberdade. O que muda de fato: faixa de repetições (≈8-15 em Hipertrofia, ≈1-6 em Força), RIR no exercício-chave (0-3 em Hipertrofia, 0-2 em Força), número de séries diretas por sessão nesse exercício (cai de ≈6-11 para ≈2 — não é só ajustar carga/reps), e descanso entre séries (≈60-90s em Hipertrofia, ≈2-5min em Força, já que cargas mais altas exigem mais recuperação para manter a técnica).

Séries de aquecimento específicas (cargas crescentes no próprio exercício) melhoram o desempenho seguinte; alongamento estático longo (≥60s) imediatamente antes de séries pesadas reduz força aguda — mobilidade dinâmica é preferível como aquecimento, e o alongamento isolado não reduz risco geral de lesão (quem reduz é o próprio treino de força bem estruturado). Como carga externa não é indispensável para hipertrofia, progredir por repetições (mantendo esforço perto da falha) produz ganhos de força, hipertrofia e composição corporal estatisticamente equivalentes a progredir por carga — este é o princípio central para prescrição sem pesos. Elásticos produzem ganhos de força equivalentes a pesos convencionais; unilateralização, manipulação de tempo (excêntrica de 3-4s) e redução de descanso entre séries são formas válidas de aumentar demanda sem carga externa.

## Filosofia e preferências metodológicas do profissional CREF responsável

O raciocínio de prescrição considera idade, altura, peso, sexo biológico, objetivo principal, até duas regiões de ênfase, existência de data-alvo, nível de experiência, condicionamento físico atual, disponibilidade semanal, histórico de lesões/dores/limitações, preferências pessoais, histórico esportivo e capacidade de recuperação observada ao longo do tempo. Quase tudo isso vem do formulário de anamnese — exceções são "condicionamento físico atual" e "capacidade de recuperação", que emergem da combinação de respostas e, com o tempo, do comportamento observado nos check-ins. É importante notar que capacidade de recuperação não é o mesmo que experiência declarada: um aluno avançado com sono ruim, alto estresse ou idade mais avançada pode se comportar, na prática, mais como um intermediário — o raciocínio deve permanecer sensível a essa diferença conforme dados de acompanhamento chegam.

Para iniciantes ou fase de adaptação, o profissional prefere full-body, circuito ou upper/lower, com menor volume e foco em execução. Para intermediários/avançados, o leque se abre para ABC, ABCD, ABCDE, push/pull/legs, upper/lower ou divisões de um-dois grupos por dia, conforme objetivo e pontos de maior desenvolvimento — full-body e circuito favorecem naturalmente frequências mais altas por músculo mesmo com poucos dias, o que serve bem a iniciantes; splits fragmentados só fazem sentido quando volume semanal e frequência mínima continuam respeitados, o que exige tolerar mais volume por sessão (perfil intermediário/avançado).

A base dos programas é formada por padrões de movimento fundamentais — agachamentos, supinos, remadas, puxadas, desenvolvimentos, levantamentos, afundos, core — livres, em máquina, com halteres ou barra, conforme o contexto; isolados entram como complemento, não como base. Essa lógica de "padrões de movimento como esqueleto, equipamento como detalhe" é o que permite adaptar a mesma prescrição a diferentes contextos de equipamento.

O volume é definido por objetivo, experiência e capacidade de recuperação — não uma fórmula fixa — e a progressão pode vir por múltiplas vias além de carga: mais repetições, mais séries, melhor execução, maior amplitude, menor intervalo, maior frequência, ou técnicas avançadas. Qualidade de movimento e evolução gradual vêm antes de simplesmente aumentar peso; isso tem respaldo direto na literatura sobre progressão por repetições vs. carga.

## Como o formulário se conecta à metodologia

Objetivo principal orienta a ênfase geral: Hipertrofia pede volume médio-alto, ampla liberdade de carga, frequência ≥2x/semana. Força pede predomínio de cargas ≥80% 1RM nos exercícios-chave, menor volume total e mais qualidade por série. Emagrecimento pede sessões de corpo inteiro (full-body tende a promover mais perda de gordura que divisões fragmentadas em treinados) e maior densidade (menos descanso, circuitos), sem abandonar a faixa de volume geral. Condicionamento físico exige componente cardiorrespiratório estruturado além da força. Saúde e bem-estar segue a lógica de dose mínima eficaz — mesmo ~2x/semana, 30-60 min/semana já capturam boa parte do benefício documentado, priorizando consistência sobre maximizar estímulo. Fisiculturismo competitivo exige periodização mais granular e acompanhamento humano próximo (peak week e manipulação agressiva fogem do escopo de automação). Quando o objetivo vem em texto livre, buscar a categoria mais próxima; na ausência de correspondência clara, "Saúde e bem-estar" é o padrão mais conservador.

Ênfase regional (até duas) soma cerca de +2 a +4 séries/semana nessas regiões, redistribuídas para não inflar desproporcionalmente o volume total — é ênfase, não abandono das demais regiões.

Data-alvo relaciona-se com a estrutura temporal dos mesociclos: quando há prazo definido, evitar posicionar o deload na última semana antes do evento (lógica de taper). Quando o prazo é incompatível com o objetivo, otimizar para o melhor resultado possível no tempo real disponível, sem prometer resultados irreais nem se afastar da metodologia segura.

Status de treino atual e tempo parado define o ponto de entrada: quanto mais tempo parado, mais a entrada se aproxima da lógica de adaptação, independentemente da experiência prévia — destreinamento reduz recuperação e tolerância mesmo em quem já foi avançado. "Voltar a treinar" como intenção declarada sempre aciona essa reentrada gradual.

Experiência com musculação define volume inicial, RIR-alvo e complexidade de exercícios: iniciantes começam no início da faixa eficiente de volume, RIR mais alto (prioridade ao padrão motor) e exercícios simples; avançados toleram volumes mais altos, RIR mais baixo, uso pontual de falha e deloads mais frequentes.

Histórico esportivo (esportes coletivos, lutas, dança, funcional) indica maior literacia motora e tolerância a padrões de movimento mais complexos introduzidos mais cedo, independentemente do nível declarado em musculação especificamente.

Barreiras de consistência são o sinal mais direto de risco de abandono/cancelamento e merecem peso alto, não tratamento como metadado: falta de tempo → respeitar rigorosamente o tempo por sessão e priorizar multiarticulares/superséries; falta de motivação → maior rotação de exercícios entre mesociclos; não saber o que fazer → instruções explícitas sem jargão; treinos muito longos → tempo informado como teto rígido; dor/lesão → ver bloco de dor abaixo; rotina imprevisível → estrutura de dias intercambiável, não travada por dia da semana; falta de resultados → progressão visível e comunicada nos check-ins; não se identificar com os treinos → mais peso a preferências pessoais e histórico esportivo na seleção de exercícios; nunca conseguiu manter rotina → iniciar deliberadamente abaixo do volume "ótimo" nas primeiras semanas (baixa fricção inicial reduz dor muscular excessiva e abandono precoce).

Dias disponíveis por semana define o split: poucos dias (1-2) tornam full-body praticamente a única forma de aproximar o piso de 2x/semana por músculo; mais dias (5-7) viabilizam splits fragmentados (PPL, ABCDE) sem sacrificar frequência.

Tempo por sessão define densidade e seleção de exercícios: sessões curtas (até 20-30 min) favorecem poucos multiarticulares, superséries e descanso reduzido; sessões mais longas abrem espaço para acessórios e isolamento — na prática, o tempo disponível costuma determinar quantas séries efetivas cabem, mais do que uma meta de volume abstrata.

Local de treino define o nível de equipamento e, por consequência, a lógica de sobrecarga progressiva aplicável (carga externa vs. repetição/tempo/unilateralização — ver banco de exercícios). O formulário atual não pergunta que equipamento o aluno já tem em casa; na ausência dessa informação, a leitura mais segura para "Em casa" e "Ao ar livre" é assumir zero equipamento.

Dor, lesões e limitações (pressupondo READY) restringem o protocolo mesmo sem vetar o treino: a região com dor pede evitar sobrecarga direta e de alta intensidade ali nos primeiros mesociclos — por exemplo, dor lombar pede cautela com carga axial pesada, dor de joelho com flexão profunda sob carga alta, dor de ombro com pressão acima da cabeça em amplitude completa — sempre como modificação prudente, nunca tratamento clínico. Dor com tendência de piora pede cautela redobrada mesmo dentro do status READY. Movimentos vetados por profissional são exclusão rígida, não sujeita a ponderação.

Preferências e exclusões de exercício levam à substituição por um exercício de padrão de movimento equivalente, preferencialmente extraído do histórico esportivo do aluno.

Sexo biológico e idade geram ajustes finos, não protocolos estruturalmente diferentes: mulheres mostraram resposta um pouco mais pronunciada a frequências mais altas numa meta-análise de força; pessoas mais jovens tendem a responder melhor a frequências altas do que mais velhas — para alunos de meia-idade/mais velhos isso pesa a favor de consistência com frequência moderada, RIR um pouco mais conservador e aquecimento específico reforçado.
`.trim();
