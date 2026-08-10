// server/services/bases/assistenteBaseService.js
// Serviço do Assistente de Base: analisa planilhas fora do padrão e gera
// preview normalizado (ID / Custo / Imposto) SEM salvar no banco.

const path = require("path");
const XLSX = require("xlsx");
const { repairWorksheetRef, lerWorkbookPlanilha } = require("../../utils/excelUtils");
const { normalizeKey } = require("../../utils/textUtils");
const { toNumber, round2 } = require("../../utils/numberUtils");
const { MARKETPLACES_SUPORTADOS } = require("./marketplacesBases");

// ─── Utilitários de letra de coluna ─────────────────────────────────────────

function indicePraLetra(idx) {
  let result = "";
  let n = idx;
  while (n >= 0) {
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
}

function letraParaIndice(letra) {
  const upper = String(letra || "").toUpperCase().trim();
  if (!upper) return -1;
  let result = 0;
  for (let i = 0; i < upper.length; i++) {
    result = result * 26 + (upper.charCodeAt(i) - 64);
  }
  return result - 1;
}

// ─── Candidatos de detecção ──────────────────────────────────────────────────

const CANDIDATOS_ID = [
  "id", "mlb", "id anuncio", "id do anuncio", "codigo do anuncio",
  "cod anuncio", "anuncio", "item id", "id mercado livre", "produto id",
];

const CANDIDATOS_CUSTO = [
  "custo", "preco custo", "preco de custo", "custo unitario",
  "custo produto", "cmv", "valor custo", "compra", "preco compra",
];

const EXCLUIR_CUSTO = [
  "venda", "atual", "sugerido", "lucro", "margem",
  "comissao", "frete", "repasse", "receita", "faturamento",
];

const CANDIDATOS_IMPOSTO = [
  "imposto", "aliquota", "tributo", "icms", "taxa imposto", "percentual imposto",
];

const CANDIDATOS_ID_MODEL = [
  "id model", "id_model", "id do modelo", "id da variacao",
  "id da variação", "variante identificador", "variation id", "model id",
];

// ─── Candidatos específicos do TikTok Shop ───────────────────────────────────
// Lista própria (não estende a do MELI) para não mudar a detecção das
// planilhas de Mercado Livre/Shopee que já funcionam hoje. Os textos aqui já
// estão na forma que pontuarColuna produz: sem acento, sem "_", minúsculo.
//
// Contrato: ID | ID DO SKU | CUSTO | IMPOSTO.
//   ID        → product_id (informativo, pode repetir)
//   ID DO SKU → sku_id da variação (chave de custo)
// As duas listas são disjuntas e a coluna do sku_id é resolvida PRIMEIRO, para
// que "ID do SKU" nunca seja confundida com a coluna "ID" (ver detectarColunas).
const CANDIDATOS_SKU_ID_TIKTOK = [
  "id do sku", "id sku", "sku id", "skuid", "tiktok sku id",
  "id da variacao", "id variacao",
];

const CANDIDATOS_ID_TIKTOK = [
  "id", "id do produto", "produto id", "produtoid", "product id",
];

const CANDIDATOS_CUSTO_TIKTOK = [
  "custo unitario", "custo", "preco de custo", "custoproduto", "custo produto",
  "cmv unitario", "cmv",
];

const CANDIDATOS_IMPOSTO_TIKTOK = [
  "imposto", "imposto percentual", "impostopercentual", "aliquota",
];

const CANDIDATOS_PRODUTO_NOME = [
  "nome do produto", "produto", "product name", "produtonome",
];

const CANDIDATOS_VARIACAO_NOME = [
  "nome do sku", "variacao", "nome da variacao", "sku name", "variacaonome",
];

function candidatosId(marketplace) {
  return marketplace === "tiktok" ? CANDIDATOS_ID_TIKTOK : CANDIDATOS_ID;
}

function candidatosSkuId(marketplace) {
  return marketplace === "tiktok" ? CANDIDATOS_SKU_ID_TIKTOK : [];
}

function candidatosCusto(marketplace) {
  return marketplace === "tiktok" ? CANDIDATOS_CUSTO_TIKTOK : CANDIDATOS_CUSTO;
}

function candidatosImposto(marketplace) {
  return marketplace === "tiktok" ? CANDIDATOS_IMPOSTO_TIKTOK : CANDIDATOS_IMPOSTO;
}

// ─── Pontuação de coluna ─────────────────────────────────────────────────────

function pontuarColuna(header, candidatos, exclusoes) {
  const norm = normalizeKey(String(header || ""))
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!norm) return 0;

  if (exclusoes) {
    for (const ex of exclusoes) {
      if (norm.includes(ex)) return 0;
    }
  }
  for (const c of candidatos) {
    if (norm === c) return 95;
  }
  for (const c of candidatos) {
    if (norm.startsWith(c) || c.startsWith(norm)) return 80;
  }
  for (const c of candidatos) {
    if (norm.includes(c) || c.includes(norm)) return 65;
  }
  return 0;
}

// Variante ESTRITA: só casa quando o cabeçalho contém o candidato, nunca o
// contrário. Usada para o ID DO SKU do TikTok — com a pontuação frouxa, um
// cabeçalho "ID" casaria com o candidato "id do sku" (porque "id do sku"
// começa com "id") e a coluna do produto seria lida como sku_id.
function pontuarColunaEstrita(header, candidatos) {
  const norm = normalizeKey(String(header || ""))
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!norm) return 0;

  for (const c of candidatos) {
    if (norm === c) return 95;
  }
  for (const c of candidatos) {
    if (norm.startsWith(c)) return 80;
  }
  for (const c of candidatos) {
    if (norm.includes(c)) return 65;
  }
  return 0;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function listarAbas(workbook) {
  return workbook.SheetNames || [];
}

function criarErro(statusCode, mensagem) {
  const err = new Error(mensagem);
  err.statusCode = statusCode;
  return err;
}

// ─── Detecção de linha de cabeçalho ──────────────────────────────────────────

function detectarCabecalho(rowsAsArrays, marketplace) {
  const MAX_SCAN = Math.min(15, rowsAsArrays.length);
  let melhorLinha = 0;
  let melhorScore = -1;

  for (let i = 0; i < MAX_SCAN; i++) {
    const row = rowsAsArrays[i] || [];
    let score = 0;

    for (const cell of row) {
      const texto = String(cell || "").trim();
      if (!texto) continue;
      score += pontuarColuna(texto, candidatosId(marketplace));
      score += pontuarColunaEstrita(texto, candidatosSkuId(marketplace));
      score += pontuarColuna(texto, candidatosCusto(marketplace), EXCLUIR_CUSTO);
      score += pontuarColuna(texto, candidatosImposto(marketplace));
    }

    if (score > melhorScore) {
      melhorScore = score;
      melhorLinha = i;
    }
  }

  return melhorLinha;
}

// ─── Detecção de colunas ──────────────────────────────────────────────────────

function detectarColunas(headerRow, marketplace) {
  const disponiveis = [];
  const scoresId = [];
  const scoresSkuId = [];
  const scoresCusto = [];
  const scoresImposto = [];
  const scoresIdModel = [];
  const scoresProdutoNome = [];
  const scoresVariacaoNome = [];

  headerRow.forEach((cell, idx) => {
    const letra = indicePraLetra(idx);
    const texto = String(cell || "").trim();
    if (texto) disponiveis.push({ coluna: letra, cabecalho: texto });

    scoresId.push({ coluna: letra, cabecalho: texto, score: pontuarColuna(texto, candidatosId(marketplace)) });
    scoresSkuId.push({ coluna: letra, cabecalho: texto, score: pontuarColunaEstrita(texto, candidatosSkuId(marketplace)) });
    scoresCusto.push({ coluna: letra, cabecalho: texto, score: pontuarColuna(texto, candidatosCusto(marketplace), EXCLUIR_CUSTO) });
    scoresImposto.push({ coluna: letra, cabecalho: texto, score: pontuarColuna(texto, candidatosImposto(marketplace)) });
    scoresIdModel.push({ coluna: letra, cabecalho: texto, score: pontuarColuna(texto, CANDIDATOS_ID_MODEL) });
    scoresProdutoNome.push({ coluna: letra, cabecalho: texto, score: pontuarColuna(texto, CANDIDATOS_PRODUTO_NOME) });
    scoresVariacaoNome.push({ coluna: letra, cabecalho: texto, score: pontuarColuna(texto, CANDIDATOS_VARIACAO_NOME) });
  });

  function melhorCandidato(scores) {
    const sorted = [...scores].sort((a, b) => b.score - a.score);
    const best = sorted[0];
    return best && best.score > 0
      ? { coluna: best.coluna, cabecalho: best.cabecalho, confianca: best.score }
      : null;
  }

  // TikTok: o sku_id é resolvido ANTES do ID e a coluna escolhida sai da
  // disputa. Sem isso, "ID do SKU" (score 80 por startsWith("id")) poderia ser
  // eleita coluna de produto numa planilha que só tem essa coluna de ID.
  const skuIdDetectado = melhorCandidato(scoresSkuId);
  const semColunaDoSkuId = (cand) =>
    (cand && skuIdDetectado && cand.coluna === skuIdDetectado.coluna ? null : cand);

  const idDetectado = semColunaDoSkuId(melhorCandidato(scoresId));
  // A mesma coluna não pode ser ID e nome ao mesmo tempo ("ID do SKU" x "Nome do SKU").
  const semColunaDoId = (cand) => (cand && idDetectado && cand.coluna === idDetectado.coluna ? null : cand);

  return {
    detectadas: {
      id:       idDetectado,
      sku_id:   skuIdDetectado,
      custo:    melhorCandidato(scoresCusto),
      imposto:  melhorCandidato(scoresImposto),
      id_model: melhorCandidato(scoresIdModel),
      produto_nome:  semColunaDoSkuId(semColunaDoId(melhorCandidato(scoresProdutoNome))),
      variacao_nome: semColunaDoSkuId(semColunaDoId(melhorCandidato(scoresVariacaoNome))),
    },
    disponiveis,
  };
}

// ─── Normalização ─────────────────────────────────────────────────────────────

function normalizarIdBase(value) {
  if (value === null || value === undefined) return null;
  let text = String(value)
    .replace(/^﻿/, "")
    .trim()
    .replace(/^['"]+|['"]+$/g, "")
    .trim();
  if (!text) return null;

  // Excel serializa números como "12345.0"
  if (/^\d+\.0+$/.test(text)) text = text.replace(/\.0+$/, "");

  // Notação científica (ex: 1.23E+11)
  const sci = text.replace(",", ".");
  if (/^\d+(\.\d+)?[eE]\+?\d+$/.test(sci)) {
    const n = Number(sci);
    if (Number.isFinite(n)) text = Math.trunc(n).toString();
  }

  const upper = text.toUpperCase();
  const mlbMatch = upper.match(/MLB[U]?\d+/);
  if (mlbMatch) return mlbMatch[0];
  if (/^\d+$/.test(text)) return `MLB${text}`;
  if (/^MLB[U]?\d+$/i.test(text)) return upper;

  return text;
}

function normalizarIdShopee(value) {
  if (value === null || value === undefined) return null;
  let text = String(value).replace(/^﻿/, "").trim().replace(/^['"]+|['"]+$/g, "").trim();
  if (!text) return null;
  if (/^\d+\.0+$/.test(text)) text = text.replace(/\.0+$/, "");
  const sci = text.replace(",", ".");
  if (/^\d+(\.\d+)?[eE]\+?\d+$/.test(sci)) {
    const n = Number(sci);
    if (Number.isFinite(n)) text = Math.trunc(n).toString();
  }
  return text;  // retorna numérico puro, sem prefixo MLB
}

// TikTok Shop: o ID do SKU tem 18–19 dígitos e precisa continuar texto.
// Diferente do MELI/Shopee: não prefixa MLB e NÃO converte notação científica
// (o Excel já perdeu dígitos nesse caso). ID inválido devolve null e a linha
// entra no preview como ignorada, com alerta próprio.
function normalizarIdTikTok(value) {
  if (value === null || value === undefined) return null;

  // Número inteiro exato ainda é recuperável; fora disso a precisão já se foi.
  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? String(value) : null;
  }

  let text = String(value).replace(/^﻿/, "").trim().replace(/^['"]+|['"]+$/g, "").trim();
  if (!text) return null;

  if (/^\d+\.0+$/.test(text)) text = text.replace(/\.0+$/, "");
  if (/^\d+(?:[.,]\d+)?[eE][+-]?\d+$/.test(text)) return null; // científico → rejeitado

  return text;
}

function ehIdTikTokCientifico(value) {
  if (typeof value === "number") return !Number.isSafeInteger(value);
  const text = String(value == null ? "" : value).replace(/^﻿/, "").trim().replace(/^['"]+|['"]+$/g, "").trim();
  return /^\d+(?:[.,]\d+)?[eE][+-]?\d+$/.test(text);
}

function normalizarTextoCelula(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/^﻿/, "").trim();
  return text ? text : null;
}

function normalizarCustoBase(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  return round2(toNumber(text));
}

function normalizarImpostoBase(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  const hasPercent = text.includes("%");
  const n = toNumber(text);
  if (hasPercent) return n / 100;
  if (n >= 1) return n / 100;
  return n;
}

// ─── Processamento de linhas ──────────────────────────────────────────────────

function normalizarIdPorMarketplace(marketplace, valor) {
  if (marketplace === "tiktok") return normalizarIdTikTok(valor);
  if (marketplace === "shopee") return normalizarIdShopee(valor);
  return normalizarIdBase(valor);
}

function processarLinhas(rowsAsArrays, linhaHeader, mapeamento, marketplace) {
  const idxId      = mapeamento.id      ? letraParaIndice(mapeamento.id)      : -1;
  const idxSkuId   = mapeamento.sku_id  ? letraParaIndice(mapeamento.sku_id)  : -1;
  const idxCusto   = mapeamento.custo   ? letraParaIndice(mapeamento.custo)   : -1;
  const idxImposto = mapeamento.imposto ? letraParaIndice(mapeamento.imposto) : -1;
  const idxIdModel = mapeamento.id_model ? letraParaIndice(mapeamento.id_model) : -1;
  const idxProduto = mapeamento.produto_nome  ? letraParaIndice(mapeamento.produto_nome)  : -1;
  const idxVariacao = mapeamento.variacao_nome ? letraParaIndice(mapeamento.variacao_nome) : -1;
  const isTikTok = marketplace === "tiktok";

  const todas = [];
  const dataRows = rowsAsArrays.slice(linhaHeader + 1);

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i] || [];
    const hasContent = row.some((c) => String(c || "").trim() !== "");
    if (!hasContent) continue;

    const linhaOriginal = linhaHeader + 2 + i; // 1-based, considera header
    const idBruto = idxId >= 0 ? row[idxId] : "";
    const skuIdBruto = idxSkuId >= 0 ? row[idxSkuId] : "";

    todas.push({
      linha_original: linhaOriginal,
      id: normalizarIdPorMarketplace(marketplace, idBruto),
      // sku_id só existe no TikTok — é a chave de custo da variação.
      ...(isTikTok ? { sku_id: normalizarIdTikTok(skuIdBruto) } : {}),
      custo:   normalizarCustoBase(idxCusto   >= 0 ? row[idxCusto]   : ""),
      imposto: normalizarImpostoBase(idxImposto >= 0 ? row[idxImposto] : ""),
      // id_model é conceito de variação da Shopee — TikTok usa sku_id.
      id_model: (marketplace === "shopee" && idxIdModel >= 0)
        ? normalizarIdShopee(row[idxIdModel])
        : null,
      produto_nome:  idxProduto  >= 0 ? normalizarTextoCelula(row[idxProduto])  : null,
      variacao_nome: idxVariacao >= 0 ? normalizarTextoCelula(row[idxVariacao]) : null,
      ...(isTikTok
        ? {
            id_cientifico:
              ehIdTikTokCientifico(idBruto) || ehIdTikTokCientifico(skuIdBruto),
          }
        : {}),
    });
  }

  return todas;
}

// ─── Resumo ───────────────────────────────────────────────────────────────────

// TikTok: a identidade da linha é o sku_id (ID DO SKU). O ID do produto repete
// entre variações de propósito e NÃO conta como duplicidade.
// MELI/Shopee: identidade é o ID, como sempre.
function chaveIdentidadeLinha(linha, marketplace) {
  return marketplace === "tiktok" ? linha.sku_id : linha.id;
}

function calcularResumo(linhas, marketplace) {
  const temIdentidade = (l) => !!chaveIdentidadeLinha(l, marketplace);
  const total    = linhas.length;
  const validas  = linhas.filter((l) => temIdentidade(l) && l.custo !== null).length;
  const importaveis = validas;
  const ignoradas = total - validas;

  const idCounts   = {};
  const idParaCusto = {};
  let duplicados   = 0;
  let conflitos    = 0;

  for (const l of linhas) {
    const chave = chaveIdentidadeLinha(l, marketplace);
    if (!chave) continue;
    idCounts[chave] = (idCounts[chave] || 0) + 1;
    if (!(chave in idParaCusto)) {
      idParaCusto[chave] = l.custo;
    } else if (idParaCusto[chave] !== l.custo) {
      conflitos++;
    }
  }

  for (const cnt of Object.values(idCounts)) {
    if (cnt > 1) duplicados++;
  }

  return { linhas_lidas: total, linhas_validas: validas, linhas_ignoradas: ignoradas, duplicados, conflitos, linhas_importaveis: importaveis };
}

// ─── Alertas ──────────────────────────────────────────────────────────────────

function gerarAlertas(linhas, mapeamento, resumo, marketplace) {
  const alertas = [];
  const isTikTok = marketplace === "tiktok";

  // TikTok: a coluna obrigatória é ID DO SKU (sku_id). A coluna ID (produto) é
  // informativa — sua ausência é aviso, não erro.
  if (isTikTok) {
    if (!mapeamento.sku_id) {
      alertas.push({
        tipo: "sem_coluna_sku_id",
        nivel: "erro",
        mensagem: 'Não foi possível detectar a coluna "ID DO SKU" (id da variação). Ela é obrigatória: é a chave do custo no TikTok. Selecione manualmente.',
      });
    }
    if (!mapeamento.id) {
      alertas.push({
        tipo: "sem_coluna_id_produto",
        nivel: "aviso",
        mensagem: 'Coluna "ID" (id do produto) não detectada. O cruzamento de custo usa apenas o ID DO SKU, então a importação continua possível.',
      });
    }
  } else if (!mapeamento.id) {
    alertas.push({ tipo: "sem_coluna_id",    nivel: "erro",    mensagem: "Não foi possível detectar a coluna de ID. Selecione manualmente." });
  }
  if (!mapeamento.custo) {
    alertas.push({ tipo: "sem_coluna_custo", nivel: "erro",    mensagem: "Não foi possível detectar a coluna de custo. Selecione manualmente." });
  }
  if (!mapeamento.imposto) {
    alertas.push({ tipo: "sem_coluna_imposto", nivel: "aviso", mensagem: "Coluna de imposto não detectada. Use 0 ou selecione manualmente." });
  }

  const rotuloIdentidade = isTikTok ? "ID DO SKU" : "ID";
  if (resumo.duplicados > 0) {
    alertas.push({
      tipo: "duplicidade",
      nivel: "warning",
      mensagem: `Foram encontrados ${resumo.duplicados} ${rotuloIdentidade} duplicados.`,
    });
  }
  if (resumo.conflitos > 0) {
    alertas.push({
      tipo: "conflito_custo",
      nivel: isTikTok ? "erro" : "warning",
      mensagem: isTikTok
        ? `${resumo.conflitos} ID DO SKU com custos diferentes em linhas repetidas. Corrija a planilha: cada variação só pode ter um custo.`
        : `${resumo.conflitos} IDs com custos diferentes em linhas duplicadas.`,
    });
  }

  const semIdentidade = linhas.filter((l) => !chaveIdentidadeLinha(l, marketplace)).length;
  if (semIdentidade > 0) {
    alertas.push({
      tipo: isTikTok ? "linhas_sem_sku_id" : "linhas_sem_id",
      nivel: "warning",
      mensagem: `${semIdentidade} linhas ignoradas por ${rotuloIdentidade} ausente ou inválido.`,
    });
  }

  // TikTok: ID em notação científica não é recuperável — o Excel já perdeu
  // dígitos. Vale para as duas colunas (ID e ID DO SKU).
  const idsCientificos = linhas.filter((l) => l.id_cientifico).length;
  if (idsCientificos > 0) {
    alertas.push({
      tipo: "id_notacao_cientifica",
      nivel: "erro",
      mensagem: `${idsCientificos} linha(s) com ID TikTok (ID ou ID DO SKU) em notação científica. Formate a coluna como texto antes de importar.`,
    });
  }

  const semCusto = linhas.filter((l) => l.custo === null).length;
  if (semCusto > 0) {
    alertas.push({ tipo: "linhas_sem_custo", nivel: "warning", mensagem: `${semCusto} linhas sem custo detectado.` });
  }

  const custoZero = linhas.filter((l) => chaveIdentidadeLinha(l, marketplace) && l.custo === 0).length;
  if (custoZero > 0) {
    alertas.push({ tipo: "custo_zerado", nivel: "info", mensagem: `${custoZero} linhas com custo igual a R$ 0,00.` });
  }

  const custoNeg = linhas.filter((l) => chaveIdentidadeLinha(l, marketplace) && l.custo !== null && l.custo < 0).length;
  if (custoNeg > 0) {
    alertas.push({ tipo: "custo_negativo", nivel: "warning", mensagem: `${custoNeg} linhas com custo negativo.` });
  }

  const impostoAlto = linhas.filter((l) => l.imposto !== null && l.imposto > 1).length;
  if (impostoAlto > 0) {
    alertas.push({ tipo: "imposto_acima_100pct", nivel: "warning", mensagem: `${impostoAlto} linhas com imposto acima de 100%.` });
  }

  return alertas;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function analisarPlanilhaBase(buffer, originalname, config) {
  config = config || {};

  // O controller já validou/normalizou; aqui só recusamos valor não suportado
  // em vez de assumir MELI para qualquer coisa.
  const marketplace = MARKETPLACES_SUPORTADOS.includes(config.marketplace)
    ? config.marketplace
    : (config.marketplace ? null : "meli");
  if (!marketplace) {
    throw criarErro(400, `marketplace inválido: "${config.marketplace}". Use: ${MARKETPLACES_SUPORTADOS.join(", ")}.`);
  }

  const ext = path.extname(String(originalname || "")).toLowerCase();
  if (![".xlsx", ".xls", ".csv"].includes(ext)) {
    throw criarErro(400, "Formato inválido. Envie .xlsx, .xls ou .csv.");
  }

  const workbook = lerWorkbookPlanilha(buffer, originalname);
  const abas = listarAbas(workbook);
  if (!abas.length) throw criarErro(400, "A planilha não possui abas válidas.");

  // Seleciona aba: config.aba se fornecida e válida, senão a primeira
  if (config.aba && !workbook.Sheets[config.aba]) {
    throw criarErro(400, `Aba "${config.aba}" não encontrada. Disponíveis: ${abas.join(", ")}.`);
  }
  const nomeAba = (config.aba && workbook.Sheets[config.aba]) ? config.aba : abas[0];

  const sheet = workbook.Sheets[nomeAba];
  repairWorksheetRef(sheet);
  const rowsAsArrays = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
  if (!rowsAsArrays.length) throw criarErro(400, "A planilha está vazia.");

  // Linha de cabeçalho
  const linhaHeader = config.linhaCabecalho !== undefined
    ? Math.max(0, parseInt(config.linhaCabecalho) || 0)
    : detectarCabecalho(rowsAsArrays, marketplace);

  const headerRow = rowsAsArrays[linhaHeader] || [];
  const { detectadas, disponiveis } = detectarColunas(headerRow, marketplace);

  // Aplica overrides manuais de coluna
  const colunasFinais = {
    id:       detectadas.id,
    sku_id:   detectadas.sku_id,
    custo:    detectadas.custo,
    imposto:  detectadas.imposto,
    id_model: detectadas.id_model,
    produto_nome:  detectadas.produto_nome,
    variacao_nome: detectadas.variacao_nome,
  };

  if (config.colunas) {
    for (const tipo of ["id", "sku_id", "custo", "imposto", "id_model", "produto_nome", "variacao_nome"]) {
      const letraOverride = config.colunas[tipo];
      if (letraOverride) {
        const letra    = String(letraOverride).toUpperCase().trim();
        const idx      = letraParaIndice(letra);
        const cabecalho = String(headerRow[idx] || "").trim();
        colunasFinais[tipo] = { coluna: letra, cabecalho, confianca: 100 };
      }
    }
  }

  const mapeamento = {
    id:       colunasFinais.id       ? colunasFinais.id.coluna       : null,
    sku_id:   colunasFinais.sku_id   ? colunasFinais.sku_id.coluna   : null,
    custo:    colunasFinais.custo    ? colunasFinais.custo.coluna    : null,
    imposto:  colunasFinais.imposto  ? colunasFinais.imposto.coluna  : null,
    id_model: colunasFinais.id_model ? colunasFinais.id_model.coluna : null,
    produto_nome:  colunasFinais.produto_nome  ? colunasFinais.produto_nome.coluna  : null,
    variacao_nome: colunasFinais.variacao_nome ? colunasFinais.variacao_nome.coluna : null,
  };

  const todasLinhas     = processarLinhas(rowsAsArrays, linhaHeader, mapeamento, marketplace);
  const resumo          = calcularResumo(todasLinhas, marketplace);
  const alertas         = gerarAlertas(todasLinhas, mapeamento, resumo, marketplace);
  const dadosImportacao = todasLinhas
    // TikTok: a linha só é importável com ID DO SKU (chave de custo). O ID do
    // produto é opcional. Demais marketplaces seguem exigindo o ID.
    .filter((l) => chaveIdentidadeLinha(l, marketplace) && l.custo !== null)
    .map((l) => ({
      id:       l.id,
      ...(marketplace === "tiktok" ? { sku_id: l.sku_id } : {}),
      custo:    l.custo,
      imposto:  l.imposto,
      // id_model só existe para Shopee; TikTok identifica a variação por sku_id.
      id_model: marketplace === "shopee" ? (l.id_model || null) : null,
      produto_nome:  l.produto_nome  || null,
      variacao_nome: l.variacao_nome || null,
    }));

  // Confiança geral = média das colunas detectadas. No TikTok a coluna de
  // identidade é sku_id (ID DO SKU), não o ID do produto.
  const camposConfianca = marketplace === "tiktok"
    ? ["sku_id", "custo", "imposto"]
    : ["id", "custo", "imposto"];
  const scoresParciais = camposConfianca
    .map((t) => (colunasFinais[t] ? colunasFinais[t].confianca : 0))
    .filter((s) => s > 0);
  const confiancaGeral = scoresParciais.length
    ? Math.round(scoresParciais.reduce((a, b) => a + b, 0) / scoresParciais.length)
    : 0;

  if (confiancaGeral > 0 && confiancaGeral < 50) {
    alertas.push({
      tipo: "baixa_confianca",
      nivel: "warning",
      mensagem: `Confiança geral na detecção automática é baixa (${confiancaGeral}%). Revise os mapeamentos.`,
    });
  }

  return {
    ok: true,
    marketplace,
    arquivo:            originalname,
    abas_disponiveis:   abas,
    aba_detectada:      nomeAba,
    linha_cabecalho:    linhaHeader,
    colunas_detectadas: colunasFinais,
    colunas_disponiveis: disponiveis,
    confianca_geral:    confiancaGeral,
    resumo,
    alertas,
    preview:           todasLinhas.slice(0, 50),
    dados_importacao:  dadosImportacao,
  };
}

module.exports = {
  analisarPlanilhaBase,
  listarAbas,
  detectarCabecalho,
  detectarColunas,
  normalizarIdBase,
  normalizarIdShopee,
  normalizarIdTikTok,
  normalizarCustoBase,
  normalizarImpostoBase,
  calcularResumo,
  gerarAlertas,
};
