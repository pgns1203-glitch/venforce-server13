import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PendenciasCusto } from "./PendenciasCusto.jsx";
import { normalizarLinhas } from "../../../utils/financeiro/produtos.js";
import {
  agruparPendencias,
  COLUNAS_PLANILHA_PENDENCIAS,
  montarLinhasPlanilhaPendencias,
  montarPlanilhaPendencias,
  nomeDaPlanilhaDePendencias,
} from "../../../utils/financeiro/pendencias.js";

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

  it("custo atual: o que a linha trouxe — ausente é null (nunca 0), zero real é 0", () => {
    const p = agruparPendencias(linhasMeli);
    expect(p[0].custoAtual).toBeNull();
    const comZero = agruparPendencias(normalizarLinhas([{ "# de anúncio": "MLB7", "Título do anúncio": "X", "Venda Total": 10, "Preço de custo": 0, LC: null, MC: null, "Cobertura de custo": "sem custo" }]));
    expect(comZero[0].custoAtual).toBe(0);
  });

  it("motivo Shopee vem do diagnóstico tipado por IGUALDADE de ID", () => {
    const linhas = normalizarLinhas([{ Produto: "Kit", ID: "100", "ID Model": "555", "Vendas (Pedido pago) (BRL)": 10, "Cobertura de custo": "sem custo" }]);
    const p = agruparPendencias(linhas, { unmatchedCosts: [{ type: "variation_id", value: "555", reason: "cost_only_on_parent_item", parentItemId: "100", blockedBy: "multiple_variations_in_performance" }] });
    expect(p[0].motivo).toMatch(/^Custo somente no item pai \(ID Item 100\); o anúncio tem várias variações/);
    const semCasar = agruparPendencias(linhas, { unmatchedCosts: [{ type: "variation_id", value: "5550", reason: "zero_cost_in_base" }] });
    expect(semCasar[0].motivo).toBe("Não encontrado na base");
  });
});

// A planilha é um CONTRATO com o leitor de Bases (assistenteBaseService). O
// teste do servidor (server/tests/pendenciasPlanilhaContrato.test.js) lê estes
// mesmos cabeçalhos com o leitor real; aqui travamos o lado do portal.
describe("planilha de pendências (XLSX)", () => {
  it("colunas: nome do produto, ID, SKU, Model ID, motivo, receita, custo atual, novo custo, imposto", () => {
    expect(COLUNAS_PLANILHA_PENDENCIAS).toEqual([
      "Nome do produto", "ID", "SKU", "Model ID", "Motivo", "Receita impactada", "Custo atual", "Novo custo", "Imposto (%)",
    ]);
  });

  it("'Produto' puro é proibido: o leitor de Bases o confunde com custo (vira R$ 0)", () => {
    expect(COLUNAS_PLANILHA_PENDENCIAS).not.toContain("Produto");
  });

  it("linhas: ausência vira célula vazia (null), Novo custo sempre vazio, imposto com '%'", () => {
    const linhas = normalizarLinhas([
      { "# de anúncio": "MLB1", "Título do anúncio": "Calça", "Venda Total": 100, "Preço de custo": null, Imposto: 10.5, LC: null, MC: null, "Cobertura de custo": "sem custo" },
    ]);
    const [l1] = montarLinhasPlanilhaPendencias(agruparPendencias(linhas));
    expect(l1).toEqual(["Calça", "MLB1", null, null, "Não encontrado na base", 100, null, null, "10,5%"]);
  });

  it("ID longo permanece TEXTO (não vira número/notação científica)", () => {
    const linhas = normalizarLinhas([{ Produto: "Kit", ID: "169417000000123", "ID Model": "555000000000123", "Vendas (Pedido pago) (BRL)": 10, "Cobertura de custo": "sem custo" }]);
    const [l1] = montarLinhasPlanilhaPendencias(agruparPendencias(linhas));
    expect(typeof l1[1]).toBe("string");
    expect(l1[1]).toBe("169417000000123");
    expect(l1[3]).toBe("555000000000123");
  });

  it("gera um .xlsx real (ZIP com as partes do workbook) com cabeçalho e dados", () => {
    const bytes = montarPlanilhaPendencias(agruparPendencias(linhasMeli), { marketplace: "meli", cliente: "Zenite Comercial", clienteSlug: "zenite", conta: "ML 1", competencia: "2026-10" });
    expect(bytes[0]).toBe(0x50); // P
    expect(bytes[1]).toBe(0x4b); // K
    const texto = new TextDecoder().decode(bytes);
    for (const parte of ["[Content_Types].xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml", "xl/styles.xml"]) {
      expect(texto).toContain(parte);
    }
    expect(texto).toContain("Pendências de custo");
    expect(texto).toContain("Nome do produto");
    expect(texto).toContain("MLB1");
    expect(texto).toContain("Zenite Comercial");
    // Novo custo vazio: nenhuma célula H preenchida na linha de dados
    expect(texto).not.toMatch(/<c r="H2"/);
  });

  it("sem nome do cliente: a célula Cliente fica vazia (o slug tem linha própria)", () => {
    const texto = new TextDecoder().decode(montarPlanilhaPendencias(agruparPendencias(linhasMeli), { marketplace: "meli", cliente: null, clienteSlug: "zenite", competencia: "2026-10" }));
    expect(texto).toContain("zenite");
    expect(texto).not.toMatch(/<c r="B3"[^>]*>.*?<t[^>]*>undefined/);
  });

  it("nome do arquivo", () => {
    expect(nomeDaPlanilhaDePendencias({ marketplace: "meli", periodo: "2026-10" })).toBe("pendencias-custo-meli-2026-10.xlsx");
  });

  it("botão baixa um XLSX (não CSV)", async () => {
    const usuario = userEvent.setup();
    globalThis.URL.createObjectURL = vi.fn(() => "blob:x");
    globalThis.URL.revokeObjectURL = vi.fn();
    const clique = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<PendenciasCusto linhas={linhasMeli} processamento={processamentoBase} marketplace="meli" base={base} contexto={{ competencia: "2026-10" }} onReprocessar={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /CSV/i })).not.toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "Baixar planilha (XLSX)" }));
    expect(clique.mock.instances[0].download).toBe("pendencias-custo-meli-2026-10.xlsx");
    const blob = globalThis.URL.createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    clique.mockRestore();
  });
});

describe("PendenciasCusto · tabela", () => {
  it("colunas operacionais: produto, ID, SKU/Model, motivo, receita, custo atual, novo custo, ação", () => {
    render(<PendenciasCusto linhas={linhasMeli} processamento={processamentoBase} marketplace="meli" base={base} onReprocessar={vi.fn()} />);
    const cabecalhos = screen.getAllByRole("columnheader").map((th) => th.textContent);
    expect(cabecalhos).toEqual(["Produto", "ID", "SKU / Model", "Motivo", "Receita impactada", "Custo atual", "Novo custo", "Ação"]);
  });

  it("custo atual ausente é '—' (não R$ 0,00)", () => {
    render(<PendenciasCusto linhas={linhasMeli} processamento={processamentoBase} marketplace="meli" base={base} onReprocessar={vi.fn()} />);
    const linha = screen.getByText("Calça").closest("tr");
    const celulas = within(linha).getAllByRole("cell");
    expect(celulas[5]).toHaveTextContent("—");
    expect(within(linha).queryByText("R$ 0,00")).not.toBeInTheDocument();
  });

  it("'sem custo' e 'financeiro pendente' são coisas diferentes: financeiro pendente com custo NÃO é pendência de custo", () => {
    render(<PendenciasCusto linhas={linhasMeli} processamento={processamentoBase} marketplace="meli" base={base} onReprocessar={vi.fn()} />);
    expect(screen.getByText("Calça")).toBeInTheDocument();
    expect(screen.getByText("Blusa")).toBeInTheDocument();
    expect(screen.queryByText("Saia")).not.toBeInTheDocument();
  });
});

describe("PendenciasCusto · correção na linha", () => {
  it("MELI com base vinculada: digita na linha, vê o que será gravado, confirma e registra — sem reprocessar sozinho", async () => {
    const usuario = userEvent.setup();
    const reprocessar = vi.fn();
    render(<PendenciasCusto linhas={linhasMeli} processamento={processamentoBase} marketplace="meli" base={base} onReprocessar={reprocessar} />);

    const linha = screen.getByText("Calça").closest("tr");
    // ambíguo nunca ganha campo de correção
    const ambigua = screen.getByText("Blusa").closest("tr");
    expect(within(ambigua).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(ambigua).getByText(/Custo ambíguo — resolver em Bases de Custo/)).toBeInTheDocument();

    const campo = within(linha).getByRole("textbox", { name: "Novo custo unitário de MLB1" });
    expect(within(linha).getByRole("button", { name: "Salvar na base" })).toBeDisabled();
    await usuario.type(campo, "12,50");
    await usuario.click(within(linha).getByRole("button", { name: "Salvar na base" }));

    expect(within(linha).getByText(/produto_id = MLB1/)).toBeInTheDocument();
    await waitFor(() => expect(within(linha).getByText(/imposto padrão da base \(8%\)/)).toBeInTheDocument());
    expect(api.upsert).not.toHaveBeenCalled();

    await usuario.click(within(linha).getByRole("button", { name: "Confirmar e registrar" }));
    expect(api.upsert).toHaveBeenCalledWith("base-zenite", { produtoId: "MLB1", custoProduto: 12.5, produtoNome: "Calça" });
    expect(await within(linha).findByText(/Registrado na base — reprocesse/)).toBeInTheDocument();
    expect(reprocessar).not.toHaveBeenCalled(); // reprocesso é explícito, em lote
    expect(screen.getByRole("status")).toHaveTextContent("1 custo foi registrado na base");
    expect(screen.getByRole("button", { name: "Reprocessar fechamento" })).toHaveClass("vf-btn--primary");
  });

  it("custo inválido (0, vazio, texto) não habilita Salvar", async () => {
    const usuario = userEvent.setup();
    render(<PendenciasCusto linhas={linhasMeli} processamento={processamentoBase} marketplace="meli" base={base} onReprocessar={vi.fn()} />);
    const linha = screen.getByText("Calça").closest("tr");
    const campo = within(linha).getByRole("textbox", { name: "Novo custo unitário de MLB1" });
    for (const v of ["0", "abc", "-3"]) {
      await usuario.clear(campo);
      await usuario.type(campo, v);
      expect(within(linha).getByRole("button", { name: "Salvar na base" })).toBeDisabled();
    }
    expect(api.upsert).not.toHaveBeenCalled();
  });

  it("falha ao registrar: o erro aparece NA LINHA, a linha continua editável e nada é reprocessado", async () => {
    api.upsert.mockRejectedValueOnce(new Error("Base fora da sua carteira."));
    const usuario = userEvent.setup();
    const reprocessar = vi.fn();
    render(<PendenciasCusto linhas={linhasMeli} processamento={processamentoBase} marketplace="meli" base={base} onReprocessar={reprocessar} />);
    const linha = screen.getByText("Calça").closest("tr");
    await usuario.type(within(linha).getByRole("textbox", { name: "Novo custo unitário de MLB1" }), "10");
    await usuario.click(within(linha).getByRole("button", { name: "Salvar na base" }));
    await usuario.click(within(linha).getByRole("button", { name: "Confirmar e registrar" }));
    expect(await within(linha).findByRole("alert")).toHaveTextContent("Base fora da sua carteira.");
    expect(within(linha).getByRole("button", { name: "Confirmar e registrar" })).toBeEnabled(); // pode tentar de novo
    expect(within(screen.getByText("Blusa").closest("tr")).queryByRole("alert")).not.toBeInTheDocument();
    expect(reprocessar).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("depois de registrar, 'Reprocessar fechamento' dispara UM reprocesso", async () => {
    const usuario = userEvent.setup();
    const reprocessar = vi.fn();
    render(<PendenciasCusto linhas={linhasMeli} processamento={processamentoBase} marketplace="meli" base={base} onReprocessar={reprocessar} />);
    const linha = screen.getByText("Calça").closest("tr");
    await usuario.type(within(linha).getByRole("textbox", { name: "Novo custo unitário de MLB1" }), "9,9");
    await usuario.click(within(linha).getByRole("button", { name: "Salvar na base" }));
    await usuario.click(within(linha).getByRole("button", { name: "Confirmar e registrar" }));
    await within(linha).findByText(/Registrado na base/);
    await usuario.click(screen.getByRole("button", { name: "Reprocessar fechamento" }));
    expect(reprocessar).toHaveBeenCalledTimes(1);
  });

  it("custos de upload (não da base vinculada): sem campo de correção", () => {
    render(<PendenciasCusto linhas={linhasMeli} processamento={{ costsSource: "upload" }} marketplace="meli" base={base} onReprocessar={vi.fn()} />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Salvar na base" })).not.toBeInTheDocument();
    expect(screen.getByText(/Correção na linha indisponível/)).toBeInTheDocument();
  });

  it("base de OUTRA conta (slug diferente do usado no processamento): sem campo de correção", () => {
    render(<PendenciasCusto linhas={linhasMeli} processamento={{ costsSource: "base", costsBase: { slug: "outra-base" } }} marketplace="meli" base={base} onReprocessar={vi.fn()} />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("Shopee: nunca oferece correção na linha (não escolhe Item × Variação) e aponta Bases/planilha", () => {
    const linhas = normalizarLinhas([{ Produto: "Kit", ID: "100", "ID Model": "555", "Vendas (Pedido pago) (BRL)": 10, "Cobertura de custo": "sem custo" }]);
    render(<PendenciasCusto linhas={linhas} processamento={processamentoBase} marketplace="shopee" base={base} onReprocessar={vi.fn()} />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Salvar na base" })).not.toBeInTheDocument();
    expect(screen.getByText(/a tela não escolhe o identificador/)).toBeInTheDocument();
    expect(screen.getByText("Corrigir em Bases de Custo")).toBeInTheDocument();
  });

  it("Shopee com IDs conflitantes: o diagnóstico é exibido como veio, sem inventar match", () => {
    const linhas = normalizarLinhas([{ Produto: "Kit", ID: "100", "ID Model": "555", "Vendas (Pedido pago) (BRL)": 10, "Cobertura de custo": "sem custo" }]);
    render(
      <PendenciasCusto
        linhas={linhas}
        processamento={{ ...processamentoBase, unmatchedCosts: [{ type: "variation_id", value: "555", reason: "ambiguous_bridge_candidates" }] }}
        marketplace="shopee"
        base={base}
        onReprocessar={vi.fn()}
      />
    );
    expect(screen.getByText(/IDs conflitantes — custos diferentes na base/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
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

describe("PendenciasCusto · lista longa", () => {
  it("mostra só as 10 maiores e libera o resto sob demanda", async () => {
    const usuario = userEvent.setup();
    const muitas = normalizarLinhas(Array.from({ length: 40 }, (_, i) => ({ "# de anúncio": `MLB${i}`, "Título do anúncio": `Item ${i}`, "Venda Total": 1000 - i, "Preço de custo": null, LC: null, MC: null, "Cobertura de custo": "sem custo" })));
    render(<PendenciasCusto linhas={muitas} processamento={processamentoBase} marketplace="meli" base={base} onReprocessar={vi.fn()} />);
    expect(screen.getAllByRole("row")).toHaveLength(11); // cabeçalho + 10
    expect(screen.getByText("Item 0")).toBeInTheDocument(); // maior receita primeiro
    expect(screen.queryByText("Item 39")).not.toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "Ver todas as 40 pendências" }));
    expect(screen.getAllByRole("row")).toHaveLength(41);
  });
});
