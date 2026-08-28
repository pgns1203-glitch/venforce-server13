// server/tests/responsabilidadeNaoAutoriza.test.js
//
// V3 P2.7 BLOCO M — hardening de P2.4 (responsabilidades de cliente).
//
// P2.4 já está entregue; aqui NÃO se reimplementa nada. O que se trava é o
// invariante que a missão chama de inegociável:
//
//     ROLE → SQUAD MEMBERSHIP → CLIENT RESPONSIBILITY → CLIENTE
//
//     Squad define carteira/acesso operacional.
//     Responsabilidade organiza trabalho.
//     RESPONSABILIDADE NÃO AUTORIZA ACESSO.
//
// Os dois casos que a missão pede explicitamente:
//   usuário do Squad SEM responsabilidade direta  → AINDA acessa o Cliente
//   usuário responsável FORA do Squad             → responsabilidade NÃO
//                                                   concede acesso
//
// Estes testes rodam com SQUADS_ENFORCEMENT=on de propósito: com o
// enforcement OFF todo papel interno acessa tudo, e o invariante não seria
// exercitado — passaria por acidente.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";
process.env.SQUADS_ENFORCEMENT = "on";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const pool = require("../config/database");
const authz = require("../services/squads/authorizationService");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

// Mundo do teste:
//   Squad 100 (ativo)   → Cliente 1
//   Squad 200 (INATIVO) → Cliente 2
//   user 10: membro ativo do Squad 100, SEM responsabilidade nenhuma
//   user 20: responsável pelo Cliente 1, mas SEM membership em nenhum Squad
//   user 30: membro INATIVO do Squad 100 e responsável pelo Cliente 1
//   user 40: membro ativo do Squad 200 (inativo) e responsável pelo Cliente 2
const MEMBROS_ATIVOS = { 10: [100], 40: [200] }; // user -> squads com membership ATIVA
const SQUADS_ATIVOS = new Set([100]);
const CLIENTE_SQUAD = { 1: 100, 2: 200 };

function mock(sql, params = []) {
  const q = String(sql).replace(/\s+/g, " ").trim();

  if (q.includes("authz:CAN_ACCESS_ADMIN")) {
    return { rows: [1, 2].includes(Number(params[0])) ? [{ "?column?": 1 }] : [] };
  }
  if (q.includes("authz:CAN_ACCESS_SELLER")) {
    // Nenhum vínculo de seller neste mundo.
    return { rows: [] };
  }
  if (q.includes("authz:CAN_ACCESS_INTERNAL")) {
    const [userId, clienteId] = params.map(Number);
    const squadDoCliente = CLIENTE_SQUAD[clienteId];
    const squadsDoUser = MEMBROS_ATIVOS[userId] || [];
    const autorizado = squadDoCliente != null
      && SQUADS_ATIVOS.has(squadDoCliente)
      && squadsDoUser.includes(squadDoCliente);
    return { rows: autorizado ? [{ "?column?": 1 }] : [] };
  }
  if (q.includes("authz:PORTFOLIO_INTERNAL_BY_SQUAD")) {
    const userId = Number(params[0]);
    const squadsDoUser = MEMBROS_ATIVOS[userId] || [];
    const clientes = Object.entries(CLIENTE_SQUAD)
      .filter(([, squadId]) => SQUADS_ATIVOS.has(squadId) && squadsDoUser.includes(squadId))
      .map(([clienteId]) => ({ id: Number(clienteId), slug: `cli-${clienteId}`, nome: `Cliente ${clienteId}` }));
    return { rows: clientes };
  }
  if (q.includes("authz:PORTFOLIO_ADMIN_ALL")) {
    return { rows: [{ id: 1, slug: "cli-1", nome: "Cliente 1" }, { id: 2, slug: "cli-2", nome: "Cliente 2" }] };
  }
  if (q.includes("authz:RESOLVE_CLIENTE_ID")) {
    const id = Number(params[0]);
    return { rows: [1, 2].includes(id) ? [{ id, slug: `cli-${id}`, nome: `Cliente ${id}`, ativo: true }] : [] };
  }
  // Guarda estrutural: se a autorização algum dia consultar responsáveis,
  // este teste explode em vez de passar em silêncio.
  if (/cliente_responsaveis/i.test(q)) {
    throw new Error("A AUTORIZACAO CONSULTOU cliente_responsaveis — responsabilidade nao pode virar acesso.");
  }
  return { rows: [] };
}

async function run() {
  const original = pool.query;
  pool.query = async (sql, params) => mock(sql, params);

  try {
    const doSquadSemResponsabilidade = { id: 10, role: "membro" };
    const responsavelForaDoSquad = { id: 20, role: "membro" };
    const membroInativoEResponsavel = { id: 30, role: "membro" };
    const doSquadInativo = { id: 40, role: "membro" };
    const admin = { id: 99, role: "admin" };
    const seller = { id: 88, role: "seller" };

    // ---------------- os dois casos que a missao pede explicitamente
    ok("usuario do Squad SEM responsabilidade direta AINDA acessa o Cliente",
      (await authz.canAccessCliente(doSquadSemResponsabilidade, 1)) === true);

    ok("usuario RESPONSAVEL mas FORA do Squad NAO acessa (responsabilidade nao autoriza)",
      (await authz.canAccessCliente(responsavelForaDoSquad, 1)) === false);

    // ---------------- variacoes que a missao lista no BLOCO M
    ok("membro INATIVO do Squad nao acessa, mesmo sendo responsavel",
      (await authz.canAccessCliente(membroInativoEResponsavel, 1)) === false);

    ok("Squad INATIVO nao concede acesso, mesmo com membership ativa e responsabilidade",
      (await authz.canAccessCliente(doSquadInativo, 2)) === false);

    ok("usuario do Squad 100 nao acessa cliente de outro Squad",
      (await authz.canAccessCliente(doSquadSemResponsabilidade, 2)) === false);

    ok("admin mantem o bypass canonico",
      (await authz.canAccessCliente(admin, 1)) === true && (await authz.canAccessCliente(admin, 2)) === true);

    ok("seller permanece separado: sem vinculo proprio nao acessa",
      (await authz.canAccessCliente(seller, 1)) === false);

    // ---------------- carteira coerente com o acesso individual
    {
      const carteira = await authz.resolvePortfolioClientes(doSquadSemResponsabilidade);
      ok("carteira do membro do Squad traz o cliente do Squad", carteira.map((c) => c.id).join() === "1");
    }
    {
      const carteira = await authz.resolvePortfolioClientes(responsavelForaDoSquad);
      ok("carteira do responsavel SEM membership e VAZIA, nunca 'todos os clientes'", carteira.length === 0);
    }
    {
      const carteira = await authz.resolvePortfolioClientes(doSquadInativo);
      ok("carteira de quem so tem Squad inativo e vazia", carteira.length === 0);
    }

    // ---------------- assertClienteNaCarteira usa o mesmo criterio
    {
      let erro = null;
      try { await authz.assertClienteNaCarteira(responsavelForaDoSquad, "1"); } catch (e) { erro = e; }
      ok("assertClienteNaCarteira nega o responsavel fora do Squad com 403 canonico",
        erro && erro.statusCode === 403 && erro.code === "CLIENTE_FORA_DA_CARTEIRA");
    }
    {
      const cliente = await authz.assertClienteNaCarteira(doSquadSemResponsabilidade, "1");
      ok("assertClienteNaCarteira libera o membro do Squad sem responsabilidade", cliente.id === 1);
    }
  } finally {
    pool.query = original;
  }

  // ---------------- guarda ESTRUTURAL, independente de mock
  {
    const fonte = fs.readFileSync(
      path.join(__dirname, "..", "services", "squads", "authorizationService.js"),
      "utf8"
    );
    ok("authorizationService NAO referencia cliente_responsaveis em lugar nenhum",
      !/cliente_responsaveis/i.test(fonte));
    ok("authorizationService continua derivando acesso de squad_members",
      /squad_members/.test(fonte));
  }

  console.log(`\nresponsabilidadeNaoAutoriza.test.js: ${checks} verificacoes passaram.`);
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
