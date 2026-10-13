// frontend-react/src/utils/financeiro/baseCustos.js
//
// Correção de custo NA BASE a partir do Financeiro — a parte que decide SE e
// COMO uma pendência pode ser gravada, sem inventar matching.
//
// Fatos do backend (auditados em server/services/bases/*):
//   · MELI e Shopee: a identidade de uma linha de `custos` é o produto_id (Item
//     ID / MLB) — no preview, no importador e no upsert. `id_model` é só um
//     ATRIBUTO da linha. Gravar uma variação de um Item que já tem registro
//     SOBRESCREVE o registro existente (inclusive o id_model).
//   · O upsert localiza por (base, produto_id) com LIMIT 1: se houver 2+
//     registros do mesmo Item (distinguidos por SKU), ele não sabe qual.
//   · imposto_percentual é guardado como FRAÇÃO (0,08 = 8%). A tela de Bases
//     converte o % digitado dividindo por 100.
//
// Daí as três classes de identidade (Shopee; o MELI é a mesma regra sem Model):
//   segura        → o registro-alvo é inequívoco (criar ou atualizar)
//   ambigua       → existe UM registro do Item com outro Model: mostra o
//                   registro real e o operador escolhe explicitamente
//   insuficiente  → sem Item ID, ou 2+ registros do mesmo Item: não grava
//
// Nada aqui chama a API e nenhum número financeiro é calculado.

const texto = (v) => (v === null || v === undefined ? "" : String(v).trim());

// ── IDs ─────────────────────────────────────────────────────────────────────
// Mesma normalização do servidor (baseCustosService.normalizarProdutoId*):
// o que a tela compara é o que o servidor gravaria.
export function normalizarIdMeli(valor) {
  let limpo = texto(valor).replace(/^['"]+|['"]+$/g, "").trim();
  if (!limpo) return "";
  if (/^\d+\.0+$/.test(limpo)) limpo = limpo.replace(/\.0+$/, "");
  const m = limpo.toUpperCase().match(/MLB[U]?\d+/);
  if (m) return m[0];
  if (/^\d+$/.test(limpo)) return `MLB${limpo}`;
  return limpo;
}

export function normalizarIdShopee(valor) {
  let limpo = texto(valor).replace(/^['"]+|['"]+$/g, "").trim();
  if (!limpo) return "";
  if (/^\d+\.0+$/.test(limpo)) limpo = limpo.replace(/\.0+$/, "");
  return limpo;
}

export const normalizarId = (marketplace, valor) => (marketplace === "shopee" ? normalizarIdShopee(valor) : normalizarIdMeli(valor));

// ── Imposto: fração (banco) ↔ pontos (tela) ─────────────────────────────────
export function fracaoParaPontos(fracao) {
  if (fracao === null || fracao === undefined || fracao === "") return null;
  const n = Number(fracao);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10000) / 100; // 0,105 → 10,5
}

// "10,5" | "10.5" | "10,5%" → 10,5 (pontos). Vazio → null. Inválido → NaN.
export function parsePontosBR(entrada) {
  const bruto = texto(entrada).replace("%", "").trim();
  if (!bruto) return null;
  const n = Number(bruto.replace(/\./g, (m, i, s) => (s.includes(",") ? "" : m)).replace(",", "."));
  return Number.isFinite(n) ? n : Number.NaN;
}

export const pontosParaFracao = (pontos) => (pontos === null || pontos === undefined ? null : Math.round((Number(pontos) / 100) * 1e8) / 1e8);

export function formatarPontos(pontos) {
  if (pontos === null || pontos === undefined) return "";
  return Number(pontos).toLocaleString("pt-BR", { maximumFractionDigits: 4, useGrouping: false });
}

// ── Itens da base ───────────────────────────────────────────────────────────
// GET /bases/:slug devolve `dados` como dicionário. Normaliza para lista.
export function itensDaBase(resposta) {
  const dados = resposta?.dados && typeof resposta.dados === "object" ? resposta.dados : {};
  return Object.values(dados).map((v) => ({
    produtoId: texto(v.produto_id),
    idModel: texto(v.id_model) || null,
    sku: texto(v.sku) || null,
    custo: v.custo_produto === null || v.custo_produto === undefined ? null : Number(v.custo_produto),
    imposto: v.imposto_percentual === null || v.imposto_percentual === undefined ? null : Number(v.imposto_percentual), // fração
    nome: v.produto_nome || null,
  }));
}

export function indexarPorProduto(itens) {
  const mapa = new Map();
  for (const it of itens || []) {
    if (!it.produtoId) continue;
    if (!mapa.has(it.produtoId)) mapa.set(it.produtoId, []);
    mapa.get(it.produtoId).push(it);
  }
  return mapa;
}

// ── Identidade de uma pendência ─────────────────────────────────────────────
// Devolve:
//   { classe: "segura"|"ambigua"|"insuficiente", acao: "criar"|"atualizar"|null,
//     produtoId, idModel, registro, candidatos, motivo }
// `candidatos` (só em "ambigua"): opções que o operador escolhe — cada uma com
// o `idModel` que seria GRAVADO.
export function identidadeDaPendencia({ marketplace, pendencia: p, indice }) {
  const shopee = marketplace === "shopee";
  const produtoId = normalizarId(marketplace, p.itemId);

  if (p.statusCusto === "ambiguo") {
    return { classe: "insuficiente", acao: null, produtoId, motivo: "Custo ambíguo: há custos diferentes para o mesmo produto na base. Resolva em Bases de Custo." };
  }
  if (!produtoId) {
    return {
      classe: "insuficiente",
      acao: null,
      produtoId: "",
      motivo: shopee
        ? "Esta linha não traz o ID do Item (só SKU ou pedido). Sem o Item não dá para saber qual registro da base atualizar — use a planilha."
        : "Esta linha não traz o MLB do anúncio.",
    };
  }

  const registros = (indice && indice.get(produtoId)) || [];
  if (registros.length > 1) {
    return {
      classe: "insuficiente",
      acao: null,
      produtoId,
      motivo: `A base tem ${registros.length} registros para ${produtoId} (distinguidos por SKU) e o servidor não escolhe entre eles. Corrija em Bases de Custo.`,
    };
  }

  const idModel = shopee ? normalizarIdShopee(p.modelId) || null : null;

  if (registros.length === 0) {
    return { classe: "segura", acao: "criar", produtoId, idModel, registro: null, candidatos: [], motivo: null };
  }

  const reg = registros[0];
  if (!shopee || (idModel ? reg.idModel === idModel : !reg.idModel)) {
    return { classe: "segura", acao: "atualizar", produtoId, idModel: shopee ? reg.idModel : null, registro: reg, candidatos: [], motivo: null };
  }

  // Shopee: o Item já tem UM registro e ele é de outra variação (ou do pai).
  // Gravar sobrescreveria o registro existente — o operador escolhe.
  const candidatos = [
    {
      id: "registro",
      rotulo: `Item ${produtoId}${reg.idModel ? ` · Model ${reg.idModel}` : " (item pai)"}`,
      descricao: "Atualizar só o custo do registro que já existe — o Model dele não muda.",
      idModel: reg.idModel,
    },
  ];
  if (idModel) {
    candidatos.push({
      id: "variacao",
      rotulo: `Variação ${idModel}`,
      descricao: `Gravar o custo como desta variação. O registro existente ${reg.idModel ? `(Model ${reg.idModel})` : "(item pai)"} deixa de ser o dela: a base guarda um registro por Item.`,
      idModel,
    });
  }
  return {
    classe: "ambigua",
    acao: "atualizar",
    produtoId,
    idModel,
    registro: reg,
    candidatos,
    motivo: `O Item ${produtoId} já tem um registro na base${reg.idModel ? ` (Model ${reg.idModel})` : " (sem Model)"}.`,
  };
}

// ── Planilha preenchida → o que cada linha faria na base ────────────────────
// `dados` = dados_importacao do preview real (POST /bases/assistente/preview):
// já só traz linhas COM custo; ausência nunca virou 0.
// Regras (as da tela Bases + as proteções que ela não tem):
//   · mesmo ID repetido com o MESMO custo/imposto/Model → uma linha só;
//   · mesmo ID com custos/Models diferentes → AMBÍGUA (não grava nenhuma);
//   · Shopee: o Item existe na base com outro Model → AMBÍGUA (sobrescreveria);
//   · 2+ registros do Item na base → AMBÍGUA.
export function classificarLinhasPlanilha({ marketplace, dados, itensBase }) {
  const shopee = marketplace === "shopee";
  const indice = indexarPorProduto(itensBase);

  const grupos = new Map();
  let repetidasIguais = 0;
  for (const bruta of dados || []) {
    const produtoId = normalizarId(marketplace, bruta.id);
    if (!produtoId) continue;
    const linha = {
      produtoId,
      idModel: shopee ? normalizarIdShopee(bruta.id_model) || null : null,
      custo: bruta.custo,
      imposto: bruta.imposto === undefined ? null : bruta.imposto, // fração (o preview já converte)
      nome: bruta.produto_nome || null,
    };
    if (!grupos.has(produtoId)) {
      grupos.set(produtoId, [linha]);
      continue;
    }
    const igual = grupos.get(produtoId).some((x) => x.custo === linha.custo && x.imposto === linha.imposto && x.idModel === linha.idModel);
    if (igual) repetidasIguais += 1;
    else grupos.get(produtoId).push(linha);
  }

  const linhas = [];
  for (const [produtoId, versoes] of grupos) {
    if (versoes.length > 1) {
      linhas.push({ ...versoes[0], acao: "ambigua", motivo: `ID repetido na planilha com valores diferentes (${versoes.length} versões) — nenhuma foi gravada.` });
      continue;
    }
    const linha = versoes[0];
    const registros = indice.get(produtoId) || [];
    if (registros.length === 0) {
      linhas.push({ ...linha, acao: "adicionar", motivo: null });
    } else if (registros.length > 1) {
      linhas.push({ ...linha, acao: "ambigua", motivo: `A base tem ${registros.length} registros para este ID (distinguidos por SKU).` });
    } else if (shopee && (registros[0].idModel || null) !== linha.idModel) {
      linhas.push({
        ...linha,
        acao: "ambigua",
        motivo: `O Item já tem um registro na base${registros[0].idModel ? ` com Model ${registros[0].idModel}` : " sem Model"}; gravar o Model ${linha.idModel || "(vazio)"} sobrescreveria esse registro.`,
      });
    } else {
      linhas.push({ ...linha, acao: "atualizar", motivo: null });
    }
  }

  const conta = (a) => linhas.filter((l) => l.acao === a).length;
  return { linhas, resumo: { atualizar: conta("atualizar"), adicionar: conta("adicionar"), ambiguas: conta("ambigua"), repetidasIguais } };
}
