// server/services/meliAnuncios/seo/fatosProduto.js
// -----------------------------------------------------------------------------
// Regras FACTUAIS compartilhadas pelos engines de SEO (Título · F3, Termos
// Complementares · F4R; a Descrição · F5 deve reaproveitar, não duplicar).
//
// Só o que precisa ser idêntico entre eles: como ler os atributos do anúncio,
// quais atributos não descrevem o produto, o que é marca genérica, como ler um
// booleano "Sim/Não" e a tabela de GÊNERO. Ter isso em um lugar só impede que
// um engine aceite "homem" para GENDER=Meninos e o outro não.
//
// Puro: sem banco, sem rede, sem env.
// -----------------------------------------------------------------------------

const seo = require("./seoText");

// Atributos que não descrevem o produto (identificadores, logística,
// garantia, condição). Prefixos valem para famílias inteiras.
const ATRIBUTOS_IGNORADOS = new Set([
  "SELLER_SKU", "GTIN", "EAN", "UPC", "ITEM_CONDITION", "PRODUCT_DATA_SOURCE", "EXCLUSIVE_CHANNEL",
]);
const PREFIXOS_IGNORADOS = ["PACKAGE_", "SHIPMENT_", "WARRANTY_"];

// Atributos que costumam definir o produto.
const ATRIBUTOS_ESTRUTURAIS = new Set([
  "LINE", "GENDER", "AGE_GROUP", "MATERIAL", "MAIN_MATERIAL", "VOLTAGE", "POWER",
  "CAPACITY", "STYLE", "SPORT",
]);

const MARCAS_GENERICAS = new Set(["generica", "generico", "sem marca", "outra", "outras", "outros", "nenhuma"]);

// Gênero: o atributo estruturado GENDER é evidência do público — mas só do
// público que ele DIZ. Cada valor sustenta apenas as palavras que preservam
// sexo E faixa etária: "Meninos" sustenta menino/masculino, nunca "homem"
// (seria um claim etário falso); "Homens" sustenta homem/masculino, nunca
// "menino". Valor sem idade ("Masculino") sustenta só "masculino".
//
// `proibe` = palavras que CONTRADIZEM o valor (sexo oposto, ou outra faixa
// quando o valor tem faixa). Proibido vence até o título atual do vendedor.
// Nada de sinônimo manual (garoto/garota ficaram de fora de propósito) e
// nada de idade inferida (criança, infantil, adulto, juvenil) a partir de
// GENDER. Lista explícita e pequena — não é ontologia.
// Chaves já reduzidas pelo seoText (Meninos → menino, Mulheres → mulher).
const GENERO_POR_VALOR = new Map([
  ["menino", { sustenta: ["menino", "masculino"], proibe: ["menina", "feminino", "homem", "mulher"] }],
  ["menina", { sustenta: ["menina", "feminino"], proibe: ["menino", "masculino", "homem", "mulher"] }],
  ["homem", { sustenta: ["homem", "masculino"], proibe: ["mulher", "feminino", "menino", "menina"] }],
  ["mulher", { sustenta: ["mulher", "feminino"], proibe: ["homem", "masculino", "menino", "menina"] }],
  ["masculino", { sustenta: ["masculino"], proibe: ["feminino", "menina", "mulher"] }],
  ["feminino", { sustenta: ["feminino"], proibe: ["masculino", "menino", "homem"] }],
  ["unissex", { sustenta: ["unissex"], proibe: ["masculino", "feminino", "menino", "menina", "homem", "mulher"] }],
]);

// Palavras de nome de atributo que não carregam a característica em si
// ("Com bolsos" → a característica é "bolsos", não "com").
const PALAVRAS_DE_NOME_GENERICAS = new Set(["com", "sem", "tipo", "possui", "tem", "inclui", "e"]);

function texto(v) {
  return v == null ? "" : String(v).trim();
}

function lerAtributos(anuncio) {
  let attrs = anuncio && anuncio.attributes_json;
  if (typeof attrs === "string") {
    try { attrs = JSON.parse(attrs); } catch (e) { attrs = []; }
  }
  return Array.isArray(attrs) ? attrs.filter((a) => a && typeof a === "object") : [];
}

// Valor legível de um atributo do snapshot (value, ou value_name do ML).
function valorAtributo(at) {
  return texto(at && (at.value != null ? at.value : at.value_name));
}

function atributoIgnorado(id) {
  const s = String(id || "");
  return ATRIBUTOS_IGNORADOS.has(s) || PREFIXOS_IGNORADOS.some((p) => s.startsWith(p));
}

function marcaGenerica(valor) {
  return MARCAS_GENERICAS.has(seo.normalizeText(valor));
}

function valorBooleano(valor) {
  const n = seo.normalizeText(valor);
  if (n === "sim") return true;
  if (n === "nao") return false;
  return null;
}

// Regras de gênero de um valor de GENDER ("Meninos e Meninas" → as duas).
//   { sustentadas: Set, proibidas: Set, chavesDoValor: [string] } | null
// Proibido = o que algum valor proíbe e NENHUM sustenta.
function regrasGenero(valor) {
  const chavesDoValor = seo.contentKeys(valor).filter((k) => GENERO_POR_VALOR.has(k));
  if (!chavesDoValor.length) return null;
  const regras = chavesDoValor.map((k) => GENERO_POR_VALOR.get(k));
  const sustentadas = new Set(regras.flatMap((r) => r.sustenta));
  const proibidas = new Set(regras.flatMap((r) => r.proibe).filter((k) => !sustentadas.has(k)));
  return { sustentadas, proibidas, chavesDoValor };
}

module.exports = {
  ATRIBUTOS_IGNORADOS,
  PREFIXOS_IGNORADOS,
  ATRIBUTOS_ESTRUTURAIS,
  MARCAS_GENERICAS,
  GENERO_POR_VALOR,
  PALAVRAS_DE_NOME_GENERICAS,
  texto,
  lerAtributos,
  valorAtributo,
  atributoIgnorado,
  marcaGenerica,
  valorBooleano,
  regrasGenero,
};
