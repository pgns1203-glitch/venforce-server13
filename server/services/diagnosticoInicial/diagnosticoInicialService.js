// server/services/diagnosticoInicial/diagnosticoInicialService.js
// Regras de negócio do Diagnóstico Inicial. HTTP fica no controller; SQL fica no repository.

const repo = require("./diagnosticoInicialRepository");
const gerador = require("./diagnosticoInicialGeradorService");

const MARKETPLACES = ["meli", "shopee"];
const TRISTATE_VALUES = new Set(["sim", "nao", "nao_avaliado", ""]);

function erro(statusCode, mensagem) {
  const e = new Error(mensagem);
  e.statusCode = statusCode;
  return e;
}

function isPlainObject(valor) {
  return valor != null && typeof valor === "object" && !Array.isArray(valor);
}

function normalizeMarketplace(marketplace) {
  const mkt = String(marketplace || "").trim().toLowerCase();
  if (!MARKETPLACES.includes(mkt)) {
    throw erro(400, "marketplace inválido. Use 'meli' ou 'shopee'.");
  }
  return mkt;
}

function validarData(valor) {
  if (!valor) throw erro(400, "Data inválida.");
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) throw erro(400, "Data inválida.");
}

// Regra determinística: todo número em respostas_json precisa ser finito e
// não-negativo (o domínio — faturamento, unidades, %, contagens — nunca tem
// valores negativos legítimos nos dois DOCX de origem).
function validarNumerosNaoNegativos(node, caminho = "respostas") {
  if (node === null || node === undefined) return;
  if (typeof node === "number") {
    if (!Number.isFinite(node)) throw erro(400, `${caminho}: número inválido.`);
    if (node < 0) throw erro(400, `${caminho}: não pode ser negativo.`);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, idx) => validarNumerosNaoNegativos(item, `${caminho}[${idx}]`));
    return;
  }
  if (typeof node === "object") {
    for (const [chave, valor] of Object.entries(node)) {
      validarNumerosNaoNegativos(valor, `${caminho}.${chave}`);
    }
  }
}

function validarTriStates(marketplace, respostas) {
  const campos = gerador.registroCampos(marketplace);
  for (const campo of campos) {
    if (campo.tipo !== "tristate") continue;
    const valor = gerador.getPath(respostas, campo.path);
    if (valor === undefined || valor === null) continue;
    if (!TRISTATE_VALUES.has(valor)) {
      throw erro(400, `${campo.label}: valor inválido (use "sim", "nao" ou "nao_avaliado").`);
    }
  }
}

// Valida tabelas (meses/produtos): tipo lista, limite de linhas e chave única
// (mês duplicado nas tabelas mensais, ID duplicado na tabela de produtos).
function validarTabela(lista, { campo, max = 12, chaveUnica = "mes" }) {
  if (lista == null) return;
  if (!Array.isArray(lista)) throw erro(400, `${campo} deve ser uma lista.`);
  if (lista.length > max) throw erro(400, `${campo} aceita no máximo ${max} linhas.`);
  const vistos = new Set();
  for (const linha of lista) {
    if (!isPlainObject(linha)) throw erro(400, `${campo}: cada linha deve ser um objeto.`);
    const chave = String(linha[chaveUnica] ?? "").trim().toLowerCase();
    if (!chave) continue;
    if (vistos.has(chave)) {
      throw erro(400, `${campo}: valor duplicado em "${chaveUnica}" (${linha[chaveUnica]}).`);
    }
    vistos.add(chave);
  }
}

function validarRespostas(marketplace, respostas) {
  validarNumerosNaoNegativos(respostas);
  validarTriStates(marketplace, respostas);

  validarTabela(respostas?.metricasNegocio?.meses, { campo: "Métricas de negócio", max: 12 });

  if (marketplace === "meli") {
    validarTabela(respostas?.productAds?.meses, { campo: "Product Ads", max: 12 });
  } else {
    validarTabela(respostas?.produtos?.itens, { campo: "Produtos", max: 10, chaveUnica: "id" });
    validarTabela(respostas?.shopeeAds?.meses, { campo: "Shopee Ads", max: 12 });
    validarTabela(respostas?.afiliados?.meses, { campo: "Afiliados", max: 12 });
  }
}

async function obterOuCriarRascunho({ clienteId, marketplace, responsavelUserId, dataDiagnostico }) {
  const mkt = normalizeMarketplace(marketplace);
  const clienteIdNum = parseInt(clienteId, 10);
  if (!Number.isInteger(clienteIdNum)) throw erro(400, "clienteId é obrigatório e deve ser numérico.");

  const cliente = await repo.getClienteAtivoById(clienteIdNum);
  if (!cliente) throw erro(404, "Cliente não encontrado.");

  const existente = await repo.findRascunho({ clienteId: clienteIdNum, marketplace: mkt });
  if (existente) return existente;

  if (dataDiagnostico) validarData(dataDiagnostico);

  try {
    return await repo.createDiagnostico({
      clienteId: clienteIdNum,
      marketplace: mkt,
      responsavelUserId: responsavelUserId || null,
      dataDiagnostico: dataDiagnostico || null,
      respostasJson: {},
    });
  } catch (err) {
    // Corrida entre requisições concorrentes (ex.: duplo clique): o índice
    // único parcial rejeita o segundo INSERT — nesse caso, devolve o
    // rascunho que já foi criado em vez de propagar erro 500.
    if (err && err.code === "23505") {
      const rascunho = await repo.findRascunho({ clienteId: clienteIdNum, marketplace: mkt });
      if (rascunho) return rascunho;
    }
    throw err;
  }
}

async function listar({ clienteId, marketplace }) {
  const filtro = {};
  if (clienteId !== undefined && clienteId !== "") {
    const id = parseInt(clienteId, 10);
    if (!Number.isInteger(id)) throw erro(400, "clienteId inválido.");
    filtro.clienteId = id;
  }
  if (marketplace) filtro.marketplace = normalizeMarketplace(marketplace);
  return repo.listDiagnosticos(filtro);
}

async function obterPorId(id) {
  const diagnostico = await repo.getDiagnosticoById(id);
  if (!diagnostico) throw erro(404, "Diagnóstico não encontrado.");
  return diagnostico;
}

async function atualizarRespostas(id, { respostasJson, dataDiagnostico, diagnosticoRevisadoJson }) {
  const diagnostico = await obterPorId(id);
  if (diagnostico.status === "concluido") {
    throw erro(409, "Diagnóstico já concluído não pode ser editado.");
  }

  const fields = {};

  if (respostasJson !== undefined) {
    if (!isPlainObject(respostasJson)) throw erro(400, "respostas_json deve ser um objeto.");
    validarRespostas(diagnostico.marketplace, respostasJson);
    fields.respostas_json = respostasJson;
    fields.completude = gerador.calcularCompletude(diagnostico.marketplace, respostasJson);
  }

  if (dataDiagnostico !== undefined) {
    validarData(dataDiagnostico);
    fields.data_diagnostico = dataDiagnostico;
  }

  if (diagnosticoRevisadoJson !== undefined) {
    if (!isPlainObject(diagnosticoRevisadoJson)) throw erro(400, "diagnostico_revisado_json deve ser um objeto.");
    fields.diagnostico_revisado_json = diagnosticoRevisadoJson;
  }

  if (!Object.keys(fields).length) throw erro(400, "Nenhum campo para atualizar.");

  return repo.updateDiagnostico(id, fields);
}

async function gerar(id, { geradoPor } = {}) {
  const diagnostico = await obterPorId(id);
  if (diagnostico.status === "concluido") throw erro(409, "Diagnóstico já concluído.");

  const respostas = diagnostico.respostas_json || {};
  const geradoJson = gerador.gerarDiagnostico(diagnostico.marketplace, respostas, { geradoPor });

  const fields = {
    diagnostico_gerado_json: geradoJson,
    completude: geradoJson.completude,
  };
  // Primeira geração: o rascunho editável nasce como cópia do gerado.
  // Gerações seguintes preservam edições manuais já feitas pelo gestor —
  // regenerar não sobrescreve silenciosamente o que já foi revisado.
  if (!diagnostico.diagnostico_revisado_json) {
    fields.diagnostico_revisado_json = geradoJson;
  }

  return repo.updateDiagnostico(id, fields);
}

async function concluir(id) {
  const diagnostico = await obterPorId(id);
  if (diagnostico.status === "concluido") throw erro(409, "Diagnóstico já concluído.");
  if (!diagnostico.cliente_id) throw erro(400, "Cliente é obrigatório.");
  if (!diagnostico.responsavel_user_id) throw erro(400, "Responsável é obrigatório.");
  if (!diagnostico.data_diagnostico) throw erro(400, "Data do diagnóstico é obrigatória.");
  if (!diagnostico.diagnostico_gerado_json) throw erro(400, "Gere o diagnóstico antes de concluir.");

  const revisado = diagnostico.diagnostico_revisado_json || diagnostico.diagnostico_gerado_json;
  const completude = typeof revisado.completude === "number" ? revisado.completude : diagnostico.completude;

  return repo.concluirDiagnostico(id, { diagnosticoRevisadoJson: revisado, completude });
}

module.exports = {
  obterOuCriarRascunho,
  listar,
  obterPorId,
  atualizarRespostas,
  gerar,
  concluir,
};
