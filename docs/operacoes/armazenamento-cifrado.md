# Armazenamento cifrado da MOVIVO

## Escopo e custódia

O macOS local usa FileVault no volume Data que contém o `Docker.raw`. Na VPS, os dados
persistentes de containerd, Docker (PostgreSQL, Redis, Evolution, Vault e logs) e
`/opt/movivo` (uploads, segredos operacionais e backups já cifrados) residem em um
filesystem ext4 sobre LUKS2. A imagem cifrada fica em `/srv/movivo-data.luks` e é
montada em `/mnt/movivo-secure`; os três caminhos originais são bind mounts dessa
árvore. A chave de desbloqueio e o backup do cabeçalho LUKS ficam **somente** na
estação de recuperação, fora da VPS e do Git, em
`~/.local/share/movivo-security/production-recovery/`, com permissões 0600. Esta
chave é diferente das chaves Vault Transit, pgcrypto e backup.

Após reboot da VPS, containerd e Docker permanecem parados até que o operador execute
`bash scripts/unlock-vps-storage.sh` **no Mac autorizado**. O script envia a chave pelo
stdin de SSH para `cryptsetup`, monta o volume e sobe os containers. O host precisa
ser desbloqueado manualmente para restabelecer o serviço; esse é o custo operacional
de manter a chave fora da VPS sem KMS externo. Não guardar a chave em `crypttab`,
variáveis de ambiente, arquivos da VPS ou na imagem LUKS. O serviço
`movivo-storage-mount.service` e dependências de containerd/Docker falham fechado se
o mapper não estiver aberto.

## Verificação após reboot ou manutenção

Na VPS, sem ler segredos:

```bash
sudo /usr/local/sbin/movivo-storage-verify
sudo cryptsetup status movivo_data
for path in /mnt/movivo-secure /var/lib/containerd /var/lib/docker /opt/movivo; do
  findmnt -no SOURCE,FSTYPE --target "$path"
done
systemctl is-active movivo-storage-mount containerd docker
cd /opt/movivo && docker compose ps
```

Os quatro mountpoints devem apontar para `/dev/mapper/movivo_data` (os bind mounts
incluem sufixos `[... ]` em `findmnt`). `cryptsetup status` deve indicar `LUKS2` e
`aes-xts-plain64`. Depois executar `docker compose exec -T api node --input-type=module
< bin/verify-security.mjs` e o teste de restore em `bin/movivo-restore-test.sh`.
O restore usa containers descartáveis sem rede, tmpfs e swap proibido; não altera
os serviços vivos.

Em 2026-10-07, o reboot real da VPS foi testado. O `boot_id` mudou de
`1ce38952-0082-45ff-9734-dc9f66f40031` para
`485dcdb3-2589-48c0-bb0a-1448ad262d12`; antes do desbloqueio, o LUKS estava
fechado e `movivo-storage-mount`, containerd e Docker não subiram. O comando
`bash scripts/unlock-vps-storage.sh`, executado no Mac, abriu o volume, montou os
três diretórios e trouxe os 14 serviços de volta. Depois, o verificador de mounts e
os 21 checks de TLS/Vault passaram; site e API responderam HTTP 200. Esse ensaio
comprova o procedimento de recuperação nessa VPS, com a estação e a chave atuais.

## Recuperação

Se o LUKS não abrir, preserve a imagem original e o cabeçalho. O arquivo
`storage-luks-header.img` da estação de recuperação permite recuperar um cabeçalho
danificado com `cryptsetup luksHeaderRestore`, depois de obter uma cópia da imagem
para trabalhar sem destruir a original. A chave `storage-luks.key` é necessária para
abrir o volume. Os backups `.enc` de 2026-10-07T19:23:49-03:00 foram copiados
para a estação de recuperação antes da migração. O conjunto pós-migração
`20261007-194910` também foi copiado e comparado por SHA-256, após restore
descartável completo. A restauração desses conjuntos exige as chaves
legadas de backup e a custódia original do Vault, mantidas em diretório separado.
Depois de adicionar ou retirar um slot LUKS, refaça a cópia privada do cabeçalho;
um backup de cabeçalho anterior à rotação não representa o estado dos slots novos.

Não apagar os arquivos de custódia após rotação do Transit: backups anteriores podem
conter ciphertext de versões antigas. Em caso de falha do containerd/Docker, verificar
primeiro os bind mounts; iniciar os serviços sobre diretórios vazios da partição raiz
criaria uma instância divergente, por isso as dependências systemd bloqueiam a subida.

## Limites da evidência

LUKS protege os dados persistidos contra leitura da imagem de disco com a VPS
desligada e a chave ausente. Não protege contra root do host ativo, memória de
processos, consultas autorizadas ao banco ou snapshots antigos do provedor. A
migração não apaga retroativamente snapshots de hipervisor; o estado deles depende
do fornecedor. O histórico anterior em blocos livres do ext4 original também não
é certificável somente por `rm`/`fstrim`. Para reduzir esse risco, os backups foram
cifrados separadamente, e conversas, resumos e PDFs novos usam Vault Transit na aplicação.
O inventário completo fica em
[dados-sensiveis-2026-10-06.md](../seguranca/dados-sensiveis-2026-10-06.md).
