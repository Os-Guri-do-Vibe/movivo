# RAG, memória e respostas fundamentadas

**Status:** implementado no backend do MVP

**Data:** 2026-08-27

## Objetivo e limite honesto

O Coach não responde dúvidas técnicas usando apenas o conhecimento paramétrico do LLM. Ele busca
documentos publicados, testa se o material basta, gera afirmações atômicas com referências e faz
uma segunda verificação antes de entregar. Ausência, conflito, JSON inválido ou afirmação sem
suporte resultam em abstinência e revisão humana.

Isso reduz substancialmente o risco de alucinação; não cria garantia matemática de verdade. RAG
também falha quando recupera a fonte errada, quando a fonte está errada ou quando o verificador
erra. A propriedade garantida pelo código é mais estreita: **nenhum texto técnico gerado passa sem
os gates definidos abaixo**.

## Fluxo implementado

1. **Governança do corpus:** só a versão cujo último evento é `PUBLISHED` participa da busca. Cada
   trecho leva documento, versão, SHA-256, evento de publicação, categoria e confiabilidade.
2. **Privacidade:** a consulta passa pelo scrubber de PII. Em produção, embeddings externos só
   iniciam se o endpoint `/embeddings` tiver atestado próprio para `HEALTH` — separado do chat.
3. **Recuperação adaptativa:** pergunta simples faz uma busca; pergunta composta é decomposta em
   até quatro subconsultas. É uma versão determinística e barata do princípio do Adaptive-RAG.
4. **Busca híbrida:** PGVector/HNSW e full-text search em português são fundidos com Reciprocal
   Rank Fusion. Resultados de subconsultas são reunidos sem duplicação.
5. **Reranking e diversidade:** o score combina semântica, RRF, cobertura lexical e autoridade da
   fonte. O top-K limita cópias do mesmo documento e remove trechos idênticos.
6. **Gate de cobertura:** sem sobreposição mínima ou score semântico forte, o sistema se abstém
   sem chamar o gerador.
7. **Gate de suficiência e conflito:** um auditor recebe pergunta, evidências e estado estruturado
   do aluno. `SAFETY > METHODOLOGY > SCIENTIFIC_EVIDENCE > EXERCISE_LIBRARY > OTHER`; restrições
   do aluno prevalecem sobre orientação genérica. Lacuna ou conflito fecha a resposta.
8. **Geração por afirmação:** o modelo retorna JSON validado por Zod, com no máximo seis afirmações
   curtas e uma ou duas evidências por afirmação. O modo JSON nativo é solicitado quando suportado.
9. **Checks determinísticos:** IDs duplicados ou inválidos, referência fora do conjunto autorizado,
   citação inventada e qualquer número ausente da evidência/estado bloqueiam a resposta.
10. **Verificação final:** outra chamada classifica cada afirmação como `SUPPORTED`,
    `CONTRADICTED` ou `INSUFFICIENT` contra a evidência citada e o estado autoritativo. Uma única
    falha bloqueia o texto inteiro.
11. **Proveniência visível e auditável:** a resposta mostra `[E1: título vN]`; o JSONB da conversa
    persiste a relação afirmação↔evidência, modelo verificador, SHA-256 e evento de publicação.
12. **Guardrails finais:** a resposta fundamentada ainda passa pelos validadores de linguagem,
    escopo, segurança CREF e handoff humano existentes.

## Memória: o que é fato e o que é resumo

O estado autoritativo vem de tabelas sob RLS: protocolo ativo, objetivo, fase, semana, restrições,
equipamentos, cinco treinos recentes e três check-ins concluídos. O conteúdo criptografado livre do
check-in não é aberto; somente ajustes estruturados entram, por minimização.

A janela recente do Redis e o resumo diário ajudam continuidade, mas **não são tratados como fato
autoritativo no verificador**. Essa separação evita transformar uma frase antiga ou um resumo
imperfeito em restrição clínica. O desenho cobre atualização temporal e abstinência destacadas por
LongMemEval; memória associativa em grafo no estilo HippoRAG fica fora do MVP porque o estado atual
é pequeno, fortemente estruturado e não justifica uma nova infraestrutura.

## Critério de aceite e avaliação contínua

O gate de release do modelo deve usar um corpus congelado e versionado da MOVIVO e medir, separado
por etapa:

- retrieval: recall@K da evidência necessária, precisão do contexto e taxa de documento errado;
- geração: precisão/recall de afirmações suportadas e precisão das citações;
- segurança: taxa de contradição aceita, número inventado aceito e violação de restrição do aluno;
- calibração: resposta correta entre as respondidas e abstinência correta quando falta contexto;
- operação: p50/p95, tokens, cache hit, custo e taxa de fallback por provedor.

Os testes automatizados provam os contratos determinísticos e os caminhos de abstinência com LLMs
mockados. A homologação empírica de DeepSeek versus GPT versus Claude exige executar o mesmo golden
set em endpoints aprovados; sem isso, nenhuma alegação de superioridade de desempenho é válida.

## Fontes primárias que orientaram o desenho

- Adaptive-RAG, NAACL 2024: https://aclanthology.org/2024.naacl-long.389/
- RAGChecker, NeurIPS 2024: https://proceedings.neurips.cc/paper_files/paper/2024/hash/27245589131d17368cccdfa990cbf16e-Abstract-Datasets_and_Benchmarks_Track.html
- Sufficient Context, ICLR 2025: https://openreview.net/forum?id=Jjr2Odj8DJ
- Ground Every Sentence, NAACL 2025: https://aclanthology.org/2025.findings-naacl.55/
- Authority Bias in RAG, ACL 2025: https://aclanthology.org/2025.acl-long.1400/
- Conflict-Aware RAG, EMNLP 2025: https://aclanthology.org/2025.emnlp-main.1371/
- RLSeek, ACL 2026: https://aclanthology.org/2026.acl-long.1492/
- LoCoMo, ACL 2024: https://aclanthology.org/2024.acl-long.747/
- LongMemEval, ICLR 2025: https://openreview.net/forum?id=pZiyCaVuti
- HippoRAG, NeurIPS 2024: https://proceedings.neurips.cc/paper_files/paper/2024/hash/6ddc001d07ca4f319af96a3024f6dbd1-Abstract-Conference.html
- LoCoMo-Plus, ACL 2026: https://aclanthology.org/2026.acl-long.1150/
