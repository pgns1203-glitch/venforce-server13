// server/scripts/lib/custosPglite.js
//
// Banco `custos` REAL em memória (PGlite) para scripts e checks de SQL das
// Bases de Custo. Recria a tabela como o boot real faz — o DDL de /setup em
// server/index.js (UNIQUE (base_id, produto_id) histórico + id_model) e depois
// o ensureColunasCustos() do service — e liga o `pool` do projeto a ele.
// Também recorta o parsePlanilha REAL de server/index.js (que sobe o servidor
// ao ser requerido), no mesmo idioma de tests/basesTiktok.test.js.
//
// Nunca lê DATABASE_URL e nunca abre conexão de rede.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function exigirPglite() {
  try {
    return require("@electric-sql/pglite").PGlite;
  } catch (_) {
    console.error("Instale antes (sem salvar no package.json): npm install --no-save @electric-sql/pglite@0.3");
    process.exit(2);
  }
  return null;
}

// Uma conexão só (PGlite é single-connection): pool.query e pool.connect()
// compartilham a sessão, então BEGIN/COMMIT do service funcionam em série.
function ligarPool(pg) {
  const pool = require("../../config/database");
  const query = async (sql, params = []) => {
    if (!params.length && /;\s*\S/.test(sql)) {
      const r = await pg.exec(sql);
      const ultimo = r[r.length - 1] || {};
      return { rows: ultimo.rows || [], rowCount: ultimo.affectedRows };
    }
    const r = await pg.query(sql, params);
    return { rows: r.rows, rowCount: r.affectedRows };
  };
  pool.query = query;
  pool.connect = async () => ({ query, release() {} });
  return pool;
}

async function criarBancoCustos({ ensure = true } = {}) {
  const PGlite = exigirPglite();
  const pg = new PGlite();
  const pool = ligarPool(pg);
  await pg.exec(`
    CREATE TABLE users (id SERIAL PRIMARY KEY, email TEXT);
    INSERT INTO users (email) VALUES ('op@venforce');
    CREATE TABLE activity_logs (id SERIAL PRIMARY KEY, user_id INTEGER, user_email TEXT, user_nome TEXT, acao TEXT, detalhes TEXT, ip TEXT, status TEXT, created_at TIMESTAMP DEFAULT NOW());
    CREATE TABLE bases (
      id SERIAL PRIMARY KEY, slug TEXT UNIQUE NOT NULL, nome TEXT NOT NULL,
      ativo BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      marketplace TEXT DEFAULT 'meli', updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE user_bases (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      base_id INTEGER NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, base_id)
    );
    -- server/index.js /setup: tabela original + id_model (719b1fae).
    CREATE TABLE custos (
      id SERIAL PRIMARY KEY, base_id INTEGER NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
      produto_id TEXT NOT NULL, custo_produto NUMERIC NOT NULL DEFAULT 0,
      imposto_percentual NUMERIC NOT NULL DEFAULT 0, taxa_fixa NUMERIC NOT NULL DEFAULT 0,
      UNIQUE (base_id, produto_id)
    );
    ALTER TABLE custos ADD COLUMN IF NOT EXISTS id_model TEXT;
    -- Base vinculada (buildCostRowsFromBase → resolverBaseVinculada).
    CREATE TABLE clientes (id SERIAL PRIMARY KEY, nome TEXT, slug TEXT UNIQUE NOT NULL, ativo BOOLEAN DEFAULT true);
    CREATE TABLE base_cliente_vinculos (
      id SERIAL PRIMARY KEY, base_id INTEGER REFERENCES bases(id) ON DELETE CASCADE, cliente_id INTEGER REFERENCES clientes(id) ON DELETE CASCADE,
      marketplace TEXT, origem TEXT DEFAULT 'manual', ativo BOOLEAN DEFAULT true, cliente_conta_id INTEGER,
      confirmado_por INTEGER, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  if (ensure) {
    const { ensureColunasCustos } = require("../../services/bases/baseCustosService");
    await ensureColunasCustos();
  }
  return { pg, pool, fechar: () => pg.close() };
}

function carregarParsePlanilha() {
  const XLSX = require("xlsx");
  const { MARKETPLACES_SUPORTADOS } = require("../../services/bases/marketplacesBases");
  const custosService = require("../../services/bases/baseCustosService");
  const { lerWorkbookPlanilha } = require("../../utils/excelUtils");
  const fonte = fs.readFileSync(path.join(__dirname, "..", "..", "index.js"), "utf8");
  const inicio = fonte.indexOf("// AUXILIARES");
  const fim = fonte.indexOf("function gerarApiKey()");
  if (!(inicio > 0 && fim > inicio)) throw new Error("não foi possível recortar o bloco de auxiliares de index.js");
  const sandbox = {
    XLSX,
    path,
    MARKETPLACES_SUPORTADOS,
    normalizarProdutoIdTikTok: custosService.normalizarProdutoIdTikTok,
    normalizarSkuIdTikTok: custosService.normalizarSkuIdTikTok,
    erroSkuIdDuplicadoTikTok: custosService.erroSkuIdDuplicadoTikTok,
    lerWorkbookPlanilha,
    module: { exports: {} },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(`${fonte.slice(inicio, fim)}\nmodule.exports = { parsePlanilha };`, sandbox);
  return sandbox.module.exports.parsePlanilha;
}

module.exports = { criarBancoCustos, carregarParsePlanilha, ligarPool };
