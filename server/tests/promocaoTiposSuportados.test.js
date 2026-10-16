// server/tests/promocaoTiposSuportados.test.js
// Fonte ÚNICA dos tipos de promoção em que o VenForce escreve
// (services/meliAnuncios/promocaoTiposSuportados.js):
//   - as listas são EXATAMENTE as que /anuncios já usava (nada muda lá);
//   - /anuncios (meliPromocoesService, meliPromocoesEscritaService) e a Central
//     (promocaoClassificacao / precificacaoAvaliacao) leem os MESMOS objetos.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://127.0.0.1:1/dead";

const assert = require("assert");
const tipos = require("../services/meliAnuncios/promocaoTiposSuportados");
const meliPromocoesService = require("../services/meliAnuncios/meliPromocoesService");
const escritaService = require("../services/meliAnuncios/meliPromocoesEscritaService");
const avaliacao = require("../services/motorMargem/precificacao/precificacaoAvaliacao");

const casos = [];
function cenario(nome, fn) {
  casos.push({ nome, fn });
}

// As listas que /anuncios usava ANTES da extração (meliPromocoesService/meliPromocoesEscritaService).
const PRECO_ANTES = ["DEAL", "SELLER_CAMPAIGN"];
const ACEITE_ANTES = ["MARKETPLACE_CAMPAIGN", "SMART", "PRICE_MATCHING", "PRICE_MATCHING_MELI_ALL", "PRE_NEGOTIATED", "UNHEALTHY_STOCK"];

cenario("listas idênticas às de /anuncios antes da extração (mesma ordem, mesmo conteúdo)", () => {
  assert.deepStrictEqual([...tipos.TIPOS_ESCRITA_PRECO], PRECO_ANTES);
  assert.deepStrictEqual([...tipos.TIPOS_ESCRITA_ACEITE], ACEITE_ANTES);
  assert.deepStrictEqual([...tipos.TIPOS_ACEITE_SEM_OFFER_NO_POST], ["MARKETPLACE_CAMPAIGN"]);
});

cenario("/anuncios importa os MESMOS objetos (meliPromocoesService e o escritor)", () => {
  assert.strictEqual(meliPromocoesService.TIPOS_ESCRITA_PRECO, tipos.TIPOS_ESCRITA_PRECO);
  assert.strictEqual(meliPromocoesService.TIPOS_ESCRITA_ACEITE, tipos.TIPOS_ESCRITA_ACEITE);
  assert.strictEqual(meliPromocoesService.modoEscritaPromocao, tipos.modoEscritaPromocao);
  assert.strictEqual(escritaService.TIPOS_COM_ESCRITA, tipos.TIPOS_ESCRITA_PRECO);
});

cenario("modoEscritaPromocao: mesmo resultado de antes para todo tipo conhecido (case/espaço tolerados)", () => {
  for (const t of PRECO_ANTES) assert.strictEqual(tipos.modoEscritaPromocao(t), "PRECO", t);
  for (const t of ACEITE_ANTES) assert.strictEqual(tipos.modoEscritaPromocao(t), "ACEITE", t);
  for (const t of ["PRICE_DISCOUNT", "DOD", "LIGHTNING", "VOLUME", "SELLER_COUPON_CAMPAIGN", "", null, undefined]) {
    assert.strictEqual(tipos.modoEscritaPromocao(t), null, String(t));
  }
  assert.strictEqual(tipos.modoEscritaPromocao(" smart "), "ACEITE");
});

cenario("aceiteExigeOffer: todo ACEITE menos MARKETPLACE_CAMPAIGN; tipos de preço nunca", () => {
  for (const t of ACEITE_ANTES) assert.strictEqual(tipos.aceiteExigeOffer(t), t !== "MARKETPLACE_CAMPAIGN", t);
  assert.strictEqual(tipos.aceiteExigeOffer("DEAL"), false);
  assert.strictEqual(tipos.aceiteExigeOffer("LIGHTNING"), false);
});

cenario("motivoTipoSemEscrita: null para suportados; motivo específico ou genérico para os demais", () => {
  for (const t of [...PRECO_ANTES, ...ACEITE_ANTES]) assert.strictEqual(tipos.motivoTipoSemEscrita(t), null, t);
  assert.ok(/datas/.test(tipos.motivoTipoSemEscrita("PRICE_DISCOUNT")));
  assert.ok(/oferta do dia/.test(tipos.motivoTipoSemEscrita("DOD")));
  assert.ok(/relâmpago/.test(tipos.motivoTipoSemEscrita("LIGHTNING")));
  assert.ok(/quantidade/.test(tipos.motivoTipoSemEscrita("VOLUME")));
  assert.ok(/não tem participação automática/.test(tipos.motivoTipoSemEscrita("QUALQUER")));
});

cenario("a Central lê a fonte única: escritaDaPromocao sem injetar aceite usa a lista compartilhada", () => {
  for (const t of ACEITE_ANTES) {
    const r = avaliacao.escritaDaPromocao({ tipo: t, status: "candidate", statusExibicao: "ELEGÍVEL" }, tipos.TIPOS_ESCRITA_PRECO);
    assert.deepStrictEqual(r, { suportada: true, acao: "PARTICIPAR", modo: "aceite", motivo: null }, t);
  }
});

(async () => {
  let falhas = 0;
  for (const { nome, fn } of casos) {
    try {
      await fn();
      console.log(`  ✓ ${nome}`);
    } catch (err) {
      falhas += 1;
      console.log(`  ✗ ${nome}\n    ${err.message}`);
    }
  }
  if (falhas) {
    console.log(`promocaoTiposSuportados: ${falhas} de ${casos.length} cenários falharam`);
    process.exit(1);
  }
  console.log(`promocaoTiposSuportados: ok (${casos.length} cenários)`);
})();
