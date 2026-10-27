// server/scripts/sentinel-demo-lib.js
// Salvaguardas da DEMO LOCAL do Sentinel. Nunca lê server/.env.
//   - exige SENTINEL_DEMO_DATABASE_URL apontando para host LOCAL;
//   - injeta no cache de módulos um pool SEM SSL no lugar de config/database.js
//     (que força SSL e, via DATABASE_URL, poderia apontar para produção).
// Chame preparar() ANTES de qualquer require de rota/serviço do servidor.

const path = require("path");
const { Pool } = require("pg");

const URL_PADRAO = "postgres://vf@127.0.0.1:57651/sentinel_demo";
const LOCAIS = ["127.0.0.1", "localhost", "[::1]"];

function urlDemo() {
  const url = process.env.SENTINEL_DEMO_DATABASE_URL || URL_PADRAO;
  const u = new URL(url);
  if (!LOCAIS.includes(u.hostname)) {
    throw new Error(`DEMO_RECUSADA: host "${u.hostname}" não é local. A demo só roda contra PostgreSQL local.`);
  }
  return url;
}

function preparar() {
  const url = urlDemo();
  // Qualquer módulo que leia DATABASE_URL enxerga o banco local, nunca o do .env.
  process.env.DATABASE_URL = url;
  const pool = new Pool({ connectionString: url, ssl: false });
  // Re-seed derruba as conexões (DROP DATABASE ... FORCE): não pode matar o processo.
  pool.on("error", (e) => console.warn("[demo] conexão do pool caiu:", e.message));
  const dbPath = require.resolve(path.join(__dirname, "..", "config", "database"));
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: pool };
  return { pool, url };
}

module.exports = { preparar, urlDemo, URL_PADRAO };
