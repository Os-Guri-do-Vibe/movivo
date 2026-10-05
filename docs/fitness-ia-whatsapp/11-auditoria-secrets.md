# Auditoria — Secrets, KEYS e credenciais (Sato)

**Data:** 2026-10-05 · **Projeto:** MOVIVO / fitness-ia-whatsapp  
**Status:** correções estruturais implementadas e aplicadas em produção; troca das cinco chaves de fornecedores depende de emissão nos consoles e não foi realizada. Não há garantia de segurança absoluta.

## 1. Resumo Executivo

A exposição confirmada era de credenciais bearer de alunos em logs, incluindo acesso a protocolo e checkout. O acesso legado foi encerrado na API, substituído por tokens aleatórios revogáveis server-side e testado diretamente, sem depender de bloqueio no Nginx. Logs passam por redação antes da persistência; erros Nginx continuam disponíveis em categorias seguras. Frontend recebe somente configuração pública no build e não recebe secrets em runtime.

No cutover inicial auditado, API e web de produção usaram a tag `security-c07ffe80a2fa`. Os dez serviços estão saudáveis; home e health retornam 200. Não houve alteração de chaves de banco, cifra de dados, JWT ou fornecedores. AraraHQ foi retirada da configuração/mounts/provisionamento e o arquivo não utilizado removido da VPS; a credencial no fornecedor não foi revogada.

## 2. Escopo Avaliado

Código e configuração, arquivos `.env` disponíveis, histórico Git alcançável, CI/CD, contextos e artefatos de build locais, imagens e layers Docker, arquivos públicos, bundles frontend, logs da VPS, permissões, backups e secrets protegidos GitHub. Relatórios anteriores, `ARQUITETURA.md`, ADR-005-R2 e ADR-011 orientam as decisões; gates de dados de saúde e pagamento Sandbox permanecem vigentes.

| Superfície | Evidência sanitizada |
|---|---|
| Git | Gitleaks: 311 commits alcançáveis / 287 varridos, zero secrets identificados |
| Arquivos locais | 14 achados: credenciais em arquivos locais ignorados e chaves internas geradas pelo Next; nenhum achado confirmado no código versionado |
| Build local | Canary de credencial herdada ausente de 887 arquivos `.next`; wrapper de env testado |
| Artefatos locais | `.next` 873, públicos 12, API dist 1224, Turbo 888 arquivos comparados com valores conhecidos: zero credenciais operacionais |
| GitHub Actions | 26 logs recentes comparados com 18 secrets locais: zero matches; 19 achados Gitleaks eram fingerprints GPG públicos de 40 hex do container SAST |
| GitHub proteção | Environment `production`: API_ENV_PRODUCTION, VPS_KNOWN_HOSTS, VPS_SSH_KEY; secrets/vars de repositório vazios na consulta. Valores protegidos não são legíveis pela API |
| Imagens anteriores | API/web e77b94d e a1b77af: 62 entradas, 38 layers gzip, 750.956.539 bytes, zero matches com credenciais runtime; metadados/history também sem matches |
| Imagens finais | API/web candidatas: 38 entradas, 24 gzip, 493.031.421 bytes, 19 valores conhecidos incluindo Arara antes da remoção: zero matches; image inspect zero matches |
| BuildKit final | 4 arquivos `.db`/`.json`, 34.697.216 bytes, 18 valores runtime, zero matches; nenhum arquivo desses tipos >100 MB pulado. Conteúdo integral de todo cache não foi varrido |
| Logs VPS iniciais | 10 containers, 7 dias, 5.264.026 bytes: zero chaves operacionais conhecidas; bearer de aluno em URLs encontrado separadamente |
| Logs após cutover | 10 containers, 58.085 bytes: zero matches de credenciais conhecidas; request canary bearer retornou 404 e não apareceu no log da API |
| Públicos | `.env`, `.env.local`, `.git/config`, Dockerfile, api.env, secrets/openai_api_key e manifest server Next: 404; home: 200 |
| Bundle público final | 15 JavaScript referenciados na homepage comparados com credenciais VPS: zero matches. Varredura anterior também Gitleaks zero |
| Runtime final | API: 13 secrets read-only; web: zero mounts de secrets; ambos sem ARARAHQ env/mount. Diretório de secrets 0700 |

Cobertura não equivale a prova de ausência: branches inacessíveis, bundles não referenciados nesta página, exportações externas, consoles de fornecedores, caches completos e todo histórico de backup não foram inspecionados. Artefatos GitHub de build não foram baixados com sucesso; as imagens efetivamente utilizadas foram inspecionadas.

## 3. Modelo de Ameaças (Threat Model)

Um leitor de logs poderia reutilizar link de aluno. Um build com env de backend poderia incorporar chave em bundle, cache ou layer. CI, operador ou configuração permissiva poderiam copiar credenciais dev para produção. Um rollback para imagem antiga poderia reabrir autorização por IDs persistentes. O controle atua no ponto de autorização, no coletor de logs, na fronteira do build e no provisionamento runtime.

## 4. Vulnerabilidades Identificadas

- **Alta — bearer em logs:** três checkout legados (dois válidos e um expirado), um protocolo ACTIVE acessível por UUID e um alias ativo em logs. O protocolo associado não apresentou marcador conhecido de usuário teste/demo. Links legados de assinatura também dependiam de ID persistente.
- **Alta — reabertura por rollback:** imagens anteriores aceitavam IDs/AES legado; rollback sem gate anularia a correção.
- **Média — credenciais compartilhadas:** cinco chaves plausivelmente operacionais — Asaas Sandbox, OpenAI, Anthropic, DeepSeek e Groq — eram iguais entre dev e produção. Isso amplia o impacto de eventual comprometimento; igualdade por si não comprova divulgação. Arara não utilizada também era igual e foi removida da instalação.
- **Média — provisionamento dev:** deploy copiava automaticamente chaves locais de desenvolvimento.
- **Média — build frontend herdava env:** não havia uma fronteira explícita de configuração pública para o build local.

Não foi confirmada publicação de chaves de fornecedor, banco ou JWT em Git, layers, bundles ou logs inspecionados. JWT público e fingerprints GPG não são material privado.

## 5. Impacto Potencial

Reutilização de link poderia revelar protocolo de treino ou operar a assinatura do titular. Uma chave compartilhada comprometida poderia alcançar a conta correspondente de produção, consumir recursos ou interromper o serviço. Trocar PGCRYPTO_KEY sem recifrar dados causaria perda de acesso a dados: não foi usada como revogação de links.

## 6. Probabilidade de Exploração

O cenário de logs era concreto para quem tivesse acesso a eles; não há evidência suficiente de acesso indevido por terceiros. Após o cutover, IDs e checkout legado falham fechados também na API interna. Risco residual de segredo compartilhado continua até emissão exclusiva e revogação anterior nos consoles.

## 7. Classificação de Risco

**Alta para os achados originais de bearer; corrigidos estruturalmente e validados. Média residual para segregação de credenciais e operação dos fornecedores.** A auditoria não certifica todo o sistema ou ausência de incidentes.

## 8. Controles de Segurança Implementados

- Tokens opacos criptograficamente aleatórios com finalidade/recurso/TTL/revogação; só SHA-256 no banco, nova emissão invalida a anterior do escopo. Leitura/PDF restringem titular por RLS. Alias de 24 caracteres aleatórios, hash no banco e destino cifrado com PGCRYPTO runtime.
- Migrações 0065/0066 encerram aliases antigos e cifram destinos; autorização antiga por ID e checkout AES falha fechada. Nenhuma denylist temporária permanece na solução.
- Redação Pino estrutural sempre habilitada; texto livre, mensagens e stacks passam por redação antes do transport, independentemente de LOG_REDACT_PII. Headers e nomes de secrets cobertos; URLs bearer são redigidas no helper compartilhado.
- Nginx access log sem URI/query/Referer/User-Agent e método limitado a nomes conhecidos. Erros nativos passam por FIFO 0600 em tmpfs e AWK antes do driver Docker, preservando timestamp, severidade, categoria, errno e conexão. Não persiste mensagem bruta. Coletor supervisionado e healthcheck: morte do coletor encerra Nginx para restart. Erros não são suprimidos.
- Wrapper do frontend limita env herdado, rejeita env privado/variáveis públicas desconhecidas e valida configuração pública. Docker context exclui secrets e arquivos privados; sem segredo em ARG/ENV de build. A proteção participa do hash Turbo.
- Deploy não usa secrets dev como fallback; provisionamento ausente exige fonte explícita e rejeita arquivo igual ao local. Build e runtime permanecem separados; migração recebe PGCRYPTO_KEY_FILE apenas em runtime.
- Gate de deploy/rollback exige imagem API marcada `revocable-v1`; proveniência OCI registrada. Credenciais CI protegidas por environment. Arquivos runtime em diretório 0700; modo 0644 nos bind mounts permite leitura pelo UID não privilegiado do container, sem conceder travessia a outros usuários host.
- Helper `/opt/movivo/bin/update-provider-secret.sh`: stdin, validação GET autenticada no fornecedor, redirects proibidos, troca atômica, recreate API/health e restauração em falha. Sem valor em argv/log. Asaas restrito ao Sandbox. Revogar anterior somente após validação funcional bem-sucedida.

## 9. Impacto na Arquitetura

A autoridade do link passa do ID/cifra estática para registro server-side revogável. Secrets continuam em arquivos Docker Compose protegidos, montados somente nos consumidores necessários; não se adicionou Vault para uma única VPS. O arquivo não é equivalente a um serviço de gestão centralizado: acesso root/daemon continua confiável. Uma futura gestão central pode substituir a fonte dos arquivos sem alterar o contrato *_FILE.

Produção `e77b94d1be882272ba2237dd8e78d5359f29b1cd` e HEAD local `f02fe77efe640b4fa7e6f38f02b76e32b139fb72` tinham a mesma tree `4940c0f214834339bf81b8db8429176caa928736`, antes destas mudanças. Snapshot de fonte da candidata: `c07ffe80a2fa227d4f7ac9bc6533237d6bf22297fa743d03834deb246c868a0b` (1361 arquivos, Git tracked + untracked não ignorados, sem env/runtime secrets). Configuração de infra final aplicada separadamente após build para retirar a contenção antiga e instalar helper com redirects proibidos.

| Imagem | Digest |
|---|---|
| API security-c07ffe80a2fa | sha256:c127ab8e3ee22ed23ffb169e879d784696a51c3e8d3a4b723083a8d1c19dc9be |
| Web security-c07ffe80a2fa | sha256:ef847976d6ad21a3c4d4dd3917404778ac89a448bcfb482b859a556da9b33be2 |

OCI revision: `f02fe77efe640b4fa7e6f38f02b76e32b139fb72+workspace.c07ffe80a2fa227d4f7ac9bc6533237d6bf22297fa743d03834deb246c868a0b`. Esse cutover antecedeu a publicação Git/GHCR e utilizou imagens locais verificadas. Em seguida, o usuário autorizou commit, push, PR e deploy da correção; os SHAs e resultados dessa publicação são rastreados pelo PR e pelo workflow Deploy. O gate impede iniciar uma API sem a capacidade revogável. API_ENV_PRODUCTION protegido já foi atualizado com configuração sem ponteiro Arara.

## 10. Impacto na Privacidade e LGPD

Reduz-se a circulação de dados sensíveis e de credenciais de acesso em sistemas de logs. Cifra e isolamento por titular foram preservados; não houve alteração de IDs ou destruição de protocolos. Avaliação de incidente/notificação requer evidência sobre acesso aos logs, titulares e impacto; não se infere obrigação nem ausência de incidente apenas a partir desta varredura.

## 11. Estratégia de Monitoramento

Monitorar health Docker, categorias de erro Nginx, status/duração/request ID e logs redigidos da API; acompanhar falhas de autenticação/fornecedor sem payload ou chave. O coletor retém erro desconhecido como categoria genérica, sem descartar o evento. Testes CI cobrem isolamento frontend, categorias/canary de logs e validação das cinco credenciais. RLS/token regressions cobrem escopo, expiração e revogação.

## 12. Plano de Mitigação Executado

Backup cifrado `movivo-security-20261005-194951.dump.enc` foi restaurado de verdade em banco isolado. A candidata aplicou migrações completas, RLS FORCE em 26 tabelas e conferiu 20 destinos cifrados por checksum do conteúdo decifrado versus produção, sem valores no output; aliases legados ficaram hashados e expirados. Container e volume descartáveis foram removidos. Backup retido protegido.

No cutover, API antiga foi parada antes da migração para impedir gravação simultânea de alias legado. Migração production passou; API candidata ficou saudável. Após 13 verificações diretas de rejeição antiga, web/Nginx foram recriados com logging permanente e a denylist apagada. Nenhum outro serviço de dados foi recriado; nenhum fornecedor foi rotacionado. Arara foi removida do runtime e do inventário exigido. Evidência/configuração operacional sanitizada fica no diretório audit 0700.

## 13. Estratégia de Resposta a Incidentes

Logs anteriores Nginx foram substituídos por evidência sanitizada de 9579 registros (timestamp/método/status/hash de linha, sem URI/PII/token) e descartados mediante recreate pelo Docker, sem editar arquivos internos do driver. Alias exposto foi expirado; migração final expirou todos os legados. API nova substituiu container anterior e elimina a recorrência de URL bearer em logs. Chaves de dados/JWT não foram trocadas sem exposição confirmada.

Se houver comprometimento de fornecedor, emitir chave exclusiva no console, instalar via helper, confirmar fluxo e revogar anterior. A antiga Arara não é usada nem permanece na VPS, mas sua revogação externa cabe ao administrador da conta. Não solicite nem envie credenciais em chat. Procedimento de entrada oculta no Mac e caminhos estão em `docs/operacoes/deploy-producao.md`.

## 14. Plano de Validação e Resultados

- API: 181 arquivos / 2101 testes passaram; typecheck/lint/build aprovados. Regressions específicas de tokens: 117 passaram; redação: 15 passaram.
- Banco real isolado: hash, RLS, finalidade/recurso, expiração, regeneração/revogação e destino cifrado passaram. Restore/migração clone com dados existentes confirmado antes de produção, sem envio de dados a terceiros.
- Fonte staged Gitleaks: zero achados. Builds reais Docker API/web passaram sem secrets de runtime. Wrapper frontend e selfcheck de provider/Nginx passaram; syntax checks e diff check aprovados.
- Coletor isolado Nginx: health 200, erro upstream 502 classificado com errno 111, canary ausente, morte do coletor encerrou container com código 1. Em produção FIFO 0600 e processo coletor ativo confirmados.
- API diretamente no container (sem Nginx): checkout legado 3 × read/payment = 6; protocolo read/PDF/rota public antiga = 3; portal UUID read/cancel/pause/resume = 4. **13 de 13 retornaram 404**, nenhum 429; health 200. Nenhuma mutação de negócio executada.
- Pós-cutover: dez containers saudáveis; home/API health 200, denylist ausente, API 13 secrets read-only e web zero; bundle público e layers/metadados/logs finais sem matches conhecidos.

Testes não cobrem integralmente todos os terceiros, backups históricos ou todo conteúdo de cache. Não foi executado pentest completo nem rotação de credencial externa.

## 15. Próximos Passos

1. Administrador emitir chaves exclusivas para os cinco fornecedores utilizados, conforme necessidade real e sem habilitar pagamentos produção. Instalar/validar pelo helper e revogar as anteriores depois do sucesso. Revogar Arara no console se a conta/chave ainda existir. Esta parte depende do usuário e está pendente.
2. Acompanhar a publicação autorizada pelo usuário: CI do PR e workflow Deploy devem passar antes de promover a revisão publicada. As evidências acima registram o cutover inicial; a revisão publicada e suas imagens são rastreadas no GitHub.
3. Usuários que precisem de link recebem nova emissão pelo fluxo normal; links antigos deixam de funcionar por desenho. Nenhuma mensagem WhatsApp foi enviada nesta auditoria.

## 16. Fontes Consultadas

- https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
- https://docs.docker.com/build/building/secrets/
- https://docs.docker.com/build/building/variables/
- https://docs.docker.com/reference/compose-file/secrets/
- https://docs.docker.com/engine/containers/multi-service_container/
- https://docs.docker.com/engine/logging/drivers/json-file/
- https://nextjs.org/docs/app/guides/environment-variables
- https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository
- https://nginx.org/en/docs/ngx_core_module.html#error_log
- https://nginx.org/en/docs/http/ngx_http_log_module.html
- https://nginx.org/en/docs/http/ngx_http_map_module.html
- https://nginx.org/en/security_advisories.html

Advisories Nginx oficiais e orientações OWASP foram consultados; este trabalho trata exposição/gestão de secrets, não uma auditoria completa de CVEs/dependências. Incidentes públicos do setor não produziram evidência específica desta instalação; não foram usados para afirmar comprometimento.
