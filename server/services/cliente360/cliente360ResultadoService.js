// server/services/cliente360/cliente360ResultadoService.js
// ORQUESTRADOR do cockpit de resultado da Cliente 360 (tela React).
//
// Responsabilidade: buscar os dois períodos na Fechamento API, buscar Ads da
// competência, rodar os motores PUROS na ordem certa e devolver um payload
// PRONTO PARA A INTERFACE. Não há matemática financeira aqui — cada conta mora
// no seu motor. Não há SQL aqui — os adapters cuidam disso.
//
// Ordem: fechamento → ponte operacional → produtos → confiança → recuperação →
//        narrativa → Ads (bloco descritivo separado).
//
// SEPARAÇÃO ADS × OPERAÇÃO (decisão de produto, não detalhe técnico):
//   resultadoOperacional = faturamento − comissão − frete − custo − imposto
//   resultadoAposAds     = resultadoOperacional − adsTotal
//   Ads NÃO entra na ponte, nos produtos, nas oportunidades nem no simulador.
//   `resultadoAposAds` NÃO é lucro líquido: salários, ferramentas, despesas fixas
//   e outras despesas ainda podem não estar incluídos.
//
// Não existe `resultadoFinal` neste contrato. O nome era ambíguo (às vezes antes,
// às vezes depois de Ads) e foi substituído por `resultadoOperacional` e
// `resultadoAposAds`, que dizem exatamente o que são. Como o endpoint é novo,
// não há consumidor legado para preservar — nenhum alias foi criado.

const ponteEngine = require("./cliente360PonteEngine");
const produtosEngine = require("./cliente360ProdutosEngine");
const confiancaEngine = require("./cliente360ConfiancaEngine");
const recuperacaoEngine = require("./cliente360RecuperacaoEngine");
const narrativaEngine = require("./cliente360NarrativaEngine");
const adsEngine = require("./cliente360AdsService");
const periodoUtils = require("./cliente360Periodo");

// Thresholds espelhados do diagnóstico engine (fonte única já existente).
let MC_OK = 15;
try {
  const diag = require("./cliente360DiagnosticoEngine");
  if (diag.MC_OK != null) MC_OK = diag.MC_OK;
} catch (_) { /* usa default */ }

const round2 = ponteEngine.round2;
const num = ponteEngine.num;

// ─── eficiência (percentuais sobre faturamento) ─────────────────────────────
// Só componentes operacionais. TACoS fica no bloco de Ads, não aqui.
function montarEficiencia(a, b) {
  const razao = (val, base) => (base > 0 ? val / base : null);
  const linha = (chave, label, va, ba, vb, bb) => {
    const ant = razao(va, ba);
    const atu = razao(vb, bb);
    return {
      chave,
      label,
      anterior: ant,
      atual: atu,
      deltaPp: ant != null && atu != null ? round2((atu - ant) * 100) : null,
    };
  };
  return [
    linha("custo_faturamento", "Custo / faturamento", a.custo, a.faturamento, b.custo, b.faturamento),
    linha("comissao_faturamento", "Comissão / faturamento", a.comissao, a.faturamento, b.comissao, b.faturamento),
    linha("frete_faturamento", "Frete / faturamento", a.frete, a.faturamento, b.frete, b.faturamento),
    linha("imposto_faturamento", "Imposto / faturamento", a.imposto, a.faturamento, b.imposto, b.faturamento),
    linha("margem_operacional", "Margem operacional", a.resultadoOperacional, a.faturamento, b.resultadoOperacional, b.faturamento),
  ];
}

// ─── variação por indicador ──────────────────────────────────────────────────
function delta(x, y) {
  if (x === null || x === undefined || y === null || y === undefined) return null;
  return round2(num(y) - num(x));
}
function deltaPct(x, y) {
  if (x === null || x === undefined || y === null || y === undefined) return null;
  return num(x) !== 0 ? (num(y) - num(x)) / Math.abs(num(x)) : null;
}
function deltaPp(x, y) {
  if (x === null || x === undefined || y === null || y === undefined) return null;
  return round2((num(y) - num(x)) * 100);
}

// Garante que o payload é JSON puro e seguro para o React:
// sem Map, Set, função, NaN ou Infinity. Números seguem como NÚMEROS — a
// formatação pt-BR é responsabilidade da interface, não do backend.
function sanitizarParaJson(valor) {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  if (typeof valor === "function" || typeof valor === "symbol") return undefined;
  if (valor instanceof Date) return valor.toISOString();
  if (valor instanceof Map) return Object.fromEntries([...valor.entries()].map(([k, v]) => [k, sanitizarParaJson(v)]));
  if (valor instanceof Set) return [...valor].map(sanitizarParaJson);
  if (Array.isArray(valor)) return valor.map(sanitizarParaJson);
  if (typeof valor === "object") {
    const out = {};
    for (const [chave, item] of Object.entries(valor)) {
      if (chave.startsWith("_")) continue; // estruturas internas (ex.: _perfis)
      const limpo = sanitizarParaJson(item);
      if (limpo !== undefined) out[chave] = limpo;
    }
    return out;
  }
  return valor;
}

function montarVariacao(a, b) {
  return {
    faturamento: { abs: delta(a.faturamento, b.faturamento), pct: deltaPct(a.faturamento, b.faturamento) },
    resultadoOperacional: {
      abs: delta(a.resultadoOperacional, b.resultadoOperacional),
      pct: deltaPct(a.resultadoOperacional, b.resultadoOperacional),
    },
    resultadoAposAds: {
      abs: delta(a.resultadoAposAds, b.resultadoAposAds),
      pct: deltaPct(a.resultadoAposAds, b.resultadoAposAds),
    },
    margemOperacional: { pp: deltaPp(a.margemOperacional, b.margemOperacional) },
    margemAposAds: { pp: deltaPp(a.margemAposAds, b.margemAposAds) },
    unidades: { abs: delta(a.unidades, b.unidades), pct: deltaPct(a.unidades, b.unidades) },
    pedidos: { abs: delta(a.pedidos, b.pedidos), pct: deltaPct(a.pedidos, b.pedidos) },
    ticketMedio: { abs: delta(a.ticketMedio, b.ticketMedio), pct: deltaPct(a.ticketMedio, b.ticketMedio) },
    cancelamentos: { abs: delta(a.cancelamentos, b.cancelamentos), pct: deltaPct(a.cancelamentos, b.cancelamentos) },
    ads: { abs: delta(a.ads, b.ads), pct: deltaPct(a.ads, b.ads) },
    tacos: { pp: deltaPp(a.tacos, b.tacos) },
  };
}

// ─── resumo de um período (cards do topo) ───────────────────────────────────
function montarResumo(totaisPonte, totaisFechamento, ads) {
  const faturamento = totaisPonte.faturamento;
  const resultadoOperacional = totaisPonte.resultadoOperacional;
  const adsValor = ads?.valor ?? null;
  const resultadoAposAds = adsEngine.calcularResultadoAposAds(resultadoOperacional, adsValor);

  return {
    faturamento,
    faturamentoFechamento: totaisFechamento.faturamentoFechamento,
    pedidos: totaisFechamento.pedidos,
    unidades: totaisPonte.unidades,
    ticketMedio: totaisFechamento.ticketMedio,
    cancelamentos: totaisFechamento.cancelamentos,
    valorCancelado: totaisFechamento.valorCancelado,
    comProblema: totaisFechamento.comProblema,

    comissao: totaisPonte.comissao,
    frete: totaisPonte.frete,
    custo: totaisPonte.custo,
    imposto: totaisPonte.imposto,
    ajustes: totaisPonte.ajustes,

    resultadoOperacional,
    margemOperacional: totaisPonte.margemOperacional,

    // Ads: null quando indisponível — nunca 0.
    ads: adsValor,
    adsStatus: ads?.status || adsEngine.STATUS.SEM_DADOS,
    tacos: adsEngine.calcularTacos(adsValor, faturamento),
    resultadoAposAds,
    margemAposAds: adsEngine.calcularMargemAposAds(resultadoAposAds, faturamento),
  };
}

// ─── perfil enxuto p/ o simulador ───────────────────────────────────────────
function perfilParaSimulador(map) {
  const out = [];
  for (const p of map.values()) {
    if (p.q <= 0) continue;
    out.push({
      mlb: p.mlb,
      titulo: p.titulo,
      unidades: p.q,
      precoMedio: round2(p.pu),
      custoUnitario: round2(p.custo / p.q),
      freteUnitario: round2(p.frete / p.q),
      comissaoUnitaria: round2(p.tarifa / p.q),
      impostoUnitario: round2(p.imposto / p.q),
      margemUnitaria: round2(p.mcu),
      receita: round2(p.rec),
      resultado: round2(p.mcTotal),
      margem: p.rec > 0 ? p.mcTotal / p.rec : null,
      noVermelho: p.mcTotal < 0,
    });
  }
  return out.sort((a, b) => b.receita - a.receita);
}

// Cenários rápidos do simulador — todos OPERACIONAIS. Não existe cenário de Ads.
const CENARIOS_RAPIDOS = [
  { chave: "parar_vermelho", label: "Parar produtos no vermelho", descricao: "Pausa todos os itens com margem de contribuição negativa." },
  { chave: "subir_precos_5", label: "Subir preços 5%", descricao: "Aplica +5% no preço de todos os itens ativos." },
  { chave: "reduzir_custos_5", label: "Reduzir custos 5%", descricao: "Aplica −5% no custo unitário de todos os itens ativos." },
  { chave: "limpar", label: "Limpar", descricao: "Remove todas as intervenções." },
];

// ─── estado do período (o que a interface precisa para escolher a tela) ─────
function estadoDoPeriodo(atual, anterior) {
  if (!atual.temFechamento) {
    return {
      chave: "sem_fechamento",
      mensagem: "Não há fechamento sincronizado para esta competência.",
      bloqueante: true,
    };
  }
  if (!anterior.temFechamento) {
    return {
      chave: "sem_comparacao",
      mensagem: "Não há fechamento na competência comparada — a variação e a ponte ficam indisponíveis.",
      bloqueante: false,
    };
  }
  if (atual.reconciliacao.status === "divergente") {
    return {
      chave: "fechamento_parcial",
      mensagem: "O detalhe por item não reconcilia integralmente com o total do fechamento.",
      bloqueante: false,
    };
  }
  return { chave: "ok", mensagem: null, bloqueante: false };
}

// ─── factory com injeção de dependências (testável sem banco) ───────────────
function createResultadoService({
  centralRepo = require("../centralVendas/centralVendasRepository"),
  fechamentoAdapter = null,
  adsService = null,
  agora = null,
} = {}) {
  const fechamento = fechamentoAdapter
    || require("./cliente360FechamentoAdapter").createFechamentoAdapter({ centralRepo });
  const ads = adsService || adsEngine.createAdsService();

  async function getResultado(clienteSlug, options = {}) {
    const slug = String(clienteSlug || "").trim().toLowerCase();
    if (!slug) { const e = new Error("slug é obrigatório."); e.statusCode = 400; throw e; }

    const cliente = await centralRepo.getClienteBySlug(slug);
    if (!cliente) { const e = new Error("Cliente não encontrado."); e.statusCode = 404; throw e; }

    const marketplace = String(options.marketplace || "meli").toLowerCase();
    const hoje = agora || new Date();

    // Competência padrão = último mês fechado (evita abrir a tela num mês vazio).
    const compAtual = periodoUtils.ehCompetenciaValida(options.competencia)
      ? options.competencia
      : periodoUtils.competenciaAnteriorDe(periodoUtils.competenciaAtual(hoje));
    const compComparado = periodoUtils.ehCompetenciaValida(options.compararCom)
      ? options.compararCom
      : periodoUtils.competenciaAnteriorDe(compAtual);

    const { atual: rangeAtual, comparado: rangeComparado } =
      periodoUtils.resolverPeriodos(compAtual, compComparado, hoje);

    const alvoMargemRaw = Number(options.margemAlvo);
    const alvoMargem = Number.isFinite(alvoMargemRaw) && alvoMargemRaw > 0
      ? (alvoMargemRaw > 1 ? alvoMargemRaw / 100 : alvoMargemRaw)
      : MC_OK / 100;

    // ── dados ───────────────────────────────────────────────────────────────
    // Ads roda em paralelo, mas sua falha NUNCA derruba a análise operacional.
    const [dadosAtual, dadosAnterior, adsAtual, adsAnterior] = await Promise.all([
      fechamento.lerPeriodo(cliente, rangeAtual, marketplace),
      fechamento.lerPeriodo(cliente, rangeComparado, marketplace),
      ads.getInvestimento(slug, compAtual, { range: rangeAtual })
        .catch((err) => ({ valor: null, status: adsEngine.STATUS.ERRO, fonte: null, competencia: compAtual, periodo: null, atualizadoEm: null, motivo: err?.message || "Falha ao obter Ads." })),
      ads.getInvestimento(slug, compComparado, { range: rangeComparado })
        .catch((err) => ({ valor: null, status: adsEngine.STATUS.ERRO, fonte: null, competencia: compComparado, periodo: null, atualizadoEm: null, motivo: err?.message || "Falha ao obter Ads." })),
    ]);

    // ── motores operacionais (sem Ads) ──────────────────────────────────────
    const ponte = ponteEngine.montarPonte(dadosAnterior.pedidos, dadosAtual.pedidos, {
      ajustes0: dadosAnterior.reconciliacao.ajusteIdentificado,
      ajustes1: dadosAtual.reconciliacao.ajusteIdentificado,
      materialidade: 0.02,
    });

    const confianca = confiancaEngine.avaliarConfianca(dadosAnterior.pedidos, dadosAtual.pedidos, {
      geradoEm: dadosAtual.geradoEm,
      reconciliacao: dadosAtual.reconciliacao,
      ponte, // resíduo acima de R$ 0,01 rebaixa a confiança e declara a divergência
    });

    const produtos = produtosEngine.montarProdutos(ponte.produtos, ponte._perfis.map1, {
      alvoMargem, topN: 5,
    });

    const recuperacao = recuperacaoEngine.avaliarRecuperacao(ponte, {
      alvoMargem,
      mcOk: MC_OK,
      receitaBloqueada: confianca.receitaBloqueada,
    });

    const narrativa = narrativaEngine.gerarNarrativa({
      ponte, produtos, confianca,
      periodo: { competencia: compAtual },
      comparado: { competencia: compComparado },
    });

    // ── fechamento + Ads (bloco descritivo separado) ────────────────────────
    const totA = ponte.totais.anterior;
    const totB = ponte.totais.atual;

    const resumoAnterior = montarResumo(totA, dadosAnterior.totais, adsAnterior);
    const resumoAtual = montarResumo(totB, dadosAtual.totais, adsAtual);

    const blocoAds = adsEngine.montarBlocoAds({
      adsAtual, adsAnterior,
      resumoAtual: { faturamento: totB.faturamento, resultadoOperacional: totB.resultadoOperacional },
      resumoAnterior: { faturamento: totA.faturamento, resultadoOperacional: totA.resultadoOperacional },
    });
    blocoAds.leitura = narrativaEngine.gerarLeituraAds(blocoAds);

    const exibirPonte = confianca.exibirPonte && dadosAnterior.temFechamento && dadosAtual.temFechamento;

    return sanitizarParaJson({
      ok: true,
      cliente: { slug: cliente.slug, nome: cliente.nome || cliente.slug, id: cliente.id ?? null },
      periodo: { ...rangeAtual, marketplace },
      comparacao: { ...rangeComparado, marketplace },
      estado: estadoDoPeriodo(dadosAtual, dadosAnterior),
      thresholds: { margemAlvo: alvoMargem },

      confianca,

      // Fechamento do mês: números OPERACIONAIS dos dois períodos + variações.
      // Ads não mora aqui — tem bloco próprio logo abaixo.
      fechamento: {
        atual: resumoAtual,
        anterior: resumoAnterior,
        variacoes: montarVariacao(resumoAnterior, resumoAtual),
        eficiencia: montarEficiencia(totA, totB),
        reconciliacao: {
          atual: dadosAtual.reconciliacao,
          anterior: dadosAnterior.reconciliacao,
        },
        origem: {
          atual: dadosAtual.origem,
          anterior: dadosAnterior.origem,
          geradoEm: dadosAtual.geradoEm,
        },
        fonte: "fechamento_api_central_vendas",
      },

      // Bloco próprio, descritivo. Nunca alimenta ponte/produtos/oportunidades.
      ads: {
        disponivel: blocoAds.disponivel,
        natureza: blocoAds.natureza,
        leitura: blocoAds.leitura,
        atual: blocoAds.atual,
        anterior: blocoAds.anterior,
        variacoes: blocoAds.variacao,
      },

      ponte: exibirPonte
        ? {
            base: ponte.base,
            inicio: ponte.inicio,
            fim: ponte.fim,
            delta: ponte.delta,
            residuo: ponte.residuo,
            fecha: ponte.fecha,
            divergencia: ponte.divergencia,
            linhas: ponte.linhas,
          }
        : null,

      produtos: exibirPonte
        ? produtos
        : { ajudaram: [], prejudicaram: [], noVermelho: [], abaixoDaMargem: [], curvaAEmRisco: [], totais: { noVermelho: 0, abaixoDaMargem: 0, analisados: 0 } },

      oportunidades: exibirPonte
        ? recuperacao
        : { totalRecuperavel: 0, oportunidades: [], escopo: "operacional", observacao: recuperacao.observacao },

      narrativa,

      // Configuração necessária para o simulador (que roda no servidor).
      simulacao: {
        endpoint: `/operacao/cliente-360/${cliente.slug}/resultado/simular`,
        competencia: compAtual,
        produtos: perfilParaSimulador(ponte._perfis.map1),
        adsMantido: adsAtual?.valor ?? null,
        adsStatus: adsAtual?.status || adsEngine.STATUS.SEM_DADOS,
        resultadoOperacionalAtual: totB.resultadoOperacional,
        resultadoAposAdsAtual: resumoAtual.resultadoAposAds,
        cenariosRapidos: CENARIOS_RAPIDOS,
      },

      // Placar é caro (percorre várias competências) — carregado sob demanda pelo
      // endpoint próprio. Aqui vai só a disponibilidade.
      placar: {
        disponivel: true,
        endpoint: `/operacao/cliente-360/${cliente.slug}/placar`,
        escopo: "operacional",
      },
    });
  }

  return { getResultado };
}

module.exports = {
  getResultado: (...a) => createResultadoService().getResultado(...a),
  createResultadoService,
  // exportados para teste
  montarEficiencia,
  montarVariacao,
  montarResumo,
  perfilParaSimulador,
  estadoDoPeriodo,
  sanitizarParaJson,
  CENARIOS_RAPIDOS,
};
