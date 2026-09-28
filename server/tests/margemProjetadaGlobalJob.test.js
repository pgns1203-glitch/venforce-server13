// server/tests/margemProjetadaGlobalJob.test.js
//
// FASE 2 (primeira parte) do plano de margem projetada global — ver
// docs/AUDITORIA_ANUNCIOS_ML_MARGEM_PROJETADA_FASE2_JOB_MANUAL.md. Testa a
// CLI `server/jobs/margemProjetadaGlobal.js` sem banco, sem Motor de
// verdade, sem Mercado Livre: só o núcleo puro de métricas
// (`montarResumoMargemProjetada`) e a orquestração (`executar`/`main`) com
// `motorMargemService.carregarWorkspace` injetado por `deps`.
//
// Prova (pedido explícito do usuário):
//   1. CLI repassa clienteContaId corretamente para carregarWorkspace.
//   2. CLI de fato chama carregarWorkspace (única fonte de margem).
//   3. O arquivo-fonte da CLI não embute SQL de escrita — o UPSERT mora só
//      em margemProjetadaSnapshotRepository (checagem estática); em modo
//      --dry-run, nenhuma escrita acontece (ver
//      margemProjetadaGlobalPersist.test.js para o comportamento de escrita
//      de --persist).
//   4. O resumo usa item.margin.projected / item.quality.status devolvidos
//      pelo Motor — nenhuma fórmula de margem nova.
//   5. Erro do Motor (carregarWorkspace rejeita) produz exit code 1.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  parseArgs,
  montarResumoMargemProjetada,
  executar,
  main,
} = require("../jobs/margemProjetadaGlobal");

let checks = 0;
function ok(label, cond) {
  assert.ok(cond, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

function itemFixture({ itemId, computable, profit, marginPercent, status }) {
  return {
    identity: { itemId },
    margin: {
      projected: { profit, margin: null, marginPercent, computable, strict: true, missing: [], assumed: [] },
    },
    quality: { status },
  };
}

async function run() {
  // ── parseArgs ────────────────────────────────────────────────────────────

  {
    const args = parseArgs(["--clienteSlug=cliente-a", "--clienteConta=16", "--maxItens=20", "--dry-run", "--json"]);
    ok("parseArgs lê todos os flags esperados",
      args.clienteSlug === "cliente-a" && args.clienteConta === "16" &&
        args.maxItens === "20" && args.dryRun === true && args.json === true);
  }
  {
    const args = parseArgs(["--clienteSlug=cliente-a", "--dry-run"]);
    ok("parseArgs: clienteConta/maxItens ausentes ficam null, json fica false, persist fica false",
      args.clienteConta === null && args.maxItens === null && args.json === false && args.persist === false);
  }
  {
    const args = parseArgs(["--clienteSlug=cliente-a", "--persist"]);
    ok("parseArgs lê --persist e mantém dryRun false", args.persist === true && args.dryRun === false);
  }
  {
    assert.throws(() => parseArgs(["--clienteSlug=x", "--argumento-inexistente=1"]), /Argumento desconhecido/);
    ok("parseArgs rejeita argumento desconhecido (mesmo padrão de centralVendasJobCli)", true);
  }

  // ── 1 e 2: CLI repassa clienteContaId e chama carregarWorkspace ─────────

  {
    const chamadas = [];
    const deps = {
      carregarWorkspace: async (args) => {
        chamadas.push(args);
        return { itens: [], totalItensMl: 0 };
      },
    };
    await executar({ clienteSlug: "cliente-a", clienteContaId: 16, maxItens: 20 }, deps);
    ok("executar() chama carregarWorkspace exatamente 1 vez", chamadas.length === 1);
    ok("executar() repassa clienteContaId corretamente (16, não outro valor/nulo)",
      chamadas[0].clienteContaId === 16);
    ok("executar() repassa clienteSlug e maxItens tal-e-qual", chamadas[0].clienteSlug === "cliente-a" && chamadas[0].maxItens === 20);
  }

  // main() completo (CLI → executar → carregarWorkspace) com clienteConta via argv:
  {
    const chamadas = [];
    const deps = {
      carregarWorkspace: async (args) => {
        chamadas.push(args);
        return { itens: [], totalItensMl: 0 };
      },
      pool: { end: async () => {} },
    };
    const codigo = await main(["--clienteSlug=cliente-a", "--clienteConta=16", "--maxItens=5", "--dry-run"], deps);
    ok("main(): exit code 0 em execução bem-sucedida", codigo === 0);
    ok("main(): clienteContaId chega numérico (16) até carregarWorkspace, vindo do argv --clienteConta",
      chamadas.length === 1 && chamadas[0].clienteContaId === 16);
  }

  // ── 3: nenhuma escrita no snapshot (checagem estática do arquivo-fonte) ──

  {
    const fonte = fs.readFileSync(path.join(__dirname, "..", "jobs", "margemProjetadaGlobal.js"), "utf8");
    ok("o arquivo-fonte da CLI nunca chama .query() diretamente — toda escrita/leitura de banco passa por motorMargemService/snapshotRepository",
      !/\.query\s*\(/.test(fonte));
    ok("o arquivo da CLI não faz require() de adapters do Motor diretamente (só de motorMargemService, a fachada)",
      !/require\([^)]*(marketplaceCurrentQuoteService|meliApiEvidenceAdapter|marginEngine|centralVendasEvidenceAdapter|baseCustosEvidenceAdapter)[^)]*\)/i.test(fonte));
  }

  {
    // Nem --dry-run nem --persist: falha ANTES de chamar o Motor (nenhuma tentativa de I/O).
    const chamadas = [];
    const deps = {
      carregarWorkspace: async (args) => { chamadas.push(args); return { itens: [], totalItensMl: 0 }; },
      pool: { end: async () => {} },
    };
    const codigo = await main(["--clienteSlug=cliente-a"], deps);
    ok("main() sem --dry-run nem --persist: exit code 1, erro de uso (MODO_OBRIGATORIO)", codigo === 1);
    ok("main() sem --dry-run nem --persist: carregarWorkspace NUNCA é chamado (falha antes)", chamadas.length === 0);
  }

  {
    // --dry-run E --persist juntos: ambíguo, também falha antes de chamar o Motor.
    const chamadas = [];
    const deps = {
      carregarWorkspace: async (args) => { chamadas.push(args); return { itens: [], totalItensMl: 0 }; },
      pool: { end: async () => {} },
    };
    const codigo = await main(["--clienteSlug=cliente-a", "--dry-run", "--persist"], deps);
    ok("main() com --dry-run E --persist juntos: exit code 1, erro de uso (MODO_AMBIGUO)", codigo === 1);
    ok("main() com os dois flags: carregarWorkspace NUNCA é chamado (falha antes)", chamadas.length === 0);
  }

  // ── 4: resumo usa item.margin.projected / item.quality.status do Motor ──

  {
    const itens = [
      itemFixture({ itemId: "MLB1", computable: true, profit: 20, marginPercent: 18, status: "HEALTHY" }),
      itemFixture({ itemId: "MLB2", computable: true, profit: 5, marginPercent: 4, status: "LOW_MARGIN" }),
      itemFixture({ itemId: "MLB3", computable: false, profit: null, marginPercent: null, status: "UNVALIDATED" }),
    ];

    const resumo = montarResumoMargemProjetada({
      itens, totalItensMl: 3, cliente: "cliente-a", clienteContaId: null,
      maxItens: 20, dryRun: true, inicio: "2026-09-25T10:00:00.000Z",
      fim: "2026-09-25T10:00:01.000Z", duracaoMs: 1000,
    });

    ok("itensProcessados reflete o array recebido do Motor", resumo.itensProcessados === 3);
    ok("margensComputaveis conta só item.margin.projected.computable===true", resumo.margensComputaveis === 2);
    ok("margensNaoComputaveis conta o restante", resumo.margensNaoComputaveis === 1);
    ok("profitTotalCalculado soma profit só dos computáveis (20+5=25)", resumo.profitTotalCalculado === 25);
    ok("margemMediaPercent é a média dos marginPercent computáveis ((18+4)/2=11)", resumo.margemMediaPercent === 11);
    ok("status agrega por item.quality.status", resumo.status.HEALTHY === 1 && resumo.status.LOW_MARGIN === 1 && resumo.status.UNVALIDATED === 1);
    ok("dryRun/maxItens/cliente ecoam os parâmetros recebidos", resumo.dryRun === true && resumo.maxItens === 20 && resumo.cliente === "cliente-a");
  }

  {
    // Catálogo sem itens computáveis não pode dividir por zero.
    const resumo = montarResumoMargemProjetada({
      itens: [], totalItensMl: 0, cliente: "cliente-a", clienteContaId: null,
      maxItens: 20, dryRun: true, inicio: "x", fim: "y", duracaoMs: 0,
    });
    ok("workspace vazio: margemMediaPercent é null (não NaN/divisão por zero)", resumo.margemMediaPercent === null);
    ok("workspace vazio: profitTotalCalculado é 0", resumo.profitTotalCalculado === 0);
  }

  // ── 5: erro do Motor gera exit code correto ─────────────────────────────

  {
    const deps = {
      carregarWorkspace: async () => {
        throw Object.assign(new Error("Cliente não possui grant Mercado Livre."), { statusCode: 424, codigo: "GRANT_ML_NAO_CONECTADO" });
      },
      pool: { end: async () => {} },
    };
    const codigo = await main(["--clienteSlug=cliente-sem-grant", "--dry-run"], deps);
    ok("main(): erro do Motor (carregarWorkspace rejeita) produz exit code 1", codigo === 1);
  }

  console.log(`\nmargemProjetadaGlobalJob.test.js: ${checks} verificações passaram.`);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
