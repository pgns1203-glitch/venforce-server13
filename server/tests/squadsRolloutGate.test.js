// server/tests/squadsRolloutGate.test.js
//
// VenForce V3 — P2.2 HARDENING (rollout gate).
//
// P2.2 original entregou o interruptor `SQUADS_ENFORCEMENT` com fail-safe OFF
// (coberto por squadsRolloutSafety.test.js — 32 verificações, intocado). O que
// ele NÃO impedia: setar `SQUADS_ENFORCEMENT=on` com a migração de Squads
// ainda incompleta ligava o enforcement de verdade e derrubava todo usuário
// interno em 403 cascata. A única proteção era um console.warn no boot.
//
// Este arquivo cobre o GATE que fecha essa lacuna:
//
//   flag ON  +  auditoria PRONTA        -> enforcement ATIVO
//   flag ON  +  auditoria NÃO pronta    -> enforcement OFF  (+ motivo)
//   flag ON  +  auditoria FALHOU        -> enforcement OFF  (+ motivo)
//   flag ON  +  auditoria em voo        -> enforcement OFF  (janela do boot)
//   flag ON  +  bloqueado + override    -> enforcement ATIVO (+ warn)
//   flag OFF -> OFF sempre, o gate nem é consultado (rollback instantâneo)
//
// O gate NUNCA liga o que a flag não pediu: ele só sabe DESLIGAR.
//
// Sem Postgres real: mock de pool.query casando por marcador /* authz:... */.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const pool = require("../config/database");

let checks = 0;
function ok(label, cond) {
  assert.ok(cond, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

// ─────────────────────────── modelo em memória ───────────────────────────
// Clientes 1,2 -> Squad Alpha (10). Cliente 3 -> Squad Beta (20).
// User 100 = interno só Alpha. User 400 = interno SEM nenhuma membership.
// User 900 = seller do cliente 4.
const M = {
  clientes: [
    { id: 1, slug: "cli-a", nome: "Cliente A", ativo: true },
    { id: 2, slug: "cli-b", nome: "Cliente B", ativo: true },
    { id: 3, slug: "cli-c", nome: "Cliente C", ativo: true },
    { id: 4, slug: "cli-s", nome: "Cliente Seller", ativo: true },
  ],
  squads: [{ id: 10, ativo: true }, { id: 20, ativo: true }],
  members: [{ squad_id: 10, user_id: 100, ativo: true }],
  history: [
    { cliente_id: 1, squad_id: 10, fim_em: null },
    { cliente_id: 2, squad_id: 10, fim_em: null },
    { cliente_id: 3, squad_id: 20, fim_em: null },
  ],
  sellerClientes: [{ user_id: 900, cliente_id: 4, ativo: true }],
};

// Quando `squadsVazios` está ligado, as tabelas de Squad respondem vazio —
// simula o banco pós-deploy do código e PRÉ-migração de dados.
let squadsVazios = false;

function mock(sql, params = []) {
  const q = String(sql).replace(/\s+/g, " ");
  if (/^(CREATE|ALTER|DROP|BEGIN|COMMIT|DO )/i.test(q.trim())) return { rows: [] };

  const ativos = () => M.clientes.filter((c) => c.ativo).map(({ id, slug, nome }) => ({ id, slug, nome }));

  if (q.includes("authz:PORTFOLIO_INTERNAL_ENFORCEMENT_OFF") || q.includes("authz:PORTFOLIO_ADMIN_ALL")) {
    return { rows: ativos() };
  }
  if (q.includes("authz:CAN_ACCESS_ENFORCEMENT_OFF") || q.includes("authz:CAN_ACCESS_ADMIN")) {
    return { rows: M.clientes.some((x) => x.id === Number(params[0])) ? [{ "?column?": 1 }] : [] };
  }

  const squadsDoUsuario = (uid) =>
    squadsVazios
      ? []
      : M.members
          .filter((m) => m.user_id === uid && m.ativo)
          .map((m) => m.squad_id)
          .filter((sid) => (M.squads.find((s) => s.id === sid) || {}).ativo);

  if (q.includes("authz:PORTFOLIO_INTERNAL_BY_SQUAD")) {
    const set = new Set(squadsDoUsuario(Number(params[0])));
    return {
      rows: M.clientes
        .filter((c) => c.ativo)
        .filter((c) => {
          const h = squadsVazios ? null : M.history.find((r) => r.cliente_id === c.id && r.fim_em === null);
          return h && set.has(h.squad_id);
        })
        .map(({ id, slug, nome }) => ({ id, slug, nome })),
    };
  }
  if (q.includes("authz:CAN_ACCESS_INTERNAL")) {
    const set = new Set(squadsDoUsuario(Number(params[0])));
    const h = squadsVazios ? null : M.history.find((r) => r.cliente_id === Number(params[1]) && r.fim_em === null);
    return { rows: h && set.has(h.squad_id) ? [{ "?column?": 1 }] : [] };
  }

  if (q.includes("authz:PORTFOLIO_SELLER")) {
    const ids = M.sellerClientes.filter((s) => s.user_id === Number(params[0]) && s.ativo).map((s) => s.cliente_id);
    return { rows: M.clientes.filter((c) => c.ativo && ids.includes(c.id)).map(({ id, slug, nome }) => ({ id, slug, nome })) };
  }
  if (q.includes("authz:CAN_ACCESS_SELLER")) {
    const hit = M.sellerClientes.some(
      (s) => s.user_id === Number(params[0]) && s.cliente_id === Number(params[1]) && s.ativo
    );
    return { rows: hit ? [{ "?column?": 1 }] : [] };
  }

  // resolverClienteRef — independente de squad/enforcement.
  if (q.includes("authz:RESOLVE_CLIENTE_ID")) {
    const c = M.clientes.find((x) => x.id === Number(params[0]));
    return { rows: c ? [c] : [] };
  }
  if (q.includes("authz:RESOLVE_CLIENTE_SLUG")) {
    const c = M.clientes.find((x) => x.slug === String(params[0]));
    return { rows: c ? [c] : [] };
  }
  return { rows: [] };
}

// Roda `fn` com um ambiente de env controlado, restaurando tudo no fim.
async function comEnv(vars, fn) {
  const antes = {};
  for (const [k, v] of Object.entries(vars)) {
    antes[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(antes)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

async function run() {
  const originalQuery = pool.query;
  pool.query = async (sql, params) => mock(sql, params);

  const cfg = require("../config/squadsEnforcement");
  const authz = require("../services/squads/authorizationService");

  const admin = { id: 9, role: "admin" };
  const interno100 = { id: 100, role: "membro" }; // Alpha
  const interno400 = { id: 400, role: "membro" }; // sem nenhuma membership
  const seller = { id: 900, role: "seller" };

  const TODOS = M.clientes.filter((c) => c.ativo).length;

  // Estado limpo entre blocos: gate desarmado + latches de warn zerados.
  const limpar = () => cfg._resetParaTeste();

  // ───────── 1. gate LIBERADO: flag ON + auditoria pronta → ENFORCEMENT ─────────
  await comEnv({ SQUADS_ENFORCEMENT: "on", SQUADS_ENFORCEMENT_ALLOW_INCOMPLETE: undefined }, async () => {
    limpar();
    cfg.iniciarArme();
    cfg.armarGate({ pronto: true });
    ok("ON + auditoria pronta → enforcement ATIVO", cfg.isEnforcementEnabled() === true);
    ok("ON + auditoria pronta → gate 'liberado'", cfg.describeEnforcement().gate === "liberado");
    const p = await authz.resolvePortfolioClientes(interno100);
    ok("ON + pronta → interno Alpha só vê clientes de Alpha (1,2)", p.length === 2 && p.every((c) => [1, 2].includes(c.id)));
    ok("ON + pronta → interno Alpha NÃO acessa cliente Beta (3)", (await authz.canAccessCliente(interno100, 3)) === false);
  });

  // ───────── 2. gate BLOQUEADO: flag ON + auditoria NÃO pronta → OFF ─────────
  await comEnv({ SQUADS_ENFORCEMENT: "on", SQUADS_ENFORCEMENT_ALLOW_INCOMPLETE: undefined }, async () => {
    limpar();
    cfg.iniciarArme();
    cfg.armarGate({ pronto: false, motivo: "12 clientes ativos sem Squad" });
    ok("ON + auditoria NÃO pronta → enforcement permanece OFF", cfg.isEnforcementEnabled() === false);
    const d = cfg.describeEnforcement();
    ok("ON + NÃO pronta → gate 'bloqueado'", d.gate === "bloqueado");
    ok("ON + NÃO pronta → motivo registrado", d.motivo === "12 clientes ativos sem Squad");
    ok("ON + NÃO pronta → flagLigada continua true (intenção do operador preservada)", d.flagLigada === true);
    const p400 = await authz.resolvePortfolioClientes(interno400);
    ok("ON + NÃO pronta → interno SEM membership NÃO fica sem carteira", p400.length === TODOS);
    ok("ON + NÃO pronta → interno acessa cliente de qualquer squad", (await authz.canAccessCliente(interno100, 3)) === true);
  });

  // ───────── 3. tabelas de Squad VAZIAS (pós-deploy, pré-migração) ─────────
  await comEnv({ SQUADS_ENFORCEMENT: "on", SQUADS_ENFORCEMENT_ALLOW_INCOMPLETE: undefined }, async () => {
    limpar();
    squadsVazios = true;
    cfg.iniciarArme();
    cfg.armarGate({ pronto: false, motivo: "nenhum Squad cadastrado" });
    ok("ON + tabelas vazias → enforcement OFF", cfg.isEnforcementEnabled() === false);
    const p = await authz.resolvePortfolioClientes(interno100);
    ok("ON + tabelas vazias → interno vê todos os clientes ativos (sem 403 cascata)", p.length === TODOS);
    const cli = await authz.assertClienteNaCarteira(interno400, "cli-c");
    ok("ON + tabelas vazias → assertClienteNaCarteira NÃO lança 403", cli && cli.id === 3);
    squadsVazios = false;
  });

  // ───────── 4. banco SEM as tabelas de Squad: auditoria falha → OFF ─────────
  await comEnv({ SQUADS_ENFORCEMENT: "on", SQUADS_ENFORCEMENT_ALLOW_INCOMPLETE: undefined }, async () => {
    limpar();
    cfg.iniciarArme();
    cfg.armarGateComFalha(new Error('relation "squads" does not exist'));
    ok("ON + auditoria falhou → enforcement OFF (fail-safe)", cfg.isEnforcementEnabled() === false);
    const d = cfg.describeEnforcement();
    ok("ON + auditoria falhou → gate 'bloqueado'", d.gate === "bloqueado");
    ok("ON + auditoria falhou → motivo cita o erro", /squads/.test(String(d.motivo)));
  });

  // ───────── 5. janela do boot: auditoria em voo → OFF ─────────
  await comEnv({ SQUADS_ENFORCEMENT: "on", SQUADS_ENFORCEMENT_ALLOW_INCOMPLETE: undefined }, async () => {
    limpar();
    cfg.iniciarArme(); // arme começou, auditoria ainda não respondeu
    ok("ON + auditoria em voo → enforcement OFF (janela do boot)", cfg.isEnforcementEnabled() === false);
    ok("ON + auditoria em voo → gate 'armando'", cfg.describeEnforcement().gate === "armando");
  });

  // ───────── 6. override explícito destrava o gate bloqueado ─────────
  await comEnv({ SQUADS_ENFORCEMENT: "on", SQUADS_ENFORCEMENT_ALLOW_INCOMPLETE: "on" }, async () => {
    limpar();
    cfg.iniciarArme();
    cfg.armarGate({ pronto: false, motivo: "3 internos sem membership (exceções aceitas)" });
    ok("ON + bloqueado + override → enforcement ATIVO", cfg.isEnforcementEnabled() === true);
    const d = cfg.describeEnforcement();
    ok("override → describeEnforcement marca overrideAtivo", d.overrideAtivo === true);
    ok("override → gate segue reportando 'bloqueado' (honesto)", d.gate === "bloqueado");
    const p = await authz.resolvePortfolioClientes(interno100);
    ok("override → carteira real por Squad volta a valer", p.length === 2);
  });

  // override exige token explícito próprio — não herda o de SQUADS_ENFORCEMENT
  await comEnv({ SQUADS_ENFORCEMENT: "on", SQUADS_ENFORCEMENT_ALLOW_INCOMPLETE: "talvez" }, async () => {
    limpar();
    cfg.iniciarArme();
    cfg.armarGate({ pronto: false, motivo: "migração incompleta" });
    ok("override com token inválido → NÃO destrava (fail-safe)", cfg.isEnforcementEnabled() === false);
  });

  // override sozinho (sem a flag) nunca liga nada
  await comEnv({ SQUADS_ENFORCEMENT: undefined, SQUADS_ENFORCEMENT_ALLOW_INCOMPLETE: "on" }, async () => {
    limpar();
    cfg.iniciarArme();
    cfg.armarGate({ pronto: true });
    ok("override sem SQUADS_ENFORCEMENT → enforcement OFF (gate só desliga)", cfg.isEnforcementEnabled() === false);
  });

  // ───────── 7. flag ausente → OFF em qualquer estado de gate ─────────
  for (const [rotulo, armar] of [
    ["gate liberado", () => cfg.armarGate({ pronto: true })],
    ["gate bloqueado", () => cfg.armarGate({ pronto: false, motivo: "x" })],
  ]) {
    await comEnv({ SQUADS_ENFORCEMENT: undefined, SQUADS_ENFORCEMENT_ALLOW_INCOMPLETE: undefined }, async () => {
      limpar();
      cfg.iniciarArme();
      armar();
      ok(`flag ausente + ${rotulo} → OFF`, cfg.isEnforcementEnabled() === false);
    });
  }

  // ───────── 8. rollback ON → OFF sem tocar em dado nenhum ─────────
  {
    limpar();
    // Liga de verdade: flag ON + gate liberado.
    await comEnv({ SQUADS_ENFORCEMENT: "on", SQUADS_ENFORCEMENT_ALLOW_INCOMPLETE: undefined }, async () => {
      cfg.iniciarArme();
      cfg.armarGate({ pronto: true });
      ok("rollback/antes: enforcement ATIVO", cfg.isEnforcementEnabled() === true);
      const p = await authz.resolvePortfolioClientes(interno400);
      ok("rollback/antes: interno sem membership com carteira VAZIA", p.length === 0);
    });
    // Rollback = só mexer na env var. O gate NÃO é rearmado, nada é migrado.
    await comEnv({ SQUADS_ENFORCEMENT: "off", SQUADS_ENFORCEMENT_ALLOW_INCOMPLETE: undefined }, async () => {
      ok("rollback: flag off → enforcement OFF na hora", cfg.isEnforcementEnabled() === false);
      ok("rollback: gate segue 'liberado' (não foi desfeito)", cfg.describeEnforcement().gate === "liberado");
      const p = await authz.resolvePortfolioClientes(interno400);
      ok("rollback: interno sem membership volta a ver todos os clientes", p.length === TODOS);
      ok("rollback: interno acessa cliente de outro squad de novo", (await authz.canAccessCliente(interno100, 3)) === true);
    });
    // E religar é idempotente — mesma env var de volta.
    await comEnv({ SQUADS_ENFORCEMENT: "on", SQUADS_ENFORCEMENT_ALLOW_INCOMPLETE: undefined }, async () => {
      ok("rollback: religar com on → enforcement ATIVO de novo (idempotente)", cfg.isEnforcementEnabled() === true);
      const p = await authz.resolvePortfolioClientes(interno400);
      ok("rollback: carteira volta a ser a real por Squad", p.length === 0);
    });
  }

  // ───────── 9. admin e seller preservados em TODOS os estados de gate ─────────
  const estados = [
    ["nao_armado", () => {}],
    ["armando", () => cfg.iniciarArme()],
    ["liberado", () => { cfg.iniciarArme(); cfg.armarGate({ pronto: true }); }],
    ["bloqueado", () => { cfg.iniciarArme(); cfg.armarGate({ pronto: false, motivo: "x" }); }],
  ];
  for (const [nome, armar] of estados) {
    await comEnv({ SQUADS_ENFORCEMENT: "on", SQUADS_ENFORCEMENT_ALLOW_INCOMPLETE: undefined }, async () => {
      limpar();
      armar();
      const pa = await authz.resolvePortfolioClientes(admin);
      ok(`admin preservado (gate ${nome}) → todos os clientes ativos`, pa.length === TODOS);
      ok(`admin preservado (gate ${nome}) → canAccessCliente true`, (await authz.canAccessCliente(admin, 3)) === true);
      const ps = await authz.resolvePortfolioClientes(seller);
      ok(`seller preservado (gate ${nome}) → só seller_clientes`, ps.length === 1 && ps[0].id === 4);
    });
  }

  // ───────── 10. compat: gate nunca armado → flag governa sozinha ─────────
  // Garante que testes e scripts que só setam a env var (os 7 arquivos de P2.1
  // + squadsRolloutSafety) continuam valendo, sem precisar armar gate nenhum.
  await comEnv({ SQUADS_ENFORCEMENT: "on", SQUADS_ENFORCEMENT_ALLOW_INCOMPLETE: undefined }, async () => {
    limpar();
    ok("gate nunca armado + flag on → ON (compat com testes/scripts)", cfg.isEnforcementEnabled() === true);
    ok("gate nunca armado → gate 'nao_armado'", cfg.describeEnforcement().gate === "nao_armado");
  });

  pool.query = originalQuery;
  console.log(`\nsquadsRolloutGate.test.js: ${checks} verificações passaram.`);
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
