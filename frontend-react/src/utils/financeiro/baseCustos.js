// frontend-react/src/utils/financeiro/baseCustos.js
//
// Correção de custo NA BASE a partir do Financeiro — a parte que decide SE e
// COMO uma pendência pode ser gravada, sem inventar matching.
//
// Fatos do backend (auditados em server/services/bases/*):
//   · MELI: a identidade de uma linha de `custos` é o produto_id (MLB).
//   · Shopee (FIN-508): a identidade é Item + Model — o mesmo Item tem uma
//     linha por variação, cada uma com o seu custo/imposto; a linha sem Model
//     é o custo "pai" do Item. O upsert grava EXATAMENTE Item + Model e nunca
//     muda o Model de outra linha; sem Model, só a linha pai — e recusa (409)
//     se o Item só tiver variações.
//   · imposto_percentual é guardado como FRAÇÃO (0,08 = 8%). A tela de Bases
//     converte o % digitado dividindo por 100.
//
// Daí as três classes de identidade:
//   segura        → o registro-alvo é inequívoco (criar ou atualizar)
//   ambigua       → a venda não diz o Model e o Item tem UMA variação na base:
//                   mostra o registro real e o operador escolhe explicitamente
//   insuficiente  → sem Item ID, ou várias variações e a venda não diz qual
//                   (ou 2+ registros da mesma identidade): não grava
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
        ? "Sem ID do Item nesta linha (só SKU/Model ou pedido): não dá para saber qual registro da base atualizar — nem aqui, nem pela planilha. Cadastre o custo em Bases de Custo pelo ID do Item."
        : "Sem o MLB do anúncio nesta linha: não dá para saber qual registro da base atualizar. Cadastre o custo em Bases de Custo pelo MLB.",
    };
  }

  const registros = (indice && indice.get(produtoId)) || [];
  if (shopee) return identidadeShopee({ produtoId, idModel: normalizarIdShopee(p.modelId) || null, registros });

  if (registros.length > 1) {
    return {
      classe: "insuficiente",
      acao: null,
      produtoId,
      motivo: `A base tem ${registros.length} registros para ${produtoId} (distinguidos por SKU) e o servidor não escolhe entre eles. Corrija em Bases de Custo.`,
    };
  }
  if (registros.length === 0) {
    return { classe: "segura", acao: "criar", produtoId, idModel: null, registro: null, candidatos: [], motivo: null };
  }
  return { classe: "segura", acao: "atualizar", produtoId, idModel: null, registro: registros[0], candidatos: [], motivo: null };
}

// Shopee: a linha da base é a VARIAÇÃO (Item + Model).
function identidadeShopee({ produtoId, idModel, registros }) {
  const daVariacao = registros.filter((r) => (r.idModel || null) === idModel);
  if (daVariacao.length > 1) {
    return {
      classe: "insuficiente",
      acao: null,
      produtoId,
      motivo: `A base tem ${daVariacao.length} registros para Item ${produtoId}${idModel ? ` · Model ${idModel}` : " sem Model"} (distinguidos por SKU) e o servidor não escolhe entre eles. Corrija em Bases de Custo.`,
    };
  }
  if (daVariacao.length === 1) {
    return { classe: "segura", acao: "atualizar", produtoId, idModel, registro: daVariacao[0], candidatos: [], motivo: null };
  }
  // Com Model: variação nova — as outras variações do Item não mudam.
  const variacoes = registros.filter((r) => r.idModel);
  if (idModel || variacoes.length === 0) {
    return { classe: "segura", acao: "criar", produtoId, idModel, registro: null, candidatos: [], motivo: null };
  }
  // Sem Model na venda e o Item só tem variações na base.
  if (variacoes.length === 1) {
    const reg = variacoes[0];
    return {
      classe: "ambigua",
      acao: "atualizar",
      produtoId,
      idModel: null,
      registro: reg,
      candidatos: [
        {
          id: "registro",
          rotulo: `Item ${produtoId} · Model ${reg.idModel}`,
          descricao: "Atualizar o custo desta variação — a única do Item na base. A venda não traz o Model, então confirme que é ela.",
          idModel: reg.idModel,
        },
      ],
      motivo: `A venda não traz o Model e o Item ${produtoId} tem uma variação na base (Model ${reg.idModel}).`,
    };
  }
  return {
    classe: "insuficiente",
    acao: null,
    produtoId,
    motivo: `O Item ${produtoId} tem ${variacoes.length} variações na base e esta venda não diz qual (sem Model). Corrija em Bases de Custo pela variação certa.`,
  };
}

// O registro da base que a planilha de pendências mostra como "custo atual":
// só quando a identidade aponta para UM registro (nunca o de outra variação).
export function registroDaPendencia({ marketplace, pendencia, indice }) {
  const identidade = identidadeDaPendencia({ marketplace, pendencia, indice });
  return identidade.classe === "segura" ? identidade.registro || null : null;
}

// ── Planilha preenchida → o que cada linha faria na base ────────────────────
// `dados` = dados_importacao do preview real (POST /bases/assistente/preview):
// já só traz linhas COM custo; ausência nunca virou 0.
// Regras (as da tela Bases + as proteções que ela não tem):
//   · mesma identidade repetida com o MESMO custo/imposto → uma linha só;
//   · mesma identidade com custos/impostos diferentes → AMBÍGUA (não grava);
//   · Shopee: a identidade é Item + Model — Models diferentes do mesmo Item são
//     linhas diferentes; sem Model, só a linha pai (se o Item só tem
//     variações na base, AMBÍGUA: informe o Model);
//   · 2+ registros da mesma identidade na base → AMBÍGUA.
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
    const chave = `${produtoId}|${linha.idModel || ""}`;
    if (!grupos.has(chave)) {
      grupos.set(chave, [linha]);
      continue;
    }
    const igual = grupos.get(chave).some((x) => x.custo === linha.custo && x.imposto === linha.imposto);
    if (igual) repetidasIguais += 1;
    else grupos.get(chave).push(linha);
  }

  const linhas = [];
  for (const versoes of grupos.values()) {
    if (versoes.length > 1) {
      const v = versoes[0];
      const rotulo = shopee ? `Item + Model${v.idModel ? "" : " (sem Model)"}` : "ID";
      linhas.push({ ...v, acao: "ambigua", motivo: `${rotulo} repetido na planilha com valores diferentes (${versoes.length} versões) — nenhuma foi gravada.` });
      continue;
    }
    const linha = versoes[0];
    const registros = indice.get(linha.produtoId) || [];
    const mesmos = shopee ? registros.filter((r) => (r.idModel || null) === linha.idModel) : registros;
    if (mesmos.length > 1) {
      linhas.push({ ...linha, acao: "ambigua", motivo: `A base tem ${mesmos.length} registros para esta identidade (distinguidos por SKU).` });
    } else if (mesmos.length === 1) {
      linhas.push({ ...linha, acao: "atualizar", motivo: null });
    } else if (shopee && !linha.idModel && registros.some((r) => r.idModel)) {
      linhas.push({
        ...linha,
        acao: "ambigua",
        motivo: `O Item tem ${registros.filter((r) => r.idModel).length} variação(ões) na base e esta linha não traz o Model — preencha o Model ID da variação.`,
      });
    } else {
      linhas.push({ ...linha, acao: "adicionar", motivo: null });
    }
  }

  const conta = (a) => linhas.filter((l) => l.acao === a).length;
  return { linhas, resumo: { atualizar: conta("atualizar"), adicionar: conta("adicionar"), ambiguas: conta("ambigua"), repetidasIguais } };
}
