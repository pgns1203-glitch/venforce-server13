// server/tests/centralVendasShipmentsCompleteness.test.js
//
// Hardening M3 — Shipments não pode chamar 401/403 de "coleta completa"
// (seções 12-17 da spec).
//
// Antes: `buscarFreteShipment` só marcava `erro=true` para falhas técnicas
// retryable (429/5xx exauridos/rede) — 401/403 caíam em "ausência legítima"
// (erro=false), e `shipmentsComplete = freteLote.erros === 0` podia declarar
// a fonte completa com 100% das requisições rejeitadas por permissão. Este
// arquivo prova a separação em 3 conceitos: coleta HTTP válida + custo
// (collected=true, status=real), coleta HTTP válida sem custo utilizável
// (collected=true, status=ausente — cobertura financeira, não falha de
// coleta) e coleta que não pôde ser confirmada (collected=false — 401/403/
// 400/404/429-exaurido/5xx-exaurido/erro de rede).

const assert = require("assert");
const { createCentralVendasFreteService } = require("../services/centralVendas/centralVendasFreteService");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
}
function eq(label, actual, expected) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${label} — recebido ${JSON.stringify(actual)}`);
  checks += 1;
}

const semEspera = async () => {};
const SELLER_ID = 111;
const costsPayload = (cost) => ({ senders: [{ user_id: SELLER_ID, cost }], receiver: { cost: 5 } });

async function capturandoLogs(fn) {
  const original = { log: console.log, warn: console.warn };
  console.log = () => {};
  console.warn = () => {};
  try { return await fn(); } finally { console.log = original.log; console.warn = original.warn; }
}

async function run() {
  await capturandoLogs(async () => {
    // 1. HTTP 200 + custo válido → collected=true, status=real.
    {
      const svc = createCentralVendasFreteService({ sleepFn: semEspera, mlFetchFn: async () => ({ ok: true, status: 200, data: costsPayload(12.5) }) });
      const r = await svc.buscarFreteShipment({ clienteId: 1, sellerId: SELLER_ID, shipmentId: "S1" });
      eq("1: status real", r.status, "real");
      eq("1: collected", r.collected, true);
      eq("1: httpStatus", r.httpStatus, 200);
    }

    // 2. HTTP 200 + custo ausente → collected=true (a fonte FOI consultada
    //    com sucesso), mas status=ausente (cobertura financeira faltando —
    //    conceito diferente de falha de coleta, seção 13).
    {
      const svc = createCentralVendasFreteService({ sleepFn: semEspera, mlFetchFn: async () => ({ ok: true, status: 200, data: { senders: [] } }) });
      const r = await svc.buscarFreteShipment({ clienteId: 1, sellerId: SELLER_ID, shipmentId: "S2" });
      eq("2: status ausente", r.status, "ausente");
      eq("2: collected=true", r.collected, true);
      eq("2: motivo", r.motivo, "sem_custo_seller");
    }

    // 3. HTTP 401 → coleta falhou (collected=false). Este é o P0: antes
    //    virava "ausência legítima" (erro=false), silenciosamente contada
    //    como coleta completa por centralVendasSyncService.
    {
      const svc = createCentralVendasFreteService({ sleepFn: semEspera, mlFetchFn: async () => ({ ok: false, status: 401, data: null }) });
      const r = await svc.buscarFreteShipment({ clienteId: 1, sellerId: SELLER_ID, shipmentId: "S3" });
      eq("3: collected=false", r.collected, false);
      eq("3: httpStatus", r.httpStatus, 401);
    }

    // 4. HTTP 403 → coleta falhou (o cenário real descrito no hardening:
    //    573 shipments, 573 HTTP 403, erros=0 — mas collected=false em
    //    todos, então a fonte NUNCA pode ficar complete).
    {
      const svc = createCentralVendasFreteService({ sleepFn: semEspera, mlFetchFn: async () => ({ ok: false, status: 403, data: null }) });
      const r = await svc.buscarFreteShipment({ clienteId: 1, sellerId: SELLER_ID, shipmentId: "S4" });
      eq("4: collected=false", r.collected, false);
      eq("4: erro=false (nao e falha tecnica retryable — mantido por compat)", r.erro, false);
      eq("4: httpStatus", r.httpStatus, 403);
    }

    // 5. 429 exaurido (todas as tentativas) → collection failure.
    {
      const svc = createCentralVendasFreteService({ sleepFn: semEspera, mlFetchFn: async () => ({ ok: false, status: 429, data: null, retryAfter: null }) });
      const r = await svc.buscarFreteShipment({ clienteId: 1, sellerId: SELLER_ID, shipmentId: "S5" });
      eq("5: collected=false", r.collected, false);
      eq("5: erro=true (retryable exaurido)", r.erro, true);
      eq("5: tentativas esgotadas", r.tentativas, 3);
    }

    // 6. 5xx exaurido → collection failure.
    {
      const svc = createCentralVendasFreteService({ sleepFn: semEspera, mlFetchFn: async () => ({ ok: false, status: 503, data: null }) });
      const r = await svc.buscarFreteShipment({ clienteId: 1, sellerId: SELLER_ID, shipmentId: "S6" });
      eq("6: collected=false", r.collected, false);
      eq("6: erro=true", r.erro, true);
    }

    // 7. Erro de rede (exceção) exaurido → collection failure.
    {
      const svc = createCentralVendasFreteService({ sleepFn: semEspera, mlFetchFn: async () => { throw new Error("timeout"); } });
      const r = await svc.buscarFreteShipment({ clienteId: 1, sellerId: SELLER_ID, shipmentId: "S7" });
      eq("7: collected=false", r.collected, false);
      eq("7: erro=true", r.erro, true);
      eq("7: motivo", r.motivo, "erro_fetch");
    }

    // 8. HTTP 400 e 404 — sem evidência suficiente no projeto para presumir
    //    ausência legítima; tratados conservadoramente como coleta NAO
    //    confirmada (seção 15).
    for (const status of [400, 404]) {
      const svc = createCentralVendasFreteService({ sleepFn: semEspera, mlFetchFn: async () => ({ ok: false, status, data: null }) });
      const r = await svc.buscarFreteShipment({ clienteId: 1, sellerId: SELLER_ID, shipmentId: `S8-${status}` });
      eq(`8: HTTP ${status} collected=false`, r.collected, false);
    }

    // 9. Lote: 10 shipments, 3 com HTTP 403 → naoColetados=3, buscados=10,
    //    coletados=7. Este é o contador que decide a completude da fonte,
    //    não `erros` (que ficaria 0 aqui, escondendo o problema).
    {
      const svc = createCentralVendasFreteService({
        sleepFn: semEspera,
        mlFetchFn: async (_c, path) => {
          const id = path.match(/\/shipments\/([^/]+)/)[1];
          if (["F1", "F2", "F3"].includes(id)) return { ok: false, status: 403, data: null };
          return { ok: true, status: 200, data: costsPayload(9.9) };
        },
      });
      const ids = ["OK1", "OK2", "F1", "OK3", "F2", "OK4", "F3", "OK5", "OK6", "OK7"];
      const r = await svc.buscarFretesEmLote({ clienteId: 1, sellerId: SELLER_ID, shipmentIds: ids });
      eq("9: total", r.total, 10);
      eq("9: buscados", r.buscados, 10);
      eq("9: naoColetados", r.naoColetados, 3);
      eq("9: coletados", r.coletados, 7);
      eq("9: erros (retryable) fica 0 — nao e este quem decide completude", r.erros, 0);
      ok("9: a fonte NAO pode ser considerada completa (naoColetados>0)", r.naoColetados > 0);
    }

    // 10. Todos HTTP 200 mas alguns sem custo → naoColetados=0 (fonte
    //     completa), missingFinancial (ausentes - naoColetados) > 0.
    {
      const svc = createCentralVendasFreteService({
        sleepFn: semEspera,
        mlFetchFn: async (_c, path) => {
          const id = path.match(/\/shipments\/([^/]+)/)[1];
          if (id === "SEMCUSTO") return { ok: true, status: 200, data: { senders: [] } };
          return { ok: true, status: 200, data: costsPayload(9.9) };
        },
      });
      const r = await svc.buscarFretesEmLote({ clienteId: 1, sellerId: SELLER_ID, shipmentIds: ["OK1", "SEMCUSTO", "OK2"] });
      eq("10: naoColetados=0 (fonte completa)", r.naoColetados, 0);
      eq("10: coletados=total", r.coletados, r.total);
      eq("10: ausentes financeiro (nao e falha de coleta)", r.ausentes - r.naoColetados, 1);
    }
  });

  console.log(`centralVendasShipmentsCompleteness.test.js: ${checks} verificacoes OK`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
