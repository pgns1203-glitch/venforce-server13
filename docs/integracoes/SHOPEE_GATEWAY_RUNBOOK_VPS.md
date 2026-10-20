# Runbook — gateway Shopee na VPS (fase A: rede)

Objetivo desta fase: `Render/CLI → HTTPS+HMAC → gateway real → /probe/ip → IPv4 confirmado`.
Nada aqui chama a Shopee. Contexto e contrato: [`SHOPEE_FIXED_IP_GATEWAY.md`](SHOPEE_FIXED_IP_GATEWAY.md).

Arquivos usados: `shopee-gateway/deploy/bootstrap-ubuntu.sh`, `deploy/release.sh`,
`deploy/shopee-gateway.service.example` e `deploy/gateway.env.example`.

## 0. Decisões de partida

| Item | Decisão | Por quê |
|---|---|---|
| Região do Render | **Oregon (US West)**, inferida | o Postgres de produção é `*.oregon-postgres.render.com`, e o Render exige a mesma região para o banco interno. Confirmar em Render → serviço `venforce-server` → Settings → Region |
| Região do Droplet | **SFO3 (San Francisco)** | é a região DigitalOcean mais próxima de Oregon, o que deixa o trecho Render → gateway curto. Onde ficam os servidores da Shopee que atendem o Brasil é PENDENTE DE DOCUMENTAÇÃO SHOPEE. Se a latência gateway → Shopee se mostrar ruim, recriar em outra região custa minutos, mas **muda o IPv4** (e aí refazer a allowlist) |
| Imagem | Ubuntu 24.04 LTS x64 | |
| Plano | Basic, Regular, o menor (1 vCPU / 512 MB–1 GB) | o processo é pequeno (MemoryMax 256M) |
| IPv6 | **não habilitar** na criação | o gateway já força IPv4 na saída; sem IPv6, também não há AAAA nem entrada IPv6 |
| IP de saída | IPv4 público do próprio Droplet | não usar Reserved IP nesta fase |
| Autenticação SSH | só SSH key | |
| Domínio | subdomínio próprio, ex.: `gw-shopee.<seu-dominio>` | o certificado do Caddy precisa de um nome com DNS A |

## 1. Criar o Droplet (manual, no painel da DigitalOcean)

1. Na sua máquina, gerar uma chave (se ainda não tiver):
   `ssh-keygen -t ed25519 -C "venforce-gateway" -f ~/.ssh/venforce_gateway`
2. Em DigitalOcean → **Create → Droplets**:
   - Region: **San Francisco · SFO3**;
   - Image: **Ubuntu 24.04 (LTS) x64**;
   - Size: **Basic → Regular → o menor**;
   - Authentication: **SSH Key → New SSH Key**, colando `~/.ssh/venforce_gateway.pub`;
   - Advanced: **IPv6 desmarcado**; Monitoring pode ficar ligado;
   - Hostname: `venforce-shopee-gw`.
3. Anotar o **IPv4 público** (`ipv4` na página do Droplet).
4. (Opcional, recomendado) Networking → **Firewalls → Create Firewall** `shopee-gw`:
   Inbound 22/TCP só do seu IP, 80/TCP e 443/TCP de qualquer origem; Outbound liberado;
   aplicar ao Droplet. O `ufw` do bootstrap faz o mesmo dentro da máquina.

## 2. Bootstrap (uma vez)

```bash
# na sua máquina, na raiz do repo
GW_IP=<IPv4 do Droplet>
scp -i ~/.ssh/venforce_gateway shopee-gateway/deploy/bootstrap-ubuntu.sh root@$GW_IP:/root/
ssh -i ~/.ssh/venforce_gateway root@$GW_IP \
  "ADMIN_IP=$(curl -4 -s https://api.ipify.org) GATEWAY_DOMAIN=gw-shopee.<seu-dominio> bash /root/bootstrap-ubuntu.sh"
```

O script instala atualizações + `unattended-upgrades` e cria o usuário `deploy`
(sudo, só chave). Também configura SSH sem root e sem senha, `ufw` (22 só do
ADMIN_IP, 80/443 abertos), Node 22 (NodeSource), Caddy (repositório oficial),
o usuário de serviço `shopee-gw`, `/opt/shopee-gateway/{releases,incoming}`,
`/etc/shopee-gateway/gateway.env` vazio (0640, `root:shopee-gw`) e o
Caddyfile do domínio (validado, mas ainda não recarregado).

A partir daqui o acesso é **só** `ssh -i ~/.ssh/venforce_gateway deploy@$GW_IP`
(root fica bloqueado). Se o seu IP mudar, reabra a porta 22 pelo console web da DO:
`ufw allow from <novo IP> to any port 22 proto tcp`.

## 3. Segredo compartilhado e env do gateway

No Droplet (o segredo nasce lá e não passa por chat nem por commit):

```bash
sudo bash -c 'umask 027; SECRET=$(node -e "process.stdout.write(require(\"crypto\").randomBytes(48).toString(\"base64url\"))");
cat > /etc/shopee-gateway/gateway.env <<EOF
NODE_ENV=production
HOST=127.0.0.1
PORT=8787
GATEWAY_SHARED_SECRET=$SECRET
SHOPEE_API_ORIGIN=
SHOPEE_ALLOWED_PATHS=
IP_PROBE_URL=https://api.ipify.org
UPSTREAM_TIMEOUT_MS=10000
EOF
chown root:shopee-gw /etc/shopee-gateway/gateway.env; chmod 0640 /etc/shopee-gateway/gateway.env'
```

`SHOPEE_API_ORIGIN` e `SHOPEE_ALLOWED_PATHS` ficam **vazios** na fase A. O
`/forward` responde `CONFIG_MISSING` até a documentação oficial confirmar os
valores.

Para copiar o segredo para o Render/CLI, ler direto no terminal do Droplet
(`sudo grep ^GATEWAY_SHARED_SECRET= /etc/shopee-gateway/gateway.env | cut -d= -f2-`)
e colar no destino. Não colar em chat, issue ou commit.

## 4. Publicar um release

```bash
# na sua máquina, na raiz do repo, a partir do commit desejado (ex.: origin/main)
SHA=$(git rev-parse --short=12 origin/main)
git archive --format=tar.gz -o /tmp/shopee-gateway-$SHA.tar.gz $SHA shopee-gateway
scp -i ~/.ssh/venforce_gateway /tmp/shopee-gateway-$SHA.tar.gz shopee-gateway/deploy/release.sh deploy@$GW_IP:/opt/shopee-gateway/incoming/
ssh -i ~/.ssh/venforce_gateway deploy@$GW_IP \
  "sudo bash /opt/shopee-gateway/incoming/release.sh deploy $SHA /opt/shopee-gateway/incoming/shopee-gateway-$SHA.tar.gz"
```

`release.sh deploy` extrai em `/opt/shopee-gateway/releases/<sha>` e roda os 33
testes **no próprio Droplet** (se falharem, nada é trocado). Depois instala a
unit systemd, troca `current` de forma atômica, reinicia e confere
`127.0.0.1:8787/health`. Se o `/health` não responder, volta sozinho para o
release anterior. Mantém os 5 releases mais recentes.

## 5. DNS (A sem AAAA)

No provedor DNS do domínio:

| Tipo | Nome | Valor | TTL |
|---|---|---|---|
| A | `gw-shopee` | `<IPv4 do Droplet>` | 300 |

Não criar AAAA. Conferir: `dig +short A gw-shopee.<seu-dominio>` (tem que
devolver o IPv4) e `dig +short AAAA gw-shopee.<seu-dominio>` (tem que vir vazio).

## 6. HTTPS (Caddy)

Só depois do passo 5 resolver:

```bash
ssh -i ~/.ssh/venforce_gateway deploy@$GW_IP "sudo systemctl reload caddy && sleep 5 && sudo journalctl -u caddy -n 20 --no-pager"
curl -s https://gw-shopee.<seu-dominio>/health        # {"ok":true}
curl -s -o /dev/null -w "%{http_code}\n" https://gw-shopee.<seu-dominio>/probe/ip   # 401 (sem HMAC)
```

## 7. Smoke `/probe/ip` (fase A concluída)

O probe devolve o IP com que **o gateway** sai, não importa de onde é chamado.
Por isso dá para rodar da sua máquina, sem tocar no Render:

```bash
cd server
SHOPEE_GATEWAY_URL=https://gw-shopee.<seu-dominio> SHOPEE_GATEWAY_SECRET='<segredo>' \
  node scripts/shopeeGatewayProbe.js
# Gateway reachable
# Outbound IPv4: <tem que ser o IPv4 do Droplet>
```

Conferência cruzada no Droplet: `curl -4 -s https://api.ipify.org` e
`ip -4 -brief addr show eth0` devem mostrar o mesmo IPv4.

Depois, no Render (Environment do serviço `venforce-server`), configurar
`SHOPEE_GATEWAY_URL` e `SHOPEE_GATEWAY_SECRET`. São opcionais e nenhuma rota usa
ainda, então o deploy segue igual. Para repetir o probe de dentro do Render:
Render → Shell → `cd server && node scripts/shopeeGatewayProbe.js` (o Shell só
existe em plano pago; sem ele, o teste da sua máquina já prova o caminho).

## 8. Diagnóstico

| Pergunta | Comando (no Droplet) |
|---|---|
| Processo vivo? | `systemctl status shopee-gateway` · `curl -s 127.0.0.1:8787/health` |
| Logs do gateway (JSON) | `journalctl -u shopee-gateway -f` · erros: `journalctl -u shopee-gateway -p warning --since -1h` |
| Logs do Caddy / TLS | `journalctl -u caddy -n 50` · `/var/log/caddy/shopee-gateway.log` |
| Qual release está no ar? | `sudo bash /opt/shopee-gateway/incoming/release.sh status` |
| Env carregada? (sem mostrar segredo) | `sudo awk -F= '{print $1"="(length($2)?"<preenchido>":"<vazio>")}' /etc/shopee-gateway/gateway.env` |
| IP de saída | `curl -4 -s https://api.ipify.org` · `ip -4 -brief addr` |
| Só IPv4 saindo? | durante uma chamada: `ss -tnp \| grep node` (só endereços IPv4) · `ip -6 addr` (sem global) |
| Firewall | `sudo ufw status verbose` |
| Porta do Node exposta? | `ss -ltnp \| grep 8787` → só `127.0.0.1:8787` |
| Relógio (janela HMAC de 60 s) | `timedatectl` → `System clock synchronized: yes` |
| `AUTH_INVALID` no probe | segredo diferente entre os dois lados (espaço/quebra de linha ao colar) |
| `TIMESTAMP_EXPIRED` | relógio fora de sincronia na sua máquina ou no Droplet |
| `UPSTREAM_TIMEOUT` no probe | saída bloqueada / ipify fora: `curl -4 -v https://api.ipify.org` |
| Certificado não emite | DNS A ainda não propagou, ou 80/443 fechados no Cloud Firewall |

## 9. Atualização e rollback

- **Atualizar:** repetir o passo 4 com o novo `SHA`. Zero mudança no Render.
- **Rollback:**
  `ssh deploy@$GW_IP "sudo bash /opt/shopee-gateway/incoming/release.sh rollback"`.
  Volta para o release anterior e confere `/health`.
- **Mudar env** (ex.: preencher host/paths oficiais na fase B): editar
  `/etc/shopee-gateway/gateway.env` e rodar
  `sudo systemctl restart shopee-gateway`. Config inválida derruba o boot com
  mensagem clara no `journalctl` (sem mostrar o segredo).
- **Trocar o segredo:** gerar um novo (passo 3) e atualizar o Render na mesma
  janela. Durante a troca, as chamadas falham com `AUTH_INVALID`.
- **Desligar tudo:** `sudo systemctl stop shopee-gateway caddy`. No Render, basta
  apagar `SHOPEE_GATEWAY_URL` (o client fica "não configurado").
- **IP muda se:** o Droplet for destruído/recriado ou mudar de região. Resize e
  reboot mantêm o IPv4. Se mudar, refazer o passo 7 e a allowlist.

## 10. Depois da fase A (dependem da Shopee)

1. Cadastrar o IPv4 do passo 7 na allowlist do app no console da Shopee
   (onde fica: PENDENTE DE DOCUMENTAÇÃO SHOPEE).
2. Fase B: preencher `SHOPEE_API_ORIGIN` e `SHOPEE_ALLOWED_PATHS` com os valores
   oficiais e fazer uma chamada de controle via gateway, mais o controle
   negativo direto do Render.
3. Fase C: OAuth / `state` / `token/get` via `shopeeGatewayClient.forward()`,
   só com o contrato oficial em mãos.
