/*
 * Barra de atualização das promoções (central-margem-promo-sync.js): cada
 * estado do Promo Snapshot da conta vira o texto/botão certo, sem a tela
 * decidir nada por conta própria e sem "fingir" que iniciou.
 */
"use strict";

const assert = require("assert");
const S = require("./central-margem-promo-sync.js");

let checks = 0;
function check(nome, fn) { fn(); checks += 1; console.log(`ok ${checks} - ${nome}`); }

const fmt = (v) => (v ? "04/11 10:00" : "—");
const DISP = { disponivel: true, motivo: null, mensagem: null };
function status(extra = {}) {
  return {
    ok: true, clienteContaId: 87, contaNome: "Alianza Jeans 2", sellerId: "2433262404",
    worker: { habilitado: true, noPiloto: true },
    sync: { state: "never_synced", hasSnapshot: false, snapshotState: "none", activeRun: null, ageMinutes: null },
    ultimaTentativa: null, atualizacao: DISP, ...extra,
  };
}

check("sem leitura: 'Buscar promoções' habilitado, conta identificada", () => {
  const m = S.modelo(status(), { formatDate: fmt });
  assert.strictEqual(m.estado, "sem_leitura");
  assert.strictEqual(m.botao.rotulo, "Buscar promoções");
  assert.strictEqual(m.botao.habilitado, true);
  assert.strictEqual(m.conta, "Alianza Jeans 2 · conta 87 · seller 2433262404");
  assert.strictEqual(m.acompanhar, false);
});

check("worker desligado: botão desabilitado com o motivo do servidor (nunca finge que iniciou)", () => {
  const m = S.modelo(status({ atualizacao: { disponivel: false, motivo: "WORKER_DESABILITADO", mensagem: "desligada neste ambiente" } }));
  assert.strictEqual(m.botao.habilitado, false);
  assert.strictEqual(m.botao.titulo, "desligada neste ambiente");
  assert.ok(/desligada neste ambiente/.test(m.detalhe));
});

check("fora da allowlist: aviso explícito", () => {
  const m = S.modelo(status({ atualizacao: { disponivel: false, motivo: "FORA_DO_PILOTO", mensagem: "não está liberada para esta conta" } }));
  assert.ok(/não está liberada/.test(m.detalhe));
  assert.strictEqual(m.botao.habilitado, false);
});

check("sincronizando: progresso real X de Y (%), 429 e itens sem leitura; botão travado; acompanha", () => {
  const m = S.modelo(status({
    sync: { state: "syncing", hasSnapshot: true, snapshotAt: "x", ageMinutes: 30, snapshotState: "fresh",
      activeRun: { runId: 9, status: "running", itensProcessados: 30, itensTotal: 60, rateLimits: 2, erros: 1 } },
    atualizacao: { disponivel: false, motivo: "EM_ANDAMENTO", mensagem: "em andamento" },
  }), { formatDate: fmt });
  assert.strictEqual(m.estado, "sincronizando");
  assert.strictEqual(m.acompanhar, true);
  assert.strictEqual(m.botao.habilitado, false);
  assert.strictEqual(m.progresso.pct, 50);
  assert.ok(/30 de 60 anúncios lidos \(50%\)/.test(m.detalhe), m.detalhe);
  assert.ok(/2 pausas por limite do Mercado Livre \(429\)/.test(m.detalhe));
  assert.ok(/1 anúncio sem leitura/.test(m.detalhe));
  assert.ok(/continua exibida até terminar/.test(m.detalhe));
});

check("na fila: texto de fila, sem porcentagem inventada", () => {
  const m = S.modelo(status({ sync: { state: "syncing", hasSnapshot: false, activeRun: { runId: 9, status: "queued", itensProcessados: 0, itensTotal: null } } }));
  assert.ok(/Na fila/.test(m.detalhe));
  assert.strictEqual(m.progresso.pct, null);
});

check("falhou com snapshot: motivo verificável + dados ANTIGOS; 'Tentar de novo'", () => {
  const m = S.modelo(status({
    sync: { state: "failed", hasSnapshot: true, snapshotAt: "x", ageMinutes: 120, snapshotState: "fresh", activeRun: null },
    ultimaTentativa: { status: "failed", erroCodigo: "PROMO_SNAPSHOT_LOTES_FALHANDO", erroMotivo: "o Mercado Livre falhou em vários lotes seguidos", erroMensagem: "3 lotes", rateLimits: 7 },
  }), { formatDate: fmt });
  assert.strictEqual(m.estado, "falhou");
  assert.strictEqual(m.tom, "danger");
  assert.ok(/falhou: o Mercado Livre falhou em vários lotes seguidos — 3 lotes — 7 respostas 429/.test(m.titulo), m.titulo);
  assert.ok(/dados ANTIGOS/.test(m.detalhe));
  assert.strictEqual(m.botao.rotulo, "Tentar de novo");
});

check("falhou sem snapshot: diz que não há leitura válida (nunca zero)", () => {
  const m = S.modelo(status({ sync: { state: "failed", hasSnapshot: false, activeRun: null }, ultimaTentativa: { status: "failed", erroCodigo: "ML_GRANT_REVOKED", erroMotivo: "conexão com o Mercado Livre revogada" } }));
  assert.ok(/revogada/.test(m.titulo));
  assert.ok(/Nenhuma leitura válida/.test(m.detalhe));
});

check("desatualizado: data + idade + Atualizar", () => {
  const m = S.modelo(status({ sync: { state: "stale", hasSnapshot: true, snapshotAt: "x", ageMinutes: 13 * 60, snapshotState: "stale", activeRun: null } }), { formatDate: fmt });
  assert.strictEqual(m.estado, "desatualizado");
  assert.ok(/há 13 h/.test(m.titulo) && /desatualizada/.test(m.titulo), m.titulo);
  assert.strictEqual(m.botao.habilitado, true);
});

check("atualizado + parcial + resultado do último run; cooldown desabilita com minutos", () => {
  const m = S.modelo(status({
    sync: { state: "partial", hasSnapshot: true, snapshotAt: "x", ageMinutes: 2, snapshotState: "fresh", partial: true, itemsWithoutRead: 3, itemsInherited: 2, activeRun: null },
    ultimaTentativa: { status: "partial", itensTotal: 60, promocoes: 48, erros: 3, duracaoSegundos: 95 },
    atualizacao: { disponivel: false, motivo: "COOLDOWN", mensagem: "aguarde", cooldownRestanteMinutos: 12 },
  }), { formatDate: fmt });
  assert.strictEqual(m.estado, "atualizado");
  assert.ok(/parcial: 3 anúncios sem leitura \(2 com a leitura anterior\)/.test(m.detalhe), m.detalhe);
  assert.ok(/60 anúncios lidos · 48 promoções · 3 sem leitura · em 2 min/.test(m.detalhe), m.detalhe);
  assert.ok(/aguarde \(12 min\)/.test(m.detalhe));
  assert.strictEqual(m.botao.habilitado, false);
});

check("conta sem conexão ML", () => {
  const m = S.modelo(status({ sync: null, atualizacao: { disponivel: false, motivo: "CONTA_SEM_GRANT_ML", mensagem: "sem conexão" } }));
  assert.strictEqual(m.estado, "sem_conta_ml");
  assert.strictEqual(m.botao.habilitado, false);
});

check("erro ao ler o status: estado próprio, botão desabilitado", () => {
  const m = S.modelo(null, { erro: "HTTP 500" });
  assert.strictEqual(m.estado, "erro_status");
  assert.strictEqual(m.botao.habilitado, false);
});

check("resultado do POST: enfileirado/reaproveitado iniciam; motivo do servidor não", () => {
  assert.strictEqual(S.resultadoDoPedido({ ok: true, enfileirado: true }).iniciou, true);
  assert.strictEqual(S.resultadoDoPedido({ ok: true, reaproveitado: true }).iniciou, true);
  const r = S.resultadoDoPedido({ ok: true, enfileirado: false, motivo: "COOLDOWN", mensagem: "aguarde", cooldownRestanteMinutos: 4 });
  assert.strictEqual(r.iniciou, false);
  assert.strictEqual(r.texto, "aguarde (4 min)");
  assert.strictEqual(S.resultadoDoPedido({ ok: false, error: "HTTP 403" }).texto, "HTTP 403");
});

check("terminou: havia run ativo e agora não há", () => {
  const ativo = { sync: { activeRun: { runId: 1 } } };
  const livre = { sync: { activeRun: null } };
  assert.strictEqual(S.terminou(ativo, livre), true);
  assert.strictEqual(S.terminou(livre, livre), false);
  assert.strictEqual(S.terminou(null, livre), false);
});

check("run na fila com worker DESLIGADO: estado 'parado', nunca 'atualizando', sem acompanhar", () => {
  const m = S.modelo(status({
    sync: { state: "syncing", hasSnapshot: true, snapshotAt: "x", ageMinutes: 60, activeRun: { runId: 5, status: "queued", itensProcessados: 0 } },
    atualizacao: { disponivel: false, motivo: "WORKER_DESABILITADO", mensagem: "desligada neste ambiente", runParado: 5 },
  }), { formatDate: fmt });
  assert.strictEqual(m.estado, "parado");
  assert.strictEqual(m.acompanhar, false);
  assert.strictEqual(m.botao.habilitado, false);
  assert.ok(/não vai avançar/.test(m.titulo));
});

check("run em andamento com conta fora do piloto: acompanha e mostra o aviso", () => {
  const m = S.modelo(status({
    sync: { state: "syncing", hasSnapshot: false, activeRun: { runId: 5, status: "running", itensProcessados: 3, itensTotal: 10 } },
    atualizacao: { disponivel: false, motivo: "FORA_DO_PILOTO", mensagem: "não está liberada", runId: 5 },
  }));
  assert.strictEqual(m.estado, "sincronizando");
  assert.ok(/não está liberada/.test(m.detalhe));
});

check("terminou: run PEDIDO que já saiu da fila antes do 1º status (run rápido) e troca de snapshot", () => {
  const livreA = { sync: { activeRun: null, snapshotRunId: 10 } };
  const livreB = { sync: { activeRun: null, snapshotRunId: 11 } };
  assert.strictEqual(S.terminou(livreA, livreA, 77), true, "run pedido não está mais ativo");
  assert.strictEqual(S.terminou(livreA, { sync: { activeRun: { runId: 77 }, snapshotRunId: 10 } }, 77), false, "ainda rodando");
  assert.strictEqual(S.terminou(livreA, livreB, null), true, "snapshot novo promovido");
  assert.strictEqual(S.terminou(livreA, livreA, null), false);
});

check("releituraEmMs: só no cooldown, até 16 min", () => {
  assert.strictEqual(S.releituraEmMs(status({ atualizacao: { disponivel: false, motivo: "COOLDOWN", cooldownRestanteMinutos: 3 } })), 3 * 60000 + 2000);
  assert.strictEqual(S.releituraEmMs(status({ atualizacao: { disponivel: false, motivo: "COOLDOWN", cooldownRestanteMinutos: 400 } })), 16 * 60000 + 2000);
  assert.strictEqual(S.releituraEmMs(status()), null);
  assert.strictEqual(S.releituraEmMs(status({ atualizacao: { disponivel: false, motivo: "WORKER_DESABILITADO" } })), null);
});

console.log(`# ${checks} testes da barra de atualização das promoções`);
