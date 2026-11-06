// Grants Shopee LIVE por Conta (tabela shopee_grants).
//
// - validarContaShopee: a Conta existe, é marketplace 'shopee', está ativa e o
//   Cliente dono também. Usado antes de emitir o link e de novo no callback.
// - salvarGrantLive: numa transação, com lock por loja e FOR UPDATE na Conta,
//   recusa vincular a loja a outra Conta, recusa trocar a loja de uma Conta já
//   vinculada, cifra os tokens e faz upsert (reautorizar = atualizar a linha).
//   Só retorna depois do COMMIT: falha = exceção, nunca sucesso parcial.
// - statusGrantsLive: só metadados. As colunas *_enc nunca são lidas aqui.
// - refreshGrantLive: troca o refresh_token por um par NOVO (a Shopee rotaciona
//   o refresh) e grava os dois cifrados. Lock por loja (o MESMO do callback),
//   sem espera: se outro refresh/reautorização da loja está em curso, recusa.
// - listarGrantsParaRefresh / listarContasShopee: seleção do worker e lista
//   operacional das Contas Shopee (só metadados).
const pool = require("../../config/database");
const { ensureShopeeGrantsSchema } = require("../schema/schemaEnsure");
const { cifrar, decifrar } = require("./shopeeTokenCrypto");

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
  GRANT_NAO_ENCONTRADO: [404, "Esta Conta não tem grant Shopee LIVE."],
  GRANT_INATIVO: [409, "O grant Shopee desta Conta não está ativo. Autorize a loja de novo."],
  REFRESH_EM_ANDAMENTO: [409, "Já existe um refresh ou uma autorização desta loja em andamento. Tente em instantes."],
  TOKEN_ILEGIVEL: [500, "O refresh_token gravado não pôde ser decifrado (chave de cifra trocada?). Autorize a loja de novo."],
  REFRESH_FALHOU: [502, "A Shopee recusou ou não respondeu o refresh. Os tokens anteriores foram mantidos."],
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
                          cc.nome AS conta_nome, c.nome AS cliente_nome, c.ativo AS cliente_ativo
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
         last_refresh_error = NULL,
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

// Margem do "perto de expirar" (status) e do worker: 30 min.
const MARGEM_REFRESH_MS = 30 * 60 * 1000;

// Só metadados — as colunas *_enc não entram no SELECT.
async function statusGrantsLive(
  { clienteContaId = null } = {},
  { db = pool, ensureSchema = ensureShopeeGrantsSchema, now = Date.now, margemMs = MARGEM_REFRESH_MS } = {}
) {
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
            g.access_token_expires_at, g.authorized_at, g.authorized_by, g.updated_at,
            g.last_refresh_at, g.last_refresh_request_id, g.last_refresh_attempt_at, g.last_refresh_error,
            cc.nome AS conta_nome, c.nome AS cliente_nome
       FROM shopee_grants g
       LEFT JOIN cliente_contas cc ON cc.id = g.cliente_conta_id
       LEFT JOIN clientes c ON c.id = cc.cliente_id
      WHERE g.ambiente = 'live' ${filtro}
      ORDER BY g.authorized_at DESC`,
    params
  );
  const agora = now();
  return r.rows.map((g) => {
    const expira = g.access_token_expires_at ? new Date(g.access_token_expires_at).getTime() : null;
    return {
      grantId: Number(g.id),
      clienteContaId: Number(g.cliente_conta_id),
      cliente: g.cliente_nome || null,
      conta: g.conta_nome || null,
      app: g.app,
      shopId: String(g.shop_id),
      status: g.status,
      ativo: g.status === "active",
      tokenPresente: Boolean(g.token_presente),
      refreshTokenPresente: Boolean(g.refresh_token_presente),
      accessTokenExpiraEm: g.access_token_expires_at,
      expirado: expira !== null && expira <= agora,
      pertoDeExpirar: expira !== null && expira <= agora + margemMs,
      ultimoRefreshEm: g.last_refresh_at || null,
      ultimoRefreshRequestId: g.last_refresh_request_id || null,
      ultimaTentativaRefreshEm: g.last_refresh_attempt_at || null,
      ultimoErroRefresh: g.last_refresh_error || null,
      autorizadoEm: g.authorized_at,
      autorizadoPor: g.authorized_by,
      atualizadoEm: g.updated_at,
    };
  });
}

function chaveLockLoja(ambiente, app, shopId) {
  return `${LOCK_NAMESPACE}:${ambiente}:${app}:${shopId}`;
}

// Código curto e seguro da falha, para last_refresh_error (nunca mensagem livre).
function codigoFalha(err) {
  const base = err && typeof err.code === "string" ? err.code.replace(/^SHOPEE_TEST_/, "SHOPEE_") : "ERRO_INTERNO";
  const extra = err && typeof err.shopeeError === "string" ? `:${err.shopeeError}` : "";
  return `${base}${extra}`.replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 80) || "ERRO_INTERNO";
}

// Refresh de UM grant LIVE. Fluxo, tudo numa transação de conexão dedicada:
//   BEGIN → lock da loja SEM espera (o mesmo do callback) → relê o grant
//   FOR UPDATE → [opcional] desiste se outro processo já renovou → decifra o
//   refresh_token → access_token/get pelo gateway → cifra o par NOVO →
//   UPDATE condicionado ao refresh_token lido → COMMIT.
// Falha da Shopee: os tokens não são tocados; só last_refresh_attempt_at /
// last_refresh_error são gravados (e o erro sobe como REFRESH_FALHOU).
// `last_refresh_at` e os tokens novos só existem depois do COMMIT.
// `seExpiraAntesDe` (worker): só renova se o access_token ainda expira antes
// desse instante — outra instância pode ter renovado entre a seleção e o lock.
async function refreshGrantLive(
  { clienteContaId, app = "marketing", seExpiraAntesDe = null },
  { config, refresh, db = pool, ensureSchema = ensureShopeeGrantsSchema, now = Date.now, logger = console } = {}
) {
  const contaId = contaIdValido(clienteContaId);
  if (!contaId) throw erro("CONTA_INVALIDA");
  if (!config || !config.chaveCifra) throw erro("CHAVE_CIFRA_AUSENTE");
  if (typeof refresh !== "function") throw new TypeError("refresh obrigatório");
  await ensureSchema(db);
  const ambiente = "live";

  const usaPool = typeof db.connect === "function" && typeof db.release !== "function";
  const client = usaPool ? await db.connect() : db;
  let emTransacao = false;
  try {
    await client.query("BEGIN");
    emTransacao = true;
    // A transação fica aberta durante a chamada à Shopee (o lock tem que cobrir
    // ler→rotacionar→gravar). Teto: se o processo travar, o PG derruba a sessão.
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '60s'");
    await client.query("SET LOCAL lock_timeout = '5s'");

    const g0 = await client.query(
      "SELECT id, shop_id, status FROM shopee_grants WHERE cliente_conta_id = $1 AND ambiente = $2 AND app = $3",
      [contaId, ambiente, app]
    );
    if (!g0.rows.length) throw erro("GRANT_NAO_ENCONTRADO");
    const shopId = Number(g0.rows[0].shop_id);
    const lock = await client.query("SELECT pg_try_advisory_xact_lock(hashtext($1)) AS ok", [chaveLockLoja(ambiente, app, shopId)]);
    if (!lock.rows[0] || lock.rows[0].ok !== true) throw erro("REFRESH_EM_ANDAMENTO");

    const g = (await client.query(
      `SELECT id, cliente_conta_id, shop_id, status, refresh_token_enc, access_token_expires_at
         FROM shopee_grants WHERE id = $1 FOR UPDATE`,
      [g0.rows[0].id]
    )).rows[0];
    if (!g || Number(g.shop_id) !== shopId || Number(g.cliente_conta_id) !== contaId) throw erro("GRANT_NAO_ENCONTRADO");
    if (g.status !== "active") throw erro("GRANT_INATIVO");
    if (seExpiraAntesDe && new Date(g.access_token_expires_at).getTime() > new Date(seExpiraAntesDe).getTime()) {
      await client.query("ROLLBACK");
      emTransacao = false;
      return { pulado: true, grantId: Number(g.id), clienteContaId: contaId, shopId, accessTokenExpiresAt: g.access_token_expires_at };
    }

    let refreshAtual;
    try {
      refreshAtual = decifrar(g.refresh_token_enc, { ambiente, app, shopId, tipo: "refresh" }, config.chaveCifra);
    } catch (_) {
      const e = erro("TOKEN_ILEGIVEL");
      await registrarFalha(client, g.id, e.code);
      await client.query("COMMIT");
      emTransacao = false;
      throw e;
    }

    let novo;
    try {
      novo = await refresh(config, { refreshToken: refreshAtual, shopId });
    } catch (err) {
      const codigo = codigoFalha(err);
      await registrarFalha(client, g.id, codigo);
      await client.query("COMMIT");
      emTransacao = false;
      const e = erro("REFRESH_FALHOU");
      e.detalhe = {
        code: codigo,
        upstreamStatus: err && Number.isInteger(err.upstreamStatus) ? err.upstreamStatus : null,
        shopeeError: (err && err.shopeeError) || null,
        shopeeRequestId: (err && err.shopeeRequestId) || null,
        diagnostico: (err && err.diagnostico) || null,
      };
      throw e;
    }
    if (!novo || typeof novo.accessToken !== "string" || !novo.accessToken || typeof novo.refreshToken !== "string"
      || !novo.refreshToken || !(Number(novo.expireIn) > 0)) {
      await registrarFalha(client, g.id, "RESPOSTA_INVALIDA");
      await client.query("COMMIT");
      emTransacao = false;
      throw erro("REFRESH_FALHOU");
    }

    const accessEnc = cifrar(novo.accessToken, { ambiente, app, shopId, tipo: "access" }, config.chaveCifra);
    const refreshEnc = cifrar(novo.refreshToken, { ambiente, app, shopId, tipo: "refresh" }, config.chaveCifra);
    const expiraEm = new Date(now() + Number(novo.expireIn) * 1000);
    const salvo = await client.query(
      `UPDATE shopee_grants SET
         access_token_enc = $2, refresh_token_enc = $3, access_token_expires_at = $4,
         last_refresh_at = NOW(), last_refresh_attempt_at = NOW(), last_refresh_request_id = $5,
         last_refresh_error = NULL, updated_at = NOW()
       WHERE id = $1 AND refresh_token_enc = $6 AND status = 'active'
       RETURNING access_token_expires_at, last_refresh_at`,
      [g.id, accessEnc, refreshEnc, expiraEm, novo.shopeeRequestId || null, g.refresh_token_enc]
    );
    if (salvo.rowCount !== 1) throw new ShopeeGrantError("GRANT_NAO_PERSISTIDO", "Refresh Shopee não foi persistido.", 500);
    await client.query("COMMIT");
    emTransacao = false;
    return {
      grantId: Number(g.id),
      clienteContaId: contaId,
      shopId,
      accessTokenExpiresAt: salvo.rows[0].access_token_expires_at,
      refreshedAt: salvo.rows[0].last_refresh_at,
      shopeeRequestId: novo.shopeeRequestId || null,
    };
  } catch (err) {
    if (emTransacao) {
      try { await client.query("ROLLBACK"); } catch (_) { /* conexão pode ter caído */ }
    }
    if (err instanceof ShopeeGrantError) {
      // A Shopee já rotacionou, mas o par novo não foi gravado: o refresh_token
      // gravado pode não valer mais. Só o código sai no log.
      if (err.code === "GRANT_NAO_PERSISTIDO") {
        logger.error(`[Shopee refresh] par novo NÃO gravado (conta=${contaId}); se o próximo refresh falhar, reautorize a loja`);
      }
      throw err;
    }
    if (err && err.code === "55P03") throw erro("REFRESH_EM_ANDAMENTO");
    throw new ShopeeGrantError("GRANT_NAO_PERSISTIDO", `Falha ao renovar o grant Shopee (${(err && err.code) || "erro"}).`, 500);
  } finally {
    if (usaPool && typeof client.release === "function") client.release();
  }
}

async function registrarFalha(client, grantId, codigo) {
  await client.query(
    "UPDATE shopee_grants SET last_refresh_attempt_at = NOW(), last_refresh_error = $2 WHERE id = $1",
    [grantId, String(codigo).slice(0, 80)]
  );
}

// Grants ativos que precisam de refresh: access_token expira em até `margemMs`
// (inclui os já expirados — o refresh_token segue válido por mais tempo) e,
// depois de uma falha, só de novo após `esperaAposFalhaMs`.
async function listarGrantsParaRefresh(
  { app = "marketing", margemMs = MARGEM_REFRESH_MS, esperaAposFalhaMs = 15 * 60 * 1000, limite = 20 } = {},
  { db = pool, ensureSchema = ensureShopeeGrantsSchema } = {}
) {
  await ensureSchema(db);
  const r = await db.query(
    `SELECT id, cliente_conta_id, shop_id, access_token_expires_at
       FROM shopee_grants
      WHERE ambiente = 'live' AND app = $1 AND status = 'active'
        AND access_token_expires_at <= NOW() + ($2::double precision * INTERVAL '1 millisecond')
        AND (last_refresh_error IS NULL OR last_refresh_attempt_at IS NULL
             OR last_refresh_attempt_at <= NOW() - ($3::double precision * INTERVAL '1 millisecond'))
      ORDER BY access_token_expires_at ASC
      LIMIT $4`,
    [app, margemMs, esperaAposFalhaMs, limite]
  );
  return r.rows.map((g) => ({
    grantId: Number(g.id),
    clienteContaId: Number(g.cliente_conta_id),
    shopId: Number(g.shop_id),
    accessTokenExpiresAt: g.access_token_expires_at,
  }));
}

// Contas Shopee (para achar o clienteContaId e ver quem já autorizou). Sem token.
async function listarContasShopee(
  { app = "marketing", busca = "" } = {},
  { db = pool, ensureSchema = ensureShopeeGrantsSchema } = {}
) {
  await ensureSchema(db);
  const termo = String(busca || "").trim().slice(0, 80);
  const r = await db.query(
    `SELECT cc.id, cc.nome AS conta_nome, cc.ativo, cc.external_account_id,
            c.id AS cliente_id, c.nome AS cliente_nome, c.ativo AS cliente_ativo,
            g.shop_id, g.status AS grant_status, g.access_token_expires_at, g.last_refresh_at, g.last_refresh_error
       FROM cliente_contas cc
       JOIN clientes c ON c.id = cc.cliente_id
       LEFT JOIN shopee_grants g ON g.cliente_conta_id = cc.id AND g.ambiente = 'live' AND g.app = $1
      WHERE cc.marketplace = 'shopee'
        AND ($2 = '' OR c.nome ILIKE '%' || $2 || '%' OR cc.nome ILIKE '%' || $2 || '%')
      ORDER BY c.nome, cc.id`,
    [app, termo]
  );
  return r.rows.map((x) => ({
    clienteContaId: Number(x.id),
    cliente: x.cliente_nome,
    clienteId: Number(x.cliente_id),
    conta: x.conta_nome,
    lojaVinculada: x.external_account_id ? String(x.external_account_id) : null,
    podeGerarLink: x.ativo !== false && x.cliente_ativo !== false,
    contaAtiva: x.ativo !== false,
    clienteAtivo: x.cliente_ativo !== false,
    grant: x.grant_status ? {
      status: x.grant_status,
      shopId: String(x.shop_id),
      accessTokenExpiraEm: x.access_token_expires_at,
      ultimoRefreshEm: x.last_refresh_at || null,
      ultimoErroRefresh: x.last_refresh_error || null,
    } : null,
  }));
}

module.exports = {
  validarContaShopee,
  salvarGrantLive,
  statusGrantsLive,
  refreshGrantLive,
  listarGrantsParaRefresh,
  listarContasShopee,
  MARGEM_REFRESH_MS,
  ShopeeGrantError,
  ERROS,
};
