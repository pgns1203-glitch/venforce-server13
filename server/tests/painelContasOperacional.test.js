// server/tests/painelContasOperacional.test.js
//
// Núcleo PURO do Painel de Contas operacional (sem banco):
//   B  cliente multiconta: consolidado = soma auditável das contas
//   C  consolidado parcial: conta sem import nunca vira valor inventado
//   E  manual válido sem automático → valor com fonte MANUAL
//   F  automático vence manual (manual continua auditável)
//   H  fórmulas: LC/MC, ACOS, TACoS consistentes com as funções oficiais
//   -  status explica a causa com evidência (nunca inventa "API falhou")
//   -  ausência é null, zero é zero

process.env.DATABASE_URL = "postgres://nobody@127.0.0.1:1/teste-sem-banco";

const assert = require("assert");
const op = require("../services/painelContas/painelContasOperacional");
const manual = require("../services/painelContas/painelContasManual");
const { calcularTacos } = require("../services/cliente360/cliente360AdsService");

let checks = 0;
let concluido = false;
process.on("exit", () => {
  if (!concluido) {
    console.error(`painelContasOperacional.test.js: NÃO concluiu (parou após ${checks} verificações)`);
    process.exitCode = 1;
  }
});
function ok(label, cond) {
  assert.ok(cond, `FALHOU: ${label}`);
  checks += 1;
}
function eq(label, actual, expected) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${label} — recebido ${JSON.stringify(actual)}`);
  checks += 1;
}
const perto = (a, b, tol = 1e-9) => a !== null && b !== null && Math.abs(a - b) <= tol;

// ─── fixtures ────────────────────────────────────────────────────────────────

function conta(id, over = {}) {
  return {
    id, cliente_id: 1, marketplace: "meli", nome: `LOJA ${id}`, slug: `loja-${id}`,
    external_account_id: `ML${id}`, is_primary: id === 1, ativo: true, ...over,
  };
}

// Linha de central_vendas_imports como o repositório devolve (resumo_json já
// com os campos oficiais de buildResumoCentralVendas).
function importRow(contaId, { fat, fatComCusto = fat, lc, id = contaId * 100, completude = "complete", ate = "2026-09-28", publicado = "2026-09-29T06:10:00.000Z" }) {
  const mcPct = lc !== null && fatComCusto > 0 ? Math.round((lc / fatComCusto) * 100 * 100) / 100 : null;
  return {
    id, cliente_conta_id: contaId, competencia: "2026-09", publication_status: "published",
    coverage_date_from: "2026-09-01", coverage_date_to: ate, published_at: publicado,
    created_at: publicado, sync_run_id: id + 1,
    faturamento: fat, faturamento_com_custo: fatComCusto, lucro_contribuicao: lc,
    margem_contribuicao_percentual: mcPct, completeness_status: completude,
  };
}

function manualRow(contaId, over = {}) {
  return {
    id: 900 + contaId, cliente_id: 1, cliente_conta_id: contaId, competencia: "2026-09",
    faturamento: 1000, lucro_contribuicao: 150, margem_contribuicao: 0.15,
    investimento_ads: 50, gmv_ads: 400, observacao: "planilha do cliente",
    created_by: 7, updated_by: 7, updated_by_nome: "Ana", created_at: "2026-09-10T10:00:00.000Z",
    updated_at: "2026-09-10T10:00:00.000Z", ...over,
  };
}

function resolverTodas(contas, { imports = {}, manuais = {}, runs = {} } = {}) {
  return op.resolverContas(contas, {
    importPorConta: new Map(Object.entries(imports).map(([k, v]) => [Number(k), v])),
    manualPorConta: new Map(Object.entries(manuais).map(([k, v]) => [Number(k), v])),
    runPorConta: new Map(Object.entries(runs).map(([k, v]) => [Number(k), v])),
  });
}

function run() {
  // ===========================================================================
  // Rótulos de conta e legado
  // ===========================================================================
  {
    const contas = resolverTodas([
      conta(2, { is_primary: false, nome: "SEGUNDA" }),
      conta(1, { nome: "AMARO SOLUÇÕES" }),
      conta(3, { marketplace: "shopee", nome: "SHOP", external_account_id: null }),
    ]);
    eq("contas ordenadas: principal primeiro, depois por id, agrupadas por marketplace",
      contas.map((c) => c.rotulo),
      ["Mercado Livre 1 · AMARO SOLUÇÕES", "Mercado Livre 2 · SEGUNDA", "Shopee 1 · SHOP"]);
    ok("ehSquadLegado reconhece squad-8-legado", op.ehSquadLegado({ slug: "squad-8-legado", nome: "Squad 8 - Legado" }));
    ok("ehSquadLegado não pega squad comum", !op.ehSquadLegado({ slug: "squad-6", nome: "Squad 6" }));
    ok("ehSquadLegado(null) = false", !op.ehSquadLegado(null));
  }

  // ===========================================================================
  // B — multiconta: consolidado = soma auditável das contas
  // ===========================================================================
  {
    const contas = resolverTodas([conta(1), conta(2), conta(3)], {
      imports: {
        1: importRow(1, { fat: 100, lc: 20 }),
        2: importRow(2, { fat: 200, lc: 30 }),
        3: importRow(3, { fat: 300, lc: 60 }),
      },
    });
    eq("B: cada conta mostra o SEU FAT", contas.map((c) => c.resumo.fat), [100, 200, 300]);
    ok("B: MC por conta vem do resumo oficial do import (LC/fat com custo)", perto(contas[0].resumo.mc, 0.2));
    ok("B: contas com import publicado = sincronizado, fonte API", contas.every((c) => c.status.codigo === "sincronizado" && c.fonte.tipo === "api"));

    const cli = op.consolidarCliente({ contas, snapshot: null, adsCliente: null });
    eq("B: consolidado = 600", cli.resumo.fat, 600);
    eq("B: LC consolidado = soma", cli.resumo.lc, 110);
    ok("B: MC consolidado = ΣLC / Σfat com custo (mesma definição da Central)", perto(cli.resumo.mc, 110 / 600, 1e-4));
    eq("B: escopo explícito", cli.escopo, { tipo: "consolidado", rotulo: "Consolidado · 3 contas", contasOperacionais: 3, contasComDado: 3 });
    eq("B: status sincronizado", cli.status.codigo, "sincronizado");
    eq("B: dadosAte = menor cobertura entre as contas", cli.dadosAte, "2026-09-28");
    ok("B: soma das contas bate com o consolidado", contas.reduce((s, c) => s + c.resumo.fat, 0) === cli.resumo.fat);
  }

  // Conta única: escopo é a própria conta, nunca "consolidado".
  {
    const contas = resolverTodas([conta(1, { nome: "AMARO" })], { imports: { 1: importRow(1, { fat: 2833602, lc: 400000 }) } });
    const cli = op.consolidarCliente({ contas, snapshot: null, adsCliente: null });
    eq("conta única: escopo = a conta", [cli.escopo.tipo, cli.escopo.rotulo], ["conta", "Mercado Livre 1 · AMARO"]);
  }

  // Snapshot oficial que cobre EXATAMENTE os imports escolhidos vence (Ads e
  // precedência de MC do fechamento vêm dele).
  {
    const contas = resolverTodas([conta(1), conta(2)], {
      imports: { 1: importRow(1, { fat: 100, lc: 20 }), 2: importRow(2, { fat: 200, lc: 30 }) },
    });
    const snapshot = {
      competencia: "2026-09", faturamento: 300, mcMedia: 0.21, adsInvestido: 30, gmvAds: 150,
      lucroContribuicao: 50, lucroContribuicaoPresente: true, sincronizadoEm: "2026-09-29T06:20:00.000Z",
      fonte: "central_vendas", mcFonte: "central_vendas", centralDadosAte: "2026-09-28",
      centralImportIds: [100, 200],
    };
    const cli = op.consolidarCliente({ contas, snapshot, adsCliente: null });
    eq("snapshot casado: resumo do snapshot", [cli.resumo.fat, cli.resumo.lc, cli.resumo.ads], [300, 50, 30]);
    ok("snapshot casado: ACOS e TACoS do snapshot", perto(cli.resumo.acos, 30 / 150) && perto(cli.resumo.tacos, calcularTacos(30, 300)));
    eq("snapshot casado: atualizado = sincronizado_em do snapshot", cli.atualizadoEm, "2026-09-29T06:20:00.000Z");
    eq("snapshot casado: origem", cli.origem, "snapshot");

    // Snapshot desatualizado (outro import publicado depois): usa os imports.
    const velho = { ...snapshot, centralImportIds: [99, 200], faturamento: 250 };
    const cli2 = op.consolidarCliente({ contas, snapshot: velho, adsCliente: { investimentoAds: 40, gmvAds: 200, atualizadoEm: "2026-09-29T05:00:00.000Z" } });
    eq("snapshot desatualizado: FAT dos imports atuais (não do snapshot velho)", cli2.resumo.fat, 300);
    eq("snapshot desatualizado: Ads do resumo mensal de Ads do cliente", cli2.resumo.ads, 40);
    ok("snapshot desatualizado: ACOS com o GMV do mesmo resumo", perto(cli2.resumo.acos, 40 / 200));
    eq("snapshot desatualizado: origem", cli2.origem, "contas");
  }

  // ===========================================================================
  // C — consolidado parcial: 2 de 3 contas
  // ===========================================================================
  {
    const contas = resolverTodas([conta(1), conta(2), conta(3)], {
      imports: { 1: importRow(1, { fat: 100, lc: 20 }), 2: importRow(2, { fat: 200, lc: 30 }) },
    });
    const c3 = contas[2];
    eq("C: conta 3 sem import → resumo null (nunca 300 inventado)", c3.resumo, null);
    eq("C: conta 3 → sem dados na competência (sem inventar causa)", [c3.status.codigo, c3.status.motivo], ["sem_dados", "Ainda não sincronizada nesta competência"]);

    const cli = op.consolidarCliente({ contas, snapshot: null, adsCliente: null });
    eq("C: consolidado parcial soma só o que existe", cli.resumo.fat, 300);
    eq("C: status parcial", cli.status.codigo, "parcial");
    eq("C: motivo diz quantas contas", cli.status.motivo, "2 de 3 contas com dados");
    eq("C: escopo mostra a cobertura", cli.escopo.rotulo, "Consolidado · 2 de 3 contas");

    // Snapshot antigo com as 3 contas não pode "completar" o parcial.
    const snapshot = { competencia: "2026-09", faturamento: 600, centralImportIds: [100, 200, 300], sincronizadoEm: "2026-09-20T00:00:00.000Z", fonte: "central_vendas" };
    const cli2 = op.consolidarCliente({ contas, snapshot, adsCliente: null });
    eq("C: snapshot com import que não é mais o atual não vira consolidado completo", [cli2.status.codigo, cli2.resumo.fat], ["parcial", 300]);
  }

  // Causas com evidência
  {
    const contas = resolverTodas([
      conta(1, { external_account_id: null }),
      conta(2, { marketplace: "shopee", external_account_id: null }),
      conta(3),
      conta(4),
      conta(5),
      conta(6, { ativo: false }),
    ], {
      runs: {
        3: { status: "failed", error_code: "ML_GRANT_REVOKED", created_at: "2026-09-29T06:00:00.000Z" },
        4: { status: "running", created_at: "2026-09-29T06:00:00.000Z" },
        5: { status: "completed", created_at: "2026-09-29T06:00:00.000Z" },
      },
    });
    const porId = new Map(contas.map((c) => [c.id, c]));
    eq("ML sem external_account_id → sem conexão", porId.get(1).status.codigo, "sem_conexao");
    eq("Shopee → marketplace sem integração automática", [porId.get(2).status.codigo, porId.get(2).status.motivo], ["sem_integracao", "Marketplace sem integração automática"]);
    eq("run failed → erro de sync com o code do run", [porId.get(3).status.codigo, porId.get(3).status.erroCodigo], ["erro_sync", "ML_GRANT_REVOKED"]);
    eq("run running → sincronizando", porId.get(4).status.codigo, "sincronizando");
    eq("run completed sem import publicado → não publicado", porId.get(5).status.codigo, "nao_publicado");
    eq("conta inativa → conta_inativa, sem valor", [porId.get(6).status.codigo, porId.get(6).resumo], ["conta_inativa", null]);
    ok("lançar manual só onde não há automático", porId.get(1).podeLancarManual && porId.get(2).podeLancarManual && porId.get(3).podeLancarManual && !porId.get(6).podeLancarManual);

    const cli = op.consolidarCliente({ contas, snapshot: null, adsCliente: null });
    eq("cliente sem nenhum dado → sem_dados", cli.status.codigo, "sem_dados");
    eq("conta inativa não entra no esperado", cli.escopo.contasOperacionais, 5);
    ok("sem dados + causa acionável → precisa de atenção", cli.status.precisaAtencao === true);
    ok("motivo agregado lista as causas", /1 sem conexão/.test(cli.status.motivo) && /1 sem integração/.test(cli.status.motivo) && /1 com erro de sync/.test(cli.status.motivo));

    const semNada = op.consolidarCliente({ contas: resolverTodas([conta(1)]), snapshot: null, adsCliente: null });
    eq("uma conta sem dado e sem evidência → motivo da conta, sem acusar API", semNada.status.motivo, "Ainda não sincronizada nesta competência");
    ok("sem evidência de falha → não precisa de atenção", semNada.status.precisaAtencao === false);
  }

  // Import publicado + último run falhou → mantém dado, avisa.
  {
    const [c] = resolverTodas([conta(1)], {
      imports: { 1: importRow(1, { fat: 10, lc: 1, completude: "partial" }) },
      runs: { 1: { status: "failed", error_code: "ORDERS_HTTP_ERROR", created_at: "2026-09-30T06:00:00.000Z" } },
    });
    eq("dado publicado continua sincronizado", c.status.codigo, "sincronizado");
    ok("aviso de completude parcial", c.avisos.some((a) => /completude parcial/i.test(a)));
    ok("aviso de último sync com falha", c.avisos.some((a) => /ORDERS_HTTP_ERROR/.test(a)));
  }

  // Cliente sem conta cadastrada
  {
    const cli = op.consolidarCliente({ contas: [], snapshot: null, adsCliente: null });
    eq("sem conta → sem_conta, atenção", [cli.status.codigo, cli.status.precisaAtencao], ["sem_conta", true]);
    const legado = op.consolidarCliente({
      contas: [],
      snapshot: { competencia: "2026-09", faturamento: 500, mcMedia: 18, sincronizadoEm: "2026-09-05T00:00:00.000Z", fonte: null },
      adsCliente: null,
    });
    eq("sem conta mas com snapshot do cliente → dado com escopo cliente", [legado.status.codigo, legado.escopo.tipo, legado.resumo.fat], ["sincronizado", "cliente", 500]);
    ok("snapshot do cliente: MC percentual normalizado", perto(legado.resumo.mc, 0.18));
  }

  // ===========================================================================
  // E — manual sem automático
  // ===========================================================================
  {
    const contas = resolverTodas([conta(1, { marketplace: "shopee", external_account_id: null })], { manuais: { 1: manualRow(1) } });
    const c = contas[0];
    eq("E: manual preenche a conta", [c.status.codigo, c.fonte.tipo, c.resumo.fat], ["manual", "manual", 1000]);
    ok("E: ACOS/TACoS do manual pelas funções oficiais", perto(c.resumo.acos, 50 / 400) && perto(c.resumo.tacos, calcularTacos(50, 1000)));
    eq("E: registro manual auditável na conta", [c.manual.atualizadoPor, c.manual.observacao], ["Ana", "planilha do cliente"]);
    const cli = op.consolidarCliente({ contas, snapshot: null, adsCliente: null });
    eq("E: consolidado com fonte manual", [cli.status.codigo, cli.fonte.tipo, cli.resumo.fat], ["manual", "manual", 1000]);
    eq("E: Ads manual entra quando não há Ads automático", cli.resumo.ads, 50);
    ok("E: podeLancarManual segue verdadeiro (editar)", c.podeLancarManual);
  }

  // Misto: conta API + conta manual.
  {
    const contas = resolverTodas([conta(1), conta(2, { marketplace: "shopee", external_account_id: null })], {
      imports: { 1: importRow(1, { fat: 100, fatComCusto: 80, lc: 16 }) },
      manuais: { 2: manualRow(2, { faturamento: 50, lucro_contribuicao: 10, margem_contribuicao: 0.2, investimento_ads: null, gmv_ads: null }) },
    });
    const cli = op.consolidarCliente({ contas, snapshot: null, adsCliente: { investimentoAds: 12, gmvAds: 60, atualizadoEm: "2026-09-29T00:00:00.000Z" } });
    eq("misto: fonte API + manual", [cli.status.codigo, cli.fonte.tipo, cli.fonte.rotulo], ["manual", "misto", "API + manual"]);
    eq("misto: FAT soma API e manual", cli.resumo.fat, 150);
    ok("misto: MC = ΣLC / Σ base (fat com custo na API, FAT no manual)", perto(cli.resumo.mc, 26 / 130, 1e-4));
    eq("misto: Ads automático do cliente vence o manual", cli.resumo.ads, 12);
  }

  // ===========================================================================
  // F — automático vence manual, manual continua auditável
  // ===========================================================================
  {
    const [c] = resolverTodas([conta(1)], {
      imports: { 1: importRow(1, { fat: 5000, lc: 700 }) },
      manuais: { 1: manualRow(1, { faturamento: 4800 }) },
    });
    eq("F: automático é o principal", [c.status.codigo, c.fonte.tipo, c.resumo.fat], ["sincronizado", "api", 5000]);
    ok("F: manual não some — fica marcado como substituído", c.manual && c.manual.substituidoPorAutomatico === true && c.manual.valores.fat === 4800);
    ok("F: com automático não oferece lançar manual", c.podeLancarManual === false);
  }

  // ===========================================================================
  // H — validação e derivação do lançamento manual
  // ===========================================================================
  {
    const r1 = manual.validarLancamento({ faturamento: 1000, lucroContribuicao: 150 });
    ok("H: FAT + LC → MC = LC/FAT", r1.ok && perto(r1.valores.margemContribuicao, 0.15));
    const r2 = manual.validarLancamento({ faturamento: 1000, margemContribuicao: 0.2 });
    ok("H: FAT + MC → LC = FAT × MC", r2.ok && r2.valores.lucroContribuicao === 200);
    const r3 = manual.validarLancamento({ faturamento: 1000, lucroContribuicao: 150, margemContribuicao: 0.3 });
    ok("H: FAT/LC/MC inconsistentes → recusa", !r3.ok && r3.codigo === "MANUAL_INCONSISTENTE");
    const r4 = manual.validarLancamento({ faturamento: 1000, lucroContribuicao: 150, margemContribuicao: 0.152 });
    ok("H: diferença dentro da tolerância (0,5 p.p.) é aceita", r4.ok);
    const r5 = manual.validarLancamento({ observacao: "nada" });
    ok("H: nenhuma métrica → recusa", !r5.ok && r5.codigo === "MANUAL_VAZIO");
    const r6 = manual.validarLancamento({ faturamento: -1 });
    ok("H: FAT negativo → recusa", !r6.ok && r6.codigo === "MANUAL_INVALIDO");
    const r7 = manual.validarLancamento({ faturamento: 100, margemContribuicao: 18 });
    ok("H: MC fora de [-1, 1] (percentual enviado como fração) → recusa", !r7.ok && r7.codigo === "MANUAL_INVALIDO");
    const r8 = manual.validarLancamento({ investimentoAds: 0, gmvAds: 0 });
    ok("H: zero é valor conhecido (aceito, não vira null)", r8.ok && r8.valores.investimentoAds === 0 && r8.valores.faturamento === null);
    const r9 = manual.validarLancamento({ faturamento: "abc" });
    ok("H: texto não numérico → recusa", !r9.ok);
    const r10 = manual.validarLancamento({ faturamento: 0, lucroContribuicao: 10 });
    ok("H: FAT 0 → MC não é derivado (sem divisão por zero)", r10.ok && r10.valores.margemContribuicao === null);
    ok("H: observação é aparada e limitada", manual.validarLancamento({ faturamento: 1, observacao: `  ${"x".repeat(900)} ` }).valores.observacao.length === 500);
    ok("H: competência válida", manual.competenciaValida("2026-09") && !manual.competenciaValida("2026-13") && !manual.competenciaValida("26-09"));
  }

  concluido = true;
  console.log(`painelContasOperacional.test.js: ${checks} verificações OK`);
}

try {
  run();
} catch (err) {
  console.error(err);
  process.exit(1);
}
