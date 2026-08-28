// server/tests/conciliacaoMpIsolamentoConta.test.js
//
// V3 P2.6 BLOCO H / P2.7 — isolamento por ClienteConta na conciliação Mercado Pago.
//
// O ACHADO da auditoria: as três tabelas de MP lidas pela conciliação
// (`central_vendas_mp_payments`, `..._settlement_movements`,
// `..._settlement_reports`) TÊM coluna `cliente_conta_id`, e ela é indexada —
// mas o WHERE filtrava SÓ por `sync_run_id`. Ou seja: o isolamento entre duas
// contas MELI do mesmo cliente era 100% transitivo, dependendo inteiramente de
// o array de sync_run_ids vir correto do snapshot. Qualquer erro upstream
// virava mistura de contas sem nenhuma detecção — defesa em profundidade que
// existia no schema e não estava ligada.
//
// Estes testes provam que a conta RESOLVIDA chega às três queries e que a
// linha de outra conta não entra. Linha legada (`cliente_conta_id` NULL)
// continua entrando de propósito: não dá para atribuí-la a uma conta e
// excluí-la derrubaria dado histórico.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const pagamentos = require("../services/centralVendas/centralVendasMpPaymentsRepository");
const settlement = require("../services/centralVendas/centralVendasMpSettlementRepository");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

// Banco falso que aplica de verdade o WHERE que a query montar. Assim o teste
// falha se o filtro de conta sumir do SQL — não basta o parâmetro ser passado.
function fakeDb(linhasPorTabela) {
  const capturas = [];
  return {
    capturas,
    async query(sql, params) {
      const q = String(sql).replace(/\s+/g, " ");
      capturas.push({ q, params });

      const tabela = q.includes("central_vendas_mp_payments") ? "payments"
        : q.includes("central_vendas_mp_settlement_movements") ? "movements"
        : q.includes("central_vendas_mp_settlement_reports") ? "reports"
        : null;
      if (!tabela) throw new Error(`Query inesperada: ${q.slice(0, 100)}`);

      const runIds = params[0] || [];
      // Detecta se a query trouxe o filtro de conta e, se sim, aplica.
      const temFiltroConta = /cliente_conta_id IS NULL OR .*cliente_conta_id = \$\d+/.test(q);
      const contaId = temFiltroConta ? params[1] : null;

      const linhas = (linhasPorTabela[tabela] || [])
        .filter((r) => runIds.includes(r.sync_run_id))
        .filter((r) => (temFiltroConta ? (r.cliente_conta_id == null || r.cliente_conta_id === contaId) : true))
        .map((r) => ({ ...r, charges_total: 0 }));
      return { rows: linhas };
    },
  };
}

// Um MESMO sync_run_id com linhas de duas contas — o pior cenário, e o que o
// filtro por run sozinho não consegue separar.
const LINHAS = {
  payments: [
    { id: 1, sync_run_id: 77, cliente_conta_id: 10, payment_id: "p-conta-10" },
    { id: 2, sync_run_id: 77, cliente_conta_id: 11, payment_id: "p-conta-11" },
    { id: 3, sync_run_id: 77, cliente_conta_id: null, payment_id: "p-legado" },
  ],
  movements: [
    { id: 1, sync_run_id: 77, cliente_conta_id: 10, row_number: 1 },
    { id: 2, sync_run_id: 77, cliente_conta_id: 11, row_number: 2 },
    { id: 3, sync_run_id: 77, cliente_conta_id: null, row_number: 3 },
  ],
  reports: [
    { id: 1, sync_run_id: 77, cliente_conta_id: 10, status: "imported" },
    { id: 2, sync_run_id: 77, cliente_conta_id: 11, status: "imported" },
  ],
};

async function run() {
  // ------------------------------------------------------------- payments
  {
    const db = fakeDb(LINHAS);
    const rows = await pagamentos.listMpPaymentsWithChargesTotalByRunIds([77], db, { clienteContaId: 10 });
    const ids = rows.map((r) => r.paymentId ?? r.payment_id);
    ok("payments: linha da conta 11 NAO entra no resultado da conta 10", !ids.includes("p-conta-11"));
    ok("payments: linha da propria conta entra", ids.includes("p-conta-10"));
    ok("payments: linha legada (conta NULL) continua entrando", ids.includes("p-legado"));
    ok("payments: o filtro de conta esta mesmo no SQL", /cliente_conta_id/.test(db.capturas[0].q));
  }
  {
    // Sem conta conhecida o comportamento e o de antes (compatibilidade).
    const db = fakeDb(LINHAS);
    const rows = await pagamentos.listMpPaymentsWithChargesTotalByRunIds([77], db, { clienteContaId: null });
    ok("payments: sem conta resolvida o SQL nao ganha filtro (compatibilidade)", rows.length === 3 && !/cliente_conta_id/.test(db.capturas[0].q));
  }
  {
    const db = fakeDb(LINHAS);
    const rows = await pagamentos.listMpPaymentsWithChargesTotalByRunIds([77], db);
    ok("payments: chamada antiga de 2 argumentos segue funcionando", rows.length === 3);
  }

  // ------------------------------------------------------------ movements
  {
    const db = fakeDb(LINHAS);
    const rows = await settlement.listSettlementMovementsByRunIds([77], db, { clienteContaId: 10 });
    ok("movements: so a propria conta + legado", rows.length === 2);
    ok("movements: o filtro de conta esta no SQL", /cliente_conta_id/.test(db.capturas[0].q));
    ok("movements: ORDER BY determinístico preservado", /ORDER BY sync_run_id ASC, row_number ASC/.test(db.capturas[0].q));
  }

  // -------------------------------------------------------------- reports
  {
    const db = fakeDb(LINHAS);
    const rows = await settlement.listSettlementReportsByRunIds([77], db, { clienteContaId: 11 });
    ok("reports: so o report da conta pedida", rows.length === 1);
    ok("reports: o filtro de conta esta no SQL", /cliente_conta_id/.test(db.capturas[0].q));
  }

  // ------------------------------------------------- array vazio nao consulta
  {
    const db = fakeDb(LINHAS);
    const rows = await pagamentos.listMpPaymentsWithChargesTotalByRunIds([], db, { clienteContaId: 10 });
    ok("sem sync_run_id nenhum, nao ha query nem resultado", rows.length === 0 && db.capturas.length === 0);
  }

  // ------------------------------- conta invalida nao vira filtro silencioso
  {
    const db = fakeDb(LINHAS);
    await pagamentos.listMpPaymentsWithChargesTotalByRunIds([77], db, { clienteContaId: 0 });
    ok("clienteContaId=0 e tratado como ausente, nunca como conta 0", !/cliente_conta_id/.test(db.capturas[0].q));
  }

  console.log(`\nconciliacaoMpIsolamentoConta.test.js: ${checks} verificacoes passaram.`);
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
