// frontend-react/src/hooks/useVfContext.test.js
//
// O nome amigável do cliente chega pela ponte `vf:context` em
// `snapshot.cliente` (getClienteMeta() de Portal/vf-context.js) — no MESMO
// emit que troca cliente/conta. Nunca derivado do slug.

import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { nomeDoCliente, useOperacaoAtual } from "./useVfContext.js";

function emitir(snapshot) {
  act(() => {
    document.dispatchEvent(new CustomEvent("vf:context", { detail: snapshot }));
  });
}

function snap({ clienteId = 87, slug = "influencia-jeans", contaId = 42, nome = "Influência Jeans", marketplace = "meli", clienteMeta } = {}) {
  return {
    state: "READY",
    context: { clienteId, clienteSlug: slug, clienteContaId: contaId },
    cliente: clienteMeta !== undefined ? clienteMeta : { id: clienteId, slug, nome },
    meta: { id: contaId, nome: "Conta " + contaId, marketplace },
    integration: { grant: null, base: null },
    error: null,
  };
}

describe("nomeDoCliente", () => {
  it("nome da carteira do Shell para o cliente do contexto", () => {
    expect(nomeDoCliente(snap())).toBe("Influência Jeans");
  });

  it("cliente do snapshot de OUTRO id não vale (nada stale)", () => {
    expect(nomeDoCliente(snap({ clienteMeta: { id: 1, slug: "outro", nome: "Outro Cliente" } }))).toBeNull();
  });

  it("sem nome (ou vazio) → null; o slug nunca vira nome", () => {
    expect(nomeDoCliente(snap({ nome: null }))).toBeNull();
    expect(nomeDoCliente(snap({ nome: "   " }))).toBeNull();
    expect(nomeDoCliente(snap({ clienteMeta: null }))).toBeNull();
    expect(nomeDoCliente({ state: "BOOT", context: null, cliente: null })).toBeNull();
  });
});

describe("useOperacaoAtual · nome do cliente", () => {
  it("expõe id, slug, nome, conta e marketplace do mesmo snapshot — e troca tudo junto", () => {
    const { result } = renderHook(() => useOperacaoAtual());
    emitir(snap());
    expect(result.current).toMatchObject({ clienteId: 87, clienteSlug: "influencia-jeans", clienteNome: "Influência Jeans", clienteContaId: 42, marketplace: "meli", pronta: true });

    emitir(snap({ clienteId: 90, slug: "zenite", contaId: 77, nome: "Zenite Comercial", marketplace: "shopee" }));
    expect(result.current).toMatchObject({ clienteId: 90, clienteSlug: "zenite", clienteNome: "Zenite Comercial", clienteContaId: 77, marketplace: "shopee" });

    // Cliente sem nome na carteira: o nome anterior NÃO sobrevive.
    emitir(snap({ clienteId: 91, slug: "sem-nome", contaId: 78, nome: null }));
    expect(result.current.clienteNome).toBeNull();
    expect(result.current.clienteSlug).toBe("sem-nome");
  });
});
