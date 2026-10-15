// Preço AO VIVO (sale_price) por item, sem Motor — meliPrecoAoVivoService.
// Garante: só anúncios do cliente/conta são lidos no ML; promoção só quando
// cheio > vigente; leitura que falha fica de fora sem derrubar o lote.

const assert = require("assert");
const pool = require("../config/database");
const precoItemService = require("../services/automacoes/precoItemService");

// Troca resolverPrecosItem ANTES de carregar o serviço (ele desestrutura).
const leituras = [];
let cotacaoPorItem = {};
precoItemService.resolverPrecosItem = async (args) => {
  leituras.push(args);
  const c = cotacaoPorItem[args.itemId];
  if (c instanceof Error) throw c;
  return c;
};
const servico = require("../services/meliAnuncios/meliPrecoAoVivoService");

const ANUNCIOS = [
  { cliente_id: 1, cliente_conta_id: 10, item_id: "MLB-PROMO", preco: "149.90", ml_user_id: "111" },
  { cliente_id: 1, cliente_conta_id: 10, item_id: "MLB-CHEIO", preco: "69.90", ml_user_id: null },
  { cliente_id: 1, cliente_conta_id: 10, item_id: "MLB-FALHA", preco: "10", ml_user_id: null },
  { cliente_id: 1, cliente_conta_id: null, item_id: "MLB-LEGADO", preco: "20", ml_user_id: null },
  { cliente_id: 1, cliente_conta_id: 99, item_id: "MLB-OUTRA-CONTA", preco: "30", ml_user_id: null },
  { cliente_id: 2, cliente_conta_id: 20, item_id: "MLB-OUTRO-CLIENTE", preco: "40", ml_user_id: null },
];

const consultas = [];
pool.query = async (sql, params) => {
  consultas.push({ sql, params });
  const [clienteId, ids, contaId] = params;
  const soLegadoOuConta = /OR cliente_conta_id IS NULL/.test(sql);
  const rows = ANUNCIOS.filter((a) => a.cliente_id === clienteId && ids.includes(a.item_id))
    .filter((a) => contaId === undefined || a.cliente_conta_id === contaId || (soLegadoOuConta && a.cliente_conta_id == null));
  return { rows };
};

(async () => {
  cotacaoPorItem = {
    "MLB-PROMO": { precoCheio: 149.9, precoPromocional: 114.9, precoEfetivo: 114.9, fonte: "sale_price" },
    "MLB-CHEIO": { precoCheio: 69.9, precoPromocional: null, precoEfetivo: 69.9, fonte: "sale_price" },
    "MLB-FALHA": new Error("timeout"),
    "MLB-LEGADO": { precoCheio: 20, precoPromocional: null, precoEfetivo: 20, fonte: "sale_price" },
  };

  // A. conta selecionada + legado: promoção vira cheio riscável, sem promoção
  //    não inventa cheio, falha fica de fora, outra conta/cliente nem é lida.
  const r = await servico.precosAoVivo({
    clienteId: 1, contaId: 10, includeLegacy: true, mlUserId: "999",
    itemIds: ["MLB-PROMO", "MLB-CHEIO", "MLB-FALHA", "MLB-LEGADO", "MLB-OUTRA-CONTA", "MLB-OUTRO-CLIENTE", "MLB-PROMO"],
  });
  assert.deepStrictEqual(r["MLB-PROMO"], { precoAtual: 114.9, precoOriginal: 149.9 });
  assert.deepStrictEqual(r["MLB-CHEIO"], { precoAtual: 69.9, precoOriginal: null }, "sem promoção: cheio null, nunca cópia do vigente");
  assert.ok(!("MLB-FALHA" in r), "leitura que falhou fica de fora");
  assert.deepStrictEqual(r["MLB-LEGADO"], { precoAtual: 20, precoOriginal: null });
  assert.ok(!("MLB-OUTRA-CONTA" in r) && !("MLB-OUTRO-CLIENTE" in r), "fora do cliente/conta: ausente");
  const lidos = leituras.map((l) => l.itemId).sort();
  assert.deepStrictEqual(lidos, ["MLB-CHEIO", "MLB-FALHA", "MLB-LEGADO", "MLB-PROMO"], "só anúncios do cliente/conta vão ao ML, sem repetir");
  assert.strictEqual(leituras.find((l) => l.itemId === "MLB-PROMO").mlUserId, "111", "usa a conta ML gravada no anúncio");
  assert.strictEqual(leituras.find((l) => l.itemId === "MLB-CHEIO").mlUserId, "999", "sem conta no anúncio: a do contexto");
  assert.strictEqual(leituras.find((l) => l.itemId === "MLB-CHEIO").precoListaFallback, 69.9, "fallback legado recebe o preço sincronizado");
  console.log("  ✓ A. preço ao vivo: promoção riscável, sem cheio inventado, falha isolada, isolamento por cliente/conta");

  // B. conta sem legado: item sem conta não entra.
  leituras.length = 0;
  const r2 = await servico.precosAoVivo({ clienteId: 1, contaId: 10, includeLegacy: false, itemIds: ["MLB-LEGADO", "MLB-CHEIO"] });
  assert.ok(!("MLB-LEGADO" in r2));
  assert.ok("MLB-CHEIO" in r2);
  console.log("  ✓ B. operação sem legado não lê anúncio sem conta");

  // C. lote vazio: nenhuma consulta.
  consultas.length = 0;
  assert.deepStrictEqual(await servico.precosAoVivo({ clienteId: 1, itemIds: [] }), {});
  assert.strictEqual(consultas.length, 0);
  console.log("  ✓ C. sem itemIds: nada consultado");

  // D. teto do lote.
  consultas.length = 0;
  const muitos = Array.from({ length: 100 }, (_, i) => "MLB-X" + i);
  await servico.precosAoVivo({ clienteId: 1, itemIds: muitos });
  assert.strictEqual(consultas[0].params[1].length, servico.PRECO_AO_VIVO_MAX_ITENS);
  console.log("  ✓ D. lote cortado no teto");

  console.log("meliPrecoAoVivo.test.js passed");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
