// Formatação pt-BR e a regra de honestidade do Portal:
//   null/undefined/NaN = AUSENTE ("—")   ·   0 = zero REAL
// O backend manda números; formatar é responsabilidade do cliente.

import { describe, it, expect } from "vitest";
import { formatarMoeda, formatarVariacaoMoeda, formatarMoedaCompacta } from "./currency.js";
import { formatarPercentual, formatarVariacaoPercentual, formatarPontosPercentuais } from "./percentage.js";
import { formatarNumero, direcao, ehAusente, somaEstrita, AUSENTE } from "./numbers.js";
import { rotularCompetencia, competenciaAnterior, competenciasRecentes, ehCompetencia, formatarData } from "./dates.js";
import { montarIntervencoes, ajustesDoCenarioRapido, contemCampoDeAds, ajusteVazio, ehNeutro } from "./cenario.js";

describe("moeda pt-BR", () => {
  it("usa separador de milhar e vírgula decimal", () => {
    expect(formatarMoeda(1234.5)).toBe("R$ 1.234,50");
    expect(formatarMoeda(100000)).toBe("R$ 100.000,00");
  });

  it("usa o sinal de menos tipográfico em negativos", () => {
    expect(formatarMoeda(-2640)).toBe("−R$ 2.640,00");
  });

  it("zero REAL continua zero", () => {
    expect(formatarMoeda(0)).toBe("R$ 0,00");
  });

  it("ausente vira travessão, nunca zero", () => {
    expect(formatarMoeda(null)).toBe(AUSENTE);
    expect(formatarMoeda(undefined)).toBe(AUSENTE);
    expect(formatarMoeda(NaN)).toBe(AUSENTE);
    expect(formatarMoeda(Infinity)).toBe(AUSENTE);
  });

  it("variação traz sinal explícito", () => {
    expect(formatarVariacaoMoeda(3500)).toBe("+R$ 3.500,00");
    expect(formatarVariacaoMoeda(-500)).toBe("−R$ 500,00");
    expect(formatarVariacaoMoeda(null)).toBe(AUSENTE);
  });

  it("versão compacta para valores grandes", () => {
    expect(formatarMoedaCompacta(1_500_000)).toBe("R$ 1,5 mi");
    expect(formatarMoedaCompacta(45_000)).toBe("R$ 45 mil");
    expect(formatarMoedaCompacta(null)).toBe(AUSENTE);
  });
});

describe("percentual pt-BR", () => {
  it("converte fração em percentual", () => {
    expect(formatarPercentual(0.041)).toBe("4,1%");
    expect(formatarPercentual(0.22)).toBe("22,0%");
  });

  it("TACoS ausente vira travessão, não 0%", () => {
    expect(formatarPercentual(null)).toBe(AUSENTE);
  });

  it("variação percentual com sinal", () => {
    expect(formatarVariacaoPercentual(0.124)).toBe("+12,4%");
    expect(formatarVariacaoPercentual(-0.081)).toBe("−8,1%");
  });

  it("pontos percentuais vêm prontos do backend", () => {
    expect(formatarPontosPercentuais(1.3)).toBe("+1,3 p.p.");
    expect(formatarPontosPercentuais(-0.5)).toBe("−0,5 p.p.");
    expect(formatarPontosPercentuais(null)).toBe(AUSENTE);
  });
});

describe("números e direção", () => {
  it("formata inteiros em pt-BR", () => {
    expect(formatarNumero(1500)).toBe("1.500");
    expect(formatarNumero(0)).toBe("0");
    expect(formatarNumero(null)).toBe(AUSENTE);
  });

  it("direção inverte para métricas em que subir é ruim", () => {
    expect(direcao(10)).toBe("positivo");
    expect(direcao(10, { inverso: true })).toBe("negativo");
    expect(direcao(0)).toBe("neutro");
    expect(direcao(null)).toBe("ausente");
  });

  it("ausente é diferente de zero", () => {
    expect(ehAusente(null)).toBe(true);
    expect(ehAusente(0)).toBe(false);
  });

  it("soma estrita não fabrica total com parcela ausente", () => {
    expect(somaEstrita(10, 20)).toBe(30);
    expect(somaEstrita(10, null)).toBe(null);
  });
});

describe("competências", () => {
  it("valida o formato YYYY-MM", () => {
    expect(ehCompetencia("2026-06")).toBe(true);
    expect(ehCompetencia("2026-6")).toBe(false);
  });

  it("rotula em pt-BR", () => {
    expect(rotularCompetencia("2026-06")).toBe("Junho/2026");
  });

  it("volta um mês atravessando o ano", () => {
    expect(competenciaAnterior("2026-01")).toBe("2025-12");
  });

  it("lista as mais recentes primeiro", () => {
    expect(competenciasRecentes(3, new Date(2026, 6, 15))).toEqual(["2026-07", "2026-06", "2026-05"]);
  });

  it("formata data ISO em dd/mm/aaaa", () => {
    expect(formatarData("2026-06-30")).toBe("30/06/2026");
    expect(formatarData(null)).toBe(AUSENTE);
  });
});

describe("cenário do simulador", () => {
  it("converte pontos percentuais em fração", () => {
    expect(montarIntervencoes({ MLB1: { ...ajusteVazio(), deltaPrecoPct: 5 } }))
      .toEqual([{ mlb: "MLB1", deltaPrecoPct: 0.05 }]);
    expect(montarIntervencoes({ MLB1: { ...ajusteVazio(), deltaCustoPct: -5 } }))
      .toEqual([{ mlb: "MLB1", deltaCustoPct: -0.05 }]);
  });

  it("descarta controles neutros", () => {
    expect(montarIntervencoes({ MLB1: ajusteVazio() })).toEqual([]);
    expect(ehNeutro(ajusteVazio())).toBe(true);
  });

  it("pausar ignora os deltas do mesmo produto", () => {
    expect(montarIntervencoes({ MLB1: { deltaPrecoPct: 10, deltaCustoPct: 3, deltaFretePct: 0, pausar: true } }))
      .toEqual([{ mlb: "MLB1", pausar: true }]);
  });

  it("nunca emite campo de Ads no payload", () => {
    const intervencoes = montarIntervencoes({ MLB1: { ...ajusteVazio(), deltaPrecoPct: 5, adsNovo: 1000 } });
    expect(intervencoes[0]).not.toHaveProperty("adsNovo");
    expect(contemCampoDeAds({ intervencoes })).toBe(false);
  });

  it("detecta tentativa de enviar Ads", () => {
    expect(contemCampoDeAds({ adsNovo: 500 })).toBe(true);
    expect(contemCampoDeAds({ tacosAlvo: 0.06 })).toBe(true);
    expect(contemCampoDeAds({ intervencoes: [{ mlb: "A", ads: 10 }] })).toBe(true);
  });

  it("cenários rápidos são operacionais e não existe cenário de Ads", () => {
    const produtos = [{ mlb: "A", noVermelho: false }, { mlb: "B", noVermelho: true }];
    expect(Object.keys(ajustesDoCenarioRapido("parar_vermelho", produtos))).toEqual(["B"]);
    expect(ajustesDoCenarioRapido("subir_precos_5", produtos).A.deltaPrecoPct).toBe(5);
    expect(ajustesDoCenarioRapido("reduzir_custos_5", produtos).A.deltaCustoPct).toBe(-5);
    expect(ajustesDoCenarioRapido("cortar_ads", produtos)).toEqual({});
    expect(ajustesDoCenarioRapido("tacos_alvo", produtos)).toEqual({});
  });
});
