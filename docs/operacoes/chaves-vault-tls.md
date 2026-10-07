# Chaves independentes, Vault e TLS — operação

## Ambientes e acesso

O Compose padrão local carrega `docker-compose.override.yml`, que aponta para
`infra/security/docker-compose.secure.yml`. O deploy copia esse mesmo overlay para
`/opt/movivo/compose.override.yml`. Não use um Compose sem o overlay com os dados migrados.

```sh
pnpm infra:up
curl --cacert secrets/internal_tls/ca.crt https://localhost:3001/api/v1/health
# Aplicação: https://localhost:3000
```

A CA privada local está em `secrets/internal_tls/ca.crt`. O navegador precisa confiar
nessa CA para abrir HTTPS sem aviso; a automação não altera a confiança global do
macOS. O acesso antigo `http://localhost:3000` passa a ser HTTPS. As portas HTTP dos
processos escutam apenas loopback do namespace compartilhado com o sidecar TLS.

Produção mantém os domínios HTTPS existentes. Cloudflare→Nginx usa o certificado de
origem existente; Nginx→web/API, web→API, API→Vault/Evolution, PgBouncer→Postgres,
API→PgBouncer e Redis/Sentinel usam TLS com CA e hostname verificados. Postgres e
PgBouncer recusam clientes de rede sem TLS; Redis usa `port 0`. Não há bypass de
certificado (`NODE_TLS_REJECT_UNAUTHORIZED=0`, `rejectUnauthorized=false`, `-k`).

## Chaves, autorização e limites

Vault Transit gera a chave AES-256-GCM, não exportável, separada do banco. O volume
Raft é cifrado pela barreira do Vault. Raft usa `disable_mlock=true`, conforme
orientação oficial; `memswap_limit` igual ao limite de memória impede swap do
container (`memory.swap.max=0` verificado). O heap Go tem orçamento de 256MiB. O token montado na API permite somente
`encrypt/decrypt` em `movivo-health`, `lookup-self` e `renew-self`; não administra,
exporta, remove ou rotaciona chaves. O token é periódico (24h) e renovado a cada hora.
Auditoria usa stdout com HMAC padrão, nunca `log_raw`; retenção é a rotação de logs
Docker. A chave Transit gira automaticamente a cada 2160h (90 dias); versões antigas
são preservadas para leitura e restauração. A recifragem é uma operação separada.

CA e custódia administrativas ficam em `~/.local/share/movivo-security/local` no Mac
ou `~/.local/share/movivo-security/production` do usuário deploy na VPS (diretório 700,
arquivos 600). A chave da CA e `vault-init.json` não são montados na API/Vault nem
entram em dumps ou snapshots. Os certificados públicos podem ter modo644; os
segredos legíveis pelo usuário não-root da aplicação estão dentro de `secrets/` 700.

`ponytail:` este MVP usa um Vault de nó único e custódia operacional de um operador.
A recuperação automática lê a custódia do host; root da VPS continua dentro da
fronteira de confiança. Evolução: auto-unseal com KMS externo, custódia distribuída e
Vault separado/HA. Isso não comprova cifragem integral de disco, filas ou campos que
ainda são armazenados em claro (ver inventário de dados sensíveis).

## Backup e recuperação

O backup diário agora inclui `vault-*.snapshot.enc`, além dos bancos e uploads. O
snapshot é cifrado pelo Vault e novamente pela chave de backup existente. Custódia
administrativa é guardada à parte. Preserve `PGCRYPTO_KEY` e a chave do backup para
ler versões históricas; nunca retire chaves antigas por ter completado uma migração.

```sh
# Na VPS, verifica os dumps e restaura um Vault descartável sem rede/volumes reais:
/opt/movivo/bin/movivo-backup.sh
/opt/movivo/bin/movivo-restore-test.sh
# Local, fixture sintética: nenhuma anamnese é exibida/exportada pelo teste.
python3 scripts/verify-vault-restore.py --environment local
```

`verify-vault-restore.py` usa a imagem do Vault vivo, inicializa uma instância de teste
em tmpfs, restaura o snapshot com force, abre com a custódia original e verifica uma
fixture sintética. Destrói somente o container de teste. Para desastre real, primeiro
restaure a custódia e a CA originais, depois o snapshot Raft e os bancos cifrados. Um
Vault vazio com custódia existente é recusado pelo provisionador; não gere novas
chaves para tentar abrir ciphertext antigo.

`movivo-vault-unseal.service/timer` recupera o Vault no reboot ou após reinício (até
um minuto). `movivo-certificate-renewal.timer` verifica diariamente os certificados:
renova folhas de 90 dias quando faltarem 30, recria os consumidores e reabre Vault.
A renovação pode causar uma breve interrupção. A CA dura 10 anos; sua troca exige uma
janela de migração da cadeia de confiança, não é feita silenciosamente.

## Verificações e recifragem

```sh
docker compose exec -T api node --input-type=module < scripts/verify-security.mjs
docker compose exec -T api node dist/scripts/rotate-health-cipher.js
# Após backup + restore aprovado, com UUID de um ADMIN ativo:
docker compose exec -T api node dist/scripts/rotate-health-cipher.js --apply --actor=<UUID>
```

A recifragem verifica plaintext em memória, recifra pela chave ativa e compara antes
de gravar. Atualização e auditoria são transacionais, com compare-and-swap para não
sobrescrever alterações concorrentes. Os relatórios mostram contagens, sem dados.
Deploy/rollback recusam imagens sem a capacidade `versioned-v1`: imagens anteriores
não conseguem ler os envelopes Vault. Não faça downgrade manual.

## Fontes consultadas

- https://developer.hashicorp.com/vault/tutorials/encryption-as-a-service/eaas-transit
- https://developer.hashicorp.com/vault/docs/audit/best-practices
- https://developer.hashicorp.com/vault/api-docs/system/storage/raft
- https://releases.hashicorp.com/vault/
- https://discuss.hashicorp.com/t/hcsec-2026-08-vault-vulnerable-to-denial-of-service-via-unauthenticated-root-token-generation-rekey-operations/77345
- https://www.pgbouncer.org/config.html
- https://redis.io/docs/latest/operate/oss_and_stack/management/security/encryption/

- https://developer.hashicorp.com/vault/docs/configuration/storage/raft
