(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VF_DIAGNOSTIC_SCHEMA = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const tri = (path, label, extra) => ({ path, label, type: "tristate", ...(extra || {}) });
  const num = (path, label, extra) => ({ path, label, type: "number", ...(extra || {}) });
  const pct = (path, label, extra) => ({ path, label, type: "percent", ...(extra || {}) });
  const money = (path, label, extra) => ({ path, label, type: "currency", ...(extra || {}) });
  const text = (path, label, extra) => ({ path, label, type: "text", completion: false, ...(extra || {}) });
  const bool = (path, label, extra) => ({ path, label, type: "boolean", ...(extra || {}) });
  const date = (path, label, extra) => ({ path, label, type: "date", completion: false, ...(extra || {}) });
  const select = (path, label, options, extra) => ({ path, label, type: "select", options, ...(extra || {}) });
  const table = (path, label, columns, extra) => ({ path, label, type: "table", columns, ...(extra || {}) });
  const col = (key, label, type) => ({ key, label, type: type || "text" });
  const onlyWhenSim = (path) => ({ path, equals: "sim" });

  const METRICAS_ML = [
    col("mes", "Mês"), col("faturamento", "Faturamento", "currency"),
    col("unidades", "Unidades", "number"), col("precoMedio", "Preço médio", "currency"),
    col("visitas", "Visitas", "number"), col("vendas", "Vendas", "number"),
    col("conversao", "Conversão", "percent"),
    col("cancelamentosDevolucoes", "Cancelamentos / devoluções", "currency"),
  ];
  const METRICAS_SHOPEE = [
    col("mes", "Mês"), col("faturamento", "Faturamento", "currency"),
    col("pedidos", "Pedidos", "number"), col("conversao", "Conversão", "percent"),
    col("visitantes", "Visitantes", "number"), col("vendasPorPedido", "Vendas por pedido", "number"),
    col("afiliadoShopee", "Vendas de afiliados", "currency"), col("shopeeAds", "Vendas via Shopee Ads", "currency"),
  ];
  const PRODUCT_ADS = [
    col("mes", "Mês"), col("investimento", "Investimento", "currency"),
    col("vendasAds", "Vendas Ads", "number"), col("vendasOrganicas", "Vendas orgânicas", "number"),
    col("roas", "ROAS", "percent"), col("acos", "ACOS", "percent"),
    col("tacos", "TACOS", "percent"), col("cliques", "Cliques", "number"),
  ];
  const PRODUTOS_SHOPEE = [
    col("id", "ID"), col("nome", "Nome"), col("vendas", "Vendas", "number"),
    col("impressoes", "Impressões", "number"), col("cliques", "Cliques", "number"),
    col("ctr", "CTR", "percent"), col("unidades", "Unidades", "number"),
    col("visitantes", "Visitantes", "number"), col("conversao", "Conversão", "percent"),
  ];
  const ADS_SHOPEE = [
    col("mes", "Mês"), col("impressoes", "Impressões", "number"), col("cliques", "Cliques", "number"),
    col("ctr", "CTR", "percent"), col("pedidos", "Pedidos", "number"),
    col("itensVendidos", "Itens vendidos", "number"), col("vendas", "Vendas", "currency"),
    col("investimento", "Investimento", "currency"), col("roas", "ROAS", "percent"),
    col("tacos", "TACOS", "percent"),
  ];
  const AFILIADOS_SHOPEE = [
    col("mes", "Mês"), col("vendas", "Vendas", "currency"), col("pedidos", "Pedidos", "number"),
    col("clicks", "Cliques", "number"), col("comissaoEstimada", "Comissão estimada", "currency"),
    col("roi", "ROI", "percent"), col("compradoresTotais", "Compradores totais", "number"),
    col("novosCompradores", "Novos compradores", "number"),
  ];
  const METRICAS_TIKTOK = [
    col("mes", "Mês"), col("gmv", "GMV (R$)", "currency"),
    col("itensVendidos", "Itens vendidos", "number"), col("pedidosSku", "Pedidos de SKU", "number"),
    col("pedidos", "Pedidos", "number"),
  ];
  const PRODUTOS_TIKTOK = [
    col("id", "ID"), col("titulo", "Título"), col("gmv", "GMV", "currency"),
    col("gmvVideo", "GMV Vídeo", "currency"), col("gmvLive", "GMV Live", "currency"),
    col("gmvAfiliado", "GMV Afiliado", "currency"), col("gmvCartao", "GMV Cartão", "currency"),
    col("pedidos", "Pedidos", "number"), col("unidadesVendidas", "Unidades vendidas", "number"),
  ];

  const COMMON_IDENTIFICACAO = {
    id: "identificacao", title: "Identificação",
    fields: [text("identificacao.nomeLoja", "Nome da loja/conta")],
  };
  const COMMON_ABC = {
    id: "abc", title: "Curva ABC",
    fields: [
      select("curvaAbc.status", "Status", { nao_realizada: "Não realizada", em_andamento: "Em andamento", concluida: "Concluída" }),
      select("curvaAbc.origem", "Origem", { relatorio_existente: "Relatório existente", planilha_externa: "Planilha externa", analise_manual: "Análise manual" }, { completion: false }),
      text("curvaAbc.referencia", "Referência / ID do relatório"), date("curvaAbc.dataAnalise", "Data da análise"),
      text("curvaAbc.observacoes", "Observações"), text("curvaAbc.produtosCurvaA", "Principais produtos da Curva A"),
      text("curvaAbc.produtosAtencao", "Produtos que exigem atenção"),
    ],
  };
  const COMMON_DIAGNOSTICO = {
    id: "diagnostico", title: "Diagnóstico e plano de ação",
    fields: [
      text("diagnosticoManual.estrategias", "Estratégias para a conta", { completion: true }),
      text("diagnosticoManual.pontosPositivos", "Pontos positivos da conta", { completion: true }),
      text("diagnosticoManual.pontosNegativos", "Pontos negativos da conta", { completion: true }),
      text("diagnosticoManual.prioridadesUrgencias", "Prioridades e urgências", { completion: true }),
      text("diagnosticoManual.planoAcao", "Plano de ação", { completion: true }),
    ],
  };

  const ML = [
    COMMON_IDENTIFICACAO,
    { id: "metricas", title: "Métricas de negócio", fields: [table("metricasNegocio.meses", "Métricas de negócio (últimos meses)", METRICAS_ML)] },
    { id: "reputacao", title: "Reputação e performance", fields: [
      select("reputacao.reputacaoAtual", "Reputação atual", { verde: "Verde", amarelo: "Amarelo", laranja: "Laranja", vermelho: "Vermelho" }),
      select("reputacao.medalha", "Medalha", { sem_medalha: "Sem medalha", lider: "Líder", gold: "Gold", platinum: "Platinum" }),
      pct("reputacao.reclamacoesPercentual", "Percentual de reclamações"), pct("reputacao.mediacoesPercentual", "Percentual de mediações"),
      pct("reputacao.canceladosPorVocePercentual", "Cancelados por você"), pct("reputacao.atrasoDespachoPercentual", "Atraso no despacho"),
      text("reputacao.analiseCrescimento", "Análise de crescimento"), text("reputacao.requisitosProximoNivel", "Requisitos para o próximo nível"),
      bool("reputacao.logisticaDisponivel.agenciasMl", "Agências Mercado Livre", { completion: false }),
      bool("reputacao.logisticaDisponivel.enviosFlex", "Envios Flex", { completion: false }),
      bool("reputacao.programas.decola", "Programa Decola", { completion: false }), bool("reputacao.programas.reputacao", "Programa Reputação", { completion: false }),
    ] },
    { id: "auditoria", title: "Auditoria de anúncios", fields: [
      num("auditoriaAnuncios.anunciosAtivos", "Anúncios ativos"), num("auditoriaAnuncios.anunciosInativos", "Anúncios inativos"),
      num("auditoriaAnuncios.anunciosCatalogo", "Anúncios em catálogo"),
      bool("auditoriaAnuncios.logistica.full", "Logística Full", { completion: false }), bool("auditoriaAnuncios.logistica.flex", "Logística Flex", { completion: false }), bool("auditoriaAnuncios.logistica.coleta", "Logística Coleta", { completion: false }),
      tri("auditoriaAnuncios.checklist.titulosOtimizados", "Títulos otimizados", { positive: "Títulos dos anúncios estão otimizados.", negative: "Títulos dos anúncios precisam de otimização.", priority: true }),
      tri("auditoriaAnuncios.checklist.descricoesOtimizadas", "Descrições otimizadas", { positive: "Descrições dos anúncios estão otimizadas.", negative: "Descrições dos anúncios precisam de otimização.", priority: true }),
      tri("auditoriaAnuncios.checklist.caracteristicasPreenchidas", "Características preenchidas", { positive: "Ficha técnica dos anúncios está preenchida.", negative: "Características dos anúncios não estão preenchidas." }),
      tri("auditoriaAnuncios.checklist.centralPromocaoAtiva", "Central de Promoção ativa", { positive: "Central de Promoção ativa nos anúncios auditados.", negative: "Central de Promoção não está ativa nos anúncios auditados." }),
      tri("auditoriaAnuncios.checklist.opcaoVendaVariacoes", "Opção de venda (variações)", { positive: "Anúncios utilizam variações corretamente.", negative: "Anúncios não utilizam variações." }),
      tri("auditoriaAnuncios.checklist.precoAtacado", "Preço de atacado", { positive: "Preço de atacado configurado.", negative: "Preço de atacado não configurado." }),
      tri("auditoriaAnuncios.checklist.dadosFiscaisPreenchidos", "Dados fiscais preenchidos", { positive: "Dados fiscais preenchidos nos anúncios.", negative: "Dados fiscais não preenchidos nos anúncios.", priority: true }),
      tri("auditoriaAnuncios.checklist.imagensOtimizadas", "Imagens otimizadas", { positive: "Imagens dos anúncios estão otimizadas.", negative: "Imagens dos anúncios precisam de otimização.", priority: true }),
      tri("auditoriaAnuncios.checklist.utilizaClips", "Utiliza clips (vídeos)", { positive: "Anúncios utilizam clips (vídeos).", negative: "Anúncios não utilizam clips (vídeos)." }),
    ] },
    { id: "full", title: "Operação Mercado Envios Full", fields: [
      tri("full.utilizaFull", "Utiliza Mercado Envios Full", { positive: "Cliente utiliza Mercado Envios Full.", negative: "Cliente não utiliza Mercado Envios Full." }),
      num("full.statusEstoque.impulsionar", "Estoque a impulsionar", { completion: false, condition: onlyWhenSim("full.utilizaFull") }),
      num("full.statusEstoque.boaQualidade", "Estoque em boa qualidade", { completion: false, condition: onlyWhenSim("full.utilizaFull") }),
      num("full.statusEstoque.entradaPendente", "Entradas pendentes", { completion: false, condition: onlyWhenSim("full.utilizaFull") }),
      text("full.espacoUtilizado", "Espaço utilizado", { condition: onlyWhenSim("full.utilizaFull") }),
      num("full.produtosRiscoCobranca", "Produtos com risco de cobrança/descarte", { condition: onlyWhenSim("full.utilizaFull"), risk: true }),
      money("full.simulacaoCustoRetirada", "Simulação de custo para retirada", { completion: false, condition: onlyWhenSim("full.utilizaFull") }),
      pct("full.saudeFull.pontuacaoQualidade", "Pontuação de qualidade do Full", { condition: onlyWhenSim("full.utilizaFull") }),
      text("full.alertaEstoqueAntigo", "Alerta de estoque antigo", { condition: onlyWhenSim("full.utilizaFull") }),
      text("full.saudeFull.fatoresImpacto", "Fatores de impacto na saúde do Full", { condition: onlyWhenSim("full.utilizaFull") }),
    ] },
    { id: "posvenda", title: "Pós-venda", fields: [
      tri("posVenda.reclamacoesNaoVisualizadas", "Reclamações em andamento não visualizadas", { positive: "Não há reclamações em andamento sem visualização.", negative: "Há reclamações em andamento não visualizadas.", risk: true, priority: true }),
    ] },
    { id: "marketing", title: "Central de marketing", fields: [
      tri("centralMarketing.afiliados", "Programa de afiliados", { positive: "Programa de afiliados ativo.", negative: "Programa de afiliados não está ativo." }),
      tri("centralMarketing.ofertasRelampago", "Ofertas relâmpago", { positive: "Participa de ofertas relâmpago.", negative: "Não participa de ofertas relâmpago." }),
      tri("centralMarketing.centralPromocao", "Central de Promoção", { positive: "Central de Promoção ativa.", negative: "Central de Promoção não está ativa." }),
      tri("centralMarketing.descontoQtd", "Desconto por quantidade", { positive: "Utiliza desconto por quantidade.", negative: "Não utiliza desconto por quantidade." }),
      tri("centralMarketing.minhaPaginaDisplayAds", "Minha Página / Display Ads", { positive: "Utiliza Minha Página / Display Ads.", negative: "Não utiliza Minha Página / Display Ads." }),
      tri("centralMarketing.canalTransmissao", "Canal de transmissão", { positive: "Utiliza canal de transmissão.", negative: "Não utiliza canal de transmissão." }),
    ] },
    { id: "ads", title: "Publicidade (Product Ads)", fields: [
      table("productAds.meses", "Métricas de Product Ads", PRODUCT_ADS), text("productAds.numCampanhas", "Número de campanhas", { completion: false }),
      text("productAds.anunciosPorCampanha", "Anúncios por campanha", { completion: false }),
      num("productAds.campanhasSemVendas", "Campanhas sem vendas", { risk: true }), num("productAds.campanhasComGastoElevado", "Campanhas com gasto elevado", { risk: true }),
    ] },
    { id: "marcas", title: "Marcas e catálogo", fields: [
      tri("marcasCatalogo.registroMarcaAtivo", "Registro de marca ativo", { positive: "Registro de marca ativo.", negative: "Registro de marca não está ativo." }),
      tri("marcasCatalogo.elegibilidadeCatalogo", "Elegibilidade para catálogo", { positive: "Elegível para catálogo.", negative: "Não elegível para catálogo." }),
    ] },
    COMMON_ABC,
    COMMON_DIAGNOSTICO,
  ];

  const SHOPEE = [
    COMMON_IDENTIFICACAO,
    { id: "metricas", title: "Métricas de negócio", fields: [table("metricasNegocio.meses", "Métricas de negócio (últimos meses)", METRICAS_SHOPEE)] },
    { id: "produtos", title: "Produtos", fields: [table("produtos.itens", "Principais produtos", PRODUTOS_SHOPEE)] },
    { id: "auditoria", title: "Auditoria de anúncios", fields: [
      num("auditoriaAnuncios.anunciosAtivos", "Anúncios ativos"), num("auditoriaAnuncios.anunciosInativos", "Anúncios inativos"),
      num("auditoriaAnuncios.anunciosPadronizados", "Anúncios padronizados", { completion: false }),
      bool("auditoriaAnuncios.logistica.full", "Logística Full", { completion: false }), bool("auditoriaAnuncios.logistica.flex", "Logística Flex", { completion: false }), bool("auditoriaAnuncios.logistica.coleta", "Logística Coleta", { completion: false }),
      tri("auditoriaAnuncios.checklist.titulosOtimizados", "Títulos otimizados", { positive: "Títulos dos anúncios estão otimizados.", negative: "Títulos dos anúncios precisam de otimização.", priority: true }),
      tri("auditoriaAnuncios.checklist.descricoesOtimizadas", "Descrições otimizadas", { positive: "Descrições dos anúncios estão otimizadas.", negative: "Descrições dos anúncios precisam de otimização.", priority: true }),
      tri("auditoriaAnuncios.checklist.caracteristicasPreenchidas", "Características preenchidas", { positive: "Características preenchidas nos anúncios.", negative: "Características não preenchidas nos anúncios." }),
      tri("auditoriaAnuncios.checklist.centralPromocaoAtiva", "Central de Promoção ativa", { positive: "Central de Promoção ativa nos anúncios auditados.", negative: "Central de Promoção não está ativa nos anúncios auditados." }),
      tri("auditoriaAnuncios.checklist.opcaoVendaVariacoes", "Opção de venda (variações)", { positive: "Anúncios utilizam variações corretamente.", negative: "Anúncios não utilizam variações." }),
      tri("auditoriaAnuncios.checklist.dadosFiscaisPreenchidos", "Dados fiscais preenchidos", { positive: "Dados fiscais preenchidos nos anúncios.", negative: "Dados fiscais não preenchidos nos anúncios.", priority: true }),
      tri("auditoriaAnuncios.checklist.imagensOtimizadas", "Imagens otimizadas", { positive: "Imagens dos anúncios estão otimizadas.", negative: "Imagens dos anúncios precisam de otimização.", priority: true }),
      tri("auditoriaAnuncios.checklist.utilizaClips", "Utiliza clips (vídeos)", { positive: "Anúncios utilizam clips (vídeos).", negative: "Anúncios não utilizam clips (vídeos)." }),
      tri("auditoriaAnuncios.checklist.possuiRegistroMarca", "Possui registro de marca", { positive: "Possui registro de marca.", negative: "Não possui registro de marca." }),
      tri("auditoriaAnuncios.checklist.registroMarcaAceito", "Registro de marca aceito", { condition: onlyWhenSim("auditoriaAnuncios.checklist.possuiRegistroMarca"), positive: "Registro de marca foi aceito.", negative: "Registro de marca ainda não foi aceito.", priority: true }),
    ] },
    { id: "fulfillment", title: "Operação Fulfillment", fields: [
      tri("fulfillment.utilizaFull", "Utiliza Fulfillment", { positive: "Cliente utiliza Fulfillment.", negative: "Cliente não utiliza Fulfillment." }),
      num("fulfillment.produtosNoFull", "Produtos no Fulfillment", { condition: onlyWhenSim("fulfillment.utilizaFull") }),
      num("fulfillment.variacoesNoFull", "Variações no Fulfillment", { completion: false, condition: onlyWhenSim("fulfillment.utilizaFull") }),
      pct("fulfillment.statusEstoque.taxaItemAtivo", "Taxa de estoque de item ativo", { completion: false, condition: onlyWhenSim("fulfillment.utilizaFull") }),
      num("fulfillment.statusEstoque.unidadesExcedentes", "Unidades excedentes", { completion: false, condition: onlyWhenSim("fulfillment.utilizaFull") }),
      num("fulfillment.statusEstoque.variacoesSemMovimento", "Variações sem movimento", { completion: false, condition: onlyWhenSim("fulfillment.utilizaFull") }),
      text("fulfillment.statusEstoque.observacao", "Observações sobre o estoque", { condition: onlyWhenSim("fulfillment.utilizaFull") }),
    ] },
    { id: "marketing", title: "Central de marketing", fields: [
      tri("centralMarketing.centralDesconto", "Central de Desconto", { positive: "Central de Desconto ativa.", negative: "Central de Desconto não está ativa." }),
      tri("centralMarketing.ofertasRelampago", "Ofertas relâmpago", { positive: "Participa de ofertas relâmpago.", negative: "Não participa de ofertas relâmpago." }),
      tri("centralMarketing.cuponsVendedores", "Cupons de vendedores", { positive: "Utiliza cupons de vendedores.", negative: "Não utiliza cupons de vendedores." }),
      tri("centralMarketing.campanha", "Campanha", { positive: "Participa de campanhas.", negative: "Não participa de campanhas." }),
      tri("centralMarketing.liveVideo", "Live & Vídeo", { positive: "Utiliza Live & Vídeo.", negative: "Não utiliza Live & Vídeo." }),
    ] },
    { id: "desempenho", title: "Desempenho da conta", fields: [
      text("desempenhoConta.desempenhoConta", "Desempenho da conta", { completion: false }), text("desempenhoConta.metricaDesempenho", "Métrica de desempenho", { completion: false }),
      num("desempenhoConta.minhasPenalidades", "Penalidades"), pct("desempenhoConta.taxaNaoCumprimento", "Taxa de não cumprimento"),
      pct("desempenhoConta.taxaEnvioAtrasado", "Taxa de envio atrasado"), text("desempenhoConta.tempoPreparacao", "Tempo de preparação", { completion: false }),
      pct("desempenhoConta.enviosSabados", "Envios aos sábados", { completion: false }), num("desempenhoConta.violacoesGravesAnuncios", "Violações graves de anúncios", { risk: true }),
      num("desempenhoConta.produtosPreEncomenda", "Produtos em pré-encomenda", { completion: false }), num("desempenhoConta.outrasViolacoesAnuncios", "Outras violações de anúncios", { risk: true }),
      pct("desempenhoConta.taxaResposta", "Taxa de resposta"), text("desempenhoConta.resumoPontosPenalidade", "Resumo dos pontos de penalidade"),
      tri("desempenhoConta.apelacaoAndamento", "Apelação em andamento", { positive: "Não há apelação em andamento.", negative: "Há apelação em andamento.", risk: true, priority: true }),
      tri("desempenhoConta.vendedorIndicado", "É vendedor indicado", { positive: "Conta é vendedor indicado.", negative: "Conta não é vendedor indicado." }),
    ] },
    { id: "ads", title: "Publicidade (Shopee Ads)", fields: [
      table("shopeeAds.meses", "Métricas de Shopee Ads", ADS_SHOPEE), num("shopeeAds.numCampanhas", "Número de campanhas", { completion: false }),
      num("shopeeAds.numAnunciosTotalCampanhas", "Anúncios em campanhas", { completion: false }),
      num("shopeeAds.campanhasSemVendas", "Campanhas sem vendas", { risk: true }), num("shopeeAds.campanhasComGastoElevado", "Campanhas com gasto elevado", { risk: true }),
    ] },
    { id: "afiliados", title: "Afiliados do vendedor", fields: [
      tri("afiliados.campanhaAbertaAtiva", "Campanha aberta ativa", { positive: "Possui campanha aberta ativa de afiliados.", negative: "Não possui campanha aberta ativa de afiliados." }),
      num("afiliados.produtosCampanhaAberta", "Produtos em campanha aberta", { completion: false, condition: onlyWhenSim("afiliados.campanhaAbertaAtiva") }),
      tri("afiliados.campanhaExclusivaAtiva", "Campanha exclusiva ativa", { positive: "Possui campanha exclusiva ativa de afiliados.", negative: "Não possui campanha exclusiva ativa de afiliados." }),
      num("afiliados.produtosCampanhaExclusiva", "Produtos em campanha exclusiva", { completion: false, condition: onlyWhenSim("afiliados.campanhaExclusivaAtiva") }),
      table("afiliados.meses", "Vendas mensais por afiliados", AFILIADOS_SHOPEE),
    ] },
    { id: "decoracao", title: "Decoração da loja", fields: [
      tri("decoracaoLoja.possuiDecoracao", "Possui decoração da loja", { positive: "Loja possui decoração configurada.", negative: "Loja não possui decoração configurada." }),
      date("decoracaoLoja.dataUltimaAtualizacao", "Data da última atualização", { condition: onlyWhenSim("decoracaoLoja.possuiDecoracao") }),
    ] },
    COMMON_ABC,
    COMMON_DIAGNOSTICO,
  ];

  const TIKTOK = [
    COMMON_IDENTIFICACAO,
    { id: "metricas", title: "Métricas de negócio", fields: [table("metricasNegocio.meses", "Métricas de negócio (últimos meses)", METRICAS_TIKTOK)] },
    { id: "produtos", title: "Produtos", fields: [table("produtos.itens", "Top 20 produtos", PRODUTOS_TIKTOK)] },
    { id: "avaliacoes", title: "Avaliações de produtos", fields: [
      num("avaliacoesProdutos.negativas", "Avaliações negativas"), num("avaliacoesProdutos.neutras", "Avaliações neutras"),
      pct("avaliacoesProdutos.taxaNegativasRelacionadasVendedor", "Taxa de avaliações negativas relacionadas ao vendedor"),
    ] },
    { id: "marketing", title: "Central de marketing", fields: [
      tri("centralMarketing.centralDesconto", "Central de desconto", { positive: "Central de desconto ativa.", negative: "Central de desconto não está ativa." }),
      tri("centralMarketing.ofertaRelampago", "Oferta relâmpago", { positive: "Participa de oferta relâmpago.", negative: "Não participa de oferta relâmpago." }),
      tri("centralMarketing.cuponsVendedores", "Cupons de vendedores", { positive: "Utiliza cupons de vendedores.", negative: "Não utiliza cupons de vendedores." }),
      tri("centralMarketing.campanhasTiktok", "Campanhas TikTok", { positive: "Participa de campanhas TikTok.", negative: "Não participa de campanhas TikTok." }),
      tri("centralMarketing.liveVideo", "Live e vídeo", { positive: "Utiliza Live e vídeo.", negative: "Não utiliza Live e vídeo." }),
    ] },
    { id: "afiliados", title: "Afiliados", fields: [
      tri("afiliados.campanhaAbertaAtiva", "Possui campanha aberta ativa?", { positive: "Possui campanha aberta ativa de afiliados.", negative: "Não possui campanha aberta ativa de afiliados." }),
      tri("afiliados.campanhaDirecionadaAtiva", "Possui campanha direcionada ativa?", { positive: "Possui campanha direcionada ativa de afiliados.", negative: "Não possui campanha direcionada ativa de afiliados." }),
      tri("afiliados.solicitacoesAmostraGratisAtiva", "Solicitações de amostra grátis está ativa?", { positive: "Solicitações de amostra grátis estão ativas.", negative: "Solicitações de amostra grátis não estão ativas." }),
      tri("afiliados.solicitacoesAmostraReembolsavelAtiva", "Solicitações de amostra reembolsável está ativa?", { positive: "Solicitações de amostra reembolsável estão ativas.", negative: "Solicitações de amostra reembolsável não estão ativas." }),
      money("afiliados.gmvAtribuidoCriador", "GMV atribuído ao criador"),
      num("afiliados.criadoresPublicaramConteudo", "Criadores que publicaram conteúdo"),
      num("afiliados.todosCriadoresContatados", "Todos criadores contatados"),
      num("afiliados.criadoresConvidados", "Criadores convidados"),
      num("afiliados.criadoresEnviouMensagens", "Criadores aos quais você enviou mensagens"),
      num("afiliados.criadoresAdicionaramProdutos", "Criadores que adicionaram produtos"),
      num("afiliados.criadoresSolicitaramAmostra", "Criadores que solicitaram amostra"),
      num("afiliados.criadoresReceberamAmostras", "Criadores que receberam amostras"),
      num("afiliados.criadoresComVendas", "Criadores com vendas"),
    ] },
    { id: "integridade", title: "Classificação e integridade da conta", fields: [
      text("integridadeConta.status", "Status"), num("integridadeConta.pontuacao", "Pontuação"),
      pct("integridadeConta.taxaEnviosAtraso", "Taxa de envios com atraso"),
      pct("integridadeConta.taxaCancelamentoFalhaVendedor", "Taxa de cancelamento por falha do vendedor"),
      pct("integridadeConta.taxaRespostas24h", "Taxa de respostas em 24 horas"),
      num("integridadeConta.violacoesPolitica.gerenciamentoConta", "Gerenciamento de conta", { risk: true }),
      num("integridadeConta.violacoesPolitica.avaliacaoCliente", "Avaliação do cliente", { risk: true }),
      num("integridadeConta.violacoesPolitica.negociacaoJusta", "Negociação justa", { risk: true }),
      num("integridadeConta.violacoesPolitica.envioPosVenda", "Envio e pós-venda", { risk: true }),
      num("integridadeConta.violacoesPolitica.propriedadeIntelectual", "Propriedade intelectual", { risk: true }),
      num("integridadeConta.violacoesPolitica.qualidadeAnuncio", "Qualidade do anúncio", { risk: true }),
      num("integridadeConta.violacoesPolitica.outro", "Outro", { risk: true }),
      num("integridadeConta.violacoesPolitica.conformidadeProduto", "Conformidade do produto", { risk: true }),
      num("integridadeConta.violacoesPolitica.segurancaProduto", "Segurança do produto", { risk: true }),
    ] },
    { id: "desempenho", title: "Pontuação de desempenho da loja", fields: [
      num("pontuacaoDesempenhoLoja.satisfacaoProduto", "Satisfação do produto"),
      num("pontuacaoDesempenhoLoja.cumprimentoLogistica", "Cumprimento e logística"),
      num("pontuacaoDesempenhoLoja.atendimentoCliente", "Atendimento ao cliente"),
      num("pontuacaoDesempenhoLoja.pontuacaoGeralSps", "Pontuação geral (SPS)"),
    ] },
    { id: "decoracao", title: "Decoração da loja", fields: [
      tri("decoracaoLoja.possuiDecoracao", "Possui decoração?", { positive: "Loja possui decoração configurada.", negative: "Loja não possui decoração configurada." }),
    ] },
    COMMON_ABC,
    COMMON_DIAGNOSTICO,
  ];

  const MARKETPLACES = ["meli", "shopee", "tiktok"];
  const MARKETPLACE_LABELS = { meli: "Mercado Livre", shopee: "Shopee", tiktok: "TikTok Shop" };
  const SCHEMAS = { meli: ML, shopee: SHOPEE, tiktok: TIKTOK };

  function getPath(obj, path) {
    return String(path || "").split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
  }

  function isMissing(value) {
    if (value === null || value === undefined) return true;
    if (typeof value === "string") return value.trim() === "";
    if (Array.isArray(value)) return value.length === 0 || value.every(isMissing);
    if (typeof value === "object") return Object.keys(value).length === 0 || Object.values(value).every(isMissing);
    return false;
  }

  function isApplicable(field, respostas) {
    if (!field.condition) return true;
    return getPath(respostas, field.condition.path) === field.condition.equals;
  }

  function isAnswered(field, value) {
    if (field.type === "tristate") return value === "sim" || value === "nao";
    return !isMissing(value);
  }

  function getSections(marketplace) {
    return SCHEMAS[marketplace] || SCHEMAS.meli;
  }

  function getFields(marketplace) {
    return getSections(marketplace).flatMap((section) => section.fields.map((field) => ({ ...field, sectionId: section.id, sectionTitle: section.title })));
  }

  function evaluateCompleteness(marketplace, respostas) {
    const source = respostas && typeof respostas === "object" ? respostas : {};
    const sections = getSections(marketplace).map((section) => {
      const completionFields = section.fields.filter((field) => field.completion !== false && isApplicable(field, source));
      const pending = completionFields.filter((field) => !isAnswered(field, getPath(source, field.path))).map((field) => ({
        sectionId: section.id,
        sectionTitle: section.title,
        path: field.path,
        label: field.label,
      }));
      return {
        id: section.id,
        title: section.title,
        camposAplicaveis: completionFields.length,
        camposPreenchidos: completionFields.length - pending.length,
        camposPendentes: pending,
        concluida: pending.length === 0,
      };
    });
    const camposAplicaveis = sections.reduce((sum, section) => sum + section.camposAplicaveis, 0);
    const camposPreenchidos = sections.reduce((sum, section) => sum + section.camposPreenchidos, 0);
    const camposPendentes = sections.flatMap((section) => section.camposPendentes);
    const percentual = camposAplicaveis ? Math.round((camposPreenchidos / camposAplicaveis) * 10000) / 100 : 0;
    return {
      percentual,
      camposAplicaveis,
      camposPreenchidos,
      camposPendentes,
      totalSecoes: sections.length,
      secoesConcluidas: sections.filter((section) => section.concluida).length,
      secoes: sections,
    };
  }

  return { SCHEMA_VERSION: 1, MARKETPLACES, MARKETPLACE_LABELS, getPath, isMissing, isApplicable, isAnswered, getSections, getFields, evaluateCompleteness };
});
