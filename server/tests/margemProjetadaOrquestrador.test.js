// server/tests/margemProjetadaOrquestrador.test.js
//
// Orquestrador MANUAL sequencial da carteira para a margem projetada global
// (server/services/motorMargem/margemProjetadaOrquestradorService.js +
// server/jobs/margemProjetadaOrquestrador.js). Cobre os 18 cenários pedidos:
//
//  1. conta ativa + external_account_id + Base MELI ativa → elegível.
//  2. conta sem external_account_id → ignorada.
//  3. cliente inativo → ignorado.
//  4. conta inativa → ignorada.
//  5. conta MELI sem Base → ignorada.
//  6. Base inativa → ignorada (mesmo motivo de #5 nesta consulta: o EXISTS já
//     filtra v.ativo=true e b.ativo=true — "sem base" e "base desativada"
//     chegam como o MESMO booleano `base_meli_vinculada=false`).
//  7. multi-conta: cada conta elegível aparece separadamente.
//  8. processamento sempre recebe clienteContaId explícito (sync).
//  9. carregarWorkspace recebe clienteContaId correto.
// 10. contas são processadas SEQUENCIALMENTE (nunca em paralelo).
// 11. falha da conta A não impede conta B.
// 12. snapshot parcial gera status "parcial".
// 13. computable=false NÃO gera falha.
// 14. modo --plano não chama sync/Motor/persistência.
// 15. sem filtro e sem --all → CLI recusa execução.
// 16. --all explícito → permite seleção de toda a carteira elegível.
// 17. nenhuma fórmula de margem é duplicada (reaproveita persistirSnapshots
//     e carregarWorkspace já existentes; nenhum INSERT/cálculo novo aqui).
// 18. marketplace_nao_suportado (fixture extra, mesmo motivo do padrão de
//     centralVendasNoturnoService.test.js).

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const svc = require("../services/motorMargem/margemProjetadaOrquestradorService");
const cli = require("../jobs/margemProjetadaOrquestrador");

let checks = 0;
function ok(label, cond) {
  assert.ok(cond, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

function contaRow({ contaId, clienteId, slug, ext = "MLU123", contaAtiva = true, clienteAtivo = true, marketplace = "meli", baseVinculada = true }) {
  return {
    cliente_conta_id: contaId,
    cliente_id: clienteId,
    marketplace,
    external_account_id: ext,
    conta_ativa: contaAtiva,
    conta_nome: `Conta ${contaId}`,
    cliente_slug: slug,
    cliente_nome: slug.toUpperCase(),
    cliente_ativo: clienteAtivo,
    base_meli_vinculada: baseVinculada,
  };
}

function itemFixture({ itemId, computable = true, profit = 10, marginPercent = 15, status = "HEALTHY" }) {
  return {
    identity: { itemId },
    pricing: { current: { value: 100 }, list: { value: 120 } },
    margin: { projected: { profit, margin: null, marginPercent, computable, strict: true, missing: [], assumed: [] } },
    quality: { status },
  };
}

function fakeUpsert() {
  const linhas = new Map();
  const chamadas = [];
  return {
    linhas,
    chamadas,
    upsertSnapshot: async ({ clienteId, clienteContaId, itemId, item, origemJob }) => {
      chamadas.push({ clienteId, clienteContaId, itemId, origemJob });
      const chave = `${clienteId}:${itemId}`;
      const inserted = !linhas.has(chave);
      linhas.set(chave, { clienteId, clienteContaId, itemId });
      return { inserted };
    },
  };
}

const logSilencioso = { log: () => {}, error: () => {}, warn: () => {} };

async function run() {
  // ── 1-6, 18: classificarContas/motivoInelegibilidade ────────────────────
  {
    const rows = [
      contaRow({ contaId: 1, clienteId: 10, slug: "alfa" }), // elegível
      contaRow({ contaId: 2, clienteId: 20, slug: "beta", ext: "" }), // sem ML conectado
      contaRow({ contaId: 3, clienteId: 30, slug: "gama", clienteAtivo: false }), // cliente inativo
      contaRow({ contaId: 4, clienteId: 40, slug: "delta", contaAtiva: false }), // conta inativa
      contaRow({ contaId: 5, clienteId: 50, slug: "epsilon", baseVinculada: false }), // sem Base MELI
      contaRow({ contaId: 6, clienteId: 60, slug: "zeta", baseVinculada: false }), // Base "inativa" (mesmo motivo nesta consulta)
      contaRow({ contaId: 7, clienteId: 70, slug: "eta", marketplace: "shopee" }), // marketplace não suportado
      // multi-conta: MESMO cliente, 2 contas elegíveis distintas
      contaRow({ contaId: 8, clienteId: 80, slug: "theta" }),
      contaRow({ contaId: 9, clienteId: 80, slug: "theta" }),
    ];
    const r = svc.classificarContas(rows);
    ok("1: conta ativa+ext+Base → elegível", r.elegiveis.some((c) => c.clienteContaId === 1));
    ok("2: sem external_account_id → ignorada", r.ignoradas.find((c) => c.clienteContaId === 2)?.motivo === "conta_sem_mercado_livre_conectado");
    ok("3: cliente inativo → ignorado", r.ignoradas.find((c) => c.clienteContaId === 3)?.motivo === "cliente_inativo");
    ok("4: conta inativa → ignorada", r.ignoradas.find((c) => c.clienteContaId === 4)?.motivo === "conta_inativa");
    ok("5: sem Base MELI → ignorada", r.ignoradas.find((c) => c.clienteContaId === 5)?.motivo === "base_meli_nao_vinculada");
    ok("6: Base inativa → ignorada (mesmo motivo)", r.ignoradas.find((c) => c.clienteContaId === 6)?.motivo === "base_meli_nao_vinculada");
    ok("18: marketplace não suportado → ignorada", r.ignoradas.find((c) => c.clienteContaId === 7)?.motivo === "marketplace_nao_suportado");
    ok("7: multi-conta — as 2 contas do mesmo cliente aparecem SEPARADAMENTE em elegíveis",
      r.elegiveis.filter((c) => c.clienteId === 80).map((c) => c.clienteContaId).sort().join(",") === "8,9");
    ok("total contabiliza todas as linhas descobertas", r.total === rows.length);

    const filtrado = svc.classificarContas(rows, { clientes: ["ALFA"] });
    ok("filtro --clientes (case-insensitive) restringe corretamente", filtrado.elegiveis.length === 1 && filtrado.elegiveis[0].clienteSlug === "alfa");
  }

  // ── 8, 9: clienteContaId explícito no sync e no Motor ────────────────────
  {
    const conta = { clienteId: 100, clienteSlug: "zenite_loja", clienteContaId: 38, externalAccountId: "MLU38" };
    const chamadasSync = [];
    const chamadasWorkspace = [];
    const tabela = fakeUpsert();
    const deps = {
      sincronizar: async (args) => { chamadasSync.push(args); return { ok: true, codigo: "OK", totalEncontrados: 1, totalProcessados: 1, totalSalvos: 1 }; },
      carregarWorkspace: async (args) => { chamadasWorkspace.push(args); return { cliente: { id: 100 }, clienteContaId: 38, totalItensMl: 1, itens: [itemFixture({ itemId: "MLB1" })] }; },
      persistirSnapshots: require("../jobs/margemProjetadaGlobal").persistirSnapshots,
      upsertSnapshot: tabela.upsertSnapshot,
      origemJob: "teste",
      maxItens: 20000,
      agora: () => Date.now(),
      logger: logSilencioso,
    };
    const resultado = await svc.processarConta(conta, deps);
    ok("8: sync recebeu clienteContaId explícito (38)", chamadasSync[0].clienteContaId === 38);
    ok("8: sync recebeu modo 'novos'", chamadasSync[0].modo === "novos");
    ok("9: carregarWorkspace recebeu clienteContaId explícito (38)", chamadasWorkspace[0].clienteContaId === 38);
    ok("resultado da conta tem status sucesso", resultado.status === "sucesso");
    ok("snapshot gravado com clienteContaId do WORKSPACE (Motor), não do filtro", tabela.chamadas[0].clienteContaId === 38);
  }

  // ── 13: computable=false NÃO gera falha/parcial ──────────────────────────
  {
    const conta = { clienteId: 100, clienteSlug: "cliente-x", clienteContaId: 5, externalAccountId: "MLU5" };
    const tabela = fakeUpsert();
    const deps = {
      sincronizar: async () => ({ ok: true, codigo: "OK", totalEncontrados: 1, totalProcessados: 1, totalSalvos: 0 }),
      carregarWorkspace: async () => ({
        cliente: { id: 100 }, clienteContaId: 5, totalItensMl: 1,
        itens: [itemFixture({ itemId: "MLB-UNV", computable: false, status: "UNVALIDATED" })],
      }),
      persistirSnapshots: require("../jobs/margemProjetadaGlobal").persistirSnapshots,
      upsertSnapshot: tabela.upsertSnapshot,
      origemJob: "teste",
      maxItens: 20000,
      agora: () => Date.now(),
      logger: logSilencioso,
    };
    const resultado = await svc.processarConta(conta, deps);
    ok("13: item computable=false → status ainda é 'sucesso' (não falha/parcial)", resultado.status === "sucesso");
    ok("13: margensNaoComputaveis contabilizado corretamente", resultado.margem.margensNaoComputaveis === 1 && resultado.margem.margensComputaveis === 0);
  }

  // ── 12: snapshot com falha parcial → status 'parcial' ────────────────────
  {
    const conta = { clienteId: 100, clienteSlug: "cliente-y", clienteContaId: 6, externalAccountId: "MLU6" };
    const deps = {
      sincronizar: async () => ({ ok: true, codigo: "OK", totalEncontrados: 2, totalProcessados: 2, totalSalvos: 2 }),
      carregarWorkspace: async () => ({
        cliente: { id: 100 }, clienteContaId: 6, totalItensMl: 2,
        itens: [itemFixture({ itemId: "MLB-OK" }), itemFixture({ itemId: "MLB-FALHA" })],
      }),
      persistirSnapshots: require("../jobs/margemProjetadaGlobal").persistirSnapshots,
      upsertSnapshot: async ({ itemId }) => {
        if (itemId === "MLB-FALHA") throw new Error("duplicate key value violates unique constraint");
        return { inserted: true };
      },
      origemJob: "teste",
      maxItens: 20000,
      agora: () => Date.now(),
      logger: logSilencioso,
    };
    const resultado = await svc.processarConta(conta, deps);
    ok("12: 1 snapshot falho entre 2 → status 'parcial'", resultado.status === "parcial");
    ok("12: snapshotsFalhos=1 reportado", resultado.margem.snapshotsFalhos === 1);
  }

  // ── falha ESTRUTURAL no sync → status 'falha', Motor nem é chamado ───────
  {
    const conta = { clienteId: 100, clienteSlug: "cliente-z", clienteContaId: 7, externalAccountId: "MLU7" };
    let motorChamado = false;
    const deps = {
      sincronizar: async () => { throw Object.assign(new Error("token expirado"), { code: "ML_GRANT_UNUSABLE" }); },
      carregarWorkspace: async () => { motorChamado = true; return {}; },
      origemJob: "teste",
      maxItens: 20000,
      agora: () => Date.now(),
      logger: logSilencioso,
    };
    const resultado = await svc.processarConta(conta, deps);
    ok("erro estrutural no sync → status 'falha'", resultado.status === "falha");
    ok("erro estrutural no sync → Motor NÃO é chamado para esta conta", motorChamado === false);
  }

  // ── 10, 11: sequencial + isolamento de falha entre contas ────────────────
  {
    const ordem = [];
    const contaA = { clienteId: 1, clienteSlug: "conta-a", clienteContaId: 501, externalAccountId: "MLUA" };
    const contaB = { clienteId: 2, clienteSlug: "conta-b", clienteContaId: 502, externalAccountId: "MLUB" };
    const tabela = fakeUpsert();

    const depsOverride = {
      db: { query: async () => ({ rows: [] }) },
      listarContasElegiveis: async () => [
        contaRow({ contaId: 501, clienteId: 1, slug: "conta-a" }),
        contaRow({ contaId: 502, clienteId: 2, slug: "conta-b" }),
      ],
      sincronizar: async ({ clienteContaId }) => {
        ordem.push(`sync-inicio-${clienteContaId}`);
        if (clienteContaId === 501) {
          ordem.push(`sync-fim-${clienteContaId}`);
          throw Object.assign(new Error("ML fora do ar"), { code: "ML_API_ERROR" });
        }
        ordem.push(`sync-fim-${clienteContaId}`);
        return { ok: true, codigo: "OK", totalEncontrados: 1, totalProcessados: 1, totalSalvos: 1 };
      },
      carregarWorkspace: async ({ clienteContaId }) => {
        ordem.push(`motor-${clienteContaId}`);
        return { cliente: { id: clienteContaId === 501 ? 1 : 2 }, clienteContaId, totalItensMl: 1, itens: [itemFixture({ itemId: `MLB-${clienteContaId}` })] };
      },
      persistirSnapshots: require("../jobs/margemProjetadaGlobal").persistirSnapshots,
      upsertSnapshot: tabela.upsertSnapshot,
      logger: logSilencioso,
    };

    const resumo = await svc.executarRodada({}, depsOverride);
    ok("10: sequencial — conta A termina ANTES de conta B começar (sync-fim-501 antes de sync-inicio-502)",
      ordem.indexOf("sync-fim-501") < ordem.indexOf("sync-inicio-502"));
    ok("10: nenhuma chamada de conta B começou antes do fim de conta A", ordem.indexOf("motor-502") > ordem.indexOf("sync-fim-501"));
    ok("11: falha da conta A não impede conta B — conta B processada", ordem.includes("motor-502"));
    ok("11: resultado tem 1 falha (A) e 1 sucesso (B)", resumo.falhas === 1 && resumo.sucessos === 1);
    ok("11: nenhuma terceira conta processada", resumo.resultados.length === 2);
  }

  // ── observabilidade de 429: conta A recebe rate limit, B ainda executa ────
  //
  // Simula o Motor (carregarWorkspace) rejeitando com o MESMO shape de erro
  // que meliApiEvidenceAdapter.criarErroMeliApi produz de verdade
  // (statusCode=429, codigo="MELI_RATE_LIMIT", retryAfter) — prova que
  // resumirErro() propaga os 3 campos até o resultado por conta, sem
  // reinterpretar nem inventar retry.
  {
    const chamadasMotor = [];
    const contaA = { clienteId: 1, clienteSlug: "rate-a", clienteContaId: 701, externalAccountId: "MLUA" };
    const contaB = { clienteId: 2, clienteSlug: "rate-b", clienteContaId: 702, externalAccountId: "MLUB" };
    const tabela = fakeUpsert();

    const depsOverride = {
      listarContasElegiveis: async () => [
        contaRow({ contaId: 701, clienteId: 1, slug: "rate-a" }),
        contaRow({ contaId: 702, clienteId: 2, slug: "rate-b" }),
      ],
      sincronizar: async () => ({ ok: true, codigo: "OK", totalEncontrados: 1, totalProcessados: 1, totalSalvos: 1 }),
      carregarWorkspace: async ({ clienteContaId }) => {
        chamadasMotor.push(clienteContaId);
        if (clienteContaId === 701) {
          throw Object.assign(new Error("Rate limit do Mercado Livre (429)."), {
            statusCode: 429, codigo: "MELI_RATE_LIMIT", retryAfter: 45,
          });
        }
        return { cliente: { id: 2 }, clienteContaId, totalItensMl: 1, itens: [itemFixture({ itemId: "MLB-702" })] };
      },
      persistirSnapshots: require("../jobs/margemProjetadaGlobal").persistirSnapshots,
      upsertSnapshot: tabela.upsertSnapshot,
      logger: logSilencioso,
    };

    const resumo = await svc.executarRodada({}, depsOverride);
    const resultadoA = resumo.resultados.find((r) => r.clienteContaId === 701);
    const resultadoB = resumo.resultados.find((r) => r.clienteContaId === 702);

    ok("429: conta A vira status 'falha'", resultadoA.status === "falha");
    ok("429: erro.code = MELI_RATE_LIMIT propagado até o resultado da conta", resultadoA.erro.code === "MELI_RATE_LIMIT");
    ok("429: erro.statusCode = 429 propagado (não 502 genérico)", resultadoA.erro.statusCode === 429);
    ok("429: erro.retryAfter propagado intacto (45)", resultadoA.erro.retryAfter === 45);
    ok("429: conta B ainda é executada (rodada não é abortada)", resultadoB.status === "sucesso");
    ok("429: resumo agregado conta a falha corretamente (falhas=1, sucessos=1)", resumo.falhas === 1 && resumo.sucessos === 1);
    ok("429: nenhum retry automático — carregarWorkspace chamado EXATAMENTE 1x por conta (701 e 702)",
      chamadasMotor.filter((c) => c === 701).length === 1 && chamadasMotor.filter((c) => c === 702).length === 1);
  }

  // ── 429 sem retryAfter → propagado como null, nunca inventado ────────────
  {
    const deps = {
      sincronizar: async () => ({ ok: true, codigo: "OK", totalEncontrados: 1, totalProcessados: 1, totalSalvos: 1 }),
      carregarWorkspace: async () => {
        throw Object.assign(new Error("Rate limit do Mercado Livre (429)."), {
          statusCode: 429, codigo: "MELI_RATE_LIMIT", retryAfter: null,
        });
      },
      origemJob: "teste",
      maxItens: 20000,
      agora: () => Date.now(),
      logger: logSilencioso,
    };
    const resultado = await svc.processarConta({ clienteId: 1, clienteSlug: "rate-c", clienteContaId: 703, externalAccountId: "MLUC" }, deps);
    ok("429 sem retryAfter: campo fica null (não omitido, não inventado)", resultado.erro.retryAfter === null);
    ok("429 sem retryAfter: statusCode/codigo continuam presentes", resultado.erro.statusCode === 429 && resultado.erro.code === "MELI_RATE_LIMIT");
  }

  // ── erro genérico (não-429) não ganha statusCode/retryAfter inventados ───
  {
    const deps = {
      sincronizar: async () => ({ ok: true, codigo: "OK", totalEncontrados: 1, totalProcessados: 1, totalSalvos: 1 }),
      carregarWorkspace: async () => { throw new Error("erro estrutural qualquer, sem statusCode"); },
      origemJob: "teste",
      maxItens: 20000,
      agora: () => Date.now(),
      logger: logSilencioso,
    };
    const resultado = await svc.processarConta({ clienteId: 1, clienteSlug: "generico", clienteContaId: 704, externalAccountId: "MLUD" }, deps);
    ok("erro sem statusCode não vira 429 por acidente — statusCode fica null", resultado.erro.statusCode === null);
    ok("erro sem statusCode não vira 429 por acidente — code não é MELI_RATE_LIMIT", resultado.erro.code !== "MELI_RATE_LIMIT");
  }

  // ── nenhum sleep/backoff/retry foi introduzido (checagem estática) ───────
  {
    const fonteService = fs.readFileSync(
      path.join(__dirname, "..", "services", "motorMargem", "margemProjetadaOrquestradorService.js"),
      "utf8"
    );
    const fonteAdapter = fs.readFileSync(
      path.join(__dirname, "..", "services", "motorMargem", "adapters", "meliApiEvidenceAdapter.js"),
      "utf8"
    );
    ok("orquestrador: nenhum setTimeout/sleep/backoff", !/setTimeout|sleep\(|backoff/i.test(fonteService));
    ok("adapter: nenhum setTimeout/sleep/backoff/retry automático", !/setTimeout|sleep\(|backoff|for\s*\(.*retry/i.test(fonteAdapter));
  }

  // ── 14: modo --plano não chama sync/Motor/persistência ───────────────────
  {
    const depsOverride = {
      listarContasElegiveis: async () => [contaRow({ contaId: 1, clienteId: 10, slug: "alfa" })],
      sincronizar: async () => { throw new Error("NÃO deveria ser chamado em modo plano"); },
      carregarWorkspace: async () => { throw new Error("NÃO deveria ser chamado em modo plano"); },
      persistirSnapshots: async () => { throw new Error("NÃO deveria ser chamado em modo plano"); },
      logger: logSilencioso,
    };
    const resumo = await svc.executarRodada({ plano: true }, depsOverride);
    ok("14: modo --plano não lança (sync/Motor/persist nunca chamados)", resumo.plano === true);
    ok("14: modo --plano lista as contas elegíveis do plano", resumo.contasElegiveisPlano.length === 1);
    ok("14: modo --plano não produz 'resultados' de processamento", resumo.resultados.length === 0);
  }

  // ── dm/jf_shopp/alianza_jeans-like: conta sem Base MELI fica ignorada ────
  {
    const rows = [
      contaRow({ contaId: 30, clienteId: 30, slug: "dm", baseVinculada: false }),
      contaRow({ contaId: 37, clienteId: 37, slug: "jf_shopp", baseVinculada: false }),
      contaRow({ contaId: 86, clienteId: 133, slug: "alianza_jeans", baseVinculada: false }),
    ];
    const r = svc.classificarContas(rows);
    ok("candidatos sem Base MELI (dm/jf_shopp/alianza_jeans) ficam TODOS ignorados",
      r.elegiveis.length === 0 && r.ignoradas.every((c) => c.motivo === "base_meli_nao_vinculada"));
  }

  // ── 15, 16: barreira de escopo da CLI ─────────────────────────────────────
  {
    let lancou = false;
    try { cli.validarEscopo({ plano: false, all: false, clientes: null }); } catch (e) { lancou = e.codigo === "ESCOPO_OBRIGATORIO"; }
    ok("15: validarEscopo lança ESCOPO_OBRIGATORIO sem filtro e sem --all", lancou);

    let naoLancouComAll = true;
    try { cli.validarEscopo({ plano: false, all: true, clientes: null }); } catch (e) { naoLancouComAll = false; }
    ok("16: --all explícito É aceito (não lança)", naoLancouComAll);

    let naoLancouComClientes = true;
    try { cli.validarEscopo({ plano: false, all: false, clientes: ["zenite_loja"] }); } catch (e) { naoLancouComClientes = false; }
    ok("--clientes explícito também é aceito (não lança)", naoLancouComClientes);

    let lancouAmbiguo = false;
    try { cli.validarEscopo({ plano: false, all: true, clientes: ["zenite_loja"] }); } catch (e) { lancouAmbiguo = e.codigo === "ESCOPO_AMBIGUO"; }
    ok("--all + --clientes juntos → ESCOPO_AMBIGUO", lancouAmbiguo);
  }

  // ── 17: nenhuma fórmula de margem/SQL de escrita nova é duplicada ────────
  {
    const fonteService = fs.readFileSync(
      path.join(__dirname, "..", "services", "motorMargem", "margemProjetadaOrquestradorService.js"),
      "utf8"
    );
    ok("17: orquestrador NÃO tem INSERT/UPDATE direto em anuncios_margem_projetada_snapshot",
      !/INSERT\s+INTO\s+anuncios_margem_projetada_snapshot/i.test(fonteService));
    ok("17: orquestrador reaproveita persistirSnapshots do job manual (require direto)",
      /require\(["']\.\.\/\.\.\/jobs\/margemProjetadaGlobal["']\)/.test(fonteService));
    ok("17: orquestrador reaproveita motorMargemService (nenhum cálculo de margem próprio)",
      /require\(["']\.\/motorMargemService["']\)/.test(fonteService));
    ok("17: orquestrador não faz require de clienteContaService/contextoPrecificacaoService (nenhuma segunda resolução de conta)",
      !/require\([^)]*(clienteContaService|contextoPrecificacaoService|resolveMarketplaceAccountContext)[^)]*\)/i.test(fonteService));
  }

  console.log(`\nmargemProjetadaOrquestrador.test.js: ${checks} verificações passaram.`);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
