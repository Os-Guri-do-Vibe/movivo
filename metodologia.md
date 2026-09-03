# Metodologia MOVIVO — Geração de Protocolos de Treino Personalizados por IA

**Versão:** 1.0
**Propósito:** este documento é a base de conhecimento que parametriza a IA responsável por gerar, adaptar e progredir os protocolos de treino dos alunos da MOVIVO, a partir das respostas ao formulário de anamnese (`/anamnese`). Cada resposta do formulário deve ser tratada como uma variável de entrada que altera concretamente o protocolo gerado — não existe "treino padrão"; existe uma combinação única de regras aplicadas ao caso individual.

Este documento tem três camadas:

1. **Uma regra de segurança inegociável** (Seção 1).
2. **Princípios científicos fundamentais**, que funcionam como as "leis físicas" do sistema (Seção 2).
3. **Um motor de decisão** que traduz cada resposta do formulário em ajustes concretos ao protocolo (Seções 3-7).

---

## 1. REGRA INEGOCIÁVEL DE SEGURANÇA (PAR-Q Gate)

O gate de segurança do PAR-Q **não bloqueia a geração do protocolo pela IA — bloqueia a entrega dele ao aluno.**

- Se o backend retornar **READY**: a IA gera o protocolo e ele segue o fluxo normal de entrega.
- Se o backend retornar **PENDING_REVIEW**: a IA **gera normalmente um rascunho de protocolo**, incorporando todas as respostas do formulário — incluindo as respostas específicas do PAR-Q que geraram o gatilho (ver Seção 3.14) — para que o profissional de Educação Física responsável (CREF) tenha um ponto de partida qualificado a revisar, em vez de partir do zero. **Este rascunho tem status interno "aguardando revisão humana" e nunca é liberado, exibido ou enviado ao aluno sem aprovação explícita do profissional CREF responsável.** A obrigatoriedade da revisão humana antes da entrega permanece intacta e não pode ser contornada por nenhuma otimização de engajamento/retenção descrita mais adiante — o que muda é apenas que a IA deixa de ficar ociosa diante de um gatilho e passa a produzir um insumo útil para acelerar essa revisão.
- Ao gerar um rascunho para caso PENDING_REVIEW, a IA deve aplicar cautela ampliada (Seção 3.14) e **sinalizar explicitamente, junto ao rascunho, qual(is) resposta(s) do PAR-Q geraram o gatilho** — o profissional não deve precisar garimpar o formulário para entender o motivo da revisão.

A IA também nunca diagnostica, nunca interpreta exames ou relatos médicos além do que o próprio aluno descreveu, e nunca instrui o aluno a suspender acompanhamento médico/fisioterapêutico já em curso. Quando o formulário indica acompanhamento profissional ativo (Q13f) ou movimentos vetados por um profissional (Q13g), essas informações são **restrições rígidas**, não sugestões — a IA nunca as sobrepõe, nem no rascunho nem no protocolo final.

---

## 2. PRINCÍPIOS CIENTÍFICOS FUNDAMENTAIS

Estes são os princípios que sustentam toda regra de decisão nas seções seguintes. Cada um está ancorado em literatura científica (ver Seção 9 — Referências).

### 2.1 Volume

Volume é contado como **séries efetivas por grupo muscular por semana** (séries feitas a uma intensidade de esforço relevante, não séries de aquecimento). A relação entre volume semanal e hipertrofia é dose-resposta e aproximadamente linear até a faixa estudada, com piso de referência em **~10 séries/semana/músculo** e faixa geralmente eficiente entre **10-20 séries/semana** para a maioria dos praticantes (Schoenfeld et al., 2017; Bernárdez-Vázquez et al., 2022). Acima disso, os retornos diminuem e o risco de fadiga acumulada aumenta.

### 2.2 Intensidade

Dois conceitos distintos, nunca confundidos no motor de decisão:

- **Intensidade de carga** (% 1RM): decisiva para força máxima — cargas ≥80% 1RM são superiores para ganho de 1RM (Schoenfeld et al., 2017; Carvalho et al., 2022).
- **Intensidade de esforço** (proximidade da falha, RIR): decisiva para hipertrofia — cargas entre ~30% e ~85% 1RM produzem hipertrofia semelhante, desde que as séries sejam levadas perto da falha (Schoenfeld et al., 2017).

### 2.3 Frequência

Cada grupo muscular deve ser treinado **pelo menos 2x/semana** sempre que a disponibilidade de dias permitir — este é o piso mínimo bem sustentado por evidência (Currier et al., 2023; Grgic et al., 2018). Frequências maiores (3-4x/semana) tendem a favorecer ganho de força adicional, principalmente por permitirem acumular mais volume total, não por serem uma variável mágica isolada.

### 2.4 Proximidade da falha

Não é necessário levar todas as séries à falha absoluta. A maioria das séries deve ser prescrita com **1-3 repetições de reserva (RIR)**; falha pode ser usada pontualmente (últimas séries, exercícios de isolamento, praticantes avançados) (Refalo et al., 2021).

### 2.5 Distribuição de volume por sessão

Volume é definido e somado **por semana**, mas distribuído entre sessões — empilhar tudo em um único treino tem retorno decrescente. Para hipertrofia, o platô por sessão fica em torno de **6-11 séries efetivas por grupo muscular**; para força, o platô é bem mais baixo, em torno de **2 séries diretas por sessão** (Remmert et al., 2025). **Regra prática: nunca alocar mais de ~10-12 séries de um mesmo grupo muscular em uma única sessão — dividir em mais dias sempre que possível.**

### 2.6 Divisão de treino (split) — a estrutura em si não é o fator decisivo

Full-body, upper/lower, push/pull/legs ou qualquer variação de split produzem resultados de força e hipertrofia estatisticamente equivalentes **quando o volume semanal é equalizado** (Ramos-Campo et al., 2024). O que importa é: volume semanal total por músculo + frequência ≥2x/semana + distribuição sensata por sessão (2.5). A escolha do split é, portanto, uma decisão de **logística e adesão**, não de eficácia — a IA deve escolher o split que melhor se encaixa nos dias/tempo disponíveis do aluno, não um split "ideal" abstrato.

### 2.7 Periodização e mesociclos

Modelos de periodização linear e ondulada produzem resultados equivalentes (Harries et al., 2015; Grgic et al., 2017) — a escolha do modelo é novamente uma questão de variedade/adesão, não de superioridade comprovada. Mesociclos padrão duram **4-8 semanas**, terminando em **1 semana de deload** (redução de volume e/ou intensidade de esforço, mantendo frequência e exercícios). Praticantes mais avançados tendem a precisar de deloads mais frequentes (a cada 3-5 semanas); iniciantes/intermediários toleram ciclos mais longos (6-8 semanas) (Bell et al., 2023, 2024).

### 2.8 Aquecimento e alongamento

- Séries de aquecimento específicas (cargas crescentes no próprio exercício) sempre devem preceder séries de trabalho pesadas — melhoram desempenho subsequente (Ribeiro et al., 2021).
- Alongamento estático longo (≥60s por músculo) deve ser evitado imediatamente antes de séries pesadas — reduz força aguda (revisão multinível, 2024).
- Mobilidade dinâmica é a opção preferencial de aquecimento pré-treino.
- Alongamento não substitui aquecimento nem reduz risco geral de lesão isoladamente (consenso Delphi, Afonso et al., 2025) — quem reduz risco de lesão é o próprio treino de força bem estruturado e progressivo.

### 2.9 Treino sem equipamento completo (casa/ar livre)

Como a carga externa em si não é o ingrediente indispensável para hipertrofia (2.2), progressão sem pesos é cientificamente viável. **Progredir aumentando repetições (mantendo esforço perto da falha) produz ganhos de força, hipertrofia e composição corporal estatisticamente equivalentes a progredir aumentando carga** (Plotkin et al., 2022) — este é o princípio central para prescrição sem equipamento. Ferramentas adicionais: elásticos de resistência produzem ganhos de força equivalentes a pesos convencionais (Lopes et al., 2019); unilateralização, manipulação de tempo (fase excêntrica de 3-4s) e redução de descanso entre séries são formas válidas de aumentar a demanda sem carga externa.

---

## 3. MOTOR DE DECISÃO — MAPEAMENTO FORMULÁRIO — PROTOCOLO

Cada subseção abaixo corresponde a um bloco do formulário e define **como a resposta altera o protocolo**.

### 3.1 Objetivo principal (Etapa 2, Q1) — "família de protocolo"

Esta é a variável mestra. Define a ênfase relativa de volume, carga e estrutura:

| Objetivo                       | Ênfase de carga                         | Volume/semana                                                                                                                                                                  | RIR-alvo                                      | Estrutura                                                                                                                                                                                                                                          |
| ------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hipertrofia**                | 60-85% 1RM, variando entre mesociclos   | 12-20 séries/músculo                                                                                                                                                           | 0-3 RIR na maioria das séries                 | Foco em multiarticulares + isolamento, frequência ≥2x/músculo                                                                                                                                                                                      |
| **Força**                      | Predomínio ≥80% 1RM em exercícios-chave | Menor volume total, maior qualidade por série (~2 séries diretas/sessão nos principais levantamentos)                                                                          | 0-2 RIR nos exercícios principais             | Poucos exercícios multiarticulares centrais, progressão de carga como prioridade                                                                                                                                                                   |
| **Emagrecimento**              | Ampla faixa de carga aceitável          | Volume moderado-alto, priorizando densidade (menos descanso, circuitos/supersets)                                                                                              | 1-3 RIR                                       | Preferir sessões de corpo inteiro (full-body promove mais perda de gordura que split em treinados — Iversen et al., 2024); combinar com componente de atividade cardiovascular quando o aluno tiver disponibilidade                                |
| **Condicionamento físico**     | Faixa mista                             | Volume moderado de força + componente cardiorrespiratório estruturado                                                                                                          | 2-4 RIR                                       | Treino concorrente: força não substitui trabalho aeróbico para VO2 máx., e vice-versa (An et al., 2024)                                                                                                                                            |
| **Saúde e bem-estar**          | Carga confortável e sustentável         | **Dose mínima eficaz aceitável**: mesmo 2x/semana, 30-60 min/semana total já captura boa parte do benefício de saúde/longevidade (Momma et al., 2022; Shailendra et al., 2022) | 2-4 RIR                                       | Priorizar adesão e consistência acima de maximizar estímulo; sugerir componente aeróbico complementar (efeito aditivo bem documentado — Zhao et al., 2020; Saeidifard et al., 2019)                                                                |
| **Competir em fisiculturismo** | Protocolo mais granular e avançado      | Volume no topo da faixa tolerada, periodização em blocos                                                                                                                       | Variável por fase (acumulação/intensificação) | **Sinalizar para acompanhamento humano mais próximo** — objetivo de alto risco/alta exigência técnica (peak week, manipulação agressiva de variáveis) está fora do escopo de automação plena; aumentar frequência de check-in do profissional CREF |
| **Outro** (texto livre)        | —                                       | —                                                                                                                                                                              | —                                             | IA tenta mapear semanticamente para a categoria mais próxima acima; se não houver correspondência confiável, aplicar o padrão de "Saúde e bem-estar" (mais conservador) e considerar sinalizar para revisão humana                                 |

_Nota técnica:_ o vocabulário de backend inclui também `BUILD_ROUTINE` ("Criar uma rotina de treino") e `RETURN_TO_TRAINING` ("Voltar a treinar"), não expostos na tela atual. Tratamento recomendado: `BUILD_ROUTINE` segue o padrão de "Saúde e bem-estar" (foco em consistência/hábito antes de otimização). `RETURN_TO_TRAINING` deve **sempre** acionar a lógica de reentrada gradual da Seção 3.4, independentemente do nível de experiência declarado em Q5 — histórico de destreinamento reduz a capacidade de recuperação mesmo em quem já foi avançado.

### 3.2 Ênfase regional (Q2, até 2 regiões)

Alocar **volume extra (+2 a +4 séries/semana)** nas regiões marcadas, redistribuindo para não elevar o volume semanal total de forma desproporcional (evitar sobrecarga sistêmica). As demais regiões mantêm volume de manutenção (piso ~10 séries/semana). Se "Corpo todo, sem preferência" for marcado, distribuição uniforme padrão.

### 3.3 Data/evento-alvo (Q3)

Se houver data definida, a IA calcula semanas restantes e ajusta a estrutura do(s) mesociclo(s):

- Evitar posicionar deload na última semana antes do evento (lógica de _taper_ — reduzir fadiga sem perder adaptação).
- Se o prazo for incompatível com o objetivo declarado (ex.: metas de composição corporal muito agressivas em poucas semanas), a IA deve gerar um protocolo otimizado com o melhor resultado possível a ser alcançado no tempo existente, sem prometer resultado irreal, milagres ou protocolos fora da metodologia segura.

### 3.4 Status de treino atual + tempo parado (Q4, Q4a)

Define o **ponto de entrada** (ramp-up), combinado com a experiência declarada (3.5):

| Status                | Efeito                                                                                                                                                                                                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nunca treinei         | Entrada mais conservadora possível: volume no piso, ênfase em padrão de movimento/técnica, RIR mais alto (2-4)                                                                                                                                                                                                                  |
| Estou parado          | Ramp-up graduado conforme tempo parado: <1 mês — quase sem ajuste; 1-3 meses — reduzir volume/carga inicial ~20-30% da última capacidade relatada; 4-6 meses — tratar como reentrada moderada; 7-12 meses ou mais — tratar como se fosse iniciante nas primeiras 2-3 semanas, independentemente da experiência prévia declarada |
| Treino ocasionalmente | Entrada moderada, volume abaixo do teto da faixa (10-14 séries/semana), progressão mais gradual nas primeiras semanas                                                                                                                                                                                                           |
| Treino regularmente   | Entrada padrão, conforme experiência declarada (3.5)                                                                                                                                                                                                                                                                            |

### 3.5 Experiência com musculação (Q5)

| Nível         | Volume inicial                                                     | RIR-alvo                                         | Complexidade de exercícios                                                                                                                     |
| ------------- | ------------------------------------------------------------------ | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Iniciante     | Base da faixa (~8-12 séries/músculo/semana)                        | 2-4 RIR (prioriza aprendizado motor e segurança) | Poucos exercícios, priorizar padrões fundamentais (agachar, empurrar, puxar, dobrar o quadril), progressão por repetição antes de complexidade |
| Intermediário | Faixa média (~12-16 séries/músculo/semana)                         | 1-3 RIR                                          | Introduzir variações, técnicas de intensidade moderadas                                                                                        |
| Avançado      | Faixa superior tolerada pelo aluno (~16-20+ séries/músculo/semana) | 0-2 RIR, uso pontual de falha                    | Maior variedade técnica, periodização mais granular, deloads mais frequentes (3-5 semanas)                                                     |

### 3.6 Histórico de atividades (Q6)

Informa **literacia motora de base**, não altera volume/carga diretamente, mas influencia a seleção de exercícios: aluno com bagagem em esportes coletivos, lutas, dança ou treino funcional tolera introdução mais rápida de padrões de movimento complexos/multiplanares; aluno sem nenhuma bagagem (opção "Nenhuma") recebe progressão de complexidade mais gradual, independentemente do nível declarado em Q5.

### 3.7 Barreiras de consistência (Q7) — camada de retenção embutida na prescrição

Esta pergunta é a mais diretamente ligada à retenção do produto (ver também Seção 5). Cada barreira relatada aciona uma mitigação concreta no protocolo, não apenas uma mensagem motivacional:

| Barreira relatada                  | Ajuste concreto no protocolo                                                                                                                                                                                                                                                                                           |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Falta de tempo                     | Respeitar rigorosamente o tempo por sessão (Q10); priorizar multiarticulares e superséries para eficiência                                                                                                                                                                                                             |
| Falta de motivação                 | Maior rotação de exercícios entre mesociclos; variedade deliberada mesmo quando não estritamente necessária cientificamente (2.7)                                                                                                                                                                                      |
| Não saber o que fazer              | Instruções explícitas e sem ambiguidade em cada exercício; evitar jargão técnico não explicado                                                                                                                                                                                                                         |
| Treinos muito longos               | Tratar o tempo de Q10 como teto rígido, nunca sugerir "só mais um exercício"                                                                                                                                                                                                                                           |
| Dor ou lesão                       | Cruzar com Seção 4; progressão mais conservadora mesmo se o caso for READY                                                                                                                                                                                                                                             |
| Rotina imprevisível                | Estrutura de dias intercambiável (ex.: "Treino A/B/C" que pode ser feito em qualquer ordem na semana, não travado por dia da semana)                                                                                                                                                                                   |
| Falta de resultados                | Progressão visível e comunicada — repetições/carga registradas e destacadas nos check-ins como evidência de avanço                                                                                                                                                                                                     |
| Não me identificava com os treinos | Priorizar fortemente as preferências declaradas (Q14) e o histórico de atividades (Q6) na seleção de exercícios                                                                                                                                                                                                        |
| Nunca tentei manter uma rotina     | Início deliberadamente abaixo do volume "ótimo" nas primeiras 1-2 semanas — princípio comportamental de baixa fricção inicial para reduzir dor muscular excessiva e abandono precoce (nota: isto é uma recomendação de ciência do comportamento/adesão ao exercício, não uma variável de dose-resposta de hipertrofia) |

### 3.8 Dias disponíveis por semana (Q8) — estrutura de split

Regra geral: escolher o split que maximize frequência ≥2x/semana por grupo muscular dentro dos dias disponíveis (2.6), nunca o inverso.

| Dias/semana | Split recomendado                                                                           | Observação                                                                                                                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1           | Full-body                                                                                   | Frequência de 1x/semana por músculo é o mínimo do mínimo — sinalizar (de forma gentil, não alarmista) que mais dias tendem a acelerar resultados, especialmente para hipertrofia                              |
| 2           | Full-body x2                                                                                | Atinge o piso de frequência 2x/semana                                                                                                                                                                         |
| 3           | Full-body x3 (ou Upper/Lower/Full)                                                          | Configuração robusta, boa aderência a evidência                                                                                                                                                               |
| 4           | Upper/Lower x2                                                                              | Bem sustentado por evidência, frequência 2x garantida                                                                                                                                                         |
| 5           | Push/Pull/Legs + 2 dias extra (ex.: Upper/Lower), priorizando 2x nos grupos de ênfase (3.2) | —                                                                                                                                                                                                             |
| 6-7         | Push/Pull/Legs x2                                                                           | Reservar para intermediário/avançado com boa capacidade de recuperação; se 7 dias for selecionado por iniciante, considerar incluir ao menos 1 dia de intensidade reduzida/recuperação ativa dentro da semana |

### 3.9 Tempo disponível por sessão (Q10) — densidade e seleção de exercícios

Combinado com 2.5 (teto de ~10-12 séries efetivas por músculo por sessão):

| Tempo      | Estrutura                                                                                                                                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Até 20 min | 3-5 exercícios, priorizando multiarticulares, superséries/circuitos, descanso reduzido — literatura de treino "eficiente em tempo" dá suporte a essa compressão sem grande perda de resultado (revisão narrativa, 2021) |
| ~30 min    | 4-6 exercícios, 1-2 séries de aquecimento + séries de trabalho enxutas                                                                                                                                                  |
| ~45 min    | Estrutura padrão: aquecimento específico + 5-7 exercícios                                                                                                                                                               |
| ~60 min    | Estrutura completa, espaço para acessórios/isolamento                                                                                                                                                                   |
| 60+ min    | Espaço para volume extra em regiões de ênfase (3.2) ou trabalho complementar (mobilidade, core)                                                                                                                         |

### 3.10 Local de treino (Q11) — nível de equipamento

| Local                  | Lógica de prescrição                                                                                                                                                                                                                                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Academia completa      | Prescrição padrão, acesso pleno a pesos livres, máquinas e cabos                                                                                                                                                                                                                                                                                                    |
| Academia de condomínio | Assumir equipamento limitado (poucos halteres, poucas máquinas); priorizar exercícios com pesos livres/peso corporal que não dependem de máquina específica; oferecer alternativa por grupo muscular sempre que possível                                                                                                                                            |
| Em casa                | Aplicar o princípio 2.9 na íntegra: progressão primária via repetições (Plotkin et al., 2022), uso de unilateralização, manipulação de tempo e redução de descanso como ferramentas de sobrecarga progressiva; sugerir elásticos de resistência como investimento de baixo custo com respaldo científico de equivalência a pesos convencionais (Lopes et al., 2019) |
| Ao ar livre            | Mesma lógica de "Em casa"; considerar equipamento típico de espaços públicos brasileiros (barras de flexão/apoio) quando mencionado pelo aluno                                                                                                                                                                                                                      |

**Lacuna identificada:** o formulário atual não pergunta quais equipamentos o aluno já possui em casa (halteres, elásticos, barra de flexão, banco). Até que essa pergunta exista, a IA deve **assumir o cenário mais conservador (zero equipamento)** para "Em casa" e "Ao ar livre", e permitir que o aluno reporte equipamento disponível via conversa no WhatsApp para refinar o protocolo — ver Seção 8.

### 3.11 Dor/limitações (Etapa 2, Seção 4) — modificações e gatilhos de revisão humana

Aplica-se tanto a casos READY (protocolo final) quanto ao rascunho de casos PENDING_REVIEW (Seção 3.14) — as restrições desta seção nunca são sobrepostas em nenhum dos dois fluxos. Informações desta seção **restringem** o protocolo/rascunho:

- Região com dor relatada — evitar, nos primeiros mesociclos, movimentos que sobrecarreguem diretamente essa região sob alta intensidade (ex.: dor lombar relatada — cautela com carga axial pesada e amplitude final de flexão de tronco carregada nas primeiras semanas; dor de joelho — cautela com flexão profunda de joelho sob carga alta e impacto; dor de ombro — cautela com pressão acima da cabeça em amplitude completa). Estas são modificações prudentes de treino, não tratamento — sempre generalistas e nunca substituem orientação clínica específica.
- Tendência "Piorando" (Q13c) — deve ser tratada com maior cautela mesmo dentro do status READY; considerar reduzir ainda mais volume/intensidade nas regiões afetadas e reforçar, na comunicação com o aluno, a importância de manter o acompanhamento profissional se já existente.
- Movimentos vetados por profissional (Q13g) — lista de exclusão **rígida e não negociável**.

### 3.12 Preferências/exclusões de exercício (Q14)

Exclusão direta e permanente do pool de exercícios daquele aluno; a IA substitui por exercício de padrão de movimento equivalente (mesmo grupo muscular primário, ângulo/função semelhante) extraído do histórico de atividades (Q6) quando possível.

### 3.13 Sexo biológico e idade — ajustes finos

- **Sexo biológico (Q3, Etapa 1):** o subgrupo feminino mostrou resposta ligeiramente mais pronunciada a frequências mais altas em uma meta-análise de força (Grgic et al., 2018) — ajuste fino, não determinante isolado; não deve gerar protocolos estruturalmente diferentes por sexo, apenas leve preferência por frequência mais alta quando os demais fatores (dias/tempo disponíveis) permitirem escolha.
- **Idade (derivada da data de nascimento):** a mesma meta-análise indica que indivíduos mais jovens respondem mais favoravelmente a frequências mais altas do que indivíduos mais velhos (Grgic et al., 2018). Para alunos de meia-idade/mais velhos, priorizar consistência de frequência moderada sobre frequência máxima, manter RIR um pouco mais conservador (2-4) e reforçar ainda mais a etapa de aquecimento específico (2.8). Estas são recomendações de prudência geral baseadas em literatura de treino, não orientação clínica geriátrica.

### 3.14 Respostas do PAR-Q (Etapa 3) — cautela ampliada no rascunho para casos PENDING_REVIEW

Quando alguma resposta do PAR-Q aciona PENDING_REVIEW, a IA gera o rascunho já considerando o motivo específico do gatilho — não um rascunho genérico "mais conservador" sem relação com a resposta que o originou. Isto cumpre o princípio geral desta metodologia de que toda resposta informa o protocolo, mesmo quando a entrega depende de revisão humana.

| Pergunta PAR-Q                                        | Sinalização aplicada ao rascunho                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1 — problema cardíaco/pressão alta                   | Evitar intensidade máxima e manobras de esforço com apneia (Valsalva); RIR mais conservador (3-4) em todo o protocolo; sinalizar ao profissional para confirmar limites de frequência cardíaca/liberação                                                                                                        |
| Q2 — dor no peito durante atividade física            | Sinalização de **alta prioridade** — rascunho evita qualquer componente de alta intensidade cardiovascular ou pico de esforço; destacar para revisão urgente                                                                                                                                                    |
| Q3 — dor no peito recente em repouso                  | Mesma sinalização de alta prioridade de Q2                                                                                                                                                                                                                                                                      |
| Q4 — perda de equilíbrio/desmaio                      | Evitar no rascunho exercícios com risco de queda (posições instáveis, cargas livres acima da cabeça em pé, mudanças rápidas de posição)                                                                                                                                                                         |
| Q5 — medicação contínua para pressão/coração          | Cautela moderada (similar a Q1, porém sem o mesmo grau de urgência); progressão de intensidade mais gradual, aquecimento mais longo                                                                                                                                                                             |
| Q6 — problema ósseo/articular/coluna                  | Cruzar com a lógica de restrição por região (3.11): excluir/aliviar carga direta na estrutura relatada                                                                                                                                                                                                          |
| Q7 — gestante ou pós-parto recente                    | Cautela máxima — caso onde diretrizes específicas (não genéricas) se aplicam; o rascunho se limita a um esqueleto de baixa intensidade/baixo impacto e **evidencia claramente ao profissional que a prescrição detalhada depende de avaliação especializada**, em vez de tentar progredir carga automaticamente |
| Q8 — cirurgia nos últimos 6 meses                     | Excluir/aliviar fortemente a região operada no rascunho; sinalizar que o tempo de retorno seguro é altamente individual e depende do profissional                                                                                                                                                               |
| Q9 — outro motivo (texto livre, obrigatório se "Sim") | A IA reproduz o motivo relatado verbatim junto ao rascunho para o profissional, sem tentar interpretar ou classificar automaticamente; aplica o template mais conservador disponível como ponto de partida                                                                                                      |

**Regra geral:** quanto mais o gatilho remeter a risco cardiovascular agudo (Q2, Q3) ou a um contexto que exige diretrizes especializadas e não apenas "menos volume/carga" (Q7 gestação, Q8 pós-cirúrgico recente), mais o rascunho deve se limitar a uma estrutura mínima e deixar a prescrição fina explicitamente nas mãos do profissional — nesses casos, o valor do rascunho é organizar a informação para revisão rápida, não entregar um protocolo quase pronto.

---

## 4. ESTRUTURA DE MESOCICLO PADRÃO

1. **Duração:** 4-8 semanas de progressão + 1 semana de deload (ajustar pela experiência — 3.5).
2. **Progressão dentro do mesociclo:**
   - Prioridade 1: aumentar repetições dentro da faixa-alvo, mantendo RIR (especialmente relevante para "Em casa"/"Ao ar livre" — 2.9).
   - Prioridade 2: ao atingir o topo da faixa de repetições com RIR-alvo cumprido, aumentar carga (quando equipamento permitir) e retornar à base da faixa de repetições.
   - Volume semanal pode ser progredido entre mesociclos (não necessariamente dentro de um único mesociclo) para dar espaço de recuperação.
3. **Deload:** redução de volume (~40-50% das séries) e/ou intensidade de esforço (RIR mais alto), mantendo frequência e exercícios reconhecíveis pelo aluno.
4. **Variação entre mesociclos:** trocar exercícios acessórios, ordem, ou esquema de repetições (linear vs. ondulado) — não por superioridade comprovada de um modelo sobre o outro (2.7), mas para sustentar engajamento (Seção 5).

### Rótulos visuais de ciclo (Adaptação / Hipertrofia / Força / Deload)

Sim — os quatro rótulos existentes na plataforma podem ser aplicados aos protocolos gerados pela IA como camada puramente visual/descritiva, sem alterar a lógica de cálculo de volume, carga e RIR definida nas Seções 2 e 3. Regra de ordem importante: **o rótulo é decidido depois de o protocolo já estar calculado, nunca antes** — a IA nunca ajusta volume/carga/RIR para "combinar" com um rótulo; o rótulo apenas descreve o que as regras científicas já determinaram.

Critério de atribuição, por bloco/mesociclo (pelos parâmetros reais daquele bloco específico, nunca só pelo objetivo declarado):

| Rótulo          | Quando se aplica                                                                                                                                                                                                                                                                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Deload**      | Prioridade máxima — qualquer semana que atenda aos critérios de deload definidos acima (redução de ~40-50% do volume e/ou aumento do RIR-alvo), independentemente do objetivo do aluno                                                                                                                                                                                                      |
| **Adaptação**   | Sempre que a lógica de ramp-up de entrada (3.4) estiver ativa: aluno que nunca treinou, retorno após ≥4-6 meses parado, ou primeiro mesociclo de um iniciante absoluto. Tipicamente as primeiras 2-4 semanas da jornada do aluno na plataforma, com foco em padrão de movimento e RIR mais alto                                                                                             |
| **Força**       | Sempre que os parâmetros operativos do bloco corresponderem à família "Força" da Seção 3.1 (predomínio de ≥80% 1RM nos exercícios-chave, RIR 0-2 nesses exercícios) — cobre tanto o objetivo "Força" declarado diretamente quanto fases de intensificação dentro de uma periodização de outro objetivo (ex.: bloco de força intercalado num plano de hipertrofia ou de competição)          |
| **Hipertrofia** | Rótulo padrão de "desenvolvimento" para qualquer bloco fora de Adaptação/Força/Deload — cobre o objetivo "Hipertrofia" diretamente e também os blocos de Emagrecimento, Condicionamento físico (componente de força) e Saúde e bem-estar, cujos parâmetros (volume moderado-alto, faixa de carga ampla, RIR 0-3) se aproximam estruturalmente mais deste padrão do que do padrão de "Força" |

**Nota honesta sobre o rótulo "Adaptação":** diferente dos demais, ele não corresponde a um desfecho de dose-resposta testado especificamente na literatura revisada nesta metodologia — é uma convenção pedagógica amplamente usada na prática de prescrição (fase inicial de menor volume/carga para construir tolerância e técnica antes de progredir), consistente com o princípio geral de entrada conservadora já estabelecido em 3.4, mas não uma variável com meta-análise dedicada como volume, frequência ou proximidade da falha.

---

## 5. CAMADA DE RETENÇÃO E ENGAJAMENTO

A MOVIVO opera em modelo de assinatura com 7 dias grátis. A metodologia científica acima é compatível com — e deve ser deliberadamente calibrada para — maximizar a chance de o aluno perceber valor real dentro da janela de teste e converter em pagante. Isto não contradiz a ciência: dentro do espaço de decisões igualmente válidas (2.6 split, 2.7 periodização), a IA deve escolher a opção que também favorece adesão.

- **Primeiros 7 dias (janela de trial):** o primeiro treino gerado deve ser imediatamente executável e não desproporcionalmente exigente — volume no piso da faixa recomendada para o nível do aluno, mesmo que a faixa "ótima" científica permitisse mais. Dor muscular tardia (DOMS) excessiva nos primeiros dias é um risco de abandono conhecido; a entrada conservadora (3.4, 3.5) já mitiga isso.
- **Não posicionar deload dentro da janela de trial.** Cientificamente, o momento exato do primeiro deload dentro de uma faixa de 4-8 semanas é flexível (2.7) — usar essa flexibilidade para garantir que o aluno sinta progressão contínua durante os primeiros 7-14 dias, e programar o primeiro deload para depois da conversão de assinatura.
- **Barreiras de consistência (3.7) são o principal sinal de risco de cancelamento** — tratá-las como entrada de alta prioridade no protocolo, não como metadado secundário.
- **Comunicação de progresso via WhatsApp:** cada pequeno avanço mensurável (mais uma repetição, mais carga, sessão concluída dentro do tempo previsto) deve ser refletido nos check-ins como evidência concreta de progresso — combate diretamente a barreira "Falta de resultados" e reforça a percepção de acompanhamento individualizado real.
- **Expectativas realistas (3.3):** calibrar expectativa sem desanimar — comunicar prazos plausíveis aumenta confiança de longo prazo mais do que promessas otimistas que geram frustração e cancelamento no primeiro mês.

---

## 6. ALGORITMO DE GERAÇÃO — SÍNTESE PASSO A PASSO

1. Verificar status (Seção 1). Se READY, seguir para geração normal com entrega automática ao final do passo 13. Se PENDING_REVIEW, seguir os mesmos passos 2-13 para gerar um rascunho, aplicando a cautela ampliada da Seção 3.14 e sinalizando explicitamente qual resposta do PAR-Q originou o gatilho; ao final, marcar como "aguardando revisão humana" em vez de entregar — a liberação ao aluno só ocorre após aprovação explícita do profissional CREF.
2. Determinar família de protocolo a partir do objetivo (3.1).
3. Determinar ponto de entrada (ramp-up) a partir de status atual + tempo parado + experiência (3.4, 3.5).
4. Determinar split e frequência a partir de dias disponíveis (3.8), respeitando piso de 2x/semana/músculo sempre que os dias permitirem.
5. Determinar densidade/seleção de exercícios a partir do tempo por sessão (3.9).
6. Determinar nível de equipamento e lógica de sobrecarga a partir do local de treino (3.10).
7. Aplicar restrições rígidas: dor/limitações (3.11) e exclusões de exercício (3.12).
8. Alocar volume extra nas regiões de ênfase (3.2), respeitando o teto por sessão (2.5).
9. Aplicar mitigações de barreiras de consistência (3.7).
10. Ajustar estrutura temporal se houver evento-alvo (3.3).
11. Aplicar ajustes finos de sexo/idade (3.13).
12. Montar mesociclo (Seção 4), posicionando o primeiro deload fora da janela de trial (Seção 5).
13. Gerar protocolo + plano de comunicação de check-in.

---

## 7. EXEMPLO APLICADO

**Caso:** mulher, 34 anos, objetivo "Emagrecimento", nunca treinou, disponível 3 dias/semana, 45 min/sessão, treina "Em casa", barreiras relatadas: "falta de tempo" e "nunca tentei manter uma rotina", sem dor relatada (READY), sem restrições de exercício.

**Decisões geradas:**

- Família de protocolo: emagrecimento — full-body, densidade alta, ampla faixa de carga.
- Ramp-up: iniciante absoluta — volume no piso (~8-10 séries/músculo/semana), RIR 3-4.
- Split: full-body x3 (3 dias disponíveis) — frequência 3x/semana por músculo, acima do piso.
- Densidade: 45 min — 5-7 exercícios, aquecimento específico incluído.
- Equipamento: "Em casa", sem informação de equipamento próprio — assumir zero equipamento, prescrição baseada em peso corporal com progressão via repetições (2.9), sugerir elástico como upgrade opcional.
- Mitigação de barreiras: sessões estritamente dentro de 45 min (falta de tempo); volume inicial ainda mais conservador que o piso técnico nas primeiras 2 semanas, com progressão suave (nunca tentou manter rotina).
- Mesociclo: 6 semanas de progressão (perfil iniciante) + deload na semana 7 — fora da janela de trial de 7 dias.
- Comunicação: check-ins destacando repetições/tempo de sessão cumprido como reforço de progresso tangível.

---

## 8. LACUNAS CONHECIDAS DO FORMULÁRIO ATUAL (recomendações de melhoria)

Identificadas ao mapear o formulário para esta metodologia — não bloqueiam o funcionamento atual, mas limitam a granularidade da personalização:

1. **Equipamento disponível em casa/ar livre não é perguntado** (halteres, elásticos, barra de flexão, banco). Recomenda-se adicionar pergunta condicional quando Q11 = "Em casa" ou "Ao ar livre".
2. **Nenhuma pergunta sobre condições de saúde crônicas fora do contexto de dor atual** (ex.: diabetes, hipertensão controlada) que, embora não sejam objeto de diagnóstico pela IA, poderiam justificar cautela adicional documentada — atualmente essa informação só emerge indiretamente via PAR-Q (Q1, Q5).
3. **Ausência de captura de peso/medida de progresso ao longo do tempo dentro do próprio formulário** — recomenda-se que o check-in periódico via WhatsApp colete isso de forma leve, alimentando a progressão do protocolo.

---

## 9. REFERÊNCIAS CIENTÍFICAS

1. Currier BS, Mcleod JC, Banfield L, et al. Resistance training prescription for muscle strength and hypertrophy in healthy adults: a systematic review and Bayesian network meta-analysis. _Br J Sports Med_. 2023;57(18):1211-1220.
2. Bernárdez-Vázquez R, Raya-González J, Castillo D, Beato M. Resistance Training Variables for Optimization of Muscle Hypertrophy: An Umbrella Review. _Front Sports Act Living_. 2022;4:949021.
3. Schoenfeld BJ, Ogborn D, Krieger JW. Dose-response relationship between weekly resistance training volume and increases in muscle mass. _J Sports Sci_. 2017;35(11):1073-1082.
4. Schoenfeld BJ, Grgic J, Ogborn D, Krieger JW. Strength and Hypertrophy Adaptations Between Low- vs. High-Load Resistance Training. _J Strength Cond Res_. 2017;31(12):3508-3523.
5. Refalo MC, Helms ER, Trexler ET, Hamilton DL, Fyfe JJ. Effects of resistance training performed to repetition failure or non-failure on muscular strength and hypertrophy. _J Sport Health Sci_. 2021.
6. Wewege MA, Desai I, Honey C, et al. The Effect of Resistance Training in Healthy Adults on Body Fat Percentage, Fat Mass and Visceral Fat. _Sports Med_. 2022;52(2):287-300.
7. Carvalho L, Moriggi Junior R, Barreira J, Schoenfeld BJ, Orazem J, Barroso R. Muscle hypertrophy and strength gains after resistance training with different volume-matched loads. _Appl Physiol Nutr Metab_. 2022;47(4):357-368.
8. Grgic J, Schoenfeld BJ, Davies TB, Lazinica B, Krieger JW, Pedisic Z. Effect of Resistance Training Frequency on Gains in Muscular Strength. _Sports Med_. 2018;48(5):1207-1220.
9. An J, Su Z, Meng S. Effect of aerobic training versus resistance training for improving cardiorespiratory fitness and body composition. _Arch Gerontol Geriatr_. 2024;126:105530.
10. Giovannucci EL, Rezende LFM, Lee DH. Muscle-strengthening activities and risk of cardiovascular disease, type 2 diabetes, cancer and mortality. _J Intern Med_. 2021;290(4):789-805.
11. Zhao M, Veeranki SP, Magnussen CG, Xi B. Recommended physical activity and all cause and cause specific mortality in US adults. _BMJ_. 2020;370:m2031.
12. Momma H, Kawakami R, Honda T, Sawada SS. Muscle-strengthening activities are associated with lower risk and mortality in major non-communicable diseases. _Br J Sports Med_. 2022;56(13):755-763.
13. Shailendra P, Baldock KL, Li LSK, Bennie JA, Boyle T. Resistance Training and Mortality Risk. _Am J Prev Med_. 2022;63(2):277-285.
14. Saeidifard F, Medina-Inojosa JR, West CP, et al. The association of resistance training with mortality. _Eur J Prev Cardiol_. 2019;26(15):1647-1665.
15. Nascimento W, Ferrari G, Martins CB, et al. Muscle-strengthening activities and cancer incidence and mortality. _Int J Behav Nutr Phys Act_. 2021;18(1):69.
16. Ramos-Campo DJ, Benito-Peinado PJ, Andreu-Caravaca L, Rojo-Tirado MA, Rubio-Arias JÁ. Efficacy of Split Versus Full-Body Resistance Training on Strength and Muscle Growth. _J Strength Cond Res_. 2024;38(7):1330-1340.
17. Iversen VM, Eide VB, Unhjem BJ, Fimland MS. Full-body resistance training promotes greater fat mass loss than a split-body routine in well-trained males. _Eur J Sport Sci_. 2024;24(6):846-854.
18. Remmert JF, et al. Is There Too Much of a Good Thing? Meta-Regressions of the Effect of Per-Session Volume on Hypertrophy and Strength. _SportRxiv_. 2025.
19. Harries SK, Lubans DR, Callister R. Systematic review and meta-analysis of linear and undulating periodized resistance training programs on muscular strength. _J Strength Cond Res_. 2015;29(4):1113-1125.
20. Grgic J, Mikulic P, Podnar H, Pedisic Z. Effects of linear and daily undulating periodized resistance training programs on measures of muscle hypertrophy. _PeerJ_. 2017;5:e3695.
21. Bell L, et al. Integrating Deloading into Strength and Physique Sports Training Programmes: An International Delphi Consensus Approach. _Sports Med Open_. 2023.
22. Bell L, et al. Deloading Practices in Strength and Physique Sports: A Cross-sectional Survey. _Sports Med Open_. 2024.
23. Ribeiro AS, Romanzini M, Schoenfeld BJ, et al. Effect of different warm-up procedures on the performance of resistance training exercises. _Percept Mot Skills_. 2014;119(1):133-145 (síntese consolidada em revisão sistemática, 2021).
24. Fradkin AJ, Zazryn TR, Smoliga JM. Effects of warming-up on physical performance: a systematic review with meta-analysis. _J Strength Cond Res_. 2010;24(1):140-148.
25. Revisiting the stretch-induced force deficit: A systematic review with multilevel meta-analysis of acute effects. 2024.
26. Practical recommendations on stretching exercise: A Delphi consensus statement of international research experts. 2025.
27. Lopes JSS, Machado AF, Micheletti JK, de Almeida AC, Cavina AP, Pastre CM. Effects of training with elastic resistance versus conventional resistance on muscular strength. _SAGE Open Med_. 2019;7.
28. Plotkin DL, Coleman M, Van Every D, et al. Progressive overload without progressing load? The effects of load or repetition progression on muscular adaptations. _PeerJ_. 2022;10:e14142.
29. No Time to Lift? Designing Time-Efficient Training Programs for Strength and Hypertrophy: A Narrative Review. _Sports Med_. 2021;51(10):2079-2095.
30. Lauersen JB, Andersen TE, Andersen LB. Strength Training as Superior, Dose-Dependent and Safe Prevention of Acute and Overuse Sports Injuries. _Br J Sports Med_. 2018;52:1557-1563.
