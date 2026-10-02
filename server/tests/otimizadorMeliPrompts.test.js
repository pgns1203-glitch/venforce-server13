// server/tests/otimizadorMeliPrompts.test.js
//
// Prompts do Otimizador IA de anúncios Meli.
//
// O que este teste protege:
//
//  1. a descrição REAL do anúncio (lida do Mercado Livre pelo service) chega
//     ao prompt de descrição. Antes, `blocoDadosCompleto` lia
//     `anuncio.descricao_atual` — coluna que não existe em meli_anuncios — e
//     ignorava o valor recebido: o prompt sempre dizia "(sem descrição)";
//  2. anúncio sem descrição continua dizendo "(sem descrição)";
//  3. leitura que FALHOU não se disfarça de "sem descrição" — a IA não pode
//     tratar como vazio um texto que só não conseguimos ler;
//  4. a descrição de um anúncio nunca aparece no prompt de outro.

const assert = require("assert");
const prompts = require("../services/meliAnuncios/otimizadorMeliPrompts");

function anuncio(over = {}) {
  return {
    item_id: "MLB1", titulo: "Tênis Infantil Menino", modelo: "X1", marca: "Marca A",
    category_id: "MLB23332", sku: "SKU1", preco: 99.9,
    attributes_json: [{ id: "BRAND", name: "Marca", value: "Marca A" }],
    ...over,
  };
}

let falhas = 0;
function check(nome, fn) {
  try { fn(); console.log("  ✓ " + nome); }
  catch (e) { falhas++; console.error("  ✗ " + nome + "\n    " + e.message); }
}

console.log("otimizadorMeliPrompts");

check("1 — descrição real lida do ML chega ao prompt de descrição", () => {
  const p = prompts.montarPrompt("descricao", anuncio(), { descricaoAtual: "Solado de borracha antiderrapante." });
  assert.ok(p.includes("Solado de borracha antiderrapante."), "a descrição real não chegou ao prompt");
  assert.ok(!p.includes("(sem descrição)"), "o prompt disse '(sem descrição)' com descrição real presente");
});

check("1b — o mesmo vale para o prompt de ficha técnica (recebe o mesmo extra)", () => {
  // ficha_tecnica usa o bloco enxuto (sem descrição) — o contrato é só não quebrar.
  const p = prompts.montarPrompt("ficha_tecnica", anuncio(), { descricaoAtual: "Qualquer" });
  assert.ok(typeof p === "string" && p.length > 0);
});

check("1c — descrição longa é truncada com reticências (comportamento preservado)", () => {
  const longa = "a".repeat(500);
  const p = prompts.montarPrompt("descricao", anuncio(), { descricaoAtual: longa });
  assert.ok(p.includes("a".repeat(350) + "..."), "truncamento em 350 + '...' não preservado");
  assert.ok(!p.includes("a".repeat(351)), "passou de 350 caracteres");
});

check("2 — anúncio sem descrição continua '(sem descrição)'", () => {
  for (const vazio of [null, undefined, "", "   "]) {
    const p = prompts.montarPrompt("descricao", anuncio(), { descricaoAtual: vazio });
    assert.ok(p.includes("(sem descrição)"), "faltou '(sem descrição)' para " + JSON.stringify(vazio));
  }
});

check("3 — leitura que falhou NÃO vira '(sem descrição)'", () => {
  const p = prompts.montarPrompt("descricao", anuncio(), { descricaoAtual: null, descricaoEstado: "erro" });
  assert.ok(!p.includes("(sem descrição)"), "falha de leitura foi apresentada como ausência");
  assert.ok(/não foi possível ler a descrição atual/i.test(p));
});

check("4 — descrição do item A não contamina o prompt do item B", () => {
  const pa = prompts.montarPrompt("descricao", anuncio({ item_id: "MLB-A" }), { descricaoAtual: "TEXTO-DO-A" });
  const pb = prompts.montarPrompt("descricao", anuncio({ item_id: "MLB-B" }), { descricaoAtual: null });
  assert.ok(pa.includes("TEXTO-DO-A"));
  assert.ok(!pb.includes("TEXTO-DO-A"), "estado vazou entre chamadas");
  // e uma propriedade fantasma no objeto do anúncio não é mais lida
  const pc = prompts.montarPrompt("descricao", anuncio({ descricao_atual: "FANTASMA" }), { descricaoAtual: null });
  assert.ok(!pc.includes("FANTASMA"), "o prompt ainda lê anuncio.descricao_atual");
});

check("5 — prompt de seo não recebe descrição (comportamento preservado)", () => {
  const p = prompts.montarPrompt("seo", anuncio(), { descricaoAtual: "NAO-DEVE-IR" });
  assert.ok(!p.includes("NAO-DEVE-IR"));
});

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1); }
console.log("\n✓ otimizadorMeliPrompts ok");
