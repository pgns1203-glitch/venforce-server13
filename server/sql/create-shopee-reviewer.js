#!/usr/bin/env node
// Seed script: cria conta de review da Shopee + cliente demo-shopee.
//
// Uso:
//   SHOPEE_REVIEW_EMAIL=shopee.review@venforcecompany.com \
//   SHOPEE_REVIEW_PASSWORD=<senha> \
//   DATABASE_URL=<url> \
//   node server/sql/create-shopee-reviewer.js
//
// É idempotente: pode rodar múltiplas vezes sem duplicar registros.

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const bcrypt = require("bcrypt");
const { Pool } = require("pg");

const DEMO_CLIENTE_NOME = "Cliente Demo Shopee";
const DEMO_CLIENTE_SLUG = "demo-shopee";
const REVIEWER_ROLE = "shopee_reviewer";
const REVIEWER_NOME = "Shopee Reviewer";

async function main() {
  const email = process.env.SHOPEE_REVIEW_EMAIL;
  const password = process.env.SHOPEE_REVIEW_PASSWORD;

  if (!email || !password) {
    console.error("Erro: defina SHOPEE_REVIEW_EMAIL e SHOPEE_REVIEW_PASSWORD antes de rodar.");
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error("Erro: DATABASE_URL não definida.");
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    // 1. Criar cliente demo-shopee (sem api_key exposta — gerada internamente)
    const crypto = require("crypto");
    const apiKey = "vf_demo_" + crypto.randomBytes(16).toString("hex");

    const clienteRes = await pool.query(
      `INSERT INTO clientes (nome, slug, api_key, ativo)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (slug) DO UPDATE
         SET nome = EXCLUDED.nome, ativo = true
       RETURNING id, nome, slug`,
      [DEMO_CLIENTE_NOME, DEMO_CLIENTE_SLUG, apiKey]
    );
    console.log("Cliente demo:", clienteRes.rows[0]);

    // 2. Criar usuário shopee_reviewer
    const hashed = await bcrypt.hash(password, 10);

    const userRes = await pool.query(
      `INSERT INTO users (email, password, nome, ativo, role)
       VALUES ($1, $2, $3, true, $4)
       ON CONFLICT (email) DO UPDATE
         SET password = EXCLUDED.password,
             nome     = EXCLUDED.nome,
             ativo    = true,
             role     = EXCLUDED.role
       RETURNING id, email, nome, role, ativo`,
      [email.trim().toLowerCase(), hashed, REVIEWER_NOME, REVIEWER_ROLE]
    );
    console.log("Usuário criado/atualizado:", userRes.rows[0]);

    console.log("\nPronto. Credenciais para preencher na Shopee:");
    console.log("  URL:   https://venforce-server.onrender.com/login.html");
    console.log("  Email:", email.trim().toLowerCase());
    console.log("  Senha: (conforme SHOPEE_REVIEW_PASSWORD)");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Erro ao executar seed:", err.message);
  process.exit(1);
});
