# Auditoria — Autorização e RLS (Sato)

**Data:** 2026-10-05

**Pasta:** `docs/fitness-ia-whatsapp/`

**Status:** CORREÇÕES IMPLEMENTADAS E VALIDADAS LOCALMENTE. Publicação e validação de produção acompanhadas no PR e no workflow Deploy.

**Base:** `origin/main` em `e0c2ae5` (PR #160), após as correções de secrets e autenticação. Branch `fix/autorizacao-rls`, worktree `/Users/rodrigo/Documents/movivo-autorizacao-rls`. As alterações em andamento no worktree original foram preservadas.

## 1. Resumo executivo

Não foi encontrado IDOR HTTP explorável nos fluxos de aluno inspecionados: a credencial resolve o titular no servidor, e trocar um UUID não concede acesso. Entretanto, havia exceções de autorização no banco e no guard de papéis: INSERT sem contexto, funções privilegiadas que não rejeitavam papel NULL e leitura profissional sem confirmar CREF ativo. Essas falhas foram corrigidas com testes reais, além da validação do titular de recursos-pai nas escritas de treino e protocolo.

## 2. Contexto recebido e escopo

A auditoria segue `AGENTS.md`, `docs/arquitetura/ARQUITETURA.md`, ADR-006, a decisão de anamnese anônima/RLS e as auditorias anteriores de secrets e autenticação. Avaliou RLS ENABLE/FORCE, políticas, roles de banco, contexto transacional, funções SECURITY DEFINER, guards de papel/capacidade e operações HTTP de alunos. A inspeção na VPS foi somente leitura, sem contas reais, criação de sessões, cobrança ou mensagens.

## 3. Modelo de ameaças

Atacante pode trocar UUIDs em path/body/query, usar credencial de outro propósito, ignorar UI e acessar a API diretamente. Também avaliamos chamadas internas que esqueçam contexto ou filtro de titular. O contexto SQL é estabelecido pelo backend, não pelo aluno; RLS baseada em GUCs não é uma defesa contra um atacante que já controla a conexão SQL e pode definir `SYSTEM`.

## 4. Achados e correções

| Achado anterior | Consequência | Correção |
|---|---|---|
| `users_rls_insert` aceitava UID ausente | INSERT autorizado sem contexto | Alunos e staff só podem ser criados em SYSTEM/ADMIN; onboarding permanece em `runAsSystem` |
| Predicado self não exigia papel conhecido | UID isolado podia liberar a própria linha | Self exige um papel explícito do conjunto fechado de papéis |
| Comparações `<>`, `NOT IN` e `IF NOT` sobre papel NULL | Rejeição podia não executar em funções privilegiadas | `IS DISTINCT FROM`, `coalesce` e `IS NOT TRUE` recusam contexto ausente |
| `has_active_health_consent` não validava CREF ativo | Profissional inativo podia continuar lendo dados de alunos com consentimento | Disjunto profissional exige staff correspondente, papel PROFESSIONAL e `cref_active = true` |
| `RolesGuard` permitia ausência/lista vazia de papéis | Um endpoint com guard incompleto concedia acesso autenticado | Ausência ou lista vazia retorna 403; inventário testa todas as rotas que usam esse guard |
| `user_id` denormalizado sem comprovar titular do pai | Uma escrita interna podia ligar registro de A ao recurso de B | WITH CHECK exige parent.id e parent.user_id corretos no INSERT e UPDATE de sete tabelas |
| Runner só conferia BYPASSRLS/ownership | Uma role superusuária também contornaria RLS | Runner agora rejeita SUPERUSER explicitamente |

As funções auditadas/corrigidas incluem `has_active_health_consent`, `link_session_consents_to_user`, `assign_unique_active_professional`, `publish_knowledge_document`, `purge_expired_knowledge_blobs`, `record_session_consent`, revogações de consentimento e `assigned_active_professional`. Nas funções de publicação, os demais gates de revisão e proveniência continuam obrigatórios. A ausência de papel nunca os substitui.

A integridade de titular do pai foi imposta em `protocol_versions`, `protocol_substitution_requests`, `checkins`, `workout_completions`, `workout_sessions`, `workout_set_entries` e `workout_access_tokens`. Referência nullable continua permitida quando NULL; um UUID preenchido exige pai do mesmo titular. Checks ficam no WITH CHECK, evitando recursão de policies e mantendo a filtragem de leitura por titular.

## 5. Superfícies e regra efetiva de autorização

| Superfície | Regra validada |
|---|---|
| Treino/diário/start/sets/finish/share-card | Credencial opaca validada no banco resolve userId; `ownedSession` filtra id + userId; RLS é uma segunda barreira |
| Protocolo/PDF | AccessLink de propósito PROTOCOL resolve titular/recurso; UUID de aluno/protocolo não é credencial |
| Portal de assinatura | AccessLink SUBSCRIPTION_PORTAL determina o titular; preço/assinatura não vêm de userId editável |
| Checkout | Credencial CHECKOUT distinta, expirável/revogável; token de outro propósito é recusado |
| Anamnese/consentimento | Token opaco e prazo; mutações anônimas usam escopo da sessão; submit cria/vincula aluno em contexto SYSTEM |
| Renovação/check-in | Token resolve uma sessão e titular no backend; UUID de outro recurso não autoriza |
| Dashboard CREF | JWT válido não basta: RolesGuard/capacidades e RLS profissional com consentimento e CREF ativo |
| Control Center | CapabilitiesGuard já nega ausência de política, papel desconhecido e lista vazia; mapa fechado de capacidades |
| Conta interna | JWT/session autoritativa; identidade é a de CurrentUser; não recebe userId do navegador para selecionar outra conta |

A fila do CREF continua acessível por cargo, não por atribuição nominal, conforme decisão explícita de 2026-08-19. ADMIN mantém o escopo amplo de fundador já definido. SUPPORT continua restrito a cadastro/status comercial, sem acesso às tabelas de saúde. Configurações globais, corpus RAG, finanças da empresa e favoritos globais do catálogo não são dados tenant-scoped; a autorização de seus endpoints é por capacidade.

## 6. Evidências em produção (somente leitura)

- PostgreSQL 17.11.
- Role `movivo_app`: SUPERUSER=false, BYPASSRLS=false, CREATEROLE=false; zero memberships herdadas.
- Tabelas tenant-scoped encontradas com ENABLE e FORCE; ownership em `movivo_migrator`.
- Zero policies fora dos nomes canônicos nas tabelas com RLS. Isso não substitui os testes dos predicados.
- Zero inconsistências de titular em workout_sessions→protocols e workout_set_entries→workout_sessions nas contagens verificadas.
- A inspeção descrita nesta seção antecedeu a publicação das correções e não alterou a VPS. A aplicação das policies é acompanhada no PR e no workflow Deploy.

Foram consultados os advisories oficiais de CVE-2024-10976 (corrigida em 17.1) e CVE-2025-8713 (corrigida em 17.6). A versão observada 17.11 incorpora essas correções; não se conclui, a partir desses dois advisories, que toda a infraestrutura esteja livre de qualquer vulnerabilidade.

## 7. Validação executável

- **2.138 testes unitários da API**, 182 arquivos, aprovados.
- **279 testes de integração**, 41 arquivos, aprovados em PostgreSQL/PgBouncer/Redis descartáveis e isolados, sem workers concorrentes ou credenciais de terceiros.
- Cobertura: statements 90,56%; branches 81,30%; functions 88,22%; lines 92,12%, acima dos gates vigentes de 80%.
- Typecheck da API, lint dos arquivos alterados e build da API aprovados.
- `authorization.int-spec.ts`: quatro rotas de treino com UUID B retornam 404 usando credencial A; B permanece inalterado; acesso próprio funciona; UUIDs e tokens de outro propósito são recusados; query IDs falsificados não mudam o titular; parent B é recusado por RLS e parent A é aceito com rollback.
- `security-foundation.int-spec.ts`: ausência de papel, papel desconhecido, INSERT sem contexto, autocadastro de staff ADMIN, oito funções privilegiadas sem papel e CREF inativo são recusados; catálogo comprova ENABLE/FORCE/ownership nas tabelas de titular.
- Inventário real dos controllers garante papéis não vazios nas rotas com RolesGuard. Os testes existentes mantêm a matriz de capacidades dos papéis internos.

Logs locais de verificação: `/tmp/movivo-access-full-integration.log`, `/tmp/movivo-access-coverage.log`, `/tmp/movivo-access-typecheck.log` e `/tmp/movivo-access-build.log`. Nenhuma chave ou dado de aluno real foi copiado para o relatório.

## 8. Entrega e aplicação

As policies são reconciliadas pelo runner existente `db:migrate`, idempotentemente, após migrações Drizzle. Nenhuma alteração de coluna/tabela ou nova dependência foi necessária, portanto não há nova migração versionada. O deploy padrão executa esse runner antes de atualizar API/frontend; ele aplicará as funções e policies corrigidas.

A decisão de criação de usuário no documento de anamnese/RLS foi atualizada para refletir SYSTEM/ADMIN, eliminando a orientação anterior de INSERT sem contexto.

## 9. Limites e acompanhamento

Esta auditoria comprovou os cenários listados, sem prometer segurança absoluta de todo o sistema. Funções SYSTEM e ADMIN têm privilégios intencionais e seus callers continuam sendo fronteiras confiáveis; nunca podem receber identidade/contexto arbitrário do navegador. O lookup inicial anônimo da anamnese ainda exige filtro por token, pois antecede o conhecimento do sessionId; mutações usam escopo explícito. Possuir a credencial opaca completa de B é comprometimento de credencial, não troca de UUID; a proteção depende de prazo, revogação, redaction e armazenamento server-side auditados anteriormente.

Não foi realizada análise forense histórica nem identificada evidência de exploração nesta inspeção. As contagens de consistência foram agregadas e limitadas às duas relações de treino verificadas; não comprovam ausência histórica de incidente. Releases futuras devem manter os testes de autorização e conferir o catálogo de policies, além de conservar runtime sem role privilegiada.

## Fontes Consultadas

- https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- https://www.postgresql.org/docs/17/ddl-rowsecurity.html
- https://www.postgresql.org/docs/current/plpgsql-control-structures.html
- https://www.postgresql.org/support/security/CVE-2024-10976/
- https://www.postgresql.org/support/security/CVE-2025-8713/
