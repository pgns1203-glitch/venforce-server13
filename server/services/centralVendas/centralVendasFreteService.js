// server/services/centralVendas/centralVendasFreteService.js
// Frete real por pedido — Mercado Livre Shipments API.
//
// Busca o custo de frete do seller via GET /shipments/:id/costs e devolve um valor
// honesto: número quando existir (0 = zero real), null quando ausente.
// Nunca inventa R$ 0,00, nunca estima e nunca reaproveita tabela de peso.
// Erros em um shipment NAO travam o sync — ficam ausentes e auditáveis.
//
// TODOS os shipment IDs únicos do período são processados: não há corte por
// quantidade. O processamento é feito em lotes sequenciais (para não disparar
// milhares de requisições simultâneas), com concorrência controlada dentro de
// cada lote e retry seguro por shipment.

const { mlFetch } = require("../../utils/mlClient");
const { round2 } = require("../../utils/numberUtils");

const FRETE_BATCH_SIZE = 200;   // shipments por lote — próximo lote só inicia após este concluir
const FRETE_CONCURRENCY = 6;    // requisições simultâneas dentro de um lote (4–8)
const FRETE_MAX_RETRIES = 3;    // tentativas por shipment (1 inicial + retries)

// HTTP retryável: rate limit e instabilidade transitória do lado do ML.
// 400/401/403/404 NAO sao retry automatico (erro do pedido/permissao, nao vai
// se resolver tentando de novo).
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Backoff exponencial pequeno + jitter; respeita Retry-After quando o ML manda.
function backoffDelayMs(attempt, retryAfterSeconds) {
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, 10000);
  }
  const base = 250 * 2 ** (attempt - 1); // 250ms, 500ms, 1000ms...
  const jitter = Math.floor(Math.random() * 150);
  return Math.min(base + jitter, 4000);
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// `senders[].cost` já é o custo final do usuário. Nunca usa gross_amount,
// base_cost, compensation ou save como fallback. Mantém 0 como zero real.
//
// ATENÇÃO: `receiver.cost` (valor de envio pago pelo COMPRADOR) sai por
// extrairReceitaComprador e nunca é misturado aqui — são grandezas diferentes.
function extrairFreteSeller(costs, sellerId) {
  if (!costs || typeof costs !== "object" || !Array.isArray(costs.senders)) return null;
  if (sellerId === null || sellerId === undefined || String(sellerId).trim() === "") return null;

  const sellerKey = String(sellerId).trim();
  const sender = costs.senders.find(
    (entry) => entry && entry.user_id !== null && entry.user_id !== undefined && String(entry.user_id).trim() === sellerKey
  );

  if (!sender) {
    console.warn(
      `[centralVendas] custo de frete sem sender correspondente: sellerId=${sellerKey}` +
        ` senders=${costs.senders.length}`
    );
    return null;
  }

  if (sender.cost === null || sender.cost === undefined || !Number.isFinite(Number(sender.cost))) return null;
  return round2(Number(sender.cost));
}

// Receita de envio: `receiver.cost` da MESMA resposta de GET /shipments/:id/costs
// é o valor de envio pago pelo comprador. Nunca usa base_cost, gross_amount,
// compensation ou save como fallback, e nunca cai para senders[].cost.
// null = ausente · 0 = zero real (frete grátis cobrado do comprador como 0).
function extrairReceitaComprador(costs) {
  if (!costs || typeof costs !== "object") return null;
  const receiver = costs.receiver;
  if (!receiver || typeof receiver !== "object") return null;
  if (receiver.cost === null || receiver.cost === undefined) return null;
  const valor = Number(receiver.cost);
  return Number.isFinite(valor) ? round2(valor) : null;
}

// Pool simples de concorrencia (mesmo padrao do diagnosticoService.diagPLimit).
function pLimit(concorrencia) {
  const fila = [];
  let ativos = 0;
  const proximo = () => {
    ativos--;
    if (fila.length > 0) fila.shift()();
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      const run = () => {
        ativos++;
        Promise.resolve()
          .then(fn)
          .then((v) => { proximo(); resolve(v); })
          .catch((e) => { proximo(); reject(e); });
      };
      if (ativos < concorrencia) run();
      else fila.push(run);
    });
}

function createCentralVendasFreteService({ mlFetchFn = mlFetch, sleepFn = sleep } = {}) {
  // Consulta um shipment com retry seguro. Resultado sempre no formato
  // { valor, custoSeller, receitaComprador, status, motivo, tentativas, erro,
  //   collected, httpStatus }.
  //   custoSeller (= valor, mantido por compatibilidade): senders[].cost
  //   receitaComprador: receiver.cost — valor de envio pago pelo comprador
  //   status: "real" | "ausente" (refere-se SEMPRE ao custo do seller)
  //   erro: true quando a ausência veio de falha tecnica retryable exaurida
  //         (429/5xx) ou exceção de rede — mantido por compatibilidade com
  //         `buscarFretesEmLote.erros`, nunca renomeado.
  //   collected (Hardening M3, seções 12-15): true SOMENTE quando a fonte foi
  //         de fato consultada com sucesso (HTTP ok — com ou sem custo
  //         utilizável). 401/403/429-exaurido/5xx-exaurido/erro de rede NUNCA
  //         são "coleta completa" — isso é o bug real corrigido aqui: antes,
  //         `shipments.complete` só olhava para `erro` (retryable), então
  //         573 HTTP 403 viravam "coleta completa" silenciosamente. 400/404
  //         não têm evidência suficiente no projeto para assumir ausência
  //         legítima — tratados conservadoramente como coleta não
  //         confirmada também (nunca otimista sem prova).
  async function buscarFreteShipment({ clienteId, sellerId, shipmentId, maxRetries = FRETE_MAX_RETRIES }) {
    const id = String(shipmentId || "").trim();
    if (!id) {
      return {
        valor: null,
        custoSeller: null,
        receitaComprador: null,
        status: "ausente",
        motivo: "sem_shipment_id",
        tentativas: 0,
        erro: false,
        collected: false,
        httpStatus: null,
      };
    }

    let motivoFalha = "erro_fetch";
    let httpStatusFalha = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // mlUserId=sellerId: a conta já foi congelada pelo sync run (M1/M2) —
        // nunca deixar o mlClient re-resolver "qualquer grant válido do
        // cliente", ou o custo pode vir do token de outra conta do mesmo
        // cliente (ver docs/AUDITORIA_IDENTIDADE_CENTRAL_VENDAS_CLAIMS_FRETE.md).
        const resp = await mlFetchFn(clienteId, `/shipments/${encodeURIComponent(id)}/costs`, { mlUserId: sellerId });
        const { ok, status, data, retryAfter } = resp || {};

        if (ok) {
          const valor = extrairFreteSeller(data, sellerId);
          const receitaComprador = extrairReceitaComprador(data);
          if (valor === null) {
            return {
              valor: null,
              custoSeller: null,
              receitaComprador,
              status: "ausente",
              motivo: "sem_custo_seller",
              tentativas: attempt,
              erro: false,
              collected: true,
              httpStatus: status,
            };
          }
          return {
            valor,
            custoSeller: valor,
            receitaComprador,
            status: "real",
            motivo: null,
            tentativas: attempt,
            erro: false,
            collected: true,
            httpStatus: status,
          };
        }

        motivoFalha = `http_${status}`;
        httpStatusFalha = status;
        if (RETRYABLE_STATUS.has(status) && attempt < maxRetries) {
          await sleepFn(backoffDelayMs(attempt, retryAfter));
          continue;
        }
        return {
          valor: null,
          custoSeller: null,
          receitaComprador: null,
          status: "ausente",
          motivo: motivoFalha,
          tentativas: attempt,
          erro: RETRYABLE_STATUS.has(status),
          collected: false,
          httpStatus: status,
        };
      } catch (err) {
        motivoFalha = "erro_fetch";
        if (attempt < maxRetries) {
          await sleepFn(backoffDelayMs(attempt, null));
          continue;
        }
        return {
          valor: null,
          custoSeller: null,
          receitaComprador: null,
          status: "ausente",
          motivo: "erro_fetch",
          tentativas: attempt,
          erro: true,
          collected: false,
          httpStatus: null,
        };
      }
    }

    return {
      valor: null,
      custoSeller: null,
      receitaComprador: null,
      status: "ausente",
      motivo: motivoFalha,
      tentativas: maxRetries,
      erro: true,
      collected: false,
      httpStatus: httpStatusFalha,
    };
  }

  // Busca o frete de TODOS os shipmentIds unicos, em lotes sequenciais com
  // concorrencia controlada dentro de cada lote. Sem corte por quantidade:
  // buscados sempre === total. Falha de um shipment nunca derruba o lote.
  async function buscarFretesEmLote({
    clienteId,
    sellerId,
    shipmentIds,
    batchSize = FRETE_BATCH_SIZE,
    concorrencia = FRETE_CONCURRENCY,
    maxRetries = FRETE_MAX_RETRIES,
  }) {
    const unicos = [...new Set((shipmentIds || []).map((s) => String(s || "").trim()).filter(Boolean))];
    const total = unicos.length;

    const freteMap = new Map();
    const lotesArr = chunk(unicos, Math.max(1, batchSize));

    let processados = 0;
    let comFrete = 0;
    let ausentes = 0;
    let erros = 0;
    let naoColetados = 0;
    let tentativasExtras = 0;
    let comReceitaEnvio = 0;

    for (let i = 0; i < lotesArr.length; i++) {
      const lote = lotesArr[i];
      const limit = pLimit(concorrencia);
      let loteComFrete = 0;

      await Promise.all(
        lote.map((id) =>
          limit(async () => {
            const r = await buscarFreteShipment({ clienteId, sellerId, shipmentId: id, maxRetries });
            freteMap.set(id, {
              valor: r.valor,
              custoSeller: r.custoSeller,
              receitaComprador: r.receitaComprador,
              status: r.status,
              motivo: r.motivo,
              collected: r.collected,
              httpStatus: r.httpStatus,
            });

            if (r.receitaComprador !== null && r.receitaComprador !== undefined) comReceitaEnvio++;
            processados++;
            if (r.status === "real") {
              comFrete++;
              loteComFrete++;
            } else {
              ausentes++;
            }
            if (r.erro) erros++;
            // naoColetados (Hardening M3): superset de `erros` — inclui
            // também 401/403/400/404, que `erros` sempre ignorou. É este
            // contador, não `erros`, que decide a completude da fonte.
            if (!r.collected) naoColetados++;
            tentativasExtras += Math.max(0, (r.tentativas || 1) - 1);
          })
        )
      );

      console.log(
        `[centralVendas] frete lote ${i + 1}/${lotesArr.length} concluído: ${loteComFrete}/${lote.length} com frete`
      );
      console.log(`[centralVendas] frete progresso: ${processados}/${total}`);
    }

    console.log(
      `[centralVendas] frete shipments: total=${total} buscados=${processados}` +
        ` comFrete=${comFrete} ausentes=${ausentes} erros=${erros} naoColetados=${naoColetados}` +
        ` comReceitaEnvio=${comReceitaEnvio}` +
        ` tentativasExtras=${tentativasExtras} lotes=${lotesArr.length} capExcedido=0`
    );

    return {
      freteMap,
      total,
      buscados: processados,
      comFrete,
      comReceitaEnvio,
      ausentes,
      erros,
      naoColetados,
      coletados: processados - naoColetados,
      tentativasExtras,
      lotes: lotesArr.length,
      capExcedido: 0,
    };
  }

  return { buscarFreteShipment, buscarFretesEmLote };
}

const defaultService = createCentralVendasFreteService();

module.exports = {
  extrairFreteSeller,
  extrairReceitaComprador,
  buscarFreteShipment: defaultService.buscarFreteShipment,
  buscarFretesEmLote: defaultService.buscarFretesEmLote,
  createCentralVendasFreteService,
  FRETE_BATCH_SIZE,
  FRETE_CONCURRENCY,
  FRETE_MAX_RETRIES,
};
