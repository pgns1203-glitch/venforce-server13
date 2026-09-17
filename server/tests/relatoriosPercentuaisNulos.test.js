process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const XLSX = require("xlsx");
const pool = require("../config/database");
const {
  construirWorkbookMatrizPrecificacao,
  gerarExportRelatorioXlsx,
} = require("../services/automacoes/relatoriosService");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

function workbookMatriz({ comissao, imposto, margem }) {
  const buffer = construirWorkbookMatrizPrecificacao({
    resumoRows: [["Resumo", ""]],
    itens: [{
      item_id: "MLB123",
      titulo: "Produto teste",
      comissao_percentual: comissao,
      imposto_percentual: imposto,
    }],
    margemAlvoPadrao: margem,
  });
  return XLSX.read(buffer, { type: "buffer", cellNF: true });
}

function celula(workbook, sheetName, address) {
  return workbook.Sheets[sheetName]?.[address] || null;
}

function ehVazia(cell) {
  return cell === null || cell.v === null || cell.v === undefined || cell.v === "";
}

function validarPercentuaisMatriz(label, valorEntrada, valorEsperado) {
  const workbook = workbookMatriz({
    comissao: valorEntrada,
    imposto: valorEntrada,
    margem: valorEntrada,
  });
  for (const address of ["G4", "I4", "S4"]) {
    const cell = celula(workbook, "Matriz Mercado Livre", address);
    if (valorEsperado === null) {
      ok(`${label} — ${address} fica vazia`, ehVazia(cell));
    } else {
      ok(`${label} — ${address} preserva valor numérico ${valorEsperado}`, cell?.t === "n" && cell.v === valorEsperado);
      ok(`${label} — ${address} mantém formato percentual`, cell?.z === "0.00%");
    }
  }
}

async function validarResumoExportado({ label, margemAlvo, mcMedia, valorEsperado }) {
  const originalQuery = pool.query;
  pool.query = async (sql) => {
    const q = String(sql).replace(/\s+/g, " ").trim();
    if (q.startsWith("SELECT * FROM relatorios WHERE id = $1")) {
      return { rows: [{
        id: 7,
        cliente_slug: "cliente-x",
        base_slug: "base-x",
        escopo: "loja_completa",
        margem_alvo: margemAlvo,
        mc_media: mcMedia,
        total_itens: 0,
        itens_com_base: 0,
        itens_sem_base: 0,
        itens_criticos: 0,
        itens_atencao: 0,
        itens_saudaveis: 0,
        created_at: null,
      }] };
    }
    if (q.includes("FROM relatorio_itens")) return { rows: [] };
    throw new Error(`Query não mapeada no teste: ${q}`);
  };

  try {
    const resultado = await gerarExportRelatorioXlsx({ idRaw: "7" });
    const workbook = XLSX.read(resultado.buffer, { type: "buffer", cellNF: true });
    for (const address of ["B5", "B12"]) {
      const cell = celula(workbook, "Resumo", address);
      if (valorEsperado === null) {
        ok(`${label} — Resumo ${address} fica vazio`, ehVazia(cell));
      } else {
        ok(`${label} — Resumo ${address} preserva zero numérico`, cell?.t === "n" && cell.v === valorEsperado);
        ok(`${label} — Resumo ${address} mantém formato percentual`, cell?.z === "0.00%");
      }
    }
  } finally {
    pool.query = originalQuery;
  }
}

async function run() {
  validarPercentuaisMatriz("null", null, null);
  validarPercentuaisMatriz("zero real", 0, 0);
  validarPercentuaisMatriz("percentual inteiro", 12, 0.12);
  validarPercentuaisMatriz("percentual decimal", 0.12, 0.12);

  await validarResumoExportado({
    label: "null no export do relatório",
    margemAlvo: null,
    mcMedia: null,
    valorEsperado: null,
  });
  await validarResumoExportado({
    label: "zero no export do relatório",
    margemAlvo: 0,
    mcMedia: 0,
    valorEsperado: 0,
  });

  console.log(`\n✓ relatoriosPercentuaisNulos: ${checks} verificações`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
