import { describe, it, expect } from "vitest";
import { normalizarCompetencia, mesmaCompetencia } from "./competencia.js";
import { statusDaCompetencia } from "./statusCompetencia.js";

describe("normalizarCompetencia (espelho de server/utils/competenciaCanonica)", () => {
  it.each([
    ["2026-10", "2026-10"],
    ["2026-10-31T23:00:00Z", "2026-10"],
    ["10/2026", "2026-10"],
    ["2026/10", "2026-10"],
    ["Outubro 2026", "2026-10"],
    ["março/2026", "2026-03"],
    ["maio de 2026", "2026-05"],
  ])("%s → %s", (entrada, saida) => {
    expect(normalizarCompetencia(entrada)).toBe(saida);
  });

  it.each(["2026-07 a 2026-08", "Agosto 2026-08 (parcial)", "", null, undefined, 202610, "2026-13"])(
    "ambíguo ou inválido (%s) → null, nunca um mês inventado",
    (entrada) => {
      expect(normalizarCompetencia(entrada)).toBeNull();
    }
  );

  it("mesmaCompetencia é igualdade, não substring", () => {
    expect(mesmaCompetencia("Agosto 2026", "2026-08")).toBe(true);
    expect(mesmaCompetencia("2026-07 a 2026-08", "2026-08")).toBe(false);
    expect(mesmaCompetencia(null, null)).toBe(false);
  });
});

describe("statusDaCompetencia", () => {
  it("sem entrega e sem processamento → Sem fechamento", () => {
    expect(statusDaCompetencia({}).chave).toBe("sem_fechamento");
  });
  it("processado e não salvo vence a entrega existente", () => {
    expect(statusDaCompetencia({ entrega: { publicado: true }, processadoNaoSalvo: true }).chave).toBe("processado");
  });
  it("rascunho, publicado e despublicado (já teve link)", () => {
    expect(statusDaCompetencia({ entrega: { publicado: false } }).chave).toBe("rascunho");
    expect(statusDaCompetencia({ entrega: { publicado: true, token_publico: "t" } }).chave).toBe("publicado");
    expect(statusDaCompetencia({ entrega: { publicado: false, token_publico: "t" } }).chave).toBe("despublicado");
  });
  it("entrega legada não vira status da conta — só sinaliza", () => {
    const s = statusDaCompetencia({ entrega: null, entregaLegada: { id: 1 } });
    expect(s.chave).toBe("sem_fechamento");
    expect(s.legado).toBe(true);
  });
});
