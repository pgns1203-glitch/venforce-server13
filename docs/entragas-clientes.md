# Entregas Cliente

Resumo das rotas e persistencia de `entregas_cliente`.

## 1. GET `/entregas-cliente`

O endpoint existe em `server/routes/entregasClienteRoutes.js`:

```js
router.get("/entregas-cliente", authMiddleware, requireAutomacoesAccess, listarEntregasController);
```

Controller em `server/controllers/entregasClienteController.js`:

```js
async function listarEntregasController(req, res) {
  try {
    const resultado = await listarEntregas({ query: req.query });
    return res.json({ ok: true, entregas: resultado.entregas, total: resultado.total });
  } catch (err) {
    return responderErro(res, err);
  }
}
```

Hoje o filtro por cliente aceita os parametros em snake_case:

- `cliente_slug`
- `cliente_id`

Nao ha suporte direto para `clienteSlug` ou `clienteId`.

Trecho do service em `server/services/entregasClienteService.js`:

```js
const clienteSlug = query?.cliente_slug ? normalizarSlug(query.cliente_slug) : "";
const clienteIdRaw = query?.cliente_id;
const clienteIdParsed =
  clienteIdRaw === null || clienteIdRaw === undefined || String(clienteIdRaw).trim() === ""
    ? null
    : parseInt(clienteIdRaw, 10);
const clienteId = Number.isFinite(clienteIdParsed) ? clienteIdParsed : null;

if (clienteId !== null) {
  params.push(clienteId);
  where.push(`cliente_id = $${params.length}`);
} else if (clienteSlug) {
  params.push(clienteSlug);
  where.push(`cliente_slug = $${params.length}`);
}
```

## 2. Tabela `entregas_cliente`

A tabela e criada em `server/index.js`:

```sql
CREATE TABLE IF NOT EXISTS entregas_cliente (
  id SERIAL PRIMARY KEY,
  tipo VARCHAR(50) NOT NULL,
  cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
  cliente_slug VARCHAR(255),
  cliente_nome VARCHAR(255),
  titulo VARCHAR(255) NOT NULL,
  periodo VARCHAR(100),
  status VARCHAR(30) DEFAULT 'rascunho',
  token_publico VARCHAR(120) UNIQUE,
  publicado BOOLEAN DEFAULT FALSE,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  origem_tipo VARCHAR(50),
  origem_id INTEGER,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  published_at TIMESTAMP,
  expires_at TIMESTAMP
);
```

Colunas relevantes para cliente:

- `cliente_id`
- `cliente_slug`
- `cliente_nome`

Indices criados:

```sql
CREATE INDEX IF NOT EXISTS idx_entregas_cliente_cliente_id ON entregas_cliente(cliente_id);
CREATE INDEX IF NOT EXISTS idx_entregas_cliente_token_publico ON entregas_cliente(token_publico);
CREATE INDEX IF NOT EXISTS idx_entregas_cliente_tipo ON entregas_cliente(tipo);
CREATE INDEX IF NOT EXISTS idx_entregas_cliente_created_at ON entregas_cliente(created_at);
```

## 3. POST `/entregas-cliente`

Rota em `server/routes/entregasClienteRoutes.js`:

```js
router.post("/entregas-cliente", authMiddleware, requireAutomacoesAccess, criarEntregaController);
```

Controller em `server/controllers/entregasClienteController.js`:

```js
async function criarEntregaController(req, res) {
  try {
    const resultado = await criarEntrega({ userId: req.user?.id, body: req.body });
    return res.status(201).json({ ok: true, entrega: resultado.entrega });
  } catch (err) {
    return responderErro(res, err);
  }
}
```

Campos lidos do body no service:

```js
const tipo = validarTipo(body?.tipo);
const titulo = validarTitulo(body?.titulo);
const periodoRaw = body?.periodo;
const statusRaw = String(body?.status || "").trim().toLowerCase();
const origemTipoRaw = body?.origem_tipo;
const origemIdRaw = body?.origem_id;
const expiresAt = parseTimestampOrNull(body?.expires_at);

const cliente = await buscarClientePorSlugOuId({
  clienteIdRaw: body?.cliente_id,
  clienteSlugRaw: body?.cliente_slug,
});
```

Resolucao dos dados de cliente:

```js
const cliente_id = cliente ? cliente.id : null;
const cliente_slug = cliente ? cliente.slug : (body?.cliente_slug ? normalizarSlug(body.cliente_slug) : null);
const cliente_nome = cliente ? cliente.nome : (body?.cliente_nome ? String(body.cliente_nome).trim() : null);
```

Payload padrao quando `payload_json` nao vem ou vem vazio:

```js
const payload_json = payloadVazio
  ? buildPayloadPadrao({
      tipo,
      titulo,
      periodo,
      cliente: cliente
        ? { id: cliente.id, slug: cliente.slug, nome: cliente.nome }
        : cliente_slug || cliente_nome
          ? { id: cliente_id, slug: cliente_slug, nome: cliente_nome }
          : null,
    })
  : payloadInput;
```

INSERT executado:

```js
`INSERT INTO entregas_cliente
  (tipo, cliente_id, cliente_slug, cliente_nome, titulo, periodo,
   status, publicado, payload_json, origem_tipo, origem_id, created_by, expires_at)
 VALUES
  ($1,$2,$3,$4,$5,$6,$7,false,$8,$9,$10,$11,$12)
 RETURNING
  id, tipo, cliente_id, cliente_slug, cliente_nome, titulo, periodo, status,
  token_publico, publicado, payload_json, origem_tipo, origem_id,
  created_by, created_at, updated_at, published_at, expires_at`
```

Valores enviados ao banco:

```js
[
  tipo,
  cliente_id,
  cliente_slug,
  cliente_nome,
  titulo,
  periodo,
  status,
  payload_json,
  origemTipo,
  origemId,
  userId || null,
  expiresAt,
]
```
