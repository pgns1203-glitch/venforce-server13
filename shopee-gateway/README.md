# shopee-gateway

Saída de rede com **IPv4 fixo** entre o backend VenForce (Render) e a API Shopee.
Não guarda `partner_key`, tokens nem regra de negócio: só autentica o Render
(HMAC), aplica uma allowlist de paths e repassa a chamada.

Zero dependências (Node ≥ 20, só módulos nativos). Documentação completa,
modelo de ameaça e plano de teste real: [`docs/integracoes/SHOPEE_FIXED_IP_GATEWAY.md`](../docs/integracoes/SHOPEE_FIXED_IP_GATEWAY.md).

## Rotas

| Rota | Auth | O que faz |
|---|---|---|
| `GET /health` | nenhuma | `{"ok":true}` — só "processo vivo", para monitor externo |
| `GET /probe/ip` | HMAC | pergunta a `IP_PROBE_URL` (forçando IPv4) e devolve `{"ok":true,"ipv4":"x.x.x.x"}` |
| `POST /forward` | HMAC | envelope `{method, path, query?, body?}` → `SHOPEE_API_ORIGIN + path` |

`/forward` **não é proxy genérico**: o host vem só de `SHOPEE_API_ORIGIN`, o
`path` precisa estar *exatamente* em `SHOPEE_ALLOWED_PATHS`, métodos só
`GET`/`POST`, e o envelope não aceita `url`, `host`, `headers` nem campo extra.

## Rodar localmente

```bash
cd shopee-gateway
export GATEWAY_SHARED_SECRET="$(node scripts/gen-secret.js)"
# opcional: SHOPEE_API_ORIGIN / SHOPEE_ALLOWED_PATHS (PENDENTE: valores oficiais)
npm start            # escuta em 127.0.0.1:8787
curl -s http://127.0.0.1:8787/health
```

Do lado do Render (em outro terminal, com o mesmo segredo):

```bash
cd server
SHOPEE_GATEWAY_URL=http://127.0.0.1:8787 SHOPEE_GATEWAY_SECRET="$GATEWAY_SHARED_SECRET" \
  node scripts/shopeeGatewayProbe.js
# Gateway reachable
# Outbound IPv4: x.x.x.x
```

## Testes

```bash
npm test             # node --test, servidores HTTP locais, sem rede externa
```

## Deploy

Exemplos em `deploy/` (systemd, Caddy, env). Nenhum domínio, IP ou segredo real.
Passo a passo no documento acima.
