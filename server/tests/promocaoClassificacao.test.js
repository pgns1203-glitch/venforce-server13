// server/tests/promocaoClassificacao.test.js
// Grupo (ativa · participa · pode · ml) e escrita suportada de uma promoção na
// Central de Margem — pura, sem banco nem Mercado Livre.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://127.0.0.1:1/dead";

const assert = require("assert");
const { classificarPromocao, urlPromocoesMl, GRUPOS } = require("../services/motorMargem/precificacao/promocaoClassificacao");
const { TIPOS_COM_ESCRITA } = require("../services/meliAnuncios/meliPromocoesEscritaService");
const { TIPOS_ESCRITA_ACEITE, TIPOS_ESCRITA_PRECO } = require("../services/meliAnuncios/meliPromocoesService");
const tiposSuportados = require("../services/meliAnuncios/promocaoTiposSuportados");

const casos = [];
function cenario(nome, fn) {
  casos.push({ nome, fn });
}

const classe = (p) => classificarPromocao(p, { tiposComEscrita: TIPOS_COM_ESCRITA });

cenario("ATIVA → 'Ativa agora' (a que forma o preço), com ALTERAR suportado nos tipos que a Central escreve", () => {
  const r = classe({ tipo: "DEAL", status: "started", statusExibicao: "ATIVA" });
  assert.strictEqual(r.grupo, GRUPOS.ATIVA);
  assert.deepStrictEqual(r.escrita, { suportada: true, acao: "ALTERAR", modo: "preco", motivo: null });
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
    assert.deepStrictEqual(r.escrita, { suportada: true, acao: "PARTICIPAR", modo: "preco", motivo: null });
  }
});

cenario("elegível de tipo em que o ML define o preço (ACEITE) → 'Pode participar pelo VenForce' com PARTICIPAR no modo aceite", () => {
  for (const tipo of ["MARKETPLACE_CAMPAIGN", "SMART", "PRICE_MATCHING", "PRICE_MATCHING_MELI_ALL", "PRE_NEGOTIATED", "UNHEALTHY_STOCK"]) {
    const r = classe({ tipo, status: "candidate", statusExibicao: "ELEGÍVEL" });
    assert.strictEqual(r.grupo, GRUPOS.PODE, tipo);
    assert.deepStrictEqual(r.escrita, { suportada: true, acao: "PARTICIPAR", modo: "aceite", motivo: null }, tipo);
  }
});

cenario("ACEITE já ativa ou inscrita: nunca vira ALTERAR (o ML define o preço) — Ativa agora / Você já participa, só simulação", () => {
  const ativa = classe({ tipo: "SMART", status: "started", statusExibicao: "ATIVA" });
  assert.strictEqual(ativa.grupo, GRUPOS.ATIVA);
  assert.strictEqual(ativa.escrita.suportada, false);
  assert.strictEqual(ativa.escrita.acao, null);
  assert.strictEqual(ativa.escrita.modo, "aceite");
  assert.ok(/Mercado Livre define o preço/.test(ativa.escrita.motivo));
  const programada = classe({ tipo: "PRICE_MATCHING", status: "pending", statusExibicao: "PROGRAMADA" });
  assert.strictEqual(programada.grupo, GRUPOS.PARTICIPA);
  assert.strictEqual(programada.escrita.suportada, false);
});

cenario("tipos sem escrita (PRICE_DISCOUNT, DOD, LIGHTNING, VOLUME, cupom, desconhecido) → 'Só pelo Mercado Livre' com motivo claro", () => {
  const motivos = {
    PRICE_DISCOUNT: /datas de início\/fim/,
    DOD: /oferta do dia/,
    LIGHTNING: /oferta relâmpago/,
    VOLUME: /desconto por quantidade/,
    SELLER_COUPON_CAMPAIGN: /cupons/,
    XPTO: /não tem participação automática/,
    null: /não tem participação automática/,
  };
  for (const [tipo, re] of Object.entries(motivos)) {
    const r = classe({ tipo: tipo === "null" ? null : tipo, status: "candidate", statusExibicao: "ELEGÍVEL" });
    assert.strictEqual(r.grupo, GRUPOS.ML, tipo);
    assert.strictEqual(r.escrita.suportada, false);
    assert.strictEqual(r.escrita.modo, null);
    assert.ok(/^Somente simulação: /.test(r.escrita.motivo), r.escrita.motivo);
    assert.ok(re.test(r.escrita.motivo), `${tipo}: ${r.escrita.motivo}`);
    assert.ok(/painel do Mercado Livre/.test(r.escrita.motivo));
  }
});

cenario("status desconhecido ou vazio nunca vira 'pode' (sem escrita por engano)", () => {
  for (const status of [null, "", "paused", "finished"]) {
    assert.strictEqual(classe({ tipo: "DEAL", status, statusExibicao: "ELEGÍVEL" }).grupo, GRUPOS.ML, String(status));
  }
});

cenario("contrato: a Central escreve nos MESMOS tipos que /anuncios (fonte única promocaoTiposSuportados)", () => {
  assert.deepStrictEqual([...TIPOS_COM_ESCRITA].sort(), [...TIPOS_ESCRITA_PRECO].sort());
  assert.strictEqual(TIPOS_ESCRITA_ACEITE, tiposSuportados.TIPOS_ESCRITA_ACEITE);
  for (const tipo of TIPOS_ESCRITA_PRECO) {
    assert.strictEqual(classificarPromocao({ tipo, status: "candidate", statusExibicao: "ELEGÍVEL" }).escrita.modo, "preco", tipo);
  }
  // Sem injetar tipos: a classificação lê a fonte única (a mesma lista de /anuncios).
  for (const tipo of TIPOS_ESCRITA_ACEITE) {
    const r = classificarPromocao({ tipo, status: "candidate", statusExibicao: "ELEGÍVEL" });
    assert.strictEqual(r.grupo, GRUPOS.PODE, tipo);
    assert.strictEqual(r.escrita.modo, "aceite", tipo);
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
