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
  // { valor, status, motivo, tentativas, erro }.
  //   valor: number|null · status: "real" | "ausente"
  //   erro: true quando a ausência veio de falha tecnica (429/5xx/fetch),
  //         false quando é ausência legitima (404/400/401/403/sem_custo_seller).
  async function buscarFreteShipment({ clienteId, sellerId, shipmentId, maxRetries = FRETE_MAX_RETRIES }) {
    const id = String(shipmentId || "").trim();
    if (!id) {
      return { valor: null, status: "ausente", motivo: "sem_shipment_id", tentativas: 0, erro: false };
    }

    let motivoFalha = "erro_fetch";

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const resp = await mlFetchFn(clienteId, `/shipments/${encodeURIComponent(id)}/costs`);
        const { ok, status, data, retryAfter } = resp || {};

        if (ok) {
          const valor = extrairFreteSeller(data, sellerId);
          if (valor === null) {
            return { valor: null, status: "ausente", motivo: "sem_custo_seller", tentativas: attempt, erro: false };
          }
          return { valor, status: "real", motivo: null, tentativas: attempt, erro: false };
        }

        motivoFalha = `http_${status}`;
        if (RETRYABLE_STATUS.has(status) && attempt < maxRetries) {
          await sleepFn(backoffDelayMs(attempt, retryAfter));
          continue;
        }
        return {
          valor: null,
          status: "ausente",
          motivo: motivoFalha,
          tentativas: attempt,
          erro: RETRYABLE_STATUS.has(status),
        };
      } catch (err) {
        motivoFalha = "erro_fetch";
        if (attempt < maxRetries) {
          await sleepFn(backoffDelayMs(attempt, null));
          continue;
        }
        return { valor: null, status: "ausente", motivo: "erro_fetch", tentativas: attempt, erro: true };
      }
    }

    return { valor: null, status: "ausente", motivo: motivoFalha, tentativas: maxRetries, erro: true };
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
    let tentativasExtras = 0;

    for (let i = 0; i < lotesArr.length; i++) {
      const lote = lotesArr[i];
      const limit = pLimit(concorrencia);
      let loteComFrete = 0;

      await Promise.all(
        lote.map((id) =>
          limit(async () => {
            const r = await buscarFreteShipment({ clienteId, sellerId, shipmentId: id, maxRetries });
            freteMap.set(id, { valor: r.valor, status: r.status, motivo: r.motivo });

            processados++;
            if (r.status === "real") {
              comFrete++;
              loteComFrete++;
            } else {
              ausentes++;
            }
            if (r.erro) erros++;
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
        ` comFrete=${comFrete} ausentes=${ausentes} erros=${erros}` +
        ` tentativasExtras=${tentativasExtras} lotes=${lotesArr.length} capExcedido=0`
    );

    return {
      freteMap,
      total,
      buscados: processados,
      comFrete,
      ausentes,
      erros,
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
  buscarFreteShipment: defaultService.buscarFreteShipment,
  buscarFretesEmLote: defaultService.buscarFretesEmLote,
  createCentralVendasFreteService,
  FRETE_BATCH_SIZE,
  FRETE_CONCURRENCY,
  FRETE_MAX_RETRIES,
};
