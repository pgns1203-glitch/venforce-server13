// Grants Shopee LIVE por Conta (tabela shopee_grants).
//
// - validarContaShopee: a Conta existe, é marketplace 'shopee', está ativa e o
//   Cliente dono também. Usado antes de emitir o link e de novo no callback.
// - salvarGrantLive: numa transação, com lock por loja e FOR UPDATE na Conta,
//   recusa vincular a loja a outra Conta, recusa trocar a loja de uma Conta já
//   vinculada, cifra os tokens e faz upsert (reautorizar = atualizar a linha).
//   Só retorna depois do COMMIT: falha = exceção, nunca sucesso parcial.
// - statusGrantsLive: só metadados. As colunas *_enc nunca são lidas aqui.
const pool = require("../../config/database");
const { ensureShopeeGrantsSchema } = require("../schema/schemaEnsure");
const { cifrar } = require("./shopeeTokenCrypto");

const LOCK_NAMESPACE = "vf:shopee_grant";

class ShopeeGrantError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.name = "ShopeeGrantError";
    this.code = code;
    this.status = status;
  }

  toJSON() {
    return { name: this.name, code: this.code, message: this.message, status: this.status };
  }
}

// Mensagens fixas: podem ir para o HTML/JSON.
const ERROS = Object.freeze({
  CONTA_INVALIDA: [400, "clienteContaId inválido."],
  CONTA_NAO_ENCONTRADA: [404, "Conta não encontrada."],
  MARKETPLACE_INCORRETO: [409, "A Conta não é do marketplace Shopee."],
  CONTA_INATIVA: [409, "A Conta está inativa."],
  CLIENTE_INATIVO: [409, "O Cliente da Conta está inativo."],
  SHOPEE_ACCOUNT_MISMATCH: [409, "A loja autorizada é diferente da loja já vinculada a esta Conta."],
  SHOP_EM_OUTRA_CONTA: [409, "Esta loja Shopee já está vinculada a outra Conta."],
  PARAMETRO_INVALIDO: [400, "Dados da autorização inválidos."],
  CHAVE_CIFRA_AUSENTE: [503, "Chave de cifra dos tokens Shopee não configurada."],
});

function erro(code) {
  const [status, msg] = ERROS[code];
  return new ShopeeGrantError(code, msg, status);
}

function contaIdValido(valor) {
  const n = Number(valor);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

const SQL_CONTA = `SELECT cc.id, cc.cliente_id, cc.marketplace, cc.ativo, cc.external_account_id,
                          c.ativo AS cliente_ativo
                     FROM cliente_contas cc
                     JOIN clientes c ON c.id = cc.cliente_id
                    WHERE cc.id = $1`;

function conferirConta(conta) {
  if (!conta) throw erro("CONTA_NAO_ENCONTRADA");
  if (conta.marketplace !== "shopee") throw erro("MARKETPLACE_INCORRETO");
  if (conta.ativo === false) throw erro("CONTA_INATIVA");
  if (conta.cliente_ativo === false) throw erro("CLIENTE_INATIVO");
  return conta;
}

async function validarContaShopee(clienteContaId, db = pool) {
  const id = contaIdValido(clienteContaId);
  if (!id) throw erro("CONTA_INVALIDA");
  const r = await db.query(SQL_CONTA, [id]);
  return conferirConta(r.rows[0]);
}

async function salvarGrantLive(
  { clienteContaId, app, shopId, accessToken, refreshToken, expireIn, userId = null, shopeeRequestId = null, chaveCifra },
  { db = pool, ensureSchema = ensureShopeeGrantsSchema, now = Date.now } = {}
) {
  const contaId = contaIdValido(clienteContaId);
  if (!contaId || !Number.isSafeInteger(shopId) || shopId <= 0 || typeof accessToken !== "string" || !accessToken
    || typeof refreshToken !== "string" || !refreshToken || !(Number(expireIn) > 0) || typeof app !== "string") {
    throw erro("PARAMETRO_INVALIDO");
  }
  if (!chaveCifra) throw erro("CHAVE_CIFRA_AUSENTE");

  await ensureSchema(db);
  const ambiente = "live";
  const accessEnc = cifrar(accessToken, { ambiente, app, shopId, tipo: "access" }, chaveCifra);
  const refreshEnc = cifrar(refreshToken, { ambiente, app, shopId, tipo: "refresh" }, chaveCifra);
  const expiraEm = new Date(now() + Number(expireIn) * 1000);

  const usaPool = typeof db.connect === "function" && typeof db.release !== "function";
  const client = usaPool ? await db.connect() : db;
  try {
    await client.query("BEGIN");
    // Serializa autorizações da MESMA loja (duas Contas disputando o mesmo shop_id).
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${LOCK_NAMESPACE}:${ambiente}:${app}:${shopId}`]);
    const contaR = await client.query(`${SQL_CONTA} FOR UPDATE OF cc`, [contaId]);
    const conta = conferirConta(contaR.rows[0]);

    if (conta.external_account_id && String(conta.external_account_id) !== String(shopId)) throw erro("SHOPEE_ACCOUNT_MISMATCH");

    const outraConta = await client.query(
      "SELECT id FROM cliente_contas WHERE marketplace = 'shopee' AND external_account_id = $1 AND id <> $2 LIMIT 1",
      [String(shopId), contaId]
    );
    if (outraConta.rows.length) throw erro("SHOP_EM_OUTRA_CONTA");

    const grantsLoja = await client.query(
      "SELECT id, cliente_conta_id FROM shopee_grants WHERE ambiente = $1 AND app = $2 AND shop_id = $3",
      [ambiente, app, shopId]
    );
    if (grantsLoja.rows.some((g) => Number(g.cliente_conta_id) !== contaId)) throw erro("SHOP_EM_OUTRA_CONTA");

    const grantConta = await client.query(
      "SELECT id, shop_id FROM shopee_grants WHERE cliente_conta_id = $1 AND ambiente = $2 AND app = $3",
      [contaId, ambiente, app]
    );
    const anterior = grantConta.rows[0] || null;
    if (anterior && String(anterior.shop_id) !== String(shopId)) throw erro("SHOPEE_ACCOUNT_MISMATCH");

    const salvo = await client.query(
      `INSERT INTO shopee_grants (
         cliente_conta_id, ambiente, app, shop_id, access_token_enc, refresh_token_enc,
         access_token_expires_at, status, authorized_at, authorized_by, shopee_request_id, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', NOW(), $8, $9, NOW())
       ON CONFLICT (cliente_conta_id, ambiente, app) DO UPDATE SET
         access_token_enc = EXCLUDED.access_token_enc,
         refresh_token_enc = EXCLUDED.refresh_token_enc,
         access_token_expires_at = EXCLUDED.access_token_expires_at,
         status = 'active',
         authorized_at = NOW(),
         authorized_by = EXCLUDED.authorized_by,
         shopee_request_id = EXCLUDED.shopee_request_id,
         updated_at = NOW()
       RETURNING id, access_token_expires_at, authorized_at`,
      [contaId, ambiente, app, shopId, accessEnc, refreshEnc, expiraEm, userId, shopeeRequestId]
    );
    if (!salvo.rows.length) throw new ShopeeGrantError("GRANT_NAO_PERSISTIDO", "Grant Shopee não foi persistido.", 500);

    if (!conta.external_account_id) {
      await client.query(
        "UPDATE cliente_contas SET external_account_id = $1, updated_at = NOW() WHERE id = $2 AND external_account_id IS NULL",
        [String(shopId), contaId]
      );
    }
    await client.query("COMMIT");
    return {
      grantId: Number(salvo.rows[0].id),
      clienteContaId: contaId,
      shopId,
      accessTokenExpiresAt: salvo.rows[0].access_token_expires_at,
      reautorizacao: Boolean(anterior),
    };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) { /* conexão pode ter caído */ }
    if (err instanceof ShopeeGrantError) throw err;
    // Conflito de unicidade concorrente (outra Conta levou a loja entre o SELECT e o INSERT).
    if (err && err.code === "23505") throw erro("SHOP_EM_OUTRA_CONTA");
    // Erro de banco: só o código SQLSTATE sai daqui (nada de valores/parâmetros).
    throw new ShopeeGrantError("GRANT_NAO_PERSISTIDO", `Falha ao persistir o grant Shopee (${(err && err.code) || "erro"}).`, 500);
  } finally {
    if (usaPool && typeof client.release === "function") client.release();
  }
}

// Só metadados — as colunas *_enc não entram no SELECT.
async function statusGrantsLive({ clienteContaId = null } = {}, { db = pool, ensureSchema = ensureShopeeGrantsSchema } = {}) {
  await ensureSchema(db);
  const params = [];
  let filtro = "";
  if (clienteContaId != null) {
    const id = contaIdValido(clienteContaId);
    if (!id) throw erro("CONTA_INVALIDA");
    params.push(id);
    filtro = "AND g.cliente_conta_id = $1";
  }
  const r = await db.query(
    `SELECT g.id, g.cliente_conta_id, g.app, g.shop_id, g.status,
            (g.access_token_enc <> '') AS token_presente,
            (g.refresh_token_enc <> '') AS refresh_token_presente,
            g.access_token_expires_at, g.authorized_at, g.authorized_by, g.updated_at
       FROM shopee_grants g
      WHERE g.ambiente = 'live' ${filtro}
      ORDER BY g.authorized_at DESC`,
    params
  );
  return r.rows.map((g) => ({
    grantId: Number(g.id),
    clienteContaId: Number(g.cliente_conta_id),
    app: g.app,
    shopId: String(g.shop_id),
    status: g.status,
    tokenPresente: Boolean(g.token_presente),
    refreshTokenPresente: Boolean(g.refresh_token_presente),
    accessTokenExpiraEm: g.access_token_expires_at,
    autorizadoEm: g.authorized_at,
    autorizadoPor: g.authorized_by,
    atualizadoEm: g.updated_at,
  }));
}

module.exports = { validarContaShopee, salvarGrantLive, statusGrantsLive, ShopeeGrantError, ERROS };
