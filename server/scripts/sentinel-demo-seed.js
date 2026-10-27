#!/usr/bin/env node
// server/scripts/sentinel-demo-seed.js
// Cria (e recria) o database LOCAL sentinel_demo com dados 100% FICTÍCIOS:
// usuários, Squads, clientes, contas, pedidos e checkpoints — e roda o motor
// real (avaliarIncidentesConta) para gerar os incidentes.
//
//   node server/scripts/sentinel-demo-seed.js
//   (SENTINEL_DEMO_DATABASE_URL opcional; padrão postgres://vf@127.0.0.1:57651/sentinel_demo;
//    host não-local é RECUSADO; server/.env nunca é lido.)
//
// Senha de TODOS os usuários de demo: demo1234
//   admin@demo.test | ana@demo.test (Squad Aurora) | bia@demo.test (Squad Boreal)
//   caio@demo.test (interno sem Squad) | vendedor@demo.test (seller)

const { Client } = require("pg");
const fs = require("fs");
const path = require("path");
const { urlDemo } = require("./sentinel-demo-lib");

const SENHA = "demo1234";
const H = 3600 * 1000;
const MIN = 60 * 1000;

const DDL = `
CREATE TABLE users (id integer PRIMARY KEY, nome text, email text UNIQUE, password text, role text, ativo boolean DEFAULT true);
CREATE TABLE clientes (id integer PRIMARY KEY, nome text, slug text UNIQUE, ativo boolean DEFAULT true);
CREATE TABLE cliente_contas (id integer PRIMARY KEY, cliente_id integer REFERENCES clientes(id), marketplace text, nome text,
  slug text UNIQUE, external_account_id text, is_primary boolean DEFAULT false, ativo boolean DEFAULT true,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now());
CREATE TABLE squads (id integer PRIMARY KEY, nome text, slug text, ativo boolean DEFAULT true);
CREATE TABLE squad_members (id serial PRIMARY KEY, squad_id integer, user_id integer, is_primary boolean DEFAULT false, funcao text DEFAULT 'membro', ativo boolean DEFAULT true);
CREATE TABLE cliente_squad_history (id serial PRIMARY KEY, cliente_id integer, squad_id integer, inicio_em timestamp DEFAULT now(), fim_em timestamp);
CREATE TABLE seller_clientes (user_id integer, cliente_id integer, ativo boolean DEFAULT true);
CREATE TABLE cliente_responsaveis (id serial PRIMARY KEY, cliente_id integer, user_id integer, papel text, ativo boolean DEFAULT true);
CREATE TABLE custos (id serial PRIMARY KEY, base_id integer NOT NULL, produto_id text NOT NULL, custo_produto numeric NOT NULL DEFAULT 0,
  imposto_percentual numeric NOT NULL DEFAULT 0, sku text NOT NULL DEFAULT '', sku_id text NOT NULL DEFAULT '', id_model text);
CREATE TABLE logs (id serial PRIMARY KEY);
-- Tabelas que o /me/portfolio do Shell consulta (sem colunas de segredo: não há tokens reais aqui).
CREATE TABLE ml_tokens (id serial PRIMARY KEY, cliente_id integer, cliente_conta_id integer, ml_user_id text, token_status text DEFAULT 'valid',
  is_primary boolean DEFAULT true, expires_at timestamptz, updated_at timestamptz DEFAULT now(), superseded_by_grant_id integer);
CREATE TABLE bases (id serial PRIMARY KEY, slug text, nome text);
CREATE TABLE base_cliente_vinculos (id serial PRIMARY KEY, cliente_id integer, cliente_conta_id integer, base_id integer, marketplace text, ativo boolean DEFAULT true, updated_at timestamptz DEFAULT now());
CREATE TABLE relatorios (id serial PRIMARY KEY, cliente_id integer, cliente_slug text);
`;

const USUARIOS = [
  [1, "Admin Demo", "admin@demo.test", "admin"],
  [2, "Ana Exemplo", "ana@demo.test", "interno"],
  [3, "Bia Exemplo", "bia@demo.test", "interno"],
  [4, "Caio Exemplo", "caio@demo.test", "interno"],
  [5, "Vendedor Demo", "vendedor@demo.test", "seller"],
  [6, "Revisor Demo", "revisor@demo.test", "shopee_reviewer"],
];
const CLIENTES = [
  [1, "Loja Modelo Alfa", "loja-modelo-alfa"], [2, "Emporio Ficticio Beta", "emporio-ficticio-beta"],
  [3, "Casa Exemplo Gama", "casa-exemplo-gama"], [4, "Mercado Teste Delta", "mercado-teste-delta"],
  [5, "Oficina Demo Epsilon", "oficina-demo-epsilon"],
];
const CONTAS = [[101, 1, "Alfa Oficial"], [102, 2, "Beta Principal"], [103, 3, "Gama ML"], [104, 4, "Delta ML"], [105, 5, "Epsilon ML"], [106, 1, "Alfa Antiga (desativada)"]];

let seq = 4000000000;
function pedido({ conta, mlb, h, status = "paid", estado = "confirmada", qtd = 1, preco, custoUn = 40, margem, pend = [], estadoCusto = "ok" }) {
  seq += 1;
  const fat = preco * qtd;
  const sem = estado === "sem_custo";
  return {
    conta, id: String(seq), data: new Date(Date.now() - h * H), status, estado,
    fat, comissao: Math.round(fat * 0.14 * 100) / 100, frete: sem ? null : 18.9,
    custo: sem ? null : custoUn * qtd, imposto: sem ? null : Math.round(fat * 0.06 * 100) / 100,
    margem: sem ? null : margem, pct: sem || margem == null ? null : Math.round((margem / fat) * 10000) / 100, pend,
    itens: [{ item_id: mlb, variation_id: null, sku: "SKU-" + mlb.slice(-4), quantidade: qtd, preco, custo_unitario: sem ? null : custoUn, imposto_percentual: sem ? null : 6, estado_custo: estadoCusto, origem_custo: sem ? null : "base" }],
  };
}

function gerarPedidos() {
  const p = [];
  // 102 Beta: MLB-DEMO-0002 → 11 pedidos com margem negativa (crítico por contagem)
  for (let i = 0; i < 11; i++) p.push(pedido({ conta: 102, mlb: "MLB-DEMO-0002", h: 3 + i * 5, preco: 79.9, custoUn: 66, margem: -22.4 - i }));
  // 102 Beta: MLB-DEMO-0001 → 4 pedidos negativos (alta)
  for (let i = 0; i < 4; i++) p.push(pedido({ conta: 102, mlb: "MLB-DEMO-0001", h: 8 + i * 12, preco: 59.9, custoUn: 41.5, margem: -45 }));
  // pedido cancelado com "margem negativa": NÃO conta
  p.push(pedido({ conta: 102, mlb: "MLB-DEMO-0001", h: 2, status: "cancelled", preco: 59.9, margem: -500 }));
  // 101 Alfa: margem provisória negativa (confiabilidade pendente → baixa)
  for (let i = 0; i < 2; i++) p.push(pedido({ conta: 101, mlb: "MLB-DEMO-0003", h: 6 + i * 20, estado: "provisoria", pend: ["sem_frete"], preco: 89.9, margem: -6.5 }));
  // 101 Alfa: sem custo → 6 pedidos × R$360 = receita sem custo alta
  for (let i = 0; i < 6; i++) p.push(pedido({ conta: 101, mlb: "MLB-DEMO-0004", h: 4 + i * 9, estado: "sem_custo", qtd: 3, preco: 120, estadoCusto: "sem_custo" }));
  // 104 Delta: sem custo menor (média) + alguns pedidos saudáveis
  for (let i = 0; i < 2; i++) p.push(pedido({ conta: 104, mlb: "MLB-DEMO-0005", h: 5 + i * 30, estado: "sem_custo", qtd: 2, preco: 150, estadoCusto: "sem_custo" }));
  for (let i = 0; i < 6; i++) p.push(pedido({ conta: 104, mlb: "MLB-DEMO-0006", h: 2 + i * 7, preco: 99.9, custoUn: 40, margem: 28.4 }));
  // 106 Alfa Antiga (conta DESATIVADA): incidente de custo pendente que continua para consulta/decisão humana
  for (let i = 0; i < 3; i++) p.push(pedido({ conta: 106, mlb: "MLB-DEMO-0008", h: 24 * 12 + i * 6, estado: "sem_custo", qtd: 2, preco: 130, estadoCusto: "sem_custo" }));
  // 103 Gama: pedidos saudáveis antigos (conta parou de ler)
  for (let i = 0; i < 3; i++) p.push(pedido({ conta: 103, mlb: "MLB-DEMO-0007", h: 60 + i * 10, preco: 49.9, custoUn: 20, margem: 14.2 }));
  return p;
}

async function main() {
  const url = new URL(urlDemo());
  const dbName = url.pathname.slice(1);
  if (!/^[a-z0-9_]+$/i.test(dbName)) throw new Error("Nome de database inválido.");
  const admin = new Client({ connectionString: Object.assign(new URL(url), { pathname: "/postgres" }).toString(), ssl: false });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();

  const db = new Client({ connectionString: url.toString(), ssl: false });
  await db.connect();
  try {
    await db.query(DDL);
    const bcrypt = require("bcrypt");
    const hash = await bcrypt.hash(SENHA, 8);
    for (const [id, nome, email, role] of USUARIOS) await db.query("INSERT INTO users (id,nome,email,password,role) VALUES ($1,$2,$3,$4,$5)", [id, nome, email, hash, role]);
    for (const [id, nome, slug] of CLIENTES) await db.query("INSERT INTO clientes (id,nome,slug) VALUES ($1,$2,$3)", [id, nome, slug]);
    for (const [id, cli, nome] of CONTAS) await db.query("INSERT INTO cliente_contas (id,cliente_id,marketplace,nome,slug,external_account_id,is_primary,ativo) VALUES ($1,$2,'meli',$3,$4,$5,$6,$6)", [id, cli, nome, `conta-${id}`, `900${id}`, id !== 106]); // 106 = conta DESATIVADA
    for (const [id, cli] of CONTAS.map(([i, c]) => [i, c])) await db.query("INSERT INTO ml_tokens (cliente_id, cliente_conta_id, ml_user_id) VALUES ($1,$2,$3)", [cli, id, `900${id}`]);
    await db.query("INSERT INTO squads (id,nome,slug) VALUES (1,'Squad Aurora','aurora'),(2,'Squad Boreal','boreal')");
    await db.query("INSERT INTO squad_members (squad_id,user_id) VALUES (1,2),(2,3)");
    // Epsilon (cliente 5) e Caio ficam SEM Squad de propósito: só o admin enxerga a conta 105.
    await db.query("INSERT INTO cliente_squad_history (cliente_id,squad_id) VALUES (1,1),(2,1),(3,2),(4,2)");
    await db.query("INSERT INTO seller_clientes (user_id,cliente_id) VALUES (5,1)");

    // Schema do Sentinel: migrations versionadas reais (idempotentes).
    const dir = path.join(__dirname, "..", "sql", "migrations");
    for (const f of ["20261023_sentinel_pedidos.sql", "20261027_sentinel_v0a.sql", "20261028_sentinel_incidentes.sql"]) {
      await db.query(fs.readFileSync(path.join(dir, f), "utf8"));
    }

    const clienteDe = Object.fromEntries(CONTAS.map(([id, cli]) => [id, cli]));
    for (const x of gerarPedidos()) {
      const competencia = x.data.toISOString().slice(0, 7);
      await db.query(
        `INSERT INTO sentinel_pedidos (cliente_id, cliente_conta_id, pedido_id, competencia, data_pedido, ml_date_last_updated, status_ml, itens,
           faturamento, comissao, frete, custo, imposto, margem_valor, margem_pct, estado_margem, pendencias, claims_verificado)
         VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,false)`,
        [clienteDe[x.conta], x.conta, x.id, competencia, x.data, x.status, JSON.stringify(x.itens), x.fat, x.comissao, x.frete, x.custo, x.imposto, x.margem, x.pct, x.estado, JSON.stringify(x.pend)]);
    }

    const agora = Date.now();
    const cp = (conta, lastMin, execMin, erro) => db.query(
      "INSERT INTO sentinel_checkpoints (cliente_conta_id, ultimo_date_last_updated, ultima_execucao_em, ultimo_erro, pedidos_processados_ultima) VALUES ($1,$2,$3,$4,0)",
      [conta, new Date(agora - lastMin * MIN), new Date(agora - execMin * MIN), erro]);
    await cp(101, 10, 5, null);                                  // em dia
    await cp(102, 15, 5, null);                                  // em dia
    await cp(103, 52 * 60, 60, "TOKEN_INVALIDO: 401 do Mercado Livre"); // erro de token
    await cp(104, 3 * 60, 3 * 60, null);                         // atrasada (>120 min)
    // 105: sem checkpoint → não monitorada

    // Motor REAL gera os incidentes a partir dos pedidos fictícios.
    const { avaliarIncidentesConta, reconhecerIncidente } = require("../services/sentinel/sentinelIncidentes");
    for (const [id] of CONTAS) await avaliarIncidentesConta(db, id, { agora: new Date(agora) });
    // Conta DESATIVADA (106): se o motor já a avalia, o incidente existe; senão (versão anterior do
    // motor) cria um equivalente direto, só p/ a demo mostrar o selo "conta desativada".
    if (!(await db.query("SELECT 1 FROM sentinel_incidentes WHERE cliente_conta_id = 106")).rowCount) {
      await db.query(`INSERT INTO sentinel_incidentes (cliente_conta_id, tipo, chave, severidade, confiabilidade, titulo, motivo, proxima_acao,
          impacto_tipo, impacto_valor, pedidos_afetados, primeira_ocorrencia, ultima_ocorrencia, fingerprint)
        VALUES (106,'custo_pendente','MLB-DEMO-0008','media','pendente','Panela Antiaderente sem custo (conta desativada)',
          '3 pedidos antigos sem custo; a conta foi desativada.','Decidir se o incidente ainda importa.','receita_sem_custo',780,3,
          NOW() - interval '12 days', NOW() - interval '11 days','demo-106')`);
    }
    // Demo realista: o incidente "nasce" na primeira ocorrência (senão todos teriam 1 min em aberto).
    await db.query("UPDATE sentinel_incidentes SET aberto_em = COALESCE(primeira_ocorrencia, aberto_em)");
    const { rows } = await db.query("SELECT id FROM sentinel_incidentes WHERE tipo='margem_negativa' AND severidade='alta' ORDER BY id LIMIT 1");
    if (rows[0]) await reconhecerIncidente(db, rows[0].id, { ator: "Ana Exemplo (#2)", observacao: "Vou revisar o preço." });

    const resumo = (await db.query("SELECT tipo, severidade, status, COUNT(*)::int n FROM sentinel_incidentes GROUP BY 1,2,3 ORDER BY 1,2")).rows;
    console.log(`Seed OK em ${dbName}. Incidentes gerados:`);
    console.table(resumo);
  } finally {
    await db.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
