// Fixture do payload real do endpoint GET /operacao/cliente-360/:slug/resultado.
// Espelha o contrato do backend (números crus, formatação só no React).
// Usada apenas em testes — a tela integrada nunca usa mock.

export function payloadCliente360({ ads = 4100, adsStatus = "carregado", ponteFecha = true } = {}) {
  const temAds = ads !== null && ads !== undefined;

  return {
    ok: true,
    cliente: { slug: "cliente-x", nome: "Cliente X", id: 1 },
    periodo: {
      competencia: "2026-06", inicio: "2026-06-01", fim: "2026-06-30",
      diasNoPeriodo: 30, diasNoMes: 30, parcial: false, label: "junho/2026", marketplace: "meli",
    },
    comparacao: {
      competencia: "2026-05", inicio: "2026-05-01", fim: "2026-05-31",
      diasNoPeriodo: 31, diasNoMes: 31, parcial: false, label: "maio/2026", marketplace: "meli",
    },
    estado: { chave: "ok", mensagem: null, bloqueante: false },
    thresholds: { margemAlvo: 0.15 },

    confianca: {
      nivel: "confiavel", exibirPonte: true, motivoOcultarPonte: null,
      coberturaResultado: 1, coberturaCusto: 1, coberturaFrete: 1,
      receitaBloqueada: 0, pedidosBloqueados: 0, pedidosParciais: 0,
      reconciliacao: {
        status: "reconciliado", faturamentoFechamento: 100000, faturamentoDetalhe: 100000,
        ajusteIdentificado: 0, diferenca: 0, origemAjuste: null,
      },
      divergenciaPonte: null,
      alertas: [],
      geradoEm: "2026-07-01T00:00:00Z",
      porPeriodo: { anterior: {}, atual: {} },
      pedidosDerrubando: [],
    },

    fechamento: {
      atual: {
        faturamento: 100000, pedidos: 500, unidades: 900, ticketMedio: 200,
        cancelamentos: 12, valorCancelado: 2400, comProblema: 3,
        comissao: 10000, frete: 5000, custo: 60000, imposto: 3000, ajustes: 0,
        resultadoOperacional: 22000, margemOperacional: 0.22,
        ads: temAds ? ads : null,
        adsStatus,
        tacos: temAds ? ads / 100000 : null,
        resultadoAposAds: temAds ? 22000 - ads : null,
        margemAposAds: temAds ? (22000 - ads) / 100000 : null,
      },
      anterior: {
        faturamento: 90000, pedidos: 460, unidades: 820, ticketMedio: 195,
        cancelamentos: 10, valorCancelado: 2000, comProblema: 2,
        comissao: 9000, frete: 4500, custo: 54000, imposto: 2700, ajustes: 0,
        resultadoOperacional: 19800, margemOperacional: 0.22,
        ads: temAds ? 3200 : null,
        adsStatus,
        tacos: temAds ? 3200 / 90000 : null,
        resultadoAposAds: temAds ? 16600 : null,
        margemAposAds: temAds ? 16600 / 90000 : null,
      },
      variacoes: {
        faturamento: { abs: 10000, pct: 0.1111 },
        resultadoOperacional: { abs: 2200, pct: 0.1111 },
        resultadoAposAds: { abs: temAds ? 1300 : null, pct: temAds ? 0.0783 : null },
        margemOperacional: { pp: 0 },
        margemAposAds: { pp: temAds ? 0.45 : null },
        unidades: { abs: 80, pct: 0.0976 },
        pedidos: { abs: 40, pct: 0.087 },
        ticketMedio: { abs: 5, pct: 0.0256 },
        cancelamentos: { abs: 2, pct: 0.2 },
        ads: { abs: temAds ? 900 : null, pct: temAds ? 0.2813 : null },
        tacos: { pp: temAds ? 0.5 : null },
      },
      eficiencia: [],
      reconciliacao: {
        atual: { status: "reconciliado", faturamentoFechamento: 100000, faturamentoDetalhe: 100000, ajusteIdentificado: 0, diferenca: 0 },
        anterior: { status: "reconciliado", faturamentoFechamento: 90000, faturamentoDetalhe: 90000, ajusteIdentificado: 0, diferenca: 0 },
      },
      origem: { atual: "orders_api", anterior: "orders_api", geradoEm: "2026-07-01T00:00:00Z" },
      fonte: "fechamento_api_central_vendas",
    },

    ads: {
      disponivel: temAds,
      natureza: "descritivo",
      leitura: temAds
        ? "O investimento em Ads passou de R$ 3.200,00 para R$ 4.100,00 e o TACoS passou de 3,6% para 4,1%."
        : null,
      atual: {
        valor: temAds ? ads : null, status: adsStatus, fonte: temAds ? "mercado_ads" : null,
        competencia: "2026-06", periodo: null, atualizadoEm: temAds ? "2026-07-01T12:00:00Z" : null,
        motivo: temAds ? null : "Nenhum investimento de Ads encontrado para esta competência.",
        tacos: temAds ? 0.041 : null,
        resultadoAposAds: temAds ? 17900 : null,
        margemAposAds: temAds ? 0.179 : null,
      },
      anterior: {
        valor: temAds ? 3200 : null, status: adsStatus, fonte: temAds ? "resumo_mensal" : null,
        tacos: temAds ? 0.0356 : null, resultadoAposAds: temAds ? 16600 : null, margemAposAds: temAds ? 0.1844 : null,
      },
      variacoes: {
        abs: temAds ? 900 : null, pct: temAds ? 0.2813 : null,
        tacosPp: temAds ? 0.54 : null, resultadoAposAds: temAds ? 1300 : null,
      },
    },

    ponte: {
      base: "resultadoOperacional",
      inicio: 19800, fim: 22000, delta: 2200,
      residuo: ponteFecha ? 0 : 47.5,
      fecha: ponteFecha,
      divergencia: ponteFecha ? null : {
        valor: 47.5, fonte: "decomposicao_pvm",
        mensagem: "A soma dos fatores não reconstrói a variação do resultado operacional. Os números são exibidos como estão.",
      },
      linhas: [
        {
          chave: "volume", label: "Volume", impacto: 1800, material: true,
          descricao: "O total de unidades vendidas mudou, mantida a margem unitária do período anterior.",
          formula: "(unidades atuais − unidades anteriores) × margem unitária média anterior",
          produtos: [{ mlb: "MLB1", titulo: "Produto 1", impacto: 1800, unidadesAnterior: 250, unidadesAtual: 300, unitario: null }],
        },
        {
          chave: "preco", label: "Preço médio", impacto: 900, material: true,
          descricao: "O preço médio praticado mudou nos produtos comparáveis.",
          formula: "Σ unidades atuais × (preço atual − preço anterior)",
          produtos: [{ mlb: "MLB1", titulo: "Produto 1", impacto: 900, unidadesAnterior: 250, unidadesAtual: 300, unitario: { anterior: 130, atual: 133 } }],
        },
        {
          chave: "custo", label: "Custo do produto", impacto: -500, material: true,
          descricao: "O custo unitário dos produtos comparáveis mudou.",
          formula: "− Σ unidades atuais × (custo unitário atual − custo unitário anterior)",
          produtos: [{ mlb: "MLB2", titulo: "Produto 2", impacto: -500, unidadesAnterior: 100, unidadesAtual: 100, unitario: { anterior: 150, atual: 155 } }],
        },
        {
          chave: "outros", label: "Outros", impacto: 113, material: false,
          descricao: "Fatores individualmente imateriais, agrupados. A composição exata está abaixo.",
          formula: "Comissão + Imposto",
          composicao: [
            { chave: "comissao", label: "Comissão", impacto: 160 },
            { chave: "imposto", label: "Imposto", impacto: -47 },
          ],
          produtos: [],
        },
      ],
    },

    produtos: {
      ajudaram: [{ mlb: "MLB1", titulo: "Produto 1", contribuicao: 1500, faturamento: 40000, unidadesAtual: 300, motivoDominante: "volume", margem: 0.25 }],
      prejudicaram: [{ mlb: "MLB2", titulo: "Produto 2", contribuicao: -500, faturamento: 20000, unidadesAtual: 100, motivoDominante: "custo", margem: 0.05 }],
      noVermelho: [{ mlb: "MLB3", titulo: "Produto 3", unidades: 50, faturamento: 5000, resultado: -1550, margemUnitaria: -31, margem: -0.31, precoMedio: 100, curvaA: false }],
      abaixoDaMargem: [{ mlb: "MLB2", titulo: "Produto 2", unidades: 100, faturamento: 20000, margem: 0.05, gapMargemPp: 10, recuperavelAteAlvo: 2000, curvaA: true }],
      curvaAEmRisco: [],
      totais: { noVermelho: 1, abaixoDaMargem: 1, analisados: 3 },
    },

    oportunidades: {
      totalRecuperavel: 2050,
      escopo: "operacional",
      observacao: "Total recuperável considera apenas oportunidades operacionais comprováveis (custo, frete, preço, comissão, imposto, mix). Investimento em Ads não entra.",
      oportunidades: [
        {
          tipo: "issue", severidade: "critico", titulo: "1 produto(s) com resultado negativo",
          fator: "produto", recuperavelEstimado: 1550, contaNoTotal: true,
          descricao: "Estes itens vendem abaixo do custo variável.",
          acaoRecomendada: "Subir preço ao ponto de equilíbrio ou pausar o anúncio.",
          destino: "bases.html",
          produtos: [{ mlb: "MLB3", titulo: "Produto 3", resultado: -1550, faturamento: 5000 }],
        },
        {
          tipo: "issue", severidade: "critico", titulo: "Custo do produto corroeu margem",
          fator: "custo", recuperavelEstimado: 500, contaNoTotal: true,
          descricao: "O custo unitário subiu frente ao período anterior.",
          acaoRecomendada: "Revisar/atualizar a base de custo dos produtos listados.",
          destino: "bases.html",
          produtos: [{ mlb: "MLB2", titulo: "Produto 2", impacto: -500 }],
        },
      ],
    },

    narrativa: {
      titulo: "O resultado operacional subiu R$ 2.200,00 (11,1%) em junho contra maio.",
      texto: "O resultado operacional subiu R$ 2.200,00 (11,1%) em junho contra maio. Volume adicionou R$ 1.800,00.",
      escopo: "operacional",
      drivers: { positivos: [{ chave: "volume", label: "Volume", impacto: 1800 }], negativos: [{ chave: "custo", label: "Custo do produto", impacto: -500 }] },
    },

    simulacao: {
      endpoint: "/operacao/cliente-360/cliente-x/resultado/simular",
      competencia: "2026-06",
      produtos: [
        { mlb: "MLB1", titulo: "Produto 1", unidades: 300, precoMedio: 133.33, custoUnitario: 80, freteUnitario: 10, comissaoUnitaria: 13, impostoUnitario: 4, margemUnitaria: 33, receita: 40000, resultado: 10000, margem: 0.25, noVermelho: false },
        { mlb: "MLB3", titulo: "Produto 3", unidades: 50, precoMedio: 100, custoUnitario: 108, freteUnitario: 8, comissaoUnitaria: 10, impostoUnitario: 5, margemUnitaria: -31, receita: 5000, resultado: -1550, margem: -0.31, noVermelho: true },
      ],
      adsMantido: temAds ? ads : null,
      adsStatus,
      resultadoOperacionalAtual: 22000,
      resultadoAposAdsAtual: temAds ? 22000 - ads : null,
      cenariosRapidos: [
        { chave: "parar_vermelho", label: "Parar produtos no vermelho", descricao: "Pausa todos os itens com margem de contribuição negativa." },
        { chave: "subir_precos_5", label: "Subir preços 5%", descricao: "Aplica +5% no preço de todos os itens ativos." },
        { chave: "reduzir_custos_5", label: "Reduzir custos 5%", descricao: "Aplica −5% no custo unitário de todos os itens ativos." },
        { chave: "limpar", label: "Limpar", descricao: "Remove todas as intervenções." },
      ],
    },

    placar: { disponivel: true, endpoint: "/operacao/cliente-360/cliente-x/placar", escopo: "operacional" },
  };
}
