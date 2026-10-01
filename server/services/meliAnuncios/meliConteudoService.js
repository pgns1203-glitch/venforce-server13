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

// Fotografia do corpo de erro do ML, SEM interpretação — para a tela mostrar
// o motivo real (e o código) e não só a primeira frase. O ML usa dois
// formatos: o usual `{ message, error, status, cause: [{ code, message, ... }] }`
// e o atípico do título `{ cause: 374, message, error }` (cause numérica).
// Nenhum campo é inventado: o que o ML não mandou volta null.
function texto(v) {
  return v == null || v === "" ? null : String(v);
}

function detalhesDoErroMl(data, status) {
  const d = data && typeof data === "object" ? data : {};
  const causas = (Array.isArray(d.cause) ? d.cause : [])
    .filter((c) => c && typeof c === "object")
    .map((c) => ({
      code: texto(c.code),
      message: texto(c.message),
      type: texto(c.type),
      references: Array.isArray(c.references) ? c.references.map(String) : [],
    }));
  return {
    status: status || (typeof d.status === "number" ? d.status : null),
    message: texto(d.message),
    error: texto(d.error),
    causa: typeof d.cause === "number" || typeof d.cause === "string" ? String(d.cause) : null,
    causas,
  };
}

// Tradução AMIGÁVEL das recusas de título conhecidas. É só explicação: o
// código e a mensagem originais do ML continuam indo junto, intactos.
// "bids" é o termo da API do ML para compras/vendas do item (vide
// `has_bids` nos erros de /items). A doc pública diz que item com vendas
// não muda título via API, mas há relato operacional de títulos alterados
// com vendas pela plataforma — então a regra NÃO é tratada como absoluta:
// o texto só descreve o que ESTA resposta disse, sem afirmar regra fixa.
// Quem decide é o ML — aqui nada bloqueia por vendas.
const EXPLICACOES_TITULO = [
  {
    re: /\bbids?\b|has_bids|with sales|has sales|com vendas|possui vendas/i,
    texto:
      "O Mercado Livre recusou a alteração via API neste anúncio. A resposta cita vendas (bids) no anúncio.",
  },
];

function explicacaoTitulo(detalhes) {
  const fontes = [detalhes.message, detalhes.error]
    .concat(detalhes.causas.map((c) => c.message), detalhes.causas.map((c) => c.code))
    .filter(Boolean)
    .join(" | ");
  const achada = EXPLICACOES_TITULO.find((e) => e.re.test(fontes));
  return achada ? achada.texto : null;
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

// Regra de BLOQUEIO de título — não confundir com "é catálogo" (a tag visual
// no frontend usa só catalog_listing===true; family_name é outro conceito da
// doc do ML, família/User Products, e não deve acender a tag). Aqui o
// critério é mais amplo de propósito: o ML já demonstrou recusar o PUT de
// título só por family_name, mesmo sem catalog_listing=true. Espelha
// tituloTravadoPorCatalogo em Portal/anuncios-meli.js.
function tituloTravadoPorCatalogo(anuncio) {
  return !!(anuncio && (anuncio.catalog_listing === true || anuncio.family_name));
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
  f.detalhesMl = detalhesDoErroMl(resp && resp.data, resp && resp.status);
  // Registro do corpo REAL da recusa (erro do ML não carrega token nem dado
  // pessoal) — é a única fonte para auditar a próxima recusa sem adivinhar.
  console.warn(
    `[anuncios-meli] ML recusou PUT /items/${itemId} (${Object.keys(corpo).join(",")}):`,
    resp && resp.status,
    JSON.stringify((resp && resp.data) || null).slice(0, 1000)
  );
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
  if (ehRecusaPorCatalogo(r.mlData)) {
    const f = falhaCatalogo();
    f.detalhesMl = r.detalhesMl;
    return f;
  }
  r.explicacao = explicacaoTitulo(r.detalhesMl);
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
  const catalogoTravado = tituloTravadoPorCatalogo(anuncio);

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
    if (r.ok) {
      resultados[campo] = { ok: true };
    } else {
      resultados[campo] = { ok: false, codigo: r.codigo, motivo: r.motivo };
      // Só presentes quando o ML respondeu — recusa local (título vazio,
      // longo, catálogo pré-checado) não tem "resposta do ML" para mostrar.
      if (r.explicacao) resultados[campo].explicacao = r.explicacao;
      if (r.detalhesMl) resultados[campo].detalhesMl = r.detalhesMl;
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
  // Regra real de bloqueio de título (catálogo/família). Exportada para o
  // Title Engine (SEO) recusar gerar título para quem não pode tê-lo trocado.
  tituloTravadoPorCatalogo,
  // Leitores do corpo de erro do ML. Exportados para que outro service que
  // escreve no MESMO ML (meliEstoqueService) leia a recusa exatamente igual —
  // o formato de erro é da API, não deste módulo, e duas cópias da leitura
  // divergiriam na primeira vez que o ML mudasse o formato.
  motivoDoErroMl,
  codigoDoErroMl,
  detalhesDoErroMl,
  explicacaoTitulo,
};
