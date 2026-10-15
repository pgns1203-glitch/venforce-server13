// server/scripts/meliPacoteAudit.js
//
// Auditoria de PACOTES (compra com vários produtos) num export REAL de vendas
// do Mercado Livre, contra o agrupamento que o motor faz hoje.
//
//   node scripts/meliPacoteAudit.js "<caminho do .xlsx de vendas>"
//
// Lê o arquivo pelo MESMO caminho do POST /fechamentos/financeiro
// (detectMeliHeader + parseSpreadsheet) e não grava nada. O arquivo real tem
// dados de cliente: ele NÃO vai para o git e este script só imprime números,
// N.º de venda e MLB — nunca comprador, documento ou endereço.
//
// Bloco real de pacote, como o ML exporta (out/2026):
//   PAI    Estado "Pacote de N produtos", sem MLB, com receita/tarifas/Total
//   FILHO  × N, cada um com o SEU N.º de venda, MLB, unidades e preço,
//          "Pacote de diversos produtos = Sim" e NENHUM campo financeiro

const fs = require("fs");
const { detectMeliHeader, parseSpreadsheet } = require("../utils/excelUtils");
const { normalizeText } = require("../utils/textUtils");
const meli = require("../services/fechamentoFinanceiro/meliFinanceiroService");

const r2 = (v) => Math.round(Number(v || 0) * 100) / 100;
const PACOTE_DO_PAI = /^(?:pacote|paquete) de (\d+) (?:produtos?|productos?)$/;

function auditar(rows) {
  const parsed = meli.parseMeliRows(rows);
  const estado = (i) => normalizeText(rows[i]?.Estado ?? rows[i]?.estado ?? "");
  const marcadoPacote = (i) => normalizeText(rows[i]?.["Pacote de diversos produtos"] ?? "") === "sim";
  const temFinanceiroProprio = (p) =>
    p.hasProductRevenue || p.hasFinancialTotal || p.hasSaleFee || p.hasShippingFee;

  // Blocos reais: o pai declara N; os N seguintes são os produtos.
  const blocos = [];
  for (let i = 0; i < parsed.length; i++) {
    const m = PACOTE_DO_PAI.exec(estado(i));
    if (!m || parsed[i].adId) continue;
    const n = Number(m[1]);
    const filhos = [];
    for (let k = 1; k <= n && i + k < parsed.length; k++) filhos.push(i + k);
    blocos.push({ pai: i, n, filhos });
  }

  const assoc = meli.collectMeliAssociations(parsed);
  const grupoDoPai = new Map(assoc.groups.map((g) => [g.parentIndex, g]));
  const avulsos = new Set(assoc.standaloneItems.map((s) => s.index));

  const classes = { correto: 0, parcial: 0, quebrado_no_primeiro_filho: 0, mistura_outra_linha: 0 };
  const exemplos = [];
  let filhosOrfaos = 0;
  let filhosFalsoPendente = 0;
  let receitaAfetada = 0;
  let totalAfetado = 0;
  let somaQueNaoFecha = 0;
  let filhoComFinanceiroProprio = 0;
  let filhoSemMarca = 0;
  let filhoMesmaVenda = 0;

  for (const b of blocos) {
    const pai = parsed[b.pai];
    const g = grupoDoPai.get(b.pai);
    const associados = g ? g.detailIndexes : [];
    const esperados = new Set(b.filhos);
    const intrusos = associados.filter((j) => !esperados.has(j));
    const certos = associados.filter((j) => esperados.has(j)).length;

    let classe;
    if (intrusos.length > 0) classe = "mistura_outra_linha";
    else if (certos === b.n) classe = "correto";
    else if (certos === 0) classe = "quebrado_no_primeiro_filho";
    else classe = "parcial";
    classes[classe] += 1;

    const orfaos = b.filhos.filter((j) => !associados.includes(j));
    filhosOrfaos += orfaos.length;
    filhosFalsoPendente += orfaos.filter((j) => avulsos.has(j) && !parsed[j].hasFinancialTotal).length;
    if (classe !== "correto") {
      receitaAfetada += pai.productRevenue;
      totalAfetado += pai.total;
      if (exemplos.length < 3) {
        exemplos.push({
          linha: b.pai + 1,
          venda: pai.saleNumber,
          receita: pai.productRevenue,
          total: pai.total,
          classe,
          filhos: b.filhos.map((j) => `${parsed[j].saleNumber} → ${parsed[j].adId}`),
        });
      }
    }

    b.filhos.forEach((j) => {
      if (temFinanceiroProprio(parsed[j])) filhoComFinanceiroProprio += 1;
      if (!marcadoPacote(j)) filhoSemMarca += 1;
      if (parsed[j].saleNumber === pai.saleNumber) filhoMesmaVenda += 1;
    });
    const somaFilhos = r2(b.filhos.reduce((s, j) => s + parsed[j].units * parsed[j].unitSalePrice, 0));
    if (Math.abs(somaFilhos - pai.productRevenue) > 0.005) somaQueNaoFecha += 1;
  }

  return {
    linhas: rows.length,
    pacotes: blocos.length,
    filhos: blocos.reduce((s, b) => s + b.filhos.length, 0),
    distribuicaoN: blocos.reduce((m, b) => ((m[b.n] = (m[b.n] || 0) + 1), m), {}),
    evidencias: {
      filhosComFinanceiroProprio: filhoComFinanceiroProprio,
      filhosSemMarcaPacote: filhoSemMarca,
      filhosComMesmoNumeroDoPai: filhoMesmaVenda,
      pacotesOndeSomaDosFilhosNaoFechaComReceitaDoPai: somaQueNaoFecha,
    },
    motorAtual: {
      classes,
      filhosOrfaos,
      filhosComoFinanceiroPendente: filhosFalsoPendente,
      receitaPorProdutosAfetada: r2(receitaAfetada),
      totalBrlAfetado: r2(totalAfetado),
    },
    exemplos,
  };
}

if (require.main === module) {
  const arquivo = process.argv[2];
  if (!arquivo) {
    console.error('uso: node scripts/meliPacoteAudit.js "<vendas.xlsx>"');
    process.exit(2);
  }
  const buf = fs.readFileSync(arquivo);
  const rows = parseSpreadsheet(buf, detectMeliHeader(buf).rowIndex);
  console.log(JSON.stringify(auditar(rows), null, 2));
}

module.exports = { auditar };
