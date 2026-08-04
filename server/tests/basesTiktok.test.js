// server/tests/basesTiktok.test.js
// Bases de custo do TikTok Shop.
//
// O que este teste protege:
//  1. o ID do SKU do TikTok (18–19 dígitos) chega ao banco exatamente como veio
//     — sem MLB, sem Number/parseInt, sem arredondamento;
//  2. notação científica é rejeitada em vez de "reconstruída";
//  3. "tiktok" nunca é convertido em "meli" por fallback silencioso;
//  4. a planilha do TikTok é detectada (ID do SKU / custo / imposto / nomes);
//  5. o upsert grava nomes e timestamps sem duplicar linha;
//  6. Mercado Livre e Shopee continuam funcionando como antes.

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

/* ── módulos sob teste ────────────────────────────────────────────────────── */

const pool = require("../config/database");
const {
  normalizarProdutoIdTikTok,
  obterBaseAtivaPorSlug,
  upsertCustoBase,
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

  const aoaTikTok = [
    ["ID do SKU", "Nome do produto", "Nome do SKU", "Custo unitário", "Imposto (%)"],
    [ID_19, "Camiseta Dry", "Preto, G", "15,90", "8"],
    [ID_18, "Camiseta Dry", "Branco, M", "20,00", "8"],
  ];

  const preview = await analisarPlanilhaBase(planilhaBuffer(aoaTikTok), "tiktok.xlsx", { marketplace: "tiktok" });
  eq("preview mantém marketplace tiktok", preview.marketplace, "tiktok");
  eq("detecta ID do SKU", preview.colunas_detectadas.id.cabecalho, "ID do SKU");
  eq("detecta custo unitário", preview.colunas_detectadas.custo.cabecalho, "Custo unitário");
  eq("detecta imposto", preview.colunas_detectadas.imposto.cabecalho, "Imposto (%)");
  eq("detecta produto", preview.colunas_detectadas.produto_nome.cabecalho, "Nome do produto");
  eq("detecta variação", preview.colunas_detectadas.variacao_nome.cabecalho, "Nome do SKU");

  const linha = preview.dados_importacao[0];
  eq("preview preserva o ID de 19 dígitos", linha.id, ID_19);
  eq("preview traz custo normalizado", linha.custo, 15.9);
  eq("preview traz imposto decimal", linha.imposto, 0.08);
  eq("preview traz nome do produto", linha.produto_nome, "Camiseta Dry");
  eq("preview traz nome da variação", linha.variacao_nome, "Preto, G");
  eq("preview mantém id_model nulo", linha.id_model, null);
  ok("preview não tem taxa fixa", !("taxa_fixa" in linha));

  const previewCientifico = await analisarPlanilhaBase(
    planilhaBuffer([["ID do SKU", "Custo unitário"], ["1.7359074637385248E+18", "10"]]),
    "tiktok.xlsx",
    { marketplace: "tiktok" }
  );
  eq("preview ignora linha com ID científico", previewCientifico.dados_importacao.length, 0);
  ok(
    "preview alerta sobre notação científica",
    previewCientifico.alertas.some((a) => a.tipo === "id_notacao_cientifica")
  );

  // Rota legada /importar-base → parsePlanilha
  const linhasTikTok = parsePlanilha(planilhaBuffer(aoaTikTok), "tiktok.xlsx", "tiktok");
  eq("parse: preserva o ID do SKU", linhasTikTok[0].produto_id, ID_19);
  eq("parse: segundo ID preservado", linhasTikTok[1].produto_id, ID_18);
  eq("parse: mantém taxa fixa zero", linhasTikTok[0].taxa_fixa, 0);
  eq("parse: mantém id_model nulo", linhasTikTok[0].id_model, null);
  eq("parse: salva produto_nome", linhasTikTok[0].produto_nome, "Camiseta Dry");
  eq("parse: salva variacao_nome", linhasTikTok[0].variacao_nome, "Preto, G");
  eq("parse: custo lido", linhasTikTok[0].custo_produto, 15.9);
  eq("parse: imposto decimal", linhasTikTok[0].imposto_percentual, 0.08);
  ok("parse: nunca prefixa MLB no TikTok", !linhasTikTok[0].produto_id.includes("MLB"));

  throws(
    "parse: rejeita ID científico",
    () => parsePlanilha(planilhaBuffer([["ID do SKU", "Custo unitário"], ["1.7359074637385248E+18", "10"]]), "t.xlsx", "tiktok"),
    (err) => err.statusCode === 400 && /notação científica/i.test(err.payload.erro)
  );

  // CSV UTF-8 com cabeçalho acentuado ("Custo unitário") precisa ser lido.
  const csvTikTok = `ID do SKU,Nome do produto,Nome do SKU,Custo unitário,Imposto\n"${ID_19}","Camiseta","Preto, G",15.90,0.08`;
  const linhasCsv = parsePlanilha(Buffer.from(csvTikTok, "utf8"), "tiktok.csv", "tiktok");
  eq("parse CSV: ID preservado", linhasCsv[0].produto_id, ID_19);
  eq("parse CSV: custo acentuado lido", linhasCsv[0].custo_produto, 15.9);
  eq("parse CSV: variação lida", linhasCsv[0].variacao_nome, "Preto, G");

  const semCusto = parsePlanilha(
    planilhaBuffer([["ID do SKU", "Custo unitário"], [ID_19, ""], [ID_18, "9,90"]]),
    "t.xlsx",
    "tiktok"
  );
  eq("parse: linha sem custo é marcada", semCusto.find((l) => l.produto_id === ID_19).tem_custo, false);
  eq("parse: linha com custo é marcada", semCusto.find((l) => l.produto_id === ID_18).tem_custo, true);

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
    { match: /INSERT INTO custos/i, resultado: { rows: [{ base_id: 1, produto_id: ID_19, custo_produto: "15.90", imposto_percentual: "0.08", taxa_fixa: "0", id_model: null, produto_nome: "Camiseta", variacao_nome: "Preto, G", updated_at: "2026-08-04T10:00:00Z" }] } },
  ]);
  const criado = await upsertCustoBase({
    baseId: 1,
    produtoIdNorm: ID_19,
    custoProduto: 15.9,
    impostoPercentualOpt: { tem: true, numero: 0.08 },
    taxaFixaOpt: semOpt,
    idModel: "deveria ser ignorado",
    produtoNome: "Camiseta",
    variacaoNome: "Preto, G",
    marketplace: "tiktok",
  });
  const insert = stubCriar.queries.find((q) => /INSERT INTO custos/i.test(q.text));
  stubCriar.restaurar();

  eq("cria custo TikTok", criado.acao, "criado");
  eq("insert usa o ID exato", insert.params[1], ID_19);
  eq("insert força taxa fixa zero", insert.params[4], 0);
  eq("insert força id_model nulo", insert.params[5], null);
  eq("insert grava produto_nome", insert.params[6], "Camiseta");
  eq("insert grava variacao_nome", insert.params[7], "Preto, G");
  ok("insert carimba updated_at", /updated_at/.test(insert.text) && /CURRENT_TIMESTAMP/.test(insert.text));

  // ── atualização (já existe) ──
  const existente = {
    base_id: 1, produto_id: ID_19, custo_produto: "15.90", imposto_percentual: "0.08",
    taxa_fixa: "0", id_model: null, produto_nome: "Camiseta", variacao_nome: "Preto, G", updated_at: null,
  };
  const stubAtualizar = instalarPoolFalso([
    { match: /SELECT[\s\S]*FROM custos/i, resultado: { rows: [existente] } },
    { match: /UPDATE custos/i, resultado: { rows: [{ ...existente, custo_produto: "19.90" }] } },
  ]);
  const atualizado = await upsertCustoBase({
    baseId: 1,
    produtoIdNorm: ID_19,
    custoProduto: 19.9,
    impostoPercentualOpt: semOpt,        // imposto ausente → preserva
    taxaFixaOpt: { tem: true, numero: 7 }, // ignorado no TikTok
    produtoNome: "   ",                   // vazio → não sobrescreve
    variacaoNome: "Preto, GG",
    marketplace: "tiktok",
  });
  const update = stubAtualizar.queries.find((q) => /UPDATE custos/i.test(q.text));
  const tocaBase = stubAtualizar.queries.find((q) => /UPDATE bases SET updated_at/i.test(q.text));
  stubAtualizar.restaurar();

  eq("atualiza sem duplicar", atualizado.acao, "atualizado");
  eq("update mantém o mesmo produto_id", update.params[1], ID_19);
  eq("preserva imposto quando ausente", update.params[3], 0.08);
  eq("taxa TikTok continua zero mesmo se enviada", update.params[4], 0);
  eq("nome vazio não sobrescreve", update.params[6], null);
  eq("atualiza nomes não vazios", update.params[7], "Preto, GG");
  ok("update usa COALESCE para preservar nomes", /COALESCE\(\$7, produto_nome\)/.test(update.text));
  ok("atualiza custos.updated_at", /updated_at = CURRENT_TIMESTAMP/.test(update.text));
  ok("atualiza bases.updated_at", !!tocaBase);

  // ── não regressão: MELI/Shopee mantêm taxa fixa e id_model ──
  const stubMeli = instalarPoolFalso([
    { match: /SELECT[\s\S]*FROM custos/i, resultado: { rows: [{ ...existente, produto_id: "MLB1", taxa_fixa: "3", id_model: null }] } },
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
  stubMeli.restaurar();
  eq("taxa fixa continua funcionando para MELI", updateMeli.params[4], 4.5);

  const stubShopee = instalarPoolFalso([
    { match: /SELECT[\s\S]*FROM custos/i, resultado: { rows: [{ ...existente, produto_id: "555", taxa_fixa: "2", id_model: "888" }] } },
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
  stubShopee.restaurar();
  eq("ID Model continua disponível para Shopee", updateShopee.params[5], "999");
  eq("taxa fixa continua funcionando para Shopee", updateShopee.params[4], 2);
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
  ok("campo cliente não fala só de Grant ML", html.includes("Obrigatório para Mercado Livre e TikTok Shop."));
  ok("drawer tem coluna de variação", html.includes('id="bases-costs-th-variacao"'));
  ok("drawer tem coluna de atualização", html.includes('id="bases-costs-th-atualizacao"'));

  const js = fs.readFileSync(path.join(__dirname, "..", "..", "Portal", "bases.js"), "utf8");
  ok("bases.js referencia o tbody TikTok", js.includes('document.getElementById("bases-tbody-tiktok")'));
  ok("drawer usa uma única chave de marketplace", js.includes("DRAWER_MARKETPLACE") && !js.includes("DRAWER_IS_SHOPEE"));
  ok("cliente obrigatório para TikTok", js.includes('mp === "meli" || mp === "tiktok"'));

  const css = fs.readFileSync(path.join(__dirname, "..", "..", "Portal", "css", "pages", "bases-v2.css"), "utf8");
  ok("dot visual do TikTok", css.includes(".vf-bases-mp__dot--tiktok"));
  ok("grade com três colunas", css.includes("minmax(280px, 1fr) minmax(280px, 1fr)"));
}

/* ── runner ───────────────────────────────────────────────────────────────── */

async function main() {
  testeIdsTikTok();
  await testeMarketplace();
  await testeImportacao();
  await testeUpsert();
  testeTelaBases();
  console.log(`\nbasesTiktok: ok (${checks} verificações)`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
