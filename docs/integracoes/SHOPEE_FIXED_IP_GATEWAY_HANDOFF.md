# Handoff — Gateway Shopee com IPv4 fixo (fase 1)

Data: 2026-10-20 · Repo: `venforcecompany-sudo/venforce-server`
Branch: `feat/shopee-fixed-ip-gateway` (de `origin/main` 54c8902), **local, sem push/PR/merge/deploy**.
Worktree: `C:\Users\vicap\orca\workspaces\venforce-server\dorado` (worktree do orca; estava limpo e igual a `origin/main`, então a branch foi criada nele em vez de abrir um segundo worktree).
Documento técnico completo: [`SHOPEE_FIXED_IP_GATEWAY.md`](SHOPEE_FIXED_IP_GATEWAY.md).

## 1. Arquitetura adotada

```
Portal ─► Backend VenForce (Render) ──HTTPS + HMAC──► Gateway (VPS DigitalOcean) ──IPv4 fixo──► Shopee API
```

- O **Render** fica com tudo que é negócio e segredo Shopee: OAuth, `state`, callback
  (`GET /shopee/callback`, que continua só uma casca), `partner_id`/`partner_key`,
  assinatura Shopee, tokens, Cliente/ClienteConta, banco e retry.
- O **gateway** é só a saída de rede: autentica o Render por HMAC, aplica a allowlist
  de path/método, força IPv4 e repassa. Não guarda `partner_key`, token nem estado
  (fora a cache de nonce em memória). Não recebe callback.
- IP de saída = **IPv4 público do próprio Droplet**. O Reserved IP fica como evolução
  futura (não presumir que ele vira IP de saída).

## 2. O que foi implementado

**`shopee-gateway/`**: pacote isolado, Node ≥ 20, **zero dependências**.
- `GET /health`: sem auth, de propósito, para monitor externo; responde só `{"ok":true}`.
- `GET /probe/ip` (HMAC): consulta `IP_PROBE_URL` (padrão `https://api.ipify.org`) forçando IPv4, valida com `net.isIPv4` e devolve `{ok, ipv4}`.
- `POST /forward` (HMAC): recebe o envelope fechado `{method, path, query?, body?}` e chama `SHOPEE_API_ORIGIN + path`.

**Render** (`server/`). Não está ligado a nenhuma rota:
- `services/shopee/shopeeGatewayClient.js`: `probeIp()` e `forward()`, assinatura HMAC, timeout, `redirect:"error"`, erros normalizados.
- `services/shopee/shopeeGatewayConfig.js` e `shopeeGatewayError.js`.
- `scripts/shopeeGatewayProbe.js`: smoke CLI Render → gateway → `/probe/ip` (imprime `Gateway reachable` / `Outbound IPv4: x.x.x.x`).
- `.env.example`: placeholders `SHOPEE_GATEWAY_URL`, `SHOPEE_GATEWAY_SECRET` e `SHOPEE_GATEWAY_TIMEOUT_MS`.

**Deploy (só arquivos de exemplo)**: `deploy/shopee-gateway.service.example` (systemd endurecido), `deploy/Caddyfile.example` e `deploy/gateway.env.example`. Nenhum domínio, IP ou segredo real.

## 3. Decisões de segurança

| Tema | Decisão |
|---|---|
| Autenticação | `X-VF-Timestamp` / `X-VF-Nonce` / `X-VF-Signature`. `canonical = METHOD\nPATH\nTIMESTAMP\nNONCE\nhex(SHA256(corpo cru))`, `HMAC-SHA256`, hex. METHOD/PATH são os da requisição **ao gateway**. Comparação com `timingSafeEqual` |
| Replay | janela de ±60 s nos dois sentidos + nonce obrigatório; cache em memória com TTL de 2× a janela e teto de `MAX_NONCES`; cache cheia = falha fechada (503). O nonce só é gravado depois da assinatura válida. **Vale para 1 instância**: com várias, precisa de armazenamento compartilhado |
| SSRF / open proxy | host vem só da config; path tem que bater **exatamente** com a allowlist e passar pela regex de segmento seguro (sem `.`, `%`, `\`, `//`, `?`, `#`, `@`); o envelope recusa `url`/`host`/`headers`/campo extra; a URL composta é conferida de novo |
| Métodos | só `GET` e `POST`. Incluir outro é mudança de código, não de env |
| Headers | nada do chamador é repassado. A saída usa só `accept`, `user-agent`, `content-type`, `content-length` (+ `host`/`connection` do Node). O segredo e os `X-VF-*` nunca saem |
| IPv4 | `family: 4`, `lookup` só registro A, `autoSelectFamily: false`, valendo para a Shopee e para o probe |
| Redirect | nunca seguido. 3xx vira `UPSTREAM_REDIRECT`, sem expor `Location` |
| Timeout | `AbortController` cobre DNS + conexão + resposta + corpo (padrão 10 s no gateway, 15 s no client). **Sem retry** |
| Limites | corpo de 64 KiB (o Caddy corta em 128 KB antes), resposta de 1 MiB, query de 4096 bytes / 50 chaves, headers de 8 KiB / 64, `headersTimeout` / `requestTimeout`, `MAX_INFLIGHT` = 32 |
| Logs | JSON com `request_id`, método, rota conhecida, path já aprovado (sem query), status, duração e `error_code`. Nunca query, corpo, `code`, token, assinatura ou segredo |
| Erros | códigos estáveis, mensagem genérica, sem stack. Em 4xx/5xx o corpo da Shopee volta ao Render (ele precisa do código de erro), mas no client fica em `upstreamBody` não enumerável, ou seja, fora de JSON e de log |
| Rede | o Node escuta em `127.0.0.1`; só o Caddy expõe a 443; SSH só do IP administrativo. O firewall **não substitui** o HMAC. As faixas de saída do Render só entram depois de confirmadas no painel |
| Config | o gateway não sobe sem `GATEWAY_SHARED_SECRET` (≥ 32 caracteres). Sem `SHOPEE_API_ORIGIN`, `/forward` responde `CONFIG_MISSING`, mas `/probe/ip` funciona: dá para fazer a fase A antes do host oficial. Em produção só https |

## 4. Estrutura de arquivos criada

```
shopee-gateway/
  package.json  .env.example  README.md
  src/{server,config,auth,forwarder,errors}.js
  test/gateway.test.js
  scripts/gen-secret.js
  deploy/{shopee-gateway.service.example,Caddyfile.example,gateway.env.example}
server/services/shopee/{shopeeGatewayClient,shopeeGatewayConfig,shopeeGatewayError}.js
server/scripts/shopeeGatewayProbe.js
server/tests/shopeeGatewayClient.test.js
docs/integracoes/SHOPEE_FIXED_IP_GATEWAY.md
docs/integracoes/SHOPEE_FIXED_IP_GATEWAY_HANDOFF.md   (este arquivo)
.env.example   (+ bloco do gateway; único arquivo pré-existente alterado)
```

Não foram tocados (conferido com `git diff origin/main --name-only`): `server/routes/shopeeRoutes.js`, `server/controllers/shopeeController.js`, `server/services/matrizApi/`, as rotas/controller da matriz, `server/index.js`, `Portal/` e `frontend-react/` (Shell V3, vf-context, Carteira, Squads).

## 5. Variáveis de ambiente

**Gateway**: `GATEWAY_SHARED_SECRET` (obrigatória), `SHOPEE_API_ORIGIN` (PENDENTE), `SHOPEE_ALLOWED_PATHS` (PENDENTE; lista exata separada por vírgula), `HOST`=127.0.0.1, `PORT`=8787, `IP_PROBE_URL`, `UPSTREAM_TIMEOUT_MS`=10000, `AUTH_WINDOW_SECONDS`=60, `MAX_BODY_BYTES`, `MAX_RESPONSE_BYTES`, `MAX_QUERY_LENGTH`, `MAX_NONCES`, `MAX_INFLIGHT` e `NODE_ENV`.

**Render**: `SHOPEE_GATEWAY_URL`, `SHOPEE_GATEWAY_SECRET` (mesmo valor de `GATEWAY_SHARED_SECRET`) e `SHOPEE_GATEWAY_TIMEOUT_MS`=15000. Todas opcionais: sem elas o servidor sobe e o client fica "não configurado".

Nenhum valor real em nenhum arquivo.

## 6. Testes executados

| Suíte | Resultado |
|---|---|
| `shopee-gateway`: `npm test` (`node --test`) | **33/33 passando**. Cobre os 21 itens obrigatórios + probe/ip, IPv4, config, query, 404, CONFIG_MISSING e rede |
| `server/tests/shopeeGatewayClient.test.js` | **passando**. Canonicalização, SHA256, HMAC, nonce, timestamp, request, erros do gateway, 4xx com `upstreamBody` oculto, redirect, rede, timeout, envelope inválido e **contrato com o gateway real** (subido em 127.0.0.1) |
| `server/tests/matrizApiClient.test.js`, `integracoesMatrizRoutes.test.js` | passando (a integração da matriz segue intacta) |
| Backend completo, arquivo por arquivo (`server/tests/*.test.js`) | **350 passando, 5 falhando**: `basesTiktok`, `designStudioWorkspace`, `designTemplateEngine`, `mlTokenService`, `painelContasModoManual`. **Os 5 falham igual num worktree limpo de `origin/main`**: são pré-existentes e não têm relação com esta branch (nenhum importa os arquivos novos) |
| Smoke manual | gateway real + serviço de IP fake local → `shopeeGatewayProbe.js` imprimiu `Gateway reachable` / `Outbound IPv4: 192.0.2.55`; com segredo errado, `AUTH_INVALID (HTTP 401)`, exit 1; o log do gateway não continha o segredo |

Nada foi chamado na Shopee, na DigitalOcean ou em serviço de IP real.

## 7. Commits locais

| SHA | Mensagem |
|---|---|
| `78d2e13` | feat: add hardened Shopee fixed-IP gateway |
| `d2b4406` | feat: add Render gateway client and smoke probe |
| `50d37f4` | docs: document Shopee gateway deployment and OAuth test plan |
| (este) | docs: add Shopee gateway handoff |

## 8. Pendente de propósito (fora desta fase)

`auth_partner`, `token/get` e refresh reais; qualquer chamada real à Shopee; armazenamento de tokens; migration; vínculo ClienteConta ↔ `shop_id`; persistência de `state`; UI / botão "Conectar Shopee"; ligar o client a alguma rota; mudanças no callback; webhooks, pedidos, produtos, estoque, financeiro, promoções; deploy; env real no Render; API da DigitalOcean; DNS real.

**PENDENTE DE DOCUMENTAÇÃO SHOPEE** (nada disso foi inventado): host oficial (produção e sandbox), paths oficiais, assinatura de cada endpoint, formato do `auth_partner`, `token/get` (método e onde vão os parâmetros), parâmetros do callback, suporte a `state`, validade do `code`, regras da allowlist de IP, validade/rotação dos tokens, rate limits, métodos HTTP usados e tamanho típico das respostas.

## 9. Próximos passos (teste real)

**Fase A — rede**
1. Criar o Droplet (Ubuntu LTS, SSH key, usuário não-root).
2. Configurar o firewall: 443 aberto, 80 para ACME, 22 só do IP administrativo; porta do Node fechada.
3. Instalar Node ≥ 20 (NodeSource ou nodejs.org) e copiar `shopee-gateway/` para `/opt/shopee-gateway/releases/<sha>` com o symlink `current`.
4. Criar `/etc/shopee-gateway/gateway.env` (0640) com um segredo gerado na hora e ligar o systemd.
5. Criar o registro DNS A do subdomínio → IPv4 do Droplet (sem AAAA), esperar propagar, depois Caddy (`caddy validate` antes do reload).
6. Rodar `node server/scripts/shopeeGatewayProbe.js` com as ENV do gateway e conferir com `curl -4 https://api.ipify.org` no Droplet.
7. Cadastrar o IPv4 na allowlist da Shopee.

**Fase B — controle**
8. Preencher `SHOPEE_API_ORIGIN` e `SHOPEE_ALLOWED_PATHS` com os valores oficiais.
9. Fazer uma chamada que dependa da allowlist, via gateway.
10. Fazer o controle negativo: a mesma chamada direto do Render deve ser recusada.

**Fase C — OAuth**
11. Gerar a URL de autorização no Render.
12. O seller autoriza; o callback cai no Render, que valida o `state` (spec na seção 10 do doc técnico: 32 bytes, TTL de ~10 min, uso único, ligado a usuário + ClienteConta).
13. Montar o `token/get` assinado no Render e enviar via `shopeeGatewayClient.forward()`.
14. Receber o `access_token`. Só então desenhar a persistência e a migration.

## 10. Bloqueadores e dúvidas abertas

- **Nenhum bloqueador** para esta fase.
- Dúvidas para a próxima fase:
  - Se a Shopee aceita `state` ou se o estado vai embutido no redirect.
  - Quantos IPs a allowlist aceita e se ela vale para todas as chamadas.
  - Se `token/get` exige parâmetros no corpo: o gateway serializa o `body` com `JSON.stringify`, o que basta enquanto a assinatura Shopee não cobrir os bytes do corpo (CONFIRMAR).
- Dívidas conhecidas da v1:
  - Cache de nonce por instância.
  - Rotação de segredo sem janela dupla (há uma breve indisponibilidade durante a troca).
  - A sintaxe do filtro de log do `Caddyfile.example` precisa de `caddy validate` na versão instalada.
- Ambiente: `server/node_modules` foi instalado neste worktree (`npm ci`) para rodar os testes; ele é ignorado pelo git.
