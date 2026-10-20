import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProdutosMesa } from "./ProdutosMesa.jsx";
import { normalizarLinhas } from "../../../utils/financeiro/produtos.js";

const rede = vi.hoisted(() => ({ requisitar: vi.fn() }));
vi.mock("../../../services/apiClient.js", async (orig) => ({ ...(await orig()), requisitar: rede.requisitar }));
beforeEach(() => {
  rede.requisitar.mockReset();
  rede.requisitar.mockResolvedValue({ ok: true, miniaturas: {} });
});

const linhasMeli = normalizarLinhas([
  { "# de anúncio": "MLB1", "Título do anúncio": "Calça", Unidades: 1, "Venda Total": 100, "Total (BRL)": 80, "Preço de custo": 30, LC: 20, MC: 20, "Cobertura de custo": "com custo" },
  { "# de anúncio": "MLB2", "Título do anúncio": "Blusa", Unidades: 1, "Venda Total": 50, "Total (BRL)": null, "Preço de custo": 10, LC: null, MC: null, "Cobertura de custo": "financeiro pendente" },
  { "# de anúncio": "MLB3", "Título do anúncio": "Saia", Unidades: 1, "Venda Total": 70, "Total (BRL)": 60, "Preço de custo": null, LC: null, MC: null, "Cobertura de custo": "sem custo" },
]);

const linhaDe = (titulo) => screen.getByText(titulo).closest(".vf-fin-mesa-lista__linha");
const linhasVisiveis = (container) => container.querySelectorAll(".vf-fin-mesa-lista__linha");

describe("ProdutosMesa", () => {
  it("linha com custo e financeiro pendente mostra 'Aguardando financeiro' e LC/MC '—' (não R$ 0,00)", () => {
    render(<ProdutosMesa linhas={linhasMeli} />);
    const linha = linhaDe("Blusa");
    expect(within(linha).getByText("Aguardando financeiro")).toBeInTheDocument();
    expect(within(linha).queryByText("Sem custo")).not.toBeInTheDocument();
    expect(within(linha).queryByText("R$ 0,00")).not.toBeInTheDocument();
  });

  it("ordena por receita, da maior para a menor", () => {
    const { container } = render(<ProdutosMesa linhas={linhasMeli} />);
    const titulos = Array.from(linhasVisiveis(container)).map((l) => l.querySelector(".vf-fin-mesa-produto__titulo").textContent);
    expect(titulos).toEqual(["Calça", "Saia", "Blusa"]);
  });

  it("busca fica à esquerda dos filtros por status", () => {
    const { container } = render(<ProdutosMesa linhas={linhasMeli} />);
    const ferramentas = container.querySelector(".vf-fin-mesa-produtos__ferramentas");
    expect(ferramentas.firstElementChild).toHaveAttribute("type", "search");
    expect(ferramentas.lastElementChild).toHaveAttribute("aria-label", "Filtrar produtos");
  });

  it("filtro 'Sem custo' mostra só a linha sem custo; busca por MLB", async () => {
    const usuario = userEvent.setup();
    render(<ProdutosMesa linhas={linhasMeli} />);
    await usuario.click(screen.getByRole("button", { name: /^Sem custo/ }));
    expect(screen.getByText("Saia")).toBeInTheDocument();
    expect(screen.queryByText("Calça")).not.toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: /^Todos/ }));
    await usuario.type(screen.getByRole("searchbox", { name: "Buscar produto" }), "MLB1");
    expect(screen.getByText("Calça")).toBeInTheDocument();
    expect(screen.queryByText("Saia")).not.toBeInTheDocument();
  });

  it("um pedido de fora (aviso de pendências) aplica o recorte 'Sem custo'", () => {
    const { rerender } = render(<ProdutosMesa linhas={linhasMeli} />);
    expect(screen.getByText("Calça")).toBeInTheDocument();
    rerender(<ProdutosMesa linhas={linhasMeli} pedido={{ filtro: "sem_custo", seq: 1 }} />);
    expect(screen.queryByText("Calça")).not.toBeInTheDocument();
    expect(screen.getByText("Saia")).toBeInTheDocument();
  });

  it("clicar na linha expande a composição do produto, com os dados da linha", async () => {
    const usuario = userEvent.setup();
    render(<ProdutosMesa linhas={linhasMeli} />);
    const linha = linhaDe("Calça");
    expect(linha).toHaveAttribute("aria-expanded", "false");
    await usuario.click(linha);
    expect(linha).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Composição do produto")).toBeInTheDocument();
    expect(screen.getByText("Repasse / líquido", { selector: "dt" }).nextSibling).toHaveTextContent("R$ 80,00");
  });

  it("pagina linhas grandes (25 por página) e nunca renderiza todas de uma vez", async () => {
    const usuario = userEvent.setup();
    const muitas = normalizarLinhas(Array.from({ length: 3625 }, (_, i) => ({ "# de anúncio": `MLB${i}`, "Título do anúncio": `P${i}`, "Venda Total": 1, LC: 1, MC: 20, "Cobertura de custo": "com custo" })));
    const { container } = render(<ProdutosMesa linhas={muitas} />);
    expect(screen.getByText("Página 1 de 145")).toBeInTheDocument();
    expect(screen.getByText(/3\.625 de 3\.625 linhas · mostrando 1–25/)).toBeInTheDocument();
    expect(linhasVisiveis(container)).toHaveLength(25);
    await usuario.click(screen.getByRole("button", { name: "Próxima" }));
    expect(screen.getByTitle("P25")).toBeInTheDocument();
    expect(screen.queryByTitle("P24")).not.toBeInTheDocument();
  });

  it("o operador escolhe o tamanho da página e a paginação volta para a primeira", async () => {
    const usuario = userEvent.setup();
    const muitas = normalizarLinhas(Array.from({ length: 120 }, (_, i) => ({ "# de anúncio": `MLB${i}`, "Título do anúncio": `P${i}`, "Venda Total": 1, LC: 1, MC: 20, "Cobertura de custo": "com custo" })));
    const { container } = render(<ProdutosMesa linhas={muitas} />);
    await usuario.click(screen.getByRole("button", { name: "Próxima" }));
    await usuario.selectOptions(screen.getByRole("combobox", { name: "Linhas por página" }), "100");
    expect(screen.getByText("Página 1 de 2")).toBeInTheDocument();
    expect(linhasVisiveis(container)).toHaveLength(100);
  });

  it("MC aparece só como valor, pintada pela faixa (sem barra)", () => {
    const { container } = render(<ProdutosMesa linhas={linhasMeli} />);
    const mc = linhaDe("Calça").querySelector(".vf-fin-mesa-produto__mc");
    expect(mc).toHaveTextContent("20,0%");
    expect(mc).toHaveClass("is-saudavel");
    expect(container.querySelector(".mc__bar, .vf-fin-mesa-produto__barra")).toBeNull();
  });

  it("título longo fica numa linha e o texto inteiro no tooltip", () => {
    const titulo = "Kit ".repeat(80).trim();
    const linhas = normalizarLinhas([{ "# de anúncio": "MLB9", "Título do anúncio": titulo, "Venda Total": 1, LC: 1, MC: 20, "Cobertura de custo": "com custo" }]);
    render(<ProdutosMesa linhas={linhas} />);
    expect(screen.getByTitle(titulo)).toHaveClass("vf-fin-mesa-produto__titulo");
  });

  it("amostra do fechamento salvo diz que não são todas as linhas", () => {
    render(<ProdutosMesa linhas={linhasMeli} amostra />);
    expect(screen.getByText(/Amostra de 3 linhas gravadas no fechamento salvo/)).toBeInTheDocument();
  });
});

describe("ProdutosMesa · foto do anúncio (Mercado Livre)", () => {
  const ctx = { clienteSlug: "zenite", clienteContaId: 42, marketplace: "meli" };
  const fotoDe = (titulo) => linhaDe(titulo).querySelector(".vf-fin-mesa-produto__sigla img");

  it("pede só os MLBs da página e troca a sigla pela foto; sem foto fica a sigla", async () => {
    rede.requisitar.mockResolvedValue({ ok: true, miniaturas: { MLB1: "https://img/1.jpg", MLB3: "https://img/3.jpg" } });
    render(<ProdutosMesa linhas={linhasMeli} {...ctx} />);
    await waitFor(() => expect(fotoDe("Calça")).toHaveAttribute("src", "https://img/1.jpg"));
    expect(fotoDe("Saia")).toHaveAttribute("src", "https://img/3.jpg");
    expect(fotoDe("Blusa")).toBeNull();
    expect(within(linhaDe("Blusa")).getByText("BLU")).toBeInTheDocument();
    expect(rede.requisitar).toHaveBeenCalledTimes(1);
    const [caminho, opcoes] = rede.requisitar.mock.calls[0];
    expect(caminho).toBe("/financeiro/zenite/miniaturas");
    expect(opcoes.params).toEqual({ conta: 42, itens: "MLB1,MLB3,MLB2" });
  });

  it("filtrar não pede de novo o que já foi consultado", async () => {
    const usuario = userEvent.setup();
    render(<ProdutosMesa linhas={linhasMeli} {...ctx} />);
    await waitFor(() => expect(rede.requisitar).toHaveBeenCalledTimes(1));
    await usuario.click(screen.getByRole("button", { name: /^Sem custo/ }));
    await usuario.click(screen.getByRole("button", { name: /^Todos/ }));
    expect(rede.requisitar).toHaveBeenCalledTimes(1);
  });

  it("imagem que não carrega volta para a sigla", async () => {
    rede.requisitar.mockResolvedValue({ ok: true, miniaturas: { MLB1: "https://img/quebrada.jpg" } });
    render(<ProdutosMesa linhas={linhasMeli} {...ctx} />);
    await waitFor(() => expect(fotoDe("Calça")).not.toBeNull());
    fireEvent.error(fotoDe("Calça"));
    expect(fotoDe("Calça")).toBeNull();
    expect(within(linhaDe("Calça")).getByText("CAL")).toBeInTheDocument();
  });

  it("falha da consulta não quebra a lista", async () => {
    rede.requisitar.mockRejectedValue(new Error("rede"));
    render(<ProdutosMesa linhas={linhasMeli} {...ctx} />);
    await waitFor(() => expect(rede.requisitar).toHaveBeenCalled());
    expect(within(linhaDe("Calça")).getByText("CAL")).toBeInTheDocument();
  });

  it("Shopee não consulta fotos", () => {
    render(<ProdutosMesa linhas={linhasMeli} {...ctx} marketplace="shopee" />);
    expect(rede.requisitar).not.toHaveBeenCalled();
  });
});

describe("ProdutosMesa · + Custo (base vinculada)", () => {
  const BASE = { id: 900, slug: "base-zenite", nome: "Base Zenite" };
  const baseCom = (dados = {}) => ({ ok: true, dados });
  // GET /bases/:slug → itens; POST upsert → ok; o resto (miniaturas) → vazio.
  function redeDaBase(dados = {}) {
    rede.requisitar.mockImplementation(async (caminho, opcoes = {}) => {
      if (caminho === "/bases/base-zenite") return baseCom(dados);
      if (caminho === "/bases/base-zenite/custos/upsert") return { ok: true };
      return { ok: true, miniaturas: {} };
    });
  }
  const upserts = () => rede.requisitar.mock.calls.filter(([c]) => c.endsWith("/custos/upsert"));
  const props = { linhas: linhasMeli, clienteSlug: "zenite", clienteContaId: 42, marketplace: "meli", baseDeCustos: BASE };

  it("só a linha sem custo ganha '+ Custo'", async () => {
    redeDaBase();
    render(<ProdutosMesa {...props} />);
    expect(await within(linhaDe("Saia")).findByRole("button", { name: "+ Custo" })).toBeInTheDocument();
    expect(within(linhaDe("Calça")).queryByRole("button", { name: "+ Custo" })).not.toBeInTheDocument();
    expect(within(linhaDe("Blusa")).queryByRole("button", { name: "+ Custo" })).not.toBeInTheDocument();
  });

  it("sem base vinculada: nada de '+ Custo' (e a base nem é lida)", () => {
    redeDaBase();
    render(<ProdutosMesa {...props} baseDeCustos={null} />);
    expect(screen.queryByRole("button", { name: "+ Custo" })).not.toBeInTheDocument();
    expect(rede.requisitar.mock.calls.some(([c]) => c.startsWith("/bases/"))).toBe(false);
  });

  it("Enter grava na base pelo MLB, sem imposto (o servidor mantém/usa o padrão), e avisa para reprocessar", async () => {
    redeDaBase();
    const onReprocessar = vi.fn();
    const usuario = userEvent.setup();
    render(<ProdutosMesa {...props} onReprocessar={onReprocessar} />);
    await usuario.click(await within(linhaDe("Saia")).findByRole("button", { name: "+ Custo" }));
    const campo = screen.getByRole("textbox", { name: /Custo do produto/ });
    expect(campo).toHaveFocus();
    await usuario.type(campo, "42,90{Enter}");
    await waitFor(() => expect(upserts()).toHaveLength(1));
    expect(upserts()[0][1].body).toEqual({ produto_id: "MLB3", custo_produto: 42.9, produto_nome: "Saia" });
    expect(await within(linhaDe("Saia")).findByText("na base")).toBeInTheDocument();
    expect(within(linhaDe("Saia")).getByText("R$ 42,90")).toBeInTheDocument();
    expect(screen.getByText(/1 custo foi salvo/)).toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "Reprocessar fechamento" }));
    expect(onReprocessar).toHaveBeenCalled();
  });

  it("clicar no '+ Custo' e digitar não expande a linha", async () => {
    redeDaBase();
    const usuario = userEvent.setup();
    render(<ProdutosMesa {...props} />);
    await usuario.click(await within(linhaDe("Saia")).findByRole("button", { name: "+ Custo" }));
    await usuario.type(screen.getByRole("textbox", { name: /Custo do produto/ }), "1 ");
    expect(linhaDe("Saia")).toHaveAttribute("aria-expanded", "false");
  });

  it("Esc cancela sem gravar; valor inválido não grava", async () => {
    redeDaBase();
    const usuario = userEvent.setup();
    render(<ProdutosMesa {...props} />);
    await usuario.click(await within(linhaDe("Saia")).findByRole("button", { name: "+ Custo" }));
    await usuario.type(screen.getByRole("textbox", { name: /Custo do produto/ }), "0{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent("maior que zero");
    await usuario.keyboard("{Escape}");
    expect(within(linhaDe("Saia")).getByRole("button", { name: "+ Custo" })).toBeInTheDocument();
    expect(upserts()).toHaveLength(0);
  });

  it("erro do servidor fica na célula e não marca como salvo", async () => {
    rede.requisitar.mockImplementation(async (caminho) => {
      if (caminho === "/bases/base-zenite") return baseCom();
      if (caminho.endsWith("/custos/upsert")) throw new Error("Sem permissão nesta base.");
      return { ok: true, miniaturas: {} };
    });
    const usuario = userEvent.setup();
    render(<ProdutosMesa {...props} />);
    await usuario.click(await within(linhaDe("Saia")).findByRole("button", { name: "+ Custo" }));
    await usuario.type(screen.getByRole("textbox", { name: /Custo do produto/ }), "10{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Sem permissão nesta base.");
    expect(screen.queryByText("na base")).not.toBeInTheDocument();
  });

  it("base com 2 registros do mesmo MLB: '+ Custo' leva às Pendências em vez de abrir o campo", async () => {
    redeDaBase({
      a: { produto_id: "MLB3", sku: "S-1", custo_produto: 10 },
      b: { produto_id: "MLB3", sku: "S-2", custo_produto: 12 },
    });
    const onAbrirPendencias = vi.fn();
    const usuario = userEvent.setup();
    render(<ProdutosMesa {...props} onAbrirPendencias={onAbrirPendencias} />);
    await usuario.click(await within(linhaDe("Saia")).findByRole("button", { name: "+ Custo" }));
    expect(onAbrirPendencias).toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: /Custo do produto/ })).not.toBeInTheDocument();
  });

  it("sem Pendências disponíveis (fechamento salvo): o '+ Custo' bloqueado explica o motivo na linha", async () => {
    redeDaBase({
      a: { produto_id: "MLB3", sku: "S-1", custo_produto: 10 },
      b: { produto_id: "MLB3", sku: "S-2", custo_produto: 12 },
    });
    const usuario = userEvent.setup();
    render(<ProdutosMesa {...props} />);
    await usuario.click(await within(linhaDe("Saia")).findByRole("button", { name: "+ Custo" }));
    expect(screen.getByText(/Custo não pode ser cadastrado por aqui/)).toBeInTheDocument();
    expect(screen.getByText(/2 registros para MLB3/)).toBeInTheDocument();
  });

  it("Shopee: grava Item + Model da venda", async () => {
    const linhasShopee = normalizarLinhas([
      { ID: "123", "ID Model": "456", "Nome do Produto": "Perfume", "Vendas (Pedido pago) (BRL)": 50, "Cobertura de custo": "sem custo", LC: null, MC: null },
    ]);
    redeDaBase();
    const usuario = userEvent.setup();
    render(<ProdutosMesa {...props} linhas={linhasShopee} marketplace="shopee" />);
    const linha = (await screen.findAllByRole("button", { name: "+ Custo" }))[0];
    await usuario.click(linha);
    await usuario.type(screen.getByRole("textbox", { name: /Custo do produto/ }), "20{Enter}");
    await waitFor(() => expect(upserts()).toHaveLength(1));
    expect(upserts()[0][1].body).toMatchObject({ produto_id: "123", id_model: "456", custo_produto: 20 });
  });
});
