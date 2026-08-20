const pool = require("../../config/database");

function getRepository() {
  return require("./centralVendasRepository");
}

const { resolveMarketplaceAccountContext } = require("../clienteContas/clienteContaService");

const MESES = [
  "Janeiro", "Fevereiro", "Marco", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function normalizeSlug(slug) {
  return String(slug || "").trim().toLowerCase();
}

function normalizeCompetencia(value) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}$/.test(text)) return text;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function periodoFromCompetencia(competencia) {
  const [yearText, monthText] = String(competencia).split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const lastDay = new Date(year, month, 0).getDate();
  return {
    competencia,
    inicio: `${competencia}-01`,
    fim: `${competencia}-${String(lastDay).padStart(2, "0")}`,
    label: `${MESES[month - 1] || monthText}/${year}`,
  };
}

function isValidIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function formatBrDate(iso) {
  const [y, m, d] = String(iso).split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

function periodoFromRange(dateFrom, dateTo) {
  return {
    competencia: String(dateFrom).slice(0, 7), // legado: só p/ agrupamento mensal
    inicio: dateFrom,
    fim: dateTo,
    label: `${formatBrDate(dateFrom)} – ${formatBrDate(dateTo)}`,
  };
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round2(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

function jsonValue(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (_) {
      return fallback;
    }
  }
  return value;
}

function toIsoDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

const STATUS_FORA_DO_RESULTADO = new Set(["cancelado", "com_problema"]);

// Tipos de componente persistidos pelo motor API-first. Os cinco primeiros
// formam o Resultado Parcial; `receita_envio` (receiver.cost) e
// `cancelamento_reembolso` (payments[].transaction_amount_refunded) entram nos
// TOTAIS para conciliacao, mas NUNCA na formula do resultado — somar o reembolso
// a um pedido cuja receita ja foi excluida seria dupla contagem.
const TIPOS_COMPONENTE = [
  "receita_produto",
  "tarifa_venda",
  "frete_seller",
  "custo_produto",
  "imposto_interno",
  "receita_envio",
  "cancelamento_reembolso",
];

function normalizePedidoStatus(status) {
  const text = String(status || "").toLowerCase();
  if (/cancel|devolu|reembolso/.test(text)) return "cancelado";
  if (/problema|mediacao|media/.test(text)) return "com_problema";
  if (/pend/.test(text)) return "pendente";
  return "pago";
}

// Cancelamentos e mediações permanecem no payload para auditoria, mas não
// compõem faturamento, resultado ou margem — mesma regra do motor por planilha.
function pedidoEntraNoResultado(pedido) {
  const status = normalizePedidoStatus(pedido?.status);
  return !!pedido && !STATUS_FORA_DO_RESULTADO.has(status);
}

function rowValue(row, camel, snake) {
  return row?.[camel] ?? row?.[snake];
}

function componentValue(component) {
  return numberOrNull(rowValue(component, "valor", "valor"));
}

function sumComponents(components, tipo) {
  const values = components
    .filter((component) => rowValue(component, "tipo", "tipo") === tipo)
    .map(componentValue)
    .filter((value) => value !== null);
  if (!values.length) return null;
  return round2(values.reduce((sum, value) => sum + value, 0));
}

function confidenceToResultadoStatus(confianca) {
  if (confianca === "confiavel") return "real";
  if (confianca === "parcial") return "parcial";
  return "bloqueado";
}

function buildProdutos(itens) {
  const produtos = {};

  for (const item of itens || []) {
    const mlb = rowValue(item, "mlb", "mlb");
    if (!mlb || produtos[mlb]) continue;

    const quantidade = numberOrNull(rowValue(item, "quantidade", "quantidade"));
    const custoTotal = numberOrNull(rowValue(item, "custoProduto", "custo_produto"));
    const receitaProduto = numberOrNull(rowValue(item, "receitaProduto", "receita_produto"));
    const impostoInterno = numberOrNull(rowValue(item, "impostoInterno", "imposto_interno"));
    const custoUnitario =
      custoTotal !== null && quantidade && quantidade > 0
        ? round2(custoTotal / quantidade)
        : null;
    const impostoPercentual =
      impostoInterno !== null && receitaProduto && receitaProduto > 0
        ? round2((impostoInterno / receitaProduto) * 100)
        : null;

    produtos[mlb] = {
      mlb,
      sku: rowValue(item, "sku", "sku") || null,
      titulo: rowValue(item, "titulo", "titulo") || mlb,
      full: null,
      ads: { status: "ausente" },
      base: {
        temCusto: custoUnitario !== null,
        custo: custoUnitario,
        imposto: impostoPercentual,
        status: custoUnitario !== null ? "real" : "ausente",
      },
      diag: {
        presente: false,
        mc: null,
        status: "ausente",
      },
    };
  }

  return produtos;
}

function buildPedidoContrato(pedido, itens, componentes) {
  const pedidoId = rowValue(pedido, "pedidoId", "pedido_id");
  // Vinculo por pedido_row_id (PK da linha de central_vendas_pedidos), nunca por
  // pedido_id. getCentralVendasByRange le imports de VARIAS competencias, entao o
  // mesmo pedido_id do ML pode existir em mais de uma importacao (pedido de borda
  // de mes, reimportacao). Casar por pedido_id somava os componentes das duas
  // importacoes no mesmo pedido: custo, frete e tarifa dobrados e itens
  // duplicados — inflando produtos, unidades e a ponte inteira no Cliente 360.
  const pedidoRowId = rowValue(pedido, "id", "id");
  const mesmaLinha = (row) => {
    const rowId = rowValue(row, "pedidoRowId", "pedido_row_id");
    // Fallback por pedido_id apenas quando o row id nao veio (payloads legados,
    // testes com snapshot montado a mao). Nunca quando ha row id disponivel.
    if (rowId === null || rowId === undefined || pedidoRowId === null || pedidoRowId === undefined) {
      return rowValue(row, "pedidoId", "pedido_id") === pedidoId;
    }
    return String(rowId) === String(pedidoRowId);
  };

  const pedidoItens = itens.filter(mesmaLinha);
  const pedidoComponentes = componentes.filter(mesmaLinha);
  const firstItem = pedidoItens[0] || null;
  const confianca = rowValue(pedido, "confianca", "confianca");
  // logistica/full so existem no fluxo API-first (Orders API); planilha = null.
  const pedidoPayload = jsonValue(rowValue(pedido, "payload", "payload_json"), {});
  const logistica = pedidoPayload.logistica ?? null;
  const full = pedidoPayload.full ?? (logistica ? logistica === "full" : null);
  const posVendaTipo = pedidoPayload.posVendaTipo ?? null;
  const posVendaMotivo = pedidoPayload.posVendaMotivo ?? null;
  const posVendaParcial = pedidoPayload.posVendaParcial === true;
  const claimId = pedidoPayload.claimId ?? null;
  const claimIds = Array.isArray(pedidoPayload.claimIds) ? pedidoPayload.claimIds.map(String) : [];
  const frete = sumComponents(pedidoComponentes, "frete_seller");
  const taxas = sumComponents(pedidoComponentes, "tarifa_venda");
  const custo = sumComponents(pedidoComponentes, "custo_produto");
  const imposto = sumComponents(pedidoComponentes, "imposto_interno");
  // Conciliacao: nao entram no resultado do pedido, apenas sao expostos.
  const receitaEnvio = sumComponents(pedidoComponentes, "receita_envio");
  const reembolso = sumComponents(pedidoComponentes, "cancelamento_reembolso");

  const status = normalizePedidoStatus(rowValue(pedido, "status", "status"));

  return {
    id: pedidoId,
    pedidoId,
    // M7 — identificador não ambíguo da LINHA (pedido_row_id), nunca o
    // pedido_id do ML: o mesmo pedido_id pode existir em mais de uma
    // importação (pedido de borda de mês, reimportação — ver comentário
    // acima sobre `mesmaLinha`). rowId é o que a Read API usa para
    // detalhe/ledger sob demanda sem ambiguidade nem IDOR (seção 9/10).
    rowId: pedidoRowId ?? null,
    // M7, seção 10 — honestidade multi-item: a linha nunca deve ser lida
    // como "o pedido é este 1 produto" quando há mais de um item. Os
    // valores financeiros já são a soma dos itens (M5); estes dois campos
    // só tornam essa contagem visível, sem mudar nenhum valor.
    multiItem: pedidoItens.length > 1,
    qtdItens: pedidoItens.length,
    data: toIsoDate(rowValue(pedido, "dataPedido", "data_pedido")),
    status,
    statusOriginal: pedidoPayload.statusOriginal ?? rowValue(pedido, "status", "status") ?? null,
    entraNoResultado: !STATUS_FORA_DO_RESULTADO.has(status),
    posVendaTipo,
    posVendaMotivo,
    posVendaParcial,
    posVendaQuantidadeComprada: pedidoPayload.posVendaQuantidadeComprada ?? null,
    posVendaQuantidadeDevolvida: pedidoPayload.posVendaQuantidadeDevolvida ?? null,
    claimId,
    claimIds,
    mlb: firstItem ? rowValue(firstItem, "mlb", "mlb") || null : null,
    sku: firstItem ? rowValue(firstItem, "sku", "sku") || null : null,
    produto: firstItem
      ? {
          mlb: rowValue(firstItem, "mlb", "mlb") || null,
          sku: rowValue(firstItem, "sku", "sku") || null,
          titulo: rowValue(firstItem, "titulo", "titulo") || rowValue(firstItem, "mlb", "mlb") || null,
        }
      : { mlb: null, sku: null, titulo: "(linha financeira sem produto)" },
    unidades: numberOrNull(rowValue(pedido, "quantidadeItens", "quantidade_itens")),
    valor: numberOrNull(rowValue(pedido, "faturamento", "faturamento")),
    frete: frete === null ? null : Math.abs(frete),
    freteStatus: frete === null ? "ausente" : "real",
    taxas: taxas === null ? null : Math.abs(taxas),
    taxasStatus: taxas === null ? "ausente" : "real",
    custo: custo === null ? null : Math.abs(custo),
    custoStatus: custo === null ? "ausente" : "real",
    imposto: imposto === null ? null : Math.abs(imposto),
    // receita_envio (receiver.cost) e cancelamento_reembolso ficam fora do
    // resultado — sao dados de conciliacao, nao componentes do calculo.
    receitaEnvio: receitaEnvio === null ? null : Math.abs(receitaEnvio),
    receitaEnvioStatus: receitaEnvio === null ? "ausente" : "real",
    reembolso: reembolso === null ? null : Math.abs(reembolso),
    reembolsoStatus: reembolso === null ? "ausente" : "real",
    resultado: numberOrNull(rowValue(pedido, "resultado", "resultado")),
    resultadoStatus: confidenceToResultadoStatus(confianca),
    confianca,
    pendencias: jsonValue(rowValue(pedido, "pendencias", "pendencias_json"), []),
    logistica,
    full,
    adsStatus: "ausente",
    itens: pedidoItens.map((item) => ({
      id: rowValue(item, "itemId", "item_id"),
      itemId: rowValue(item, "itemId", "item_id"),
      mlb: rowValue(item, "mlb", "mlb") || null,
      sku: rowValue(item, "sku", "sku") || null,
      titulo: rowValue(item, "titulo", "titulo") || null,
      quantidade: numberOrNull(rowValue(item, "quantidade", "quantidade")),
      valorUnitario: numberOrNull(rowValue(item, "valorUnitario", "valor_unitario")),
      receitaProduto: numberOrNull(rowValue(item, "receitaProduto", "receita_produto")),
      custoProduto: numberOrNull(rowValue(item, "custoProduto", "custo_produto")),
      impostoInterno: numberOrNull(rowValue(item, "impostoInterno", "imposto_interno")),
      resultado: numberOrNull(rowValue(item, "resultado", "resultado")),
      confianca: rowValue(item, "confianca", "confianca"),
      pendencias: jsonValue(rowValue(item, "pendencias", "pendencias_json"), []),
    })),
    componentes: pedidoComponentes.map((component) => ({
      tipo: rowValue(component, "tipo", "tipo"),
      valor: numberOrNull(rowValue(component, "valor", "valor")),
      fonte: rowValue(component, "fonte", "fonte") || null,
      confianca: rowValue(component, "confianca", "confianca"),
      obs: rowValue(component, "obs", "obs") || null,
      itemId: rowValue(component, "itemId", "item_id") || null,
      // M6 (escopo/efeito/incluido_no_resultado) já persistido desde aquele
      // marco; M7 é só quem primeiro expõe no payload (seção 9 do M6:
      // "fica para M7"). Nunca recalculado aqui — leitura direta da coluna.
      escopo: rowValue(component, "escopo", "escopo") || null,
      efeito: rowValue(component, "efeito", "efeito") || null,
      incluidoNoResultado: rowValue(component, "incluidoNoResultado", "incluido_no_resultado") ?? null,
    })),
  };
}

function buildEmptyPayload(cliente, competencia) {
  return {
    ok: true,
    fonte: "central_vendas_db",
    cliente,
    periodo: periodoFromCompetencia(competencia),
    motor: {
      status: "sem_dados",
      etapaAtual: "aguardando_importacao",
      progresso: 0,
      confianca: "ausente",
      podeConcluir: false,
      motivoBloqueio: "Nenhuma importacao encontrada para esta competencia.",
      geradoEm: null,
      origemPrincipal: "planilha_vendas",
    },
    adsPorProdutoDisponivel: false,
    adsMensal: { investimento: null, status: "ausente" },
    resumo: {
      pedidosTotal: 0,
      pedidosConfiaveis: 0,
      pedidosParciais: 0,
      pedidosBloqueados: 0,
      faturamento: 0,
      faturamentoComCusto: 0,
      receitaBloqueada: 0,
      lucroContribuicao: null,
      margemContribuicaoPercentual: null,
      totaisPorTipo: {},
    },
    produtos: {},
    pedidos: [],
  };
}

function buildPayloadFromSnapshot(cliente, competencia, snapshot) {
  if (!snapshot) return buildEmptyPayload(cliente, competencia);

  const pedidos = buildPedidos(snapshot);
  const claimsState = buildClaimsState(snapshot);
  const resumoBase = jsonValue(snapshot.importacao.resumo_json, {});
  const resumo = {
    ...resumoBase,
    ...claimsState,
    claimsVerificados: !claimsState.claimsIndisponivel,
    claimsEncontrados: pedidos.filter((pedido) => (pedido.claimIds || []).length > 0).length,
    devolucoes: pedidos.filter((pedido) => pedido.posVendaTipo === "devolucao").length,
    devolucoesParciais: pedidos.filter((pedido) => pedido.posVendaTipo === "devolucao_parcial").length,
    mediacoes: pedidos.filter((pedido) => pedido.posVendaTipo === "mediacao").length,
    confianca:
      claimsState.claimsIndisponivel || claimsState.claimsReturnsNaoResolvidos > 0
        ? "parcial"
        : resumoBase.confianca,
  };
  const temBloqueado = pedidos.some((pedido) => pedido.confianca === "bloqueado");
  const completenessState = buildCompletenessState(snapshot);
  const completudeIncompleta = completenessState.hasSignal && completenessState.completenessStatus !== "complete";
  const geradoEm = snapshot.importacao.created_at || snapshot.importacao.createdAt || null;

  const motivosBloqueio = [];
  if (claimsState.claimsIndisponivel) motivosBloqueio.push("A verificacao de pos-venda (claims) nao foi concluida.");
  if (temBloqueado) motivosBloqueio.push("Ha pedidos bloqueados por custo/produto ausente.");
  if (completudeIncompleta) {
    motivosBloqueio.push(`Coleta incompleta: ${completenessState.incompleteSources.join(", ") || "fonte nao verificada"}.`);
  }

  return {
    ok: true,
    fonte: "central_vendas_db",
    cliente,
    periodo: periodoFromCompetencia(competencia),
    motor: {
      status: "persistido",
      etapaAtual: "importacao_persistida",
      progresso: 100,
      confianca: completudeIncompleta ? "parcial" : (resumo.confianca || snapshot.importacao.confianca || "parcial"),
      podeConcluir: !temBloqueado && !claimsState.claimsIndisponivel && !completudeIncompleta,
      motivoBloqueio: motivosBloqueio.length ? motivosBloqueio.join(" ") : null,
      geradoEm: geradoEm instanceof Date ? geradoEm.toISOString() : geradoEm,
      origemPrincipal: snapshot.importacao.fonte || "planilha_vendas",
      importId: snapshot.importacao.id,
    },
    adsPorProdutoDisponivel: false,
    adsMensal: { investimento: null, status: "ausente" },
    resumo,
    completude: completenessState.hasSignal
      ? { status: completenessState.completenessStatus, fontesIncompletas: completenessState.incompleteSources }
      : null,
    produtos: buildProdutos(snapshot.itens || []),
    pedidos,
  };
}

function buildPedidos(snapshot) {
  const itens = snapshot.itens || [];
  const componentes = snapshot.componentes || [];
  return (snapshot.pedidos || []).map((pedido) => buildPedidoContrato(pedido, itens, componentes));
}

function buildClaimsState(snapshot) {
  const imports = Array.isArray(snapshot?.imports) && snapshot.imports.length
    ? snapshot.imports
    : snapshot?.importacao
      ? [snapshot.importacao]
      : [];
  const apiImports = imports.filter((importacao) => (importacao.fonte || "orders_api") === "orders_api");
  const indisponiveis = apiImports
    .map((importacao) => jsonValue(importacao.resumo_json, {}))
    // Imports API legados não registravam a verificação. Até uma nova
    // sincronização, a ausência desse sinal também é tratada honestamente como
    // pós-venda não verificado.
    .filter((resumo) => resumo.claimsIndisponivel !== false);

  const resumos = apiImports.map((importacao) => jsonValue(importacao.resumo_json, {}));
  const returnsNaoResolvidos = resumos.reduce(
    (sum, resumo) => sum + (Number(resumo.claimsReturnsNaoResolvidos) || 0),
    0
  );

  return {
    claimsIndisponivel: indisponiveis.length > 0,
    claimsMotivo: indisponiveis.find((resumo) => resumo.claimsMotivo)?.claimsMotivo
      || (indisponiveis.length ? "nao_verificado" : null),
    // Devoluções cujo pedido não pôde ser resolvido: o pós-venda foi consultado,
    // mas ficou incompleto. Não é o mesmo que "indisponível", e também não pode
    // ser lido como "sem devolução".
    claimsReturnsNaoResolvidos: returnsNaoResolvidos,
  };
}

// M3, seção 44 — honestidade do GET: quando o snapshot veio de um sync_run
// com fonte obrigatória incompleta, o motor nunca pode apresentar
// confianca=confiavel/podeConcluir=true. Só aplica a gate quando o import
// carrega o sinal (completenessStatus em resumo_json, gravado pelo M3) —
// imports legados/planilha sem esse campo seguem exatamente a regra
// anterior (claimsState/temBloqueado), sem regressão de texto.
function buildCompletenessState(snapshot) {
  const imports = Array.isArray(snapshot?.imports) && snapshot.imports.length
    ? snapshot.imports
    : snapshot?.importacao
      ? [snapshot.importacao]
      : [];
  const resumos = imports
    .map((importacao) => jsonValue(importacao.resumo_json, {}))
    .filter((resumo) => resumo && typeof resumo.completenessStatus === "string");

  if (!resumos.length) return { hasSignal: false, completenessStatus: null, incompleteSources: [] };

  const statuses = resumos.map((resumo) => resumo.completenessStatus);
  const incompleteSources = [...new Set(
    resumos.flatMap((resumo) => (Array.isArray(resumo.incompleteSources) ? resumo.incompleteSources : []))
  )];

  let completenessStatus = "complete";
  if (statuses.includes("failed")) completenessStatus = "failed";
  else if (statuses.includes("partial")) completenessStatus = "partial";
  else if (statuses.some((status) => status !== "complete")) completenessStatus = "unknown";

  return { hasSignal: true, completenessStatus, incompleteSources };
}

function buildResumoFromRange(resumoBase, pedidos) {
  const validos = pedidos.filter(pedidoEntraNoResultado);
  const comResultado = validos.filter((pedido) => pedido.resultado !== null && pedido.resultado !== undefined);
  const faturamento = round2(validos.reduce((sum, pedido) => sum + Number(pedido.valor || 0), 0));
  const lucroContribuicao = comResultado.length
    ? round2(comResultado.reduce((sum, pedido) => sum + Number(pedido.resultado || 0), 0))
    : null;
  const receitaConfiavel = round2(
    validos.filter((pedido) => pedido.confianca === "confiavel")
      .reduce((sum, pedido) => sum + Number(pedido.valor || 0), 0)
  );
  const receitaParcial = round2(
    validos.filter((pedido) => pedido.confianca === "parcial")
      .reduce((sum, pedido) => sum + Number(pedido.valor || 0), 0)
  );
  const receitaBloqueada = round2(
    validos.filter((pedido) => pedido.confianca === "bloqueado")
      .reduce((sum, pedido) => sum + Number(pedido.valor || 0), 0)
  );

  const totaisPorTipo = {};
  for (const tipo of TIPOS_COMPONENTE) {
    totaisPorTipo[tipo] = round2(
      validos.flatMap((pedido) => pedido.componentes || [])
        .filter((component) => component.tipo === tipo && component.valor !== null)
        .reduce((sum, component) => sum + Number(component.valor || 0), 0)
    );
  }

  // M9 — agregados que Portal/fechamentos-api.js antes recalculava localmente
  // sobre `payload.pedidos` inteiro (buildFechamentoResumo/
  // buildFechamentoComponentes/buildFechamentoQualidade, removidas do
  // frontend nesse marco). Nenhuma fórmula nova: soma direta de campos já
  // canônicos do pedido (M5/M6), com a MESMA honestidade de ausência —
  // campo null em TODOS os pedidos válidos permanece null aqui, nunca vira
  // 0 escondendo ausência.
  const unidades = validos.reduce((sum, pedido) => sum + Number(pedido.unidades || 0), 0);
  const ticket = validos.length ? round2(faturamento / validos.length) : null;
  // Cancelados/problemas exclui devolução para não contar a mesma linha em
  // dois cartões (devolução já tem contagem própria por posVendaTipo,
  // acima) — mesma regra que a tela aplicava localmente.
  const cancelados = pedidos.filter((pedido) => pedido.status === "cancelado" && pedido.posVendaTipo !== "devolucao").length;
  const problemas = pedidos.filter((pedido) => pedido.status === "com_problema" && pedido.posVendaTipo !== "devolucao").length;
  // Contagem dos chips rápidos da aba Pedidos (Portal/fechamentos-api.js) —
  // mesmo predicado de sempre (pedido.full), sobre TODOS os pedidos (não só
  // válidos), igual ao recorte "cancel_problema" já existente.
  const full = pedidos.filter((pedido) => pedido.full === true).length;
  const normal = pedidos.filter((pedido) => pedido.full !== true).length;

  // Gate pela mesma base do Resultado Parcial (comResultado), não por
  // `validos` inteiro: o motor (M5) trata frete/tarifa/imposto ausentes
  // como efeito zero DENTRO do resultado de um pedido calculável (custo é o
  // único bloqueador — vira `bloqueado`/resultado null). Somar
  // comissão/custo/imposto/frete sobre `validos` incluiria um pedido
  // bloqueado que por acaso já tem tarifa/frete persistidos, e a soma das
  // linhas da Composição deixaria de bater com o Resultado Parcial exibido
  // (resíduo != 0) — auditado em
  // server/tests/centralVendasClaimsPosVenda.test.js, seção 17.
  const somaCampoSeTiver = (campo) => {
    const comDado = comResultado.filter((pedido) => pedido[campo] !== null && pedido[campo] !== undefined);
    return {
      valor: comDado.length ? round2(comDado.reduce((sum, pedido) => sum + Number(pedido[campo] || 0), 0)) : null,
      count: comDado.length,
    };
  };
  const comissaoAgg = somaCampoSeTiver("taxas");
  const custoAgg = somaCampoSeTiver("custo");
  const impostoAgg = somaCampoSeTiver("imposto");
  const freteAgg = somaCampoSeTiver("frete");

  // Cobertura: qual % da receita válida cada total agregado representa —
  // necessário porque faturamento soma TODOS os pedidos válidos, enquanto
  // comissão/custo/imposto/frete/resultado só somam os calculáveis (mesma
  // base de `somaCampoSeTiver` acima — nunca `validos` inteiro, pelo motivo
  // já explicado).
  const coberturaDoCampo = (campo) => {
    const comDado = comResultado.filter((pedido) => pedido[campo] !== null && pedido[campo] !== undefined);
    if (!comDado.length || faturamento <= 0) return null;
    const soma = round2(comDado.reduce((sum, pedido) => sum + Number(pedido.valor || 0), 0));
    return round2((soma / faturamento) * 100);
  };
  const cobertura = {
    comissao: coberturaDoCampo("taxas"),
    custo: coberturaDoCampo("custo"),
    imposto: coberturaDoCampo("imposto"),
    frete: coberturaDoCampo("frete"),
    resultado: coberturaDoCampo("resultado"),
  };
  // semCusto/semFrete (Qualidade do fechamento) contam sobre TODOS os
  // pedidos válidos, não só os calculáveis — é exatamente por causa desses
  // pedidos (custo/frete ausente) que eles ficam bloqueados/parciais.
  const semCusto = validos.filter((pedido) => pedido.mlb && pedido.custoStatus === "ausente").length;
  const semFrete = validos.filter((pedido) => pedido.frete === null || pedido.frete === undefined).length;

  // Confiança do FECHAMENTO deste recorte (distinta de `resumo.confianca`,
  // que é sempre do snapshot/claims global) — mesma regra de 3 estados que
  // a tela aplicava localmente: sem pedido válido ou sem nenhum resultado
  // calculável é "insuficiente" (não "confiável" por omissão); todos os
  // pedidos válidos com resultado real é "confiavel"; qualquer parcial
  // rebaixa para "parcial". O ajuste por claims indisponível (global) é
  // aplicado por quem chama esta função, que já tem esse sinal à mão.
  const confiancaFechamento = !validos.length || !comResultado.length
    ? "insuficiente"
    : validos.every((pedido) => pedido.confianca === "confiavel")
      ? "confiavel"
      : "parcial";

  return {
    ...resumoBase,
    pedidosTotal: pedidos.length,
    pedidosValidos: validos.length,
    pedidosForaResultado: pedidos.length - validos.length,
    claimsEncontrados: pedidos.filter((pedido) => (pedido.claimIds || []).length > 0).length,
    devolucoes: pedidos.filter((pedido) => pedido.posVendaTipo === "devolucao").length,
    devolucoesParciais: pedidos.filter((pedido) => pedido.posVendaTipo === "devolucao_parcial").length,
    mediacoes: pedidos.filter((pedido) => pedido.posVendaTipo === "mediacao").length,
    pedidosComReembolso: pedidos.filter((pedido) => pedido.reembolso !== null).length,
    pedidosConfiaveis: validos.filter((pedido) => pedido.confianca === "confiavel").length,
    pedidosParciais: validos.filter((pedido) => pedido.confianca === "parcial").length,
    pedidosBloqueados: validos.filter((pedido) => pedido.confianca === "bloqueado").length,
    faturamento,
    faturamentoComCusto: round2(
      validos.filter((pedido) => pedido.custo !== null)
        .reduce((sum, pedido) => sum + Number(pedido.valor || 0), 0)
    ),
    lucroContribuicao,
    margemContribuicaoPercentual:
      lucroContribuicao !== null && faturamento > 0
        ? round2((lucroContribuicao / faturamento) * 100)
        : null,
    receitaConfiavel,
    receitaParcial,
    receitaBloqueada,
    totaisPorTipo,
    // M9 — ver comentário acima.
    unidades,
    ticket,
    cancelados,
    problemas,
    full,
    normal,
    comissao: comissaoAgg.valor,
    custoTotal: custoAgg.valor,
    impostoTotal: impostoAgg.valor,
    freteTotal: freteAgg.valor,
    cobertura,
    semCusto,
    semFrete,
    pctFatBloqueado: faturamento > 0 ? round2((receitaBloqueada / faturamento) * 100) : null,
    confiancaFechamento,
  };
}

// M9 — agregado diário puro (D): soma os mesmos campos já canônicos do
// pedido (M5/M6) por data, sem recalcular nada. Substitui o par
// buildFechamentoPorDia/buildDailySales que existia no frontend por UM
// único contrato, período inteiro, independente de página/filtro da tabela
// de pedidos (zero dias — calendário completo — fica a cargo do frontend,
// que já sabia preencher os dias sem pedido a partir de `periodo`).
function buildDiario(pedidos) {
  const map = new Map();
  for (const pedido of pedidos || []) {
    if (!pedido.data) continue;
    if (!map.has(pedido.data)) {
      map.set(pedido.data, {
        data: pedido.data, pedidos: 0, unidades: 0, faturamento: 0,
        comissao: 0, custo: 0, imposto: 0, receitaBloqueada: 0,
        cancelProblema: 0, semFrete: 0, semCusto: 0,
        _comissao: false, _custo: false, _imposto: false,
        _produtos: new Set(), _topMap: new Map(),
      });
    }
    const dia = map.get(pedido.data);
    const valido = pedidoEntraNoResultado(pedido);
    dia.pedidos += 1;
    if (valido) {
      dia.faturamento += Number(pedido.valor || 0);
      dia.unidades += Number(pedido.unidades || 0);
      if (pedido.mlb) {
        dia._produtos.add(pedido.mlb);
        const atual = dia._topMap.get(pedido.mlb) || { valor: 0, titulo: pedido.produto?.titulo || pedido.mlb };
        atual.valor += Number(pedido.valor || 0);
        dia._topMap.set(pedido.mlb, atual);
      }
      if (pedido.taxas !== null && pedido.taxas !== undefined) { dia.comissao += Number(pedido.taxas); dia._comissao = true; }
      if (pedido.custo !== null && pedido.custo !== undefined) { dia.custo += Number(pedido.custo); dia._custo = true; }
      if (pedido.imposto !== null && pedido.imposto !== undefined) { dia.imposto += Number(pedido.imposto); dia._imposto = true; }
      if (pedido.frete === null || pedido.frete === undefined) dia.semFrete += 1;
      if (pedido.mlb && pedido.custoStatus === "ausente") dia.semCusto += 1;
    }
    if (pedido.confianca === "bloqueado" && valido) dia.receitaBloqueada += Number(pedido.valor || 0);
    if (pedido.status === "cancelado" || pedido.status === "com_problema") dia.cancelProblema += 1;
  }

  return [...map.values()]
    .map((dia) => {
      let top = null;
      for (const [mlb, info] of dia._topMap) {
        if (!top || info.valor > top.valor) top = { mlb, titulo: info.titulo, valor: info.valor };
      }
      return {
        data: dia.data,
        pedidos: dia.pedidos,
        unidades: dia.unidades,
        faturamento: round2(dia.faturamento),
        comissao: dia._comissao ? round2(dia.comissao) : null,
        custo: dia._custo ? round2(dia.custo) : null,
        imposto: dia._imposto ? round2(dia.imposto) : null,
        receitaBloqueada: round2(dia.receitaBloqueada),
        cancelProblema: dia.cancelProblema,
        semFrete: dia.semFrete,
        semCusto: dia.semCusto,
        produtos: dia._produtos.size,
        topProduto: top ? { mlb: top.mlb, titulo: top.titulo, faturamento: round2(top.valor) } : null,
      };
    })
    .sort((a, b) => a.data.localeCompare(b.data));
}

// M9 — Curva ABC agregada por produto (D): soma os mesmos campos já
// canônicos do pedido por MLB, período inteiro (nunca por página da tabela
// de pedidos). Substitui aggByProduct/buildCurvaAbcRows que existiam no
// frontend — mesma classificação A (até 80% acumulado) / B (até 95%) / C
// (resto), portada sem alteração. `produtosCatalogo` é o mesmo dicionário
// já produzido por buildProdutos (base/custo por MLB) — custoUnit lê o
// catálogo, nunca divide o total do pedido (um pedido multi-item some
// custos de produtos diferentes; dividir por unidades daria um custo
// unitário errado para o MLB representante da linha — ver M7, seção 10).
function buildAbcProdutos(pedidos, produtosCatalogo = {}) {
  const map = new Map();
  for (const pedido of pedidos || []) {
    const key = pedido.mlb || "__SEM_PRODUTO__";
    if (!map.has(key)) {
      const catalogo = pedido.mlb ? produtosCatalogo[pedido.mlb] : null;
      const temCusto = catalogo?.base?.temCusto === true;
      map.set(key, {
        mlb: pedido.mlb, sku: pedido.sku, titulo: pedido.produto?.titulo || pedido.mlb,
        semProduto: !pedido.mlb,
        temCusto,
        custoUnit: temCusto ? catalogo.base.custo : null,
        unidades: 0, pedidos: 0, faturamento: 0, receitaBloqueada: 0, comissao: 0,
        fullPedidos: 0, normalPedidos: 0,
      });
    }
    const produto = map.get(key);
    const valido = pedidoEntraNoResultado(pedido);
    produto.pedidos += 1;
    if (valido) {
      produto.unidades += Number(pedido.unidades || 0);
      produto.faturamento += Number(pedido.valor || 0);
      produto.comissao += Number(pedido.taxas || 0);
    }
    if (pedido.confianca === "bloqueado" && valido) produto.receitaBloqueada += Number(pedido.valor || 0);
    if (pedido.full === true) produto.fullPedidos += 1;
    else produto.normalPedidos += 1;
  }

  const all = [...map.values()].map((p) => {
    const faturamento = round2(p.faturamento);
    return {
      mlb: p.mlb, sku: p.sku, titulo: p.titulo, semProduto: p.semProduto,
      temCusto: p.temCusto, custoUnit: p.custoUnit,
      unidades: p.unidades, pedidos: p.pedidos, faturamento,
      receitaBloqueada: round2(p.receitaBloqueada),
      comissao: round2(p.comissao),
      ticketMedio: p.pedidos > 0 ? round2(faturamento / p.pedidos) : null,
      logisticaTipo: p.fullPedidos > 0 && p.normalPedidos > 0 ? "misto"
        : p.fullPedidos > 0 ? "full" : p.normalPedidos > 0 ? "normal" : null,
    };
  });

  const totalFat = round2(all.reduce((sum, p) => sum + p.faturamento, 0));
  all.forEach((p) => { p.pctFat = totalFat > 0 ? round2((p.faturamento / totalFat) * 100) : null; });

  const porFaturamento = all.slice().sort((a, b) => b.faturamento - a.faturamento);
  let acumulado = 0;
  for (const p of porFaturamento) {
    const anterior = acumulado;
    acumulado = round2(acumulado + (p.pctFat || 0));
    p.acumPctFat = acumulado;
    p.curva = p.faturamento <= 0 ? null : (anterior < 80 ? "A" : anterior < 95 ? "B" : "C");
  }

  return { produtos: all, totalFat };
}

// Payload por INTERVALO de datas (período de análise). Pode unir vários meses.
function buildPayloadFromRange(cliente, range, snapshot) {
  const periodo = periodoFromRange(range.dateFrom, range.dateTo);

  // M4, seção 8: `snapshot === null` é "nenhum import encontrado para este
  // período" (getCentralVendasByRange devolve null quando nenhuma linha
  // published/legacy cobre o range) — isso sim é "nunca sincronizado".
  // `snapshot` existente com `pedidos: []` é outra coisa: um import REAL foi
  // encontrado (ex.: Orders 0/0, run completed/candidate publicado) e
  // simplesmente não há pedido nesse período — um resultado verificado, não
  // a ausência de sincronização. Cai no corpo normal abaixo, que já tolera
  // pedidos vazios (buildPedidos([]) = [], somas em 0).
  if (!snapshot) {
    return {
      ok: true,
      fonte: "central_vendas_db",
      cliente,
      periodo,
      motor: {
        status: "sem_dados",
        etapaAtual: "aguardando_sincronizacao",
        progresso: 0,
        confianca: "ausente",
        podeConcluir: false,
        motivoBloqueio: "Nenhum pedido sincronizado para este periodo.",
        geradoEm: null,
        origemPrincipal: "orders_api",
      },
      adsPorProdutoDisponivel: false,
      adsMensal: { investimento: null, status: "ausente" },
      resumo: {
        pedidosTotal: 0,
        faturamento: 0,
        receitaBloqueada: 0,
        lucroContribuicao: null,
        margemContribuicaoPercentual: null,
        totaisPorTipo: {},
      },
      produtos: {},
      pedidos: [],
    };
  }

  const pedidos = buildPedidos(snapshot);
  const pedidosValidos = pedidos.filter(pedidoEntraNoResultado);
  const temBloqueado = pedidosValidos.some((pedido) => pedido.confianca === "bloqueado");
  const claimsState = buildClaimsState(snapshot);
  const completenessState = buildCompletenessState(snapshot);
  const completudeIncompleta = completenessState.hasSignal && completenessState.completenessStatus !== "complete";
  const geradoEm = snapshot.importacao?.created_at || null;
  const resumo = {
    ...buildResumoFromRange(jsonValue(snapshot.importacao?.resumo_json, {}), pedidos),
    ...claimsState,
    claimsVerificados: !claimsState.claimsIndisponivel,
    // M4, seção 8: zero pedidos válidos verificados (Orders 0/0) é
    // "confiavel", não "ausente" — "ausente" já é usado acima para "nenhum
    // snapshot encontrado"; aqui o snapshot existe e foi consultado.
    confianca: claimsState.claimsIndisponivel || claimsState.claimsReturnsNaoResolvidos > 0 || completudeIncompleta
      ? "parcial"
      : (temBloqueado ? "parcial" : "confiavel"),
  };
  const motivosBloqueio = [];
  if (temBloqueado) motivosBloqueio.push("Ha pedidos bloqueados por custo/produto ausente.");
  if (claimsState.claimsIndisponivel) motivosBloqueio.push("A verificacao de pos-venda (claims) nao foi concluida.");
  if (claimsState.claimsReturnsNaoResolvidos > 0) {
    motivosBloqueio.push(
      `${claimsState.claimsReturnsNaoResolvidos} devolucao(oes) sem pedido resolvido no detalhe de returns.`
    );
  }
  if (completudeIncompleta) {
    motivosBloqueio.push(`Coleta incompleta: ${completenessState.incompleteSources.join(", ") || "fonte nao verificada"}.`);
  }

  return {
    ok: true,
    fonte: "central_vendas_db",
    cliente,
    periodo,
    motor: {
      status: "persistido",
      etapaAtual: "importacao_persistida",
      progresso: 100,
      confianca: resumo.confianca,
      podeConcluir: !temBloqueado && !claimsState.claimsIndisponivel
        && claimsState.claimsReturnsNaoResolvidos === 0 && !completudeIncompleta,
      motivoBloqueio: motivosBloqueio.length ? motivosBloqueio.join(" ") : null,
      geradoEm: geradoEm instanceof Date ? geradoEm.toISOString() : geradoEm,
      origemPrincipal: snapshot.importacao?.fonte || "orders_api",
      importId: snapshot.importacao?.id,
    },
    adsPorProdutoDisponivel: false,
    adsMensal: { investimento: null, status: "ausente" },
    resumo,
    completude: completenessState.hasSignal
      ? { status: completenessState.completenessStatus, fontesIncompletas: completenessState.incompleteSources }
      : null,
    produtos: buildProdutos(snapshot.itens || []),
    pedidos,
  };
}

function buildContextoPayload(context) {
  if (!context) return null;
  return {
    conta: context.conta,
    externalAccountId: context.mlUserId,
    baseResolutionMode: context.base?.resolvido_por || null,
    baseId: context.base?.base_id || null,
  };
}

function createCentralVendasService(repository = getRepository(), db = pool) {
  // M7 — resolução de identidade + snapshot por INTERVALO, extraída de
  // getCentralVendas sem mudar nenhum comportamento (mesma ordem de
  // validações, mesma query de includeLegacy, mesma chamada ao
  // repository). Único ponto de seleção do snapshot por range: getCentralVendas
  // (GET legado) e centralVendasReadService (M7) chamam ESTA função — nunca
  // uma segunda implementação paralela da regra do M4.
  async function resolveRangeContext(clienteSlug, { dateFrom, dateTo, marketplace = "meli", clienteContaId = null } = {}) {
    const slug = normalizeSlug(clienteSlug);
    const marketplaceNorm = String(marketplace || "meli").trim().toLowerCase();

    if (!slug) {
      const err = new Error("slug e obrigatorio.");
      err.statusCode = 400;
      throw err;
    }
    if (!isValidIsoDate(dateFrom) || !isValidIsoDate(dateTo)) {
      const err = new Error("dateFrom e dateTo (YYYY-MM-DD) sao obrigatorios.");
      err.statusCode = 400;
      throw err;
    }

    const cliente = await repository.getClienteBySlug(slug);
    if (!cliente) {
      const err = new Error("Cliente nao encontrado.");
      err.statusCode = 404;
      throw err;
    }

    // Mesma regra de identidade do sync, aplicada também na leitura: nunca
    // deixar a tela abrir um fechamento sem saber de qual conta ele é,
    // quando existe ambiguidade real (2+ contas ML ativas). Sem grant
    // obrigatório aqui — GET é leitura, não dispara chamada ao Mercado Livre.
    let context = null;
    if (marketplaceNorm === "meli") {
      context = await resolveMarketplaceAccountContext({
        clienteId: cliente.id,
        marketplace: marketplaceNorm,
        clienteContaId,
        requireUsableGrant: false,
        queryable: db,
      });
    }

    // P0 do hardening M1/M2: a leitura precisa ser escopada pela MESMA conta
    // que o resolver validou — nunca só cliente_slug+marketplace (isso
    // permitia ler o snapshot mais recente de OUTRA conta do mesmo
    // cliente). includeLegacy só libera snapshot com cliente_conta_id NULL
    // quando essa conta é comprovadamente a única ativa daquele marketplace
    // (nunca com 2+ contas ativas — ver centralVendasRepository).
    const contaIdResolvida = context?.conta?.id || null;
    let includeLegacy = true;
    if (contaIdResolvida) {
      const totalAtivasResult = await db.query(
        "SELECT COUNT(*)::int AS total FROM cliente_contas WHERE cliente_id = $1 AND marketplace = $2 AND ativo = true",
        [cliente.id, marketplaceNorm]
      );
      includeLegacy = (totalAtivasResult.rows[0]?.total || 0) <= 1;
    }

    const from = dateFrom <= dateTo ? dateFrom : dateTo;
    const to = dateFrom <= dateTo ? dateTo : dateFrom;
    const snapshot = await repository.getCentralVendasByRange({
      clienteSlug: slug,
      dateFrom: from,
      dateTo: to,
      marketplace: marketplaceNorm,
      clienteContaId: contaIdResolvida,
      includeLegacy,
    });

    return { cliente, context, snapshot, dateFrom: from, dateTo: to, marketplace: marketplaceNorm };
  }

  async function getCentralVendas(clienteSlug, { competencia, dateFrom, dateTo, marketplace = "meli", clienteContaId = null } = {}) {
    // Novo: periodo de analise por intervalo de datas (pode cruzar meses).
    if (isValidIsoDate(dateFrom) && isValidIsoDate(dateTo)) {
      const { cliente, context, snapshot, dateFrom: from, dateTo: to } =
        await resolveRangeContext(clienteSlug, { dateFrom, dateTo, marketplace, clienteContaId });
      const payload = buildPayloadFromRange(cliente, { dateFrom: from, dateTo: to }, snapshot);
      payload.contexto = buildContextoPayload(context);
      return payload;
    }

    const slug = normalizeSlug(clienteSlug);
    const marketplaceNorm = String(marketplace || "meli").trim().toLowerCase();

    if (!slug) {
      const err = new Error("slug e obrigatorio.");
      err.statusCode = 400;
      throw err;
    }

    const cliente = await repository.getClienteBySlug(slug);
    if (!cliente) {
      const err = new Error("Cliente nao encontrado.");
      err.statusCode = 404;
      throw err;
    }

    let context = null;
    if (marketplaceNorm === "meli") {
      context = await resolveMarketplaceAccountContext({
        clienteId: cliente.id,
        marketplace: marketplaceNorm,
        clienteContaId,
        requireUsableGrant: false,
        queryable: db,
      });
    }

    const contaIdResolvida = context?.conta?.id || null;
    let includeLegacy = true;
    if (contaIdResolvida) {
      const totalAtivasResult = await db.query(
        "SELECT COUNT(*)::int AS total FROM cliente_contas WHERE cliente_id = $1 AND marketplace = $2 AND ativo = true",
        [cliente.id, marketplaceNorm]
      );
      includeLegacy = (totalAtivasResult.rows[0]?.total || 0) <= 1;
    }

    // Legado: por competencia (mes unico).
    const competenciaNorm = normalizeCompetencia(competencia);
    const snapshot = await repository.getLatestCentralVendasImport({
      clienteSlug: slug,
      competencia: competenciaNorm,
      marketplace: marketplaceNorm,
      clienteContaId: contaIdResolvida,
      includeLegacy,
    });

    const payload = buildPayloadFromSnapshot(cliente, competenciaNorm, snapshot);
    payload.contexto = buildContextoPayload(context);
    return payload;
  }

  return {
    getCentralVendas,
    resolveRangeContext,
  };
}

module.exports = {
  getCentralVendas: (...args) => createCentralVendasService().getCentralVendas(...args),
  createCentralVendasService,
  buildPayloadFromSnapshot,
  // Consumido pela Cliente 360 (cliente360FechamentoAdapter) para ler o
  // fechamento por intervalo de datas sem duplicar o contrato de pedido.
  buildPayloadFromRange,
  buildPedidos,
  buildContextoPayload,
  buildResumoFromRange,
  buildDiario,
  buildAbcProdutos,
  periodoFromRange,
  STATUS_FORA_DO_RESULTADO,
  TIPOS_COMPONENTE,
  normalizePedidoStatus,
  pedidoEntraNoResultado,
  periodoFromCompetencia,
};
