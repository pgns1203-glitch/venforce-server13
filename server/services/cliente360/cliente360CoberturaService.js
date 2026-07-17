// server/services/cliente360/cliente360CoberturaService.js
// Cobertura da base por faturamento — motor PURO (sem SQL, sem chamadas ML).
// Cruza o faturamento por produto persistido no snapshot
// (cliente_360_resumos_mensais.payload_json.topProdutos, gravado pelo
// SyncService) com o status com base/sem base do último diagnóstico
// (relatorio_itens.tem_base). Chave de cruzamento: MLB; SKU só como
// fallback quando o MLB não existe e o SKU é único no relatório.
//
// Regras de honestidade do dado:
//   - ausência de dado NUNCA vira 0 — vira disponivel:false + motivo;
//   - percentual sem denominador é null, nunca 0;
//   - zero real (mês sincronizado sem vendas) é exposto com disponivel:true.

const r2 = (v) => Math.round(Number(v) * 100) / 100;
const r1 = (v) => Math.round(Number(v) * 10) / 10;
const numOrNull = (v) => (v === null || v === undefined ? null : Number(v));

const TOP_RANKING = 10;       // produtos sem base no ranking exposto
const MATRIZ_MAX = 20;        // itens por grupo da preparação da matriz
const DETALHE_OK_PCT = 90;    // detalhamento abaixo disso rebaixa confiança
const DETALHE_MIN_PCT = 60;   // abaixo disso a confiança é baixa
const RELATORIO_VELHO_D = 30; // dias até o diagnóstico rebaixar confiança
const RELATORIO_MUITO_VELHO_D = 60;

function pctDe(parte, total) {
  const p = Number(parte);
  const t = Number(total);
  if (!Number.isFinite(p)) return null;
  if (!Number.isFinite(t) || t <= 0) return null;
  return r1((p / t) * 100);
}

function fmtPctBr(v) {
  return `${Number(v).toFixed(1).replace(".", ",")}%`;
}

function normalizarMlb(v) {
  const s = String(v || "").trim().toUpperCase();
  if (!s || s === "DESCONHECIDO") return null;
  return s;
}

function normalizarSku(v) {
  const s = String(v || "").trim();
  return s || null;
}

// Extrai o detalhe por produto do snapshot. null = snapshot sem detalhamento
// (sync antigo); lista vazia = detalhe sincronizado com zero vendas (real).
function detalheDoSnapshot(snapshot) {
  const pj = snapshot?.payload_json;
  if (!pj || !Array.isArray(pj.topProdutos)) return null;
  return {
    produtos: pj.topProdutos.map((p) => ({
      mlb: normalizarMlb(p.mlb ?? p.itemId),
      sku: normalizarSku(p.sku),
      titulo: p.titulo || null,
      unidades: Number(p.unidades) || 0,
      faturamento: Number(p.faturamento) || 0,
    })),
    truncado: !!pj.topProdutosTruncado,
    geradoEm: pj.topProdutosEm || snapshot.sincronizado_em || null,
  };
}

function diasDesde(dataIso) {
  if (!dataIso) return null;
  const ms = Date.now() - new Date(dataIso).getTime();
  return Number.isFinite(ms) ? ms / 86400000 : null;
}

// pior nível ganha: alta < media < baixa
function rebaixar(nivelAtual, novoNivel) {
  const peso = { alta: 0, media: 1, baixa: 2 };
  return peso[novoNivel] > peso[nivelAtual] ? novoNivel : nivelAtual;
}

function contagensDiagnostico(relatorio, relatorioItens) {
  if (Array.isArray(relatorioItens) && relatorioItens.length) {
    const semBase = relatorioItens.filter((it) => it.tem_base === false).length;
    return {
      qtdItensDiagnostico: relatorioItens.length,
      qtdItensComBase: relatorioItens.length - semBase,
      qtdItensSemBase: semBase,
    };
  }
  if (relatorio) {
    return {
      qtdItensDiagnostico: numOrNull(relatorio.totalItens),
      qtdItensComBase: null,
      qtdItensSemBase: numOrNull(relatorio.itensSemBase),
    };
  }
  return { qtdItensDiagnostico: null, qtdItensComBase: null, qtdItensSemBase: null };
}

function indisponivel({ motivo, mensagem, periodoAlvo, tipo, relatorio, contagens }) {
  return {
    disponivel: false,
    motivo,
    mensagem,
    periodo: periodoAlvo
      ? { competencia: periodoAlvo.competencia, label: periodoAlvo.label, tipo }
      : null,
    // Mantém a contagem seca do diagnóstico mesmo sem faturamento por produto
    // — deixa claro que ainda não dá para ponderar por receita.
    diagnostico: relatorio
      ? {
          fonte: `relatorio_${relatorio.id}`,
          criadoEm: relatorio.criadoEm || null,
          qtdItensDiagnostico: contagens.qtdItensDiagnostico,
          qtdItensComBase: contagens.qtdItensComBase,
          qtdItensSemBase: contagens.qtdItensSemBase,
        }
      : null,
  };
}

/**
 * Monta o bloco coberturaBaseFaturamento do payload da Cliente 360.
 *
 * @param {object} p
 * @param {object} p.periodo           período solicitado { competencia, label }
 * @param {string} [p.tipoPeriodo]     tipo do período solicitado: mes_anterior | mes_atual | selecionado
 * @param {object|null} p.periodoAnterior  mês imediatamente anterior ao solicitado { competencia, label }
 * @param {string} [p.tipoPeriodoAnterior] tipo do mês anterior ao solicitado
 * @param {boolean} p.filtroManual     true quando o usuário pediu competência específica
 * @param {object|null} p.snapshotAtual    linha de cliente_360_resumos_mensais do período solicitado
 * @param {object|null} p.snapshotAnterior idem para o mês anterior ao solicitado
 * @param {object|null} p.relatorio    último relatório mapeado ({ id, criadoEm, itensSemBase, totalItens })
 * @param {Array} p.relatorioItens     linhas de relatorio_itens (item_id, sku, titulo, tem_base, mc, diagnostico)
 */
function montarCoberturaBaseFaturamento({
  periodo,
  tipoPeriodo,
  periodoAnterior,
  tipoPeriodoAnterior,
  filtroManual,
  snapshotAtual,
  snapshotAnterior,
  relatorio,
  relatorioItens,
}) {
  const contagens = contagensDiagnostico(relatorio, relatorioItens);
  const tipoPadrao = tipoPeriodo || "selecionado";

  // Sem diagnóstico com itens não há como separar com base de sem base.
  if (!relatorio || !Array.isArray(relatorioItens) || !relatorioItens.length) {
    return indisponivel({
      motivo: "sem_relatorio",
      mensagem: "Nenhum diagnóstico com itens para separar produtos com base e sem base.",
      periodoAlvo: periodo,
      tipo: tipoPadrao,
      relatorio,
      contagens,
    });
  }

  // Escolha do período: o período analisado pela tela (já mês anterior por
  // padrão) vem primeiro; sem filtro manual, o mês anterior a ele entra como
  // fallback rotulado quando só ele tiver detalhamento por produto.
  const candidatos = filtroManual
    ? [{ snap: snapshotAtual, periodo, tipo: tipoPadrao }]
    : [
        { snap: snapshotAtual, periodo, tipo: tipoPadrao },
        { snap: snapshotAnterior, periodo: periodoAnterior, tipo: tipoPeriodoAnterior || "selecionado" },
      ];

  let escolhido = null;
  for (const c of candidatos) {
    if (!c.snap || !c.periodo) continue;
    const det = detalheDoSnapshot(c.snap);
    if (det) { escolhido = { ...c, det }; break; }
  }

  if (!escolhido) {
    const temAlgumSnapshot = candidatos.some((c) => c.snap);
    return indisponivel({
      motivo: temAlgumSnapshot ? "sem_faturamento_por_produto" : "sem_snapshot",
      mensagem: temAlgumSnapshot
        ? "O snapshot salvo não tem faturamento por produto. A próxima sincronização grava esse detalhamento."
        : "Sem snapshot salvo para o período. O faturamento por produto é gravado na sincronização.",
      periodoAlvo: periodo,
      tipo: tipoPadrao,
      relatorio,
      contagens,
    });
  }

  const { snap, det } = escolhido;

  // ── Índices do diagnóstico: MLB principal; SKU só quando único ─────────
  const porMlb = new Map();
  const porSku = new Map();
  const skuAmbiguo = new Set();
  for (const it of relatorioItens) {
    const mlb = normalizarMlb(it.item_id);
    if (mlb && !porMlb.has(mlb)) porMlb.set(mlb, it);
    const sku = normalizarSku(it.sku);
    if (sku) {
      if (porSku.has(sku)) skuAmbiguo.add(sku);
      else porSku.set(sku, it);
    }
  }
  for (const s of skuAmbiguo) porSku.delete(s); // SKU repetido não é chave segura

  // ── Cruzamento e somas ──────────────────────────────────────────────────
  let fatComBase = 0;
  let fatSemBase = 0;
  let fatNaoClassificado = 0;
  const semBaseVendidos = [];
  const idsSemBaseComVenda = new Set();
  const matriz = {
    altoFaturamentoComBaseSaudavel: [],
    altoFaturamentoSemBase: [],
    altoFaturamentoCritico: [],
    baixoFaturamentoCritico: [],
    naoClassificado: [],
  };
  const cruzados = []; // { produto, item|null, viaSku }

  for (const p of det.produtos) {
    let item = p.mlb ? porMlb.get(p.mlb) : null;
    let viaSku = false;
    if (!item && !p.mlb && p.sku && porSku.has(p.sku)) {
      item = porSku.get(p.sku);
      viaSku = true;
    }
    cruzados.push({ produto: p, item: item || null, viaSku });

    if (!item) {
      fatNaoClassificado += p.faturamento;
      continue;
    }
    if (item.tem_base === false) {
      fatSemBase += p.faturamento;
      idsSemBaseComVenda.add(item.id);
      semBaseVendidos.push({ ...p, viaSku });
    } else {
      fatComBase += p.faturamento;
    }
  }

  const faturamentoAnalisado = r2(fatComBase + fatSemBase + fatNaoClassificado);
  fatComBase = r2(fatComBase);
  fatSemBase = r2(fatSemBase);
  fatNaoClassificado = r2(fatNaoClassificado);

  const faturamentoTotalMes = numOrNull(snap.faturamento);
  const pctDetalhamento = pctDe(faturamentoAnalisado, faturamentoTotalMes);
  const pctComBase = pctDe(fatComBase, faturamentoAnalisado);
  const pctSemBase = pctDe(fatSemBase, faturamentoAnalisado);
  const pctNaoClassificado = pctDe(fatNaoClassificado, faturamentoAnalisado);

  const qtdItensSemBaseComVenda = idsSemBaseComVenda.size;
  const qtdItensSemBaseSemVenda = contagens.qtdItensSemBase !== null
    ? Math.max(0, contagens.qtdItensSemBase - qtdItensSemBaseComVenda)
    : null;

  // ── Ranking de produtos sem base por faturamento ────────────────────────
  semBaseVendidos.sort((a, b) => b.faturamento - a.faturamento);
  const produtosSemBaseMaisRelevantes = semBaseVendidos.slice(0, TOP_RANKING).map((p) => ({
    mlb: p.mlb,
    sku: p.sku,
    titulo: p.titulo,
    faturamento: r2(p.faturamento),
    unidades: p.unidades,
    pctDaReceitaSemBase: pctDe(p.faturamento, fatSemBase),
    pctDoFaturamentoAnalisado: pctDe(p.faturamento, faturamentoAnalisado),
    statusDiagnostico: "sem_base",
    fonte: p.viaSku ? "snapshot+relatorio (sku)" : "snapshot+relatorio",
  }));

  const topN = Math.min(5, semBaseVendidos.length);
  const top5Faturamento = r2(
    semBaseVendidos.slice(0, 5).reduce((s, p) => s + p.faturamento, 0)
  );
  const concentracaoSemBase = {
    topN,
    top5Faturamento,
    top5PctDaReceitaSemBase: pctDe(top5Faturamento, fatSemBase),
  };

  // ── Preparação da Matriz Receita x Risco ────────────────────────────────
  // "Alto faturamento" = classe A da curva ABC: produtos que, ordenados por
  // faturamento, acumulam os primeiros 80% da receita analisada (o produto
  // que cruza a linha ainda conta). Corte determinístico e autoescalável.
  const mlbsAlto = new Set();
  if (faturamentoAnalisado > 0) {
    const ordenados = [...det.produtos].sort((a, b) => b.faturamento - a.faturamento);
    let acumulado = 0;
    for (const p of ordenados) {
      if (p.faturamento <= 0) break;
      const antes = acumulado;
      acumulado += p.faturamento;
      if (antes / faturamentoAnalisado < 0.8) mlbsAlto.add(p);
    }
  }
  const slim = ({ produto, item }) => ({
    mlb: produto.mlb,
    titulo: produto.titulo || item?.titulo || null,
    faturamento: r2(produto.faturamento),
    mc: item ? numOrNull(item.mc) : null,
    statusDiagnostico: item ? (item.diagnostico || (item.tem_base === false ? "sem_base" : null)) : "nao_classificado",
  });
  for (const c of cruzados) {
    const alto = mlbsAlto.has(c.produto);
    if (!c.item) {
      if (matriz.naoClassificado.length < MATRIZ_MAX) matriz.naoClassificado.push(slim(c));
      continue;
    }
    const status = c.item.diagnostico || (c.item.tem_base === false ? "sem_base" : null);
    if (c.item.tem_base === false) {
      if (alto && matriz.altoFaturamentoSemBase.length < MATRIZ_MAX) matriz.altoFaturamentoSemBase.push(slim(c));
      continue;
    }
    if (status === "critico") {
      const grupo = alto ? matriz.altoFaturamentoCritico : matriz.baixoFaturamentoCritico;
      if (grupo.length < MATRIZ_MAX) grupo.push(slim(c));
    } else if (alto && status === "saudavel") {
      if (matriz.altoFaturamentoComBaseSaudavel.length < MATRIZ_MAX) matriz.altoFaturamentoComBaseSaudavel.push(slim(c));
    }
  }

  // ── Confiança da leitura ────────────────────────────────────────────────
  let confianca = "alta";
  const motivosConfianca = [];
  if (escolhido.tipo === "mes_atual") {
    confianca = rebaixar(confianca, "media");
    motivosConfianca.push("competência em aberto — os números mudam ao longo do mês");
  }
  const idadeRel = diasDesde(relatorio.criadoEm);
  if (idadeRel !== null && idadeRel > RELATORIO_MUITO_VELHO_D) {
    confianca = rebaixar(confianca, "baixa");
    motivosConfianca.push(`diagnóstico com mais de ${RELATORIO_MUITO_VELHO_D} dias`);
  } else if (idadeRel !== null && idadeRel > RELATORIO_VELHO_D) {
    confianca = rebaixar(confianca, "media");
    motivosConfianca.push(`diagnóstico com mais de ${RELATORIO_VELHO_D} dias`);
  }
  if (pctDetalhamento !== null && pctDetalhamento < DETALHE_MIN_PCT) {
    confianca = rebaixar(confianca, "baixa");
    motivosConfianca.push(`detalhamento por produto cobre só ${fmtPctBr(pctDetalhamento)} do faturamento do mês`);
  } else if (pctDetalhamento !== null && pctDetalhamento < DETALHE_OK_PCT) {
    confianca = rebaixar(confianca, "media");
    motivosConfianca.push(`detalhamento por produto cobre ${fmtPctBr(pctDetalhamento)} do faturamento do mês`);
  }
  if (det.truncado) {
    confianca = rebaixar(confianca, "media");
    motivosConfianca.push("lista de produtos truncada no sync (top 50 por faturamento)");
  }
  if (pctNaoClassificado !== null && pctNaoClassificado > 10) {
    confianca = rebaixar(confianca, "media");
    motivosConfianca.push(`${fmtPctBr(pctNaoClassificado)} da receita vendida não está no diagnóstico`);
  }

  // ── Observações factuais (dado, não conselho) ───────────────────────────
  const observacoes = [];
  if (det.produtos.length === 0) {
    observacoes.push("Sem vendas por produto no período analisado (zero real do snapshot).");
  }
  if (pctSemBase !== null && pctSemBase > 0) {
    observacoes.push(`${fmtPctBr(pctSemBase)} do faturamento analisado está em produtos sem base de custo.`);
  }
  if (contagens.qtdItensSemBase !== null && contagens.qtdItensSemBase > 0) {
    observacoes.push(
      qtdItensSemBaseComVenda > 0
        ? `${qtdItensSemBaseComVenda} de ${contagens.qtdItensSemBase} itens sem base tiveram venda no período.`
        : `Nenhum dos ${contagens.qtdItensSemBase} itens sem base teve venda no período analisado.`
    );
  }
  if (semBaseVendidos.length >= 3 && concentracaoSemBase.top5PctDaReceitaSemBase !== null) {
    observacoes.push(
      `Os ${topN} maiores produtos sem base concentram ${fmtPctBr(concentracaoSemBase.top5PctDaReceitaSemBase)} da receita sem base.`
    );
  }
  if (pctSemBase !== null && pctSemBase >= 10) {
    observacoes.push("A MC média do período pode estar distorcida: parte da receita não possui custo confiável.");
  }

  return {
    disponivel: true,
    periodo: {
      competencia: escolhido.periodo.competencia,
      label: escolhido.periodo.label,
      tipo: escolhido.tipo, // mes_anterior | mes_atual | selecionado
    },
    fonte: {
      faturamento: "snapshot",
      faturamentoDetalheEm: det.geradoEm,
      diagnostico: `relatorio_${relatorio.id}`,
      diagnosticoEm: relatorio.criadoEm || null,
      base: "relatorio_itens.tem_base",
      confianca,
      motivosConfianca,
    },
    resumo: {
      faturamentoTotalMes,
      faturamentoAnalisado,
      faturamentoComBase: fatComBase,
      faturamentoSemBase: fatSemBase,
      faturamentoNaoClassificado: fatNaoClassificado,
      pctComBase,
      pctSemBase,
      pctNaoClassificado,
      pctDetalhamento,
      qtdItensDiagnostico: contagens.qtdItensDiagnostico,
      qtdItensComBase: contagens.qtdItensComBase,
      qtdItensSemBase: contagens.qtdItensSemBase,
      qtdItensSemBaseComVenda,
      qtdItensSemBaseSemVenda,
      qtdProdutosVendidos: det.produtos.length,
      qtdProdutosNaoClassificados: cruzados.filter((c) => !c.item).length,
    },
    concentracaoSemBase,
    produtosSemBaseMaisRelevantes,
    matrizPreparacao: {
      criterioAlto: "classe A da curva ABC — produtos que acumulam os primeiros 80% do faturamento analisado",
      ...matriz,
    },
    observacoes,
  };
}

module.exports = { montarCoberturaBaseFaturamento };
