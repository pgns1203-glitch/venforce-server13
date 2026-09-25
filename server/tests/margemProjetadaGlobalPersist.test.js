// server/tests/margemProjetadaGlobalPersist.test.js
//
// FASE 2B do plano de margem projetada global — ver
// docs/AUDITORIA_ANUNCIOS_ML_MARGEM_PROJETADA_FASE2_JOB_MANUAL.md. Testa a
// orquestração de persistência da CLI (`persistirSnapshots`/`main` com
// `--persist`) com um `deps.upsertSnapshot` fake em memória (simula a
// UNIQUE (cliente_id, item_id) sem Postgres real) — prova o comportamento
// pedido explicitamente pelo usuário:
//
//   1. --dry-run não escreve (nenhuma chamada a upsertSnapshot).
//   2. --persist cria snapshot (1ª execução: N inserts).
//   3. 2ª execução dos MESMOS itens: 0 duplicação, updates dos mesmos registros.
//   4. clienteContaId correto é salvo (repassado tal-e-qual ao repository).
//   5. item.margin.projected é a origem dos valores persistidos (via
//      itemFixture, sem nenhuma fórmula nova no caminho).
//   6. Erro de banco (upsertSnapshot rejeita) gera exit code correto.

const assert = require("assert");
const { persistirSnapshots, main } = require("../jobs/margemProjetadaGlobal");

let checks = 0;
function ok(label, cond) {
  assert.ok(cond, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

function itemFixture({ itemId, computable = true, profit = 10, marginPercent = 15, status = "HEALTHY" }) {
  return {
    identity: { itemId },
    pricing: { current: { value: 100 }, list: { value: 120 } },
    margin: { projected: { profit, margin: null, marginPercent, computable, strict: true, missing: [], assumed: [] } },
    quality: { status },
  };
}

// Fake de tabela em memória: simula a UNIQUE (cliente_id, item_id) real —
// mesma chave, mesmo comportamento de "insere se não existe, atualiza se existe".
function fakeTabela() {
  const linhas = new Map(); // chave `${clienteId}:${itemId}` -> linha
  const chamadas = [];
  return {
    linhas,
    chamadas,
    upsertSnapshot: async ({ clienteId, clienteContaId, itemId, item, origemJob }) => {
      chamadas.push({ clienteId, clienteContaId, itemId, item, origemJob });
      const chave = `${clienteId}:${itemId}`;
      const inserted = !linhas.has(chave);
      linhas.set(chave, {
        clienteId,
        clienteContaId,
        itemId,
        marginPercent: item.margin.projected.marginPercent,
        profit: item.margin.projected.profit,
        computable: item.margin.projected.computable,
        status: item.quality.status,
        origemJob,
        calculadoEm: Date.now(),
      });
      return { inserted };
    },
  };
}

async function run() {
  // ── 1: --dry-run não escreve (via main(), fluxo completo) ───────────────

  {
    const tabela = fakeTabela();
    const deps = {
      carregarWorkspace: async () => ({
        cliente: { id: 16 }, totalItensMl: 2,
        itens: [itemFixture({ itemId: "MLB1" }), itemFixture({ itemId: "MLB2" })],
      }),
      upsertSnapshot: tabela.upsertSnapshot,
      pool: { end: async () => {} },
    };
    const codigo = await main(["--clienteSlug=cliente-a", "--dry-run"], deps);
    ok("main() --dry-run: exit code 0", codigo === 0);
    ok("main() --dry-run: upsertSnapshot NUNCA é chamado", tabela.chamadas.length === 0);
    ok("main() --dry-run: nenhuma linha na tabela fake", tabela.linhas.size === 0);
  }

  // ── 2: --persist cria snapshot (1ª execução) ─────────────────────────────

  let tabelaCompartilhada;
  {
    tabelaCompartilhada = fakeTabela();
    const deps = {
      carregarWorkspace: async () => ({
        cliente: { id: 16 }, totalItensMl: 2,
        itens: [
          itemFixture({ itemId: "MLB1", profit: 10, marginPercent: 15, status: "HEALTHY" }),
          itemFixture({ itemId: "MLB2", profit: 20, marginPercent: 25, status: "HEALTHY" }),
        ],
      }),
      upsertSnapshot: tabelaCompartilhada.upsertSnapshot,
      pool: { end: async () => {} },
    };
    const codigo = await main(["--clienteSlug=cliente-a", "--clienteConta=6", "--persist"], deps);
    ok("main() --persist (1ª execução): exit code 0", codigo === 0);
    ok("main() --persist (1ª execução): upsertSnapshot chamado 1x por item (2 itens)", tabelaCompartilhada.chamadas.length === 2);
    ok("main() --persist (1ª execução): 2 linhas novas na tabela", tabelaCompartilhada.linhas.size === 2);
  }

  // ── 3: 2ª execução dos MESMOS itens: 0 duplicação, update ───────────────

  {
    const deps = {
      carregarWorkspace: async () => ({
        cliente: { id: 16 }, totalItensMl: 2,
        itens: [
          // Mesmos item_id, valores DIFERENTES (simula margem recalculada
          // pelo Motor entre as 2 execuções) — prova que é UPDATE de verdade,
          // não um insert que por acaso não duplicou.
          itemFixture({ itemId: "MLB1", profit: 11, marginPercent: 16, status: "HEALTHY" }),
          itemFixture({ itemId: "MLB2", profit: 21, marginPercent: 26, status: "LOW_MARGIN" }),
        ],
      }),
      upsertSnapshot: tabelaCompartilhada.upsertSnapshot,
      pool: { end: async () => {} },
    };
    const codigo = await main(["--clienteSlug=cliente-a", "--clienteConta=6", "--persist"], deps);
    ok("main() --persist (2ª execução): exit code 0", codigo === 0);
    ok("main() --persist (2ª execução): AINDA 2 linhas (0 duplicação)", tabelaCompartilhada.linhas.size === 2);
    const linhaMLB1 = tabelaCompartilhada.linhas.get("16:MLB1");
    ok("main() --persist (2ª execução): valores da linha foram ATUALIZADOS (profit 11, não 10)", linhaMLB1.profit === 11);
    ok("main() --persist (2ª execução): marginPercent atualizado (16, não 15)", linhaMLB1.marginPercent === 16);
    const linhaMLB2 = tabelaCompartilhada.linhas.get("16:MLB2");
    ok("main() --persist (2ª execução): status atualizado (LOW_MARGIN, não HEALTHY)", linhaMLB2.status === "LOW_MARGIN");
  }

  // ── 4: clienteContaId correto é salvo ────────────────────────────────────

  {
    ok("clienteContaId (6) chegou ao repository em toda chamada, tal-e-qual pedido no argv",
      tabelaCompartilhada.chamadas.every((c) => c.clienteContaId === 6));
    ok("cliente_id (16, workspace.cliente.id) chegou ao repository, nunca outro",
      tabelaCompartilhada.chamadas.every((c) => c.clienteId === 16));
  }

  // ── 5: item.margin.projected é a origem (prova adicional via persistirSnapshots direto) ──

  {
    const tabela = fakeTabela();
    await persistirSnapshots(
      { itens: [itemFixture({ itemId: "MLB7", profit: 99.9, marginPercent: 33, status: "HEALTHY" })], clienteId: 1, clienteContaId: null, origemJob: "manual_cli" },
      { upsertSnapshot: tabela.upsertSnapshot }
    );
    const linha = tabela.linhas.get("1:MLB7");
    ok("persistirSnapshots grava exatamente profit/marginPercent de item.margin.projected (99.9/33)",
      linha.profit === 99.9 && linha.marginPercent === 33);
    ok("persistirSnapshots grava origem_job = 'manual_cli' (valor estável, não nome de fase)", linha.origemJob === "manual_cli");
  }

  // ── 6: erro de banco gera exit code correto ─────────────────────────────

  {
    const deps = {
      carregarWorkspace: async () => ({
        cliente: { id: 16 }, totalItensMl: 1,
        itens: [itemFixture({ itemId: "MLB-FALHA" })],
      }),
      upsertSnapshot: async () => { throw new Error("connection terminated unexpectedly"); },
      pool: { end: async () => {} },
    };
    const codigo = await main(["--clienteSlug=cliente-a", "--persist"], deps);
    ok("main() --persist com erro de banco em TODOS os itens: exit code 1 (snapshotsFalhos > 0)", codigo === 1);
  }

  {
    // Erro parcial: 1 de 2 itens falha — o outro não é derrubado (mesma
    // filosofia de isolamento por item que enrichBatch já aplica).
    let chamada = 0;
    const deps = {
      carregarWorkspace: async () => ({
        cliente: { id: 16 }, totalItensMl: 2,
        itens: [itemFixture({ itemId: "MLB-OK" }), itemFixture({ itemId: "MLB-FALHA" })],
      }),
      upsertSnapshot: async ({ itemId }) => {
        chamada += 1;
        if (itemId === "MLB-FALHA") throw new Error("duplicate key value violates unique constraint");
        return { inserted: true };
      },
      pool: { end: async () => {} },
    };
    const codigo = await main(["--clienteSlug=cliente-a", "--persist"], deps);
    ok("main() --persist com falha PARCIAL: ainda tenta os 2 itens (isolamento por item)", chamada === 2);
    ok("main() --persist com falha PARCIAL: exit code 1 (pelo menos 1 falha)", codigo === 1);
  }

  console.log(`\nmargemProjetadaGlobalPersist.test.js: ${checks} verificações passaram.`);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
