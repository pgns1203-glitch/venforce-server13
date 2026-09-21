// server/services/painelContas/painelContasService.js
// Orquestrador do Painel de Controle de Contas por Squad (Auditoria §13).
//
// `resolvePortfolioClientes`/`assertClienteNaCarteira` são SEMPRE o primeiro
// passo — squadId/busca/ano são filtros aplicados DEPOIS, sobre o conjunto já
// autorizado pelo servidor. Nunca o contrário: filtro enviado pelo frontend é
// preferência de exibição, nunca fonte de autorização (Auditoria §15).
//
// Nenhuma consulta financeira roda por cliente em loop — tudo em lote,
// mesmo padrão de dashboardService.loadProductionData / meService (§18/§19).

const pool = require("../../config/database");
const { resolvePortfolioClientes, assertClienteNaCarteira } = require("../squads/authorizationService");
const squadsRepo = require("../squads/squadsRepository");
const cliente360Repo = require("../cliente360/cliente360Repository");
const repo = require("./painelContasRepository");
const { deriveResumo } = require("./painelContasMetricas");
const { variacaoResumo, sanitizarParaJson } = require("./painelContasVariacao");
const { DEFINICAO: DEFINICAO_SEMANA, agruparEmSemanas } = require("./painelContasSemanas");

function anoAtualUTC() {
  return new Date().getUTCFullYear();
}

function anoValido(ano) {
  const n = Number(ano);
  return Number.isInteger(n) && n > 2000 && n < 2100 ? n : null;
}

function normalizarBusca(valor) {
  return String(valor || "").trim().toLowerCase();
}

function competenciaAnterior(competencia) {
  const [ano, mes] = String(competencia).split("-").map(Number);
  const d = new Date(Date.UTC(ano, mes - 1 - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// GET /painel-contas?ano=&squadId=&busca= — lista inicial (§13/§25).
async function listar(user, { ano, squadId, busca } = {}) {
  const autorizados = await resolvePortfolioClientes(user, pool);
  const idsAutorizados = autorizados.map((c) => c.id);

  await squadsRepo.ensureSquadsTables();
  const [squadsUsuario, squadPorCliente] = await Promise.all([
    squadsRepo.membershipsDoUsuario(user.id),
    squadsRepo.squadsAtivosDeClientes(idsAutorizados),
  ]);
  const squadDoClienteMap = new Map(squadPorCliente.map((r) => [r.cliente_id, r]));

  const anoNum = anoValido(ano);
  const squadIdNum = squadId != null && squadId !== "" ? Number(squadId) : null;
  const buscaNorm = normalizarBusca(busca);

  // Filtro de squad/busca sobre o conjunto JÁ autorizado — nunca substitui a
  // autorização (§15).
  const filtrados = autorizados.filter((c) => {
    if (squadIdNum != null) {
      const s = squadDoClienteMap.get(c.id);
      if (!s || s.squad_id !== squadIdNum) return false;
    }
    if (buscaNorm) {
      const alvo = `${c.nome || ""} ${c.slug || ""}`.toLowerCase();
      if (!alvo.includes(buscaNorm)) return false;
    }
    return true;
  });

  const linhas = await repo.listarUltimosResumos(filtrados.map((c) => c.id), { ano: anoNum });
  const resumoPorCliente = new Map(linhas.map((r) => [r.clienteId, r]));

  const clientes = filtrados.map((c) => {
    const row = resumoPorCliente.get(c.id) || null;
    const s = squadDoClienteMap.get(c.id) || null;
    return {
      id: c.id,
      slug: c.slug,
      nome: c.nome,
      squad: s ? { id: s.squad_id, nome: s.squad_nome, slug: s.squad_slug } : null,
      ultimoMesDisponivel: row ? row.competencia : null,
      sincronizadoEm: row ? row.sincronizadoEm : null,
      resumo: row ? deriveResumo(row) : null,
    };
  });

  return sanitizarParaJson({
    ok: true,
    squadsDoUsuario: squadsUsuario.map((s) => ({
      id: s.squad_id, nome: s.squad_nome, slug: s.squad_slug, principal: s.is_primary === true,
    })),
    clientes,
  });
}

// GET /painel-contas/:clienteId/meses?ano= (§13/§25).
async function listarMeses(user, clienteRef, { ano } = {}) {
  const cliente = await assertClienteNaCarteira(user, clienteRef, pool);
  const anoNum = anoValido(ano) || anoAtualUTC();
  const linhas = await repo.listarResumosDoAno(cliente.id, cliente.slug, anoNum);

  const meses = linhas.map((row, idx) => {
    const atual = deriveResumo(row);
    const anteriorRow = linhas[idx - 1];
    // Variação só contra o mês CALENDÁRIO imediatamente anterior, e só se ele
    // estiver presente no conjunto retornado — nunca contra uma competência
    // não-adjacente nem inventada.
    const anteriorEsperado = competenciaAnterior(row.competencia);
    const anterior = anteriorRow && anteriorRow.competencia === anteriorEsperado
      ? deriveResumo(anteriorRow)
      : null;
    return {
      competencia: row.competencia,
      sincronizadoEm: row.sincronizadoEm,
      resumo: atual,
      variacaoVsMesAnterior: variacaoResumo(anterior, atual),
    };
  });

  return sanitizarParaJson({
    ok: true,
    cliente: { id: cliente.id, slug: cliente.slug, nome: cliente.nome },
    meses,
  });
}

// GET /painel-contas/:clienteId/meses/:competencia/semanas (§11/§13/§25).
async function listarSemanas(user, clienteRef, competencia) {
  const cliente = await assertClienteNaCarteira(user, clienteRef, pool);
  if (!/^\d{4}-\d{2}$/.test(String(competencia || ""))) {
    const err = new Error("competencia inválida (esperado YYYY-MM).");
    err.statusCode = 400;
    throw err;
  }
  const row = await cliente360Repo.findResumoMensal(cliente.id, competencia);
  const porDia = row?.payload_json?.porDia || null;
  const semanas = agruparEmSemanas(competencia, porDia);

  return sanitizarParaJson({
    ok: true,
    competencia,
    definicaoSemana: DEFINICAO_SEMANA,
    semanas,
  });
}

module.exports = { listar, listarMeses, listarSemanas };
