const schema = require("../../../Portal/diagnostico-inicial-schema");

const clone = (value) => (value === undefined ? null : JSON.parse(JSON.stringify(value)));

function normalizeAnalysis(value) {
  const source = value && typeof value === "object" ? value : {};
  const list = (key) => (Array.isArray(source[key]) ? source[key].map((item) => String(item)) : []);
  return {
    resumoExecutivo: String(source.resumoExecutivo || ""),
    situacaoAtual: String(source.situacaoAtual || ""),
    pontosPositivos: list("pontosPositivos"),
    pontosNegativos: list("pontosNegativos"),
    riscosUrgencias: list("riscosUrgencias"),
    prioridadesPrimeiraSemana: list("prioridadesPrimeiraSemana"),
    plano30Dias: list("plano30Dias"),
    acoesMedioPrazo: list("acoesMedioPrazo"),
    conclusaoAnalista: String(source.conclusaoAnalista || ""),
  };
}

function buildSnapshot(diagnostico, { generatedAt } = {}) {
  const respostas = diagnostico?.respostas_json && typeof diagnostico.respostas_json === "object"
    ? diagnostico.respostas_json
    : {};
  const marketplace = schema.MARKETPLACES.includes(diagnostico?.marketplace) ? diagnostico.marketplace : "meli";
  const completude = schema.evaluateCompleteness(marketplace, respostas);
  const analysisSource = diagnostico?.diagnostico_revisado_json || diagnostico?.diagnostico_gerado_json || {};

  const secoes = schema.getSections(marketplace).map((section) => ({
    id: section.id,
    titulo: section.title,
    campos: section.fields
      .filter((field) => schema.isApplicable(field, respostas))
      .map((field) => ({
        label: field.label,
        tipo: field.type,
        valor: clone(schema.getPath(respostas, field.path)),
        opcoes: field.options ? clone(field.options) : undefined,
        colunas: field.columns ? clone(field.columns) : undefined,
      })),
  }));

  const informacoesAusentes = completude.secoes
    .filter((section) => section.camposPendentes.length)
    .map((section) => ({
      secao: section.title,
      itens: section.camposPendentes.map((field) => field.label),
    }));

  const analise = normalizeAnalysis(analysisSource);
  return {
    version: 1,
    generatedAt: generatedAt || new Date().toISOString(),
    titulo: "Relatório de Diagnóstico Inicial Venforce",
    cliente: {
      id: diagnostico?.cliente_id ?? null,
      nome: String(diagnostico?.cliente_nome || diagnostico?.cliente?.nome || ""),
      slug: String(diagnostico?.cliente_slug || diagnostico?.cliente?.slug || ""),
    },
    marketplace,
    marketplaceLabel: schema.MARKETPLACE_LABELS[marketplace] || marketplace,
    responsavel: { nome: String(diagnostico?.responsavel_nome || "") },
    dataDiagnostico: diagnostico?.data_diagnostico || null,
    status: diagnostico?.status || "rascunho",
    completedAt: diagnostico?.completed_at || null,
    completude,
    resumo: {
      resumoExecutivo: analise.resumoExecutivo,
      situacaoAtual: analise.situacaoAtual,
      pontosPositivos: analise.pontosPositivos.length,
      riscos: analise.riscosUrgencias.length,
      prioridades: analise.prioridadesPrimeiraSemana.length,
      informacoesAusentes: completude.camposPendentes.length,
    },
    analise,
    secoes,
    informacoesAusentes,
  };
}

module.exports = { buildSnapshot, normalizeAnalysis };
