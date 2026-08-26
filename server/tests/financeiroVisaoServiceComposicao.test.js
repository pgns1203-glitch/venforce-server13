// server/tests/financeiroVisaoServiceComposicao.test.js
//
// GET /financeiro/:cliente?conta=&periodo=YYYY-MM (VenForce V3 Master Spec
// §12.4, §18.4) — composição de leitura, não o fluxo de upload/processamento
// (fechamentosFinanceiroController.js, intocado). Mesmo padrão de injeção
// de dependência de visaoServiceComposicao.test.js.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const { obterFinanceiro, extrairComposicaoDoFechamento } = require("../services/financeiroVisaoService");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}
async function rejeitaCom(label, promise, verificar) {
  let erro = null;
  try {
    await promise;
  } catch (e) {
    erro = e;
  }
  assert.ok(erro, `FALHOU (não rejeitou): ${label}`);
  if (verificar) assert.ok(verificar(erro), `FALHOU (erro inesperado): ${label} — ${erro.message}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

const cliente = { id: 1, nome: "N97 Comercial", slug: "n97", ativo: true };
const contaMeli = { id: 10, cliente_id: 1, marketplace: "meli", nome: "ML 1", ativo: true };
const contaShopee = { id: 11, cliente_id: 1, marketplace: "shopee", nome: "Shopee", ativo: true };
const contaInativa = { id: 12, cliente_id: 1, marketplace: "meli", nome: "ML velha", ativo: false };

function depsBase(overrides = {}) {
  return {
    resolverClientePorIdOuSlug: async () => cliente,
    obterConta: async (id) => {
      const todas = [contaMeli, contaShopee, contaInativa];
      const c = todas.find((x) => x.id === Number(id));
      if (!c) { const e = new Error("Conta não encontrada."); e.statusCode = 404; throw e; }
      return c;
    },
    sanitizarConta: (row) => row,
    listarEntregas: async () => ({ ok: true, entregas: [] }),
    getMercadoPagoReconciliationForRange: async () => ({ ok: true, summary: { conciliados: 3180, total: 3201 } }),
    ...overrides,
  };
}

async function run() {
  // 1. Sem fechamento no período: resultado.disponivel=false com motivo
  //    honesto, nunca fabrica um resultado zerado.
  {
    const resultado = await obterFinanceiro({ clienteSlugRaw: "n97", clienteContaIdRaw: "10", periodoRaw: "2026-08" }, depsBase());
    ok("sem fechamento no período: resultado indisponível com motivo, não zero fabricado", resultado.resultado.disponivel === false && /Nenhum fechamento/.test(resultado.resultado.motivo));
    ok("relatorios (histórico) continua disponível mesmo sem fechamento do período pedido", resultado.relatorios.disponivel === true);
  }

  // 2. Com fechamento do período: composição extraída do payload_json real,
  //    disponivel por item nunca fabricado.
  {
    const deps = depsBase({
      listarEntregas: async () => ({
        ok: true,
        entregas: [
          {
            id: 5, periodo: "2026-08", status: "publicado", created_at: "2026-09-01", published_at: "2026-09-01", publicado: true, token_publico: "abc123",
            payload_json: { cards: [{ chave: "faturamento_bruto", label: "Faturamento bruto", valor: 412880 }, { chave: "frete", label: "Frete", valor: null }] },
          },
        ],
      }),
    });
    const resultado = await obterFinanceiro({ clienteSlugRaw: "n97", clienteContaIdRaw: "10", periodoRaw: "2026-08" }, deps);
    ok("resultado disponível com o fechamento certo do período", resultado.resultado.disponivel === true && resultado.resultado.dados.status === "publicado");
    const comp = resultado.resultado.dados.composicao;
    ok("composicao[].disponivel=true quando o valor existe", comp.find((c) => c.chave === "faturamento_bruto").disponivel === true);
    ok("composicao[].disponivel=false quando o valor é null — nunca vira 0 (M6)", comp.find((c) => c.chave === "frete").disponivel === false && comp.find((c) => c.chave === "frete").valor === null);
  }

  // 3. Conciliação MP: só MELI.
  {
    const deps = depsBase({ getMercadoPagoReconciliationForRange: async () => { throw new Error("não deveria ser chamado para Shopee"); } });
    const resultado = await obterFinanceiro({ clienteSlugRaw: "n97", clienteContaIdRaw: "11", periodoRaw: "2026-08" }, deps);
    ok("conciliação MP indisponível para Shopee, com motivo explícito", resultado.conciliacao.disponivel === false && /Mercado Livre/.test(resultado.conciliacao.motivo));
  }
  {
    const resultado = await obterFinanceiro({ clienteSlugRaw: "n97", clienteContaIdRaw: "10", periodoRaw: "2026-08" }, depsBase());
    ok("conciliação MP disponível e account-aware para MELI", resultado.conciliacao.disponivel === true && resultado.conciliacao.escopoConta === true);
  }

  // 4. Conta inativa → 409, nada é composto.
  await rejeitaCom(
    "conta inativa → 409 CONTA_INATIVA",
    obterFinanceiro({ clienteSlugRaw: "n97", clienteContaIdRaw: "12", periodoRaw: "2026-08" }, depsBase()),
    (err) => err.statusCode === 409 && err.code === "CONTA_INATIVA"
  );

  // 5. periodo em formato inválido → 400.
  await rejeitaCom(
    "periodo inválido → 400",
    obterFinanceiro({ clienteSlugRaw: "n97", clienteContaIdRaw: "10", periodoRaw: "agosto-2026" }, depsBase()),
    (err) => err.statusCode === 400
  );

  // 6. extrairComposicaoDoFechamento isolado: entrega null → status "nao_gerado", nunca lança.
  ok("extrairComposicaoDoFechamento(null) → nao_gerado, sem lançar", extrairComposicaoDoFechamento(null).status === "nao_gerado");

  console.log(`\nfinanceiroVisaoServiceComposicao.test.js: ${checks} verificações passaram.`);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
