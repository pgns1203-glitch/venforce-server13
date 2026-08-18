// Prova o cache curto + single-flight da Central de Gestao Full: hit fresco,
// expiracao/stale, duas chamadas concorrentes fazem uma unica coleta, falha
// de reload nunca apaga o ultimo snapshot bom, e LRU respeita o teto de
// entradas.

const assert = require("assert");
const { createFullCache } = require("../services/full/fullCache");

function run() {
  return (async () => {
    // hit fresco nao chama loadFn de novo
    {
      let calls = 0;
      let time = 0;
      const cache = createFullCache({ successTtlMs: 1000, nowFn: () => time });
      const loadFn = async () => {
        calls += 1;
        return { value: { n: calls } };
      };

      const first = await cache.getOrLoad("k1", loadFn);
      assert.strictEqual(first.hit, true);
      assert.strictEqual(first.stale, false);
      assert.strictEqual(first.source, "load");
      assert.deepStrictEqual(first.value, { n: 1 });

      const second = await cache.getOrLoad("k1", loadFn);
      assert.strictEqual(second.source, "cache");
      assert.strictEqual(calls, 1, "hit fresco nao deve chamar loadFn de novo");
      console.log("  ✓ hit fresco nao dispara nova carga");
    }

    // expiracao vira stale, dispara reload e atualiza o valor
    {
      let calls = 0;
      let time = 0;
      const cache = createFullCache({ successTtlMs: 100, nowFn: () => time });
      const loadFn = async () => {
        calls += 1;
        return { value: calls };
      };

      await cache.getOrLoad("k2", loadFn);
      time = 150; // passou do TTL de sucesso
      const reloaded = await cache.getOrLoad("k2", loadFn);
      assert.strictEqual(calls, 2);
      assert.strictEqual(reloaded.value, 2);
      assert.strictEqual(reloaded.stale, false, "apos reload bem sucedido o valor novo nao e stale");
      console.log("  ✓ expiracao dispara reload e devolve o valor atualizado");
    }

    // duas chamadas concorrentes para a mesma chave fazem uma unica coleta (single-flight)
    {
      let calls = 0;
      let resolveLoad;
      const cache = createFullCache();
      const loadFn = () =>
        new Promise((resolve) => {
          calls += 1;
          resolveLoad = () => resolve({ value: "V" });
        });

      const p1 = cache.getOrLoad("k3", loadFn);
      const p2 = cache.getOrLoad("k3", loadFn);
      await new Promise((r) => setImmediate(r));
      assert.strictEqual(calls, 1, "duas chamadas concorrentes devem disparar loadFn uma unica vez");

      resolveLoad();
      const [r1, r2] = await Promise.all([p1, p2]);
      assert.strictEqual(r1.value, "V");
      assert.strictEqual(r2.value, "V");
      assert.strictEqual(r2.source, "single-flight");
      console.log("  ✓ chamadas concorrentes para a mesma chave compartilham uma unica coleta");
    }

    // falha de reload preserva o ultimo snapshot bom (nunca substitui por vazio)
    {
      let time = 0;
      let shouldFail = false;
      const cache = createFullCache({ successTtlMs: 100, errorTtlMs: 50, nowFn: () => time });
      const loadFn = async () => {
        if (shouldFail) throw new Error("falha simulada da coleta");
        return { value: "bom", retryAt: 999 };
      };

      const good = await cache.getOrLoad("k4", loadFn);
      assert.strictEqual(good.value, "bom");

      time = 150; // expira
      shouldFail = true;
      const afterFailure = await cache.getOrLoad("k4", loadFn);
      assert.strictEqual(afterFailure.value, "bom", "falha de reload nao pode apagar o ultimo snapshot bom");
      assert.strictEqual(afterFailure.stale, true);
      assert.strictEqual(afterFailure.isError, true);
      assert.strictEqual(afterFailure.generatedAt, good.generatedAt, "generatedAt deve continuar refletindo quando o dado bom foi gerado");
      console.log("  ✓ falha de reload preserva o ultimo snapshot bom, marcado como stale/erro");

      // Ainda dentro do cooldown de erro (errorTtlMs=50, time=150): nao martela a origem de novo.
      let loadCallsDuringCooldown = 0;
      const stillCooling = await cache.getOrLoad("k4", async () => {
        loadCallsDuringCooldown += 1;
        throw new Error("nao deveria ser chamado durante o cooldown");
      });
      assert.strictEqual(loadCallsDuringCooldown, 0, "durante o TTL de erro, novas chamadas nao devem martelar a origem");
      assert.strictEqual(stillCooling.value, "bom");
      assert.strictEqual(stillCooling.source, "cache-cooldown");

      // Apos o cooldown (time=210 > 150+errorTtlMs=200): tenta de novo.
      time = 210;
      shouldFail = false;
      const recovered = await cache.getOrLoad("k4", loadFn);
      assert.strictEqual(recovered.value, "bom");
      assert.strictEqual(recovered.isError, false);
      assert.strictEqual(recovered.stale, false);
      console.log("  ✓ cooldown de erro evita martelar a origem; apos o cooldown, tenta recarregar de novo");
    }

    // falha sem nenhum snapshot anterior propaga o erro
    {
      const cache = createFullCache();
      await assert.rejects(() => cache.getOrLoad("k5", async () => { throw new Error("sem snapshot anterior"); }));
      console.log("  ✓ falha sem snapshot anterior propaga o erro (nao ha o que preservar)");
    }

    // LRU: excede o teto de entradas e descarta a mais antiga
    {
      const cache = createFullCache({ maxEntries: 2 });
      await cache.getOrLoad("a", async () => ({ value: 1 }));
      await cache.getOrLoad("b", async () => ({ value: 2 }));
      await cache.getOrLoad("c", async () => ({ value: 3 }));
      assert.strictEqual(cache.size(), 2, "nunca deve exceder maxEntries");
      const snapA = cache.snapshot("a");
      assert.strictEqual(snapA.hit, false, "entrada mais antiga deve ser descartada pelo LRU");
      console.log("  ✓ LRU descarta a entrada mais antiga ao exceder o teto de entradas");
    }

    console.log("fullCache.test.js passed");
  })();
}

run();
