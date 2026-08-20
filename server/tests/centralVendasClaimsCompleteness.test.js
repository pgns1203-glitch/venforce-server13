// server/tests/centralVendasClaimsCompleteness.test.js
//
// Hardening M3 — completude de Claims (seções 5-11 da spec).
//
// P0: `paging.total` ausente NUNCA prova completude, mesmo com lista vazia
// (antes disso podia virar "0 claims confirmado" silenciosamente). Total
// variando entre páginas usa a estratégia conservadora do maior valor visto
// (maxReportedTotal), nunca o último sobrescrevendo o anterior. Página vazia
// antes do total conhecido e o teto de paginação (CLAIMS_MAX_PAGES) geram
// motivos tipados próprios em vez de indisponivel=true genérico.

const assert = require("assert");
const {
  createCentralVendasClaimsService,
  computeClaimsCompleteness,
  CLAIMS_MAX_PAGES,
} = require("../services/centralVendas/centralVendasClaimsService");

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

function claim(id) {
  return { id, resource: "order", resource_id: `o${id}` };
}

// `paginas` é servida em ordem por chamada ao endpoint de busca de claims;
// além disso o path é resolvido para as demais rotas (returns detail) como
// sucesso vazio — nenhum destes testes usa devolução sem vínculo.
function servicoComPaginas(paginas) {
  let chamada = 0;
  return createCentralVendasClaimsService({
    sleepFn: semEspera,
    mlFetchFn: async (_clienteId, path) => {
      if (!path.startsWith("/post-purchase/v1/claims/search")) return { ok: true, status: 200, data: {} };
      const pagina = paginas[Math.min(chamada, paginas.length - 1)];
      chamada += 1;
      if (pagina.erro) return { ok: false, status: pagina.status || 500, data: pagina.data || null };
      return { ok: true, status: 200, data: { data: pagina.items, paging: pagina.total != null ? { total: pagina.total } : undefined } };
    },
  });
}

async function capturandoLogs(fn) {
  const original = console.log;
  console.log = () => {};
  try { return await fn(); } finally { console.log = original; }
}

async function run() {
  const base = { clienteId: 1, sellerId: SELLER_ID, dateFrom: "2026-08-01", dateTo: "2026-08-31", hoje: new Date("2026-08-19") };

  await capturandoLogs(async () => {
    // 1. HTTP 200 + total=0 + [] → complete. Zero é resultado válido quando
    //    a API realmente informa o total.
    {
      const svc = servicoComPaginas([{ items: [], total: 0 }]);
      const r = await svc.buscarClaimsPorPeriodo(base);
      ok("1: indisponivel=false", r.indisponivel === false);
      eq("1: complete", r.completeness.complete, true);
      eq("1: expected", r.completeness.expectedCount, 0);
      eq("1: received", r.completeness.receivedCount, 0);
    }

    // 2. HTTP 200 + total AUSENTE + [] → incomplete/CLAIMS_TOTAL_UNKNOWN.
    //    Este é o P0: antes, lista vazia sem total virava "complete" (0
    //    claims "confirmado") mesmo sem qualquer prova de cobertura.
    {
      const svc = servicoComPaginas([{ items: [] }]); // sem paging.total
      const r = await svc.buscarClaimsPorPeriodo(base);
      ok("2: indisponivel=false (a API respondeu, só nao provou cobertura)", r.indisponivel === false);
      eq("2: complete=false", r.completeness.complete, false);
      eq("2: reason", r.completeness.reason, "CLAIMS_TOTAL_UNKNOWN");
      eq("2: expected null", r.completeness.expectedCount, null);
    }

    // 3. total=20 (1a pagina) depois pagina vazia reportando total=15 (caiu)
    //    → incomplete, expectedCount preserva o MAIOR total já visto (20),
    //    nunca reescreve para o que foi de fato coletado.
    {
      const svc = servicoComPaginas([
        { items: Array.from({ length: 10 }, (_, i) => claim(i)), total: 20 },
        { items: [], total: 15 },
      ]);
      const r = await svc.buscarClaimsPorPeriodo(base);
      eq("3: complete=false", r.completeness.complete, false);
      eq("3: expected preserva o maior total (20)", r.completeness.expectedCount, 20);
      eq("3: received", r.completeness.receivedCount, 10);
      eq("3: metadata.totalChanged", r.completeness.metadata.totalChanged, true);
    }

    // 4. total=15 (1a pagina) depois total=20 (revisado pra cima), cobertura
    //    final atinge o maior total → complete (estrategia documentada:
    //    "se a cobertura final atinge o maior total, é completa").
    {
      const svc = servicoComPaginas([
        { items: Array.from({ length: 10 }, (_, i) => claim(i)), total: 15 },
        { items: Array.from({ length: 10 }, (_, i) => claim(10 + i)), total: 20 },
      ]);
      const r = await svc.buscarClaimsPorPeriodo(base);
      eq("4: complete=true", r.completeness.complete, true);
      eq("4: expected usa o maior total (20)", r.completeness.expectedCount, 20);
      eq("4: received", r.completeness.receivedCount, 20);
      eq("4: metadata.totalChanged", r.completeness.metadata.totalChanged, true);
    }

    // 5. Página vazia antes do total conhecido (total estável=100, só 60
    //    chegaram) → incomplete/CLAIMS_EARLY_EMPTY_PAGE.
    {
      const svc = servicoComPaginas([
        { items: Array.from({ length: 60 }, (_, i) => claim(i)), total: 100 },
        { items: [], total: 100 },
      ]);
      const r = await svc.buscarClaimsPorPeriodo(base);
      eq("5: complete=false", r.completeness.complete, false);
      eq("5: reason", r.completeness.reason, "CLAIMS_EARLY_EMPTY_PAGE");
      eq("5: received", r.completeness.receivedCount, 60);
    }

    // 6. Teto de paginação (CLAIMS_MAX_PAGES) atingido antes de cobrir o
    //    total → incomplete/CLAIMS_TRUNCATED_BY_SAFETY_LIMIT. Antes disto
    //    virava `indisponivel=true` genérico (limite_paginacao_excedido) —
    //    agora a causa específica é provada e a coleta parcial continua
    //    disponível para auditoria (mesmo espírito de Orders).
    {
      const totalReal = 15000; // mais alto do que o teto consegue alcançar (100 paginas x 100 itens = 10000)
      const paginas = [];
      for (let p = 0; p < CLAIMS_MAX_PAGES; p++) {
        paginas.push({ items: Array.from({ length: 100 }, (_, i) => claim(`${p}_${i}`)), total: totalReal });
      }
      const svc = servicoComPaginas(paginas);
      const r = await svc.buscarClaimsPorPeriodo(base);
      ok("6: indisponivel=false (causa especifica provada, nao generica)", r.indisponivel === false);
      eq("6: complete=false", r.completeness.complete, false);
      eq("6: reason", r.completeness.reason, "CLAIMS_TRUNCATED_BY_SAFETY_LIMIT");
      eq("6: expected preservado", r.completeness.expectedCount, totalReal);
      eq("6: received (teto)", r.completeness.receivedCount, 10000);
    }

    // 7. HTTP 400 continua failed/CLAIMS_HTTP_400 (nao regrediu com o
    //    hardening — mesma garantia do M3 original).
    {
      const svc = servicoComPaginas([{ erro: true, status: 400, data: { error: "bad_request" } }]);
      const r = await svc.buscarClaimsPorPeriodo(base);
      eq("7: indisponivel", r.indisponivel, true);
      eq("7: status http", r.status, 400);
    }

    // 8. Diagnostico do HTTP 400 (Hardening identidade/400): o corpo de erro
    //    do ML sobrevive ate o resultado do collector (antes se perdia em
    //    `falha()`, so aparecia no console.log — ver
    //    docs/AUDITORIA_IDENTIDADE_CENTRAL_VENDAS_CLAIMS_FRETE.md, secao 5).
    //    Apenas os 3 campos documentados, nunca o corpo bruto completo.
    {
      const svc = servicoComPaginas([{
        erro: true, status: 400,
        data: { error: "bad_request", message: "invalid range parameter", cause: [{ code: "range.invalid" }], extra_field_nao_esperado: "nao deve vazar sem necessidade" },
      }]);
      const r = await svc.buscarClaimsPorPeriodo(base);
      eq("8: indisponivel", r.indisponivel, true);
      ok("8: diagnostic presente", r.diagnostic !== null && r.diagnostic !== undefined);
      eq("8: diagnostic.mlError", r.diagnostic.mlError, "bad_request");
      eq("8: diagnostic.mlMessage", r.diagnostic.mlMessage, "invalid range parameter");
      ok("8: diagnostic.mlCause presente", typeof r.diagnostic.mlCause === "string" && r.diagnostic.mlCause.includes("range.invalid"));
      eq("8: diagnostic nao vaza campos fora do whitelist", Object.keys(r.diagnostic).sort(), ["mlCause", "mlError", "mlMessage"]);
    }

    // 9. Falha sem corpo (erro de rede) -> diagnostic null, nunca objeto vazio
    //    fantasma.
    {
      const svc = servicoComPaginas([{ erro: true, status: 500, data: null }]);
      const r = await svc.buscarClaimsPorPeriodo(base);
      eq("9: diagnostic null quando nao ha corpo", r.diagnostic, null);
    }
  });

  // 10. mlUserId=sellerId deve ser propagado em toda chamada de busca de
  //     claims — nunca deixar o mlClient re-resolver "qualquer grant valido
  //     do cliente" quando a conta ja foi congelada pelo sync run.
  await capturandoLogs(async () => {
    const mlUserIdsRecebidos = [];
    const svc = createCentralVendasClaimsService({
      sleepFn: semEspera,
      mlFetchFn: async (_clienteId, path, options = {}) => {
        if (path.startsWith("/post-purchase/v1/claims/search")) {
          mlUserIdsRecebidos.push(options.mlUserId);
          return { ok: true, status: 200, data: { data: [], paging: { total: 0 } } };
        }
        return { ok: true, status: 200, data: {} };
      },
    });
    await svc.buscarClaimsPorPeriodo({ ...base, sellerId: "222" });
    ok("10: claims consultado ao menos uma vez", mlUserIdsRecebidos.length > 0);
    ok("10: mlUserId=222 propagado em 100% das chamadas", mlUserIdsRecebidos.every((id) => id === "222"));
  });

  // computeClaimsCompleteness isolada — zero claims sem sinal de total
  // nenhuma vez (maxReportedTotal null) nunca é complete, mesmo
  // receivedCount=0.
  {
    const c = computeClaimsCompleteness({
      receivedCount: 0, firstReportedTotal: null, lastReportedTotal: null, maxReportedTotal: null,
      earlyEmptyReason: null, cappedBySafetyLimit: false,
    });
    eq("computeClaimsCompleteness: total nunca informado + 0 recebidos -> incomplete", c.complete, false);
    eq("computeClaimsCompleteness: reason", c.reason, "CLAIMS_TOTAL_UNKNOWN");
  }

  console.log(`centralVendasClaimsCompleteness.test.js: ${checks} verificacoes OK`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
