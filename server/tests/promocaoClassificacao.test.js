// server/tests/promocaoClassificacao.test.js
// Grupo (ativa · participa · pode · ml) e escrita suportada de uma promoção na
// Central de Margem — pura, sem banco nem Mercado Livre.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://127.0.0.1:1/dead";

const assert = require("assert");
const { classificarPromocao, urlPromocoesMl, GRUPOS } = require("../services/motorMargem/precificacao/promocaoClassificacao");
const { TIPOS_COM_ESCRITA } = require("../services/meliAnuncios/meliPromocoesEscritaService");
const { TIPOS_ESCRITA_ACEITE, TIPOS_ESCRITA_PRECO } = require("../services/meliAnuncios/meliPromocoesService");

const casos = [];
function cenario(nome, fn) {
  casos.push({ nome, fn });
}

const classe = (p) => classificarPromocao(p, { tiposComEscrita: TIPOS_COM_ESCRITA });

cenario("ATIVA → 'Ativa agora' (a que forma o preço), com ALTERAR suportado nos tipos que a Central escreve", () => {
  const r = classe({ tipo: "DEAL", status: "started", statusExibicao: "ATIVA" });
  assert.strictEqual(r.grupo, GRUPOS.ATIVA);
  assert.deepStrictEqual(r.escrita, { suportada: true, acao: "ALTERAR", motivo: null });
});

cenario("inscrita que não forma o preço (NÃO APLICADA / PROGRAMADA) → 'Você já participa', só simulação", () => {
  for (const [status, exibicao] of [["started", "NÃO APLICADA"], ["active", "NÃO APLICADA"], ["pending", "PROGRAMADA"]]) {
    const r = classe({ tipo: "DEAL", status, statusExibicao: exibicao });
    assert.strictEqual(r.grupo, GRUPOS.PARTICIPA, `${status}/${exibicao}`);
    assert.strictEqual(r.escrita.suportada, false);
    assert.ok(r.escrita.motivo);
  }
});

cenario("elegível (candidate) de tipo que a Central escreve → 'Pode participar pelo VenForce' com PARTICIPAR", () => {
  for (const tipo of ["DEAL", "SELLER_CAMPAIGN"]) {
    const r = classe({ tipo, status: "candidate", statusExibicao: "ELEGÍVEL" });
    assert.strictEqual(r.grupo, GRUPOS.PODE, tipo);
    assert.deepStrictEqual(r.escrita, { suportada: true, acao: "PARTICIPAR", motivo: null });
  }
});

cenario("elegível de tipo em que o ML define o preço (ou sem escrita) → 'Só pelo Mercado Livre'", () => {
  for (const tipo of ["SMART", "MARKETPLACE_CAMPAIGN", "PRICE_MATCHING", "PRE_NEGOTIATED", "UNHEALTHY_STOCK", "LIGHTNING", "DOD", "PRICE_DISCOUNT", "VOLUME", null]) {
    const r = classe({ tipo, status: "candidate", statusExibicao: "ELEGÍVEL" });
    assert.strictEqual(r.grupo, GRUPOS.ML, String(tipo));
    assert.strictEqual(r.escrita.suportada, false);
    assert.ok(/Somente simulação/.test(r.escrita.motivo));
  }
});

cenario("status desconhecido ou vazio nunca vira 'pode' (sem escrita por engano)", () => {
  for (const status of [null, "", "paused", "finished"]) {
    assert.strictEqual(classe({ tipo: "DEAL", status, statusExibicao: "ELEGÍVEL" }).grupo, GRUPOS.ML, String(status));
  }
});

cenario("contrato: a Central escreve só os tipos de PREÇO do serviço de Anúncios; os de ACEITE ficam fora (até terem preview/auditoria próprios)", () => {
  assert.deepStrictEqual([...TIPOS_COM_ESCRITA].sort(), [...TIPOS_ESCRITA_PRECO].sort());
  for (const tipo of TIPOS_ESCRITA_ACEITE) {
    assert.strictEqual(classe({ tipo, status: "candidate", statusExibicao: "ELEGÍVEL" }).grupo, GRUPOS.ML, tipo);
  }
});

cenario("urlPromocoesMl: link do painel do ML pela parte numérica do MLB", () => {
  assert.strictEqual(urlPromocoesMl("MLB4147165927"), "https://www.mercadolivre.com.br/anuncios/lista/promos?page=1&search=4147165927");
  assert.strictEqual(urlPromocoesMl("mlb123"), "https://www.mercadolivre.com.br/anuncios/lista/promos?page=1&search=123");
  assert.strictEqual(urlPromocoesMl(""), null);
  assert.strictEqual(urlPromocoesMl(null), null);
});

(async () => {
  let falhas = 0;
  for (const { nome, fn } of casos) {
    try {
      await fn();
      console.log(`  ✓ ${nome}`);
    } catch (err) {
      falhas += 1;
      console.log(`  ✗ ${nome}\n    ${err.message}\n    ${(err.stack.split("\n").find((l) => l.includes(".test.js")) || "").trim()}`);
    }
  }
  if (falhas) {
    console.log(`promocaoClassificacao: ${falhas} de ${casos.length} cenários falharam`);
    process.exit(1);
  }
  console.log(`promocaoClassificacao: ok (${casos.length} cenários)`);
})();
