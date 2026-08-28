// server/tests/mePortfolioReadiness.test.js
//
// V3 P2.7 BLOCO P — dívida de readiness de `GET /me/portfolio`.
//
// Registrado no readiness anterior e reafirmado pela Pessoa 1 em
// Squads_migration/VENFORCE_V3_F4_2_DEPENDENCIAS_P2_6.md §D3:
//   - `pendencias[]` só trazia `{ tipo }`;
//   - `contas[].ultimaSync` era `null` LITERAL (hardcoded);
//   - `clientes[].ultimaSincronizacao` não existia, e por isso a Carteira
//     perdeu a ordenação por "Última sync" ao migrar para /me/portfolio.
//
// O que este arquivo trava:
//   - `ultimaSincronizacao` vem da MESMA chamada de readiness que já era
//     feita (zero query nova);
//   - `contas[].ultimaSync` vem de `central_vendas_sync_runs`, em UMA query
//     batelada (nunca 1 por conta);
//   - só run `completed` conta como sincronização;
//   - ausência continua `null` — "sem dado de sync", NUNCA um valor fabricado
//     nem a afirmação mais forte "nunca sincronizou";
//   - `desde`/`dias` continuam FORA da pendência: nenhuma fonte guarda desde
//     quando ela existe, e datar isso seria inventar.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const pool = require("../config/database");
const meService = require("../services/meService");
const cliente360Service = require("../services/cliente360/cliente360Service");
const squadsRepo = require("../services/squads/squadsRepository");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

const USER = { id: 1, role: "admin", nome: "Admin", email: "a@b.c" };

async function comAmbiente({ syncRuns = [], readiness = [] }, fn) {
  const originalQuery = pool.query;
  const originalOperacional = cliente360Service.getClientesOperacional;
  const originalEnsure = squadsRepo.ensureSquadsTables;
  const originalSquads = squadsRepo.squadsAtivosDeClientes;
  const originalResp = squadsRepo.responsaveisDeClientes;

  const queries = [];
  pool.query = async (sql, params = []) => {
    const q = String(sql).replace(/\s+/g, " ").trim();
    queries.push({ q, params });

    if (q.includes("authz:PORTFOLIO_ADMIN_ALL")) {
      return { rows: [{ id: 1, slug: "n97", nome: "N97" }, { id: 2, slug: "outro", nome: "Outro" }] };
    }
    if (q.includes("FROM squad_members")) return { rows: [] };
    if (q.includes("DISTINCT ON (cliente_conta_id)")) {
      return { rows: syncRuns };
    }
    if (q.includes("FROM cliente_contas")) {
      return { rows: [
        { id: 10, cliente_id: 1, marketplace: "meli", nome: "ML 1", ativo: true, external_account_id: "1", externalAccountLabel: "ML 1" },
        { id: 11, cliente_id: 1, marketplace: "shopee", nome: "Shopee", ativo: true, external_account_id: "2", externalAccountLabel: "SH" },
        { id: 20, cliente_id: 2, marketplace: "meli", nome: "ML Outro", ativo: true, external_account_id: "3", externalAccountLabel: "ML O" },
      ] };
    }
    return { rows: [] };
  };

  cliente360Service.getClientesOperacional = async () => ({ clientes: readiness });
  squadsRepo.ensureSquadsTables = async () => {};
  squadsRepo.squadsAtivosDeClientes = async () => [];
  squadsRepo.responsaveisDeClientes = async () => [];

  try {
    return await fn(queries);
  } finally {
    pool.query = originalQuery;
    cliente360Service.getClientesOperacional = originalOperacional;
    squadsRepo.ensureSquadsTables = originalEnsure;
    squadsRepo.squadsAtivosDeClientes = originalSquads;
    squadsRepo.responsaveisDeClientes = originalResp;
  }
}

async function run() {
  // --------------------------------------------- dado presente, dado real
  await comAmbiente({
    syncRuns: [{ cliente_conta_id: 10, finished_at: "2026-08-27T10:00:00.000Z" }],
    readiness: [
      { id: 1, statusOperacional: "atencao", pendencias: ["sem_base"], ultimaSincronizacao: "2026-08-01T00:00:00.000Z" },
      { id: 2, statusOperacional: "critico", pendencias: ["sem_grant", "sem_base"], ultimaSincronizacao: null },
    ],
  }, async (queries) => {
    const r = await meService.obterPortfolio(USER);
    const n97 = r.clientes.find((c) => c.id === 1);
    const outro = r.clientes.find((c) => c.id === 2);

    ok("clientes[].ultimaSincronizacao passa a existir (D3)", n97.ultimaSincronizacao === "2026-08-01T00:00:00.000Z");
    ok("cliente sem sincronizacao continua null, nunca 0 nem data inventada", outro.ultimaSincronizacao === null);

    const contaMeli = n97.contas.find((c) => c.id === 10);
    const contaShopee = n97.contas.find((c) => c.id === 11);
    ok("contas[].ultimaSync deixa de ser null hardcoded e traz a data real", contaMeli.ultimaSync === "2026-08-27T10:00:00.000Z");
    ok("conta sem run completo continua null (sem dado de sync)", contaShopee.ultimaSync === null);

    // BLOCO P — pendencia enriquecida, sem inventar.
    ok("pendencia mantem tipo (contrato estavel)", n97.pendencias[0].tipo === "sem_base");
    ok("pendencia ganha rotulo legivel", typeof n97.pendencias[0].rotulo === "string" && n97.pendencias[0].rotulo.length > 0);
    ok("pendencia ganha destino de resolucao", n97.pendencias[0].destino === "bases");
    ok("pendencia sem_grant aponta para cliente-contas", outro.pendencias.find((p) => p.tipo === "sem_grant").destino === "cliente-contas");
    ok("pendencia NAO inventa 'desde'", !("desde" in n97.pendencias[0]));
    ok("pendencia NAO inventa 'dias'", !("dias" in n97.pendencias[0]));

    // Sem N+1: UMA query de sync para o portfolio inteiro.
    const qsSync = queries.filter((x) => x.q.includes("DISTINCT ON (cliente_conta_id)"));
    ok("exatamente 1 query de ultima sync para N clientes/contas (sem N+1)", qsSync.length === 1);
    ok("a query de sync so considera run completed", /status = 'completed'/.test(qsSync[0].q));
    ok("a query de sync ignora run sem finished_at", /finished_at IS NOT NULL/.test(qsSync[0].q));
  });

  // ------------------------------------- pendencia desconhecida e honesta
  await comAmbiente({
    syncRuns: [],
    readiness: [{ id: 1, statusOperacional: "atencao", pendencias: ["tipo_que_nao_existe"], ultimaSincronizacao: null }],
  }, async () => {
    const r = await meService.obterPortfolio(USER);
    const p = r.clientes.find((c) => c.id === 1).pendencias[0];
    ok("pendencia desconhecida preserva o tipo", p.tipo === "tipo_que_nao_existe");
    ok("pendencia desconhecida devolve rotulo null em vez de inventar um", p.rotulo === null);
    ok("pendencia desconhecida devolve destino null em vez de chutar uma tela", p.destino === null);
  });

  // ------------------------- tabela de sync ausente nao derruba a Carteira
  {
    const originalQuery = pool.query;
    const originalOperacional = cliente360Service.getClientesOperacional;
    const originalEnsure = squadsRepo.ensureSquadsTables;
    const originalSquads = squadsRepo.squadsAtivosDeClientes;
    const originalResp = squadsRepo.responsaveisDeClientes;
    try {
      pool.query = async (sql) => {
        const q = String(sql).replace(/\s+/g, " ").trim();
        if (q.includes("authz:PORTFOLIO_ADMIN_ALL")) return { rows: [{ id: 1, slug: "n97", nome: "N97" }] };
        if (q.includes("DISTINCT ON (cliente_conta_id)")) throw new Error('relation "central_vendas_sync_runs" does not exist');
        if (q.includes("FROM cliente_contas")) {
          return { rows: [{ id: 10, cliente_id: 1, marketplace: "meli", nome: "ML 1", ativo: true, external_account_id: "1", externalAccountLabel: "ML 1" }] };
        }
        return { rows: [] };
      };
      cliente360Service.getClientesOperacional = async () => ({ clientes: [{ id: 1, statusOperacional: "pronto", pendencias: [], ultimaSincronizacao: null }] });
      squadsRepo.ensureSquadsTables = async () => {};
      squadsRepo.squadsAtivosDeClientes = async () => [];
      squadsRepo.responsaveisDeClientes = async () => [];

      const r = await meService.obterPortfolio(USER);
      ok("base sem a tabela de sync: Carteira responde mesmo assim", r.clientes.length === 1);
      ok("...e ultimaSync cai para null, o contrato honesto", r.clientes[0].contas[0].ultimaSync === null);
    } finally {
      pool.query = originalQuery;
      cliente360Service.getClientesOperacional = originalOperacional;
      squadsRepo.ensureSquadsTables = originalEnsure;
      squadsRepo.squadsAtivosDeClientes = originalSquads;
      squadsRepo.responsaveisDeClientes = originalResp;
    }
  }

  console.log(`\nmePortfolioReadiness.test.js: ${checks} verificacoes passaram.`);
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
