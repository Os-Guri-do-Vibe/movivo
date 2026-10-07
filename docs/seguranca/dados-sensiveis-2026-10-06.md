# Relatório — Sato: proteção de dados sensíveis

**Data:** 2026-10-06; fechamento operacional em 2026-10-07
**Ideia analisada:** MOVIVO — treino conversacional supervisionado por profissional CREF
**Pasta do projeto:** docs/fitness-ia-whatsapp/
**Status:** CONCLUÍDO — Vault, chaves independentes, TLS e recuperação validados localmente e na VPS.
**Risco residual:** ALTO para dados estruturados/artefatos sem prova de cifra do armazenamento; transporte e Vault comprovados.

## 1. Resumo Executivo

O helper compartilhado cifrava dados dentro do PostgreSQL e enviava ao banco a chave e o
plaintext. Novas escritas passam a AES-256-GCM na aplicação; o banco recebe somente
ciphertext. Há keyring com ID autenticado e opção Vault Transit, que mantém a chave de
cifra fora da aplicação. Leitura de pgcrypto antigo continua disponível, com erros
sanitizados para impedir vazamento de parâmetros SQL. A rotação agora tem CLI de
verificação/recifra, compare-and-swap e auditoria atômica por escrita.

Esta correção cobre o conteúdo já encaminhado ao `HealthCipherService`. Não equivale
a cifrar todas as colunas nem a provar que a VPS usa discos criptografados. A recifra local foi executada e validada; TLS/Vault de produção já passaram os checks reais. Backup, restore conjunto e recifra de produção também foram concluídos e verificados.

## 2. Escopo Avaliado

Contexto: arquitetura vigente, relatórios de produto, jurídico e segurança já
consolidados, fluxos de anamnese/PAR-Q, renovação, check-in, diário, Coach, MFA,
aliases, configurações, Compose, proxy e runbooks existentes de backup.

| Classe operacional | Dados / localização | Proteção de aplicação atual / decisão |
|---|---|---|
| Saúde de maior criticidade | `anamnesis_sessions.data_block_2`: dor, PAR-Q, saúde e texto livre | AES-GCM/Vault nas novas escritas; pgcrypto legado legível |
| Saúde de maior criticidade | `protocol_renewal_sessions.data_block_3` | Mesmo helper |
| Saúde e texto livre | `checkins.notes_cipher`, `workout_sessions.feedback_cipher`, `protocols.mesocycle_notes_cipher` | Mesmo helper |
| Saúde, derivação/inferências | `protocols.constraints`, `par_q_flags`, `content`, `mesocycle_summary`; dor/esforço no diário; `checkins.answers`; peso/fadiga/sono na renovação | **Em claro no schema**. Não classificar automaticamente como dado comum. Cifra de armazenamento obrigatória; RLS/minimização; avaliar cifra de aplicação por coluna sem eliminar queries de operação |
| Saúde potencial e identificadores livres | `conversations.content`, `coaching_sessions.summary`, handoffs; memória/cache e payloads de fila Redis | **Em claro**. TTL/redação/RLS não substituem cifra at-rest. Armazenamento cifrado pendente; TLS interno comprovado local e VPS; cifra de aplicação deve considerar todos os leitores, dashboards e consumidores de fila |
| Identificação pessoal | `users`/`staff` e `anamnesis_sessions.data_block_1/3`: nome, telefone, e-mail, nascimento, dados demográficos e rotina | Em claro para busca/roteamento. Cifra de armazenamento com acesso mínimo; logs redigidos. Contexto de saúde torna ligação destes dados especialmente crítica |
| Credenciais | TOTP `staff.mfa_secret_cipher`; destinos tokenizados `short_links.target_url` | Mesmo helper; wrapper externo `pgp:v1:` preservado por compatibilidade, pode conter envelope AES/Vault |
| Credenciais não reversíveis | Senha, recuperação MFA, refresh/access tokens e códigos conforme seus fluxos | Hash/assinatura específicos; não substituir hashing de senha por cifra reversível |
| Exportações/artefatos | PDFs de protocolo, WAL, dumps, AOF/RDB, volumes de avatar/WhatsApp e logs | Cifra de armazenamento/backups e retenção; PDF pode carregar saúde mesmo sem campo chamado “saúde” |

Classificação operacional conservadora não substitui a definição de base legal por
Alexandre. Dado estruturado ou derivado pode revelar saúde mesmo sem texto livre.

## 3. Modelo de Ameaças (Threat Model)

Considerados roubo de dump/volume, leitura de banco por operador ou invasor, interceptação
na rede interna, acesso a logs de exceção e perda/comprometimento de chave. A cifra de
aplicação dificulta exposição por dump/DB; root da VPS ou comprometimento do processo
com permissão de decifrar continua sendo risco. Vault restringe exportação de chave,
mas a aplicação comprometida ainda pode abusar da permissão de decrypt.

## 4. Vulnerabilidades Identificadas

- Chave e plaintext em chamadas SQL de cifra; exceções do driver podem conter parâmetros.
- Rotação pgcrypto apenas descrita: substituir a única chave prejudicava a leitura.
- Suposição incorreta de que só campos livres/dor são sensíveis: há inferências e conversas em claro.
- TLS de borda configurado; conexões internas e volumes sem comprovação equivalente.
- Docker Secrets em Compose são arquivos montados, não KMS/Vault nem isolamento de root.

## 5. Impacto Potencial

Exposição de histórico de saúde, credenciais MFA e links de acesso; perda de leitura de
protocolos/anamnese após rotação inadequada; exposição por logs ou backups. Não foi
identificada evidência de exploração/incidente nesta revisão.

## 6. Probabilidade de Exploração

Condicional ao acesso ao banco, logs, rede ou host; não estimada quantitativamente.
Não foi realizado pentest externo nem auditoria do provedor de armazenamento.

## 7. Classificação de Risco

ALTO para saúde em armazenamento/transporte sem evidência; MÉDIO para o helper após
correção, considerando permissões de aplicação e dependência de chaves. Não atribuir
risco baixo global com base apenas na cifra de algumas colunas.

## 8. Controles de Segurança Recomendados e Implementados

Implementados: AES-256-GCM, IV aleatório de 96 bits, tag de 128 bits, autenticação do
header/ID, keyring de chaves independentes de 256 bits, erro sem causa/query/params,
leitura compatível, Vault HTTPS com timeout de 5 s e redirecionamento proibido,
validação de resposta e ausência de fallback silencioso ao falhar Vault.

Sem keyring, o modo LOCAL deriva uma chave de 256 bits por SHA-256 do secret aleatório
pgcrypto existente, identificado como `legacy-derived`. **É transição de compatibilidade,
não KDF de senha.** Use keyring independente ou Vault; nunca use senha humana como chave.

Externos: TLS validado em cada hop, volume criptografado para PostgreSQL/WAL/Redis e
artefatos, backups cifrados e chaves fora dos dumps, Vault gerido com ACL mínima e audit.

## 9. Impacto na Arquitetura

Sem novas dependências, alteração de coluna ou interfaces de callers. Node `crypto`
implementa AES-GCM; `fetch` integra Transit. Migrações antigas ainda podem produzir
pgcrypto, lido pelo helper. A chave antiga continua necessária para esses dados.
Não ativar Vault sem disponibilidade, ACL e TLS corretos. Nome da chave Transit é
estável: não renomear sem migrar os ciphertexts que apontam para aquele keyring Vault.

Overrides opt-in: `infra/security/docker-compose.health-keyring.yml` e
`infra/security/docker-compose.health-vault.yml`; não iniciam Vault nem alteram o
Compose base. Combine somente o provedor pretendido. Para ler AES de keyring após
migrar a Vault, mantenha também o mount/variável do keyring antigo.

## 10. Impacto na Privacidade e LGPD

Não muda consentimento, bases legais, transferência ou retenção. Inventário inclui
saúde inferida e dados livres; proteção não autoriza ampliar coleta. Vault externo
recebe plaintext/ciphertext para operar Transit: tratar fornecedor, localização e
acesso no processo de diligência. Usar instância controlada e política de acesso mínima.

## 11. Estratégia de Monitoramento

Monitorar falha de encrypt/decrypt, indisponibilidade Vault, uso anormal de decrypt,
conflicts da rotação e eventos `HEALTH_CIPHER_REENCRYPTED` na trilha imutável. CLI só
imprime runId, tabela e contagens; auditoria só contém tabela/coluna/provedor/ID.
Nunca adicionar conteúdo, chave ou token a métricas/logs. Vault audit deve estar ligado
no serviço externo com retenção e acesso próprios.

## 12. Plano de Mitigação e Runbook de Rotação

1. Antes da mudança: backup cifrado, cópia de chaves sob custódia separada, restore
   em ambiente isolado **com decifra**, inventário de versões e período de retenção.
2. Gerar nova chave CSPRNG de 32 bytes em arquivo privado; keyring JSON contém IDs
   antigos e novo. Nunca sobrescrever material de um ID existente. Não use
   `legacy-derived` para uma chave nova: esse ID identifica a derivação histórica.
3. Provisionar `HEALTH_CIPHER_KEYRING_FILE` como secret somente da API, ativo
   `HEALTH_CIPHER_KEY_ID=health-2026-q4`. Envs/arquivos reais não entram em Git.
   No modo Vault: provisionar chave `aes256-gcm96`, token limitado a encrypt/decrypt,
   endpoint HTTPS e `VAULT_TOKEN_FILE`. Rotação de chave Vault cabe ao operador,
   nunca ao token da aplicação; conservar versões anteriores.
4. Validar leitura anterior e nova escrita. No checkout, usando env local adequado:

   ```sh
   pnpm --filter @movivo/api exec tsx src/scripts/rotate-health-cipher.ts --dry-run
   ```

   Em imagem compilada: `node dist/scripts/rotate-health-cipher.js --dry-run`.
   O dry-run lê/decifra **todos** os valores das sete colunas alvo (páginas de 100),
   sem atualizar; saída é somente contagem. Não prova colunas em claro fora da lista.
5. Após deploy controlado e backup comprovado, recifrar explicitamente:

   ```sh
   pnpm --filter @movivo/api exec tsx src/scripts/rotate-health-cipher.ts --apply --actor=<UUID-admin-ativo>
   ```

   A CLI valida round-trip antes de UPDATE; compara valor anterior, registra auditoria
   na mesma transação e interrompe com exit 1 em falha/conflito. Reexecute se houve
   alteração concorrente; cada linha já atualizada continua legível. Não requer
   conexão superuser/migrator: usa runtime/PgBouncer e contexto SYSTEM.
6. Repetir dry-run com configuração sem a chave antiga em ambiente isolado/restore
   e confirmar leitura dos dados atuais. Backups antigos ainda exigem suas chaves.
   Não retirar `PGCRYPTO_KEY_FILE` enquanto migrações/legado/backups dependem dele.
7. Rollback: **o código implantado deve reconhecer AES/Vault**. Restaurar somente
   config/provider/ID mantendo todas as chaves e versões. Voltar ao binário antigo
   (pgcrypto-only) após novas escritas não é rollback válido. Em falha, não apagar
   nem regenerar secrets; preservar ciphertext/backup e retornar à configuração
   anterior com keyring completo.

Exemplo operacional Docker local (arquivos secretos já provisionados):

```sh
HEALTH_CIPHER_KEY_ID=health-2026-q4 docker compose -f docker-compose.yml -f docker-compose.secrets.yml -f infra/security/docker-compose.health-keyring.yml config --quiet
```

Para produção, primeiro Compose é `infra/vps/docker-compose.prod.yml`; caminhos
`./secrets` dos overrides resolvem relativos a ele. Usar esse override em cada deploy;
não basta definir `*_FILE` sem montar o arquivo. `docker compose config --quiet`
valida sem imprimir ambientes resolvidos. Configuração dos overrides validada com `config --quiet` (local e produção). O provisionamento e ativação reais foram concluídos em 2026-10-07, conforme as evidências ao final.

TLS concluído: certificados/CA e clientes verificados para Postgres↔PgBouncer,
app↔PgBouncer e Redis/Sentinel/réplica (incluindo BullMQ), além de HTTPS interno.
Os checks positivos e negativos reais estão registrados ao final; um ensaio de
failover completo não está incluído nessas provas. Continua pendente evidenciar
criptografia dos volumes pelo provedor ou configuração de volume. Rede Docker interna sozinha não cumpre criptografia
em trânsito. Backup cifrado existente não prova cifra do volume vivo. Não trocar flags
para `true` sem infraestrutura correspondente.

## 13. Estratégia de Resposta a Incidentes

Em comprometimento de chave: revogar identidade/token, restringir acesso, preservar
logs/ciphertext, provisionar chave nova e recifrar sob acompanhamento. Envolver
responsáveis de operação, segurança e jurídico na avaliação da exposição. Rotação não
revoga uma cópia de dump já extraída com a chave; backups afetados requerem avaliação.

## 14. Plano de Validação

Histórico da validação inicial (2026-10-06; fechamento adicional em 2026-10-07 ao final):

- Suíte unitária completa anterior aos últimos testes adicionais: **189 arquivos,
  2.295 testes passaram**; suíte focada final de cifra/config/secret/shortlinks:
  **7 arquivos, 75 testes passaram**, incluindo CAS/auditoria e redação de keyring/token.
- `typecheck` da API passou; casos de alteração de ciphertext/header/IV/tag,
  truncamento, rotação old/new, rollback, retirada de chave e falha de Vault.
- Smoke com PostgreSQL/PgBouncer real: pgcrypto sintético legível, nova escrita
  AES-GCM com round-trip exato e sem plaintext no buffer; sem gravar dados reais.
- CLI dry-run local: **40** anamneses, **1** segredo MFA, **8** aliases decifrados;
  zero updates/conflitos. Demais alvos cifrados estavam vazios (não representam
  cobertura real de recifra desses tipos).

Na etapa inicial de 2026-10-06 ainda não haviam sido executados `--apply`, Vault
real/rotação, TLS interno e restore completo. Esses itens operacionais foram
concluídos em 2026-10-07 (evidências ao final). Pentest externo e cifra integral
dos volumes permanecem fora da comprovação; backups legados exigem chave antiga.

## 15. Próximos Passos

Vault, chave independente, TLS, recifra e restore foram concluídos nos dois ambientes.
Continua necessária a comprovação de cifra dos volumes. Engenharia deve avaliar cifra
de aplicação para conversas/resumos
livres com migração coordenada de todos os leitores. Relatório não certifica adequação
integral da implantação atual.

Redis: revisão de CVEs consultada inclui advisory de 2026 (não apenas RediShell 2025).
A imagem implantada não foi inspecionada nesta tarefa; não afirmar patch por tag genérica.
Aplicar rotina SCA/advisories já existente para confirmar versão/digest executado.

## 16. Fontes Consultadas

- https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Key_Management_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html
- https://developer.hashicorp.com/vault/api-docs/secret/transit
- https://developer.hashicorp.com/vault/docs/secrets/transit
- https://www.postgresql.org/docs/current/pgcrypto.html
- https://redis.io/docs/latest/operate/oss_and_stack/management/security/
- https://redis.io/blog/security-advisory-cve-2025-49844/
- https://redis.io/blog/security-advisory-cve202623479-cve202625243-cve-2026-25588-cve202625589-cve-2026-23631/

Limites: pesquisa documental e advisories de fornecedor; sem dados para estimar
probabilidade real de incidente nem auditoria externa de contas/infraestrutura.

## Complemento operacional — CA privada e clientes (continuação de 2026-10-06)

O suporte de clientes abaixo foi implementado e testado no código. Na etapa inicial
a comprovação operacional ainda estava em andamento; o provisionamento local/VPS e
as evidências reais foram concluídos e registrados nas seções de fechamento abaixo.

- `DATABASE_SSL_CA_FILE` carrega a CA do PostgreSQL/PgBouncer. Runtime exige
  `rejectUnauthorized=true` e verifica o `DATABASE_HOST`, inclusive IP. Os modos
  postgres.js `require/prefer/allow` não são usados porque permitem conexão sem
  autenticação equivalente do servidor.
- `MIGRATION_DATABASE_SSL` e `MIGRATION_DATABASE_SSL_CA_FILE` cobrem migração direta,
  seeds, drizzle-kit e scripts operacionais que antes fixavam `ssl:false`. Em ausência
  de override, usam a configuração TLS de runtime; flag inválida ou CA com TLS
  desligado gera erro, sem downgrade silencioso.
- `REDIS_TLS_CA_FILE` autentica master/réplica e Sentinels. `buildRedisOptions` define
  **`tls`, `sentinelTLS` e `enableTLSForSentinelMode=true`**. BullMQ reutiliza essas
  opções; não cria uma conexão plaintext alternativa. Certificados devem conter
  SANs para os nomes/IPs anunciados pelo Sentinel e os destinos do `natMap` local.
- `VAULT_CA_FILE` aplica CA privada apenas à requisição Vault usando `node:https`;
  validação de cadeia e hostname permanecem habilitadas, timeout cobre toda a
  requisição, resposta limitada a 2 MiB, redirects são rejeitados e erros sanitizados.
  Sem CA privada, `fetch` usa a trust store padrão. Não é necessário nem aceitável
  usar `NODE_TLS_REJECT_UNAUTHORIZED=0`.
- `HTTP_BIND_HOST=127.0.0.1` permite terminar TLS em sidecar que compartilha o namespace
  da API e encaminha o último hop somente por loopback. O default continua `0.0.0.0`
  para execução sem sidecar. A flag sozinha não configura proxy, certificado ou acesso
  externo; a configuração operacional precisa ativá-los em conjunto.
- Certificados públicos usam o contrato `*_FILE` existente. O loader falha se o arquivo
  não existir/estiver vazio; valores não são reinjetados no ambiente nem nos logs.

Testes adicionais: CA/host/IP PostgreSQL, propagação de CA para Redis/Sentinel/BullMQ,
configuração inválida, caminho HTTPS privado Vault, falha TLS sanitizada, redirects,
falhas HTTP e resposta excessiva. Testes de cliente não substituem o handshake real
nem a negativa de certificado não confiável em cada ambiente.

Fontes oficiais complementares:

- https://github.com/porsager/postgres
- https://github.com/redis/ioredis
- https://redis.github.io/ioredis/interfaces/SentinelConnectionOptions.html
- https://nodejs.org/download/release/latest-jod/docs/api/https.html

Validação da continuação no código: **193 arquivos / 2.315 testes unitários da API
passaram**, além de typecheck e ESLint dos arquivos alterados. O gate contra SQL não
parametrizado foi atualizado com justificativa explícita para a CLI: sete alvos
constantes e whitelist obrigatória antes de formar identificadores; nenhum valor
sensível é interpolado em SQL bruto. A recifra mantém sua prova CAS/auditoria.

## Evidência operacional local — 2026-10-07

O ambiente local foi provisionado com CA privada, chaves independentes e Vault
Transit real. `scripts/verify-security.mjs`, executado dentro da API com a
configuração real, passou **21/21 verificações**: TLS PostgreSQL/PgBouncer e
Redis/Sentinel, rejeição de CA/hostname incorretos e de plaintext, Vault round-trip
sem SQL, token limitado sem acesso administrativo, leitura dos formatos legados,
dry-run de 49 valores sem escrita, BFF → API HTTPS, Evolution HTTPS e API HTTP
inacessível pela rede Docker. O último hop HTTP fica em loopback no namespace do
sidecar. O Compose vigente possui um Sentinel; a expansão para três é futura.

O Vault local usa **2.1.1**, fixado por digest
`sha256:47f14a6acb98f48d798a07df7c83f23a6e636e1cf724c5f8ff165cb32667a1e2`.
A revisão de versão inclui HCSEC-2026-08 e HCSEC-2026-26; atualizar o binário não
substitui ACL, TLS nem a manutenção de versões futuras. Audit logging está ativo
com `log_raw=false`; token periódico de 24h tem renovação horária e a chave Transit
rotação automática de 2160h. A custódia de unseal/root permanece fora dos volumes
de dados e da aplicação. O unseal manual após reinício exige operador.

A recuperação foi **testada de verdade** por `scripts/verify-vault-restore.py`:
fixture sintética cifrada na chave versão 1 → snapshot Raft via HTTPS → inicialização
e unseal de instância descartável → restore `-force` → unseal com custódia original
→ emissão de novo token limitado pela política restaurada → decifra exata. O teste
usa a imagem do Vault ativo, `--network none`, filesystem read-only e armazenamento
tmpfs, memória limitada a 512 MiB e swap proibido; não monta dados/custódia do host nem altera o Vault ativo. O container de
UUID único foi removido ao final. Tokens e shares transitam por stdin para arquivos
0600 em tmpfs e não são argumentos de processos nem saídas do teste.

Comandos reproduzíveis (sem imprimir segredos):

```sh
docker compose exec -T api node --input-type=module < scripts/verify-security.mjs
python3 scripts/verify-vault-restore.py --environment local
python3 scripts/verify-vault-restore.py --environment production --root /opt/movivo --snapshot /caminho/privado/vault.snap
```

O snapshot fornecido é preservado. Deve ser do cluster correspondente à custódia
e conter a versão 1 da chave `movivo-health`; versões antigas precisam continuar
retidas para recuperar backups. A fixture versão 1 torna o teste compatível com
snapshot anterior a uma rotação, e o token novo é emitido somente na instância
descartável para evitar dependência de um token live posterior ao backup. Este teste
prova recuperação das chaves/política Transit, não integridade de um restore conjunto
de todos os dados PostgreSQL e anexos. A prova local não certifica VPS: anexar o
resultado real de produção registrado na seção de fechamento abaixo.

Fontes complementares consultadas:

- https://developer.hashicorp.com/vault/docs/sysadmin/snapshots/restore
- https://developer.hashicorp.com/vault/api-docs/system/storage/raft
- https://developer.hashicorp.com/vault/docs/commands/write
- https://discuss.hashicorp.com/t/hcsec-2026-08-vault-vulnerable-to-denial-of-service-via-unauthenticated-root-token-generation-rekey-operations/77345
- https://discuss.hashicorp.com/t/hcsec-2026-26-vault-vulnerable-to-list-authorization-bypass-via-trailing-slash-strip/77632

Após backup local cifrado e a prova de recuperação acima, o operador executou a
recifra real local: **49/49 valores atualizados, zero conflitos**, run
`c60e35fd-0b20-4df1-a5a9-1bf2c605290b`. Cada escrita valida round-trip, faz CAS e
registra auditoria na mesma transação. Este resultado é exclusivo do ambiente local;
backups antigos ainda exigem a chave pgcrypto e a custódia original preservadas.

Continuidade CI: os 52 clientes PostgreSQL diretos da suíte de integração foram
ajustados para o helper TLS existente, e a limpeza Redis de persona reutiliza as
opções verificadas do runtime. Workflow configura TLS e arquivos de CA/keyring/token
absolutos para clientes host. A descoberta enumerou 44 arquivos de integração sem
executar global setup; typecheck da API, lint dos testes e 14 testes unitários de
TLS/Redis/gate anti-SQL passaram. A integração completa não foi executada sobre o
banco local com dados a preservar.

Limite adicional: o typecheck habitual da API inclui somente `src/`. Ao incluir
explicitamente os testes de integração em configuração temporária, aparecem erros
de fixtures anteriores (campos obrigatórios novos ausentes e acesso a arrays sem
checagem). A descoberta não prova execução nem corrige essa dívida; o CI com banco
sintético continua necessário antes de declarar a suíte inteira verde.


## Evidência operacional de produção — 2026-10-07

A VPS executa a revisão `82d9e41` com **21/21 checks reais** de transporte, ACL,
Vault Transit e leitura de formatos legados. O dry-run verificou **1 valor existente
(MFA)**. A recuperação com snapshot fresh de produção passou na instância descartável
isolada, com custódia original e decifra pelo token limitado da política restaurada.
O teste de rotação nativa avançou a chave Transit para **versão 2**: um ciphertext
anterior continuou legível e o período automático de **7.776.000 segundos (2160h)**
foi conferido. Chaves antigas permanecem retidas para backups.

O checker de recuperação agora prova dois casos: fixture versão 1 e fixture na
`latest_version` lida **do snapshot restaurado**, usando cifragem sintética live nessa
versão explícita. Assim, um snapshot antigo não depende da versão atual da instância
live; a decifra exige que aquele snapshot realmente contenha a chave correspondente.
A leitura de metadados de chave e emissão de token são feitas somente no scratch com
root da custódia; a decifra usa token novo de menor privilégio.

O processo Raft usa `disable_mlock=true`, conforme recomendação operacional para
Integrated Storage; o limite de memória/swap do container é 512 MiB com
`memory.swap.max=0` verificado na VPS. RSS observado em produção foi aproximadamente
40 MiB. Esse controle evita swap do processo Vault e não prova cifra dos demais
volumes, host ou artefatos da aplicação.

Durante o primeiro bootstrap, o kernel confirmou OOM antes da implantação da API
nova. O material daquele bootstrap ficou em quarentena em
`/vault/data/bootstrap-failed-20261007`, preservado sem apagar o volume. A API anterior
à migração ainda não enviava dados para esse Vault; a perda da inicialização ocorreu
antes desse uso. A recuperação requer a custódia correspondente ao cluster atual,
não o material da tentativa interrompida.

O operador copiou custódia de unseal, CA, keyring e chaves pgcrypto/backup de produção
para `~/.local/share/movivo-security/production-recovery` no Mac, com permissões
privadas (arquivos 0600), fora do repositório e separadas dos volumes da VPS. Essa cópia
foi confirmada pelo operador; não é custódia em HSM/KMS, não prova recuperação fora
da máquina e exige retenção/acesso operacional mínimo. O Vault self-hosted protege
contra acesso somente ao banco/dump; root do host continua no modelo de ameaça.

As evidências finais de backup, restore conjunto PostgreSQL/Vault e recifra 1/1
de produção estão registradas no fechamento abaixo. Não confundir TLS/Transit com cifra integral
do armazenamento: os campos estruturados e artefatos identificados no inventário
continuam exigindo controle at-rest comprovado.


## Fechamento operacional — 2026-10-07

**CONCLUÍDO para Vault, chaves independentes e TLS nos ambientes local e VPS.**
Após a implantação, o checker passou **21/21 na produção** (1 valor cifrado existente
verificado) e **21/21 no local** (49 valores). As URLs HTTPS local e de produção,
incluindo a API, responderam HTTP 200; a aplicação local está em
`https://localhost:3000`. A CA local privada exige confiança explícita do cliente.

A recifra de produção atualizou **1/1 segredo MFA de staff, zero conflitos**, run
`0c3a52e7-30d1-4f67-bd51-74614350225e`, com ator ADMIN ativo
`dd9250e8-bb25-45ed-879c-c25550b576df`. O valor permaneceu legível após a recifra e
passou a usar Vault Transit. Legado/PGCRYPTO e versões Transit anteriores continuam
preservados para recuperação; não foram removidos após a recifra.

O backup completo de **14:20** incluiu dois bancos, uploads e snapshot Raft Vault,
cifrados em arquivos `.enc`. O restore descartável terminou **OK em
2026-10-07T14:20:43-03:00**:

| Artefato recuperado | Evidência |
|---|---|
| PostgreSQL MOVIVO | 49 tabelas, 792 linhas e 26 políticas RLS |
| PostgreSQL Evolution | 37 tabelas e 435 linhas |
| Uploads | Integridade/listagem do tar verificadas |
| Vault Raft | Snapshot fresh e snapshot fornecido restaurados; unseal original, ACL limitada e decifra sintética versão 1 e latest_version **2** |

A comparação criptográfica de fixtures na versão 2 prova recuperação da chave usada
pela implantação, além da compatibilidade versão 1; não é mera leitura de contagens
ou teste mockado. Snapshots fornecidos não são sobrescritos pelo checker. Os checks
pós-recifra confirmaram acesso e legibilidade do MFA existente na produção.

Preservação: a execução pré/pós de 14:20 reutilizou nomes de backup com precisão de
minuto; não constitui dois backups independentes. O backup prévio de 03:38 permaneceu
preservado. O nome agora inclui segundos e um novo conjunto completo foi criado em
**20261007-142345** e restaurado em containers descartáveis. Não houve exclusão da
quarentena de bootstrap nem da custódia legada.

O fechamento não declara segurança integral do produto. Conversas, resumos,
metadados de saúde, filas e artefatos identificados no inventário ainda dependem de
cifra at-rest do armazenamento não comprovada nesta execução. O teste recuperou os
componentes do backup; não simula todos os fluxos de usuário, indisponibilidade total
da VPS, failover de Sentinel ou um atacante com root do host.

Fontes do controle de memória/Raft:

- https://developer.hashicorp.com/vault/docs/configuration/storage/raft
- https://developer.hashicorp.com/vault/docs/configuration
- https://developer.hashicorp.com/vault/docs/concepts/production-hardening
