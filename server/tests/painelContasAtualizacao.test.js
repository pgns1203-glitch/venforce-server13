// server/tests/painelContasAtualizacao.test.js
//
// "Atualizar dados" do Painel de Contas (painelContasAtualizacao) sem banco e
// sem Mercado Livre. O orquestrador usado é o executarRodada REAL da rodada
// noturna — só as portas externas (criar/executar/obter run, Ads, snapshot,
// imports publicados) são falsas. Assim o teste prova que a atualização sob
// demanda REUSA o motor, em vez de só conferir que "chamou alguma coisa".
//
//   1  período: mês corrente → dia 1..HOJE (SP); mês anterior → mês completo
//   2  gate: só admin; competência inválida/futura; carteira
//   3  só contas ML ativas e conectadas sincronizam; o resto vira "ignorada"
//   4  run com requested_by = quem clicou e sem reaproveitar run publicado
//   5  falha de UMA conta é reportada por conta, com mensagem clara
//   6  duas atualizações do mesmo escopo → 409 (memória e advisory lock)
//   7  erro estrutural → job "falhou", lock sempre liberado
//   8  job concluído fica consultável pela retenção, depois some

process.env.DATABASE_URL = "postgres://nobody@127.0.0.1:1/teste-sem-banco";

const assert = require("assert");
const atualizacao = require("../services/painelContas/painelContasAtualizacao");
const noturno = require("../services/centralVendas/centralVendasNoturnoService");

let checks = 0;
let concluido = false;
process.on("exit", () => {
  if (!concluido) {
    console.error(`painelContasAtualizacao.test.js: NÃO concluiu (parou após ${checks} verificações)`);
    process.exitCode = 1;
  }
});
function ok(label, cond) {
  assert.ok(cond, `FALHOU: ${label}`);
  checks += 1;
}
function eq(label, actual, expected) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${label} — recebido ${JSON.stringify(actual)}`);
  checks += 1;
}
async function rejeita(label, promessa, status, code) {
  try {
    await promessa;
  } catch (err) {
    eq(`${label} (status)`, err.statusCode, status);
    if (code) eq(`${label} (code)`, err.code, code);
    return err;
  }
  throw new Error(`FALHOU: ${label} — não rejeitou`);
}

const ADMIN = { id: 1, role: "admin", nome: "Admin" };
const MEMBRO = { id: 2, role: "membro", nome: "Ana" };
const AGORA = new Date("2026-09-29T15:00:00Z"); // 12:00 em São Paulo
const silencioso = { log() {}, warn() {}, error() {} };

// cliente_contas (formato de centralVendasNoturnoService.listarContas)
function linhaConta(id, over = {}) {
  return {
    cliente_conta_id: id, cliente_id: 7, marketplace: "meli", external_account_id: `ML${id}`,
    conta_ativa: true, conta_nome: `LOJA ${id}`, cliente_slug: "amr", cliente_nome: "AMR", cliente_ativo: true, ...over,
  };
}
const CONTAS = [
  linhaConta(71),
  linhaConta(72),
  linhaConta(73, { external_account_id: null }), // ML não conectado
  linhaConta(74, { conta_ativa: false }), // inativa: fora do consolidado
  linhaConta(81, { cliente_id: 8, cliente_slug: "outro", cliente_nome: "Outro" }), // outro cliente
];

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// Portas externas do orquestrador noturno. `falhar` = contas cujo criarSyncRun
// lança (erro com code), como faria resolveMarketplaceAccountContext.
function fakesOrquestrador({ falhar = {}, gate = null } = {}) {
  const chamadas = { criarSyncRun: [], executarSyncRun: [], ads: [], snapshot: [] };
  const fakes = {
    ensureCentralVendasTables: async () => {},
    criarSyncRun: async (args) => {
      chamadas.criarSyncRun.push(args);
      if (gate) await gate.promise;
      if (falhar[args.clienteContaId]) {
        const e = new Error(`erro ${falhar[args.clienteContaId]}`);
        e.code = falhar[args.clienteContaId];
        throw e;
      }
      return { run: { id: args.clienteContaId * 10, status: "queued" }, context: {}, reaproveitado: false };
    },
    executarSyncRun: async (job) => { chamadas.executarSyncRun.push(job.params); return { ok: true }; },
    obterSyncRun: async ({ runId }) => ({ id: runId, status: "completed", completenessStatus: "complete" }),
    sincronizarAdsCliente: async (a) => { chamadas.ads.push(a); return { atualizado: true, contas: a.contas.length, investimentoAds: 1, gmvAds: 2 }; },
    reconstruirSnapshotMensal: async (a) => { chamadas.snapshot.push(a); return { atualizado: true, sincronizadoEm: AGORA.toISOString() }; },
    sleep: async () => {},
    random: () => 0,
    agora: () => AGORA.getTime(),
    logger: silencioso,
  };
  return { chamadas, fakes };
}

function montarDeps({ orquestrador, lock = null, carteira = null, hoje = "2026-09-29", agora = AGORA } = {}) {
  const locks = { adquiridos: 0, liberados: 0 };
  const deps = {
    db: { query: async () => ({ rows: [{ id: 1, competencia: "2026-09" }] }) }, // imports publicados do run
    assertClienteNaCarteira: carteira || (async (_u, ref) => {
      if (String(ref) !== "7") { const e = new Error("fora"); e.statusCode = 403; e.code = "CLIENTE_FORA_DA_CARTEIRA"; throw e; }
      return { id: 7, slug: "amr", nome: "AMR" };
    }),
    listarContas: async () => CONTAS,
    // O orquestrador REAL, com as portas externas trocadas. As portas que o
    // serviço injeta (listarContas, criarSyncRun, logger) passam por cima.
    executarRodada: (opts, over) => noturno.executarRodada(opts, {
      ...orquestrador.fakes,
      ...over,
      criarSyncRun: over.criarSyncRun,
    }),
    criarSyncRun: orquestrador.fakes.criarSyncRun,
    adquirirLock: lock || (async () => {
      locks.adquiridos += 1;
      return { adquirido: true, liberar: async () => { locks.liberados += 1; } };
    }),
    hoje: () => hoje,
    agora: () => agora,
    env: {},
    logger: silencioso,
  };
  return { deps, locks };
}

async function run() {
  // ===========================================================================
  // 1 — período
  // ===========================================================================
  eq("mês corrente → dia 1 até HOJE, incluindo o dia parcial",
    atualizacao.periodoSobDemanda("2026-09", "2026-09-29"),
    { competencia: "2026-09", dateFrom: "2026-09-01", dateTo: "2026-09-29", incluiHoje: true, mesCompleto: false });
  eq("mês anterior → mês completo, nunca até hoje",
    atualizacao.periodoSobDemanda("2026-08", "2026-09-29"),
    { competencia: "2026-08", dateFrom: "2026-08-01", dateTo: "2026-08-31", incluiHoje: false, mesCompleto: true });
  eq("fevereiro de ano bissexto fecha no dia 29", atualizacao.periodoSobDemanda("2028-02", "2028-03-01").dateTo, "2028-02-29");
  eq("dia 1 do mês: o mês corrente é só hoje", atualizacao.periodoSobDemanda("2026-10", "2026-10-01").dateTo, "2026-10-01");
  eq("dezembro do ano anterior completo", atualizacao.periodoSobDemanda("2025-12", "2026-01-15").dateTo, "2025-12-31");
  assert.throws(() => atualizacao.periodoSobDemanda("2026-10", "2026-09-29"), (e) => e.statusCode === 400 && e.code === "COMPETENCIA_FUTURA");
  checks += 1;

  // ===========================================================================
  // 2 — gate
  // ===========================================================================
  {
    atualizacao._limparParaTestes();
    const orq = fakesOrquestrador();
    const { deps, locks } = montarDeps({ orquestrador: orq });
    await rejeita("membro não atualiza sob demanda", atualizacao.iniciarAtualizacao(MEMBRO, "7", "2026-09", deps), 403, "SEM_PERMISSAO");
    await rejeita("competência inválida", atualizacao.iniciarAtualizacao(ADMIN, "7", "2026-13", deps), 400, "COMPETENCIA_INVALIDA");
    await rejeita("competência futura", atualizacao.iniciarAtualizacao(ADMIN, "7", "2026-10", deps), 400, "COMPETENCIA_FUTURA");
    await rejeita("cliente fora da carteira", atualizacao.iniciarAtualizacao(ADMIN, "8", "2026-09", deps), 403, "CLIENTE_FORA_DA_CARTEIRA");
    eq("nenhum gate recusado tocou no sync nem no lock", [orq.chamadas.criarSyncRun.length, locks.adquiridos], [0, 0]);
  }

  // ===========================================================================
  // 3/4/5 — execução com o orquestrador real; uma conta falha
  // ===========================================================================
  {
    atualizacao._limparParaTestes();
    const orq = fakesOrquestrador({ falhar: { 72: "GRANT_UNAVAILABLE" } });
    const { deps, locks } = montarDeps({ orquestrador: orq });
    const { atualizacao: inicial, execucao } = await atualizacao.iniciarAtualizacao(ADMIN, "7", "2026-09", deps);

    eq("resposta imediata: executando", inicial.estado, "executando");
    eq("resposta traz o período até hoje", [inicial.periodo.dateFrom, inicial.periodo.dateTo, inicial.periodo.incluiHoje], ["2026-09-01", "2026-09-29", true]);
    eq("contas do job: 2 elegíveis + 1 ignorada (inativa e de outro cliente ficam fora)",
      inicial.contas.map((c) => [c.contaId, c.estado]), [[71, "pendente"], [72, "pendente"], [73, "ignorada"]]);
    ok("resposta pública não expõe o lock", !("lock" in inicial) && !("iniciadaPorId" in inicial));

    const job = await execucao;
    eq("criarSyncRun só para as contas elegíveis do cliente", orq.chamadas.criarSyncRun.map((a) => a.clienteContaId).sort(), [71, 72]);
    ok("run pedido por quem clicou e sem reaproveitar run publicado",
      orq.chamadas.criarSyncRun.every((a) => a.requestedBy === 1 && a.reutilizarCompletedPublicado === false));
    ok("período do run = dia 1 → hoje", orq.chamadas.criarSyncRun.every((a) => a.dateFrom === "2026-09-01" && a.dateTo === "2026-09-29"));
    eq("executarSyncRun (o motor da Central) roda para a conta criada", orq.chamadas.executarSyncRun.map((p) => [p.clienteSlug, p.dateFrom, p.dateTo]), [["amr", "2026-09-01", "2026-09-29"]]);

    const porConta = new Map(job.contas.map((c) => [c.contaId, c]));
    eq("conta 71 atualizada", [porConta.get(71).estado, porConta.get(71).mensagem], ["ok", null]);
    eq("conta 72 falhou com causa legível", [porConta.get(72).estado, porConta.get(72).erroCodigo], ["falha", "GRANT_UNAVAILABLE"]);
    ok("mensagem da falha fala a língua da operação", /reconecte/i.test(porConta.get(72).mensagem));
    eq("conta 73 ignorada: ML não conectado", [porConta.get(73).estado, porConta.get(73).mensagem], ["ignorada", "Mercado Livre não conectado."]);
    eq("job termina com pendências (não 'falhou': uma conta atualizou)", job.estado, "concluida_com_pendencias");
    eq("mensagem resume quantas contas", job.mensagem, "1 de 3 contas atualizadas.");
    eq("Ads não roda com venda incompleta (mesma regra do noturno)", [orq.chamadas.ads.length, job.ads.atualizado, job.ads.motivo], [0, false, "VENDAS_NAO_PUBLICADAS_PARA_TODAS_CONTAS"]);
    eq("snapshot reconstruído com o que publicou", [orq.chamadas.snapshot.length, job.snapshot.atualizado], [1, true]);
    eq("snapshot marcado com a origem sob demanda", orq.chamadas.snapshot[0].origem, "painel-sob-demanda");
    eq("lock liberado exatamente uma vez", [locks.adquiridos, locks.liberados], [1, 1]);
    eq("progresso final", [job.progresso.fase, job.progresso.concluidas, job.progresso.total], ["concluida", 2, 2]);

    const lida = await atualizacao.obterAtualizacao(ADMIN, "7", "2026-09", deps);
    eq("GET devolve o job concluído", [lida.id, lida.estado], [job.id, "concluida_com_pendencias"]);
  }

  // ===========================================================================
  // Sucesso completo + mês anterior (mês fechado)
  // ===========================================================================
  {
    atualizacao._limparParaTestes();
    const orq = fakesOrquestrador();
    const { deps } = montarDeps({ orquestrador: orq });
    const { execucao } = await atualizacao.iniciarAtualizacao(ADMIN, "7", "2026-08", deps);
    const job = await execucao;
    ok("mês anterior: run do mês completo", orq.chamadas.criarSyncRun.every((a) => a.dateFrom === "2026-08-01" && a.dateTo === "2026-08-31"));
    eq("todas publicadas → Ads e snapshot", [orq.chamadas.ads.length, orq.chamadas.snapshot.length], [1, 1]);
    eq("Ads do mesmo segmento", orq.chamadas.ads[0].segmento, { dateFrom: "2026-08-01", dateTo: "2026-08-31" });
    eq("conta não conectada continua pendente (ignorada)", job.estado, "concluida_com_pendencias");
  }

  // ===========================================================================
  // 6 — concorrência do mesmo escopo
  // ===========================================================================
  {
    atualizacao._limparParaTestes();
    const gate = deferred();
    const orq = fakesOrquestrador({ gate });
    const { deps, locks } = montarDeps({ orquestrador: orq });
    const { execucao } = await atualizacao.iniciarAtualizacao(ADMIN, "7", "2026-09", deps);
    await new Promise((r) => setImmediate(r));

    const err = await rejeita("2º clique no mesmo escopo → 409", atualizacao.iniciarAtualizacao(ADMIN, "7", "2026-09", deps), 409, "ATUALIZACAO_EM_ANDAMENTO");
    eq("409 devolve o job em andamento para a tela acompanhar", err.atualizacao?.estado, "executando");
    const emCurso = await atualizacao.obterAtualizacao(ADMIN, "7", "2026-09", deps);
    eq("GET durante a execução", emCurso.estado, "executando");
    eq("listar enxerga o job pelo registro (sem query)", atualizacao.atualizacaoDoCliente(7, "2026-09", { agoraMs: AGORA.getTime() })?.estado, "executando");
    eq("outra competência do mesmo cliente não fica bloqueada pelo registro", atualizacao.atualizacaoDoCliente(7, "2026-08", { agoraMs: AGORA.getTime() }), null);

    gate.resolve();
    await execucao;
    eq("só um lock foi adquirido", [locks.adquiridos, locks.liberados], [1, 1]);

    // Retenção: concluído continua visível por 30 min, depois some.
    const depois = AGORA.getTime() + atualizacao.RETENCAO_CONCLUIDO_MS + 60 * 1000;
    ok("concluído ainda visível logo depois", atualizacao.atualizacaoDoCliente(7, "2026-09", { agoraMs: AGORA.getTime() }) !== null);
    eq("concluído some após a retenção", atualizacao.atualizacaoDoCliente(7, "2026-09", { agoraMs: depois }), null);
  }

  // Outra instância segurando o advisory lock.
  {
    atualizacao._limparParaTestes();
    const orq = fakesOrquestrador();
    const { deps } = montarDeps({ orquestrador: orq, lock: async () => ({ adquirido: false }) });
    await rejeita("lock de outra instância → 409", atualizacao.iniciarAtualizacao(ADMIN, "7", "2026-09", deps), 409, "ATUALIZACAO_EM_ANDAMENTO");
    eq("sem lock, nenhum run criado", orq.chamadas.criarSyncRun.length, 0);
  }

  // Sem conta elegível.
  {
    atualizacao._limparParaTestes();
    const orq = fakesOrquestrador();
    const { deps, locks } = montarDeps({ orquestrador: orq });
    deps.listarContas = async () => [linhaConta(73, { external_account_id: null })];
    await rejeita("nenhuma conta ML conectada → 422", atualizacao.iniciarAtualizacao(ADMIN, "7", "2026-09", deps), 422, "SEM_CONTA_ELEGIVEL");
    eq("sem conta elegível, nem lock", locks.adquiridos, 0);
  }

  // ===========================================================================
  // 7 — erro estrutural
  // ===========================================================================
  {
    atualizacao._limparParaTestes();
    const orq = fakesOrquestrador();
    orq.fakes.ensureCentralVendasTables = async () => { const e = new Error("schema indisponível"); e.code = "57P01"; throw e; };
    const { deps, locks } = montarDeps({ orquestrador: orq });
    const { execucao } = await atualizacao.iniciarAtualizacao(ADMIN, "7", "2026-09", deps);
    const job = await execucao;
    eq("erro estrutural → falhou", job.estado, "falhou");
    ok("contas elegíveis viram falha com a causa", job.contas.filter((c) => c.elegivel).every((c) => c.estado === "falha" && c.erroCodigo === "57P01"));
    eq("lock liberado mesmo com erro", locks.liberados, 1);
  }

  // Todas as elegíveis falham → "falhou".
  {
    atualizacao._limparParaTestes();
    const orq = fakesOrquestrador({ falhar: { 71: "ML_ACCOUNT_MISMATCH", 72: "GRANT_UNAVAILABLE" } });
    const { deps } = montarDeps({ orquestrador: orq });
    const { execucao } = await atualizacao.iniciarAtualizacao(ADMIN, "7", "2026-09", deps);
    const job = await execucao;
    eq("nenhuma conta atualizou → falhou", [job.estado, job.mensagem], ["falhou", "Nenhuma das 2 contas foi atualizada."]);
    eq("sem publicação, snapshot não reconstrói", job.snapshot, { atualizado: false, motivo: "NENHUM_RUN_PUBLICADO_NESTA_RODADA" });
  }

  // Mensagens por resultado.
  eq("parcial: pedidos incompletos", atualizacao.mensagemDaConta({ status: "parcial", motivo: "NAO_PUBLICADO_ORDERS_INCOMPLETO" }), "Sincronizou, mas os pedidos vieram incompletos — nada foi publicado.");
  eq("parcial: completude parcial", atualizacao.mensagemDaConta({ status: "parcial", motivo: "COMPLETUDE_PARTIAL" }), "Publicado com cobertura parcial das fontes.");
  eq("falha sem code conhecido: mensagem sanitizada do erro", atualizacao.mensagemDaConta({ status: "falha", erro: { code: "X", message: "timeout" } }), "timeout");

  concluido = true;
  console.log(`painelContasAtualizacao.test.js: ${checks} verificações OK`);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
