# Gateway Shopee com IPv4 fixo

> Estado: **fase 1 — infraestrutura**. Gateway e client prontos e testados com
> mocks locais. Nada em produção, nada ligado a rota, nenhuma chamada real à
> Shopee. Tudo marcado **PENDENTE DE DOCUMENTAÇÃO SHOPEE** precisa ser
> confirmado na documentação oficial antes de virar código.

## 1. Por que existe

A Shopee exige que as chamadas venham de IPs cadastrados numa allowlist. O
Render não tem IP de saída próprio e previsível para isso, e mover o SaaS
inteiro para uma VPS não vale a pena. Então só a **saída de rede** vai para
uma VPS pequena:

```
Portal ──► Backend VenForce (Render) ──HTTPS + HMAC──► Gateway (VPS) ──IPv4 fixo──► Shopee API
```

O callback de autorização **continua no Render** (`GET /shopee/callback`). O
gateway nunca recebe callback da Shopee.

## 2. Responsabilidades

| Render (backend) | Gateway (VPS) |
|---|---|
| Regras de negócio, Cliente / ClienteConta, banco | Nada disso |
| OAuth: URL de autorização, `state`, callback | Nada disso |
| `partner_id`, `partner_key` | **Nunca** recebe `partner_key` |
| Assinatura Shopee (vai pronta na `query`) | Não assina, não altera a query |
| `access_token` / `refresh_token` (persistência) | Não persiste nada; só repassa a resposta |
| Retry (com timestamp/nonce/assinatura novos) | **Sem retry** |
| HMAC Render → Gateway (`SHOPEE_GATEWAY_SECRET`) | Verifica HMAC (`GATEWAY_SHARED_SECRET`) |
| — | Allowlist de paths/métodos, IPv4 forçado, timeouts, limites |

O `access_token` passa pela memória do gateway em trânsito (vai na query ou no
corpo da chamada Shopee e volta na resposta do `token/get`), mas nunca é
gravado nem logado.

## 3. Arquivos

```
shopee-gateway/                 pacote isolado, zero dependências
  src/server.js                 rotas, leitura de corpo com limite, logs, erros
  src/config.js                 env → config validada (origem, allowlist, limites)
  src/auth.js                   HMAC, janela de timestamp, cache de nonce
  src/forwarder.js              saída HTTP: IPv4 forçado, timeout, sem redirect, limite de resposta
  src/errors.js                 códigos de erro estáveis
  test/gateway.test.js          33 testes (node --test) com servidores locais
  scripts/gen-secret.js         gera segredo forte
  deploy/                       systemd, Caddy e env de exemplo (sem valor real)
server/services/shopee/
  shopeeGatewayConfig.js        SHOPEE_GATEWAY_URL / _SECRET / _TIMEOUT_MS
  shopeeGatewayError.js         erro tipado (só metadados seguros)
  shopeeGatewayClient.js        probeIp(), forward() — NÃO ligado a rota
server/scripts/shopeeGatewayProbe.js   smoke test Render → gateway → IP
server/tests/shopeeGatewayClient.test.js
```

Não foram tocados: `server/routes/shopeeRoutes.js`,
`server/controllers/shopeeController.js` (callback), `server/services/matrizApi/`,
Shell V3, Squads, Carteira, vf-context, banco.

## 4. Contrato Render → Gateway

### 4.1 Autenticação HMAC

Toda rota exceto `/health` exige:

| Header | Formato |
|---|---|
| `X-VF-Timestamp` | segundos Unix, inteiro |
| `X-VF-Nonce` | 16–128 chars `[A-Za-z0-9_-]`; o client usa 32 bytes aleatórios em base64url |
| `X-VF-Signature` | hex minúsculo (64 chars) |

```
canonical = METHOD + "\n" + PATH + "\n" + TIMESTAMP + "\n" + NONCE + "\n" + hex(SHA256(corpo cru))
signature = hex(HMAC-SHA256(segredo, canonical))
```

- `METHOD`/`PATH` são os da requisição **ao gateway** (`POST /forward`,
  `GET /probe/ip`). Método e path da Shopee ficam dentro do corpo e estão
  cobertos pelo hash. Corpo vazio → `e3b0c442…b855`.
- Janela: `|agora − timestamp| ≤ AUTH_WINDOW_SECONDS` (padrão 60 s), nos dois
  sentidos.
- Comparação com `crypto.timingSafeEqual`.
- Ordem: formato → janela → assinatura → nonce. O nonce só entra na cache
  **depois** da assinatura válida, para que um atacante sem o segredo não consiga
  encher a cache.
- Nonce repetido dentro do TTL (2 × janela) → `NONCE_REPLAY`. Cache em memória
  limitada a `MAX_NONCES`; cheia → `NONCE_CACHE_FULL` (503, falha fechada:
  despejar nonces vivos reabriria replay).
- **Uma instância só.** Com mais de uma instância, o nonce precisa de
  armazenamento compartilhado (senão um replay passa por outra instância).

### 4.2 `POST /forward`

Corpo (JSON):

```json
{ "method": "GET|POST", "path": "/caminho/exato/da/allowlist", "query": { "k": "v" }, "body": { } }
```

- Campos aceitos: só `method`, `path`, `query`, `body`. Qualquer outro
  (`url`, `host`, `origin`, `headers`…) → 400 `INVALID_FORMAT`.
- `method`: `GET` ou `POST`. As APIs Shopee que precisamos usam só esses dois
  (CONFIRMAR NA DOCUMENTAÇÃO SHOPEE); acrescentar outro é mudança de código
  consciente, não de env.
- `path`: segmentos `[A-Za-z0-9_-]` separados por `/`, sem `.`, `%`, `\`,
  `//`, `?`, `#`, `@`, espaço ou barra final; e precisa estar **exatamente** em
  `SHOPEE_ALLOWED_PATHS` (sem prefixo, sem curinga).
- `query`: objeto plano de string/number/boolean, chaves `[A-Za-z0-9_.-]`,
  ≤ 50 chaves, query final ≤ `MAX_QUERY_LENGTH`. É aqui que vão `partner_id`,
  `timestamp`, `sign` etc. da Shopee, montados pelo Render.
- `body`: só em `POST`; o gateway serializa com `JSON.stringify` e envia como
  `application/json`. GET com body → 400.
- URL final = `new URL(path, SHOPEE_API_ORIGIN)`, conferida de novo
  (`origin` e `pathname` iguais aos esperados) antes de sair.

Resposta:

| Situação | HTTP do gateway | Corpo |
|---|---|---|
| Shopee 2xx | 200 | `{ok:true, request_id, upstream:{status, content_type, body}}` |
| Shopee 4xx | 502 | `{ok:false, request_id, error:{code:"UPSTREAM_4XX"}, upstream:{status, content_type, body}}` |
| Shopee 5xx | 502 | idem com `UPSTREAM_5XX` |
| Shopee 3xx | 502 | `UPSTREAM_REDIRECT`, sem `Location`, sem corpo |
| Erro do gateway | ver tabela 4.4 | `{ok:false, request_id, error:{code, message}}` |

`upstream.body` é o corpo cru (string) da Shopee: o Render faz o `JSON.parse`.
Em 4xx/5xx o corpo volta para o Render porque ele precisa do código de erro
da Shopee para decidir, mas o corpo **nunca** vai para log (nem no gateway nem
no client: `upstreamBody` é propriedade não enumerável do erro).

### 4.3 `GET /probe/ip` e `GET /health`

- `/probe/ip` (HMAC): GET em `IP_PROBE_URL` (padrão `https://api.ipify.org`,
  aceita texto `1.2.3.4` ou JSON `{"ip": …}`), forçando IPv4, com timeout e
  limite de 1 KiB. Valida com `net.isIPv4`. Falha → erro controlado; o
  processo segue vivo.
- `/health` (sem auth, **decisão consciente**): responde só `{"ok":true}`,
  para monitor externo/uptime. Não expõe env, host, versão, segredo nem token.

### 4.4 Códigos de erro

| code | HTTP | quando |
|---|---|---|
| `AUTH_MISSING` | 401 | faltou algum `X-VF-*` |
| `AUTH_INVALID` | 401 | formato ou assinatura inválidos |
| `TIMESTAMP_EXPIRED` | 401 | fora da janela (passado ou futuro) |
| `NONCE_REPLAY` | 401 | nonce já usado |
| `NONCE_CACHE_FULL` / `BUSY` | 503 | cache de nonce cheia / `MAX_INFLIGHT` requisições em curso |
| `NOT_FOUND` | 404 | rota desconhecida (a URL não é logada) |
| `METHOD_NOT_ALLOWED` | 405 | método da rota ou do envelope fora da allowlist |
| `PATH_NOT_ALLOWED` | 403 | path fora da allowlist, URL absoluta, `//host`, traversal… |
| `INVALID_FORMAT` | 400 | JSON inválido, campo extra, GET com body |
| `QUERY_INVALID` | 400 | query malformada ou grande demais |
| `BODY_TOO_LARGE` | 413 | corpo > `MAX_BODY_BYTES` |
| `CONFIG_MISSING` | 503 | `SHOPEE_API_ORIGIN` ainda não configurado |
| `UPSTREAM_TIMEOUT` | 504 | upstream não respondeu em `UPSTREAM_TIMEOUT_MS` |
| `UPSTREAM_NETWORK` | 502 | DNS, conexão recusada, TLS, reset |
| `UPSTREAM_REDIRECT` | 502 | upstream 3xx |
| `UPSTREAM_RESPONSE_TOO_LARGE` | 502 | resposta > `MAX_RESPONSE_BYTES` |
| `UPSTREAM_INVALID_RESPONSE` | 502 | probe sem IPv4 válido, status inesperado |
| `UPSTREAM_4XX` / `UPSTREAM_5XX` | 502 | Shopee respondeu erro |
| `INTERNAL` | 500 | bug; mensagem genérica, sem stack |

No client do Render, esses códigos chegam em `err.code`. Códigos locais do
client: `SHOPEE_GATEWAY_NAO_CONFIGURADO`, `_TIMEOUT`, `_ERRO_REDE`,
`_REDIRECT_BLOQUEADO`, `_RESPOSTA_INVALIDA`, `_ENVELOPE_INVALIDO`.

## 5. Variáveis de ambiente

**Gateway** (`/etc/shopee-gateway/gateway.env` na VPS; modelo em
`shopee-gateway/.env.example` e `deploy/gateway.env.example`):

| Var | Obrigatória | Padrão | Nota |
|---|---|---|---|
| `GATEWAY_SHARED_SECRET` | sim (não sobe sem) | — | ≥ 32 chars; `node scripts/gen-secret.js` |
| `SHOPEE_API_ORIGIN` | não | vazio → `/forward` = `CONFIG_MISSING` | só origem; https em produção. **PENDENTE** |
| `SHOPEE_ALLOWED_PATHS` | não | vazio → nada passa | lista exata, vírgula. **PENDENTE** |
| `HOST` / `PORT` | não | `127.0.0.1` / `8787` | nunca expor o Node direto |
| `IP_PROBE_URL` | não | `https://api.ipify.org` | |
| `UPSTREAM_TIMEOUT_MS` | não | 10000 | |
| `AUTH_WINDOW_SECONDS` | não | 60 | |
| `MAX_BODY_BYTES` / `MAX_RESPONSE_BYTES` | não | 64 KiB / 1 MiB | |
| `MAX_QUERY_LENGTH` / `MAX_NONCES` / `MAX_INFLIGHT` | não | 4096 / 10000 / 32 | |
| `NODE_ENV` | — | — | `production` → origem/probe só https |

**Render** (opcionais; sem elas o servidor sobe e o client fica "não configurado"):

| Var | Nota |
|---|---|
| `SHOPEE_GATEWAY_URL` | `https://<subdomínio do gateway>` (https obrigatório em produção) |
| `SHOPEE_GATEWAY_SECRET` | mesmo valor de `GATEWAY_SHARED_SECRET` |
| `SHOPEE_GATEWAY_TIMEOUT_MS` | padrão 15000 (maior que o timeout do gateway) |

O segredo nunca vai para frontend, query string, resposta HTTP ou log.

## 6. Rodar e testar localmente

```bash
# gateway
cd shopee-gateway
npm test                                   # 33 testes, sem rede externa
GATEWAY_SHARED_SECRET="$(node scripts/gen-secret.js)" npm start

# backend
cd server
node tests/shopeeGatewayClient.test.js     # unit + contrato com o gateway real local
SHOPEE_GATEWAY_URL=http://127.0.0.1:8787 SHOPEE_GATEWAY_SECRET=<o mesmo> \
  node scripts/shopeeGatewayProbe.js       # aqui sai pelo IP da sua máquina
```

Uso futuro do client (ainda não ligado a nada):

```js
const { shopeeGatewayClient } = require("./services/shopee/shopeeGatewayClient");
const { ipv4 } = await shopeeGatewayClient.probeIp();
const r = await shopeeGatewayClient.forward({ method: "POST", path: "<path oficial>", query: { /* partner_id, timestamp, sign… */ }, body: { /* … */ } });
JSON.parse(r.body);
```

## 7. Modelo de ameaça (v1, proporcional)

| Ameaça | Mitigação |
|---|---|
| Open proxy / SSRF | host só de `SHOPEE_API_ORIGIN`; path exato da allowlist com regex de segmento seguro; envelope fechado (sem `url`/`host`/`headers`); URL composta reconferida |
| Path traversal / encoding | `.`, `%`, `\`, `//` proibidos no path; allowlist validada no boot com a mesma regra |
| Redirect abuse | `node:http` não segue redirect; 3xx vira `UPSTREAM_REDIRECT` sem expor `Location`; client usa `redirect:"error"` |
| IPv6 bypass | `family: 4`, `lookup` só A record, `autoSelectFamily: false` em toda saída (Shopee e probe) |
| Replay | timestamp ±60 s + nonce obrigatório em cache com TTL e teto |
| Timing attack | `timingSafeEqual` em buffers de tamanho fixo |
| Vazamento de segredo | segredo só em env; nunca encaminhado (headers de saída são fixos: `accept`, `user-agent`, `content-type`, `content-length`); erros com mensagem genérica |
| Vazamento em log | log JSON só com `request_id`, método, rota conhecida, path já aprovado (sem query), status, duração, `error_code`. Nunca query, corpo, `code`, token, assinatura. Caddy de exemplo apaga query e `X-VF-*` do access log |
| Header injection | headers do caller descartados; `Host`, `Connection`, `Transfer-Encoding`, `X-Forwarded-*` são do Node, não do caller; path com CR/LF rejeitado |
| Payload abuse / DoS básico | corpo ≤ 64 KiB (Caddy corta em 128 KB antes), resposta ≤ 1 MiB, query ≤ 4096, cabeçalho ≤ 8 KiB e ≤ 64 headers, `headersTimeout`/`requestTimeout`, `MAX_INFLIGHT` |
| Rede / DNS pendurado | `AbortController` cobre DNS + conexão + resposta + corpo |
| Upstream malicioso/errado | tamanho limitado, corpo tratado como dado (string), status classificado; nada do upstream é executado ou logado |
| Exposição da porta | Node ouve em `127.0.0.1`; só o Caddy (443) é público; firewall não substitui o HMAC |

Fora do escopo v1: múltiplas instâncias (nonce compartilhado), rotação de
segredo com dois segredos válidos ao mesmo tempo, mTLS, rate limit por chave.

## 8. Deploy na VPS (DigitalOcean) — NÃO feito ainda

Valores de exemplo: domínio `gateway.exemplo.com`, usuário `deploy`, usuário de
serviço `shopee-gw`. Nenhum é real.

1. **Droplet**: Ubuntu LTS (24.04), menor plano, região próxima (CONFIRMAR se a
   região influencia algo na Shopee). Acesso só por **SSH key**. Use o **IPv4
   público do próprio Droplet**. Não presuma que um Reserved IP vira IP de
   saída: por padrão não vira; isso fica como evolução, depois de testar.
2. **Usuário não-root**:
   `adduser deploy && usermod -aG sudo deploy`, copiar a chave para
   `~deploy/.ssh/authorized_keys`, depois em `/etc/ssh/sshd_config`:
   `PermitRootLogin no`, `PasswordAuthentication no`, e `systemctl restart ssh`.
3. **Firewall** (Cloud Firewall do DO e/ou `ufw`):
   - 443/TCP aberto (HTTPS do Render; o Render não tem IP fixo de saída,
     então restringir 443 por origem só quando as faixas de saída do Render
     forem confirmadas no painel do Render — não hardcodar faixas sem validar);
   - 80/TCP aberto só se usar o desafio HTTP do ACME (padrão do Caddy);
   - 22/TCP só do IP administrativo;
   - a porta do Node (8787) **não** abre.
   ```bash
   sudo ufw default deny incoming && sudo ufw default allow outgoing
   sudo ufw allow from <IP_ADMIN> to any port 22 proto tcp
   sudo ufw allow 443/tcp && sudo ufw allow 80/tcp
   sudo ufw enable
   ```
4. **Node ≥ 20 LTS**: o `nodejs` do apt do Ubuntu 24.04 é antigo; usar o
   repositório da NodeSource (LTS) ou o binário oficial de nodejs.org.
   Conferir: `node -v`.
5. **Usuário de serviço e código**:
   ```bash
   sudo useradd --system --home /opt/shopee-gateway --shell /usr/sbin/nologin shopee-gw
   sudo mkdir -p /opt/shopee-gateway/releases /etc/shopee-gateway
   # copiar a pasta shopee-gateway/ do commit X para /opt/shopee-gateway/releases/<sha>
   sudo ln -sfn /opt/shopee-gateway/releases/<sha> /opt/shopee-gateway/current
   ```
   Sem `npm install`: o gateway não tem dependência.
6. **Env**: copiar `deploy/gateway.env.example` para
   `/etc/shopee-gateway/gateway.env`, preencher `GATEWAY_SHARED_SECRET`
   (gerado na hora, nunca copiado de chat/commit),
   `chown root:shopee-gw` e `chmod 0640`.
7. **systemd**: copiar `deploy/shopee-gateway.service.example` para
   `/etc/systemd/system/shopee-gateway.service`, depois
   `sudo systemctl daemon-reload && sudo systemctl enable --now shopee-gateway`.
   Conferir: `curl -s http://127.0.0.1:8787/health`.
8. **DNS**: registro **A** `gateway.exemplo.com` → IPv4 do Droplet (sem AAAA,
   para não convidar IPv6 na entrada). Esperar propagar
   (`dig +short gateway.exemplo.com`) **antes** de subir o Caddy, senão a
   emissão do certificado falha.
9. **Caddy** (instalação pelo repositório oficial, conforme
   caddyserver.com/docs/install): copiar `deploy/Caddyfile.example` para
   `/etc/caddy/Caddyfile` trocando o domínio, rodar
   `caddy validate --config /etc/caddy/Caddyfile` (a sintaxe do filtro de log
   varia entre versões do Caddy) e `sudo systemctl reload caddy`. O Caddy emite e
   renova o certificado sozinho. Conferir:
   `curl -s https://gateway.exemplo.com/health` → `{"ok":true}`.
10. **Render**: configurar `SHOPEE_GATEWAY_URL` e `SHOPEE_GATEWAY_SECRET`
    (a configuração real no Render fica para a próxima fase).

**Operação**

- Logs: `journalctl -u shopee-gateway -f` (JSON por linha) e
  `/var/log/caddy/shopee-gateway.log`.
- Restart: `sudo systemctl restart shopee-gateway`.
- Atualizar: novo diretório em `releases/<sha-novo>`, `npm test` lá dentro,
  `ln -sfn … current`, `systemctl restart shopee-gateway`, `/health`.
- Rollback: `ln -sfn /opt/shopee-gateway/releases/<sha-anterior> /opt/shopee-gateway/current && sudo systemctl restart shopee-gateway`.
- Rotação de segredo (v1 com 1 segredo só): gerar novo → atualizar gateway e
  Render na mesma janela; durante a troca as chamadas falham com `AUTH_INVALID`.
- Atualizações do SO: `unattended-upgrades` ligado.

## 9. Descobrir o IP e cadastrar na allowlist

1. Do Render (ou da sua máquina, com as mesmas ENV):
   `node scripts/shopeeGatewayProbe.js` → `Outbound IPv4: x.x.x.x`.
2. Conferir no Droplet que é o mesmo IP: `curl -4 -s https://api.ipify.org` e
   `ip -4 addr show` (o IPv4 público do Droplet).
3. Garantir que é IPv4 de verdade: o probe já recusa resposta que não seja
   IPv4; durante uma chamada, `ss -tnp | grep node` mostra só conexões IPv4.
4. Cadastrar **esse** IPv4 na allowlist do app no painel da Shopee
   (onde fica e quantos IPs aceita: PENDENTE DE DOCUMENTAÇÃO SHOPEE).
5. Se o Droplet for destruído/recriado, o IP muda: refazer o probe e a allowlist.

## 10. Fluxo OAuth futuro (NÃO implementado)

```
Seller ─► Shopee (autoriza) ─► Render GET /shopee/callback
  Render valida state ─► monta token/get assinado com partner_key
  ─► shopeeGatewayClient.forward() ─► Gateway ─► Shopee
  ◄─ access_token/refresh_token ◄─ Render persiste (fase futura)
```

**Especificação de `state`** (para a próxima fase):

- 32 bytes de `crypto.randomBytes`, codificados em base64url;
- associado a usuário + ClienteConta no servidor (tabela ou cache server-side);
- TTL curto (~10 min), uso único, invalidado ao consumir (também em falha);
- o callback só confia no que o `state` aponta; nunca em `shop_id`/ids vindos
  só da query do callback.
- Se a Shopee aceita/devolve um parâmetro `state` (ou se o estado precisa ir
  embutido na `redirect` URL): **CONFIRMAR NA DOCUMENTAÇÃO SHOPEE**.

## 11. Teste real (próximas fases)

**Fase A — rede**
1. Criar Droplet.
2. Subir gateway (seção 8).
3. Configurar DNS + HTTPS.
4. Rodar `/probe/ip` via `shopeeGatewayProbe.js`.
5. Confirmar o IPv4 real (seção 9).
6. Cadastrar o IPv4 na allowlist da Shopee.

**Fase B — controle**
7. Preencher `SHOPEE_API_ORIGIN` e `SHOPEE_ALLOWED_PATHS` com valores oficiais;
   testar uma chamada que dependa da allowlist via gateway.
8. Se possível, controle negativo: a mesma chamada direto do Render deve ser
   recusada pela Shopee.

**Fase C — OAuth**
9. Gerar a URL de autorização no Render.
10. Seller autoriza.
11. Callback no Render.
12. Validar `state`.
13. Render monta `token/get` assinado.
14. Envia via gateway.
15. Shopee devolve `access_token`.
16. Só então integrar persistência (tokens, vínculo ClienteConta ↔ `shop_id`).

## 12. Checklist da próxima fase

- [ ] Confirmar tudo da seção 13 na documentação oficial
- [ ] Criar Droplet, usuário, SSH key, firewall
- [ ] Domínio/subdomínio do gateway e registro A
- [ ] Deploy do gateway + Caddy + `/health` público ok
- [ ] Gerar segredo e configurar nos dois lados (sem passar por chat/commit)
- [ ] `shopeeGatewayProbe.js` → IPv4; cadastrar na Shopee
- [ ] `SHOPEE_API_ORIGIN` + `SHOPEE_ALLOWED_PATHS` oficiais
- [ ] Fase B (positivo via gateway + negativo direto)
- [ ] Desenho de `state` + persistência de tokens + migration (fase C)

## 13. PENDENTE DE DOCUMENTAÇÃO SHOPEE

Nada abaixo foi inventado no código. Cada item precisa da fonte oficial.

| Item | Estado |
|---|---|
| Host oficial da API (produção) | PENDENTE → `SHOPEE_API_ORIGIN` |
| Host de sandbox/teste e diferenças em relação à produção | PENDENTE |
| Paths oficiais (auth, token, refresh, demais) | PENDENTE → `SHOPEE_ALLOWED_PATHS` |
| Assinatura de cada endpoint (base string, chave, parâmetros comuns) | PENDENTE (fica no Render) |
| Formato da URL de autorização (`auth_partner`) | PENDENTE |
| `token/get`: método, onde vão os parâmetros (query × corpo) | PENDENTE |
| Parâmetros que chegam no callback | PENDENTE |
| Suporte a `state` / como preservar estado no redirect | PENDENTE |
| Validade do `code` | PENDENTE |
| Allowlist de IP: onde cadastrar, quantos IPs, se vale para todas as chamadas, tempo de propagação | PENDENTE |
| Refresh: validade de `access_token`/`refresh_token`, rotação | PENDENTE |
| Limites / rate limits | PENDENTE |
| Métodos HTTP usados (hoje o gateway aceita só GET/POST) | CONFIRMAR |
| Tamanho típico das respostas (hoje teto de 1 MiB) | CONFIRMAR |
