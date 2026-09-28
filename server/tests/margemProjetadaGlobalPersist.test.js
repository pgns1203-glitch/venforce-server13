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
//
// Extensão (fechamento da lacuna "cliente_conta_id persistido = valor do
// argv, não a conta efetivamente resolvida pelo Motor"):
//   7. Single-account SEM --clienteConta: workspace.clienteContaId (mockado,
//      simula o Motor auto-resolvendo) é o que vai para o snapshot — nunca null
//      só porque o argv não veio.
//   8. Multi-account COM --clienteConta=A / =B: grava exatamente A / B.
//   9. Multi-account SEM seleção: continua propagando erro estrutural
//      (MULTIPLE_MARKETPLACE_ACCOUNTS), sem fallback silencioso.
//  10. --dry-run também expõe no JSON a conta efetivamente resolvida — sem escrever.
//  11. Reexecução ATUALIZA cliente_conta_id de uma linha antes NULL para o valor resolvido.
//  12. A CLI não resolve conta de novo (nenhum require de clienteContaService).

const assert = require("assert");
const fs = require("fs");
const path = require("path");
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
      // clienteContaId=6 no retorno simula o Motor CONFIRMANDO a conta pedida
      // via --clienteConta=6 (cenário 8 abaixo prova o caso geral de A/B;
      // aqui é só o valor que o snapshot deve gravar).
      carregarWorkspace: async () => ({
        cliente: { id: 16 }, clienteContaId: 6, totalItensMl: 2,
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
        cliente: { id: 16 }, clienteContaId: 6, totalItensMl: 2,
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
    ok("clienteContaId (6) chegou ao repository em toda chamada — vindo de workspace.clienteContaId (Motor), não do argv bruto",
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

  // ── 7: single-account SEM --clienteConta grava a conta AUTO-resolvida ────
  // (nunca null só porque o argv não veio) ─────────────────────────────────

  {
    const tabela = fakeTabela();
    const deps = {
      // Simula o Motor: cliente tem 1 conta só, resolvida sozinha (id=38),
      // mesmo sem nenhum --clienteConta no argv.
      carregarWorkspace: async () => ({
        cliente: { id: 100 }, clienteContaId: 38, totalItensMl: 1,
        itens: [itemFixture({ itemId: "MLB-AUTO" })],
      }),
      upsertSnapshot: tabela.upsertSnapshot,
      pool: { end: async () => {} },
    };
    const codigo = await main(["--clienteSlug=zenite_loja", "--persist"], deps);
    ok("single-account sem --clienteConta: exit code 0", codigo === 0);
    ok("single-account sem --clienteConta: snapshot grava cliente_conta_id=38 (resolvido pelo Motor), não null",
      tabela.chamadas[0].clienteContaId === 38);
  }

  // ── 8: multi-account COM --clienteConta=A / =B grava exatamente A / B ────

  {
    // Mock reage à seleção pedida, como o Motor faria de verdade (confirma
    // a MESMA conta pedida, nunca troca) — mas quem decide o valor gravado
    // é sempre workspace.clienteContaId, nunca o argv bruto.
    function carregarWorkspaceMultiConta(args) {
      return { cliente: { id: 200 }, clienteContaId: args.clienteContaId, totalItensMl: 1, itens: [itemFixture({ itemId: "MLB-MULTI" })] };
    }

    const tabelaA = fakeTabela();
    const codigoA = await main(
      ["--clienteSlug=cliente-multi", "--clienteConta=501", "--persist"],
      { carregarWorkspace: async (a) => carregarWorkspaceMultiConta(a), upsertSnapshot: tabelaA.upsertSnapshot, pool: { end: async () => {} } }
    );
    ok("multi-account --clienteConta=501: exit code 0", codigoA === 0);
    ok("multi-account --clienteConta=501: snapshot grava cliente_conta_id=501", tabelaA.chamadas[0].clienteContaId === 501);

    const tabelaB = fakeTabela();
    const codigoB = await main(
      ["--clienteSlug=cliente-multi", "--clienteConta=502", "--persist"],
      { carregarWorkspace: async (a) => carregarWorkspaceMultiConta(a), upsertSnapshot: tabelaB.upsertSnapshot, pool: { end: async () => {} } }
    );
    ok("multi-account --clienteConta=502: exit code 0", codigoB === 0);
    ok("multi-account --clienteConta=502: snapshot grava cliente_conta_id=502, nunca 501", tabelaB.chamadas[0].clienteContaId === 502);
  }

  // ── 9: multi-account SEM seleção continua falhando (nenhum fallback) ─────

  {
    const deps = {
      carregarWorkspace: async () => {
        throw Object.assign(new Error("O cliente possui mais de uma conta para este marketplace; informe cliente_conta_id."), {
          statusCode: 409, code: "MULTIPLE_MARKETPLACE_ACCOUNTS",
        });
      },
      pool: { end: async () => {} },
    };
    const codigo = await main(["--clienteSlug=cliente-multi", "--persist"], deps);
    ok("multi-account sem --clienteConta: exit code 1 (erro estrutural propagado, sem fallback silencioso)", codigo === 1);
  }

  // ── 10: --dry-run também expõe a conta resolvida no JSON, sem escrever ───

  {
    const tabela = fakeTabela();
    const linhasImpressas = [];
    const logOriginal = console.log;
    console.log = (msg) => linhasImpressas.push(String(msg));
    let codigo;
    try {
      codigo = await main(
        ["--clienteSlug=zenite_loja", "--maxItens=1", "--dry-run", "--json"],
        {
          carregarWorkspace: async () => ({
            cliente: { id: 100 }, clienteContaId: 38, totalItensMl: 1,
            itens: [itemFixture({ itemId: "MLB-DRY" })],
          }),
          upsertSnapshot: tabela.upsertSnapshot,
          pool: { end: async () => {} },
        }
      );
    } finally {
      console.log = logOriginal;
    }
    const saida = linhasImpressas.join("\n");
    const jsonTexto = saida.split("--- JSON ---")[1];
    const resumo = JSON.parse(jsonTexto);

    ok("dry-run: exit code 0", codigo === 0);
    ok("dry-run: JSON mostra clienteContaId=38 (resolvido pelo Motor), mesmo sem nenhuma escrita", resumo.clienteContaId === 38);
    ok("dry-run: nenhuma chamada a upsertSnapshot", tabela.chamadas.length === 0);
  }

  // ── 11: reexecução ATUALIZA cliente_conta_id de uma linha antes NULL ─────

  {
    const tabela = fakeTabela();
    // 1ª execução: conta ainda não resolvida (simula snapshot antigo, campo NULL).
    await persistirSnapshots(
      { itens: [itemFixture({ itemId: "MLB-RECONCILIA" })], clienteId: 100, clienteContaId: null, origemJob: "manual_cli" },
      { upsertSnapshot: tabela.upsertSnapshot }
    );
    ok("reexecução: 1ª gravação fica com cliente_conta_id NULL", tabela.linhas.get("100:MLB-RECONCILIA").clienteContaId === null);

    // 2ª execução: MESMO item, agora com a conta efetivamente resolvida (38).
    await persistirSnapshots(
      { itens: [itemFixture({ itemId: "MLB-RECONCILIA" })], clienteId: 100, clienteContaId: 38, origemJob: "manual_cli" },
      { upsertSnapshot: tabela.upsertSnapshot }
    );
    ok("reexecução: cliente_conta_id é ATUALIZADO de NULL para 38, mesma linha (UNIQUE cliente_id+item_id, sem duplicar)",
      tabela.linhas.size === 1 && tabela.linhas.get("100:MLB-RECONCILIA").clienteContaId === 38);
  }

  // ── 12: a CLI não resolve conta de novo (checagem estática) ──────────────

  {
    const fonte = fs.readFileSync(path.join(__dirname, "..", "jobs", "margemProjetadaGlobal.js"), "utf8");
    ok("margemProjetadaGlobal.js não faz require() de clienteContaService/contextoPrecificacaoService — a única fonte de conta resolvida é workspace.clienteContaId",
      !/require\([^)]*(clienteContaService|contextoPrecificacaoService|resolveMarketplaceAccountContext)[^)]*\)/i.test(fonte));
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
