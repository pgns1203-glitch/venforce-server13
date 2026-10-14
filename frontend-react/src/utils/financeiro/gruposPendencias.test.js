import { describe, it, expect } from "vitest";
import { classificarPendencias, LIMITE_CORRECAO_INDIVIDUAL } from "./gruposPendencias.js";
import { indexarPorProduto } from "./baseCustos.js";

const pend = (chave, extra = {}) => ({ chave, itemId: chave, modelId: null, sku: null, statusCusto: "sem_custo", produto: chave, ...extra });
const meli = (n) => Array.from({ length: n }, (_, i) => pend(`MLB${100 + i}`));
const total = (g) => g.contagem.agora + g.contagem.planilha + g.contagem.bloqueadas;

describe("classificarPendencias · partição em três grupos", () => {
  it("cada pendência cai em exatamente UM grupo e a soma bate com o total", () => {
    const pendencias = [
      pend("MLB1"),
      pend("MLB2", { statusCusto: "ambiguo" }),
      pend("SEMID", { itemId: null }),
      pend("MLB3"),
    ];
    const g = classificarPendencias({ pendencias, marketplace: "meli", indice: new Map() });
    expect(total(g)).toBe(pendencias.length);
    expect(g.agora.map((p) => p.chave)).toEqual(["MLB1", "MLB3"]);
    expect(g.bloqueadas.map((b) => b.pendencia.chave)).toEqual(["MLB2", "SEMID"]);
    expect(g.bloqueadas.every((b) => typeof b.motivo === "string" && b.motivo.length > 0)).toBe(true);
  });

  it(`volume: até ${LIMITE_CORRECAO_INDIVIDUAL} corrigíveis no portal; acima disso, na planilha`, () => {
    const noLimite = classificarPendencias({ pendencias: meli(LIMITE_CORRECAO_INDIVIDUAL), marketplace: "meli", indice: new Map() });
    expect(noLimite.modo).toBe("portal");
    expect(noLimite.contagem).toEqual({ agora: LIMITE_CORRECAO_INDIVIDUAL, planilha: 0, bloqueadas: 0 });
    const acima = classificarPendencias({ pendencias: meli(LIMITE_CORRECAO_INDIVIDUAL + 1), marketplace: "meli", indice: new Map() });
    expect(acima.modo).toBe("planilha");
    expect(acima.contagem).toEqual({ agora: 0, planilha: LIMITE_CORRECAO_INDIVIDUAL + 1, bloqueadas: 0 });
  });

  it("a preferência do operador vence o volume, nos dois sentidos — e as bloqueadas não se mexem", () => {
    const pendencias = [...meli(20), pend("X", { statusCusto: "ambiguo" })];
    const portal = classificarPendencias({ pendencias, marketplace: "meli", indice: new Map(), preferencia: "portal" });
    expect(portal.contagem).toEqual({ agora: 20, planilha: 0, bloqueadas: 1 });
    const planilha = classificarPendencias({ pendencias: meli(2), marketplace: "meli", indice: new Map(), preferencia: "planilha" });
    expect(planilha.contagem).toEqual({ agora: 0, planilha: 2, bloqueadas: 0 });
  });

  it("Shopee (FIN-508): Item com registro de OUTRA variação é corrigível — a variação nova tem registro próprio", () => {
    const indice = indexarPorProduto([{ produtoId: "200", idModel: "2999", sku: null, custo: 20, imposto: 0.1 }]);
    const g = classificarPendencias({ pendencias: [pend("200", { modelId: "2001" })], marketplace: "shopee", indice });
    expect(g.agora).toHaveLength(1);
    expect(g.contagem).toEqual({ agora: 1, planilha: 0, bloqueadas: 0 });
  });

  it("Shopee: venda sem Model e Item com UMA variação na base depende de decisão (não é bloqueio cego, nem gravação silenciosa)", () => {
    const indice = indexarPorProduto([{ produtoId: "200", idModel: "2999", sku: null, custo: 20, imposto: 0.1 }]);
    const g = classificarPendencias({ pendencias: [pend("200", { modelId: null })], marketplace: "shopee", indice });
    expect(g.decisao).toHaveLength(1);
    expect(g.contagem).toEqual({ agora: 0, planilha: 0, bloqueadas: 1 });
  });

  it("o que já foi gravado nesta tela fica no grupo em que foi corrigido, mesmo que a base relida mude a identidade", () => {
    const indice = indexarPorProduto([{ produtoId: "200", idModel: "OUTRO", sku: null, custo: 5, imposto: null }]);
    const p = pend("200", { modelId: "2001" });
    const g = classificarPendencias({ pendencias: [p], marketplace: "shopee", indice, registrados: { 200: { custo: 5 } } });
    expect(g.agora).toEqual([p]);
    expect(g.decisao).toHaveLength(0);
  });

  it("pendências seguras do MESMO registro são marcadas (Shopee: mesmo Item E mesmo Model)", () => {
    const g = classificarPendencias({
      pendencias: [
        pend("A", { itemId: "300", modelId: "1" }),
        pend("B", { itemId: "300", modelId: "2" }),
        pend("A2", { itemId: "300", modelId: "1" }),
        pend("C", { itemId: "400" }),
      ],
      marketplace: "shopee",
      indice: new Map(),
    });
    // Models 1 e 2 do Item 300 são registros diferentes — só A e A2 colidem.
    expect(g.mesmoItem).toEqual({ A: 2, A2: 2 });
  });

  it("MELI: o mesmo MLB em duas pendências continua marcado", () => {
    const g = classificarPendencias({ pendencias: [pend("X", { itemId: "MLB1" }), pend("Y", { itemId: "MLB1" })], marketplace: "meli", indice: new Map() });
    expect(g.mesmoItem).toEqual({ X: 2, Y: 2 });
  });
});
