# Artigos padrão da Base de Conhecimento

Os 48 artigos de `articles/` são carregados no banco a cada deploy pelo `migrate.js`
([`default-articles.ts`](../../src/core/database/default-articles.ts)). É o conteúdo que a busca (RAG) consulta
ao responder o aluno e na revisão semanal: musculação, corrida, treino híbrido, HYROX, nutrição, recuperação e
hábitos. Cada arquivo é uma síntese curta de um tema, escrita para a busca (conclusão no começo, um assunto por
arquivo), a partir das fontes listadas em [`docs/base-conhecimento/`](../../../../docs/base-conhecimento/).

## Como a carga funciona

- **Só insere o que falta.** Se já existe um documento com o mesmo hash **ou com o mesmo título**
  (a equipe enviou a versão dela), o artigo padrão é pulado: nunca sobrescreve nem duplica.
- **Artigo excluído não volta.** Ao excluir um artigo pelo painel, a auditoria guarda o hash e a chave dele
  (nunca o conteúdo). A carga reconhece essa "lápide" e não o recria no deploy seguinte. Para tirar um padrão
  de vez, basta excluí-lo no painel.
- **Aparece no painel como qualquer artigo** (Base de Conhecimento → Artigos), com texto, trechos e
  original. Sem "enviado por" e sem revisor: é carga do sistema, como as fichas dos agentes e a metodologia
  padrão. O corpus que a busca lê é o mesmo que o envio pelo painel gravaria.
- **Sem rede e sem chave.** Os vetores já vêm calculados no `manifest.json`. A carga reconfere, antes de
  gravar: hash do original, hash do texto extraído, título, hash de cada trecho e dimensão do vetor. Se um
  artigo mudou e o manifesto não foi regerado, o migrate **falha** (o deploy para), em vez de publicar vetor de
  outro texto. A varredura de segurança dos uploads também roda.

## Como mudar, trocar ou acrescentar um artigo

1. Edite ou crie o `.md` em `articles/`. Formato: título `# …` na primeira linha, depois o cabeçalho
   (`Tipo:`, `Domínio:`, `População:`, uma linha por campo), a `Conclusão:` e as seções. Nome do arquivo em
   minúsculas, com hífens. Sem autor, estudo, DOI ou link no corpo: o agente não pode citar, e a rastreabilidade
   fica em `docs/base-conhecimento/`.
2. Gere o manifesto, com o embedding **real** (precisa de `OPENAI_API_KEY` e
   `KNOWLEDGE_OPENAI_EMBEDDING_HEALTH_DATA_APPROVED=true`):
   `pnpm --filter @movivo/api knowledge:build-defaults`. Só o que mudou paga embedding.
3. Confira o `git diff` do `manifest.json` e faça o commit dos dois juntos. O teste
   [`default-articles.spec.ts`](../../src/core/database/default-articles.spec.ts) reprova arquivo e manifesto
   que divergem.
4. Mudou o texto de um artigo que já está em produção? O padrão novo **não** o substitui lá: o título é a
   mesma chave, e a carga nunca sobrescreve. Em produção, a versão nova sobe pelo painel (nova versão do mesmo
   título). Excluir o antigo também não faz o padrão novo entrar, porque a exclusão deixa a lápide. Ambientes
   novos (banco vazio) já nascem com a versão do repositório. Evolução do dia a dia é pelo painel; este
   diretório é o ponto de partida.

## O que NÃO entra aqui

Regras de comportamento dos agentes, números que o aluno recebe, protocolos e a lista de referências. Isso é da
Metodologia e das fichas. Em `articles/` só entra texto que a busca possa entregar ao agente como evidência.
