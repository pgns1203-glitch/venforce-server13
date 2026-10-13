import { describe, it, expect } from "vitest";
import { normalizarLinhaProduto, filtrarLinhas, contarPorFiltro, normalizarLinhas } from "./produtos.js";

const meli = (extra = {}) => ({
  "# de anúncio": "MLB1",
  "Título do anúncio": "Calça Jeans",
  Unidades: 2,
  "Venda Total": 200,
  "Total (BRL)": 150,
  Imposto: 10,
  "Preço de custo": 40,
  "Preço de custo total": 80,
  LC: 50,
  MC: 25,
  "Cobertura de custo": "com custo",
  ...extra,
});

describe("normalizarLinhaProduto · eixos custo × financeiro", () => {
  it("custo existente + financeiro pendente → Aguardando financeiro, NUNCA Sem custo", () => {
    const l = normalizarLinhaProduto(meli({ "Total (BRL)": null, LC: null, MC: null, "Cobertura de custo": "financeiro pendente" }));
    expect(l.statusFinanceiro).toBe("pendente");
    expect(l.statusCusto).toBe("ok");
    expect(l.statusPrincipal).toBe("aguardando_financeiro");
    expect(l.lc).toBeNull();
    expect(l.mc).toBeNull();
  });

  it("financeiro pendente sem custo: principal continua Aguardando financeiro; custo é detalhe", () => {
    const l = normalizarLinhaProduto(meli({ "Preço de custo": null, "Preço de custo total": null, LC: null, MC: null, "Cobertura de custo": "financeiro pendente" }));
    expect(l.statusPrincipal).toBe("aguardando_financeiro");
    expect(l.statusCusto).toBe("sem_custo");
  });

  it("financeiro pendente com id ambíguo no summary → custo ambíguo como detalhe", () => {
    const l = normalizarLinhaProduto(meli({ "Preço de custo": null, "Cobertura de custo": "financeiro pendente" }), { ambiguousIds: ["MLB1"] });
    expect(l.statusCusto).toBe("ambiguo");
  });

  it("backend informa custo ausente → Sem custo", () => {
    const l = normalizarLinhaProduto(meli({ "Preço de custo": null, LC: null, MC: null, "Cobertura de custo": "sem custo" }));
    expect(l.statusPrincipal).toBe("sem_custo");
  });

  it("custo ambíguo não escolhe candidato: sem custo unitário e status próprio", () => {
    const l = normalizarLinhaProduto(meli({ "Preço de custo": null, LC: null, MC: null, "Cobertura de custo": "custo ambíguo" }));
    expect(l.statusPrincipal).toBe("custo_ambiguo");
    expect(l.custoUnitario).toBeNull();
  });

  it("Shopee Order.all: Match de custo 'ambiguous' é custo ambíguo, não sem custo", () => {
    const l = normalizarLinhaProduto({ "ID do pedido": "P1", Produto: "Kit", SKU: "K1", "Receita bruta": 99, "Match de custo": "ambiguous", "Cobertura de custo": "sem custo", LC: null, MC: null });
    expect(l.statusPrincipal).toBe("custo_ambiguo");
  });

  it("saúde pela MC do backend (pontos): <0 crítico, <15 atenção", () => {
    expect(normalizarLinhaProduto(meli({ MC: -3 })).statusPrincipal).toBe("critico");
    expect(normalizarLinhaProduto(meli({ MC: 10 })).statusPrincipal).toBe("atencao");
    expect(normalizarLinhaProduto(meli({ MC: 25 })).statusPrincipal).toBe("saudavel");
  });

  it("Shopee Performance: LC exibido é o LC POR ANÚNCIO (total), e Model ID é lido", () => {
    const l = normalizarLinhaProduto({ Produto: "Blusa", ID: "111", "ID Model": "222", "Vendas (Pedido pago) (BRL)": 300, "Unidades (Pedido pago)": 3, Custo: 20, Imposto: 6, LC: 10, MC: 30, "LC POR ANÚNCIO": 30, "Cobertura de custo": "com custo" });
    expect(l.lc).toBe(30);
    expect(l.modelId).toBe("222");
    expect(l.receita).toBe(300);
  });

  it("imposto MELI 0,10 é lido como 10% (mesma leitura do motor)", () => {
    expect(normalizarLinhaProduto(meli({ Imposto: 0.1 })).impostoPercentual).toBeCloseTo(10);
    expect(normalizarLinhaProduto(meli({ Imposto: 12 })).impostoPercentual).toBe(12);
  });

  it("cancelado/devolvido vem do status do pedido (Order.all)", () => {
    const l = normalizarLinhaProduto({ "ID do pedido": "P2", Produto: "X", "Cobertura de custo": "com custo", MC: 20, "Status do pedido": "cancelado" });
    expect(l.canceladoOuDevolvido).toBe(true);
  });
});

describe("filtros e busca", () => {
  const linhas = normalizarLinhas([
    meli({ "# de anúncio": "MLB1", MC: 25 }),
    meli({ "# de anúncio": "MLB2", "Título do anúncio": "Jaqueta", MC: 5 }),
    meli({ "# de anúncio": "MLB3", "Preço de custo": null, "Cobertura de custo": "sem custo", LC: null, MC: null }),
    meli({ "# de anúncio": "MLB4", "Cobertura de custo": "financeiro pendente", LC: null, MC: null }),
  ]);

  it("cada linha cai em UM status principal", () => {
    const c = contarPorFiltro(linhas);
    expect(c.todos).toBe(4);
    expect(c.saudaveis + c.atencao + c.criticos + c.sem_custo + c.custo_ambiguo + c.aguardando_financeiro).toBe(4);
    expect(c.sem_custo).toBe(1);
    expect(c.aguardando_financeiro).toBe(1);
  });

  it("busca por título, ID (sem acento/caixa)", () => {
    expect(filtrarLinhas(linhas, { busca: "jaqueta" }).map((l) => l.itemId)).toEqual(["MLB2"]);
    expect(filtrarLinhas(linhas, { busca: "mlb3" }).map((l) => l.itemId)).toEqual(["MLB3"]);
  });
});
