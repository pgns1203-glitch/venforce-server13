#!/usr/bin/env node
// server/scripts/shopeeBaseItemModelAudit.js
//
// FIN-508 — auditoria de uma Base de Custos Shopee REAL (ID | ID Model |
// Custo | Imposto) contra o caminho real de importação:
//
//   parsePlanilha (server/index.js)  →  baseImportService.criarBaseComCustos
//   →  custos (schema do boot: ensureColunasCustos)  →  buildCostRowsFromBase
//
// num Postgres REAL em memória (PGlite). Mostra a matriz Item × Model do
// arquivo e quantas linhas o banco guarda de fato.
//
//   npm install --no-save @electric-sql/pglite@0.3
//   node scripts/shopeeBaseItemModelAudit.js "<base shopee.xlsx>"
//
// SEGURANÇA: nunca lê DATABASE_URL e nunca abre conexão de rede. O arquivo
// real tem dados de cliente: NÃO vai para o git; o script só imprime números
// e IDs de Item/Model.

process.env.DATABASE_URL = "postgres://127.0.0.1:1/shopee-base-audit-nunca-conecta";

const fs = require("fs");
const { criarBancoCustos, carregarParsePlanilha } = require("./lib/custosPglite");

const r2 = (v) => Math.round(Number(v) * 100) / 100;

function matriz(linhas) {
  const porItem = new Map();
  for (const l of linhas) {
    if (!porItem.has(l.produto_id)) porItem.set(l.produto_id, []);
    porItem.get(l.produto_id).push(l);
  }
  const multi = [...porItem.values()].filter((ls) => ls.length > 1);
  const pares = new Set(linhas.map((l) => `${l.produto_id}|${l.id_model || ""}`));
  return {
    linhas: linhas.length,
    items: porItem.size,
    models: new Set(linhas.map((l) => l.id_model).filter(Boolean)).size,
    paresItemModel: pares.size,
    linhasSemModel: linhas.filter((l) => !l.id_model).length,
    itemsCom1Model: porItem.size - multi.length,
    itemsComVariosModels: multi.length,
    maxModelsPorItem: Math.max(0, ...[...porItem.values()].map((ls) => ls.length)),
    // Arredondado a centavos: o Excel guarda 22,4199999999999 e 22,4199999999998.
    itemsComCustosDiferentes: multi.filter((ls) => new Set(ls.map((l) => r2(l.custo_produto))).size > 1).length,
    itemsComImpostosDiferentes: multi.filter((ls) => new Set(ls.map((l) => l.imposto_percentual)).size > 1).length,
    exemplos: multi.slice(0, 2).map((ls) => ({ item: ls[0].produto_id, models: ls.length })),
  };
}

async function main() {
  const arquivo = process.argv[2];
  if (!arquivo) {
    console.error('uso: node scripts/shopeeBaseItemModelAudit.js "<base shopee.xlsx>"');
    process.exit(2);
  }
  const parsePlanilha = carregarParsePlanilha();
  const linhas = parsePlanilha(fs.readFileSync(arquivo), "base.xlsx", "shopee");

  const { pool, fechar } = await criarBancoCustos();
  const baseImportService = require("../services/bases/baseImportService");

  const importado = await baseImportService.criarBaseComCustos({
    slug: "auditoria-shopee", nomeBase: "auditoria shopee", marketplace: "shopee",
    linhasPersistiveis: linhas.filter((l) => l.tem_custo !== false),
  });
  const noBanco = await pool.query(
    "SELECT produto_id, id_model, custo_produto, imposto_percentual FROM custos WHERE base_id = $1",
    [importado.baseId]
  );
  const itemsNoBanco = new Set(noBanco.rows.map((r) => r.produto_id));
  const exemplo = matriz(linhas).exemplos[0];
  const modelsDoExemploNoBanco = exemplo
    ? noBanco.rows.filter((r) => r.produto_id === exemplo.item).map((r) => r.id_model)
    : [];

  console.log(JSON.stringify({
    arquivo: matriz(linhas),
    importacao: {
      totalQueAImportacaoInforma: importado.total,
      linhasNoBanco: noBanco.rows.length,
      itemsNoBanco: itemsNoBanco.size,
      modelsNoBanco: new Set(noBanco.rows.map((r) => r.id_model).filter(Boolean)).size,
      exemplo: exemplo ? { item: exemplo.item, modelsNoArquivo: exemplo.models, modelsNoBanco: modelsDoExemploNoBanco.length } : null,
    },
  }, null, 2));
  await fechar();
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
