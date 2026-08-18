import { describe, it, expect } from "vitest";
import { classificarStatusConta } from "./fullAccountStatus.js";

describe("classificarStatusConta", () => {
  it("sem grant vira 'sem_grant' / Aguardando grant", () => {
    expect(classificarStatusConta({ grant: null })).toEqual({ code: "sem_grant", label: "Aguardando grant", symbol: "○" });
    expect(classificarStatusConta(null)).toEqual({ code: "sem_grant", label: "Aguardando grant", symbol: "○" });
  });

  it("grant com token_status='valid' vira 'conectado'", () => {
    expect(classificarStatusConta({ grant: { token_status: "valid" } })).toEqual({
      code: "conectado",
      label: "Conectado",
      symbol: "●",
    });
  });

  it("grant sem token_status explícito é tratado como válido (mesmo default do backend)", () => {
    expect(classificarStatusConta({ grant: { token_status: null } }).code).toBe("conectado");
  });

  it("grant com token_status diferente de 'valid' vira 'atencao' / Grant com problema", () => {
    expect(classificarStatusConta({ grant: { token_status: "expired" } })).toEqual({
      code: "atencao",
      label: "Grant com problema",
      symbol: "⚠",
    });
    expect(classificarStatusConta({ grant: { token_status: "revoked" } }).code).toBe("atencao");
  });
});
