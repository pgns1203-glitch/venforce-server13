// Prova o custo da Central do Full: mesma Base da conta (via lerCustos
// injetado), custo ausente nunca vira zero, e o contrato "fetchCosts nunca
// rejeita" — sem Base, sem slug ou com erro vira status unavailable.

const assert = require("assert");
const { createFullCostProvider } = require("../services/full/fullCostProvider");

function run() {
  return (async () => {
    // Base resolvida: so custos numericos entram no mapa
    {
      const chamadas = [];
      const provider = createFullCostProvider({
        lerCustos: async (args) => {
          chamadas.push(args);
          return { base: { slug: "b", nome: "Base B", id: 9 }, motivo: "conta", custos: { MLB1: 10, MLB2: null } };
        },
      });
      const r = await provider.fetchCosts({ clienteSlug: "c", clienteContaId: 5, itemIds: ["MLB1", "MLB2"] });
      assert.strictEqual(r.status, "ok");
      assert.deepStrictEqual(r.base, { slug: "b", nome: "Base B" }, "id interno da Base nao sai");
      assert.strictEqual(r.costsByItemId.get("MLB1"), 10);
      assert.strictEqual(r.costsByItemId.has("MLB2"), false, "custo null nao vira zero");
      assert.deepStrictEqual(chamadas, [{ clienteSlug: "c", clienteContaId: 5, itemIds: ["MLB1", "MLB2"] }]);
      console.log("  ✓ Base resolvida devolve o mapa de custos; custo ausente fica fora do mapa");
    }

    // Sem Base vinculada: unavailable com o motivo da resolucao
    {
      const provider = createFullCostProvider({
        lerCustos: async () => ({ base: null, motivo: "SEM_BASE", mensagem: "Conta sem Base", custos: {} }),
      });
      const r = await provider.fetchCosts({ clienteSlug: "c", clienteContaId: 5, itemIds: ["MLB1"] });
      assert.strictEqual(r.status, "unavailable");
      assert.strictEqual(r.reason, "SEM_BASE");
      assert.strictEqual(r.costsByItemId.size, 0);
      console.log("  ✓ conta sem Base vira unavailable com o motivo");
    }

    // Erro da fonte, slug ausente e fonte nao ligada: nunca rejeita
    {
      const quebrado = createFullCostProvider({ lerCustos: async () => { throw new Error("db fora"); } });
      assert.strictEqual((await quebrado.fetchCosts({ clienteSlug: "c", clienteContaId: 5, itemIds: ["MLB1"] })).reason, "cost_source_error");

      const semSlug = createFullCostProvider({ lerCustos: async () => { throw new Error("nao deveria chamar"); } });
      assert.strictEqual((await semSlug.fetchCosts({ clienteSlug: null, clienteContaId: 5, itemIds: ["MLB1"] })).reason, "cliente_slug_ausente");

      const semFonte = createFullCostProvider();
      assert.strictEqual((await semFonte.fetchCosts({ clienteSlug: "c", clienteContaId: 5, itemIds: ["MLB1"] })).reason, "cost_source_absent");
      console.log("  ✓ erro da fonte, slug ausente e fonte nao ligada viram unavailable, nunca rejeitam");
    }

    // Lista vazia nao consulta a Base
    {
      let chamou = false;
      const provider = createFullCostProvider({ lerCustos: async () => { chamou = true; return {}; } });
      const r = await provider.fetchCosts({ clienteSlug: "c", clienteContaId: 5, itemIds: [] });
      assert.strictEqual(r.status, "ok");
      assert.strictEqual(chamou, false);
      console.log("  ✓ sem itens, nenhuma consulta a Base");
    }

    console.log("fullCostProvider.test.js passed");
  })();
}

run();
