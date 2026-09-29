// server/tests/centralVendasNoturnoDeadlockPreparacao.test.js
//
// Deadlock 40P01 na PREPARAÇÃO concorrente do sync noturno. Cobre a metade do
// orquestrador (centralVendasNoturnoService.executarRodada):
//   A  10 contas / concorrência 3: todas preparadas e tentadas, schema 1x
//   D  40P01 transitório na preparação: retry, unidade segue, sem run duplicado
//   E  40P01 permanente: só ESSA unidade falha; as seguintes continuam
//   F  erro não transitório (23505): sem retry
//   -  ensure roda ANTES de qualquer pool de concorrência (e não no dry-run)
//   -  40001 também é transitório; log de retry sem segredos
//
// Tudo injetado; NENHUM banco real (DATABASE_URL aponta para porta morta).

process.env.DATABASE_URL = "postgres://nobody@127.0.0.1:1/teste-sem-banco";

const assert = require("assert");
const svc = require("../services/centralVendas/centralVendasNoturnoService");

let checks = 0;
let concluido = false;
process.on("exit", () => {
  if (!concluido) {
    console.error(`centralVendasNoturnoDeadlockPreparacao.test.js: NÃO concluiu (parou após ${checks} verificações)`);
    process.exitCode = 1;
  }
});
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
}
function eq(label, actual, expected) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${label} — recebido ${JSON.stringify(actual)}`);
  checks += 1;
}

const PERIODOS = [{ competencia: "2026-09", dateFrom: "2026-09-01", dateTo: "2026-09-23" }];
const SEGREDO = "APP_USR-1122334455-segredo";

function contaRow(contaId) {
  return {
    cliente_conta_id: contaId,
    cliente_id: contaId,
    marketplace: "meli",
    external_account_id: `ML${contaId}`,
    conta_ativa: true,
    conta_nome: `Conta ${contaId}`,
    cliente_slug: `cli${contaId}`,
    cliente_nome: `CLI${contaId}`,
    cliente_ativo: true,
  };
}

function erroPg(code, message = `pg ${code} Bearer ${SEGREDO}`) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// `falhasCriar[contaId]` = lista de erros (ou null = sucesso) por tentativa.
function makeDeps({ contas, falhasCriar = {}, ordemEventos = [] }) {
  const logs = [];
  const logger = {
    log: (...a) => logs.push(a.join(" ")),
    warn: (...a) => logs.push(a.join(" ")),
    error: (...a) => logs.push(a.join(" ")),
  };
  const tentativasCriar = {}; // contaId → nº de chamadas a criarSyncRun
  const runsCriados = []; // contaId de cada run REALMENTE criado
  const executadas = [];
  const esperas = [];
  let ensureChamadas = 0;
  let ensureConcluido = false;
  let emVooPreparacao = 0;
  let maxEmVooPreparacao = 0;
  let proximoRunId = 1;
  const runs = new Map();

  const deps = {
    db: {
      async query(sql, params) {
        if (sql.includes("FROM central_vendas_imports") && sql.includes("sync_run_id = $1")) {
          return { rows: runs.get(params[0])?.publicado ? [{ id: 1, competencia: "2026-09" }] : [] };
        }
        throw new Error(`SQL inesperado no teste: ${sql.slice(0, 80)}`);
      },
    },
    async listarContas() { return contas; },
    async ensureCentralVendasTables() {
      ensureChamadas += 1;
      ordemEventos.push("ensure:inicio");
      await new Promise((r) => setTimeout(r, 5));
      ensureConcluido = true;
      ordemEventos.push("ensure:fim");
    },
    async criarSyncRun(p) {
      // O schema TEM de estar garantido antes de qualquer preparação.
      if (!ensureConcluido) throw new Error("criarSyncRun chamado antes do ensure concluir");
      const id = p.clienteContaId;
      tentativasCriar[id] = (tentativasCriar[id] || 0) + 1;
      ordemEventos.push(`criar:${id}`);
      emVooPreparacao += 1;
      maxEmVooPreparacao = Math.max(maxEmVooPreparacao, emVooPreparacao);
      try {
        await new Promise((r) => setTimeout(r, 3));
        const roteiro = falhasCriar[id];
        const falha = roteiro ? roteiro[Math.min(tentativasCriar[id], roteiro.length) - 1] : null;
        if (falha) throw falha;
      } finally {
        emVooPreparacao -= 1;
      }
      const runId = proximoRunId++;
      runs.set(runId, { id: runId, status: "queued", publicado: false, contaId: id });
      runsCriados.push(id);
      return { run: { id: runId, status: "queued" }, context: { conta: { id } }, reaproveitado: false };
    },
    async executarSyncRun({ run }) {
      executadas.push(runs.get(run.id).contaId);
      const r = runs.get(run.id);
      r.status = "completed";
      r.publicado = true;
      return { ok: true };
    },
    async obterSyncRun({ runId }) {
      const r = runs.get(runId);
      return { id: r.id, status: r.status, completenessStatus: "complete", error: null };
    },
    async sincronizarAdsCliente(p) { return { atualizado: true, contas: p.contas.length, investimentoAds: 1, gmvAds: 2 }; },
    async reconstruirSnapshotMensal() { return { atualizado: true, motivo: null, sincronizadoEm: new Date(0).toISOString() }; },
    sleep: async (ms) => { esperas.push(ms); },
    random: () => 0,
    agora: () => 1_000_000,
    observarIntervaloMs: 1,
    observarTimeoutMs: 10,
    logger,
  };
  return {
    deps, logs, tentativasCriar, runsCriados, executadas, esperas,
    ensureChamadas: () => ensureChamadas,
    maxEmVooPreparacao: () => maxEmVooPreparacao,
  };
}

async function run() {
  // =========================================================================
  // A — 10 contas, concorrência 3: nenhuma some depois das 3 primeiras
  // =========================================================================
  {
    const contas = Array.from({ length: 10 }, (_, i) => contaRow(i + 1));
    const ordemEventos = [];
    const h = makeDeps({ contas, ordemEventos });
    const resumo = await svc.executarRodada({ periodos: PERIODOS, concorrencia: 3 }, h.deps);

    eq("A: schema garantido UMA vez na rodada", h.ensureChamadas(), 1);
    eq("A: ensure vem antes de qualquer preparação", ordemEventos.slice(0, 2), ["ensure:inicio", "ensure:fim"]);
    eq("A: as 10 contas foram preparadas (1 tentativa cada)", Object.keys(h.tentativasCriar).length, 10);
    ok("A: nenhuma preparação precisou de retry", Object.values(h.tentativasCriar).every((n) => n === 1));
    eq("A: 10 runs criados", h.runsCriados.length, 10);
    eq("A: as 10 foram tentadas (executadas)", [...h.executadas].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    ok("A: preparação respeitou concorrência máxima 3", h.maxEmVooPreparacao() <= 3 && h.maxEmVooPreparacao() >= 2);
    eq("A: resumo — elegíveis/execuções/sucesso/falha", [resumo.elegiveis, resumo.execucoes, resumo.sucesso, resumo.falha], [10, 10, 10, 0]);
  }

  // O ensure NÃO roda no dry-run (dry-run continua sem tocar o schema).
  {
    const h = makeDeps({ contas: [contaRow(1), contaRow(2)] });
    const resumo = await svc.executarRodada({ periodos: PERIODOS, concorrencia: 3, dryRun: true }, h.deps);
    eq("dry-run: não executa ensure", h.ensureChamadas(), 0);
    eq("dry-run: não cria runs", h.runsCriados.length, 0);
    eq("dry-run: lista as unidades", resumo.execucoes, 2);
  }

  // Ensure que falha é erro estrutural: a rodada sobe o erro antes de preparar.
  {
    const h = makeDeps({ contas: [contaRow(1)] });
    h.deps.ensureCentralVendasTables = async () => { throw new Error("schema indisponível"); };
    let erro = null;
    try { await svc.executarRodada({ periodos: PERIODOS, concorrencia: 3 }, h.deps); } catch (e) { erro = e; }
    ok("ensure falho: rodada sobe o erro", erro && /schema indisponível/.test(erro.message));
    eq("ensure falho: nenhuma unidade foi preparada", Object.keys(h.tentativasCriar).length, 0);
  }

  // =========================================================================
  // D — 40P01 transitório: retry, unidade segue, run NÃO duplicado
  // =========================================================================
  {
    const contas = [1, 2, 3, 4].map(contaRow);
    const h = makeDeps({ contas, falhasCriar: { 2: [erroPg("40P01"), null] } });
    const resumo = await svc.executarRodada({ periodos: PERIODOS, concorrencia: 3 }, h.deps);

    eq("D: conta 2 tentou 2 vezes", h.tentativasCriar[2], 2);
    eq("D: run da conta 2 criado UMA vez (sem duplicar)", h.runsCriados.filter((c) => c === 2).length, 1);
    ok("D: conta 2 seguiu e foi executada", h.executadas.includes(2));
    eq("D: 4 sucessos, nenhuma falha", [resumo.sucesso, resumo.falha], [4, 0]);
    eq("D: dormiu uma vez com backoff curto", h.esperas.length, 1);
    ok("D: backoff curto (< 1s)", h.esperas[0] > 0 && h.esperas[0] < 1000);
    const logRetry = h.logs.find((l) => l.includes("preparação retry"));
    ok("D: log de retry no formato pedido", logRetry === "[cron-central] preparação retry 2/3 cliente=cli2 conta=2 erro=40P01");
    ok("D: log não vaza segredo", !h.logs.some((l) => l.includes(SEGREDO)));
  }

  // 40001 (serialization_failure) também é transitório.
  {
    const h = makeDeps({ contas: [contaRow(1)], falhasCriar: { 1: [erroPg("40001"), erroPg("40P01"), null] } });
    const resumo = await svc.executarRodada({ periodos: PERIODOS, concorrencia: 3 }, h.deps);
    eq("40001: 3ª tentativa passa", h.tentativasCriar[1], 3);
    eq("40001: sucesso final", [resumo.sucesso, resumo.falha], [1, 0]);
    eq("40001: 2 esperas (entre as 3 tentativas)", h.esperas.length, 2);
  }

  // =========================================================================
  // E — 40P01 permanente: só essa unidade falha; as demais continuam
  // =========================================================================
  {
    const contas = Array.from({ length: 10 }, (_, i) => contaRow(i + 1));
    const permanente = [erroPg("40P01"), erroPg("40P01"), erroPg("40P01"), erroPg("40P01")];
    const h = makeDeps({ contas, falhasCriar: { 3: permanente } });
    const resumo = await svc.executarRodada({ periodos: PERIODOS, concorrencia: 3 }, h.deps);

    eq("E: conta 3 tentou exatamente 3 vezes (máximo)", h.tentativasCriar[3], 3);
    ok("E: conta 3 nunca executou", !h.executadas.includes(3));
    eq("E: as outras 9 foram executadas", [...h.executadas].sort((a, b) => a - b), [1, 2, 4, 5, 6, 7, 8, 9, 10]);
    eq("E: resumo — 9 sucessos, 1 falha, 10 execuções", [resumo.sucesso, resumo.falha, resumo.execucoes], [9, 1, 10]);
    eq("E: falha registrada com code 40P01 na conta certa", [resumo.falhas.length, resumo.falhas[0].contaId, resumo.falhas[0].erro.code], [1, 3, "40P01"]);
    ok("E: mensagem da falha sanitizada", !JSON.stringify(resumo.falhas).includes(SEGREDO));
  }

  // =========================================================================
  // F — erro não transitório: sem retry
  // =========================================================================
  {
    const contas = [1, 2, 3].map(contaRow);
    const h = makeDeps({ contas, falhasCriar: { 2: [erroPg("23505", "duplicate key value violates unique constraint")] } });
    const resumo = await svc.executarRodada({ periodos: PERIODOS, concorrencia: 3 }, h.deps);
    eq("F: 23505 = 1 tentativa só", h.tentativasCriar[2], 1);
    eq("F: sem espera de retry", h.esperas.length, 0);
    ok("F: sem log de retry", !h.logs.some((l) => l.includes("preparação retry")));
    eq("F: conta 2 falha, as outras seguem", [resumo.sucesso, resumo.falha], [2, 1]);
  }

  concluido = true;
  console.log(`centralVendasNoturnoDeadlockPreparacao.test.js: ${checks} verificações OK`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
