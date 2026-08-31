// server/tests/jwtSecretBoot.test.js
//
// VenForce V3 — Pós-Convergência #2 (BLOCO 14 / 19).
//
// O segredo de assinatura é resolvido de forma preguiçosa (config/jwtSecret.js),
// mas em produção o servidor NÃO PODE subir com JWT_SECRET ausente/fraco e só
// falhar no primeiro login. index.js chama getJwtSecret() ANTES de app.listen
// e faz process.exit(1) se ela lançar.
//
// Este teste sobe o index.js REAL como subprocesso, variando só o ambiente, e
// checa o exit code + a mensagem. `PORT=0` (porta efêmera) e um DATABASE_URL
// inalcançável garantem que, no cenário "sobe", a gente derrube o processo
// rápido sem depender de Postgres — o pool do pg só conecta sob demanda, e a
// checagem de JWT acontece antes de qualquer query.

const assert = require("assert");
const { spawnSync } = require("child_process");
const path = require("path");

const indexPath = path.join(__dirname, "..", "index.js");
let checks = 0;

function bootCom(env, timeout = 6000) {
  return spawnSync(process.execPath, [indexPath], {
    encoding: "utf8",
    timeout,
    killSignal: "SIGKILL",
    env: {
      ...process.env,
      PORT: "0",
      DATABASE_URL: "postgres://127.0.0.1:1/vf_boot_test",
      ...env,
    },
  });
}

function ok(label, cond) {
  assert.ok(cond, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

// ---------- produção SEM JWT_SECRET → exit 1, mensagem acionável ----------
{
  const r = bootCom({ NODE_ENV: "production", JWT_SECRET: "" });
  const saida = (r.stdout || "") + (r.stderr || "");
  ok("producao sem JWT_SECRET: exit code 1", r.status === 1);
  ok("producao sem JWT_SECRET: mensagem de boot cita JWT_SECRET e producao",
    /\[boot\]/.test(saida) && /JWT_SECRET/.test(saida) && /production/i.test(saida));
  ok("producao sem JWT_SECRET: NAO chega a logar 'VenForce rodando'", !/VenForce rodando/.test(saida));
  ok("producao sem JWT_SECRET: o segredo de dev nao vaza na saida", !saida.includes("venforce_secret_local"));
}

// ---------- produção com o segredo de DEV → exit 1 ----------
{
  const r = bootCom({ NODE_ENV: "production", JWT_SECRET: "venforce_secret_local" });
  ok("producao com segredo de dev: exit code 1", r.status === 1);
}

// ---------- produção com segredo curto → exit 1 ----------
{
  const r = bootCom({ NODE_ENV: "production", JWT_SECRET: "curto-demais" });
  ok("producao com segredo curto: exit code 1", r.status === 1);
}

// ---------- produção com segredo forte → passa da checagem de JWT ----------
// (o processo depois tenta subir e falha/trava no Postgres inalcançável; o
// que provamos aqui é que NÃO morreu com a mensagem [boot] de JWT.)
{
  const r = bootCom({ NODE_ENV: "production", JWT_SECRET: "x".repeat(48) });
  const saida = (r.stdout || "") + (r.stderr || "");
  ok("producao com segredo forte: nao morre na checagem [boot] de JWT_SECRET",
    !/\[boot\].*JWT_SECRET/.test(saida));
}

console.log(`\njwtSecretBoot.test.js: ${checks} verificacoes passaram.`);
