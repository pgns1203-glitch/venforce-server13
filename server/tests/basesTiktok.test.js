// server/tests/basesTiktok.test.js
// Bases de custo do TikTok Shop — modelo product_id × sku_id.
//
// Contrato da planilha:  ID | ID DO SKU | CUSTO | IMPOSTO
//   ID        → custos.produto_id  (product_id, PODE repetir)
//   ID DO SKU → custos.sku_id      (variação, identidade do custo)
//
// O que este teste protege:
//  1. ID e ID DO SKU (18–19 dígitos) chegam ao banco exatamente como vieram
//     — sem MLB, sem Number/parseInt, sem arredondamento;
//  2. notação científica é rejeitada em vez de "reconstruída", nas DUAS colunas;
//  3. "tiktok" nunca é convertido em "meli" por fallback silencioso;
//  4. a planilha do TikTok é detectada (ID / ID DO SKU / custo / imposto);
//  5. o mesmo ID de produto com vários ID DO SKU vira várias linhas, cada uma
//     com seu custo — e ID DO SKU repetido conflitante é rejeitado;
//  6. o upsert localiza a linha por sku_id, nunca por produto_id/SKU textual;
//  7. Mercado Livre e Shopee continuam funcionando como antes.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const XLSX = require("xlsx");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}
function eq(label, actual, expected) {
  assert.strictEqual(actual, expected, `${label}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}
function throws(label, fn, testeErro) {
  let lancou = false;
  try {
    fn();
  } catch (err) {
    lancou = true;
    if (testeErro) assert.ok(testeErro(err), `FALHOU (erro inesperado): ${label} — ${err.message}`);
  }
  assert.ok(lancou, `FALHOU (não lançou): ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

const ID_18 = "173590746373852481";
const ID_19 = "1735907463738524810";

// Exemplo real do pedido: um product_id, três sku_id, custos diferentes.
const PRODUTO_ID = "1736898364814492810";
const SKU_ID_A = "1736898108355347594"; // custo 13,80
const SKU_ID_B = "1736898108355413130"; // custo 13,80
const SKU_ID_C = "1736898108355871882"; // custo  6,90

/* ── módulos sob teste ────────────────────────────────────────────────────── */

const pool = require("../config/database");
const {
  normalizarProdutoIdTikTok,
  normalizarSkuIdTikTok,
  obterBaseAtivaPorSlug,
  upsertCustoBase,
  erroSkuIdDuplicadoTikTok,
} = require("../services/bases/baseCustosService");
const {
  MARKETPLACES_SUPORTADOS,
  normalizarMarketplaceSuportado,
} = require("../services/bases/marketplacesBases");
const {
  analisarPlanilhaBase,
  normalizarIdTikTok,
  normalizarIdBase,
  normalizarIdShopee,
} = require("../services/bases/assistenteBaseService");
const {
  normalizarMarketplace,
  detectarMarketplaceBase,
  sugerirVinculo,
} = require("../services/baseVinculosService");
const { lerWorkbookPlanilha } = require("../utils/excelUtils");

/* ── parsePlanilha vive dentro de server/index.js (que sobe servidor ao ser
      requerido). Carregamos só o bloco de auxiliares num sandbox. ─────────── */

function carregarAuxiliaresIndex() {
  const fonte = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const inicio = fonte.indexOf("// AUXILIARES");
  const fim = fonte.indexOf("function gerarApiKey()");
  assert.ok(inicio > 0 && fim > inicio, "não foi possível recortar o bloco de auxiliares de index.js");

  const sandbox = {
    XLSX,
    path,
    MARKETPLACES_SUPORTADOS,
    normalizarProdutoIdTikTok,
    normalizarSkuIdTikTok,
    erroSkuIdDuplicadoTikTok,
    lerWorkbookPlanilha,
    module: { exports: {} },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(`${fonte.slice(inicio, fim)}\nmodule.exports = { parsePlanilha, normalizarMlItemId };`, sandbox);
  return sandbox.module.exports;
}

const { parsePlanilha } = carregarAuxiliaresIndex();

function planilhaBuffer(aoa, nomeAba = "Custos") {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, nomeAba);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

/* ── contrato de frontend: helpers puros de Portal/bases.js ───────────────── */

function carregarHelpersFrontend() {
  const fonte = fs.readFileSync(path.join(__dirname, "..", "..", "Portal", "bases.js"), "utf8");
  const inicio = fonte.indexOf("const MARKETPLACES_SUPORTADOS");
  const fim = fonte.indexOf("// ─── Desatualização");
  assert.ok(inicio > 0 && fim > inicio, "não foi possível recortar os helpers de Portal/bases.js");

  const sandbox = { module: { exports: {} }, console };
  vm.createContext(sandbox);
  vm.runInContext(
    `${fonte.slice(inicio, fim)}\nmodule.exports = { normalizarMarketplaceKey, marketplaceLabel, getBaseMarketplaceKey, getCoberturaBase };`,
    sandbox
  );
  return sandbox.module.exports;
}

const frontend = carregarHelpersFrontend();

/* ── pool falso: registra as queries e devolve respostas roteirizadas ─────── */

function instalarPoolFalso(respostas) {
  const queries = [];
  const original = pool.query;
  pool.query = async (text, params) => {
    queries.push({ text: String(text).replace(/\s+/g, " ").trim(), params });
    for (const r of respostas) {
      if (r.match.test(String(text))) return r.resultado;
    }
    return { rows: [], rowCount: 0 };
  };
  return { queries, restaurar: () => { pool.query = original; } };
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. IDs TikTok
   ═══════════════════════════════════════════════════════════════════════════ */
function testeIdsTikTok() {
  console.log("\n▸ IDs TikTok");

  eq("preserva 18 dígitos", normalizarProdutoIdTikTok(ID_18), ID_18);
  eq("preserva 19 dígitos", normalizarProdutoIdTikTok(ID_19), ID_19);
  eq("remove aspas simples", normalizarProdutoIdTikTok(`'${ID_19}'`), ID_19);
  eq("remove aspas duplas", normalizarProdutoIdTikTok(`"${ID_19}"`), ID_19);
  eq("remove BOM", normalizarProdutoIdTikTok(`﻿${ID_19}`), ID_19);
  eq("remove .0 seguro", normalizarProdutoIdTikTok(`${ID_19}.0`), ID_19);
  eq("remove .000 seguro", normalizarProdutoIdTikTok(`${ID_19}.000`), ID_19);
  eq("remove espaços externos", normalizarProdutoIdTikTok(`  ${ID_19}  `), ID_19);
  eq("vazio continua vazio", normalizarProdutoIdTikTok(""), "");
  eq("null continua vazio", normalizarProdutoIdTikTok(null), "");

  throws(
    "rejeita notação científica",
    () => normalizarProdutoIdTikTok("1.7359074637385248E+18"),
    (err) => err.statusCode === 400 && /notação científica/i.test(err.payload.erro)
  );
  throws(
    "rejeita notação científica minúscula",
    () => normalizarProdutoIdTikTok("1.7359074637385248e18"),
    (err) => err.statusCode === 400
  );
  throws(
    "rejeita número que já perdeu precisão",
    () => normalizarProdutoIdTikTok(1735907463738524810),
    (err) => err.statusCode === 400 && /precisão/i.test(err.payload.erro)
  );

  ok("não adiciona MLB", !normalizarProdutoIdTikTok(ID_19).includes("MLB"));
  ok("não usa arredondamento", normalizarProdutoIdTikTok(ID_19) !== String(Number(ID_19)));
  eq("não corta dígitos (comprimento)", normalizarProdutoIdTikTok(ID_19).length, 19);
  eq("número seguro vira texto", normalizarProdutoIdTikTok(12345), "12345");

  // ── ID DO SKU (sku_id) — MESMA regra de precisão, mensagem própria ──
  eq("sku_id preserva 18 dígitos", normalizarSkuIdTikTok(ID_18), ID_18);
  eq("sku_id preserva 19 dígitos", normalizarSkuIdTikTok(ID_19), ID_19);
  eq("sku_id preserva o exemplo real", normalizarSkuIdTikTok(SKU_ID_A), SKU_ID_A);
  eq("sku_id remove aspas", normalizarSkuIdTikTok(`'${SKU_ID_C}'`), SKU_ID_C);
  eq("sku_id remove .0", normalizarSkuIdTikTok(`${SKU_ID_C}.0`), SKU_ID_C);
  eq("sku_id vazio continua vazio", normalizarSkuIdTikTok(""), "");
  ok("sku_id nunca recebe MLB", !normalizarSkuIdTikTok(SKU_ID_A).includes("MLB"));
  eq("sku_id preserva byte a byte", normalizarSkuIdTikTok(SKU_ID_A), "1736898108355347594");
  ok(
    "sku_id não é o resultado de Number()",
    normalizarSkuIdTikTok(SKU_ID_A) !== String(Number(SKU_ID_A))
  );
  throws(
    "sku_id rejeita notação científica",
    () => normalizarSkuIdTikTok("1.7368981083553476E+18"),
    (err) => err.statusCode === 400 && /ID do SKU/.test(err.payload.erro) && /notação científica/i.test(err.payload.erro)
  );
  throws(
    "sku_id rejeita número que já perdeu precisão",
    () => normalizarSkuIdTikTok(1736898108355347594),
    (err) => err.statusCode === 400 && /precisão/i.test(err.payload.erro)
  );
  ok(
    "mensagem do ID do produto cita ID (não ID do SKU)",
    (() => {
      try { normalizarProdutoIdTikTok("1.7368983648144928E+18"); return false; }
      catch (err) { return /^ID TikTok/.test(err.payload.erro); }
    })()
  );

  // Versão do assistente: mesma normalização, mas devolve null em vez de lançar.
  eq("assistente preserva 19 dígitos", normalizarIdTikTok(ID_19), ID_19);
  eq("assistente remove aspas", normalizarIdTikTok(`'${ID_19}'`), ID_19);
  eq("assistente remove BOM", normalizarIdTikTok(`﻿${ID_19}`), ID_19);
  eq("assistente remove .0", normalizarIdTikTok(`${ID_19}.0`), ID_19);
  eq("assistente rejeita científico", normalizarIdTikTok("1.7359074637385248E+18"), null);
  ok("assistente não adiciona MLB", !String(normalizarIdTikTok(ID_19)).includes("MLB"));
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. Marketplace
   ═══════════════════════════════════════════════════════════════════════════ */
async function testeMarketplace() {
  console.log("\n▸ Marketplace");

  ok("lista suportada tem os três canais", ["meli", "shopee", "tiktok"].every((m) => MARKETPLACES_SUPORTADOS.includes(m)));
  eq("aceita tiktok", normalizarMarketplaceSuportado("tiktok"), "tiktok");
  eq("normaliza TikTok Shop para tiktok", normalizarMarketplaceSuportado("TikTok Shop"), "tiktok");
  eq("normaliza Tik Tok para tiktok", normalizarMarketplaceSuportado("Tik Tok"), "tiktok");
  eq("não transforma tiktok em meli", normalizarMarketplaceSuportado("TikTok"), "tiktok");
  eq("rejeita marketplace inválido", normalizarMarketplaceSuportado("kwai"), "");
  eq("meli continua meli", normalizarMarketplaceSuportado("Mercado Livre"), "meli");
  eq("shopee continua shopee", normalizarMarketplaceSuportado("Shopee"), "shopee");

  // Vínculos
  eq("vínculo: TikTok Shop → tiktok", normalizarMarketplace("TikTok Shop"), "tiktok");
  eq("vínculo: Tik Tok → tiktok", normalizarMarketplace("Tik Tok"), "tiktok");
  eq("vínculo: tiktok → tiktok", normalizarMarketplace("tiktok"), "tiktok");
  eq("vínculo: inválido → outro", normalizarMarketplace("kwai"), "outro");
  eq("vínculo: meli preservado", normalizarMarketplace("Mercado Livre"), "meli");
  eq("vínculo: shopee preservado", normalizarMarketplace("Shopee"), "shopee");
  eq("detecta base TikTok pelo nome", detectarMarketplaceBase({ nome: "Base TikTok Shop Acme", slug: "base_tiktok_acme" }), "tiktok");
  eq("detecta base TikTok pelo slug", detectarMarketplaceBase({ nome: "Acme", slug: "acme_tiktok" }), "tiktok");

  const sugestao = sugerirVinculo(
    { nome: "Base TikTok Acme Store", slug: "base_tiktok_acme_store" },
    [{ id: 7, nome: "Acme Store", slug: "acme-store" }]
  );
  ok("sugere vínculo ignorando o termo tiktok", !!sugestao && sugestao.cliente_id === 7);
  eq("sugestão vem com marketplace tiktok", sugestao.marketplace, "tiktok");

  // Resolução da base: marketplace do banco não vira meli silenciosamente.
  const stubTikTok = instalarPoolFalso([
    { match: /FROM bases WHERE slug/i, resultado: { rows: [{ id: 9, slug: "base_tiktok", marketplace: "tiktok" }] } },
  ]);
  const baseTikTok = await obterBaseAtivaPorSlug("base_tiktok");
  stubTikTok.restaurar();
  eq("base do banco com tiktok resolve tiktok", baseTikTok.marketplace, "tiktok");

  const stubInvalido = instalarPoolFalso([
    { match: /FROM bases WHERE slug/i, resultado: { rows: [{ id: 9, slug: "base_x", marketplace: "kwai" }] } },
  ]);
  let erroBase = null;
  try {
    await obterBaseAtivaPorSlug("base_x");
  } catch (err) {
    erroBase = err;
  }
  stubInvalido.restaurar();
  ok("marketplace inválido no banco não vira meli", erroBase && erroBase.statusCode === 422);

  // Assistente: marketplace não suportado é erro, não fallback.
  let erroAssistente = null;
  try {
    await analisarPlanilhaBase(planilhaBuffer([["ID do SKU", "Custo unitário"], [ID_19, 10]]), "x.xlsx", { marketplace: "kwai" });
  } catch (err) {
    erroAssistente = err;
  }
  ok("assistente rejeita marketplace inválido", erroAssistente && erroAssistente.statusCode === 400);

  // Frontend (Portal/bases.js)
  eq("frontend: tiktok → tiktok", frontend.normalizarMarketplaceKey("tiktok"), "tiktok");
  eq("frontend: TikTok Shop → tiktok", frontend.normalizarMarketplaceKey("TikTok Shop"), "tiktok");
  eq("frontend: label do tiktok", frontend.marketplaceLabel("tiktok"), "TikTok Shop");
  eq("frontend: base tiktok não vira meli", frontend.getBaseMarketplaceKey({ marketplace: "tiktok" }), "tiktok");
  eq("frontend: base desconhecida não vira meli", frontend.getBaseMarketplaceKey({ marketplace: "kwai" }), "outro");
  eq("frontend: base sem marketplace continua meli", frontend.getBaseMarketplaceKey({}), "meli");
  eq("frontend: shopee preservado", frontend.getBaseMarketplaceKey({ marketplace: "shopee" }), "shopee");
  const cobertura = frontend.getCoberturaBase({ total_skus: 10, skus_com_custo: 7 });
  eq("frontend: cobertura sem custo", cobertura.semCusto, 3);
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. Importação (assistente + rota legada)
   ═══════════════════════════════════════════════════════════════════════════ */
async function testeImportacao() {
  console.log("\n▸ Importação");

  // Planilha canônica: ID | ID DO SKU | CUSTO | IMPOSTO.
  const aoaTikTok = [
    ["ID", "ID DO SKU", "CUSTO", "IMPOSTO"],
    [PRODUTO_ID, SKU_ID_A, "13,80", "6%"],
    [PRODUTO_ID, SKU_ID_B, "13,80", "6%"],
    [PRODUTO_ID, SKU_ID_C, "6,90", "6%"],
  ];

  const preview = await analisarPlanilhaBase(planilhaBuffer(aoaTikTok), "tiktok.xlsx", { marketplace: "tiktok" });
  eq("preview mantém marketplace tiktok", preview.marketplace, "tiktok");
  eq("detecta a coluna ID (produto)", preview.colunas_detectadas.id.cabecalho, "ID");
  eq("detecta a coluna ID DO SKU", preview.colunas_detectadas.sku_id.cabecalho, "ID DO SKU");
  ok(
    "ID e ID DO SKU são colunas DIFERENTES",
    preview.colunas_detectadas.id.coluna !== preview.colunas_detectadas.sku_id.coluna
  );
  eq("detecta custo", preview.colunas_detectadas.custo.cabecalho, "CUSTO");
  eq("detecta imposto", preview.colunas_detectadas.imposto.cabecalho, "IMPOSTO");

  eq("preview traz as três variações", preview.dados_importacao.length, 3);
  const linha = preview.dados_importacao[0];
  eq("preview preserva o product_id", linha.id, PRODUTO_ID);
  eq("preview preserva o sku_id", linha.sku_id, SKU_ID_A);
  eq("preview traz custo normalizado", linha.custo, 13.8);
  eq("preview traz imposto decimal (6% → 0.06)", linha.imposto, 0.06);
  eq("preview mantém id_model nulo", linha.id_model, null);
  ok("preview não tem taxa fixa", !("taxa_fixa" in linha));
  eq("mesmo product_id nas três linhas", new Set(preview.dados_importacao.map((l) => l.id)).size, 1);
  eq("três sku_id distintos", new Set(preview.dados_importacao.map((l) => l.sku_id)).size, 3);
  eq("custo da variação C é o dela", preview.dados_importacao[2].custo, 6.9);
  ok(
    "product_id repetido NÃO é acusado como duplicidade",
    preview.resumo.duplicados === 0 && preview.resumo.conflitos === 0
  );

  // Só ID DO SKU (sem a coluna ID): importável — o cruzamento não usa product_id.
  const previewSemProduto = await analisarPlanilhaBase(
    planilhaBuffer([["ID DO SKU", "CUSTO", "IMPOSTO"], [SKU_ID_A, "13,80", "6"]]),
    "tiktok.xlsx",
    { marketplace: "tiktok" }
  );
  eq("sem coluna ID a linha continua importável", previewSemProduto.dados_importacao.length, 1);
  eq("sku_id lido mesmo sem coluna ID", previewSemProduto.dados_importacao[0].sku_id, SKU_ID_A);
  ok(
    "coluna ID ausente é aviso, não erro",
    previewSemProduto.alertas.some((a) => a.tipo === "sem_coluna_id_produto" && a.nivel === "aviso")
  );

  // Sem ID DO SKU: erro, porque é a chave do custo.
  const previewSemSkuId = await analisarPlanilhaBase(
    planilhaBuffer([["ID", "CUSTO", "IMPOSTO"], [PRODUTO_ID, "13,80", "6"]]),
    "tiktok.xlsx",
    { marketplace: "tiktok" }
  );
  ok(
    "ID DO SKU ausente é erro",
    previewSemSkuId.alertas.some((a) => a.tipo === "sem_coluna_sku_id" && a.nivel === "erro")
  );
  eq("sem ID DO SKU nada é importável", previewSemSkuId.dados_importacao.length, 0);

  const previewCientifico = await analisarPlanilhaBase(
    planilhaBuffer([["ID", "ID DO SKU", "CUSTO"], [PRODUTO_ID, "1.7368981083553476E+18", "10"]]),
    "tiktok.xlsx",
    { marketplace: "tiktok" }
  );
  eq("preview ignora linha com ID DO SKU científico", previewCientifico.dados_importacao.length, 0);
  ok(
    "preview alerta sobre notação científica",
    previewCientifico.alertas.some((a) => a.tipo === "id_notacao_cientifica")
  );

  // ID DO SKU repetido com custos diferentes → conflito sinalizado como erro.
  const previewConflito = await analisarPlanilhaBase(
    planilhaBuffer([
      ["ID", "ID DO SKU", "CUSTO"],
      [PRODUTO_ID, SKU_ID_A, "13,80"],
      [PRODUTO_ID, SKU_ID_A, "20,00"],
    ]),
    "tiktok.xlsx",
    { marketplace: "tiktok" }
  );
  ok(
    "preview acusa conflito de custo no mesmo ID DO SKU",
    previewConflito.alertas.some((a) => a.tipo === "conflito_custo" && a.nivel === "erro")
  );

  // ── Rota legada /importar-base → parsePlanilha ──
  const linhasTikTok = parsePlanilha(planilhaBuffer(aoaTikTok), "tiktok.xlsx", "tiktok");
  eq("parse: mesmo product_id gera três linhas", linhasTikTok.length, 3);
  eq("parse: produto_id da 1ª linha", linhasTikTok[0].produto_id, PRODUTO_ID);
  eq("parse: produto_id repetido na 2ª linha", linhasTikTok[1].produto_id, PRODUTO_ID);
  eq("parse: produto_id repetido na 3ª linha", linhasTikTok[2].produto_id, PRODUTO_ID);
  eq("parse: sku_id da 1ª variação", linhasTikTok[0].sku_id, SKU_ID_A);
  eq("parse: sku_id da 2ª variação", linhasTikTok[1].sku_id, SKU_ID_B);
  eq("parse: sku_id da 3ª variação", linhasTikTok[2].sku_id, SKU_ID_C);
  eq("parse: custo da variação A", linhasTikTok[0].custo_produto, 13.8);
  eq("parse: custo da variação B", linhasTikTok[1].custo_produto, 13.8);
  eq("parse: custo diferente da variação C", linhasTikTok[2].custo_produto, 6.9);
  eq("parse: imposto 6% vira 0.06", linhasTikTok[0].imposto_percentual, 0.06);
  eq("parse: mantém taxa fixa zero", linhasTikTok[0].taxa_fixa, 0);
  eq("parse: mantém id_model nulo", linhasTikTok[0].id_model, null);
  eq("parse: SKU textual não é mais exigido nem preenchido", linhasTikTok[0].sku, "");
  ok("parse: nunca prefixa MLB no product_id", !linhasTikTok[0].produto_id.includes("MLB"));
  ok("parse: nunca prefixa MLB no sku_id", !linhasTikTok[0].sku_id.includes("MLB"));
  eq("parse: sku_id preservado byte a byte (19 dígitos)", linhasTikTok[0].sku_id.length, 19);

  throws(
    "parse: rejeita ID DO SKU científico",
    () => parsePlanilha(planilhaBuffer([["ID", "ID DO SKU", "CUSTO"], [PRODUTO_ID, "1.7368981083553476E+18", "10"]]), "t.xlsx", "tiktok"),
    (err) => err.statusCode === 400 && /notação científica/i.test(err.payload.erro)
  );
  throws(
    "parse: rejeita ID (produto) científico",
    () => parsePlanilha(planilhaBuffer([["ID", "ID DO SKU", "CUSTO"], ["1.7368983648144928E+18", SKU_ID_A, "10"]]), "t.xlsx", "tiktok"),
    (err) => err.statusCode === 400 && /notação científica/i.test(err.payload.erro)
  );

  // Sem a coluna ID: aceito, produto_id fica vazio (não é inventado).
  const linhasSemProduto = parsePlanilha(
    planilhaBuffer([["ID DO SKU", "CUSTO"], [SKU_ID_A, "13,80"]]),
    "sem-produto.xlsx",
    "tiktok"
  );
  eq("parse: linha sem coluna ID é aceita", linhasSemProduto.length, 1);
  eq("parse: produto_id fica vazio (nunca inventado)", linhasSemProduto[0].produto_id, "");
  eq("parse: sku_id continua correto", linhasSemProduto[0].sku_id, SKU_ID_A);

  // ID DO SKU repetido com valores idênticos: uma linha só, sem erro.
  const linhasDuplicataIdentica = parsePlanilha(
    planilhaBuffer([
      ["ID", "ID DO SKU", "CUSTO", "IMPOSTO"],
      [PRODUTO_ID, SKU_ID_A, "13,80", "6"],
      [PRODUTO_ID, SKU_ID_A, "13,80", "6"],
    ]),
    "dup-identica.xlsx",
    "tiktok"
  );
  eq("parse: duplicata idêntica não cria duas linhas", linhasDuplicataIdentica.length, 1);

  // ID DO SKU repetido com custo divergente: 422 citando o sku_id e as linhas.
  throws(
    "parse: ID DO SKU repetido com custo divergente é rejeitado",
    () => parsePlanilha(
      planilhaBuffer([
        ["ID", "ID DO SKU", "CUSTO"],
        [PRODUTO_ID, SKU_ID_A, "13,80"],
        [PRODUTO_ID, SKU_ID_A, "20,00"],
      ]),
      "conflito.xlsx",
      "tiktok"
    ),
    (err) =>
      err.statusCode === 422 &&
      err.payload.erro.includes(SKU_ID_A) &&
      /linhas 2 e 3/.test(err.payload.erro)
  );
  ok(
    "mensagem de duplicidade cita o ID DO SKU",
    erroSkuIdDuplicadoTikTok(SKU_ID_A).includes(SKU_ID_A)
  );

  // Aliases razoáveis do cabeçalho continuam sendo aceitos.
  for (const alias of ["ID DO SKU", "ID SKU", "SKU ID", "sku_id"]) {
    const linhasAlias = parsePlanilha(
      planilhaBuffer([["ID", alias, "CUSTO"], [PRODUTO_ID, SKU_ID_C, "6,90"]]),
      "alias.xlsx",
      "tiktok"
    );
    eq(`parse: alias de cabeçalho "${alias}"`, linhasAlias[0].sku_id, SKU_ID_C);
    eq(`parse: alias "${alias}" não rouba a coluna ID`, linhasAlias[0].produto_id, PRODUTO_ID);
  }

  // CSV UTF-8: custo com ponto, "R$" e imposto em percentual.
  const csvTikTok = `ID,ID DO SKU,CUSTO,IMPOSTO\n"${PRODUTO_ID}","${SKU_ID_A}","R$ 13,80","6%"`;
  const linhasCsv = parsePlanilha(Buffer.from(csvTikTok, "utf8"), "tiktok.csv", "tiktok");
  eq("parse CSV: product_id preservado", linhasCsv[0].produto_id, PRODUTO_ID);
  eq("parse CSV: sku_id preservado", linhasCsv[0].sku_id, SKU_ID_A);
  eq("parse CSV: custo com R$ lido", linhasCsv[0].custo_produto, 13.8);
  eq("parse CSV: imposto 6% lido", linhasCsv[0].imposto_percentual, 0.06);

  const semCusto = parsePlanilha(
    planilhaBuffer([["ID", "ID DO SKU", "CUSTO"], [PRODUTO_ID, SKU_ID_A, ""], [PRODUTO_ID, SKU_ID_C, "9,90"]]),
    "t.xlsx",
    "tiktok"
  );
  eq("parse: linha sem custo é marcada", semCusto.find((l) => l.sku_id === SKU_ID_A).tem_custo, false);
  eq("parse: linha com custo é marcada", semCusto.find((l) => l.sku_id === SKU_ID_C).tem_custo, true);

  // ── Não regressão MELI / Shopee ──
  const linhasMeli = parsePlanilha(
    planilhaBuffer([["ID", "Custo", "Imposto", "Taxa"], ["123456789", "10", "12", "1,5"]]),
    "meli.xlsx",
    "meli"
  );
  eq("MELI continua adicionando MLB", linhasMeli[0].produto_id, "MLB123456789");
  eq("MELI continua lendo taxa fixa", linhasMeli[0].taxa_fixa, 1.5);
  eq("MELI não recebe id_model", linhasMeli[0].id_model, null);

  const linhasShopee = parsePlanilha(
    planilhaBuffer([["ID", "Model ID", "Custo", "Imposto", "Taxa"], ["987654321", "555444333", "20", "5", "2"]]),
    "shopee.xlsx",
    "shopee"
  );
  eq("Shopee preserva o ID sem MLB", linhasShopee[0].produto_id, "987654321");
  eq("ID Model continua disponível para Shopee", linhasShopee[0].id_model, "555444333");
  eq("Shopee continua lendo taxa fixa", linhasShopee[0].taxa_fixa, 2);

  eq("normalização MELI segue prefixando MLB", normalizarIdBase("123456789"), "MLB123456789");
  eq("normalização Shopee segue sem MLB", normalizarIdShopee("123456789"), "123456789");
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. Upsert
   ═══════════════════════════════════════════════════════════════════════════ */
async function testeUpsert() {
  console.log("\n▸ Upsert");

  const semOpt = { tem: false, numero: null };

  // ── criação (não existe ainda) ──
  const stubCriar = instalarPoolFalso([
    { match: /INSERT INTO custos/i, resultado: { rows: [{ base_id: 1, produto_id: PRODUTO_ID, sku_id: SKU_ID_A, sku: "", custo_produto: "13.80", imposto_percentual: "0.06", taxa_fixa: "0", id_model: null, produto_nome: null, variacao_nome: null, updated_at: "2026-08-10T10:00:00Z" }] } },
  ]);
  const criado = await upsertCustoBase({
    baseId: 1,
    produtoIdNorm: PRODUTO_ID,
    skuIdNorm: SKU_ID_A,
    custoProduto: 13.8,
    impostoPercentualOpt: { tem: true, numero: 0.06 },
    taxaFixaOpt: semOpt,
    idModel: "deveria ser ignorado",
    marketplace: "tiktok",
  });
  const insert = stubCriar.queries.find((q) => /INSERT INTO custos/i.test(q.text));
  stubCriar.restaurar();

  eq("cria custo TikTok", criado.acao, "criado");
  eq("insert grava o produto_id exato", insert.params[1], PRODUTO_ID);
  eq("insert grava o sku_id exato", insert.params[2], SKU_ID_A);
  eq("insert força taxa fixa zero", insert.params[5], 0);
  eq("insert força id_model nulo", insert.params[6], null);
  eq("insert não grava SKU textual no TikTok", insert.params[9], "");
  ok("insert inclui a coluna sku_id", /sku_id/.test(insert.text));
  ok("insert carimba updated_at", /updated_at/.test(insert.text) && /CURRENT_TIMESTAMP/.test(insert.text));

  // sku_id é obrigatório: sem ele o upsert nem consulta o banco.
  const stubSemSkuId = instalarPoolFalso([]);
  let erroSemSkuId = null;
  try {
    await upsertCustoBase({
      baseId: 1, produtoIdNorm: PRODUTO_ID, custoProduto: 10,
      impostoPercentualOpt: semOpt, taxaFixaOpt: semOpt, marketplace: "tiktok",
    });
  } catch (e) { erroSemSkuId = e; }
  stubSemSkuId.restaurar();
  ok("upsert: TikTok sem sku_id é recusado (400)", !!erroSemSkuId && erroSemSkuId.statusCode === 400);
  ok("upsert: mensagem exige o ID DO SKU", erroSemSkuId && /ID DO SKU/.test(erroSemSkuId.payload.erro));

  // ── atualização (já existe o mesmo sku_id) ──
  const existente = {
    base_id: 1, produto_id: PRODUTO_ID, sku_id: SKU_ID_A, sku: "", custo_produto: "13.80",
    imposto_percentual: "0.06", taxa_fixa: "0", id_model: null, produto_nome: null,
    variacao_nome: null, updated_at: null,
  };
  const stubAtualizar = instalarPoolFalso([
    { match: /SELECT[\s\S]*FROM custos/i, resultado: { rows: [existente] } },
    { match: /UPDATE custos/i, resultado: { rows: [{ ...existente, custo_produto: "19.90" }] } },
  ]);
  const atualizado = await upsertCustoBase({
    baseId: 1,
    produtoIdNorm: PRODUTO_ID,
    skuIdNorm: SKU_ID_A,
    custoProduto: 19.9,
    impostoPercentualOpt: semOpt,          // imposto ausente → preserva
    taxaFixaOpt: { tem: true, numero: 7 }, // ignorado no TikTok
    marketplace: "tiktok",
  });
  const select = stubAtualizar.queries.find((q) => /SELECT[\s\S]*FROM custos/i.test(q.text));
  const update = stubAtualizar.queries.find((q) => /UPDATE custos/i.test(q.text));
  const tocaBase = stubAtualizar.queries.find((q) => /UPDATE bases SET updated_at/i.test(q.text));
  stubAtualizar.restaurar();

  eq("atualiza sem duplicar", atualizado.acao, "atualizado");
  eq("update localiza a linha pelo sku_id", update.params[1], SKU_ID_A);
  eq("preserva imposto quando ausente", update.params[4], 0.06);
  ok("select de existência filtra por base_id + sku_id", /WHERE base_id = \$1 AND sku_id = \$2/.test(select.text));
  ok("update filtra por base_id + sku_id, nunca por produto_id", /WHERE base_id = \$1 AND sku_id = \$2/.test(update.text));
  ok("update NÃO usa produto_id como filtro", !/WHERE base_id = \$1 AND produto_id/.test(update.text));
  ok("update NÃO usa SKU textual como filtro", !/LOWER\(sku\)/.test(update.text));
  ok("taxa fixa é forçada a zero no TikTok", /taxa_fixa = 0/.test(update.text));
  ok("produto_id só é sobrescrito quando vem preenchido", /produto_id = COALESCE\(NULLIF\(\$3, ''\), produto_id\)/.test(update.text));
  ok("atualiza custos.updated_at", /updated_at = CURRENT_TIMESTAMP/.test(update.text));
  ok("atualiza bases.updated_at", !!tocaBase);

  // ── mesmo product_id, sku_id diferente = registro DISTINTO ──
  const stubOutraVariacao = instalarPoolFalso([
    { match: /SELECT[\s\S]*FROM custos/i, resultado: { rows: [] } },
    { match: /INSERT INTO custos/i, resultado: { rows: [{ ...existente, sku_id: SKU_ID_C, custo_produto: "6.90" }] } },
  ]);
  const criadaOutraVariacao = await upsertCustoBase({
    baseId: 1, produtoIdNorm: PRODUTO_ID, skuIdNorm: SKU_ID_C, custoProduto: 6.9,
    impostoPercentualOpt: { tem: true, numero: 0.06 }, taxaFixaOpt: semOpt,
    marketplace: "tiktok",
  });
  const selectOutraVariacao = stubOutraVariacao.queries.find((q) => /SELECT[\s\S]*FROM custos/i.test(q.text));
  stubOutraVariacao.restaurar();
  eq("mesmo product_id + sku_id novo CRIA (não atualiza)", criadaOutraVariacao.acao, "criado");
  eq("busca de existência usa o sku_id novo", selectOutraVariacao.params[1], SKU_ID_C);

  // ── não regressão: MELI/Shopee mantêm taxa fixa, id_model e identidade ──
  const stubMeli = instalarPoolFalso([
    { match: /SELECT[\s\S]*FROM custos/i, resultado: { rows: [{ ...existente, produto_id: "MLB1", sku_id: "", taxa_fixa: "3", id_model: null }] } },
    { match: /UPDATE custos/i, resultado: { rows: [{ ...existente, produto_id: "MLB1" }] } },
  ]);
  await upsertCustoBase({
    baseId: 1,
    produtoIdNorm: "MLB1",
    custoProduto: 10,
    impostoPercentualOpt: semOpt,
    taxaFixaOpt: { tem: true, numero: 4.5 },
    marketplace: "meli",
  });
  const updateMeli = stubMeli.queries.find((q) => /UPDATE custos/i.test(q.text));
  const selectMeli = stubMeli.queries.find((q) => /SELECT[\s\S]*FROM custos/i.test(q.text));
  stubMeli.restaurar();
  eq("taxa fixa continua funcionando para MELI", updateMeli.params[4], 4.5);
  ok("MELI continua sendo localizado por produto_id", /WHERE base_id = \$1 AND produto_id = \$2/.test(selectMeli.text));
  ok("MELI nunca é localizado por sku_id", !/sku_id = /.test(selectMeli.text));
  ok("MELI mantém o UPDATE por produto_id", /WHERE base_id = \$1 AND produto_id = \$2/.test(updateMeli.text));

  const stubShopee = instalarPoolFalso([
    { match: /SELECT[\s\S]*FROM custos/i, resultado: { rows: [{ ...existente, produto_id: "555", sku_id: "", taxa_fixa: "2", id_model: "888" }] } },
    { match: /UPDATE custos/i, resultado: { rows: [{ ...existente, produto_id: "555" }] } },
  ]);
  await upsertCustoBase({
    baseId: 1,
    produtoIdNorm: "555",
    custoProduto: 10,
    impostoPercentualOpt: semOpt,
    taxaFixaOpt: { tem: true, numero: 2 },
    idModel: "999",
    marketplace: "shopee",
  });
  const updateShopee = stubShopee.queries.find((q) => /UPDATE custos/i.test(q.text));
  const selectShopee = stubShopee.queries.find((q) => /SELECT[\s\S]*FROM custos/i.test(q.text));
  stubShopee.restaurar();
  eq("ID Model continua disponível para Shopee", updateShopee.params[5], "999");
  eq("taxa fixa continua funcionando para Shopee", updateShopee.params[4], 2);
  ok("Shopee continua sendo localizada por produto_id", /WHERE base_id = \$1 AND produto_id = \$2/.test(selectShopee.text));
}

/* ═══════════════════════════════════════════════════════════════════════════
   4-bis. Schema — sku_id, índices parciais e migration
   ═══════════════════════════════════════════════════════════════════════════ */
function testeSchemaSkuId() {
  console.log("\n▸ Schema (sku_id + índices)");

  const migration = fs.readFileSync(
    path.join(__dirname, "..", "sql", "migrations", "20260810_add_sku_id_tiktok.sql"),
    "utf8"
  );
  ok("migration cria sku_id como TEXT", /ADD COLUMN IF NOT EXISTS sku_id TEXT/.test(migration));
  ok(
    "migration é idempotente na coluna",
    /ADD COLUMN IF NOT EXISTS sku_id/.test(migration)
  );
  ok(
    "migration cria índice único do TikTok por (base_id, sku_id)",
    /CREATE UNIQUE INDEX IF NOT EXISTS uq_custos_base_sku_id[\s\S]*\(base_id, sku_id\) WHERE sku_id <> ''/.test(migration)
  );
  ok(
    "migration preserva a identidade de MELI/Shopee em índice parcial",
    /uq_custos_base_produto_sku_legado[\s\S]*\(base_id, produto_id, sku\) WHERE sku_id = ''/.test(migration)
  );
  ok(
    "backfill só toca bases tiktok",
    /LOWER\(COALESCE\(b\.marketplace, ''\)\) = 'tiktok'/.test(migration)
  );
  ok(
    "backfill só copia produto_id quando ele é único na base (não cria sku_id duplicado)",
    /NOT EXISTS \([\s\S]*d\.produto_id = c\.produto_id[\s\S]*d\.id <> c\.id/.test(migration)
  );
  ok(
    "migration não tenta inventar product_id",
    /NÃO é inventado|não é inventado/i.test(migration)
  );
  ok("migration não faz DROP TABLE nem DELETE", !/DROP TABLE|DELETE FROM/i.test(migration));

  // A migration antiga não pode continuar afirmando a regra velha sem ressalva.
  const migrationAntiga = fs.readFileSync(
    path.join(__dirname, "..", "sql", "migrations", "20260804_add_custos_nomes_tiktok.sql"),
    "utf8"
  );
  ok(
    "migration de 2026-08-04 está marcada como superada quanto à chave",
    /SUPERADA/.test(migrationAntiga) && /20260810_add_sku_id_tiktok/.test(migrationAntiga)
  );

  // ensureColunasCustos (boot) precisa espelhar a migration.
  const servicoSrc = fs.readFileSync(
    path.join(__dirname, "..", "services", "bases", "baseCustosService.js"),
    "utf8"
  );
  ok("boot cria a coluna sku_id", /ADD COLUMN IF NOT EXISTS sku_id TEXT NOT NULL DEFAULT ''/.test(servicoSrc));
  ok("boot cria uq_custos_base_sku_id", /uq_custos_base_sku_id/.test(servicoSrc));
  ok("boot cria uq_custos_base_produto_sku_legado", /uq_custos_base_produto_sku_legado/.test(servicoSrc));

  // Importação: ON CONFLICT correto por marketplace (índices parciais).
  // A escrita de custos da importação foi extraída para
  // baseImportService.js (correção pós-auditoria de "Importar nova base");
  // o contrato de identidade por marketplace continua o mesmo.
  const baseImportSrc = fs.readFileSync(
    path.join(__dirname, "..", "services", "bases", "baseImportService.js"),
    "utf8"
  );
  ok(
    "import TikTok resolve conflito por (base_id, sku_id)",
    /ON CONFLICT \(base_id, sku_id\) WHERE sku_id <> ''/.test(baseImportSrc)
  );
  ok(
    "import MELI/Shopee mantém o conflito histórico",
    /ON CONFLICT \(base_id, produto_id, sku\) WHERE sku_id = ''/.test(baseImportSrc)
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. Contrato da tela /bases
   ═══════════════════════════════════════════════════════════════════════════ */
function testeTelaBases() {
  console.log("\n▸ Tela /bases");

  const html = fs.readFileSync(path.join(__dirname, "..", "..", "Portal", "bases.html"), "utf8");
  ok('opção "TikTok Shop" no modal de importação', html.includes('<option value="tiktok">TikTok Shop</option>'));
  ok("terceira seção com contagem", html.includes('id="count-tiktok"'));
  ok("tbody da seção TikTok", html.includes('id="bases-tbody-tiktok"'));
  ok("wrapper da seção TikTok", html.includes('id="wrap-tiktok"'));
  ok("estado vazio da seção TikTok", html.includes('id="empty-tiktok"'));
  ok("TikTok no modal de vínculo", (html.match(/value="tiktok"/g) || []).length >= 2);
  ok("campo cliente obrigatório só para Mercado Livre", html.includes("Obrigatório para Mercado Livre."));
  // Tabela TikTok: ID | ID DO SKU | CUSTO | IMPOSTO | ATUALIZAÇÃO | AÇÃO.
  ok("drawer tem a coluna do ID DO SKU", html.includes('id="bases-costs-th-sku"'));
  ok('coluna do TikTok se chama "ID DO SKU"', html.includes('id="bases-costs-th-sku" style="display:none;">ID DO SKU</th>'));
  ok("drawer tem coluna de atualização", html.includes('id="bases-costs-th-atualizacao"'));
  ok(
    "drawer não tem mais colunas de nome de produto/variação (TikTok)",
    !html.includes('id="bases-costs-th-produto-nome"') && !html.includes('id="bases-costs-th-variacao"')
  );
  ok("preview de importação mostra ID DO SKU", html.includes('id="preview-th-sku" style="display:none;">ID DO SKU</th>'));

  const js = fs.readFileSync(path.join(__dirname, "..", "..", "Portal", "bases.js"), "utf8");
  ok("bases.js referencia o tbody TikTok", js.includes('document.getElementById("bases-tbody-tiktok")'));
  ok("drawer usa uma única chave de marketplace", js.includes("DRAWER_MARKETPLACE") && !js.includes("DRAWER_IS_SHOPEE"));
  ok("cliente é opcional para TikTok (só MELI exige)", js.includes("function marketplaceExigeCliente(mp) {\n  return mp === \"meli\";\n}"));
  ok("formulário tem campo de ID DO SKU", js.includes('id="cost-form-sku-id"'));
  ok("formulário não tem mais campo de SKU textual", !js.includes('id="cost-form-sku"'));
  ok("formulário não pede mais nome de produto/variação", !js.includes('id="cost-form-produto-nome"'));
  ok("upsert envia sku_id no TikTok", js.includes("payload.sku_id = skuId"));
  ok("atualização por planilha envia sku_id", js.includes('payload.sku_id = linha.sku_id || ""'));
  ok(
    "classificação da planilha usa a mesma identidade do servidor",
    js.includes("function chaveIdentidadePlanilha(linha, isTiktok)")
  );
  ok("CSV do assistente segue o contrato canônico", js.includes('"ID,ID DO SKU,CUSTO,IMPOSTO\\n"'));

  const css = fs.readFileSync(path.join(__dirname, "..", "..", "Portal", "css", "pages", "bases-v2.css"), "utf8");
  ok("dot visual do TikTok", css.includes(".vf-bases-mp__dot--tiktok"));
  ok("grade das seções tem duas colunas fluidas", /grid-template-columns:\s*minmax\([^)]+\)\s+minmax\([^)]+\)/.test(css));
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. Cliente opcional na Base TikTok (criação/importação/vínculo)
   ═══════════════════════════════════════════════════════════════════════════ */
function testeClienteOpcionalTikTok() {
  console.log("\n▸ Cliente opcional (Base TikTok)");

  // 1/2. Base TikTok criada/importada sem cliente: a rota /importar-base não
  // lê nem exige cliente_slug em nenhum ponto — a base TikTok é persistida
  // (INSERT INTO bases + custos) sem qualquer referência a cliente.
  const indexSrc = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const inicioRota = indexSrc.indexOf('app.post("/importar-base"');
  const fimRota = indexSrc.indexOf("// DESABILITAR BASE");
  ok("rota /importar-base localizada", inicioRota > 0 && fimRota > inicioRota);
  const rotaImportar = indexSrc.slice(inicioRota, fimRota);
  ok(
    "importação de base NÃO exige nem lê cliente_slug",
    !/cliente_slug|clienteSlug/.test(rotaImportar)
  );

  // 3. Cliente opcional ainda pode ser vinculado: o vínculo só acontece se um
  // clienteId for explicitamente informado (fluxo best-effort no frontend).
  const basesJsSrc = fs.readFileSync(path.join(__dirname, "..", "..", "Portal", "bases.js"), "utf8");
  ok(
    "vínculo automático só ocorre com clienteId informado (nunca vazio)",
    /if \(!VINCULOS_EDITAVEIS \|\| !clienteId\) return;/.test(basesJsSrc)
  );
  ok(
    "endpoint de vínculo manual exige cliente_id explicitamente (não é chamado sem ele)",
    /criarVinculoManual/.test(fs.readFileSync(path.join(__dirname, "..", "services", "baseVinculosService.js"), "utf8"))
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   7. GET /bases/:baseId — não colapsa linhas com o mesmo produto_id (TikTok)
   ═══════════════════════════════════════════════════════════════════════════ */
function testeGetBaseMultiSku() {
  console.log("\n▸ GET /bases/:baseId — chave composta no TikTok");

  const indexSrc = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const inicio = indexSrc.indexOf("// BUSCAR CUSTOS DE UMA BASE");
  const fim = indexSrc.indexOf("// IMPORTAR PLANILHA");
  ok("rota GET /bases/:baseId localizada", inicio > 0 && fim > inicio);
  const rota = indexSrc.slice(inicio, fim);
  ok(
    "chave do dicionário é o sku_id no TikTok (evita colapsar variações do mesmo produto)",
    /const chave = row\.sku_id\s*\?\s*row\.sku_id/.test(rota)
  );
  ok("resposta expõe produto_id explicitamente por item", /produto_id: row\.produto_id/.test(rota));
  ok("resposta expõe sku_id por item", /sku_id: row\.sku_id \|\| null/.test(rota));
  ok("SELECT lê a coluna sku_id", /SELECT produto_id, sku_id/.test(rota));
}

/* ── runner ───────────────────────────────────────────────────────────────── */

async function main() {
  testeIdsTikTok();
  await testeMarketplace();
  await testeImportacao();
  await testeUpsert();
  testeSchemaSkuId();
  testeClienteOpcionalTikTok();
  testeGetBaseMultiSku();
  testeTelaBases();
  console.log(`\nbasesTiktok: ok (${checks} verificações)`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
