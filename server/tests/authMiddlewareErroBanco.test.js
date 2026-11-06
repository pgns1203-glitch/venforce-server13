// Falha de infraestrutura na validação de sessão NÃO pode virar 401.
// 401 faz o portal limpar o login e perder o formulário em andamento.
const assert = require("assert");
const jwt = require("jsonwebtoken");

const pool = require("../config/database");
const { getJwtSecret } = require("../config/jwtSecret");
const { authMiddleware } = require("../middlewares/authMiddleware");

function responseStub() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function run(authorization) {
  return new Promise((resolve) => {
    const res = responseStub();
    const req = { headers: authorization ? { authorization } : {} };
    let nextCalled = false;
    authMiddleware(req, res, () => { nextCalled = true; resolve({ res, req, nextCalled }); })
      .then(() => { if (!nextCalled) resolve({ res, req, nextCalled }); });
  });
}

const tokenValido = jwt.sign({ id: 7 }, getJwtSecret(), { expiresIn: "5m" });
const originalQuery = pool.query;

(async () => {
  // 1) Sem token → 401 (sessão de fato ausente).
  {
    const { res, nextCalled } = await run(null);
    assert.strictEqual(nextCalled, false);
    assert.strictEqual(res.statusCode, 401);
  }

  // 2) Token forjado/expirado → 401.
  {
    const { res, nextCalled } = await run("Bearer token.invalido.aqui");
    assert.strictEqual(nextCalled, false);
    assert.strictEqual(res.statusCode, 401);
  }

  // 3) Token válido, usuário inexistente → 401.
  {
    pool.query = async () => ({ rows: [] });
    const { res, nextCalled } = await run(`Bearer ${tokenValido}`);
    assert.strictEqual(nextCalled, false);
    assert.strictEqual(res.statusCode, 401);
  }

  // 4) Token válido, banco falhando (pool esgotado/timeout) → 503, NUNCA 401.
  {
    pool.query = async () => { throw new Error("timeout acquiring connection from pool"); };
    const { res, nextCalled } = await run(`Bearer ${tokenValido}`);
    assert.strictEqual(nextCalled, false);
    assert.strictEqual(res.statusCode, 503);
    assert.notStrictEqual(res.statusCode, 401);
  }

  // 5) Token válido, usuário ativo → next() com req.user preenchido.
  {
    pool.query = async () => ({ rows: [{ id: 7, role: "membro", ativo: true }] });
    const { req, nextCalled } = await run(`Bearer ${tokenValido}`);
    assert.strictEqual(nextCalled, true);
    assert.strictEqual(req.user.id, 7);
  }

  // 6) Usuário inativo → 403 (não é sessão inválida).
  {
    pool.query = async () => ({ rows: [{ id: 7, role: "membro", ativo: false }] });
    const { res, nextCalled } = await run(`Bearer ${tokenValido}`);
    assert.strictEqual(nextCalled, false);
    assert.strictEqual(res.statusCode, 403);
  }

  pool.query = originalQuery;
  console.log("✓ authMiddleware: falha de banco responde 503 e preserva a sessão");
  process.exit(0);
})().catch((err) => {
  pool.query = originalQuery;
  console.error(err);
  process.exit(1);
});
