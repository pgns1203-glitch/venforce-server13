#!/usr/bin/env bash
# Bootstrap do Droplet do gateway Shopee (Ubuntu 24.04 LTS). Rodar como root,
# UMA vez, logo após criar o Droplet:
#
#   ADMIN_IP=<seu IPv4 público> GATEWAY_DOMAIN=<subdominio.dominio> bash bootstrap-ubuntu.sh
#
# Idempotente: pode rodar de novo sem quebrar nada. Não grava segredo nenhum:
# o gateway.env é criado vazio (0640) para ser preenchido à mão depois.
set -euo pipefail

: "${ADMIN_IP:?defina ADMIN_IP (IPv4 de onde você faz SSH)}"
: "${GATEWAY_DOMAIN:?defina GATEWAY_DOMAIN (ex.: gw-shopee.seudominio.com)}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
SERVICE_USER="shopee-gw"
APP_DIR="/opt/shopee-gateway"
ENV_DIR="/etc/shopee-gateway"
NODE_MAJOR="${NODE_MAJOR:-22}"

[ "$(id -u)" -eq 0 ] || { echo "rode como root"; exit 1; }
. /etc/os-release
[ "${ID}" = "ubuntu" ] || { echo "esperado Ubuntu, achei ${ID}"; exit 1; }

echo "== pacotes base"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y ca-certificates curl gnupg ufw unattended-upgrades debian-keyring debian-archive-keyring apt-transport-https dnsutils
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "== usuário administrativo não-root (${DEPLOY_USER})"
if ! id "${DEPLOY_USER}" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "${DEPLOY_USER}"
fi
usermod -aG sudo "${DEPLOY_USER}"
install -d -m 0700 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "/home/${DEPLOY_USER}/.ssh"
if [ -s /root/.ssh/authorized_keys ] && [ ! -s "/home/${DEPLOY_USER}/.ssh/authorized_keys" ]; then
  install -m 0600 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" /root/.ssh/authorized_keys "/home/${DEPLOY_USER}/.ssh/authorized_keys"
fi
# sudo sem senha só para o deploy (conta sem senha, acesso só por chave).
echo "${DEPLOY_USER} ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/90-${DEPLOY_USER}"
chmod 0440 "/etc/sudoers.d/90-${DEPLOY_USER}"

echo "== SSH: só chave, sem root"
cat > /etc/ssh/sshd_config.d/90-shopee-gateway.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
EOF
sshd -t
systemctl reload ssh

echo "== firewall (ufw): 22 só do ADMIN_IP, 80/443 abertos, porta do Node fechada"
ufw default deny incoming
ufw default allow outgoing
ufw allow from "${ADMIN_IP}" to any port 22 proto tcp
ufw allow 80/tcp   # desafio HTTP do ACME (emissão/renovação do certificado)
ufw allow 443/tcp
ufw --force enable

echo "== Node ${NODE_MAJOR}.x (NodeSource)"
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" -o /tmp/nodesource_setup.sh
  bash /tmp/nodesource_setup.sh
  apt-get install -y nodejs
fi
node -v

echo "== Caddy (repositório oficial)"
if ! command -v caddy >/dev/null 2>&1; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi
caddy version

echo "== usuário de serviço e diretórios"
if ! id "${SERVICE_USER}" >/dev/null 2>&1; then
  useradd --system --home "${APP_DIR}" --shell /usr/sbin/nologin "${SERVICE_USER}"
fi
install -d -m 0755 -o root -g root "${APP_DIR}" "${APP_DIR}/releases" "${APP_DIR}/incoming"
chown "${DEPLOY_USER}:${DEPLOY_USER}" "${APP_DIR}/incoming"
install -d -m 0750 -o root -g "${SERVICE_USER}" "${ENV_DIR}"
if [ ! -f "${ENV_DIR}/gateway.env" ]; then
  install -m 0640 -o root -g "${SERVICE_USER}" /dev/null "${ENV_DIR}/gateway.env"
fi

echo "== Caddyfile para ${GATEWAY_DOMAIN}"
cat > /etc/caddy/Caddyfile <<EOF
${GATEWAY_DOMAIN} {
	request_body {
		max_size 128KB
	}
	reverse_proxy 127.0.0.1:8787
	log {
		output file /var/log/caddy/shopee-gateway.log {
			roll_size 10MiB
			roll_keep 5
		}
		format filter {
			wrap json
			fields {
				request>uri delete
				request>headers>X-Vf-Signature delete
				request>headers>X-Vf-Nonce delete
			}
		}
	}
}
EOF
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
# O Caddy só é recarregado depois do DNS apontar (ver runbook, passo 6).

echo
echo "OK. Próximos passos (runbook): preencher ${ENV_DIR}/gateway.env, publicar o 1º release, DNS A, reload do Caddy."
echo "IPv4 público deste Droplet: $(curl -4 -fsS --max-time 10 https://api.ipify.org || echo '?')"
