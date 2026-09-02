// server/tests/squadsRolloutGateBoot.test.js
//
// VenForce V3 — P2.2 HARDENING (arme do rollout gate no boot).
//
// O gate em si (config/squadsEnforcement) só sabe receber um veredito. QUEM
// decide o veredito é este módulo, no boot — é aqui que mora a POLÍTICA de
// prontidão, de propósito: uma estratégia futura de rollout parcial (por
// Squad, por lote, por exceções aceitas) troca esta política sem tocar no
// gate nem no authorizationService.
//
// Cobre:
//   - o arme é SÍNCRONO (fecha a janela entre "processo no ar" e "auditoria
//     respondeu"), mesmo que a auditoria demore
//   - auditoria pronta      -> gate liberado
//   - auditoria não pronta  -> gate bloqueado + motivo que NOMEIA a pendência
//   - auditoria estourou    -> gate bloqueado (fail-safe), boot não quebra
//   - o resultado da auditoria volta para quem chamou (o log de boot usa)

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");

let checks = 0;
function ok(label, cond) {
  assert.ok(cond, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

const cfg = require("../config/squadsEnforcement");
const { armarRolloutGate } = require("../services/squads/rolloutGateBoot");

// Auditoria completa e limpa; os testes derrubam campos pontuais a partir daqui.
function auditoriaBase(over = {}) {
  return {
    clientesAtivos: { total: 40, semSquad: 0, emSquadInativo: 0, ...(over.clientesAtivos || {}) },
    usuariosInternos: {
      total: 12,
      semMembership: 0,
      apenasEmSquadInativo: 0,
      semPrincipal: 0,
      ...(over.usuariosInternos || {}),
    },
    pronto: over.pronto !== undefined ? over.pronto : true,
  };
}

async function run() {
  // ───────── 1. o arme é síncrono ─────────
  cfg._resetParaTeste();
  {
    let liberarAuditoria;
    const emVoo = new Promise((resolve) => { liberarAuditoria = resolve; });
    const p = armarRolloutGate({ auditoria: () => emVoo });

    // Ainda NÃO respondemos a auditoria — o gate já tem de estar fechado.
    ok("arme é síncrono: gate vira 'armando' antes da auditoria responder",
      cfg.describeEnforcement().gate === "armando");

    liberarAuditoria(auditoriaBase());
    await p;
    ok("depois da auditoria pronta: gate 'liberado'", cfg.describeEnforcement().gate === "liberado");
  }

  // ───────── 2. auditoria pronta → liberado, e devolve o resultado ─────────
  cfg._resetParaTeste();
  {
    const a = auditoriaBase();
    const r = await armarRolloutGate({ auditoria: async () => a });
    ok("auditoria pronta → gate 'liberado'", cfg.describeEnforcement().gate === "liberado");
    ok("auditoria pronta → sem motivo de bloqueio", cfg.describeEnforcement().motivo === null);
    ok("devolve a auditoria para o log de boot", r.auditoria === a);
    ok("devolve o estado do gate", r.gate === "liberado");
  }

  // ───────── 3. auditoria não pronta → bloqueado + motivo que nomeia ─────────
  cfg._resetParaTeste();
  {
    await armarRolloutGate({
      auditoria: async () => auditoriaBase({
        pronto: false,
        clientesAtivos: { semSquad: 7 },
        usuariosInternos: { semMembership: 3 },
      }),
    });
    const d = cfg.describeEnforcement();
    ok("auditoria não pronta → gate 'bloqueado'", d.gate === "bloqueado");
    ok("motivo nomeia clientes sem squad", /7/.test(d.motivo) && /sem Squad/i.test(d.motivo));
    ok("motivo nomeia internos sem membership", /3/.test(d.motivo) && /membership/i.test(d.motivo));
  }

  // pendência em squad inativo também precisa aparecer no motivo
  cfg._resetParaTeste();
  {
    await armarRolloutGate({
      auditoria: async () => auditoriaBase({
        pronto: false,
        clientesAtivos: { emSquadInativo: 2 },
        usuariosInternos: { apenasEmSquadInativo: 1 },
      }),
    });
    const d = cfg.describeEnforcement();
    ok("motivo nomeia cliente em Squad inativo", /2/.test(d.motivo) && /inativo/i.test(d.motivo));
    ok("motivo nomeia interno só em Squad inativo", /1/.test(d.motivo) && /inativo/i.test(d.motivo));
  }

  // não pronta sem contador conhecido: ainda bloqueia, com motivo genérico
  cfg._resetParaTeste();
  {
    await armarRolloutGate({ auditoria: async () => auditoriaBase({ pronto: false }) });
    const d = cfg.describeEnforcement();
    ok("não pronta sem contador reconhecido → bloqueia mesmo assim", d.gate === "bloqueado");
    ok("não pronta sem contador → motivo genérico não vazio", typeof d.motivo === "string" && d.motivo.length > 0);
  }

  // ───────── 4. auditoria estourou → bloqueado, sem derrubar o boot ─────────
  cfg._resetParaTeste();
  {
    const r = await armarRolloutGate({
      auditoria: async () => { throw new Error('relation "squads" does not exist'); },
    });
    const d = cfg.describeEnforcement();
    ok("auditoria estourou → gate 'bloqueado' (fail-safe)", d.gate === "bloqueado");
    ok("auditoria estourou → motivo cita o erro", /squads/.test(d.motivo));
    ok("auditoria estourou → não rejeita a promise (boot não quebra)", r.gate === "bloqueado");
    ok("auditoria estourou → devolve o erro para o log", r.erro instanceof Error);
    ok("auditoria estourou → auditoria vem null", r.auditoria === null);
  }

  // ───────── 5. efeito ponta-a-ponta: flag on + boot bloqueado → OFF ─────────
  cfg._resetParaTeste();
  {
    const antes = process.env.SQUADS_ENFORCEMENT;
    process.env.SQUADS_ENFORCEMENT = "on";
    try {
      await armarRolloutGate({
        auditoria: async () => auditoriaBase({ pronto: false, clientesAtivos: { semSquad: 5 } }),
      });
      ok("boot bloqueado + SQUADS_ENFORCEMENT=on → enforcement OFF",
        cfg.isEnforcementEnabled() === false);
    } finally {
      if (antes === undefined) delete process.env.SQUADS_ENFORCEMENT;
      else process.env.SQUADS_ENFORCEMENT = antes;
    }
  }

  // ───────── 6. wiring: o boot de produção PRECISA armar o gate ─────────
  // Modo de falha silencioso e perigoso: o gate existe, os testes passam, mas
  // ninguém arma no boot -> em produção o gate fica `nao_armado`, a flag volta
  // a governar sozinha e a lacuna que este hardening fecha REABRE sem aviso.
  {
    const fonteIndex = require("fs").readFileSync(require("path").join(__dirname, "..", "index.js"), "utf8");
    ok("server/index.js arma o rollout gate no boot", /armarRolloutGate/.test(fonteIndex));
    ok("server/index.js não chama mais a auditoria por fora do arme",
      !/ensureSquadsTables\(\)\s*\.then\(\s*\(\)\s*=>\s*require\(["'].\/services\/squads\/squadsMigracaoService["']\)/.test(fonteIndex));
  }

  cfg._resetParaTeste();
  console.log(`\nsquadsRolloutGateBoot.test.js: ${checks} verificações passaram.`);
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
