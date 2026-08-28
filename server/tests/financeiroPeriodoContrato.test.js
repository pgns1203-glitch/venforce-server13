// server/tests/financeiroPeriodoContrato.test.js
//
// V3 P2.6 — BLOCO C (período explícito), BLOCO E (Julho não pode ser lido
// como Agosto / fechamento duplicado), BLOCO G (relatorios[].periodo
// normalizado) e BLOCO S (sem fan-out duplicado).
//
// Regressões que este arquivo trava:
//   1. String(e.periodo).includes(competencia) fazia uma entrega de intervalo
//      ("2026-07 a 2026-08") responder por DUAS competências.
//   2. relatorios[].periodo era devolvido cru: podia ser null, ISO date,
//      "Maio 2026" ou texto livre — o frontend não tinha como comparar.
//   3. listarEntregas era chamado DUAS vezes com argumentos idênticos.
//   4. Fechamento duplicado na mesma competência era escolhido em silêncio,
//      sem ordem determinística (a tabela não tem UNIQUE).

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const { obterFinanceiro, selecionarFechamentoDoPeriodo, montarHistorico } = require("../services/financeiroVisaoService");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}
async function rejeitaCom(label, promise, verificar) {
  let erro = null;
  try { await promise; } catch (e) { erro = e; }
  assert.ok(erro, `FALHOU (nao rejeitou): ${label}`);
  if (verificar) assert.ok(verificar(erro), `FALHOU (erro inesperado): ${label} — ${erro.message} / code=${erro.code}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

const cliente = { id: 1, nome: "N97 Comercial", slug: "n97", ativo: true };
const contaMeli = { id: 10, cliente_id: 1, marketplace: "meli", nome: "ML 1", ativo: true };

function depsBase(overrides = {}) {
  return {
    resolverClientePorIdOuSlug: async () => cliente,
    obterConta: async () => contaMeli,
    sanitizarConta: (row) => row,
    listarEntregas: async () => ({ ok: true, entregas: [] }),
    getMercadoPagoReconciliationForRange: async () => ({ ok: true, summary: {} }),
    ...overrides,
  };
}

async function run() {
  // ------------------------------------------------------------- BLOCO E
  // Uma entrega cujo período textual CONTÉM a competência não é a entrega
  // daquela competência.
  {
    const deps = depsBase({
      listarEntregas: async () => ({ ok: true, entregas: [
        { id: 1, periodo: "2026-07 a 2026-08", status: "publicado", payload_json: { cards: [] } },
      ] }),
    });
    const julho = await obterFinanceiro({ clienteSlugRaw: "n97", clienteContaIdRaw: "10", periodoRaw: "2026-07" }, deps);
    ok("intervalo '2026-07 a 2026-08' NAO responde por Julho (fim do substring)", julho.resultado.disponivel === false);
    const agosto = await obterFinanceiro({ clienteSlugRaw: "n97", clienteContaIdRaw: "10", periodoRaw: "2026-08" }, deps);
    ok("intervalo '2026-07 a 2026-08' NAO responde por Agosto (fim do substring)", agosto.resultado.disponivel === false);
  }

  // Julho e Agosto sao entregas DIFERENTES e cada uma responde so pela sua.
  {
    const deps = depsBase({
      listarEntregas: async () => ({ ok: true, entregas: [
        { id: 7, periodo: "2026-07", status: "publicado", payload_json: { cards: [{ chave: "x", valor: 7 }] } },
        { id: 8, periodo: "2026-08", status: "rascunho", payload_json: { cards: [{ chave: "x", valor: 8 }] } },
      ] }),
    });
    const julho = await obterFinanceiro({ clienteSlugRaw: "n97", clienteContaIdRaw: "10", periodoRaw: "2026-07" }, deps);
    ok("Julho traz o fechamento de Julho", julho.resultado.dados.composicao[0].valor === 7);
    const agosto = await obterFinanceiro({ clienteSlugRaw: "n97", clienteContaIdRaw: "10", periodoRaw: "2026-08" }, deps);
    ok("Agosto traz o fechamento de Agosto", agosto.resultado.dados.composicao[0].valor === 8);
  }

  // Entrega gravada em formato legado ainda casa com a competencia do mes.
  {
    const deps = depsBase({
      listarEntregas: async () => ({ ok: true, entregas: [
        { id: 9, periodo: "2026-08-01", status: "publicado", payload_json: { cards: [] } },
      ] }),
    });
    const r = await obterFinanceiro({ clienteSlugRaw: "n97", clienteContaIdRaw: "10", periodoRaw: "2026-08" }, deps);
    ok("entrega gravada como data ISO casa com a competencia do mes", r.resultado.disponivel === true);
  }
  {
    const deps = depsBase({
      listarEntregas: async () => ({ ok: true, entregas: [
        { id: 9, periodo: "Agosto 2026", status: "publicado", payload_json: { cards: [] } },
      ] }),
    });
    const r = await obterFinanceiro({ clienteSlugRaw: "n97", clienteContaIdRaw: "10", periodoRaw: "2026-08" }, deps);
    ok("entrega gravada como 'Agosto 2026' (formato REAL do Portal) casa", r.resultado.disponivel === true);
    const julho = await obterFinanceiro({ clienteSlugRaw: "n97", clienteContaIdRaw: "10", periodoRaw: "2026-07" }, deps);
    ok("...e NAO casa com Julho", julho.resultado.disponivel === false);
  }

  // ------------------------------------------------------------- BLOCO G
  {
    const deps = depsBase({
      listarEntregas: async () => ({ ok: true, entregas: [
        { id: 1, periodo: "2026-08", status: "publicado", created_at: "2026-09-01", publicado: true, token_publico: "t1" },
        { id: 2, periodo: "2026-07-31", status: "publicado", created_at: "2026-08-01", publicado: false },
        { id: 3, periodo: "06/2026", status: "publicado", created_at: "2026-07-01", publicado: false },
        { id: 4, periodo: null, status: "rascunho", created_at: "2026-06-01", publicado: false },
        { id: 5, periodo: "fechamento de maio", status: "rascunho", created_at: "2026-05-01", publicado: false },
        { id: 6, periodo: "Maio 2026", status: "rascunho", created_at: "2026-05-02", publicado: false },
      ] }),
    });
    const r = await obterFinanceiro({ clienteSlugRaw: "n97", clienteContaIdRaw: "10", periodoRaw: "2026-08" }, deps);
    const rel = r.relatorios.dados;
    ok("relatorios[0].periodo ja canonico permanece YYYY-MM", rel[0].periodo === "2026-08");
    ok("relatorios[1].periodo ISO e normalizado para YYYY-MM", rel[1].periodo === "2026-07");
    ok("relatorios[2].periodo MM/YYYY e normalizado para YYYY-MM", rel[2].periodo === "2026-06");
    ok("relatorios[3].periodo null continua null — nunca fabricado", rel[3].periodo === null);
    ok("relatorios[4].periodo em texto livre vira null — nunca fabricado", rel[4].periodo === null);
    ok("relatorios[5].periodo 'Maio 2026' (formato real) vira 2026-05", rel[5].periodo === "2026-05");
    ok("periodoBruto preserva o valor original para diagnostico", rel[4].periodoBruto === "fechamento de maio");
    ok("todo relatorio tem a chave periodo (contrato estavel)", rel.every((x) => "periodo" in x));
    ok("token so aparece quando publicado", rel[0].token === "t1" && rel[1].token === null);
  }

  // ------------------------------------------------------------- BLOCO S
  {
    let chamadas = 0;
    const deps = depsBase({
      listarEntregas: async () => { chamadas += 1; return { ok: true, entregas: [] }; },
    });
    await obterFinanceiro({ clienteSlugRaw: "n97", clienteContaIdRaw: "10", periodoRaw: "2026-08" }, deps);
    ok("listarEntregas e chamado UMA vez (era 2x com args identicos)", chamadas === 1);
  }

  // ------------------------------------------------------------- BLOCO C
  await rejeitaCom("periodo ausente → 400 PERIODO_OBRIGATORIO",
    obterFinanceiro({ clienteSlugRaw: "n97", clienteContaIdRaw: "10", periodoRaw: undefined }, depsBase()),
    (e) => e.statusCode === 400 && e.code === "PERIODO_OBRIGATORIO");
  await rejeitaCom("periodo invalido → 400 PERIODO_INVALIDO (nunca o mes atual)",
    obterFinanceiro({ clienteSlugRaw: "n97", clienteContaIdRaw: "10", periodoRaw: "agosto-2026" }, depsBase()),
    (e) => e.statusCode === 400 && e.code === "PERIODO_INVALIDO");

  // ------------------------------------------- ambiguidade de fechamento
  {
    const deps = depsBase({
      listarEntregas: async () => ({ ok: true, entregas: [
        { id: 1, periodo: "2026-08", status: "rascunho", created_at: "2026-09-01T10:00:00Z", publicado: false, payload_json: { cards: [{ chave: "x", valor: 1 }] } },
        { id: 2, periodo: "2026-08", status: "publicado", created_at: "2026-09-02T10:00:00Z", publicado: true, payload_json: { cards: [{ chave: "x", valor: 2 }] } },
      ] }),
    });
    const r = await obterFinanceiro({ clienteSlugRaw: "n97", clienteContaIdRaw: "10", periodoRaw: "2026-08" }, deps);
    ok("fechamento duplicado: publicada vence rascunho", r.resultado.dados.composicao[0].valor === 2);
    ok("fechamento duplicado e DECLARADO, nao escondido", r.resultado.ambiguidade && r.resultado.ambiguidade.total === 2);
    ok("ambiguidade diz qual foi escolhido", r.resultado.ambiguidade.escolhidoId === 2);
  }
  {
    // Sem publicada: vence a mais recente; empate de data → maior id.
    const escolha = selecionarFechamentoDoPeriodo([
      { id: 1, periodo: "2026-08", created_at: "2026-09-01T10:00:00Z" },
      { id: 2, periodo: "2026-08", created_at: "2026-09-01T10:00:00Z" },
    ], "2026-08");
    ok("empate total de data desempata por id (ordem sempre determinística)", escolha.entrega.id === 2);
  }
  {
    const r = await obterFinanceiro({ clienteSlugRaw: "n97", clienteContaIdRaw: "10", periodoRaw: "2026-08" }, depsBase({
      listarEntregas: async () => ({ ok: true, entregas: [{ id: 1, periodo: "2026-08", status: "publicado", payload_json: { cards: [] } }] }),
    }));
    ok("sem duplicata NAO existe campo ambiguidade", r.resultado.ambiguidade === undefined);
  }

  // ---------------------------------------------- contrato de contexto
  {
    const r = await obterFinanceiro({ clienteSlugRaw: "n97", clienteContaIdRaw: "10", periodoRaw: "2026-08" }, depsBase());
    ok("contexto ecoa a competencia efetivamente usada", r.contexto.periodo === "2026-08");
    ok("contexto declara que a competencia veio do request", r.contexto.periodoInferido === false);
    ok("resultado.escopoConta continua false e honesto (sem cliente_conta_id na tabela)", r.resultado.escopoConta === false);
    ok("relatorios.escopoConta tambem e honesto", r.relatorios.escopoConta === false);
  }

  // -------------------------------- falha da fonte nao derruba a resposta
  {
    const r = await obterFinanceiro({ clienteSlugRaw: "n97", clienteContaIdRaw: "10", periodoRaw: "2026-08" }, depsBase({
      listarEntregas: async () => { throw new Error("banco fora"); },
    }));
    ok("fonte de entregas indisponivel: resultado indisponivel com motivo", r.resultado.disponivel === false && /banco fora/.test(r.resultado.motivo));
    ok("fonte de entregas indisponivel: relatorios indisponivel com motivo", r.relatorios.disponivel === false && /banco fora/.test(r.relatorios.motivo));
    ok("conciliacao continua resolvida mesmo com entregas fora (cobertura parcial)", r.conciliacao.disponivel === true);
  }

  // ------------------------- range enviado a conciliacao e o mes inteiro
  {
    let capturado = null;
    await obterFinanceiro({ clienteSlugRaw: "n97", clienteContaIdRaw: "10", periodoRaw: "2026-02" }, depsBase({
      getMercadoPagoReconciliationForRange: async (_slug, opts) => { capturado = opts; return { ok: true }; },
    }));
    ok("conciliacao recebe o mes inteiro da competencia pedida", capturado.dateFrom === "2026-02-01" && capturado.dateTo === "2026-02-28");
    ok("conciliacao recebe clienteContaId explicito", capturado.clienteContaId === 10);
  }

  // ----------------------------------------------- montarHistorico puro
  ok("montarHistorico([]) e vazio, nao lanca", montarHistorico([]).length === 0);
  ok("montarHistorico(undefined) e vazio, nao lanca", montarHistorico(undefined).length === 0);

  console.log(`\nfinanceiroPeriodoContrato.test.js: ${checks} verificacoes passaram.`);
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
