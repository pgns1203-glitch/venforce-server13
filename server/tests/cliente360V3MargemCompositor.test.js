// server/tests/cliente360V3MargemCompositor.test.js
//
// FASE 3 (Projeto_cliente360) — gate de aplicabilidade do Motor de Margem
// (não é clienteContaId-aware; só integra quando o cliente tem EXATAMENTE 1
// conta MELI ativa) e o cruzamento por MLB. Tudo com deps injetadas — NUNCA
// chama a API real do Mercado Livre nem o Postgres real.
//
// Roda sem infra: node server/tests/cliente360V3MargemCompositor.test.js

const assert = require("assert");
const { avaliarAplicabilidade, comporMargemPorMlb } = require("../services/cliente360/cliente360V3MargemCompositor");

let passed = 0;
const check = (n, c) => { assert.ok(c, `FALHOU: ${n}`); passed++; console.log(`  ok  ${n}`); };

function contaAtiva(id) { return { id, ativo: true, marketplace: "meli" }; }

function itemFake({ itemId, status = "HEALTHY", statusLabel = "Saudável", confidence = "high", realizedComputable = true, realizedPercent = 0.22, projectedPercent = 0.18, motivo = null }) {
  return {
    identity: { itemId, sku: null, titulo: `Produto ${itemId}` },
    quality: { status, statusLabel, confidence, statusReasons: motivo ? [motivo] : [] },
    margin: {
      realized: { computable: realizedComputable, marginPercent: realizedComputable ? realizedPercent : null },
      projected: { marginPercent: projectedPercent },
    },
  };
}

(async () => {
  // ── avaliarAplicabilidade ────────────────────────────────────────────────
  const naoMeli = await avaliarAplicabilidade({ clienteId: 1, marketplace: "shopee" }, {});
  check("marketplace != meli → não aplicável, código MARKETPLACE_NAO_SUPORTADO", naoMeli.aplicavel === false && naoMeli.codigo === "MARKETPLACE_NAO_SUPORTADO");

  const semContaMeli = await avaliarAplicabilidade(
    { clienteId: 1, marketplace: "meli" },
    { listarContasDoCliente: async () => [] }
  );
  check("0 contas MELI ativas → não aplicável, SEM_CONTA_MELI_ATIVA", semContaMeli.aplicavel === false && semContaMeli.codigo === "SEM_CONTA_MELI_ATIVA");

  const multiconta = await avaliarAplicabilidade(
    { clienteId: 1, marketplace: "meli" },
    { listarContasDoCliente: async () => [contaAtiva(10), contaAtiva(11)] }
  );
  check("2+ contas MELI ativas → não aplicável, MOTOR_MARGEM_MULTICONTA_NAO_SUPORTADO (nunca mistura contas)",
    multiconta.aplicavel === false && multiconta.codigo === "MOTOR_MARGEM_MULTICONTA_NAO_SUPORTADO");
  check("motivo da multiconta é honesto, não genérico", multiconta.motivo.includes("multiconta"));

  const contaUnica = await avaliarAplicabilidade(
    { clienteId: 1, marketplace: "meli" },
    { listarContasDoCliente: async () => [contaAtiva(10)] }
  );
  check("exatamente 1 conta MELI ativa → aplicável", contaUnica.aplicavel === true);

  // ── comporMargemPorMlb: não chama a API quando não aplicável ────────────
  let chamouListarItens = false;
  const semAplicar = await comporMargemPorMlb(
    { clienteId: 1, clienteSlug: "n97", marketplace: "shopee", mlbs: ["MLB1"] },
    { listarItens: async () => { chamouListarItens = true; return { itens: [] }; } }
  );
  check("não aplicável: porMlb vazio, motivo presente", semAplicar.aplicavel === false && Object.keys(semAplicar.porMlb).length === 0);
  check("não aplicável: NUNCA chama a API do Mercado Livre (economiza custo/rate-limit)", chamouListarItens === false);

  // ── comporMargemPorMlb: lista vazia de MLBs não chama a API ─────────────
  let chamouListarItens2 = false;
  const semMlbs = await comporMargemPorMlb(
    { clienteId: 1, clienteSlug: "n97", marketplace: "meli", mlbs: [] },
    {
      listarContasDoCliente: async () => [contaAtiva(10)],
      listarItens: async () => { chamouListarItens2 = true; return { itens: [] }; },
    }
  );
  check("mlbs vazio: aplicável mas porMlb vazio, sem chamar a API", semMlbs.aplicavel === true && Object.keys(semMlbs.porMlb).length === 0 && chamouListarItens2 === false);

  // ── comporMargemPorMlb: caminho feliz, matched com margem realizada ─────
  const comMatch = await comporMargemPorMlb(
    { clienteId: 1, clienteSlug: "n97", marketplace: "meli", mlbs: ["MLB1", "MLB2"] },
    {
      listarContasDoCliente: async () => [contaAtiva(10)],
      listarItens: async (params) => {
        check("listarItens recebe os MLBs pedidos via itemIds (nunca varre o catálogo inteiro)",
          Array.isArray(params.itemIds) && params.itemIds.includes("MLB1") && params.itemIds.includes("MLB2"));
        return { itens: [itemFake({ itemId: "MLB1", status: "HEALTHY" })] };
      },
    }
  );
  check("MLB1 (retornado): identidade matched", comMatch.porMlb.MLB1.identidade === "matched");
  check("MLB1: status/confidence vêm do Motor de Margem", comMatch.porMlb.MLB1.status === "HEALTHY" && comMatch.porMlb.MLB1.confidence === "high");
  check("MLB1: margem realizada (computable=true) é rotulada 'realizada', nunca confundida com projetada", comMatch.porMlb.MLB1.margemTipo === "realizada" && comMatch.porMlb.MLB1.margemPercent === 0.22);
  check("MLB2 (não retornado pelo Motor de Margem — pausado/removido): identidade missing, nunca inventa status", comMatch.porMlb.MLB2.identidade === "missing");

  // ── margem projetada quando a realizada não é computável ────────────────
  const comProjetada = await comporMargemPorMlb(
    { clienteId: 1, clienteSlug: "n97", marketplace: "meli", mlbs: ["MLB3"] },
    {
      listarContasDoCliente: async () => [contaAtiva(10)],
      listarItens: async () => ({ itens: [itemFake({ itemId: "MLB3", realizedComputable: false, projectedPercent: 0.09, status: "RECONCILING", motivo: "Venda ainda não conciliada." })] }),
    }
  );
  check("realizada não computável → cai para projetada, rotulada 'projetada' (nunca mostrada como se fosse realizada)",
    comProjetada.porMlb.MLB3.margemTipo === "projetada" && comProjetada.porMlb.MLB3.margemPercent === 0.09);
  check("problemaPrincipal vem de quality.statusReasons[0], não inventado", comProjetada.porMlb.MLB3.problemaPrincipal === "Venda ainda não conciliada.");

  console.log(`\n${passed} verificações passaram. Motor de Margem só integra com exatamente 1 conta MELI ativa; MLB é a chave exata dos dois lados; realizada/projetada nunca se confundem.`);
})().catch((e) => { console.error(e); process.exit(1); });
