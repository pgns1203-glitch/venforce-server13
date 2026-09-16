// Testes do hook de Histórico (Fase 6) — LAZY (só busca quando habilitado,
// depois que o bootstrap já resolveu), cancela ao trocar de conta.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useHistoricoV3 } from "./useHistoricoV3.js";

const api = vi.hoisted(() => ({ obterHistoricoV3: vi.fn() }));
vi.mock("../services/cliente360V3HistoricoApi.js", () => api);

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("useHistoricoV3 · lazy", () => {
  it("não busca quando habilitado=false", async () => {
    const { result } = renderHook(() => useHistoricoV3({ clienteSlug: "n97", clienteContaId: 10, habilitado: false }));
    await waitFor(() => expect(result.current.carregando).toBe(false));
    expect(api.obterHistoricoV3).not.toHaveBeenCalled();
    expect(result.current.dados).toBeNull();
  });

  it("busca quando habilitado=true e devolve os eventos", async () => {
    api.obterHistoricoV3.mockResolvedValue({ historico: { eventos: [{ tipo: "entrega", escopo: "account" }], fontes: {} } });
    const { result } = renderHook(() => useHistoricoV3({ clienteSlug: "n97", clienteContaId: 10, habilitado: true }));
    await waitFor(() => expect(result.current.dados).not.toBeNull());
    expect(result.current.dados.eventos).toHaveLength(1);
  });
});

describe("useHistoricoV3 · troca de contexto cancela a requisição anterior", () => {
  it("trocar de conta aborta o request em voo e só a resposta da conta nova é aplicada", async () => {
    let resolverPrimeira, resolverSegunda;
    api.obterHistoricoV3
      .mockImplementationOnce(() => new Promise((res) => { resolverPrimeira = res; }))
      .mockImplementationOnce(() => new Promise((res) => { resolverSegunda = res; }));

    const { result, rerender } = renderHook(
      ({ clienteContaId }) => useHistoricoV3({ clienteSlug: "n97", clienteContaId, habilitado: true }),
      { initialProps: { clienteContaId: 10 } }
    );
    await waitFor(() => expect(api.obterHistoricoV3).toHaveBeenCalledTimes(1));
    const primeiroSignal = api.obterHistoricoV3.mock.calls[0][1].signal;

    rerender({ clienteContaId: 11 });
    await waitFor(() => expect(api.obterHistoricoV3).toHaveBeenCalledTimes(2));
    expect(primeiroSignal.aborted).toBe(true);

    await act(async () => resolverPrimeira({ historico: { eventos: [{ tipo: "conta-10-atrasada" }], fontes: {} } }));
    expect(result.current.dados).toBeNull();

    await act(async () => resolverSegunda({ historico: { eventos: [{ tipo: "conta-11" }], fontes: {} } }));
    await waitFor(() => expect(result.current.dados?.eventos?.[0]?.tipo).toBe("conta-11"));
  });
});
