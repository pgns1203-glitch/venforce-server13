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
  separarPendenciasParaPlanilha,
} from "../../../utils/financeiro/pendencias.js";
import { indexarPorProduto, itensDaBase } from "../../../utils/financeiro/baseCustos.js";

const api = vi.hoisted(() => ({ padrao: vi.fn(), upsert: vi.fn(), base: vi.fn(), preview: vi.fn() }));
vi.mock("../../../services/basesCustoApi.js", () => ({
  obterPadraoCustoBase: api.padrao,
  registrarCustoNaBase: api.upsert,
  obterCustosDaBase: api.base,
  previewPlanilhaDeCustos: api.preview,
}));

const linhasMeli = normalizarLinhas([
  { "# de anúncio": "MLB1", "Título do anúncio": "Calça", "Venda Total": 100, "Preço de custo": null, LC: null, MC: null, "Cobertura de custo": "sem custo" },
  { "# de anúncio": "MLB1", "Título do anúncio": "Calça", "Venda Total": 50, "Preço de custo": null, LC: null, MC: null, "Cobertura de custo": "sem custo" },
  { "# de anúncio": "MLB2", "Título do anúncio": "Blusa", "Venda Total": 70, "Preço de custo": null, LC: null, MC: null, "Cobertura de custo": "custo ambíguo" },
  { "# de anúncio": "MLB3", "Título do anúncio": "Saia", "Venda Total": 40, "Preço de custo": 10, LC: null, MC: null, "Cobertura de custo": "financeiro pendente" },
  { "# de anúncio": "MLB4", "Título do anúncio": "Top", "Venda Total": 90, "Preço de custo": 20, LC: 30, MC: 33, "Cobertura de custo": "com custo" },
]);

const shopeeLinha = (extra = {}) => ({ Produto: "Kit", ID: "169417000123", "ID Model": "555000000123", "Vendas (Pedido pago) (BRL)": 10, "Cobertura de custo": "sem custo", ...extra });
const linhasShopee = (...extras) => normalizarLinhas(extras.length ? extras.map((e) => shopeeLinha(e)) : [shopeeLinha()]);

const base = { id: 9, slug: "base-zenite", nome: "Base Zenite" };
const processamentoBase = { costsSource: "base", costsBase: { slug: "base-zenite" }, unmatchedCosts: [] };
const dadosBase = (...itens) => ({ ok: true, dados: Object.fromEntries(itens.map((i, n) => [`k${n}`, { custo_produto: 0, imposto_percentual: 0.08, id_model: null, ...i }])) });

beforeEach(() => {
  vi.clearAllMocks();
  api.padrao.mockResolvedValue({ ok: true, padrao: { imposto_percentual: 0.08, taxa_fixa: 0 } });
  api.base.mockResolvedValue(dadosBase());
  api.upsert.mockResolvedValue({ ok: true, acao: "criado" });
});

// A base é lida do servidor: os grupos só aparecem quando ela chegou.
async function montar(props) {
  const utils = render(<PendenciasCusto processamento={processamentoBase} base={base} onReprocessar={vi.fn()} {...props} />);
  await screen.findByRole("list", { name: "Resumo das pendências" });
  return utils;
}
const linhaDe = (texto) => screen.getByText(texto).closest("tr");
// "1 corrigível agora · 0 por planilha · 2 bloqueadas" → [1, 0, 2]
const contagens = () =>
  Array.from(screen.getByRole("list", { name: "Resumo das pendências" }).querySelectorAll("li")).map((li) => [li.dataset.grupo, Number(li.querySelector("strong").textContent)]);
const grupo = (id) => document.querySelector(`[data-grupo="${id}"].vf-fin-pend-grupo`);

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
    const p = agruparPendencias(linhasShopee(), { unmatchedCosts: [{ type: "variation_id", value: "555000000123", reason: "cost_only_on_parent_item", parentItemId: "169417000123", blockedBy: "multiple_variations_in_performance" }] });
    expect(p[0].motivo).toMatch(/^Custo somente no item pai \(ID Item 169417000123\); o anúncio tem várias variações/);
    const semCasar = agruparPendencias(linhasShopee(), { unmatchedCosts: [{ type: "variation_id", value: "5550", reason: "zero_cost_in_base" }] });
    expect(semCasar[0].motivo).toBe("Não encontrado na base");
  });
});

// A planilha é um CONTRATO com o leitor de Bases (assistenteBaseService). O
// teste do servidor (server/tests/pendenciasPlanilhaContrato.test.js) usa ESTE
// gerador e o parser REAL; aqui travamos o lado do portal.
describe("planilha de pendências (XLSX)", () => {
  it("colunas: nome do produto, ID, SKU, Model ID, motivo, receita, custo atual, novo custo, imposto", () => {
    expect(COLUNAS_PLANILHA_PENDENCIAS).toEqual(["Nome do produto", "ID", "SKU", "Model ID", "Motivo", "Receita impactada", "Custo atual", "Novo custo", "Imposto (%)"]);
    expect(COLUNAS_PLANILHA_PENDENCIAS).not.toContain("Produto"); // o leitor de Bases o leria como CUSTO
  });

  it("MELI: ausência vira célula vazia (null), Novo custo sempre vazio, Model ID só no Shopee", () => {
    const [l1] = montarLinhasPlanilhaPendencias(agruparPendencias(linhasMeli), { marketplace: "meli" });
    expect(l1).toEqual(["Calça", "MLB1", null, null, "Não encontrado na base", 150, null, null, null]);
  });

  it("custo atual e imposto vêm do REGISTRO DA BASE (imposto fração → '%' em pontos), nunca da linha de venda", () => {
    const indice = indexarPorProduto(itensDaBase(dadosBase({ produto_id: "MLB1", custo_produto: 12.5, imposto_percentual: 0.105 })));
    const [l1] = montarLinhasPlanilhaPendencias(agruparPendencias(linhasMeli), { marketplace: "meli", indice });
    expect(l1[6]).toBe(12.5);
    expect(l1[8]).toBe("10,5%");
  });

  it("Shopee: Item e Model como TEXTO (sem notação científica)", () => {
    const [l1] = montarLinhasPlanilhaPendencias(agruparPendencias(linhasShopee({ ID: "169417000000123", "ID Model": "555000000000123" })), { marketplace: "shopee" });
    expect(l1[1]).toBe("169417000000123");
    expect(l1[3]).toBe("555000000000123");
    expect(typeof l1[1]).toBe("string");
  });

  it("quem NÃO tem ID do Item (o importador ignoraria) e o custo ambíguo ficam fora, e são contados", () => {
    const sep = separarPendenciasParaPlanilha(agruparPendencias(linhasMeli), { marketplace: "meli" });
    expect(sep.incluidas.map((p) => p.itemId)).toEqual(["MLB1"]);
    expect(sep.ambiguas.map((p) => p.itemId)).toEqual(["MLB2"]);
    const semItem = separarPendenciasParaPlanilha(agruparPendencias(normalizarLinhas([{ Produto: "Kit", "ID Model": "555", "Vendas (Pedido pago) (BRL)": 10, "Cobertura de custo": "sem custo" }])), { marketplace: "shopee" });
    expect(semItem.semId).toHaveLength(1);
  });

  it("gera um .xlsx real (ZIP) com cabeçalho e dados, sem célula de Novo custo preenchida", () => {
    const bytes = montarPlanilhaPendencias(agruparPendencias(linhasMeli), { marketplace: "meli", cliente: "Zenite Comercial", clienteSlug: "zenite", conta: "ML 1", competencia: "2026-10" });
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
    const texto = new TextDecoder().decode(bytes);
    expect(texto).toContain("Nome do produto");
    expect(texto).toContain("Zenite Comercial");
    expect(texto).not.toMatch(/<c r="H2"/);
  });

  it("nome do arquivo", () => {
    expect(nomeDaPlanilhaDePendencias({ marketplace: "meli", periodo: "2026-10" })).toBe("pendencias-custo-meli-2026-10.xlsx");
  });
});

describe("três grupos com contagem (partição) · volume decide portal × planilha", () => {
  const muitas = (n) => normalizarLinhas(Array.from({ length: n }, (_, i) => ({ "# de anúncio": `MLB${100 + i}`, "Título do anúncio": `Item ${i}`, "Venda Total": 1000 - i, "Preço de custo": null, LC: null, MC: null, "Cobertura de custo": "sem custo" })));

  it("os três grupos aparecem SEMPRE, numerados e na ordem: agora → planilha → bloqueadas", async () => {
    await montar({ linhas: muitas(2), marketplace: "meli" });
    expect(Array.from(document.querySelectorAll(".vf-fin-pend-grupo")).map((g) => g.dataset.grupo)).toEqual(["agora", "planilha", "bloqueadas"]);
    expect(screen.getByRole("region", { name: "Corrigir agora no portal" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Corrigir por planilha (importação)" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Bloqueadas / dependem de decisão" })).toBeInTheDocument();
  });

  it("poucas pendências: todas no grupo 1 (inputs na tela), 0 por planilha, e a planilha fica a um clique", async () => {
    await montar({ linhas: muitas(5), marketplace: "meli" });
    expect(contagens()).toEqual([["agora", 5], ["planilha", 0], ["bloqueadas", 0]]);
    expect(within(grupo("agora")).getByRole("textbox", { name: "Novo custo unitário de MLB100" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Correção em lote")).not.toBeInTheDocument();
    expect(within(grupo("planilha")).getByRole("button", { name: "Corrigir as 5 por planilha" })).toBeInTheDocument();
  });

  it("muitas pendências: todas no grupo 2 (planilha) por padrão; o grupo 1 explica e oferece voltar", async () => {
    const usuario = userEvent.setup();
    await montar({ linhas: muitas(30), marketplace: "meli" });
    expect(contagens()).toEqual([["agora", 0], ["planilha", 30], ["bloqueadas", 0]]);
    expect(within(grupo("planilha")).getByLabelText("Correção em lote")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Pendências para corrigir agora" })).not.toBeInTheDocument();
    expect(grupo("agora")).toHaveTextContent("30 pendências corrigíveis estão no grupo da planilha");
    await usuario.click(screen.getByRole("button", { name: "Corrigir as 30 aqui no portal mesmo assim" }));
    expect(screen.getByRole("table", { name: "Pendências para corrigir agora" })).toBeInTheDocument();
    expect(contagens()).toEqual([["agora", 30], ["planilha", 0], ["bloqueadas", 0]]);
  });

  it("o operador pode levar as poucas para a planilha", async () => {
    const usuario = userEvent.setup();
    await montar({ linhas: muitas(3), marketplace: "meli" });
    await usuario.click(screen.getByRole("button", { name: "Corrigir as 3 por planilha" }));
    expect(screen.getByLabelText("Correção em lote")).toBeInTheDocument();
    expect(contagens()).toEqual([["agora", 0], ["planilha", 3], ["bloqueadas", 0]]);
  });

  it("a soma dos grupos é SEMPRE o total — cada pendência está em um grupo só (MELI: ambíguo vai para bloqueadas)", async () => {
    await montar({ linhas: linhasMeli, marketplace: "meli" });
    expect(contagens()).toEqual([["agora", 1], ["planilha", 0], ["bloqueadas", 1]]);
    expect(within(grupo("agora")).getByText("Calça")).toBeInTheDocument();
    expect(within(grupo("bloqueadas")).getByText("Blusa")).toBeInTheDocument();
    expect(within(grupo("agora")).queryByText("Blusa")).not.toBeInTheDocument();
  });

  it("mostra só as 10 maiores e libera o resto sob demanda (grupo 1)", async () => {
    const usuario = userEvent.setup();
    await montar({ linhas: muitas(40), marketplace: "meli" });
    await usuario.click(screen.getByRole("button", { name: "Corrigir as 40 aqui no portal mesmo assim" }));
    expect(screen.getAllByRole("row")).toHaveLength(11);
    expect(screen.getByText("Item 0")).toBeInTheDocument();
    expect(screen.queryByText("Item 39")).not.toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "Ver todas as 40 pendências" }));
    expect(screen.getAllByRole("row")).toHaveLength(41);
  });
});

describe("correção individual · MELI", () => {
  it("colunas: produto, identificação, motivo, receita, custo atual, novo custo, imposto, ação", async () => {
    await montar({ linhas: linhasMeli, marketplace: "meli" });
    const tabela = screen.getByRole("table", { name: "Pendências para corrigir agora" });
    expect(within(tabela).getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["Produto", "Identificação", "Motivo", "Receita impactada", "Custo atual", "Novo custo", "Imposto %", "Ação"]);
  });

  it("bloqueada: tabela própria, com o motivo da pendência e POR QUE não dá para corrigir aqui", async () => {
    await montar({ linhas: linhasMeli, marketplace: "meli" });
    const tabela = screen.getByRole("table", { name: "Pendências bloqueadas" });
    expect(within(tabela).getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["Produto", "Identificação", "Motivo da pendência", "Receita impactada", "Por que não dá para corrigir aqui"]);
    expect(within(linhaDe("Blusa")).getByText(/Resolva em Bases de Custo/)).toBeInTheDocument();
    expect(within(grupo("bloqueadas")).getByRole("link", { name: /Abrir Bases de Custo/ })).toBeInTheDocument();
  });

  it("custo atual vem do REGISTRO da base (R$ 0,00 real aparece; ausente é '—')", async () => {
    api.base.mockResolvedValue(dadosBase({ produto_id: "MLB1", custo_produto: 0 }));
    await montar({ linhas: linhasMeli, marketplace: "meli" });
    expect(within(linhaDe("Calça")).getAllByRole("cell")[4]).toHaveTextContent("R$ 0,00");
  });

  it("'financeiro pendente' com custo NÃO é pendência de custo; custo ambíguo não ganha campo", async () => {
    await montar({ linhas: linhasMeli, marketplace: "meli" });
    expect(screen.queryByText("Saia")).not.toBeInTheDocument();
    expect(within(linhaDe("Blusa")).queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText(/Custo ambíguo: há custos diferentes/)).toBeInTheDocument();
  });

  it("digita custo e imposto, vê o que será gravado, confirma e grava NA BASE — sem reprocessar sozinho", async () => {
    const usuario = userEvent.setup();
    const reprocessar = vi.fn();
    await montar({ linhas: linhasMeli, marketplace: "meli", onReprocessar: reprocessar });
    const linha = linhaDe("Calça");
    const imposto = within(linha).getByRole("textbox", { name: "Imposto (%) de MLB1" });
    expect(imposto).toHaveValue("8"); // padrão da base (fração 0,08 → 8%)
    expect(within(linha).getByRole("button", { name: "Salvar na base" })).toBeDisabled();
    await usuario.type(within(linha).getByRole("textbox", { name: "Novo custo unitário de MLB1" }), "12,50");
    await usuario.clear(imposto);
    await usuario.type(imposto, "10,5");
    await usuario.click(within(linha).getByRole("button", { name: "Salvar na base" }));

    const confirmacao = screen.getByRole("group", { name: "Confirmar custo de MLB1" });
    expect(linha.nextElementSibling).toContainElement(confirmacao);
    expect(confirmacao).toHaveTextContent("produto_id = MLB1");
    expect(confirmacao).toHaveTextContent("10,5%");
    expect(confirmacao).toHaveTextContent(/registro NOVO/);
    expect(confirmacao).toHaveTextContent(/base vinculada, não um valor só deste fechamento/);
    expect(api.upsert).not.toHaveBeenCalled();

    await usuario.click(screen.getByRole("button", { name: "Confirmar e registrar" }));
    expect(api.upsert).toHaveBeenCalledWith("base-zenite", { produtoId: "MLB1", custoProduto: 12.5, impostoFracao: 0.105, idModel: null, produtoNome: "Calça" });
    expect(await within(linha).findByText("✓ Custo atualizado na base")).toBeInTheDocument();
    expect(reprocessar).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("1 custo foi registrado na base");
    expect(screen.getByRole("button", { name: "Reprocessar fechamento" })).toHaveClass("vf-btn--primary");
    expect(screen.getAllByRole("button", { name: "Reprocessar fechamento" })).toHaveLength(1);
  });

  it("registro que JÁ existe na base: diz 'existente' e usa o imposto dele como sugestão", async () => {
    const usuario = userEvent.setup();
    api.base.mockResolvedValue(dadosBase({ produto_id: "MLB1", custo_produto: 0, imposto_percentual: 0.12 }));
    await montar({ linhas: linhasMeli, marketplace: "meli" });
    const linha = linhaDe("Calça");
    expect(within(linha).getByRole("textbox", { name: "Imposto (%) de MLB1" })).toHaveValue("12");
    await usuario.type(within(linha).getByRole("textbox", { name: "Novo custo unitário de MLB1" }), "9");
    await usuario.click(within(linha).getByRole("button", { name: "Salvar na base" }));
    expect(screen.getByRole("group", { name: "Confirmar custo de MLB1" })).toHaveTextContent(/registro existente/);
  });

  it("custo inválido (0, texto, negativo) ou imposto fora de 0–100 não habilita Salvar", async () => {
    const usuario = userEvent.setup();
    await montar({ linhas: linhasMeli, marketplace: "meli" });
    const linha = linhaDe("Calça");
    const campo = within(linha).getByRole("textbox", { name: "Novo custo unitário de MLB1" });
    for (const v of ["0", "abc", "-3"]) {
      await usuario.clear(campo);
      await usuario.type(campo, v);
      expect(within(linha).getByRole("button", { name: "Salvar na base" })).toBeDisabled();
    }
    await usuario.clear(campo);
    await usuario.type(campo, "10");
    const imposto = within(linha).getByRole("textbox", { name: "Imposto (%) de MLB1" });
    await usuario.clear(imposto);
    await usuario.type(imposto, "150");
    expect(within(linha).getByRole("button", { name: "Salvar na base" })).toBeDisabled();
    expect(api.upsert).not.toHaveBeenCalled();
  });

  it("falha ao registrar: o erro aparece logo abaixo DA linha, pode tentar de novo, nada é reprocessado", async () => {
    api.upsert.mockRejectedValueOnce(new Error("Base fora da sua carteira."));
    const usuario = userEvent.setup();
    const reprocessar = vi.fn();
    await montar({ linhas: linhasMeli, marketplace: "meli", onReprocessar: reprocessar });
    const linha = linhaDe("Calça");
    await usuario.type(within(linha).getByRole("textbox", { name: "Novo custo unitário de MLB1" }), "10");
    await usuario.click(within(linha).getByRole("button", { name: "Salvar na base" }));
    await usuario.click(screen.getByRole("button", { name: "Confirmar e registrar" }));
    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("Base fora da sua carteira.");
    expect(linha.nextElementSibling).toContainElement(alerta);
    expect(screen.getByRole("button", { name: "Confirmar e registrar" })).toBeEnabled();
    expect(reprocessar).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("Reprocessar fechamento (rodapé) chama o mesmo processamento UMA vez", async () => {
    const usuario = userEvent.setup();
    const reprocessar = vi.fn();
    await montar({ linhas: linhasMeli, marketplace: "meli", onReprocessar: reprocessar });
    await usuario.click(screen.getByRole("button", { name: "Reprocessar fechamento" }));
    expect(reprocessar).toHaveBeenCalledTimes(1);
  });

  it("custos de upload (não da base vinculada): sem campos, com o motivo e a planilha mantida", async () => {
    render(<PendenciasCusto linhas={linhasMeli} processamento={{ costsSource: "upload" }} marketplace="meli" base={base} onReprocessar={vi.fn()} />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(await screen.findByText(/Correção direta indisponível neste fechamento/)).toBeInTheDocument();
    expect(screen.getByText(/usou a planilha de custos enviada/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Baixar planilha (XLSX)" })).toBeInTheDocument();
    expect(api.base).not.toHaveBeenCalled(); // não lê base que não foi usada
  });

  it("base de OUTRA conta (slug diferente do usado no processamento): sem campos", async () => {
    render(<PendenciasCusto linhas={linhasMeli} processamento={{ costsSource: "base", costsBase: { slug: "outra-base" } }} marketplace="meli" base={base} onReprocessar={vi.fn()} />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(await screen.findByText(/não é a vinculada a esta operação/)).toBeInTheDocument();
  });

  it("falha ao ler a base: não oferece correção direta (nunca grava às cegas)", async () => {
    api.base.mockRejectedValueOnce(new Error("fora do ar"));
    render(<PendenciasCusto linhas={linhasMeli} processamento={processamentoBase} marketplace="meli" base={base} onReprocessar={vi.fn()} />);
    expect(await screen.findByText(/não foi possível ler a base de custos agora/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("sem pendências não renderiza nada", () => {
    const { container } = render(<PendenciasCusto linhas={normalizarLinhas([{ "# de anúncio": "MLB4", "Venda Total": 1, "Preço de custo": 1, LC: 1, MC: 20, "Cobertura de custo": "com custo" }])} processamento={processamentoBase} marketplace="meli" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("correção individual · Shopee (identidade real da base)", () => {
  const shopeeProps = (linhas, dados) => {
    api.base.mockResolvedValue(dados || dadosBase());
    return { linhas, marketplace: "shopee" };
  };

  it("SEGURA — Item ainda não existe na base: campos liberados e grava Item + Model da própria pendência", async () => {
    const usuario = userEvent.setup();
    await montar(shopeeProps(linhasShopee()));
    const linha = linhaDe("Kit");
    expect(linha).toHaveAttribute("data-identidade", "segura");
    expect(within(linha).getByText("Item 169417000123")).toBeInTheDocument();
    expect(within(linha).getByText("Model 555000000123")).toBeInTheDocument();
    await usuario.type(within(linha).getByRole("textbox", { name: "Novo custo unitário de 169417000123" }), "9,9");
    await usuario.click(within(linha).getByRole("button", { name: "Salvar na base" }));
    expect(screen.getByRole("group", { name: "Confirmar custo de 169417000123" })).toHaveTextContent("id_model = 555000000123");
    await usuario.click(screen.getByRole("button", { name: "Confirmar e registrar" }));
    expect(api.upsert).toHaveBeenCalledWith("base-zenite", { produtoId: "169417000123", custoProduto: 9.9, impostoFracao: 0.08, idModel: "555000000123", produtoNome: "Kit" });
  });

  it("SEGURA — o registro do Item é desta MESMA variação: atualiza preservando o Model", async () => {
    const usuario = userEvent.setup();
    await montar(shopeeProps(linhasShopee(), dadosBase({ produto_id: "169417000123", id_model: "555000000123", custo_produto: 0 })));
    const linha = linhaDe("Kit");
    expect(linha).toHaveAttribute("data-identidade", "segura");
    await usuario.type(within(linha).getByRole("textbox", { name: "Novo custo unitário de 169417000123" }), "7");
    await usuario.click(within(linha).getByRole("button", { name: "Salvar na base" }));
    await usuario.click(screen.getByRole("button", { name: "Confirmar e registrar" }));
    expect(api.upsert.mock.calls[0][1]).toMatchObject({ produtoId: "169417000123", idModel: "555000000123" });
  });

  // FIN-508: a base guarda uma linha por VARIAÇÃO (Item + Model).
  it("SEGURA — o Item tem registro de OUTRA variação: grava ESTA variação sem pedir escolha (a outra não muda)", async () => {
    const usuario = userEvent.setup();
    await montar(shopeeProps(linhasShopee(), dadosBase({ produto_id: "169417000123", id_model: "999000000999", custo_produto: 20, imposto_percentual: 0.1 })));
    const linha = linhaDe("Kit");
    expect(linha).toHaveAttribute("data-identidade", "segura");
    expect(screen.queryByRole("group", { name: /Encontramos 1 registro possível/ })).not.toBeInTheDocument();
    await usuario.type(within(linha).getByRole("textbox", { name: "Novo custo unitário de 169417000123" }), "15");
    await usuario.click(within(linha).getByRole("button", { name: "Salvar na base" }));
    expect(screen.getByRole("group", { name: "Confirmar custo de 169417000123" })).toHaveTextContent("registro NOVO");
    expect(screen.getByRole("group", { name: "Confirmar custo de 169417000123" })).toHaveTextContent("id_model = 555000000123");
    await usuario.click(screen.getByRole("button", { name: "Confirmar e registrar" }));
    expect(api.upsert.mock.calls[0][1]).toMatchObject({ produtoId: "169417000123", idModel: "555000000123", custoProduto: 15 });
  });

  it("AMBÍGUA — a venda não traz o Model e o Item tem UMA variação na base: mostra o registro real e SÓ libera depois de escolher", async () => {
    const usuario = userEvent.setup();
    await montar(shopeeProps(linhasShopee({ "ID Model": null }), dadosBase({ produto_id: "169417000123", id_model: "999000000999", custo_produto: 20, imposto_percentual: 0.1 })));
    const linha = linhaDe("Kit");
    expect(linha).toHaveAttribute("data-identidade", "ambigua");
    const escolha = screen.getByRole("group", { name: /Encontramos 1 registro possível/ });
    expect(escolha).toHaveTextContent("Item 169417000123 · Model 999000000999");
    expect(escolha).toHaveTextContent("Registro atual: custo R$ 20,00 · imposto 10%");
    const campo = within(linha).getByRole("textbox", { name: "Novo custo unitário de 169417000123" });
    expect(campo).toBeDisabled(); // nada é liberado antes da escolha
    await usuario.click(within(escolha).getByRole("radio", { name: /Item 169417000123 · Model 999000000999/ }));
    expect(campo).toBeEnabled();
    await usuario.type(campo, "18");
    await usuario.click(within(linha).getByRole("button", { name: "Atualizar registro selecionado" }));
    await usuario.click(screen.getByRole("button", { name: "Confirmar e registrar" }));
    // grava a variação escolhida — com o Model DELA, nunca como linha pai
    expect(api.upsert.mock.calls[0][1]).toMatchObject({ produtoId: "169417000123", idModel: "999000000999", custoProduto: 18 });
  });

  it("INSUFICIENTE — sem ID do Item (só Model): grupo 3, sem campos, e diz que nem a planilha resolve", async () => {
    const linhas = normalizarLinhas([{ Produto: "Kit", "ID Model": "555000000123", "Vendas (Pedido pago) (BRL)": 10, "Cobertura de custo": "sem custo" }]);
    await montar(shopeeProps(linhas));
    const linha = linhaDe("Kit");
    expect(linha).toHaveAttribute("data-identidade", "insuficiente");
    expect(grupo("bloqueadas")).toContainElement(linha);
    expect(within(linha).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(linha).getByText(/Sem ID do Item nesta linha/)).toBeInTheDocument();
    expect(within(linha).getByText(/nem aqui, nem pela planilha/)).toBeInTheDocument();
    expect(contagens()).toEqual([["agora", 0], ["planilha", 0], ["bloqueadas", 1]]);
  });

  it("Shopee misto: 1 segura (grupo 1), 1 venda sem Model para Item com variação (decisão) e 1 sem Item (bloqueada) — contagem 1 · 0 · 2", async () => {
    const linhas = normalizarLinhas([
      shopeeLinha({ Produto: "Kit Seguro", ID: "100", "ID Model": "1001" }),
      shopeeLinha({ Produto: "Kit Conflito", ID: "200", "ID Model": null }),
      { Produto: "Kit Sem Item", "ID Model": "3001", "Vendas (Pedido pago) (BRL)": 10, "Cobertura de custo": "sem custo" },
    ]);
    await montar(shopeeProps(linhas, dadosBase({ produto_id: "200", id_model: "2999", custo_produto: 20 })));
    expect(contagens()).toEqual([["agora", 1], ["planilha", 0], ["bloqueadas", 2]]);
    expect(grupo("agora")).toContainElement(linhaDe("Kit Seguro"));
    const decisao = grupo("bloqueadas").querySelector('[data-subgrupo="decisao"]');
    expect(decisao).toHaveTextContent("Dependem de decisão (1)");
    expect(decisao).toContainElement(linhaDe("Kit Conflito"));
    const bloqueadas = grupo("bloqueadas").querySelector('[data-subgrupo="bloqueadas"]');
    expect(bloqueadas).toHaveTextContent("Bloqueadas (1)");
    expect(bloqueadas).toContainElement(linhaDe("Kit Sem Item"));
  });

  it("INSUFICIENTE — venda sem Model e o Item tem 2 variações na base: o servidor não escolhe, a tela também não", async () => {
    await montar(shopeeProps(linhasShopee({ "ID Model": null }), dadosBase({ produto_id: "169417000123", id_model: "1" }, { produto_id: "169417000123", id_model: "2" })));
    expect(linhaDe("Kit")).toHaveAttribute("data-identidade", "insuficiente");
    expect(screen.getByText(/2 variações na base e esta venda não diz qual/)).toBeInTheDocument();
  });

  it("duas variações do MESMO Item são registros próprios: gravar a 1ª não bloqueia nem substitui a 2ª", async () => {
    const usuario = userEvent.setup();
    const linhas = normalizarLinhas([
      shopeeLinha({ Produto: "Kit A", "ID Model": "111" }),
      shopeeLinha({ Produto: "Kit B", "ID Model": "222" }),
    ]);
    await montar(shopeeProps(linhas));
    const a = linhaDe("Kit A");
    expect(a).toHaveAttribute("data-identidade", "segura");
    expect(linhaDe("Kit B")).toHaveAttribute("data-identidade", "segura");
    // Models diferentes: nenhum aviso de "mesmo registro"
    expect(within(a).queryByText(/mesmo registro da base/)).not.toBeInTheDocument();
    await usuario.type(within(a).getByRole("textbox", { name: "Novo custo unitário de 169417000123" }), "5");
    await usuario.click(within(a).getByRole("button", { name: "Salvar na base" }));
    await usuario.click(screen.getByRole("button", { name: "Confirmar e registrar" }));
    await within(a).findByText("✓ Custo atualizado na base");
    // a 2ª variação continua segura e grava o SEU Model
    const b = linhaDe("Kit B");
    expect(b).toHaveAttribute("data-identidade", "segura");
    await usuario.type(within(b).getByRole("textbox", { name: "Novo custo unitário de 169417000123" }), "9");
    await usuario.click(within(b).getByRole("button", { name: "Salvar na base" }));
    await usuario.click(screen.getByRole("button", { name: "Confirmar e registrar" }));
    await within(b).findByText("✓ Custo atualizado na base");
    expect(api.upsert.mock.calls.map((c) => [c[1].idModel, c[1].custoProduto])).toEqual([["111", 5], ["222", 9]]);
  });

});

describe("correção em lote · importação dentro do Financeiro", () => {
  const muitas = (n) => normalizarLinhas(Array.from({ length: n }, (_, i) => ({ "# de anúncio": `MLB${100 + i}`, "Título do anúncio": `Item ${i}`, "Venda Total": 1000 - i, "Preço de custo": null, LC: null, MC: null, "Cobertura de custo": "sem custo" })));
  const planilha = () => new File(["x"], "pendencias-preenchida.xlsx", { type: "application/vnd.ms-excel" });
  const previa = (dados, extra = {}) => ({ ok: true, dados_importacao: dados, resumo: { linhas_lidas: dados.length + 1, linhas_ignoradas: 1 }, alertas: [], ...extra });

  async function abrirLote(props = {}) {
    await montar({ linhas: muitas(30), marketplace: "meli", ...props });
    return userEvent.setup();
  }

  it("mostra os 5 passos na ordem: baixar → preencher → enviar → atualizar a base → reprocessar", async () => {
    await abrirLote();
    const passos = Array.from(screen.getByLabelText("Correção em lote").querySelectorAll("[data-passo]")).map((e) => e.dataset.passo);
    expect(passos).toEqual(["baixar", "preencher", "enviar", "importar", "reprocessar"]);
  });

  it("não permite importar antes de enviar uma planilha", async () => {
    await abrirLote();
    expect(screen.getByRole("button", { name: "Importar e atualizar base" })).toBeDisabled();
  });

  it("baixar: XLSX com o nome do fechamento", async () => {
    const usuario = await abrirLote({ contexto: { competencia: "2026-10" } });
    globalThis.URL.createObjectURL = vi.fn(() => "blob:x");
    globalThis.URL.revokeObjectURL = vi.fn();
    const clique = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await usuario.click(screen.getByRole("button", { name: "Baixar XLSX" }));
    expect(clique.mock.instances[0].download).toBe("pendencias-custo-meli-2026-10.xlsx");
    expect(globalThis.URL.createObjectURL.mock.calls[0][0].type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    clique.mockRestore();
  });

  it("enviar: lê pelo parser REAL (preview), classifica contra a base e mostra o resumo ANTES de gravar", async () => {
    api.base.mockResolvedValue(dadosBase({ produto_id: "MLB100", custo_produto: 0 }));
    api.preview.mockResolvedValue(previa([{ id: "MLB100", custo: 5, imposto: 0.1 }, { id: "MLB101", custo: 6, imposto: null }]));
    const usuario = await abrirLote();
    await usuario.upload(screen.getByLabelText("Planilha de custos preenchida"), planilha());
    const resumo = await screen.findByText(/1 para atualizar/);
    expect(api.preview).toHaveBeenCalledWith(expect.any(File), { marketplace: "meli" });
    const bloco = resumo.closest("[data-previa]");
    expect(bloco).toHaveTextContent("1 para adicionar");
    expect(bloco).toHaveTextContent("1 sem Novo custo (ignoradas)");
    expect(bloco).toHaveTextContent("0 ambíguas");
    expect(bloco).toHaveTextContent("2 linhas corrigem pendências desta tela (30 no total)");
    expect(api.upsert).not.toHaveBeenCalled();
  });

  it("importar: atualiza a BASE linha a linha (mesmo endpoint) e mostra ✓ atualizados / ⚠ ignoradas / ✕ ambíguas — depois reprocessa", async () => {
    api.preview.mockResolvedValue(previa([{ id: "MLB100", custo: 5, imposto: 0.1 }, { id: "MLB101", custo: 6, imposto: null }, { id: "MLB102", custo: 7, imposto: null }, { id: "MLB102", custo: 8, imposto: null }]));
    api.upsert.mockResolvedValueOnce({ ok: true, acao: "atualizado" }).mockResolvedValueOnce({ ok: true, acao: "criado" });
    api.base.mockResolvedValue(dadosBase({ produto_id: "MLB100", custo_produto: 0 }));
    const reprocessar = vi.fn();
    const usuario = await abrirLote({ onReprocessar: reprocessar });
    await usuario.upload(screen.getByLabelText("Planilha de custos preenchida"), planilha());
    await screen.findByText(/para atualizar/);
    await usuario.click(screen.getByRole("button", { name: "Importar e atualizar base" }));
    const resultado = await screen.findByText(/✓ 2 custos atualizados na base/);
    expect(api.upsert).toHaveBeenCalledTimes(2); // MLB102 (valores diferentes na planilha) é ambígua e NÃO foi gravada
    expect(api.upsert).toHaveBeenNthCalledWith(1, "base-zenite", { produtoId: "MLB100", custoProduto: 5, impostoFracao: 0.1, idModel: null, produtoNome: null });
    expect(api.upsert).toHaveBeenNthCalledWith(2, "base-zenite", { produtoId: "MLB101", custoProduto: 6, impostoFracao: null, idModel: null, produtoNome: null });
    const bloco = resultado.closest("[data-resultado]");
    expect(bloco).toHaveTextContent("1 novos, 1 existentes");
    expect(bloco).toHaveTextContent("⚠ 1 linha ignorada (sem Novo custo)");
    expect(bloco).toHaveTextContent("✕ 1 linha ambígua, não gravada");
    expect(reprocessar).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Reprocessar fechamento" })).toHaveClass("vf-btn--primary");
    await usuario.click(screen.getByRole("button", { name: "Reprocessar fechamento" }));
    expect(reprocessar).toHaveBeenCalledTimes(1);
    // a base foi relida depois de gravar
    await waitFor(() => expect(api.base.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("feedback por linha: a falha de uma linha aparece com o ID e não impede as outras", async () => {
    api.preview.mockResolvedValue(previa([{ id: "MLB100", custo: 5 }, { id: "MLB101", custo: 6 }]));
    api.upsert.mockRejectedValueOnce(new Error("Base fora da sua carteira.")).mockResolvedValueOnce({ ok: true, acao: "criado" });
    const usuario = await abrirLote();
    await usuario.upload(screen.getByLabelText("Planilha de custos preenchida"), planilha());
    await screen.findByText(/2 para adicionar/);
    await usuario.click(screen.getByRole("button", { name: "Importar e atualizar base" }));
    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("1 linha falhou");
    expect(alerta).toHaveTextContent("MLB100");
    expect(alerta).toHaveTextContent("Base fora da sua carteira.");
    expect(screen.getByText(/✓ 1 custo atualizado na base/)).toBeInTheDocument();
  });

  it("Shopee: linha SEM Model para Item que só tem variações na base é ambígua — não grava e diz por quê", async () => {
    api.base.mockResolvedValue(dadosBase({ produto_id: "169417000123", id_model: "999", custo_produto: 20 }));
    api.preview.mockResolvedValue(previa([{ id: "169417000123", id_model: null, custo: 5 }]));
    const usuario = await abrirLote({ linhas: normalizarLinhas(Array.from({ length: 20 }, (_, i) => shopeeLinha({ Produto: `Kit ${i}`, ID: String(169417000100 + i), "ID Model": String(555000 + i) }))), marketplace: "shopee" });
    await usuario.upload(screen.getByLabelText("Planilha de custos preenchida"), planilha());
    await screen.findByText(/1 ambíguas/);
    expect(screen.getByRole("button", { name: "Importar e atualizar base" })).toBeDisabled(); // nada gravável
    await usuario.click(screen.getByText(/Ver as 1 linhas ambíguas/));
    expect(screen.getByText(/não traz o Model/)).toBeInTheDocument();
    expect(api.upsert).not.toHaveBeenCalled();
  });

  it("Shopee: outro Model do mesmo Item é ADICIONADO como variação, sem tocar a existente", async () => {
    api.base.mockResolvedValue(dadosBase({ produto_id: "169417000123", id_model: "999", custo_produto: 20 }));
    api.preview.mockResolvedValue(previa([{ id: "169417000123", id_model: "555", custo: 5 }, { id: "169417000123", id_model: "999", custo: 21 }]));
    const usuario = await abrirLote({ linhas: normalizarLinhas(Array.from({ length: 20 }, (_, i) => shopeeLinha({ Produto: `Kit ${i}`, ID: String(169417000100 + i), "ID Model": String(555000 + i) }))), marketplace: "shopee" });
    await usuario.upload(screen.getByLabelText("Planilha de custos preenchida"), planilha());
    await screen.findByText(/0 ambíguas/);
    await usuario.click(screen.getByRole("button", { name: "Importar e atualizar base" }));
    await waitFor(() => expect(api.upsert).toHaveBeenCalledTimes(2));
    expect(api.upsert.mock.calls.map((c) => [c[1].idModel, c[1].custoProduto])).toEqual([["555", 5], ["999", 21]]);
  });

  it("planilha com cabeçalho não reconhecido: o erro do leitor real aparece e bloqueia a importação", async () => {
    api.preview.mockResolvedValue(previa([{ id: "MLB100", custo: 5 }], { alertas: [{ tipo: "sem_coluna_custo", nivel: "erro", mensagem: "Não foi possível detectar a coluna de custo." }] }));
    const usuario = await abrirLote();
    await usuario.upload(screen.getByLabelText("Planilha de custos preenchida"), planilha());
    expect(await screen.findByText("Não foi possível detectar a coluna de custo.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Importar e atualizar base" })).toBeDisabled();
  });

  it("arquivo ilegível/inválido: mostra o erro e não habilita nada", async () => {
    api.preview.mockRejectedValue(new Error("A planilha está vazia."));
    const usuario = await abrirLote();
    await usuario.upload(screen.getByLabelText("Planilha de custos preenchida"), planilha());
    expect(await screen.findByText("A planilha está vazia.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Importar e atualizar base" })).toBeDisabled();
  });
});
