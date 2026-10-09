import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PendenciasCusto } from "./PendenciasCusto.jsx";
import { normalizarLinhas } from "../../../utils/financeiro/produtos.js";
import { agruparPendencias, montarCsvPendencias } from "../../../utils/financeiro/pendencias.js";

const api = vi.hoisted(() => ({ padrao: vi.fn(), upsert: vi.fn() }));
vi.mock("../../../services/basesCustoApi.js", () => ({
  obterPadraoCustoBase: api.padrao,
  registrarCustoNaBase: api.upsert,
}));

const linhasMeli = normalizarLinhas([
  { "# de anúncio": "MLB1", "Título do anúncio": "Calça", "Venda Total": 100, "Preço de custo": null, LC: null, MC: null, "Cobertura de custo": "sem custo" },
  { "# de anúncio": "MLB1", "Título do anúncio": "Calça", "Venda Total": 50, "Preço de custo": null, LC: null, MC: null, "Cobertura de custo": "sem custo" },
  { "# de anúncio": "MLB2", "Título do anúncio": "Blusa", "Venda Total": 70, "Preço de custo": null, LC: null, MC: null, "Cobertura de custo": "custo ambíguo" },
  { "# de anúncio": "MLB3", "Título do anúncio": "Saia", "Venda Total": 40, "Preço de custo": 10, LC: null, MC: null, "Cobertura de custo": "financeiro pendente" },
  { "# de anúncio": "MLB4", "Título do anúncio": "Top", "Venda Total": 90, "Preço de custo": 20, LC: 30, MC: 33, "Cobertura de custo": "com custo" },
]);

const base = { id: 9, slug: "base-zenite", nome: "Base Zenite" };
const processamentoBase = { costsSource: "base", costsBase: { slug: "base-zenite" }, unmatchedCosts: [] };

beforeEach(() => {
  vi.clearAllMocks();
  api.padrao.mockResolvedValue({ ok: true, padrao: { imposto_percentual: 8, taxa_fixa: 0 } });
  api.upsert.mockResolvedValue({ ok: true, acao: "criado" });
});

describe("agruparPendencias", () => {
  it("só linhas com custo não-ok, agrupadas por ID, com a receita somada; financeiro pendente COM custo não é pendência de custo", () => {
    const p = agruparPendencias(linhasMeli);
    expect(p.map((x) => x.itemId)).toEqual(["MLB1", "MLB2"]);
    expect(p[0].receitaImpactada).toBe(150);
    expect(p[0].linhas).toBe(2);
    expect(p[1].statusCusto).toBe("ambiguo");
  });

  it("motivo Shopee vem do diagnóstico tipado por IGUALDADE de ID", () => {
    const linhas = normalizarLinhas([{ Produto: "Kit", ID: "100", "ID Model": "555", "Vendas (Pedido pago) (BRL)": 10, "Cobertura de custo": "sem custo" }]);
    const p = agruparPendencias(linhas, { unmatchedCosts: [{ type: "variation_id", value: "555", reason: "cost_only_on_parent_item", parentItemId: "100", blockedBy: "multiple_variations_in_performance" }] });
    expect(p[0].motivo).toMatch(/^Custo somente no item pai \(ID Item 100\); o anúncio tem várias variações/);
    const semCasar = agruparPendencias(linhas, { unmatchedCosts: [{ type: "variation_id", value: "5550", reason: "zero_cost_in_base" }] });
    expect(semCasar[0].motivo).toBe("Não encontrado na base");
  });

  it("CSV traz as colunas pedidas, BOM e novo_custo vazio", () => {
    const csv = montarCsvPendencias(agruparPendencias(linhasMeli), { marketplace: "meli", cliente: "Zenite", conta: "ML 1", competencia: "2026-10" });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const [cab, l1] = csv.slice(1).split("\r\n");
    expect(cab).toBe("marketplace;cliente;conta;competencia;produto;item_id;variation_id;sku;model_id;motivo;receita_impactada;custo_atual;novo_custo");
    expect(l1).toBe("meli;Zenite;ML 1;2026-10;Calça;MLB1;;;;Não encontrado na base;150,00;;");
  });
});

describe("PendenciasCusto · ações", () => {
  it("MELI com base vinculada: corrigir custo mostra o registro, pede confirmação e só reprocessa após sucesso", async () => {
    const usuario = userEvent.setup();
    const reprocessar = vi.fn();
    render(<PendenciasCusto linhas={linhasMeli} processamento={processamentoBase} marketplace="meli" base={base} onReprocessar={reprocessar} />);

    const linha = screen.getByText("Calça").closest("tr");
    // ambíguo nunca ganha correção rápida
    expect(within(screen.getByText("Blusa").closest("tr")).queryByRole("button", { name: "Corrigir custo" })).not.toBeInTheDocument();

    await usuario.click(within(linha).getByRole("button", { name: "Corrigir custo" }));
    await usuario.type(within(linha).getByRole("textbox", { name: "Novo custo unitário" }), "12,50");
    await usuario.click(within(linha).getByRole("button", { name: "Revisar" }));
    expect(within(linha).getByText(/produto_id = MLB1/)).toBeInTheDocument();
    await waitFor(() => expect(within(linha).getByText(/imposto padrão da base \(8%\)/)).toBeInTheDocument());
    expect(api.upsert).not.toHaveBeenCalled();
    expect(reprocessar).not.toHaveBeenCalled();

    await usuario.click(within(linha).getByRole("button", { name: "Registrar na base e reprocessar" }));
    expect(api.upsert).toHaveBeenCalledWith("base-zenite", { produtoId: "MLB1", custoProduto: 12.5, produtoNome: "Calça" });
    await waitFor(() => expect(reprocessar).toHaveBeenCalledTimes(1));
  });

  it("falha ao registrar não reprocessa e mostra o erro", async () => {
    api.upsert.mockRejectedValueOnce(new Error("Base fora da sua carteira."));
    const usuario = userEvent.setup();
    const reprocessar = vi.fn();
    render(<PendenciasCusto linhas={linhasMeli} processamento={processamentoBase} marketplace="meli" base={base} onReprocessar={reprocessar} />);
    const linha = screen.getByText("Calça").closest("tr");
    await usuario.click(within(linha).getByRole("button", { name: "Corrigir custo" }));
    await usuario.type(within(linha).getByRole("textbox", { name: "Novo custo unitário" }), "10");
    await usuario.click(within(linha).getByRole("button", { name: "Revisar" }));
    await usuario.click(within(linha).getByRole("button", { name: "Registrar na base e reprocessar" }));
    expect(await within(linha).findByRole("alert")).toHaveTextContent("Base fora da sua carteira.");
    expect(reprocessar).not.toHaveBeenCalled();
  });

  it("custos de upload (não da base vinculada): sem correção rápida", () => {
    render(<PendenciasCusto linhas={linhasMeli} processamento={{ costsSource: "upload" }} marketplace="meli" base={base} onReprocessar={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Corrigir custo" })).not.toBeInTheDocument();
    expect(screen.getByText(/Correção rápida indisponível/)).toBeInTheDocument();
  });

  it("Shopee: nunca oferece correção rápida (não escolhe Item × Variação)", () => {
    const linhas = normalizarLinhas([{ Produto: "Kit", ID: "100", "ID Model": "555", "Vendas (Pedido pago) (BRL)": 10, "Cobertura de custo": "sem custo" }]);
    render(<PendenciasCusto linhas={linhas} processamento={processamentoBase} marketplace="shopee" base={base} onReprocessar={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Corrigir custo" })).not.toBeInTheDocument();
    expect(screen.getByText(/a tela não escolhe o identificador/)).toBeInTheDocument();
  });

  it("Reprocessar fechamento chama o mesmo processamento", async () => {
    const usuario = userEvent.setup();
    const reprocessar = vi.fn();
    render(<PendenciasCusto linhas={linhasMeli} processamento={processamentoBase} marketplace="meli" base={base} onReprocessar={reprocessar} />);
    await usuario.click(screen.getByRole("button", { name: "Reprocessar fechamento" }));
    expect(reprocessar).toHaveBeenCalledTimes(1);
  });

  it("sem pendências não renderiza nada", () => {
    const { container } = render(<PendenciasCusto linhas={normalizarLinhas([{ "# de anúncio": "MLB4", "Venda Total": 1, "Preço de custo": 1, LC: 1, MC: 20, "Cobertura de custo": "com custo" }])} processamento={processamentoBase} marketplace="meli" />);
    expect(container).toBeEmptyDOMElement();
  });
});
