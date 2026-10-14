import { describe, it, expect } from "vitest";
import {
  classificarLinhasPlanilha,
  fracaoParaPontos,
  identidadeDaPendencia,
  indexarPorProduto,
  itensDaBase,
  normalizarIdMeli,
  normalizarIdShopee,
  parsePontosBR,
  pontosParaFracao,
} from "./baseCustos.js";

const item = (produtoId, idModel = null, extra = {}) => ({ produtoId, idModel, sku: null, custo: 10, imposto: 0.08, nome: null, ...extra });
const pend = (extra = {}) => ({ itemId: "169417000123", modelId: "555000000123", sku: null, statusCusto: "sem_custo", produto: "Kit", ...extra });
const idt = (marketplace, p, itens = []) => identidadeDaPendencia({ marketplace, pendencia: p, indice: indexarPorProduto(itens) });

describe("imposto · fração (banco) ↔ pontos (tela)", () => {
  it("0,105 ↔ 10,5 e o '%' elimina a ambiguidade 0,5 × 50", () => {
    expect(fracaoParaPontos(0.105)).toBe(10.5);
    expect(fracaoParaPontos(0.08)).toBe(8);
    expect(fracaoParaPontos(null)).toBeNull();
    expect(pontosParaFracao(10.5)).toBe(0.105);
    expect(pontosParaFracao(0.5)).toBe(0.005); // 0,5% é meio por cento, nunca 50%
  });
  it("parsePontosBR: pt-BR, ponto, '%', vazio e inválido", () => {
    expect(parsePontosBR("10,5")).toBe(10.5);
    expect(parsePontosBR("10.5")).toBe(10.5);
    expect(parsePontosBR("8%")).toBe(8);
    expect(parsePontosBR("")).toBeNull();
    expect(parsePontosBR("abc")).toBeNaN();
  });
});

describe("normalização de ID (a mesma do servidor)", () => {
  it("MELI: prefixa MLB em número puro, extrai o MLB de um texto e tira '.0'", () => {
    expect(normalizarIdMeli("123456")).toBe("MLB123456");
    expect(normalizarIdMeli("mlb123456")).toBe("MLB123456");
    expect(normalizarIdMeli("123456.0")).toBe("MLB123456");
    expect(normalizarIdMeli("")).toBe("");
  });
  it("Shopee: sem prefixo, tira aspas e '.0'", () => {
    expect(normalizarIdShopee("'169417000123'")).toBe("169417000123");
    expect(normalizarIdShopee("169417000123.0")).toBe("169417000123");
  });
});

describe("itensDaBase", () => {
  it("lê o dicionário de GET /bases/:slug; imposto continua FRAÇÃO e custo ausente continua null", () => {
    const itens = itensDaBase({ dados: { A: { produto_id: "MLB1", custo_produto: 12.5, imposto_percentual: 0.08, id_model: null }, B: { produto_id: "MLB2", custo_produto: null, imposto_percentual: 0.1 } } });
    expect(itens[0]).toMatchObject({ produtoId: "MLB1", custo: 12.5, imposto: 0.08, idModel: null });
    expect(itens[1].custo).toBeNull();
  });
});

describe("identidadeDaPendencia · MELI", () => {
  it("MLB que ainda não existe na base → segura, criar", () => {
    expect(idt("meli", pend({ itemId: "MLB1", modelId: null }))).toMatchObject({ classe: "segura", acao: "criar", produtoId: "MLB1" });
  });
  it("MLB que já existe (custo vazio/zero) → segura, atualizar", () => {
    const r = idt("meli", pend({ itemId: "MLB1", modelId: null }), [item("MLB1", null, { custo: 0 })]);
    expect(r).toMatchObject({ classe: "segura", acao: "atualizar" });
    expect(r.registro.custo).toBe(0);
  });
  it("custo ambíguo nunca é corrigível aqui", () => {
    expect(idt("meli", pend({ itemId: "MLB1", statusCusto: "ambiguo" })).classe).toBe("insuficiente");
  });
});

describe("identidadeDaPendencia · Shopee", () => {
  it("SEGURA — Item não existe na base: cria (Item + Model da própria pendência)", () => {
    const r = idt("shopee", pend());
    expect(r).toMatchObject({ classe: "segura", acao: "criar", produtoId: "169417000123", idModel: "555000000123" });
  });
  it("SEGURA — o registro do Item é exatamente desta variação: atualiza preservando o Model", () => {
    const r = idt("shopee", pend(), [item("169417000123", "555000000123", { custo: 0 })]);
    expect(r).toMatchObject({ classe: "segura", acao: "atualizar", idModel: "555000000123" });
  });
  it("SEGURA — pendência de item (sem Model) e registro sem Model", () => {
    expect(idt("shopee", pend({ modelId: null }), [item("169417000123", null)]).classe).toBe("segura");
  });
  // FIN-508: a base guarda uma linha por VARIAÇÃO (Item + Model).
  it("SEGURA — o Item tem registro de OUTRA variação: cria esta variação, a outra não muda", () => {
    const r = idt("shopee", pend(), [item("169417000123", "999000000999", { custo: 20 })]);
    expect(r).toMatchObject({ classe: "segura", acao: "criar", produtoId: "169417000123", idModel: "555000000123", registro: null });
  });
  it("SEGURA — pendência de variação e registro só do item pai: cria a variação (o pai continua)", () => {
    expect(idt("shopee", pend(), [item("169417000123", null)])).toMatchObject({ classe: "segura", acao: "criar", idModel: "555000000123" });
  });
  it("SEGURA — várias variações na base: atualiza EXATAMENTE a do Model da pendência", () => {
    const r = idt("shopee", pend(), [item("169417000123", "1"), item("169417000123", "555000000123", { custo: 7 }), item("169417000123", "3")]);
    expect(r).toMatchObject({ classe: "segura", acao: "atualizar", idModel: "555000000123" });
    expect(r.registro.custo).toBe(7);
  });
  it("SEGURA — pendência sem Model, base com o pai e variações: atualiza o pai", () => {
    const r = idt("shopee", pend({ modelId: null }), [item("169417000123", null, { custo: 4 }), item("169417000123", "1")]);
    expect(r).toMatchObject({ classe: "segura", acao: "atualizar", idModel: null });
    expect(r.registro.custo).toBe(4);
  });
  it("AMBÍGUA — pendência sem Model e o Item tem UMA variação: só ela é candidata, gravando o Model dela", () => {
    const r = idt("shopee", pend({ modelId: null }), [item("169417000123", "999000000999")]);
    expect(r.classe).toBe("ambigua");
    expect(r.candidatos.map((c) => c.id)).toEqual(["registro"]);
    expect(r.candidatos[0].idModel).toBe("999000000999");
  });
  it("INSUFICIENTE — pendência sem Model e o Item tem várias variações: não escolhe nenhuma", () => {
    const r = idt("shopee", pend({ modelId: null }), [item("169417000123", "1"), item("169417000123", "2")]);
    expect(r.classe).toBe("insuficiente");
    expect(r.motivo).toMatch(/2 variações na base e esta venda não diz qual/);
  });
  it("INSUFICIENTE — sem ID do Item (só SKU/pedido)", () => {
    const r = idt("shopee", pend({ itemId: null, sku: "AB-1", modelId: null }));
    expect(r.classe).toBe("insuficiente");
    expect(r.motivo).toMatch(/Sem ID do Item nesta linha/);
  });
  it("INSUFICIENTE — 2+ registros da MESMA variação (legado por SKU): o servidor não escolhe, a tela também não", () => {
    const r = idt("shopee", pend(), [item("169417000123", "555000000123", { sku: "A" }), item("169417000123", "555000000123", { sku: "B" })]);
    expect(r.classe).toBe("insuficiente");
    expect(r.motivo).toMatch(/2 registros/);
  });
  it("IDs comparados por IGUALDADE exata — prefixo parecido não casa", () => {
    expect(idt("shopee", pend(), [item("1694170001239", "555000000123")]).acao).toBe("criar");
  });
});

describe("classificarLinhasPlanilha", () => {
  const base = [item("MLB1"), item("MLB2")];
  it("atualizar / adicionar conforme o ID já exista na base", () => {
    const { linhas, resumo } = classificarLinhasPlanilha({ marketplace: "meli", dados: [{ id: "MLB1", custo: 5, imposto: 0.1 }, { id: "MLB9", custo: 7, imposto: null }], itensBase: base });
    expect(linhas.map((l) => l.acao)).toEqual(["atualizar", "adicionar"]);
    expect(resumo).toMatchObject({ atualizar: 1, adicionar: 1, ambiguas: 0 });
    expect(linhas[1].imposto).toBeNull(); // sem imposto na planilha: nada é inventado
  });
  it("mesmo ID repetido e IGUAL conta uma vez; repetido com valores diferentes é ambíguo e não grava nada", () => {
    const iguais = classificarLinhasPlanilha({ marketplace: "meli", dados: [{ id: "MLB1", custo: 5 }, { id: "MLB1", custo: 5 }], itensBase: base });
    expect(iguais.linhas).toHaveLength(1);
    expect(iguais.resumo.repetidasIguais).toBe(1);
    const diferentes = classificarLinhasPlanilha({ marketplace: "meli", dados: [{ id: "MLB1", custo: 5 }, { id: "MLB1", custo: 6 }], itensBase: base });
    expect(diferentes.linhas).toHaveLength(1);
    expect(diferentes.linhas[0].acao).toBe("ambigua");
  });
  it("Shopee: identidade Item + Model — mesmo Model atualiza, outro Model do mesmo Item adiciona, Item novo adiciona", () => {
    const itens = [item("111", "A"), item("222", "B")];
    const { linhas, resumo } = classificarLinhasPlanilha({
      marketplace: "shopee",
      dados: [{ id: "111", id_model: "A", custo: 1 }, { id: "222", id_model: "OUTRO", custo: 2 }, { id: "333", id_model: "C", custo: 3 }],
      itensBase: itens,
    });
    expect(linhas.map((l) => [l.produtoId, l.idModel, l.acao])).toEqual([["111", "A", "atualizar"], ["222", "OUTRO", "adicionar"], ["333", "C", "adicionar"]]);
    expect(resumo).toMatchObject({ atualizar: 1, adicionar: 2, ambiguas: 0 });
  });
  it("Shopee: Models diferentes do MESMO Item na planilha não são repetição", () => {
    const { linhas, resumo } = classificarLinhasPlanilha({ marketplace: "shopee", dados: [{ id: "111", id_model: "A", custo: 1 }, { id: "111", id_model: "B", custo: 9 }], itensBase: [] });
    expect(linhas.map((l) => l.acao)).toEqual(["adicionar", "adicionar"]);
    expect(resumo.repetidasIguais).toBe(0);
  });
  it("Shopee: a MESMA variação repetida com valores diferentes é ambígua e não grava", () => {
    const { linhas } = classificarLinhasPlanilha({ marketplace: "shopee", dados: [{ id: "111", id_model: "A", custo: 1 }, { id: "111", id_model: "A", custo: 2 }], itensBase: [] });
    expect(linhas).toHaveLength(1);
    expect(linhas[0].acao).toBe("ambigua");
  });
  it("Shopee: linha sem Model para Item que só tem variações na base → ambígua (preencha o Model)", () => {
    const { linhas } = classificarLinhasPlanilha({ marketplace: "shopee", dados: [{ id: "222", id_model: null, custo: 2 }], itensBase: [item("222", "B")] });
    expect(linhas[0].acao).toBe("ambigua");
    expect(linhas[0].motivo).toMatch(/não traz o Model/);
  });
  it("Shopee: registro do Item sem Model e linha com Model → adiciona a variação (o pai continua)", () => {
    const { linhas } = classificarLinhasPlanilha({ marketplace: "shopee", dados: [{ id: "111", id_model: "A", custo: 1 }], itensBase: [item("111", null)] });
    expect(linhas[0].acao).toBe("adicionar");
  });
  it("2+ registros do ID na base → ambígua", () => {
    const { linhas } = classificarLinhasPlanilha({ marketplace: "meli", dados: [{ id: "MLB1", custo: 5 }], itensBase: [item("MLB1", null, { sku: "A" }), item("MLB1", null, { sku: "B" })] });
    expect(linhas[0].acao).toBe("ambigua");
  });
});
