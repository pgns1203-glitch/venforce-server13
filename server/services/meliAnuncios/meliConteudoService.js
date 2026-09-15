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

// Achado da investigação do BODY_INVALID_FIELDS: para título, o ML devolve um
// formato atípico — `cause` é um número (não array), `message` é o código
// genérico ("BODY_INVALID_FIELDS") e a explicação real vem em `error`:
//   { cause: 374, message: "BODY_INVALID_FIELDS",
//     error: "You cannot modify the title if the item has a family_name" }
// Por isso `codigoDoErroMl`/`motivoDoErroMl` (pensados para o formato usual
// com `cause[]`) não pegam essa explicação — ela só existe em `data.error`.
const MOTIVO_CATALOGO =
  "O título deste anúncio é definido pelo catálogo do Mercado Livre e não pode ser alterado por aqui.";

// Critério único de "é catálogo": catalog_listing OU family_name — o mesmo
// usado no frontend (Portal/anuncios-meli.js: ehAnuncioCatalogo). Um item
// pode ter family_name sem catalog_listing=true; usar só um dos dois sinais
// foi a causa da tag "Catálogo" divergir entre lista e detalhe.
function ehAnuncioCatalogo(anuncio) {
  return !!(anuncio && (anuncio.family_name || anuncio.catalog_listing));
}

function falhaCatalogo() {
  return falha("TITLE_LOCKED_BY_CATALOG", MOTIVO_CATALOGO);
}

// Reconhece a recusa de catálogo a partir do corpo bruto do ML, para o caso
// (raro) de o anúncio ainda não ter sido resincronizado com family_name.
function ehRecusaPorCatalogo(data) {
  const texto = String((data && data.error) || (data && data.message) || "");
  return /family_name/i.test(texto);
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
  const f = falha(
    codigoDoErroMl(resp && resp.data, resp && resp.status),
    motivoDoErroMl(resp && resp.data, resp && resp.status)
  );
  f.mlData = resp && resp.data; // corpo bruto, para checagens específicas do chamador (ex.: catálogo)
  return f;
}

async function atualizarTitulo({ clienteId, itemId, titulo, mlUserId, catalogoTravado }) {
  const valor = String(titulo == null ? "" : titulo).trim();
  if (!valor) return falha("TITULO_VAZIO", "O título não pode ficar vazio.");
  if (valor.length > TITULO_MAX) {
    return falha(
      "TITULO_LONGO",
      `O título tem ${valor.length} caracteres — o Mercado Livre aceita até ${TITULO_MAX}.`
    );
  }
  // Pré-checagem: o próprio anúncio já indica catálogo/família (sincronizado
  // do ML) — nem gasta a chamada, mesma lógica do TITULO_LONGO acima.
  if (catalogoTravado) return falhaCatalogo();

  const r = await enviarItem(clienteId, itemId, { title: valor }, mlUserId);
  if (r.ok) return { ok: true, valor };
  // Fallback: linha ainda não resincronizada, mas o ML confirma catálogo agora.
  if (ehRecusaPorCatalogo(r.mlData)) return falhaCatalogo();
  return r;
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
async function aplicarConteudo({ clienteId, itemId, mlUserId, campos, anuncio }) {
  const resultados = {};
  const aplicados = {};

  // `family_name`/`catalog_listing` vêm da sincronização (podem estar NULL
  // em linhas antigas, até a próxima ressincronização). Se ausentes, a
  // pré-checagem não trava nada — sobra o fallback dentro de atualizarTitulo.
  const catalogoTravado = ehAnuncioCatalogo(anuncio);

  const executores = [
    ["titulo", () => atualizarTitulo({ clienteId, itemId, titulo: campos.titulo, mlUserId, catalogoTravado })],
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
