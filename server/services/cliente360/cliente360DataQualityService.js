// server/services/cliente360/cliente360DataQualityService.js
// Motor de qualidade de dados — puro, sem SQL, sem ML.
// Recebe o `contexto` já montado pelo Service e mapeia o que impede
// a confiabilidade dos cálculos.

const RELATORIO_RECENTE_DIAS = 30;

function diasDesde(dataIso) {
  if (!dataIso) return Infinity;
  const ms = Date.now() - new Date(dataIso).getTime();
  if (!Number.isFinite(ms)) return Infinity;
  return ms / 86400000;
}

function verificarBaseVinculada(bases) {
  return Array.isArray(bases) && bases.length > 0;
}

function verificarGrant(grant) {
  return !!(grant && grant.temGrant);
}

function verificarRelatorioRecente(relatorios) {
  if (!Array.isArray(relatorios) || !relatorios.length) return false;
  const maisRecente = relatorios[0]; // já vem ORDER BY created_at DESC
  return diasDesde(maisRecente.created_at) <= RELATORIO_RECENTE_DIAS;
}

function verificarFechamentoMes(entregas, competencia) {
  if (!Array.isArray(entregas)) return false;
  const mes = String(competencia || "").split("-")[1] || "";
  return entregas.some(
    (e) =>
      e.tipo === "fechamento_mensal" &&
      (String(e.periodo || "").includes(competencia) ||
        (mes && String(e.periodo || "").includes(mes)))
  );
}

function contarAnunciosSemCusto(relatorioItens) {
  if (!Array.isArray(relatorioItens)) return null;
  return relatorioItens.filter((it) => it.tem_base === false).length;
}

// Avalia a qualidade geral e devolve score (0–100) + lista de problemas.
function avaliarQualidadeDados(contexto) {
  const { bases, grant, relatorios, entregas, periodo, relatorioItens } = contexto;
  const problemas = [];

  const temBase = verificarBaseVinculada(bases);
  const temGrant = verificarGrant(grant);
  const relatorioRecente = verificarRelatorioRecente(relatorios);
  const temFechamento = verificarFechamentoMes(entregas, periodo?.competencia);
  const semCusto = contarAnunciosSemCusto(relatorioItens);

  if (!temBase) problemas.push({ chave: "base_ausente", peso: 30, descricao: "Sem base de custo vinculada." });
  if (!temGrant) problemas.push({ chave: "grant_ausente", peso: 30, descricao: "Sem grant Mercado Livre conectado." });
  if (Array.isArray(relatorios) && relatorios.length && !relatorioRecente) {
    problemas.push({ chave: "relatorio_antigo", peso: 15, descricao: "Último diagnóstico com mais de 30 dias." });
  }
  if (!Array.isArray(relatorios) || !relatorios.length) {
    problemas.push({ chave: "sem_relatorio", peso: 15, descricao: "Nenhum diagnóstico rodado." });
  }
  if (!temFechamento) {
    problemas.push({ chave: "sem_fechamento_mes", peso: 10, descricao: "Sem fechamento do mês atual." });
  }
  if (semCusto && semCusto > 0) {
    problemas.push({
      chave: "itens_sem_custo",
      peso: Math.min(20, semCusto),
      descricao: `${semCusto} anúncio(s) sem custo cadastrado.`,
    });
  }

  const penalidade = problemas.reduce((s, p) => s + p.peso, 0);
  const score = Math.max(0, 100 - penalidade);

  return {
    score,
    problemas: problemas.map((p) => ({ chave: p.chave, descricao: p.descricao })),
    flags: {
      temBase,
      temGrant,
      relatorioRecente,
      temFechamento,
      itensSemCusto: semCusto,
    },
  };
}

module.exports = {
  avaliarQualidadeDados,
  verificarBaseVinculada,
  verificarGrant,
  verificarRelatorioRecente,
  verificarFechamentoMes,
  contarAnunciosSemCusto,
};
