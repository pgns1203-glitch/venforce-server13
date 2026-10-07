// server/tests/painelContasModoManual.test.js
//
// MODO MANUAL do Painel de Contas (padrão: PAINEL_CONTAS_AUTO_UPDATE_ENABLED
// ausente). Sem Postgres: o banco em memória de
// helpers/painelContasModeloMemoria guarda o que foi gravado entre chamadas,
// como a tabela painel_contas_lancamentos_manuais guardaria.
//
//   1  lançamento manual ML salva (mesmo com import publicado)
//   2  lançamento manual Shopee salva
//   3  GET posterior devolve o mesmo valor
//   4  "reload" (service recarregado do zero) / outro login → mesmo valor
//   5  rotina automática (import novo + snapshot novo) NÃO sobrescreve o manual
//   6  competências diferentes não se misturam
//   7  conta A não mistura com conta B
//   8  cliente A não mistura com cliente B
//   9  consolidado usa o manual (FAT, LC, Ads) — multi-conta
//  10  automação OFF: "Atualizar dados" recusa ANTES de qualquer query/sync
//  11  outras leituras do Painel e o scheduler da Central seguem funcionando
//  12  Central de Vendas não lê a flag nem o modo do Painel; ninguém fora do
//      repositório do Painel escreve na tabela manual
//   R  reativação: com a flag "true" volta o contrato antigo

process.env.DATABASE_URL = "postgres://nobody@127.0.0.1:1/teste-sem-banco";
process.env.SQUADS_ENFORCEMENT = "on";
delete process.env.PAINEL_CONTAS_AUTO_UPDATE_ENABLED;

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { importRow, novoModelo, instalarMock } = require("./helpers/painelContasModeloMemoria");

let checks = 0;
let concluido = false;
process.on("exit", () => {
  if (!concluido) {
    console.error(`painelContasModoManual.test.js: NÃO concluiu (parou após ${checks} verificações)`);
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
async function rejeita(label, promise, statusCode, code) {
  let erro = null;
  try { await promise; } catch (e) { erro = e; }
  ok(`${label} — recebido ${erro?.statusCode} ${erro?.code}`, erro && erro.statusCode === statusCode && (!code || erro.code === code));
}

const PAINEL_DIR = path.join(__dirname, "..", "services", "painelContas");
function carregarService() {
  // "Reload": nenhum estado em memória do processo sobrevive — só o banco.
  for (const k of Object.keys(require.cache)) {
    if (k.startsWith(PAINEL_DIR)) delete require.cache[k];
  }
  return require("../services/painelContas/painelContasService");
}

const U = {
  ana: { id: 100, role: "membro", nome: "Ana" }, // coordena o Squad 6 (AMR, Red Fish, Coremix, Carpei)
  beto: { id: 200, role: "membro", nome: "Beto" }, // coordena o Squad 2 (Fora da Carteira)
  admin: { id: 1, role: "admin", nome: "Admin" },
};
const SET = "2026-09";
const AGO = "2026-08";
const agora = { agora: new Date("2026-09-30T15:00:00-03:00") };

const doCliente = (lista, slug) => lista.clientes.find((c) => c.slug === slug);
const daConta = (cliente, id) => cliente.contas.find((c) => c.id === id);

async function run() {
  const m = novoModelo();
  const { restaurar } = instalarMock(m);
  try {
    let service = carregarService();

    // ── modo declarado ──────────────────────────────────────────────────────
    const inicial = await service.listar(U.ana, { competencia: SET }, agora);
    eq("modo: padrão sem a flag é MANUAL", [inicial.modo.codigo, inicial.modo.manualPrevalece, inicial.modo.atualizacaoAutomatica], ["manual", true, false]);
    const amr0 = doCliente(inicial, "amr-ecommerce");
    eq("modo: conta ML com import pode receber lançamento manual", daConta(amr0, 11).podeLancarManual, true);
    eq("modo: sem manual, a conta ML segue mostrando a API", [daConta(amr0, 11).fonte.tipo, daConta(amr0, 11).resumo.fat], ["api", 2833602]);

    // ── 1. ML salva mesmo com import publicado ──────────────────────────────
    const salvoMl = await service.salvarLancamentoManual(U.ana, "1", "11", SET,
      { faturamento: 3000000, lucroContribuicao: 450000, investimentoAds: 50000, gmvAds: 400000, observacao: "planilha do gestor" }, agora);
    eq("1: ML salvo com fonte MANUAL", [salvoMl.ok, salvoMl.conta.fonte.tipo, salvoMl.conta.resumo.fat], [true, "manual", 3000000]);
    ok("1: gravado no banco (1 linha conta 11 × set)", m.manuais.filter((x) => x.cliente_conta_id === 11 && x.competencia === SET).length === 1);
    eq("1: trilha de auditoria registrou a criação", m.historico.at(-1).acao, "criado");

    // ── 2. Shopee salva ─────────────────────────────────────────────────────
    const salvoShopee = await service.salvarLancamentoManual(U.ana, "3", "31", SET, { faturamento: 52000, margemContribuicao: 0.2 }, agora);
    eq("2: Shopee salvo, LC derivado de FAT × MC", [salvoShopee.conta.fonte.tipo, salvoShopee.conta.resumo.fat, salvoShopee.conta.resumo.lc], ["manual", 52000, 10400]);

    // ── 3. GET posterior ────────────────────────────────────────────────────
    const depois = await service.listar(U.ana, { competencia: SET }, agora);
    const amr = doCliente(depois, "amr-ecommerce");
    const conta11 = daConta(amr, 11);
    eq("3: GET devolve o manual da conta ML", [conta11.fonte.tipo, conta11.status.codigo, conta11.resumo.fat, conta11.resumo.lc], ["manual", "manual", 3000000, 450000]);
    eq("3: GET devolve o manual da Shopee", [doCliente(depois, "coremix").resumo.fat, doCliente(depois, "coremix").fonte.tipo], [52000, "manual"]);
    eq("3: API continua visível só como referência", [conta11.referenciaApi.fat, conta11.referenciaApi.importId], [2833602, 1101]);
    ok("3: aviso explica que o manual prevalece", conta11.avisos.some((a) => /manual prevalece/.test(a)));
    const lancados = await service.listarLancamentosDaConta(U.ana, "1", "11");
    eq("3: rastreabilidade lista a competência com o mesmo valor", lancados.lancamentos.map((l) => [l.competencia, l.valores.fat]), [[SET, 3000000]]);

    // ── 4. reload / logout-login ────────────────────────────────────────────
    service = carregarService();
    const aposReload = await service.listar(U.ana, { competencia: SET }, agora);
    eq("4: depois do reload, o mesmo valor", daConta(doCliente(aposReload, "amr-ecommerce"), 11).resumo.fat, 3000000);
    const outroLogin = await service.listar(U.admin, { competencia: SET }, agora);
    eq("4: outro login (admin) vê o mesmo valor", daConta(doCliente(outroLogin, "amr-ecommerce"), 11).resumo.fat, 3000000);
    eq("4: quem lançou continua registrado", daConta(doCliente(outroLogin, "amr-ecommerce"), 11).manual.atualizadoPor, "Ana");

    // ── 5. rotina automática não sobrescreve ────────────────────────────────
    // Simula o noturno/Atualizar dados: import NOVO publicado da conta 11 e
    // snapshot do cliente gerado exatamente com os imports vigentes.
    const manualAntes = JSON.stringify(m.manuais);
    m.imports = m.imports.filter((i) => i.id !== 1101);
    m.imports.push(importRow(1102, 11, SET, { fat: 2900000, lc: 430000, ate: `${SET}-29`, publicado: `${SET}-30T06:00:00.000Z` }));
    m.resumos.push({
      cliente_id: 1, competencia: SET, faturamento: 4120512, mc_media: 0.15, ads_investido: 120000,
      sincronizado_em: `${SET}-30T06:05:00.000Z`,
      payload_json: { centralVendas: { lucroContribuicao: 613000, contas: [{ importId: 1102 }, { importId: 1201 }, { importId: 1301 }] } },
    });
    const aposSync = await service.listar(U.ana, { competencia: SET }, agora);
    const amrSync = doCliente(aposSync, "amr-ecommerce");
    eq("5: depois do sync a conta 11 continua MANUAL", [daConta(amrSync, 11).fonte.tipo, daConta(amrSync, 11).resumo.fat], ["manual", 3000000]);
    eq("5: a referência da API acompanha o import novo", daConta(amrSync, 11).referenciaApi.fat, 2900000);
    ok("5: snapshot automático NÃO substitui o consolidado com manual", amrSync.origem === "contas" && amrSync.resumo.fat !== 4120512);
    eq("5: a tabela manual não foi tocada pelo sync", JSON.stringify(m.manuais), manualAntes);

    // ── 6. competências independentes ───────────────────────────────────────
    await service.salvarLancamentoManual(U.ana, "1", "11", AGO, { faturamento: 1111 }, agora);
    const set6 = await service.listar(U.ana, { competencia: SET }, agora);
    const ago6 = await service.listar(U.ana, { competencia: AGO }, agora);
    eq("6: setembro mantém o seu valor", daConta(doCliente(set6, "amr-ecommerce"), 11).resumo.fat, 3000000);
    eq("6: agosto mostra o seu valor", daConta(doCliente(ago6, "amr-ecommerce"), 11).resumo.fat, 1111);
    eq("6: duas linhas, uma por competência", m.manuais.filter((x) => x.cliente_conta_id === 11).map((x) => x.competencia).sort(), [AGO, SET]);

    // ── 7. conta A × conta B (multi-conta) ──────────────────────────────────
    const amr7 = doCliente(set6, "amr-ecommerce");
    eq("7: conta 12 do mesmo cliente segue com a própria API", [daConta(amr7, 12).fonte.tipo, daConta(amr7, 12).resumo.fat], ["api", 800000]);
    eq("7: conta 13 idem", [daConta(amr7, 13).fonte.tipo, daConta(amr7, 13).resumo.fat], ["api", 420512]);
    await service.salvarLancamentoManual(U.ana, "1", "12", SET, { faturamento: 700000, lucroContribuicao: 70000 }, agora);
    const set7 = await service.listar(U.ana, { competencia: SET }, agora);
    eq("7: lançar na conta 12 não altera a 11", [daConta(doCliente(set7, "amr-ecommerce"), 11).resumo.fat, daConta(doCliente(set7, "amr-ecommerce"), 12).resumo.fat], [3000000, 700000]);

    // ── 8. cliente A × cliente B ────────────────────────────────────────────
    await rejeita("8: conta de outro cliente no path → 404", service.salvarLancamentoManual(U.ana, "2", "11", SET, { faturamento: 1 }, agora), 404, "CONTA_NAO_ENCONTRADA");
    await rejeita("8: cliente fora da carteira → recusado", service.salvarLancamentoManual(U.ana, "6", "61", SET, { faturamento: 1 }, agora), 403);
    eq("8: Red Fish (outro cliente) sem dado nenhum", doCliente(set7, "red-fish").resumo, null);
    eq("8: nenhuma linha manual em contas de outro cliente", m.manuais.filter((x) => ![11, 12, 31].includes(x.cliente_conta_id)).length, 0);
    const beto = await service.listar(U.beto, { competencia: SET }, agora);
    eq("8: Beto não vê o cliente da Ana", beto.clientes.map((c) => c.slug), ["fora-da-carteira"]);

    // ── 9. consolidado usa o manual ─────────────────────────────────────────
    const amr9 = doCliente(set7, "amr-ecommerce");
    eq("9: FAT consolidado = manual 11 + manual 12 + API 13", amr9.resumo.fat, 3000000 + 700000 + 420512);
    eq("9: fonte do consolidado = API + manual", amr9.fonte.tipo, "misto");
    eq("9: LC consolidado soma os manuais e a API", amr9.resumo.lc, 450000 + 70000 + 63000);
    eq("9: Ads lançado à mão vence o Ads automático do cliente", amr9.resumo.ads, 50000);
    eq("9: resumo da carteira conta o cliente como manual", set7.resumoCarteira.manuais >= 2, true);

    // ── 10. automação OFF: nenhuma escrita automática do Painel ─────────────
    eq("10: admin não recebe o botão Atualizar dados", outroLogin.permissoes.atualizarDados, false);
    ok("10: nenhum job de atualização exposto na lista", outroLogin.clientes.every((c) => c.atualizacao === null));
    const atualizacao = require("../services/painelContas/painelContasAtualizacao");
    const chamadas = [];
    const espiao = (nome) => async () => { chamadas.push(nome); throw new Error(`${nome} não deveria ser chamado`); };
    await rejeita("10: POST Atualizar dados → 409 PAINEL_MODO_MANUAL",
      atualizacao.iniciarAtualizacao(U.admin, "1", SET, {
        assertClienteNaCarteira: espiao("carteira"), listarContas: espiao("listarContas"),
        executarRodada: espiao("executarRodada"), criarSyncRun: espiao("criarSyncRun"),
        adquirirLock: espiao("lock"), criarConexaoLock: espiao("conexaoLock"),
      }), 409, "PAINEL_MODO_MANUAL");
    eq("10: nada foi consultado, travado ou sincronizado", chamadas, []);

    // ── 11. outras leituras e o scheduler da Central ────────────────────────
    const meses = await service.listarMeses(U.ana, "1", { ano: 2026 });
    ok("11: histórico mensal do cliente (snapshot) continua respondendo", meses.ok === true && meses.meses.some((x) => x.competencia === SET));
    const historico = await service.listarHistoricoLancamento(U.ana, "1", "11", SET);
    ok("11: histórico do lançamento continua respondendo", historico.historico.length >= 1);
    const scheduler = require("../services/centralVendas/centralVendasNoturnoScheduler");
    eq("11: scheduler da Central ignora a flag do Painel (ligado)", scheduler.habilitado({ CENTRAL_VENDAS_NOTURNO_ENABLED: "true" }), true);
    eq("11: scheduler da Central ignora a flag do Painel (desligado)", scheduler.habilitado({ PAINEL_CONTAS_AUTO_UPDATE_ENABLED: "true" }), false);

    // ── 12. Central de Vendas intocada / escrita manual só no Painel ────────
    const raiz = path.join(__dirname, "..");
    const arquivos = [];
    (function varrer(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name === "tests" || e.name.startsWith(".")) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) varrer(p);
        else if (e.name.endsWith(".js")) arquivos.push(p);
      }
    })(raiz);
    const foraDoPainel = arquivos.filter((p) => !p.startsWith(PAINEL_DIR));
    const leemModo = foraDoPainel.filter((p) => /PAINEL_CONTAS_AUTO_UPDATE_ENABLED|painelContasModo/.test(fs.readFileSync(p, "utf8")));
    eq("12: nenhum arquivo fora do Painel lê a flag/modo (Central, scheduler, Margem)", leemModo, []);
    const escrevemManual = arquivos.filter((p) => /(INSERT INTO|UPDATE|DELETE FROM)\s+painel_contas_lancamentos_manuais\b/.test(fs.readFileSync(p, "utf8")));
    eq("12: só o repositório do Painel escreve na tabela manual", escrevemManual.map((p) => path.relative(raiz, p)), ["services/painelContas/painelContasRepository.js"]);

    // ── R. reativação ───────────────────────────────────────────────────────
    process.env.PAINEL_CONTAS_AUTO_UPDATE_ENABLED = "true";
    const auto = await service.listar(U.admin, { competencia: SET }, agora);
    const amrAuto = doCliente(auto, "amr-ecommerce");
    eq("R: flag true → modo automático", auto.modo.codigo, "automatico");
    eq("R: import volta a prevalecer; manual guardado", [daConta(amrAuto, 11).fonte.tipo, daConta(amrAuto, 11).manual.substituidoPorAutomatico], ["api", true]);
    eq("R: admin volta a ver Atualizar dados", auto.permissoes.atualizarDados, true);
    await rejeita("R: manual sobre automático volta a ser recusado", service.salvarLancamentoManual(U.ana, "1", "11", SET, { faturamento: 1 }, agora), 409, "AUTOMATICO_DISPONIVEL");
    eq("R: o valor manual não foi perdido ao alternar o modo", m.manuais.find((x) => x.cliente_conta_id === 11 && x.competencia === SET).faturamento, 3000000);
    delete process.env.PAINEL_CONTAS_AUTO_UPDATE_ENABLED;
    const deVolta = await service.listar(U.ana, { competencia: SET }, agora);
    eq("R: desligando de novo, o manual reaparece igual", daConta(doCliente(deVolta, "amr-ecommerce"), 11).resumo.fat, 3000000);

    concluido = true;
    console.log(`painelContasModoManual.test.js: ${checks} verificações OK`);
  } finally {
    restaurar();
  }
}

run().catch((err) => { console.error(err); process.exit(1); });
