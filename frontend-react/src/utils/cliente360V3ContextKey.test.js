// Espelha, propositalmente, os mesmos 10 casos de
// server/tests/cliente360V3ContextKey.test.js — os dois algoritmos
// PRECISAM concordar byte a byte (ver o comentário no topo do módulo).

import { describe, it, expect } from "vitest";
import { criarContextKey } from "./cliente360V3ContextKey.js";

const base = { clienteId: 1, clienteContaId: 10, periodo: "2026-08", compararCom: "2026-07" };

describe("criarContextKey (frontend) · mesmo contrato do backend", () => {
  it("mesmos campos → mesma chave", () => {
    expect(criarContextKey(base)).toBe(criarContextKey({ ...base }));
  });

  it("clienteContaId diferente → chave diferente (conta A não pode reaproveitar cache da conta B)", () => {
    expect(criarContextKey(base)).not.toBe(criarContextKey({ ...base, clienteContaId: 11 }));
  });

  it("clienteId diferente → chave diferente", () => {
    expect(criarContextKey(base)).not.toBe(criarContextKey({ ...base, clienteId: 2 }));
  });

  it("periodo diferente → chave diferente", () => {
    expect(criarContextKey(base)).not.toBe(criarContextKey({ ...base, periodo: "2026-09" }));
  });

  it("compararCom diferente → chave diferente", () => {
    expect(criarContextKey(base)).not.toBe(criarContextKey({ ...base, compararCom: "2026-06" }));
  });

  it("compararCom ausente (undefined) e compararCom=null → mesma chave (normalizado)", () => {
    expect(criarContextKey({ ...base, compararCom: undefined })).toBe(criarContextKey({ ...base, compararCom: null }));
  });

  it("clienteId ausente → null (contexto incompleto nunca gera chave válida)", () => {
    expect(criarContextKey({ ...base, clienteId: null })).toBeNull();
  });

  it("clienteContaId ausente → null", () => {
    expect(criarContextKey({ ...base, clienteContaId: null })).toBeNull();
  });

  it("periodo ausente → null", () => {
    expect(criarContextKey({ ...base, periodo: null })).toBeNull();
  });

  it("chave é string quando completa, e é exatamente o formato clienteId:clienteContaId:periodo:compararCom", () => {
    expect(criarContextKey(base)).toBe("1:10:2026-08:2026-07");
  });
});
