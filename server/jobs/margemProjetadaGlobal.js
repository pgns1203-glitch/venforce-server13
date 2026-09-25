// server/jobs/margemProjetadaGlobal.js
// -----------------------------------------------------------------------------
// FASE 2 do plano de ordenação global por margem PROJETADA (Anúncios ML) — ver
// docs/AUDITORIA_ANUNCIOS_ML_MARGEM_PROJETADA_FASE2_JOB_MANUAL.md. Este é o
// PRIMEIRO experimento: uma CLI manual, SOMENTE dry-run, para medir o custo
// real de calcular margem projetada com o Motor de Margem existente — antes
// de decidir qualquer teto de itens, scheduler ou escrita real no snapshot.
//
// O Motor de Margem (server/services/motorMargem/) continua sendo a ÚNICA
// fonte de verdade da margem. Este arquivo NÃO calcula margem, NÃO chama o
// Mercado Livre diretamente, NÃO replica fórmula de comissão/frete/custo —
// só chama `motorMargemService.carregarWorkspace`, lê `item.margin.projected`
// e `item.quality.status` do contrato que o Motor já devolve, e agrega em
// métricas. Nenhuma escrita em `anuncios_margem_projetada_snapshot` (ou em
// qualquer tabela) acontece aqui — nem em dry-run, nem fora dele: esta
// primeira versão só sabe medir, `--dry-run` é obrigatório.
//
// Fluxo (nenhum salto de camada):
//   CLI → motorMargemService.carregarWorkspace → prepareWorkspaceContext →
//   enrichBatch → marginEngine (já existente) → item.margin.projected → métricas
//
// Uso:
//   node server/jobs/margemProjetadaGlobal.js --clienteSlug=<slug> --dry-run [opções]
//
// Opções:
//   --clienteConta=<id>   Restringe a uma conta ML específica (default: resolução automática)
//   --maxItens=N          Teto de itens varridos nesta rodada (default: 20 — 1 lote do Motor;
//                          NUNCA assume catálogo inteiro)
//   --json                Imprime também o resumo completo em JSON
//   --dry-run             OBRIGATÓRIO nesta versão — nenhuma escrita é suportada ainda
// -----------------------------------------------------------------------------

require("dotenv").config();

const motorMargemService = require("../services/motorMargem/motorMargemService");
const { encerrar } = require("./centralVendasJobCli");

// Mesmo teto de lote que o Motor usa hoje (PAGE_LIMIT_MAX, não exportado por
// motorMargemService) — só para a ESTIMATIVA de chamadas ML abaixo, nunca
// para decidir o tamanho real do lote (isso é decisão interna do Motor). Se
// o Motor mudar esse teto, este número precisa ser revisto junto.
const PAGE_LIMIT_ESTIMADO = 20;
const MAX_ITENS_DEFAULT = 20;

function round2(value) {
  return value === null || value === undefined ? null : Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseArgs(argv) {
  const args = { clienteSlug: null, clienteConta: null, maxItens: null, dryRun: false, json: false };
  for (const raw of argv) {
    const [chave, ...resto] = String(raw).split("=");
    const valor = resto.join("=");
    switch (chave) {
      case "--clienteSlug": args.clienteSlug = valor; break;
      case "--clienteConta": args.clienteConta = valor; break;
      case "--maxItens": args.maxItens = valor; break;
      case "--dry-run": args.dryRun = true; break;
      case "--json": args.json = true; break;
      default: throw Object.assign(new Error(`Argumento desconhecido: ${raw}`), { codigo: "ARGUMENTO_DESCONHECIDO" });
    }
  }
  return args;
}

// Núcleo PURO das métricas (sem I/O): dado o que `carregarWorkspace` já
// devolveu, agrega. Nunca recalcula margem — só lê `item.margin.projected`
// (computable/profit/marginPercent) e `item.quality.status`, os mesmos
// campos que `/anuncios-meli/performance` já expõe hoje. Separado de
// `executar()` para ser testável sem banco/Motor (mesmo padrão de
// `calcularCobertura` em auditoriaCoberturaMargemRealizada.js).
function montarResumoMargemProjetada({
  itens,
  totalItensMl,
  cliente,
  clienteContaId,
  maxItens,
  dryRun,
  inicio,
  fim,
  duracaoMs,
}) {
  const status = {};
  let margensComputaveis = 0;
  let margensNaoComputaveis = 0;
  let profitTotal = 0;
  let somaMarginPercent = 0;

  for (const item of itens) {
    const projetado = item.margin.projected;
    if (projetado.computable) {
      margensComputaveis += 1;
      profitTotal += projetado.profit || 0;
      somaMarginPercent += projetado.marginPercent || 0;
    } else {
      margensNaoComputaveis += 1;
    }

    const chave = (item.quality && item.quality.status) || "OUTRO";
    status[chave] = (status[chave] || 0) + 1;
  }

  const margemMediaPercent = margensComputaveis > 0 ? round2(somaMarginPercent / margensComputaveis) : null;

  // ESTIMATIVA, não medição real — mlFetch não tem contador hoje (achado da
  // auditoria da Fase 2) e esta etapa não cria instrumentação global. Fórmula:
  // por lote de até PAGE_LIMIT_ESTIMADO itens, `buscarItensAtivos` (2 chamadas,
  // status active+paused) + `buscarDetalhesItens` (1 multiget); por item, até
  // 3 chamadas (preço/comissão/frete). Pode ser MENOR na prática se algum
  // item cair de cache/erro antes da 3ª chamada — é teto, não valor exato.
  const lotes = itens.length > 0 ? Math.ceil(itens.length / PAGE_LIMIT_ESTIMADO) : 0;
  const chamadasMlAproximadas = lotes * (2 + 1) + itens.length * 3;

  return {
    cliente,
    clienteContaId,
    maxItens,
    dryRun,
    inicio,
    fim,
    duracaoMs,
    totalItensMl,
    itensProcessados: itens.length,
    margensComputaveis,
    margensNaoComputaveis,
    profitTotalCalculado: round2(profitTotal),
    margemMediaPercent,
    status,
    chamadasMlAproximadas,
    erros: [],
  };
}

function formatarRelatorio(r) {
  const linhas = [];
  linhas.push(`Cliente: ${r.cliente}${r.clienteContaId != null ? ` (conta ${r.clienteContaId})` : ""}`);
  linhas.push(`Modo: ${r.dryRun ? "DRY-RUN (nenhuma escrita)" : "REAL"}`);
  linhas.push(`Início: ${r.inicio}  Fim: ${r.fim}  Duração: ${r.duracaoMs}ms`);
  linhas.push("");
  linhas.push(`maxItens pedido: ${r.maxItens}`);
  linhas.push(`Itens no catálogo ML (totalItensMl): ${r.totalItensMl}`);
  linhas.push(`Itens processados nesta rodada: ${r.itensProcessados}`);
  linhas.push("");
  linhas.push(`Margem projetada computável: ${r.margensComputaveis}`);
  linhas.push(`Margem projetada NÃO computável: ${r.margensNaoComputaveis}`);
  linhas.push(`Profit total calculado (soma, só itens computáveis): ${r.profitTotalCalculado}`);
  linhas.push(`Margem média % (só itens computáveis): ${r.margemMediaPercent}`);
  linhas.push("");
  linhas.push("Status (item.quality.status):");
  for (const [chave, qtd] of Object.entries(r.status)) {
    linhas.push(`  ${chave} .......... ${qtd}`);
  }
  linhas.push("");
  linhas.push(`[estimativa, não medido] chamadas ao Mercado Livre: ~${r.chamadasMlAproximadas}`);
  if (r.erros.length) {
    linhas.push("");
    linhas.push(`Erros: ${r.erros.length}`);
    for (const e of r.erros) linhas.push(`  ${e}`);
  }
  return linhas.join("\n");
}

// Chama o Motor (única fonte de verdade) e devolve o workspace bruto.
// `deps.carregarWorkspace` é injetável só para teste — nunca aponta para
// outra implementação em produção.
async function executar({ clienteSlug, clienteContaId, maxItens }, deps = {}) {
  const carregarWorkspace = deps.carregarWorkspace || motorMargemService.carregarWorkspace;
  return carregarWorkspace({ clienteSlug, clienteContaId, maxItens });
}

async function main(argv = process.argv.slice(2), deps = {}) {
  const inicioTs = Date.now();
  const inicio = new Date(inicioTs).toISOString();
  const pool = deps.pool || require("../config/database");

  try {
    const args = parseArgs(argv);

    if (!args.clienteSlug) {
      throw Object.assign(new Error("--clienteSlug é obrigatório."), { codigo: "CLIENTE_SLUG_OBRIGATORIO" });
    }
    if (!args.dryRun) {
      throw Object.assign(
        new Error("--dry-run é obrigatório nesta primeira versão do job — nenhuma escrita é suportada ainda."),
        { codigo: "DRY_RUN_OBRIGATORIO" }
      );
    }

    const clienteContaId = args.clienteConta != null ? Number(args.clienteConta) : null;
    const maxItens = args.maxItens != null ? Number(args.maxItens) : MAX_ITENS_DEFAULT;

    const workspace = await executar({ clienteSlug: args.clienteSlug, clienteContaId, maxItens }, deps);

    const fimTs = Date.now();
    const resumo = montarResumoMargemProjetada({
      itens: workspace.itens,
      totalItensMl: workspace.totalItensMl,
      cliente: args.clienteSlug,
      clienteContaId,
      maxItens,
      dryRun: args.dryRun,
      inicio,
      fim: new Date(fimTs).toISOString(),
      duracaoMs: fimTs - inicioTs,
    });

    console.log(formatarRelatorio(resumo));
    if (args.json) {
      console.log("\n--- JSON ---");
      console.log(JSON.stringify(resumo, null, 2));
    }
    return 0;
  } catch (err) {
    console.error(`[margem-projetada] erro${err.codigo ? ` [${err.codigo}]` : ""}: ${err.message}`);
    return 1;
  } finally {
    if (pool && typeof pool.end === "function") {
      await pool.end().catch(() => {});
    }
  }
}

if (require.main === module) {
  main().then(encerrar, (err) => {
    console.error("[margem-projetada] erro fatal:", err?.message || err);
    encerrar(1);
  });
}

module.exports = {
  parseArgs,
  montarResumoMargemProjetada,
  formatarRelatorio,
  executar,
  main,
};
