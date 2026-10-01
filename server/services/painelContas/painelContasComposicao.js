// server/services/painelContas/painelContasComposicao.js
// Composição do faturamento POR CONTA — apresentação, não fórmula.
//
//   Faturamento bruto  (regra da Cliente 360 V1: TODOS os pedidos do período,
//                       cancelados inclusos)
//   − cancelamentos
//   − devoluções concluídas
//   − devoluções em andamento
//   − mediações em aberto
//   − outros pedidos com problema (só aparece se existir)
//   = pedidos válidos  →  conferido contra o FAT oficial do import
//
// Tudo sai do MESMO import que alimenta o FAT da conta na lista (escolhido por
// selecionarMelhorImportPorCompetencia) e de TODOS os pedidos persistidos
// nele — o mesmo conjunto sobre o qual buildResumoCentralVendas calculou o
// FAT. O FAT exibido continua sendo o `resumo_json.faturamento` do import; a
// soma dos válidos aqui só o CONFERE (reconciliação), nunca o substitui.
//
// Cada pedido cai em exatamente UM grupo (UNIQUE (import_id, pedido_id) no
// banco + classificação exclusiva abaixo). "Válido" é decidido pelo mesmo
// predicado da Central (pedidoEntraNoResultado); os grupos de exclusão só
// detalham o que esse predicado tirou.
//
// Limite conhecido (Etapa A §5): o valor por pedido é Σ unit_price × qty dos
// itens (a base do FAT), não o `total_amount` da Orders API que a V1 lê ao
// vivo — `total_amount` não é persistido. O universo de pedidos é o da V1.

const { normalizePedidoStatus, pedidoEntraNoResultado } = require("../centralVendas/centralVendasService");

const GRUPOS_EXCLUSAO = ["cancelamentos", "devolucoes", "devolucoesEmAndamento", "mediacoes", "outrosProblemas"];
const TOLERANCIA = 0.005; // meio centavo: as duas somas são de valores em centavos

function round2(v) {
  return Math.round((Number(v) + Number.EPSILON) * 100) / 100;
}

function numeroOuNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function dia(v) {
  if (!v) return null;
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

// Grupo de UM pedido. `posVendaTipo` vem do payload persistido pela Central
// (classificarClaimsDoPedido); o texto do status cobre os imports de planilha,
// que não têm claim.
function classificarPedido(status, posVendaTipo) {
  if (pedidoEntraNoResultado({ status })) return "validos";
  const tipo = String(posVendaTipo || "").toLowerCase();
  const texto = String(status || "").toLowerCase();
  if (normalizePedidoStatus(status) === "cancelado") {
    return tipo === "devolucao" || (!tipo && /devolu|reembolso/.test(texto)) ? "devolucoes" : "cancelamentos";
  }
  // com_problema: claim aberto (Central) ou status de planilha.
  if (tipo === "devolucao") return "devolucoesEmAndamento";
  if (tipo === "mediacao" || (!tipo && /media/.test(texto))) return "mediacoes";
  return "outrosProblemas";
}

function grupoVazio() {
  return { pedidos: 0, valor: 0 };
}

/**
 * @param {object} imp     linha de listarImportsDaCompetencia (o import escolhido)
 * @param {Array}  linhas  agregados de listarComposicaoDosImports DESTE import:
 *                         {status, pos_venda_tipo, pedidos, sem_valor, faturamento}
 */
function montarComposicaoConta(imp, linhas = []) {
  const grupos = { validos: grupoVazio() };
  for (const g of GRUPOS_EXCLUSAO) grupos[g] = grupoVazio();
  let pedidosSemValor = 0;

  for (const l of linhas) {
    const g = classificarPedido(l.status, l.pos_venda_tipo);
    grupos[g].pedidos += Number(l.pedidos) || 0;
    grupos[g].valor += Number(l.faturamento) || 0;
    pedidosSemValor += Number(l.sem_valor) || 0;
  }
  for (const g of Object.keys(grupos)) grupos[g].valor = round2(grupos[g].valor);

  const exclusoes = Object.fromEntries(GRUPOS_EXCLUSAO.map((g) => [g, grupos[g]]));
  const totalExcluido = {
    pedidos: GRUPOS_EXCLUSAO.reduce((s, g) => s + grupos[g].pedidos, 0),
    valor: round2(GRUPOS_EXCLUSAO.reduce((s, g) => s + grupos[g].valor, 0)),
  };
  const bruto = {
    pedidos: grupos.validos.pedidos + totalExcluido.pedidos,
    valor: round2(grupos.validos.valor + totalExcluido.valor),
  };
  const fat = numeroOuNull(imp?.faturamento);
  const diferenca = fat === null ? null : round2(fat - grupos.validos.valor);

  return {
    importId: imp ? Number(imp.id) : null,
    periodo: { de: dia(imp?.coverage_date_from), ate: dia(imp?.coverage_date_to) },
    fonte: imp?.publication_status === "legacy" ? "planilha" : "api",
    bruto,
    exclusoes,
    totalExcluido,
    validos: grupos.validos,
    fat,
    pedidosSemValor,
    reconciliacao: {
      fecha: diferenca !== null && Math.abs(diferenca) < TOLERANCIA,
      diferenca,
    },
  };
}

// Soma das contas — o consolidado do cliente. Não substitui as contas: só
// existe ao lado delas. Fecha apenas se TODAS as contas fecham e nenhum pedido
// aparece em duas contas (`sobreposicao` vem do banco, ver repositório).
function somarComposicoes(composicoes = [], sobreposicao = { pedidos: 0, valor: 0 }) {
  const lista = composicoes.filter(Boolean);
  if (!lista.length) return null;
  const somaGrupo = (ler) => ({
    pedidos: lista.reduce((s, c) => s + ler(c).pedidos, 0),
    valor: round2(lista.reduce((s, c) => s + ler(c).valor, 0)),
  });
  const fats = lista.map((c) => c.fat);
  const fat = fats.some((v) => v === null) ? null : round2(fats.reduce((s, v) => s + v, 0));
  const inicios = lista.map((c) => c.periodo.de).filter(Boolean).sort();
  const fins = lista.map((c) => c.periodo.ate).filter(Boolean).sort();
  const pedidosSobrepostos = Number(sobreposicao?.pedidos) || 0;
  const diferenca = fat === null ? null : round2(fat - somaGrupo((c) => c.validos).valor);

  return {
    contas: lista.length,
    periodo: {
      de: inicios[0] || null,
      ate: fins[fins.length - 1] || null,
      // Uma conta parada em 29/09 e outra em 30/09: a soma mistura períodos.
      diferente: new Set(lista.map((c) => `${c.periodo.de}|${c.periodo.ate}`)).size > 1,
    },
    bruto: somaGrupo((c) => c.bruto),
    exclusoes: Object.fromEntries(GRUPOS_EXCLUSAO.map((g) => [g, somaGrupo((c) => c.exclusoes[g])])),
    totalExcluido: somaGrupo((c) => c.totalExcluido),
    validos: somaGrupo((c) => c.validos),
    fat,
    pedidosSemValor: lista.reduce((s, c) => s + c.pedidosSemValor, 0),
    sobreposicao: { pedidos: pedidosSobrepostos, valor: round2(Number(sobreposicao?.valor) || 0) },
    reconciliacao: {
      fecha: lista.every((c) => c.reconciliacao.fecha) && pedidosSobrepostos === 0,
      diferenca,
    },
  };
}

// ── Cobertura de custos (LC/MC) ─────────────────────────────────────────────
// SINALIZAÇÃO, não fórmula: LC continua sendo Σ LC dos pedidos com custo e MC
// = LC ÷ faturamento com custo, exatamente como hoje. Isto só diz quanto do
// FAT exibido está coberto pela base que gerou LC/MC.
//
//   null      → não há o que sinalizar (LC ausente já aparece "—", ou FAT ≤ 0)
//   completa  → a base do LC é o FAT inteiro
//   parcial   → parte do FAT não tem custo: LC/MC valem só para a parte coberta
function coberturaCustos({ fat, lc, baseLc }) {
  const f = numeroOuNull(fat);
  const b = numeroOuNull(baseLc);
  if (numeroOuNull(lc) === null || f === null || f <= 0 || b === null) return null;
  const coberta = Math.max(0, Math.min(b, f));
  const parcial = f - coberta >= TOLERANCIA;
  return {
    estado: parcial ? "parcial" : "completa",
    cobertura: parcial ? Math.floor((coberta / f) * 1000) / 1000 : 1,
    faturamentoComCusto: round2(coberta),
    faturamentoSemCusto: round2(f - coberta),
  };
}

module.exports = {
  GRUPOS_EXCLUSAO,
  classificarPedido,
  montarComposicaoConta,
  somarComposicoes,
  coberturaCustos,
};
