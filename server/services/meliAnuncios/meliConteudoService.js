// server/services/meliAnuncios/meliConteudoService.js
// -----------------------------------------------------------------------------
// Módulo: Anúncios Meli — edição real de conteúdo do anúncio no Mercado Livre.
//
// Existe por uma razão só: até aqui, os campos "Título", "Modelo" e "Descrição"
// eram editáveis na tela e não iam a lugar nenhum (achado F-03 da auditoria).
// O detalhe novo (modal) os torna persistentes — e "persistente" aqui significa
// escrever no ANÚNCIO REAL, não no snapshot local:
//
//   Portal → controller → ClienteConta/ml_user_id → grant/token → API do ML
//          → confirmação → atualização do snapshot local → UI
//
// Regras:
//  - uma chamada ao ML POR CAMPO. Título e Modelo caberiam num único
//    PUT /items/{id}, mas aí uma recusa do ML no título (ele restringe
//    alteração de título em item com vendas) derrubaria o modelo junto e a UI
//    não teria como dizer o que passou e o que não passou;
//  - o snapshot local (meli_anuncios) só é atualizado depois do ML CONFIRMAR.
//    Nunca "salva local e mente que salvou";
//  - `mlUserId` é obrigatório e vem de cima (do anúncio ou do contexto de
//    conta). Este service não escolhe conta nenhuma.
//
// Mapa campo → API do Mercado Livre:
//   titulo     → PUT /items/{id}                { title }
//   modelo     → PUT /items/{id}                { attributes: [{ id:"MODEL" }] }
//   descricao  → PUT /items/{id}/description    { plain_text }
// -----------------------------------------------------------------------------

const { mlFetch } = require("../../utils/mlClient");

const TITULO_MAX = 60;

// Extrai uma mensagem legível do corpo de erro do ML. O ML devolve
// { message, error, cause: [{ code, message }] } — a `cause` é a que explica.
function motivoDoErroMl(data, status) {
  const causes = Array.isArray(data && data.cause) ? data.cause : [];
  const primeira = causes.find((c) => c && (c.message || c.code));
  if (primeira && primeira.message) return String(primeira.message);
  if (data && data.message) return String(data.message);
  if (status === 403) {
    return "O Mercado Livre não permitiu esta alteração nesta conta.";
  }
  return `O Mercado Livre recusou a alteração (HTTP ${status || "?"}).`;
}

function codigoDoErroMl(data, status) {
  const causes = Array.isArray(data && data.cause) ? data.cause : [];
  const primeira = causes.find((c) => c && (c.code || c.error));
  const bruto = primeira
    ? primeira.code || primeira.error
    : (data && (data.error || data.code)) || null;
  return bruto ? String(bruto) : `ML_HTTP_${status || 0}`;
}

function falha(codigo, motivo) {
  return { ok: false, codigo, motivo };
}

// ---------------------------------------------------------------------------
// PUT /items/{id} — usado por título e por modelo, um campo de cada vez.
// ---------------------------------------------------------------------------
async function enviarItem(clienteId, itemId, corpo, mlUserId) {
  const resp = await mlFetch(
    clienteId,
    `/items/${encodeURIComponent(itemId)}`,
    { method: "PUT", body: JSON.stringify(corpo), mlUserId }
  );
  if (resp && resp.ok) return { ok: true, item: resp.data || null };
  // DEBUG TEMPORÁRIO — investigação do BODY_INVALID_FIELDS em título.
  // Remover depois do diagnóstico: motivoDoErroMl/codigoDoErroMl abaixo
  // descartam boa parte do corpo (cause[] completo, references, etc.),
  // então aqui vai o response bruto que normalmente nunca é logado.
  console.error(JSON.stringify({
    event: "ml_put_item_rejected_DEBUG_TEMP",
    itemId,
    payloadEnviado: corpo,
    status: resp && resp.status,
    responseBody: resp && resp.data,
  }, null, 2));
  const f = falha(
    codigoDoErroMl(resp && resp.data, resp && resp.status),
    motivoDoErroMl(resp && resp.data, resp && resp.status)
  );
  // DEBUG TEMPORÁRIO — vai junto no resultado interno; só o orquestrador
  // decide se isso é exposto na resposta HTTP (hoje, só para título).
  f.debugMlResponseTemp = {
    itemId,
    payloadEnviado: corpo,
    status: resp && resp.status,
    responseBody: resp && resp.data,
  };
  return f;
}

async function atualizarTitulo({ clienteId, itemId, titulo, mlUserId }) {
  const valor = String(titulo == null ? "" : titulo).trim();
  if (!valor) return falha("TITULO_VAZIO", "O título não pode ficar vazio.");
  if (valor.length > TITULO_MAX) {
    return falha(
      "TITULO_LONGO",
      `O título tem ${valor.length} caracteres — o Mercado Livre aceita até ${TITULO_MAX}.`
    );
  }
  const r = await enviarItem(clienteId, itemId, { title: valor }, mlUserId);
  return r.ok ? { ok: true, valor } : r;
}

async function atualizarModelo({ clienteId, itemId, modelo, mlUserId }) {
  const valor = String(modelo == null ? "" : modelo).trim();
  if (!valor) {
    return falha(
      "MODELO_VAZIO",
      "O modelo não pode ficar vazio. Para remover um atributo, use o Mercado Livre."
    );
  }
  const r = await enviarItem(
    clienteId,
    itemId,
    { attributes: [{ id: "MODEL", value_name: valor }] },
    mlUserId
  );
  return r.ok ? { ok: true, valor } : r;
}

// A descrição vive num recurso próprio do item e é escrita com PUT
// (o POST só vale na criação, quando ela ainda não existe).
async function atualizarDescricao({ clienteId, itemId, descricao, mlUserId }) {
  const valor = String(descricao == null ? "" : descricao);
  const resp = await mlFetch(
    clienteId,
    `/items/${encodeURIComponent(itemId)}/description`,
    { method: "PUT", body: JSON.stringify({ plain_text: valor }), mlUserId }
  );
  if (resp && resp.ok) return { ok: true, valor };
  return falha(
    codigoDoErroMl(resp && resp.data, resp && resp.status),
    motivoDoErroMl(resp && resp.data, resp && resp.status)
  );
}

// ---------------------------------------------------------------------------
// Orquestração: aplica só os campos presentes em `campos`, na ordem
// título → modelo → descrição, e devolve um resultado POR CAMPO. Um campo que
// falha não impede os outros — e não deixa o snapshot local mentir sobre ele.
// ---------------------------------------------------------------------------
async function aplicarConteudo({ clienteId, itemId, mlUserId, campos }) {
  const resultados = {};
  const aplicados = {};

  const executores = [
    ["titulo", () => atualizarTitulo({ clienteId, itemId, titulo: campos.titulo, mlUserId })],
    ["modelo", () => atualizarModelo({ clienteId, itemId, modelo: campos.modelo, mlUserId })],
    ["descricao", () => atualizarDescricao({ clienteId, itemId, descricao: campos.descricao, mlUserId })],
  ];

  for (const [campo, executar] of executores) {
    if (campos[campo] === undefined) continue;
    let r;
    try {
      r = await executar();
    } catch (err) {
      r = falha(
        "ML_INDISPONIVEL",
        err && err.message
          ? `Falha ao falar com o Mercado Livre: ${err.message}`
          : "Falha ao falar com o Mercado Livre."
      );
    }
    resultados[campo] = r.ok
      ? { ok: true }
      : { ok: false, codigo: r.codigo, motivo: r.motivo };
    // DEBUG TEMPORÁRIO — investigação do BODY_INVALID_FIELDS em título.
    // Só título expõe o response bruto do ML na resposta HTTP; remover
    // este bloco (e o campo debugMlResponseTemp em enviarItem) depois.
    if (!r.ok && campo === "titulo" && r.debugMlResponseTemp) {
      resultados[campo].debugMlResponseTemp = r.debugMlResponseTemp;
    }
    if (r.ok) aplicados[campo] = r.valor;
  }

  return { resultados, aplicados };
}

module.exports = {
  aplicarConteudo,
  atualizarTitulo,
  atualizarModelo,
  atualizarDescricao,
  TITULO_MAX,
};
