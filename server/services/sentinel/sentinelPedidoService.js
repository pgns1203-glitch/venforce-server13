// server/services/sentinel/sentinelPedidoService.js
// Margem de UM pedido ML, fora do sync da Central, gravada em sentinel_pedidos.
//
// Reaproveita sem alterar:
//   · buildMotorFromOrders (centralVendasSyncService.js:471) — o mesmo motor
//     da Central, chamado com [order];
//   · buscarFreteShipment (centralVendasFreteService.js:130) — senders[].cost.
// Pós-venda NÃO é consultado nesta fase: claimsMap vazio e
// claims_verificado=false (nunca "sem devolução").
//
// Estado (o primeiro que se aplica):
//   erro          — exceção ao processar (mensagem em pendencias)
//   custo_ambiguo — algum item com MLB de custos divergentes sem variação que
//                   desempate (ou o mesmo MLB com custos diferentes no pedido)
//   sem_custo     — algum item sem custo utilizável na base da conta
//   provisoria    — calculada, mas com pendência (sem_frete, sem_imposto, ...)
//   confirmada    — todos os componentes reais
// custo_ambiguo/sem_custo: faturamento, comissão e frete são gravados; custo,
// imposto e margem ficam NULL (nunca margem parcial).

const crypto = require("crypto");
const { round2 } = require("../../utils/numberUtils");
const { buildMotorFromOrders } = require("../centralVendas/centralVendasSyncService");
const { createCentralVendasFreteService } = require("../centralVendas/centralVendasFreteService");
const { prepararEnvioCompartilhado, entraNoRateioEnvio } = require("../centralVendas/centralVendasEnvioCompartilhado");
const { resolverEnvio } = require("./sentinelEnvioPack");

const { carregarIndiceCusto, resolverCustoItem, montarCostMap } = require("./sentinelCusto");

// Estados que não mudam sem o ML atualizar o pedido: o skip por
// ml_date_last_updated igual só vale para eles. provisoria/erro sempre
// reprocessam.
const ESTADOS_ESTAVEIS = new Set(["confirmada", "sem_custo", "custo_ambiguo"]);

// Mesma regra de sincronizarVendasMeli (centralVendasSyncService.js:1207-1208):
// competência = mês de date_created; sem data válida, mês corrente.
function competenciaDoPedido(order, agora = new Date()) {
  const comp = String(order?.date_created || "").slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(comp)) return comp;
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;
}

function somaComponente(componentes, tipo) {
  const valores = componentes.filter((c) => c.tipo === tipo && c.itemId !== null);
  if (!valores.length || valores.some((c) => c.valor === null)) return null;
  return round2(Math.abs(valores.reduce((s, c) => s + Number(c.valor), 0)));
}

// JSON canônico (chaves ordenadas, sem undefined) → sha256. Entra: faturamento,
// comissão, frete, custo, imposto, margem, estado, pendências, itens, status_ml.
function canonico(v) {
  if (Array.isArray(v)) return `[${v.map(canonico).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort()
      .map((k) => `${JSON.stringify(k)}:${canonico(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v === undefined ? null : v);
}

function calcularPayloadHash(linha) {
  const payload = {
    faturamento: linha.faturamento ?? null,
    comissao: linha.comissao ?? null,
    frete: linha.frete ?? null,
    custo: linha.custo ?? null,
    imposto: linha.imposto ?? null,
    margem_valor: linha.margem_valor ?? null,
    margem_pct: linha.margem_pct ?? null,
    estado_margem: linha.estado_margem,
    pendencias: linha.pendencias || [],
    itens: linha.itens || [],
    status_ml: linha.status_ml ?? null,
  };
  return crypto.createHash("sha256").update(canonico(payload)).digest("hex");
}

// Pura: pedido + frete + índice de custo → linha de sentinel_pedidos.
// grupoEnvio: pedidos do MESMO shipment (inclui `order`) quando há envio compartilhado; o frete e a
// receita de envio do shipment são rateados pela função pura da Central. fretePackIncompleto: não
// foi possível conhecer todos os pedidos do pack ⇒ frete NULL (nunca o valor cheio).
function calcularPedidoSemHash({ order, freteEntry, indiceCusto, clienteSlug, coletaFreteFalhou = false, grupoEnvio = null, fretePackIncompleto = false }) {
  const pedidoId = String(order.id);
  const competencia = competenciaDoPedido(order);
  const orderItems = Array.isArray(order.order_items) ? order.order_items : [];
  const resolucoes = orderItems.map((oi) => resolverCustoItem(indiceCusto, oi));

  const pendencias = [];
  let estado = null;
  if (resolucoes.some((r) => r.estado === "custo_ambiguo")) estado = "custo_ambiguo";
  else if (!orderItems.length || resolucoes.some((r) => r.estado === "sem_custo")) estado = "sem_custo";

  let { costMap, conflitoMlb } = montarCostMap(resolucoes);
  if (conflitoMlb) {
    estado = "custo_ambiguo";
    pendencias.push("mlb_repetido_com_custos_diferentes");
    costMap = new Map();
  }

  const shipmentId = order.shipping?.id != null ? String(order.shipping.id) : null;
  const freteMap = new Map();
  if (shipmentId && freteEntry) freteMap.set(shipmentId, freteEntry);

  // POLÍTICA ÚNICA (a mesma da Central): só paid/partially_refunded têm peso; o resto = peso 0.
  const entraNoRateio = (o) => entraNoRateioEnvio(o?.status);
  const compartilhado = shipmentId && Array.isArray(grupoEnvio) && grupoEnvio.length > 1
    ? prepararEnvioCompartilhado(grupoEnvio, freteMap, { entra: entraNoRateio }).get(shipmentId) || null
    : null;
  const motor = buildMotorFromOrders({
    orders: [order],
    costMap,
    freteMap,
    claimsMap: new Map(),
    clienteSlug,
    competencia,
    ordersContexto: compartilhado ? grupoEnvio : [order],
    envioEntraNoResultado: entraNoRateio,
  });
  const pedido = motor.pedidos[0];
  const componentes = motor.componentes;

  let freteReal = freteEntry && freteEntry.status === "real" ? round2(freteEntry.valor) : null;
  if (compartilhado) {
    const parte = compartilhado.frete.get(pedidoId);
    freteReal = parte === null || parte === undefined ? null : round2(parte); // parcela do pedido, não o shipment
  }
  // "frete ainda não existe" (sem_frete) ≠ "a coleta falhou" (frete_coleta_falhou) ≠ pack sem
  // todos os pedidos conhecidos (frete_pack_incompleto).
  if (freteReal === null) {
    pendencias.push(fretePackIncompleto ? "frete_pack_incompleto" : coletaFreteFalhou ? "frete_coleta_falhou" : "sem_frete");
  }
  const comissao = somaComponente(componentes, "tarifa_venda");
  if (comissao === null) pendencias.push("sem_comissao");

  const itens = orderItems.map((oi, idx) => ({
    item_id: oi.item?.id ?? null,
    variation_id: oi.item?.variation_id ?? null,
    sku: oi.item?.seller_sku || null,
    quantidade: oi.quantity ?? null,
    preco: oi.unit_price ?? null,
    custo_unitario: resolucoes[idx].estado === "ok" ? resolucoes[idx].cost : null,
    imposto_percentual: resolucoes[idx].estado === "ok" ? resolucoes[idx].taxPercent : null,
    estado_custo: resolucoes[idx].estado,
    origem_custo: resolucoes[idx].origem,
  }));

  const base = {
    pedido_id: pedidoId,
    competencia,
    data_pedido: order.date_created || null,
    ml_date_last_updated: order.date_last_updated || null,
    status_ml: order.status || null,
    itens,
    faturamento: pedido.faturamento,
    comissao,
    frete: freteReal,
    claims_verificado: false,
  };

  if (estado) {
    return {
      ...base,
      custo: null, imposto: null, margem_valor: null, margem_pct: null,
      estado_margem: estado,
      pendencias: [...new Set([...pendencias, estado])],
    };
  }

  const resolvidosSemImposto = resolucoes.some((r) => r.taxPercent === null);
  if (resolvidosSemImposto) pendencias.push("sem_imposto");
  const custo = somaComponente(componentes, "custo_produto");
  const imposto = resolvidosSemImposto ? null : somaComponente(componentes, "imposto_interno");

  return {
    ...base,
    custo,
    imposto,
    margem_valor: pedido.lucroContribuicao,
    margem_pct: pedido.margemContribuicaoPercentual,
    estado_margem: pendencias.length ? "provisoria" : "confirmada",
    pendencias,
  };
}

function calcularPedido(args) {
  const linha = calcularPedidoSemHash(args);
  return { ...linha, payload_hash: calcularPayloadHash(linha) };
}

// Pack sem todos os pedidos conhecidos: as linhas JÁ gravadas dos irmãos deixam de poder afirmar um
// frete rateado (o grupo mudou). Marca frete/margem NULL + 'frete_pack_incompleto' (provisória,
// inconclusiva); hash NULL ⇒ o próximo recálculo completo regrava. Pela dbEscrita (fencing).
const MARCAR_PACK_INCOMPLETO_SQL = `
  UPDATE sentinel_pedidos SET
    frete = NULL, margem_valor = NULL, margem_pct = NULL, payload_hash = NULL,
    estado_margem = CASE WHEN estado_margem IN ('confirmada', 'provisoria') THEN 'provisoria' ELSE estado_margem END,
    pendencias = (SELECT COALESCE(jsonb_agg(DISTINCT e), '[]'::jsonb)
                    FROM jsonb_array_elements(pendencias || '["frete_pack_incompleto"]'::jsonb) e
                   WHERE e <> '"sem_frete"'::jsonb),
    calculado_em = NOW(), updated_at = NOW()
  WHERE cliente_conta_id = $1 AND pedido_id = ANY($2::text[]) AND estado_margem <> 'erro'`;

const UPSERT_SQL = `
  INSERT INTO sentinel_pedidos (
    cliente_id, cliente_conta_id, pedido_id, competencia, data_pedido, ml_date_last_updated, status_ml,
    itens, faturamento, comissao, frete, custo, imposto, margem_valor, margem_pct,
    estado_margem, pendencias, claims_verificado, payload_hash, calculado_em, created_at, updated_at
  ) VALUES (
    -- Dono = o da Conta NO MOMENTO da escrita (não o do contexto lido no início do
    -- ciclo). FOR SHARE conflita com o UPDATE da unificação: se ela estiver em curso,
    -- espera e lê a versão confirmada (sem o lock, o snapshot do comando devolveria o
    -- dono antigo); se esta escrita vier antes, a unificação espera e a move depois.
    -- $1 só vale se a Conta sumiu — aí a FK de cliente_conta_id recusa a escrita.
    COALESCE((SELECT cc.cliente_id FROM cliente_contas cc WHERE cc.id = $2 FOR SHARE), $1::int),
    $2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19,NOW(),NOW(),NOW())
  ON CONFLICT (cliente_conta_id, pedido_id) DO UPDATE SET
    cliente_id = EXCLUDED.cliente_id,
    competencia = EXCLUDED.competencia,
    data_pedido = EXCLUDED.data_pedido,
    ml_date_last_updated = EXCLUDED.ml_date_last_updated,
    status_ml = EXCLUDED.status_ml,
    itens = EXCLUDED.itens,
    faturamento = EXCLUDED.faturamento,
    comissao = EXCLUDED.comissao,
    frete = EXCLUDED.frete,
    custo = EXCLUDED.custo,
    imposto = EXCLUDED.imposto,
    margem_valor = EXCLUDED.margem_valor,
    margem_pct = EXCLUDED.margem_pct,
    estado_margem = EXCLUDED.estado_margem,
    pendencias = EXCLUDED.pendencias,
    claims_verificado = EXCLUDED.claims_verificado,
    payload_hash = EXCLUDED.payload_hash,
    calculado_em = NOW(),
    updated_at = NOW()
  -- Monotonicidade: observação com ml_date_last_updated MENOR nunca sobrescreve.
  -- Atualiza só se o ML andou (date maior) OU se a date é igual e o cálculo mudou
  -- (hash distinto: custo, frete, imposto... mudaram sem o ML mexer no pedido).
  WHERE (sentinel_pedidos.ml_date_last_updated IS NULL AND EXCLUDED.ml_date_last_updated IS NOT NULL)
     OR EXCLUDED.ml_date_last_updated > sentinel_pedidos.ml_date_last_updated
     OR (EXCLUDED.ml_date_last_updated IS NOT DISTINCT FROM sentinel_pedidos.ml_date_last_updated
         AND sentinel_pedidos.payload_hash IS DISTINCT FROM EXCLUDED.payload_hash)
  RETURNING id`;

// Estado erro: só cria a linha se o pedido ainda não existe. NUNCA sobrescreve um
// cálculo válido anterior (o erro vai para sentinel_pedido_excecoes).
const INSERT_ERRO_SQL = `
  INSERT INTO sentinel_pedidos (
    cliente_id, cliente_conta_id, pedido_id, competencia, data_pedido, ml_date_last_updated, status_ml,
    itens, estado_margem, pendencias, claims_verificado, calculado_em, created_at, updated_at
  ) VALUES (COALESCE((SELECT cc.cliente_id FROM cliente_contas cc WHERE cc.id = $2 FOR SHARE), $1::int),
    $2,$3,$4,$5,$6,$7,'[]'::jsonb,'erro',$8::jsonb,false,NOW(),NOW(),NOW())
  ON CONFLICT (cliente_conta_id, pedido_id) DO NOTHING`;

async function gravarLinha(db, contaCtx, linha) {
  const r = await db.query(UPSERT_SQL, [
    contaCtx.clienteId, contaCtx.clienteContaId, linha.pedido_id, linha.competencia, linha.data_pedido,
    linha.ml_date_last_updated, linha.status_ml, JSON.stringify(linha.itens || []), linha.faturamento ?? null,
    linha.comissao ?? null, linha.frete ?? null, linha.custo ?? null, linha.imposto ?? null,
    linha.margem_valor ?? null, linha.margem_pct ?? null, linha.estado_margem,
    JSON.stringify(linha.pendencias || []), linha.claims_verificado === true, linha.payload_hash ?? null,
  ]);
  return r.rowCount > 0;
}

// Frete já gravado, reaproveitado quando o pedido não mudou (a chamada de frete é
// a cara; o cálculo é local). receitaComprador não entra no resultado nem no hash.
function freteGravado(row) {
  if (row?.frete === null || row?.frete === undefined) return null;
  return { valor: Number(row.frete), custoSeller: Number(row.frete), status: "real", receitaComprador: null, collected: true };
}

let freteServicoPadrao = null;
function buscarFretePadrao(args) {
  // Serviço da Central intocado; só injeta o mlFetch do Sentinel (noRefresh).
  if (!freteServicoPadrao) {
    const { criarMlFetchSentinel } = require("./sentinelMlClient");
    freteServicoPadrao = createCentralVendasFreteService({ mlFetchFn: criarMlFetchSentinel({ modoFrete: true }) });
  }
  return freteServicoPadrao.buscarFreteShipment(args);
}

async function regravarIrmaos({ db, dbW, contaCtx, order, envio, freteEntry, indiceCusto }) {
  const irmaos = envio.pedidos.filter((o) => String(o.id) !== String(order.id));
  if (!irmaos.length) return;
  const existentes = await db.query(
    "SELECT pedido_id FROM sentinel_pedidos WHERE cliente_conta_id = $1 AND pedido_id = ANY($2::text[])",
    [contaCtx.clienteContaId, irmaos.map((o) => String(o.id))]
  );
  const existe = new Set(existentes.rows.map((r) => String(r.pedido_id)));
  for (const irmao of irmaos) {
    if (!existe.has(String(irmao.id))) continue;
    const linhaIrmao = calcularPedido({
      order: irmao, freteEntry, indiceCusto, clienteSlug: contaCtx.clienteSlug,
      grupoEnvio: envio.pedidos, fretePackIncompleto: false,
    });
    await gravarLinha(dbW, contaCtx, linhaIrmao); // mesma monotonicidade/hash do UPSERT
  }
}

// contaCtx: { clienteId, clienteContaId, clienteSlug, sellerId, baseId }
// deps: { db, buscarFrete, cacheCusto, forcar }
// Devolve { pedidoId, resultado: "gravado"|"inalterado"|"pulado"|"erro", estado, dateLastUpdated }.
async function processarPedido(contaCtx, order, deps = {}) {
  const db = deps.db; // leituras
  if (!db) throw new Error("processarPedido exige `db` explícito (pool próprio do Sentinel).");
  // ESCRITAS: na conexão que detém o advisory lock (fencing); sem ela (run avulso/teste) = db.
  const dbW = deps.dbEscrita || db;
  const buscarFrete = deps.buscarFrete || buscarFretePadrao;
  const pedidoId = order?.id != null ? String(order.id) : null;
  const dateLastUpdated = order?.date_last_updated || null;
  if (!pedidoId) return { pedidoId: null, resultado: "erro", estado: "erro", dateLastUpdated, erro: "pedido sem id" };

  try {
    const atual = await db.query(
      `SELECT ml_date_last_updated, estado_margem, frete, payload_hash FROM sentinel_pedidos
        WHERE cliente_conta_id = $1 AND pedido_id = $2`,
      [contaCtx.clienteContaId, pedidoId]
    );
    const row = atual.rows[0];
    const novoMs = dateLastUpdated ? Date.parse(dateLastUpdated) : null;
    const atualMs = row?.ml_date_last_updated ? new Date(row.ml_date_last_updated).getTime() : null;
    const mesmaDate = novoMs !== null && atualMs !== null && novoMs === atualMs;

    // Observação mais antiga que a gravada: nunca regride (e não gasta frete).
    if (row && novoMs !== null && atualMs !== null && novoMs < atualMs) {
      return { pedidoId, resultado: "inalterado", estado: row.estado_margem, dateLastUpdated, obsoleto: true };
    }

    const estavel = !!row && ESTADOS_ESTAVEIS.has(row.estado_margem);
    const shipmentId = order.shipping?.id != null ? String(order.shipping.id) : null;
    // Envio compartilhado (pack): sem `deps.envio` (chamada avulsa) = pedido único, como antes.
    const envio = shipmentId && deps.envio ? await resolverEnvio(order, deps.envio) : { tipo: "unico" };
    const fretePackIncompleto = envio.tipo === "incompleto";
    const compartilhado = envio.tipo === "compartilhado";
    let freteEntry = null;
    if (fretePackIncompleto) {
      console.warn(`[sentinel] pedido ${pedidoId}: pack/shipment ${shipmentId} sem todos os pedidos conhecidos (${envio.motivo}); frete NULL.`);
    } else if (shipmentId) {
      // O frete gravado de um pedido de pack é a PARCELA dele — nunca reaproveitar como shipment.
      const reaproveitado = !compartilhado && !deps.forcar && estavel && mesmaDate ? freteGravado(row) : null;
      const cacheFrete = compartilhado ? deps.envio.cacheFrete : null;
      freteEntry = reaproveitado || (cacheFrete && cacheFrete.get(shipmentId))
        || await buscarFrete({ clienteId: contaCtx.clienteId, sellerId: contaCtx.sellerId, shipmentId });
      if (cacheFrete && freteEntry && freteEntry.collected !== false) cacheFrete.set(shipmentId, freteEntry);
    }
    // Coleta de frete que FALHOU (401/5xx/timeout/orçamento: o serviço da Central devolve
    // "ausente" com collected:false) ≠ frete que ainda não existe (collected:true).
    if (fretePackIncompleto && envio.irmaosIds && envio.irmaosIds.length) {
      await dbW.query(MARCAR_PACK_INCOMPLETO_SQL, [contaCtx.clienteContaId, envio.irmaosIds.map(String)]);
    }
    const coletaFreteFalhou = !fretePackIncompleto && !!shipmentId && !!freteEntry && freteEntry.status !== "real" && freteEntry.collected === false;
    if (coletaFreteFalhou && row) {
      // Já existe linha: NÃO grava provisória por cima. Quem chama registra a tentativa.
      const motivo = `frete: coleta falhou (${freteEntry.motivo || "sem motivo"}${freteEntry.httpStatus ? ` HTTP ${freteEntry.httpStatus}` : ""})`;
      return { pedidoId, resultado: "erro", estado: row.estado_margem, dateLastUpdated, erro: motivo, codigo: "SENTINEL_FRETE_COLETA_FALHOU", mantida: true };
    }
    const indiceCusto = await carregarIndiceCusto(contaCtx.baseId, db, deps.cacheCusto || null);
    const linha = calcularPedido({
      order, freteEntry, indiceCusto, clienteSlug: contaCtx.clienteSlug, coletaFreteFalhou,
      grupoEnvio: compartilhado ? envio.pedidos : null, fretePackIncompleto,
    });

    // Estado estável, mesma date e cálculo idêntico (custo/frete/imposto não
    // mudaram): nada a gravar.
    if (estavel && mesmaDate && row.payload_hash && row.payload_hash === linha.payload_hash) {
      return { pedidoId, resultado: "pulado", estado: row.estado_margem, dateLastUpdated };
    }
    const mudou = await gravarLinha(dbW, contaCtx, linha);
    // BL1: o rateio de TODOS os irmãos depende do grupo (ex.: B cancela ⇒ A passa a levar o shipment
    // inteiro). Recalcula e regrava os irmãos que JÁ existem, com os pedidos do grupo resolvido.
    if (compartilhado) await regravarIrmaos({ db, dbW, contaCtx, order, envio, freteEntry, indiceCusto });
    return { pedidoId, resultado: mudou ? "gravado" : "inalterado", estado: linha.estado_margem, dateLastUpdated };
  } catch (err) {
    const mensagem = String(err?.message || err).slice(0, 500);
    try {
      await dbW.query(INSERT_ERRO_SQL, [
        contaCtx.clienteId, contaCtx.clienteContaId, pedidoId, competenciaDoPedido(order),
        order?.date_created || null, dateLastUpdated, order?.status || null,
        JSON.stringify([{ erro: mensagem, code: err?.code || null }]),
      ]);
    } catch (errGravar) {
      console.error(`[sentinel] falha ao gravar estado erro do pedido ${pedidoId}:`, errGravar?.message);
    }
    return { pedidoId, resultado: "erro", estado: "erro", dateLastUpdated, erro: mensagem, codigo: err?.code || null };
  }
}

module.exports = {
  processarPedido,
  calcularPedido,
  calcularPayloadHash,
  gravarLinha,
  competenciaDoPedido,
  ESTADOS_ESTAVEIS,
};
