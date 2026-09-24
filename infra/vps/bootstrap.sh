#!/usr/bin/env bash
# =============================================================================
# MOVIVO — Bootstrap da VPS de produção (Hostinger KVM 2 · Ubuntu 24.04 LTS)
# =============================================================================
# Dono: Henrique (Platform/SRE)
#
# Roda UMA vez, como root, numa VPS recém-criada. É idempotente: rodar de novo
# não quebra nada, só reaplica a configuração.
#
# Uso (da sua máquina, depois de `ssh-copy-id root@<IP>`):
#   scp infra/vps/bootstrap.sh root@<IP>:/root/
#   ssh root@<IP>
#   bash /root/bootstrap.sh                      # DENTRO da sessão, e mantenha-a aberta
#   DEPLOY_USER=outro bash /root/bootstrap.sh    # usuário ≠ deploy
#
# Rode dentro de uma sessão interativa (não `ssh root@IP 'bash ...'`): o último
# passo bloqueia o root por SSH, e essa sessão aberta é o seu caminho de volta
# se o login do usuário de deploy falhar.
#
# O que faz:
#   1. Atualiza o sistema e liga atualização automática SÓ de segurança
#      (sem reboot automático — derrubaria o Postgres num horário aleatório).
#   2. Cria o usuário de deploy (sudo + docker) com as MESMAS chaves SSH do root.
#   3. Instala Docker Engine + Compose plugin pelo repositório oficial da Docker.
#   4. Firewall UFW: nega tudo que entra, exceto 22/80/443.
#   5. fail2ban no SSH.
#   6. Swap de 4 GB + sysctl que o Redis exige (overcommit_memory=1).
#   7. /opt/movivo (secrets 700, uploads, backups) com dono = usuário de deploy.
#   8. POR ÚLTIMO: SSH só por chave, sem login de root.
#
# Trava anti-lockout: aborta ANTES de tocar em qualquer coisa se o root não tiver
# uma chave em /root/.ssh/authorized_keys — desligar senha sem chave instalada
# tranca todo mundo fora da máquina.
#
# Atenção — Docker × UFW: portas publicadas pelo Docker passam POR FORA do UFW
# (o Docker escreve no iptables antes). Por isso o docker-compose publica tudo em
# 127.0.0.1; em produção só o Nginx publica 80/443.
# =============================================================================
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"
SWAP_SIZE_GB="${SWAP_SIZE_GB:-4}"
APP_DIR="/opt/movivo"

log() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mERRO: %s\033[0m\n' "$*" >&2; exit 1; }

# -----------------------------------------------------------------------------
# 0. Pré-condições
# -----------------------------------------------------------------------------
[[ $EUID -eq 0 ]] || die "rode como root."

# shellcheck source=/dev/null
. /etc/os-release
[[ "${ID}" == "ubuntu" && "${VERSION_ID}" == "24.04" ]] \
  || die "feito para Ubuntu 24.04 LTS; esta máquina é ${PRETTY_NAME}."

[[ -s /root/.ssh/authorized_keys ]] \
  || die "/root/.ssh/authorized_keys vazio. Rode antes, da sua máquina: ssh-copy-id root@<IP>"

export DEBIAN_FRONTEND=noninteractive
# needrestart do 24.04 pergunta quais serviços reiniciar — em modo "a" reinicia sozinho.
export NEEDRESTART_MODE=a

# -----------------------------------------------------------------------------
# 1. Sistema + atualização automática de segurança
# -----------------------------------------------------------------------------
log "Atualizando pacotes"
apt-get update -q
apt-get -y -q -o Dpkg::Options::=--force-confold upgrade
apt-get -y -q install ca-certificates curl gnupg ufw fail2ban \
  unattended-upgrades apt-listchanges

timedatectl set-timezone America/Sao_Paulo

cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF

cat > /etc/apt/apt.conf.d/51movivo-unattended <<'EOF'
// Sem reboot automático: kernel novo fica pendente até um reboot planejado
// (/var/run/reboot-required sinaliza). Reboot às cegas derruba o Postgres.
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
EOF

# -----------------------------------------------------------------------------
# 2. Usuário de deploy
# -----------------------------------------------------------------------------
log "Usuário ${DEPLOY_USER}"
if ! id "${DEPLOY_USER}" &>/dev/null; then
  adduser --disabled-password --gecos "" "${DEPLOY_USER}"
fi
usermod -aG sudo "${DEPLOY_USER}"

# Sem senha, o sudo precisa ser NOPASSWD — senão o usuário não consegue usá-lo.
echo "${DEPLOY_USER} ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/90-${DEPLOY_USER}"
chmod 440 "/etc/sudoers.d/90-${DEPLOY_USER}"
visudo -cf "/etc/sudoers.d/90-${DEPLOY_USER}" >/dev/null

install -d -m 700 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "/home/${DEPLOY_USER}/.ssh"
install -m 600 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" \
  /root/.ssh/authorized_keys "/home/${DEPLOY_USER}/.ssh/authorized_keys"

# -----------------------------------------------------------------------------
# 3. Docker Engine (repositório oficial — não o docker.io do Ubuntu)
# -----------------------------------------------------------------------------
log "Docker Engine"
if ! command -v docker &>/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get -y -q install docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin
fi

# Rotação de log no daemon: sem isso o json-file cresce até encher os 100 GB.
# live-restore: containers seguem de pé durante upgrade do próprio Docker.
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "local",
  "log-opts": { "max-size": "20m", "max-file": "5" },
  "live-restore": true
}
EOF
systemctl enable --now docker
systemctl restart docker

# Grupo docker ≡ root na prática. Aceito aqui porque o usuário de deploy já tem
# sudo; não adicione mais ninguém a esse grupo.
usermod -aG docker "${DEPLOY_USER}"

# -----------------------------------------------------------------------------
# 4. Firewall
# -----------------------------------------------------------------------------
log "UFW (22, 80, 443)"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# -----------------------------------------------------------------------------
# 5. fail2ban no SSH
# -----------------------------------------------------------------------------
log "fail2ban"
cat > /etc/fail2ban/jail.d/movivo.conf <<'EOF'
[sshd]
enabled  = true
backend  = systemd
maxretry = 5
findtime = 10m
bantime  = 1h
EOF
# O filtro padrão casa _SYSTEMD_UNIT=sshd.service, mas no Ubuntu 24.04 a unidade
# é ssh.service: sem este override o jail fica ativo e cego (0 falhas, sempre).
cat > /etc/fail2ban/filter.d/sshd.local <<'EOF'
[Definition]
journalmatch = _SYSTEMD_UNIT=ssh.service + _COMM=sshd
EOF
systemctl enable fail2ban
systemctl restart fail2ban

# -----------------------------------------------------------------------------
# 6. Swap + sysctl
# -----------------------------------------------------------------------------
log "Swap de ${SWAP_SIZE_GB} GB e sysctl"
if ! swapon --show | grep -q '/swapfile'; then
  fallocate -l "${SWAP_SIZE_GB}G" /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

cat > /etc/sysctl.d/99-movivo.conf <<'EOF'
# Swap só como último recurso antes do OOM killer — não como memória de trabalho.
vm.swappiness = 10
# Exigido pelo Redis: sem isso o BGSAVE/AOF rewrite pode falhar sob pressão de RAM.
vm.overcommit_memory = 1
EOF
sysctl --system >/dev/null

# -----------------------------------------------------------------------------
# 7. Diretório da aplicação
# -----------------------------------------------------------------------------
log "${APP_DIR}"
install -d -m 755 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "${APP_DIR}"
install -d -m 700 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "${APP_DIR}/secrets"
install -d -m 750 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "${APP_DIR}/uploads"
install -d -m 700 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "${APP_DIR}/backups"

# -----------------------------------------------------------------------------
# 8. SSH só por chave — SEMPRE o último passo
# -----------------------------------------------------------------------------
log "SSH: só chave, sem root"
# Prefixo 00-: o sshd fica com o PRIMEIRO valor que lê, e o cloud-init da
# Hostinger costuma deixar um 50-cloud-init.conf com PasswordAuthentication yes.
cat > /etc/ssh/sshd_config.d/00-movivo.conf <<EOF
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
AllowUsers ${DEPLOY_USER}
EOF
sshd -t || die "config do sshd inválida — nada foi reiniciado."
systemctl restart ssh

IP="$(hostname -I | awk '{print $1}')"
cat <<EOF

=============================================================================
 Bootstrap concluído.

 NÃO feche esta sessão ainda. Numa aba NOVA do terminal, teste:

     ssh ${DEPLOY_USER}@${IP}
     docker run --rm hello-world

 Só depois que funcionar, feche a sessão do root. Daqui em diante o root não
 entra mais por SSH; use '${DEPLOY_USER}' + sudo.
=============================================================================
EOF
