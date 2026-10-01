// server/services/meliAnuncios/seo/termosComplementaresEngine.js
// -----------------------------------------------------------------------------
// Termos Complementares (SEO ML · F4R) — quais termos factualizados e
// relevantes deste produto o título de referência ainda NÃO representa bem?
//
// É uma ANÁLISE, só leitura. Não responde "o que escrever no MODEL": o MODEL é
// dado factual/estrutural do produto (PARENT_PK em 768/768 categorias reais —
// auditoria F4.1) e nada daqui é gravado nele nem em lugar nenhum. Por isso
// não há gate de MODEL (catalog_required, PARENT_PK, catálogo, família): eles
// protegem a ESCRITA do atributo, e esta análise não escreve. As regras de
// escrita do MODEL continuam onde sempre estiveram (PATCH /conteudo).
//
// Futuro consumidor previsto: contexto do Title Engine, explicação de
// oportunidades e auditoria do título. Nenhum deles está ligado ainda.
//
// 100% determinístico: sem IA, sem banco, sem rede, sem env. Os candidatos
// vêm só de fatos do anúncio (atributos estruturados, marca, categoria); a
// nota de cada termo é calculada aqui.
//
//   montarCandidatos           — fatos → termos candidatos (com baseScore)
//   gerarTermosComplementares  — complementaridade → seleção gulosa
//
// O score mede força factual + relevância estrutural + especificidade +
// utilidade + complementaridade com o título. NÃO mede popularidade de busca
// (não há sinal de volume nesta fase).
// -----------------------------------------------------------------------------

const seo = require("./seoText");
const {
  ATRIBUTOS_ESTRUTURAIS,
  PALAVRAS_DE_NOME_GENERICAS,
  texto,
  lerAtributos,
  valorAtributo,
  atributoIgnorado,
  marcaGenerica,
  valorBooleano,
  regrasGenero,
} = require("./fatosProduto");

// O MODEL atual nunca é fonte de termo: o otimizador legado gravou listas de
// palavras-chave nele (~45% dos MODEL reais têm esse indício — F4.1).
const ATRIBUTO_MODELO = "MODEL";

// Seleção: só entra termo com TERM_SCORE ≥ LIMIAR, até MAX_TERMOS conceitos.
// Não completa a lista só porque há espaço.
const LIMIAR_TERM_SCORE = 60;
const MAX_TERMOS = 8;

// Termo com mais palavras de conteúdo que isso, ou mais longo que isso, é
// frase — não termo.
const MAX_PALAVRAS_TERMO = 4;
const MAX_CHARS_TERMO = 40;

// -----------------------------------------------------------------------------
// 1. CANDIDATOS
// -----------------------------------------------------------------------------

// Além dos ignorados do F3 (SKU, GTIN, PACKAGE_*, SHIPMENT_*, WARRANTY_*…):
// outros modelos/códigos de peça e atributos de venda/logística que não
// descrevem o produto ("Unidades por embalagem = 1").
const NAO_DESCRITIVOS = new Set([
  ATRIBUTO_MODELO, "ALPHANUMERIC_MODEL", "DETAILED_MODEL", "MPN", "PART_NUMBER",
  "UNITS_PER_PACK", "UNITS_PER_PACKAGE", "SALE_FORMAT", "IS_KIT", "ORIGIN",
]);
const SUFIXO_IDENTIFICADOR = /(^|_)(SKU|GTIN|EAN|UPC|MPN|ISBN|CODE|ID)$/;

function atributoNaoDescritivo(id) {
  const s = String(id || "");
  return atributoIgnorado(s) || NAO_DESCRITIVOS.has(s) || SUFIXO_IDENTIFICADOR.test(s);
}

// Valor sem letra ("1", "250") não diz nada sozinho. Valor que é um código
// (uma "palavra" só, letras e dígitos misturados, ≥ 6 caracteres: "A515-54G",
// "XJ221B9") é identificador. Número com unidade ("110V/220V", "500ml",
// "12 V") é medida, não código.
const MEDIDA = /^\d+([.,]\d+)?\s?[a-zA-Zµ°%]{1,4}(\s?\/\s?\d+([.,]\d+)?\s?[a-zA-Zµ°%]{1,4})*$/;
function valorNaoDescritivo(valor) {
  if (!/\p{L}/u.test(valor)) return true;
  const semEspaco = !/\s/.test(valor);
  const codigo = semEspaco && valor.length >= 6 && /\d/.test(valor) && /\p{L}/u.test(valor) && !MEDIDA.test(valor);
  return codigo;
}

// Força da evidência (40) — poucos níveis fixos.
const EVIDENCIA = {
  VALOR: 40,        // valor de atributo estruturado, dito pelo próprio vendedor/ML
  MARCA: 36,        // BRAND estruturada
  CATEGORIA: 32,    // nome da categoria do ML
  EQUIVALENTE: 32,  // palavra equivalente DENTRO do mesmo atributo (tabela GENDER)
  NOME_ATRIBUTO: 24, // característica dita pelo nome do atributo ("Com bolsos: Sim")
};

// Relevância estrutural (30) — o atributo descreve o produto?
const RELEVANCIA = {
  NUCLEO: 30,         // marca, categoria, LINE/GENDER/MATERIAL/VOLTAGE/… (ATRIBUTOS_ESTRUTURAIS)
  DESCRITIVO: 20,     // demais atributos de produto (cor, tamanho, fechamento…)
  CARACTERISTICA: 15, // booleano "Sim" — presença de um recurso
};

// Especificidade (20): palavra genérica não identifica nada.
const GENERICAS = new Set(
  ["produto", "modelo", "artigo", "item", "tipo", "outro", "geral", "padrão", "normal", "comum",
    "variado", "diverso", "único", "básico", "simples", "genérico", "genérica", "linha", "estilo"]
    .map((w) => seo.contentKeys(w)[0])
);

function pontuarEspecificidade(chaves) {
  if (!chaves.length) return 0;
  const especificas = chaves.filter((k) => !GENERICAS.has(k)).length;
  return Math.round(20 * (especificas / chaves.length));
}

// Compactação / utilidade (10): 1–2 palavras de conteúdo = 10, 3 = 7, 4 = 4;
// cada conectivo dentro do termo custa 2 ("uso no dia a dia em casa").
// Não premia "curto": premia termo que carrega informação sem virar frase.
function pontuarCompactacao(nChaves, nStopwords) {
  const base = nChaves <= 2 ? 10 : nChaves === 3 ? 7 : 4;
  return Math.max(0, base - 2 * nStopwords);
}

function minusculo(s) {
  return s.toLocaleLowerCase("pt-BR");
}

// Constrói um candidato (ou um excluído) a partir de um texto factual.
//   extra: { fonte, atributo, conceptId, conceitoChaves?, evidencia, relevancia, preservarCaixa? }
function montarCandidato(termoBruto, extra) {
  const termo = texto(termoBruto).replace(/\s+/g, " ");
  const tokens = seo.extractTokens(termo);
  const chaves = seo.contentKeys(termo);
  const nStop = tokens.filter((t) => t.stopword).length;
  const exibicao = extra.preservarCaixa ? termo : minusculo(termo);

  if (!chaves.length) return { excluido: { termo: exibicao, motivo: "TERMO_GENERICO" } };
  if (chaves.length > MAX_PALAVRAS_TERMO || termo.length > MAX_CHARS_TERMO) {
    return { excluido: { termo: exibicao, motivo: "TERMO_LONGO" } };
  }
  const especificidade = pontuarEspecificidade(chaves);
  if (especificidade === 0) return { excluido: { termo: exibicao, motivo: "TERMO_GENERICO" } };

  const breakdown = {
    evidencia: extra.evidencia,
    relevancia: extra.relevancia,
    especificidade,
    compactacao: pontuarCompactacao(chaves.length, nStop),
  };
  return {
    candidato: {
      termo: exibicao,
      chaves,
      assinatura: chaves.slice().sort().join(" "),
      fonte: extra.fonte,
      atributo: extra.atributo || null,
      conceptId: extra.conceptId,
      conceitoChaves: extra.conceitoChaves || null,
      baseScore: breakdown.evidencia + breakdown.relevancia + breakdown.especificidade + breakdown.compactacao,
      breakdown,
    },
  };
}

// -----------------------------------------------------------------------------
// montarCandidatos(anuncio, { categoriaNome })
//   → { candidatos, excluidos, proibidas }
//
// Fontes (nada fora delas):
//   - BRAND estruturada (não genérica)            → fonte "marca"
//   - nome da categoria do ML                      → fonte "categoria"
//   - valores de atributos descritivos             → fonte "atributo"
//     (valor com vírgula/";" = vários valores, um candidato por valor)
//   - GENDER: as palavras que a tabela segura do F3 diz que o valor sustenta
//     (Meninos → meninos [valor] + masculino [equivalente]), um conceito por
//     público do valor
//   - booleano "Sim": a característica do nome ("Com bolsos" → "bolsos")
//
// NÃO são fonte: o MODEL atual (o otimizador legado gravou listas de
// palavras-chave nele e não há como separar, com segurança, um modelo real
// de uma lista dessas), o título, a descrição, SKU/GTIN/códigos, logística,
// garantia, preço, estoque, vendas.
// -----------------------------------------------------------------------------
function montarCandidatos(anuncio, opts = {}) {
  const a = anuncio || {};
  const attrs = lerAtributos(a);
  const candidatos = [];
  const excluidos = [];
  const proibidas = new Set();

  function adicionar(termo, extra) {
    const r = montarCandidato(termo, extra);
    if (r.excluido) excluidos.push(r.excluido);
    else candidatos.push(r.candidato);
  }

  const marcaAttr = attrs.find((x) => x.id === "BRAND");
  const marca = marcaAttr ? valorAtributo(marcaAttr) : texto(a.marca);
  if (marca && !marcaGenerica(marca)) {
    adicionar(marca, {
      fonte: "marca", atributo: "BRAND", conceptId: "BRAND",
      evidencia: EVIDENCIA.MARCA, relevancia: RELEVANCIA.NUCLEO, preservarCaixa: true,
    });
  }

  const categoria = texto(opts.categoriaNome);
  if (categoria && !marcaGenerica(categoria)) {
    adicionar(categoria, {
      fonte: "categoria", conceptId: "CATEGORIA",
      evidencia: EVIDENCIA.CATEGORIA, relevancia: RELEVANCIA.NUCLEO,
    });
  }

  for (const at of attrs) {
    const id = String(at.id || "");
    const valor = valorAtributo(at);
    if (!valor || id === "BRAND" || atributoNaoDescritivo(id)) continue;
    const nome = texto(at.name) || id;

    const bool = valorBooleano(valor);
    if (bool !== null) {
      const palavrasNome = seo.extractTokens(nome)
        .filter((t) => !t.stopword && !PALAVRAS_DE_NOME_GENERICAS.has(t.key));
      if (bool === false) {
        for (const t of palavrasNome) proibidas.add(t.key);
        continue;
      }
      if (palavrasNome.length) {
        adicionar(palavrasNome.map((t) => t.original).join(" "), {
          fonte: "atributo", atributo: id, conceptId: id + ":SIM",
          evidencia: EVIDENCIA.NOME_ATRIBUTO, relevancia: RELEVANCIA.CARACTERISTICA,
        });
      }
      continue;
    }

    if (id === "GENDER") {
      const genero = regrasGenero(valor);
      if (genero) {
        for (const k of genero.proibidas) proibidas.add(k);
        // Um conceito por público do valor ("Meninos e Meninas" = dois).
        const originais = new Map(seo.extractTokens(valor).map((t) => [t.key, t.original]));
        for (const chave of genero.chavesDoValor) {
          const sustenta = fatosGeneroDe(chave);
          for (const palavra of sustenta) {
            const doValor = palavra === chave;
            adicionar(doValor ? originais.get(chave) || palavra : palavra, {
              fonte: "atributo", atributo: "GENDER", conceptId: "GENDER:" + chave,
              conceitoChaves: sustenta,
              evidencia: doValor ? EVIDENCIA.VALOR : EVIDENCIA.EQUIVALENTE,
              relevancia: RELEVANCIA.NUCLEO,
            });
          }
        }
        continue;
      }
    }

    const relevancia = ATRIBUTOS_ESTRUTURAIS.has(id) ? RELEVANCIA.NUCLEO : RELEVANCIA.DESCRITIVO;
    for (const parte of valor.split(/[;,]/)) {
      const v = texto(parte);
      if (!v) continue;
      if (valorNaoDescritivo(v)) {
        excluidos.push({ termo: minusculo(v), motivo: "VALOR_NAO_DESCRITIVO" });
        continue;
      }
      adicionar(v, {
        fonte: "atributo", atributo: id, conceptId: id + ":" + seo.contentKeys(v).join(" "),
        evidencia: EVIDENCIA.VALOR, relevancia,
      });
    }
  }

  // Mais estrito que o F3 de propósito: lá o vendedor/IA escreve e a ficha
  // contraditória ("Estilo: Feminino" com GENDER=Meninos) deixa o fato
  // vencer; aqui é o ENGINE que origina o termo, então qualquer termo com
  // palavra que contradiga GENDER ou um booleano "Não" fica de fora.
  return { candidatos, excluidos, proibidas };
}

function fatosGeneroDe(chave) {
  const r = regrasGenero(chave);
  return r ? Array.from(r.sustentadas) : [chave];
}

// -----------------------------------------------------------------------------
// 2. COMPLEMENTARIDADE
//
//   lexical (seoText): 1 − cobertura do termo pelas chaves já cobertas
//     (título + termos já escolhidos). Plural, gênero morfológico e acento
//     já são a mesma chave. Termo composto parcialmente coberto = proporcional
//     ("Tênis Cadarço" com título "Tênis Infantil" → 0,5).
//   conceito estruturado: se o título já tem QUALQUER palavra do mesmo
//     conceito do mesmo atributo (GENDER=Meninos: menino/masculino), o termo
//     vale 0 — "masculino" não complementa um título que diz "Menino". Só
//     existe conceito onde a estrutura prova (tabela GENDER); não há sinônimo
//     geral (infantil ≠ criança).
// -----------------------------------------------------------------------------
function complementaridade(c, cobertas, conceitosEscolhidos) {
  if (conceitosEscolhidos.has(c.conceptId)) return 0;
  if (c.conceitoChaves && c.conceitoChaves.some((k) => cobertas.has(k))) return 0;
  return seo.termComplementarity(c.termo, cobertas);
}

function arred2(n) {
  return Math.round(n * 100) / 100;
}

// -----------------------------------------------------------------------------
// gerarTermosComplementares({ anuncio, tituloReferencia, categoriaNome })
//
//   baseScore (0–100) = evidência (≤40) + relevância (≤30)
//                       + especificidade (≤20) + compactação/utilidade (≤10)
//   TERM_SCORE        = round(baseScore × complementaridade)
//
// Seleção gulosa: a cada passo recalcula a complementaridade de todos contra
// título + termos já escolhidos, pega o maior TERM_SCORE (empate: menos
// caracteres, depois ordem de origem), para quando o melhor fica abaixo do
// LIMIAR ou chega a MAX_TERMOS. Não há limite de caracteres: os termos são
// uma lista, não o valor de um campo.
//
// Retorno (nunca lança). Nada a complementar é resposta válida, não erro:
//   { ok:true, termos:[{ termo, score, baseScore, complementaridade, fonte,
//                        attributeId, conceptId, breakdown }],
//     excluidos:[{ termo, motivo }] }
//
// motivos de exclusão: COBERTO_PELO_TITULO · DUPLICADO · REDUNDANTE ·
//   ABAIXO_DO_LIMIAR · LIMITE_DE_TERMOS · CONFLITO_ATRIBUTO ·
//   TERMO_GENERICO · TERMO_LONGO · VALOR_NAO_DESCRITIVO
// -----------------------------------------------------------------------------
function gerarTermosComplementares({ anuncio, tituloReferencia, categoriaNome }) {
  const { candidatos, excluidos, proibidas } = montarCandidatos(anuncio, { categoriaNome });
  const tituloChaves = seo.titleKeySet(texto(tituloReferencia));
  const vazio = new Set();

  // Pré-filtro: conflito com atributo, já coberto pelo título, duplicado.
  const vistos = new Set();
  let restantes = [];
  candidatos.forEach((c, ordem) => {
    if (c.chaves.some((k) => proibidas.has(k))) {
      excluidos.push({ termo: c.termo, motivo: "CONFLITO_ATRIBUTO" });
      return;
    }
    c.ordem = ordem;
    c.compTitulo = complementaridade(c, tituloChaves, vazio);
    if (c.compTitulo === 0) {
      excluidos.push({ termo: c.termo, motivo: "COBERTO_PELO_TITULO" });
      return;
    }
    if (vistos.has(c.assinatura)) {
      excluidos.push({ termo: c.termo, motivo: "DUPLICADO" });
      return;
    }
    vistos.add(c.assinatura);
    restantes.push(c);
  });

  const cobertas = new Set(tituloChaves);
  const conceitos = new Set();
  const escolhidos = [];

  for (;;) {
    for (const c of restantes) {
      c.comp = complementaridade(c, cobertas, conceitos);
      c.score = Math.round(c.baseScore * c.comp);
    }
    restantes.sort((x, y) =>
      y.score - x.score || x.termo.length - y.termo.length || x.ordem - y.ordem);
    const melhor = restantes[0];
    if (!melhor || melhor.score < LIMIAR_TERM_SCORE) break;
    if (escolhidos.length >= MAX_TERMOS) break;

    restantes = restantes.slice(1);
    escolhidos.push(melhor);
    for (const k of melhor.chaves) cobertas.add(k);
    if (melhor.conceitoChaves) for (const k of melhor.conceitoChaves) cobertas.add(k);
    conceitos.add(melhor.conceptId);
  }

  for (const c of restantes) {
    let motivo;
    if (c.score >= LIMIAR_TERM_SCORE) motivo = "LIMITE_DE_TERMOS";
    else if (conceitos.has(c.conceptId)) motivo = "DUPLICADO";
    else if (Math.round(c.baseScore * c.compTitulo) >= LIMIAR_TERM_SCORE) motivo = "REDUNDANTE";
    else motivo = "ABAIXO_DO_LIMIAR";
    excluidos.push({ termo: c.termo, motivo });
  }

  return {
    ok: true,
    termos: escolhidos.map((c) => ({
      termo: c.termo,
      score: c.score,
      baseScore: c.baseScore,
      complementaridade: arred2(c.comp),
      fonte: c.fonte,
      attributeId: c.atributo,
      conceptId: c.conceptId,
      breakdown: c.breakdown,
    })),
    excluidos,
  };
}

module.exports = {
  montarCandidatos,
  complementaridade,
  gerarTermosComplementares,
  LIMIAR_TERM_SCORE,
  MAX_TERMOS,
  EVIDENCIA,
  RELEVANCIA,
};
