#!/usr/bin/env node
// server/scripts/painelContasV3SqlCheck.js
// Validação do SQL do Painel de Contas V3 contra um Postgres REAL em memória
// (PGlite). Não é teste da suíte (a suíte usa fake db): prova a semântica que o
// fake não prova — a migration manual da CHECK de TikTok (idempotente), a
// coluna data_referencia do ensure lazy, as queries de escopo do Painel
// (coordenador/gestor), a trilha do lançamento manual e a composição do
// faturamento por conta.
//
// SEGURANÇA: nunca lê DATABASE_URL e nunca abre conexão de rede.
//
// Uso (a partir de server/, sem alterar package.json):
//   npm install --no-save @electric-sql/pglite@0.3
//   node scripts/painelContasV3SqlCheck.js
process.env.DATABASE_URL = "postgres://nobody@127.0.0.1:1/morto";
const fs = require("fs");
const path = require("path");
let PGlite;
try {
  ({ PGlite } = require("@electric-sql/pglite"));
} catch (_) {
  console.error("Instale antes (sem salvar no package.json): npm install --no-save @electric-sql/pglite@0.3");
  process.exit(2);
}
const W = path.join(__dirname, "..", "..");
const assert = require("assert");
let n = 0; const ok = (l, c) => { assert.ok(c, "FALHOU: " + l); n++; console.log("  ok ", l); };

(async () => {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE users (id SERIAL PRIMARY KEY, nome TEXT, role TEXT);
    CREATE TABLE clientes (id SERIAL PRIMARY KEY, slug TEXT UNIQUE, nome TEXT, ativo BOOLEAN DEFAULT true);
    CREATE TABLE squads (id SERIAL PRIMARY KEY, nome TEXT, slug TEXT, ativo BOOLEAN DEFAULT true);
    CREATE TABLE squad_members (id SERIAL PRIMARY KEY, squad_id INT REFERENCES squads(id), user_id INT REFERENCES users(id), is_primary BOOLEAN DEFAULT false, funcao TEXT NOT NULL DEFAULT 'membro', ativo BOOLEAN DEFAULT true);
    CREATE TABLE cliente_squad_history (id SERIAL PRIMARY KEY, cliente_id INT REFERENCES clientes(id), squad_id INT REFERENCES squads(id), inicio_em TIMESTAMP DEFAULT NOW(), fim_em TIMESTAMP);
    CREATE TABLE cliente_responsaveis (id SERIAL PRIMARY KEY, cliente_id INT REFERENCES clientes(id), user_id INT REFERENCES users(id), papel TEXT NOT NULL, ativo BOOLEAN DEFAULT true);
    CREATE TABLE cliente_contas (id SERIAL PRIMARY KEY, cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE, marketplace TEXT NOT NULL, nome TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, external_account_id TEXT, is_primary BOOLEAN NOT NULL DEFAULT false, ativo BOOLEAN NOT NULL DEFAULT true, metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb);
    ALTER TABLE cliente_contas ADD CONSTRAINT cliente_contas_marketplace_check CHECK (marketplace IN ('meli', 'shopee'));
    INSERT INTO users (nome, role) VALUES ('Ana','membro'),('Beto','membro'),('Carla','user'),('Admin','admin');
    INSERT INTO clientes (slug, nome, ativo) VALUES ('a','A',true),('b','B',true),('c','C',true),('d','D inativo',false);
    INSERT INTO squads (nome, slug, ativo) VALUES ('S1','s1',true),('S2','s2',true),('S3','s3',false);
    INSERT INTO squad_members (squad_id, user_id, funcao, ativo) VALUES (1,1,'coordenador',true),(2,2,'membro',true),(3,2,'coordenador',true),(2,3,'membro',true);
    INSERT INTO cliente_squad_history (cliente_id, squad_id, fim_em) VALUES (1,1,NULL),(2,2,NULL),(3,3,NULL),(2,1,NOW()),(4,1,NULL);
    INSERT INTO cliente_responsaveis (cliente_id, user_id, papel, ativo) VALUES (2,3,'gestor',true),(1,3,'auxiliar',true),(3,3,'gestor',false);
  `);

  // TikTok: antes da migration, o banco recusa.
  let recusou = false;
  try { await db.query("INSERT INTO cliente_contas (cliente_id, marketplace, nome, slug) VALUES (1,'tiktok','T','a-tt')"); } catch (e) { recusou = /cliente_contas_marketplace_check/.test(e.message); }
  ok("sem a migration, CHECK recusa tiktok", recusou);
  const mig = fs.readFileSync(path.join(W, "server/sql/migrations/20261001_cliente_contas_marketplace_tiktok.sql"), "utf8");
  await db.exec(mig);
  await db.exec(mig);
  ok("migration roda 2x (idempotente)", true);
  await db.query("INSERT INTO cliente_contas (cliente_id, marketplace, nome, slug) VALUES (1,'tiktok','T','a-tt'), (1,'shopee','S','a-sh'), (2,'meli','M','b-ml')");
  let invalido = false;
  try { await db.query("INSERT INTO cliente_contas (cliente_id, marketplace, nome, slug) VALUES (1,'magalu','X','a-x')"); } catch (e) { invalido = true; }
  ok("depois da migration: tiktok entra, marketplace desconhecido continua barrado", invalido);

  // Painel schema (lazy ensure) 2x — inclusive o ALTER novo.
  const schema = fs.readFileSync(path.join(W, "server/sql/painel_contas_schema.sql"), "utf8");
  await db.exec(schema); await db.exec(schema);
  const cols = await db.query("SELECT data_type FROM information_schema.columns WHERE table_name='painel_contas_lancamentos_manuais' AND column_name='data_referencia'");
  ok("painel_contas_schema.sql idempotente e cria data_referencia DATE", cols.rows[0]?.data_type === "date");

  // Liga o pool do app ao PGlite.
  const pool = require(path.join(W, "server/config/database"));
  const exec = async (sql, params) => { const r = await db.query(sql, params || []); return { rows: r.rows, rowCount: r.affectedRows }; };
  pool.query = exec;
  pool.connect = async () => ({ query: exec, release() {} });

  const acesso = require(path.join(W, "server/services/painelContas/painelContasAcesso.js"));
  const ids = (e) => e.clientes.map((c) => Number(c.id)).sort();
  const admin = await acesso.resolverEscopoPainel({ id: 4, role: "admin" });
  ok("admin: todos os ativos", admin.tipo === "admin" && JSON.stringify(ids(admin)) === "[1,2,3]");
  const ana = await acesso.resolverEscopoPainel({ id: 1, role: "membro" });
  ok("coordenador S1: só cliente do Squad vigente (histórico encerrado e inativo fora)", ana.tipo === "carteira" && JSON.stringify(ids(ana)) === "[1]" && ana.squadsCoordenados.map((s) => s.nome).join() === "S1");
  const beto = await acesso.resolverEscopoPainel({ id: 2, role: "membro" });
  ok("membro comum + coordenador de Squad inativo: sem acesso", beto.tipo === "nenhum" && beto.clientes.length === 0);
  const carla = await acesso.resolverEscopoPainel({ id: 3, role: "user" });
  ok("gestor ativo: só o cliente que gere (auxiliar e gestão inativa não contam)", carla.tipo === "carteira" && JSON.stringify(ids(carla)) === "[2]" && carla.clientesComoGestor === 1);
  await acesso.assertClienteNoPainel({ id: 3, role: "user" }, "b");
  let negado = null; try { await acesso.assertClienteNoPainel({ id: 3, role: "user" }, "a"); } catch (e) { negado = e; }
  ok("PODE_VER_CLIENTE: gestor de B lê B e não lê A (auxiliar)", negado?.statusCode === 403);
  let inat = null; try { await acesso.assertClienteNoPainel({ id: 1, role: "membro" }, "d"); } catch (e) { inat = e; }
  ok("cliente inativo do Squad coordenado não é aberto por não-admin", inat?.statusCode === 403);
  ok("admin abre cliente inativo (bypass de sempre)", (await acesso.assertClienteNoPainel({ id: 4, role: "admin" }, "d")).id === 4);

  // Repositório: upsert com data_referencia, trilha e leituras novas.
  const repo = require(path.join(W, "server/services/painelContas/painelContasRepository.js"));
  const valores = (fat, ref) => ({ faturamento: fat, lucroContribuicao: null, margemContribuicao: null, investimentoAds: null, gmvAds: null, observacao: null, dataReferencia: ref });
  const r1 = await repo.salvarLancamentoManual({ clienteId: 1, contaId: 2, competencia: "2026-08", valores: valores(400, "2026-08-31"), userId: 1 });
  const r2 = await repo.salvarLancamentoManual({ clienteId: 1, contaId: 2, competencia: "2026-09", valores: valores(500, null), userId: 1 });
  const r3 = await repo.salvarLancamentoManual({ clienteId: 1, contaId: 2, competencia: "2026-09", valores: valores(520, "2026-09-29"), userId: 3 });
  ok("upsert: insert x update distinguidos (xmax)", r1.inserido === true && r2.inserido === true && r3.inserido === false);
  const lancs = await repo.listarManuaisDaConta(2, 1);
  ok("MANUAIS_DA_CONTA: 2 competências, mais recente primeiro, agosto intacto", lancs.map((l) => `${l.competencia}:${Number(l.faturamento)}`).join() === "2026-09:520,2026-08:400");
  ok("MANUAIS_DA_CONTA: created_by_nome / updated_by_nome", lancs[0].created_by_nome === "Ana" && lancs[0].updated_by_nome === "Carla");
  const daComp = await repo.listarManuaisDaCompetencia([2], "2026-09");
  ok("MANUAIS_DA_COMPETENCIA traz data_referencia e created_by_nome", String(daComp[0].data_referencia).length > 0 && daComp[0].created_by_nome === "Ana");
  await repo.removerLancamentoManual({ clienteId: 1, contaId: 2, competencia: "2026-09", userId: 4 });
  const hist = await repo.listarHistoricoManual(2, 1, "2026-09");
  ok("HISTORICO_DA_CONTA: removido, alterado, criado (mais recente primeiro) com autor", hist.map((h) => `${h.acao}:${h.user_nome}`).join() === "removido:Admin,alterado:Carla,criado:Ana");
  ok("trilha guarda a data de referência", hist[1].valores_json.dataReferencia === "2026-09-29" && hist[0].valores_json.dataReferencia === "2026-09-29");
  ok("trilha de agosto separada", (await repo.listarHistoricoManual(2, 1, "2026-08")).length === 1);

  // Composição do faturamento por conta: agregado por status × pós-venda e
  // sobreposição de pedido entre imports — DDL real da Central.
  const ddlCentral = fs.readFileSync(path.join(W, "server/sql/central_vendas_schema.sql"), "utf8");
  // Só as duas tabelas que a composição lê (o arquivo inteiro depende de outras).
  const tabela = (nome) => ddlCentral.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${nome} \\([\\s\\S]*?\\n\\);`))[0];
  await db.exec(tabela("central_vendas_imports"));
  await db.exec(tabela("central_vendas_pedidos"));
  await db.exec(`
    INSERT INTO central_vendas_imports (id, cliente_slug, competencia, fonte, status, confianca, resumo_json)
    VALUES (901, 'a', '2026-09', 'api', 'ok', 'parcial', '{"faturamento": 150.50}'),
           (902, 'a', '2026-09', 'api', 'ok', 'parcial', '{"faturamento": 70}');
    INSERT INTO central_vendas_pedidos (import_id, cliente_slug, competencia, pedido_id, status, confianca, faturamento, payload_json) VALUES
      (901,'a','2026-09','p1','paid','confiavel',100.25,'{}'),
      (901,'a','2026-09','p2','partially_refunded','bloqueado',50.25,'{}'),
      (901,'a','2026-09','p3','cancelled','confiavel',40,'{}'),
      (901,'a','2026-09','p4','cancelado','confiavel',30,'{"posVendaTipo":"devolucao"}'),
      (901,'a','2026-09','p5','com_problema','confiavel',20,'{"posVendaTipo":"mediacao"}'),
      (901,'a','2026-09','p6','com_problema','confiavel',10,'{"posVendaTipo":"devolucao"}'),
      (901,'a','2026-09','p7','paid','confiavel',NULL,'{}'),
      (902,'a','2026-09','p1','paid','confiavel',70,'{}');
  `);
  const comp = require(path.join(W, "server/services/painelContas/painelContasComposicao.js"));
  const linhas = await repo.listarComposicaoDosImports([901, 902]);
  const de901 = linhas.filter((l) => Number(l.import_id) === 901);
  const c901 = comp.montarComposicaoConta({ id: 901, faturamento: 150.5 }, de901);
  ok("COMPOSICAO_DOS_IMPORTS: posVendaTipo lido do payload, grupos disjuntos",
    c901.exclusoes.cancelamentos.valor === 40 && c901.exclusoes.devolucoes.valor === 30
    && c901.exclusoes.mediacoes.valor === 20 && c901.exclusoes.devolucoesEmAndamento.valor === 10);
  ok("COMPOSICAO_DOS_IMPORTS: bruto 7 pedidos − exclusões = FAT do import (fecha), pedido sem valor contado",
    c901.bruto.pedidos === 7 && c901.bruto.valor === 250.5 && c901.validos.valor === 150.5
    && c901.reconciliacao.fecha === true && c901.pedidosSemValor === 1);
  const sob = await repo.medirSobreposicaoDosImports([901, 902]);
  ok("COMPOSICAO_SOBREPOSICAO: mesmo pedido em dois imports é medido (1 pedido, excedente 70)", sob.pedidos === 1 && sob.valor === 70);
  ok("COMPOSICAO_SOBREPOSICAO: um import só não consulta", (await repo.medirSobreposicaoDosImports([901])).pedidos === 0);

  console.log(`painelContasV3SqlCheck.js: ${n} verificações em PostgreSQL (PGlite) passaram.`);
})().catch((e) => { console.error(e); process.exit(1); });
