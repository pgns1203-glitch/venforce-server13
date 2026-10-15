/* Testes puros da linha de fonte das promoções (aba Promoções e Bancada leem a mesma). */
"use strict";

const assert = require("assert");
const fonte = require("./central-margem-promo-fonte.js");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

// Formatador injetado: a data real vem da tela (formatShortDateTime).
const fmt = (v) => (v ? `D(${v})` : null);
const base = { motivo: null, atualizando: false, falha: null, progresso: null, ultimoBom: null, legado: null, origemDados: null };
const bom = { runId: 5, geradoEm: "2026-10-10T12:00:00Z", parcial: false, itensSemLeitura: 0, itensHerdados: 0 };

test("sem fonte: linha vazia", () => {
  assert.strictEqual(fonte.linha(null, { formatDate: fmt }), "");
  assert.strictEqual(fonte.linha(undefined, { formatDate: fmt }), "");
});

test("os 5 estados do pedido, com o texto exato", () => {
  const linha = (o) => fonte.linha({ ...base, ...o }, { formatDate: fmt });
  assert.strictEqual(linha({ estado: "primeira_sincronizacao_pendente", rotulo: "Primeira sincronização pendente" }), "Primeira sincronização pendente");
  assert.strictEqual(linha({ estado: "sincronizando", rotulo: "Sincronizando promoções…", atualizando: true }), "Sincronizando promoções…");
  assert.strictEqual(
    linha({ estado: "desatualizado", rotulo: "atualizando", atualizando: true, ultimoBom: bom, origemDados: "promo_snapshot" }),
    "Promo Snapshot · D(2026-10-10T12:00:00Z) · atualizando",
    "stale: último bom + atualizando + data"
  );
  assert.strictEqual(
    linha({ estado: "falhou", rotulo: "falha na atualização · o Mercado Livre falhou em vários lotes seguidos", falha: { codigo: "X", motivo: "o Mercado Livre falhou em vários lotes seguidos" }, ultimoBom: bom, origemDados: "promo_snapshot" }),
    "Promo Snapshot · D(2026-10-10T12:00:00Z) · falha na atualização · o Mercado Livre falhou em vários lotes seguidos"
  );
  assert.strictEqual(
    linha({ estado: "fora_do_piloto", rotulo: "Promoções automáticas não ativadas para esta conta", motivo: "FORA_DO_PILOTO" }),
    "Promoções automáticas não ativadas para esta conta"
  );
});

test("falhou sem nenhum snapshot bom: só a falha, sem data", () => {
  const l = fonte.linha({ ...base, estado: "falhou", rotulo: "falha na atualização · erro do Mercado Livre", falha: { codigo: "PROMO_SNAPSHOT_ML_ERRO", motivo: "erro do Mercado Livre" } }, { formatDate: fmt });
  assert.strictEqual(l, "falha na atualização · erro do Mercado Livre");
});

test("atualizado: só a origem e a data (sem rótulo de estado)", () => {
  assert.strictEqual(fonte.linha({ ...base, estado: "atualizado", rotulo: "", ultimoBom: bom, origemDados: "promo_snapshot" }, { formatDate: fmt }), "Promo Snapshot · D(2026-10-10T12:00:00Z)");
});

test("parcial e leituras herdadas aparecem na origem", () => {
  const l = fonte.linha({ ...base, estado: "atualizado", rotulo: "", origemDados: "promo_snapshot", ultimoBom: { ...bom, parcial: true, itensHerdados: 3 } }, { formatDate: fmt });
  assert.strictEqual(l, "Promo Snapshot · D(2026-10-10T12:00:00Z) · parcial · 3 com leitura anterior");
});

test("sincronizando mostra o progresso quando o servidor informa", () => {
  const l = fonte.linha({ ...base, estado: "sincronizando", rotulo: "Sincronizando promoções…", atualizando: true, progresso: { processados: 10, total: 100 } }, { formatDate: fmt });
  assert.strictEqual(l, "Sincronizando promoções… (10/100)");
});

test("legado: rotulado 'diagnóstico legado · data'; sem data → 'data desconhecida' (nunca '—'); mantém o rótulo do estado", () => {
  const legado = { diagnosticoId: 91, geradoEm: "2026-10-09T09:00:00Z", parcial: false };
  const comData = fonte.linha({ ...base, estado: "primeira_sincronizacao_pendente", rotulo: "Primeira sincronização pendente", legado, origemDados: "diagnostico_legado" }, { formatDate: fmt });
  assert.strictEqual(comData, "diagnóstico legado · D(2026-10-09T09:00:00Z) · Primeira sincronização pendente");
  const semData = fonte.linha({ ...base, estado: "fora_do_piloto", rotulo: "Promoções automáticas não ativadas para esta conta", legado: { ...legado, geradoEm: null }, origemDados: "diagnostico_legado" }, { formatDate: fmt });
  assert.strictEqual(semData, "diagnóstico legado · data desconhecida · Promoções automáticas não ativadas para esta conta");
  assert.ok(!semData.includes("—"));
});

test("data que o formatador recusa também vira 'data desconhecida'", () => {
  const l = fonte.linha({ ...base, estado: "atualizado", rotulo: "", origemDados: "promo_snapshot", ultimoBom: { ...bom, geradoEm: "lixo" } }, { formatDate: () => "—" });
  assert.strictEqual(l, "Promo Snapshot · data desconhecida");
});

test("estimativa: só promoção marcada pelo servidor (legado) é estimativa", () => {
  assert.strictEqual(fonte.estimativa({ estimativa: true, fonte: "diagnostico_legado" }), true);
  assert.strictEqual(fonte.estimativa({ fonte: "diagnostico_legado" }), true);
  assert.strictEqual(fonte.estimativa({ estimativa: false, fonte: "promo_snapshot" }), false);
  assert.strictEqual(fonte.estimativa({}), false);
  assert.strictEqual(fonte.estimativa(null), false);
});

test("sincronizando/pendente com fila (autoTrigger) conta como 'sincronizando' para o polling", () => {
  assert.strictEqual(fonte.sincronizando({ ...base, estado: "sincronizando" }), true);
  assert.strictEqual(fonte.sincronizando({ ...base, estado: "primeira_sincronizacao_pendente" }, "enfileirado"), true);
  assert.strictEqual(fonte.sincronizando({ ...base, estado: "primeira_sincronizacao_pendente" }, "nenhuma"), false);
  assert.strictEqual(fonte.sincronizando({ ...base, estado: "fora_do_piloto" }, "enfileirado"), false);
  assert.strictEqual(fonte.sincronizando(null), false);
});

console.log(`central-margem-promo-fonte: ${passed} testes ok`);
