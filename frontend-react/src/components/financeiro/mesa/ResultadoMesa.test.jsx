// A mesa do fechamento (modelo B): destaque, cascata "Da receita ao
// resultado" e o drawer de Detalhes. Regra de todos: o número é o do
// backend — null vira "—", zero real vira R$ 0,00 e nada é recalculado.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ResultadoDestaque } from "./ResultadoDestaque.jsx";
import { ReceitaAoResultado } from "./ReceitaAoResultado.jsx";
import { DetalhesFechamento } from "./DetalhesFechamento.jsx";
import { formatarValor } from "../shared/ValorFinanceiro.jsx";
import { kpisPrincipais, coberturas, leituraDoFechamento, metricasSecundarias } from "../../../utils/financeiro/resumoFechamento.js";
import { degrausDoResultado, etapasDoFechamento, resumoDePendencias } from "../../../utils/financeiro/mesa.js";

vi.mock("../../../services/apiClient.js", async (orig) => ({ ...(await orig()), ehAdmin: () => false }));

const SUMMARY_MELI = {
  calculationMode: "real_meli_vendas",
  financialConfidence: "parcial",
  grossRevenueTotal: 100000,
  paidRevenueTotal: 82000.5,
  revenueWithCost: 90000,
  revenueWithoutCost: 10000,
  calculatedCoveragePercent: 90,
  revenueWithFinancialData: 95000,
  revenuePendingFinancial: 5000,
  financialDataCoveragePercent: 95,
  salesPendingFinancialCount: 3,
  contributionProfitTotal: 5000,
  averageContributionMargin: 0.06,
  contributionMarginCalculated: 0.0588,
  finalResult: 1700,
  finalMarginCalculated: 0.02,
  tacos: 0.015,
  tacox: 0.033,
  adsTotal: 1500,
  venforceTotal: 1100,
  affiliatesTotal: 700,
  fullCostTotal: 0,
  additionalCostsTotal: 0,
  refundsCount: 2,
  refundsTotal: -300,
  lostRevenueTotal: 300,
  ambiguousCostIds: ["MLB9"],
};

function processamento(extra = {}) {
  return {
    summary: SUMMARY_MELI,
    competencia: { divergente: false },
    unmatchedIds: ["MLB1", "MLB2"],
    unmatchedCosts: [],
    detailedRows: [],
    excelBase64: btoa("xlsx"),
    costsSource: "base",
    costsBase: { slug: "base-x", nome: "Base X" },
    ...extra,
  };
}

beforeEach(() => vi.clearAllMocks());

function kpi(chave) {
  const raiz = screen.getByTestId("kpis-processamento");
  return chave === "finalResult"
    ? raiz.querySelector(".vf-fin-mesa-destaque__valor")
    : raiz.querySelector(`[data-kpi="${chave}"] .vf-fin-mesa-kpi__valor`);
}

const destaque = (summary = SUMMARY_MELI) => render(<ResultadoDestaque summary={summary} periodoLabel="Outubro/2026" />);
const detalhes = (extra = {}, marketplace = "meli") => render(<DetalhesFechamento processamento={processamento(extra)} marketplace={marketplace} />);

describe("formatação · null ≠ 0", () => {
  it("null, undefined e string vazia viram '—', nunca R$ 0,00", () => {
    expect(formatarValor(null)).toBe("—");
    expect(formatarValor(undefined)).toBe("—");
    expect(formatarValor("")).toBe("—");
    expect(formatarValor(null, "fracao")).toBe("—");
  });
  it("zero real vira R$ 0,00 / 0,0%", () => {
    expect(formatarValor(0)).toBe("R$ 0,00");
    expect(formatarValor(0, "fracao")).toBe("0,0%");
    expect(formatarValor(0, "pontos")).toBe("0,0%");
  });

  it("summary.finalResult = null renderiza '—' no destaque", () => {
    destaque({ ...SUMMARY_MELI, finalResult: null });
    expect(kpi("finalResult")).toHaveTextContent("—");
    expect(kpi("finalResult")).not.toHaveTextContent("R$ 0,00");
  });

  it("summary.finalResult = 0 renderiza R$ 0,00", () => {
    destaque({ ...SUMMARY_MELI, finalResult: 0 });
    expect(kpi("finalResult")).toHaveTextContent("R$ 0,00");
  });

  it("MC Calculada usa contributionMarginCalculated (null honesto) em vez do legado averageContributionMargin", () => {
    const k = kpisPrincipais({ averageContributionMargin: 0, contributionMarginCalculated: null });
    expect(k.find((x) => x.chave === "mcCalculada").valor).toBeNull();
  });
});

describe("destaque · Resultado final + seis números", () => {
  it("Resultado final em destaque e seis números ao lado, na ordem do modelo B", () => {
    destaque();
    const raiz = screen.getByTestId("kpis-processamento");
    const grade = Array.from(raiz.querySelectorAll(".vf-fin-mesa-destaque__grade [data-kpi]")).map((e) => e.dataset.kpi);
    expect(grade).toEqual(["grossRevenueTotal", "paidRevenueTotal", "contributionProfitTotal", "tacos", "tacox", "calculatedCoveragePercent"]);
    expect(raiz.querySelector(".vf-fin-mesa-destaque__resultado")).toHaveTextContent("Resultado final · Outubro/2026");
  });

  it("o Resultado ganha cor pelo sinal (o cartão é claro, como os KPIs de Anúncios ML)", () => {
    const { rerender } = destaque({ ...SUMMARY_MELI, finalResult: -50 });
    const resultado = () => screen.getByTestId("kpis-processamento").querySelector(".vf-fin-mesa-destaque__resultado");
    expect(resultado()).toHaveClass("is-negativo");
    rerender(<ResultadoDestaque summary={SUMMARY_MELI} periodoLabel="Outubro/2026" />);
    expect(resultado()).toHaveClass("is-positivo");
  });

  it.each([
    ["grossRevenueTotal", "R$ 100.000,00"],
    ["paidRevenueTotal", "R$ 82.000,50"],
    ["contributionProfitTotal", "R$ 5.000,00"],
    ["finalResult", "R$ 1.700,00"],
    ["tacos", "1,5%"],
    ["tacox", "3,3%"],
    ["calculatedCoveragePercent", "90,0%"],
  ])("paridade: %s → %s", (chave, esperado) => {
    destaque();
    expect(kpi(chave)).toHaveTextContent(esperado);
  });

  it("MC calculada e MC final aparecem como apoio, com o valor do backend", () => {
    destaque();
    const raiz = screen.getByTestId("kpis-processamento");
    expect(raiz.querySelector('[data-kpi="contributionProfitTotal"]')).toHaveTextContent("MC calc. 5,9%");
    expect(raiz.querySelector(".vf-fin-mesa-destaque__apoio")).toHaveTextContent("MC final 2,0%");
  });
});

describe("cascata · Da receita ao resultado", () => {
  const degraus = (container) => Array.from(container.querySelectorAll("[data-degrau]")).map((d) => d.dataset.degrau);
  const valor = (container, chave) => container.querySelector(`[data-degrau="${chave}"] .vf-fin-mesa-cascata__valor`);

  it("degraus: receitas → LC → despesas do período → Resultado final", () => {
    const { container } = render(<ReceitaAoResultado summary={SUMMARY_MELI} />);
    expect(degraus(container)).toEqual(["grossRevenueTotal", "paidRevenueTotal", "contributionProfitTotal", "adsTotal", "venforceTotal", "affiliatesTotal", "finalResult"]);
  });

  it("despesas com sinal de menos; o Resultado é o do BACKEND (não a soma)", () => {
    const { container } = render(<ReceitaAoResultado summary={{ ...SUMMARY_MELI, finalResult: 1234 }} />);
    expect(valor(container, "adsTotal")).toHaveTextContent("−R$ 1.500,00");
    expect(valor(container, "venforceTotal")).toHaveTextContent("−R$ 1.100,00");
    expect(valor(container, "finalResult")).toHaveTextContent("R$ 1.234,00");
  });

  it("despesa zerada ou ausente não vira degrau; total ausente vira '—' sem barra", () => {
    const { container } = render(<ReceitaAoResultado summary={{ ...SUMMARY_MELI, paidRevenueTotal: null }} />);
    expect(container.querySelector('[data-degrau="fullCostTotal"]')).toBeNull();
    expect(valor(container, "paidRevenueTotal")).toHaveTextContent("—");
    expect(container.querySelector('[data-degrau="paidRevenueTotal"] .vf-fin-mesa-cascata__barra')).toBeNull();
  });

  it("Baixar planilha e Detalhes só aparecem quando a mesa os oferece", () => {
    const { rerender } = render(<ReceitaAoResultado summary={SUMMARY_MELI} />);
    expect(screen.queryByRole("button", { name: "Baixar planilha" })).not.toBeInTheDocument();
    rerender(<ReceitaAoResultado summary={SUMMARY_MELI} onBaixarPlanilha={() => {}} onDetalhes={() => {}} />);
    expect(screen.getByRole("button", { name: "Baixar planilha" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Detalhes" })).toBeInTheDocument();
  });

  it("as barras ficam dentro do trilho (0–100%)", () => {
    for (const d of degrausDoResultado({ ...SUMMARY_MELI, finalResult: -20000 })) {
      if (!d.barra) continue;
      expect(d.barra.inicio).toBeGreaterThanOrEqual(0);
      expect(d.barra.inicio + d.barra.largura).toBeLessThanOrEqual(100.5);
    }
  });
});

describe("detalhes · o detalhamento completo (drawer)", () => {
  const bloco = (comp, id) => comp.querySelector(`[data-bloco="${id}"]`);

  it("ordem: leitura → reconciliação → composição → cobertura", () => {
    const { container } = detalhes({ summary: { ...SUMMARY_MELI, orderAllTotalCount: 10, orderAllTotalRevenue: 1000, orderAllCompletedCount: 10, orderAllCompletedRevenue: 1000 } }, "shopee");
    const ordem = Array.from(container.querySelectorAll("[data-secao]")).map((e) => e.dataset.secao);
    expect(ordem).toEqual(["leitura", "reconciliacao", "composicao", "cobertura"]);
  });

  it("composição: LC, despesas com sinal e o finalResult DO BACKEND", () => {
    detalhes();
    const comp = screen.getByRole("region", { name: "Composição financeira" });
    const resultado = bloco(comp, "resultado");
    expect(within(resultado).getByText("LC Total").nextSibling).toHaveTextContent("R$ 5.000,00");
    expect(comp.querySelector('[data-despesa="adsTotal"] dd')).toHaveTextContent("−R$ 1.500,00");
    expect(within(resultado).getByText("Resultado Final").nextSibling).toHaveTextContent("R$ 1.700,00");
    expect(Array.from(comp.querySelectorAll("[data-bloco]")).map((b) => b.dataset.bloco)).toEqual(["receitas", "deducoes", "investimentos", "resultado"]);
  });

  it("despesa ausente é '—', zero real é R$ 0,00 (nunca o contrário)", () => {
    const { adsTotal, ...semAds } = SUMMARY_MELI;
    detalhes({ summary: { ...semAds, venforceTotal: 0, affiliatesTotal: null } });
    const comp = screen.getByRole("region", { name: "Composição financeira" });
    expect(comp.querySelector('[data-despesa="adsTotal"]')).toBeNull();
    expect(comp.querySelector('[data-despesa="venforceTotal"] dd')).toHaveTextContent("R$ 0,00");
    expect(comp.querySelector('[data-despesa="affiliatesTotal"] dd')).toHaveTextContent("—");
  });

  it("composição tem as linhas do legado: Receitas com financeiro publicado e cobertura; Resultado com o status do fechamento", () => {
    detalhes();
    const comp = screen.getByRole("region", { name: "Composição financeira" });
    const rotulos = (id) => Array.from(comp.querySelectorAll(`[data-bloco="${id}"] dt`)).map((d) => d.textContent);
    expect(rotulos("receitas")).toEqual(["Receita Bruta Total", "Receita Líquida", "Financeiro publicado", "Aguardando financeiro", "Receita com custo", "Receita sem custo", "Cobertura da base"]);
    expect(rotulos("resultado")).toEqual(["LC Total", "MC Calculada", "Resultado Final", "MC Final", "TACoS", "TACoX", "Status do fechamento"]);
  });

  it("Shopee (motor sem eixo financeiro) não mostra 'Financeiro publicado' nem FULL", () => {
    const { revenueWithFinancialData, revenuePendingFinancial, financialDataCoveragePercent, salesPendingFinancialCount, fullCostTotal, additionalCostsTotal, ...shopee } = SUMMARY_MELI;
    detalhes({ summary: shopee }, "shopee");
    const comp = screen.getByRole("region", { name: "Composição financeira" });
    expect(within(bloco(comp, "receitas")).queryByText("Financeiro publicado")).not.toBeInTheDocument();
    expect(comp.querySelector('[data-despesa="fullCostTotal"]')).toBeNull();
  });

  it("eventos do período ficam na composição, abaixo dos 4 cartões", () => {
    const { container } = detalhes({ summary: { ...SUMMARY_MELI, cancelledCount: 4, unpaidCount: 1 } }, "shopee");
    expect(container.querySelector('[data-secao="composicao"] [aria-label="Eventos do período"]')).not.toBeNull();
    expect(container.querySelector('[data-secao="cobertura"] [aria-label="Eventos do período"]')).toBeNull();
  });

  it("cobertura: custo e financeiro separados, cada um com seus números", () => {
    detalhes();
    const custo = screen.getByRole("region", { name: "Cobertura de custos" });
    const fin = screen.getByRole("region", { name: "Cobertura financeira" });
    expect(custo).toHaveTextContent("90,0%");
    expect(custo).toHaveTextContent("R$ 10.000,00");
    expect(fin).toHaveTextContent("95,0%");
    expect(fin).toHaveTextContent("Receita aguardando financeiro");
  });

  it("leitura: no máximo 3 alertas à vista; os demais ficam recolhidos", () => {
    detalhes({ summary: { ...SUMMARY_MELI, refundsCount: 38, refundsTotal: -7120.4, lostRevenueTotal: 7120.4 }, unmatchedIds: ["A", "B"] });
    const leitura = screen.getByRole("complementary", { name: "Leitura do fechamento" });
    expect(within(within(leitura).getByRole("list", { name: "Pontos de atenção" })).getAllByRole("listitem").length).toBeLessThanOrEqual(3);
    expect(leitura.querySelector("details").open).toBe(false);
  });

  it("conciliação Mercado Pago só no MELI", () => {
    const conciliacao = { disponivel: false, motivo: "Mercado Pago ainda não conectado.", dados: null };
    const { rerender } = render(<DetalhesFechamento processamento={processamento()} marketplace="meli" conciliacao={conciliacao} />);
    expect(screen.getByRole("region", { name: "Conciliação Mercado Pago" })).toBeInTheDocument();
    rerender(<DetalhesFechamento processamento={processamento()} marketplace="shopee" conciliacao={conciliacao} />);
    expect(screen.queryByRole("region", { name: "Conciliação Mercado Pago" })).not.toBeInTheDocument();
  });
});

describe("funções puras da mesa", () => {
  it("coberturas: produtos sem custo e ambíguos contam separados", () => {
    const c = coberturas(SUMMARY_MELI, { unmatchedIds: ["A", "B"] });
    expect(c.custo.produtosSemCusto).toBe(2);
    expect(c.custo.custosAmbiguos).toBe(1);
  });

  it("resumoDePendencias soma sem custo + ambíguos e devolve a receita sem custo do backend", () => {
    expect(resumoDePendencias(SUMMARY_MELI, { unmatchedIds: ["A", "B"] })).toEqual({ produtos: 3, receitaSemCusto: 10000 });
  });

  it("etapas: a primeira não feita é a 'atual'; publicar só fica feita com entrega publicada", () => {
    const base = { status: "encontrada", override: false };
    const antes = etapasDoFechamento({ base, arquivos: { sales: null }, ajustes: 0, temResultado: false, salvoSemProcessar: false, pendencias: 0, entrega: null });
    expect(antes.map((e) => e.estado)).toEqual(["feita", "atual", "pendente", "pendente", "pendente", "pendente"]);
    const depois = etapasDoFechamento({ base, arquivos: { sales: {} }, ajustes: 0, temResultado: true, salvoSemProcessar: false, pendencias: 2, entrega: null });
    expect(depois.find((e) => e.id === "pendencias").estado).toBe("atual");
    const publicado = etapasDoFechamento({ base, arquivos: { sales: {} }, ajustes: 0, temResultado: true, salvoSemProcessar: false, pendencias: 0, entrega: { publicado: true } });
    expect(publicado.every((e) => e.estado === "feita")).toBe(true);
  });

  it("sem base vinculada, a etapa Base só fica feita com a planilha de custos", () => {
    const sem = etapasDoFechamento({ base: { status: "ausente" }, arquivos: { sales: null, costs: null }, ajustes: 0, temResultado: false, salvoSemProcessar: false, pendencias: 0, entrega: null });
    expect(sem[0].estado).toBe("atual");
    const com = etapasDoFechamento({ base: { status: "ausente" }, arquivos: { sales: null, costs: {} }, ajustes: 0, temResultado: false, salvoSemProcessar: false, pendencias: 0, entrega: null });
    expect(com[0].estado).toBe("feita");
  });

  it("leitura determinística explica por que o fechamento é parcial", () => {
    const frases = leituraDoFechamento({ summary: SUMMARY_MELI, marketplace: "meli", unmatchedIds: ["A", "B"] }).map((f) => f.texto);
    expect(frases).toContain("Resultado Final positivo: R$ 1.700,00.");
    expect(frases.some((f) => f.includes("R$ 10.000,00 da receita estão sem custo"))).toBe(true);
    expect(frases).toContain("2 produtos sem custo identificado.");
  });

  it("valor ausente na leitura não vira R$ 0,00", () => {
    const frases = leituraDoFechamento({ summary: { cancelledCount: 3, cancelledLostRevenue: null }, marketplace: "shopee" }).map((f) => f.texto);
    expect(frases).toContain("3 pedidos cancelados confirmados.");
  });

  it("métricas Shopee não aparecem no MELI", () => {
    const meli = metricasSecundarias({ ...SUMMARY_MELI, cancelledCount: 4, unpaidCount: 1 }, "meli").map((m) => m.chave);
    expect(meli).not.toContain("cancelledCount");
    const shopee = metricasSecundarias({ cancelledCount: 4, unpaidCount: 0 }, "shopee");
    expect(shopee.find((m) => m.chave === "unpaidCount").valor).toBe(0);
  });
});
