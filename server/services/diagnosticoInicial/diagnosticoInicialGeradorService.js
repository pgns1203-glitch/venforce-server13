// Motor determinístico do Diagnóstico Inicial. O registro oficial de seções e
// campos é compartilhado com o relatório e com a interface para impedir regras
// divergentes de completude, condições, labels e formatação.

const schema = require("../../../Portal/diagnostico-inicial-schema");

function splitLinhas(texto) {
  return String(texto || "")
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter(Boolean);
}

function registroCampos(marketplace) {
  return schema.getFields(marketplace).map((field) => ({
    ...field,
    tipo: field.type === "tristate" ? "tristate" : "valor",
    positivo: field.positive,
    negativo: field.negative,
    prioridade: field.priority,
    risco: field.risk,
  }));
}

function avaliarCampos(marketplace, respostas) {
  const source = respostas && typeof respostas === "object" ? respostas : {};
  const completude = schema.evaluateCompleteness(marketplace, source);
  const resultado = {
    aplicaveis: completude.camposAplicaveis,
    preenchidos: completude.camposPreenchidos,
    completude,
    pontosPositivos: [],
    pontosNegativos: [],
    riscosUrgencias: [],
    prioridadesPrimeiraSemana: [],
    informacoesAusentes: completude.camposPendentes.map((item) => ({
      secaoId: item.sectionId,
      secao: item.sectionTitle,
      label: item.label,
      mensagem: "Não avaliado ou não informado",
    })),
  };

  for (const campo of registroCampos(marketplace)) {
    if (campo.completion === false || !schema.isApplicable(campo, source)) continue;
    const valor = schema.getPath(source, campo.path);
    if (!schema.isAnswered(campo, valor)) continue;

    if (campo.type === "tristate") {
      if (valor === "sim") {
        resultado.pontosPositivos.push(campo.positivo || `${campo.label}: Sim.`);
      } else if (valor === "nao") {
        const texto = campo.negativo || `${campo.label}: Não.`;
        if (campo.risco) resultado.riscosUrgencias.push(texto);
        else resultado.pontosNegativos.push(texto);
        if (campo.prioridade) resultado.prioridadesPrimeiraSemana.push(texto);
      }
      continue;
    }

    if (campo.risco && typeof valor === "number" && valor > 0) {
      resultado.riscosUrgencias.push(`${campo.label}: ${valor}.`);
    }
  }

  return resultado;
}

function calcularCompletudeDetalhada(marketplace, respostas) {
  return schema.evaluateCompleteness(marketplace, respostas);
}

function calcularCompletude(marketplace, respostas) {
  return calcularCompletudeDetalhada(marketplace, respostas).percentual;
}

function montarResumoExecutivo(avaliacao, marketplace) {
  const nomeMkt = marketplace === "shopee" ? "Shopee" : "Mercado Livre";
  const partes = [`Diagnóstico inicial ${nomeMkt} gerado com ${avaliacao.completude.percentual}% de completude.`];
  if (avaliacao.pontosPositivos.length) partes.push(`${avaliacao.pontosPositivos.length} ponto(s) positivo(s) identificado(s).`);
  if (avaliacao.pontosNegativos.length) partes.push(`${avaliacao.pontosNegativos.length} ponto(s) de atenção identificado(s).`);
  if (avaliacao.riscosUrgencias.length) partes.push(`${avaliacao.riscosUrgencias.length} risco(s)/urgência(s) identificado(s).`);
  if (avaliacao.informacoesAusentes.length) partes.push(`${avaliacao.informacoesAusentes.length} item(ns) ainda não avaliado(s) ou não informado(s).`);
  return partes.join(" ");
}

function gerarDiagnostico(marketplace, respostas, { geradoPor } = {}) {
  const avaliacao = avaliarCampos(marketplace, respostas);
  const out = {
    resumoExecutivo: "",
    situacaoAtual: "",
    pontosPositivos: [...avaliacao.pontosPositivos],
    pontosNegativos: [...avaliacao.pontosNegativos],
    riscosUrgencias: [...avaliacao.riscosUrgencias],
    prioridadesPrimeiraSemana: [...avaliacao.prioridadesPrimeiraSemana],
    plano30Dias: [],
    acoesMedioPrazo: [],
    informacoesAusentes: [...avaliacao.informacoesAusentes],
    conclusaoAnalista: "",
    completude: avaliacao.completude.percentual,
    completudeDetalhes: avaliacao.completude,
    geradoEm: new Date().toISOString(),
    geradoPor: geradoPor || "sistema",
  };

  const manual = (respostas && respostas.diagnosticoManual) || {};
  out.situacaoAtual = String(manual.estrategias || "").trim();
  if (manual.pontosPositivos) out.pontosPositivos.push(...splitLinhas(manual.pontosPositivos));
  if (manual.pontosNegativos) out.pontosNegativos.push(...splitLinhas(manual.pontosNegativos));
  if (manual.prioridadesUrgencias) out.prioridadesPrimeiraSemana.push(...splitLinhas(manual.prioridadesUrgencias));
  if (manual.planoAcao) out.plano30Dias.push(...splitLinhas(manual.planoAcao));

  out.resumoExecutivo = montarResumoExecutivo(avaliacao, marketplace);
  return out;
}

module.exports = {
  gerarDiagnostico,
  calcularCompletude,
  calcularCompletudeDetalhada,
  avaliarCampos,
  registroCampos,
  getPath: schema.getPath,
};
