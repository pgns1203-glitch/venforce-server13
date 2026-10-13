import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProdutosFinanceiroTable } from "./ProdutosFinanceiroTable.jsx";
import { normalizarLinhas } from "../../../utils/financeiro/produtos.js";

const linhasMeli = normalizarLinhas([
  { "# de anúncio": "MLB1", "Título do anúncio": "Calça", Unidades: 1, "Venda Total": 100, "Total (BRL)": 80, "Preço de custo": 30, LC: 20, MC: 20, "Cobertura de custo": "com custo" },
  { "# de anúncio": "MLB2", "Título do anúncio": "Blusa", Unidades: 1, "Venda Total": 50, "Total (BRL)": null, "Preço de custo": 10, LC: null, MC: null, "Cobertura de custo": "financeiro pendente" },
  { "# de anúncio": "MLB3", "Título do anúncio": "Saia", Unidades: 1, "Venda Total": 70, "Total (BRL)": 60, "Preço de custo": null, LC: null, MC: null, "Cobertura de custo": "sem custo" },
]);

describe("ProdutosFinanceiroTable", () => {
  it("linha com custo e financeiro pendente mostra 'Aguardando financeiro' e LC/MC '—' (não R$ 0,00)", () => {
    render(<ProdutosFinanceiroTable linhas={linhasMeli} />);
    const linha = screen.getByText("Blusa").closest("tr");
    expect(within(linha).getByText("Aguardando financeiro")).toBeInTheDocument();
    expect(within(linha).queryByText("Sem custo")).not.toBeInTheDocument();
    expect(within(linha).queryByText("R$ 0,00")).not.toBeInTheDocument();
  });

  it("colunas sem dado no marketplace não aparecem (MELI não tem SKU/Model ID/Pedido)", () => {
    render(<ProdutosFinanceiroTable linhas={linhasMeli} />);
    const cabecalhos = screen.getAllByRole("columnheader").map((th) => th.textContent);
    expect(cabecalhos).toContain("MLB / Item ID");
    expect(cabecalhos).not.toContain("SKU");
    expect(cabecalhos).not.toContain("Model ID");
    expect(cabecalhos).not.toContain("Pedido");
  });

  it("filtro 'Sem custo' mostra só a linha sem custo; busca por MLB", async () => {
    const usuario = userEvent.setup();
    render(<ProdutosFinanceiroTable linhas={linhasMeli} />);
    await usuario.click(screen.getByRole("button", { name: /^Sem custo/ }));
    expect(screen.getByText("Saia")).toBeInTheDocument();
    expect(screen.queryByText("Calça")).not.toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: /^Todos/ }));
    await usuario.type(screen.getByRole("searchbox", { name: "Buscar produto" }), "MLB1");
    expect(screen.getByText("Calça")).toBeInTheDocument();
    expect(screen.queryByText("Saia")).not.toBeInTheDocument();
  });

  it("pagina linhas grandes (25 por página) e nunca renderiza todas de uma vez", async () => {
    const usuario = userEvent.setup();
    const muitas = normalizarLinhas(Array.from({ length: 3625 }, (_, i) => ({ "# de anúncio": `MLB${i}`, "Título do anúncio": `P${i}`, "Venda Total": 1, LC: 1, MC: 20, "Cobertura de custo": "com custo" })));
    render(<ProdutosFinanceiroTable linhas={muitas} />);
    expect(screen.getByText("Página 1 de 145")).toBeInTheDocument();
    expect(screen.getByText(/3\.625 de 3\.625 linhas · mostrando 1–25/)).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(26); // cabeçalho + 25
    await usuario.click(screen.getByRole("button", { name: "Próxima" }));
    expect(screen.getByText("P25")).toBeInTheDocument();
    expect(screen.queryByText("P24")).not.toBeInTheDocument();
  });

  it("o operador escolhe o tamanho da página e a paginação volta para a primeira", async () => {
    const usuario = userEvent.setup();
    const muitas = normalizarLinhas(Array.from({ length: 120 }, (_, i) => ({ "# de anúncio": `MLB${i}`, "Título do anúncio": `P${i}`, "Venda Total": 1, LC: 1, MC: 20, "Cobertura de custo": "com custo" })));
    render(<ProdutosFinanceiroTable linhas={muitas} />);
    await usuario.click(screen.getByRole("button", { name: "Próxima" }));
    await usuario.selectOptions(screen.getByRole("combobox", { name: "Linhas por página" }), "100");
    expect(screen.getByText("Página 1 de 2")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(101);
  });

  it("título longo é limitado em 2 linhas e o texto inteiro fica no tooltip", () => {
    const titulo = "Kit ".repeat(80).trim();
    const linhas = normalizarLinhas([{ "# de anúncio": "MLB9", "Título do anúncio": titulo, "Venda Total": 1, LC: 1, MC: 20, "Cobertura de custo": "com custo" }]);
    render(<ProdutosFinanceiroTable linhas={linhas} />);
    const el = screen.getByTitle(titulo);
    expect(el).toHaveClass("vf-fin-clamp");
  });
});
