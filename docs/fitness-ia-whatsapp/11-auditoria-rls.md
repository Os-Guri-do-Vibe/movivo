# Auditoria — Sato: configuração efetiva de RLS

**Data:** 2026-10-06  
**Pasta do projeto:** docs/fitness-ia-whatsapp/  
**Escopo:** políticas PostgreSQL por operação, contexto de titular e isolamento A/B.  
**Status:** correções implementadas e validadas. Publicação rastreada pelo PR e workflow de deploy da branch `fix/rls-operacoes`.

## Resumo executivo

A MOVIVO usa PostgreSQL/PgBouncer e RLS como segunda barreira de autorização, com
contexto definido pelo backend em transações. Não bastava conferir ENABLE/FORCE:
a revisão encontrou permissões residuais sem papel válido, acesso anônimo amplo
no lookup inicial, vínculos entre recursos sem igualdade de titular e reconciliação
que preservava políticas extras. Essas lacunas foram corrigidas no catálogo central,
no contexto anônimo e no runner de migração, mantendo os fluxos existentes.

## Contexto recebido e verificação de produção

Esta revisão complementa `11-auditoria-autorizacao-rls.md` e a decisão operacional
`docs/arquitetura/decisoes/us-1.1-acesso-anamnese-anonima-e-rls.md`, seguindo
`docs/arquitetura/ARQUITETURA.md`. A autorização dos endpoints e a validação de
sessão continuam obrigatórias; a identidade de tenant não vem de um UUID fornecido
pelo navegador.

Uma inspeção SSH em transação READ ONLY, encerrada com ROLLBACK, confirmou na VPS:

- 26 tabelas de titular com ENABLE e FORCE RLS.
- Quatro políticas por tabela, separadas por SELECT/INSERT/UPDATE/DELETE, exceto
  `consents`, que possui três e nega DELETE por ausência de política.
- `movivo_app` sem SUPERUSER, BYPASSRLS ou CREATEROLE.
- `movivo_migrator` sem SUPERUSER/CREATEROLE, com BYPASSRLS para manutenção.
- Nenhuma política adicional nesse inventário. Foram consultados somente metadados,
  sem ler dados pessoais ou tokens de produção.

Essas verificações descrevem a configuração publicada antes desta correção.
A verificação pós-deploy deve confirmar a revisão da imagem e os predicados
corrigidos na VPS; o resultado da publicação é rastreado pelo PR e workflow.

## Achados e correções

| Achado | Correção |
|---|---|
| Atribuição profissional era visível por UUID sem exigir papel | SELECT exige PROFESSIONAL no caminho da própria atribuição; ADMIN/SYSTEM preservados |
| INSERT de auditoria própria aceitava papel ausente/desconhecido | Exige papel autenticado reconhecido, além da igualdade actor/titular |
| Lookup anônimo permitia todas as sessões órfãs sem escopo | Token de 256 bits parametrizado em GUC LOCAL; RLS exige correspondência no SELECT e INSERT |
| Cinco vínculos adicionais não comprovavam titular do pai | WITH CHECK de INSERT/UPDATE compara `parent.user_id` e titular do filho |
| Reconciliação removia somente nomes conhecidos de políticas | Remove todas as políticas das tabelas geridas antes de criar o catálogo esperado |
| Verificação de FORCE podia considerar homônimo em outro schema | Restringe o inventário a `public` |

Os cinco vínculos adicionados são protocolo→anamnese, protocolo→renovação,
renovação→protocolo anterior, conversa→protocolo e pagamento→assinatura.
Junto aos sete vínculos protegidos anteriormente, o catálogo cobre doze referências.
Referências opcionais nulas permanecem permitidas; quando preenchidas, exigem o
mesmo titular. Chaves estrangeiras verificam existência e não substituem essa
verificação de autorização.

A substituição de políticas roda em uma transação única no migrador. Não há estado
intermediário publicado entre remover e recriar as políticas. O catálogo é a fonte
exclusiva de políticas dessas tabelas: alterações futuras devem ser feitas nele,
para não serem descartadas na próxima reconciliação.

O fluxo anônimo conserva duas etapas: `runAsToken(cb, token)` para criação/lookup;
`runAsTokenScoped` após resolver a sessão para leitura/UPDATE da anamnese e
SELECT/INSERT de consentimentos. Sem token ou escopo, nenhuma órfã é visível.

## Validação

- Testes unitários completos: 2.138 aprovados, em 182 arquivos.
- Cobertura: statements 90,56%; branches 81,32%; functions 88,24%; lines 92,12%.
- TypeScript, lint dos arquivos alterados, build NestJS e `git diff --check` aprovados.
- Integração PostgreSQL real: 300 testes aprovados em 42 arquivos, em banco isolado recriado do zero.

`rls-operations.int-spec.ts` consulta como `movivo_app` via PgBouncer, testa
SELECT/INSERT/UPDATE/DELETE entre A/B, transferência indevida de titular, papel
vazio/desconhecido, catálogo por comando e remoção de política permissiva extra.
Também testa os cinco vínculos novos, com pai de B recusado e pai de A aceito.
Operações positivas e DDL de teste são revertidos; fixtures usam dados sintéticos.

`security-foundation.int-spec.ts` prova que lookup anônimo sem WHERE retorna
somente a sessão do token, contexto sem token não retorna órfãs, INSERT com token
diferente é negado e UPDATE sem filtro não modifica outra sessão. As suítes
existentes verificam onboarding, consentimentos, geração, renovação, pagamentos
e autorização HTTP com UUID de outro titular.

## Limites e decisões preservadas

RLS restringe linhas, não substitui autorização de campos no serviço. A conexão
server-side e os contextos SYSTEM/ADMIN são fronteiras confiáveis e privilegiadas;
RLS baseada em GUC não protege contra um invasor que controle essa conexão e
possa definir arbitrariamente o contexto. Credenciais de migração não servem tráfego.

O acesso CREF mantém a decisão vigente: fila por cargo, profissional ativo e
consentimento de saúde vigente. SUPPORT permanece limitado ao cadastro/status
permitidos. Dados globais de configuração e conhecimento não recebem RLS de
aluno indiscriminadamente. Registros append-only mantêm triggers e privilégios
restritos; adicionar uma política permissiva DELETE a consentimentos seria errado.

Não há garantia absoluta de ausência de falhas no sistema: o resultado se limita
ao fluxo, catálogo e cenários auditados. Não foram alteradas credenciais externas,
fornecedores ou o modo Sandbox do pagamento.

## Fontes Consultadas

- https://www.postgresql.org/docs/17/ddl-rowsecurity.html
- https://www.postgresql.org/docs/17/sql-createpolicy.html
