// server/services/centralVendas/centralVendasFreteService.js
// Frete real por pedido (Fase 1) — Mercado Livre Shipments API.
//
// Busca o custo de frete do seller via GET /shipments/:id e devolve um valor
// honesto: número quando existir (0 = zero real), null quando ausente.
// Nunca inventa R$ 0,00. Erros em um shipment NÃO travam o sync.
//
// Performance: cache por shipmentId único, concorrencia baixa (4) e cap de
// seguranca (800 shipments/sync). Excedentes ficam ausentes.

const { mlFetch } = require("../../utils/mlClient");
const { round2 } = require("../../utils/numberUtils");

const FRETE_CONCURRENCY = 4;
const FRETE_MAX_SHIPMENTS = 800;

// Custo de frete do seller (Fase 1): base_cost do envio. Fallbacks defensivos.
// Mantem 0 como zero real; campo inexistente vira null (ausente).
function extrairFreteSeller(shipment) {
  if (!shipment || typeof shipment !== "object") return null;
  const candidatos = [
    shipment.base_cost,
    shipment.shipping_option && shipment.shipping_option.list_cost,
    shipment.shipping_option && shipment.shipping_option.cost,
  ];
  for (const c of candidatos) {
    if (c !== null && c !== undefined && Number.isFinite(Number(c))) {
      return round2(Number(c));
    }
  }
  return null;
}

// Resultado sempre no formato { valor, status, motivo }.
//   valor: number|null  ·  status: "real" | "ausente"
async function buscarFreteShipment({ clienteId, shipmentId }) {
  const id = String(shipmentId || "").trim();
  if (!id) return { valor: null, status: "ausente", motivo: "sem_shipment_id" };

  try {
    const { ok, status, data } = await mlFetch(clienteId, `/shipments/${encodeURIComponent(id)}`);
    if (!ok) return { valor: null, status: "ausente", motivo: `http_${status}` };
    const valor = extrairFreteSeller(data);
    if (valor === null) return { valor: null, status: "ausente", motivo: "sem_campo_custo" };
    return { valor, status: "real", motivo: null };
  } catch (err) {
    return { valor: null, status: "ausente", motivo: "erro_fetch" };
  }
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

// Busca o frete de varios shipments com cache/concorrencia/cap.
// Retorna { freteMap: Map<shipmentId, {valor,status,motivo}>, ...stats }.
async function buscarFretesEmLote({ clienteId, shipmentIds, maxShipments = FRETE_MAX_SHIPMENTS, concorrencia = FRETE_CONCURRENCY }) {
  const unicos = [...new Set((shipmentIds || []).map((s) => String(s || "").trim()).filter(Boolean))];
  const alvos = unicos.slice(0, maxShipments);
  const capExcedido = unicos.length - alvos.length;

  const freteMap = new Map();
  const limit = pLimit(concorrencia);
  let feitos = 0;
  let comFrete = 0;

  await Promise.all(
    alvos.map((id) =>
      limit(async () => {
        const r = await buscarFreteShipment({ clienteId, shipmentId: id });
        freteMap.set(id, r);
        feitos++;
        if (r.status === "real") comFrete++;
        if (feitos % 50 === 0) {
          console.log(`[centralVendas] shipments ${feitos}/${alvos.length} (comFrete=${comFrete})`);
        }
      })
    )
  );

  console.log(
    `[centralVendas] frete shipments: unicos=${unicos.length} buscados=${alvos.length}` +
      ` comFrete=${comFrete} capExcedido=${capExcedido}`
  );

  return { freteMap, total: unicos.length, buscados: alvos.length, comFrete, capExcedido };
}

module.exports = {
  extrairFreteSeller,
  buscarFreteShipment,
  buscarFretesEmLote,
  FRETE_CONCURRENCY,
  FRETE_MAX_SHIPMENTS,
};
