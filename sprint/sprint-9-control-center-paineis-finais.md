# Sprint 9 — Fechamento dos painéis finais do Control Center

**Autor:** execução consolidada de Produto, Engenharia e QA  
**Data:** 2026-08-14  
**Produto:** MOVIVO — AI Coach de treino no WhatsApp  
**Fase do pipeline:** Fase 5 — Desenvolvimento  
**Status:** ENTREGUE

## Objetivo e resultado

Esta entrega retirou o estado “em breve” dos sete itens restantes do Control Center sem
alterar a ordem de segurança do caminho da IA. O simulador foi concluído primeiro; FAQ e
guardrails L1 só passaram a publicar depois que o gate síncrono existia no servidor.

| Item | Resultado entregue | Commit |
|---|---|---|
| Simulador de configuração | quatro etapas, golden set, integridade L0 e revalidação no servidor | `0f5fdfe` |
| FAQ determinístico | histórico versionado, publish/rollback/retire e match exato antes do classificador | `604544c` |
| Guardrails L1 | regras aditivas exclusivamente `FLAG`, com revisão humana e sem bloqueio configurável | `95c96d3` |
| Auditoria | busca paginada por ator, período e ação, sem expor o conteúdo de `changes` | `41ec3c3` |
| Conhecimento RAG | upload em quarentena, revisão CREF obrigatória, indexação estreita e proveniência por resposta | `c369f3a` |
| Campanhas | economia por `utm_campaign` com o mesmo cálculo dos canais e k-anonimato | `46b2d0d` |
| Resultado & Projeção | realizado separado de três cenários projetados e base de cálculo visível | `bdb47d0` |

## Decisões de produto tomadas durante a execução

### 1. Upload do RAG aceita somente texto simples e Markdown

**Decisão:** aceitar `.txt` e `.md`, até 512 KiB. A entrada passa por validação de extensão,
MIME, tamanho em bytes, caracteres de controle, marcação ativa, dado pessoal evidente e
padrões de instrução direcionada à agente.

**Razão:** o valor do MVP está no conteúdo técnico, não em preservar o formato visual do
arquivo. Restringir a texto elimina macros, objetos incorporados e a maior parte da superfície
de arquivos compostos. PDF e DOCX exigiriam extração em sandbox e antimalware próprios.

### 2. Quarentena em PostgreSQL com retenção do original separada do histórico

**Decisão:** o payload fica em `knowledge_document_blobs`; metadados e revisões ficam em
tabelas distintas e imutáveis. O original pendente ou recusado expira em 30 dias; após
aprovação, em 365 dias. O expurgo apaga somente o blob. Metadados, revisão e chunks publicados
permanecem auditáveis. A role de runtime não pode alterar nem apagar o payload diretamente.

**Razão:** com teto de 512 KiB e volume inicial baixo, object storage adicionaria operação sem
reduzir risco material. Separar o blob permite cumprir retenção sem apagar a prova da decisão
profissional. O expurgo é oportunista ao abrir o painel e usa função estreita do banco.

### 3. Aprovação é uma decisão final por documento nesta versão

**Decisão:** cada upload recebe uma única decisão `APPROVED` ou `REJECTED`. Para corrigir um
documento recusado, envia-se novo arquivo; não se altera a linha anterior.

**Razão:** preservar o objeto exato que foi revisado evita uma troca de conteúdo entre revisão
e publicação. Novo SHA-256 significa novo documento e nova revisão.

### 4. Publicação do corpus é garantida no banco

**Decisão:** `movivo_app` continua sem `INSERT`, `UPDATE` ou `DELETE` direto em
`knowledge_base`. A publicação usa uma função `SECURITY DEFINER` estreita que confirma papel
profissional, CREF ativo e revisão aprovada mais recente antes de inserir os chunks.

**Razão:** capability na API protege a rota; a função protege a invariável mesmo se outro
caminho de aplicação tentar escrever no corpus.

### 5. Proveniência é um snapshot durável na resposta

**Decisão:** toda mensagem gerada com RAG persiste em `conversations.rag_sources` os IDs do
chunk e do documento, título e URL da fonte. Resposta bloqueada pelo validador não recebe
fontes, porque o texto de fallback não foi sustentado por elas.

**Razão:** a origem continua verificável mesmo depois que o original vence pela política de
retenção ou que o título externo muda.

### 6. `utm_campaign` é a unidade do experimento

**Decisão:** cada valor saneado de `utm_campaign`, dentro de seu canal canônico, forma uma
célula. A tela calcula CAC, receita recebida, ROAS, LTV/CAC e payback pela mesma função usada
no agregado por canal. Grupos com menos de 10 cadastros são omitidos por inteiro.

**Razão:** evita criar uma segunda entidade “experimento” que duplicaria o identificador já
presente nas URLs e no gerenciador de mídia. O painel mede; não edita campanhas externas.

### 7. Projeção financeira é simples, explícita e separada do realizado

**Decisão:** usar a média de até três meses fechados presentes simultaneamente em
`costByMonth` e `receivedRevenueByMonth`, excluindo o mês corrente. Horizonte de três meses:

- conservador: receita −10%, custo +10%;
- base: média histórica sem ajuste;
- otimista: receita +10%, custo −5%.

Sem um mês fechado comum às duas séries, a projeção fica indisponível. Cada valor é arredondado
para centavos antes da soma.

**Razão:** o histórico atual não sustenta sazonalidade ou regressão. Uma média curta torna a
premissa conferível pelo CFO e impede que precisão aparente seja confundida com fato.

## Simplificações deliberadas e seus limites

| Simplificação | Limite atual | Caminho de evolução |
|---|---|---|
| RAG apenas `.txt`/`.md` | não recebe PDF/DOCX nem imagem | extração em sandbox + antimalware antes de ampliar MIME |
| Blob no PostgreSQL | adequado ao teto de 512 KiB e baixo volume | object storage privado com URL assinada, mantendo metadados no banco |
| Expurgo ao abrir o painel | arquivo pode vencer antes da próxima abertura | job diário monitorado chamando a mesma função de expurgo |
| Sem retirada de documento aprovado nesta tela | corpus aprovado permanece ativo | evento append-only de retirada + remoção estreita dos chunks |
| Campanha é somente leitura analítica | não cria UTM nem opera Meta Ads | integração externa quando o volume justificar o custo operacional |
| Cenários fixos | não há ajuste manual de fatores | parâmetros versionados após validação do CFO e 12 meses de histórico |

## Garantias verificadas

- Nenhum item solicitado permanece com `soon` no menu.
- Controles sem capability ficam ausentes, não desabilitados.
- FAQ, guardrails, documentos e revisões preservam histórico append-only quando aplicável.
- `knowledge_base` permanece somente leitura para a role de runtime.
- Campanhas com `n=10` são publicadas; com `n=9`, suprimidas em PostgreSQL real.
- Projeções usam apenas meses fechados e não alteram as séries realizadas.
- Valores novos têm testes com igualdade exata, sem margem de tolerância.
- O quality gate consolidado cobre unitários, typecheck, lint e integrações reais.
