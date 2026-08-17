// server/tests/clientesContasResumo.test.js
//
// Fechamento da Fase 1 — cobre a lógica PURA (sem DOM) por trás da nova
// coluna "Contas" de /clientes.html e da expansão inline que substitui o
// drawer: Portal/clientes-contas-resumo.js.

const assert = require("assert");
const {
  classificarStatusConta,
  resumirContasMarketplace,
  criarExpansaoUnica,
} = require("../../Portal/clientes-contas-resumo");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}
function eq(label, actual, expected) {
  assert.deepStrictEqual(actual, expected, `${label}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

const contaMl = (over = {}) => ({ marketplace: "meli", ativo: true, grant: null, ...over });
const contaShopee = (over = {}) => ({ marketplace: "shopee", ativo: true, base: null, ...over });

console.log("\n▸ Mercado Livre — 1 conta válida (item 8)");
{
  const r = resumirContasMarketplace("meli", [contaMl({ grant: { token_status: "valid" } })]);
  eq("estado saudável", r.state, "saudavel");
  eq("símbolo ●", r.symbol, "●");
  eq("texto: 1 conectada", r.texto, "1 conectada");
}

console.log("\n▸ Mercado Livre — ML1 válido + ML2 sem grant (item 9)");
{
  const r = resumirContasMarketplace("meli", [
    contaMl({ grant: { token_status: "valid" } }),
    contaMl({ grant: null }),
  ]);
  eq("estado pendência", r.state, "pendencia");
  eq("símbolo ⚠", r.symbol, "⚠");
  eq("texto: 1/2 conectadas", r.texto, "1/2 conectadas");
}

console.log("\n▸ Mercado Livre — 2/2 conectadas (múltiplas contas saudáveis)");
{
  const r = resumirContasMarketplace("meli", [
    contaMl({ grant: { token_status: "valid" } }),
    contaMl({ grant: { token_status: "valid" } }),
  ]);
  eq("estado saudável", r.state, "saudavel");
  eq("texto: 2/2 conectadas", r.texto, "2/2 conectadas");
}

console.log("\n▸ Mercado Livre — grant com problema conta como vermelho, não amarelo");
{
  const r = resumirContasMarketplace("meli", [
    contaMl({ grant: { token_status: "valid" } }),
    contaMl({ grant: { token_status: "invalid_grant" } }),
  ]);
  eq("estado problema", r.state, "problema");
  eq("texto: 1 conectada · 1 com problema", r.texto, "1 conectada · 1 com problema");
}

console.log("\n▸ Mercado Livre — conta inativa não entra na conta nem no total");
{
  const r = resumirContasMarketplace("meli", [
    contaMl({ grant: { token_status: "valid" } }),
    contaMl({ grant: null, ativo: false }),
  ]);
  eq("total ignora a inativa", r.total, 1);
  eq("estado saudável (só a ativa conta)", r.state, "saudavel");
}

console.log("\n▸ Shopee — conta com base definida (item 10)");
{
  const r = resumirContasMarketplace("shopee", [contaShopee({ base: { base_id: 501 } })]);
  eq("estado saudável", r.state, "saudavel");
  eq("texto: 1 configurada", r.texto, "1 configurada");
}

console.log("\n▸ Shopee — conta sem base definida (item 11)");
{
  const r = resumirContasMarketplace("shopee", [contaShopee({ base: null })]);
  eq("estado pendência", r.state, "pendencia");
  ok("símbolo de alerta, não de saudável", r.symbol === "⚠");
}

console.log("\n▸ Shopee — nenhuma conta cadastrada → cinza/vazio (item 6: cinza = inexistente)");
{
  const r = resumirContasMarketplace("shopee", []);
  eq("estado vazio", r.state, "vazio");
  eq("símbolo ○", r.symbol, "○");
  eq("texto: nenhuma", r.texto, "nenhuma");
}

console.log("\n▸ classificarStatusConta — contrato usado pelo resumo");
{
  eq("sem grant", classificarStatusConta(contaMl({ grant: null })).code, "sem_grant");
  eq("grant valid", classificarStatusConta(contaMl({ grant: { token_status: "valid" } })).code, "conectado");
  eq("grant com problema", classificarStatusConta(contaMl({ grant: { token_status: "revoked" } })).code, "atencao");
}

console.log("\n▸ Expansão inline — abre/recolhe (item 12) e só uma por vez (item 13)");
{
  const expansao = criarExpansaoUnica();
  ok("nada expandido no início", expansao.atual() === null);

  expansao.toggle("cliente-a");
  ok("cliente A expandido", expansao.isExpandido("cliente-a"));
  ok("cliente B não está expandido", !expansao.isExpandido("cliente-b"));

  expansao.toggle("cliente-b");
  ok("abrir B recolhe A automaticamente", !expansao.isExpandido("cliente-a"));
  ok("cliente B agora expandido", expansao.isExpandido("cliente-b"));

  expansao.toggle("cliente-b");
  ok("clicar de novo no mesmo cliente recolhe", expansao.atual() === null);

  expansao.toggle("cliente-c");
  const fechado = expansao.fechar();
  eq("fechar() devolve o que estava aberto", fechado, "cliente-c");
  ok("nada expandido depois de fechar()", expansao.atual() === null);
}

console.log(`\n✓ clientesContasResumo: ${checks} verificações`);
