// server/services/motorMargem/marginRealizadoPeriodo.js
// Período e cobertura do REALIZADO da Central de Margem — módulo puro.
//
// ── POR QUE O PADRÃO TERMINA ONTEM ──────────────────────────────────────────
// O sync noturno da Central de Vendas publica o mês corrente só ATÉ ONTEM
// (centralVendasNoturnoService.calcularPeriodosNoturnos) e a seleção M4 só
// aceita um import publicado cuja cobertura CONTÉM o trecho pedido
// (centralVendasRepository.coberturaContemSegmento). Um período que termina
// HOJE faz o import do mês corrente ser recusado — e o mês inteiro sumia do
// realizado sem aviso (docs/AUDITORIA_REALIZADO_MARGIN_SYNC.md R-01). O padrão
// passa a ser "últimos 30 dias até ontem" no fuso da operação
// (America/Sao_Paulo, o mesmo do noturno). A regra M4 NÃO muda.
//
// ── COBERTURA ────────────────────────────────────────────────────────────────
// Quando mesmo assim um trecho do período não é coberto (período
// personalizado até hoje, mês sem sync, run que não publicou), a leitura diz
// qual mês ficou de fora e até onde há dado publicado — nunca "sem venda".
//
// Formatos aceitos para o período (nenhum store novo):
//   dateFrom/dateTo  YYYY-MM-DD explícitos (personalizado)
//   periodo          YYYY-MM — o MESMO parâmetro global do Shell
//                    (vf-context getPeriodoParam, MASTER_SPEC §8.5)
//   (nada)           últimos 30 dias até ontem

const { hojeNoFuso, TIMEZONE } = require("../centralVendas/centralVendasNoturnoService");

const DIAS_PADRAO = 30;
const PERIODO_MES = /^\d{4}-(0[1-9]|1[0-2])$/;

const ESTADOS_REALIZADO = {
  // Todo o período coberto por imports publicados com cobertura declarada.
  ATUAL: "ATUAL",
  // Todo o período tem import, mas ao menos um mês é legado (anterior à
  // publicação M4): não há cobertura declarada para afirmar "atual".
  NAO_DECLARADA: "NAO_DECLARADA",
  // Algum mês do período não tem import que o cubra inteiro (ver `lacunas`,
  // que dizem até onde há dado publicado).
  PARCIAL: "PARCIAL",
  // Nenhum dado publicado (nem parcial) toca o período.
  SEM_SINCRONIZACAO: "SEM_SINCRONIZACAO",
};

function ultimoDiaDoMes(ano, mes) {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [ano, mes, dia] = value.split("-").map(Number);
  return mes >= 1 && mes <= 12 && dia >= 1 && dia <= ultimoDiaDoMes(ano, mes);
}

// Aritmética de CALENDÁRIO sobre "YYYY-MM-DD" (meio-dia UTC evita qualquer
// deslocamento de fuso/horário de verão).
function somarDias(iso, dias) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function formatarBr(iso) {
  const [ano, mes, dia] = String(iso).split("-");
  return `${dia}/${mes}/${ano}`;
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/**
 * @returns {{ modo: "ultimos30"|"mes"|"personalizado", dateFrom, dateTo,
 *   rotulo, periodo: string|null, referencia: { hoje, ontem, fuso } }}
 */
function resolverPeriodoRealizado({ dateFrom, dateTo, periodo = null, now = new Date() } = {}) {
  const hoje = hojeNoFuso(now);
  const ontem = somarDias(hoje, -1);
  const referencia = { hoje, ontem, fuso: TIMEZONE };

  if (isIsoDate(dateFrom) && isIsoDate(dateTo)) {
    const inicio = dateFrom <= dateTo ? dateFrom : dateTo;
    const fim = dateFrom <= dateTo ? dateTo : dateFrom;
    return {
      modo: "personalizado", dateFrom: inicio, dateTo: fim, periodo: null, referencia,
      rotulo: `${formatarBr(inicio)} a ${formatarBr(fim)}`,
    };
  }

  if (typeof periodo === "string" && PERIODO_MES.test(periodo)) {
    const [ano, mes] = periodo.split("-").map(Number);
    const inicio = `${periodo}-01`;
    const fimDoMes = `${periodo}-${String(ultimoDiaDoMes(ano, mes)).padStart(2, "0")}`;
    // Mês corrente: até ontem (o que o noturno publica). No dia 1 o mês ainda
    // não tem dia fechado — o período vira só o dia 1 e a cobertura explica.
    let fim = fimDoMes < ontem ? fimDoMes : ontem;
    if (fim < inicio) fim = inicio;
    const nomeMes = `${MESES[mes - 1]}/${ano}`;
    return {
      modo: "mes", dateFrom: inicio, dateTo: fim, periodo, referencia,
      rotulo: fim < fimDoMes ? `${nomeMes} (até ${formatarBr(fim)})` : nomeMes,
    };
  }

  return {
    modo: "ultimos30",
    dateFrom: somarDias(ontem, -(DIAS_PADRAO - 1)),
    dateTo: ontem,
    periodo: null,
    referencia,
    rotulo: `Últimos ${DIAS_PADRAO} dias (até ${formatarBr(ontem)})`,
  };
}

function maxIso(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return a > b ? a : b;
}

/**
 * Resume o diagnóstico por competência (centralVendasRepository
 * .diagnosticarCompetencias) em cobertura do período.
 */
function resumirCobertura({ competencias = [] } = {}) {
  const lacunas = [];
  const origens = new Set();
  let meses = 0;
  let mesesComImport = 0;
  let sincronizadoAte = null;
  let ultimaPublicacaoEm = null;
  let ultimoImportEm = null;

  for (const c of competencias) {
    meses += 1;
    const sel = c.selecionado;
    if (sel) {
      mesesComImport += 1;
      origens.add(sel.publicationStatus || "desconhecido");
      if (sel.publicationStatus === "published" && sel.coverageTo) {
        const ate = sel.coverageTo < c.segmento.dateTo ? sel.coverageTo : c.segmento.dateTo;
        sincronizadoAte = maxIso(sincronizadoAte, ate);
      }
      ultimaPublicacaoEm = maxIso(ultimaPublicacaoEm, sel.publishedAt);
      ultimoImportEm = maxIso(ultimoImportEm, sel.createdAt);
      continue;
    }
    const parcial = c.publicadoMaisRecente;
    if (parcial && parcial.coverageTo) sincronizadoAte = maxIso(sincronizadoAte, parcial.coverageTo);
    if (parcial) ultimaPublicacaoEm = maxIso(ultimaPublicacaoEm, parcial.publishedAt);
    lacunas.push({
      competencia: c.competencia,
      segmento: c.segmento,
      motivo: parcial ? "COBERTURA_INSUFICIENTE" : "SEM_IMPORT_PUBLICADO",
      publicadoDe: parcial ? parcial.coverageFrom : null,
      publicadoAte: parcial ? parcial.coverageTo : null,
      publicadoEm: parcial ? parcial.publishedAt : null,
    });
  }

  // "Sem sincronização" só quando NADA publicado toca o período. Havendo
  // publicação que não cobre o trecho pedido (ex.: mês corrente até ontem), o
  // estado é PARCIAL e a lacuna diz até onde há dado.
  const temPublicacaoParcial = lacunas.some((l) => l.publicadoAte);
  let estado;
  if (!meses || (mesesComImport === 0 && !temPublicacaoParcial)) estado = ESTADOS_REALIZADO.SEM_SINCRONIZACAO;
  else if (lacunas.length) estado = ESTADOS_REALIZADO.PARCIAL;
  else if (origens.size === 1 && origens.has("published")) estado = ESTADOS_REALIZADO.ATUAL;
  else estado = ESTADOS_REALIZADO.NAO_DECLARADA;

  return {
    estado,
    meses,
    mesesComImport,
    origem: origens.size === 0 ? null : origens.size === 1 ? Array.from(origens)[0] : "misto",
    sincronizadoAte,
    ultimaPublicacaoEm,
    ultimoImportEm,
    lacunas,
    competencias,
  };
}

module.exports = {
  DIAS_PADRAO,
  ESTADOS_REALIZADO,
  resolverPeriodoRealizado,
  resumirCobertura,
  somarDias,
  isIsoDate,
};
