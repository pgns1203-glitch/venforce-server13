// server/services/diagnosticoInicial/diagnosticoInicialGeradorService.js
//
// Motor determinístico (sem IA externa) que transforma respostas_json em um
// diagnóstico estruturado (seção 13 da especificação). Regras:
//   - "Sim" em item relevante alimenta pontosPositivos.
//   - "Não" em item relevante alimenta pontosNegativos (ou riscosUrgencias,
//     quando o item é de compliance/penalidade) e, se marcado como
//     prioritário, também prioridadesPrimeiraSemana.
//   - "Não avaliado" / vazio alimenta informacoesAusentes — nunca é tratado
//     como "Não", e número vazio nunca vira zero.
//   - Textos livres do gestor (diagnosticoManual) complementam, nunca são
//     inventados ou resumidos por conta própria.
//
// Preparado para, no futuro, trocar a estratégia de geração (ex.: chamar um
// provedor de IA) sem alterar o contrato de saída — quem chama este módulo
// só conhece gerarDiagnostico() e calcularCompletude().

function getPath(obj, path) {
  return path.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function isVazio(valor) {
  if (valor === null || valor === undefined || valor === "") return true;
  if (Array.isArray(valor)) return valor.length === 0;
  if (typeof valor === "object") return Object.values(valor).every(isVazio);
  return false;
}

function triSim(respostas, path) {
  return getPath(respostas, path) === "sim";
}

function splitLinhas(texto) {
  return String(texto || "")
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter(Boolean);
}

// ─── Registros de campos por marketplace ────────────────────────────────
// tipo 'tristate': valores 'sim' | 'nao' | 'nao_avaliado' (ou vazio).
// tipo 'valor': número, texto, select ou tabela — só checa presença/ausência.
// risco: "Não" (ou número > 0) alimenta riscosUrgencias em vez de pontosNegativos.
// prioridade: além do destino normal, também alimenta prioridadesPrimeiraSemana.

const CAMPOS_ML = [
  { path: "reputacao.reputacaoAtual", tipo: "valor", label: "Reputação atual" },
  { path: "reputacao.medalha", tipo: "valor", label: "Medalha" },
  { path: "reputacao.reclamacoesPercentual", tipo: "valor", label: "Percentual de reclamações" },
  { path: "reputacao.mediacoesPercentual", tipo: "valor", label: "Percentual de mediações" },
  { path: "reputacao.canceladosPorVocePercentual", tipo: "valor", label: "Cancelados por você (%)" },
  { path: "reputacao.atrasoDespachoPercentual", tipo: "valor", label: "Atraso no despacho (%)" },

  { path: "auditoriaAnuncios.anunciosAtivos", tipo: "valor", label: "Anúncios ativos" },
  { path: "auditoriaAnuncios.anunciosInativos", tipo: "valor", label: "Anúncios inativos" },
  { path: "auditoriaAnuncios.anunciosCatalogo", tipo: "valor", label: "Anúncios em catálogo" },
  { path: "auditoriaAnuncios.checklist.titulosOtimizados", tipo: "tristate", label: "Títulos otimizados",
    positivo: "Títulos dos anúncios estão otimizados.", negativo: "Títulos dos anúncios precisam de otimização.", prioridade: true },
  { path: "auditoriaAnuncios.checklist.descricoesOtimizadas", tipo: "tristate", label: "Descrições otimizadas",
    positivo: "Descrições dos anúncios estão otimizadas.", negativo: "Descrições dos anúncios precisam de otimização.", prioridade: true },
  { path: "auditoriaAnuncios.checklist.caracteristicasPreenchidas", tipo: "tristate", label: "Características preenchidas",
    positivo: "Ficha técnica dos anúncios está preenchida.", negativo: "Características dos anúncios não estão preenchidas." },
  { path: "auditoriaAnuncios.checklist.centralPromocaoAtiva", tipo: "tristate", label: "Central de Promoção ativa (anúncios)",
    positivo: "Central de Promoção ativa nos anúncios auditados.", negativo: "Central de Promoção não está ativa nos anúncios auditados." },
  { path: "auditoriaAnuncios.checklist.opcaoVendaVariacoes", tipo: "tristate", label: "Opção de venda (variações)",
    positivo: "Anúncios utilizam variações corretamente.", negativo: "Anúncios não utilizam variações." },
  { path: "auditoriaAnuncios.checklist.precoAtacado", tipo: "tristate", label: "Preço de atacado",
    positivo: "Preço de atacado configurado.", negativo: "Preço de atacado não configurado." },
  { path: "auditoriaAnuncios.checklist.dadosFiscaisPreenchidos", tipo: "tristate", label: "Dados fiscais preenchidos",
    positivo: "Dados fiscais preenchidos nos anúncios.", negativo: "Dados fiscais não preenchidos nos anúncios.", prioridade: true },
  { path: "auditoriaAnuncios.checklist.imagensOtimizadas", tipo: "tristate", label: "Imagens otimizadas",
    positivo: "Imagens dos anúncios estão otimizadas.", negativo: "Imagens dos anúncios precisam de otimização.", prioridade: true },
  { path: "auditoriaAnuncios.checklist.utilizaClips", tipo: "tristate", label: "Utiliza clips (vídeos)",
    positivo: "Anúncios utilizam clips (vídeos).", negativo: "Anúncios não utilizam clips (vídeos)." },

  { path: "full.utilizaFull", tipo: "tristate", label: "Utiliza Mercado Envios Full",
    positivo: "Cliente utiliza Mercado Envios Full.", negativo: "Cliente não utiliza Mercado Envios Full." },
  { path: "full.produtosRiscoCobranca", tipo: "valor", label: "Produtos com risco de cobrança/descarte (Full)",
    condicional: (r) => triSim(r, "full.utilizaFull"), risco: true },
  { path: "full.saudeFull.pontuacaoQualidade", tipo: "valor", label: "Pontuação de qualidade do Full",
    condicional: (r) => triSim(r, "full.utilizaFull") },

  { path: "posVenda.reclamacoesNaoVisualizadas", tipo: "tristate", label: "Reclamações em andamento não visualizadas",
    positivo: "Não há reclamações em andamento sem visualização.", negativo: "Há reclamações em andamento não visualizadas.",
    prioridade: true, risco: true },

  { path: "centralMarketing.afiliados", tipo: "tristate", label: "Programa de afiliados",
    positivo: "Programa de afiliados ativo.", negativo: "Programa de afiliados não está ativo." },
  { path: "centralMarketing.ofertasRelampago", tipo: "tristate", label: "Ofertas relâmpago",
    positivo: "Participa de ofertas relâmpago.", negativo: "Não participa de ofertas relâmpago." },
  { path: "centralMarketing.centralPromocao", tipo: "tristate", label: "Central de Promoção",
    positivo: "Central de Promoção ativa.", negativo: "Central de Promoção não está ativa." },
  { path: "centralMarketing.descontoQtd", tipo: "tristate", label: "Desconto por quantidade",
    positivo: "Utiliza desconto por quantidade.", negativo: "Não utiliza desconto por quantidade." },
  { path: "centralMarketing.minhaPaginaDisplayAds", tipo: "tristate", label: "Minha Página / Display Ads",
    positivo: "Utiliza Minha Página / Display Ads.", negativo: "Não utiliza Minha Página / Display Ads." },
  { path: "centralMarketing.canalTransmissao", tipo: "tristate", label: "Canal de transmissão",
    positivo: "Utiliza canal de transmissão.", negativo: "Não utiliza canal de transmissão." },

  { path: "productAds.meses", tipo: "valor", label: "Métricas de Product Ads" },
  { path: "productAds.campanhasSemVendas", tipo: "valor", label: "Campanhas sem vendas (Product Ads)", risco: true },
  { path: "productAds.campanhasComGastoElevado", tipo: "valor", label: "Campanhas com gasto elevado (Product Ads)", risco: true },

  { path: "marcasCatalogo.registroMarcaAtivo", tipo: "tristate", label: "Registro de marca ativo",
    positivo: "Registro de marca ativo.", negativo: "Registro de marca não está ativo." },
  { path: "marcasCatalogo.elegibilidadeCatalogo", tipo: "tristate", label: "Elegibilidade para catálogo",
    positivo: "Elegível para catálogo.", negativo: "Não elegível para catálogo." },

  { path: "metricasNegocio.meses", tipo: "valor", label: "Métricas de negócio (últimos meses)" },
  { path: "curvaAbc.status", tipo: "valor", label: "Status da Curva ABC" },
];

const CAMPOS_SHOPEE = [
  { path: "auditoriaAnuncios.anunciosAtivos", tipo: "valor", label: "Anúncios ativos" },
  { path: "auditoriaAnuncios.anunciosInativos", tipo: "valor", label: "Anúncios inativos" },
  { path: "auditoriaAnuncios.checklist.titulosOtimizados", tipo: "tristate", label: "Títulos otimizados",
    positivo: "Títulos dos anúncios estão otimizados.", negativo: "Títulos dos anúncios precisam de otimização.", prioridade: true },
  { path: "auditoriaAnuncios.checklist.descricoesOtimizadas", tipo: "tristate", label: "Descrições otimizadas",
    positivo: "Descrições dos anúncios estão otimizadas.", negativo: "Descrições dos anúncios precisam de otimização.", prioridade: true },
  { path: "auditoriaAnuncios.checklist.caracteristicasPreenchidas", tipo: "tristate", label: "Características preenchidas",
    positivo: "Características preenchidas nos anúncios.", negativo: "Características não preenchidas nos anúncios." },
  { path: "auditoriaAnuncios.checklist.centralPromocaoAtiva", tipo: "tristate", label: "Central de Promoção ativa (anúncios)",
    positivo: "Central de Promoção ativa nos anúncios auditados.", negativo: "Central de Promoção não está ativa nos anúncios auditados." },
  { path: "auditoriaAnuncios.checklist.opcaoVendaVariacoes", tipo: "tristate", label: "Opção de venda (variações)",
    positivo: "Anúncios utilizam variações corretamente.", negativo: "Anúncios não utilizam variações." },
  { path: "auditoriaAnuncios.checklist.dadosFiscaisPreenchidos", tipo: "tristate", label: "Dados fiscais preenchidos",
    positivo: "Dados fiscais preenchidos nos anúncios.", negativo: "Dados fiscais não preenchidos nos anúncios.", prioridade: true },
  { path: "auditoriaAnuncios.checklist.imagensOtimizadas", tipo: "tristate", label: "Imagens otimizadas",
    positivo: "Imagens dos anúncios estão otimizadas.", negativo: "Imagens dos anúncios precisam de otimização.", prioridade: true },
  { path: "auditoriaAnuncios.checklist.utilizaClips", tipo: "tristate", label: "Utiliza clips (vídeos)",
    positivo: "Anúncios utilizam clips (vídeos).", negativo: "Anúncios não utilizam clips (vídeos)." },
  { path: "auditoriaAnuncios.checklist.possuiRegistroMarca", tipo: "tristate", label: "Possui registro de marca (Brand Management)",
    positivo: "Possui registro de marca.", negativo: "Não possui registro de marca." },
  { path: "auditoriaAnuncios.checklist.registroMarcaAceito", tipo: "tristate", label: "Registro de marca aceito",
    condicional: (r) => triSim(r, "auditoriaAnuncios.checklist.possuiRegistroMarca"),
    positivo: "Registro de marca foi aceito.", negativo: "Registro de marca ainda não foi aceito.", prioridade: true },

  { path: "fulfillment.utilizaFull", tipo: "tristate", label: "Utiliza Fulfillment",
    positivo: "Cliente utiliza Fulfillment.", negativo: "Cliente não utiliza Fulfillment." },
  { path: "fulfillment.produtosNoFull", tipo: "valor", label: "Produtos no Fulfillment",
    condicional: (r) => triSim(r, "fulfillment.utilizaFull") },

  { path: "centralMarketing.centralDesconto", tipo: "tristate", label: "Central de Desconto",
    positivo: "Central de Desconto ativa.", negativo: "Central de Desconto não está ativa." },
  { path: "centralMarketing.ofertasRelampago", tipo: "tristate", label: "Ofertas relâmpago",
    positivo: "Participa de ofertas relâmpago.", negativo: "Não participa de ofertas relâmpago." },
  { path: "centralMarketing.cuponsVendedores", tipo: "tristate", label: "Cupons de vendedores",
    positivo: "Utiliza cupons de vendedores.", negativo: "Não utiliza cupons de vendedores." },
  { path: "centralMarketing.campanha", tipo: "tristate", label: "Campanha",
    positivo: "Participa de campanhas.", negativo: "Não participa de campanhas." },
  { path: "centralMarketing.liveVideo", tipo: "tristate", label: "Live & Vídeo",
    positivo: "Utiliza Live & Vídeo.", negativo: "Não utiliza Live & Vídeo." },

  { path: "desempenhoConta.apelacaoAndamento", tipo: "tristate", label: "Apelação em andamento",
    positivo: "Não há apelação em andamento.", negativo: "Há apelação em andamento.", risco: true, prioridade: true },
  { path: "desempenhoConta.vendedorIndicado", tipo: "tristate", label: "É vendedor indicado",
    positivo: "Conta é vendedor indicado.", negativo: "Conta não é vendedor indicado." },
  { path: "desempenhoConta.violacoesGravesAnuncios", tipo: "valor", label: "Violações graves de anúncios", risco: true },
  { path: "desempenhoConta.outrasViolacoesAnuncios", tipo: "valor", label: "Outras violações de anúncios", risco: true },
  { path: "desempenhoConta.minhasPenalidades", tipo: "valor", label: "Penalidades" },
  { path: "desempenhoConta.taxaNaoCumprimento", tipo: "valor", label: "Taxa de não cumprimento" },
  { path: "desempenhoConta.taxaEnvioAtrasado", tipo: "valor", label: "Taxa de envio atrasado" },
  { path: "desempenhoConta.taxaResposta", tipo: "valor", label: "Taxa de resposta" },

  { path: "shopeeAds.meses", tipo: "valor", label: "Métricas de Shopee Ads" },
  { path: "shopeeAds.campanhasSemVendas", tipo: "valor", label: "Campanhas sem vendas (Shopee Ads)", risco: true },
  { path: "shopeeAds.campanhasComGastoElevado", tipo: "valor", label: "Campanhas com gasto elevado (Shopee Ads)", risco: true },

  { path: "afiliados.campanhaAbertaAtiva", tipo: "tristate", label: "Campanha aberta ativa (afiliados)",
    positivo: "Possui campanha aberta ativa de afiliados.", negativo: "Não possui campanha aberta ativa de afiliados." },
  { path: "afiliados.campanhaExclusivaAtiva", tipo: "tristate", label: "Campanha exclusiva ativa (afiliados)",
    positivo: "Possui campanha exclusiva ativa de afiliados.", negativo: "Não possui campanha exclusiva ativa de afiliados." },

  { path: "decoracaoLoja.possuiDecoracao", tipo: "tristate", label: "Possui decoração da loja",
    positivo: "Loja possui decoração configurada.", negativo: "Loja não possui decoração configurada." },

  { path: "metricasNegocio.meses", tipo: "valor", label: "Métricas de negócio (últimos meses)" },
  { path: "produtos.itens", tipo: "valor", label: "Principais produtos" },
  { path: "curvaAbc.status", tipo: "valor", label: "Status da Curva ABC" },
];

function registroCampos(marketplace) {
  return marketplace === "shopee" ? CAMPOS_SHOPEE : CAMPOS_ML;
}

// Percorre o registro de campos aplicável e classifica cada resposta.
function avaliarCampos(marketplace, respostas) {
  const campos = registroCampos(marketplace);
  const resultado = {
    aplicaveis: 0,
    preenchidos: 0,
    pontosPositivos: [],
    pontosNegativos: [],
    riscosUrgencias: [],
    prioridadesPrimeiraSemana: [],
    informacoesAusentes: [],
  };

  for (const campo of campos) {
    if (campo.condicional && !campo.condicional(respostas || {})) continue;
    resultado.aplicaveis += 1;
    const valor = getPath(respostas || {}, campo.path);

    if (campo.tipo === "tristate") {
      if (valor === "sim") {
        resultado.preenchidos += 1;
        resultado.pontosPositivos.push(campo.positivo || `${campo.label}: Sim.`);
      } else if (valor === "nao") {
        resultado.preenchidos += 1;
        const texto = campo.negativo || `${campo.label}: Não.`;
        if (campo.risco) resultado.riscosUrgencias.push(texto);
        else resultado.pontosNegativos.push(texto);
        if (campo.prioridade) resultado.prioridadesPrimeiraSemana.push(texto);
      } else {
        resultado.informacoesAusentes.push(`${campo.label}: não avaliado.`);
      }
      continue;
    }

    // tipo "valor": número, texto, select ou tabela — só presença/ausência.
    if (isVazio(valor)) {
      resultado.informacoesAusentes.push(`${campo.label}: não informado.`);
    } else {
      resultado.preenchidos += 1;
      if (campo.risco && typeof valor === "number" && valor > 0) {
        resultado.riscosUrgencias.push(`${campo.label}: ${valor}.`);
      }
    }
  }

  return resultado;
}

function calcularCompletude(marketplace, respostas) {
  const { aplicaveis, preenchidos } = avaliarCampos(marketplace, respostas);
  if (!aplicaveis) return 0;
  return Math.round((preenchidos / aplicaveis) * 10000) / 100;
}

function montarResumoExecutivo({ completude, pontosPositivos, pontosNegativos, riscosUrgencias, informacoesAusentes }, marketplace) {
  const nomeMkt = marketplace === "shopee" ? "Shopee" : "Mercado Livre";
  const partes = [`Diagnóstico inicial ${nomeMkt} gerado com ${completude}% de completude.`];
  if (pontosPositivos.length) partes.push(`${pontosPositivos.length} ponto(s) positivo(s) identificado(s).`);
  if (pontosNegativos.length) partes.push(`${pontosNegativos.length} ponto(s) de atenção identificado(s).`);
  if (riscosUrgencias.length) partes.push(`${riscosUrgencias.length} risco(s)/urgência(s) identificado(s).`);
  if (informacoesAusentes.length) partes.push(`${informacoesAusentes.length} item(ns) ainda não avaliado(s) ou não informado(s).`);
  return partes.join(" ");
}

function gerarDiagnostico(marketplace, respostas, { geradoPor } = {}) {
  const avaliacao = avaliarCampos(marketplace, respostas);
  const completude = avaliacao.aplicaveis
    ? Math.round((avaliacao.preenchidos / avaliacao.aplicaveis) * 10000) / 100
    : 0;

  const out = {
    resumoExecutivo: "",
    situacaoAtual: "",
    pontosPositivos: [...avaliacao.pontosPositivos],
    pontosNegativos: [...avaliacao.pontosNegativos],
    riscosUrgencias: [...avaliacao.riscosUrgencias],
    prioridadesPrimeiraSemana: [...avaliacao.prioridadesPrimeiraSemana],
    plano30Dias: [],
    acoesMedioPrazo: [],
    informacoesAusentes: [...avaliacao.informacoesAusentes],
    conclusaoAnalista: "",
    completude,
    geradoEm: new Date().toISOString(),
    geradoPor: geradoPor || "sistema",
  };

  // Textos livres do gestor (seção "Diagnóstico" dos DOCX) complementam o
  // resultado automático — nunca são resumidos ou reinterpretados aqui.
  const manual = (respostas && respostas.diagnosticoManual) || {};
  out.situacaoAtual = String(manual.estrategias || "").trim();
  if (manual.pontosPositivos) out.pontosPositivos.push(...splitLinhas(manual.pontosPositivos));
  if (manual.pontosNegativos) out.pontosNegativos.push(...splitLinhas(manual.pontosNegativos));
  if (manual.prioridadesUrgencias) out.prioridadesPrimeiraSemana.push(...splitLinhas(manual.prioridadesUrgencias));
  if (manual.planoAcao) out.plano30Dias.push(...splitLinhas(manual.planoAcao));

  out.resumoExecutivo = montarResumoExecutivo(out, marketplace);

  return out;
}

module.exports = {
  gerarDiagnostico,
  calcularCompletude,
  registroCampos,
  getPath,
};
