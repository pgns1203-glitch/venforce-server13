// server/services/motorMargem/margemSimularService.js
// POST /api/margem/simular — "e se este anúncio custasse P'?" para um MLB de
// uma conta, em vários cenários de uma vez.
//
// Uma fórmula só: o cálculo é o `core.calcularCenario` (que usa o
// computeMargin do Motor). Este serviço só monta as ENTRADAS, cada uma com
// fonte e data:
//   composição de hoje ... Margin Snapshot da conta (a mesma linha da tabela)
//                          + retorno ML da promoção em andamento (a mesma
//                          correção de leitura da tabela: margemAtualRebate)
//   promoções ............ Promo Snapshot da conta (P' = preço final do ML,
//                          retorno ML = subsídio, status bruto)
//   comissão'/frete' ..... cotação REAL em P' (listing_prices / shipping
//                          free), uma por (MLB, P') por requisição
//   alíquota/custo/taxa .. do snapshot (Base)
// Cotação indisponível ⇒ `bloqueado` com motivo; NUNCA cai na taxa ou no
// frete atuais. Somente leitura: nada é escrito no Mercado Livre nem na Base.
//
// Escopo: usuário → cliente → cliente_conta_id → seller. A conta tem de estar
// na carteira do usuário (403) e o MLB tem de ser do seller dessa conta (403).

const pool = require("../../config/database");
const core = require("./core");
const { criarCotadorEmP } = require("./margemCotacaoEmP");
const { carregarRebatesAtivos, margemAtualComRebate, MOTIVO_REBATE } = require("./margemAtualRebate");

const MAX_CENARIOS = 20;
const MAX_PROMOS_POR_ITEM = 60;
const MAX_COTACOES_POR_REQUISICAO = 40;
const TIPOS = new Set(["preco", "promo", "todas_promos", "insumos"]);
const CAMPOS_INSUMOS = ["preco", "custo", "aliquota", "taxa_fixa", "comissao", "frete", "rebate"];

function erroHttp(statusCode, codigo, motivo, extra = {}) {
  const err = new Error(motivo);
  err.statusCode = statusCode;
  err.code = codigo;
  err.payload = { ok: false, codigo, code: codigo, erro: motivo, motivo, ...extra };
  return err;
}

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function iso(valor) {
  if (!valor) return null;
  const d = valor instanceof Date ? valor : new Date(valor);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function defaults(deps = {}) {
  return {
    db: deps.db || pool,
    now: deps.now || (() => new Date()),
    logger: deps.logger || console,
    env: deps.env || process.env,
    assertContaNaCarteira:
      deps.assertContaNaCarteira || require("../squads/authorizationService").assertClienteContaNaCarteira,
    obterConta: deps.obterConta || require("../clienteContas/clienteContaService").obterConta,
    snapshotRepo: deps.snapshotRepo || require("./marginSnapshotRepository"),
    obterAnuncio: deps.obterAnuncio || ((clienteId, itemId) => require("../meliAnuncios/meliAnunciosService").obterAnuncio(clienteId, itemId)),
    promoService: deps.promoService || require("../promoSnapshot/promoSnapshotService"),
    promoRepo: deps.promoRepo || require("../promoSnapshot/promoSnapshotRepository"),
    buscarComissaoEFrete: deps.buscarComissaoEFrete || require("../shared/marketplaceCurrentQuoteService").buscarComissaoEFrete,
    mlFetch: deps.mlFetch || require("../../utils/mlClient").mlFetch,
    carregarRebates: deps.carregarRebates || carregarRebatesAtivos,
  };
}

// ─── Validação do corpo (400 explícito: nada é ignorado em silêncio) ─────────

function parseInteiroPositivo(bruto) {
  if (bruto === null || bruto === undefined || String(bruto).trim() === "") return null;
  const n = Number(bruto);
  return Number.isInteger(n) && n > 0 ? n : NaN;
}

// Preço digitado: número > 0 com no máximo 2 casas. Nunca arredonda em
// silêncio ("114,999" é recusado, não vira 115,00).
function validarPrecoCenario(bruto, indice) {
  if (bruto === null || bruto === undefined || bruto === "") {
    throw erroHttp(400, "PRECO_AUSENTE", `cenarios[${indice}].preco é obrigatório.`);
  }
  const texto = String(bruto).trim().replace(",", ".");
  const n = Number(texto);
  if (!Number.isFinite(n) || n <= 0) {
    throw erroHttp(400, "PRECO_INVALIDO", `cenarios[${indice}].preco precisa ser um número maior que zero.`);
  }
  if (!/^\d+(\.\d{1,2})?$/.test(texto)) {
    throw erroHttp(400, "PRECO_CASAS_DECIMAIS", `cenarios[${indice}].preco aceita no máximo duas casas decimais.`);
  }
  return core.round2(n);
}

function validarInsumos(bruto, indice) {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) {
    throw erroHttp(400, "INSUMOS_INVALIDOS", `cenarios[${indice}].insumos precisa ser um objeto.`);
  }
  const saida = {};
  for (const campo of Object.keys(bruto)) {
    if (!CAMPOS_INSUMOS.includes(campo)) {
      throw erroHttp(400, "INSUMOS_CAMPO_DESCONHECIDO", `cenarios[${indice}].insumos.${campo} não é um insumo aceito (${CAMPOS_INSUMOS.join(", ")}).`);
    }
    const valor = bruto[campo];
    if (valor === null) { saida[campo] = null; continue; }
    const n = typeof valor === "string" ? Number(valor.trim().replace(",", ".")) : Number(valor);
    if (valor === "" || !Number.isFinite(n)) {
      throw erroHttp(400, "INSUMOS_VALOR_INVALIDO", `cenarios[${indice}].insumos.${campo} precisa ser um número (ou null).`);
    }
    saida[campo] = n;
  }
  return saida;
}

function validarCorpo(body) {
  const b = body && typeof body === "object" ? body : {};
  const contaId = parseInteiroPositivo(b.cliente_conta_id ?? b.clienteContaId);
  if (contaId === null) throw erroHttp(400, "CLIENTE_CONTA_ID_OBRIGATORIO", "cliente_conta_id é obrigatório: a simulação é sempre por conta.");
  if (Number.isNaN(contaId)) throw erroHttp(400, "CLIENTE_CONTA_ID_INVALIDO", "cliente_conta_id inválido.");

  const mlb = String(b.mlb || "").trim().toUpperCase();
  if (!/^MLB\d+$/.test(mlb)) throw erroHttp(400, "MLB_INVALIDO", "Informe um anúncio (MLB) válido.");

  if (!Array.isArray(b.cenarios) || b.cenarios.length === 0) {
    throw erroHttp(400, "CENARIOS_OBRIGATORIOS", "Informe ao menos um cenário em `cenarios`.");
  }
  if (b.cenarios.length > MAX_CENARIOS) {
    throw erroHttp(400, "CENARIOS_DEMAIS", `No máximo ${MAX_CENARIOS} cenários por requisição.`, { maximo: MAX_CENARIOS });
  }

  const cenarios = b.cenarios.map((c, i) => {
    if (!c || typeof c !== "object") throw erroHttp(400, "CENARIO_INVALIDO", `cenarios[${i}] precisa ser um objeto.`);
    const tipo = String(c.tipo || "").trim().toLowerCase();
    if (!TIPOS.has(tipo)) {
      throw erroHttp(400, "CENARIO_TIPO_INVALIDO", `cenarios[${i}].tipo precisa ser: ${Array.from(TIPOS).join(", ")}.`);
    }
    if (tipo === "preco") return { tipo, preco: validarPrecoCenario(c.preco, i) };
    if (tipo === "promo") {
      const id = String(c.promotion_id ?? "").trim();
      if (!id || id.length > 160) throw erroHttp(400, "PROMOTION_ID_OBRIGATORIO", `cenarios[${i}].promotion_id é obrigatório.`);
      return { tipo, promotion_id: id };
    }
    if (tipo === "insumos") return { tipo, insumos: validarInsumos(c.insumos, i) };
    return { tipo };
  });
  return { contaId, mlb, cenarios };
}

// ─── Escopo e dados do item ──────────────────────────────────────────────────

async function autorizarConta(user, contaId, d) {
  // 404 (conta inexistente) / 403 (cliente fora da carteira) — mesmo contrato
  // do guard de carteira das demais rotas.
  const autorizada = await d.assertContaNaCarteira(user || {}, contaId, d.db);
  const conta = await d.obterConta(contaId, d.db);
  if (Number(conta.cliente_id) !== Number(autorizada.clienteId)) {
    throw erroHttp(403, "CONTA_NAO_PERTENCE_AO_CLIENTE", "Esta conta não pertence ao cliente.");
  }
  if (String(conta.marketplace || "").toLowerCase() !== "meli") {
    throw erroHttp(422, "MARKETPLACE_INCOMPATIVEL", "A simulação só atende contas Mercado Livre.");
  }
  if (conta.ativo === false) throw erroHttp(409, "CONTA_INATIVA", `A conta "${conta.nome}" foi desativada.`);
  return { autorizada, conta };
}

async function resolverEscopo(user, contaId, d) {
  const { autorizada, conta } = await autorizarConta(user, contaId, d);
  const sellerId = conta.external_account_id ? String(conta.external_account_id) : null;
  if (!sellerId) throw erroHttp(422, "CONTA_SEM_GRANT_ML", "A conta não tem conexão do Mercado Livre vinculada.");
  return {
    clienteId: Number(autorizada.clienteId),
    clienteSlug: autorizada.clienteSlug || null,
    conta: { id: Number(conta.id), nome: conta.nome || null },
    sellerId,
  };
}

async function carregarItem(escopo, mlb, d) {
  const [snapshot, anuncio] = await Promise.all([
    d.snapshotRepo.getProjectionSnapshot({ clienteContaId: escopo.conta.id, itemId: mlb, db: d.db }),
    d.obterAnuncio(escopo.clienteId, mlb),
  ]);
  const dono = anuncio && anuncio.ml_user_id ? String(anuncio.ml_user_id) : null;
  if (dono && dono !== escopo.sellerId) {
    throw erroHttp(403, "MLB_FORA_DA_CONTA", "Este anúncio não pertence ao seller da conta informada.");
  }
  if (!snapshot && !anuncio) throw erroHttp(404, "MLB_NAO_ENCONTRADO", "Anúncio não encontrado para esta conta.");
  return { snapshot, anuncio };
}

function metaDoSnapshot(snapshot) {
  const bruta = snapshot && snapshot.quality ? num(snapshot.quality.targetMargin) : null;
  if (bruta !== null && bruta > 0 && bruta < 1) return { margem_alvo: bruta, margem_minima: 0, fonte: "margin_snapshot" };
  // Meta não informada (ou inválida no snapshot): o padrão do Motor, dito como padrão.
  return { margem_alvo: core.DEFAULT_TARGET_MARGIN, margem_minima: 0, fonte: "padrao_do_motor", motivo: bruta === null ? "meta_nao_informada" : "meta_fora_da_faixa" };
}

async function carregarPromocoes(escopo, mlb, d, estado) {
  if (!estado || !estado.hasSnapshot) {
    return { disponivel: false, motivo: core.MOTIVOS.SEM_SNAPSHOT_PROMOCOES, linhas: [], estado };
  }
  const { linhas } = await d.promoRepo.listarLinhasSnapshot({
    clienteContaId: escopo.conta.id, sellerId: escopo.sellerId, runId: estado.snapshotRunId,
    page: 1, limit: MAX_PROMOS_POR_ITEM, itemId: mlb,
  }, d.db);
  return { disponivel: true, motivo: null, linhas, estado };
}

function promocaoPublica(linha) {
  return {
    id: linha.promotionId || linha.promocaoChave,
    chave: linha.promocaoChave,
    ref_id: linha.refId || null,
    tipo: linha.tipo || null,
    nome: linha.nome || null,
    status: linha.status || null,
    status_exibicao: linha.statusExibicao || null,
    inicio: iso(linha.inicio),
    fim: iso(linha.fim),
    preco_original: linha.precoOriginal,
    preco_final: linha.precoFinal,
    preco_final_fonte: linha.precoFinalFonte || null,
    desconto_percentual: linha.descontoPercentual,
    seller_percentage: linha.sellerPercentage,
    meli_percentage: linha.meliPercentage,
    subsidio_ml: linha.subsidioMl,
    elegivel: linha.elegivel === true,
    observado_em: iso(linha.observedAt),
    herdada: linha.herdada === true,
  };
}

function casaPromocao(linha, id) {
  const alvo = String(id);
  return String(linha.promocaoChave) === alvo || String(linha.promotionId || "") === alvo || String(linha.refId || "") === alvo;
}

// ─── Montagem dos cenários ───────────────────────────────────────────────────

// Cada pedido vira 1+ "tarefas" (todas_promos expande). A tarefa diz o que o
// núcleo precisa: P', retorno ML, status da promoção — ou um bloqueio que nem
// chega ao cálculo (sem Promo Snapshot, promoção inexistente).
function montarTarefas(pedidos, promocoes) {
  const tarefas = [];
  const bloqueio = (tipo, entrada, motivo, extra = {}) => tarefas.push({ tipo, entrada, bloqueio: motivo, ...extra });

  for (const pedido of pedidos) {
    if (pedido.tipo === "preco") {
      tarefas.push({ tipo: "preco", entrada: { preco: pedido.preco }, preco: pedido.preco, rebate: 0 });
    } else if (pedido.tipo === "insumos") {
      tarefas.push({ tipo: "insumos", entrada: { insumos: pedido.insumos }, insumos: pedido.insumos });
    } else if (pedido.tipo === "promo") {
      const entrada = { promotion_id: pedido.promotion_id };
      if (!promocoes.disponivel) { bloqueio("promo", entrada, core.MOTIVOS.SEM_SNAPSHOT_PROMOCOES); continue; }
      const casadas = promocoes.linhas.filter((l) => casaPromocao(l, pedido.promotion_id));
      if (casadas.length === 0) { bloqueio("promo", entrada, core.MOTIVOS.PROMOCAO_NAO_ENCONTRADA); continue; }
      if (casadas.length > 1) { bloqueio("promo", entrada, core.MOTIVOS.PROMOCAO_AMBIGUA); continue; }
      tarefas.push(tarefaDePromocao(casadas[0], entrada));
    } else {
      // todas_promos
      if (!promocoes.disponivel) { bloqueio("promo", { promotion_id: null }, core.MOTIVOS.SEM_SNAPSHOT_PROMOCOES); continue; }
      for (const linha of promocoes.linhas) tarefas.push(tarefaDePromocao(linha, { promotion_id: linha.promotionId || linha.promocaoChave, origem: "todas_promos" }));
    }
  }
  return tarefas;
}

function tarefaDePromocao(linha, entrada) {
  const subsidio = num(linha.subsidioMl);
  return {
    tipo: "promo",
    entrada,
    promocao: promocaoPublica(linha),
    preco: num(linha.precoFinal),
    // ML não informou retorno (meli_percentage ausente) = a promoção é do
    // seller; vira 0 DECLARADO na evidência, não um zero escondido.
    rebate: subsidio === null ? 0 : subsidio,
    rebate_informado: subsidio !== null,
    status_promocao: linha.status || null,
  };
}

// Promoção que o núcleo já responde sem cotação (já ativa, ou P' ≥ preço atual):
// não gasta consulta ao ML à toa.
function deveCotar(tarefa, atual) {
  if (tarefa.bloqueio || tarefa.tipo === "insumos") return false;
  if (!(tarefa.preco !== null && tarefa.preco > 0)) return false;
  if (tarefa.tipo !== "promo") return true;
  if (core.STATUS_PROMOCAO_ATIVA.includes(String(tarefa.status_promocao || "").toLowerCase())) return false;
  const precoAtual = num(atual.preco);
  return !(precoAtual !== null && tarefa.preco >= precoAtual - core.TOLERANCIA_VALOR);
}

function evidenciaCotacao(cotacao) {
  if (!cotacao) return null;
  return {
    comissao: {
      fonte: cotacao.fonte.comissao,
      consultado_em: cotacao.consultado_em,
      motivo: cotacao.comissao === null ? cotacao.motivos.comissao : null,
    },
    frete: {
      fonte: cotacao.fonte.frete,
      consultado_em: cotacao.frete_aplicavel ? cotacao.consultado_em : null,
      motivo: cotacao.frete === null && cotacao.frete_aplicavel ? cotacao.motivos.frete : null,
      aplicavel: cotacao.frete_aplicavel,
    },
  };
}

function calcularTarefa(tarefa, ctx) {
  const { atual, flags, meta, cotacoes, evidenciaBase, rebateAtual } = ctx;
  const saidaBase = { tipo: tarefa.tipo, entrada: tarefa.entrada };
  if (tarefa.promocao) saidaBase.promocao = tarefa.promocao;

  if (tarefa.bloqueio) {
    return { ...saidaBase, ...core.resultadoBloqueado(tarefa.bloqueio, { flags, meta }), evidencia: null };
  }

  if (tarefa.tipo === "insumos") {
    const ins = tarefa.insumos;
    const pick = (campo, fallback) => (Object.prototype.hasOwnProperty.call(ins, campo) ? ins[campo] : fallback);
    const resultado = core.calcularCenario({
      atual,
      cenario: {
        tipo: "insumos",
        preco: pick("preco", atual.preco),
        rebate: pick("rebate", atual.rebate),
        custo: pick("custo", atual.custo),
        aliquota: pick("aliquota", atual.aliquota),
        taxa_fixa: pick("taxa_fixa", atual.taxa_fixa),
      },
      // Hipótese do operador: comissão e frete são os informados (ou os de hoje); não há recotação.
      cotacao: { comissao: pick("comissao", atual.comissao), frete: pick("frete", atual.frete), frete_aplicavel: ctx.freteAplicavel },
      meta,
      flags,
    });
    return {
      ...saidaBase,
      ...resultado,
      evidencia: { ...evidenciaBase, preco: { fonte: "informado", consultado_em: null }, hipotese: true },
    };
  }

  const cotacao = deveCotar(tarefa, atual) ? cotacoes.get(Number(tarefa.preco).toFixed(2)) || null : null;
  const resultado = core.calcularCenario({
    atual,
    cenario: { tipo: tarefa.tipo, preco: tarefa.preco, rebate: tarefa.rebate, status_promocao: tarefa.status_promocao },
    cotacao: cotacao
      ? { comissao: cotacao.comissao, frete: cotacao.frete, frete_aplicavel: cotacao.frete_aplicavel, limite_excedido: cotacao.limite_excedido }
      : { comissao: null, frete: null, frete_aplicavel: ctx.freteAplicavel },
    meta,
    flags,
  });
  const evidencia = { ...evidenciaBase, ...(evidenciaCotacao(cotacao) || {}) };
  if (tarefa.tipo === "promo") {
    evidencia.preco = { fonte: "promo_snapshot", observado_em: tarefa.promocao.observado_em, fonte_do_preco: tarefa.promocao.preco_final_fonte };
    evidencia.rebate = {
      fonte: "promo_snapshot",
      observado_em: tarefa.promocao.observado_em,
      informado: tarefa.rebate_informado === true,
      motivo: tarefa.rebate_informado === true ? null : "ml_nao_informou_retorno",
    };
  } else {
    evidencia.preco = { fonte: "informado", consultado_em: null };
  }
  // Sem a atualidade da composição de hoje, a faixa de frete seria só uma
  // comparação sem data: ela vem sempre acompanhada de `evidencia.atual`.
  return { ...saidaBase, ...resultado, evidencia, _rebateAtual: rebateAtual };
}

/**
 * @param {{ user: object, body: object }} p
 * @param {object} [deps]
 */
async function simular({ user, body } = {}, deps = {}) {
  const d = defaults(deps);
  const pedido = validarCorpo(body);
  const escopo = await resolverEscopo(user, pedido.contaId, d);
  const { snapshot, anuncio } = await carregarItem(escopo, pedido.mlb, d);

  const agora = d.now();
  const geradoEm = agora.toISOString();
  const semSnapshot = !snapshot || Boolean(snapshot.catalogMissingSince);

  // ── Composição de hoje: a mesma da tabela (snapshot + retorno ML em andamento) ──
  let rebates = { porItem: new Map(), indisponivel: null };
  if (!semSnapshot) {
    rebates = await d.carregarRebates({
      clienteContaId: escopo.conta.id, sellerId: escopo.sellerId, itemIds: [pedido.mlb], db: d.db, promoRepo: d.promoRepo, logger: d.logger,
    });
  }
  const infoRebate = rebates.porItem.get(pedido.mlb);
  const atualRebate = semSnapshot
    ? { rebate: null, rebateMotivo: null }
    : margemAtualComRebate(snapshot, infoRebate, rebates.indisponivel);

  const cotador = criarCotadorEmP({
    clienteId: escopo.clienteId,
    itemId: pedido.mlb,
    anuncio,
    sellerId: escopo.sellerId,
    mlUserId: escopo.sellerId,
    buscarComissaoEFrete: d.buscarComissaoEFrete,
    mlFetch: d.mlFetch,
    now: d.now,
    maxCotacoes: MAX_COTACOES_POR_REQUISICAO,
    timeoutMs: deps.mlTimeoutMs || 8000,
  });

  const atual = semSnapshot
    ? { sem_snapshot: true }
    : {
        preco: snapshot.price,
        custo: snapshot.cost,
        aliquota: snapshot.taxRate,
        taxa_fixa: snapshot.fixedFee,
        comissao: snapshot.commission,
        frete: snapshot.freight,
        rebate: atualRebate.rebate === null ? 0 : atualRebate.rebate,
      };
  const meta = metaDoSnapshot(snapshot);
  const flags = {
    rebate_ambiguo: atualRebate.rebateMotivo === MOTIVO_REBATE.AMBIGUO,
    rebate_atual_indisponivel: atualRebate.rebateMotivo === MOTIVO_REBATE.PROMO_SNAPSHOT_INDISPONIVEL,
  };

  // ── Promoções (só lê o Promo Snapshot quando algum cenário precisa) ──
  const precisaPromo = pedido.cenarios.some((c) => c.tipo === "promo" || c.tipo === "todas_promos");
  // Estado do Promo Snapshot (data do snapshot): para as promoções pedidas e
  // para dar data ao retorno ML que já compõe a margem de hoje.
  const estadoPromo = precisaPromo || atualRebate.rebate !== null
    ? await d.promoService.estadoSincronizacao(
      { clienteContaId: escopo.conta.id, marketplace: "meli", sellerId: escopo.sellerId },
      { db: d.db, repo: d.promoRepo, now: d.now, env: d.env, logger: d.logger }
    )
    : null;
  const promocoes = precisaPromo
    ? await carregarPromocoes(escopo, pedido.mlb, d, estadoPromo)
    : { disponivel: null, motivo: null, linhas: [], estado: null };

  const tarefas = montarTarefas(pedido.cenarios, promocoes);

  // ── Cotação em P' — só dos preços distintos que as tarefas pedem ──
  const precosParaCotar = semSnapshot ? [] : tarefas.filter((t) => deveCotar(t, atual)).map((t) => t.preco);
  const cotacoes = await cotador.cotarVarios(precosParaCotar);

  const evidenciaBase = semSnapshot
    ? {}
    : {
        custo: { fonte: "margin_snapshot", calculado_em: iso(snapshot.calculatedAt), base_id: snapshot.baseId },
        aliquota: { fonte: "margin_snapshot", calculado_em: iso(snapshot.calculatedAt), base_id: snapshot.baseId },
        taxa_fixa: { fonte: "margin_snapshot", calculado_em: iso(snapshot.calculatedAt), base_id: snapshot.baseId },
      };

  const ctx = { atual, flags, meta, cotacoes, evidenciaBase, freteAplicavel: cotador.freteAplicavel, rebateAtual: atualRebate };
  const cenarios = tarefas.map((t) => {
    const r = calcularTarefa(t, ctx);
    delete r._rebateAtual;
    // A composição de hoje vai uma vez na raiz, não repetida em cada cenário.
    delete r.atual;
    return r;
  });

  const atualCalc = core.calcularAtual({ atual, frete_aplicavel: cotador.freteAplicavel });
  const estatisticas = cotador.estatisticas();

  return {
    ok: true,
    cliente_conta_id: escopo.conta.id,
    mlb: pedido.mlb,
    gerado_em: geradoEm,
    item: {
      titulo: (snapshot && snapshot.titulo) || (anuncio && anuncio.titulo) || null,
      sku: (snapshot && snapshot.sku) || (anuncio && anuncio.sku) || null,
    },
    atual: {
      ...atualCalc.atual,
      bloqueios: atualCalc.bloqueios,
      rebate_motivo: atualRebate.rebateMotivo || null,
      evidencia: semSnapshot
        ? { fonte: "margin_snapshot", motivo: snapshot && snapshot.catalogMissingSince ? "item_fora_do_catalogo" : core.MOTIVOS.SEM_SNAPSHOT_MARGEM }
        : {
            preco: { fonte: "margin_snapshot", calculado_em: iso(snapshot.calculatedAt) },
            comissao: { fonte: "margin_snapshot", calculado_em: iso(snapshot.calculatedAt) },
            frete: { fonte: "margin_snapshot", calculado_em: iso(snapshot.calculatedAt) },
            ...evidenciaBase,
            rebate: atualRebate.rebate !== null
              ? { fonte: "promo_snapshot", snapshot_em: iso(estadoPromo && estadoPromo.snapshotAt) }
              : { fonte: null, motivo: atualRebate.rebateMotivo || "sem_promocao_em_andamento" },
          },
    },
    meta,
    promocoes: precisaPromo
      ? {
          disponivel: promocoes.disponivel,
          motivo: promocoes.motivo,
          snapshot_em: promocoes.estado ? iso(promocoes.estado.snapshotAt) : null,
          run_id: promocoes.estado ? promocoes.estado.snapshotRunId : null,
          parcial: promocoes.estado ? promocoes.estado.partial === true : null,
        }
      : null,
    cotacoes: {
      consultas: estatisticas.chamadas,
      precos_distintos: estatisticas.precos_distintos,
      limite_excedido: estatisticas.limite_excedido,
      maximo_por_requisicao: MAX_COTACOES_POR_REQUISICAO,
    },
    cenarios,
  };
}

const MAX_ITENS_COMPOSICAO = 200;

/**
 * POST /api/margem/composicao — LC e margem de VÁRIOS jogos de insumos de uma
 * conta (a "Composição" da tabela com fontes personalizadas). Cálculo puro do
 * núcleo: nada é buscado no ML nem no banco além da autorização por carteira.
 */
async function calcularComposicoes({ user, body } = {}, deps = {}) {
  const d = defaults(deps);
  const b = body && typeof body === "object" ? body : {};
  const contaId = parseInteiroPositivo(b.cliente_conta_id ?? b.clienteContaId);
  if (contaId === null) throw erroHttp(400, "CLIENTE_CONTA_ID_OBRIGATORIO", "cliente_conta_id é obrigatório.");
  if (Number.isNaN(contaId)) throw erroHttp(400, "CLIENTE_CONTA_ID_INVALIDO", "cliente_conta_id inválido.");
  if (!Array.isArray(b.itens) || b.itens.length === 0) throw erroHttp(400, "ITENS_OBRIGATORIOS", "Informe ao menos um item em `itens`.");
  if (b.itens.length > MAX_ITENS_COMPOSICAO) {
    throw erroHttp(400, "ITENS_DEMAIS", `No máximo ${MAX_ITENS_COMPOSICAO} itens por requisição.`, { maximo: MAX_ITENS_COMPOSICAO });
  }
  const itens = b.itens.map((it, i) => {
    if (!it || typeof it !== "object") throw erroHttp(400, "ITEM_INVALIDO", `itens[${i}] precisa ser um objeto.`);
    const id = String(it.id ?? "").trim();
    if (!id || id.length > 80) throw erroHttp(400, "ITEM_ID_OBRIGATORIO", `itens[${i}].id é obrigatório.`);
    return { id, insumos: validarInsumos(it.insumos, i) };
  });
  const { conta } = await autorizarConta(user, contaId, d);
  return {
    ok: true,
    cliente_conta_id: Number(conta.id),
    itens: itens.map((it) => ({ id: it.id, ...core.calcularComposicao(it.insumos) })),
  };
}

module.exports = {
  simular,
  calcularComposicoes,
  MAX_ITENS_COMPOSICAO,
  validarCorpo,
  montarTarefas,
  MAX_CENARIOS,
  MAX_PROMOS_POR_ITEM,
  MAX_COTACOES_POR_REQUISICAO,
};
