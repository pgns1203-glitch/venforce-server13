import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VFTable } from "./index.js";

const LINHAS = [
  { id: "a", nome: "Kit Karité", fat: 1200 },
  { id: "b", nome: "Saboneteira", fat: 300 },
];

const COLUNAS = [
  { key: "nome", header: "Produto", rowHeader: true, width: "60%" },
  { key: "fat", header: "Faturamento", align: "right", sortKey: "fat", render: (l) => `R$ ${l.fat}` },
];

describe("VFTable", () => {
  it("tabela semântica nomeada pela legenda, nas classes da V2", () => {
    const { container } = render(<VFTable caption="Produtos" columns={COLUNAS} rows={LINHAS} getRowKey={(l) => l.id} />);
    const tabela = screen.getByRole("table", { name: "Produtos" });
    expect(tabela).toHaveClass("vf-table", "vf-table--compact");
    expect(container.firstChild).toHaveClass("vf-table-wrap");
    expect(screen.getByRole("rowheader", { name: "Kit Karité" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((th) => th.getAttribute("scope"))).toEqual(["col", "col"]);
    expect(container.querySelector("col").style.width).toBe("60%");
  });

  it("coluna numérica recebe .num no cabeçalho e nas células; render formata", () => {
    render(<VFTable columns={COLUNAS} rows={LINHAS} />);
    expect(screen.getByRole("columnheader", { name: /Faturamento/ })).toHaveClass("num");
    expect(screen.getByRole("cell", { name: "R$ 1200" })).toHaveClass("num");
  });

  it("sem linhas: uma célula de vazio ocupando todas as colunas", () => {
    render(<VFTable columns={COLUNAS} rows={[]} emptyLabel="Nenhum produto neste filtro." />);
    const vazio = screen.getByRole("cell", { name: "Nenhum produto neste filtro." });
    expect(vazio).toHaveClass("vf-table__empty");
    expect(vazio).toHaveAttribute("colspan", "2");
  });

  it("ordenação: aria-sort none → ascending, botão com is-asc, onSort recebe a chave", async () => {
    const onSort = vi.fn();
    const { rerender } = render(<VFTable columns={COLUNAS} rows={LINHAS} onSort={onSort} sort={null} />);
    const th = screen.getByRole("columnheader", { name: /Faturamento/ });
    expect(th).toHaveAttribute("aria-sort", "none");
    expect(screen.getByRole("columnheader", { name: "Produto" })).not.toHaveAttribute("aria-sort");
    await userEvent.setup().click(within(th).getByRole("button"));
    expect(onSort).toHaveBeenCalledWith("fat");
    rerender(<VFTable columns={COLUNAS} rows={LINHAS} onSort={onSort} sort={{ key: "fat", dir: "asc" }} />);
    expect(th).toHaveAttribute("aria-sort", "ascending");
    expect(within(th).getByRole("button")).toHaveClass("vf-table__sort", "is-asc");
  });

  it("sem onSort a coluna com sortKey não vira botão", () => {
    render(<VFTable columns={COLUNAS} rows={LINHAS} />);
    expect(within(screen.getByRole("columnheader", { name: "Faturamento" })).queryByRole("button")).toBeNull();
  });

  it("linha clicável e linha marcada", async () => {
    const onRowClick = vi.fn();
    render(<VFTable columns={COLUNAS} rows={LINHAS} getRowKey={(l) => l.id} onRowClick={onRowClick} selectedKey="b" />);
    const [, linhaA, linhaB] = screen.getAllByRole("row");
    expect(linhaA).toHaveClass("is-clickable");
    expect(linhaB).toHaveClass("row--selected");
    await userEvent.setup().click(within(linhaA).getByRole("rowheader"));
    expect(onRowClick).toHaveBeenCalledWith(LINHAS[0]);
  });

  it("classNames troca o visual sem mudar o comportamento (seta em texto quando pedida)", () => {
    const { container } = render(
      <VFTable
        columns={COLUNAS}
        rows={LINHAS}
        onSort={() => {}}
        sort={{ key: "fat", dir: "desc" }}
        classNames={{ wrap: "denso", table: "denso__grade", num: "is-num", sortArrow: "seta", sortedHeader: "is-ordenada" }}
      />,
    );
    expect(container.firstChild).toHaveClass("denso");
    expect(screen.getByRole("table")).toHaveClass("denso__grade");
    const th = screen.getByRole("columnheader", { name: /Faturamento/ });
    expect(th).toHaveClass("is-num", "is-ordenada");
    expect(th.querySelector(".seta")).toHaveTextContent("↓");
  });
});
