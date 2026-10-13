// Contrato financeiro da tela de resultado: o React APRESENTA o summary do
// backend. null/undefined/"" → "—"; 0 → R$ 0,00; nada é recalculado.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResultadoProcessado } from "./ResultadoProcessado.jsx";
import { formatarValor } from "../shared/ValorFinanceiro.jsx";
import { kpisPrincipais, coberturas, leituraDoFechamento, metricasSecundarias } from "../../../utils/financeiro/resumoFechamento.js";

vi.mock("../../../services/apiClient.js", async (orig) => ({ ...(await orig()), ehAdmin: () => false }));

function kpi(chave) {
  return screen.getByTestId("kpis-processamento").querySelector(`[data-kpi="${chave}"] .vf-fin-kpi__valor`);
}

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

  it("summary.finalResult = null renderiza '—' no KPI", () => {
    render(<ResultadoProcessado processamento={processamento({ summary: { ...SUMMARY_MELI, finalResult: null } })} marketplace="meli" periodo="2026-10" />);
    expect(kpi("finalResult")).toHaveTextContent("—");
    expect(kpi("finalResult")).not.toHaveTextContent("R$ 0,00");
  });

  it("summary.finalResult = 0 renderiza R$ 0,00", () => {
    render(<ResultadoProcessado processamento={processamento({ summary: { ...SUMMARY_MELI, finalResult: 0 } })} marketplace="meli" periodo="2026-10" />);
    expect(kpi("finalResult")).toHaveTextContent("R$ 0,00");
  });

  it("MC Calculada usa contributionMarginCalculated (null honesto) em vez do legado averageContributionMargin", () => {
    const k = kpisPrincipais({ averageContributionMargin: 0, contributionMarginCalculated: null });
    expect(k.find((x) => x.chave === "mcCalculada").valor).toBeNull();
  });
});

describe("composição financeira · LC → Resultado Final", () => {
  const bloco = (comp, id) => comp.querySelector(`[data-bloco="${id}"]`);

  it("mostra LC, despesas com sinal e o finalResult DO BACKEND", () => {
    render(<ResultadoProcessado processamento={processamento()} marketplace="meli" periodo="2026-10" />);
    const comp = screen.getByRole("region", { name: "Composição financeira" });
    const resultado = bloco(comp, "resultado");
    expect(within(resultado).getByText("LC Total").nextSibling).toHaveTextContent("R$ 5.000,00");
    expect(comp.querySelector('[data-despesa="adsTotal"] dd')).toHaveTextContent("−R$ 1.500,00");
    expect(comp.querySelector('[data-despesa="affiliatesTotal"] dd')).toHaveTextContent("−R$ 700,00");
    expect(comp.querySelector('[data-despesa="venforceTotal"] dd')).toHaveTextContent("−R$ 1.100,00");
    expect(within(resultado).getByText("Resultado Final").nextSibling).toHaveTextContent("R$ 1.700,00");
  });

  it("os quatro grupos aparecem lado a lado, na ordem Receitas · Deduções · Custos/Investimentos · Resultado", () => {
    render(<ResultadoProcessado processamento={processamento()} marketplace="meli" periodo="2026-10" />);
    const comp = screen.getByRole("region", { name: "Composição financeira" });
    expect(Array.from(comp.querySelectorAll("[data-bloco]")).map((b) => b.dataset.bloco)).toEqual(["receitas", "deducoes", "investimentos", "resultado"]);
    expect(within(bloco(comp, "receitas")).getByText("Receita sem custo").nextSibling).toHaveTextContent("R$ 10.000,00");
  });

  it("não recalcula: se o backend diz 1.234, a tela diz 1.234 (mesmo que as parcelas somem outra coisa)", () => {
    render(<ResultadoProcessado processamento={processamento({ summary: { ...SUMMARY_MELI, finalResult: 1234 } })} marketplace="meli" periodo="2026-10" />);
    const comp = screen.getByRole("region", { name: "Composição financeira" });
    expect(within(bloco(comp, "resultado")).getByText("Resultado Final").nextSibling).toHaveTextContent("R$ 1.234,00");
  });

  it("despesa ausente é '—', zero real é R$ 0,00 (nunca o contrário)", () => {
    const { adsTotal, ...semAds } = SUMMARY_MELI;
    render(<ResultadoProcessado processamento={processamento({ summary: { ...semAds, venforceTotal: 0, affiliatesTotal: null } })} marketplace="meli" periodo="2026-10" />);
    const comp = screen.getByRole("region", { name: "Composição financeira" });
    expect(comp.querySelector('[data-despesa="adsTotal"]')).toBeNull();
    expect(comp.querySelector('[data-despesa="venforceTotal"] dd')).toHaveTextContent("R$ 0,00");
    expect(comp.querySelector('[data-despesa="affiliatesTotal"] dd')).toHaveTextContent("—");
  });

  it("Shopee não inventa FULL/custos adicionais (o motor não devolve)", () => {
    const { fullCostTotal, additionalCostsTotal, ...semFull } = SUMMARY_MELI;
    render(<ResultadoProcessado processamento={processamento({ summary: semFull })} marketplace="shopee" periodo="2026-10" />);
    const comp = screen.getByRole("region", { name: "Composição financeira" });
    expect(comp.querySelector('[data-despesa="fullCostTotal"]')).toBeNull();
    expect(comp.querySelector('[data-despesa="additionalCostsTotal"]')).toBeNull();
  });
});

describe("hierarquia da página · ordem das seções", () => {
  const ordem = (container) => Array.from(container.querySelectorAll("[data-secao]")).map((e) => e.dataset.secao);

  it("topo (KPIs + leitura ao lado) → reconciliação → composição → cobertura (compacta) → pendências → ações", () => {
    const { container } = render(
      <ResultadoProcessado
        processamento={processamento({ summary: { ...SUMMARY_MELI, orderAllTotalCount: 10, orderAllTotalRevenue: 1000, orderAllCompletedCount: 10, orderAllCompletedRevenue: 1000 } })}
        marketplace="shopee"
        periodo="2026-10"
        pendencias={() => <section data-secao="pendencias" />}
        acoes={<section data-secao="acoes" />}
      />
    );
    expect(ordem(container)).toEqual(["resultado", "leitura", "reconciliacao", "composicao", "cobertura", "pendencias", "acoes"]);
  });

  it("Cobertura é COMPACTA: uma linha por eixo, sem cartões altos", () => {
    const { container } = render(<ResultadoProcessado processamento={processamento()} marketplace="meli" periodo="2026-10" />);
    const cob = container.querySelector('[data-secao="cobertura"]');
    expect(cob).toHaveClass("vf-fin-secao--compacta");
    expect(cob.querySelectorAll(".vf-fin-cob__linha")).toHaveLength(2); // custo + financeiro, uma linha cada
    expect(cob.querySelector(".vf-fin-bloco")).toBeNull(); // nada de card grande
    expect(cob.querySelector(".vf-fin-cobertura__barra")).not.toBeNull();
  });

  it("Leitura: no máximo 3 alertas à vista; os demais ficam recolhidos", () => {
    const summary = { ...SUMMARY_MELI, refundsCount: 38, refundsTotal: -7120.4, lostRevenueTotal: 7120.4 };
    render(<ResultadoProcessado processamento={processamento({ summary, unmatchedIds: ["A", "B"] })} marketplace="meli" periodo="2026-10" />);
    const leitura = screen.getByRole("complementary", { name: "Leitura do fechamento" });
    const visiveis = within(within(leitura).getByRole("list", { name: "Pontos de atenção" })).getAllByRole("listitem");
    expect(visiveis.length).toBeLessThanOrEqual(3);
    const resumo = leitura.querySelector("details > summary");
    expect(resumo).toHaveTextContent(/Mais \d+ alertas?/);
    expect(leitura.querySelector("details").open).toBe(false);
  });

  it("os produtos NÃO fazem parte do resultado: a tabela vem depois, fora dele", () => {
    const { container } = render(<ResultadoProcessado processamento={processamento()} marketplace="meli" periodo="2026-10" />);
    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelector('[data-secao="produtos"]')).toBeNull();
  });

  it("KPIs: Resultado Final e os três totais são a faixa principal; margens e índices são apoio", () => {
    render(<ResultadoProcessado processamento={processamento()} marketplace="meli" periodo="2026-10" />);
    const raiz = screen.getByTestId("kpis-processamento");
    const principais = Array.from(raiz.querySelectorAll(".vf-fin-resumo__principal [data-kpi]")).map((e) => e.dataset.kpi);
    const apoio = Array.from(raiz.querySelectorAll(".vf-fin-resumo__apoio [data-kpi]")).map((e) => e.dataset.kpi);
    expect(principais).toEqual(["finalResult", "grossRevenueTotal", "paidRevenueTotal", "contributionProfitTotal"]);
    expect(apoio).toEqual(["mcCalculada", "finalMarginCalculated", "tacos", "tacox"]);
  });

  it("Leitura é um painel de APOIO dentro da faixa de topo, ao lado dos KPIs — não uma seção própria", () => {
    const { container } = render(<ResultadoProcessado processamento={processamento({ unmatchedIds: ["A", "B"] })} marketplace="meli" periodo="2026-10" />);
    const topo = container.querySelector(".vf-fin-topo");
    expect(topo.querySelector('[data-testid="kpis-processamento"]')).not.toBeNull();
    expect(topo.querySelector('aside[data-secao="leitura"]')).not.toBeNull();
    expect(container.querySelector('section[data-secao="leitura"]')).toBeNull();
  });

  it("Leitura: só os ALERTAS à vista; contexto e notas técnicas recolhidos; sem repetir modo/Resultado Final", () => {
    render(<ResultadoProcessado processamento={processamento({ unmatchedIds: ["A", "B"], summary: { ...SUMMARY_MELI, executiveNotes: ["Nota do motor."] } })} marketplace="meli" periodo="2026-10" />);
    const leitura = screen.getByRole("complementary", { name: "Leitura do fechamento" });
    const alertas = within(leitura).getByRole("list", { name: "Pontos de atenção" });
    expect(alertas).toHaveTextContent("2 produtos sem custo identificado.");
    expect(leitura).not.toHaveTextContent("Resultado Final positivo");
    expect(leitura).not.toHaveTextContent("Fechamento em modo");
    const recolhido = leitura.querySelector("details");
    expect(recolhido).not.toBeNull();
    expect(recolhido.open).toBe(false);
    expect(within(recolhido).getByRole("list", { name: "Notas técnicas do motor" })).toBeInTheDocument();
  });

  it("sem alertas: diz que não há ponto de atenção (em vez de lista vazia)", () => {
    render(<ResultadoProcessado processamento={processamento({ summary: { finalResult: 10, grossRevenueTotal: 100, calculatedCoveragePercent: 100 }, unmatchedIds: [] })} marketplace="meli" periodo="2026-10" />);
    expect(within(screen.getByRole("complementary", { name: "Leitura do fechamento" })).getByText("Nenhum ponto de atenção.")).toBeInTheDocument();
  });

  it("eventos do período (cancelados/não pagos/devoluções) ficam na faixa de topo, junto dos KPIs", () => {
    const { container } = render(<ResultadoProcessado processamento={processamento({ summary: { ...SUMMARY_MELI, cancelledCount: 4, unpaidCount: 1 } })} marketplace="shopee" periodo="2026-10" />);
    expect(container.querySelector('.vf-fin-topo__numeros [aria-label="Eventos do período"]')).not.toBeNull();
    expect(container.querySelector('[data-secao="cobertura"] [aria-label="Eventos do período"]')).toBeNull();
  });
});

describe("coberturas · custo ≠ financeiro", () => {
  it("os dois eixos aparecem separados, cada um com seus números", () => {
    render(<ResultadoProcessado processamento={processamento()} marketplace="meli" periodo="2026-10" />);
    const custo = screen.getByRole("region", { name: "Cobertura de custos" });
    const fin = screen.getByRole("region", { name: "Cobertura financeira" });
    expect(custo).toHaveTextContent("90,0%");
    expect(custo).toHaveTextContent("Receita sem custo");
    expect(custo).toHaveTextContent("R$ 10.000,00");
    expect(custo).not.toHaveTextContent("aguardando");
    expect(fin).toHaveTextContent("95,0%");
    expect(fin).toHaveTextContent("Receita aguardando financeiro");
    expect(fin).toHaveTextContent("R$ 5.000,00");
    expect(fin).not.toHaveTextContent("sem custo");
  });

  it("produtos sem custo e ambíguos contam separados (ambíguo não é 'sem custo')", () => {
    const c = coberturas(SUMMARY_MELI, { unmatchedIds: ["A", "B"] });
    expect(c.custo.produtosSemCusto).toBe(2);
    expect(c.custo.custosAmbiguos).toBe(1);
  });

  it("motor sem eixo financeiro (Shopee) diz que não se aplica, sem inventar 0%", () => {
    const { revenueWithFinancialData, revenuePendingFinancial, financialDataCoveragePercent, salesPendingFinancialCount, ...shopee } = SUMMARY_MELI;
    render(<ResultadoProcessado processamento={processamento({ summary: shopee })} marketplace="shopee" periodo="2026-10" />);
    const fin = screen.getByRole("complementary", { name: "Cobertura financeira" });
    expect(fin).toHaveTextContent("este motor não separa financeiro disponível × pendente");
    expect(fin).not.toHaveTextContent("0,0%");
    // nota compacta, não um card do tamanho da cobertura de custo
    expect(screen.queryByRole("region", { name: "Cobertura financeira" })).not.toBeInTheDocument();
  });
});

describe("leitura e métricas", () => {
  it("leitura determinística explica por que o fechamento é parcial", () => {
    const frases = leituraDoFechamento({ summary: SUMMARY_MELI, marketplace: "meli", unmatchedIds: ["A", "B"] }).map((f) => f.texto);
    expect(frases).toContain("Resultado Final positivo: R$ 1.700,00.");
    expect(frases.some((f) => f.startsWith("Cobertura da base de custos em 90,0%"))).toBe(true);
    expect(frases.some((f) => f.includes("R$ 10.000,00 da receita estão sem custo"))).toBe(true);
    expect(frases).toContain("2 produtos sem custo identificado.");
    expect(frases.some((f) => f.startsWith("3 vendas (R$ 5.000,00) aguardando financeiro"))).toBe(true);
  });

  it("valor ausente na leitura não vira R$ 0,00", () => {
    const frases = leituraDoFechamento({ summary: { cancelledCount: 3, cancelledLostRevenue: null }, marketplace: "shopee" }).map((f) => f.texto);
    expect(frases).toContain("3 pedidos cancelados confirmados.");
  });

  it("métricas Shopee não aparecem no MELI", () => {
    const meli = metricasSecundarias({ ...SUMMARY_MELI, cancelledCount: 4, unpaidCount: 1 }, "meli").map((m) => m.chave);
    expect(meli).not.toContain("cancelledCount");
    expect(meli).not.toContain("unpaidCount");
    const shopee = metricasSecundarias({ cancelledCount: 4, unpaidCount: 0 }, "shopee");
    expect(shopee.find((m) => m.chave === "unpaidCount").valor).toBe(0);
  });
});

describe("download da planilha processada", () => {
  it("usa o excelBase64 do backend, com nome por marketplace e competência", async () => {
    const usuario = userEvent.setup();
    const criar = vi.fn(() => "blob:x");
    globalThis.URL.createObjectURL = criar;
    globalThis.URL.revokeObjectURL = vi.fn();
    const clique = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<ResultadoProcessado processamento={processamento()} marketplace="shopee" periodo="2026-10" />);
    await usuario.click(screen.getByRole("button", { name: "Baixar planilha processada" }));
    expect(criar).toHaveBeenCalled();
    const anchor = clique.mock.instances[0];
    expect(anchor.download).toBe("fechamento-shopee-2026-10.xlsx");
    clique.mockRestore();
  });

  it("sem excelBase64, não oferece o botão", () => {
    render(<ResultadoProcessado processamento={processamento({ excelBase64: undefined })} marketplace="meli" periodo="2026-10" />);
    expect(screen.queryByRole("button", { name: "Baixar planilha processada" })).not.toBeInTheDocument();
  });
});

// Paridade de DADOS com o legado: os mesmos campos do summary que o legado
// lê aparecem na V3 com o valor exato do backend (só formatação pt-BR).
describe("paridade de dados · summary → tela", () => {
  it.each([
    ["grossRevenueTotal", "R$ 100.000,00"],
    ["paidRevenueTotal", "R$ 82.000,50"],
    ["contributionProfitTotal", "R$ 5.000,00"],
    ["finalResult", "R$ 1.700,00"],
    ["mcCalculada", "5,9%"],
    ["finalMarginCalculated", "2,0%"],
    ["tacos", "1,5%"],
    ["tacox", "3,3%"],
  ])("%s → %s", (chave, esperado) => {
    render(<ResultadoProcessado processamento={processamento()} marketplace="meli" periodo="2026-10" />);
    expect(kpi(chave)).toHaveTextContent(esperado);
  });

  it("revenueWithCost, revenueWithoutCost, coberturas e financeiro aparecem com o valor do backend", () => {
    render(<ResultadoProcessado processamento={processamento()} marketplace="meli" periodo="2026-10" />);
    const custo = screen.getByRole("region", { name: "Cobertura de custos" });
    expect(within(custo).getByText("Receita com custo").nextSibling).toHaveTextContent("R$ 90.000,00");
    expect(within(custo).getByText("Receita sem custo").nextSibling).toHaveTextContent("R$ 10.000,00");
    const fin = screen.getByRole("region", { name: "Cobertura financeira" });
    expect(within(fin).getByText("Receita com financeiro disponível").nextSibling).toHaveTextContent("R$ 95.000,00");
    expect(within(fin).getByText("Receita aguardando financeiro").nextSibling).toHaveTextContent("R$ 5.000,00");
  });
});
