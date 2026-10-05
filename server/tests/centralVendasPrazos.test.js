// server/tests/centralVendasPrazos.test.js
//
// Incidente P0 2026-10-02 — esperas SEM PRAZO na Central de Vendas:
//   1) chamadas HTTP de coleta ao Mercado Livre / Mercado Pago sem timeout;
//   2) a transação de gravação do import (persistCentralVendasImport) faz um INSERT por vez, sem
//      prazo por query: uma conexão presa espera para sempre (os runs #363/#399/#472 pararam aqui);
//   3) a rodada noturna não tem prazo por unidade: 3 unidades presas ocupam as 3 vagas de
//      concorrência até um restart (rodadas de 30/09 e 01/10: 34/61 e 11/64 unidades concluídas);
//   4) o fechamento do grupo (Ads / snapshot) também não tem prazo.
//
// Aqui TUDO que "trava" é uma promessa que nunca resolve (fake), e cada prazo é de dezenas de ms.
// NENHUM banco ou API reais: DATABASE_URL aponta para porta morta.

process.env.DATABASE_URL = "postgres://nobody@127.0.0.1:1/teste-sem-banco";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { comPrazo, PrazoExcedidoError } = require("../utils/comPrazo");
const prazosMod = require("../services/centralVendas/centralVendasPrazos");
const pool = require("../config/database");
const repository = require("../services/centralVendas/centralVendasRepository");
const syncService = require("../services/centralVendas/centralVendasSyncService");
const noturno = require("../services/centralVendas/centralVendasNoturnoService");

let checks = 0;
let concluido = false;
process.on("exit", () => {
  if (!concluido) {
    console.error(`centralVendasPrazos.test.js: NÃO concluiu (parou após ${checks} verificações)`);
    process.exitCode = 1;
  }
});
let rejeicoesNaoTratadas = 0;
process.on("unhandledRejection", () => { rejeicoesNaoTratadas += 1; });
function ok(label, cond) { assert.ok(cond, `FALHOU: ${label}`); checks += 1; }
function eq(label, actual, expected) { assert.deepStrictEqual(actual, expected, `FALHOU: ${label} — recebido ${JSON.stringify(actual)}`); checks += 1; }
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const NUNCA = () => new Promise(() => {});
// Corre contra um relógio: devolve { terminou, valor|erro }. Prova que algo NÃO termina dentro do limite.
async function comRelogio(promessa, limiteMs) {
  let t;
  const relogio = new Promise((r) => { t = setTimeout(() => r({ terminou: false }), limiteMs); });
  const r = await Promise.race([
    promessa.then((valor) => ({ terminou: true, valor }), (erro) => ({ terminou: true, erro })),
    relogio,
  ]);
  clearTimeout(t);
  return r;
}
const logger = { log() {}, warn() {}, error() {} };

async function main() {
  // ---------------------------------------------------------------------------
  // 1. comPrazo
  // ---------------------------------------------------------------------------
  {
    eq("comPrazo: promessa rápida resolve", await comPrazo(Promise.resolve(7), 50), 7);
    let limpou = null;
    const r = await comRelogio(comPrazo(NUNCA(), 30, { code: "X_TIMEOUT", message: "parou", onTimeout: (e) => { limpou = e.code; } }), 500);
    ok("comPrazo: promessa pendurada é rejeitada no prazo", r.terminou && r.erro instanceof PrazoExcedidoError);
    eq("comPrazo: código e mensagem", [r.erro.code, r.erro.message, r.erro.prazoMs], ["X_TIMEOUT", "parou", 30]);
    eq("comPrazo: onTimeout recebeu o erro (libera o recurso)", limpou, "X_TIMEOUT");
    const tardia = new Promise((_, rej) => setTimeout(() => rej(new Error("tarde")), 80));
    await comRelogio(comPrazo(tardia, 20), 500);
    await esperar(120);
    eq("comPrazo: rejeição tardia da promessa abandonada NÃO vira unhandledRejection", rejeicoesNaoTratadas, 0);
    const p = NUNCA();
    ok("comPrazo: ms inválido devolve a MESMA promessa (sem prazo implícito)", comPrazo(p, 0) === p && comPrazo(p, undefined) === p && comPrazo(p, "abc") === p);
  }

  // ---------------------------------------------------------------------------
  // 2. prazos(env) e comPrazoPadrao
  // ---------------------------------------------------------------------------
  {
    eq("prazos: padrões", prazosMod.prazos({}), { mlMs: 30000, mpMs: 30000, dbQueryMs: 60000, unidadeMs: 1800000, fechamentoMs: 300000 });
    const e = prazosMod.prazos({
      CENTRAL_VENDAS_ML_TIMEOUT_MS: "5000", CENTRAL_VENDAS_DB_QUERY_TIMEOUT_MS: "abc",
      CENTRAL_VENDAS_NOTURNO_UNIDADE_TIMEOUT_MS: "0", CENTRAL_VENDAS_MP_TIMEOUT_MS: "-1",
    });
    eq("prazos: override válido vale; inválido/zero/negativo volta ao padrão (não dá para desligar por engano)",
      [e.mlMs, e.dbQueryMs, e.unidadeMs, e.mpMs], [5000, 60000, 1800000, 30000]);
    const visto = [];
    const base = async (cid, p, o) => { visto.push([cid, p, o]); return { ok: true }; };
    const f = prazosMod.comPrazoPadrao(base, "mlMs", { CENTRAL_VENDAS_ML_TIMEOUT_MS: "1234" });
    await f(9, "/x", { mlUserId: "S1" });
    await f(9, "/y", { mlUserId: "S1", timeoutMs: 77 });
    eq("comPrazoPadrao injeta timeoutMs e preserva mlUserId", visto[0][2], { timeoutMs: 1234, mlUserId: "S1" });
    eq("comPrazoPadrao: o chamador ainda pode passar o próprio timeoutMs", visto[1][2].timeoutMs, 77);
  }

  // ---------------------------------------------------------------------------
  // 3. withTransaction com prazo POR QUERY (conexão presa => descartada, sem ROLLBACK pendurado)
  // ---------------------------------------------------------------------------
  function poolFalso(scriptQuery) {
    const client = {
      chamadas: [], liberacoes: [],
      query(sql, params) { this.chamadas.push(String(sql).split(/\s+/)[0]); return scriptQuery(this.chamadas.length, sql, params); },
      release(err) { this.liberacoes.push(err === undefined ? "ok" : (err.code || err.message || "erro")); },
    };
    return { client, pool: { connect: async () => client } };
  }
  {
    const { client, pool: pf } = poolFalso(async () => ({ rows: [] }));
    const r = await repository.withTransaction(async (db) => { await db.query("SELECT 1"); return "feito"; }, { pool: pf, queryTimeoutMs: 50 });
    eq("transação normal com prazo: resultado e sequência BEGIN/SET LOCAL x2/SELECT/COMMIT", [r, client.chamadas], ["feito", ["BEGIN", "SET", "SET", "SELECT", "COMMIT"]]);
    eq("transação normal: conexão devolvida ao pool sem erro, uma vez", client.liberacoes, ["ok"]);
  }
  {
    const { client, pool: pf } = poolFalso((n) => (n === 5 ? NUNCA() : Promise.resolve({ rows: [] })));
    let depois = null;
    const r = await comRelogio(repository.withTransaction(async (db) => {
      await db.query("INSERT 1");
      try { await db.query("INSERT 2"); } catch (e) { depois = e; throw e; }
    }, { pool: pf, queryTimeoutMs: 40 }), 1000);
    ok("query presa no meio da transação: rejeita no prazo (não pendura)", r.terminou && r.erro && r.erro.code === "PG_QUERY_TIMEOUT");
    eq("a conexão presa é DESCARTADA (release com erro), exatamente uma vez", client.liberacoes, ["PG_QUERY_TIMEOUT"]);
    ok("nenhum ROLLBACK foi enviado para a conexão presa (ele também penduraria)", !client.chamadas.includes("ROLLBACK"));
    ok("a mensagem diz o prazo", /40 ms/.test(r.erro.message));
    // Uma query posterior no mesmo `db` falha na hora (a conexão foi descartada).
    const { pool: pf2 } = poolFalso((n) => (n === 4 ? NUNCA() : Promise.resolve({ rows: [] })));
    let segunda = null;
    await comRelogio(repository.withTransaction(async (db) => {
      const primeira = db.query("INSERT A").catch((e) => e);
      await primeira;
      segunda = await comRelogio(db.query("INSERT B").then(() => "passou", (e) => e), 200);
    }, { pool: pf2, queryTimeoutMs: 30 }).catch(() => {}), 1000);
    ok("query posterior na conexão descartada rejeita imediatamente", segunda && segunda.terminou && segunda.valor && segunda.valor.code === "PG_QUERY_TIMEOUT");
  }
  {
    const { client, pool: pf } = poolFalso((n, sql) => (/^COMMIT/.test(sql) ? NUNCA() : Promise.resolve({ rows: [] })));
    const r = await comRelogio(repository.withTransaction(async () => "x", { pool: pf, queryTimeoutMs: 40 }), 1000);
    ok("COMMIT sem resposta também respeita o prazo e descarta a conexão", r.terminou && r.erro && r.erro.code === "PG_QUERY_TIMEOUT" && client.liberacoes.join() === "PG_QUERY_TIMEOUT");
  }
  {
    const { client, pool: pf } = poolFalso(async () => ({ rows: [] }));
    let recebido = null;
    await repository.withTransaction(async (db) => { recebido = db; }, { pool: pf });
    ok("sem queryTimeoutMs o comportamento é o de antes: o callback recebe o próprio client", recebido === client);
    const { client: c2, pool: pf2 } = poolFalso(async (n, sql) => { if (n === 4) throw Object.assign(new Error("boom"), { code: "XX" }); return { rows: [] }; });
    await repository.withTransaction(async (db) => { await db.query("X"); }, { pool: pf2, queryTimeoutMs: 50 }).catch(() => {});
    eq("erro comum (não timeout) continua fazendo ROLLBACK e devolvendo a conexão", [c2.chamadas.at(-1), c2.liberacoes], ["ROLLBACK", ["ok"]]);
  }

  // 3b. persistCentralVendasImport de ponta a ponta contra um cliente que trava no 3º INSERT.
  {
    const original = pool.connect;
    const client = {
      n: 0, liberacoes: [], chamadas: [],
      query(sql) {
        this.n += 1; this.chamadas.push(String(sql).trim().split(/\s+/)[0]);
        if (this.n === 6) return NUNCA(); // BEGIN, SET, SET, createImport, 1º INSERT de pedido, 2º => trava
        return Promise.resolve({ rows: [{ id: this.n, competencia: "2026-09" }] });
      },
      release(err) { this.liberacoes.push(err ? err.code : "ok"); },
    };
    pool.connect = async () => client;
    process.env.CENTRAL_VENDAS_DB_QUERY_TIMEOUT_MS = "40";
    try {
      const payload = { pedidos: [{ pedidoId: "1" }, { pedidoId: "2" }, { pedidoId: "3" }], itens: [], componentes: [] };
      const r = await comRelogio(repository.persistCentralVendasImport({
        cliente: { id: 1, slug: "x" }, marketplace: "meli", competencia: "2026-09",
        motorPayload: payload, resumo: {}, fonte: "orders_api", syncRunId: 5, publicationStatus: "candidate",
      }), 1500);
      ok("persistCentralVendasImport com query presa NÃO fica pendurada (antes: para sempre)", r.terminou && r.erro && r.erro.code === "PG_QUERY_TIMEOUT");
      eq("a conexão da gravação presa foi descartada", client.liberacoes, ["PG_QUERY_TIMEOUT"]);
      ok("nenhum COMMIT foi enviado (a transação nunca confirma meio import)", !client.chamadas.includes("COMMIT"));
    } finally {
      pool.connect = original;
      delete process.env.CENTRAL_VENDAS_DB_QUERY_TIMEOUT_MS;
    }
  }

  // ---------------------------------------------------------------------------
  // 4. ML: timeout de coleta é transitório para as páginas de orders (retry), mas o prazo ESGOTADO não é
  // ---------------------------------------------------------------------------
  {
    const t = (code, name = "MlTimeoutError") => Object.assign(new Error(code), { name, code });
    ok("ML_TIMEOUT (sem resposta no prazo) é erro transitório => retry", syncService.isErroTransitorioDeRede(t("ML_TIMEOUT")) === true);
    ok("ML_DEADLINE_EXCEEDED (prazo esgotado antes de enviar) NÃO é transitório", syncService.isErroTransitorioDeRede(t("ML_DEADLINE_EXCEEDED")) === false);
    ok("ML_ABORTED NÃO é transitório", syncService.isErroTransitorioDeRede(t("ML_ABORTED")) === false);
    ok("erro de negócio do token (ML_*) continua permanente", syncService.isErroTransitorioDeRede(Object.assign(new Error("x"), { code: "ML_GRANT_REVOGADO" })) === false);
    ok("TimeoutError do fetch continua transitório", syncService.isErroTransitorioDeRede(Object.assign(new Error("t"), { name: "TimeoutError" })) === true);
    // fetchAllOrders: uma página que estoura o prazo 1x é repetida e a coleta conclui.
    let chamadas = 0;
    const mlFetchFn = async () => {
      chamadas += 1;
      if (chamadas === 1) throw t("ML_TIMEOUT");
      return { ok: true, status: 200, data: { results: [], paging: { total: 0, offset: 0, limit: 50 } } };
    };
    const r = await syncService.fetchAllOrders(1, "S1", "2026-09-01", "2026-09-30", { mlFetchFn, sleepFn: async () => {}, maxAttempts: 3 });
    ok("fetchAllOrders: 1 timeout de página + retry => coleta concluída e completa", chamadas === 2 && r && Array.isArray(r.data) && r.completeness.complete === true);
  }

  // 5. Contrato dos pontos de chamada: a coleta da Central usa SEMPRE os wrappers com prazo.
  {
    const lerFonte = (f) => fs.readFileSync(path.join(__dirname, "..", "services", "centralVendas", f), "utf8");
    for (const [arq, padrao, base] of [
      ["centralVendasSyncService.js", /mlFetchFn = mlFetchCentral/, /const mlFetchCentral = comPrazoPadrao\(mlFetch, "mlMs"\)/],
      ["centralVendasClaimsService.js", /mlFetchFn = mlFetchCentral/, /const mlFetchCentral = comPrazoPadrao\(mlFetch, "mlMs"\)/],
      ["centralVendasFreteService.js", /mlFetchFn = mlFetchCentral/, /const mlFetchCentral = comPrazoPadrao\(mlFetch, "mlMs"\)/],
      ["centralVendasMpPaymentsService.js", /mpFetchFn = mpFetchCentral/, /const mpFetchCentral = comPrazoPadrao\(mpFetch, "mpMs"\)/],
    ]) {
      const src = lerFonte(arq);
      ok(`${arq}: o padrão é o fetch COM prazo`, padrao.test(src));
      ok(`${arq}: o wrapper envolve o fetch do require do topo (stub no carregamento continua valendo)`, base.test(src));
      ok(`${arq}: nenhum default sem prazo (mlFetchFn = mlFetch / mpFetchFn = mpFetch)`, !/(mlFetchFn = mlFetch\b(?!Central))|(mpFetchFn = mpFetch\b(?!Central))/.test(src));
    }
    const rep = lerFonte("centralVendasRepository.js");
    const trecho = rep.slice(rep.indexOf("async function persistCentralVendasImport"));
    ok("persistCentralVendasImport passa queryTimeoutMs para a transação", /queryTimeoutMs:\s*prazos\(\)\.dbQueryMs/.test(trecho.slice(0, 3500)));
  }

  // 6. mpFetch: timeoutMs opt-in aborta o fetch pendurado (e não muda nada sem ele).
  {
    const tokenPath = require.resolve("../services/mlTokenService");
    const salvo = require.cache[tokenPath];
    require.cache[tokenPath] = { id: tokenPath, filename: tokenPath, loaded: true, exports: {
      sanitizeErrorMessage: (e) => String(e && e.message || e),
      getValidMlGrantToken: async () => ({ accessToken: "tok", grant: { id: 1 } }),
      getMlGrantTokenNoRefresh: async () => ({ accessToken: "tok", grant: { id: 1 } }),
      refreshMlGrant: async () => { throw new Error("não deveria"); },
    } };
    delete require.cache[require.resolve("../utils/mercadoPagoClient")];
    const mp = require("../utils/mercadoPagoClient");
    const fetchOriginal = global.fetch;
    let sinal = null;
    global.fetch = (url, opts) => { sinal = opts.signal; return NUNCA(); };
    const errConsole = console.error; console.error = () => {};
    try {
      const r = await comRelogio(mp.mpFetch(1, "/v1/payments/1", { mlUserId: "S1", timeoutMs: 40 }), 1000);
      ok("mpFetch com timeoutMs: fetch pendurado rejeita no prazo (código MP_TIMEOUT)", r.terminou && r.erro && r.erro.code === "MP_TIMEOUT");
      ok("o AbortSignal do fetch foi abortado (a requisição é cancelada de verdade)", sinal && sinal.aborted === true);
      global.fetch = async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ id: 1 }) });
      const sem = await mp.mpFetch(1, "/v1/payments/1", { mlUserId: "S1" });
      eq("sem timeoutMs o comportamento é o de antes", [sem.ok, sem.data], [true, { id: 1 }]);
      const com = await mp.mpFetch(1, "/v1/payments/1", { mlUserId: "S1", timeoutMs: 500 });
      eq("com timeoutMs e resposta rápida: resultado normal", [com.ok, com.data], [true, { id: 1 }]);
    } finally {
      global.fetch = fetchOriginal; console.error = errConsole;
      if (salvo) require.cache[tokenPath] = salvo; else delete require.cache[tokenPath];
      delete require.cache[require.resolve("../utils/mercadoPagoClient")];
    }
  }

  // ---------------------------------------------------------------------------
  // 7. Rodada noturna: prazo por unidade (a vaga é devolvida) e prazo no fechamento do grupo
  // ---------------------------------------------------------------------------
  const contaRow = (i) => ({
    cliente_conta_id: i, cliente_id: i, marketplace: "meli", external_account_id: `ML${i}`, conta_ativa: true,
    conta_nome: `Conta ${i}`, cliente_slug: `cliente-${i}`, cliente_nome: `Cliente ${i}`, cliente_ativo: true,
  });
  function depsRodada({ travar = new Set(), unidadeTimeoutMs, fechamentoTimeoutMs, adsTrava = false, n = 5 }) {
    const rows = Array.from({ length: n }, (_, i) => contaRow(i + 1));
    const runs = new Map();
    const fechados = [];
    const executados = [];
    return {
      fechados, executados, runs,
      deps: {
        db: { async query(sql, p) { return { rows: sql.includes("central_vendas_imports") ? [{ id: p[0] * 10, competencia: "2026-09" }] : [] }; } },
        async listarContas() { return rows; },
        async ensureCentralVendasTables() {},
        async criarSyncRun(p) {
          const run = { id: 100 + p.clienteContaId, status: "queued", completenessStatus: null };
          runs.set(run.id, run);
          return { run, context: {}, reaproveitado: false };
        },
        async executarSyncRun({ run }) {
          executados.push(run.id);
          if (travar.has(run.id)) return NUNCA();
          run.status = "completed"; run.completenessStatus = "complete";
          return { ok: true };
        },
        async obterSyncRun({ runId }) { return runs.get(runId); },
        async marcarRunFailed(runId, info) {
          fechados.push([runId, info.code]);
          const r = runs.get(runId); if (r && r.status !== "completed") { r.status = "failed"; r.error = info; }
          return r;
        },
        async sincronizarAdsCliente({ contas }) { return adsTrava ? NUNCA() : { atualizado: true, contas: contas.length, investimentoAds: 0, gmvAds: 0 }; },
        async reconstruirSnapshotMensal() { return { atualizado: true }; },
        sleep: async () => {}, agora: () => Date.now(), observarIntervaloMs: 1, observarTimeoutMs: 5,
        logger, unidadeTimeoutMs, fechamentoTimeoutMs,
      },
    };
  }
  const periodo = [{ competencia: "2026-09", dateFrom: "2026-09-01", dateTo: "2026-09-30" }];

  // 7a. processarUnidade com executarSyncRun pendurado.
  {
    const { deps, fechados } = depsRodada({ travar: new Set([101]), unidadeTimeoutMs: 40 });
    const conta = { clienteId: 1, clienteSlug: "cliente-1", clienteContaId: 1, marketplace: "meli" };
    const t0 = Date.now();
    const r = await comRelogio(noturno.processarUnidade({ conta, periodo: periodo[0] }, deps), 2000);
    ok("unidade presa: processarUnidade devolve (a vaga é liberada) em vez de pendurar", r.terminou && r.valor);
    eq("a unidade vira falha com o código do prazo", [r.valor.status, r.valor.erro && r.valor.erro.code], ["falha", "UNIDADE_TIMEOUT"]);
    ok("a liberação aconteceu perto do prazo (não esperou o fim do mundo)", Date.now() - t0 < 1500);
    eq("o run da unidade presa é FECHADO como failed (SYNC_RUN_UNIT_TIMEOUT), não fica running para sempre", fechados, [[101, "SYNC_RUN_UNIT_TIMEOUT"]]);
  }

  // 7b. A rodada inteira: 3 unidades presas de 5, concorrência 3. Sem prazo a rodada TRAVA; com prazo termina.
  {
    const sem = depsRodada({ travar: new Set([101, 102, 103]), unidadeTimeoutMs: undefined });
    const pendurada = await comRelogio(noturno.executarRodada({ periodos: periodo, concorrencia: 3 }, sem.deps), 400);
    ok("SEM prazo por unidade, 3 presas ocupam as 3 vagas e a rodada NÃO termina (o incidente)", pendurada.terminou === false);
    ok("... e as unidades 4 e 5 nunca chegam a ser executadas", !sem.executados.includes(104) && !sem.executados.includes(105));

    const com = depsRodada({ travar: new Set([101, 102, 103]), unidadeTimeoutMs: 40 });
    const r = await comRelogio(noturno.executarRodada({ periodos: periodo, concorrencia: 3 }, com.deps), 3000);
    ok("COM prazo por unidade a rodada termina", r.terminou && r.valor);
    eq("resumo: 3 falhas por prazo + 2 concluídas (as unidades 4 e 5 executaram)", [r.valor.falha, r.valor.sucesso], [3, 2]);
    ok("as 5 unidades foram executadas", com.executados.length === 5);
    eq("os 3 runs presos foram fechados", com.fechados.map((x) => x[0]).sort(), [101, 102, 103]);
    ok("as falhas informam o código do prazo", r.valor.falhas.every((f) => f.erro && f.erro.code === "UNIDADE_TIMEOUT"));
  }

  // 7c. Fechamento do grupo (Ads) pendurado não segura a rodada.
  {
    const { deps } = depsRodada({ adsTrava: true, fechamentoTimeoutMs: 40, unidadeTimeoutMs: 1000, n: 2 });
    const r = await comRelogio(noturno.executarRodada({ periodos: periodo, concorrencia: 2 }, deps), 3000);
    ok("Ads pendurado: a rodada termina", r.terminou && r.valor);
    eq("Ads cai em ADS_NAO_ATUALIZADO com o código do prazo e o snapshot segue", [r.valor.ads.naoAtualizados, Object.keys(r.valor.ads.porMotivo)], [2, ["ADS_NAO_ATUALIZADO"]]);
  }

  // 7d. Sem hangs nada muda: todas concluem, nenhum run é fechado.
  {
    const { deps, fechados } = depsRodada({ unidadeTimeoutMs: 1000, fechamentoTimeoutMs: 1000 });
    const r = await noturno.executarRodada({ periodos: periodo, concorrencia: 3 }, deps);
    eq("rodada saudável: 5 sucessos, 0 falhas, nenhum run fechado pelo prazo", [r.sucesso, r.falha, fechados.length], [5, 0, 0]);
  }

  // ---------------------------------------------------------------------------
  // 8. O prazo CANCELA o trabalho abandonado (não só libera a vaga lógica)
  // ---------------------------------------------------------------------------
  // 8a. Transação: o prazo vira statement_timeout/idle_in_transaction NO SERVIDOR (SET LOCAL, só nesta transação).
  {
    const sqls = [];
    const pf = { connect: async () => ({ query(sql) { sqls.push(String(sql).trim()); return Promise.resolve({ rows: [] }); }, release() {} }) };
    await repository.withTransaction(async (db) => { await db.query("SELECT 1"); }, { pool: pf, queryTimeoutMs: 60000 });
    eq("SET LOCAL statement_timeout = prazo+5s e idle_in_transaction = 2x, depois do BEGIN e antes do callback",
      sqls.slice(0, 4), ["BEGIN", "SET LOCAL statement_timeout = 65000", "SET LOCAL idle_in_transaction_session_timeout = 130000", "SELECT 1"]);
    sqls.length = 0;
    await repository.withTransaction(async (db) => { await db.query("SELECT 1"); }, { pool: pf });
    eq("sem queryTimeoutMs nenhum SET LOCAL é emitido (comportamento anterior)", sqls, ["BEGIN", "SELECT 1", "COMMIT"]);
  }

  // 8b. Unidade: ao estourar o prazo o AbortSignal entregue ao trabalho é abortado; o trabalho para no próximo
  // ponto seguro e NÃO grava nada depois.
  {
    const { assertNaoCancelado } = require("../utils/comPrazo");
    let sinal = null; let gravouDepois = false; let parou = null;
    const { deps } = depsRodada({ unidadeTimeoutMs: 40, n: 1 });
    deps.executarSyncRun = async ({ signal }) => {
      sinal = signal;
      await esperar(120); // passa do prazo da unidade
      try { assertNaoCancelado(signal, "gravar"); gravouDepois = true; } catch (e) { parou = e; throw e; }
    };
    const r = await noturno.executarRodada({ periodos: periodo, concorrencia: 1 }, deps);
    await esperar(160);
    ok("executarSyncRun recebe um AbortSignal", sinal && typeof sinal.aborted === "boolean");
    ok("o sinal foi abortado quando o prazo da unidade estourou", sinal.aborted === true);
    ok("o trabalho abandonado parou no ponto seguro (UNIDADE_CANCELADA) e não gravou", gravouDepois === false && parou && parou.code === "UNIDADE_CANCELADA");
    ok("a rodada seguiu e contou a falha por prazo", r.falha === 1);
  }

  // 8c. Worker real: cancelado depois de coletar => não completa, não publica, não enfileira margem.
  {
    const worker = require("../services/centralVendas/centralVendasSyncWorker");
    const queries = [];
    const dbFalso = { async query(sql) { queries.push(String(sql)); return /RETURNING/.test(sql) ? { rows: [{ id: 9, status: "running" }] } : { rows: [] }; } };
    const ctrl = new AbortController();
    let enfileirou = false;
    const err = await worker.executarSyncRun({
      run: { id: 9 }, context: {}, params: { clienteSlug: "x", dateFrom: "2026-09-01", dateTo: "2026-09-30", marketplace: "meli" },
      db: dbFalso, signal: ctrl.signal,
      sincronizarVendasMeli: async () => { ctrl.abort(); return { ordersEncontrados: 1 }; },
      marginSnapshotEnqueue: async () => { enfileirou = true; return { enfileirado: true, runId: 1 }; },
    }).then(() => null, (e) => e);
    ok("worker: execução cancelada rejeita com UNIDADE_CANCELADA", err && err.code === "UNIDADE_CANCELADA");
    ok("worker: nunca tentou marcar o run como completed", !queries.some((q) => /status = 'completed'/.test(q)));
    ok("worker: nunca tentou publicar (nenhuma promoção de import a published)", !queries.some((q) => /published/.test(q)));
    ok("worker: não enfileirou margin snapshot", enfileirou === false);
    // Sem cancelamento tudo segue como antes (o caminho saudável continua marcando completed).
    const q2 = [];
    const db2 = { async query(sql) { q2.push(String(sql)); return /RETURNING/.test(sql) ? { rows: [{ id: 9, status: "running" }] } : { rows: [] }; } };
    await worker.executarSyncRun({
      run: { id: 9 }, context: {}, params: { clienteSlug: "x", dateFrom: "2026-09-01", dateTo: "2026-09-30", marketplace: "meli" },
      db: db2, signal: new AbortController().signal,
      sincronizarVendasMeli: async () => ({ ordersEncontrados: 1 }),
      marginSnapshotEnqueue: async () => ({ enfileirado: false }),
    }).catch(() => {});
    ok("worker saudável (sinal não abortado): tenta marcar completed como sempre", q2.some((q) => /status = 'completed'/.test(q)));
  }

  // 8d. Coleta: o sinal chega ao mlFetch e uma página não é pedida depois do cancelamento.
  {
    const ctrl = new AbortController();
    const vistos = [];
    const err = await syncService.fetchAllOrders(1, "S1", "2026-09-01", "2026-09-30", {
      mlFetchFn: async (c, p, o) => {
        vistos.push(o.signal === ctrl.signal);
        ctrl.abort();
        return { ok: true, status: 200, data: { results: [{ id: 1 }], paging: { total: 5000, offset: 0, limit: 50 } } };
      },
      sleepFn: async () => {}, signal: ctrl.signal,
    }).then(() => null, (e) => e);
    ok("fetchAllOrders repassa o signal ao mlFetch", vistos[0] === true);
    ok("fetchAllOrders para depois do cancelamento (1 página, UNIDADE_CANCELADA)", vistos.length === 1 && err && err.code === "UNIDADE_CANCELADA");
  }

  // 8e. Contrato (a função inteira de sync é pesada demais para um fake): toda gravação do import e cada etapa de
  // coleta são precedidas da checagem de cancelamento.
  {
    const fonte = fs.readFileSync(path.join(__dirname, "..", "services", "centralVendas", "centralVendasSyncService.js"), "utf8");
    ok("a gravação de cada competência é precedida de assertNaoCancelado",
      /assertNaoCancelado\(signal, "gravar o import da competência"\);\s*const persisted = await repository\.persistCentralVendasImport\(/.test(fonte));
    ok("a checagem antes de frete/pós-venda/pagamentos existe", /assertNaoCancelado\(signal, "frete\/pós-venda\/pagamentos"\)/.test(fonte));
    ok("a checagem a cada página de pedidos existe", /assertNaoCancelado\(signal, "página de pedidos"\)/.test(fonte));
    ok("o sinal é repassado de sincronizarVendasMeli para a coleta de pedidos", /fetchAllOrders\(cliente\.id, sellerId, from, to, signal \? \{ signal \} : \{\}\)/.test(fonte));
  }

  concluido = true;
  console.log(`centralVendasPrazos.test.js: ${checks} verificacoes OK`);
}

main().catch((err) => { console.error(err); process.exit(1); });
