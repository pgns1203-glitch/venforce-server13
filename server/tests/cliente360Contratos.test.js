// server/tests/cliente360Contratos.test.js
// Guarda de CONTRATO DE MÓDULO da Cliente 360.
//
// Por que este arquivo existe: o endpoint GET /operacao/cliente-360/:slug/resultado
// devolveu HTTP 500 com "buildPayloadFromRange is not a function" mesmo com todas
// as suítes verdes. Motivo: `centralVendasService` DEFINIA a função mas não a
// listava em `module.exports`, e os testes existentes injetavam um fake
// (`createFechamentoAdapter({ buildPayloadFromRange: fakeBuild })`), nunca
// exercitando o require padrão do adapter.
//
// A lição é geral: injeção de dependência esconde erro de import quando o teste
// sempre passa a dependência. Estes testes montam o adapter SEM injetar nada, do
// mesmo jeito que o controller faz em produção.
//
// Roda sem infra: node tests/cliente360Contratos.test.js

const assert = require("assert");

let passed = 0;
const check = (n, c) => { assert.ok(c, `FALHOU: ${n}`); passed++; console.log(`  ok  ${n}`); };

// ── 1. O módulo exporta o que o adapter importa ────────────────────────────
{
  // Importado EXATAMENTE como cliente360FechamentoAdapter.js importa.
  const centralVendasService = require("../services/centralVendas/centralVendasService");
  const { buildPayloadFromRange } = centralVendasService;

  check("centralVendasService exporta buildPayloadFromRange",
    typeof buildPayloadFromRange === "function");
  check("centralVendasService continua exportando buildPayloadFromSnapshot",
    typeof centralVendasService.buildPayloadFromSnapshot === "function");
  check("centralVendasService continua exportando getCentralVendas",
    typeof centralVendasService.getCentralVendas === "function");
  check("centralVendasService continua exportando createCentralVendasService",
    typeof centralVendasService.createCentralVendasService === "function");
  check("centralVendasService continua exportando periodoFromCompetencia",
    typeof centralVendasService.periodoFromCompetencia === "function");

  // O projeto usa exports NOMEADOS: o módulo é um objeto, não a função direta.
  check("o módulo é um objeto de exports nomeados",
    typeof centralVendasService === "object" && !Array.isArray(centralVendasService));

  // Só uma implementação: a exportada é a mesma usada internamente.
  const payloadVazio = buildPayloadFromRange(
    { slug: "x", nome: "X" }, { dateFrom: "2026-06-01", dateTo: "2026-06-30" }, null
  );
  check("buildPayloadFromRange devolve o contrato de pedidos",
    payloadVazio && payloadVazio.ok === true && Array.isArray(payloadVazio.pedidos));
}

// ── 2. Cada módulo da Cliente 360 exporta o que os outros consomem ─────────
{
  const CONTRATOS = [
    ["../services/cliente360/cliente360PonteEngine", ["montarPonte", "agregarProdutos", "totaisDoPeriodo", "round2", "num"]],
    ["../services/cliente360/cliente360ProdutosEngine", ["montarProdutos", "curvaAporFaturamento"]],
    ["../services/cliente360/cliente360ConfiancaEngine", ["avaliarConfianca", "coberturaPeriodo", "classificar"]],
    ["../services/cliente360/cliente360RecuperacaoEngine", ["avaliarRecuperacao"]],
    ["../services/cliente360/cliente360NarrativaEngine", ["gerarNarrativa", "gerarLeituraAds"]],
    ["../services/cliente360/cliente360SimuladorEngine", ["simular", "aplicar", "totalizar", "chavesProibidasEm"]],
    ["../services/cliente360/cliente360ElasticidadeEngine", ["estimarElasticidades"]],
    ["../services/cliente360/cliente360Periodo", ["resolverPeriodos", "rangeDaCompetencia", "competenciaAnteriorDe", "proximaCompetencia", "ehCompetenciaValida"]],
    ["../services/cliente360/cliente360FechamentoAdapter", ["createFechamentoAdapter", "reconciliar", "totaisOperacionais"]],
    ["../services/cliente360/cliente360AdsService", ["createAdsService", "getInvestimento", "montarBlocoAds", "calcularTacos", "calcularResultadoAposAds", "calcularMargemAposAds"]],
    ["../services/cliente360/cliente360ResultadoService", ["getResultado", "createResultadoService", "sanitizarParaJson"]],
    ["../services/cliente360/cliente360SimulacaoService", ["simular", "createSimulacaoService", "intervencoesDoCenarioRapido"]],
    ["../services/cliente360/cliente360SerieService", ["getSerie", "getElasticidades", "createSerieService"]],
    ["../services/cliente360/cliente360PlacarService", ["getPlacar", "createPlacarService"]],
    ["../services/cliente360/cliente360AcoesRepository", ["registrarAcao", "listarAcoes", "removerAcao", "ehFatorLegado"]],
    ["../services/ads/mlAdsService", ["buscarPerformanceML"]],
  ];

  for (const [caminho, esperados] of CONTRATOS) {
    const modulo = require(caminho);
    const faltando = esperados.filter((nome) => typeof modulo[nome] !== "function");
    check(`${caminho.split("/").pop()} exporta ${esperados.length} função(ões)`, faltando.length === 0);
  }
}

// ── 3. Controller e rotas carregam e expõem os handlers ───────────────────
{
  const controller = require("../controllers/cliente360ResultadoController");
  const handlers = [
    "obterResultado", "simularResultado", "obterElasticidades",
    "obterPlacar", "registrarAcao", "listarAcoes", "removerAcao",
  ];
  for (const nome of handlers) {
    check(`controller exporta ${nome}`, typeof controller[nome] === "function");
  }

  const rotas = require("../routes/cliente360ResultadoRoutes");
  check("router da Cliente 360 carrega", typeof rotas === "function" && Array.isArray(rotas.stack));
  check("router registra o GET /:slug/resultado",
    rotas.stack.some((camada) => camada.route?.path === "/:slug/resultado" && camada.route.methods.get));
  check("router registra o POST /:slug/resultado/simular",
    rotas.stack.some((camada) => camada.route?.path === "/:slug/resultado/simular" && camada.route.methods.post));
}

// ── 4. Fiação REAL do adapter: sem injetar nenhuma dependência ────────────
// Este é o teste que teria pego o 500. Só `centralRepo` é trocado (para não
// tocar o banco); `buildPayloadFromRange` vem do require padrão, como em produção.
(async () => {
  const { createFechamentoAdapter } = require("../services/cliente360/cliente360FechamentoAdapter");

  const snapshotFake = {
    importacao: { id: 1, fonte: "orders_api", created_at: "2026-07-01T00:00:00Z" },
    pedidos: [{
      id: 10, pedido_id: "P1", data_pedido: "2026-06-10", status: "paid",
      faturamento: 1000, quantidade_itens: 10, resultado: 400, confianca: "confiavel",
      payload_json: null, pendencias_json: [],
    }],
    itens: [{
      pedido_row_id: 10, pedido_id: "P1", item_id: "P1:MLB1:0", mlb: "MLB1", sku: "SKU1",
      titulo: "Produto 1", quantidade: 10, valor_unitario: 100,
      receita_produto: 1000, custo_produto: 400, imposto_interno: 50,
      resultado: 400, confianca: "confiavel", pendencias_json: [],
    }],
    componentes: [
      { pedido_row_id: 10, pedido_id: "P1", tipo: "tarifa_venda", valor: -100, confianca: "confiavel" },
      { pedido_row_id: 10, pedido_id: "P1", tipo: "frete_seller", valor: -50, confianca: "confiavel" },
      { pedido_row_id: 10, pedido_id: "P1", tipo: "custo_produto", valor: -400, confianca: "confiavel" },
      { pedido_row_id: 10, pedido_id: "P1", tipo: "imposto_interno", valor: -50, confianca: "confiavel" },
    ],
  };

  const adapter = createFechamentoAdapter({
    centralRepo: {
      getClienteBySlug: async (slug) => ({ slug, nome: "Cliente Teste", id: 1 }),
      getCentralVendasByRange: async () => snapshotFake,
    },
    // buildPayloadFromRange NÃO é injetado de propósito — usa o require real.
  });

  const periodo = await adapter.lerPeriodo(
    { slug: "adb_supply", nome: "ADB Supply" },
    { inicio: "2026-06-01", fim: "2026-06-30" },
    "meli"
  );

  check("adapter monta o período usando o require real (sem TypeError)", !!periodo);
  check("adapter devolve pedidos do fechamento", periodo.pedidos.length === 1);
  check("adapter marca que há fechamento", periodo.temFechamento === true);
  check("adapter apura os totais operacionais", periodo.totais.faturamentoFechamento === 1000);
  check("adapter reconcilia detalhe × fechamento", periodo.reconciliacao.status === "reconciliado");

  // ── 5. O orquestrador roda fim-a-fim com a fiação padrão ────────────────
  // Só `centralRepo` e `adsService` são trocados; o adapter de fechamento é o
  // construído internamente pelo service, com o require real.
  const { createResultadoService } = require("../services/cliente360/cliente360ResultadoService");
  const { STATUS } = require("../services/cliente360/cliente360AdsService");

  const service = createResultadoService({
    centralRepo: {
      getClienteBySlug: async (slug) => ({ slug, nome: "ADB Supply", id: 1 }),
      getCentralVendasByRange: async () => snapshotFake,
    },
    adsService: {
      getInvestimento: async (_slug, competencia) => ({
        valor: null, status: STATUS.SEM_DADOS, fonte: null, competencia,
        periodo: null, atualizadoEm: null, motivo: "sem linha",
      }),
    },
  });

  const payload = await service.getResultado("adb_supply", {
    competencia: "2026-06", compararCom: "2026-05", marketplace: "meli",
  });

  check("GET resultado monta o payload sem erro de import", payload.ok === true);
  check("payload traz o fechamento", !!payload.fechamento?.atual);
  check("payload traz o bloco de Ads", !!payload.ads);
  check("payload traz a configuração do simulador", Array.isArray(payload.simulacao?.produtos));
  check("payload é serializável em JSON", typeof JSON.stringify(payload) === "string");

  console.log(`\n${passed} verificações passaram. Contratos de módulo da Cliente 360 íntegros.`);
})().catch((e) => { console.error(e); process.exit(1); });
