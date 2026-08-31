// server/tests/entregasClienteContaOperacao.test.js
//
// V3 P2.6 D1 — a entrega passa a registrar a OPERAÇÃO (ClienteConta).
//
// Bloqueio levantado pela Pessoa 1 em
// Squads_migration/VENFORCE_V3_F4_2_DEPENDENCIAS_P2_6.md §D1:
//   `clienteContaId` chegava ao CÁLCULO do fechamento e não chegava à ENTREGA
//   salva. O número publicado perdia a operação que o gerou exatamente no
//   passo em que virava registro. Um cliente com duas contas do mesmo
//   marketplace tinha dois fechamentos possíveis para a mesma competência e,
//   depois de salvos, eles ficavam indistinguíveis.
//
// Invariantes cobertos aqui (os quatro testes pedidos no doc de dependências):
//   - entrega criada com conta de OUTRO cliente → 409, não grava;
//   - filtro por conta não vaza entrega de conta irmã do mesmo cliente;
//   - entrega antiga (NULL) continua sendo lida e listada, sem virar "conta 0";
//   - GET /financeiro/:cliente?conta= só considera a entrega daquela conta.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const pool = require("../config/database");
const servico = require("../services/entregasClienteService");
const { obterFinanceiro } = require("../services/financeiroVisaoService");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}
async function rejeitaCom(label, promise, verificar) {
  let erro = null;
  try { await promise; } catch (e) { erro = e; }
  assert.ok(erro, `FALHOU (nao rejeitou): ${label}`);
  if (verificar) assert.ok(verificar(erro), `FALHOU (erro inesperado): ${label} — status=${erro.statusCode} code=${erro.code} msg=${erro.message}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

// Cliente 1 tem contas 10 e 11 (duas MELI). Cliente 2 tem a conta 20.
const CONTAS = [
  { id: 10, cliente_id: 1, nome: "ML Principal", ativo: true },
  { id: 11, cliente_id: 1, nome: "ML Secundaria", ativo: true },
  { id: 20, cliente_id: 2, nome: "Outro cliente", ativo: true },
];
const CLIENTES = [
  { id: 1, slug: "n97", nome: "N97" },
  { id: 2, slug: "outro", nome: "Outro" },
];

function mockDb({ entregas = [], duplicatas = [] } = {}) {
  const fixtureDuplicatas = duplicatas;
  const capturas = [];
  return {
    capturas,
    async query(sql, params = []) {
      const q = String(sql).replace(/\s+/g, " ").trim();
      capturas.push({ q, params });

      if (q.startsWith("SELECT id, cliente_id, nome, ativo FROM cliente_contas WHERE id = $1")) {
        const c = CONTAS.find((x) => x.id === Number(params[0]));
        return { rows: c ? [c] : [] };
      }
      if (q.includes("FROM clientes") && q.includes("WHERE")) {
        const alvo = CLIENTES.find((c) => c.id === Number(params[0]) || c.slug === String(params[0]));
        return { rows: alvo ? [alvo] : [] };
      }
      if (q.startsWith("SELECT id, status, publicado, token_publico, created_at FROM entregas_cliente")) {
        // D4 - busca de duplicata da competencia. Aplica de verdade o WHERE.
        const [tipoAlvo, clienteAlvo, periodoAlvo] = params;
        const semConta = /cliente_conta_id IS NULL/.test(q);
        const contaAlvo = semConta ? null : params[3];
        const achada = fixtureDuplicatas.find((e) =>
          e.tipo === tipoAlvo && e.cliente_id === clienteAlvo && e.periodo === periodoAlvo
          && (semConta ? e.cliente_conta_id == null : e.cliente_conta_id === contaAlvo));
        return { rows: achada ? [achada] : [] };
      }
      if (q.startsWith("SELECT * FROM entregas_cliente WHERE id = $1")) {
        const achada = fixtureDuplicatas.find((e) => e.id === Number(params[0]));
        return { rows: achada ? [achada] : [] };
      }
      if (q.startsWith("UPDATE entregas_cliente SET")) {
        return { rows: [{ id: params[params.length - 1], substituida: true }] };
      }
      if (q.startsWith("INSERT INTO entregas_cliente")) {
        return { rows: [{ id: 99, cliente_conta_id: params[12] ?? null }] };
      }
      if (q.includes("COUNT(*)::int AS total FROM entregas_cliente")) {
        return { rows: [{ total: aplicarFiltro(q, params, entregas).length }] };
      }
      if (q.includes("FROM entregas_cliente")) {
        return { rows: aplicarFiltro(q, params, entregas) };
      }
      return { rows: [] };
    },
  };
}

// Aplica de verdade o filtro de conta que a query montar — se o WHERE sumir do
// SQL, o teste falha em vez de passar por acidente.
function aplicarFiltro(q, params, entregas) {
  let linhas = entregas.slice();
  const comNull = q.match(/\(cliente_conta_id = \$(\d+) OR cliente_conta_id IS NULL\)/);
  // Cuidado: um `(?! OR)` ingenuo aqui casa com " ORDER BY" e mata o match.
  const soConta = comNull ? null : q.match(/cliente_conta_id = \$(\d+)/);
  if (comNull) {
    const alvo = params[Number(comNull[1]) - 1];
    linhas = linhas.filter((e) => e.cliente_conta_id == null || e.cliente_conta_id === alvo);
  } else if (soConta) {
    const alvo = params[Number(soConta[1]) - 1];
    linhas = linhas.filter((e) => e.cliente_conta_id === alvo);
  }
  return linhas;
}

async function comDb(fixture, fn) {
  const original = pool.query;
  const db = mockDb(fixture);
  pool.query = (sql, params) => db.query(sql, params);
  try { return await fn(db); } finally { pool.query = original; }
}

async function run() {
  // ------------------------------------------------- criar com a operacao
  await comDb({}, async (db) => {
    await servico.criarEntrega({
      userId: 5,
      body: { tipo: "fechamento_mensal", titulo: "Fechamento", cliente_id: 1, cliente_conta_id: 10, periodo: "2026-08" },
    });
    const insert = db.capturas.find((c) => c.q.startsWith("INSERT INTO entregas_cliente"));
    ok("INSERT grava cliente_conta_id", /cliente_conta_id/.test(insert.q) && insert.params[12] === 10);
    ok("periodo e gravado ja normalizado", insert.params[5] === "2026-08");
  });

  await comDb({}, async (db) => {
    await servico.criarEntrega({
      userId: 5,
      body: { tipo: "fechamento_mensal", titulo: "F", cliente_id: 1, periodo: "Agosto 2026" },
    });
    const insert = db.capturas.find((c) => c.q.startsWith("INSERT INTO entregas_cliente"));
    ok("sem conta informada grava NULL (sem operacao registrada), nao 0", insert.params[12] === null);
    ok("periodo legado 'Agosto 2026' e normalizado na escrita", insert.params[5] === "2026-08");
  });

  // ------------------------------------------- conta de OUTRO cliente: 409
  await comDb({}, async () => {
    await rejeitaCom(
      "conta de outro cliente → 409 CONTA_NAO_PERTENCE_AO_CLIENTE, nao grava",
      servico.criarEntrega({ userId: 5, body: { tipo: "fechamento_mensal", titulo: "F", cliente_id: 1, cliente_conta_id: 20 } }),
      (e) => e.statusCode === 409 && e.code === "CONTA_NAO_PERTENCE_AO_CLIENTE"
    );
    await rejeitaCom(
      "conta inexistente → 404",
      servico.criarEntrega({ userId: 5, body: { tipo: "fechamento_mensal", titulo: "F", cliente_id: 1, cliente_conta_id: 777 } }),
      (e) => e.statusCode === 404
    );
    await rejeitaCom(
      "conta sem cliente resolvido → 400 (nao da para validar posse)",
      servico.criarEntrega({ userId: 5, body: { tipo: "fechamento_mensal", titulo: "F", cliente_conta_id: 10 } }),
      (e) => e.statusCode === 400
    );
    await rejeitaCom(
      "cliente_conta_id nao numerico → 400",
      servico.criarEntrega({ userId: 5, body: { tipo: "fechamento_mensal", titulo: "F", cliente_id: 1, cliente_conta_id: "abc" } }),
      (e) => e.statusCode === 400
    );
  });

  // ------------------------------------------------------ filtro na lista
  const HISTORICO = [
    { id: 1, cliente_id: 1, cliente_conta_id: 10, periodo: "2026-08", status: "publicado", publicado: true, token_publico: "t1" },
    { id: 2, cliente_id: 1, cliente_conta_id: 11, periodo: "2026-08", status: "publicado", publicado: true, token_publico: "t2" },
    { id: 3, cliente_id: 1, cliente_conta_id: null, periodo: "2026-05", status: "publicado", publicado: false },
  ];

  await comDb({ entregas: HISTORICO }, async () => {
    const r = await servico.listarEntregas({ query: { cliente_id: 1, cliente_conta_id: 10 } });
    const ids = r.entregas.map((e) => e.id);
    ok("filtro por conta NAO vaza a entrega da conta irma", !ids.includes(2));
    ok("filtro por conta traz a entrega da propria conta", ids.includes(1));
    ok("entrega antiga (NULL) continua visivel por padrao", ids.includes(3));
    ok("total tambem respeita o filtro de conta", r.total === 2);
  });

  await comDb({ entregas: HISTORICO }, async () => {
    const r = await servico.listarEntregas({ query: { cliente_id: 1, cliente_conta_id: 10, incluir_sem_conta: "false" } });
    ok("incluir_sem_conta=false exclui as entregas sem operacao registrada", r.entregas.map((e) => e.id).join() === "1");
  });

  await comDb({ entregas: HISTORICO }, async () => {
    const r = await servico.listarEntregas({ query: { cliente_id: 1 } });
    ok("sem filtro de conta a lista traz tudo do cliente (compatibilidade)", r.entregas.length === 3);
  });

  // ------------------------------- GET /financeiro so considera esta conta
  function depsFinanceiro(entregas) {
    return {
      resolverClientePorIdOuSlug: async () => ({ id: 1, slug: "n97", nome: "N97", ativo: true }),
      obterConta: async (id) => CONTAS.find((c) => c.id === Number(id)),
      sanitizarConta: (r) => ({ ...r, marketplace: "meli" }),
      getMercadoPagoReconciliationForRange: async () => ({ ok: true }),
      listarEntregas: async ({ query }) => ({ ok: true, entregas: aplicarFiltroJs(entregas, query) }),
    };
  }
  function aplicarFiltroJs(entregas, query) {
    const conta = query?.cliente_conta_id;
    if (!conta) return entregas;
    const semConta = String(query?.incluir_sem_conta ?? "true").toLowerCase() !== "false";
    return entregas.filter((e) => e.cliente_conta_id === conta || (semConta && e.cliente_conta_id == null));
  }

  {
    const entregas = [
      { id: 1, cliente_conta_id: 10, periodo: "2026-08", status: "publicado", publicado: true, payload_json: { cards: [{ chave: "x", valor: 10 }] } },
      { id: 2, cliente_conta_id: 11, periodo: "2026-08", status: "publicado", publicado: true, payload_json: { cards: [{ chave: "x", valor: 11 }] } },
    ];
    const conta10 = await obterFinanceiro({ clienteSlugRaw: "n97", clienteContaIdRaw: "10", periodoRaw: "2026-08" }, depsFinanceiro(entregas));
    ok("conta 10 recebe o fechamento da conta 10", conta10.resultado.dados.composicao[0].valor === 10);
    ok("conta 10: escopoConta agora e TRUE de verdade (D1)", conta10.resultado.escopoConta === true);

    const conta11 = await obterFinanceiro({ clienteSlugRaw: "n97", clienteContaIdRaw: "11", periodoRaw: "2026-08" }, depsFinanceiro(entregas));
    ok("conta 11 recebe o fechamento da conta 11, nunca o da irma", conta11.resultado.dados.composicao[0].valor === 11);
  }

  {
    // So existe a entrega legada: e do CLIENTE, nao desta conta — e isso e dito.
    const entregas = [
      { id: 3, cliente_conta_id: null, periodo: "2026-08", status: "publicado", publicado: true, payload_json: { cards: [{ chave: "x", valor: 3 }] } },
    ];
    const r = await obterFinanceiro({ clienteSlugRaw: "n97", clienteContaIdRaw: "10", periodoRaw: "2026-08" }, depsFinanceiro(entregas));
    ok("entrega legada ainda e encontrada (historico nao some)", r.resultado.disponivel === true);
    ok("entrega legada NAO e declarada como account-aware", r.resultado.escopoConta === false);
    ok("a limitacao e DECLARADA em origemClientLevel, nao escondida", !!r.resultado.origemClientLevel);
  }

  {
    // Conta especifica vence a legada quando as duas existem na competencia.
    const entregas = [
      { id: 3, cliente_conta_id: null, periodo: "2026-08", status: "publicado", publicado: true, created_at: "2026-09-10T00:00:00Z", payload_json: { cards: [{ chave: "x", valor: 3 }] } },
      { id: 1, cliente_conta_id: 10, periodo: "2026-08", status: "rascunho", publicado: false, created_at: "2026-09-01T00:00:00Z", payload_json: { cards: [{ chave: "x", valor: 10 }] } },
    ];
    const r = await obterFinanceiro({ clienteSlugRaw: "n97", clienteContaIdRaw: "10", periodoRaw: "2026-08" }, depsFinanceiro(entregas));
    ok("entrega DESTA operacao vence a legada, mesmo sendo mais antiga e rascunho", r.resultado.dados.composicao[0].valor === 10);
    ok("...e ai escopoConta e true", r.resultado.escopoConta === true);
  }

  {
    const entregas = [
      { id: 1, cliente_conta_id: 10, periodo: "2026-08", status: "publicado", publicado: true, payload_json: { cards: [] } },
      { id: 3, cliente_conta_id: null, periodo: "2026-05", status: "rascunho", publicado: false, payload_json: { cards: [] } },
    ];
    const r = await obterFinanceiro({ clienteSlugRaw: "n97", clienteContaIdRaw: "10", periodoRaw: "2026-08" }, depsFinanceiro(entregas));
    const rel = r.relatorios.dados;
    ok("relatorios expoem clienteContaId por item", rel[0].clienteContaId === 10);
    ok("entrega sem operacao registrada aparece como null, nunca como conta 0", rel[1].clienteContaId === null);
  }

  // --------------------------------------------------------------- D4
  // Reprocessar nao pode duplicar em silencio: dois fechamentos publicados da
  // mesma competencia sao dois links publicos com numeros diferentes.
  const JA_EXISTE = [
    { id: 55, tipo: "fechamento_mensal", cliente_id: 1, cliente_conta_id: 10, periodo: "2026-08", status: "publicado", publicado: true, token_publico: "tok" },
    { id: 56, tipo: "fechamento_mensal", cliente_id: 1, cliente_conta_id: null, periodo: "2026-07", status: "rascunho", publicado: false, token_publico: null },
  ];

  await comDb({ duplicatas: JA_EXISTE }, async () => {
    await rejeitaCom(
      "POST repetido da mesma competencia/operacao -> 409 ENTREGA_JA_EXISTE",
      servico.criarEntrega({ userId: 5, body: { tipo: "fechamento_mensal", titulo: "F", cliente_id: 1, cliente_conta_id: 10, periodo: "2026-08" } }),
      (e) => e.statusCode === 409 && e.code === "ENTREGA_JA_EXISTE"
    );
  });

  await comDb({ duplicatas: JA_EXISTE }, async () => {
    let erro = null;
    try {
      await servico.criarEntrega({ userId: 5, body: { tipo: "fechamento_mensal", titulo: "F", cliente_id: 1, cliente_conta_id: 10, periodo: "2026-08" } });
    } catch (e) { erro = e; }
    ok("o 409 devolve o id da entrega existente (para oferecer 'substituir')", erro.payload.entregaId === 55);
    ok("o 409 diz se a existente ja esta publicada", erro.payload.publicado === true);
  });

  await comDb({ duplicatas: JA_EXISTE }, async (db) => {
    const r = await servico.criarEntrega({
      userId: 5,
      body: { tipo: "fechamento_mensal", titulo: "F2", cliente_id: 1, cliente_conta_id: 10, periodo: "2026-08", substituir: true },
    });
    ok("substituir=true ATUALIZA a existente em vez de criar outra", r.entrega.substituida === true);
    ok("substituir NAO faz INSERT novo", !db.capturas.some((c) => c.q.startsWith("INSERT INTO entregas_cliente")));
    ok("substituir NAO toca em token_publico (o link ja divulgado nao morre)",
      !db.capturas.some((c) => c.q.startsWith("UPDATE entregas_cliente SET") && /token_publico/.test(c.q)));
  });

  // A duplicata e por (cliente, operacao, competencia): variar qualquer um libera.
  await comDb({ duplicatas: JA_EXISTE }, async (db) => {
    await servico.criarEntrega({ userId: 5, body: { tipo: "fechamento_mensal", titulo: "F", cliente_id: 1, cliente_conta_id: 11, periodo: "2026-08" } });
    ok("outra OPERACAO na mesma competencia e permitida (nao e duplicata)", db.capturas.some((c) => c.q.startsWith("INSERT INTO entregas_cliente")));
  });
  await comDb({ duplicatas: JA_EXISTE }, async (db) => {
    await servico.criarEntrega({ userId: 5, body: { tipo: "fechamento_mensal", titulo: "F", cliente_id: 1, cliente_conta_id: 10, periodo: "2026-09" } });
    ok("outra COMPETENCIA e permitida", db.capturas.some((c) => c.q.startsWith("INSERT INTO entregas_cliente")));
  });
  await comDb({ duplicatas: JA_EXISTE }, async (db) => {
    await servico.criarEntrega({ userId: 5, body: { tipo: "diagnostico_completo", titulo: "F", cliente_id: 1, cliente_conta_id: 10, periodo: "2026-08" } });
    ok("outro TIPO na mesma competencia continua livre (so fechamento_mensal e unico)", db.capturas.some((c) => c.q.startsWith("INSERT INTO entregas_cliente")));
  });
  await comDb({ duplicatas: JA_EXISTE }, async (db) => {
    await servico.criarEntrega({ userId: 5, body: { tipo: "fechamento_mensal", titulo: "F", cliente_id: 1, cliente_conta_id: 10 } });
    ok("entrega SEM competencia nunca e tratada como duplicata", db.capturas.some((c) => c.q.startsWith("INSERT INTO entregas_cliente")));
  });
  await comDb({ duplicatas: JA_EXISTE }, async () => {
    await rejeitaCom(
      "duplicata legada (sem operacao registrada) tambem e detectada",
      servico.criarEntrega({ userId: 5, body: { tipo: "fechamento_mensal", titulo: "F", cliente_id: 1, periodo: "2026-07" } }),
      (e) => e.statusCode === 409 && e.code === "ENTREGA_JA_EXISTE"
    );
  });

  console.log(`\nentregasClienteContaOperacao.test.js: ${checks} verificacoes passaram.`);
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
