// Prova que centralVendasFreteService processa TODOS os shipment IDs unicos
// de um periodo, sem corte fixo (o antigo FRETE_MAX_SHIPMENTS=800), em lotes
// com concorrencia controlada e retry seguro. Cobre os casos A-F pedidos na
// correcao do carregamento de frete real da Fechamento API.

const assert = require("assert");
const { createCentralVendasFreteService } = require("../services/centralVendas/centralVendasFreteService");

// sleep instantaneo nos testes — nao precisamos esperar o backoff de verdade.
const semEspera = async () => {};

function shipmentIdFromPath(path) {
  const m = String(path || "").match(/\/shipments\/([^/?]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function run() {
  // A. Mais de 800 shipments — todos devem ser chamados, sem corte.
  {
    const ids = Array.from({ length: 1001 }, (_, i) => `S${i + 1}`);
    let chamadas = 0;
    const service = createCentralVendasFreteService({
      sleepFn: semEspera,
      mlFetchFn: async () => {
        chamadas++;
        return { ok: true, status: 200, data: { base_cost: 12.5 } };
      },
    });

    const r = await service.buscarFretesEmLote({ clienteId: 1, shipmentIds: ids });

    assert.strictEqual(r.total, 1001, "total deve contar todos os IDs unicos");
    assert.strictEqual(r.buscados, 1001, "buscados deve ser igual ao total (sem corte)");
    assert.strictEqual(r.capExcedido, 0, "capExcedido nunca pode ser positivo");
    assert.strictEqual(chamadas, 1001, "cada shipment unico deve gerar exatamente 1a tentativa bem-sucedida");
    assert.strictEqual(r.comFrete + r.ausentes, r.total, "comFrete + ausentes deve fechar com o total");
    console.log("  ✓ A. mais de 800 shipments: todos processados, capExcedido=0");
  }

  // B. IDs duplicados — dedupe antes de consultar o ML.
  {
    const chamadasPorId = new Map();
    const service = createCentralVendasFreteService({
      sleepFn: semEspera,
      mlFetchFn: async (_clienteId, path) => {
        const id = shipmentIdFromPath(path);
        chamadasPorId.set(id, (chamadasPorId.get(id) || 0) + 1);
        return { ok: true, status: 200, data: { base_cost: 5 } };
      },
    });

    const r = await service.buscarFretesEmLote({
      clienteId: 1,
      shipmentIds: ["1", "1", "2", "2", "3"],
    });

    assert.strictEqual(r.total, 3, "duplicados devem contar como 1 shipment unico cada");
    assert.strictEqual(r.buscados, 3);
    assert.strictEqual(chamadasPorId.size, 3, "apenas 3 shipments distintos foram consultados");
    for (const [id, n] of chamadasPorId) {
      assert.strictEqual(n, 1, `shipment ${id} deveria ser consultado uma unica vez`);
    }
    console.log("  ✓ B. IDs duplicados: apenas 3 consultas");
  }

  // C. Zero real — base_cost: 0 e frete real igual a zero, nao ausente.
  {
    const service = createCentralVendasFreteService({
      sleepFn: semEspera,
      mlFetchFn: async () => ({ ok: true, status: 200, data: { base_cost: 0 } }),
    });

    const r = await service.buscarFreteShipment({ clienteId: 1, shipmentId: "ZERO" });

    assert.strictEqual(r.valor, 0, "zero real deve permanecer 0, nunca null");
    assert.strictEqual(r.status, "real");
    console.log("  ✓ C. zero real: valor=0, status=real");
  }

  // D. Campo inexistente — sem base_cost/list_cost/cost vira ausente honesto.
  {
    const service = createCentralVendasFreteService({
      sleepFn: semEspera,
      mlFetchFn: async () => ({ ok: true, status: 200, data: { tracking_number: "abc" } }),
    });

    const r = await service.buscarFreteShipment({ clienteId: 1, shipmentId: "SEMCUSTO" });

    assert.strictEqual(r.valor, null);
    assert.strictEqual(r.status, "ausente");
    assert.strictEqual(r.motivo, "sem_campo_custo");
    console.log("  ✓ D. campo inexistente: valor=null, status=ausente, motivo=sem_campo_custo");
  }

  // E. Retry — 429, depois 503, depois 200 com base_cost: deve devolver valor
  // real sem derrubar a sincronizacao, registrando as tentativas.
  {
    let tentativa = 0;
    const service = createCentralVendasFreteService({
      sleepFn: semEspera,
      mlFetchFn: async () => {
        tentativa++;
        if (tentativa === 1) return { ok: false, status: 429, data: null, retryAfter: null };
        if (tentativa === 2) return { ok: false, status: 503, data: null };
        return { ok: true, status: 200, data: { base_cost: 33.4 } };
      },
    });

    const r = await service.buscarFreteShipment({ clienteId: 1, shipmentId: "RETRY" });

    assert.strictEqual(r.valor, 33.4, "apos 429 e 503, a 3a tentativa com sucesso deve valer");
    assert.strictEqual(r.status, "real");
    assert.strictEqual(r.tentativas, 3, "devem ser registradas as 3 tentativas");
    assert.strictEqual(r.erro, false, "resultado final com sucesso nao e erro");
    console.log("  ✓ E. retry 429→503→200: valor real, 3 tentativas, sem falha global");
  }

  // F. Falha isolada — um shipment falha (esgota retries em 500), os demais
  // continuam reais e a sincronizacao (buscarFretesEmLote) conclui normalmente.
  {
    const service = createCentralVendasFreteService({
      sleepFn: semEspera,
      mlFetchFn: async (_clienteId, path) => {
        const id = shipmentIdFromPath(path);
        if (id === "FALHA") return { ok: false, status: 500, data: null };
        return { ok: true, status: 200, data: { base_cost: 9.9 } };
      },
    });

    const r = await service.buscarFretesEmLote({
      clienteId: 1,
      shipmentIds: ["OK1", "OK2", "FALHA", "OK3"],
    });

    assert.strictEqual(r.total, 4);
    assert.strictEqual(r.buscados, 4, "sincronizacao deve concluir mesmo com 1 shipment falhando");
    assert.strictEqual(r.comFrete, 3, "os 3 shipments saudaveis devem ficar reais");
    assert.strictEqual(r.ausentes, 1, "somente o shipment com falha fica ausente");
    assert.strictEqual(r.erros, 1, "a falha tecnica deve ser contabilizada em erros");

    const falha = r.freteMap.get("FALHA");
    assert.strictEqual(falha.status, "ausente");
    assert.strictEqual(falha.motivo, "http_500");
    for (const id of ["OK1", "OK2", "OK3"]) {
      assert.strictEqual(r.freteMap.get(id).status, "real", `${id} deveria continuar real`);
    }
    console.log("  ✓ F. falha isolada: somente o shipment com falha fica ausente, demais reais");
  }

  console.log("centralVendasFreteLotes.test.js passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
