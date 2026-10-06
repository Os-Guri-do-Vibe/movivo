# Auditoria — Autenticação server-side (Sato)

**Data:** 2026-10-05
**Pasta:** `docs/fitness-ia-whatsapp/`
**Status:** CORRIGIDO NO CÓDIGO E VALIDADO LOCALMENTE — publicação e validação de produção acompanhadas no PR e no workflow Deploy.

**Escopo:** código após PR #157 (`d171a9c`), branch `fix/autenticacao-server-side`. Os achados descrevem o comportamento anterior; a seção 12 registra as correções aplicadas. Foram feitos apenas checks anônimos e leitura de configuração na VPS, sem testar contas reais.

## 1. Resumo Executivo

O sistema já verifica credenciais no backend e usa BFF server-side com cookies HttpOnly; não foi encontrada decisão de autorização baseada exclusivamente no estado do navegador. Foram encontradas falhas no ciclo de vida: logout sem access válido pode preservar o refresh, JWT não consulta o estado autoritativo da sessão, refresh prolonga a família indefinidamente e tokens de formulários permitem leitura após seu prazo. Essas falhas exigem correções compartilhadas, sem acrescentar uma plataforma de autenticação.

## 2. Escopo Avaliado

Referências internas: `AGENTS.md`, `apps/web/AGENTS.md`, `docs/arquitetura/ARQUITETURA.md`, ADR-006 e correções anteriores de links revogáveis.

| Superfície | Fronteira real de autenticação/autorização |
|---|---|
| Dashboard/Control Center | Server Components chamam `/auth/me`; BFF encaminha JWT HttpOnly; todos os controllers administrativos usam JwtAuthGuard e RolesGuard/CapabilitiesGuard |
| Conta: perfil, senha, upload | JWT no backend; identidade derivada de CurrentUser, sem userId fornecido pelo navegador |
| SSE de fila | JWT/RBAC na abertura; conexão limitada a cinco minutos, originalmente sem revalidação durante transmissão |
| Anamnese/consentimento | Token CSPRNG de sessão, escopo RLS e validação backend; consentimento exige prazo válido |
| Renovação/check-in | Token de sessão verificado no backend; mutações validam estado/consentimento, leitura tinha TTL dependente de status |
| Treino | Magic-link 256 bits, consumo atômico único, sessão SHA-256 no banco; backend valida kind, expiração e revogação em cada operação |
| Protocolo/assinatura/checkout | AccessLinkService verifica hash, propósito, prazo, revogação e titular não anonimizado; UUID isolado não autoriza |
| Short-links | Alias com hash e prazo no banco; destino ainda exige sua própria credencial |
| Webhooks | Verificação no serviço/adapter backend, segredo/HMAC conforme fornecedor, nonce e identidade do remetente; HTTP 200 uniforme não significa aceitação |
| Avatar de staff | Exceção pública documentada: UUID opaco e cache de um ano. Não protege sessão nem conteúdo de saúde; publicação é uma decisão de produto existente |

## 3. Modelo de Ameaças

Atacante pode ignorar UI/proxy, acessar API diretamente, reapresentar tokens roubados, concorrenciar refresh e manter conexão SSE aberta. Não pressupomos comprometimento da chave privada nem acesso administrativo ao banco. Os cenários principais são sessão que continua válida após logout, privilégio mantido por estado obsoleto e leitura de dados por token vencido.

## 4. Vulnerabilidades Identificadas

1. **Logout incompleto (Alto).** `apps/web/src/app/api/dashboard/_lib/bff.ts`, `logoutBackend`: só encaminha access se presente, ignora status HTTP e limpa cookies no finally. `AuthController.logout` exige access válido. Após expiração de 15 minutos, a sessão renovável de 30 dias pode continuar no banco, inclusive quando a UI anuncia logout.
2. **Revogação sem estado autoritativo no access (Alto).** `JwtStrategy.validate` originalmente verifica denylist Redis e papel, sem conferir `auth_sessions.jti`, titular, `revoked_at` e prazo. Perda de estado da denylist pode reativar JWT de sessão revogada até expiração.
3. **Prazo de refresh deslizante ilimitado (Médio).** `AuthService.refresh` calcula novo `expiresAt` a partir do momento da rotação. Família continuamente utilizada não tem teto de 30 dias desde o login.
4. **TTL de leitura condicionado ao status (Alto para anamnese/renovação; Baixo para check-in).** `getByToken` e `isExpired` nos três serviços originalmente expiram somente IN_PROGRESS/PENDING. Sessões SUBMITTED/EXPIRED continuam legíveis; anamnese expõe identificação/rotina e renovação expõe respostas. Mesmo a primeira leitura vencida retornava view com parte dos dados.
5. **Senha alterada sem revogar sessões (Alto em resposta a comprometimento).** `AccountService.changePassword` atualiza apenas passwordHash. Possuidor de refresh anterior pode continuar autenticado após a troca.
6. **SSE não revalida sessão (Baixo).** `DashboardService.events` autoriza uma vez; `DashboardQueueEventsService.stream` continua por até cinco minutos mesmo após logout/expiração. Emite apenas invalidação/heartbeat, sem IDs nem conteúdo de saúde; o fetch seguinte volta a passar pelo guard.
7. **Validação explícita de claims incompleta (Médio, defesa em profundidade).** Assinatura RS256/kid e expiração quando presente são validadas, mas a estratégia deve exigir exp/iat finitos e jti UUID; não basta pressupor que todos os tokens assinados foram emitidos pelo caminho atual.

## 5. Impacto Potencial

Reuso de sessão roubada após logout/troca de senha, prolongamento do acesso e leitura de identificação/rotina fora do prazo prometido. Não há evidência, nesta auditoria, de exploração real ou vazamento de chave privada.

## 6. Probabilidade de Exploração

Logout expirado ocorre no uso normal. Exploração contra outra pessoa exige obter um token/cookie válido; adivinhar tokens CSPRNG não é viável. O bypass de prazo dos formulários exige apenas conservar um link legítimo, sem quebrar criptografia.

## 7. Classificação de Risco

Risco agregado **Alto** antes das correções. O julgamento depende dos caminhos demonstrados, não de qualquer afirmação de que o sistema seja totalmente seguro.

## 8. Controles de Segurança Recomendados

Consultar sessão persistida em toda operação JWT protegida; exigir claims completas; tratar logout por credencial renovável, com revogação transacional da família e confirmação HTTP; manter prazo absoluto na rotação; revogar sessões ao trocar senha; interromper SSE ao perder validade; impor TTL independente de status em leitura e escrita. Manter cookies HttpOnly/Secure/SameSite, CSRF same-origin e RBAC backend já existentes.

## 9. Impacto na Arquitetura

Preserva NestJS, JWT RS256, PostgreSQL/RLS, Redis e BFF. Estado de `auth_sessions` já existe e oferece a autoridade de revogação; Redis continua auxiliar, sem ser a única prova de sessão viva. Não requer Auth.js adicional nem nova dependência.

## 10. Impacto na Privacidade e LGPD

Prazo de autorização deve limitar o acesso, não apagar registros históricos necessários à operação. A correção dos getters rejeita leitura vencida sem devolver dados, preservando registros SUBMITTED no banco. Não registrar JWT, refresh, cookies ou respostas sensíveis nos eventos de auditoria.

## 11. Estratégia de Monitoramento

Manter eventos estruturados auth_login, auth_logout e auth_refresh_reuse; acompanhar falhas de revogação, sessão expirada, token órfão e taxas de 401/403. Alertar por reuse e por erro de persistência durante logout, usando identificadores internos e requestId sem credenciais em claro.

## 12. Plano de Mitigação

As sete falhas foram corrigidas:

- **JWT:** exige UUID em `sub/jti`, papel conhecido, `iat/exp` inteiros, expiração futura e janela máxima configurada. `AuthService.assertActiveSession` verifica jti, titular, prazo, revogação e papel atual no PostgreSQL a cada operação. O cache de papel não concede mais autenticação; perda da denylist não ressuscita sessão.
- **Logout:** `/auth/logout/refresh` autentica pelo segredo opaco e revoga a família inteira, inclusive com access expirado ou refresh ancestral. O contrato Bearer anterior continua disponível. BFF só remove cookies após confirmação HTTP; falha de rede/servidor não é anunciada como logout pela UI. A revogação persistida também protege se o Redis falhar depois do commit.
- **Refresh:** prazo absoluto preservado a cada rotação; ambiente recusa TTL access acima de 15 minutos, refresh acima de 30 dias ou formato inválido. Migração `0067_prazo_absoluto_auth_sessions.sql` recupera o menor prazo das famílias legadas, incluindo gerações revogadas, sem prorrogar ou apagar sessões. Esse histórico existe e não tem limpeza no código atual.
- **Concorrência:** logout, refresh e reuse compartilham advisory lock transacional por família; refresh trava staff antes da sessão. Login revalida hash e papel sob lock antes de emitir sessão, fechando corrida com mudança de senha/papel.
- **Senha:** verificação da senha atual, alteração e revogação de todas as sessões ocorrem na mesma transação. BFF limpa cookies após 204; UI exige novo login.
- **SSE:** cada evento/heartbeat revalida a sessão no banco; timer encerra no instante de expiração do access, além do limite original de cinco minutos. Após revogação, não transmite novos eventos; conexão ociosa detecta revogação no próximo heartbeat (até 25 segundos).
- **Formulários:** anamnese, renovação e check-in validam prazo em qualquer status e retornam 410 sem dados quando vencidos. Histórico SUBMITTED é preservado; fluxo de retomada já trata expiração.

Removido do BFF o contador local de negativas 403 que apenas apagava cookies e chamava isso de encerramento de sessão. Respostas 403 legítimas continuam sendo decisões de autorização do backend; não simulam logout local.

## 13. Estratégia de Resposta a Incidentes

Diante de token roubado, revogar a sessão/família ou todas as sessões da conta no banco; confirmar recusa de access e refresh anteriores, inclusive após perda de cache. Preservar logs redigidos e registros de auditoria. Rotação da chave JWT somente se houver comprometimento do material de assinatura; não confundir revogação de sessão com troca de chave global.

## 14. Plano de Validação

Testes unitários de cada serviço cobrem leitura vencida em IN_PROGRESS/PENDING, SUBMITTED e EXPIRED, além de EXPIRED com prazo futuro para anamnese/renovação. Checar boundary exato do prazo, token ausente/inválido, refresh consumido concorrentemente, reuse, logout sem access, logout com backend indisponível, senha alterada e sessão revogada com Redis limpo. Validar por HTTP a API diretamente, sem depender da tela. Não executar login/pagamento/mensagens contra usuários reais como teste.

Validação executada:

| Check | Resultado |
|---|---|
| API unitários + cobertura | 2.133 testes passaram; gates ≥80% passaram (branches 81,30%) |
| Web unitários + cobertura | 973 testes passaram; gates ≥80% passaram (branches 80,49%) |
| Integração real PostgreSQL/PgBouncer/Redis | 259 cenários distintos validados; inclui todas as operações administrativas por HTTP sem autenticação, logout, concorrência, expiração, Redis sem revogação, mudança de papel, senha e migração legada |
| Typecheck, lint, build API/web/shared | Passaram |
| Migração 0067 | Aplicada em banco local e banco descartável; teste confirma prazo das gerações antigas e rejeição de access/refresh vencidos |
| Inspeção anônima da produção | `/auth/me`, `/account/profile` e `/professional/dashboard/queue` retornaram 401 sem token; configuração 15m/30d confirmada |

A primeira execução ampla no stack de desenvolvimento encontrou disputa de workers, fixture RAG previamente existente e acesso a provedor real. Foi substituída por uma cópia temporária do código, secrets novos, cinco containers de dados, volumes/rede próprios e `.env.example`, sem chaves de fornecedores. Na execução isolada, 258/259 cenários passaram; o único erro foi o smoke antigo fixando a porta 5433, enquanto o PgBouncer isolado usava 25433. O smoke foi corrigido para conferir a porta validada na configuração, rejeitar 5432 e verificar `via=pgbouncer`/prepared statements desativados; reexecução dos três cenários de health passou. Não foi alterada a configuração da VPS nem executado teste autenticado contra usuário real.

Comandos de referência: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm --filter @movivo/api test:cov`, `pnpm --filter @movivo/web test:cov`, `pnpm --filter @movivo/api test:int`. A integração ampla deve usar ambiente descartável como o CI, sem API concorrente nem chaves de fornecedores.

## 15. Próximos Passos

Publicar as alterações e aplicar a migração 0067 antes de considerar o ambiente de produção corrigido. A migração pode encerrar famílias antigas cujo prazo original já venceu; exigir novo login é o efeito esperado. Publicar API antes do web/BFF, pois o BFF passa a usar `/auth/logout/refresh`; a ordem atual de dependências/health do Compose atende esse requisito.

Limites explícitos:

- Refreshes simultâneos com o mesmo token encerram a família por detecção de reuse. Comportamento seguro, mas concorrência entre abas pode exigir novo login. Não foi introduzida janela de tolerância que reaceite token consumido.
- A sessão de treino tem prazo fixo de 30 dias e nenhuma opção de logout visível atualmente. Se adicionada, deve revogar token no servidor antes de apagar cookie.
- Avatar público continua exceção explícita; não deve ser apresentado como recurso privado.
- A auditoria cobre as fronteiras encontradas e os cenários testados; não constitui garantia de ausência de toda vulnerabilidade ou pentest completo.

## 16. Fontes Consultadas

- https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html — autoridade server-side, invalidação e prazos.
- https://www.rfc-editor.org/rfc/rfc9700.html — refresh rotation/replay e revogação; referência de boas práticas, sem afirmar que o protocolo próprio seja OAuth.
- https://github.com/vercel/next.js/security/advisories/GHSA-f82v-jwr5-mffw — CVE-2025-29927 demonstra o risco de depender apenas de middleware; não é finding de versão vulnerável atual.
- https://vercel.com/blog/postmortem-on-next-js-middleware-bypass — contexto oficial do bypass.
- https://github.blog/news-insights/company-news/security-alert-stolen-oauth-user-tokens/ — caso público de roubo/reuso de tokens; não incidente da MOVIVO.

As fontes fundamentam os controles. A evidência dos achados vem do código local; não foi executado pentest completo, teste de invasão nem coleta de credenciais reais. Nenhum incidente do setor wellness foi utilizado como prova do sistema.
