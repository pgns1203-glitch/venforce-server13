// frontend-react/src/dev/cliente360V3PreviewFixtures.js
//
// Fixture do preview visual do Dossiê (?preview=1). SÓ é importada pelo entry
// de preview, que por sua vez só existe no dev server do Vite
// (vite.config.js :: forcarHtmlDaFonteSobrePublicDir) — nada aqui entra num
// build de produção.
//
// Por que a fixture ficou maior do que `payloadCliente360()` de test/payload.js:
// aquele fixture é o CONTRATO mínimo (3 produtos, 4 fatores) e serve para
// provar que a tela lê o formato certo. Ele não serve para JULGAR densidade —
// uma tabela com três linhas parece confortável em qualquer largura, e uma
// ponte com quatro barras nunca aperta. O preview precisa de uma operação de
// tamanho realista: 14 produtos materiais, seis fatores na ponte, oportunidades
// concorrendo por espaço.
//
// A FORMA continua sendo exatamente a do contrato real: os mesmos campos, com
// os mesmos nomes e as mesmas unidades (margem em fração, p.p. já calculado,
// ausência = null). Os valores derivados (custo/frete/comissão unitários,
// recuperável até o alvo, participações) são CALCULADOS aqui a partir dos
// mesmos identidades que o backend usa, em vez de digitados — fixture com
// número digitado à mão desalinha na primeira edição e passa a validar uma
// tela impossível.

const ALVO_MARGEM = 0.15;
const TAXA_COMISSAO = 0.14;
const TAXA_IMPOSTO = 0.03;

export const ESTADOS_PREVIEW = [
  { chave: "normal", alias: "normal", label: "Normal" },
  { chave: "atencao", alias: "attention", label: "Atenção" },
  { chave: "confianca_parcial", alias: "partial", label: "Confiança parcial" },
  { chave: "indisponivel", alias: "unavailable", label: "Indisponível" },
  { chave: "carregando", alias: "loading", label: "Carregando" },
];

// Aceita `?state=partial` (oficial) e `?estado=confianca_parcial` (o parâmetro
// da versão anterior, mantido para não quebrar link salvo de ninguém).
export function lerEstado(search) {
  const params = new URLSearchParams(search || "");
  const bruto = params.get("state") || params.get("estado") || "";
  const achado = ESTADOS_PREVIEW.find((e) => e.chave === bruto || e.alias === bruto);
  return achado ? achado.chave : "normal";
}

const round2 = (n) => Math.round(n * 100) / 100;

// Mesma identidade financeira do motor: preço unitário − comissão − imposto −
// frete − custo = margem de contribuição unitária. Aqui a conta é invertida
// (sabemos a margem, derivamos o custo) para os números do preview fecharem
// entre si em qualquer tela que os cruze.
function montarProduto({ mlb, titulo, faturamento, unidades, margem, curvaAbc, freteUnitario }) {
  const resultado = round2(faturamento * margem);
  const precoMedio = round2(faturamento / unidades);
  const comissaoUnitaria = round2(precoMedio * TAXA_COMISSAO);
  const impostoUnitario = round2(precoMedio * TAXA_IMPOSTO);
  const margemUnitaria = round2(resultado / unidades);
  const custoUnitario = round2(precoMedio - comissaoUnitaria - impostoUnitario - freteUnitario - margemUnitaria);
  return {
    mlb, titulo, unidades, faturamento, resultado, margem, precoMedio,
    custoUnitario, freteUnitario, comissaoUnitaria, impostoUnitario, margemUnitaria,
    curvaA: curvaAbc === "A",
    curvaAbc,
  };
}

const CATALOGO = [
  { mlb: "MLB2847193", titulo: "Air Fryer Oven 12L Inox Digital", faturamento: 78400, unidades: 392, margem: 0.221, curvaAbc: "A", freteUnitario: 18.9 },
  { mlb: "MLB1994522", titulo: "Robô Aspirador Smart W300 Wi-Fi", faturamento: 61250, unidades: 175, margem: 0.184, curvaAbc: "A", freteUnitario: 24.5 },
  { mlb: "MLB3310877", titulo: "Cafeteira Expresso Duo Crema 19 bar", faturamento: 44900, unidades: 310, margem: 0.093, curvaAbc: "A", freteUnitario: 16.2 },
  { mlb: "MLB2210044", titulo: "Panela Elétrica de Arroz 1,8L", faturamento: 39180, unidades: 620, margem: -0.061, curvaAbc: "A", freteUnitario: 14.8 },
  { mlb: "MLB1877340", titulo: "Liquidificador Turbo 1400W 12 velocidades", faturamento: 31640, unidades: 452, margem: 0.163, curvaAbc: "A", freteUnitario: 13.4 },
  { mlb: "MLB4092118", titulo: "Kit Facas Damasco 6 peças com cepo", faturamento: 27310, unidades: 289, margem: 0.241, curvaAbc: "B", freteUnitario: 11.2 },
  { mlb: "MLB2664901", titulo: "Purificador de Água Flow Compacto", faturamento: 24860, unidades: 118, margem: 0.128, curvaAbc: "B", freteUnitario: 22.1 },
  { mlb: "MLB3785220", titulo: "Escova Secadora Pro 1200W", faturamento: 21470, unidades: 358, margem: 0.042, curvaAbc: "B", freteUnitario: 12.6 },
  { mlb: "MLB1550983", titulo: "Jogo de Panelas Antiaderente 7 peças", faturamento: 18930, unidades: 142, margem: 0.207, curvaAbc: "B", freteUnitario: 19.7 },
  { mlb: "MLB2903461", titulo: "Ventilador de Coluna 40cm 6 pás", faturamento: 15720, unidades: 244, margem: -0.118, curvaAbc: "B", freteUnitario: 17.3 },
  { mlb: "MLB3120765", titulo: "Sanduicheira Grill 3 em 1", faturamento: 12480, unidades: 267, margem: 0.089, curvaAbc: "C", freteUnitario: 10.4 },
  { mlb: "MLB2445118", titulo: "Balança Digital Corporal Bluetooth", faturamento: 9640, unidades: 401, margem: 0.312, curvaAbc: "C", freteUnitario: 8.1 },
  { mlb: "MLB1739502", titulo: "Organizador Modular 6 gavetas", faturamento: 7210, unidades: 96, margem: 0.058, curvaAbc: "C", freteUnitario: 15.6 },
  { mlb: "MLB4471009", titulo: 'Suporte Articulado para TV 55"', faturamento: 5980, unidades: 148, margem: 0.196, curvaAbc: "C", freteUnitario: 9.3 },
].map(montarProduto);

const porMlb = Object.fromEntries(CATALOGO.map((p) => [p.mlb, p]));

// Contribuições vêm da ponte (quanto o item moveu o RESULTADO contra o mês
// anterior), não do resultado do próprio item — são coisas diferentes e o
// motor real também as separa.
const CONTRIBUICOES = {
  MLB2847193: { contribuicao: 3120, motivoDominante: "volume" },
  MLB1994522: { contribuicao: 2480, motivoDominante: "preco" },
  MLB4092118: { contribuicao: 1540, motivoDominante: "volume" },
  MLB1877340: { contribuicao: 980, motivoDominante: "preco" },
  MLB2445118: { contribuicao: 610, motivoDominante: "volume" },
  MLB2210044: { contribuicao: -2180, motivoDominante: "custo" },
  MLB2903461: { contribuicao: -1340, motivoDominante: "custo" },
  MLB3310877: { contribuicao: -890, motivoDominante: "preco" },
  MLB3785220: { contribuicao: -640, motivoDominante: "frete" },
  MLB2664901: { contribuicao: -310, motivoDominante: "comissao" },
};

function comContribuicao(mlb) {
  const p = porMlb[mlb];
  return {
    mlb: p.mlb, titulo: p.titulo, faturamento: p.faturamento, unidadesAtual: p.unidades,
    margem: p.margem, curvaA: p.curvaA, curvaAbc: p.curvaAbc,
    ...CONTRIBUICOES[mlb],
  };
}

const AJUDARAM = ["MLB2847193", "MLB1994522", "MLB4092118", "MLB1877340", "MLB2445118"].map(comContribuicao);
const PREJUDICARAM = ["MLB2210044", "MLB2903461", "MLB3310877", "MLB3785220", "MLB2664901"].map(comContribuicao);

const NO_VERMELHO = CATALOGO
  .filter((p) => p.resultado < 0)
  .map((p) => ({ ...p, motivoRisco: "resultado_negativo" }))
  .sort((a, b) => a.resultado - b.resultado);

const ABAIXO_DA_MARGEM = CATALOGO
  .filter((p) => p.margem > 0 && p.margem < ALVO_MARGEM)
  .map((p) => ({
    ...p,
    motivoRisco: "margem_abaixo_alvo",
    gapMargemPp: round2((ALVO_MARGEM - p.margem) * 100),
    recuperavelAteAlvo: round2((ALVO_MARGEM - p.margem) * p.faturamento),
  }))
  .sort((a, b) => b.recuperavelAteAlvo - a.recuperavelAteAlvo);

const CURVA_A_EM_RISCO = [...NO_VERMELHO, ...ABAIXO_DA_MARGEM].filter((p) => p.curvaA);

const RECUPERAVEL_PRODUTO = round2(NO_VERMELHO.reduce((s, p) => s + Math.abs(p.resultado), 0));
const RECUPERAVEL_MARGEM = round2(ABAIXO_DA_MARGEM.reduce((s, p) => s + p.recuperavelAteAlvo, 0));
const RECUPERAVEL_CUSTO = 2610;
const RECUPERAVEL_FRETE = 940;

const FECHAMENTO_ATUAL = {
  faturamento: 412840, pedidos: 1847, unidades: 2412, ticketMedio: 223.52,
  cancelamentos: 41, valorCancelado: 8930, comProblema: 12,
  comissao: 57798, frete: 38190, custo: 231190, imposto: 12385, ajustes: 0,
  resultadoOperacional: 73277, margemOperacional: 0.1775,
  ads: 21640, adsStatus: "carregado", tacos: 0.0524,
  resultadoAposAds: 51637, margemAposAds: 0.1251,
};

const FECHAMENTO_ANTERIOR = {
  faturamento: 380910, pedidos: 1702, unidades: 2208, ticketMedio: 223.8,
  cancelamentos: 33, valorCancelado: 6980, comProblema: 9,
  comissao: 53327, frete: 34282, custo: 216118, imposto: 11427, ajustes: 0,
  resultadoOperacional: 65756, margemOperacional: 0.1726,
  ads: 17980, adsStatus: "carregado", tacos: 0.0472,
  resultadoAposAds: 47776, margemAposAds: 0.1254,
};

// Fatores somam EXATAMENTE a variação do resultado (7.521) — é o que
// `fecha: true` promete no contrato. O estado "confianca_parcial" quebra essa
// soma de propósito, para o waterfall poder mostrar a coluna "não explicado".
const PONTE_LINHAS = [
  {
    chave: "volume", label: "Volume", impacto: 6080, material: true,
    descricao: "O total de unidades vendidas cresceu, mantida a margem unitária do período anterior.",
    formula: "(unidades atuais − unidades anteriores) × margem unitária média anterior",
    produtos: [
      { mlb: "MLB2847193", titulo: porMlb.MLB2847193.titulo, impacto: 3980, unidadesAnterior: 298, unidadesAtual: 392, unitario: null },
      { mlb: "MLB4092118", titulo: porMlb.MLB4092118.titulo, impacto: 1540, unidadesAnterior: 221, unidadesAtual: 289, unitario: null },
      { mlb: "MLB2445118", titulo: porMlb.MLB2445118.titulo, impacto: 560, unidadesAnterior: 326, unidadesAtual: 401, unitario: null },
    ],
  },
  {
    chave: "preco", label: "Preço médio", impacto: 3940, material: true,
    descricao: "O preço médio praticado subiu nos produtos comparáveis.",
    formula: "Σ unidades atuais × (preço atual − preço anterior)",
    produtos: [
      { mlb: "MLB1994522", titulo: porMlb.MLB1994522.titulo, impacto: 2480, unidadesAnterior: 168, unidadesAtual: 175, unitario: { anterior: 335.8, atual: 350 } },
      { mlb: "MLB1877340", titulo: porMlb.MLB1877340.titulo, impacto: 1350, unidadesAnterior: 431, unidadesAtual: 452, unitario: { anterior: 67.01, atual: 70 } },
      { mlb: "MLB3310877", titulo: porMlb.MLB3310877.titulo, impacto: 110, unidadesAnterior: 286, unidadesAtual: 310, unitario: { anterior: 144.49, atual: 144.84 } },
    ],
  },
  {
    chave: "custo", label: "Custo do produto", impacto: -2610, material: true,
    descricao: "O custo unitário subiu nos itens comparáveis — a base de custo desta operação foi atualizada em 12/08.",
    formula: "− Σ unidades atuais × (custo unitário atual − custo unitário anterior)",
    produtos: [
      { mlb: "MLB2210044", titulo: porMlb.MLB2210044.titulo, impacto: -1740, unidadesAnterior: 588, unidadesAtual: 620, unitario: { anterior: 44.11, atual: 46.92 } },
      { mlb: "MLB2903461", titulo: porMlb.MLB2903461.titulo, impacto: -870, unidadesAnterior: 231, unidadesAtual: 244, unitario: { anterior: 47.31, atual: 50.88 } },
    ],
  },
  {
    chave: "comissao", label: "Comissão", impacto: 2150, material: true,
    descricao: "A alíquota média de comissão caiu com a mudança de categoria de dois anúncios.",
    formula: "− Σ (comissão atual − comissão anterior)",
    produtos: [
      { mlb: "MLB1994522", titulo: porMlb.MLB1994522.titulo, impacto: 1420, unidadesAnterior: 168, unidadesAtual: 175, unitario: { anterior: 56.4, atual: 49 } },
      { mlb: "MLB2664901", titulo: porMlb.MLB2664901.titulo, impacto: 730, unidadesAnterior: 104, unidadesAtual: 118, unitario: { anterior: 35.6, atual: 29.5 } },
    ],
  },
  {
    chave: "frete", label: "Frete", impacto: -940, material: true,
    descricao: "O frete médio por pedido subiu na faixa de peso dos itens grandes.",
    formula: "− Σ (frete atual − frete anterior)",
    produtos: [
      { mlb: "MLB3785220", titulo: porMlb.MLB3785220.titulo, impacto: -640, unidadesAnterior: 341, unidadesAtual: 358, unitario: { anterior: 10.8, atual: 12.6 } },
      { mlb: "MLB1550983", titulo: porMlb.MLB1550983.titulo, impacto: -300, unidadesAnterior: 138, unidadesAtual: 142, unitario: { anterior: 17.6, atual: 19.7 } },
    ],
  },
  {
    chave: "outros", label: "Outros", impacto: -1099, material: false,
    descricao: "Fatores individualmente imateriais, agrupados. A composição exata está abaixo.",
    formula: "Mix + Imposto",
    composicao: [
      { chave: "mix", label: "Mix de produtos", impacto: -372 },
      { chave: "imposto", label: "Imposto", impacto: -727 },
    ],
    produtos: [],
  },
];

function payloadBase() {
  return {
    ok: true,
    cliente: { slug: "casa-viva", nome: "Casa Viva Utilidades", id: 42 },
    periodo: {
      competencia: "2026-08", inicio: "2026-08-01", fim: "2026-08-31",
      diasNoPeriodo: 31, diasNoMes: 31, parcial: false, label: "agosto/2026", marketplace: "meli",
    },
    comparacao: {
      competencia: "2026-07", inicio: "2026-07-01", fim: "2026-07-31",
      diasNoPeriodo: 31, diasNoMes: 31, parcial: false, label: "julho/2026", marketplace: "meli",
    },
    estado: { chave: "ok", mensagem: null, bloqueante: false },
    thresholds: { margemAlvo: ALVO_MARGEM },

    confianca: {
      nivel: "confiavel", exibirPonte: true, motivoOcultarPonte: null,
      coberturaResultado: 0.98, coberturaCusto: 0.94, coberturaFrete: 0.99,
      receitaBloqueada: 8140, pedidosBloqueados: 22, pedidosParciais: 7,
      reconciliacao: {
        status: "reconciliado", faturamentoFechamento: 412840, faturamentoDetalhe: 412840,
        ajusteIdentificado: 0, diferenca: 0, origemAjuste: null,
      },
      divergenciaPonte: null,
      alertas: [],
      geradoEm: "2026-09-01T06:12:00Z",
      porPeriodo: { anterior: {}, atual: {} },
      pedidosDerrubando: [
        { pedidoId: "2000009284417731", data: "2026-08-04", valor: 1890.4, pendencias: ["custo ausente"] },
        { pedidoId: "2000009284511902", data: "2026-08-11", valor: 1640.0, pendencias: ["custo ausente", "frete ausente"] },
        { pedidoId: "2000009284772104", data: "2026-08-19", valor: 1425.9, pendencias: ["frete ausente"] },
        { pedidoId: "2000009285003318", data: "2026-08-27", valor: 1183.7, pendencias: ["custo ausente"] },
      ],
    },

    fechamento: {
      atual: { ...FECHAMENTO_ATUAL },
      anterior: { ...FECHAMENTO_ANTERIOR },
      variacoes: {
        faturamento: { abs: 31930, pct: 0.0838 },
        resultadoOperacional: { abs: 7521, pct: 0.1144 },
        resultadoAposAds: { abs: 3861, pct: 0.0808 },
        margemOperacional: { pp: 0.49 },
        margemAposAds: { pp: -0.03 },
        unidades: { abs: 204, pct: 0.0924 },
        pedidos: { abs: 145, pct: 0.0852 },
        ticketMedio: { abs: -0.28, pct: -0.0013 },
        cancelamentos: { abs: 8, pct: 0.2424 },
        ads: { abs: 3660, pct: 0.2036 },
        tacos: { pp: 0.52 },
      },
      eficiencia: [],
      reconciliacao: {
        atual: { status: "reconciliado", faturamentoFechamento: 412840, faturamentoDetalhe: 412840, ajusteIdentificado: 0, diferenca: 0 },
        anterior: { status: "reconciliado", faturamentoFechamento: 380910, faturamentoDetalhe: 380910, ajusteIdentificado: 0, diferenca: 0 },
      },
      origem: { atual: "orders_api", anterior: "orders_api", geradoEm: "2026-09-01T06:12:00Z" },
      fonte: "fechamento_api_central_vendas",
    },

    ads: {
      disponivel: true,
      natureza: "descritivo",
      leitura: "O investimento em Ads subiu 20,4% e o TACoS passou de 4,7% para 5,2% — Ads cresceu acima do resultado operacional (+11,4%).",
      atual: {
        valor: 21640, status: "carregado", fonte: "mercado_ads", competencia: "2026-08", periodo: null,
        atualizadoEm: "2026-09-01T12:00:00Z", motivo: null,
        tacos: 0.0524, resultadoAposAds: 51637, margemAposAds: 0.1251,
      },
      anterior: { valor: 17980, status: "carregado", fonte: "mercado_ads", tacos: 0.0472, resultadoAposAds: 47776, margemAposAds: 0.1254 },
      variacoes: { abs: 3660, pct: 0.2036, tacosPp: 0.52, resultadoAposAds: 3861 },
    },

    ponte: {
      base: "resultadoOperacional",
      inicio: 65756, fim: 73277, delta: 7521,
      residuo: 0, fecha: true, divergencia: null,
      linhas: PONTE_LINHAS.map((l) => ({ ...l })),
    },

    produtos: {
      ajudaram: AJUDARAM,
      prejudicaram: PREJUDICARAM,
      noVermelho: NO_VERMELHO,
      abaixoDaMargem: ABAIXO_DA_MARGEM,
      curvaAEmRisco: CURVA_A_EM_RISCO,
      totais: { noVermelho: NO_VERMELHO.length, abaixoDaMargem: ABAIXO_DA_MARGEM.length, analisados: 186 },
    },

    oportunidades: {
      totalRecuperavel: round2(RECUPERAVEL_PRODUTO + RECUPERAVEL_MARGEM + RECUPERAVEL_CUSTO + RECUPERAVEL_FRETE),
      escopo: "operacional",
      observacao: "Total recuperável considera apenas oportunidades operacionais comprováveis (custo, frete, preço, comissão, imposto, mix). Investimento em Ads não entra.",
      oportunidades: [
        {
          tipo: "issue", severidade: "critico", titulo: `${ABAIXO_DA_MARGEM.length} produtos abaixo da margem-alvo`,
          fator: "margem", recuperavelEstimado: RECUPERAVEL_MARGEM, contaNoTotal: true,
          descricao: "Itens com margem positiva, porém abaixo do alvo de 15% configurado para esta operação.",
          acaoRecomendada: "Subir preço ou renegociar custo até o alvo, mantido o faturamento.",
          destino: "bases.html",
          produtos: ABAIXO_DA_MARGEM.map((p) => ({ mlb: p.mlb, titulo: p.titulo, recuperavel: p.recuperavelAteAlvo })),
        },
        {
          tipo: "issue", severidade: "critico", titulo: `${NO_VERMELHO.length} produtos com resultado negativo`,
          fator: "produto", recuperavelEstimado: RECUPERAVEL_PRODUTO, contaNoTotal: true,
          descricao: "Estes itens vendem abaixo do custo variável — cada unidade vendida aprofunda o prejuízo.",
          acaoRecomendada: "Subir preço ao ponto de equilíbrio ou pausar o anúncio.",
          destino: "bases.html",
          produtos: NO_VERMELHO.map((p) => ({ mlb: p.mlb, titulo: p.titulo, resultado: p.resultado, faturamento: p.faturamento })),
        },
        {
          tipo: "issue", severidade: "critico", titulo: "Custo do produto corroeu margem",
          fator: "custo", recuperavelEstimado: RECUPERAVEL_CUSTO, contaNoTotal: true,
          descricao: "O custo unitário subiu frente a julho nos itens comparáveis.",
          acaoRecomendada: "Revisar a atualização de base de 12/08 nos itens listados.",
          destino: "bases.html",
          produtos: [
            { mlb: "MLB2210044", titulo: porMlb.MLB2210044.titulo, impacto: -1740 },
            { mlb: "MLB2903461", titulo: porMlb.MLB2903461.titulo, impacto: -870 },
          ],
        },
        {
          tipo: "issue", severidade: "atencao", titulo: "Frete subiu na faixa de peso dos itens grandes",
          fator: "frete", recuperavelEstimado: RECUPERAVEL_FRETE, contaNoTotal: true,
          descricao: "Dois itens passaram de faixa e o frete médio por pedido subiu.",
          acaoRecomendada: "Revisar embalagem e dimensões cadastradas no anúncio.",
          destino: "bases.html",
          produtos: [
            { mlb: "MLB3785220", titulo: porMlb.MLB3785220.titulo, impacto: -640 },
            { mlb: "MLB1550983", titulo: porMlb.MLB1550983.titulo, impacto: -300 },
          ],
        },
        {
          tipo: "alerta", severidade: "atencao", titulo: "22 pedidos sem custo apurado",
          fator: "dado", recuperavelEstimado: null, contaNoTotal: false,
          descricao: "R$ 8.140,00 de receita ficou fora do resultado por falta de custo. O valor recuperável desses itens não é estimável enquanto o custo não existir.",
          acaoRecomendada: "Completar a base de custo dos SKUs envolvidos.",
          destino: "bases.html",
          produtos: [],
        },
      ],
    },

    narrativa: {
      titulo: "O resultado operacional subiu R$ 7.521,00 (11,4%) em agosto contra julho.",
      texto: "Volume (+R$ 6.080) e preço médio (+R$ 3.940) puxaram o resultado para cima; custo do produto (−R$ 2.610) e frete (−R$ 940) puxaram para baixo.",
      escopo: "operacional",
      drivers: {
        positivos: [{ chave: "volume", label: "Volume", impacto: 6080 }, { chave: "preco", label: "Preço médio", impacto: 3940 }],
        negativos: [{ chave: "custo", label: "Custo do produto", impacto: -2610 }],
      },
    },

    simulacao: {
      endpoint: "/operacao/cliente-360/casa-viva/resultado/simular",
      competencia: "2026-08",
      produtos: CATALOGO.map((p) => ({
        mlb: p.mlb, titulo: p.titulo, unidades: p.unidades, precoMedio: p.precoMedio,
        custoUnitario: p.custoUnitario, freteUnitario: p.freteUnitario,
        comissaoUnitaria: p.comissaoUnitaria, impostoUnitario: p.impostoUnitario,
        margemUnitaria: p.margemUnitaria, receita: p.faturamento, resultado: p.resultado,
        margem: p.margem, noVermelho: p.resultado < 0,
      })),
      adsMantido: 21640,
      adsStatus: "carregado",
      resultadoOperacionalAtual: 73277,
      resultadoAposAdsAtual: 51637,
      cenariosRapidos: [
        { chave: "parar_vermelho", label: "Parar produtos no vermelho", descricao: "Pausa todos os itens com margem de contribuição negativa." },
        { chave: "subir_precos_5", label: "Subir preços 5%", descricao: "Aplica +5% no preço de todos os itens ativos." },
        { chave: "reduzir_custos_5", label: "Reduzir custos 5%", descricao: "Aplica −5% no custo unitário de todos os itens ativos." },
        { chave: "limpar", label: "Limpar", descricao: "Remove todas as intervenções." },
      ],
    },

    placar: { disponivel: true, endpoint: "/operacao/cliente-360/casa-viva/placar", escopo: "operacional" },
  };
}

// Motor de Margem: status por item derivado do MESMO resultado do catálogo —
// prejuízo, margem baixa, saudável — mais dois casos que só o Motor conhece
// (item sem custo no catálogo e dado suspeito).
function margemFixture() {
  const entradas = CATALOGO.map((p) => {
    let status = "HEALTHY";
    if (p.margem < 0) status = "LOSS";
    else if (p.margem < ALVO_MARGEM) status = "LOW_MARGIN";
    return [p.mlb, {
      titulo: p.titulo, status,
      statusLabel: status === "LOSS" ? "Prejuízo" : status === "LOW_MARGIN" ? "Margem baixa" : "Saudável",
      margemPercent: p.margem, margemTipo: "liquida", identidade: "found", confidence: "high",
      problemaPrincipal: status === "LOSS" ? "Preço abaixo do custo variável apurado." : null,
    }];
  });

  entradas.push(["MLB1739502", {
    titulo: porMlb.MLB1739502.titulo, status: "SUSPECT_DATA", statusLabel: "Dado suspeito",
    margemPercent: null, margemTipo: "liquida", identidade: "found", confidence: "low",
    problemaPrincipal: "Custo cadastrado é maior que o preço de venda em 2 variações.",
  }]);
  entradas.push(["MLB9900011", {
    titulo: "SKU sem vínculo no catálogo", identidade: "missing",
    motivo: "Item vendido no período não foi encontrado na base de custo desta conta.",
  }]);

  return { dados: { aplicavel: true, porMlb: Object.fromEntries(entradas) }, carregando: false, erro: null };
}

const SAUDE_OK = {
  grantBase: {
    disponivel: true, escopo: "account",
    dados: { grantConectado: true, grantStatus: "valid", baseVinculada: true, baseSlug: "casa-viva-meli-2026" },
  },
  sync: {
    disponivel: true, escopo: "account",
    dados: {
      ultimasExecucoes: [
        { fonte: "orders_api", started_at: "2026-09-01T06:00:00Z", status: "completed" },
        { fonte: "resumo_mensal", started_at: "2026-09-01T06:05:00Z", status: "completed" },
      ],
    },
  },
  entrega: {
    disponivel: true, escopo: "account",
    dados: { ultimaEntrega: { periodo: "2026-08", cliente_conta_id: 91 }, escopoEntrega: "account" },
  },
};

const HISTORICO_OK = {
  dados: {
    eventos: [
      { tipo: "entrega", escopo: "account", timestamp: "2026-09-01T09:14:00Z", titulo: "Fechamento de agosto publicado", competencia: "2026-08", ator: "consultor@venforce.com.br" },
      { tipo: "sincronizacao", escopo: "account", timestamp: "2026-09-01T06:05:00Z", titulo: "Sincronização orders_api concluída", ator: null },
      { tipo: "acao", escopo: "client_legacy", timestamp: "2026-08-12T15:40:00Z", titulo: "Base de custo atualizada (94 SKUs)", competencia: "2026-08", ator: "consultor@venforce.com.br" },
      { tipo: "acao", escopo: "account", timestamp: "2026-08-06T11:02:00Z", titulo: "Reprecificação aplicada em 12 anúncios", competencia: "2026-08", ator: "consultor@venforce.com.br" },
      { tipo: "sincronizacao", escopo: "account", timestamp: "2026-08-01T06:03:00Z", titulo: "Sincronização orders_api concluída", ator: null },
    ],
    fontes: { entregas: { disponivel: true }, sincronizacao: { disponivel: true }, acoes: { disponivel: true } },
  },
  carregando: false,
  erro: null,
};

const PERIODOS = ["2026-09", "2026-08", "2026-07", "2026-06", "2026-05", "2026-04"];

export function criarFixturePreview(estado) {
  const base = {
    // O contexto da operação é conhecido pelo Shell ANTES de qualquer
    // requisição — por isso ele existe em todos os estados, inclusive
    // "indisponível" e "carregando".
    contexto: { nome: "Casa Viva Utilidades", slug: "casa-viva", marketplace: "meli" },
    periodos: PERIODOS,
    periodo: "2026-08",
    carregando: false,
    pedirMargem: () => {},
    margem: margemFixture(),
    saudeAds: { ads: { disponivel: true, dados: { investimentoAds: 21640, gmvAds: 164780, roas: 7.61, acos: 13.13 } }, saude: SAUDE_OK, carregando: false, erro: null },
    historico: HISTORICO_OK,
  };

  if (estado === "carregando") {
    return {
      ...base,
      carregando: true,
      resultado: null,
      margem: { dados: null, carregando: false, erro: null },
      saudeAds: { ads: null, saude: null, carregando: true, erro: null },
      historico: { dados: null, carregando: true, erro: null },
    };
  }

  if (estado === "indisponivel") {
    return {
      ...base,
      resultado: {
        disponivel: false,
        motivo: "O motor de resultado não respondeu para esta competência (timeout em fechamento_api_central_vendas). Nenhum número foi estimado no lugar.",
      },
      margem: { dados: null, carregando: false, erro: null },
      saudeAds: { ads: null, saude: null, carregando: false, erro: null },
      historico: { dados: null, carregando: false, erro: null },
    };
  }

  const dados = payloadBase();

  if (estado === "atencao") {
    dados.estado = {
      chave: "atencao_dados",
      mensagem: "31 pedidos de agosto ainda não foram sincronizados — os números desta competência podem mudar.",
      bloqueante: false,
    };
    return {
      ...base,
      resultado: { disponivel: true, dados },
      // Grant caído: além da linha em Saúde, isso sobe para a faixa de bloqueio
      // do topo, porque muda o que a seção Ads pode mostrar.
      saudeAds: {
        ads: { disponivel: false, motivo: "A conta perdeu o grant do Mercado Ads — reconecte para voltar a ver investimento e ROAS." },
        saude: {
          ...SAUDE_OK,
          grantBase: {
            disponivel: true, escopo: "account",
            dados: { grantConectado: false, grantStatus: "expired", baseVinculada: true, baseSlug: "casa-viva-meli-2026" },
          },
          sync: {
            disponivel: true, escopo: "account",
            dados: { ultimasExecucoes: [{ fonte: "orders_api", started_at: "2026-08-29T06:00:00Z", status: "failed" }] },
          },
        },
        carregando: false, erro: null,
      },
      historico: {
        ...HISTORICO_OK,
        dados: {
          ...HISTORICO_OK.dados,
          fontes: {
            entregas: { disponivel: true },
            sincronizacao: { disponivel: false, motivo: "central_vendas_sync_run_service não respondeu" },
            acoes: { disponivel: true },
          },
        },
      },
    };
  }

  if (estado === "confianca_parcial") {
    dados.confianca = {
      ...dados.confianca,
      nivel: "parcial",
      coberturaResultado: 0.87,
      coberturaCusto: 0.72,
      coberturaFrete: 0.94,
      receitaBloqueada: 53680,
      pedidosBloqueados: 141,
      pedidosParciais: 38,
      reconciliacao: {
        status: "divergente", faturamentoFechamento: 412840, faturamentoDetalhe: 408215,
        ajusteIdentificado: 2180, diferenca: 2445, origemAjuste: "ajuste_manual_fechamento",
      },
      alertas: [
        { chave: "custo_incompleto", severidade: "critico", mensagem: "28% do faturamento não tem custo apurado — a margem por item está subestimada.", fonte: "base de custo" },
        { chave: "reconciliacao", severidade: "atencao", mensagem: "R$ 2.445,00 de diferença sem origem identificada entre o detalhe e o total oficial.", fonte: "fechamento_api" },
      ],
    };
    // Sem custo em parte da base, a decomposição não reconstrói a variação: o
    // resíduo é declarado e vira coluna própria no waterfall.
    dados.ponte = {
      ...dados.ponte,
      linhas: dados.ponte.linhas.map((l) => (l.chave === "custo" ? { ...l, impacto: -1490 } : l)),
      residuo: 1120,
      fecha: false,
      divergencia: {
        valor: 1120, fonte: "decomposicao_pvm",
        mensagem: "A soma dos fatores não reconstrói a variação do resultado operacional. Os números são exibidos como estão.",
      },
    };
    // A narrativa vem do mesmo motor que a ponte: com o custo parcialmente
    // apurado, ela precisa citar o mesmo número que o gráfico mostra.
    dados.narrativa = {
      ...dados.narrativa,
      texto: "Volume (+R$ 6.080) e preço médio (+R$ 3.940) puxaram o resultado para cima; custo do produto (−R$ 1.490, apurado sobre 72% da base) e frete (−R$ 940) puxaram para baixo.",
    };
    return {
      ...base,
      resultado: { disponivel: true, dados },
      margem: { dados: { aplicavel: false, motivo: "O Motor de Margem só é aplicável quando o cliente tem exatamente uma conta Mercado Livre ativa. Esta operação tem duas." }, carregando: false, erro: null },
    };
  }

  return { ...base, resultado: { disponivel: true, dados } };
}
